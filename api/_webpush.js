/* PIMP STUDIO — Envío Web Push compartido (panel + Academy)
   ------------------------------------------------------------------
   Sale de api/push.js para que la Academy pueda mandar push a sus miembros
   (api/_academyPush.js) sin importar push.js entero: push.js arrastra
   _loyalty, _googleWallet y APNs, y _loyaltyBridge/_complete ya importan de
   push.js — cualquier import nuevo hacia allá desde el código de la Academy
   abría un ciclo. Por eso este archivo NO importa nada del proyecto (mismo
   criterio que api/_bridge.js) salvo api/_academyHost.js, que son datos
   puros del sitio sin imports: solo el paquete `web-push` y las VAPID. Es
   parte del set portable de la Academy (docs/academy/PORTABLE.md).

   El comportamiento para los barberos es EXACTAMENTE el de antes (ver
   notifyBarber/notifyAll en push.js): mismo import memoizado, mismas VAPID,
   mismo payload serializado con JSON.stringify, misma limpieza en 404/410 y
   mismos mensajes de log.

   No es una función serverless (prefijo `_`): Vercel Hobby topa a 12.
   ================================================================ */

import { HOST } from "./_academyHost.js"

let webpushModule = null

/* Remitente VAPID por defecto si no hay VAPID_SUBJECT: el contacto del
   dominio del sitio (mailto:contacto@pimpstudio.cl). */
function defaultVapidSubject() {
  try {
    return `mailto:contacto@${new URL(HOST.defaultSiteUrl).hostname.replace(/^www\./, "")}`
  } catch {
    return "mailto:contacto@localhost"
  }
}

/* Módulo `web-push` ya configurado con las VAPID, o null si falta algo.
   Memoizado por instancia tibia, igual que antes vivía en push.js: el import
   dinámico y setVapidDetails se pagan una vez, no por cada aviso. Si faltan
   las claves NO se memoiza el null, para que un deploy que las agrega no
   quede pegado a la instancia vieja. */
export async function getWebPush() {
  if (webpushModule) return webpushModule
  try {
    const mod = await import("web-push")
    const webpush = mod.default || mod
    const pub = process.env.VAPID_PUBLIC_KEY
    const priv = process.env.VAPID_PRIVATE_KEY
    if (pub && priv) {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || defaultVapidSubject(), pub, priv)
      webpushModule = webpush
      return webpush
    }
    console.error("getWebPush: VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY ausentes")
  } catch (err) {
    console.error("getWebPush import error:", err?.message)
  }
  return null
}

/* Manda `payload` a cada fila { id, endpoint, p256dh, auth } en paralelo.

   - `onGone(row)` se llama cuando el servicio de push contesta 404/410 (la
     suscripción murió: PWA reinstalada, permiso revocado, endpoint rotado):
     quien llama sabe de qué tabla borrarla (push_subscriptions del barbero o
     academy_push_subscriptions del miembro). Un fallo de onGone se traga, como
     el `.catch(() => {})` que tenía el DELETE original.
   - `label` solo cambia el prefijo del log, para que los mensajes de error del
     panel sigan diciendo "notifyBarber …" / "notifyAll …" como siempre.

   Nunca lanza por un envío individual: un endpoint roto no corta al resto.
   Devuelve { sent, gone, failed, configured }. */
export async function sendToSubscriptions(rows, payload, onGone, { label = "webpush" } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const webpush = await getWebPush()
  if (!webpush) return { sent: 0, gone: 0, failed: 0, configured: false }

  const body = typeof payload === "string" ? payload : JSON.stringify(payload)
  let sent = 0
  let gone = 0
  let failed = 0
  await Promise.all(list.map(async (s) => {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }
    try {
      await webpush.sendNotification(subscription, body)
      sent++
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        gone++
        if (typeof onGone === "function") {
          try { await onGone(s) } catch { /* igual que el DELETE original: best-effort */ }
        }
      } else {
        failed++
        console.error(`${label} sendNotification error:`, err?.statusCode, err?.body || err?.message)
      }
    }
  }))
  return { sent, gone, failed, configured: true }
}
