/* ACADEMY — Presupuesto diario de correos
   ------------------------------------------------------------------
   El plan gratis de Resend son 100 correos al día, y los COMPARTEN las
   confirmaciones de reserva y los "gracias por tu visita" de la barbería. Si
   la Academy se los come (un foro activo, un resumen masivo, alguien
   pidiendo "olvidé mi contraseña" en loop), el cliente que reserva un corte
   deja de recibir su confirmación. Por eso todo correo de la Academy pasa por
   sendAcademyEmail(), que cuenta por día (hora de Santiago) y por tipo en
   academy_email_log:

     - no críticos: se frenan cuando la Academy ya mandó 60 ese día (quedan
       ~40 para las reservas);
     - los que dispara alguien sin sesión ('reset', 'email'): además tope
       propio de 20 al día entre los dos, para que un formulario público no
       pueda gastar el presupuesto entero;
     - críticos (las credenciales de una compra pagada): SIEMPRE salen. Se
       cuentan igual, pero un alumno que pagó y no puede entrar es peor que
       cualquier otra cosa en esta lista.

   Con la base compartida (api/_academyDb.js) cada sitio manda con SU cuenta
   de Resend, así que cada uno cuenta su propio cupo: la fila lleva `site`
   (y '' = filas anteriores, del dueño de la base).

   Tipos usados por el resto de la Academy (VARCHAR(24)):
     credentials  acceso con contraseña temporal (crítico)
     already      "ya tienes acceso a <curso>"
     reset        restablecer contraseña (público)
     email        confirmar correo nuevo / aviso al viejo (público)
     activity     resumen de novedades
     event        recordatorio de evento

   Las plantillas (acceso, reset, cambio de correo, novedades, recordatorio
   de evento) y el envío por Resend viven también acá, con la marca de
   api/_academyHost.js: antes estaban en api/_email.js, pero la Academy es un
   módulo portable y no puede depender del correo de la barbería.

   Nunca se loguea el cuerpo del correo ni una contraseña: solo tipo y motivo.
   Prefijo `_`: no cuenta como función serverless. */

import { HOST, siteUrl } from "./_academyHost.js"
import { SITE, ownsDb } from "./_academyDb.js"
import { esc } from "./_academyText.js"

export const ACADEMY_EMAIL_DAILY_CAP = 60
export const ACADEMY_EMAIL_PUBLIC_CAP = 20
export const PUBLIC_EMAIL_KINDS = ["reset", "email"]

let nowFn = () => new Date()

/* fetch inyectable SOLO para tests. En producción queda en null y se usa
   el fetch global. */
let injectedFetch = null

/* Solo tests (scripts/test-academy): `fetch` reemplaza al de Resend y `now`
   al reloj (para probar el corte de día). Llamarlo sin argumentos restaura. */
export function __setTestDeps({ fetch, now } = {}) {
  injectedFetch = typeof fetch === "function" ? fetch : null
  nowFn = typeof now === "function" ? now : () => new Date()
}

/* Día calendario en Santiago (YYYY-MM-DD). Vercel corre en UTC: a las 22:00
   de Santiago ya es "mañana" en UTC, y el presupuesto se reiniciaría a
   destiempo. en-CA formatea justamente como YYYY-MM-DD. */
function santiagoDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}

/* ¿Se mandó de verdad? Un timeout o un error de red pueden haber llegado a
   Resend igual: esos se quedan contados (mejor quedarse corto que pasarse).
   Un rechazo explícito (4xx/5xx, sin llave, sin destinatario) no gastó cuota
   y se devuelve al contador. */
function notSent(result) {
  if (!result || result.ok) return false
  if (result.reason === "timeout" || result.reason === "network-error") return false
  return true
}

/* sendAcademyEmail(sql, kind, sendFn, args, { critical })
   → { ok, status, reason, skipped? }
   `sendFn` es una de las plantillas de más abajo (sendAcademyAccessEmail,
   …) y `args` sus argumentos. Nunca lanza. */
