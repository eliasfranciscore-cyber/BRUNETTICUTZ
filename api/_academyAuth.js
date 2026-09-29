/* ACADEMY — Quién es quién en cada request
   ------------------------------------------------------------------
   requireMember        token de miembro (api/_academySession.js) +
                        la fila de academy_members, que es la autoridad: rol,
                        estado y session_version se leen de la BASE en cada
                        request, nunca del token. Subir session_version
                        (cambio de clave, "cerrar sesión en todos lados",
                        expulsión) invalida al instante todos los tokens
                        anteriores sin tabla de sesiones.
   requireAcademyAdmin  miembro propietario/admin, O barbero admin del panel
                        (requireBarberAdmin del host, verificado contra la
                        base). Se decide por la FORMA del token y se corre
                        una sola de las dos verificaciones: nunca "si falla
                        una, pruebo la otra".
   requireModerator     igual, aceptando además el rol moderador.
   loadMe               la proyección `Me` del miembro que llama.

   Las tres require* escriben la respuesta de error y devuelven null (mismo
   contrato que requireScope/requireAdmin del panel).
   Prefijo `_`: no cuenta como función serverless. */

import { readMemberToken, hasMemberBearer } from "./_academySession.js"
import { requireBarberAdmin } from "./_academyHost.js"
import { memberPublicFromRow, normalizePrefs, levelFor, getSettings, isStaffRole, isAdminRole, pgCode } from "./_academyHttp.js"

function deny(res, status, error, code) {
  res.setHeader("Cache-Control", "private, no-store")
  res.status(status).json({ ok: false, error, code })
  return null
}

const AUTH_ERROR = "Sesión de Academy requerida"

/* → ctx.member = { id, role, status, sessionVersion, mustChangePassword,
                    name, handle, prefs, lastSeenAt, token:{iat,exp,pwc} }
   o null con la respuesta ya enviada:
     401 code 'auth'    sin token / token inválido / fila ausente / estado
                        distinto de 'activo' / session_version distinto /
                        tablas aún no creadas (42P01: no puede haber
                        miembros todavía)
     403 code 'password_change_required'  cuenta con contraseña temporal
                        (o token pwc) en un modo que no la admite
     503                la base no respondió: falla CERRADO, no se deja
                        pasar a nadie que no se pudo verificar */
export async function requireMember(sql, req, res, { allowPwc = false } = {}) {
  const tok = readMemberToken(req)
  if (!tok) return deny(res, 401, AUTH_ERROR, "auth")
  let row
  try {
    ;[row] = await sql`
      SELECT id, role, status, session_version, must_change_password, name, handle, prefs,
             to_char(last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen_at,
             (last_seen_at IS NULL OR last_seen_at < NOW() - interval '5 minutes') AS seen_stale
      FROM academy_members
      WHERE id = ${tok.sub}
    `
  } catch (err) {
    if (pgCode(err) === "42P01") return deny(res, 401, AUTH_ERROR, "auth")
    console.error("[academy:auth] requireMember:", err?.code || err?.message || err)
    return deny(res, 503, "No se pudo verificar tu sesión. Intenta de nuevo en un momento.", "unavailable")
  }
  if (!row || row.status !== "activo" || Number(row.session_version) !== tok.sv) {
    return deny(res, 401, AUTH_ERROR, "auth")
  }
  const mustChangePassword = Boolean(row.must_change_password)
  if ((mustChangePassword || tok.pwc) && !allowPwc) {
    return deny(res, 403, "Primero tienes que crear tu contraseña.", "password_change_required")
  }
  return {
    id: Number(row.id),
    role: row.role,
    status: row.status,
    sessionVersion: Number(row.session_version),
    mustChangePassword,
    name: row.name,
    handle: row.handle,
    prefs: normalizePrefs(row.prefs),
    lastSeenAt: row.last_seen_at || null,
    seenStale: Boolean(row.seen_stale),
    token: { iat: Number(tok.iat) || 0, exp: Number(tok.exp) || 0, pwc: Boolean(tok.pwc) },
  }
}

/* Barbero admin del panel → rol dentro de la Academy.
   El barbero ya está verificado como admin contra la base
   (requireBarberAdmin del host → { barberId, name, email }).
   Su rol acá es el de la fila de academy_members vinculada por barber_id
   (la crea owner-session: la primera vez que un admin abre la Academy desde
   el panel queda como propietario). Si no tiene fila vinculada:
     - si la Academy todavía no tiene propietario → 'propietario' (es quien
       la va a abrir; sin esto el panel no podría configurar nada antes del
       primer "Abrir Academy");
     - si ya lo tiene → 'admin'.
   Un error que no sea "la tabla no existe" falla cerrado (503). */
