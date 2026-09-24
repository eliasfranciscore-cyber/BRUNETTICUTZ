/* ================================================================
   Catálogo de productos del módulo "Essentials" (tienda de clientes) y su
   inventario.
   No es una función serverless propia: Vercel Hobby tope 12 funciones,
   así que api/services.js delega aquí cuando ?scope=shop o ?scope=inventory
   (igual patrón que push.js absorbió el cron de recordatorios).

   products.stock ES LA VERDAD. Es lo que leen y descuentan el checkout y el
   webhook de Mercado Pago (api/mp-payments.js), y lo que la versión anterior
   de este archivo sigue leyendo si hay que volver atrás. El libro
   product_stock_moves es la HISTORIA de por qué cambió: cada escritura de
   stock que pasa por acá deja su movimiento en el MISMO statement, así que
   los dos no pueden quedar a medias. Lo que no pasa por acá (un rollback, un
   camino viejo) se ve en la vista de inventario como desfase (stock − suma del
   libro), y "cuadrar" inserta un 'ajuste' por esa diferencia. Nunca se
   reescribe el stock desde el libro: eso borraría en silencio justo lo que el
   desfase existe para mostrar.

   Un solo interruptor de visibilidad: "Publicado" = `active`. Publicado y con
   stock → aparece en /essentials y se puede vender en el mesón.

   Sin comisión en ningún lado (BrunettiCutz es un solo barbero).
   ================================================================ */

import { neon } from "@neondatabase/serverless"
import { put } from "@vercel/blob"
import { requireInternal } from "./_auth.js"
import { ensureProductsLedger } from "./_schema.js"

const DEMO_PRODUCTS = [
  {
    id: 1,
    name: "Polera Barber Club",
    brand: "Barber Club",
    description: "Ven y sé parte del Club usando Polera Boxy Fit con estilo streetwear.",
    price: 19990,
    oldPrice: null,
    stock: 10,
    active: true,
    sortOrder: 0,
    imgFront: "/assets/products/polera-barber-club-1.png",
    imgBack: "/assets/products/polera-barber-club-2.png",
    imgDetail: "/assets/products/polera-barber-club-3.png",
  },
]

/* Tipos de movimiento que una persona declara a mano desde Inventario.
   'inicial' no está: lo escribe el alta de un producto con stock.
   'venta' tampoco: lo escriben el webhook de Mercado Pago y la venta en el
   mesón, cada uno en su flujo. */
const MANUAL_MOVE_KINDS = ["compra", "devolucion", "merma", "ajuste"]

/* Cuáles suman y cuáles restan. 'ajuste' es el único que puede ir para los dos
   lados, así que lo decide el signo de la cantidad que llega. */
const MOVE_SIGN = { compra: 1, devolucion: 1, merma: -1, ajuste: 0 }

const MAX_STOCK = 100000
const MAX_MONEY = 10_000_000
const BUSINESS_TZ = "America/Santiago"

/* La tienda pública no depende de la migración del inventario (esa corre en
   los caminos del panel, ver ensureProductsLedger): solo necesita que la tabla
   exista, como siempre. Se recuerda por instancia para no repetir el CREATE
   en cada visita (Neon cobra tiempo de cómputo activo). */
let productsTableReady = null
function ensureProductsTable(sql) {
  if (!productsTableReady) {
    productsTableReady = Promise.resolve(sql`
      CREATE TABLE IF NOT EXISTS products (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(200) NOT NULL,
        brand       VARCHAR(120) DEFAULT '',
        description TEXT         DEFAULT '',
        price       INTEGER      NOT NULL,
        old_price   INTEGER,
        stock       INTEGER      NOT NULL DEFAULT 0,
        active      BOOLEAN      NOT NULL DEFAULT true,
        sort_order  INTEGER      NOT NULL DEFAULT 0,
        img_front   TEXT,
        img_back    TEXT,
        img_detail  TEXT,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `).catch((err) => {
      productsTableReady = null
      throw err
    })
  }
  return productsTableReady
}

/* Qué viaja según quién pregunta:
     público   lo que la tienda necesita para vender, como siempre.
     interno   agrega sku y archivado.
     admin     agrega el costo de compra, que es el margen de la casa. */
