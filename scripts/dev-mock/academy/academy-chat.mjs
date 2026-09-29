/* Mock de Academy — Chats, Grupos, sync y push (SPEC §5.4).

   Espejo de api/_academyChat.js: chats directos y de Grupo, mensajes,
   leídos/silenciados, bloqueos, `sync` (el único modo que se consulta
   periódicamente), suscripción push, Grupos (salas / generaciones) y el
   archivo privado de un adjunto.

   Reglas que se imitan tal cual, para poder probar IDOR en dev: un chat
   ajeno responde 404 (no 403, no revela que existe); un DM entre bloqueados
   es un 403 genérico; el chat apagado del otro es `chat_off`; el mínimo de
   nivel para chatear (`plugins.minChatLevel`) frena a quien no es staff; un
   archivo privado solo lo baja quien puede ver un mensaje que lo usa (o
   quien lo subió, o el staff).

   DEV_MOCK_BOTS=1 (solo en el mock): 8 s después de que alguien escribe en
   un chat, otro miembro del chat contesta; y cada 2 minutos un miembro
   publica algo nuevo en Comunidad. Sirve para ver `sync` en acción, el
   separador "Nuevos mensajes" y "Cargar N publicaciones nuevas". Los
   temporizadores arrancan recién con la primera llamada de chat/sync (no al
   importar) y no mantienen vivo el proceso (`unref`). */

import {
  fail, rows, removeWhere, toInt, toBool, has, msOf, toIso, nowIso, nextIdOf, cut, cleanText, safeUrl, isImageUrl,
  memberRow, isActive, staffRow, needMember, needAdmin, actorId, mini, isOnline, isBlocked,
  dmBlockReason, notifyMember, unreadNotifCount, canSeePostRow, visibleCategories, createPost, dayOfKey,
} from './academy-community.mjs'

const PAGE_MESSAGES = 40
const SYNC_MIN_MS = 4000
const SYNC_WRITE_MS = 60_000
const SEND_WINDOW_MS = 60_000
const SEND_MAX = 20

/* ── Filas y membresías ── */
const chatRow = (st, id) => (id == null ? null : rows(st, 'academy_chats').find((c) => c.id === id) || null)
const cohortRow = (st, id) => (id == null ? null : rows(st, 'academy_cohorts').find((c) => c.id === id) || null)
const membership = (st, chatId, memberId) =>
  rows(st, 'academy_chat_members').find((r) => r.chat_id === chatId && r.member_id === memberId) || null
const chatMemberIds = (st, chatId) => rows(st, 'academy_chat_members').filter((r) => r.chat_id === chatId).map((r) => r.member_id)
const liveMessages = (st, chatId) => rows(st, 'academy_messages').filter((m) => m.chat_id === chatId && !m.deleted_at)
const cohortMemberIds = (st, cohortId) => rows(st, 'academy_cohort_members').filter((r) => r.cohort_id === cohortId).map((r) => r.member_id)
const dmOther = (st, chat, meId) => (chat.kind === 'directo' ? chatMemberIds(st, chat.id).find((id) => id !== meId) ?? null : null)

function unreadIn(st, chat, cm) {
  const last = cm.last_read_message_id || 0
  return rows(st, 'academy_messages').filter((m) => m.chat_id === chat.id && !m.deleted_at && m.id > last && m.author_id !== cm.member_id).length
}

// Chats que cuentan para el globito: con mensajes sin leer (o marcados como
// no leídos a mano) y sin silenciar.
function unreadChatsCount(st, memberId) {
  let n = 0
  for (const cm of rows(st, 'academy_chat_members')) {
    if (cm.member_id !== memberId || cm.muted) continue
    const chat = chatRow(st, cm.chat_id)
    if (chat && (cm.marked_unread || unreadIn(st, chat, cm) > 0)) n++
  }
  return n
}

function addChatMember(ctx, chatId, memberId) {
  if (membership(ctx.state, chatId, memberId)) return false
  const last = liveMessages(ctx.state, chatId).reduce((a, m) => Math.max(a, m.id), 0)
  // Quien entra a un chat con historia no ve todo como "no leído".
  rows(ctx.state, 'academy_chat_members').push({
    chat_id: chatId, member_id: memberId, last_read_message_id: last, muted: false, marked_unread: false, joined_at: nowIso(ctx),
  })
  return true
}

