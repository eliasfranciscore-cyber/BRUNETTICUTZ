/* ACADEMY — Administración: miembros, accesos, pedidos y ajustes
   ------------------------------------------------------------------
   Modos admin-* del router (api/_academy.js, SPEC §5.6). Todos llegan con
   ctx.admin = { memberId|null, barberId|null, role:'propietario'|'admin' }
   ya verificado (miembro propietario/admin, o barbero admin del panel) y con
   ensureAcademyTables ya corrido por el router: acá nunca hay DDL.

   Lo que CONCEDE acceso (invitar, dar un curso, importar un comprador de
   BrunettiCutz) no se escribe acá: se delega en _academyProvision.js
   (provisionManualGrant / claimAndSendCredentials / revokeGrant), el único
   archivo que convierte algo en acceso. Si el acceso se concediera en dos
   lugares, tarde o temprano se concedería distinto (la misma lección que el
   "escritor único" de estrellas de CLAUDE.md).

   Reglas de roles (SPEC §5.6), las decide el SERVIDOR aunque el front ya
   esconda los botones:
     - rol y correo de una cuenta: solo el propietario los cambia;
     - nadie asigna 'propietario' (hay uno, lo crea owner-session);
     - un admin no toca filas de propietario ni de otro admin;
     - la cuenta del propietario no se modifica desde acá, y nadie se
       modifica a sí mismo (para eso está Ajustes de la Academy).
   Expulsar = banned_at + session_version+1 (cierra todas sus sesiones al
   instante) + borrar sus suscripciones push, y opcionalmente ocultar lo que
   publicó en los últimos 7 días.

   Prefijo `_`: no cuenta como función serverless (tope 12 del plan Hobby). */

import { HttpError, getSettings, mergeSettings, invalidateSettings, intParam, boolParam, pageParam, isAdminRole } from "./_academyHttp.js"
import { safeUrl, isImageUrl, parseYouTubeId, cleanText, cleanLine } from "./_academyText.js"
import { generateResetToken } from "./_academyPassword.js"
import { rateLimit } from "./_academyLimits.js"
import { sendAcademyEmail, academyEmailsToday, sendAcademyResetEmail } from "./_academyEmail.js"
import { HOST, siteUrl } from "./_academyHost.js"
import { SITE } from "./_academyDb.js"
import { callPeer, siteLabel } from "./_academyPeer.js"
import {
  provisionManualGrant, claimAndSendCredentials, rearmCredentials, revokeGrant, reconcileOrder,
  memberAdminRows, loadMemberAdmin, normEmail, isValidEmail, cleanName,
} from "./_academyProvision.js"

/* ── Constantes ─────────────────────────────────────────────────────────── */

// Páginas de la Academy en este sitio (https://pimpstudio.cl/academy).
const academyUrl = () => `${siteUrl()}${HOST.basePath}`
const PAGE_SIZE = 30
// Exportar CSV trae todo sin paginar; el tope es solo un freno de seguridad
// para que un listado gigante no deje colgada la función.
const CSV_MAX = 5000
// Mismo vencimiento que el "olvidé mi contraseña" público: la hoja de
// miembro del front dice "vence en 30 minutos".
const RESET_TTL_MIN = 30
const MEMBER_STATUSES = ["activo", "cancelado", "expulsado"]
const ASSIGNABLE_ROLES = ["admin", "moderador", "miembro"]
const ORDER_STATUSES = ["pendiente", "pagada", "revision", "reembolsada", "anulada"]
const REF_RE = /^aca-[a-f0-9]{32}$/
// Referencia de importación ('brunetti:mp:123'): la llave de idempotencia.
const EXT_REF_RE = /^[A-Za-z0-9:_.-]{3,120}$/
const MAX_COURSES_PER_INVITE = 20
const UPLOAD_GLOBAL_FALLBACK = 1200

const isPlainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v)
const toId = (v) => intParam(v)
const bad = (message, code = "invalid") => new HttpError(400, message, code)
const hasValue = (v) => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")

// SQLSTATE de Postgres (5 caracteres). Sirve para distinguir un error de la
// base (que el router traduce) de uno de red con Mercado Pago o Resend.
const isDbError = (err) => typeof err?.code === "string" && /^[0-9A-Z]{5}$/.test(err.code)

const isOwnerActor = (ctx) => ctx.admin?.role === "propietario"
// Llave de cuota por persona: el miembro admin, o el barbero si entró con
// su sesión del panel sin fila de miembro.
const actorKey = (ctx) => (ctx.admin?.memberId ? `m${ctx.admin.memberId}` : `b${ctx.admin?.barberId || 0}`)

const ISO = (v) => v || null

/* Cuota diaria por administrador. rateLimit falla ABIERTO si la tabla no
   responde: una invitación legítima no debe caerse por el limitador. */
async function limitActor(ctx, prefix, max, windowSeconds = 86400, message) {
  const ok = await rateLimit(ctx.sql, `${prefix}:${actorKey(ctx)}`, { max, windowSeconds })
  if (!ok) throw new HttpError(429, message, "rate_limited", { retryAfter: Math.min(windowSeconds, 3600) })
}

/* La fila sobre la que se actúa, con lo que hace falta para decidir
   permisos y armar correos. `courses` = títulos de sus cursos activos (para
   el correo de credenciales). */
async function loadTarget(sql, id) {
  if (!id) return null
  const [row] = await sql`
    SELECT m.id, m.role, m.status, m.name, m.email, m.email_norm,
           (m.password_set_at IS NOT NULL) AS password_set,
           (m.deleted_at IS NOT NULL) AS deleted,
           (SELECT string_agg(c.title, ', ' ORDER BY g.id)
              FROM academy_grants g JOIN academy_courses c ON c.id = g.course_id
             WHERE g.member_id = m.id AND g.state = 'activa') AS courses
    FROM academy_members m
    WHERE m.id = ${id}
  `
  if (!row || row.deleted) return null
  return { ...row, id: Number(row.id) }
}

/* Acciones que no cambian la fila pero sí actúan sobre la cuenta (reenviar
   acceso, mandar enlace de contraseña, quitar un curso): sobre filas de
   propietario/admin solo las hace el propietario. */
function assertCanActOn(ctx, target) {
  if (isAdminRole(target.role) && !isOwnerActor(ctx)) {
    throw new HttpError(403, "Solo el propietario puede gestionar la cuenta de un administrador.", "forbidden")
  }
}

