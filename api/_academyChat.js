/* PIMP STUDIO — Academy: chats, Grupos, sync, push y archivos privados
   ------------------------------------------------------------------
   Modos de /api/academy?mode=… (SPEC §5.4) que despacha api/_academy.js:
     chats, chat, chat-start, chat-send, chat-read, chats-read-all, chat-mute,
     chat-mark-unread, block, blocks, sync, push-subscribe, push-unsubscribe,
     cohorts, cohort, file, admin-cohort-save, admin-cohort-members,
     admin-cohort-archive.
   El router ya resolvió la sesión (ctx.member / ctx.admin) y el método; acá
   solo vive la regla de negocio. Un handler devuelve un objeto (el router
   responde 200 {ok:true, …} con `private, no-store`) o lanza HttpError.

   Helpers exportados para otros módulos (SPEC §16), los usa _academyProvision
   al acreditar una compra presencial y para el mensaje de bienvenida:
     ensureCohortChat(sql, cohortId) → chatId
     addToCohort(sql, cohortId, memberIds, opts?) → { chatId, added }
     removeFromCohort(sql, cohortId, memberIds) → removed
     startDm(sql, fromId, toId) → chatId
     postSystemDm(sql, fromMemberId, toMemberId, body, opts?) → { chatId, messageId } | null

   Reglas que no se negocian:
   - Chat de Grupo = chat del cohort. Sus miembros (academy_chat_members) son
     los del cohort MÁS el staff dueño (propietario y admins): el profe tiene
     que estar en la sala de su generación sin tener que "inscribirse" en ella
     (eso lo contaría en memberCount y en los cupos). Sacar a alguien del
     cohort lo saca del chat; al staff no.
   - DM: bloqueo en cualquiera de las dos direcciones → 403 genérico (no se
     dice quién bloqueó a quién); destinatario con el chat apagado → 403
     `chat_off`; `plugins.minChatLevel` frena a los que no son staff (salvo
     que le escriban al staff: el mensaje de bienvenida invita a responderle
     al dueño, y un miembro nuevo es nivel 1).
   - `sync` es la ÚNICA ruta que se consulta en bucle (SPEC §9): un solo viaje
     a la base con CTEs, la escritura de presencia a lo más una vez por
     minuto, y un freno en memoria de 1 request cada 4 s por miembro. Nunca
     llama a ensure* (nada de DDL en la ruta caliente).
   - Los adjuntos del chat son blobs PRIVADOS: el mensaje guarda solo el id de
     academy_uploads y la imagen se sirve por `file`, que revisa que quien la
     pide pueda ver un mensaje que la referencia.
   ================================================================ */

import { HttpError, levelFor, getSettings, isStaffRole, memberMini } from "./_academyHttp.js"
import { cleanText, cleanLine, safeUrl, isImageUrl } from "./_academyText.js"
import { pushToMembers } from "./_academyPush.js"
import { HOST } from "./_academyHost.js"

const MSG_MAX = 4000
const PAGE = 40

// ── utilidades ────────────────────────────────────────────────────────────

function intId(v) {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null
}

function intIds(list, max = 200) {
  if (!Array.isArray(list)) return []
  return [...new Set(list.map(intId).filter(Boolean))].slice(0, max)
}

function rawFirstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || ""
}

function firstName(name) {
  return rawFirstName(name) || "Este miembro"
}

// Una imagen de usuario solo sale si es del Blob del proyecto o de /assets/
// (SPEC §0.2). Se revisa también al leer, no solo al guardar: si algún día
// entra una URL mala por otro camino, acá no se propaga.
function imageOrNull(u) {
  if (!u || !isImageUrl(u)) return null
  return safeUrl(u) || null
}

// MemberMini (SPEC §4.3) con el memberMini() compartido. Las consultas de
// este archivo traen los puntos en la misma fila (subconsulta a
// academy_likes), así el nivel sale sin una consulta extra; las columnas con
// prefijo (autor del mensaje, el otro del DM…) se renombran antes de llamar.
function mini(r) {
  if (!r || r.id === null || r.id === undefined) return null
  return memberMini(r, Number(r.points) || 0)
}

function fileUrl(uploadId) {
  return `/api/academy?mode=file&id=${uploadId}`
}

function messageOut(r, meId) {
  const atts = Array.isArray(r.attachments) ? r.attachments : []
  return {
    id: Number(r.id),
    chatId: Number(r.chat_id),
    author: mini({ id: r.author_id, handle: r.a_handle, name: r.a_name, avatar_url: r.a_avatar, role: r.a_role, points: r.a_points }),
    body: r.body || "",
    attachments: atts.map((a) => intId(a?.uploadId)).filter(Boolean).slice(0, 4).map((id) => ({ kind: "image", url: fileUrl(id) })),
    createdAt: r.created_at,
    mine: Number(r.author_id) === Number(meId),
  }
}

// Espera una promesa hasta `ms` y sigue: el push de un mensaje no puede
// demorar la respuesta del envío (Vercel congela la función apenas se
// responde, así que tampoco se puede dejar corriendo "de fondo").
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.() }),
  ])
}

// ── frenos en memoria ─────────────────────────────────────────────────────
// Por instancia tibia, no globales: alcanzan para cortar un bucle del propio
// cliente (el caso real) sin sumar una escritura a rate_limits —que además
// hace DDL en cada llamada— en las dos rutas más calientes de la Academy.

const syncHits = new Map() // memberId → ms del último sync aceptado
function syncGate(memberId) {
  const now = Date.now()
  const last = syncHits.get(memberId) || 0
  if (now - last < 4000) throw new HttpError(429, "Demasiadas solicitudes", "rate", { retryAfter: Math.ceil((4000 - (now - last)) / 1000) })
  syncHits.set(memberId, now)
  if (syncHits.size > 5000) {
    for (const [k, t] of syncHits) if (now - t > 60_000) syncHits.delete(k)
  }
}

const sendHits = new Map() // memberId → [ms de cada envío en la última hora]
function sendGate(memberId) {
  const now = Date.now()
  const recent = (sendHits.get(memberId) || []).filter((t) => now - t < 3_600_000)
  const burst = recent.filter((t) => now - t < 10_000).length
  if (burst >= 8 || recent.length >= 300) throw new HttpError(429, "Vas muy rápido. Espera un momento.", "rate", { retryAfter: burst >= 8 ? 10 : 600 })
  recent.push(now)
  sendHits.set(memberId, recent)
  if (sendHits.size > 5000) {
    for (const [k, arr] of sendHits) if (!arr.length || now - arr[arr.length - 1] > 3_600_000) sendHits.delete(k)
  }
}

// ── reglas de DM ──────────────────────────────────────────────────────────

/* ¿`me` puede escribirle a `other`? `other` = { id, name, role, status,
   deleted, chatEnabled ('false'|otro), blocked (cualquier dirección) }.
   Devuelve { ok } o { ok:false, status, code, message }. */
async function dmGate(sql, me, other, myPoints) {
  if (!other || other.deleted || other.status !== "activo") {
    return { ok: false, status: 403, code: "inactive", message: "Este miembro ya no está en la Academy" }
  }
  if (other.blocked) {
    return { ok: false, status: 403, code: "no_dm", message: "No puedes chatear con este miembro" }
  }
  if (me?.prefs?.chat?.enabled === false) {
    return { ok: false, status: 403, code: "chat_off_self", message: "Tienes el chat apagado. Actívalo en Ajustes." }
  }
  if (other.chatEnabled === "false") {
    return { ok: false, status: 403, code: "chat_off", message: `${firstName(other.name)} tiene el chat apagado` }
  }
  if (!isStaffRole(me?.role) && !isStaffRole(other.role)) {
    const settings = await getSettings(sql)
    const min = Number(settings?.plugins?.minChatLevel)
    if (Number.isInteger(min) && min >= 2 && levelFor(Number(myPoints) || 0).level < min) {
      return { ok: false, status: 403, code: "level", message: `El chat se desbloquea en el Nivel ${min}` }
    }
  }
  return { ok: true }
}