function toClient(row, { internal = false, admin = false } = {}) {
  const base = {
    id: row.id,
    name: row.name,
    brand: row.brand || "",
    description: row.description || "",
    price: row.price,
    oldPrice: row.old_price ?? null,
    stock: Number(row.stock ?? 0),
    active: row.active,
    sortOrder: row.sort_order,
    imgFront: row.img_front,
    imgBack: row.img_back,
    imgDetail: row.img_detail,
  }
  if (!internal) return base
  base.sku = row.sku || ""
  base.archived = Boolean(row.archived_at)
  if (admin) base.cost = row.cost ?? null
  return base
}

const has = (body, key) => Object.prototype.hasOwnProperty.call(body || {}, key)
const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "")

/* Entero dentro de [min, max], o un error para el 400. `blank` = vacío. */
function readInt(value, { min = 0, max = MAX_MONEY, label }) {
  if (blank(value)) return { value: null }
  const n = Number(typeof value === "string" ? value.trim() : value)
  if (!Number.isFinite(n)) return { error: `${label} inválido` }
  const rounded = Math.round(n)
  if (rounded < min || rounded > max) return { error: `${label} inválido` }
  return { value: rounded }
}

/* Timestamp ISO sin milisegundos (el formato del resto de la API). */
function isoNoMs(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().replace(/\.\d{3}Z$/, "Z")
}

/* created_by apunta a barbers(id). Una sesión sin id, o con el de un barbero
   que ya no existe, deja el movimiento sin autor en vez de reventar la FK. */
const sessionBarberId = (session) => (Number.isInteger(Number(session?.id)) && Number(session?.id) > 0 ? Number(session.id) : null)

/* ============================================================================
   CATÁLOGO — /api/services?scope=shop
   ========================================================================= */

export async function handleProducts(req, res) {
  // Verifica sesión ANTES de tocar la base de datos: si esto viviera dentro
  // del try/catch de más abajo, una caída de la DB (o DATABASE_URL ausente)
  // saltaría directo al fallback de demo sin haber validado nada, dejando
  // ver la lista completa (incluyendo ocultos) a cualquiera sin sesión.
  const isGet = req.method === "GET"
  const includeInactive = isGet && req.query.includeInactive === "true"
  const forSale = isGet && !includeInactive && req.query.for === "venta"
  let session = null
  if (includeInactive || forSale) {
    session = requireInternal(req, res)
    if (!session) return
  } else if (!isGet) {
    session = requireInternal(req, res, { admin: true })
    if (!session) return
  }
  const internal = Boolean(session)
  const admin = Boolean(session?.admin)

  try {
    const sql = neon(process.env.DATABASE_URL)

    if (isGet && !internal) {
      // Catálogo público. archived_at por to_jsonb: esta rama no corre la
      // migración, así que no puede nombrar la columna directo (da NULL si
      // todavía no existe). Un archivado igual tiene active = false; esto es
      // el cinturón.
      await ensureProductsTable(sql)
      const rows = await sql`
        SELECT * FROM products p
        WHERE p.active = true AND p.stock > 0 AND (to_jsonb(p)->>'archived_at') IS NULL
        ORDER BY p.sort_order, p.id
      `
      /* checkoutEnabled le dice a la tienda si hay pasarela viva. Sin esto el
         botón de pagar se ofrece igual y recién al tocarlo el cliente
         descubre que no funciona: peor que no ofrecerlo. */
      return res.json({
        ok: true,
        products: rows.map((r) => toClient(r)),
        checkoutEnabled: Boolean(process.env.MP_ACCESS_TOKEN),
      })
    }

    // De acá para abajo todo es del panel: acá sí corre la migración.
    await ensureProductsLedger(sql)

    if (isGet) {
      if (forSale) {
        // Lo vendible en el mesón: publicado, no archivado y con stock.
        const rows = await sql`
          SELECT * FROM products
          WHERE active = true AND archived_at IS NULL AND stock > 0
          ORDER BY sort_order, id
        `
        return res.json({
          ok: true,
          products: rows.map((r) => ({ ...toClient(r, { internal, admin }), photo: r.img_front || null })),
        })
      }
      const includeArchived = req.query.includeArchived === "1"
      const rows = await sql`
        SELECT * FROM products
        WHERE archived_at IS NULL OR ${includeArchived}::boolean
        ORDER BY archived_at NULLS FIRST, sort_order, id
      `
      return res.json({ ok: true, products: rows.map((r) => toClient(r, { internal, admin })) })
    }

    // `return await` y no `return` a secas: sin el await, un error de la base
    // dentro del helper rechaza DESPUÉS de salir del try y se saltea el catch
    // de abajo (el request queda colgado en vez de responder 500).
    if (req.method === "POST") {
      if (req.query.upload === "1") return await uploadImage(req, res, sql)
      return await createProduct(req, res, sql, session)
    }

    if (req.method === "PATCH") {
      if (req.body?.reorder && Array.isArray(req.body.order)) {
        const order = req.body.order.map(Number).filter(Number.isFinite)
        for (let i = 0; i < order.length; i++) {
          await sql`UPDATE products SET sort_order = ${i}, updated_at = NOW() WHERE id = ${order[i]}`
        }
        return res.json({ ok: true })
      }
      return await updateProduct(req, res, sql, session)
    }

    if (req.method === "DELETE") {
      const id = Number(req.query.id || (req.body || {}).id)
      if (!id) return res.status(400).json({ ok: false, error: "id requerido" })
      return await removeProduct(res, sql, id)
    }

    return res.status(405).json({ error: "Method not allowed" })
  } catch (err) {
    console.error("products error:", err)
    if (isGet && !internal) {
      // Sin base no hay cómo crear el pedido, así que tampoco hay checkout.
      return res.json({ ok: true, products: DEMO_PRODUCTS.filter((p) => p.active && p.stock > 0), checkoutEnabled: false })
    }
    // Panel: nunca filas de demo sobre las que se pueda actuar (editar el
    // producto 1 inventado escribiría sobre el producto 1 real). La sesión ya
    // se validó arriba antes del try; llegar aquí es un error real de DB.
    return res.status(500).json({ ok: false, error: "No se pudo procesar productos" })
  }
}

