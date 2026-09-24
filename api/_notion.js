/* PIMP STUDIO — Sincronización de reservas con Notion (API REST directa, sin SDK)
   ------------------------------------------------------------------
   syncBookingToNotion(...): crea una página en la base de datos de Notion
   configurada, para que la reserva aparezca en Notion Calendar.
   updateNotionBookingStatus(...): refleja cambios de estado (cancelación, etc).
   Requiere NOTION_API_KEY y NOTION_DATABASE_ID; si faltan, degrada sin romper
   el flujo de reserva (mismo patrón que notifyBarber/sendBookingConfirmationEmail).

   Propiedades reales de la base "Reservas Brunetti" (creada a mano por el
   usuario — los nombres/tipos no coinciden con un esquema ideal, así que el
   código se adapta a lo que existe en vez de pedir más cambios manuales):
     Nombre (title), Fecha (date), servicio (rich_text), Barbero (rich_text),
     teléfono (phone_number), Precio (rich_text — no number), Estado (status
     de 3 etapas fijas: "Sin empezar"/"En curso"/"Listo" — no select libre),
     Cliente (people — no puede recibir texto libre, así que el nombre del
     cliente NO se escribe ahí; queda visible en el título de la página). */

const NOTION_API_URL = "https://api.notion.com/v1"
const NOTION_VERSION = "2022-06-28"
const BUSINESS_TZ = "America/Santiago"
const DEFAULT_DURATION_MIN = 40

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  }
}

// Notion, cuando recibe un start/end CON sufijo "Z"/offset a la vez que un
// time_zone, no hace la conversión que uno esperaría: toma los dígitos del
// timestamp tal cual y los etiqueta con el time_zone indicado. Por eso acá
// NO usamos toISOString() directo (que depende de la zona horaria del
// proceso que corre este código — distinta en local vs en Vercel) sino que
// armamos los dígitos a mano vía Date.UTC como aritmética neutra, y le
// sacamos la "Z" antes de mandarlos: así el string queda representando
// siempre la hora de Chile tal cual se guardó la reserva, sin importar en
// qué zona horaria corra el servidor.
function buildDateRange(date, time, durationMin) {
  const [hh, mm] = String(time).slice(0, 5).split(":").map(Number)
  const [y, mo, d] = date.split("-").map(Number)
  const startMs = Date.UTC(y, mo - 1, d, hh, mm, 0)
  const endMs = startMs + (durationMin || DEFAULT_DURATION_MIN) * 60_000
  const naiveIso = (ms) => new Date(ms).toISOString().replace("Z", "")
  return { start: naiveIso(startMs), end: naiveIso(endMs), time_zone: BUSINESS_TZ }
}

function formatCLP(price) {
  if (price == null) return ""
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(price)
}

// La propiedad "Estado" quedó como Status (3 etapas fijas de Notion), no
// Select libre: solo acepta "Sin empezar" / "En curso" / "Listo". Mapeamos
// nuestros 5 estados internos a esas 3 etapas lo mejor posible.
function mapStatusToStage(status) {
  const s = String(status || "").toLowerCase()
  if (s === "en curso") return "En curso"
  if (s === "completada") return "Listo"
  return "Sin empezar" // pendiente / confirmada
}

export async function syncBookingToNotion({ client, phone, service, barber, date, time, price, status, durationMin }) {
  const apiKey = process.env.NOTION_API_KEY
  const databaseId = process.env.NOTION_DATABASE_ID
  if (!apiKey || !databaseId) return { ok: false, reason: "notion-not-configured" }

  const properties = {
    Nombre: { title: [{ text: { content: `${service || "Reserva"} — ${client || "Cliente"}` } }] },
    Fecha: { date: buildDateRange(date, time, durationMin) },
    servicio: { rich_text: [{ text: { content: service || "" } }] },
    Barbero: { rich_text: [{ text: { content: barber || "" } }] },
    Estado: { status: { name: mapStatusToStage(status) } },
    ...(phone ? { "teléfono": { phone_number: String(phone) } } : {}),
    ...(price != null ? { Precio: { rich_text: [{ text: { content: formatCLP(price) } }] } } : {}),
  }

  try {
    const response = await fetch(`${NOTION_API_URL}/pages`, {
      method: "POST",
      headers: notionHeaders(),
      body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => "")
      console.error("syncBookingToNotion: Notion respondió", response.status, errText)
      return { ok: false, reason: "notion-error" }
    }
    const page = await response.json()
    return { ok: true, pageId: page.id }
  } catch (err) {
    console.error("syncBookingToNotion error:", err?.message)
    return { ok: false, reason: "network-error" }
  }
}

// Una reserva cancelada no calza en ninguna de las 3 etapas fijas de Estado,
// así que en vez de forzar un valor engañoso archivamos la página: desaparece
// del calendario/vista activa sin perder el registro (se puede restaurar
// desde la papelera de Notion).
export async function updateNotionBookingStatus(pageId, status) {
  const apiKey = process.env.NOTION_API_KEY
  if (!apiKey || !pageId) return { ok: false }
  const isCancelled = String(status || "").toLowerCase() === "cancelada"
  const body = isCancelled
    ? { archived: true }
    : { properties: { Estado: { status: { name: mapStatusToStage(status) } } } }
  try {
    const response = await fetch(`${NOTION_API_URL}/pages/${pageId}`, {
      method: "PATCH",
      headers: notionHeaders(),
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => "")
      console.error("updateNotionBookingStatus: Notion respondió", response.status, errText)
      return { ok: false }
    }
    return { ok: true }
  } catch (err) {
    console.error("updateNotionBookingStatus error:", err?.message)
    return { ok: false }
  }
}

/* Reagendar: mueve la fecha/hora de la página (y de paso actualiza servicio,
   barbero y precio si cambiaron). Sin esto, una reserva movida desde el panel
   seguiría apareciendo en el horario viejo en Notion Calendar. */
export async function updateNotionBookingSchedule(pageId, { date, time, durationMin, service, barber, price, client }) {
  const apiKey = process.env.NOTION_API_KEY
  if (!apiKey || !pageId || !date || !time) return { ok: false }
  const properties = {
    Fecha: { date: buildDateRange(date, time, durationMin) },
    ...(service ? {
      servicio: { rich_text: [{ text: { content: service } }] },
      Nombre: { title: [{ text: { content: `${service} — ${client || "Cliente"}` } }] },
    } : {}),
    ...(barber ? { Barbero: { rich_text: [{ text: { content: barber } }] } } : {}),
    ...(price != null ? { Precio: { rich_text: [{ text: { content: formatCLP(price) } }] } } : {}),
  }
  try {
    const response = await fetch(`${NOTION_API_URL}/pages/${pageId}`, {
      method: "PATCH",
      headers: notionHeaders(),
      body: JSON.stringify({ properties }),
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => "")
      console.error("updateNotionBookingSchedule: Notion respondió", response.status, errText)
      return { ok: false }
    }
    return { ok: true }
  } catch (err) {
    console.error("updateNotionBookingSchedule error:", err?.message)
    return { ok: false }
  }
}