/* ── Proyecciones ── */
export function messageShape(ctx, msg, viewerId) {
  const att = Array.isArray(msg.attachments) ? msg.attachments : []
  return {
    id: msg.id,
    chatId: msg.chat_id,
    author: mini(ctx, msg.author_id),
    body: msg.body || '',
    // Adjuntos privados: siempre por el proxy con sesión, nunca la URL del blob.
    attachments: att.map((a) => {
      const uploadId = toInt(a?.uploadId)
      if (uploadId != null) return { kind: 'image', url: `/api/academy?mode=file&id=${uploadId}` }
      return a && isImageUrl(a.url) ? { kind: 'image', url: safeUrl(a.url) || a.url } : null
    }).filter(Boolean),
    createdAt: toIso(msg.created_at),
    mine: msg.author_id === viewerId,
  }
}

const cohortMini = (c) => (c ? { id: c.id, name: c.name, coverUrl: c.cover_url && isImageUrl(c.cover_url) ? c.cover_url : null } : null)

function chatHeader(ctx, chat, me) {
  const st = ctx.state
  const otherId = dmOther(st, chat, me.id)
  const other = otherId != null ? mini(ctx, otherId) : null
  const cohort = chat.kind === 'grupo' ? cohortRow(st, chat.cohort_id) : null
  const name = chat.kind === 'directo' ? other?.name || 'Chat' : chat.name || cohort?.name || 'Grupo'
  return { id: chat.id, kind: chat.kind, name, other, cohort: cohortMini(cohort) }
}

function chatSummary(ctx, chat, cm, me) {
  const st = ctx.state
  const last = liveMessages(st, chat.id).reduce((a, m) => (!a || m.id > a.id ? m : a), null)
  return {
    ...chatHeader(ctx, chat, me),
    lastMessage: last ? { body: last.body || '', authorId: last.author_id, createdAt: toIso(last.created_at) } : null,
    unread: unreadIn(st, chat, cm),
    muted: !!cm.muted,
    markedUnread: !!cm.marked_unread,
    _lastAt: last ? msOf(last.created_at) || 0 : msOf(chat.created_at) || 0,
  }
}

function cohortShape(ctx, c, viewer, withAdmin = false) {
  const st = ctx.state
  const course = c.course_id != null ? rows(st, 'academy_courses').find((x) => x.id === c.course_id) : null
  const out = {
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    coverUrl: c.cover_url && isImageUrl(c.cover_url) ? c.cover_url : null,
    course: course ? { slug: course.slug, title: course.title } : null,
    startsOn: c.starts_on ? String(c.starts_on).slice(0, 10) : null,
    memberCount: cohortMemberIds(st, c.id).length,
    chatId: c.chat_id ?? null,
    isMember: !!viewer && cohortMemberIds(st, c.id).includes(viewer.id),
  }
  if (withAdmin) Object.assign(out, { seats: c.seats ?? null, salesOpen: !!c.sales_open, archivedAt: toIso(c.archived_at) })
  return out
}

/* ══ Ayudas para otros archivos del mock (espejo de SPEC §16) ═════════════
   El primer argumento es `{ state, lib }` (el equivalente del `sql` real).
   Las usa la provisión del checkout del mock (Grupo al comprar, AutoDM). */

export function ensureCohortChat(ctx, cohortId) {
  const st = ctx.state
  const cohort = cohortRow(st, cohortId)
  if (!cohort) return null
  let chat = chatRow(st, cohort.chat_id)
  if (!chat) {
    chat = {
      id: nextIdOf(ctx, 'academy_chats'), kind: 'grupo', dm_key: null, cohort_id: cohort.id, name: cohort.name,
      last_message_id: null, last_message_at: null, created_at: nowIso(ctx),
    }
    rows(st, 'academy_chats').push(chat)
    cohort.chat_id = chat.id
  }
  for (const id of cohortMemberIds(st, cohort.id)) addChatMember(ctx, chat.id, id)
  return chat.id
}

export function addToCohort(ctx, cohortId, memberIds) {
  const st = ctx.state
  const cohort = cohortRow(st, cohortId)
  if (!cohort) return []
  const chatId = ensureCohortChat(ctx, cohortId)
  const added = []
  const list = rows(st, 'academy_cohort_members')
  for (const id of new Set(memberIds)) {
    if (!isActive(memberRow(st, id))) continue
    if (!list.some((r) => r.cohort_id === cohortId && r.member_id === id)) {
      list.push({ cohort_id: cohortId, member_id: id, added_at: nowIso(ctx) })
      added.push(id)
    }
    if (chatId != null) addChatMember(ctx, chatId, id)
  }
  return added
}

