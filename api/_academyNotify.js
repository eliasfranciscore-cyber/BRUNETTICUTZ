/* ACADEMY — Notificaciones in-app (+ push best-effort)
   ------------------------------------------------------------------
   Todo aviso de la Academy pasa por acá: la campana (academy_notifications)
   y, si corresponde, un push al teléfono del miembro. Nunca se escribe en la
   tabla `notifications` del panel: esa es de los barberos, y una fila sin
   barber_id aparece en la campana de TODOS los barberos (api/push.js).

   Reglas que viven en un solo lugar para que ningún módulo se las salte:
   - El actor nunca se avisa a sí mismo.
   - Si hay un bloqueo en cualquier dirección entre actor y destinatario, el
     aviso se descarta en silencio (el bloqueado no debe enterarse).
   - Si el miembro apagó ese tipo en Ajustes (prefs.notif.<familia> = false),
     no se crea la fila. prefs.notif.push = false solo apaga el push.
   - Un aviso sobre una publicación de un Grupo privado solo le llega a quien
     puede verla (`requirePostId`): si no, la vista previa filtraría el título
     de una sala a la que no pertenece.
   - Los "me gusta" (y la actividad de un post que sigues) se AGRUPAN por
     group_key: una sola fila no leída por publicación o comentario, que se
     actualiza con el último actor. El "y 3 más" se calcula al leer, desde el
     like_count real, así que un "ya no me gusta" lo corrige solo.
   - Con group_key en cualquier otro tipo, la clave es de idempotencia: la
     misma mención, el mismo "empezó a seguirte" o la misma subida de nivel no
     se repiten aunque alguien edite, deje de seguir y vuelva a seguir.

   Nada de esto lanza: una notificación es un efecto secundario, y jamás debe
   ser la razón de que un comentario, un like o un pago fallen.
   ================================================================ */

import { HttpError, memberMini, pointsFor, getSettings, isStaffRole } from "./_academyHttp.js"
import { safeUrl, isImageUrl } from "./_academyText.js"
import { HOST } from "./_academyHost.js"

const DEFAULT_GROUP_NAME = HOST.brand.name
// Ruta base de la Academy en este sitio ("/academy"); ver api/_academyHost.js.
const BASE = HOST.basePath
const PAGE = 20

// Familia de preferencias (prefs.notif.<familia>) de cada tipo. Los tipos que
// no están acá (anuncio, nivel, bienvenida, curso, grupo, reporte,
// miembro_nuevo) no se pueden apagar: son del propio acceso o de moderación.
const FAMILY = {
  like: "likes",
  comentario: "comments",
  respuesta: "comments",
  actividad: "comments",
  mencion: "mentions",
  post_seguido: "follows",
  seguidor: "follows",
  evento: "events",
}

// Tipos que se agrupan en una sola fila no leída por group_key.
const AGGREGATE = new Set(["like", "actividad"])

const TS_CURSOR_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/

function toId(v) {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null
}

function clip(s, n) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim()
  if (!t) return null
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url")
}

function decodeCursor(raw) {
  if (!raw || typeof raw !== "string" || raw.length > 200) return null
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    return v && typeof v === "object" ? v : null
  } catch {
    return null
  }
}

function pointsOf(map, id) {
  if (!map || typeof map.get !== "function") return 0
  return Number(map.get(id) ?? map.get(String(id)) ?? 0) || 0
}

// Una URL de avatar solo sale si es del Blob del proyecto o de /assets/. Ya se
// valida al guardar (me-update), pero la academia comparte origen con el
// panel: se vuelve a mirar al proyectar por si una fila vieja se coló.
function safeImage(u) {
  if (!u) return null
  const s = safeUrl(u)
  return s && isImageUrl(s) ? s : null
}

/* MemberMini de varios ids en una pasada: las filas y los puntos van en
   paralelo (dos requests HTTP a Neon a la vez, no uno detrás del otro).
   Los puntos salen de pointsFor() para que la definición de "punto" (like
   recibido de OTRO miembro) viva en un solo lugar. */