/* Lee sku / costo del body. `touched` distingue "no vino" de "vino vacío a
   propósito", para que el PATCH del panel viejo (que no los conoce) no los
   borre. */
function readCatalogFields(body) {
  const out = { skuTouched: has(body, "sku"), sku: null, costTouched: has(body, "cost"), cost: null }
  if (out.skuTouched && !blank(body.sku)) out.sku = String(body.sku).trim().slice(0, 60)
  if (out.costTouched) {
    const cost = readInt(body.cost, { min: 0, max: MAX_MONEY, label: "Costo" })
    if (cost.error) return { error: cost.error }
    out.cost = cost.value
  }
  return out
}

/* Precio "antes" (tachado). Vacío o 0 = sin precio anterior, como siempre.
   Uno que no es número responde 400 en vez de reventar contra la columna
   INTEGER con un 500. */
function readOldPrice(value) {
  const parsed = readInt(value, { min: 0, max: MAX_MONEY, label: "Precio anterior" })
  if (parsed.error) return parsed
  return { value: parsed.value || null }
}

async function createProduct(req, res, sql, session) {
  const body = req.body || {}
  const { name, brand, description, price, oldPrice } = body
  if (!String(name || "").trim() || !Number.isFinite(Number(price))) {
    return res.status(400).json({ ok: false, error: "Datos incompletos" })
  }
  const stock = readInt(body.stock, { min: 0, max: MAX_STOCK, label: "Stock" })
  if (stock.error) return res.status(400).json({ ok: false, error: stock.error })
  const fields = readCatalogFields(body)
  if (fields.error) return res.status(400).json({ ok: false, error: fields.error })
  const oldPriceValue = readOldPrice(oldPrice)
  if (oldPriceValue.error) return res.status(400).json({ ok: false, error: oldPriceValue.error })
  const active = typeof body.active === "boolean" ? body.active : true

  // Producto y su movimiento 'inicial' en un solo statement: o quedan los dos
  // o ninguno. Sin stock no hay movimiento (el CHECK delta <> 0 lo exige).
  const [row] = await sql`
    WITH p AS (
      INSERT INTO products (name, brand, description, price, old_price, stock, active, sort_order, sku, cost)
      VALUES (
        ${String(name).trim()}, ${String(brand || "").trim()}, ${String(description || "").trim()},
        ${Math.round(Number(price))}, ${oldPriceValue.value}::int, ${stock.value ?? 0}, ${active},
        (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM products),
        ${fields.sku}, ${fields.cost}
      )
      RETURNING *
    ), mv AS (
      INSERT INTO product_stock_moves (product_id, delta, kind, reason, unit_cost, created_by)
      SELECT p.id, p.stock, 'inicial', 'Stock al crear el producto', p.cost,
             (SELECT b.id FROM barbers b WHERE b.id = ${sessionBarberId(session)}::int)
      FROM p WHERE p.stock > 0
      RETURNING id
    )
    SELECT p.* FROM p
  `
  return res.json({ ok: true, product: toClient(row, { internal: true, admin: Boolean(session?.admin) }) })
}