export async function sendAcademyEmail(sql, kind, sendFn, args, { critical = false } = {}) {
  const k = String(kind || "otro").slice(0, 24)
  if (typeof sendFn !== "function") return { ok: false, status: 0, reason: "no-template", skipped: true }
  const isPublic = PUBLIC_EMAIL_KINDS.includes(k)
  const day = santiagoDay(nowFn())

  // Reserva del cupo ANTES de mandar, en una sola sentencia: el INSERT solo
  // ocurre si el SELECT de totales pasa el filtro, así que "leer el total y
  // sumar uno" no puede intercalarse con otra instancia entre medio. (Dos
  // requests exactamente simultáneas podrían pasarse por uno; es un tope de
  // cortesía, no contable.) ON CONFLICT sobre la PK (day, kind), nunca un
  // índice parcial.
  let reserved = false
  const own = ownsDb()
  try {
    const rows = await sql`
      WITH tot AS (
        SELECT COALESCE(SUM(n), 0)::int AS total,
               COALESCE(SUM(n) FILTER (WHERE kind = ANY(${PUBLIC_EMAIL_KINDS}::text[])), 0)::int AS pub
        FROM academy_email_log
        WHERE day = ${day}::date AND (site = ${SITE} OR (site = '' AND ${own}::boolean))
      )
      INSERT INTO academy_email_log (day, kind, site, n)
      SELECT ${day}::date, ${k}, ${SITE}, 1 FROM tot
      WHERE ${critical}::boolean
         OR (tot.total < ${ACADEMY_EMAIL_DAILY_CAP}::int
             AND (NOT ${isPublic}::boolean OR tot.pub < ${ACADEMY_EMAIL_PUBLIC_CAP}::int))
      ON CONFLICT (day, kind, site) DO UPDATE SET n = academy_email_log.n + 1
      RETURNING n
    `
    reserved = rows.length > 0
  } catch (err) {
    // Sin contador (tabla aún no creada, base caída): lo crítico sale igual;
    // lo demás espera — mandar a ciegas es justo lo que el tope evita.
    console.error(`[academy:email] contador no disponible (${k}):`, err?.code || err?.message || err)
    if (!critical) return { ok: false, status: 0, reason: "budget-unavailable", skipped: true }
    reserved = false
  }
  if (!reserved && !critical) {
    console.warn(`[academy:email] presupuesto del día agotado, no se envía (${k})`)
    return { ok: false, status: 0, reason: "budget", skipped: true }
  }

  let result
  try {
    result = await sendFn(args || {})
  } catch (err) {
    // Las plantillas no lanzan, pero si una lo hiciera no debe tumbar a quien
    // llama (un webhook de pago, un cron).
    console.error(`[academy:email] la plantilla falló (${k}):`, err?.message || err)
    result = { ok: false, status: 0, reason: "template-error" }
  }
  if (!result?.ok) console.error(`[academy:email] no se envió (${k}):`, result?.status || 0, result?.reason || "desconocido")

  if (reserved && notSent(result)) {
    try {
      await sql`UPDATE academy_email_log SET n = GREATEST(n - 1, 0) WHERE day = ${day}::date AND kind = ${k} AND site = ${SITE}`
    } catch {
      // Si no se pudo devolver el cupo, el día queda contado de más: inofensivo.
    }
  }
  return { ok: Boolean(result?.ok), status: Number(result?.status || 0), reason: result?.reason ?? null }
}

/* Cuántos correos lleva la Academy hoy desde ESTE sitio (para admin-stats):
   el cupo es de su cuenta de Resend. */
export async function academyEmailsToday(sql) {
  const day = santiagoDay(nowFn())
  const [row] = await sql`
    SELECT COALESCE(SUM(n), 0)::int AS n FROM academy_email_log
    WHERE day = ${day}::date AND (site = ${SITE} OR (site = '' AND ${ownsDb()}::boolean))`
  return { today: Number(row?.n || 0), budget: ACADEMY_EMAIL_DAILY_CAP }
}

/* ══ Envío por Resend (API REST directa, sin SDK) ══════════════════════════
   Mismo contrato que sendViaResend de la barbería: devuelve
   { ok, status, reason } y nunca lanza. `status` es el HTTP de Resend (0 si
   ni siquiera se llegó): quien reintenta (las credenciales de una compra)
   necesita distinguir un 429 de cuota de un error permanente. `headers`
   sirve para la Idempotency-Key, que Resend respeta 24 h: un reintento del
   mismo correo de acceso no llega dos veces. El timeout existe porque sin
   él un Resend lento dejaba colgada la función hasta su propio límite.

   Remitente: el nombre de la Academy (HOST.brand.emailFromName) con la
   dirección de RESEND_FROM, que es la que está verificada en Resend. */
