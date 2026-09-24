// Marca personal de un solo barbero: Brunetti (Bruno Herrera). Se eliminaron
// los demás barberos del sitio público y del flujo de reserva.
// `avatar` es un recorte chico (~20 KB) de la cara para el panel, que dibuja
// la foto a 32-96 px: `photo` pesa ~340 KB y se usa donde se ve grande.
export const BARBERS = [
  { id: 6, name: "Brunetti", short: "Brunetti", code: "bruno-herrera", role: "Visagista · Director de imagen", exp: "12 años", rating: 5.0, tier: "premium", instagram: "brunetticutz", photo: "/assets/bruno-hero.jpg", avatar: "/assets/avatars/bruno.jpg" },
]

export const SERVICES = [
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

/* Identificador estable de una reserva, para keys de React y para abrir el
   detalle con un `find`. Acá todas vienen de la misma base y el `id` basta;
   una reserva que llegue con `source` (así lo arma PimpStudio para las de
   otra base) lleva el prefijo, para que dos ids iguales de bases distintas
   nunca se confundan. Los componentes del panel lo usan tal cual. */
export function bookingUid(b) {
  if (!b) return ""
  const base = b.id ?? `${b.barberId}-${b.date}-${b.time}`
  return b.source ? `${b.source}:${base}` : String(base)
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

// Mismas constantes que loyaltySummary() en api/_loyalty.js de PimpStudio —
// el programa de fidelidad es uno solo y vive allá (10 estrellas para el
// corte gratis, 5 para el 30% de descuento en productos). El panel arma el
// resumen acá mismo a partir del saldo numérico, sin pedirle este cálculo al
// servidor aparte. Mismo formato que el `loyalty` que ya devuelve el puente.
export function loyaltyFromStars(stars) {
  const FREE_CUT_STARS = 10
  const PRODUCT_DISCOUNT_STARS = 5
  const PRODUCT_DISCOUNT_PCT = 30
  const n = Number(stars || 0)
  return {
    stars: n,
    cutsToFreeCut: Math.max(0, FREE_CUT_STARS - n),
    freeCutReady: n >= FREE_CUT_STARS,
    productDiscountReady: n >= PRODUCT_DISCOUNT_STARS,
    productDiscountPct: PRODUCT_DISCOUNT_PCT,
    goal: FREE_CUT_STARS,
  }
}

// --- Fechas en español de Chile (panel) ----------------------------------
// Mismo problema (y misma solución) que formatDate() en api/_email.js: un
// dateKey "YYYY-MM-DD" es un día de calendario, no un instante. Armarlo con
// `new Date("2026-09-23")` lo interpreta en la zona del runtime y, si se
// formatea después en America/Santiago, cae en el día anterior por la noche
// (Chile es UTC-3/-4). Por eso se arma y se formatea en UTC: el día llega
// intacto. Cuando SÍ llega un Date de verdad (un instante, no una clave de
// calendario) se formatea en America/Santiago, que es su zona real.
function dateAndZone(dateKey) {
  if (dateKey instanceof Date) return { date: dateKey, timeZone: "America/Santiago" }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateKey ?? ""))
  if (!m) return null
  return { date: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))), timeZone: "UTC" }
}

const dayPart = (date, timeZone) => Number(new Intl.DateTimeFormat("es-CL", { timeZone, day: "numeric" }).format(date))
const yearPart = (date, timeZone) => Number(new Intl.DateTimeFormat("es-CL", { timeZone, year: "numeric" }).format(date))
// Número de mes (1-12), no el nombre: para comparar "mismo mes" sin
// depender de comparar strings localizados.
const monthIndexPart = (date, timeZone) => Number(new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric" }).format(date))
// Minúsculas, 3 letras y sin punto ("sep", no "sept." ni "sept"): el
// abreviado de Intl en es-CL viene en 4 letras para septiembre (y a veces
// con punto final según la versión de ICU) — se fuerza a 3 para que el
// formato sea uniforme entre meses y estable entre entornos.
const monthPart = (date, timeZone, form = "short") => {
  const raw = new Intl.DateTimeFormat("es-CL", { timeZone, month: form }).format(date).toLowerCase().replace(/\.$/, "")
  return form === "short" ? raw.slice(0, 3) : raw
}
const dowPart = (date, timeZone, form = "short") =>
  new Intl.DateTimeFormat("es-CL", { timeZone, weekday: form }).format(date).toLowerCase().replace(/\.$/, "")

/* Estilos: 'short' → "mié 23 sep", 'long' → "miércoles 23 de septiembre",
   'dm' → "23 sep", 'dmy' → "23 sep 2026". Un dateKey inválido devuelve el
   valor tal cual llegó (no truena, no inventa una fecha). */
export function fmtDate(dateKey, style = "short") {
  const parsed = dateAndZone(dateKey)
  if (!parsed) return dateKey
  const { date, timeZone } = parsed
  const day = dayPart(date, timeZone)
  if (style === "long") return `${dowPart(date, timeZone, "long")} ${day} de ${monthPart(date, timeZone, "long")}`
  if (style === "dm") return `${day} ${monthPart(date, timeZone)}`
  if (style === "dmy") return `${day} ${monthPart(date, timeZone)} ${yearPart(date, timeZone)}`
  return `${dowPart(date, timeZone)} ${day} ${monthPart(date, timeZone)}`
}

/* "16–30 sep" (mismo mes), "28 sep – 4 oct" (distinto mes). El año se agrega
   por punta y solo si esa punta no cae en el año actual, así que un rango
   dentro de este año nunca lo repite, pero un rango que cruza fin de año
   (o que quedó de un año anterior) sí lo deja explícito. */
export function fmtRange(startKey, endKey) {
  const start = dateAndZone(startKey)
  const end = dateAndZone(endKey)
  if (!start || !end) return `${startKey} – ${endKey}`
  const currentYear = yearPart(new Date(), "America/Santiago")
  const yearSuffix = (parsed) => {
    const y = yearPart(parsed.date, parsed.timeZone)
    return y === currentYear ? "" : ` ${y}`
  }
  const sameMonth = yearPart(start.date, start.timeZone) === yearPart(end.date, end.timeZone)
    && monthIndexPart(start.date, start.timeZone) === monthIndexPart(end.date, end.timeZone)
  if (sameMonth) {
    return `${dayPart(start.date, start.timeZone)}–${dayPart(end.date, end.timeZone)} ${monthPart(end.date, end.timeZone)}${yearSuffix(end)}`
  }
  return `${dayPart(start.date, start.timeZone)} ${monthPart(start.date, start.timeZone)}${yearSuffix(start)} – ${dayPart(end.date, end.timeZone)} ${monthPart(end.date, end.timeZone)}${yearSuffix(end)}`
}

/* Día de calendario en Chile ("YYYY-MM-DD") de un instante. Un `created_at`
   de la base (p. ej. los pedidos de Mercado Pago) viene en UTC: pasado por
   isoDate() queda en la zona del navegador y, de noche o fuera de Chile, cae
   en otro día que el de Caja o el del período. Una clave "YYYY-MM-DD" ya es
   un día y vuelve tal cual; un valor vacío o inválido devuelve "". Se arma
   con formatToParts (y no con el string de en-CA) para no depender de cómo
   escribe cada motor esa fecha. */
const SANTIAGO_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" })
export function santiagoDateKey(value = new Date()) {
  if (value == null || value === "") return ""
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const parts = Object.fromEntries(SANTIAGO_DAY.formatToParts(date).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