async function updateProduct(req, res, sql, session) {
  const body = req.body || {}
  const { id, name, brand, description, price, oldPrice, active } = body
  if (!id) return res.status(400).json({ ok: false, error: "id requerido" })
  const touchPrice = !blank(price)
  if (touchPrice && !Number.isFinite(Number(price))) return res.status(400).json({ ok: false, error: "Precio inválido" })

  // El stock se sigue pudiendo mandar desde la ficha (el stepper del panel):
  // se traduce en un movimiento 'ajuste' por la diferencia, en el mismo
  // statement que el cambio de stock.
  const touchStock = !blank(body.stock)
  const stock = readInt(body.stock, { min: 0, max: MAX_STOCK, label: "Stock" })
  if (stock.error) return res.status(400).json({ ok: false, error: stock.error })
  const fields = readCatalogFields(body)
  if (fields.error) return res.status(400).json({ ok: false, error: fields.error })
  const oldPriceValue = readOldPrice(oldPrice)
  if (oldPriceValue.error) return res.status(400).json({ ok: false, error: oldPriceValue.error })
  const touchArchived = typeof body.archived === "boolean"

  // Los campos "déjalo como está" van con CASE WHEN y un booleano, NO con un
  // fragmento sql`columna` anidado: este driver manda todo lo interpolado como
  // PARÁMETRO, así que un fragmento anidado llegaba como el texto JSON del
  // objeto y reventaba contra la columna INTEGER. Era un campo minado latente
  // en old_price (no explotaba solo porque el panel siempre manda la llave,
  // aunque sea en null).
  //
  // cur toma el candado de la fila: el delta del ajuste se calcula contra el
  // stock vigente, aunque un webhook lo haya descontado recién.
  const [row] = await sql`
    WITH cur AS (
      SELECT id, stock FROM products WHERE id = ${Number(id)} FOR UPDATE
    ), upd AS (
      UPDATE products p SET
        name        = COALESCE(${name ?? null}, p.name),
        brand       = COALESCE(${brand ?? null}, p.brand),
        description = COALESCE(${description ?? null}, p.description),
        price       = COALESCE(${touchPrice ? Math.round(Number(price)) : null}::int, p.price),
        old_price   = CASE WHEN ${oldPrice !== undefined}::boolean
                           THEN ${oldPriceValue.value}::int
                           ELSE p.old_price END,
        stock       = CASE WHEN ${touchStock}::boolean THEN ${stock.value}::int ELSE p.stock END,
        active      = CASE WHEN ${touchArchived && body.archived === true}::boolean THEN false
                           ELSE COALESCE(${typeof active === "boolean" ? active : null}::boolean, p.active) END,
        sku         = CASE WHEN ${fields.skuTouched}::boolean THEN ${fields.sku}::varchar ELSE p.sku END,
        cost        = CASE WHEN ${fields.costTouched}::boolean THEN ${fields.cost}::int ELSE p.cost END,
        archived_at = CASE WHEN ${touchArchived}::boolean
                           THEN (CASE WHEN ${body.archived === true}::boolean THEN COALESCE(p.archived_at, NOW()) ELSE NULL END)
                           ELSE p.archived_at END,
        updated_at  = NOW()
      FROM cur
      WHERE p.id = cur.id
      RETURNING p.*, cur.stock AS stock_before
    ), mv AS (
      INSERT INTO product_stock_moves (product_id, delta, kind, reason, created_by)
      SELECT upd.id, upd.stock - upd.stock_before, 'ajuste', 'Ajuste desde la ficha del producto',
             (SELECT b.id FROM barbers b WHERE b.id = ${sessionBarberId(session)}::int)
      FROM upd
      WHERE upd.stock <> upd.stock_before
      RETURNING id
    )
    SELECT upd.* FROM upd
  `
  return res.json({ ok: true, product: row ? toClient(row, { internal: true, admin: Boolean(session?.admin) }) : null })
}

