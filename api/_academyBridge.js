/* ACADEMY — Modos del puente entre los dos sitios (auth 'peer')
   ------------------------------------------------------------------
   Solo los llama el OTRO sitio de la Academy, servidor a servidor, con el
   secreto del puente (api/_academyPeer.js; el router responde 404 sin él).
   La base ya es la misma para los dos: esto es únicamente lo que depende de
   las llaves de ESTE sitio.

     bridge-push          { memberIds, payload:{title, body, path, tag} }
                          → { sent }. Manda el aviso a las suscripciones de
                          ESTE sitio (sus VAPID); la ruta llega relativa a la
                          Academy y acá se le pone el basePath propio. Nunca
                          reenvía de vuelta.
     bridge-verify-order  { ref } → { result:{ found, action, status } }.
                          Concilia la orden con el Mercado Pago de ESTE sitio
                          (el botón "Verificar pago" del panel del otro).

   Prefijo `_`: no cuenta como función serverless. */

import { HttpError } from "./_academyHttp.js"
import { pushToMembers, pathToUrl } from "./_academyPush.js"

const REF_RE = /^aca-[a-f0-9]{32}$/
const isDbError = (err) => typeof err?.code === "string" && /^[0-9A-Z]{5}$/.test(err.code)

async function bridgePush(ctx) {
  const { sql, body } = ctx
  const ids = [...new Set((Array.isArray(body.memberIds) ? body.memberIds : []).map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 2000)
  if (!ids.length) return { sent: 0 }
  const p = body.payload && typeof body.payload === "object" ? body.payload : {}
  const r = await pushToMembers(sql, ids, {
    title: p.title,
    body: p.body,
    url: pathToUrl(p.path),
    tag: p.tag,
  }, { forward: false })
  return { sent: Number(r?.sent) || 0 }
}

async function bridgeVerifyOrder(ctx) {
  const ref = String(ctx.body?.ref ?? "").trim()
  if (!REF_RE.test(ref)) throw new HttpError(400, "Referencia de pedido inválida.")
  const { reconcileOrder } = await import("./_academyProvision.js")
  let r
  try {
    r = await reconcileOrder(ctx.sql, ref, { timeoutMs: 6500 })
  } catch (err) {
    if (isDbError(err)) throw err
    console.error("[academy:bridge-verify-order] Mercado Pago:", err?.status || "", err?.message || err)
    throw new HttpError(502, "No pudimos consultar Mercado Pago.", "mp_error")
  }
  if (!r?.found) throw new HttpError(404, "Pedido no encontrado", "not_found")
  if (r.action === "sin_mercadopago") throw new HttpError(503, "Mercado Pago no está configurado en ese servidor.", "mp_not_configured")
  // Nunca rebota: una orden "del otro sitio" vista desde acá sería de quien
  // llamó, y él ya sabe que no la puede consultar.
  if (r.action === "otro_sitio") throw new HttpError(409, "Ese pedido no se cobró en este sitio.", "otro_sitio")
  return { result: { found: true, action: r.action || null, ignored: r.ignored || null, status: r.status || null } }
}

/* Nombres EXACTOS de MODE_OWNERS en api/_academy.js. */
export const handlers = {
  "bridge-push": bridgePush,
  "bridge-verify-order": bridgeVerifyOrder,
}