export function startDm(ctx, fromId, toId) {
  const st = ctx.state
  const key = `${Math.min(fromId, toId)}:${Math.max(fromId, toId)}`
  let chat = rows(st, 'academy_chats').find((c) => c.dm_key === key)
  if (!chat) {
    chat = {
      id: nextIdOf(ctx, 'academy_chats'), kind: 'directo', dm_key: key, cohort_id: null, name: null,
      last_message_id: null, last_message_at: null, created_at: nowIso(ctx),
    }
    rows(st, 'academy_chats').push(chat)
  }
  addChatMember(ctx, chat.id, fromId)
  addChatMember(ctx, chat.id, toId)
  return chat.id
}

function postMessage(ctx, chat, authorId, body, attachments = []) {
  const now = nowIso(ctx)
  const msg = { id: nextIdOf(ctx, 'academy_messages'), chat_id: chat.id, author_id: authorId, body, attachments, created_at: now, deleted_at: null }
  rows(ctx.state, 'academy_messages').push(msg)
  chat.last_message_id = msg.id
  chat.last_message_at = now
  const cm = membership(ctx.state, chat.id, authorId)
  if (cm) {
    cm.last_read_message_id = msg.id
    cm.marked_unread = false
  }
  return msg
}

// AutoDM y avisos del sistema: sin límites de envío ni reglas de nivel.
export function postSystemDm(ctx, fromMemberId, toMemberId, body) {
  const chatId = startDm(ctx, fromMemberId, toMemberId)
  const chat = chatRow(ctx.state, chatId)
  return postMessage(ctx, chat, fromMemberId, cleanText(body, 4000))
}

/* ══ Bots (DEV_MOCK_BOTS=1) ═══════════════════════════════════════════════ */

const BOT_REPLIES = [
  '¡Buena! Justo estaba practicando eso.',
  'Jaja sí, me pasó lo mismo con el degradado.',
  '¿Te conectas al Q&A del jueves?',
  'Gracias por el dato 🙌',
  'Mándame una foto de cómo quedó.',
  'Dale, lo pruebo mañana y te cuento.',
  'Yo uso la 1.5 para esa parte, queda más limpio.',
]
const BOT_POSTS = [
  { title: '¿Qué máquina usan para el fade?', body: 'Estoy entre dos modelos y no me decido. ¿Qué recomiendan para empezar?' },
  { title: 'Mi primer degradado bajo 💈', body: 'Después de la clase 3 me atreví. Todavía se marca la línea, pero voy mejorando.' },
  { title: 'Tip: la línea con navaja', body: 'Estiren la piel con dos dedos y vayan en tramos cortos. Cambió todo para mí.' },
  { title: '¿Alguien más practica los domingos?', body: 'Busco con quién intercambiar cortes para practicar. Soy de Santiago centro.' },
  { title: 'Terminé el módulo de visagismo', body: 'Brutal cómo cambia el corte cuando entiendes la forma de la cara. ¡Recomendado!' },
]

const bots = { timer: null, ref: null, pending: new Set(), getState: null, log: null }
const botsOn = () => process.env.DEV_MOCK_BOTS === '1'
const pick = (list) => list[Math.floor(Math.random() * list.length)]
const botLog = (...args) => (bots.log || console.log)('[dev-mock:bots]', ...args)

// Gancho opcional que index.mjs llama al registrar el plugin: nos da cómo
// leer el estado VIGENTE (un /api/__mock/reset lo reemplaza entero). No
// arranca nada: los temporizadores nacen recién con la primera llamada.
export function setup({ getState, log } = {}) {
  if (typeof getState === 'function') bots.getState = getState
  if (typeof log === 'function') bots.log = log
}

const currentRef = (fallback) => {
  const st = bots.getState?.()
  return st ? { state: st, lib: fallback?.lib } : fallback
}

// Recuerda el último estado visto y arranca el intervalo de publicaciones la
// primera vez que alguien usa chat/sync con DEV_MOCK_BOTS=1.
function bindBots(ctx) {
  if (!botsOn()) return
  bots.ref = { state: ctx.state, lib: ctx.lib }
  if (bots.timer) return
  bots.timer = setInterval(() => {
    try { botPost(currentRef(bots.ref)) } catch (e) { botLog('publicación falló', e?.message || e) }
  }, 120_000)
  bots.timer.unref?.()
  botLog('activos: respuestas a los 8 s y una publicación cada 2 min')
}

