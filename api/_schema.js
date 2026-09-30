/* BRUNETTI — Tablas y columnas que el código crea al vuelo
   ------------------------------------------------------------------
   Las migraciones de este proyecto corren desde el código (ensure*), no a
   mano en la consola de Neon: el deploy no depende de que alguien haya
   corrido db/schema.sql antes. La definición canónica sigue en db/schema.sql;
   esto la repite, solo con cambios ADITIVOS (columnas nuevas con default,
   tablas nuevas, índices), para que la versión anterior del código siga
   funcionando igual sobre la base ya migrada — un rollback no rompe nada.

   Tres reglas que valen para todo el archivo:

   1. Se mira information_schema / pg_indexes / pg_constraint ANTES de cada
      ALTER. `ADD COLUMN IF NOT EXISTS` toma el candado ACCESS EXCLUSIVE de la
      tabla aunque la columna ya exista, y bookings la lee cada pantalla del
      panel. Con la migración ya corrida (lo normal), cada ensure es un SELECT
      por instancia fría y nada más.
   2. Un solo ALTER por tabla con todas sus columnas: un candado y un viaje.
      Los índices y los CHECK van aparte, cada uno en su PROPIO try/catch: son
      optimizaciones o cinturones, y si uno fallara (un candado que no se
      consigue, datos viejos que no cumplen) no puede tumbar el ensure entero
      —y con él el GET que lo llamó.
   3. Las rutas calientes y las del puente NO dependen de que esto haya
      corrido: leen las columnas opcionales con to_jsonb(fila)->>'columna',
      que da NULL si la columna todavía no existe (ver optionalBool y
      compañía, al final).

   once(): se recuerda la promesa por instancia, así una lambda tibia no
   repite el DDL en cada request (Neon cobra tiempo de cómputo activo). Si
   falla, se olvida para reintentar en el próximo request en vez de quedar
   rota hasta el redeploy.
   Prefijo `_`: no consume slot de función serverless (tope 12 del plan Hobby).
   ================================================================ */

function once(fn) {
  let pending = null
  return (sql) => {
    if (!pending) pending = fn(sql).catch((err) => { pending = null; throw err })
    return pending
  }
}

async function presentColumns(sql, table, columns) {
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ANY(${columns}::text[])
  `
  return new Set(rows.map((r) => r.column_name))
}

async function presentTables(sql, tables) {
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = ANY(${tables}::text[])
  `
  return new Set(rows.map((r) => r.table_name))
}

async function hasIndex(sql, name) {
  const [row] = await sql`SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ${name} LIMIT 1`
  return Boolean(row)
}

async function hasConstraint(sql, name) {
  const [row] = await sql`SELECT 1 FROM pg_constraint WHERE conname = ${name} LIMIT 1`
  return Boolean(row)
}

/* Índice o CHECK opcional: su fallo se registra y no sube. */
async function guarded(label, fn) {
  try {
    await fn()
  } catch (err) {
    console.error(`_schema ${label} error:`, err?.message || err)
  }
}

/* ---------------------------------------------------------------------------
   bookings — el ciclo de vida de una atención (ver api/_bookingLife.js) y su
   cobro (ver api/_money.js). Ninguna es un estado nuevo: la app de iOS
   decodifica `status` con un enum estricto de 5 valores y un valor
   desconocido le rompería la lista entera de reservas.

   no_show            "No vino": cancelada + no_show = true.
   started_at         cuándo pasó a "en curso" (el reloj del autocompletar).
   auto_completed_at  la completó el sistema, no una persona.
   completed_at       cuándo entró a "completada". Marca desde cuándo se cobra
                      de verdad: las completadas viejas (NULL) siguen contando
                      al precio, como siempre.
   redeem_state       canje del corte gratis: NULL (sin canje), 'redeemed'
                      (canjeado, 10 estrellas debitadas en PimpStudio) o
                      'voided' (se canceló y se le devolvieron las estrellas).
   price_snapshot     precio de catálogo congelado al completar.
   paid_amount        lo que REALMENTE entró en caja (NULL = sin cobrar).
   payment_method     efectivo | tarjeta | transferencia | mercadopago | cortesia.
   payment_ref        n.º de boleta / operación, según el medio.
   paid_at            cuándo se registró el cobro.
   charged_by         quién lo registró (barbero de la sesión).
   ------------------------------------------------------------------------- */
