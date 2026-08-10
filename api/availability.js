import { neon } from "@neondatabase/serverless"
import { requireInternal } from "./_auth.js"
import { ALL_SLOTS, blocksForDuration, slotsForBooking } from "./_slots.js"

const BUSINESS_TZ = "America/Santiago"
const MIN_LEAD_MINUTES = 55

// Mismo secreto/patrón que bookings.js: PimpStudio llama estos endpoints
// servidor-a-servidor para que Bruno pueda bloquear/abrir sus propios
// horarios desde el panel de PimpStudio. Acotado siempre a su propio
// barbero (BRIDGE_BARBER_ID) — el secreto no debe poder tocar la
// disponibilidad de nadie más.
const BRIDGE_SECRET = process.env.PIMPSTUDIO_BRIDGE_SECRET || ""
const BRIDGE_BARBER_ID = 6

function isBridgeRequest(req) {
  if (!BRIDGE_SECRET) return false
  const key = req.headers["x-bridge-secret"]
  return typeof key === "string" && key === BRIDGE_SECRET
}

// Igual que en bookings.js: calculamos "hoy" y la hora actual en la zona
// horaria del negocio, no en UTC (Vercel corre las funciones en UTC).
function businessDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}
function businessNowMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date)
  const h = Number(parts.find((p) => p.type === "hour").value)
  const m = Number(parts.find((p) => p.type === "minute").value)
  return h * 60 + m
}
function slotMinutes(slot) {
  const [h, m] = slot.split(":").map(Number)
  return h * 60 + m
}

export default async function handler(req, res) {
  const source = req.method === "GET" ? req.query : (req.body || {})
  const { barberId, date, slot, reason } = source
  if (!barberId || !date) return res.status(400).json({ error: "barberId y date requeridos" })

  try {
    const sql = neon(process.env.DATABASE_URL)
    if (req.method === "POST") {
      const bridge = isBridgeRequest(req)
      if (bridge) {
        if (Number(barberId) !== BRIDGE_BARBER_ID) return res.status(403).json({ ok: false, error: "No autorizado" })
      } else {
        const session = requireInternal(req, res)
        if (!session) return
      }
      if (!slot) return res.status(400).json({ ok: false, error: "slot requerido" })
      const [block] = await sql`
        INSERT INTO availability_blocks (barber_id, block_date, slot_time, reason)
        VALUES (${Number(barberId)}, ${date}, ${slot}, ${reason || (bridge ? "Bloqueado desde PimpStudio" : "Bloqueado desde panel")})
        ON CONFLICT (barber_id, block_date, slot_time) DO UPDATE SET reason = EXCLUDED.reason
        RETURNING id, barber_id as "barberId", block_date::text as date, slot_time::text as slot, reason
      `
      return res.json({ ok: true, block: { ...block, slot: block.slot?.slice(0, 5) } })
    }

    if (req.method === "DELETE") {
      const bridge = isBridgeRequest(req)
      if (bridge) {
        if (Number(barberId) !== BRIDGE_BARBER_ID) return res.status(403).json({ ok: false, error: "No autorizado" })
      } else {
        const session = requireInternal(req, res)
        if (!session) return
      }
      if (!slot) return res.status(400).json({ ok: false, error: "slot requerido" })
      await sql`
        DELETE FROM availability_blocks
        WHERE barber_id = ${Number(barberId)} AND block_date = ${date} AND slot_time = ${slot}
      `
      return res.json({ ok: true })
    }

    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

    const booked = await sql`
      SELECT b.booking_time::text as slot, COALESCE(s.duration_min, 60) as "durationMin"
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      WHERE b.barber_id = ${barberId} AND b.booking_date = ${date} AND b.status NOT IN ('cancelada')
    `
    const blocked = await sql`
      SELECT slot_time::text as slot FROM availability_blocks
      WHERE barber_id = ${barberId} AND block_date = ${date}
    `
    // Un servicio de más de 1h ocupa varios bloques consecutivos, no solo el
    // horario en el que se agendó (ver api/_slots.js).
    const bookedSet = new Set()
    for (const r of booked) {
      const start = r.slot?.slice(0, 5)
      const span = slotsForBooking(start, blocksForDuration(r.durationMin)) || [start]
      span.forEach((s) => bookedSet.add(s))
    }
    const blockedSet = new Set(blocked.map(r => r.slot?.slice(0,5)))
    const unavailable = new Set([...bookedSet, ...blockedSet])
    const isToday = date === businessDateKey(new Date())
    const minMinutes = isToday ? businessNowMinutes(new Date()) + MIN_LEAD_MINUTES : -1
    const slots = ALL_SLOTS.map(s => ({
      slot: s,
      available: !unavailable.has(s) && slotMinutes(s) >= minMinutes,
      state: bookedSet.has(s) ? "booked" : blockedSet.has(s) ? "blocked" : slotMinutes(s) < minMinutes ? "past" : "free",
    }))
    return res.json({ ok: true, slots })
  } catch (err) {
    console.error("availability error:", err)
    // Bloquear/desbloquear un horario es una acción del panel interno con
    // sesión: si la escritura real falla, el barbero debe verlo (mismo bug
    // que "reserva confirmada" pero al revés — un bloqueo que no se guardó
    // deja el horario abierto sin que nadie lo sepa).
    if (req.method === "POST" || req.method === "DELETE") {
      return res.status(500).json({ ok: false, error: "No se pudo guardar el cambio de disponibilidad. Intenta de nuevo." })
    }
    const isToday = date === businessDateKey(new Date())
    const minMinutes = isToday ? businessNowMinutes(new Date()) + MIN_LEAD_MINUTES : -1
    return res.json({ ok: true, slots: ALL_SLOTS.map(s => ({ slot: s, available: slotMinutes(s) >= minMinutes })) })
  }
}