async function barberAcademyRole(sql, res, barber) {
  const barberId = Number(barber.barberId)
  let rows = []
  try {
    rows = await sql`
      SELECT id, role, status, barber_id
      FROM academy_members
      WHERE barber_id = ${barberId} OR role = 'propietario'
      ORDER BY (barber_id = ${barberId}) DESC NULLS LAST, id
      LIMIT 5
    `
  } catch (err) {
    if (pgCode(err) !== "42P01") {
      console.error("[academy:auth] barberAcademyRole:", err?.code || err?.message || err)
      deny(res, 503, "No se pudieron verificar tus permisos. Intenta de nuevo.", "unavailable")
      return null
    }
    rows = []
  }
  const linked = rows.find((r) => Number(r.barber_id) === barberId && r.status === "activo")
  const ownerExists = rows.some((r) => r.role === "propietario")
  let role
  if (linked && isAdminRole(linked.role)) role = linked.role
  else role = ownerExists ? "admin" : "propietario"
  return { memberId: linked ? Number(linked.id) : null, barberId, role, member: null, barber }
}

/* → ctx.admin = { memberId|null, barberId|null, role:'propietario'|'admin',
                   member (ctx de requireMember o null), barber
                   ({ barberId, name, email } del host, o null) } */
export async function requireAcademyAdmin(sql, req, res) {
  if (hasMemberBearer(req)) {
    const member = await requireMember(sql, req, res)
    if (!member) return null
    if (!isAdminRole(member.role)) return deny(res, 403, "Esto es solo para administradores de la Academy.", "forbidden")
    return { memberId: member.id, barberId: null, role: member.role, member, barber: null }
  }
  const barber = await requireBarberAdmin(sql, req, res)
  if (!barber) return null
  return barberAcademyRole(sql, res, barber)
}

/* Igual que requireAcademyAdmin, aceptando además 'moderador'. Un barbero
   admin del panel siempre pasa (con su rol de propietario/admin). */
export async function requireModerator(sql, req, res) {
  if (hasMemberBearer(req)) {
    const member = await requireMember(sql, req, res)
    if (!member) return null
    if (!isStaffRole(member.role)) return deny(res, 403, "Esto es solo para el equipo de la Academy.", "forbidden")
    return { memberId: member.id, barberId: null, role: member.role, member, barber: null }
  }
  const barber = await requireBarberAdmin(sql, req, res)
  if (!barber) return null
  return barberAcademyRole(sql, res, barber)
}

/* "Activo hace X": se escribe como mucho cada 5 minutos, y solo desde `me`
   (que corre al abrir la app y al volver a la pestaña). Cada UPDATE es
   cómputo de Neon; un UPDATE por request sería pagar por cada click. */
export async function touchSeen(sql, memberId) {
  try {
    await sql`
      UPDATE academy_members SET last_seen_at = NOW()
      WHERE id = ${Number(memberId)} AND (last_seen_at IS NULL OR last_seen_at < NOW() - interval '5 minutes')
    `
  } catch (err) {
    console.error("[academy:auth] touchSeen:", err?.code || err?.message || err)
  }
}

/* Me = MemberPublic + { email, prefs, mustChangePassword,
        cohorts:[{id,name,chatId}], courseIds, isOwner, isAdmin,
        isModerator, points, levelInfo }
   Una sola consulta (subconsultas para puntos, grupos y cursos). null si la
   fila no existe. */
export async function loadMe(sql, memberId) {
  const id = Number(memberId)
  if (!Number.isInteger(id) || id <= 0) return null
  const [row] = await sql`
    SELECT m.id, m.handle, m.name, m.email, m.avatar_url, m.role, m.status, m.bio, m.location, m.links, m.prefs,
           m.must_change_password,
           to_char(m.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS joined_at,
           to_char(m.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen_at,
           (m.last_sync_at IS NOT NULL AND m.last_sync_at > NOW() - interval '90 seconds') AS online_raw,
           (SELECT count(*)::int FROM academy_likes l WHERE l.author_id = m.id AND l.member_id <> m.id) AS points,
           COALESCE((
             SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'chatId', c.chat_id) ORDER BY c.starts_on NULLS LAST, c.id)
             FROM academy_cohort_members cm
             JOIN academy_cohorts c ON c.id = cm.cohort_id
             WHERE cm.member_id = m.id AND c.archived_at IS NULL
           ), '[]'::json) AS cohorts,
           COALESCE((
             SELECT array_agg(DISTINCT g.course_id ORDER BY g.course_id)
             FROM academy_grants g
             WHERE g.member_id = m.id AND g.state = 'activa'
           ), '{}'::int[]) AS course_ids
    FROM academy_members m
    WHERE m.id = ${id}
  `
  if (!row) return null
  const settings = await getSettings(sql)
  const pub = memberPublicFromRow(row, { id })
  const info = levelFor(pub.points)
  const names = settings.levels.names
  return {
    ...pub,
    email: row.email,
    prefs: normalizePrefs(row.prefs),
    mustChangePassword: Boolean(row.must_change_password),
    cohorts: (Array.isArray(row.cohorts) ? row.cohorts : []).map((c) => ({ id: Number(c.id), name: c.name, chatId: c.chatId == null ? null : Number(c.chatId) })),
    courseIds: (Array.isArray(row.course_ids) ? row.course_ids : []).map(Number),
    isOwner: row.role === "propietario",
    isAdmin: isAdminRole(row.role),
    isModerator: isStaffRole(row.role),
    points: pub.points,
    levelInfo: { ...info, name: names[info.level - 1] || `Nivel ${info.level}` },
  }
}
