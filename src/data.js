// Marca personal de un solo barbero: Brunetti (Bruno Herrera). Se eliminaron
// los demás barberos del sitio público y del flujo de reserva.
export const BARBERS = [
  { id: 6, name: "Brunetti", short: "Brunetti", code: "bruno-herrera", role: "Visagista · Director de imagen", exp: "12 años", rating: 5.0, tier: "premium", instagram: "brunetticutz", photo: "/assets/bruno-hero.jpg" },
]

export const SERVICES = [
  { id: 5,  name: "Asesoría de corte",              price: 24990, min: 90,  cat: "general",  tne: true,  desc: "Consulta profesional para encontrar tu estilo ideal." },
  { id: 6,  name: "Corte de cabello",               price: 15990, min: 60,  cat: "general",  tne: true,  desc: "Corte profesional con técnicas modernas y clásicas." },
  { id: 7,  name: "Corte + perfilado de barba",     price: 22990, min: 75,  cat: "general",  tne: true,  desc: "Servicio completo de corte y arreglo de barba." },
  { id: 8,  name: "Perfilado de barba",             price: 11990, min: 45,  cat: "general",  tne: true,  desc: "Perfilado y arreglo profesional de barba." },
  { id: 9,  name: "Solo fade",                      price: 9990,  min: 40,  cat: "general",  tne: true,  desc: "Degradado perfecto y limpio." },
  { id: 10, name: "Asesoría de Imagen · Visagista", price: 39990, min: 120, cat: "premium",  tne: false, desc: "Consulta personalizada según tu fisonomía." },
  { id: 11, name: "Corte de cabello",               price: 19990, min: 60,  cat: "premium",  tne: false, desc: "Corte de precisión con técnicas avanzadas." },
  { id: 12, name: "Corte de cabello y barba",       price: 29990, min: 90,  cat: "premium",  tne: false, desc: "Servicio premium completo de corte y barba." },
  { id: 13, name: "Ondulación permanente",          price: 65990, min: 180, cat: "quimico",  tne: false, desc: "Forma y textura duradera al cabello." },
  { id: 14, name: "Platinado Global",               price: 89990, min: 240, cat: "quimico",  tne: false, desc: "Decoloración completa para un rubio platino." },
  { id: 15, name: "Visos Platinados",               price: 74990, min: 210, cat: "quimico",  tne: false, desc: "Mechas platinadas para un look sofisticado." },
]

export const CLIENTS = [
  { id: 1, name: "Carlos Rodriguez", phone: "987654321", email: "carlos@ejemplo.com", visits: 4, lastVisit: "2026-05-22", totalSpent: 68960, status: "activo" },
  { id: 2, name: "Maria Gonzalez", phone: "912345678", email: "maria@ejemplo.com", visits: 2, lastVisit: "2026-06-04", totalSpent: 55980, status: "activo" },
  { id: 3, name: "Pedro Soto", phone: "956789012", email: "pedro@ejemplo.com", visits: 1, lastVisit: "2026-06-09", totalSpent: 9990, status: "nuevo" },
]

export const EXPENSES = [
  { id: 1, date: "2026-06-03", category: "Insumos", detail: "Cera, navajas y peines", amount: 145000, owner: "Brunetti" },
  { id: 2, date: "2026-06-05", category: "Marketing", detail: "Campana Instagram", amount: 85000, owner: "Brunetti" },
  { id: 3, date: "2026-06-08", category: "Arriendo", detail: "Local Monumento 1750", amount: 620000, owner: "Administracion" },
]

// Brunetti atiende todos los servicios (único barbero).
export const SERVICE_BARBERS = { 6: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }

export const CAT_LABEL = { general: "Servicios generales", premium: "Brunetti Experience", quimico: "Servicios químicos" }

export const SLOT_GROUPS = {
  Mañana: ["09:00", "10:00", "11:00"],
  Tarde:  ["12:00", "13:00", "14:00", "15:00", "16:00", "17:00"],
  Noche:  ["18:00", "19:00"],
}
export const ALL_SLOTS = [...SLOT_GROUPS["Mañana"], ...SLOT_GROUPS["Tarde"], ...SLOT_GROUPS["Noche"]]

export const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
export const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