export async function memberMinis(sql, ids) {
  const uniq = [...new Set((ids || []).map(toId).filter(Boolean))]
  const out = new Map()
  if (!uniq.length) return out
  const [rows, pts] = await Promise.all([
    sql`
      SELECT id, handle, name, avatar_url, avatar_url AS "avatarUrl", role
        FROM academy_members
       WHERE id = ANY(${uniq}::int[])
    `,
    pointsFor(sql, uniq),
  ])
  for (const row of rows) {
    const mini = memberMini({ ...row, points: pointsOf(pts, row.id) })
    if (mini) {
      mini.avatarUrl = safeImage(mini.avatarUrl ?? row.avatar_url)
      out.set(row.id, mini)
    }
  }
  return out
}

/* Texto de una notificación, en partes para que el front pueda poner el
   nombre en negrita SIN interpretar HTML ni markdown (todo se pinta como
   nodos de texto). `notificationText` es la misma frase unida. */
export function notificationParts(kind, actorName, extra = {}) {
  const who = { text: String(actorName || "").trim() || "Alguien", bold: true }
  const t = (text) => ({ text })
  const b = (text) => ({ text, bold: true })
  switch (kind) {
    case "like": {
      const obj = extra.targetType === "comment" ? "tu comentario" : "tu publicación"
      const n = Math.max(0, Math.floor(Number(extra.count) || 0))
      return n > 0
        ? [t("A "), who, t(` y ${n} más les gustó ${obj}`)]
        : [t("A "), who, t(` le gustó ${obj}`)]
    }
    case "comentario":
      return [who, t(" comentó en tu publicación")]
    case "respuesta":
      return [who, t(" respondió tu comentario")]
    case "mencion":
      return [who, t(" te mencionó")]
    case "post_seguido":
      return [who, t(" (siguiendo) publicó")]
    case "actividad":
      return [t("Hay actividad nueva en una publicación que sigues")]
    case "anuncio":
      return [who, t(" publicó un anuncio")]
    case "seguidor":
      return [who, t(" empezó a seguirte")]
    case "evento":
      // El texto del evento ("Mañana 19:00: Q&A con Bruno") lo arma quien
      // lo crea (el cron) y viaja en `preview`: acá no hay de dónde sacarlo.
      return [t(String(extra.text || extra.preview || "Tienes un evento próximo"))]
    case "nivel": {
      const level = Math.max(1, Math.floor(Number(extra.level) || 1))
      const name = String(extra.levelName || "").trim()
      return [t(`¡Subiste al Nivel ${level}${name ? ` · ${name}` : ""}!`)]
    }
    case "bienvenida":
      return [t(`¡Bienvenido a ${extra.groupName || DEFAULT_GROUP_NAME}!`)]
    case "curso": {
      const title = String(extra.courseTitle || extra.preview || "").trim()
      return title ? [t("Tienes acceso a "), b(title)] : [t("Tienes acceso a un curso nuevo")]
    }
    case "grupo": {
      const name = String(extra.cohortName || extra.preview || "").trim()
      return name ? [t("Te agregaron al grupo "), b(name)] : [t("Te agregaron a un grupo")]
    }
    case "reporte":
      return [t("Nuevo reporte de contenido")]
    case "miembro_nuevo":
      return [who, t(" se unió a la Academy")]
    default:
      return [t(String(extra.text || "Tienes una notificación nueva"))]
  }
}

export function notificationText(kind, actorName, extra = {}) {
  return notificationParts(kind, actorName, extra).map((p) => p.text).join("")
}

/* Ruta RELATIVA dentro de la academia. Nunca una URL absoluta ni algo que
   venga del usuario tal cual: el service worker la abre con openWindow y la
   valida contra ^/[A-Za-z0-9/_\-?=&%.]*$, así que tampoco lleva '#'. Los
   slugs y handles ya son [a-z0-9-], el encode es por si acaso. */