// ── helpers exportados (SPEC §16) ─────────────────────────────────────────

/* Chat del Grupo: lo crea si falta y deja adentro a todos los miembros
   activos del cohort + propietario/admins. Idempotente; se puede llamar
   cuantas veces se quiera (repara un chat al que le faltan miembros).
   Devuelve el chatId, o null si el cohort no existe. Sin DDL: se puede usar
   desde el webhook de pago. */
export async function ensureCohortChat(sql, cohortId) {
  const id = intId(cohortId)
  if (!id) return null
  const [co] = await sql`SELECT id, chat_id FROM academy_cohorts WHERE id = ${id}`
  if (!co) return null

  let chatId = co.chat_id ? Number(co.chat_id) : null
  if (!chatId) {
    // Un solo statement: el FOR UPDATE hace que dos llamadas simultáneas no
    // creen dos chats (la segunda espera, vuelve a mirar chat_id y ya no está
    // en NULL). El UPDATE apunta a una fila que YA existía, por eso sí ve el
    // chat recién insertado vía RETURNING.
    const rows = await sql`
      WITH co AS (
        SELECT id, name FROM academy_cohorts WHERE id = ${id} AND chat_id IS NULL FOR UPDATE
      ), ch AS (
        INSERT INTO academy_chats (kind, cohort_id, name)
        SELECT 'grupo', co.id, co.name FROM co
        RETURNING id, cohort_id
      ), up AS (
        UPDATE academy_cohorts c SET chat_id = ch.id, updated_at = NOW()
          FROM ch WHERE c.id = ch.cohort_id
        RETURNING c.chat_id
      )
      SELECT chat_id FROM up
    `
    chatId = rows[0]?.chat_id ? Number(rows[0].chat_id) : null
    if (!chatId) {
      const [again] = await sql`SELECT chat_id FROM academy_cohorts WHERE id = ${id}`
      chatId = again?.chat_id ? Number(again.chat_id) : null
    }
  }
  if (!chatId) return null

  await sql`
    INSERT INTO academy_chat_members (chat_id, member_id)
    SELECT ${chatId}::int, m.id
      FROM academy_members m
     WHERE m.status = 'activo' AND m.deleted_at IS NULL
       AND (m.role IN ('propietario', 'admin')
            OR EXISTS (SELECT 1 FROM academy_cohort_members x WHERE x.cohort_id = ${id} AND x.member_id = m.id))
    ON CONFLICT DO NOTHING
  `
  return chatId
}

/* Agrega miembros a un Grupo y a su chat en el mismo statement. Solo entran
   miembros activos. `notify` (por defecto sí) deja el aviso "Te agregaron al
   grupo …" a los que entraron recién (no a los que ya estaban).
   Devuelve { chatId, added: [memberId] }. */
export async function addToCohort(sql, cohortId, memberIds, { actorId = null, notify = true } = {}) {
  const cid = intId(cohortId)
  const ids = intIds(Array.isArray(memberIds) ? memberIds : [memberIds], 500)
  if (!cid || !ids.length) return { chatId: null, added: [] }
  const chatId = await ensureCohortChat(sql, cid)
  if (!chatId) return { chatId: null, added: [] }

  const rows = await sql`
    WITH valid AS (
      SELECT m.id FROM academy_members m
       WHERE m.id = ANY(${ids}::int[]) AND m.status = 'activo' AND m.deleted_at IS NULL
    ), ins AS (
      INSERT INTO academy_cohort_members (cohort_id, member_id)
      SELECT ${cid}::int, valid.id FROM valid
      ON CONFLICT DO NOTHING
      RETURNING member_id
    ), chm AS (
      INSERT INTO academy_chat_members (chat_id, member_id)
      SELECT ${chatId}::int, valid.id FROM valid
      ON CONFLICT DO NOTHING
      RETURNING member_id
    )
    SELECT ins.member_id, (SELECT name FROM academy_cohorts WHERE id = ${cid}) AS cohort_name FROM ins
  `
  const added = rows.map((r) => Number(r.member_id))

  if (notify && added.length) {
    // Best-effort: el aviso in-app es de _academyNotify (BE-COMMUNITY). Un
    // fallo ahí no deshace la inscripción ya guardada.
    try {
      const name = rows[0]?.cohort_name || ""
      const { notifyMany } = await import("./_academyNotify.js")
      await notifyMany(sql, added, {
        kind: "grupo",
        actorId: intId(actorId),
        targetType: "grupo",
        targetId: cid,
        preview: name || null,
        text: name ? `Te agregaron al grupo ${name}` : "Te agregaron a un grupo",
      })
    } catch (err) {
      console.error("[academy:grupo] notify error:", err?.message || err)
    }
  }
  return { chatId, added }
}

/* Saca miembros del Grupo y de su chat. Al staff (propietario/admin) no lo
   saca del chat: está ahí por ser staff, no por ser del cohort. */
export async function removeFromCohort(sql, cohortId, memberIds) {
  const cid = intId(cohortId)
  const ids = intIds(Array.isArray(memberIds) ? memberIds : [memberIds], 500)
  if (!cid || !ids.length) return 0
  const [row] = await sql`
    WITH del AS (
      DELETE FROM academy_cohort_members
       WHERE cohort_id = ${cid} AND member_id = ANY(${ids}::int[])
      RETURNING member_id
    ), co AS (
      SELECT chat_id FROM academy_cohorts WHERE id = ${cid}
    ), dch AS (
      DELETE FROM academy_chat_members cm
       USING co, academy_members m
       WHERE cm.chat_id = co.chat_id
         AND cm.member_id = ANY(${ids}::int[])
         AND m.id = cm.member_id
         AND m.role NOT IN ('propietario', 'admin')
      RETURNING cm.member_id
    )
    SELECT (SELECT count(*)::int FROM del) AS removed
  `
  return Number(row?.removed) || 0
}

/* DM entre dos miembros: crea (o reusa, por dm_key '<min>:<max>', que es
   UNIQUE simple) el chat y deja a los dos como miembros. NO revisa reglas
   (bloqueos, chat apagado, nivel): eso lo hace chat-start; esto también lo
   usa el mensaje de bienvenida del sistema. */
export async function startDm(sql, fromId, toId) {
  const a = intId(fromId)
  const b = intId(toId)
  if (!a || !b || a === b) throw new HttpError(400, "Miembro inválido")
  const key = `${Math.min(a, b)}:${Math.max(a, b)}`
  const rows = await sql`
    WITH c AS (
      INSERT INTO academy_chats (kind, dm_key) VALUES ('directo', ${key})
      ON CONFLICT (dm_key) DO UPDATE SET dm_key = EXCLUDED.dm_key
      RETURNING id
    ), cm AS (
      INSERT INTO academy_chat_members (chat_id, member_id)
      SELECT c.id, x FROM c, unnest(${[a, b]}::int[]) AS x
      ON CONFLICT DO NOTHING
      RETURNING member_id
    )
    SELECT id FROM c
  `
  return Number(rows[0].id)
}

/* Mensaje directo "del sistema" (AutoDM de bienvenida, SPEC §6.3): del dueño
   al miembro nuevo, sin las reglas de chat-start ni los frenos de envío.
   Reemplaza #NOMBRE# (primer nombre del destinatario) y #GRUPO# (nombre de
   la Academy) si la plantilla todavía los trae. Sin push: se manda justo al
   pagar, cuando el miembro todavía no tiene suscripción.
   `onlyIfEmpty` evita duplicarlo si ese DM ya tiene mensajes.
   Devuelve { chatId, messageId } o null si no había nada que mandar. */