export function slotState(barberId, dateKey, slot) {
  const seed = [...(`${barberId}|${dateKey}|${slot}`)].reduce((a, c) => a + c.charCodeAt(0), 0)
  const r = (seed * 9301 + 49297) % 233280 / 233280
  if (r < 0.30) return "booked"
  if (r < 0.40) return "blocked"
  return "free"
}

export const TODAY_BOOKINGS = [
  { time: "09:00", client: "Carlos Rodríguez",  service: "Corte + perfilado de barba",     barberId: 6,  price: 22990, status: "confirmada" },
  { time: "09:30", client: "Matías Pérez",       service: "Solo fade",                      barberId: 6,  price: 9990,  status: "confirmada" },
  { time: "10:00", client: "Diego Salinas",      service: "Corte de cabello",               barberId: 6,  price: 15990, status: "en curso" },
  { time: "10:30", client: "Bruno Castro",       service: "Asesoría de Imagen · Visagista", barberId: 6,  price: 39990, status: "confirmada" },
  { time: "11:00", client: "Felipe Aravena",     service: "Perfilado de barba",             barberId: 6,  price: 11990, status: "confirmada" },
  { time: "12:00", client: "Joaquín Reyes",      service: "Corte de cabello",               barberId: 6,  price: 15990, status: "confirmada" },
  { time: "13:00", client: "Tomás Vidal",        service: "Corte + perfilado de barba",     barberId: 6,  price: 22990, status: "confirmada" },
  { time: "15:00", client: "Sebastián Núñez",    service: "Platinado Global",               barberId: 6, price: 89990, status: "confirmada" },
  { time: "16:00", client: "Ignacio Soto",       service: "Corte de cabello",               barberId: 6,  price: 15990, status: "confirmada" },
  { time: "17:00", client: "Vicente Lagos",      service: "Visos Platinados",               barberId: 6, price: 74990, status: "pendiente" },
  { time: "18:00", client: "Andrés Fuentes",     service: "Solo fade",                      barberId: 6,  price: 9990,  status: "confirmada" },
  { time: "18:30", client: "Gabriel Muñoz",      service: "Corte + perfilado de barba",     barberId: 6,  price: 29990, status: "confirmada" },
]

export const CLIENT_APPTS = [
  { id: 1, date: "2026-06-14", time: "11:00", barberId: 6, service: "Corte + perfilado de barba",     price: 22990, status: "confirmada", when: "next" },
  { id: 2, date: "2026-05-22", time: "16:00", barberId: 6, service: "Corte de cabello",               price: 15990, status: "completada", when: "past" },
  { id: 3, date: "2026-04-30", time: "10:30", barberId: 6, service: "Solo fade",                      price: 9990,  status: "completada", when: "past" },
  { id: 4, date: "2026-03-18", time: "18:00", barberId: 6, service: "Asesoría de Imagen · Visagista", price: 39990, status: "completada", when: "past" },
]

export function CLP(n) { return "$" + Number(n || 0).toLocaleString("es-CL") }
export function CLPk(n) { return "$" + (Math.round(Number(n) / 1000)).toLocaleString("es-CL") + "k" }
export function barberById(id) { return BARBERS.find((b) => b.id === id) || null }
export function tne(price) { return Math.round(price * 0.8) }
export function cleanPhone(v) {
  let digits = String(v || "").replace(/\D/g, "")
  if (digits.length > 9 && digits.startsWith("56")) digits = digits.slice(2)
  return digits.slice(0, 9)
}
export function isAdminUser(user) {
  const haystack = `${user?.name || ""} ${user?.code || ""} ${user?.role || ""}`.toLowerCase()
  return haystack.includes("brunetti") || haystack.includes("bruno") || haystack.includes("admin")
}

// --- Utilidades de fecha (locales, no UTC) -------------------------------
// toISOString() usa UTC: en Chile (UTC-3/-4) hace rollover al día siguiente
// de noche, desalineando "hoy". Estas usan componentes locales.
export function isoDate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

// Semana (Lun→Dom) desplazada `offset` semanas. Devuelve 7 días con
// { key: "YYYY-MM-DD", label: "Lun 6", dow: "Lun", num: 6 }.
export function buildWeek(offset = 0) {
  const now = new Date()
  const monday = new Date(now)
  const day = monday.getDay() || 7
  monday.setDate(now.getDate() - day + 1 + offset * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    const dow = DAYS_ES[date.getDay()]
    const num = date.getDate()
    return { key: isoDate(date), label: `${dow} ${num}`, dow, num }
  })
}
