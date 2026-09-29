/* ACADEMY — Router de /api/academy?mode=…
   ------------------------------------------------------------------
   vercel.json reescribe /api/academy → /api/services?scope=academy y
   services.js llega acá con un import() dinámico: si algo de la Academy no
   carga, el catálogo de servicios de /reservar y el webhook de Mercado Pago
   siguen andando. No es una función serverless nueva (prefijo `_`): el
   proyecto está en 11/12 del plan Hobby.

   Cada modo declara quién lo puede llamar (`auth`), con qué método, y en qué
   archivo vive. Los módulos se cargan con import() LITERAL por archivo: el
   empaquetador de Vercel solo sigue imports con un string fijo, y así cada
   request carga únicamente el archivo de su modo.

   auth:
     public      sin sesión
     member      miembro activo, contraseña ya creada
     member-pwc  miembro activo, admite el token de "crea tu contraseña"
     moderator   miembro propietario/admin/moderador, o barbero admin
     admin       miembro propietario/admin, o barbero admin
     owner       SOLO barbero admin del panel (owner-session)
   La verificación del barbero es del host (requireBarberAdmin de
   api/_academyHost.js → { barberId, name, email }): este archivo no conoce
   las sesiones del panel.

   Contrato con los handlers (`export const handlers = { 'modo': fn }`):
     ctx = { sql, req, res, query, body, member, admin, barber, ip }
     - devuelven un objeto → 200 { ok:true, ...objeto }, Cache-Control
       private, no-store. Solo un modo PÚBLICO puede pedir caché de CDN con
       { __cache: 'public, s-maxage=300, …' } (se quita de la respuesta).
     - lanzan new HttpError(status, mensaje, code?, extra?) → { ok:false,
       error, code, ...extra }.
     - si ya escribieron la respuesta (un stream, un archivo) devuelven
       undefined y el router no toca nada.
     - cualquier otro error → log "[academy:<modo>]" + 500 "Error interno".
   ensureAcademyTables() lo corre ESTE router antes de `me` y de todo modo
   admin/moderator/owner; los handlers nunca lo llaman. */

import { neon } from "@neondatabase/serverless"
import { requireBarberAdmin } from "./_academyHost.js"
import { clientIp } from "./_academyLimits.js"
import { HttpError, pgCode } from "./_academyHttp.js"
import { requireMember, requireAcademyAdmin, requireModerator } from "./_academyAuth.js"
import { ensureAcademyTables } from "./_academySchema.js"

const account = () => import("./_academyAccount.js")
const courses = () => import("./_academyCourses.js")
const community = () => import("./_academyCommunity.js")
const notifyMod = () => import("./_academyNotify.js")
const chat = () => import("./_academyChat.js")
const events = () => import("./_academyEvents.js")
const adminMod = () => import("./_academyAdmin.js")

const GET = ["GET"]
const POST = ["POST"]
const m = (load, auth, methods) => Object.freeze({ load, auth, methods })

/* SPEC §5 y §16. Agregar un modo = agregar una línea acá Y el handler en su
   archivo con exactamente el mismo nombre. */