export async function postSystemDm(sql, fromMemberId, toMemberId, body, { onlyIfEmpty = false } = {}) {
  const from = intId(fromMemberId)
  const to = intId(toMemberId)
  if (!from || !to || from === to) return null
  let text = String(body ?? "")
  if (text.includes("#NOMBRE#") || text.includes("#GRUPO#")) {
    const [r] = await sql`SELECT name FROM academy_members WHERE id = ${to}`
    let group = HOST.brand.name
    try { group = (await getSettings(sql))?.group?.name || group } catch { /* nombre por defecto */ }
    text = text.replaceAll("#NOMBRE#", rawFirstName(r?.name)).replaceAll("#GRUPO#", group)
  }
  text = cleanText(text, MSG_MAX)
  if (!text) return null

  const chatId = await startDm(sql, from, to)
  const rows = await sql`
    WITH msg AS (
      INSERT INTO academy_messages (chat_id, author_id, body)
      SELECT ${chatId}::int, ${from}::int, ${text}::text
       WHERE NOT (${onlyIfEmpty}::boolean AND EXISTS (SELECT 1 FROM academy_messages WHERE chat_id = ${chatId}))
      RETURNING id, chat_id, created_at
    ), upd AS (
      UPDATE academy_chats c
         SET last_message_id = GREATEST(COALESCE(c.last_message_id, 0), msg.id),
             last_message_at = GREATEST(COALESCE(c.last_message_at, msg.created_at), msg.created_at)
        FROM msg WHERE c.id = msg.chat_id
      RETURNING c.id
    ), rd AS (
      UPDATE academy_chat_members cm
         SET last_read_message_id = GREATEST(cm.last_read_message_id, msg.id)
        FROM msg WHERE cm.chat_id = msg.chat_id AND cm.member_id = ${from}
      RETURNING cm.member_id
    )
    SELECT id FROM msg
  `
  return { chatId, messageId: rows[0]?.id ? Number(rows[0].id) : null }
}

/* Para quien necesite el mismo criterio que chat-start sin crear nada (p. ej.
   `canChat` en el perfil). Devuelve { ok, code?, message? }. */
export async function canStartDm(sql, me, targetId) {
  const target = intId(targetId)
  if (!me?.id || !target || target === Number(me.id)) return { ok: false, code: "invalid" }
  const [row] = await sql`
    SELECT m.id, m.name, m.role, m.status, m.deleted_at IS NOT NULL AS deleted,
           m.prefs->'chat'->>'enabled' AS chat_enabled,
           EXISTS (SELECT 1 FROM academy_blocks b
                    WHERE (b.blocker_id = ${me.id} AND b.blocked_id = m.id)
                       OR (b.blocker_id = m.id AND b.blocked_id = ${me.id})) AS blocked,
           (SELECT count(*)::int FROM academy_likes l WHERE l.author_id = ${me.id} AND l.member_id <> ${me.id}) AS my_points
      FROM academy_members m WHERE m.id = ${target}
  `
  if (!row) return { ok: false, code: "inactive", message: "Este miembro ya no está en la Academy" }
  const gate = await dmGate(sql, me, { id: row.id, name: row.name, role: row.role, status: row.status, deleted: row.deleted, chatEnabled: row.chat_enabled, blocked: row.blocked }, row.my_points)
  return gate.ok ? { ok: true } : { ok: false, code: gate.code, message: gate.message }
}

// ── chats ─────────────────────────────────────────────────────────────────

async function listChats(ctx) {
  const { sql } = ctx
  const me = ctx.member
  const onlyUnread = ctx.query?.filter === "no-leidos"
  // Un DM recién creado con chat-start y sin mensajes no aparece en la lista
  // (igual que Skool): el front ya lo abrió con el chatId que le devolvimos.
  const rows = await sql`
    SELECT c.id, c.kind, c.name, c.cohort_id,
           cm.muted, cm.marked_unread,
           (SELECT count(*)::int FROM academy_messages x
             WHERE x.chat_id = c.id AND x.id > cm.last_read_message_id
               AND x.author_id <> ${me.id} AND x.deleted_at IS NULL) AS unread,
           lm.id AS lm_id, LEFT(lm.body, 200) AS lm_body, lm.author_id AS lm_author,
           jsonb_array_length(COALESCE(lm.attachments, '[]'::jsonb)) AS lm_att,
           lm.deleted_at IS NOT NULL AS lm_deleted,
           to_char(lm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS lm_at,
           o.id AS o_id, o.handle AS o_handle, o.name AS o_name, o.avatar_url AS o_avatar, o.role AS o_role,
           (SELECT count(*)::int FROM academy_likes l WHERE l.author_id = o.id AND l.member_id <> o.id) AS o_points,
           co.id AS co_id, co.name AS co_name, co.cover_url AS co_cover, co.archived_at IS NOT NULL AS co_archived
      FROM academy_chat_members cm
      JOIN academy_chats c ON c.id = cm.chat_id
      LEFT JOIN academy_messages lm ON lm.id = c.last_message_id
      LEFT JOIN LATERAL (
        SELECT m.id, m.handle, m.name, m.avatar_url, m.role
          FROM academy_chat_members ocm
          JOIN academy_members m ON m.id = ocm.member_id
         WHERE c.kind = 'directo' AND ocm.chat_id = c.id AND ocm.member_id <> ${me.id}
         LIMIT 1
      ) o ON true
      LEFT JOIN academy_cohorts co ON c.kind = 'grupo' AND co.id = c.cohort_id
     WHERE cm.member_id = ${me.id}
       AND (c.kind = 'grupo' OR c.last_message_id IS NOT NULL)
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
     LIMIT 200
  `

  // unreadTotal = chats con algo sin leer (o marcados como no leídos), sin
  // contar los silenciados: es el número del globito del ícono de chat.
  let unreadTotal = 0
  const chats = rows.map((r) => {
    const unread = Number(r.unread) || 0
    const hasUnread = unread > 0 || Boolean(r.marked_unread)
    if (hasUnread && !r.muted) unreadTotal++
    const other = r.kind === "directo"
      ? mini({ id: r.o_id, handle: r.o_handle, name: r.o_name, avatar_url: r.o_avatar, role: r.o_role, points: r.o_points })
      : null
    const cohort = r.kind === "grupo" && r.co_id
      ? { id: Number(r.co_id), name: r.co_name, coverUrl: imageOrNull(r.co_cover) }
      : null
    return {
      id: Number(r.id),
      kind: r.kind,
      name: r.kind === "directo" ? (other?.name || "Miembro") : (r.co_name || r.name || "Grupo"),
      other,
      cohort,
      lastMessage: r.lm_id
        ? { body: r.lm_deleted ? "" : (r.lm_body || ""), authorId: Number(r.lm_author), createdAt: r.lm_at, attachments: Number(r.lm_att) || 0 }
        : null,
      unread,
      muted: Boolean(r.muted),
      markedUnread: Boolean(r.marked_unread),
      archived: Boolean(r.co_archived),
    }
  })
  return { chats: onlyUnread ? chats.filter((c) => c.unread > 0 || c.markedUnread) : chats, unreadTotal }
}