function botPost(ref) {
  if (!ref?.state) return
  const st = ref.state
  const authors = rows(st, 'academy_members').filter((m) => isActive(m) && !staffRow(m) && m.handle)
  const author = pick(authors)
  if (!author) return
  const ctx = { state: st, lib: ref.lib, member: author, admin: null }
  const cats = visibleCategories(ctx, author).filter((c) => c.write_role !== 'admins' && c.cohort_id == null)
  const idea = pick(BOT_POSTS)
  createPost(ctx, author, { categoryId: cats.length ? pick(cats).id : null, title: idea.title, body: idea.body })
  botLog(`${author.name} publicó "${idea.title}"`)
}

function scheduleBotReply(ctx, chat, senderId) {
  if (!botsOn() || bots.pending.has(chat.id)) return
  const st = ctx.state
  const others = chatMemberIds(st, chat.id).filter((id) => id !== senderId).map((id) => memberRow(st, id)).filter(isActive)
  const pool = chat.kind === 'directo' ? others : others.filter((m) => !staffRow(m))
  const responder = pick(pool.length ? pool : others)
  if (!responder || isBlocked(st, responder.id, senderId)) return
  bots.pending.add(chat.id)
  const ref = { state: ctx.state, lib: ctx.lib }
  const t = setTimeout(() => {
    bots.pending.delete(chat.id)
    try {
      // Si hubo un reset entremedio, el chat ya no es el mismo: no contestar.
      const live = currentRef(ref)
      if (live.state !== ref.state) return
      const c = chatRow(ref.state, chat.id)
      if (!c || !membership(ref.state, c.id, responder.id)) return
      postMessage(ref, c, responder.id, pick(BOT_REPLIES))
    } catch (e) { botLog('respuesta falló', e?.message || e) }
  }, 8000)
  t.unref?.()
}

/* ══ Handlers ═════════════════════════════════════════════════════════════ */

function chats(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  bindBots(ctx)
  const onlyUnread = ctx.query?.filter === 'no-leidos'
  const list = []
  for (const cm of rows(st, 'academy_chat_members')) {
    if (cm.member_id !== me.id) continue
    const chat = chatRow(st, cm.chat_id)
    if (!chat) continue
    const s = chatSummary(ctx, chat, cm, me)
    // Un DM recién abierto sin mensajes todavía no aparece en la lista.
    if (chat.kind === 'directo' && !s.lastMessage) continue
    if (onlyUnread && !(s.unread > 0 || s.markedUnread)) continue
    list.push(s)
  }
  list.sort((a, b) => b._lastAt - a._lastAt || b.id - a.id)
  return { chats: list.map(({ _lastAt, ...c }) => c), unreadTotal: unreadChatsCount(st, me.id) }
}

function chat(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  bindBots(ctx)
  const c = chatRow(st, toInt(ctx.query?.id))
  const cm = c && membership(st, c.id, me.id)
  if (!cm) fail(ctx, 404, 'Chat no encontrado', 'not_found')
  const before = toInt(ctx.query?.before)
  const msgs = liveMessages(st, c.id).filter((m) => before == null || m.id < before).sort((a, b) => a.id - b.id)
  const others = rows(st, 'academy_chat_members').filter((r) => r.chat_id === c.id && r.member_id !== me.id)
  return {
    chat: chatHeader(ctx, c, me),
    members: chatMemberIds(st, c.id).map((id) => mini(ctx, id)).filter(Boolean),
    messages: msgs.slice(-PAGE_MESSAGES).map((m) => messageShape(ctx, m, me.id)),
    lastReadByOthers: others.reduce((a, r) => Math.max(a, r.last_read_message_id || 0), 0),
    myLastRead: cm.last_read_message_id || 0,
  }
}

function chatStart(ctx) {
  const me = needMember(ctx)
  const other = memberRow(ctx.state, toInt(ctx.body?.memberId))
  if (!other || !isActive(other)) fail(ctx, 404, 'Miembro no encontrado', 'not_found')
  if (other.id === me.id) fail(ctx, 400, 'No puedes chatear contigo mismo', 'invalid')
  const why = dmBlockReason(ctx, me, other)
  if (why) fail(ctx, why.status, why.message, why.code)
  return { chatId: startDm(ctx, me.id, other.id) }
}