/* ── admin-members ─────────────────────────────────────────────────────────
   GET {status?, q?, courseId?, cohortId?, all?=1, page?}
   → { members:[MemberAdmin], total, counts, page, pages }
   all=1 → sin paginar (para el CSV). Las cuentas borradas por su dueño
   (me-delete, anonimizadas) no se listan: ya no queda nada de esa persona. */
async function adminMembers(ctx) {
  const { sql, query } = ctx
  const status = MEMBER_STATUSES.includes(query.status) ? query.status : null
  const q = cleanLine(query.q, 80)
  const pattern = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null
  const courseId = toId(query.courseId)
  const cohortId = toId(query.cohortId)
  const all = boolParam(query.all)
  const page = all ? 1 : pageParam(query.page)
  const limit = all ? CSV_MAX : PAGE_SIZE
  const offset = all ? 0 : (page - 1) * PAGE_SIZE

  // Una sola ida a la base: filtro + página + totales por estado.
  const [row] = await sql`
    WITH f AS (
      SELECT m.id, m.joined_at
      FROM academy_members m
      WHERE m.deleted_at IS NULL
        AND (${status}::text IS NULL OR m.status = ${status}::text)
        AND (${pattern}::text IS NULL
             OR m.name ILIKE ${pattern}::text ESCAPE '\\'
             OR m.email_norm ILIKE ${pattern}::text ESCAPE '\\'
             OR m.handle ILIKE ${pattern}::text ESCAPE '\\')
        AND (${courseId}::int IS NULL OR EXISTS (
              SELECT 1 FROM academy_grants g
              WHERE g.member_id = m.id AND g.course_id = ${courseId}::int AND g.state = 'activa'))
        AND (${cohortId}::int IS NULL OR EXISTS (
              SELECT 1 FROM academy_cohort_members cm
              WHERE cm.member_id = m.id AND cm.cohort_id = ${cohortId}::int))
    ), pg AS (
      SELECT id, joined_at FROM f ORDER BY joined_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}
    ), c AS (
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'activo')::int AS activo,
             count(*) FILTER (WHERE status = 'cancelado')::int AS cancelado,
             count(*) FILTER (WHERE status = 'expulsado')::int AS expulsado,
             count(*) FILTER (WHERE status = 'activo' AND role <> 'propietario' AND password_set_at IS NULL)::int AS pendientes
      FROM academy_members
      WHERE deleted_at IS NULL
    )
    SELECT (SELECT count(*)::int FROM f) AS filtered,
           COALESCE((SELECT array_agg(id ORDER BY joined_at DESC, id DESC) FROM pg), '{}'::int[]) AS ids,
           c.total, c.activo, c.cancelado, c.expulsado, c.pendientes
    FROM c
  `
  const ids = (row?.ids || []).map(Number)
  const map = await memberAdminRows(sql, ids)
  const members = ids.map((id) => map.get(id)).filter(Boolean)
  const total = Number(row?.filtered) || 0
  const counts = {
    total: Number(row?.total) || 0,
    activo: Number(row?.activo) || 0,
    cancelado: Number(row?.cancelado) || 0,
    expulsado: Number(row?.expulsado) || 0,
    pendientes: Number(row?.pendientes) || 0,
  }
  return {
    members,
    total,
    counts,
    page,
    pages: all ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE)),
    ...(all && total > CSV_MAX ? { truncated: true } : {}),
  }
}

/* ── Validación compartida de altas manuales ───────────────────────────── */

function parsePerson(body) {
  const name = cleanName(body.name)
  if (!name) throw bad("Escribe el nombre.")
  if (name.length > 80) throw bad("El nombre puede tener hasta 80 caracteres.")
  const email = String(body.email ?? "").trim()
  if (!isValidEmail(email)) throw bad("Escribe un correo válido.")
  return { name, email, emailNorm: normEmail(email) }
}

function parseCourseIds(v) {
  if (!Array.isArray(v)) return []
  const ids = [...new Set(v.map(toId))]
  if (ids.some((id) => !id)) throw bad("Uno de los cursos no es válido.")
  if (ids.length > MAX_COURSES_PER_INVITE) throw bad(`Máximo ${MAX_COURSES_PER_INVITE} cursos por invitación.`)
  return ids
}

/* Que los cursos (y el grupo, si viene) existan, y que el correo no sea de
   alguien expulsado — provisionManualGrant confía en que quien lo llama ya
   rechazó ese caso. Todo en una consulta. */
async function precheckGrant(sql, { courseIds, cohortId = null, emailNorm }) {
  const [row] = await sql`
    SELECT (SELECT count(*)::int FROM academy_courses WHERE id = ANY(${courseIds}::int[])) AS courses,
           (SELECT count(*)::int FROM academy_cohorts WHERE id = ${cohortId}::int AND archived_at IS NULL) AS cohort,
           (SELECT status FROM academy_members WHERE email_norm = ${emailNorm}) AS member_status
  `
  if ((Number(row?.courses) || 0) !== courseIds.length) throw new HttpError(404, "Uno de los cursos ya no existe.", "not_found")
  if (cohortId && !Number(row?.cohort)) throw new HttpError(404, "Ese grupo no existe o está archivado.", "not_found")
  if (row?.member_status === "expulsado") {
    throw new HttpError(409, "Ese correo pertenece a un miembro expulsado. Reactívalo primero si quieres darle acceso.", "expulsado")
  }
}

/* ── admin-invite ──────────────────────────────────────────────────────────
   POST {name, email, courseIds:[int], cohortId?}
   → { member: MemberAdmin, created, credentials, granted }
   Se exige al menos un curso: sin un grant activo claimAndSendCredentials
   no manda nada (SPEC §6.4) y la invitación quedaría como una cuenta a la
   que nadie puede entrar. */
async function adminInvite(ctx) {
  const { sql, body } = ctx
  const person = parsePerson(body)
  const courseIds = parseCourseIds(body.courseIds)
  if (!courseIds.length) throw bad("Elige al menos un curso: el acceso a la Academy viene con un curso.", "courses_required")
  const cohortId = hasValue(body.cohortId) ? toId(body.cohortId) : null
  if (hasValue(body.cohortId) && !cohortId) throw bad("Ese grupo no es válido.")

  await precheckGrant(sql, { courseIds, cohortId, emailNorm: person.emailNorm })
  // La cuota va después de validar: un formulario mal llenado no la gasta.
  await limitActor(ctx, "aca-invite", 10, 86400, "Llegaste al límite de 10 invitaciones por día. Vuelve a intentarlo mañana.")

  const r = await provisionManualGrant(sql, {
    name: person.name, email: person.email, courseIds, cohortId, source: "invitacion", actor: ctx.admin,
  })
  return { member: r.member, created: Boolean(r.created), credentials: r.credentials, granted: r.granted || [] }
}

