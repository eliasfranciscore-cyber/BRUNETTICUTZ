/* PIMP STUDIO — Persistencia local de reservas
   ------------------------------------------------------------------
   Capa de respaldo: guarda las reservas creadas desde el flujo público en
   localStorage para que aparezcan de inmediato en el panel interno (Reservas),
   aunque el backend (Neon) no esté disponible o tarde en sincronizar.
   El backend sigue siendo la fuente de verdad cuando responde; esto solo
   garantiza una experiencia consistente y verificable de extremo a extremo. */

const KEY = "ps_bookings_local"
const CANCEL_KEY = "ps_bookings_cancelled"

export function readLocalBookings() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") } catch { return [] }
}

const cancelKeyOf = (b) => `${Number(b.barberId)}|${b.date}|${b.time}`

export function readCancelledKeys() {
  try { return JSON.parse(localStorage.getItem(CANCEL_KEY) || "[]") } catch { return [] }
}

export function isCancelled(booking) {
  return readCancelledKeys().includes(cancelKeyOf(booking))
}

/* Cancela una cita: la marca como cancelada (para que no reaparezca desde la
   demo/servidor) y la quita del respaldo local. */
export function cancelLocalBooking(booking) {
  const key = cancelKeyOf(booking)
  const cancelled = readCancelledKeys()
  if (!cancelled.includes(key)) {
    cancelled.push(key)
    try { localStorage.setItem(CANCEL_KEY, JSON.stringify(cancelled.slice(-100))) } catch {}
  }
  const list = readLocalBookings().filter((b) => cancelKeyOf(b) !== key)
  writeLocalBookings(list)
}

function writeLocalBookings(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-100))) } catch {}
}

export function addLocalBooking(booking) {
  const list = readLocalBookings()
  const entry = {
    id: booking.id || `local-${Date.now()}`,
    date: booking.date,
    time: booking.time,
    barberId: Number(booking.barberId),
    serviceId: booking.serviceId || null,
    service: booking.service || "Servicio",
    client: booking.client || "Cliente",
    phone: booking.phone || "",
    price: Number(booking.price || 0),
    status: booking.status || "confirmada",
    source: "local",
  }
  // Evita duplicados exactos (mismo barbero/fecha/hora).
  const deduped = list.filter((b) => !(b.barberId === entry.barberId && b.date === entry.date && b.time === entry.time))
  deduped.push(entry)
  writeLocalBookings(deduped)
  return entry
}

/* Combina reservas del backend/demo con las locales sin duplicar.
   Cada reserva del servidor tiene un id real único: se indexa por id, NO por
   barbero|fecha|hora, porque ese horario puede haber tenido más de una
   reserva a lo largo del tiempo (una cancelada y luego otra persona reservó
   la misma hora libre) — indexar por ese trío colapsaba ambas filas en una
   sola entrada del Map y, según el orden en que llegara del servidor, la
   reserva cancelada podía pisar a la reserva activa real, haciéndola
   desaparecer por completo del panel.
   Las locales (creadas offline, sin id real todavía) sí se detectan por
   barbero|fecha|hora: solo se muestran si ese horario no tiene ya una
   reserva real del servidor. */
export function mergeBookings(serverBookings = []) {
  const local = readLocalBookings()
  const byId = new Map()
  const slotKeyOf = (b) => `${Number(b.barberId)}|${b.date}|${b.time}`
  serverBookings.forEach((b) => byId.set(String(b.id), b))
  const occupiedSlots = new Set(serverBookings.map(slotKeyOf))
  local.forEach((b) => { if (!occupiedSlots.has(slotKeyOf(b))) byId.set(String(b.id), b) })
  return [...byId.values()]
}

/* Una reserva local es "huérfana" cuando nunca recibió un id real del
   servidor (se creó en modo offline: ver Booking.jsx confirm()). Son las
   únicas candidatas a reconciliar — las que sí tienen id numérico ya se
   crearon en el servidor, solo faltaba que este fetch las trajera. */
export function isOrphanLocalBooking(b) {
  return typeof b?.id === "string" && b.id.startsWith("local-")
}

const matchKeyOf = (b) => `${Number(b.barberId)}|${b.date}|${b.time}`

/* La reserva huérfana ya existe de verdad en el servidor (se confirma
   comparando contra la lista real) o el reintento en background falló sin
   remedio: no tiene sentido seguir mostrándola como "confirmada". */
export function removeOrphanLocalBooking(match) {
  const key = matchKeyOf(match)
  writeLocalBookings(readLocalBookings().filter((b) => matchKeyOf(b) !== key))
}

/* El reintento en background sí logró crear la reserva: reemplaza el id
   local (local-<timestamp>) por el id real para que cancelar/reagendar
   funcione contra el servidor en vez de contra un id inventado. */
export function markLocalBookingSynced(match, realId) {
  const key = matchKeyOf(match)
  const list = readLocalBookings().map((b) => (matchKeyOf(b) === key ? { ...b, id: realId } : b))
  writeLocalBookings(list)
}