export function routeFor({ kind, targetType, targetId, parentId, extra = {} } = {}) {
  const id = toId(targetId)
  const parent = toId(parentId)
  const seg = (s) => encodeURIComponent(String(s))
  const x = extra || {}
  switch (targetType) {
    case "post":
      return id ? `${BASE}/comunidad/${id}` : `${BASE}/comunidad`
    case "comment":
      if (x.courseSlug && x.lessonSlug) {
        return `${BASE}/cursos/${seg(x.courseSlug)}/${seg(x.lessonSlug)}${id ? `?comentario=${id}` : ""}`
      }
      if (parent) return `${BASE}/comunidad/${parent}${id ? `?comentario=${id}` : ""}`
      return `${BASE}/comunidad`
    case "lesson":
      if (x.courseSlug && x.lessonSlug) return `${BASE}/cursos/${seg(x.courseSlug)}/${seg(x.lessonSlug)}`
      if (x.courseSlug) return `${BASE}/cursos/${seg(x.courseSlug)}`
      return `${BASE}/cursos`
    case "event":
      return id ? `${BASE}/calendario?evento=${id}` : `${BASE}/calendario`
    case "miembro":
      return x.handle ? `${BASE}/perfil/${seg(x.handle)}` : `${BASE}/miembros`
    case "chat":
      return id ? `${BASE}/chat/${id}` : `${BASE}/comunidad`
    case "curso":
      return x.courseSlug ? `${BASE}/cursos/${seg(x.courseSlug)}` : `${BASE}/cursos`
    case "grupo":
      return id ? `${BASE}/grupos/${id}` : `${BASE}/comunidad`
    default:
      break
  }
  if (kind === "nivel") return `${BASE}/clasificacion`
  if (kind === "evento") return `${BASE}/calendario`
  return `${BASE}/comunidad`
}

async function groupName(sql) {
  try {
    const s = await getSettings(sql)
    return String(s?.group?.name || "").trim() || DEFAULT_GROUP_NAME
  } catch {
    return DEFAULT_GROUP_NAME
  }
}

// El push es best-effort de verdad: import dinámico (si _academyPush.js no
// carga, la notificación in-app ya quedó escrita) y cualquier error se traga.
async function pushSafe(sql, memberIds, payload) {
  if (!memberIds.length) return 0
  try {
    const m = await import("./_academyPush.js")
    await m.pushToMembers(sql, memberIds, payload)
    return memberIds.length
  } catch (err) {
    console.error("[academy:notify] push:", err?.message || err)
    return 0
  }
}

/* Crea (o agrupa) la misma notificación para varios miembros en UN statement.
   payload: { kind, actorId, targetType, targetId, parentId, preview, groupKey,
              push = true, text, requirePostId, extra }
   - `requirePostId`: solo recibe quien puede ver ese post (Grupo privado).
   - `extra`: datos para armar la ruta/texto del push (slugs de la lección,
     handle, nivel…); no se guarda.
   - `text`: frase ya armada por quien llama (eventos). Si no viene preview,
     se guarda como preview para poder reconstruirla al leer.
   Devuelve { inserted, updated, pushed } y nunca lanza. */