/* ── admin-import-grant ────────────────────────────────────────────────────
   POST {name, email, courseId, externalRef?} — compradores de BrunettiCutz
   (u otro alta manual con referencia). Con externalRef es idempotente: la
   misma referencia dos veces no crea dos accesos, aunque venga con otro
   correo (esa referencia ya se usó; no se regala un segundo acceso). */
async function adminImportGrant(ctx) {
  const { sql, body } = ctx
  const person = parsePerson(body)
  const courseId = toId(body.courseId)
  if (!courseId) throw bad("Elige un curso.")
  let externalRef = null
  if (hasValue(body.externalRef)) {
    externalRef = String(body.externalRef).trim()
    if (!EXT_REF_RE.test(externalRef)) throw bad("La referencia externa no es válida (letras, números y : _ . -).")
  }

  if (externalRef) {
    const [dup] = await sql`SELECT member_id FROM academy_grants WHERE external_ref = ${externalRef}`
    if (dup) {
      return { member: await loadMemberAdmin(sql, dup.member_id), created: false, credentials: "no_aplica", granted: [], duplicate: true }
    }
  }
  await precheckGrant(sql, { courseIds: [courseId], emailNorm: person.emailNorm })
  // Más holgada que la de invitaciones: importar la lista de compradores de
  // BrunettiCutz son decenas de filas de una vez. El correo igual lo frena
  // el presupuesto diario de _academyEmail.js.
  await limitActor(ctx, "aca-import", 40, 86400, "Llegaste al límite de 40 importaciones por día. Sigue mañana.")

  const r = await provisionManualGrant(sql, {
    name: person.name, email: person.email, courseIds: [courseId],
    source: externalRef ? "puente" : "manual", externalRef, actor: ctx.admin,
  })
  return { member: r.member, created: Boolean(r.created), credentials: r.credentials, granted: r.granted || [], duplicate: false }
}

/* ── admin-member-update ───────────────────────────────────────────────────
   POST {id, role?, status?, purgeRecent?, email?} → { member, purged?, credentials? } */
async function adminMemberUpdate(ctx) {
  const { sql, body } = ctx
  const id = toId(body.id)
  if (!id) throw bad("Falta el miembro.")
  const wantsRole = hasValue(body.role)
  const wantsStatus = hasValue(body.status)
  const wantsEmail = hasValue(body.email)
  if (!wantsRole && !wantsStatus && !wantsEmail) throw bad("No hay cambios que guardar.")

  if ((wantsRole || wantsEmail) && !isOwnerActor(ctx)) {
    throw new HttpError(403, "Solo el propietario puede cambiar roles o correos.", "forbidden")
  }
  if (wantsRole) {
    if (body.role === "propietario") throw bad("Nadie puede asignar el rol de propietario.")
    if (!ASSIGNABLE_ROLES.includes(body.role)) throw bad("Rol inválido.")
  }
  if (wantsStatus && !MEMBER_STATUSES.includes(body.status)) throw bad("Estado inválido.")
  let emailNorm = null
  if (wantsEmail) {
    if (!isValidEmail(body.email)) throw bad("Escribe un correo válido.")
    emailNorm = normEmail(body.email)
  }

  const target = await loadTarget(sql, id)
  if (!target) throw new HttpError(404, "Miembro no encontrado", "not_found")
  if (target.role === "propietario") throw new HttpError(403, "La cuenta del propietario no se puede modificar desde acá.", "forbidden")
  if (ctx.admin?.memberId && Number(ctx.admin.memberId) === target.id) {
    throw bad("No puedes cambiar tu propia cuenta desde acá. Usa Ajustes de la Academy.", "self")
  }
  if (isAdminRole(target.role) && !isOwnerActor(ctx)) {
    throw new HttpError(403, "Solo el propietario puede modificar a otro administrador.", "forbidden")
  }

  const newRole = wantsRole ? body.role : target.role
  const newStatus = wantsStatus ? body.status : target.status
  const statusChanged = newStatus !== target.status
  const out = {}

  if (statusChanged || newRole !== target.role) {
    // Pasar a cancelado/expulsado cierra todas sus sesiones (sv+1) y apaga
    // sus pushes; volver a 'activo' no toca la versión (no hay nada que
    // cerrar: requireMember ya lo rechazaba por el estado).
    const leaving = statusChanged && newStatus !== "activo"
    const ban = statusChanged && newStatus === "expulsado"
    const unban = statusChanged && target.status === "expulsado"
    /* El WHERE repite el rol y el estado que se revisaron arriba: si otro
       admin cambió la fila entre medio (p. ej. la subieron a admin), este
       UPDATE no calza y se responde 409 en vez de saltarse la regla. */
    const rows = await sql`
      WITH u AS (
        UPDATE academy_members
           SET role = ${newRole}, status = ${newStatus},
               banned_at = CASE WHEN ${ban}::boolean THEN NOW() WHEN ${unban}::boolean THEN NULL ELSE banned_at END,
               session_version = session_version + CASE WHEN ${leaving}::boolean THEN 1 ELSE 0 END,
               updated_at = NOW()
         WHERE id = ${id} AND role = ${target.role} AND status = ${target.status} AND deleted_at IS NULL
        RETURNING id
      ), p AS (
        DELETE FROM academy_push_subscriptions
         WHERE ${leaving}::boolean AND member_id IN (SELECT id FROM u)
        RETURNING 1
      )
      SELECT id FROM u
    `
    if (!rows.length) throw new HttpError(409, "El miembro cambió mientras tanto. Recarga e intenta de nuevo.", "stale")
  }

  if (wantsStatus && newStatus === "expulsado" && boolParam(body.purgeRecent)) {
    out.purged = await purgeRecent(sql, id)
  }

  if (wantsEmail && emailNorm !== target.email_norm) {
    out.credentials = await transferAccount(sql, id, { email: String(body.email).trim(), emailNorm })
  }

  return { member: await loadMemberAdmin(sql, id), ...out }
}

