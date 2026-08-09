// Horarios de 1h que vende el negocio. Compartido por availability.js y
// bookings.js para que ambos calculen los mismos bloques ocupados por una
// reserva según la duración del servicio (antes cada reserva ocupaba un solo
// bloque sin importar cuánto durara el servicio, así que un "corte + barba"
// de 90 min dejaba la hora siguiente libre para que otro cliente la tomara).
export const ALL_SLOTS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"]

export function blocksForDuration(durationMin) {
  return Math.max(1, Math.ceil(Number(durationMin || 60) / 60))
}

// Bloques consecutivos que ocupa una reserva de `blocks` horas empezando en
// `startSlot`. null si no cabe dentro del horario del negocio.
export function slotsForBooking(startSlot, blocks) {
  const idx = ALL_SLOTS.indexOf(startSlot)
  if (idx === -1 || idx + blocks > ALL_SLOTS.length) return null
  return ALL_SLOTS.slice(idx, idx + blocks)
}

// Set de horarios ocupados (por reservas activas, según la duración de su
// servicio, + bloqueos manuales) para un barbero en una fecha.
export async function busySlotsForBarberDate(sql, barberId, date) {
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
  const busy = new Set()
  for (const row of booked) {
    const start = row.slot?.slice(0, 5)
    const span = slotsForBooking(start, blocksForDuration(row.durationMin)) || [start]
    span.forEach((s) => busy.add(s))
  }
  blocked.forEach((row) => busy.add(row.slot?.slice(0, 5)))
  return busy
}