const BOOKING_COLUMNS = [
  "no_show", "started_at", "auto_completed_at", "completed_at", "redeem_state",
  "price_snapshot", "paid_amount", "payment_method", "payment_ref", "paid_at", "charged_by",
]
export const ensureBookingColumns = once(async (sql) => {
  const present = await presentColumns(sql, "bookings", BOOKING_COLUMNS)
  if (present.size < BOOKING_COLUMNS.length) {
    await sql`
      ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS no_show           BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS started_at        TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS auto_completed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS completed_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS redeem_state      VARCHAR(10),
        ADD COLUMN IF NOT EXISTS price_snapshot    INTEGER,
        ADD COLUMN IF NOT EXISTS paid_amount       INTEGER,
        ADD COLUMN IF NOT EXISTS payment_method    VARCHAR(20),
        ADD COLUMN IF NOT EXISTS payment_ref       VARCHAR(60),
        ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS charged_by        INTEGER REFERENCES barbers(id) ON DELETE SET NULL
    `
  }
  await guarded("bookings_payment_method_check", async () => {
    if (await hasConstraint(sql, "bookings_payment_method_check")) return
    await sql`
      ALTER TABLE bookings ADD CONSTRAINT bookings_payment_method_check
        CHECK (payment_method IN ('efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'cortesia'))
    `
  })
  await guarded("bookings_redeem_state_check", async () => {
    if (await hasConstraint(sql, "bookings_redeem_state_check")) return
    await sql`ALTER TABLE bookings ADD CONSTRAINT bookings_redeem_state_check CHECK (redeem_state IN ('redeemed', 'voided'))`
  })
  // Índices parciales diminutos: casi nunca hay filas que calcen.
  await guarded("idx_bookings_en_curso", async () => {
    if (!(await hasIndex(sql, "idx_bookings_en_curso"))) {
      await sql`CREATE INDEX IF NOT EXISTS idx_bookings_en_curso ON bookings (id) WHERE status = 'en curso'`
    }
  })
  await guarded("idx_bookings_open", async () => {
    if (!(await hasIndex(sql, "idx_bookings_open"))) {
      await sql`CREATE INDEX IF NOT EXISTS idx_bookings_open ON bookings (booking_date) WHERE status IN ('pendiente', 'confirmada', 'en curso')`
    }
  })
  await guarded("idx_bookings_paid", async () => {
    if (!(await hasIndex(sql, "idx_bookings_paid"))) {
      await sql`CREATE INDEX IF NOT EXISTS idx_bookings_paid ON bookings (booking_date) WHERE paid_at IS NOT NULL`
    }
  })
})

/* users.profession — texto libre y opcional, lo completa el barbero en la
   ficha del cliente. */