/* Cambio de correo por el dueño = traspaso de la cuenta (SPEC §6.6): la
   contraseña, los tokens pendientes y las sesiones de la persona anterior
   dejan de servir, y el correo nuevo recibe credenciales temporales. Una
   sola sentencia; el NOT EXISTS evita pisar el correo de otra cuenta (y el
   UNIQUE de email_norm cubre la carrera). */
async function transferAccount(sql, id, { email, emailNorm }) {
  let rows
  try {
    rows = await sql`
      WITH u AS (
        UPDATE academy_members
           SET email = ${email}, email_norm = ${emailNorm}, session_version = session_version + 1,
               password_hash = NULL, password_set_at = NULL, must_change_password = true,
               temp_password_expires_at = NULL, credentials_sent_at = NULL, credentials_claimed_at = NULL,
               credentials_attempts = 0, credentials_retry_at = NULL, updated_at = NOW()
         WHERE id = ${id} AND deleted_at IS NULL AND email_norm <> ${emailNorm}
           AND NOT EXISTS (SELECT 1 FROM academy_members x WHERE x.email_norm = ${emailNorm})
        RETURNING id,
                  (SELECT string_agg(c.title, ', ' ORDER BY g.id)
                     FROM academy_grants g JOIN academy_courses c ON c.id = g.course_id
                    WHERE g.member_id = academy_members.id AND g.state = 'activa') AS courses
      ), t AS (
        DELETE FROM academy_auth_tokens WHERE member_id IN (SELECT id FROM u) RETURNING 1
      ), p AS (
        DELETE FROM academy_push_subscriptions WHERE member_id IN (SELECT id FROM u) RETURNING 1
      )
      SELECT id, courses FROM u
    `
  } catch (err) {
    if (err?.code === "23505") throw new HttpError(409, "Ese correo ya lo usa otra cuenta de la Academy.", "email_taken")
    throw err
  }
  if (!rows.length) throw new HttpError(409, "Ese correo ya lo usa otra cuenta de la Academy.", "email_taken")
  try {
    return await claimAndSendCredentials(sql, id, { course: rows[0].courses || null })
  } catch (err) {
    // El traspaso ya quedó hecho; el cron reintenta las credenciales.
    console.error("[academy:admin-member-update] credenciales tras traspaso:", err?.code || err?.message || err)
    return "pendientes"
  }
}

/* Expulsión con limpieza: oculta (soft delete, como el borrado normal) lo
   que publicó y comentó en los últimos 7 días — el caso típico es alguien
   que entró a hacer spam. Mismo patrón que comment-delete: el contador del
   post y las notificaciones se tocan en la misma sentencia. Los posts van en
   otra sentencia porque un mismo post puede recibir las dos cosas (su
   contador y su borrado) y Postgres no aplica dos UPDATE a la misma fila en
   un solo WITH. */
async function purgeRecent(sql, id) {
  const [c] = await sql`
    WITH c AS (
      UPDATE academy_comments SET deleted_at = NOW(), updated_at = NOW()
       WHERE author_id = ${id} AND deleted_at IS NULL AND created_at > NOW() - interval '7 days'
      RETURNING id, post_id
    ), k AS (
      SELECT post_id, count(*)::int AS n FROM c WHERE post_id IS NOT NULL GROUP BY post_id
    ), u AS (
      UPDATE academy_posts p SET comment_count = GREATEST(p.comment_count - k.n, 0)
        FROM k WHERE p.id = k.post_id
      RETURNING p.id
    ), n AS (
      DELETE FROM academy_notifications WHERE target_type = 'comment' AND target_id IN (SELECT id FROM c)
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM c
  `
  const [p] = await sql`
    WITH p AS (
      UPDATE academy_posts SET deleted_at = NOW(), updated_at = NOW()
       WHERE author_id = ${id} AND deleted_at IS NULL AND created_at > NOW() - interval '7 days'
      RETURNING id
    ), n AS (
      DELETE FROM academy_notifications WHERE target_type = 'post' AND target_id IN (SELECT id FROM p)
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM p
  `
  return { posts: Number(p?.n) || 0, comments: Number(c?.n) || 0 }
}

/* ── Enlace para crear contraseña ──────────────────────────────────────────
   Mismo token que password-reset-request (academy_auth_tokens, purpose
   'reset', solo el hash guardado) y la misma página /academy/restablecer,
   que también activa una cuenta que nunca tuvo contraseña. Pedir uno nuevo
   anula los anteriores. Tipo de correo 'reset-admin': lo pide un admin con
   sesión, así que no gasta el tope de 20/día de los formularios públicos,
   pero sí el presupuesto general de la Academy. */
async function sendResetLink(ctx, target) {
  const { sql } = ctx
  // Freno por destinatario: dos clics nerviosos no deben llenarle la bandeja.
  const ok = await rateLimit(sql, `aca-admin-reset:${target.id}`, { max: 5, windowSeconds: 3600 })
  if (!ok) throw new HttpError(429, "Ya le mandaste varios enlaces en la última hora. Espera un rato.", "rate_limited", { retryAfter: 900 })

  const { token, tokenHash } = generateResetToken()
  await sql.transaction([
    sql`UPDATE academy_auth_tokens SET used_at = NOW() WHERE member_id = ${target.id} AND purpose = 'reset' AND used_at IS NULL`,
    sql`
      INSERT INTO academy_auth_tokens (token_hash, member_id, purpose, expires_at, requested_ip)
      VALUES (${tokenHash}, ${target.id}, 'reset', NOW() + make_interval(mins => ${RESET_TTL_MIN}::int), ${ctx.ip || null})
    `,
  ])
  const resetUrl = `${academyUrl()}/restablecer?token=${encodeURIComponent(token)}`
  const r = await sendAcademyEmail(sql, "reset-admin", sendAcademyResetEmail, {
    to: target.email, name: target.name, resetUrl, minutes: RESET_TTL_MIN,
  })
  if (r?.ok) return true
  if (r?.skipped) {
    // Seguro que no salió: el enlace se anula para no dejar uno vivo que
    // nadie recibió.
    await sql`UPDATE academy_auth_tokens SET used_at = NOW() WHERE token_hash = ${tokenHash}`.catch(() => {})
    throw new HttpError(429, "Se agotó el cupo de correos de la Academy por hoy. Intenta mañana.", "email_budget")
  }
  throw new HttpError(502, "No pudimos enviar el correo. Intenta de nuevo en un rato.", "email_failed")
}