export const MODE_OWNERS = Object.freeze({
  // Cuenta — _academyAccount.js
  "login": m(account, "public", POST),
  "password-change": m(account, "member-pwc", POST),
  "password-reset-request": m(account, "public", POST),
  "password-reset-confirm": m(account, "public", POST),
  "me": m(account, "member-pwc", GET),
  "me-update": m(account, "member", POST),
  "email-change": m(account, "member", POST),
  "email-change-confirm": m(account, "public", POST),
  "logout-all": m(account, "member-pwc", POST),
  "me-export": m(account, "member", GET),
  "me-delete": m(account, "member", POST),
  "about": m(account, "public", GET),
  "owner-session": m(account, "owner", POST),
  "idle": m(account, "member", POST),

  // Cursos — _academyCourses.js
  "courses": m(courses, "member", GET),
  "course": m(courses, "member", GET),
  "lesson": m(courses, "member", GET),
  "lesson-progress": m(courses, "member", POST),
  "catalog": m(courses, "public", GET),
  "admin-courses": m(courses, "admin", GET),
  "admin-course-save": m(courses, "admin", POST),
  "admin-course-delete": m(courses, "admin", POST),
  "admin-section-save": m(courses, "admin", POST),
  "admin-section-delete": m(courses, "admin", POST),
  "admin-lesson-save": m(courses, "admin", POST),
  "admin-lesson-delete": m(courses, "admin", POST),
  "admin-reorder": m(courses, "admin", POST),
  "admin-seed": m(courses, "admin", POST),
  "upload": m(courses, "member", POST),

  // Comunidad — _academyCommunity.js
  "feed": m(community, "member", GET),
  "post": m(community, "member", GET),
  "post-save": m(community, "member", POST),
  "post-delete": m(community, "member", POST),
  "comment-save": m(community, "member", POST),
  "comment-delete": m(community, "member", POST),
  "lesson-comments": m(community, "member", GET),
  "like": m(community, "member", POST),
  "poll-vote": m(community, "member", POST),
  "follow": m(community, "member", POST),
  "report": m(community, "member", POST),
  "members": m(community, "member", GET),
  "member": m(community, "member", GET),
  "leaderboard": m(community, "member", GET),
  "search": m(community, "member", GET),
  "group-card": m(community, "member", GET),
  "admin-category-save": m(community, "admin", POST),
  "admin-category-delete": m(community, "admin", POST),
  "admin-pin": m(community, "admin", POST),
  "admin-post-moderate": m(community, "moderator", POST),
  "admin-reports": m(community, "moderator", GET),
  "admin-report-resolve": m(community, "moderator", POST),

  // Notificaciones — _academyNotify.js
  "notifications": m(notifyMod, "member", GET),
  "notifications-read": m(notifyMod, "member", POST),

  // Chat, grupos, sync, push — _academyChat.js
  "chats": m(chat, "member", GET),
  "chat": m(chat, "member", GET),
  "chat-start": m(chat, "member", POST),
  "chat-send": m(chat, "member", POST),
  "chat-read": m(chat, "member", POST),
  "chats-read-all": m(chat, "member", POST),
  "chat-mute": m(chat, "member", POST),
  "chat-mark-unread": m(chat, "member", POST),
  "block": m(chat, "member", POST),
  "blocks": m(chat, "member", GET),
  "sync": m(chat, "member", GET),
  "push-subscribe": m(chat, "member", POST),
  "push-unsubscribe": m(chat, "member-pwc", POST),
  "cohorts": m(chat, "member", GET),
  "cohort": m(chat, "member", GET),
  "file": m(chat, "member", GET),
  "admin-cohort-save": m(chat, "admin", POST),
  "admin-cohort-members": m(chat, "admin", POST),
  "admin-cohort-archive": m(chat, "admin", POST),

  // Eventos — _academyEvents.js
  "events": m(events, "member", GET),
  "event": m(events, "member", GET),
  "admin-event-save": m(events, "moderator", POST),
  "admin-event-delete": m(events, "moderator", POST),

  // Administración y pagos — _academyAdmin.js
  "admin-members": m(adminMod, "admin", GET),
  "admin-invite": m(adminMod, "admin", POST),
  "admin-member-update": m(adminMod, "admin", POST),
  "admin-resend-access": m(adminMod, "admin", POST),
  "admin-password-link": m(adminMod, "admin", POST),
  "admin-grant": m(adminMod, "admin", POST),
  "admin-revoke": m(adminMod, "admin", POST),
  "admin-orders": m(adminMod, "admin", GET),
  "admin-verify-order": m(adminMod, "admin", POST),
  "admin-import-grant": m(adminMod, "admin", POST),
  "admin-settings": m(adminMod, "admin", ["GET", "POST"]),
  "admin-stats": m(adminMod, "admin", GET),
})

// Modos que disparan ensureAcademyTables antes del handler.
const ENSURE_AUTH = new Set(["admin", "moderator", "owner"])
const ENSURE_MODES = new Set(["me"])

/* Solo tests (scripts/test-academy): `sql` reemplaza al cliente de Neon.
   Sin argumentos vuelve al real. */
let sqlOverride = null
export function __setTestDeps({ sql } = {}) {
  sqlOverride = sql || null
}

function reply(res, status, body, cache = "private, no-store") {
  if (res.headersSent || res.writableEnded) return
  res.setHeader("Cache-Control", cache)
  res.status(status).json(body)
}

/* Vercel parsea el JSON cuando el Content-Type es application/json; un
   `fetch(..., { keepalive: true })` o un sendBeacon a veces llega como
   texto. Se acepta solo un objeto plano: un arreglo o un número como body
   no le sirven a ningún handler y los obligaría a defenderse de más. */
function parseBody(req) {
  let b = req.body
  if (typeof b === "string") {
    try { b = JSON.parse(b) } catch { b = null }
  } else if (Buffer.isBuffer(b)) {
    try { b = JSON.parse(b.toString("utf8")) } catch { b = null }
  }
  return b && typeof b === "object" && !Array.isArray(b) ? b : {}
}

/* Traducción de errores de Postgres que no atrapó el handler. El texto del
   error de la base NUNCA va al cliente (trae nombres de tablas y valores). */
function mapDbError(err) {
  switch (pgCode(err)) {
    case "42P01": // tabla inexistente
    case "42703": // columna inexistente
      return [503, "La Academy todavía se está preparando. Intenta de nuevo en un momento.", "not_ready"]
    case "23505":
      return [409, "Eso ya existe.", "conflict"]
    case "23503":
      return [409, "Lo que intentas vincular ya no existe.", "conflict"]
    case "23514":
    case "22P02":
    case "22003":
    case "22001":
      return [400, "Datos inválidos.", "invalid"]
    case "40001":
    case "40P01":
      return [503, "Hubo un choque con otra operación. Intenta de nuevo.", "retry"]
    default:
      return null
  }
}