const sendLog = new Map()

function chatSend(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  bindBots(ctx)
  const b = ctx.body || {}
  const c = chatRow(st, toInt(b.chatId))
  if (!c || !membership(st, c.id, me.id)) fail(ctx, 404, 'Chat no encontrado', 'not_found')

  const body = cleanText(b.body, 4000)
  let attachments = []
  if (b.attachments != null) {
    if (!Array.isArray(b.attachments) || b.attachments.length > 4) fail(ctx, 400, 'Puedes adjuntar hasta 4 imágenes', 'invalid')
    // Solo uploads propios y privados de chat: no se puede "adjuntar" (y así
    // compartir) el archivo privado de otra persona conociendo su id.
    attachments = b.attachments.map((a) => {
      const id = toInt(a?.uploadId)
      const up = id != null ? rows(st, 'academy_uploads').find((u) => u.id === id) : null
      if (!up || up.member_id !== me.id || up.kind !== 'chat') fail(ctx, 400, 'Ese adjunto no es válido', 'invalid')
      return { kind: 'image', uploadId: id }
    })
  }
  if (!body && !attachments.length) fail(ctx, 400, 'Escribe un mensaje', 'invalid')

  if (c.kind === 'directo') {
    const why = dmBlockReason(ctx, me, memberRow(st, dmOther(st, c, me.id)))
    if (why) fail(ctx, why.status, why.message, why.code)
  } else if (cohortRow(st, c.cohort_id)?.archived_at) {
    fail(ctx, 403, 'Este grupo está archivado', 'archived')
  }

  const now = Date.now()
  const recent = (sendLog.get(me.id) || []).filter((t) => t > now - SEND_WINDOW_MS)
  if (recent.length >= SEND_MAX) fail(ctx, 429, 'Vas muy rápido. Espera un momento', 'rate_limited')
  recent.push(now)
  sendLog.set(me.id, recent)

  const msg = postMessage(ctx, c, me.id, body, attachments)
  scheduleBotReply(ctx, c, me.id)
  return { message: messageShape(ctx, msg, me.id) }
}

function chatRead(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const c = chatRow(st, toInt(ctx.body?.chatId))
  const cm = c && membership(st, c.id, me.id)
  if (!cm) fail(ctx, 404, 'Chat no encontrado', 'not_found')
  const maxId = liveMessages(st, c.id).reduce((a, m) => Math.max(a, m.id), 0)
  const wanted = toInt(ctx.body?.messageId)
  const upTo = Math.min(wanted ?? maxId, maxId)
  cm.last_read_message_id = Math.max(cm.last_read_message_id || 0, upTo)
  cm.marked_unread = false
  return {}
}

function chatsReadAll(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  for (const cm of rows(st, 'academy_chat_members')) {
    if (cm.member_id !== me.id) continue
    const maxId = liveMessages(st, cm.chat_id).reduce((a, m) => Math.max(a, m.id), 0)
    cm.last_read_message_id = Math.max(cm.last_read_message_id || 0, maxId)
    cm.marked_unread = false
  }
  return {}
}

function ownMembership(ctx) {
  const me = needMember(ctx)
  const c = chatRow(ctx.state, toInt(ctx.body?.chatId))
  const cm = c && membership(ctx.state, c.id, me.id)
  if (!cm) fail(ctx, 404, 'Chat no encontrado', 'not_found')
  return cm
}

function chatMute(ctx) {
  ownMembership(ctx).muted = toBool(ctx.body?.muted, true)
  return {}
}

function chatMarkUnread(ctx) {
  ownMembership(ctx).marked_unread = true
  return {}
}

function block(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const target = memberRow(st, toInt(ctx.body?.memberId))
  if (!target || target.deleted_at) fail(ctx, 404, 'Miembro no encontrado', 'not_found')
  if (target.id === me.id) fail(ctx, 400, 'No puedes bloquearte a ti mismo', 'invalid')
  const list = rows(st, 'academy_blocks')
  const idx = list.findIndex((r) => r.blocker_id === me.id && r.blocked_id === target.id)
  const want = toBool(ctx.body?.block, true)
  if (want && idx < 0) list.push({ blocker_id: me.id, blocked_id: target.id, created_at: nowIso(ctx) })
  else if (!want && idx >= 0) list.splice(idx, 1)
  return {}
}