/* "Eliminar" archiva: los movimientos del libro y las líneas de venta
   referencian el producto, y un DELETE real o reventaría la FK o se llevaría
   la historia. Solo se borra de verdad un producto que nunca tuvo nada (se
   creó sin stock y nunca se movió), que es el caso de "lo creé por error". */
async function removeProduct(res, sql, id) {
  const [ref] = await sql`
    SELECT EXISTS (SELECT 1 FROM products WHERE id = ${id}) AS "exists",
           (EXISTS (SELECT 1 FROM product_stock_moves WHERE product_id = ${id})
            OR EXISTS (SELECT 1 FROM product_sale_items WHERE product_id = ${id})) AS used
  `
  if (!ref?.exists) return res.json({ ok: true, archived: false, deleted: false })

  if (!ref.used) {
    try {
      await sql`DELETE FROM products WHERE id = ${id}`
      return res.json({ ok: true, archived: false, deleted: true })
    } catch (err) {
      // Otro request le escribió un movimiento entre el chequeo y el DELETE:
      // la FK lo frena y se archiva igual.
      if (err?.code !== "23503") throw err
    }
  }
  await sql`
    UPDATE products
    SET archived_at = COALESCE(archived_at, NOW()), active = false, updated_at = NOW()
    WHERE id = ${id}
  `
  return res.json({ ok: true, archived: true, deleted: false })
}

/* ============================================================================
   INVENTARIO — /api/services?scope=inventory   (solo admin)
   GET               lista con stock, suma del libro y desfase
   GET &productId=   el kardex de un producto, con saldo corrido
   POST              movimiento manual (compra, devolución, merma, ajuste)
   POST action=reconcile   cuadra el libro con el stock
   ========================================================================= */

export async function handleInventory(req, res) {
  const session = requireInternal(req, res, { admin: true })
  if (!session) return

  const sql = neon(process.env.DATABASE_URL)
  if (req.method === "GET") {
    try {
      await ensureProductsLedger(sql)
      const productId = Number(req.query.productId || 0)
      if (productId) return await kardex(res, sql, productId)
      return await inventoryList(req, res, sql)
    } catch (err) {
      console.error("inventory error:", err)
      // Sin datos de demo a propósito: un inventario inventado es peor que
      // ninguno — alguien saldría a vender lo que no hay.
      return res.status(503).json({ ok: false, error: "No se pudo leer el inventario" })
    }
  }

  if (req.method === "POST") {
    try {
      await ensureProductsLedger(sql)
      if (req.body?.action === "reconcile") return await reconcile(req, res, sql, session)
      return await manualMove(req, res, sql, session)
    } catch (err) {
      console.error("inventory move error:", err)
      return res.status(500).json({ ok: false, error: "No se pudo registrar el movimiento" })
    }
  }

  return res.status(405).json({ error: "Method not allowed" })
}

/* Una fila del inventario. El desfase (drift) es stock − suma del libro:
   0 = todo lo que movió el stock quedó declarado. Distinto de 0 = algo lo
   movió sin dejar movimiento (un producto de antes del libro, un camino
   viejo), y se cuadra con un 'ajuste'. */