export async function handleAcademy(req, res) {
  const mode = String(req.query?.mode || "")
  // hasOwn: que "__proto__" o "constructor" no se lean como modos.
  const entry = Object.prototype.hasOwnProperty.call(MODE_OWNERS, mode) ? MODE_OWNERS[mode] : null
  if (!entry) return reply(res, 404, { ok: false, error: "Modo no reconocido" })
  if (!entry.methods.includes(req.method)) {
    res.setHeader("Allow", entry.methods.join(", "))
    return reply(res, 405, { ok: false, error: "Método no permitido" })
  }

  let sql = sqlOverride
  if (!sql) {
    if (!process.env.DATABASE_URL) return reply(res, 503, { ok: false, error: "La Academy no está disponible en este momento.", code: "unavailable" })
    try {
      sql = neon(process.env.DATABASE_URL)
    } catch (err) {
      console.error("[academy] neon():", err?.message || err)
      return reply(res, 503, { ok: false, error: "La Academy no está disponible en este momento.", code: "unavailable" })
    }
  }

  const ctx = {
    sql,
    req,
    res,
    query: req.query || {},
    body: req.method === "GET" ? {} : parseBody(req),
    member: null,
    admin: null,
    barber: null,
    ip: clientIp(req),
    mode,
  }

  try {
    /* Autenticación ANTES del ensure: un request sin token válido se corta
       sin tocar la base (ni despertar a Neon). La ruta de barbero no
       necesita las tablas de la Academy para verificarse. */
    switch (entry.auth) {
      case "public":
        break
      case "member":
      case "member-pwc": {
        const member = await requireMember(sql, req, res, { allowPwc: entry.auth === "member-pwc" })
        if (!member) return
        ctx.member = member
        break
      }
      case "admin":
      case "moderator": {
        const admin = entry.auth === "admin" ? await requireAcademyAdmin(sql, req, res) : await requireModerator(sql, req, res)
        if (!admin) return
        ctx.admin = { memberId: admin.memberId, barberId: admin.barberId, role: admin.role }
        ctx.member = admin.member || null
        ctx.barber = admin.barber || null
        break
      }
      case "owner": {
        // requireBarberAdmin ya rechaza los tokens de barbero sin `exp`
        // (emitidos antes de que existiera y que no vencen nunca): uno de
        // esos, filtrado, no debe poder abrir la Academy como propietario.
        const barber = await requireBarberAdmin(sql, req, res)
        if (!barber) return
        ctx.barber = barber
        ctx.admin = { memberId: null, barberId: barber.barberId, role: "propietario" }
        break
      }
      default:
        return reply(res, 500, { ok: false, error: "Error interno" })
    }

    if (ENSURE_AUTH.has(entry.auth) || ENSURE_MODES.has(mode)) {
      try {
        await ensureAcademyTables(sql)
      } catch (err) {
        // No se corta: si las tablas ya estaban (lo normal), el modo anda
        // igual; si faltan, su consulta dará 42P01 y se traduce abajo.
        console.error(`[academy:${mode}] ensureAcademyTables:`, err?.code || err?.message || err)
      }
    }

    let mod
    try {
      mod = await entry.load()
    } catch (err) {
      console.error(`[academy:${mode}] no cargó el módulo:`, err?.message || err)
      return reply(res, 503, { ok: false, error: "Esta sección de la Academy no está disponible.", code: "unavailable" })
    }
    const fn = mod?.handlers?.[mode]
    if (typeof fn !== "function") {
      console.error(`[academy:${mode}] el módulo no exporta el handler`)
      return reply(res, 501, { ok: false, error: "Esta sección de la Academy todavía no está lista.", code: "not_implemented" })
    }

    const result = await fn(ctx)
    if (res.headersSent || res.writableEnded) return
    const out = result && typeof result === "object" && !Array.isArray(result) ? { ...result } : {}
    let cache = "private, no-store"
    if (typeof out.__cache === "string" && entry.auth === "public") cache = out.__cache
    delete out.__cache
    delete out.ok
    return reply(res, 200, { ok: true, ...out }, cache)
  } catch (err) {
    if (res.headersSent || res.writableEnded) {
      console.error(`[academy:${mode}] error después de responder:`, err?.message || err)
      return
    }
    if (err instanceof HttpError || err?.name === "HttpError") {
      const body = { ok: false, error: err.message || "Error", ...(err.code ? { code: err.code } : {}), ...(err.extra || {}) }
      const retry = Number(err.extra?.retryAfter)
      if (Number.isFinite(retry) && retry > 0) res.setHeader("Retry-After", String(Math.ceil(retry)))
      return reply(res, Number(err.status) || 500, body)
    }
    const mapped = mapDbError(err)
    if (mapped) {
      console.error(`[academy:${mode}] db:`, err?.code, err?.message)
      return reply(res, mapped[0], { ok: false, error: mapped[1], code: mapped[2] })
    }
    console.error(`[academy:${mode}]`, err?.stack || err?.message || err)
    return reply(res, 500, { ok: false, error: "Error interno" })
  }
}