/* ── admin-resend-access ───────────────────────────────────────────────────
   POST {id} → { credentials }
   - Nunca eligió contraseña → re-arme + credenciales temporales nuevas.
   - Ya tiene la suya → no se toca (comprar con el correo de otro no puede
     dejarlo afuera, y un admin tampoco): se le manda un enlace para crear
     una nueva, y credentials = 'cuenta_existente'.
   - Propietario, o alguien activo sin cursos (claim → 'no_aplica'): enlace. */
async function adminResendAccess(ctx) {
  const { sql, body } = ctx
  const target = await loadTarget(sql, toId(body.id))
  if (!target) throw new HttpError(404, "Miembro no encontrado", "not_found")
  assertCanActOn(ctx, target)
  if (target.status !== "activo") throw new HttpError(409, "Ese miembro no está activo. Reactívalo primero.", "inactivo")

  if (!target.password_set && target.role !== "propietario") {
    await rearmCredentials(sql, target.id)
    const credentials = await claimAndSendCredentials(sql, target.id, { course: target.courses || null })
    if (credentials !== "no_aplica") return { credentials }
  }
  await sendResetLink(ctx, target)
  return { credentials: "cuenta_existente", resetLink: true }
}

/* ── admin-password-link ─── POST {id} → {} */
async function adminPasswordLink(ctx) {
  const { sql, body } = ctx
  const target = await loadTarget(sql, toId(body.id))
  if (!target) throw new HttpError(404, "Miembro no encontrado", "not_found")
  assertCanActOn(ctx, target)
  // password-reset-confirm solo acepta cuentas activas: un enlace a una
  // cuenta cancelada llegaría y no serviría.
  if (target.status !== "activo") throw new HttpError(409, "Ese miembro no está activo. Reactívalo primero.", "inactivo")
  await sendResetLink(ctx, target)
  return {}
}

/* ── admin-grant ───────────────────────────────────────────────────────────
   POST {memberId, courseId} → { grant, created, credentials, member }
   Pasa por provisionManualGrant (source 'manual'): reactiva a un cancelado,
   no duplica un acceso activo, avisa al miembro y le manda credenciales o
   "ya tienes acceso" según corresponda. */
async function adminGrant(ctx) {
  const { sql, body } = ctx
  const memberId = toId(body.memberId)
  const courseId = toId(body.courseId)
  if (!memberId) throw bad("Falta el miembro.")
  if (!courseId) throw bad("Elige un curso.")
  const [row] = await sql`
    SELECT m.id, m.name, m.email, m.status, (m.deleted_at IS NOT NULL) AS deleted,
           (SELECT title FROM academy_courses WHERE id = ${courseId}) AS course_title
    FROM academy_members m
    WHERE m.id = ${memberId}
  `
  if (!row || row.deleted) throw new HttpError(404, "Miembro no encontrado", "not_found")
  if (!row.course_title) throw new HttpError(404, "Curso no encontrado", "not_found")
  if (row.status === "expulsado") throw new HttpError(409, "Ese miembro está expulsado. Reactívalo primero.", "expulsado")

  const r = await provisionManualGrant(sql, {
    name: row.name, email: row.email, courseIds: [courseId], source: "manual", actor: ctx.admin,
  })
  const [g] = await sql`
    SELECT id, course_id, state, source,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
    FROM academy_grants
    WHERE member_id = ${memberId} AND course_id = ${courseId} AND state = 'activa'
    ORDER BY id DESC
    LIMIT 1
  `
  if (!g) throw new HttpError(409, "No se pudo dar el curso. Revisa el estado del miembro.", "not_granted")
  return {
    grant: {
      id: Number(g.id), memberId, courseId: Number(g.course_id), courseTitle: row.course_title,
      state: g.state, source: g.source, createdAt: g.created_at,
    },
    created: (r.granted || []).map(Number).includes(courseId),
    credentials: r.credentials,
    member: r.member,
  }
}

/* ── admin-revoke ─── POST {grantId, reason} → { revoked, memberCancelled }
   La lógica (miembro → cancelado si no le queda otro acceso, salvo staff)
   vive en revokeGrant. La orden, si la hay, no se toca: devolver la plata
   es otra decisión, en Mercado Pago. */
async function adminRevoke(ctx) {
  const { sql, body } = ctx
  const grantId = toId(body.grantId)
  if (!grantId) throw bad("Falta el acceso a revocar.")
  const reason = cleanLine(body.reason, 200)
  const [g] = await sql`
    SELECT g.id, m.role
    FROM academy_grants g JOIN academy_members m ON m.id = g.member_id
    WHERE g.id = ${grantId}
  `
  if (!g) throw new HttpError(404, "Acceso no encontrado", "not_found")
  assertCanActOn(ctx, { role: g.role })
  const r = await revokeGrant(sql, grantId, `manual: ${reason || "sin motivo"}`, ctx.admin)
  if (!r.found) throw new HttpError(404, "Acceso no encontrado", "not_found")
  return { revoked: Boolean(r.revoked), memberCancelled: Boolean(r.cancelled) }
}

/* ── Pedidos ────────────────────────────────────────────────────────────── */

/* Filas de academy_orders con curso, grupo y a qué miembro quedó ligada. El
   miembro sale del grant de la orden (sobrevive a un traspaso de correo) y,
   si todavía no hay grant, de la cuenta con ese correo. */
function queryOrders(sql, { status = null, ref = null, limit = PAGE_SIZE, offset = 0 }) {
  return sql`
    SELECT o.public_ref, o.modality, o.title_snapshot, o.amount, o.name, o.email, o.email_norm, o.phone, o.status, o.site,
           o.mp_payment_id, o.mp_payer_email, o.mp_last_status, o.paid_amount, o.refund_reason, o.live_mode,
           to_char(o.paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS paid_at,
           to_char(o.refunded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS refunded_at,
           to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           c.id AS course_id, c.slug AS course_slug, c.title AS course_title,
           k.id AS cohort_id, k.name AS cohort_name,
           COALESCE((SELECT g.member_id FROM academy_grants g WHERE g.order_id = o.id LIMIT 1),
                    (SELECT m.id FROM academy_members m WHERE m.email_norm = o.email_norm)) AS member_id
    FROM academy_orders o
    LEFT JOIN academy_courses c ON c.id = o.course_id
    LEFT JOIN academy_cohorts k ON k.id = o.cohort_id
    WHERE (${status}::text IS NULL OR o.status = ${status}::text)
      AND (${ref}::text IS NULL OR o.public_ref = ${ref}::text)
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `
}

