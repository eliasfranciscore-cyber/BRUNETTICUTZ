/* BRUNETTI — Puente de fidelidad hacia PimpStudio (pimpstudio.cl)
   ------------------------------------------------------------------
   Brunetti NO tiene programa de puntos propio: usa el de PimpStudio. Las
   estrellas, los pases de Apple/Google Wallet y el registro de dispositivos
   viven en la base de datos de PimpStudio, que es la fuente de verdad para
   los clientes de los dos negocios (se cruzan por teléfono).

   Este archivo es el ÚNICO punto del proyecto que habla con esa API — igual
   que api/bruno-agenda.js allá es el único que habla con esta. Todo pasa por
   acá para que el navegador del cliente nunca llame a otro origen (evita
   CORS/CSP y que su teléfono viaje en una URL de otro dominio).

   Contraparte: api/_loyaltyBridge.js + los modos `bridge-*` de
   api/clients.js y api/push.js en el proyecto PimpStudio.

   No es una función serverless (prefijo `_`): Vercel Hobby tope 12 funciones
   y este proyecto ya está en el tope (ver CLAUDE.md).

   REGLA DE ORO: todo lo de acá es best-effort. Si pimpstudio.cl no responde,
   se registra el error y la operación local sigue como si nada — una reserva
   nunca se cae, ni el panel se rompe, porque la fidelidad no esté disponible.
   ================================================================ */

const BASE = (process.env.PIMPSTUDIO_API_BASE || "https://pimpstudio.cl").replace(/\/$/, "")
const SECRET = process.env.PIMPSTUDIO_BRIDGE_SECRET || ""
const TIMEOUT_MS = 6000

export function isLoyaltyBridgeConfigured() {
  return Boolean(SECRET)
}

/* Sin AbortController, una lambda puede quedarse esperando hasta el tope de
   Vercel por algo que es accesorio al pedido del usuario. */
async function bridgeFetch(path, { method = "GET", body, ip, raw = false } = {}) {
  if (!SECRET) return { status: 503, data: { ok: false, error: "Puente de fidelidad no configurado" } }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Secret": SECRET,
        // El IP real se pierde si no se reenvía a propósito: fetch() no copia
        // los headers entrantes, y sin esto el rate limit de PimpStudio vería
        // siempre la IP saliente de esta función.
        ...(ip ? { "X-Forwarded-For": ip } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (raw) {
      const buffer = Buffer.from(await res.arrayBuffer())
      return { status: res.status, buffer, contentType: res.headers.get("content-type") || "" }
    }
    const data = await res.json().catch(() => ({}))
    return { status: res.status, data }
  } catch (err) {
    console.error("loyalty bridge fetch error:", path, err?.name === "AbortError" ? "timeout" : err?.message || err)
    return { status: 504, data: { ok: false, error: "La fidelidad no está disponible en este momento" } }
  } finally {
    clearTimeout(timer)
  }
}

/* Identificador estable del evento puente. El id es el de ESTA base de datos
   (la reserva vive acá), y PimpStudio lo guarda en loyalty_events.bridge_ref
   con un índice único: dos llamadas por la misma reserva suman una sola
   estrella, venga el doble-tap del panel de acá o del de PimpStudio. */
export function bookingRef(bookingId) {
  return `brunetti:${Number(bookingId)}`
}

/* +1 estrella al completar un servicio. Todas las reservas de brunetticutz.cl
   suman, sin importar el barbero. */
export async function creditStar({ bookingId, phone, name, ip }) {
  const { status, data } = await bridgeFetch("/api/clients?mode=bridge-loyalty-earn", {
    method: "POST", ip, body: { ref: bookingRef(bookingId), phone, name },
  })
  if (status >= 400) return { ok: false, error: data?.error }
  return { ok: true, earned: Boolean(data?.earned), loyalty: data?.loyalty || null }
}

/* La reserva dejó de estar completada (corrección de estado o cancelación):
   se devuelve la estrella. */
export async function revertStar({ bookingId, ip }) {
  const { status, data } = await bridgeFetch("/api/clients?mode=bridge-loyalty-revert", {
    method: "POST", ip, body: { ref: bookingRef(bookingId) },
  })
  if (status >= 400) return { ok: false, error: data?.error }
  return { ok: true, reverted: Boolean(data?.reverted), loyalty: data?.loyalty || null }
}

/* Canje del corte gratis. Devuelve el status real de PimpStudio para que el
   panel distinga "le faltan estrellas" (422) de "ya canjeada" (409) de una
   caída del puente (504). */