async function getChat(ctx) {
  const { sql } = ctx
  const me = ctx.member
  const id = intId(ctx.query?.id)
  if (!id) throw new HttpError(400, "Chat inválido")
  const beforeRaw = ctx.query?.before
  const before = beforeRaw === undefined || beforeRaw === null || beforeRaw === "" ? null : intId(beforeRaw)
  if (beforeRaw && !before) throw new HttpError(400, "Parámetro inválido")

  // La pertenencia va en el JOIN: si no eres miembro, el chat "no existe"
  // (404, no 403 — no se confirma que haya un chat con ese id).
  const [c] = await sql`
    SELECT c.id, c.kind, c.name, c.cohort_id, cm.last_read_message_id, cm.muted, cm.marked_unread,
           co.name AS co_name, co.cover_url AS co_cover, co.archived_at IS NOT NULL AS archived,
           (SELECT COALESCE(max(o.last_read_message_id), 0)::int FROM academy_chat_members o
             WHERE o.chat_id = c.id AND o.member_id <> ${me.id}) AS last_read_by_others
      FROM academy_chats c
      JOIN academy_chat_members cm ON cm.chat_id = c.id AND cm.member_id = ${me.id}
      LEFT JOIN academy_cohorts co ON c.kind = 'grupo' AND co.id = c.cohort_id
     WHERE c.id = ${id}
  `
  if (!c) throw new HttpError(404, "Chat no encontrado")
  const isGroup = c.kind === "grupo"

  const [memberRows, msgRows] = await Promise.all([
    sql`
      SELECT m.id, m.handle, m.name, m.avatar_url, m.role, m.status, m.deleted_at IS NOT NULL AS deleted,
             m.prefs->'chat'->>'enabled' AS chat_enabled,
             (m.last_sync_at > NOW() - interval '90 seconds'
               AND COALESCE(m.prefs->'privacy'->>'hideOnline', 'false') <> 'true') AS online,
             (SELECT count(*)::int FROM academy_likes l WHERE l.author_id = m.id AND l.member_id <> m.id) AS points,
             EXISTS (SELECT 1 FROM academy_blocks b
                      WHERE (b.blocker_id = ${me.id} AND b.blocked_id = m.id)
                         OR (b.blocker_id = m.id AND b.blocked_id = ${me.id})) AS blocked
        FROM academy_chat_members cm
        JOIN academy_members m ON m.id = cm.member_id
       WHERE cm.chat_id = ${id}
       ORDER BY (m.role = 'propietario') DESC, (m.role = 'admin') DESC, m.name ASC
       LIMIT 500
    `,
    // En un Grupo se esconden los mensajes de quien YO bloqueé; en un DM no
    // (ahí el bloqueo ya impide seguir escribiendo y el historial es mío).
    sql`
      SELECT msg.id, msg.chat_id, msg.author_id, msg.body, msg.attachments,
             to_char(msg.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
             a.handle AS a_handle, a.name AS a_name, a.avatar_url AS a_avatar, a.role AS a_role,
             (SELECT count(*)::int FROM academy_likes l WHERE l.author_id = a.id AND l.member_id <> a.id) AS a_points
        FROM academy_messages msg
        JOIN academy_members a ON a.id = msg.author_id
       WHERE msg.chat_id = ${id} AND msg.deleted_at IS NULL
         AND (${before}::int IS NULL OR msg.id < ${before}::int)
         AND (${isGroup}::boolean = false OR msg.author_id = ${me.id}
              OR NOT EXISTS (SELECT 1 FROM academy_blocks b WHERE b.blocker_id = ${me.id} AND b.blocked_id = msg.author_id))
       ORDER BY msg.id DESC
       LIMIT 41
    `,
  ])

  const hasMore = msgRows.length > PAGE
  const messages = msgRows.slice(0, PAGE).reverse().map((r) => messageOut(r, me.id))
  const members = memberRows.filter((m) => !m.deleted && m.status === "activo").map(mini)
  const meRow = memberRows.find((m) => Number(m.id) === Number(me.id))
  const otherRow = isGroup ? null : memberRows.find((m) => Number(m.id) !== Number(me.id)) || null
  const other = otherRow ? mini(otherRow) : null

  // Se calcula acá para que la ventana muestre el motivo (bloqueado, chat
  // apagado, nivel) en vez de dejar escribir y fallar al enviar.
  let canSend = true
  let cantSendReason = null
  if (isGroup) {
    if (c.archived) { canSend = false; cantSendReason = "archived" }
  } else {
    const gate = await dmGate(sql, me, otherRow
      ? { id: otherRow.id, name: otherRow.name, role: otherRow.role, status: otherRow.status, deleted: otherRow.deleted, chatEnabled: otherRow.chat_enabled, blocked: otherRow.blocked }
      : null, meRow?.points)
    if (!gate.ok) { canSend = false; cantSendReason = gate.code }
  }

  return {
    chat: {
      id: Number(c.id),
      kind: c.kind,
      name: isGroup ? (c.co_name || c.name || "Grupo") : (other?.name || "Miembro"),
      other,
      cohort: isGroup && c.cohort_id ? { id: Number(c.cohort_id), name: c.co_name || c.name || "Grupo", coverUrl: imageOrNull(c.co_cover) } : null,
      muted: Boolean(c.muted),
      markedUnread: Boolean(c.marked_unread),
      archived: Boolean(c.archived),
      otherOnline: Boolean(otherRow?.online),
    },
    members,
    messages,
    hasMore,
    lastReadByOthers: Number(c.last_read_by_others) || 0,
    myLastRead: Number(c.last_read_message_id) || 0,
    canSend,
    cantSendReason,
  }
}

async function chatStart(ctx) {
  const { sql } = ctx
  const me = ctx.member
  const target = intId(ctx.body?.memberId)
  if (!target || target === Number(me.id)) throw new HttpError(400, "Miembro inválido")
  const gate = await canStartDm(sql, me, target)
  if (!gate.ok) {
    if (gate.code === "invalid") throw new HttpError(400, "Miembro inválido")
    throw new HttpError(gate.code === "inactive" ? 404 : 403, gate.message || "No puedes chatear con este miembro", gate.code)
  }
  const chatId = await startDm(sql, me.id, target)
  return { chatId }
}

