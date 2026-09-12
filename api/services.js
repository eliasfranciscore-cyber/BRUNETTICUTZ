import { neon } from "@neondatabase/serverless"
import { requireInternal } from "./_auth.js"
import { handleProducts } from "./_products.js"

const STATIC_SERVICES = [
  { id: 5,  name: "Asesoría de corte",              price: 24990, min: 90,  cat: "general",  tne: true,  desc: "Consulta profesional para encontrar tu estilo ideal." },
  { id: 6,  name: "Corte de cabello",               price: 15990, min: 60,  cat: "general",  tne: true,  desc: "Corte profesional con técnicas modernas y clásicas." },
  { id: 7,  name: "Corte + perfilado de barba",     price: 22990, min: 75,  cat: "general",  tne: true,  desc: "Servicio completo de corte y arreglo de barba." },
  { id: 8,  name: "Perfilado de barba",             price: 11990, min: 45,  cat: "general",  tne: true,  desc: "Perfilado y arreglo profesional de barba." },
  { id: 9,  name: "Solo fade",                      price: 9990,  min: 40,  cat: "general",  tne: true,  desc: "Solo mantención de un fade ya hecho. No es un corte completo: si es tu primera vez acá, elige Corte de cabello." },
  { id: 10, name: "Asesoría de Imagen · Visagista", price: 39990, min: 120, cat: "premium",  tne: false, desc: "Consulta personalizada según tu fisonomía." },
  { id: 11, name: "Corte de cabello",               price: 19990, min: 60,  cat: "premium",  tne: false, desc: "Corte de precisión con técnicas avanzadas." },
  { id: 12, name: "Corte de cabello y barba",       price: 29990, min: 90,  cat: "premium",  tne: false, desc: "Servicio premium completo de corte y barba." },
  { id: 13, name: "Ondulación permanente",          price: 65990, min: 180, cat: "quimico",  tne: false, desc: "Forma y textura duradera al cabello." },
  { id: 14, name: "Platinado Global",               price: 89990, min: 240, cat: "quimico",  tne: false, desc: "Decoloración completa para un rubio platino." },
  { id: 15, name: "Visos Platinados",               price: 74990, min: 210, cat: "quimico",  tne: false, desc: "Mechas platinadas para un look sofisticado." },
]

export default async function handler(req, res) {
  // El catálogo de productos ("Essentials") vive en su propio módulo pero
  // reusa esta función serverless — Vercel Hobby tope 12 funciones.
  if (req.query.scope === "shop") return handleProducts(req, res)

  try {
    const sql = neon(process.env.DATABASE_URL)

    if (req.method === "GET") {
      const includeInactive = req.query.includeInactive === "true"
      if (includeInactive) {
        const session = requireInternal(req, res)
        if (!session) return
      }
      const services = includeInactive
        ? await sql`SELECT id, name, price, duration_min as min, category as cat, tne_eligible as tne, description as desc, active FROM services ORDER BY id`
        : await sql`SELECT id, name, price, duration_min as min, category as cat, tne_eligible as tne, description as desc, active FROM services WHERE active = true ORDER BY id`

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
      const { name, price, min, cat, tne, desc } = req.body || {}
      if (!String(name || "").trim() || !Number(price) || !Number(min) || !cat) {
        return res.status(400).json({ ok: false, error: "Datos incompletos" })
      }
      const [service] = await sql`
        INSERT INTO services (id, name, price, duration_min, category, tne_eligible, description, active)
        VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM services), ${String(name).trim()}, ${Number(price)}, ${Number(min)}, ${cat}, ${Boolean(tne)}, ${String(desc || "").trim()}, true)
        RETURNING id, name, price, duration_min as min, category as cat, tne_eligible as tne, description as desc, active
      `
      return res.json({ ok: true, service })
    }

    if (req.method === "PATCH") {
      const { id, name, price, min, cat, tne, desc, active } = req.body || {}
      if (!id) return res.status(400).json({ ok: false, error: "id requerido" })
      const [service] = await sql`
        UPDATE services SET
          name = COALESCE(${name || null}, name),
          price = COALESCE(${price ? Number(price) : null}, price),
          duration_min = COALESCE(${min ? Number(min) : null}, duration_min),
          category = COALESCE(${cat || null}, category),
          tne_eligible = COALESCE(${typeof tne === "boolean" ? tne : null}, tne_eligible),
          description = COALESCE(${desc ?? null}, description),
          active = COALESCE(${typeof active === "boolean" ? active : null}, active)
        WHERE id = ${Number(id)}
        RETURNING id, name, price, duration_min as min, category as cat, tne_eligible as tne, description as desc, active
      `
      return res.json({ ok: true, service })
    }

    if (req.method === "DELETE") {
      const id = Number(req.query.id || (req.body || {}).id)
      if (!id) return res.status(400).json({ ok: false, error: "id requerido" })
      // Materializa nombre/precio en las reservas históricas antes de borrar:
      // el FK bookings.service_id no tiene ON DELETE y no queremos perder el
      // historial (COALESCE respeta un custom_price ya congelado).
      await sql`
        UPDATE bookings SET
          custom_service = COALESCE(bookings.custom_service, s.name),
          custom_price = COALESCE(bookings.custom_price, s.price),
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
    if (req.method === "GET") return res.json({ ok: true, services: STATIC_SERVICES.map((service) => ({ ...service, active: true })) })
    const session = requireInternal(req, res, { admin: true })
    if (!session) return
    // POST/PATCH/DELETE escriben el catálogo real: mismo bug de "éxito
    // falso" que en reservas — el admin no debe creer que guardó/borró un
    // servicio si la escritura falló de verdad.
    return res.status(500).json({ ok: false, error: "No se pudo procesar servicios" })
  }
}