export async function notifyMany(sql, memberIds, payload = {}) {
  const result = { inserted: 0, updated: 0, pushed: 0 }
  try {
    const kind = String(payload.kind || "").slice(0, 24)
    if (!kind) return result
    const ids = [...new Set((Array.isArray(memberIds) ? memberIds : [memberIds]).map(toId).filter(Boolean))].slice(0, 5000)
    if (!ids.length) return result

    const actorId = toId(payload.actorId)
    const targetType = payload.targetType ? String(payload.targetType).slice(0, 10) : null
    const targetId = toId(payload.targetId)
    const parentId = toId(payload.parentId)
    const groupKey = payload.groupKey ? String(payload.groupKey).slice(0, 120) : null
    const preview = clip(payload.preview ?? payload.text, 200)
    const family = FAMILY[kind] || null
    const aggregate = !!groupKey && AGGREGATE.has(kind)
    const dedupe = !!groupKey && !aggregate && payload.dedupe !== false
    const requirePostId = toId(payload.requirePostId)

    /* Candidatos: activos, no el actor, sin bloqueo en ninguna dirección, con
       ese tipo encendido y (si aplica) con permiso para ver el post. Después,
       en el mismo statement: agrupar sobre la fila no leída existente o
       insertar una nueva. want_push se decide acá mismo para no volver a leer
       prefs: push encendido y el miembro no está mirando la app ahora (si
       está en línea, la campana ya se lo muestra en el próximo sync). */
    const rows = await sql`
      WITH cand AS (
        SELECT m.id,
               (COALESCE(m.prefs->'notif'->>'push', 'true') <> 'false'
                AND (m.last_sync_at IS NULL OR m.last_sync_at < NOW() - interval '90 seconds')) AS want_push
          FROM academy_members m
         WHERE m.id = ANY(${ids}::int[])
           AND m.status = 'activo' AND m.deleted_at IS NULL
           AND (${actorId}::int IS NULL OR m.id <> ${actorId}::int)
           AND (${family}::text IS NULL OR COALESCE(m.prefs->'notif'->>${family}::text, 'true') <> 'false')
           AND (${actorId}::int IS NULL OR NOT EXISTS (
                 SELECT 1 FROM academy_blocks b
                  WHERE (b.blocker_id = m.id AND b.blocked_id = ${actorId}::int)
                     OR (b.blocker_id = ${actorId}::int AND b.blocked_id = m.id)))
           AND (${requirePostId}::int IS NULL OR EXISTS (
                 SELECT 1 FROM academy_posts p
                   LEFT JOIN academy_categories c ON c.id = p.category_id
                  WHERE p.id = ${requirePostId}::int AND p.deleted_at IS NULL
                    AND (c.cohort_id IS NULL
                         OR m.role IN ('propietario', 'admin', 'moderador')
                         OR EXISTS (SELECT 1 FROM academy_cohort_members cm
                                     WHERE cm.cohort_id = c.cohort_id AND cm.member_id = m.id))))
      ),
      upd AS (
        UPDATE academy_notifications n
           SET actor_id = ${actorId}::int,
               preview = COALESCE(${preview}::text, n.preview),
               created_at = NOW()
         WHERE ${aggregate}::boolean
           AND n.group_key = ${groupKey}::text
           AND n.read_at IS NULL
           AND n.member_id IN (SELECT id FROM cand)
        RETURNING n.member_id
      ),
      ins AS (
        INSERT INTO academy_notifications (member_id, kind, actor_id, target_type, target_id, parent_id, preview, group_key)
        SELECT c.id, ${kind}::text, ${actorId}::int, ${targetType}::text, ${targetId}::int, ${parentId}::int,
               ${preview}::text, ${groupKey}::text
          FROM cand c
         WHERE NOT (${aggregate}::boolean AND EXISTS (
                 SELECT 1 FROM academy_notifications x
                  WHERE x.member_id = c.id AND x.group_key = ${groupKey}::text AND x.read_at IS NULL))
           AND NOT (${dedupe}::boolean AND EXISTS (
                 SELECT 1 FROM academy_notifications x
                  WHERE x.member_id = c.id AND x.group_key = ${groupKey}::text))
        RETURNING member_id
      )
      SELECT c.id AS member_id, c.want_push,
             EXISTS (SELECT 1 FROM ins WHERE ins.member_id = c.id) AS inserted,
             EXISTS (SELECT 1 FROM upd WHERE upd.member_id = c.id) AS updated,
             (SELECT name FROM academy_members WHERE id = ${actorId}::int) AS actor_name
        FROM cand c
    `

    const toPush = []
    let actorName = null
    for (const r of rows) {
      actorName = r.actor_name ?? actorName
      if (r.inserted) {
        result.inserted++
        if (r.want_push) toPush.push(r.member_id)
      } else if (r.updated) {
        result.updated++
      }
    }

    // Solo una fila NUEVA avisa al teléfono: el segundo, tercer… like sobre
    // la misma publicación ya está en la campana y no vuelve a sonar.
    if (payload.push !== false && toPush.length) {
      const x = payload.extra || {}
      const text = payload.text
        ? String(payload.text)
        : notificationText(kind, actorName, { ...x, targetType, count: 0, preview })
      const detail = kind === "evento" || payload.text ? null : clip(payload.preview, 100)
      result.pushed = await pushSafe(sql, toPush, {
        title: await groupName(sql),
        body: detail ? `${text}\n${detail}` : text,
        url: routeFor({ kind, targetType, targetId, parentId, extra: x }),
        tag: `aca-${groupKey || `${kind}-${targetType || "x"}-${targetId || 0}`}`.slice(0, 64),
      })
    }
  } catch (err) {
    console.error(`[academy:notify] ${payload?.kind || "?"}:`, err?.message || err)
  }
  return result
}

