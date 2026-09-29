import { neon } from "@neondatabase/serverless"
import { requireInternal } from "./_auth.js"
import { handleProducts, handleInventory } from "./_products.js"
import { ensureServiceColumns } from "./_schema.js"

const STATIC_SERVICES = [
  { id: 5,  name: "Asesoría de corte",              price: 24990, min: 90,  cat: "general",  tne: true,  active: false, desc: "Corte más una conversación de estilo: forma de rostro, qué te acomoda y cómo mantenerlo." },
  { id: 6,  name: "Corte de cabello",               price: 15990, min: 60,  cat: "general",  tne: true,  active: false, desc: "Corte completo de principio a fin: largo, forma y terminación. El indicado si es tu primera vez." },
  { id: 7,  name: "Corte + perfilado de barba",     price: 22990, min: 75,  cat: "general",  tne: true,  active: false, desc: "Corte completo más perfilado de barba, todo en la misma sesión." },
  { id: 8,  name: "Perfilado de barba",             price: 11990, min: 45,  cat: "general",  tne: true,  active: false, desc: "Solo barba: perfilado, contornos y arreglo. No incluye corte de pelo." },
  { id: 9,  name: "Solo fade",                      price: 11990,  min: 40,  cat: "general",  tne: true,  desc: "Solo mantención de un fade ya hecho. No es un corte completo: si es tu primera vez acá, elige Corte de cabello." },
  { id: 10, name: "Asesoría de Imagen · Visagista", price: 49990, min: 120, cat: "premium",  tne: false, desc: "Análisis de tu fisonomía para definir el estilo que te favorece y cómo llevarlo." },
  { id: 11, name: "Corte de cabello",               price: 19990, min: 60,  cat: "premium",  tne: false, desc: "Corte completo de principio a fin: largo, forma y terminación. El indicado si es tu primera vez." },
  { id: 12, name: "Corte de cabello y barba",       price: 29990, min: 90,  cat: "premium",  tne: false, desc: "Corte completo y barba perfilada, con terminación de detalle." },
  { id: 13, name: "Ondulación permanente",          price: 66990, min: 180, cat: "quimico",  tne: false, desc: "Ondulación química: da forma y textura al pelo liso, con resultado duradero." },
  { id: 14, name: "Platinado Global",               price: 89990, min: 240, cat: "quimico",  tne: false, desc: "Decoloración de todo el pelo hasta rubio platino. El resultado depende de tu base." },
  { id: 15, name: "Visos Platinados",               price: 74990, min: 210, cat: "quimico",  tne: false, desc: "Mechas platinadas sobre tu color, sin decolorar todo el pelo." },
]

const BUSINESS_TZ = "America/Santiago"
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const has = (body, key) => Object.prototype.hasOwnProperty.call(body || {}, key)

/* onlyOnDate del body: 'YYYY-MM-DD' real, o vacío/null para "todos los días".
   `touched` dice si la llave vino, para que un PATCH que no la conoce (la app
   de iOS, el panel viejo) no le borre la fecha a un servicio. */
function readOnlyOnDate(body) {
  if (!has(body, "onlyOnDate")) return { touched: false, value: null }
  const raw = body.onlyOnDate
  if (raw === null || raw === undefined || String(raw).trim() === "") return { touched: true, value: null }
  const value = String(raw).trim()
  const [y, m, d] = value.split("-").map(Number)
  const probe = new Date(Date.UTC(y, (m || 0) - 1, d || 0))
  if (!DATE_RE.test(value) || probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return { error: "La fecha del servicio no es válida" }
  }
  return { touched: true, value }
}

/* Respaldo sin base: `active` se respeta, no se fuerza. Forzarlo a true
   resucitaba en la web pública los cuatro servicios que el panel tiene
   apagados (entre ellos el corte de $15.990, que en este local no se vende),
   que es justo lo que el `active: false` del catálogo estático quería evitar.
   La rama pública además los saca, igual que el WHERE active = true de la
   consulta real. */
function staticServices({ includeInactive }) {
  return STATIC_SERVICES
    .map((service) => ({
      ...service,
      active: service.active !== false,
      featured: service.featured === true,
      onlyOnDate: null,
      ...(includeInactive ? { loyaltyEligible: service.loyaltyEligible !== false } : {}),
    }))
    .filter((service) => includeInactive || service.active)
}