async function chatSend(ctx) {
  const { sql } = ctx
  const me = ctx.member
  const chatId = intId(ctx.body?.chatId)
  if (!chatId) throw new HttpError(400, "Chat inválido")
  const body = cleanText(String(ctx.body?.body ?? ""), MSG_MAX) || ""
  const rawAtt = Array.isArray(ctx.body?.attachments) ? ctx.body.attachments : []
  const uploadIds = intIds(rawAtt.map((a) => a?.uploadId), 4)
  if (!body && !uploadIds.length) throw new HttpError(400, "Escribe un mensaje")
  sendGate(me.id)

  const [c] = await sql`
    SELECT c.id, c.kind, c.cohort_id,
           co.name AS co_name, co.archived_at IS NOT NULL AS archived,
           me.handle AS me_handle, me.avatar_url AS me_avatar,
           (SELECT count(*)::int FROM academy_likes l WHERE l.author_id = ${me.id} AND l.member_id <> ${me.id}) AS my_points,
           o.id AS o_id, o.name AS o_name, o.role AS o_role, o.status AS o_status,
           o.deleted_at IS NOT NULL AS o_deleted, o.prefs->'chat'->>'enabled' AS o_chat_enabled,
           (o.id IS NOT NULL AND EXISTS (SELECT 1 FROM academy_blocks b
                    WHERE (b.blocker_id = ${me.id} AND b.blocked_id = o.id)
                       OR (b.blocker_id = o.id AND b.blocked_id = ${me.id}))) AS blocked
      FROM academy_chats c
      JOIN academy_chat_members cm ON cm.chat_id = c.id AND cm.member_id = ${me.id}
      JOIN academy_members me ON me.id = ${me.id}
      LEFT JOIN academy_cohorts co ON c.kind = 'grupo' AND co.id = c.cohort_id
      LEFT JOIN LATERAL (
        SELECT m.* FROM academy_chat_members ocm JOIN academy_members m ON m.id = ocm.member_id
         WHERE c.kind = 'directo' AND ocm.chat_id = c.id AND ocm.member_id <> ${me.id}
         LIMIT 1
      ) o ON true
     WHERE c.id = ${chatId}
  `
  if (!c) throw new HttpError(404, "Chat no encontrado")
  const isGroup = c.kind === "grupo"
  if (isGroup) {
    if (c.archived) throw new HttpError(409, "Este grupo está archivado", "archived")
  } else {
    const gate = await dmGate(sql, me, c.o_id
      ? { id: c.o_id, name: c.o_name, role: c.o_role, status: c.o_status, deleted: c.o_deleted, chatEnabled: c.o_chat_enabled, blocked: c.blocked }
      : null, c.my_points)
    if (!gate.ok) throw new HttpError(gate.status, gate.message, gate.code)
  }

  // Un solo statement: valida los adjuntos (tienen que ser subidas MÍAS de
  // tipo chat), inserta, mueve last_message_* del chat (GREATEST: dos envíos
  // simultáneos no retroceden el puntero), me marca leído hasta mi propio
  // mensaje y calcula a quién avisar por push: miembros del chat no
  // silenciados, activos, sin sync reciente (si están mirando, el chat ya les
  // llega por sync) y que no me bloquearon. No deja fila de notificación
  // in-app: el globito de chats ya lo cubre (SPEC §5.4).
  const [row] = await sql`
    WITH att AS (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'image', 'uploadId', u.id)
                                ORDER BY array_position(${uploadIds}::int[], u.id)), '[]'::jsonb) AS a
        FROM academy_uploads u
       WHERE u.id = ANY(${uploadIds}::int[]) AND u.member_id = ${me.id} AND u.kind = 'chat'
    ), msg AS (
      INSERT INTO academy_messages (chat_id, author_id, body, attachments)
      SELECT cm.chat_id, ${me.id}::int, ${body}::text, att.a
        FROM academy_chat_members cm, att
       WHERE cm.chat_id = ${chatId} AND cm.member_id = ${me.id}
         AND (length(${body}::text) > 0 OR jsonb_array_length(att.a) > 0)
      RETURNING id, chat_id, body, attachments, created_at
    ), upd AS (
      UPDATE academy_chats c
         SET last_message_id = GREATEST(COALESCE(c.last_message_id, 0), msg.id),
             last_message_at = GREATEST(COALESCE(c.last_message_at, msg.created_at), msg.created_at)
        FROM msg WHERE c.id = msg.chat_id
      RETURNING c.id
    ), rd AS (
      UPDATE academy_chat_members cm
         SET last_read_message_id = GREATEST(cm.last_read_message_id, msg.id), marked_unread = false
        FROM msg WHERE cm.chat_id = msg.chat_id AND cm.member_id = ${me.id}
      RETURNING cm.member_id
    ), rcpt AS (
      SELECT m.id, COALESCE(m.prefs->'chat'->>'previews', 'false') = 'true' AS previews
        FROM msg
        JOIN academy_chat_members ocm ON ocm.chat_id = msg.chat_id AND ocm.member_id <> ${me.id} AND NOT ocm.muted
        JOIN academy_members m ON m.id = ocm.member_id
       WHERE m.status = 'activo' AND m.deleted_at IS NULL
         AND (m.last_sync_at IS NULL OR m.last_sync_at < NOW() - interval '90 seconds')
         AND NOT EXISTS (SELECT 1 FROM academy_blocks b WHERE b.blocker_id = m.id AND b.blocked_id = ${me.id})
    )
    SELECT msg.id, msg.chat_id, msg.body, msg.attachments,
           to_char(msg.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           COALESCE((SELECT json_agg(json_build_object('id', rcpt.id, 'previews', rcpt.previews)) FROM rcpt), '[]'::json) AS recipients
      FROM msg
  `
  // Sin fila: el cuerpo venía vacío y ningún adjunto era válido.
  if (!row) throw new HttpError(400, "El adjunto no es válido")

  const message = messageOut({
    ...row,
    author_id: me.id,
    a_handle: c.me_handle || me.handle,
    a_name: me.name,
    a_avatar: c.me_avatar,
    a_role: me.role,
    a_points: c.my_points,
  }, me.id)

  const recipients = Array.isArray(row.recipients) ? row.recipients : []
  if (recipients.length) {
    await withTimeout(pushChatMessage(sql, {
      chatId,
      isGroup,
      cohortId: c.cohort_id ? Number(c.cohort_id) : null,
      groupName: c.co_name || "Grupo",
      senderName: me.name || "Miembro",
      text: body || (message.attachments.length ? "📷 Imagen" : ""),
      recipients,
    }), 3000)
  }
  return { message }
}

/* La vista previa del texto en la pantalla bloqueada es opt-in de cada
   destinatario (prefs.chat.previews, apagada por defecto): se arman dos
   payloads y se mandan por separado. */
async function pushChatMessage(sql, { chatId, isGroup, cohortId, groupName, senderName, text, recipients }) {
  try {
    const withPreview = recipients.filter((r) => r.previews).map((r) => r.id)
    const without = recipients.filter((r) => !r.previews).map((r) => r.id)
    const url = isGroup && cohortId ? `${HOST.basePath}/grupos/${cohortId}` : `${HOST.basePath}/chat/${chatId}`
    const tag = `aca-chat-${chatId}`
    const title = isGroup ? groupName : senderName
    const jobs = []
    if (withPreview.length) {
      jobs.push(pushToMembers(sql, withPreview, { title, body: isGroup ? `${firstName(senderName)}: ${text}` : text, url, tag }))
    }
    if (without.length) {
      jobs.push(pushToMembers(sql, without, { title, body: isGroup ? `${senderName} escribió en el grupo` : "Te envió un mensaje", url, tag }))
    }
    await Promise.all(jobs)
  } catch (err) {
    console.error("[academy:chat-send] push error:", err?.message || err)
  }
}

async function chatRead(ctx) {
  const { sql } = ctx
  const me = ctx.member
  const chatId = intId(ctx.body?.chatId)
  if (!chatId) throw new HttpError(400, "Chat inválido")
  const raw = ctx.body?.messageId
  const messageId = raw === undefined || raw === null || raw === "" ? null : intId(raw)
  if (raw && !messageId) throw new HttpError(400, "Mensaje inválido")
  // Nunca más allá del último mensaje real (un id inventado no deja el chat
  // "leído" para mensajes futuros) y nunca hacia atrás.
  const rows = await sql`
    UPDATE academy_chat_members cm
       SET last_read_message_id = GREATEST(cm.last_read_message_id,
             LEAST(COALESCE(${messageId}::int, c.last_message_id, 0), COALESCE(c.last_message_id, 0))),
           marked_unread = false
      FROM academy_chats c
     WHERE c.id = cm.chat_id AND cm.chat_id = ${chatId} AND cm.member_id = ${me.id}
    RETURNING cm.last_read_message_id
  `
  if (!rows.length) throw new HttpError(404, "Chat no encontrado")
  return { myLastRead: Number(rows[0].last_read_message_id) || 0 }
}

async function chatsReadAll(ctx) {
  const { sql } = ctx
  const me = ctx.member
  await sql`
    UPDATE academy_chat_members cm
       SET last_read_message_id = GREATEST(cm.last_read_message_id, COALESCE(c.last_message_id, 0)),
           marked_unread = false
      FROM academy_chats c
     WHERE c.id = cm.chat_id AND cm.member_id = ${me.id}
       AND (cm.last_read_message_id < COALESCE(c.last_message_id, 0) OR cm.marked_unread)
  `
  return {}
}

async function chatMute(ctx) {
  const { sql } = ctx
  const me = ctx.member
  const chatId = intId(ctx.body?.chatId)
  if (!chatId) throw new HttpError(400, "Chat inválido")
  const muted = ctx.body?.muted === true
  const rows = await sql`
    UPDATE academy_chat_members SET muted = ${muted}
     WHERE chat_id = ${chatId} AND member_id = ${me.id}
    RETURNING muted
  `
  if (!rows.length) throw new HttpError(404, "Chat no encontrado")
  return { muted: Boolean(rows[0].muted) }
}

async function chatMarkUnread(ctx) {
  const { sql } = ctx
  const me = ctx.member
  const chatId = intId(ctx.body?.chatId)
  if (!chatId) throw new HttpError(400, "Chat inválido")
  const rows = await sql`
    UPDATE academy_chat_members SET marked_unread = true
     WHERE chat_id = ${chatId} AND member_id = ${me.id}
    RETURNING chat_id
  `
  if (!rows.length) throw new HttpError(404, "Chat no encontrado")
  return {}
}

// ── bloqueos ──────────────────────────────────────────────────────────────

async function blockMember(ctx) {
  const { sql } = ctx
  const me = ctx.member
  const target = intId(ctx.body?.memberId)
  if (!target || target === Number(me.id)) throw new HttpError(400, "Miembro inválido")
  const block = ctx.body?.block !== false
  if (block) {
    const rows = await sql`
      WITH t AS (SELECT id FROM academy_members WHERE id = ${target} AND deleted_at IS NULL),
      ins AS (
        INSERT INTO academy_blocks (blocker_id, blocked_id)
        SELECT ${me.id}::int, t.id FROM t
        ON CONFLICT DO NOTHING
        RETURNING blocked_id
      )
      SELECT id FROM t
    `
    if (!rows.length) throw new HttpError(404, "Miembro no encontrado")
  } else {
    await sql`DELETE FROM academy_blocks WHERE blocker_id = ${me.id} AND blocked_id = ${target}`
  }
  return { blocked: block }
}