function blocks(ctx) {
  const me = needMember(ctx)
  const ids = rows(ctx.state, 'academy_blocks').filter((r) => r.blocker_id === me.id).map((r) => r.blocked_id)
  return { members: ids.map((id) => mini(ctx, id)).filter(Boolean) }
}

const syncLog = new Map()

// Una sola "consulta": contadores + mensajes nuevos del chat abierto +
// publicaciones nuevas. Nunca crea tablas ni manda notificaciones.
function sync(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const now = Date.now()
  const last = syncLog.get(me.id) || 0
  if (now - last < SYNC_MIN_MS) {
    fail(ctx, 429, 'Demasiadas solicitudes. Intenta en unos segundos', 'rate_limited', { retryAfter: Math.ceil((SYNC_MIN_MS - (now - last)) / 1000) })
  }
  syncLog.set(me.id, now)
  bindBots(ctx)

  // Presencia: last_sync_at se escribe a lo más una vez por minuto (igual
  // que el real, que así ahorra escrituras en Neon).
  const row = memberRow(st, me.id) || me
  const iso = nowIso(ctx)
  if (!row.last_sync_at || (msOf(row.last_sync_at) || 0) < now - SYNC_WRITE_MS) row.last_sync_at = iso
  row.last_seen_at = iso

  let messages = []
  const chatId = toInt(ctx.query?.chat)
  if (chatId != null && membership(st, chatId, me.id)) {
    const since = toInt(ctx.query?.since)
    const list = liveMessages(st, chatId).sort((a, b) => a.id - b.id)
    messages = (since != null ? list.filter((m) => m.id > since).slice(0, 100) : list.slice(-PAGE_MESSAGES)).map((m) => messageShape(ctx, m, me.id))
  }

  let newPosts = 0
  const feedSince = msOf(ctx.query?.feedSince)
  if (feedSince != null) {
    newPosts = rows(st, 'academy_posts').filter((p) => p.author_id !== me.id && (msOf(p.created_at) || 0) > feedSince && canSeePostRow(ctx, me, p)).length
  }

  return {
    unreadNotifications: unreadNotifCount(st, me.id),
    unreadChats: unreadChatsCount(st, me.id),
    messages,
    newPosts,
    onlineCount: rows(st, 'academy_members').filter(isOnline).length,
    serverTime: iso,
  }
}

function pushSubscribe(ctx) {
  const me = needMember(ctx)
  const s = ctx.body?.subscription || {}
  const endpoint = typeof s.endpoint === 'string' ? s.endpoint.trim() : ''
  const p256dh = typeof s.keys?.p256dh === 'string' ? s.keys.p256dh : ''
  const auth = typeof s.keys?.auth === 'string' ? s.keys.auth : ''
  let okEndpoint = false
  try { okEndpoint = new URL(endpoint).protocol === 'https:' && endpoint.length <= 2000 } catch { okEndpoint = false }
  if (!okEndpoint || !p256dh || !auth || p256dh.length > 300 || auth.length > 300) fail(ctx, 400, 'Suscripción no válida', 'invalid')
  const list = rows(ctx.state, 'academy_push_subscriptions')
  const existing = list.find((r) => r.endpoint === endpoint)
  // ON CONFLICT (endpoint): el mismo navegador pasa a ser del miembro actual.
  if (existing) Object.assign(existing, { member_id: me.id, p256dh, auth })
  else list.push({ id: nextIdOf(ctx, 'academy_push_subscriptions'), member_id: me.id, endpoint, p256dh, auth, created_at: nowIso(ctx) })
  return {}
}

function pushUnsubscribe(ctx) {
  const me = needMember(ctx)
  const endpoint = typeof ctx.body?.endpoint === 'string' ? ctx.body.endpoint.trim() : ''
  if (!endpoint) fail(ctx, 400, 'Falta el endpoint', 'invalid')
  const st = ctx.state
  // Solo la suscripción propia: no se puede apagar el push de otra persona.
  removeWhere(st, 'academy_push_subscriptions', (r) => r.endpoint === endpoint && r.member_id === me.id)
  return {}
}

