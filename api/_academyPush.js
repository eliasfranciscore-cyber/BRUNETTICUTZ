/* PIMP STUDIO — Push a miembros de la Academy
   ------------------------------------------------------------------
   pushToMembers(sql, memberIds, { title, body, url, tag }) manda un Web Push a
   las suscripciones de esos miembros (academy_push_subscriptions). Lo usan
   _academyNotify.js (avisos in-app que además suenan en el teléfono) y
   _academyChat.js (mensajes de chat, que NO dejan fila de notificación).

   Tabla aparte de push_subscriptions (la del panel) a propósito: esa tiene
   barber_id y todo lo que la lee trata la fila como "avisos de reservas de un
   barbero". Un mismo teléfono puede estar en las dos tablas con el MISMO
   endpoint (una sola suscripción por navegador, ver src/push.js) y está bien:
   el service worker enruta el toque según la `url` del payload.

   Nunca lanza: un aviso que no sale no puede tumbar el mensaje, el
   comentario o el pago que lo disparó.
   ================================================================ */

import { getWebPush, sendToSubscriptions } from "./_webpush.js"
import { HOST } from "./_academyHost.js"

// Misma validación que aplica public/sw.js al tocar la notificación: ruta
// relativa, caracteres seguros y sin `//` (que sería una URL a otro host).
// Además tiene que ser de la Academy (HOST.basePath, p. ej. /academy): un
// push de miembro nunca abre /panel.
const URL_RE = /^\/[A-Za-z0-9/_\-?=&%.]*$/
const TAG_RE = /^[A-Za-z0-9:_\-]{1,64}$/
const BASE = HOST.basePath
const BASE_RE = new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\/|\\?|$)`)

function cleanUrl(u) {
  const s = String(u || "")
  if (s.length <= 300 && URL_RE.test(s) && !s.includes("//") && BASE_RE.test(s)) return s
  return `${BASE}/comunidad`
}

// El payload viaja cifrado pero se muestra en la pantalla bloqueada: texto
// plano, sin controles, corto (iOS corta ~4 KB y en la práctica muestra
// ~180 caracteres).
function clip(s, max) {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export async function pushToMembers(sql, memberIds, payload = {}) {
  try {
    const list = Array.isArray(memberIds) ? memberIds : [memberIds]
    const ids = [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 2000)
    if (!ids.length) return { ok: true, sent: 0 }

    // Sin VAPID no se consulta la tabla (mismo orden que notifyBarber).
    const webpush = await getWebPush()
    if (!webpush) return { ok: false, sent: 0, reason: "not-configured" }

    // Solo miembros activos (un cancelado o expulsado no recibe nada aunque
    // su fila siga ahí) y con el push general encendido en Ajustes. Los
    // interruptores por tipo (likes, comentarios…) los aplica notifyMany antes
    // de llamar acá; este es el interruptor maestro.
    const rows = await sql`
      SELECT s.id, s.endpoint, s.p256dh, s.auth
      FROM academy_push_subscriptions s
      JOIN academy_members m ON m.id = s.member_id
      WHERE s.member_id = ANY(${ids}::int[])
        AND m.status = 'activo'
        AND m.deleted_at IS NULL
        AND COALESCE(m.prefs->'notif'->>'push', 'true') <> 'false'
    `
    if (!rows.length) return { ok: true, sent: 0 }

    const clean = {
      title: clip(payload.title, 80) || HOST.brand.name,
      // Nunca vacío: el service worker rellena un body vacío con el texto de
      // "nueva reserva" del panel.
      body: clip(payload.body, 180) || `Tienes novedades en la ${HOST.brand.short}`,
      url: cleanUrl(payload.url),
      tag: TAG_RE.test(String(payload.tag || "")) ? String(payload.tag) : "aca",
    }
    const r = await sendToSubscriptions(
      rows,
      clean,
      (row) => sql`DELETE FROM academy_push_subscriptions WHERE id = ${row.id}`.catch(() => {}),
      { label: "pushToMembers" },
    )
    return { ok: true, sent: r.sent, gone: r.gone }
  } catch (err) {
    console.error("pushToMembers error:", err?.message || err)
    return { ok: false, sent: 0 }
  }
}