export async function notify(sql, { memberId, ...payload } = {}) {
  return notifyMany(sql, [memberId], payload)
}

/* ── Modos del router ───────────────────────────────────────────────────── */

async function listNotifications(ctx) {
  const { sql, member, query } = ctx
  const filter = String(query.filter || "todas")
  const unreadOnly = filter === "no-leidas" || filter === "no-leidos" || filter === "unread"
  const cur = decodeCursor(query.cursor)
  const curTs = cur && typeof cur.t === "string" && TS_CURSOR_RE.test(cur.t) && toId(cur.id) ? cur.t : null
  const curId = curTs ? toId(cur.id) : null
  const staff = isStaffRole(member.role)

  /* Se ordena por created_at (no por id) porque una fila agrupada de likes
     sube a la cima cuando llega un like nuevo. El cursor lleva el instante
     con microsegundos (es opaco, nunca se muestra), así el keyset no se
     salta filas.

     Al LEER se vuelve a validar el destino: si el post se borró o el miembro
     ya no está en el Grupo de esa categoría, la fila se sigue contando (para
     que la campana cuadre con `sync`), pero sin vista previa y sin ruta al
     contenido. */
  const [rows, countRows, settings] = await Promise.all([
    sql`
      SELECT n.id, n.kind, n.actor_id, n.target_type, n.target_id, n.parent_id, n.preview,
             (n.read_at IS NOT NULL) AS read,
             to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
             to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS cur_ts,
             COALESCE(pp.id, cp.id) AS post_id,
             pp.like_count AS post_likes,
             cm.like_count AS comment_likes,
             (cm.id IS NOT NULL AND cm.deleted_at IS NULL) AS comment_alive,
             ls.slug AS lesson_slug, lco.slug AS lesson_course_slug,
             tl.slug AS tl_slug, tlc.slug AS tl_course_slug,
             tm.handle AS target_handle,
             co.slug AS course_slug, co.title AS course_title,
             ch.name AS cohort_name,
             CASE
               WHEN pp.id IS NULL AND cp.id IS NULL THEN true
               ELSE (COALESCE(pp.deleted_at, cp.deleted_at) IS NULL
                     AND (vc.cohort_id IS NULL OR ${staff}::boolean
                          OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                                      WHERE vcm.cohort_id = vc.cohort_id AND vcm.member_id = ${member.id}::int)))
             END AS visible
        FROM academy_notifications n
        LEFT JOIN academy_posts pp ON n.target_type = 'post' AND pp.id = n.target_id
        LEFT JOIN academy_comments cm ON n.target_type = 'comment' AND cm.id = n.target_id
        LEFT JOIN academy_posts cp ON cp.id = cm.post_id
        LEFT JOIN academy_categories vc ON vc.id = COALESCE(pp.category_id, cp.category_id)
        LEFT JOIN academy_lessons ls ON ls.id = cm.lesson_id
        LEFT JOIN academy_courses lco ON lco.id = ls.course_id
        LEFT JOIN academy_lessons tl ON n.target_type = 'lesson' AND tl.id = n.target_id
        LEFT JOIN academy_courses tlc ON tlc.id = tl.course_id
        LEFT JOIN academy_members tm ON n.target_type = 'miembro' AND tm.id = n.target_id
        LEFT JOIN academy_courses co ON n.target_type = 'curso' AND co.id = n.target_id
        LEFT JOIN academy_cohorts ch ON n.target_type = 'grupo' AND ch.id = n.target_id
       WHERE n.member_id = ${member.id}::int
         AND (NOT ${unreadOnly}::boolean OR n.read_at IS NULL)
         AND (${curTs}::text IS NULL
              OR (n.created_at, n.id) < ((${curTs}::timestamp AT TIME ZONE 'UTC'), ${curId}::int))
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ${PAGE + 1}::int
    `,
    sql`SELECT count(*)::int AS n FROM academy_notifications WHERE member_id = ${member.id}::int AND read_at IS NULL`,
    getSettings(sql).catch(() => null),
  ])

  const page = rows.slice(0, PAGE)
  const actors = await memberMinis(sql, page.map((r) => r.actor_id))
  const names = Array.isArray(settings?.levels?.names) ? settings.levels.names : []
  const gName = String(settings?.group?.name || "").trim() || DEFAULT_GROUP_NAME

  const notifications = page.map((r) => {
    const visible = r.visible !== false
    const actor = r.actor_id ? actors.get(r.actor_id) || null : null
    let preview = visible ? r.preview : null
    if (r.target_type === "comment" && !r.comment_alive) preview = null

    const routeExtra = {}
    if (r.target_type === "comment" && r.lesson_slug) {
      routeExtra.courseSlug = r.lesson_course_slug
      routeExtra.lessonSlug = r.lesson_slug
    }
    if (r.target_type === "lesson") {
      routeExtra.courseSlug = r.tl_course_slug
      routeExtra.lessonSlug = r.tl_slug
    }
    if (r.target_type === "miembro") routeExtra.handle = r.target_handle
    if (r.target_type === "curso") routeExtra.courseSlug = r.course_slug

    const likes = r.target_type === "comment" ? r.comment_likes : r.post_likes
    const level = r.kind === "nivel" ? toId(r.target_id) || 1 : null
    const extra = {
      targetType: r.target_type,
      count: r.kind === "like" ? Math.max(0, (Number(likes) || 0) - 1) : 0,
      preview: r.preview,
      level,
      levelName: level ? names[level - 1] || null : null,
      courseTitle: r.course_title || r.preview,
      cohortName: r.cohort_name || r.preview,
      groupName: gName,
    }
    const parts = notificationParts(r.kind, actor?.name, extra)
    // El texto del evento ya ES la vista previa: no se repite abajo.
    if (r.kind === "evento" || r.kind === "curso" || r.kind === "grupo") preview = null

    const route = visible
      ? routeFor({
          kind: r.kind,
          targetType: r.target_type,
          targetId: r.target_id,
          parentId: r.target_type === "comment" ? r.post_id || r.parent_id : r.parent_id,
          extra: routeExtra,
        })
      : `${BASE}/comunidad`

    return {
      id: r.id,
      kind: r.kind,
      actor,
      targetType: r.target_type,
      targetId: r.target_id,
      parentId: r.parent_id,
      route,
      text: parts.map((p) => p.text).join(""),
      parts,
      preview,
      createdAt: r.created_at,
      read: !!r.read,
    }
  })

  const last = page[page.length - 1]
  return {
    notifications,
    unread: countRows[0]?.n || 0,
    nextCursor: rows.length > PAGE && last ? encodeCursor({ t: last.cur_ts, id: last.id }) : null,
  }
}

async function markRead(ctx) {
  const { sql, member, body } = ctx
  const all = body?.all === true
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(toId).filter(Boolean))].slice(0, 500) : []
  if (!all && !ids.length) throw new HttpError(400, "Indica qué notificaciones marcar como leídas")

  // El conteo de la subconsulta ve la foto de ANTES del UPDATE (mismo
  // statement), por eso se le restan las que se acaban de marcar.
  const [row] = await sql`
    WITH u AS (
      UPDATE academy_notifications SET read_at = NOW()
       WHERE member_id = ${member.id}::int AND read_at IS NULL
         AND (${all}::boolean OR id = ANY(${ids}::int[]))
      RETURNING id
    )
    SELECT ((SELECT count(*) FROM academy_notifications WHERE member_id = ${member.id}::int AND read_at IS NULL)
            - (SELECT count(*) FROM u))::int AS unread
  `
  return { unread: Math.max(0, row?.unread || 0) }
}

export const handlers = {
  notifications: listNotifications,
  "notifications-read": markRead,
}