function cohorts(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const staff = staffRow(me)
  const mine = new Set(rows(st, 'academy_cohort_members').filter((r) => r.member_id === me.id).map((r) => r.cohort_id))
  const list = rows(st, 'academy_cohorts')
    .filter((c) => (staff ? true : mine.has(c.id) && !c.archived_at))
    .sort((a, b) => (a.archived_at ? 1 : 0) - (b.archived_at ? 1 : 0) || String(b.starts_on || '').localeCompare(String(a.starts_on || '')) || b.id - a.id)
  return { cohorts: list.map((c) => cohortShape(ctx, c, me, staff)) }
}

function cohort(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const c = cohortRow(st, toInt(ctx.query?.id))
  if (!c) fail(ctx, 404, 'Grupo no encontrado', 'not_found')
  const isMember = cohortMemberIds(st, c.id).includes(me.id)
  if (!isMember && !staffRow(me)) fail(ctx, 403, 'No perteneces a este grupo', 'forbidden')
  return {
    cohort: cohortShape(ctx, c, me, staffRow(me)),
    members: cohortMemberIds(st, c.id).map((id) => mini(ctx, id)).filter(Boolean),
    chatId: c.chat_id ?? null,
    isMember,
  }
}

function file(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const id = toInt(ctx.query?.id)
  const up = id != null ? rows(st, 'academy_uploads').find((u) => u.id === id) : null
  const inMyChat = () => rows(st, 'academy_messages').some((m) => !m.deleted_at &&
    Array.isArray(m.attachments) && m.attachments.some((a) => toInt(a?.uploadId) === id) && !!membership(st, m.chat_id, me.id))
  // Mismo 404 para "no existe" y "no es tuyo": no se puede sondear ids.
  if (!up || !(up.member_id === me.id || staffRow(me) || inMyChat())) fail(ctx, 404, 'Archivo no encontrado', 'not_found')

  // El `upload` del mock guarda los bytes en state.mock.blobs (no hay Blob
  // real); si no están, se acepta un dataURL o una URL segura en la fila.
  const blob = st.mock?.blobs?.get?.(id) || null
  const url = String(up.url || '')
  const data = blob ? null : /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(url)
  const bytes = blob?.buffer ? Buffer.from(blob.buffer) : data ? Buffer.from(data[2], 'base64') : null
  const contentType = blob?.contentType || data?.[1] || 'application/octet-stream'
  const target = bytes ? null : safeUrl(url)
  if (!bytes && !target) fail(ctx, 404, 'Archivo no encontrado', 'not_found')
  if (!/^image\/(webp|jpeg|png)$/.test(contentType) && bytes) fail(ctx, 404, 'Archivo no encontrado', 'not_found')
  const res = ctx.res
  if (res && typeof res.setHeader === 'function' && !res.headersSent) {
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (bytes) {
      res.statusCode = 200
      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Length', String(bytes.length))
      res.end(bytes)
    } else {
      res.statusCode = 302
      res.setHeader('Location', target)
      res.end()
    }
    return undefined
  }
  // Sin `res` en el ctx: el router del mock decide cómo servirlo.
  return bytes ? { __file: { contentType, base64: bytes.toString('base64'), cache: 'private, max-age=300' } } : { __redirect: target }
}