function orderAdmin(r) {
  const payer = r.mp_payer_email ? normEmail(r.mp_payer_email) : ""
  return {
    ref: r.public_ref,
    course: r.course_id ? { id: Number(r.course_id), slug: r.course_slug, title: r.course_title } : null,
    courseTitle: r.title_snapshot,
    modality: r.modality,
    cohort: r.cohort_id ? { id: Number(r.cohort_id), name: r.cohort_name } : null,
    amount: Number(r.amount) || 0,
    name: r.name,
    email: r.email,
    phone: r.phone || null,
    status: r.status,
    mpPaymentId: r.mp_payment_id || null,
    mpPayerEmail: r.mp_payer_email || null,
    mpLastStatus: r.mp_last_status || null,
    paidAt: ISO(r.paid_at),
    paidAmount: r.paid_amount == null ? null : Number(r.paid_amount),
    refundedAt: ISO(r.refunded_at),
    refundReason: r.refund_reason || null,
    liveMode: r.live_mode == null ? null : Boolean(r.live_mode),
    createdAt: ISO(r.created_at),
    // En qué sitio se cobró (cada uno con su Mercado Pago). NULL = antes de
    // la base compartida, del dueño de la base.
    site: r.site || null,
    siteLabel: r.site ? siteLabel(r.site) : null,
    memberId: r.member_id == null ? null : Number(r.member_id),
    // El que pagó en Mercado Pago no es el correo de la cuenta: normal si
    // pagó otro (un regalo), sospechoso si no. El panel lo marca.
    emailMismatch: Boolean(payer && payer !== r.email_norm),
  }
}

/* ── admin-orders ─── GET {status?, page?} → { orders, total, counts, page, pages } */
async function adminOrders(ctx) {
  const { sql, query } = ctx
  const status = ORDER_STATUSES.includes(query.status) ? query.status : null
  const page = pageParam(query.page)
  const [rows, summary] = await Promise.all([
    queryOrders(sql, { status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    sql`SELECT status, count(*)::int AS n FROM academy_orders GROUP BY status`,
  ])
  const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]))
  for (const r of summary) if (r.status in counts) counts[r.status] = Number(r.n) || 0
  const total = status ? counts[status] : Object.values(counts).reduce((a, b) => a + b, 0)
  return {
    orders: rows.map(orderAdmin),
    total,
    counts,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  }
}

/* ── admin-verify-order ────────────────────────────────────────────────────
   POST {ref} → { order, result:{action, mpStatus} }
   Le pregunta a Mercado Pago por la referencia (reconcileOrder) y aplica lo
   que encuentre, igual que el webhook: es el botón "Verificar pago" para el
   caso en que el aviso de Mercado Pago no llegó. Nunca inventa un pago. */
async function adminVerifyOrder(ctx) {
  const { sql, body } = ctx
  const ref = String(body.ref ?? "").trim()
  if (!REF_RE.test(ref)) throw bad("Referencia de pedido inválida.")
  // Cada clic es una llamada a la API de Mercado Pago.
  await limitActor(ctx, "aca-verify", 20, 60, "Demasiadas verificaciones seguidas. Espera un minuto.")

  let result
  try {
    result = await reconcileOrder(sql, ref, { timeoutMs: 8000 })
  } catch (err) {
    if (isDbError(err)) throw err
    console.error("[academy:admin-verify-order] Mercado Pago:", err?.status || "", err?.message || err)
    throw new HttpError(502, "No pudimos consultar Mercado Pago. Intenta de nuevo en un rato.", "mp_error")
  }
  if (result?.found && result.action === "otro_sitio") {
    // Se cobró con el Mercado Pago del otro sitio: que lo consulte él (la
    // orden y el acceso viven en la base compartida, así que al volver se
    // lee igual que si se hubiera verificado acá).
    const peer = await callPeer("bridge-verify-order", { ref }, { timeoutMs: 8500 })
    if (!peer.ok) {
      const where = siteLabel(result.site)
      if (peer.status === 404 && peer.data?.code === "not_found") throw new HttpError(404, "Pedido no encontrado", "not_found")
      throw new HttpError(502, `Este pedido se pagó en ${where} y no pudimos consultarlo desde acá. Intenta de nuevo, o verifícalo desde el panel de ${where}.`, "otro_sitio")
    }
    result = { found: true, ...(peer.data?.result || {}) }
  }
  if (!result?.found) throw new HttpError(404, "Pedido no encontrado", "not_found")
  if (result.action === "sin_mercadopago") {
    throw new HttpError(503, "Mercado Pago no está configurado en este servidor.", "mp_not_configured")
  }
  const [row] = await queryOrders(sql, { ref, limit: 1, offset: 0 })
  return {
    order: row ? orderAdmin(row) : null,
    result: { action: result.action || result.ignored || null, mpStatus: result.status || null },
  }
}

/* ── admin-settings ────────────────────────────────────────────────────────
   GET → { settings }   POST {group?, levels?, plugins?, tabs?, sync?,
   autoprovision?} → { settings }.
   El POST es PARCIAL y se valida entero antes de escribir nada: un campo
   inválido rechaza todo con 400 (no se guarda "la mitad"). Lo validado se
   mezcla en profundidad sobre lo guardado (mergeSettings: los objetos se
   combinan, las listas se reemplazan). Las mismas reglas vuelven a correr
   al leer (shapeSettings en _academyHttp.js), por si alguien edita la fila a
   mano. */