const RESEND_API_URL = "https://api.resend.com/emails"

/* Asunto en una sola línea: un salto de línea en un asunto armado con datos
   del usuario es la forma clásica de inyectar cabeceras. */
function oneLine(s) {
  return String(s ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 200)
}

function fromAddress() {
  const raw = String(process.env.RESEND_FROM || "").trim()
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(raw)
  let address = m ? m[1] : (/^[^\s<>@]+@[^\s<>@]+$/.test(raw) ? raw : "")
  if (!address) {
    let host = ""
    try { host = new URL(HOST.defaultSiteUrl).hostname.replace(/^www\./, "") } catch { host = "" }
    address = `reservas@${host || "localhost"}`
  }
  const name = String(HOST.brand?.emailFromName || HOST.brand?.name || "").replace(/[<>"\r\n]+/g, "").trim()
  return name ? `${name} <${address}>` : address
}

async function sendViaResend({ to, subject, html, text, headers = {}, replyTo, timeoutMs = 8000 }) {
  if (!to) return { ok: false, status: 0, reason: "no-email" }
  const doFetch = injectedFetch || fetch
  const apiKey = process.env.RESEND_API_KEY || (injectedFetch ? "test-key" : "")
  if (!apiKey) {
    console.error("[academy:email] RESEND_API_KEY ausente")
    return { ok: false, status: 0, reason: "email-not-configured" }
  }
  const payload = { from: fromAddress(), to, subject: oneLine(subject), html }
  if (text) payload.text = text
  if (replyTo) payload.reply_to = replyTo
  const extra = {}
  for (const [k, v] of Object.entries(headers || {})) {
    if (typeof v === "string" && v && /^[A-Za-z0-9-]{1,64}$/.test(k)) extra[k] = v.slice(0, 256)
  }
  try {
    const response = await doFetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        ...extra,
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 8000)),
    })
    if (!response.ok) {
      // Solo el status y un pedazo del error de Resend: su respuesta puede
      // traer el destinatario, pero nunca el cuerpo que mandamos.
      const errText = await response.text().catch(() => "")
      console.error("[academy:email] Resend respondió", response.status, String(errText).slice(0, 300))
      return { ok: false, status: response.status, reason: response.status === 429 ? "rate-limited" : "resend-error" }
    }
    return { ok: true, status: response.status, reason: null }
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError"
    console.error("[academy:email] error:", timedOut ? "timeout" : err?.message)
    return { ok: false, status: 0, reason: timedOut ? "timeout" : "network-error" }
  }
}

/* ══ Plantillas ════════════════════════════════════════════════════════════
   Mismo "cascarón" visual que los correos de la barbería (fondo gris,
   tarjeta de 480 px, cabecera negra con el logo, botón pastilla). Cada
   plantilla manda también una parte de texto plano: sin ella, varios
   filtros de spam castigan el correo y los lectores de pantalla leen el
   HTML crudo. Todo lo que se interpola en el HTML pasa por esc().

   Todas devuelven { ok, status, reason } (lo de sendViaResend). No se llaman
   directo: van por sendAcademyEmail(), que lleva el presupuesto diario. */

const ACADEMY_NAME = HOST.brand.name
// "la Academy": el nombre corto con artículo, para las frases de los correos.
const LA_ACADEMY = `la ${HOST.brand.short}`
const BASE = HOST.basePath
const logoUrl = () => `${siteUrl()}${HOST.brand.emailLogoPath || HOST.brand.logoPath}`

/* Solo links propios o https: las URLs de estas plantillas las arma el
   servidor, pero una ruta relativa ("/academy/…") tiene que llegar absoluta
   al correo y cualquier otra cosa rara cae al inicio de la Academy. */
function absUrl(u) {
  const s = String(u ?? "").trim()
  if (s.startsWith("/") && !s.startsWith("//")) return `${siteUrl()}${s}`
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s
  return `${siteUrl()}${BASE}`
}

function courseTitle(course) {
  if (!course) return ""
  if (typeof course === "string") return course
  return String(course.title || course.name || "")
}

function firstName(name) {
  return String(name ?? "").trim().split(/\s+/)[0] || ""
}

/* `headingText`, `introText` y `cta` llegan como TEXTO y se escapan acá;
   `bodyHtml` y `footerHtml` los arma quien llama, ya escapados. */