export function inventoryItem(r) {
  const stock = Number(r.stock ?? 0)
  const ledgerStock = Number(r.ledger ?? 0)
  const cost = r.cost == null ? null : Number(r.cost)
  return {
    id: r.id,
    name: r.name,
    brand: r.brand || "",
    sku: r.sku || "",
    price: r.price,
    stock,
    ledgerStock,
    drift: stock - ledgerStock,
    cost,
    // Valorizado al COSTO, no al precio de venta: el inventario es plata que
    // el local puso, no plata que espera ganar.
    value: cost == null ? null : cost * stock,
    active: r.active,
    archived: Boolean(r.archived_at),
    imgFront: r.img_front || null,
    lastMoveAt: isoNoMs(r.last_move_at),
    // Stock bajo cero. El webhook y la venta nunca lo dejan así (una
    // sobreventa web corta el stock en 0 y se ve como desfase positivo: el
    // libro anota lo pedido), así que esto solo se prende si alguien lo
    // escribió a mano por fuera. Se muestra, no se esconde.
    oversold: stock < 0,
  }
}

export function inventoryTotals(items) {
  return {
    units: items.reduce((n, p) => n + p.stock, 0),
    value: items.reduce((n, p) => n + (p.value || 0), 0),
    outOfStock: items.filter((p) => p.stock <= 0).length,
    oversold: items.filter((p) => p.oversold).length,
    withoutCost: items.filter((p) => p.cost == null).length,
    withDrift: items.filter((p) => p.drift !== 0).length,
  }
}

async function inventoryList(req, res, sql) {
  const includeArchived = req.query.includeArchived === "1"
  const rows = await sql`
    SELECT p.id, p.name, p.brand, p.sku, p.price, p.cost, p.stock, p.active, p.archived_at, p.img_front,
           COALESCE(m.ledger, 0)::int AS ledger, m.last_move_at
    FROM products p
    LEFT JOIN (
      SELECT product_id, SUM(delta)::int AS ledger, MAX(created_at) AS last_move_at
      FROM product_stock_moves
      GROUP BY product_id
    ) m ON m.product_id = p.id
    WHERE p.archived_at IS NULL OR ${includeArchived}::boolean
    ORDER BY p.archived_at NULLS FIRST, p.sort_order, p.id
  `
  const items = rows.map(inventoryItem)
  // `products` repite `items` para una UI portada de PimpStudio, que lo lee
  // con ese nombre.
  return res.json({ ok: true, items, products: items, totals: inventoryTotals(items) })
}

/* El kardex de un producto: cada movimiento con su SALDO CORRIDO. Ver el
   número de hoy no dice nada si no se puede seguir cómo llegó hasta ahí. */
async function kardex(res, sql, productId) {
  const [product] = await sql`
    SELECT id, name, brand, sku, cost, stock, active, archived_at FROM products WHERE id = ${productId}
  `
  if (!product) return res.status(404).json({ ok: false, error: "Producto no encontrado" })

  const rows = await sql`
    SELECT m.id, m.delta, m.kind, m.reason, m.unit_cost, m.sale_item_id, m.shop_order_id, m.created_at,
           ((m.created_at AT TIME ZONE ${BUSINESS_TZ})::date)::text AS day,
           b.name AS by_name
    FROM product_stock_moves m
    LEFT JOIN barbers b ON b.id = m.created_by
    WHERE m.product_id = ${productId}
    ORDER BY m.created_at, m.id
  `
  let balance = 0
  const moves = rows.map((r) => {
    balance += Number(r.delta)
    return {
      id: r.id,
      date: r.day,
      createdAt: isoNoMs(r.created_at),
      kind: r.kind,
      delta: Number(r.delta),
      reason: r.reason || "",
      unitCost: r.unit_cost ?? null,
      saleItemId: r.sale_item_id ?? null,
      shopOrderId: r.shop_order_id ?? null,
      byName: r.by_name || null,
      balance,
    }
  })
  const stock = Number(product.stock ?? 0)
  return res.json({
    ok: true,
    product: {
      id: product.id,
      name: product.name,
      brand: product.brand || "",
      sku: product.sku || "",
      cost: product.cost ?? null,
      active: product.active,
      archived: Boolean(product.archived_at),
      stock,
      ledgerStock: balance,
      drift: stock - balance,
    },
    stock,
    ledgerStock: balance,
    drift: stock - balance,
    moves: moves.reverse(), // más reciente arriba; el saldo ya está calculado en orden
  })
}

