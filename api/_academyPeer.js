/* ACADEMY — Puente entre los dos sitios de la Academy
   ------------------------------------------------------------------
   Con la base compartida (api/_academyDb.js) casi todo es de los dos sitios
   a la vez. Quedan dos cosas que solo puede hacer el sitio donde nacieron:

     - Push: una suscripción Web Push queda atada a las VAPID y al service
       worker del sitio donde se creó. Un aviso para un teléfono suscrito en
       el otro sitio lo tiene que mandar el otro sitio (modo bridge-push).
     - Pagos: una orden se cobra con el Mercado Pago del sitio donde se creó y
       solo ese sitio puede consultar el pago ("Verificar pago" del panel →
       modo bridge-verify-order).

   Servidor a servidor, con el mismo secreto del puente de reservas y
   fidelidad (PIMPSTUDIO_BRIDGE_SECRET, mismo valor en los dos Vercel, header
   X-Bridge-Secret) y la URL del otro sitio de HOST.peer. Sin secreto o sin
   peer no hay puente: cada sitio atiende solo lo suyo. Un modo bridge-* sin
   el secreto correcto responde 404, igual que los del puente de reservas.

   Nunca lanza: callPeer devuelve { ok, status, reason, data }.
   Prefijo `_`: no cuenta como función serverless. */

import crypto from "node:crypto"
import { HOST } from "./_academyHost.js"

const secret = () => String(process.env.PIMPSTUDIO_BRIDGE_SECRET || "")

export const PEER = HOST.peer?.key || null

/* Origen del otro sitio (https://brunetticutz.cl), o "" si no hay uno válido.
   Solo https: el secreto viaja en un header. */
function peerOrigin() {
  try {
    const raw = typeof HOST.peer?.apiBase === "function" ? HOST.peer.apiBase() : HOST.peer?.apiBase
    const u = new URL(String(raw || ""))
    if (u.protocol !== "https:" || u.username || u.password) return ""
    return u.origin
  } catch {
    return ""
  }
}

/* "brunetticutz.cl" para mostrar en el panel de qué sitio es algo. */
export function siteLabel(key) {
  const host = (url) => {
    try { return new URL(String(url || "")).hostname.replace(/^www\./, "") } catch { return "" }
  }
  if (!key || key === HOST.key) return host(HOST.defaultSiteUrl) || HOST.key
  if (key === PEER) return host(typeof HOST.peer?.apiBase === "function" ? HOST.peer.apiBase() : HOST.peer?.apiBase) || String(key)
  return String(key)
}

export function peerConfigured() {
  return Boolean(PEER && secret() && peerOrigin())
}

/* Comparación en tiempo constante sobre los SHA-256 (mismo patrón que
   api/_bridge.js): ni el tiempo de respuesta ni el largo filtran el secreto. */
export function isPeerRequest(req) {
  const s = secret()
  if (!s) return false
  const key = req?.headers?.["x-bridge-secret"]
  if (typeof key !== "string" || !key) return false
  const given = crypto.createHash("sha256").update(key).digest()
  const expected = crypto.createHash("sha256").update(s).digest()
  return crypto.timingSafeEqual(given, expected)
}

let injectedFetch = null
/* Solo tests: reemplaza el fetch hacia el otro sitio. Sin argumentos restaura. */
export function __setTestDeps({ fetch } = {}) {
  injectedFetch = typeof fetch === "function" ? fetch : null
}

/* POST <otro sitio>/api/academy?mode=<mode> con el secreto del puente. */
export async function callPeer(mode, body = {}, { timeoutMs = 6000 } = {}) {
  if (!/^bridge-[a-z-]{1,40}$/.test(String(mode))) return { ok: false, status: 0, reason: "modo-invalido" }
  if (!peerConfigured() && !injectedFetch) return { ok: false, status: 0, reason: "sin-puente" }
  const doFetch = injectedFetch || fetch
  try {
    const r = await doFetch(`${peerOrigin() || "https://peer.invalid"}/api/academy?mode=${mode}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Secret": secret(),
        "X-Academy-Site": HOST.key,
      },
      body: JSON.stringify(body || {}),
      redirect: "error",
      signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 6000)),
    })
    const data = await r.json().catch(() => null)
    if (!r.ok || !data || data.ok !== true) {
      return { ok: false, status: r.status, reason: data?.code || "error-del-otro-sitio", data }
    }
    return { ok: true, status: r.status, reason: null, data }
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError"
    console.error(`[academy:peer] ${mode}:`, timedOut ? "timeout" : err?.message || err)
    return { ok: false, status: 0, reason: timedOut ? "timeout" : "red" }
  }
}