function adminCohortSave(ctx) {
  needAdmin(ctx)
  const st = ctx.state
  const b = ctx.body || {}
  const id = toInt(b.id)
  const existing = id != null ? cohortRow(st, id) : null
  if (id != null && !existing) fail(ctx, 404, 'Grupo no encontrado', 'not_found')
  // "Sin cambios" si el campo no viene (mismo criterio que el CASE WHEN real).
  const val = (key, col, dflt) => (has(b, key) ? b[key] : existing ? existing[col] : dflt)

  const name = cleanText(val('name', 'name', ''), 80).replace(/\n+/g, ' ')
  if (!name) fail(ctx, 400, 'Ponle un nombre al grupo', 'invalid')
  const description = cleanText(val('description', 'description', ''), 2000) || null
  const coverRaw = val('coverUrl', 'cover_url', null)
  const coverUrl = coverRaw == null || coverRaw === '' ? null : isImageUrl(coverRaw) ? safeUrl(coverRaw) || String(coverRaw).trim() : fail(ctx, 400, 'La portada no es válida', 'bad_image')
  const courseRaw = val('courseId', 'course_id', null)
  const courseId = courseRaw == null || courseRaw === '' ? null : toInt(courseRaw)
  if (courseRaw != null && courseRaw !== '' && (courseId == null || !rows(st, 'academy_courses').some((c) => c.id === courseId))) fail(ctx, 400, 'Ese curso no existe', 'invalid')
  const startsRaw = val('startsOn', 'starts_on', null)
  const startsOn = startsRaw == null || startsRaw === '' ? null : String(startsRaw).slice(0, 10)
  if (startsOn != null && dayOfKey(startsOn) == null) fail(ctx, 400, 'La fecha de inicio no es válida', 'invalid')
  const seatsRaw = val('seats', 'seats', null)
  const seats = seatsRaw == null || seatsRaw === '' ? null : toInt(seatsRaw)
  if (seatsRaw != null && seatsRaw !== '' && (seats == null || seats < 1 || seats > 10000)) fail(ctx, 400, 'Los cupos no son válidos', 'invalid')
  const salesOpen = toBool(val('salesOpen', 'sales_open', false))

  const now = nowIso(ctx)
  const fields = { name, description, cover_url: coverUrl, course_id: courseId, starts_on: startsOn, seats, sales_open: salesOpen, updated_at: now }
  let c = existing
  if (c) {
    Object.assign(c, fields)
    const ch = chatRow(st, c.chat_id)
    if (ch) ch.name = name
  } else {
    c = { id: nextIdOf(ctx, 'academy_cohorts'), ...fields, chat_id: null, archived_at: null, created_by: actorId(ctx), created_at: now }
    rows(st, 'academy_cohorts').push(c)
    const chatId = ensureCohortChat(ctx, c.id)
    // Quien crea el Grupo (la fila de miembro del dueño, si existe) entra a
    // su chat para poder hablarle a la generación; no cuenta como alumno.
    const creator = actorId(ctx)
    if (chatId != null && creator != null && isActive(memberRow(st, creator))) addChatMember(ctx, chatId, creator)
  }
  return { cohort: cohortShape(ctx, c, ctx.member, true) }
}

function adminCohortMembers(ctx) {
  needAdmin(ctx)
  const st = ctx.state
  const b = ctx.body || {}
  const c = cohortRow(st, toInt(b.cohortId))
  if (!c) fail(ctx, 404, 'Grupo no encontrado', 'not_found')
  const add = Array.isArray(b.add) ? b.add.map(toInt).filter((x) => x != null) : []
  const remove = Array.isArray(b.remove) ? b.remove.map(toInt).filter((x) => x != null) : []
  if (add.length > 500 || remove.length > 500) fail(ctx, 400, 'Demasiados miembros en una sola operación', 'invalid')

  const added = addToCohort(ctx, c.id, add)
  for (const id of added) {
    notifyMember(ctx, id, { kind: 'grupo', actorId: actorId(ctx), targetType: 'grupo', targetId: c.id, preview: cut(c.name, 140) })
  }
  if (remove.length) {
    const out = new Set(remove)
    removeWhere(st, 'academy_cohort_members', (r) => r.cohort_id === c.id && out.has(r.member_id))
    // Sale del Grupo = sale de su chat (deja de leer la historia).
    if (c.chat_id != null) removeWhere(st, 'academy_chat_members', (r) => r.chat_id === c.chat_id && out.has(r.member_id))
  }
  c.updated_at = nowIso(ctx)
  return { memberCount: cohortMemberIds(st, c.id).length }
}

function adminCohortArchive(ctx) {
  needAdmin(ctx)
  const c = cohortRow(ctx.state, toInt(ctx.body?.id))
  if (!c) fail(ctx, 404, 'Grupo no encontrado', 'not_found')
  const now = nowIso(ctx)
  c.archived_at = c.archived_at || now
  c.sales_open = false
  c.updated_at = now
  return {}
}

export const handlers = {
  chats,
  chat,
  'chat-start': chatStart,
  'chat-send': chatSend,
  'chat-read': chatRead,
  'chats-read-all': chatsReadAll,
  'chat-mute': chatMute,
  'chat-mark-unread': chatMarkUnread,
  block,
  blocks,
  sync,
  'push-subscribe': pushSubscribe,
  'push-unsubscribe': pushUnsubscribe,
  cohorts,
  cohort,
  file,
  'admin-cohort-save': adminCohortSave,
  'admin-cohort-members': adminCohortMembers,
  'admin-cohort-archive': adminCohortArchive,
}

// Para el reset del mock: los límites en memoria vuelven a cero.
export function resetChatMemory() {
  sendLog.clear()
  syncLog.clear()
  bots.pending.clear()
}