function moveToClient(m) {
  if (!m?.move_id) return null
  return {
    id: m.move_id,
    productId: m.move_product_id,
    kind: m.move_kind,
    delta: Number(m.move_delta),
    reason: m.move_reason || "",
    unitCost: m.move_unit_cost ?? null,
    date: m.move_day || null,
    createdAt: isoNoMs(m.move_created_at),
  }
}

async function manualMove(req, res, sql, session) {
  const { productId, kind, qty, reason, unitCost } = req.body || {}
  const pid = Number(productId)
  if (!Number.isInteger(pid) || pid <= 0) return res.status(400).json({ ok: false, error: "Producto requerido" })
  if (!MANUAL_MOVE_KINDS.includes(String(kind))) {
    return res.status(400).json({ ok: false, error: "Tipo de movimiento inválido" })
  }
  const amount = Math.round(Number(qty))
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > MAX_STOCK) {
    return res.status(400).json({ ok: false, error: "Indica una cantidad distinta de cero" })
  }
  const motive = String(reason || "").trim().slice(0, 200)
  if (!motive) return res.status(400).json({ ok: false, error: "El motivo es obligatorio" })
  const cost = readInt(unitCost, { min: 0, max: MAX_MONEY, label: "Costo unitario" })
  if (cost.error) return res.status(400).json({ ok: false, error: cost.error })

  // El signo lo pone el tipo, salvo en 'ajuste', que respeta el que venga.
  const sign = MOVE_SIGN[kind]
  const delta = sign === 0 ? amount : Math.abs(amount) * sign
  // Una compra con costo actualiza el costo de referencia del producto: es el
  // número con el que se valoriza todo el stock de ahí en adelante.
  const setCost = kind === "compra" && cost.value != null

  // Stock y movimiento en un solo statement, con la fila tomada: el chequeo
  // de "no queda negativo" es contra el stock vigente, y si no pasa no se
  // escribe ninguno de los dos.
  const [row] = await sql`
    WITH cur AS (
      SELECT id, stock FROM products WHERE id = ${pid} AND archived_at IS NULL FOR UPDATE
    ), upd AS (
      UPDATE products p SET
        stock = p.stock + ${delta}::int,
        cost = CASE WHEN ${setCost}::boolean THEN ${cost.value}::int ELSE p.cost END,
        updated_at = NOW()
      FROM cur
      WHERE p.id = cur.id AND cur.stock + ${delta}::int >= 0
      RETURNING p.id, p.stock
    ), mv AS (
      INSERT INTO product_stock_moves (product_id, delta, kind, reason, unit_cost, created_by)
      SELECT upd.id, ${delta}::int, ${kind}::varchar, ${motive}::text, ${cost.value}::int,
             (SELECT b.id FROM barbers b WHERE b.id = ${sessionBarberId(session)}::int)
      FROM upd
      RETURNING id, product_id, delta, kind, reason, unit_cost, created_at
    )
    SELECT (SELECT stock FROM cur) AS before, (SELECT stock FROM upd) AS after,
           mv.id AS move_id, mv.product_id AS move_product_id, mv.delta AS move_delta, mv.kind AS move_kind,
           mv.reason AS move_reason, mv.unit_cost AS move_unit_cost, mv.created_at AS move_created_at,
           ((mv.created_at AT TIME ZONE ${BUSINESS_TZ})::date)::text AS move_day
    FROM (SELECT 1) one LEFT JOIN mv ON true
  `
  if (row?.before == null) return res.status(404).json({ ok: false, error: "Producto no encontrado" })
  if (row.after == null) {
    const before = Number(row.before)
    return res.status(409).json({
      ok: false,
      error: `No alcanza el stock: hay ${before} y el movimiento dejaría ${before + delta}.`,
      stock: before,
    })
  }
  return res.json({ ok: true, productId: pid, move: moveToClient(row), stock: Number(row.after) })
}