async function listBlocks(ctx) {
  const { sql } = ctx
  const me = ctx.member
  const rows = await sql`
    SELECT m.id, m.handle, m.name, m.avatar_url, m.role,
           (SELECT count(*)::int FROM academy_likes l WHERE l.author_id = m.id AND l.member_id <> m.id) AS points
      FROM academy_blocks b
      JOIN academy_members m ON m.id = b.blocked_id
     WHERE b.blocker_id = ${me.id}
     ORDER BY b.created_at DESC
     LIMIT 500
  `
  return { members: rows.map(mini) }
}

// ── sync ──────────────────────────────────────────────────────────────────

function parseIso(v) {
  if (typeof v !== "string" || !v || v.length > 40) return null
  const t = Date.parse(v)
  if (!Number.isFinite(t)) return null
  // No más de 30 días atrás: el conteo de publicaciones nuevas es para el
  // aviso "Hay N publicaciones nuevas", no para recorrer la historia.
  return new Date(Math.max(t, Date.now() - 30 * 86_400_000)).toISOString()
}

async function sync(ctx) {
  const { sql } = ctx
  const me = ctx.member
  syncGate(me.id)
  const chatId = intId(ctx.query?.chat)
  const sinceRaw = ctx.query?.since
  // `since` = último id de mensaje que el cliente ya tiene. Sin `since` no se
  // mandan mensajes: la carga inicial es `chat` (que pagina); acá solo lo
  // nuevo, para que un sync sin parámetro no baje la historia entera.
  const since = sinceRaw === "0" || sinceRaw === 0 ? 0 : intId(sinceRaw)
  const feedSince = parseIso(ctx.query?.feedSince)
  const staff = isStaffRole(me.role)

  // UN viaje a la base. `touch` es un CTE que escribe: Postgres lo ejecuta
  // aunque nadie lea su salida. Escribe la presencia (last_sync_at → "En
  // línea", last_seen_at → "Activo hace X") a lo más una vez por minuto, que
  // con la ventana de 90 s de "en línea" alcanza de sobra.
  const [r] = await sql`
    WITH touch AS (
      UPDATE academy_members SET last_sync_at = NOW(), last_seen_at = NOW()
       WHERE id = ${me.id} AND (last_sync_at IS NULL OR last_sync_at < NOW() - interval '60 seconds')
      RETURNING id
    ), mychats AS (
      SELECT cm.chat_id, cm.last_read_message_id, cm.marked_unread, cm.muted, c.kind
        FROM academy_chat_members cm
        JOIN academy_chats c ON c.id = cm.chat_id
       WHERE cm.member_id = ${me.id}
    ), openchat AS (
      SELECT chat_id, kind FROM mychats WHERE chat_id = ${chatId}::int
    ), msgs AS (
      SELECT msg.id, msg.chat_id, msg.author_id, msg.body, msg.attachments,
             to_char(msg.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
             a.handle AS a_handle, a.name AS a_name, a.avatar_url AS a_avatar, a.role AS a_role,
             (SELECT count(*)::int FROM academy_likes l WHERE l.author_id = a.id AND l.member_id <> a.id) AS a_points
        FROM academy_messages msg
        JOIN openchat oc ON oc.chat_id = msg.chat_id
        JOIN academy_members a ON a.id = msg.author_id
       WHERE ${since}::int IS NOT NULL AND msg.id > ${since}::int AND msg.deleted_at IS NULL
         AND (oc.kind <> 'grupo' OR msg.author_id = ${me.id}
              OR NOT EXISTS (SELECT 1 FROM academy_blocks b WHERE b.blocker_id = ${me.id} AND b.blocked_id = msg.author_id))
       ORDER BY msg.id ASC
       LIMIT 100
    )
    SELECT
      (SELECT count(*)::int FROM academy_notifications n WHERE n.member_id = ${me.id} AND n.read_at IS NULL) AS unread_notifications,
      (SELECT count(*)::int FROM mychats mc
        WHERE NOT mc.muted
          AND (mc.marked_unread OR EXISTS (
                SELECT 1 FROM academy_messages x
                 WHERE x.chat_id = mc.chat_id AND x.id > mc.last_read_message_id
                   AND x.author_id <> ${me.id} AND x.deleted_at IS NULL))) AS unread_chats,
      (SELECT COALESCE(json_agg(msgs ORDER BY msgs.id), '[]'::json) FROM msgs) AS messages,
      (SELECT COALESCE(max(o.last_read_message_id), 0)::int
         FROM academy_chat_members o JOIN openchat oc ON oc.chat_id = o.chat_id
        WHERE o.member_id <> ${me.id}) AS last_read_by_others,
      CASE WHEN ${feedSince}::timestamptz IS NULL THEN 0 ELSE (
        SELECT count(*)::int FROM (
          SELECT 1 FROM academy_posts p
            LEFT JOIN academy_categories cat ON cat.id = p.category_id
           WHERE p.deleted_at IS NULL
             AND p.created_at > ${feedSince}::timestamptz
             AND p.author_id <> ${me.id}
             AND (cat.cohort_id IS NULL OR ${staff}::boolean
                  OR EXISTS (SELECT 1 FROM academy_cohort_members x WHERE x.cohort_id = cat.cohort_id AND x.member_id = ${me.id}))
           LIMIT 100
        ) q
      ) END AS new_posts,
      (SELECT count(*)::int FROM academy_members m
        WHERE m.status = 'activo' AND m.deleted_at IS NULL
          AND m.last_sync_at > NOW() - interval '90 seconds'
          AND COALESCE(m.prefs->'privacy'->>'hideOnline', 'false') <> 'true') AS online_count,
      to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS server_time
  `

  const messages = (Array.isArray(r?.messages) ? r.messages : []).map((m) => messageOut(m, me.id))
  return {
    unreadNotifications: Number(r?.unread_notifications) || 0,
    unreadChats: Number(r?.unread_chats) || 0,
    messages,
    lastReadByOthers: Number(r?.last_read_by_others) || 0,
    newPosts: Number(r?.new_posts) || 0,
    onlineCount: Number(r?.online_count) || 0,
    serverTime: r?.server_time || null,
  }
}

// ── push ──────────────────────────────────────────────────────────────────

// Solo servicios de push reales. El servidor le hace un POST al endpoint
// guardado cada vez que hay un aviso: aceptar cualquier URL convertiría esta
// ruta en un "haz que el servidor le pegue a donde yo diga" (SSRF).
const PUSH_HOST_RE = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/i
const KEY_RE = /^[A-Za-z0-9_\-+/=]{16,200}$/

function validEndpoint(e) {
  if (typeof e !== "string" || e.length > 1000) return false
  try {
    const u = new URL(e)
    return u.protocol === "https:" && !u.username && !u.password && (u.port === "" || u.port === "443") && PUSH_HOST_RE.test(u.hostname)
  } catch {
    return false
  }
}

async function pushSubscribe(ctx) {
  const { sql } = ctx
  const me = ctx.member
  const sub = ctx.body?.subscription || {}
  const endpoint = sub.endpoint
  const p256dh = sub.keys?.p256dh
  const auth = sub.keys?.auth
  if (!validEndpoint(endpoint) || !KEY_RE.test(String(p256dh || "")) || !KEY_RE.test(String(auth || ""))) {
    throw new HttpError(400, "Suscripción inválida")
  }
  // ON CONFLICT (endpoint): UNIQUE simple. Si el mismo navegador ya estaba a
  // nombre de otro miembro (cerró sesión y entró otro), pasa a este.
  await sql`
    INSERT INTO academy_push_subscriptions (member_id, endpoint, p256dh, auth)
    VALUES (${me.id}, ${endpoint}, ${p256dh}, ${auth})
    ON CONFLICT (endpoint) DO UPDATE
      SET member_id = EXCLUDED.member_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, created_at = NOW()
  `
  // Tope de 10 dispositivos por miembro: los endpoints viejos que el servicio
  // nunca contestó con 404/410 se acumularían para siempre.
  await sql`
    DELETE FROM academy_push_subscriptions
     WHERE member_id = ${me.id}
       AND id NOT IN (SELECT id FROM academy_push_subscriptions WHERE member_id = ${me.id}
                       ORDER BY created_at DESC, id DESC LIMIT 10)
  `.catch((err) => console.error("[academy:push-subscribe] prune error:", err?.message || err))
  return {}
}