export default async function handler(req, res) {
  // El catálogo de productos ("Essentials") y su inventario viven en su
  // propio módulo pero reusan esta función serverless — Vercel Hobby tope 12
  // funciones.
  if (req.query.scope === "shop") return handleProducts(req, res)
  if (req.query.scope === "inventory") return handleInventory(req, res)
  // Brunetti Academy (/api/academy → rewrite a ?scope=academy, ver
  // vercel.json). Va en esta función y no en un archivo api/ nuevo por el
  // tope de 12 funciones del plan Hobby. import() DINÁMICO a propósito: un
  // import estático que fallara al cargar tumbaría también el catálogo que
  // usa /reservar (y la app de iOS). Así, lo peor que puede pasar es que solo
  // /api/academy responda 503.
  if (req.query.scope === "academy") {
    let handleAcademy
    try {
      ;({ handleAcademy } = await import("./_academy.js"))
    } catch (err) {
      console.error("academy: no cargó el router:", err?.message || err)
      res.setHeader("Cache-Control", "private, no-store")
      return res.status(503).json({ ok: false, error: "La Academy no está disponible en este momento.", code: "unavailable" })
    }
    return handleAcademy(req, res)
  }

  try {
    const sql = neon(process.env.DATABASE_URL)

    if (req.method === "GET") {
      const includeInactive = req.query.includeInactive === "true"
      if (includeInactive) {
        const session = requireInternal(req, res)
        if (!session) return
      }
      /* featured / only_on_date / loyalty_eligible se leen por to_jsonb: esta
         lectura no corre la migración (la corren POST y PATCH) y da NULL si la
         columna todavía no existe, así que el catálogo nunca depende de ella.

         Servicios de un solo día (only_on_date):
           - la lista plana NO los trae. PimpStudio la lee tal cual para
             agendar a Bruno desde pimpstudio.cl (bruno-agenda?mode=services),
             no entiende onlyOnDate y ofrecería el servicio cualquier día.
           - ?includeSingleDay=1 los agrega (lo pide /reservar de acá), pero
             solo los que todavía no pasaron (día de Santiago).
           - el panel (includeInactive) los ve todos, vencidos incluidos.
         La caché del CDN es por URL, así que las dos listas públicas no se
         pisan. */
      const includeSingleDay = !includeInactive && req.query.includeSingleDay === "1"
      const services = includeInactive
        ? await sql`
            SELECT id, name, price, duration_min as min, category as cat, tne_eligible as tne, description as desc, active,
                   COALESCE((to_jsonb(s)->>'featured')::boolean, false) AS featured,
                   to_jsonb(s)->>'only_on_date' AS "onlyOnDate",
                   COALESCE((to_jsonb(s)->>'loyalty_eligible')::boolean, true) AS "loyaltyEligible"
            FROM services s
            ORDER BY id
          `
        : await sql`
            SELECT id, name, price, duration_min as min, category as cat, tne_eligible as tne, description as desc, active,
                   COALESCE((to_jsonb(s)->>'featured')::boolean, false) AS featured,
                   to_jsonb(s)->>'only_on_date' AS "onlyOnDate"
            FROM services s
            WHERE s.active = true
              AND ((to_jsonb(s)->>'only_on_date') IS NULL
                   OR (${includeSingleDay}::boolean
                       AND (to_jsonb(s)->>'only_on_date')::date >= (NOW() AT TIME ZONE ${BUSINESS_TZ})::date))
            ORDER BY id
          `

      // Caché de CDN para el catálogo PÚBLICO. Cada visita a la landing y a
      // la reserva pedía esto, y cada pedido despertaba el compute de Neon —
      // que se cobra por tiempo encendido, no por consulta. El menú cambia
      // cada varias semanas; que el borde lo sirva 5 min sin tocar la base
      // saca del camino la mayoría de las despertadas por tráfico público.
      //
      // s-maxage (borde) y no max-age (navegador): el navegador revalida
      // siempre, así que un hard-refresh muestra el precio nuevo al toque.
      // El precio de esto es que un cambio hecho en el panel tarda hasta
      // 5 min en verse en el sitio, y hasta 10 min más si el borde alcanza a
      // servir una copia vencida mientras la refresca por detrás.
      //
      // Solo la rama pública: includeInactive=true exige sesión y devuelve
      // también los servicios ocultos, así que cachearla en el CDN los
      // filtraría a cualquiera que pidiera la URL sin token.
      //
      // Mismo cambio, con el mismo motivo, en pimpstudio (api/services.js).
      if (!includeInactive) {
        res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=600")
      }
      return res.json({ ok: true, services })
    }

    const session = requireInternal(req, res, { admin: true })
    if (!session) return

    if (req.method === "POST") {
      const body = req.body || {}
      const { name, price, min, cat, tne, desc } = body
      if (!String(name || "").trim() || !Number(price) || !Number(min) || !cat) {
        return res.status(400).json({ ok: false, error: "Datos incompletos" })
      }
      const onlyOnDate = readOnlyOnDate(body)
      if (onlyOnDate.error) return res.status(400).json({ ok: false, error: onlyOnDate.error })
      await ensureServiceColumns(sql)
      // Defaults de un servicio nuevo: no destacado, todos los días y "Suma
      // estrella" (como todo el catálogo hasta hoy).
      const [service] = await sql`
        INSERT INTO services (id, name, price, duration_min, category, tne_eligible, description, active, featured, only_on_date, loyalty_eligible)
        VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM services), ${String(name).trim()}, ${Number(price)}, ${Number(min)}, ${cat}, ${Boolean(tne)}, ${String(desc || "").trim()}, true,
                ${body.featured === true}, ${onlyOnDate.value}::date, ${body.loyaltyEligible !== false})
        RETURNING id, name, price, duration_min as min, category as cat, tne_eligible as tne, description as desc, active,
                  featured, only_on_date::text AS "onlyOnDate", loyalty_eligible AS "loyaltyEligible"
      `
      return res.json({ ok: true, service })
    }

    if (req.method === "PATCH") {
      const body = req.body || {}
      const { id, name, price, min, cat, tne, desc, active } = body
      if (!id) return res.status(400).json({ ok: false, error: "id requerido" })
      /* Los tres campos nuevos solo se escriben si la llave vino en el body
         (hasOwnProperty), con CASE WHEN y un booleano: la app de iOS y el
         panel viejo mandan el servicio sin ellos y no se los pueden resetear,
         y con un COALESCE no habría forma de BORRAR la fecha de un servicio
         de un solo día (null sería "no tocar"). */
      const onlyOnDate = readOnlyOnDate(body)
      if (onlyOnDate.error) return res.status(400).json({ ok: false, error: onlyOnDate.error })
      const touchFeatured = has(body, "featured") && typeof body.featured === "boolean"
      const touchLoyalty = has(body, "loyaltyEligible") && typeof body.loyaltyEligible === "boolean"
      await ensureServiceColumns(sql)
      const [service] = await sql`
        UPDATE services SET
          name = COALESCE(${name || null}, name),
          price = COALESCE(${price ? Number(price) : null}, price),
          duration_min = COALESCE(${min ? Number(min) : null}, duration_min),
          category = COALESCE(${cat || null}, category),
          tne_eligible = COALESCE(${typeof tne === "boolean" ? tne : null}, tne_eligible),
          description = COALESCE(${desc ?? null}, description),
          active = COALESCE(${typeof active === "boolean" ? active : null}, active),
          featured = CASE WHEN ${touchFeatured}::boolean THEN ${body.featured === true}::boolean ELSE featured END,
          only_on_date = CASE WHEN ${onlyOnDate.touched}::boolean THEN ${onlyOnDate.value}::date ELSE only_on_date END,
          loyalty_eligible = CASE WHEN ${touchLoyalty}::boolean THEN ${body.loyaltyEligible === true}::boolean ELSE loyalty_eligible END
        WHERE id = ${Number(id)}
        RETURNING id, name, price, duration_min as min, category as cat, tne_eligible as tne, description as desc, active,
                  featured, only_on_date::text AS "onlyOnDate", loyalty_eligible AS "loyaltyEligible"
      `
      return res.json({ ok: true, service })
    }

    if (req.method === "DELETE") {
      const id = Number(req.query.id || (req.body || {}).id)
      if (!id) return res.status(400).json({ ok: false, error: "id requerido" })
      // Materializa nombre/precio en las reservas históricas antes de borrar:
      // el FK bookings.service_id no tiene ON DELETE y no queremos perder el
      // historial (COALESCE respeta un custom_price ya congelado, y el precio
      // de catálogo congelado al completar: sin él, borrar el servicio le
      // ponía el precio de HOY a una atención cobrada con el de antes).
      // price_snapshot por to_jsonb: esta ruta no corre la migración.
      await sql`
        UPDATE bookings SET
          custom_service = COALESCE(bookings.custom_service, s.name),
          custom_price = COALESCE(bookings.custom_price, (to_jsonb(bookings)->>'price_snapshot')::int, s.price),
          service_id = NULL
        FROM services s
        WHERE bookings.service_id = ${id} AND s.id = ${id}
      `
      await sql`DELETE FROM services WHERE id = ${id}`
      return res.json({ ok: true })
    }

    return res.status(405).json({ error: "Method not allowed" })
  } catch (err) {
    console.error("services error:", err)
    if (req.method === "GET") return res.json({ ok: true, services: staticServices({ includeInactive: req.query.includeInactive === "true" }) })
    const session = requireInternal(req, res, { admin: true })
    if (!session) return
    // POST/PATCH/DELETE escriben el catálogo real: mismo bug de "éxito
    // falso" que en reservas — el admin no debe creer que guardó/borró un
    // servicio si la escritura falló de verdad.
    return res.status(500).json({ ok: false, error: "No se pudo procesar servicios" })
  }
}
