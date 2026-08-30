/* PIMP STUDIO — Correos transaccionales vía Resend (API REST directa, sin SDK)
   ------------------------------------------------------------------
   sendBookingConfirmationEmail(...): avisa al cliente que su reserva quedó
   confirmada. Requiere RESEND_API_KEY; si falta o el cliente no dejó email,
   degrada sin romper el flujo de reserva (mismo patrón que notifyBarber en
   push.js). */

const RESEND_API_URL = "https://api.resend.com/emails"
const SITE_URL = process.env.SITE_URL || "https://brunetticutz.cl"
const LOGO_URL = `${SITE_URL}/assets/brunetti-hero-wordmark.webp`
/* PNG (no webp) a propósito: Outlook de Windows no renderiza webp. */
const WORKSHOP_LOGO_URL = `${SITE_URL}/assets/email/brunetti-wordmark-morado.png`
const ASCENSION_LOGO_URL = `${SITE_URL}/assets/email/ascension-logo.png`
const WORKSHOP_MAP_URL = `${SITE_URL}/assets/email/workshop-mapa.png`

/* Datos fijos del Workshop (Uno Norte 681, local 7 · Viña del Mar). */
const WK = {
  address: "Uno Norte 681, local 7",
  city: "Viña del Mar",
  hint: "a pasos de Avenida Libertad",
  time: "10:00 h",
  arrive: "Llega 10 o 15 minutos antes",
  mapsUrl: "https://www.google.com/maps/dir/?api=1&destination=-33.0223239%2C-71.5518522",
  whatsapp: "56987483279",
}

async function sendViaResend({ to, subject, html }) {
  if (!to) return { ok: false, reason: "no-email" }
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error("sendViaResend: RESEND_API_KEY ausente")
    return { ok: false, reason: "email-not-configured" }
  }
  const from = process.env.RESEND_FROM || "Brunetticutz <reservas@brunetticutz.cl>"
  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => "")
      console.error("sendViaResend: Resend respondió", response.status, errText)
      return { ok: false, reason: "resend-error" }
    }
    return { ok: true }
  } catch (err) {
    console.error("sendViaResend error:", err?.message)
    return { ok: false, reason: "network-error" }
  }
}

function formatCLP(price) {
  if (price == null) return null
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(price)
}