async function pushUnsubscribe(ctx) {
  const { sql } = ctx
  const me = ctx.member
  const endpoint = ctx.body?.endpoint
  if (typeof endpoint !== "string" || !endpoint || endpoint.length > 1000) throw new HttpError(400, "endpoint requerido")
  await sql`DELETE FROM academy_push_subscriptions WHERE endpoint = ${endpoint} AND member_id = ${me.id}`
  return {}
}

// ── Grupos (cohorts) ──────────────────────────────────────────────────────

/* Consulta común de cohorts. `oneId` null = todos; `all` = sin filtro de
   visibilidad (staff, o el chequeo lo hace quien llama). */
function cohortRows(sql, { viewerId, oneId = null, all = false }) {
  return sql`
    SELECT co.id, co.name, co.description, co.cover_url, co.course_id,
           to_char(co.starts_on, 'YYYY-MM-DD') AS starts_on, co.seats, co.sales_open, co.chat_id,
           to_char(co.archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS archived_at,
           c.slug AS course_slug, c.title AS course_title,
           (SELECT count(*)::int FROM academy_cohort_members x
              JOIN academy_members m ON m.id = x.member_id
             WHERE x.cohort_id = co.id AND m.status = 'activo' AND m.deleted_at IS NULL) AS member_count,
           EXISTS (SELECT 1 FROM academy_cohort_members x WHERE x.cohort_id = co.id AND x.member_id = ${viewerId}::int) AS is_member,
           EXISTS (SELECT 1 FROM academy_chat_members y WHERE y.chat_id = co.chat_id AND y.member_id = ${viewerId}::int) AS in_chat
      FROM academy_cohorts co
      LEFT JOIN academy_courses c ON c.id = co.course_id
     WHERE (${oneId}::int IS NULL OR co.id = ${oneId}::int)
       AND (${all}::boolean
            OR (co.archived_at IS NULL
                AND EXISTS (SELECT 1 FROM academy_cohort_members x WHERE x.cohort_id = co.id AND x.member_id = ${viewerId}::int)))
     ORDER BY (co.archived_at IS NOT NULL), co.starts_on DESC NULLS LAST, co.id DESC
     LIMIT 200
  `
}

function cohortOut(r) {
  return {
    id: Number(r.id),
    name: r.name,
    description: r.description || "",
    coverUrl: imageOrNull(r.cover_url),
    course: r.course_slug ? { slug: r.course_slug, title: r.course_title } : null,
    courseId: r.course_id ? Number(r.course_id) : null,
    startsOn: r.starts_on || null,
    seats: r.seats === null || r.seats === undefined ? null : Number(r.seats),
    salesOpen: Boolean(r.sales_open),
    archived: Boolean(r.archived_at),
    archivedAt: r.archived_at || null,
    memberCount: Number(r.member_count) || 0,
    // El chatId va siempre; `inChat` dice si el que mira puede abrirlo (un
    // moderador que no es del cohort lo ve en la lista pero su chat da 404).
    chatId: r.chat_id ? Number(r.chat_id) : null,
    isMember: Boolean(r.is_member),
    inChat: Boolean(r.in_chat),
  }
}

async function listCohorts(ctx) {
  const me = ctx.member
  const rows = await cohortRows(ctx.sql, { viewerId: me.id, all: isStaffRole(me.role) })
  return { cohorts: rows.map(cohortOut) }
}

async function getCohort(ctx) {
  const { sql } = ctx
  const me = ctx.member
  const id = intId(ctx.query?.id)
  if (!id) throw new HttpError(400, "Grupo inválido")
  const [rows, memberRows] = await Promise.all([
    cohortRows(sql, { viewerId: me.id, oneId: id, all: true }),
    sql`
      SELECT m.id, m.handle, m.name, m.avatar_url, m.role,
             (SELECT count(*)::int FROM academy_likes l WHERE l.author_id = m.id AND l.member_id <> m.id) AS points
        FROM academy_cohort_members x
        JOIN academy_members m ON m.id = x.member_id
       WHERE x.cohort_id = ${id} AND m.status = 'activo' AND m.deleted_at IS NULL
       ORDER BY x.added_at ASC, m.id ASC
       LIMIT 500
    `,
  ])
  const row = rows[0]
  if (!row) throw new HttpError(404, "Grupo no encontrado")
  if (!row.is_member && !isStaffRole(me.role)) throw new HttpError(403, "Este grupo es privado", "private")
  const cohort = cohortOut(row)
  return { cohort, members: memberRows.map(mini), chatId: cohort.chatId, isMember: cohort.isMember }
}

// ── archivos privados ─────────────────────────────────────────────────────

const SAFE_IMAGE_TYPES = new Set(["image/webp", "image/jpeg", "image/png"])

/* Sirve un blob de academy_uploads (los del chat son privados) solo si quien
   lo pide lo subió, es staff (moderar un reporte), o es miembro de un chat
   con un mensaje vivo que lo referencia. La respuesta la escribe el handler
   (no es JSON) y devuelve undefined, como pide el router. */
async function serveFile(ctx) {
  const { sql, res } = ctx
  const me = ctx.member
  const id = intId(ctx.query?.id)
  if (!id) throw new HttpError(400, "Archivo inválido")
  const staff = isStaffRole(me.role)
  const [row] = await sql`
    SELECT u.id, u.url, u.private
      FROM academy_uploads u
     WHERE u.id = ${id}
       AND (u.member_id = ${me.id} OR ${staff}::boolean OR EXISTS (
             SELECT 1 FROM academy_chat_members cm
               JOIN academy_messages msg ON msg.chat_id = cm.chat_id
              WHERE cm.member_id = ${me.id} AND msg.deleted_at IS NULL
                AND msg.attachments @> ${JSON.stringify([{ uploadId: id }])}::jsonb))
  `
  // Mismo 404 exista o no: no se confirma que haya un archivo con ese id.
  if (!row) throw new HttpError(404, "Archivo no encontrado")

  let host = ""
  try { host = new URL(row.url).hostname } catch { /* URL rota → 404 abajo */ }
  if (!host.endsWith(".blob.vercel-storage.com")) throw new HttpError(404, "Archivo no encontrado")

  const token = process.env.BLOB_READ_WRITE_TOKEN || undefined
  let result = null
  try {
    const { get } = await import("@vercel/blob")
    result = await get(row.url, { access: row.private ? "private" : "public", token, abortSignal: AbortSignal.timeout(8000) })
  } catch (err) {
    console.error("[academy:file] blob error:", err?.message || err)
    throw new HttpError(502, "No se pudo cargar el archivo")
  }
  if (!result || result.statusCode !== 200 || !result.stream) throw new HttpError(404, "Archivo no encontrado")

  // Las subidas son ≤ 2 MB (SPEC §5.2): se bufferea en vez de hacer pipe del
  // stream web, que en el runtime de Node de Vercel es más frágil.
  const buf = Buffer.from(await new Response(result.stream).arrayBuffer())
  if (buf.length > 5 * 1024 * 1024) throw new HttpError(413, "Archivo demasiado grande")

  const type = String(result.blob?.contentType || "").split(";")[0].trim().toLowerCase()
  res.statusCode = 200
  if (SAFE_IMAGE_TYPES.has(type)) {
    res.setHeader("Content-Type", type)
  } else {
    // Nunca se sirve otra cosa "inline" desde nuestro origen: el panel vive
    // acá y un HTML/SVG subido de alguna forma podría leer su token.
    res.setHeader("Content-Type", "application/octet-stream")
    res.setHeader("Content-Disposition", "attachment")
  }
  res.setHeader("Content-Length", String(buf.length))
  res.setHeader("Cache-Control", "private, max-age=300")
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin")
  res.end(buf)
  return undefined
}

