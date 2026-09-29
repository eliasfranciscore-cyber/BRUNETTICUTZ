/* ACADEMY — Mercado Pago (Checkout Pro) por REST, sin SDK
   ------------------------------------------------------------------
   Cliente propio de la Academy (antes usaba api/_mercadopago.js, que sigue
   siendo el de Essentials) para que el módulo se pueda llevar tal cual a
   otro sitio: la URL del webhook, la página de vuelta y el texto de la
   cartola salen de api/_academyHost.js. La firma del webhook NO vive acá:
   la valida el checkout del host (su propio endpoint), que después le pasa
   el pago ya consultado a handleAcademyPayment (api/_academyProvision.js).

   Con tope de 8 s por llamada: Mercado Pago espera 22 s la respuesta de un
   webhook, y un fetch sin signal no se rinde nunca. 8 s deja margen para la
   consulta del pago + la base + el correo dentro de esos 22.
   Prefijo `_`: no cuenta como función serverless. */

import { HOST, siteUrl } from "./_academyHost.js"

const API = "https://api.mercadopago.com"
const MP_TIMEOUT_MS = 8000

export const mpConfigured = () => Boolean(process.env.MP_ACCESS_TOKEN)

/* A dónde avisa Mercado Pago y a dónde vuelve el cliente, según el host. */
export const notificationUrl = () => `${siteUrl()}${HOST.mpNotificationPath}`
export const backUrlFor = (ref) => `${siteUrl()}${HOST.basePath}/gracias?ref=${encodeURIComponent(String(ref))}`

async function mpFetch(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(MP_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = body?.message || body?.error || res.statusText
    throw new Error(`Mercado Pago ${res.status}: ${detail}`)
  }
  return body
}

/* Solo se manda lo que es válido: un correo mal escrito haría que Mercado
   Pago rechace la preferencia entera, y eso sería peor que no precargar. */
const PAYER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
function payerFor(payer) {
  if (!payer || typeof payer !== "object") return null
  const out = {}
  const name = String(payer.name || "").trim().slice(0, 80)
  const email = String(payer.email || "").trim()
  if (name) out.name = name
  if (email && email.length <= 120 && PAYER_EMAIL_RE.test(email)) out.email = email
  return Object.keys(out).length ? out : null
}

/* Crea la preferencia y devuelve { preferenceId, initPoint }. `items` viaja
   con los precios que ya validó el servidor contra la base, nunca con los
   del navegador. backUrl, notificationUrl y statementDescriptor salen del
   host si no se pasan. */
export async function createPreference({ ref, items, payer, backUrl, notificationUrl: notifyUrl, metadata, statementDescriptor }) {
  const back = backUrl || backUrlFor(ref)
  const body = {
    items: (items || []).map((i) => ({
      id: String(i.productId),
      title: i.name,
      quantity: Number(i.qty),
      unit_price: Number(i.unitPrice),
      currency_id: "CLP",
    })),
    // El vínculo entre el pago de allá y la orden de acá: el ref público
    // aleatorio, no el id correlativo.
    external_reference: String(ref),
    back_urls: { success: back, pending: back, failure: back },
    auto_return: "approved",
    notification_url: notifyUrl || notificationUrl(),
    statement_descriptor: String(statementDescriptor || HOST.statementDescriptor),
  }
  const payerBody = payerFor(payer)
  if (payerBody) body.payer = payerBody
  if (metadata && typeof metadata === "object") body.metadata = metadata
  const pref = await mpFetch("/checkout/preferences", { method: "POST", body: JSON.stringify(body) })
  return { preferenceId: pref.id, initPoint: pref.init_point || pref.sandbox_init_point }
}

export const fetchPayment = (paymentId) => mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`)

/* Pagos de una orden, del más nuevo al más viejo ([] si no hay). Es la otra
   mitad de la conciliación: Mercado Pago reintenta el webhook cada 15 min
   pero la firma vale 10, así que un aviso que recibió un 500 puede no
   volver nunca. `timeoutMs` acorta el tope cuando quien llama tiene su
   propio presupuesto (el cron). */
export async function searchPayments(externalReference, { timeoutMs } = {}) {
  const qs = new URLSearchParams({
    external_reference: String(externalReference),
    sort: "date_created",
    criteria: "desc",
  })
  const ms = Number(timeoutMs)
  const init = Number.isFinite(ms) && ms > 0 ? { signal: AbortSignal.timeout(Math.min(ms, MP_TIMEOUT_MS)) } : {}
  const body = await mpFetch(`/v1/payments/search?${qs.toString()}`, init)
  return Array.isArray(body?.results) ? body.results : []
}