export const ensureClientColumns = once(async (sql) => {
  const present = await presentColumns(sql, "users", ["profession"])
  if (!present.has("profession")) await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profession TEXT`
})

/* services
   featured          aparece en "Los más pedidos" de /reservar.
   only_on_date      servicio de un solo día: solo se ofrece y se agenda esa
                     fecha. NULL = todos los días (el resto del catálogo).
   loyalty_eligible  "Suma estrella". Arranca en true para todo el catálogo:
                     hoy todo suma, y apagarlo es una decisión por servicio.
   show_on_home      "En el home": sale en la vitrina de servicios de la
                     landing. Arranca en true (hoy salen todos); en false el
                     servicio solo se ve al reservar. */
const SERVICE_COLUMNS = ["featured", "only_on_date", "loyalty_eligible", "show_on_home"]
export const ensureServiceColumns = once(async (sql) => {
  const present = await presentColumns(sql, "services", SERVICE_COLUMNS)
  if (present.size < SERVICE_COLUMNS.length) {
    await sql`
      ALTER TABLE services
        ADD COLUMN IF NOT EXISTS featured         BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS only_on_date     DATE,
        ADD COLUMN IF NOT EXISTS loyalty_eligible BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS show_on_home     BOOLEAN NOT NULL DEFAULT true
    `
  }
})

/* expenses.kind — gasto | ingreso (ingreso manual en Finanzas). Default
   'gasto': las filas que ya existen son todas gastos, y la app de iOS suma
   todo lo que le devuelve GET /api/expenses como gasto. */
export const ensureExpenseColumns = once(async (sql) => {
  const present = await presentColumns(sql, "expenses", ["kind"])
  if (!present.has("kind")) {
    await sql`
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'gasto'
        CHECK (kind IN ('gasto', 'ingreso'))
    `
  }
})

/* settings — clave/valor. Mismo DDL que ensureSettingsTable() en
   api/mp-payments.js (precios y fecha del Workshop, interruptor de pagos):
   es la misma tabla, y cualquiera de los dos puede crearla primero. */
export const ensureSettingsTable = once(async (sql) => {
  if ((await presentTables(sql, ["settings"])).has("settings")) return
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
})

/* barber_reviews — una fila por reserva completada, creada al completarla
   con el token que va en el correo de agradecimiento; `rating` queda NULL
   hasta que el cliente califica en /resena. La fila es también la marca de
   "ya se le pidió reseña por esta visita": el UNIQUE(booking_id) es lo que
   evita mandar dos correos si la reserva se completa dos veces. */
export const ensureReviewsTable = once(async (sql) => {
  const tables = await presentTables(sql, ["barber_reviews"])
  if (!tables.has("barber_reviews")) {
    await sql`
      CREATE TABLE IF NOT EXISTS barber_reviews (
        id         SERIAL PRIMARY KEY,
        booking_id INTEGER UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
        barber_id  INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
        user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        token      VARCHAR(40) NOT NULL UNIQUE,
        rating     SMALLINT CHECK (rating BETWEEN 1 AND 5),
        comment    TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        rated_at   TIMESTAMPTZ
      )
    `
  }
  await guarded("idx_barber_reviews_rated", async () => {
    if (!(await hasIndex(sql, "idx_barber_reviews_rated"))) {
      await sql`CREATE INDEX IF NOT EXISTS idx_barber_reviews_rated ON barber_reviews (barber_id, rated_at DESC) WHERE rating IS NOT NULL`
    }
  })
})

/* ---------------------------------------------------------------------------
   Productos: inventario (libro de movimientos) y venta en el mesón.

   products.stock SIGUE SIENDO LA VERDAD: es lo que leen y descuentan el
   checkout y el webhook de Mercado Pago. El libro (product_stock_moves) es la
   historia de por qué cambió; la vista de inventario muestra el desfase entre
   los dos y "cuadrar" inserta un 'ajuste' — nunca se reescribe el stock desde
   el libro. Por eso tampoco hay saldo de apertura acá: ninguna migración
   escribe datos.

   Sin comisión en ningún lado (BrunettiCutz es un solo barbero).

   products
     archived_at  borrado suave: DELETE archiva, porque los movimientos y las
                  líneas de venta referencian el producto.
     sku          código opcional.
     cost         costo de compra, opcional (valoriza el inventario).
   product_stock_moves  delta firmado por movimiento.
   product_sales        cabecera de una venta del mesón (un evento de pago).
   product_sale_items   sus líneas, con nombre y precios congelados.
   ------------------------------------------------------------------------- */
const PRODUCT_COLUMNS = ["archived_at", "sku", "cost"]
const LEDGER_TABLES = ["products", "product_sales", "product_sale_items", "product_stock_moves"]
export const ensureProductsLedger = once(async (sql) => {
  const tables = await presentTables(sql, LEDGER_TABLES)
  if (!tables.has("products")) {
    // Mismo DDL que ensureTable() en api/_products.js.
    await sql`
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
    `
  }
  const present = await presentColumns(sql, "products", PRODUCT_COLUMNS)
  if (present.size < PRODUCT_COLUMNS.length) {
    await sql`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS sku         VARCHAR(60),
        ADD COLUMN IF NOT EXISTS cost        INTEGER
    `
  }
  if (!tables.has("product_sales")) {
    await sql`
      CREATE TABLE IF NOT EXISTS product_sales (
        id             SERIAL PRIMARY KEY,
        booking_id     INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
        client_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sale_date      DATE NOT NULL,
        source         VARCHAR(12) NOT NULL DEFAULT 'mostrador' CHECK (source IN ('atencion', 'mostrador')),
        status         VARCHAR(12) NOT NULL DEFAULT 'pagada' CHECK (status IN ('pagada', 'anulada')),
        payment_method VARCHAR(20) CHECK (payment_method IN ('efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'cortesia')),
        payment_ref    VARCHAR(60),
        discount_pct   SMALLINT NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
        total          INTEGER NOT NULL DEFAULT 0,
        paid_at        TIMESTAMPTZ,
        charged_by     INTEGER REFERENCES barbers(id) ON DELETE SET NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_date ON product_sales (sale_date)`
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_booking ON product_sales (booking_id)`
  }
  if (!tables.has("product_sale_items")) {
    await sql`
      CREATE TABLE IF NOT EXISTS product_sale_items (
        id             SERIAL PRIMARY KEY,
        sale_id        INTEGER NOT NULL REFERENCES product_sales(id) ON DELETE CASCADE,
        product_id     INTEGER NOT NULL REFERENCES products(id),
        qty            INTEGER NOT NULL CHECK (qty > 0),
        name_snapshot  VARCHAR(200) NOT NULL,
        unit_price     INTEGER NOT NULL,
        unit_collected INTEGER NOT NULL,
        unit_cost      INTEGER,
        line_total     INTEGER NOT NULL
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON product_sale_items (sale_id)`
    await sql`CREATE INDEX IF NOT EXISTS idx_sale_items_product ON product_sale_items (product_id)`
  }
  if (!tables.has("product_stock_moves")) {
    // shop_order_id sin FK a propósito: shop_orders la crea api/mp-payments.js
    // cuando le toca, y puede no existir todavía acá.
    await sql`
      CREATE TABLE IF NOT EXISTS product_stock_moves (
        id            SERIAL PRIMARY KEY,
        product_id    INTEGER NOT NULL REFERENCES products(id),
        delta         INTEGER NOT NULL CHECK (delta <> 0),
        kind          VARCHAR(20) NOT NULL CHECK (kind IN ('inicial', 'compra', 'venta', 'devolucion', 'merma', 'ajuste')),
        reason        TEXT,
        unit_cost     INTEGER,
        sale_item_id  INTEGER REFERENCES product_sale_items(id) ON DELETE SET NULL,
        shop_order_id INTEGER,
        created_by    INTEGER REFERENCES barbers(id) ON DELETE SET NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_stock_moves_product ON product_stock_moves (product_id, created_at)`
  }
})

/* shop_orders.paid_at — cuándo se confirmó el pago de un pedido de
   Essentials (hasta ahora solo había created_at). Solo si la tabla ya existe:
   la crea api/mp-payments.js. Ninguna DDL corre en el checkout ni en el
   webhook de Mercado Pago, así que esto se llama desde un camino del panel. */
export const ensureShopOrderColumns = once(async (sql) => {
  const tables = await presentTables(sql, ["shop_orders"])
  if (!tables.has("shop_orders")) return
  const present = await presentColumns(sql, "shop_orders", ["paid_at"])
  if (!present.has("paid_at")) await sql`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`
})

/* ---------------------------------------------------------------------------
   Autenticación
     password_hash  VARCHAR(64) → TEXT: cabe justo un SHA-256 en hex, y el
                    formato PBKDF2 ("pbkdf2$iteraciones$sal$hash") no. VARCHAR
                    a TEXT no reescribe la tabla.
     barbers.email  para el restablecimiento por correo; único sin importar
                    mayúsculas (índice parcial, en su propio try/catch: si ya
                    hubiera dos iguales, el índice no entra pero la columna sí).
     password_resets  se guarda el SHA-256 del token, nunca el token.
   login_attempts (bloqueo por intentos fallidos) la crea api/_rateLimit.js,
   igual que en PimpStudio.
   ------------------------------------------------------------------------- */
export const ensureAuthColumns = once(async (sql) => {
  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'barbers' AND column_name IN ('password_hash', 'email')
  `
  const byName = Object.fromEntries(cols.map((c) => [c.column_name, c.data_type]))
  if (byName.password_hash === "character varying") {
    await sql`ALTER TABLE barbers ALTER COLUMN password_hash TYPE TEXT`
  } else if (!byName.password_hash) {
    await sql`ALTER TABLE barbers ADD COLUMN IF NOT EXISTS password_hash TEXT`
  }
  if (!byName.email) await sql`ALTER TABLE barbers ADD COLUMN IF NOT EXISTS email VARCHAR(300)`
  await guarded("barbers_email_unique", async () => {
    if (!(await hasIndex(sql, "barbers_email_unique"))) {
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS barbers_email_unique ON barbers (lower(email)) WHERE email IS NOT NULL`
    }
  })
  const tables = await presentTables(sql, ["password_resets"])
  if (!tables.has("password_resets")) {
    await sql`
      CREATE TABLE IF NOT EXISTS password_resets (
        token_hash   CHAR(64) PRIMARY KEY,
        barber_id    INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
        expires_at   TIMESTAMPTZ NOT NULL,
        used_at      TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        requested_ip TEXT
      )
    `
    await sql`CREATE INDEX IF NOT EXISTS idx_password_resets_barber ON password_resets (barber_id, created_at DESC)`
  }
})