/* Cuadrar: inserta un 'ajuste' igual al desfase, así la suma del libro queda
   igual al stock. NO toca el stock (el stock es la verdad).
   Dos statements en una transacción: el primero toma el candado de la fila y
   el segundo, que ya corre con una foto nueva de la base, suma el libro. Así
   un doble toque en "Cuadrar" no inserta dos ajustes: el segundo espera al
   primero y encuentra el desfase ya en 0. */
async function reconcile(req, res, sql, session) {
  const pid = Number(req.body?.productId)
  if (!Number.isInteger(pid) || pid <= 0) return res.status(400).json({ ok: false, error: "Producto requerido" })

  const results = await sql.transaction([
    sql`SELECT id FROM products WHERE id = ${pid} FOR UPDATE`,
    sql`
      WITH cur AS (
        SELECT p.id, p.stock,
               COALESCE((SELECT SUM(m.delta) FROM product_stock_moves m WHERE m.product_id = p.id), 0)::int AS ledger
        FROM products p WHERE p.id = ${pid}
      ), mv AS (
        INSERT INTO product_stock_moves (product_id, delta, kind, reason, created_by)
        SELECT cur.id, cur.stock - cur.ledger, 'ajuste', 'Cuadre del libro con el stock',
               (SELECT b.id FROM barbers b WHERE b.id = ${sessionBarberId(session)}::int)
        FROM cur
        WHERE cur.stock - cur.ledger <> 0
        RETURNING id, product_id, delta, kind, reason, unit_cost, created_at
      )
      SELECT cur.stock, cur.ledger,
             mv.id AS move_id, mv.product_id AS move_product_id, mv.delta AS move_delta, mv.kind AS move_kind,
             mv.reason AS move_reason, mv.unit_cost AS move_unit_cost, mv.created_at AS move_created_at,
             ((mv.created_at AT TIME ZONE ${BUSINESS_TZ})::date)::text AS move_day
      FROM cur LEFT JOIN mv ON true
    `,
  ])
  const [row] = results[1] || []
  if (!row) return res.status(404).json({ ok: false, error: "Producto no encontrado" })
  const move = moveToClient(row)
  const stock = Number(row.stock)
  return res.json({
    ok: true,
    productId: pid,
    move,
    stock,
    // Después del cuadre el libro suma lo mismo que el stock.
    ledgerStock: stock,
    drift: 0,
  })
}

/* Sube una foto de producto a Vercel Blob y guarda la URL en la columna
   correspondiente (front = portada, back = hover, detail = dentro del modal). */
async function uploadImage(req, res, sql) {
  const { id, slot, dataUrl } = req.body || {}
  if (!id || !["front", "back", "detail"].includes(slot) || !dataUrl) {
    return res.status(400).json({ ok: false, error: "Datos incompletos" })
  }
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/.exec(dataUrl)
  if (!match) return res.status(400).json({ ok: false, error: "Formato de imagen no soportado" })

  const [, mime, base64] = match
  const buffer = Buffer.from(base64, "base64")
  if (buffer.length > 8 * 1024 * 1024) {
    return res.status(400).json({ ok: false, error: "Imagen muy pesada (máx. 8MB)" })
  }

  const ext = mime === "image/jpeg" || mime === "image/jpg" ? "jpg" : mime.split("/")[1]
  const blob = await put(`products/${id}-${slot}-${Date.now()}.${ext}`, buffer, {
    access: "public",
    contentType: mime,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  })

  const [row] = slot === "front"
    ? await sql`UPDATE products SET img_front = ${blob.url}, updated_at = NOW() WHERE id = ${Number(id)} RETURNING *`
    : slot === "back"
    ? await sql`UPDATE products SET img_back = ${blob.url}, updated_at = NOW() WHERE id = ${Number(id)} RETURNING *`
    : await sql`UPDATE products SET img_detail = ${blob.url}, updated_at = NOW() WHERE id = ${Number(id)} RETURNING *`

  return res.json({ ok: true, url: blob.url, product: row ? toClient(row, { internal: true, admin: true }) : null })
}