function academyShell({ headingText, introText, bodyHtml = "", cta = null, showFallbackLink = false, footerHtml = "" }) {
  const ctaUrl = cta ? absUrl(cta.url) : ""
  return `
    <div style="font-family: Georgia, 'Times New Roman', serif; background: #f0f0f0; padding: 32px 16px;">
      <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e0e0e0;">
        <div style="background: #141414; padding: 24px; text-align: center;">
          <img src="${esc(logoUrl())}" alt="${esc(HOST.brand.siteName)}" width="120" style="width: 120px; max-width: 40%; height: auto; display: inline-block; border-radius: 50%;" />
        </div>
        <div style="padding: 28px 24px;">
          <h1 style="margin: 0 0 4px; font-size: 20px; color: #1a1a1a;">${esc(headingText)}</h1>
          ${introText ? `<p style="margin: 0 0 20px; color: #454545; font-size: 14px;">${esc(introText)}</p>` : ""}
          ${bodyHtml}
          ${cta ? `
          <div style="text-align: center; margin: 26px 0 6px;">
            <a href="${esc(ctaUrl)}" style="display: inline-block; background: #1a1a1a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 999px;">${esc(cta.label)}</a>
          </div>` : ""}
          ${cta && showFallbackLink ? `
          <p style="margin: 18px 0 0; color: #858585; font-size: 12px; word-break: break-all;">
            Si el botón no funciona, copia este enlace:<br />${esc(ctaUrl)}
          </p>` : ""}
          ${footerHtml}
        </div>
      </div>
    </div>
  `.trim()
}

function smallNote(html) {
  return `<p style="margin: 18px 0 0; color: #858585; font-size: 12px;">${html}</p>`
}

/* Texto plano: líneas no vacías separadas por salto; los links van solos en
   su línea para que cualquier cliente los haga clicables. */