function formatDate(dateStr) {
  try {
    return new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${dateStr}T00:00:00`))
  } catch {
    return dateStr
  }
}

export async function sendBookingConfirmationEmail({ to, name, service, barber, date, time, price }) {
  const prettyDate = formatDate(date)
  const prettyTime = String(time || "").slice(0, 5)
  const prettyPrice = formatCLP(price)

  const html = `
    <div style="font-family: Georgia, 'Times New Roman', serif; background: #f7f3ea; padding: 32px 16px;">
      <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e7e0d1;">
        <div style="background: #16130f; padding: 24px; text-align: center;">
          <img src="${LOGO_URL}" alt="Brunetticutz" width="220" style="width: 220px; max-width: 70%; height: auto; display: inline-block;" />
        </div>
        <div style="padding: 28px 24px;">
          <h1 style="margin: 0 0 4px; font-size: 20px; color: #1c1a17;">¡Reserva confirmada${name ? `, ${name}` : ""}!</h1>
          <p style="margin: 0 0 20px; color: #4a453d; font-size: 14px;">Te esperamos en Brunetticutz. Estos son los detalles de tu hora:</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #1c1a17;">
            <tr><td style="padding: 6px 0; color: #8a847d;">Servicio</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${service || "-"}</td></tr>
            <tr><td style="padding: 6px 0; color: #8a847d;">Barbero</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${barber || "-"}</td></tr>
            <tr><td style="padding: 6px 0; color: #8a847d;">Fecha</td><td style="padding: 6px 0; text-align: right; font-weight: 600; text-transform: capitalize;">${prettyDate}</td></tr>
            <tr><td style="padding: 6px 0; color: #8a847d;">Hora</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${prettyTime}</td></tr>
            ${prettyPrice ? `<tr><td style="padding: 6px 0; color: #8a847d;">Precio</td><td style="padding: 6px 0; text-align: right; font-weight: 600;">${prettyPrice}</td></tr>` : ""}
          </table>
          <div style="text-align: center; margin: 26px 0 6px;">
            <a href="${SITE_URL}/cuenta" style="display: inline-block; background: #d9b158; color: #1c1a17; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 28px; border-radius: 999px;">Ver o gestionar mi reserva</a>
          </div>
          <p style="margin: 14px 0 0; color: #8a847d; font-size: 12px; text-align: center;">Puedes cancelar o cambiar la hora desde ahí, con al menos 10 horas de anticipación.</p>
        </div>
      </div>
    </div>
  `.trim()

  return sendViaResend({ to, subject: "Tu reserva en Brunetticutz está confirmada", html })
}

/* Tarjeta de fidelidad: le manda al cliente su link personal /tarjeta?t=…
   El correo NO lleva el .pkpass adjunto a propósito — ese archivo solo sirve
   en iPhone, y el link resuelve las dos plataformas con un mismo mensaje: al
   abrirlo desde el celular aparece un único botón, Apple Wallet o Google
   Wallet según el teléfono. */
export async function sendLoyaltyCardEmail({ to, name, url, stars = 0 }) {
  const first = String(name || "").trim().split(" ")[0] || ""
  const saldo = stars > 0
    ? `Ya llevas <strong>${stars} ${stars === 1 ? "estrella" : "estrellas"}</strong>${stars >= 10 ? " — tu próximo corte va gratis." : `, te faltan ${10 - stars} para el corte gratis.`}`
    : "Se te suma la primera estrella con tu próximo corte."

  const html = `
    <div style="font-family: Georgia, 'Times New Roman', serif; background: #f7f3ea; padding: 32px 16px;">
      <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e7e0d1;">
        <div style="background: #16130f; padding: 24px; text-align: center;">
          <img src="${LOGO_URL}" alt="Brunetticutz" width="220" style="width: 220px; max-width: 70%; height: auto; display: inline-block;" />
        </div>
        <div style="padding: 28px 24px;">
          <h1 style="margin: 0 0 4px; font-size: 20px; color: #1c1a17;">Tu tarjeta de fidelidad${first ? `, ${first}` : ""}</h1>
          <p style="margin: 0 0 18px; color: #4a453d; font-size: 14px; line-height: 1.6;">
            Cada corte suma una estrella. A las 5 tienes 30% de descuento en productos, y a las 10 tu corte va gratis. ${saldo}
          </p>
          <div style="text-align: center; margin: 24px 0 10px;">
            <a href="${url}" style="display: inline-block; background: #d9b158; color: #1c1a17; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 30px; border-radius: 999px;">Agregar mi tarjeta al celular</a>
          </div>
          <p style="margin: 0 0 18px; color: #8a847d; font-size: 12px; text-align: center; line-height: 1.6;">
            Ábrelo desde tu teléfono: se agrega a Apple Wallet si tienes iPhone, o a Google Wallet si tienes Android.
            Se actualiza sola cada vez que te cortas el pelo, sin instalar ninguna app.
          </p>
          <p style="margin: 0; padding-top: 14px; border-top: 1px solid #eee6d8; color: #a49c90; font-size: 11px; text-align: center; line-height: 1.6;">
            La tarjeta la compartimos con Pimp Studio: tus estrellas suman y se canjean en los dos locales.
          </p>
        </div>
      </div>
    </div>
  `.trim()

  return sendViaResend({ to, subject: `${first ? `${first}, tu` : "Tu"} tarjeta de fidelidad de Brunetticutz`, html })
}


/* ============================================================
   WORKSHOP — cascarón responsive compartido
   ------------------------------------------------------------
   Se arma con tablas y un documento HTML completo (viewport +
   media queries) porque el layout anterior era de <div>: en
   pantallas de teléfono la etiqueta y el valor de cada fila
   quedaban en la misma línea, se pisaban y el texto se montaba.
   Bajo 480px cada fila pasa a apilarse (etiqueta arriba, valor
   abajo) y el ancho fijo se suelta a 100%.
   ============================================================ */
const PURPLE = "#8838d8"
const PURPLE_DP = "#6b28b8"
const INK = "#211a2b"
const MUTED = "#7c7391"

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || ""
}

/* Fila etiqueta/valor. En móvil se apila (ver .r-l/.r-v en el <style>). */
function wkRow(label, value, { strong = false } = {}) {
  if (value == null || value === "") return ""
  return `
    <tr>
      <td class="r-l" style="padding: 11px 0; border-bottom: 1px solid #efe9f7; color: ${MUTED}; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; vertical-align: top;">${esc(label)}</td>
      <td class="r-v" style="padding: 11px 0; border-bottom: 1px solid #efe9f7; text-align: right; color: ${INK}; font-size: ${strong ? "16px" : "15px"}; font-weight: 700; word-break: break-word; vertical-align: top;">${value}</td>
    </tr>`
}

function wkButton(href, text, { solid = true } = {}) {
  return `<a class="btn" href="${href}" style="display: inline-block; background: ${solid ? PURPLE : "#ffffff"}; border: 2px solid ${PURPLE}; color: ${solid ? "#ffffff" : PURPLE_DP}; text-decoration: none; font-weight: 700; font-size: 15px; padding: 13px 26px; border-radius: 999px;">${text}</a>`
}

/* Bloque "cómo llegar": mapa + dirección + botón a Google Maps. */
function wkLocationBlock() {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 26px 0 0; border-collapse: separate; border-radius: 14px; overflow: hidden; border: 1px solid #e6dcf2;">
      <tr>
        <td style="padding: 0; line-height: 0;">
          <a href="${WK.mapsUrl}">
            <img src="${WORKSHOP_MAP_URL}" alt="Mapa: ${esc(WK.address)}, ${esc(WK.city)}" width="600" style="width: 100%; max-width: 600px; height: auto; display: block; border: 0;" />
          </a>
        </td>
      </tr>
      <tr>
        <td class="px" style="padding: 18px 22px 22px; background: #faf7fe; text-align: center;">
          <p style="margin: 0 0 2px; font-size: 16px; font-weight: 700; color: ${INK};">${esc(WK.address)}</p>
          <p style="margin: 0 0 16px; font-size: 13px; color: ${MUTED};">${esc(WK.city)} · ${esc(WK.hint)}</p>
          ${wkButton(WK.mapsUrl, "Cómo llegar &rarr;", { solid: false })}
        </td>
      </tr>
    </table>`
}

function wkShell({ preheader, kicker, body }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<style>
  body { margin: 0; padding: 0; width: 100% !important; background: #f4f0f9; -webkit-text-size-adjust: 100%; }
  img { border: 0; outline: none; -ms-interpolation-mode: bicubic; }
  @media only screen and (max-width: 480px) {
    .sh { width: 100% !important; max-width: 100% !important; }
    .px { padding-left: 20px !important; padding-right: 20px !important; }
    .r-l, .r-v {
      display: block !important; width: 100% !important;
      text-align: left !important; white-space: normal !important;
      border-bottom: 0 !important;
    }
    .r-l { padding: 12px 0 0 !important; font-size: 12px !important; }
    .r-v { padding: 2px 0 12px !important; border-bottom: 1px solid #efe9f7 !important; }
    .h1 { font-size: 22px !important; }
    .btn { display: block !important; text-align: center !important; }
  }
</style>
</head>
<body style="margin: 0; padding: 0; background: #f4f0f9;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent; font-size: 1px; line-height: 1px;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f4f0f9;">
    <tr>
      <td align="center" style="padding: 28px 12px;">
        <table role="presentation" class="sh" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 600px; max-width: 600px; background: #ffffff; border-radius: 18px; overflow: hidden; border: 1px solid #e6dcf2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
          <tr>
            <td class="px" align="center" style="background: #0b0b0a; padding: 30px 24px 24px;">
              <img src="${WORKSHOP_LOGO_URL}" alt="Brunetticutz" width="220" style="width: 220px; max-width: 68%; height: auto; display: block; margin: 0 auto;" />
              <p style="margin: 14px 0 0; font-size: 11px; letter-spacing: 0.34em; text-transform: uppercase; color: #b483f3; font-weight: 700;">${esc(kicker)}</p>
            </td>
          </tr>
          <tr><td class="px" style="padding: 30px 30px 32px;">${body}</td></tr>
          <tr>
            <td class="px" align="center" style="background: #0b0b0a; padding: 24px;">
              <p style="margin: 0 0 12px; font-size: 10px; letter-spacing: 0.28em; text-transform: uppercase; color: #65635d;">Producido junto a</p>
              <img src="${ASCENSION_LOGO_URL}" alt="Ascensión" width="86" style="width: 86px; height: auto; display: block; margin: 0 auto 18px;" />
              <a href="https://wa.me/${WK.whatsapp}" style="color: #b483f3; text-decoration: none; font-size: 14px; font-weight: 700;">Escríbenos por WhatsApp</a>
              <p style="margin: 12px 0 0; font-size: 12px; color: #65635d; line-height: 1.6;">${esc(WK.address)} · ${esc(WK.city)}<br />brunetticutz.cl</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/* ============================================================
   1) WORKSHOP · CUPO CONFIRMADO
   Se manda cuando la persona TIENE cupo: pagó por Mercado Pago
   (amount + paymentId) o el barbero la inscribió a mano desde el
   panel (sin monto). Si hay monto, el correo lo dice — antes este
   mismo texto afirmaba "sin pago en este paso" incluso a quien
   acababa de pagar.
   ============================================================ */
export async function sendWorkshopConfirmationEmail({ to, name, edition, amount, paymentId }) {
  const first = firstName(name)
  const paid = Number(amount) > 0
  const prettyAmount = paid ? formatCLP(Number(amount)) : null

  const intro = paid
    ? "Recibimos tu pago y tu cupo quedó confirmado. Guarda este correo: acá está la fecha, la hora y cómo llegar."
    : "Tu cupo quedó reservado. Guarda este correo: acá está la fecha, la hora y cómo llegar."

  const body = `
    ${paid ? `<p style="margin: 0 0 14px;"><span style="display: inline-block; background: #f3e8ff; color: ${PURPLE_DP}; font-size: 11px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; padding: 7px 14px; border-radius: 999px;">Pago recibido</span></p>` : ""}
    <h1 class="h1" style="margin: 0 0 8px; font-size: 26px; line-height: 1.2; color: ${INK};">¡Nos vemos en el Workshop${first ? `, ${esc(first)}` : ""}!</h1>
    <p style="margin: 0 0 22px; color: #55506b; font-size: 15px; line-height: 1.65;">${intro}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
      ${wkRow("Edición", esc(edition || "Por confirmar"), { strong: true })}
      ${wkRow("Hora", `${esc(WK.time)}<br /><span style="font-weight: 400; font-size: 13px; color: ${MUTED};">${esc(WK.arrive)}</span>`, { strong: true })}
      ${wkRow("Lugar", `${esc(WK.address)}<br /><span style="font-weight: 400; font-size: 13px; color: ${MUTED};">${esc(WK.city)}</span>`)}
      ${paid ? wkRow("Pagado", esc(prettyAmount)) : ""}
      ${paid && paymentId ? wkRow("N° de operación", `<span style="font-weight: 400; font-size: 13px; color: ${MUTED};">${esc(paymentId)}</span>`) : ""}
    </table>

    ${wkLocationBlock()}

    <p style="margin: 26px 0 0; text-align: center; font-size: 14px; color: ${MUTED}; line-height: 1.6;">
      ¿Te surge cualquier duda antes del día? Respóndenos este correo o escríbenos por WhatsApp.
    </p>`

  return sendViaResend({
    to,
    subject: first ? `${first}, tu cupo en el Workshop está confirmado` : "Tu cupo en el Workshop de Brunetticutz está confirmado",
    html: wkShell({
      preheader: `${edition ? `${edition} · ` : ""}${WK.time} · ${WK.address}, ${WK.city}`,
      kicker: "Workshop · Cupo confirmado",
      body,
    }),
  })
}

/* ============================================================
   2) WORKSHOP · LISTA DE ESPERA
   Sin pago y sin cupo asignado: acá sí corresponde decir que no
   hay cobro en este paso. No lleva mapa ni horario, porque
   todavía no hay fecha que ir a buscar.
   ============================================================ */
export async function sendWorkshopWaitlistEmail({ to, name }) {
  const first = firstName(name)
  const body = `
    <h1 class="h1" style="margin: 0 0 8px; font-size: 26px; line-height: 1.2; color: ${INK};">Quedaste en la lista${first ? `, ${esc(first)}` : ""}</h1>
    <p style="margin: 0 0 18px; color: #55506b; font-size: 15px; line-height: 1.65;">
      Anotamos tus datos para la próxima edición del Workshop. <strong>No hay ningún cobro en este paso</strong>: apenas
      confirmemos la fecha te escribimos primero a ti, antes de abrir los cupos al público.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
      ${wkRow("Estado", "En lista de espera", { strong: true })}
      ${wkRow("Cupo", `<span style="font-weight: 400; font-size: 14px; color: ${MUTED};">Se confirma al pagar, cuando abramos la edición</span>`)}
    </table>
    <p style="margin: 26px 0 0; text-align: center;">${wkButton(`${SITE_URL}/workshop`, "Ver el Workshop")}</p>
    <p style="margin: 18px 0 0; text-align: center; font-size: 14px; color: ${MUTED}; line-height: 1.6;">
      Si quieres adelantarte o tienes dudas, escríbenos por WhatsApp.
    </p>`

  return sendViaResend({
    to,
    subject: first ? `${first}, quedaste en la lista de espera del Workshop` : "Quedaste en la lista de espera del Workshop",
    html: wkShell({
      preheader: "Te avisamos apenas confirmemos la próxima edición.",
      kicker: "Workshop · Lista de espera",
      body,
    }),
  })
}

/* ============================================================
   3) WORKSHOP · DETALLES DEL DÍA (ubicación y horario)
   Para quienes ya pagaron y se inscribieron antes de que el
   correo de confirmación incluyera esta información.
   `whenLabel` es opcional ("Mañana", "Este sábado"…).
   ============================================================ */
export async function sendWorkshopDetailsEmail({ to, name, edition, whenLabel }) {
  const first = firstName(name)
  const body = `
    <h1 class="h1" style="margin: 0 0 8px; font-size: 26px; line-height: 1.2; color: ${INK};">Todo listo${first ? `, ${esc(first)}` : ""}</h1>
    <p style="margin: 0 0 22px; color: #55506b; font-size: 15px; line-height: 1.65;">
      Tu cupo en el Workshop está confirmado${whenLabel ? ` y ${esc(String(whenLabel).toLowerCase())} nos vemos` : ""}. Te dejamos la
      información práctica del día para que llegues sin buscar nada.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
      ${wkRow("Fecha", esc(edition || "Por confirmar"), { strong: true })}
      ${wkRow("Comenzamos", `${esc(WK.time)}<br /><span style="font-weight: 400; font-size: 13px; color: ${MUTED};">${esc(WK.arrive)}</span>`, { strong: true })}
      ${wkRow("Lugar", `${esc(WK.address)}<br /><span style="font-weight: 400; font-size: 13px; color: ${MUTED};">${esc(WK.city)} · ${esc(WK.hint)}</span>`)}
    </table>

    ${wkLocationBlock()}

    <p style="margin: 26px 0 0; text-align: center; font-size: 14px; color: ${MUTED}; line-height: 1.6;">
      Si se te complica llegar o necesitas avisarnos algo, escríbenos por WhatsApp — te respondemos al tiro.
    </p>`

  return sendViaResend({
    to,
    subject: first
      ? `${first}, acá va todo para el Workshop · ${WK.time} · ${WK.address}`
      : `Detalles del Workshop · ${WK.time} · ${WK.address}`,
    html: wkShell({
      preheader: `${edition ? `${edition} · ` : ""}${WK.time} · ${WK.address}, ${WK.city}`,
      kicker: "Workshop · Detalles del día",
      body,
    }),
  })
}