// ── admin de Grupos ───────────────────────────────────────────────────────

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key)
}

function parseDateOnly(v) {
  if (v === null || v === undefined || v === "") return null
  const s = String(v)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return undefined
  return s
}

async function adminCohortSave(ctx) {
  const { sql } = ctx
  const b = ctx.body || {}
  const actorId = ctx.admin?.memberId ?? ctx.member?.id ?? null
  const createdBy = actorId ?? ctx.admin?.barberId ?? null
  const id = has(b, "id") && b.id !== null && b.id !== "" ? intId(b.id) : null
  if (has(b, "id") && b.id !== null && b.id !== "" && !id) throw new HttpError(400, "Grupo inválido")

  const name = cleanLine(String(b.name ?? ""), 80) || ""
  if ((!id || has(b, "name")) && !name) throw new HttpError(400, "El grupo necesita un nombre")
  const description = has(b, "description") ? (cleanText(String(b.description ?? ""), 2000) || null) : null

  let coverUrl = null
  if (has(b, "coverUrl") && b.coverUrl) {
    coverUrl = imageOrNull(String(b.coverUrl))
    if (!coverUrl) throw new HttpError(400, "La portada tiene que ser una imagen subida a la Academy")
  }

  let courseId = null
  if (has(b, "courseId") && b.courseId !== null && b.courseId !== "") {
    courseId = intId(b.courseId)
    if (!courseId) throw new HttpError(400, "Curso inválido")
    const [course] = await sql`SELECT id FROM academy_courses WHERE id = ${courseId}`
    if (!course) throw new HttpError(400, "Ese curso no existe")
  }

  const startsOn = has(b, "startsOn") ? parseDateOnly(b.startsOn) : null
  if (startsOn === undefined) throw new HttpError(400, "Fecha de inicio inválida")

  let seats = null
  if (has(b, "seats") && b.seats !== null && b.seats !== "") {
    seats = Number(b.seats)
    if (!Number.isInteger(seats) || seats < 1 || seats > 10000) throw new HttpError(400, "Cupos inválidos")
  }
  const salesOpen = b.salesOpen === true

  let cohortId = id
  if (!id) {
    // Cohort y su chat nacen juntos, en un statement (SPEC §0.5): el id del
    // cohort se reserva con nextval para que el chat lo lleve desde el
    // INSERT (un UPDATE no vería la fila insertada en el mismo statement).
    const rows = await sql`
      WITH ids AS (
        SELECT nextval(pg_get_serial_sequence('academy_cohorts', 'id'))::int AS cid
      ), ch AS (
        INSERT INTO academy_chats (kind, cohort_id, name)
        SELECT 'grupo', ids.cid, ${name}::text FROM ids
        RETURNING id, cohort_id
      ), co AS (
        INSERT INTO academy_cohorts (id, name, description, cover_url, course_id, starts_on, seats, sales_open, chat_id, created_by)
        SELECT ch.cohort_id, ${name}::text, ${description}::text, ${coverUrl}::text, ${courseId}::int, ${startsOn}::date, ${seats}::int, ${salesOpen}::boolean, ch.id, ${createdBy}::int
          FROM ch
        RETURNING id
      )
      SELECT id FROM co
    `
    cohortId = Number(rows[0].id)
  } else {
    // "Dejar como está" lo que no vino (SPEC §0.5): el panel puede mandar
    // solo el interruptor de ventas sin borrar el resto. Un grupo archivado
    // no puede quedar con ventas abiertas.
    const rows = await sql`
      WITH co AS (
        UPDATE academy_cohorts SET
          name        = CASE WHEN ${has(b, "name")}::boolean THEN ${name} ELSE name END,
          description = CASE WHEN ${has(b, "description")}::boolean THEN ${description} ELSE description END,
          cover_url   = CASE WHEN ${has(b, "coverUrl")}::boolean THEN ${coverUrl} ELSE cover_url END,
          course_id   = CASE WHEN ${has(b, "courseId")}::boolean THEN ${courseId}::int ELSE course_id END,
          starts_on   = CASE WHEN ${has(b, "startsOn")}::boolean THEN ${startsOn}::date ELSE starts_on END,
          seats       = CASE WHEN ${has(b, "seats")}::boolean THEN ${seats}::int ELSE seats END,
          sales_open  = CASE WHEN ${has(b, "salesOpen")}::boolean THEN (${salesOpen}::boolean AND archived_at IS NULL) ELSE sales_open END,
          updated_at  = NOW()
         WHERE id = ${id}
        RETURNING id, name, chat_id
      ), ch AS (
        UPDATE academy_chats c SET name = co.name FROM co WHERE c.id = co.chat_id
        RETURNING c.id
      )
      SELECT id FROM co
    `
    if (!rows.length) throw new HttpError(404, "Grupo no encontrado")
  }

  // Deja adentro del chat a propietario/admins (y repara un chat que falte).
  await ensureCohortChat(sql, cohortId)
  const [row] = await cohortRows(sql, { viewerId: actorId, oneId: cohortId, all: true })
  return { cohort: row ? cohortOut(row) : null }
}

async function adminCohortMembers(ctx) {
  const { sql } = ctx
  const b = ctx.body || {}
  const cohortId = intId(b.cohortId)
  if (!cohortId) throw new HttpError(400, "Grupo inválido")
  const add = intIds(b.add, 200)
  const remove = intIds(b.remove, 200)
  const [co] = await sql`SELECT id, archived_at IS NOT NULL AS archived FROM academy_cohorts WHERE id = ${cohortId}`
  if (!co) throw new HttpError(404, "Grupo no encontrado")
  if (add.length && co.archived) throw new HttpError(409, "El grupo está archivado", "archived")

  if (add.length) await addToCohort(sql, cohortId, add, { actorId: ctx.admin?.memberId ?? ctx.member?.id ?? null })
  if (remove.length) await removeFromCohort(sql, cohortId, remove)

  const [cnt] = await sql`
    SELECT count(*)::int AS n FROM academy_cohort_members x
      JOIN academy_members m ON m.id = x.member_id
     WHERE x.cohort_id = ${cohortId} AND m.status = 'activo' AND m.deleted_at IS NULL
  `
  return { memberCount: Number(cnt?.n) || 0 }
}

async function adminCohortArchive(ctx) {
  const { sql } = ctx
  const id = intId(ctx.body?.id)
  if (!id) throw new HttpError(400, "Grupo inválido")
  // `archived:false` lo reactiva (el panel necesita deshacer un archivado).
  // Archivar cierra las ventas: una generación archivada no se vende.
  const archived = ctx.body?.archived !== false
  const rows = await sql`
    UPDATE academy_cohorts
       SET archived_at = CASE WHEN ${archived}::boolean THEN COALESCE(archived_at, NOW()) ELSE NULL END,
           sales_open  = CASE WHEN ${archived}::boolean THEN false ELSE sales_open END,
           updated_at  = NOW()
     WHERE id = ${id}
    RETURNING id
  `
  if (!rows.length) throw new HttpError(404, "Grupo no encontrado")
  return { archived }
}

// ── tabla del router ──────────────────────────────────────────────────────

export const handlers = {
  "chats": listChats,
  "chat": getChat,
  "chat-start": chatStart,
  "chat-send": chatSend,
  "chat-read": chatRead,
  "chats-read-all": chatsReadAll,
  "chat-mute": chatMute,
  "chat-mark-unread": chatMarkUnread,
  "block": blockMember,
  "blocks": listBlocks,
  "sync": sync,
  "push-subscribe": pushSubscribe,
  "push-unsubscribe": pushUnsubscribe,
  "cohorts": listCohorts,
  "cohort": getCohort,
  "file": serveFile,
  "admin-cohort-save": adminCohortSave,
  "admin-cohort-members": adminCohortMembers,
  "admin-cohort-archive": adminCohortArchive,
}