function plain(lines) {
  return lines.filter((l) => l !== null && l !== undefined && l !== false).join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function idem(key) {
  return key ? { "Idempotency-Key": String(key) } : {}
}

/* Credenciales tras la compra (o una invitación). Es el ÚNICO correo que no
   frena el presupuesto diario: sin él, alguien que pagó no puede entrar.
   `idempotencyKey` = 'aca-cred-<id>-<claim>': si la función se cae después
   de mandar y antes de marcarlo enviado, el reintento no llega duplicado. */
export async function sendAcademyAccessEmail({ to, name, tempPassword, loginUrl, course, idempotencyKey }) {
  const who = firstName(name)
  const title = courseTitle(course)
  const url = absUrl(loginUrl || `${BASE}/ingreso`)
  const introText = title
    ? `Tu inscripción en ${title} quedó confirmada. Estos son tus datos para entrar:`
    : `Ya tienes acceso a ${ACADEMY_NAME}. Estos son tus datos para entrar:`
  const bodyHtml = `
          <div style="margin: 0 0 8px; padding: 16px 18px; background: #faf7f0; border: 1px solid #e8dfc8; border-radius: 12px;">
            <p style="margin: 0 0 4px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #858585;">Usuario</p>
            <p style="margin: 0 0 14px; font-size: 15px; color: #1a1a1a; word-break: break-all;">${esc(to)}</p>
            <p style="margin: 0 0 4px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #858585;">Contraseña temporal</p>
            <p style="margin: 0; font-family: 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 20px; letter-spacing: 3px; color: #1a1a1a;">${esc(tempPassword)}</p>
          </div>
          <p style="margin: 10px 0 0; color: #454545; font-size: 13px;">Válida por 72 h; al entrar te pediremos crear la tuya.</p>`
  const footerHtml = smallNote("Si recibiste más de un correo con contraseña temporal, usa el más reciente: los anteriores ya no sirven.")
    + smallNote("<strong>¿No hiciste esta compra?</strong> Responde este correo y lo revisamos.")
  const html = academyShell({
    headingText: `¡Bienvenido a ${ACADEMY_NAME}${who ? `, ${who}` : ""}!`,
    introText,
    bodyHtml,
    cta: { label: `Entrar a ${LA_ACADEMY}`, url },
    footerHtml,
  })
  const text = plain([
    `¡Bienvenido a ${ACADEMY_NAME}${who ? `, ${who}` : ""}!`,
    "",
    introText,
    "",
    `Usuario: ${to}`,
    `Contraseña temporal: ${tempPassword}`,
    "Válida por 72 h; al entrar te pediremos crear la tuya.",
    "",
    `Entrar a ${LA_ACADEMY}: ${url}`,
    "",
    "Si recibiste más de un correo con contraseña temporal, usa el más reciente.",
  ])
  return sendViaResend({ to, subject: `Tu acceso a ${ACADEMY_NAME}`, html, text, headers: idem(idempotencyKey) })
}

/* Compra nueva de alguien que YA tiene contraseña: no se le manda otra
   temporal (le pisaría la suya), solo el aviso de que el curso ya está. */
export async function sendAcademyAlreadyEmail({ to, name, course, loginUrl, idempotencyKey }) {
  const who = firstName(name)
  const title = courseTitle(course) || "tu nuevo curso"
  const url = absUrl(loginUrl || `${BASE}/ingreso`)
  const introText = `Sumamos ${title} a tu cuenta de ${ACADEMY_NAME}. Entra con tu correo y tu contraseña de siempre.`
  const html = academyShell({
    headingText: `¡Listo${who ? `, ${who}` : ""}!`,
    introText,
    cta: { label: `Entrar a ${LA_ACADEMY}`, url },
    footerHtml: smallNote("¿No recuerdas tu contraseña? En la página de ingreso toca «¿Olvidaste tu contraseña?» y te mandamos un enlace."),
  })
  const text = plain([
    `¡Listo${who ? `, ${who}` : ""}!`,
    "",
    introText,
    "",
    `Entrar a ${LA_ACADEMY}: ${url}`,
    "",
    "¿No recuerdas tu contraseña? En la página de ingreso toca «¿Olvidaste tu contraseña?».",
  ])
  return sendViaResend({ to, subject: `Ya tienes acceso a ${title}`, html, text, headers: idem(idempotencyKey) })
}

/* Restablecer (o crear por primera vez) la contraseña del miembro. Mismo
   criterio que el del panel: sirve una vez, vence pronto, y si no lo pediste
   el correo te dice que no hagas nada. */
export async function sendAcademyResetEmail({ to, name, resetUrl, minutes = 30 }) {
  const who = firstName(name)
  const url = absUrl(resetUrl)
  const introText = `Pediste crear una contraseña nueva para ${ACADEMY_NAME}. Este enlace sirve una sola vez y vence en ${Number(minutes) || 30} minutos.`
  const html = academyShell({
    headingText: `Restablece tu contraseña${who ? `, ${who}` : ""}`,
    introText,
    cta: { label: "Crear una contraseña nueva", url },
    showFallbackLink: true,
    footerHtml: smallNote("<strong>¿No fuiste tú?</strong> Ignora este correo: tu contraseña actual sigue funcionando mientras no uses el enlace."),
  })
  const text = plain([
    `Restablece tu contraseña${who ? `, ${who}` : ""}`,
    "",
    introText,
    "",
    url,
    "",
    "¿No fuiste tú? Ignora este correo: tu contraseña actual sigue funcionando.",
  ])
  return sendViaResend({ to, subject: `Restablece tu contraseña de ${ACADEMY_NAME}`, html, text })
}

/* Confirmación del correo NUEVO. Va al correo nuevo, no al viejo: lo que se
   prueba es que la persona controla la casilla a la que quiere cambiarse. */
export async function sendAcademyEmailChangeEmail({ to, name, confirmUrl, minutes = 30 }) {
  const who = firstName(name)
  const url = absUrl(confirmUrl)
  const introText = `Pediste usar este correo para entrar a ${ACADEMY_NAME}. Confírmalo con el botón; el enlace vence en ${Number(minutes) || 30} minutos.`
  const html = academyShell({
    headingText: `Confirma tu nuevo correo${who ? `, ${who}` : ""}`,
    introText,
    cta: { label: "Confirmar mi correo", url },
    showFallbackLink: true,
    footerHtml: smallNote("Si no fuiste tú, ignora este correo: no cambia nada."),
  })
  const text = plain([
    `Confirma tu nuevo correo${who ? `, ${who}` : ""}`,
    "",
    introText,
    "",
    url,
    "",
    "Si no fuiste tú, ignora este correo: no cambia nada.",
  ])
  return sendViaResend({ to, subject: `Confirma tu nuevo correo en ${ACADEMY_NAME}`, html, text })
}

/* Aviso al correo VIEJO después del cambio. Si el cambio no lo hizo el
   dueño de la cuenta, este es el único rastro que le queda: por eso va
   siempre y dice qué hacer. */
export async function sendAcademyEmailChangedNotice({ to, name, newEmailMasked }) {
  const who = firstName(name)
  const introText = `Desde ahora entras a ${ACADEMY_NAME} con ${newEmailMasked || "tu correo nuevo"}. Por seguridad cerramos tu sesión en todos los dispositivos.`
  const html = academyShell({
    headingText: `Tu correo cambió${who ? `, ${who}` : ""}`,
    introText,
    footerHtml: smallNote("<strong>¿No fuiste tú?</strong> Responde este correo de inmediato y te ayudamos a recuperar tu cuenta."),
  })
  const text = plain([
    `Tu correo cambió${who ? `, ${who}` : ""}`,
    "",
    introText,
    "",
    "¿No fuiste tú? Responde este correo de inmediato y te ayudamos a recuperar tu cuenta.",
  ])
  return sendViaResend({ to, subject: `El correo de tu cuenta de ${ACADEMY_NAME} cambió`, html, text })
}

/* Resumen de novedades (menciones, respuestas, mensajes) para quien no
   tiene push y no entra hace rato. Máximo 10 ítems: es un aviso, no un feed. */
export async function sendAcademyActivityEmail({ to, name, items = [], loginUrl }) {
  const who = firstName(name)
  const list = (Array.isArray(items) ? items : []).slice(0, 10).map((it) => ({ text: String(it?.text ?? "").slice(0, 200), url: absUrl(it?.url || `${BASE}/comunidad`) })).filter((it) => it.text)
  const url = absUrl(loginUrl || `${BASE}/comunidad`)
  const bodyHtml = list.length
    ? `<ul style="margin: 0; padding: 0 0 0 18px; color: #1a1a1a; font-size: 14px;">${list.map((it) => `<li style="margin: 0 0 8px;"><a href="${esc(it.url)}" style="color: #1a1a1a;">${esc(it.text)}</a></li>`).join("")}</ul>`
    : ""
  const introText = `Pasaron cosas en ${LA_ACADEMY} mientras no estabas:`
  const html = academyShell({
    headingText: `Hola${who ? ` ${who}` : ""}, tienes novedades`,
    introText,
    bodyHtml,
    cta: { label: `Ir a ${LA_ACADEMY}`, url },
    footerHtml: smallNote("Puedes apagar estos correos en Ajustes → Notificaciones."),
  })
  const text = plain([
    `Hola${who ? ` ${who}` : ""}, tienes novedades`,
    "",
    introText,
    ...list.map((it) => `- ${it.text}: ${it.url}`),
    "",
    `Ir a ${LA_ACADEMY}: ${url}`,
    "",
    "Puedes apagar estos correos en Ajustes → Notificaciones.",
  ])
  return sendViaResend({ to, subject: `Tienes novedades en ${ACADEMY_NAME}`, html, text })
}

/* Recordatorio de evento (24 h antes). `whenText` ya viene armado en la zona
   del evento ("mañana jueves 2 de octubre a las 19:00"). */
export async function sendAcademyEventReminderEmail({ to, name, event = {} }) {
  const who = firstName(name)
  const title = String(event?.title || `Evento de ${LA_ACADEMY}`).slice(0, 120)
  const whenText = String(event?.whenText || "").slice(0, 120)
  const url = absUrl(event?.url || `${BASE}/calendario`)
  const introText = whenText ? `${who ? `${who}, te` : "Te"} recordamos: es ${whenText}.` : `${who ? `${who}, te` : "Te"} recordamos este evento de ${LA_ACADEMY}.`
  const html = academyShell({
    headingText: title,
    introText,
    cta: { label: "Ver el evento", url },
    footerHtml: smallNote("Puedes apagar estos recordatorios en Ajustes → Notificaciones."),
  })
  const text = plain([
    title,
    "",
    introText,
    "",
    `Ver el evento: ${url}`,
    "",
    "Puedes apagar estos recordatorios en Ajustes → Notificaciones.",
  ])
  return sendViaResend({ to, subject: `Recordatorio: ${title}`, html, text })
}