function validateGroup(g) {
  if (!isPlainObject(g)) throw bad("Datos del grupo inválidos.")
  const out = {}
  if (g.name !== undefined) {
    const name = cleanLine(g.name, 200)
    if (!name) throw bad("El grupo necesita un nombre.")
    if (Array.from(name).length > 60) throw bad("El nombre del grupo puede tener hasta 60 caracteres.")
    out.name = name
  }
  if (g.description !== undefined) {
    const d = cleanText(g.description ?? "", 5000)
    if (Array.from(d).length > 4000) throw bad("La descripción puede tener hasta 4000 caracteres.")
    out.description = d
  }
  if (g.initials !== undefined) {
    const ini = cleanLine(g.initials, 10).toUpperCase()
    if (!/^[\p{L}\p{N}]{1,3}$/u.test(ini)) throw bad("Las iniciales son de 1 a 3 letras o números.")
    out.initials = ini
  }
  if (g.color !== undefined) {
    if (typeof g.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(g.color)) throw bad("Color inválido (usa el formato #RRGGBB).")
    out.color = g.color.toLowerCase()
  }
  for (const key of ["coverUrl", "iconUrl"]) {
    if (g[key] === undefined) continue
    if (!hasValue(g[key])) { out[key] = null; continue }
    // Solo imágenes subidas por la Academy (Blob del proyecto) o /assets/:
    // una URL remota sería un píxel de rastreo y el CSP la bloquearía igual.
    const url = isImageUrl(g[key]) ? safeUrl(String(g[key]).trim()) : null
    if (!url) throw bad("Las imágenes del grupo tienen que subirse desde la Academy.")
    out[key] = url
  }
  if (g.links !== undefined) {
    if (!Array.isArray(g.links) || g.links.length > 5) throw bad("Máximo 5 enlaces.")
    out.links = g.links.map((l) => {
      const title = cleanLine(l?.title, 200)
      const url = safeUrl(typeof l?.url === "string" ? l.url : "")
      if (!title || Array.from(title).length > 60) throw bad("Cada enlace necesita un nombre de hasta 60 caracteres.")
      if (!url) throw bad(`El enlace "${title}" no es válido (usa https://…).`)
      return { title, url }
    })
  }
  if (g.rules !== undefined) {
    if (!Array.isArray(g.rules) || g.rules.length > 20) throw bad("Máximo 20 reglas.")
    out.rules = g.rules
      .map((r) => (typeof r === "string" ? { title: r } : r))
      .map((r) => {
        if (!isPlainObject(r)) throw bad("Una de las reglas no es válida.")
        const title = cleanLine(r.title, 500)
        const text = cleanText(r.body ?? "", 5000)
        if (Array.from(title).length > 120) throw bad("El título de una regla puede tener hasta 120 caracteres.")
        if (Array.from(text).length > 1000) throw bad("El detalle de una regla puede tener hasta 1000 caracteres.")
        return title ? { title, ...(text ? { body: text } : {}) } : null
      })
      .filter(Boolean)
  }
  if (g.media !== undefined) {
    if (!Array.isArray(g.media) || g.media.length > 12) throw bad("Máximo 12 imágenes o videos en la galería.")
    out.media = g.media.map((m) => {
      if (m?.kind === "youtube") {
        const videoId = parseYouTubeId(String(m.videoId || m.url || ""))
        if (!videoId) throw bad("Uno de los videos de YouTube no es válido.")
        return { kind: "youtube", videoId }
      }
      if (m?.kind === "image") {
        const url = isImageUrl(m.url) ? safeUrl(String(m.url).trim()) : null
        if (!url) throw bad("Una de las imágenes no es válida: súbela desde la Academy.")
        return { kind: "image", url }
      }
      throw bad("Uno de los elementos de la galería no es válido.")
    })
  }
  return out
}

function validateLevels(levels) {
  const names = isPlainObject(levels) ? levels.names : null
  if (!Array.isArray(names) || names.length !== 9) throw bad("Tienen que ser 9 nombres de nivel.")
  return {
    names: names.map((n, i) => {
      const t = cleanLine(typeof n === "string" ? n : "", 100)
      if (!t || Array.from(t).length > 20) throw bad(`El nivel ${i + 1} necesita un nombre de hasta 20 caracteres.`)
      return t
    }),
  }
}

// Nivel mínimo para publicar/chatear: 2..9, o null (= sin restricción). El
// nivel 1 es el de todos, así que "desde el nivel 1" no restringe nada.
function levelOrNull(v, label) {
  if (!hasValue(v) || v === 0 || v === "0") return null
  const n = intParam(v, { min: 2, max: 9 })
  if (!n) throw bad(`${label}: elige un nivel entre 2 y 9, o déjalo sin restricción.`)
  return n
}

function validatePlugins(p) {
  if (!isPlainObject(p)) throw bad("Complementos inválidos.")
  const out = {}
  if (p.minPostLevel !== undefined) out.minPostLevel = levelOrNull(p.minPostLevel, "Nivel mínimo para publicar")
  if (p.minChatLevel !== undefined) out.minChatLevel = levelOrNull(p.minChatLevel, "Nivel mínimo para chatear")
  if (p.autoDm !== undefined) {
    if (!isPlainObject(p.autoDm)) throw bad("Mensaje de bienvenida inválido.")
    const dm = {}
    if (p.autoDm.enabled !== undefined) {
      if (typeof p.autoDm.enabled !== "boolean") throw bad("Mensaje de bienvenida: encendido debe ser sí o no.")
      dm.enabled = p.autoDm.enabled
    }
    if (p.autoDm.text !== undefined) {
      const text = cleanText(p.autoDm.text ?? "", 2000)
      if (Array.from(text).length > 1000) throw bad("El mensaje de bienvenida puede tener hasta 1000 caracteres.")
      dm.text = text
    }
    out.autoDm = dm
  }
  if (p.welcomeVideoId !== undefined) {
    if (!hasValue(p.welcomeVideoId)) out.welcomeVideoId = null
    else {
      const id = parseYouTubeId(String(p.welcomeVideoId))
      if (!id) throw bad("Ese video de YouTube no es válido.")
      out.welcomeVideoId = id
    }
  }
  return out
}

function validateTabs(t) {
  if (!isPlainObject(t)) throw bad("Pestañas inválidas.")
  const out = {}
  for (const k of ["comunidad", "calendario", "clasificacion"]) {
    if (t[k] === undefined) continue
    if (typeof t[k] !== "boolean") throw bad("Cada pestaña se prende o se apaga (sí o no).")
    out[k] = t[k]
  }
  return out
}

function validateSettingsPatch(body) {
  const out = {}
  if (body.group !== undefined) out.group = validateGroup(body.group)
  if (body.levels !== undefined) out.levels = validateLevels(body.levels)
  if (body.plugins !== undefined) out.plugins = validatePlugins(body.plugins)
  if (body.tabs !== undefined) out.tabs = validateTabs(body.tabs)
  if (body.sync !== undefined) {
    if (!isPlainObject(body.sync) || typeof body.sync.enabled !== "boolean") throw bad("Sincronización: encendida debe ser sí o no.")
    out.sync = { enabled: body.sync.enabled }
  }
  if (body.autoprovision !== undefined) {
    if (typeof body.autoprovision !== "boolean") throw bad("Alta automática: debe ser sí o no.")
    out.autoprovision = body.autoprovision
  }
  return out
}