/* ---------------------------------------------------------------------------
   Lectura de columnas opcionales sin depender de la migración.

   En SQL: to_jsonb(b)->>'redeem_state' devuelve el valor como TEXTO, o NULL
   si la columna todavía no existe (o viene NULL). Nunca lanza "column does
   not exist", así que sirve en las rutas calientes y en las del puente:
     COALESCE((to_jsonb(s)->>'loyalty_eligible')::boolean, true)
     to_jsonb(b)->>'paid_amount'  AS "paidAmount"
   ⚠️ to_jsonb(s) de un LEFT JOIN sin fila es NULL entero: el COALESCE cubre
   también a las reservas con servicio personalizado (sin service_id).

   En JS, estos parsean ese texto (o el valor ya tipado, si la consulta lo
   casteó) con un default. */
export function optionalBool(value, fallback = false) {
  if (value === true || value === "true" || value === "t") return true
  if (value === false || value === "false" || value === "f") return false
  return fallback
}

export function optionalInt(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

export function optionalText(value, fallback = null) {
  if (value === null || value === undefined) return fallback
  const s = String(value)
  return s === "" ? fallback : s
}

/* ¿Ya existen estas columnas? Para elegir entre dos versiones de una
   consulta cuando to_jsonb no alcanza (por ejemplo, en un WHERE o un ORDER BY
   sobre muchas filas). Se recuerda por instancia solo cuando TODAS están: una
   columna que ya existe no desaparece, y una que falta se vuelve a mirar en
   el próximo request (la puede crear otra lambda en cualquier momento). */
const columnsMemo = new Map()
export async function hasColumns(sql, table, columns) {
  const key = `${table}:${[...columns].sort().join(",")}`
  if (columnsMemo.get(key)) return true
  const present = await presentColumns(sql, table, columns)
  const all = columns.every((c) => present.has(c))
  if (all) columnsMemo.set(key, true)
  return all
}