export async function redeemFreeCut({ bookingId, phone, name, ip }) {
  const { status, data } = await bridgeFetch("/api/clients?mode=bridge-redeem", {
    method: "POST", ip,
    body: { ref: bookingRef(bookingId), phone, name, note: "Corte gratis canjeado desde el panel de BrunettiCutz" },
  })
  return { status, ok: status < 400 && data?.ok !== false, error: data?.error, loyalty: data?.loyalty || null }
}

/* Compensación cuando el débito salió bien pero acá no se pudo dejar la
   reserva en $0: sin esto el cliente perdería 10 estrellas sin corte gratis. */
export async function cancelRedeem({ bookingId, ip }) {
  return bridgeFetch("/api/clients?mode=bridge-redeem-cancel", {
    method: "POST", ip, body: { ref: bookingRef(bookingId) },
  })
}

/* Saldo de un cliente (cuenta del cliente, popup de instalación). */
export async function loyaltyFor(phone, ip) {
  const { status, data } = await bridgeFetch(`/api/clients?mode=bridge-loyalty&phone=${encodeURIComponent(phone || "")}`, { ip })
  if (status >= 400) return null
  return { loyalty: data?.loyalty || null, hasPass: Boolean(data?.hasPass) }
}

/* Saldos de toda la lista de clientes del panel en una sola llamada. */
export async function loyaltyForPhones(phones, ip) {
  const { status, data } = await bridgeFetch("/api/clients?mode=bridge-loyalty-bulk", {
    method: "POST", ip, body: { phones },
  })
  if (status >= 400) return {}
  return data?.byPhone || {}
}

/* Token del link personal /tarjeta?t=… Con él se pide el pase sin que el
   teléfono del cliente aparezca nunca en una URL. */
export async function shareToken({ phone, name, ip }) {
  const qs = new URLSearchParams({ phone: String(phone || "") })
  if (name) qs.set("name", String(name))
  const { status, data } = await bridgeFetch(`/api/clients?mode=bridge-share-token&${qs.toString()}`, { ip })
  if (status >= 400 || !data?.token) return { ok: false, status, error: data?.error || "No se pudo generar la tarjeta" }
  return { ok: true, token: data.token, name: data.name }
}

/* Descarga el .pkpass ya firmado desde PimpStudio para reenviarlo tal cual.
   Se baja por token (no por teléfono) y se sirve desde brunetticutz.cl: en
   iOS, Safari abre el pase directo cuando la navegación es del mismo origen
   que la página. */
export async function applePassBytes(token, ip) {
  return bridgeFetch(`/api/clients?mode=wallet-pass&t=${encodeURIComponent(token)}`, { ip, raw: true })
}

/* Android: no hay archivo, hay un link firmado que devuelve la API. */
export async function googleSaveURL(token, ip) {
  const { status, data } = await bridgeFetch(`/api/clients?mode=wallet-pass-google&t=${encodeURIComponent(token)}`, { ip })
  if (status >= 400 || !data?.saveUrl) return { ok: false, status, error: data?.error || "No se pudo generar el pase" }
  return { ok: true, saveUrl: data.saveUrl }
}

/* Resuelve el token del link personal a { name } para el saludo de /tarjeta.
   El teléfono NUNCA vuelve en esta respuesta: el token es justo lo que evita
   que el número quede escrito en el historial de WhatsApp o del navegador. */
export async function tarjetaInfo(token, ip) {
  const { status, data } = await bridgeFetch(`/api/clients?mode=wallet-tarjeta-info&t=${encodeURIComponent(token)}`, { ip })
  if (status >= 400 || !data?.ok) return { ok: false, status, error: data?.error || "Link inválido o vencido" }
  return { ok: true, name: data.name }
}

/* Métricas y campañas de la pestaña Marketing — las mismas que ve el panel de
   PimpStudio: el programa de puntos es uno solo. */
export async function walletStats(ip) {
  const { status, data } = await bridgeFetch("/api/clients?mode=bridge-stats", { ip })
  if (status >= 400) return null
  return data?.stats || null
}

export async function walletCampaigns(ip) {
  const { status, data } = await bridgeFetch("/api/push?mode=bridge-campaigns", { ip })
  if (status >= 400) return []
  return data?.campaigns || []
}

export async function sendWalletCampaign({ message, audience, ip }) {
  const { status, data } = await bridgeFetch("/api/push?mode=bridge-campaign", {
    method: "POST", ip, body: { message, audience },
  })
  return { status, data }
}