/* Leer → mezclar → escribir con control optimista (updated_at): dos
   interruptores del panel guardados casi a la vez no se pisan. Si la fila
   cambió entre la lectura y la escritura, se vuelve a leer y a mezclar. */
async function saveSettingsPatch(sql, patch) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [cur] = await sql`SELECT settings, updated_at::text AS ver FROM academy_settings WHERE id = 1`
    const next = mergeSettings(isPlainObject(cur?.settings) ? cur.settings : {}, patch)
    const json = JSON.stringify(next)
    const rows = cur
      ? await sql`
          UPDATE academy_settings SET settings = ${json}::jsonb, updated_at = NOW()
          WHERE id = 1 AND updated_at = ${cur.ver}::timestamptz
          RETURNING id
        `
      : await sql`
          INSERT INTO academy_settings (id, settings, updated_at) VALUES (1, ${json}::jsonb, NOW())
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `
    if (rows.length) return
  }
  throw new HttpError(409, "Otro administrador guardó cambios al mismo tiempo. Recarga e intenta de nuevo.", "conflict")
}

async function adminSettings(ctx) {
  const { sql, req, body } = ctx
  if (req.method === "POST") {
    const patch = validateSettingsPatch(body)
    if (!Object.keys(patch).length) throw bad("No hay cambios que guardar.")
    await saveSettingsPatch(sql, patch)
  }
  // El caché de ajustes es por instancia (60 s): el dueño siempre ve lo que
  // está guardado de verdad, no una copia de hace un minuto. strict: un
  // error de base es un error, no los valores de fábrica.
  invalidateSettings()
  return { settings: await getSettings(sql, { strict: true }) }
}

/* ── admin-stats ───────────────────────────────────────────────────────────
   GET → { members:{active,new7,new30,active7}, courses:[{id,title,owners,
   completedPct}], orders:{paid30,revenue30,pending}, community:{posts7,
   comments7}, uploads:{month,limit}, email:{today,budget} }
   completedPct = avance promedio (lecciones publicadas completadas) de los
   miembros activos con acceso comprado/dado a ese curso. */
async function adminStats(ctx) {
  const { sql } = ctx
  const [[s], courses, email, uploadLimit] = await Promise.all([
    sql`
      SELECT
        (SELECT count(*)::int FROM academy_members WHERE status = 'activo' AND deleted_at IS NULL) AS active,
        (SELECT count(*)::int FROM academy_members WHERE status = 'activo' AND deleted_at IS NULL
            AND joined_at > NOW() - interval '7 days') AS new7,
        (SELECT count(*)::int FROM academy_members WHERE status = 'activo' AND deleted_at IS NULL
            AND joined_at > NOW() - interval '30 days') AS new30,
        (SELECT count(*)::int FROM academy_members WHERE status = 'activo' AND deleted_at IS NULL
            AND last_seen_at > NOW() - interval '7 days') AS active7,
        (SELECT count(*)::int FROM academy_orders WHERE status = 'pagada' AND paid_at > NOW() - interval '30 days') AS paid30,
        (SELECT COALESCE(sum(COALESCE(paid_amount, amount)), 0)::bigint FROM academy_orders
          WHERE status = 'pagada' AND paid_at > NOW() - interval '30 days') AS revenue30,
        (SELECT count(*)::int FROM academy_orders WHERE status = 'pendiente') AS pending,
        (SELECT count(*)::int FROM academy_posts WHERE deleted_at IS NULL AND created_at > NOW() - interval '7 days') AS posts7,
        (SELECT count(*)::int FROM academy_comments WHERE deleted_at IS NULL AND created_at > NOW() - interval '7 days') AS comments7,
        (SELECT count(*)::int FROM academy_uploads
          WHERE created_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago') AS uploads_month
    `,
    sql`
      WITH les AS (
        SELECT course_id, count(*)::int AS n FROM academy_lessons WHERE published GROUP BY course_id
      ), own AS (
        SELECT DISTINCT g.course_id, g.member_id
        FROM academy_grants g JOIN academy_members m ON m.id = g.member_id AND m.status = 'activo'
        WHERE g.state = 'activa'
      ), done AS (
        SELECT l.course_id, p.member_id, count(*)::int AS n
        FROM academy_lesson_progress p JOIN academy_lessons l ON l.id = p.lesson_id AND l.published
        WHERE p.completed_at IS NOT NULL
        GROUP BY l.course_id, p.member_id
      )
      SELECT c.id, c.title,
             count(own.member_id)::int AS owners,
             COALESCE(round(avg(LEAST(100, 100.0 * COALESCE(done.n, 0) / NULLIF(les.n, 0)))), 0)::int AS completed_pct
      FROM academy_courses c
      LEFT JOIN les ON les.course_id = c.id
      LEFT JOIN own ON own.course_id = c.id
      LEFT JOIN done ON done.course_id = c.id AND done.member_id = own.member_id
      GROUP BY c.id, c.title, c.position
      ORDER BY c.position, c.id
    `,
    academyEmailsToday(sql),
    // Mismo tope que hace cumplir `upload`. Import dinámico: si el módulo de
    // cursos no cargara, las estadísticas igual salen.
    import("./_academyCourses.js").then((m) => m.UPLOAD_LIMITS?.globalMonth).catch(() => null),
  ])
  return {
    members: { active: s.active, new7: s.new7, new30: s.new30, active7: s.active7 },
    courses: courses.map((c) => ({ id: Number(c.id), title: c.title, owners: Number(c.owners) || 0, completedPct: Number(c.completed_pct) || 0 })),
    orders: { paid30: s.paid30, revenue30: Number(s.revenue30) || 0, pending: s.pending },
    community: { posts7: s.posts7, comments7: s.comments7 },
    uploads: { month: s.uploads_month, limit: Number(uploadLimit) || UPLOAD_GLOBAL_FALLBACK },
    email: { today: email.today, budget: email.budget },
  }
}

/* Nombres EXACTOS de MODE_OWNERS en api/_academy.js (SPEC §16). */
export const handlers = {
  "admin-members": adminMembers,
  "admin-invite": adminInvite,
  "admin-member-update": adminMemberUpdate,
  "admin-resend-access": adminResendAccess,
  "admin-password-link": adminPasswordLink,
  "admin-grant": adminGrant,
  "admin-revoke": adminRevoke,
  "admin-orders": adminOrders,
  "admin-verify-order": adminVerifyOrder,
  "admin-import-grant": adminImportGrant,
  "admin-settings": adminSettings,
  "admin-stats": adminStats,
}
