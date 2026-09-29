/* Mock de los modos de _academyAccount.js, _academyCourses.js y
   _academyAdmin.js (SPEC §5.1, §5.2, §5.6), más el checkout de cursos
   (§6.1–§6.5). El login mínimo del panel (/api/auth-barber) es propio de
   cada repo: en PimpStudio vive en scripts/dev-mock/index.mjs.

   Mismas formas y mismos códigos de estado que el backend real, aplicando
   las mismas reglas de acceso (lib.mjs): así la app de Academy y la pestaña
   del panel se prueban enteras sin Neon, Mercado Pago ni Resend. Los correos
   quedan en state.outbox y en la consola (ahí se lee la contraseña
   temporal de una compra nueva).

   Contraseñas del mock: la "hash" es `mock$<clave>` (ver fixtures.mjs). No
   hay PBKDF2 a propósito: acá no se protege nada real y el login tiene que
   responder al instante. */

import crypto from 'node:crypto'
import {
  HttpError, nowIso, DAY, HOUR, MIN, nextId, paginate, sha256, outbox, issueMemberToken,
  memberById, memberByEmail, memberMini, memberAdmin, meOf, mergePrefs, deepMerge, settingsOf, DEFAULT_SETTINGS,
  isAdmin, isStaff, pointsOf, levelFor, activeGrantCourseIds, canAccessCourse, canAccessLesson, orderedLessons,
  notify, notifyMany, safeUrl, isImageUrl, parseYouTubeId, slugify, cleanText, EMAIL_RE, emailNorm, maskEmail,
  santiagoDateKey, HOST,
} from './lib.mjs'
import { mockHash, DEFAULT_CATEGORIES } from './fixtures.mjs'

/* ── Utilidades ───────────────────────────────────────────────────────── */
const bad = (msg, code, extra) => new HttpError(400, msg, code, extra)
const notFound = (msg = 'No encontrado') => new HttpError(404, msg)
const toInt = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim())
  return NaN
}
const reqInt = (v, msg = 'Falta el id.') => { const n = toInt(v); if (!Number.isInteger(n) || n < 1) throw bad(msg); return n }
const optInt = (v) => (v === undefined || v === null || v === '' ? null : toInt(v))
const byPos = (a, b) => (a.position - b.position) || (a.id - b.id)
const failKnob = (name) => String(process.env.DEV_MOCK_FAIL || '').split(',').map((s) => s.trim()).includes(name)
const siteUrl = (p) => p // rutas relativas: el mock vive en el mismo origen

// Ventana deslizante en memoria (equivale a rateLimit() del real).
function hit(state, key, max, windowMs) {
  const now = Date.now()
  const arr = (state.mock.rate[key] || []).filter((t) => now - t < windowMs)
  arr.push(now)
  state.mock.rate[key] = arr
  return arr.length <= max
}

/* ── Contraseñas (§3.2) ───────────────────────────────────────────────── */
const TEMP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const COMMON = ['1234567890', 'password12', 'contraseña', 'qwertyuiop', 'pimpstudio', 'barberia123', '0987654321', '1111111111', 'abcdefghij', 'academy123']
export function generateTempPassword() {
  const chars = Array.from({ length: 12 }, () => TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)]).join('')
  return { display: chars.match(/.{4}/g).join('-'), canonical: chars }
}
export const canonicalTemp = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
function passwordProblem(pw, email) {
  const s = String(pw || '')
  if (s.length < 10 || s.length > 200) return 'La contraseña debe tener entre 10 y 200 caracteres.'
  const local = String(email || '').split('@')[0].toLowerCase()
  if (local && s.toLowerCase() === local) return 'No uses tu correo como contraseña.'
  if (COMMON.includes(s.toLowerCase())) return 'Esa contraseña es demasiado común. Elige otra.'
  return null
}
function checkPassword(row, pw) {
  if (!row?.password_hash || typeof pw !== 'string' || !pw) return false
  if (row.password_hash === mockHash(pw)) return true
  // La temporal se guarda canónica: acepta "k7qm 4rtx-9pwd" igual que el real.
  return Boolean(row.must_change_password) && row.password_hash === mockHash(canonicalTemp(pw))
}
function setPassword(state, row, pw) {
  Object.assign(row, {
    password_hash: mockHash(pw), password_set_at: nowIso(), must_change_password: false, temp_password_expires_at: null,
    session_version: row.session_version + 1, updated_at: nowIso(),
  })
}
const dropPushSubs = (state, memberId) => { state.academy_push_subscriptions = state.academy_push_subscriptions.filter((p) => p.member_id !== memberId) }

/* ── Lockout del login (§3.6): 5 por correo, 20 por IP, 5 min ─────────── */
const LOCK_MS = 5 * MIN
function lockedFor(state, keys) {
  const now = Date.now()
  let wait = 0
  for (const k of keys) {
    const f = state.mock.loginFails[k]
    if (f?.lockedUntil > now) wait = Math.max(wait, Math.ceil((f.lockedUntil - now) / 1000))
  }
  return wait
}
function registerFailure(state, keyMax) {
  const now = Date.now()
  let wait = 0
  for (const [k, max] of keyMax) {
    const f = state.mock.loginFails[k] && now - state.mock.loginFails[k].first < 15 * MIN ? state.mock.loginFails[k] : { n: 0, first: now, lockedUntil: 0 }
    f.n += 1
    if (f.n >= max) { f.lockedUntil = now + LOCK_MS; f.n = 0; f.first = now; wait = Math.max(wait, LOCK_MS / 1000) }
    state.mock.loginFails[k] = f
  }
  return wait
}

/* ── Proyecciones de cursos (§5.2) ────────────────────────────────────── */
function progressMap(state, memberId) {
  const map = new Map()
  if (memberId == null) return map
  for (const p of state.academy_lesson_progress) if (p.member_id === memberId) map.set(p.lesson_id, p)
  return map
}
function courseCard(state, viewer, c) {
  const admin = isAdmin(viewer)
  const mid = viewer?.memberId ?? viewer?.id ?? null
  const acc = canAccessCourse(state, viewer, c)
  const lessons = orderedLessons(state, c.id, { includeDrafts: admin })
  const prog = progressMap(state, mid)
  const completed = lessons.filter((l) => prog.get(l.id)?.completed_at)
  const next = acc.ok ? lessons.find((l) => !prog.get(l.id)?.completed_at) : null
  return {
    id: c.id, slug: c.slug, title: c.title, subtitle: c.subtitle || null, description: c.description || null, coverUrl: c.cover_url || null,
    access: c.access, unlockLevel: c.unlock_level ?? null,
    owned: mid != null && state.academy_grants.some((g) => g.member_id === mid && g.course_id === c.id && g.state === 'activa'),
    locked: !acc.ok, lockReason: acc.ok ? null : acc.reason,
    lessonCount: lessons.length, completedCount: completed.length,
    progress: lessons.length ? Math.round((completed.length / lessons.length) * 100) : 0,
    nextLesson: next ? { slug: next.slug, title: next.title } : null,
    priceOnline: c.price_online ?? null, salesOpen: Boolean(c.sales_open), published: Boolean(c.published),
  }
}
function courseProgressPct(state, memberId, courseId) {
  const lessons = orderedLessons(state, courseId)
  if (!lessons.length) return 0
  const prog = progressMap(state, memberId)
  return Math.round((lessons.filter((l) => prog.get(l.id)?.completed_at).length / lessons.length) * 100)
}
const lessonAdmin = (l) => ({
  id: l.id, courseId: l.course_id, sectionId: l.section_id ?? null, slug: l.slug, title: l.title, position: l.position,
  videoProvider: l.video_provider, videoId: l.video_id || null, durationSec: l.duration_sec ?? null, body: l.body || '',
  resources: l.resources || [], published: Boolean(l.published), createdAt: l.created_at, updatedAt: l.updated_at,
})
function courseAdmin(state, c) {
  const sections = state.academy_sections.filter((s) => s.course_id === c.id).sort(byPos)
  const lessons = state.academy_lessons.filter((l) => l.course_id === c.id).sort(byPos)
  const known = new Set(sections.map((s) => s.id))
  return {
    id: c.id, slug: c.slug, catalogId: c.catalog_id || null, title: c.title, subtitle: c.subtitle || null, description: c.description || null,
    coverUrl: c.cover_url || null, position: c.position, published: Boolean(c.published), access: c.access, unlockLevel: c.unlock_level ?? null,
    priceOnline: c.price_online ?? null, pricePresencial: c.price_presencial ?? null, salesOpen: Boolean(c.sales_open),
    owners: state.academy_grants.filter((g) => g.course_id === c.id && g.state === 'activa').length,
    orderCount: state.academy_orders.filter((o) => o.course_id === c.id).length,
    lessonCount: lessons.length, publishedCount: lessons.filter((l) => l.published).length,
    createdAt: c.created_at, updatedAt: c.updated_at,
    sections: sections.map((s) => ({ id: s.id, courseId: c.id, title: s.title, position: s.position, lessons: lessons.filter((l) => l.section_id === s.id).map(lessonAdmin) })),
    unsectioned: lessons.filter((l) => l.section_id == null || !known.has(l.section_id)).map(lessonAdmin),
  }
}

/* ── Miembros, accesos y correos (§6.3–§6.6) ──────────────────────────── */
function insertMember(state, { name, email, phone = null, source = 'pago', role = 'miembro', grantedBy = null, barberId = null, mustChange = true }) {
  const now = nowIso()
  const row = {
    id: nextId(state, 'academy_members'), email_norm: emailNorm(email), email: String(email).trim(), name: String(name).trim().slice(0, 80),
    handle: null, phone, user_id: null, bio: null, location: null, links: {}, avatar_url: null, role, status: 'activo', source,
    password_hash: null, password_set_at: null, must_change_password: mustChange, temp_password_expires_at: null, session_version: 0,
    credentials_claimed_at: null, credentials_sent_at: null, credentials_attempts: 0, credentials_retry_at: null,
    last_login_at: null, last_seen_at: null, last_sync_at: null, activity_email_at: null, barber_id: barberId, granted_by: grantedBy,
    prefs: {}, joined_at: now, banned_at: null, deleted_at: null, created_at: now, updated_at: now,
  }
  // Igual que el real: el handle se completa DESPUÉS de tener id.
  row.handle = `${slugify(row.name) || 'miembro'}-${row.id}`
  state.academy_members.push(row)
  return row
}

function addToCohort(state, cohortId, memberId) {
  const cohort = state.academy_cohorts.find((c) => c.id === cohortId)
  if (!cohort) return false
  let added = false
  if (!state.academy_cohort_members.some((cm) => cm.cohort_id === cohortId && cm.member_id === memberId)) {
    state.academy_cohort_members.push({ cohort_id: cohortId, member_id: memberId, added_at: nowIso() })
    added = true
  }
  if (cohort.chat_id && !state.academy_chat_members.some((m) => m.chat_id === cohort.chat_id && m.member_id === memberId)) {
    const chat = state.academy_chats.find((c) => c.id === cohort.chat_id)
    state.academy_chat_members.push({ chat_id: cohort.chat_id, member_id: memberId, last_read_message_id: chat?.last_message_id || 0, muted: false, marked_unread: false, joined_at: nowIso() })
  }
  if (added) notify(state, { memberId, kind: 'grupo', targetType: 'grupo', targetId: cohortId, preview: cohort.name })
  return added
}

// grant idempotente: por external_ref, por order_id o por "ya tiene uno activo de ese curso".
function ensureGrant(state, { memberId, courseId, orderId = null, externalRef = null, source, grantedBy = null, stateName = 'activa' }) {
  let g = externalRef ? state.academy_grants.find((x) => x.external_ref === externalRef) : null
  if (!g && orderId) g = state.academy_grants.find((x) => x.order_id === orderId)
  if (!g) g = state.academy_grants.find((x) => x.member_id === memberId && x.course_id === courseId && x.state === 'activa')
  if (g) return { grant: g, created: false }
  const now = nowIso()
  g = {
    id: nextId(state, 'academy_grants'), member_id: memberId, course_id: courseId, order_id: orderId, external_ref: externalRef,
    source, state: stateName, notified_at: null, revoked_at: null, revoke_reason: null, granted_by: grantedBy, created_at: now, updated_at: now,
  }
  state.academy_grants.push(g)
  return { grant: g, created: true }
}

function sendResetLink(state, m, { ip = null, minutes = 30, kind = 'reset' } = {}) {
  const token = crypto.randomBytes(32).toString('hex')
  state.academy_auth_tokens.push({
    token_hash: sha256(token), member_id: m.id, purpose: 'reset', payload: null,
    expires_at: nowIso(new Date(Date.now() + minutes * MIN)), used_at: null, requested_ip: ip, created_at: nowIso(),
  })
  outbox(state, {
    kind, to: m.email, subject: `Crea una contraseña nueva para ${HOST.brand.name}`,
    text: `Hola ${m.name}: abre este enlace para crear tu contraseña (vence en ${minutes} minutos).`,
    data: { url: siteUrl(`${HOST.base}/restablecer?token=${token}`), minutes },
  })
  return token
}

export function claimAndSendCredentials(state, memberId, { course } = {}) {
  const m = memberById(state, memberId)
  if (!m) return 'no_aplica'
  if (m.password_set_at) return 'cuenta_existente'
  if (m.status !== 'activo' || m.role === 'propietario') return 'no_aplica'
  if (m.credentials_sent_at) return 'enviadas'
  if (!state.academy_grants.some((g) => g.member_id === m.id && g.state === 'activa')) return 'no_aplica'
  const now = Date.now()
  if (m.credentials_attempts >= 5) return 'pendientes'
  if (m.credentials_retry_at && Date.parse(m.credentials_retry_at) > now) return 'pendientes'
  if (m.credentials_claimed_at && Date.parse(m.credentials_claimed_at) > now - 10 * MIN) return 'pendientes'
  Object.assign(m, { credentials_claimed_at: nowIso(), credentials_attempts: m.credentials_attempts + 1, updated_at: nowIso() })
  const temp = generateTempPassword()
  Object.assign(m, { password_hash: mockHash(temp.canonical), must_change_password: true, temp_password_expires_at: nowIso(new Date(now + 72 * HOUR)) })
  // DEV_MOCK_FAIL=email simula el tope diario de Resend (429 → reintento).
  if (failKnob('email')) {
    Object.assign(m, { credentials_attempts: m.credentials_attempts - 1, credentials_retry_at: nowIso(new Date(now + HOUR)) })
    console.log(`  ✉ Mock Academy · correo de acceso a ${m.email} NO enviado (DEV_MOCK_FAIL=email) → pendientes`)
    return 'pendientes'
  }
  outbox(state, {
    kind: 'acceso', to: m.email, subject: `Tu acceso a ${HOST.brand.name}`,
    text: `Hola ${m.name}: tu usuario es ${m.email} y tu contraseña temporal ${temp.display}. Válida por 72 h; al entrar te pediremos crear la tuya.`,
    data: { tempPassword: temp.display, loginUrl: `${HOST.base}/ingreso`, course: course?.title || null },
  })
  m.credentials_sent_at = nowIso()
  return 'enviadas'
}

function sendAlready(state, m, course, grant) {
  if (grant) {
    if (grant.notified_at) return
    grant.notified_at = nowIso()
  }
  outbox(state, {
    kind: 'ya_tienes', to: m.email, subject: `Ya tienes acceso a ${course?.title || 'tu curso'}`,
    text: `Hola ${m.name}: entra con tu correo y tu contraseña de siempre.`, data: { loginUrl: `${HOST.base}/ingreso`, course: course?.title || null },
  })
}

// Mensaje de bienvenida automático del propietario (plugins.autoDm).
function autoDm(state, m) {
  const s = settingsOf(state)
  const owner = state.academy_members.find((x) => x.role === 'propietario' && x.status === 'activo' && !x.deleted_at)
  if (!s.plugins?.autoDm?.enabled || !owner || owner.id === m.id) return
  const [a, b] = [Math.min(owner.id, m.id), Math.max(owner.id, m.id)]
  let chat = state.academy_chats.find((c) => c.dm_key === `${a}:${b}`)
  if (!chat) {
    chat = { id: nextId(state, 'academy_chats'), kind: 'directo', dm_key: `${a}:${b}`, cohort_id: null, name: null, last_message_id: null, last_message_at: null, created_at: nowIso() }
    state.academy_chats.push(chat)
    for (const mid of [owner.id, m.id]) state.academy_chat_members.push({ chat_id: chat.id, member_id: mid, last_read_message_id: 0, muted: false, marked_unread: false, joined_at: nowIso() })
  }
  const body = String(s.plugins.autoDm.text || '').replace(/#NOMBRE#/g, m.name.split(' ')[0]).replace(/#GRUPO#/g, s.group?.name || HOST.brand.name).slice(0, 2000)
  const msg = { id: nextId(state, 'academy_messages'), chat_id: chat.id, author_id: owner.id, body, attachments: [], created_at: nowIso(), deleted_at: null }
  state.academy_messages.push(msg)
  chat.last_message_id = msg.id
  chat.last_message_at = msg.created_at
  const own = state.academy_chat_members.find((x) => x.chat_id === chat.id && x.member_id === owner.id)
  if (own) own.last_read_message_id = msg.id
}

function adminAlert(state, title, body) {
  const row = { id: (state.notifications.reduce((n, x) => Math.max(n, x.id), 0) || 0) + 1, barber_id: state.barbers[0]?.id ?? 1, title, body, url: '/panel?tab=academy', created_at: nowIso() }
  state.notifications.unshift(row)
  console.log(`  🔔 Mock Academy · alerta del panel: ${title} · ${body}`)
}

function welcomeNew(state, m) {
  const s = settingsOf(state)
  notify(state, { memberId: m.id, kind: 'bienvenida', preview: s.group?.name || HOST.brand.name })
  const staff = state.academy_members.filter((x) => ['propietario', 'admin'].includes(x.role) && x.status === 'activo').map((x) => x.id)
  notifyMany(state, staff, { kind: 'miembro_nuevo', actorId: m.id, targetType: 'miembro', targetId: m.id })
}

// Invitación / importación / "Dar curso" (§5.6): crea o reusa la cuenta y da los cursos.
export function provisionManualGrant(state, { name, email, courseIds = [], cohortId = null, source = 'invitacion', externalRef = null, actor = null }) {
  let m = memberByEmail(state, email)
  let created = false
  if (!m) {
    m = insertMember(state, { name, email, source: source === 'puente' ? 'puente' : 'invitacion', grantedBy: actor })
    created = true
  } else if (m.status === 'cancelado' && !m.deleted_at) {
    Object.assign(m, { status: 'activo', updated_at: nowIso() })
  }
  const newGrants = []
  courseIds.forEach((courseId, i) => {
    const r = ensureGrant(state, { memberId: m.id, courseId, externalRef: i === 0 ? externalRef : null, source, grantedBy: actor, stateName: m.status === 'expulsado' ? 'revision' : 'activa' })
    if (r.created) newGrants.push(r.grant)
  })
  if (cohortId) addToCohort(state, cohortId, m.id)
  for (const g of newGrants) {
    const c = state.academy_courses.find((x) => x.id === g.course_id)
    notify(state, { memberId: m.id, kind: 'curso', targetType: 'curso', targetId: g.course_id, preview: c?.title })
  }
  if (created) welcomeNew(state, m)
  const firstCourse = state.academy_courses.find((x) => x.id === (newGrants[0]?.course_id ?? courseIds[0]))
  let credentials
  if (m.password_set_at) {
    for (const g of newGrants) sendAlready(state, m, state.academy_courses.find((x) => x.id === g.course_id), g)
    credentials = 'cuenta_existente'
  } else {
    credentials = claimAndSendCredentials(state, m.id, { course: firstCourse })
  }
  if (created) autoDm(state, m)
  return { member: m, created, credentials }
}

// §6.3: pago aprobado → orden pagada + miembro + acceso + grupo, idempotente.
export function grantFromOrder(state, order, { paymentId, payerEmail } = {}) {
  const pid = String(paymentId || `mock-${Date.now()}`)
  if (order.status === 'pagada' || order.paid_at) {
    if (order.mp_payment_id && order.mp_payment_id !== pid) adminAlert(state, 'Pago duplicado Academy', `${order.public_ref}: reembolsar el pago ${pid}`)
    return { order, member: memberByEmail(state, order.email_norm), already: true }
  }
  if (!['pendiente', 'anulada'].includes(order.status)) return { order, member: memberByEmail(state, order.email_norm), already: true }
  const now = nowIso()
  Object.assign(order, {
    status: 'pagada', mp_payment_id: pid, mp_last_status: 'approved', paid_at: now, paid_amount: order.amount,
    mp_payer_email: payerEmail || order.email, live_mode: false, updated_at: now,
  })
  let m = memberByEmail(state, order.email_norm)
  const nuevo = !m
  if (!m) m = insertMember(state, { name: order.name, email: order.email, phone: order.phone, source: 'pago' })
  else if (m.status === 'cancelado' && !m.deleted_at) Object.assign(m, { status: 'activo', updated_at: now })
  const { grant } = ensureGrant(state, { memberId: m.id, courseId: order.course_id, orderId: order.id, source: 'pago', stateName: m.status === 'expulsado' ? 'revision' : 'activa' })
  if (order.cohort_id) addToCohort(state, order.cohort_id, m.id)
  const course = state.academy_courses.find((c) => c.id === order.course_id)
  notify(state, { memberId: m.id, kind: 'curso', targetType: 'curso', targetId: course?.id, preview: course?.title })
  if (nuevo) welcomeNew(state, m)
  let credentials
  if (m.password_set_at) { sendAlready(state, m, course, grant); credentials = 'cuenta_existente' } else credentials = claimAndSendCredentials(state, m.id, { course })
  if (nuevo) autoDm(state, m)
  adminAlert(state, 'Nueva inscripción Academy', `${course?.title || order.title_snapshot} · $${order.amount.toLocaleString('es-CL')}`)
  return { order, member: m, grant, credentials, already: false }
}

// §6.5: revocar un acceso y, si ya no le queda ninguno, cancelar la cuenta.
function settleMemberAfterRevoke(state, memberId, excludeOrderId = null) {
  const m = memberById(state, memberId)
  if (!m || ['propietario', 'admin'].includes(m.role)) return
  const others = state.academy_grants.some((g) => g.member_id === m.id && g.state === 'activa' && (excludeOrderId == null || g.order_id !== excludeOrderId))
  if (others) return
  if (m.status === 'activo') Object.assign(m, { status: 'cancelado', session_version: m.session_version + 1, updated_at: nowIso() })
  dropPushSubs(state, m.id)
}
export function revokeGrant(state, grant, reason) {
  if (grant.state === 'revocada') return
  Object.assign(grant, { state: 'revocada', revoked_at: nowIso(), revoke_reason: String(reason || 'manual').slice(0, 300), updated_at: nowIso() })
  settleMemberAfterRevoke(state, grant.member_id)
}
function refundOrder(state, order) {
  if (order.status !== 'pagada' || order.refunded_at) return false
  Object.assign(order, { status: 'reembolsada', refunded_at: nowIso(), refund_reason: 'refunded', mp_last_status: 'refunded', updated_at: nowIso() })
  let memberId = null
  for (const g of state.academy_grants.filter((x) => x.order_id === order.id)) {
    Object.assign(g, { state: 'revocada', revoked_at: nowIso(), revoke_reason: 'reembolso', updated_at: nowIso() })
    memberId = g.member_id
  }
  if (memberId) settleMemberAfterRevoke(state, memberId, order.id)
  adminAlert(state, 'Reembolso Academy', `${order.title_snapshot} · ${maskEmail(order.email)}`)
  return true
}

// __mock/mp y admin-verify-order: aplica el estado de un pago simulado (§6.2).
export function applyMockPayment(state, ref, status = 'approved') {
  const order = state.academy_orders.find((o) => o.public_ref === ref)
  if (!order) throw notFound('Orden no encontrada')
  const s = String(status)
  state.mock.mpPayments[ref] = { status: s, at: nowIso() }
  if (s === 'approved') grantFromOrder(state, order, { paymentId: order.mp_payment_id || `mock-${Date.now()}` })
  else if (s === 'refunded' || s === 'charged_back') refundOrder(state, order)
  else if (['pending', 'in_process', 'authorized', 'rejected'].includes(s)) { if (order.status === 'pendiente') Object.assign(order, { mp_last_status: s, updated_at: nowIso() }) }
  else if (s === 'cancelled') { if (order.status === 'pendiente') Object.assign(order, { status: 'anulada', mp_last_status: s, updated_at: nowIso() }) }
  else throw bad('Estado de pago desconocido (approved | refunded | rejected | pending | cancelled).')
  return orderAdmin(state, order)
}

function orderAdmin(state, o) {
  const c = state.academy_courses.find((x) => x.id === o.course_id)
  const co = o.cohort_id ? state.academy_cohorts.find((x) => x.id === o.cohort_id) : null
  const m = memberByEmail(state, o.email_norm)
  return {
    ref: o.public_ref, course: c ? { id: c.id, slug: c.slug, title: c.title } : null, courseTitle: o.title_snapshot, modality: o.modality,
    cohort: co ? { id: co.id, name: co.name } : null, amount: o.amount, name: o.name, email: o.email, phone: o.phone || null,
    status: o.status, mpPaymentId: o.mp_payment_id || null, mpPayerEmail: o.mp_payer_email || null, mpLastStatus: o.mp_last_status || null,
    paidAt: o.paid_at || null, paidAmount: o.paid_amount ?? null, refundedAt: o.refunded_at || null, createdAt: o.created_at, memberId: m?.id ?? null,
    emailMismatch: Boolean(o.mp_payer_email && emailNorm(o.mp_payer_email) !== o.email_norm),
  }
}

const cohortSeatsLeft = (state, cohort) => {
  if (cohort.seats == null) return null
  const taken = state.academy_cohort_members.filter((cm) => cm.cohort_id === cohort.id && memberById(state, cm.member_id)?.role === 'miembro').length
  const pending = state.academy_orders.filter((o) => o.cohort_id === cohort.id && o.status === 'pendiente' && Date.parse(o.created_at) > Date.now() - 30 * MIN).length
  return Math.max(0, cohort.seats - taken - pending)
}

/* ── Validaciones de perfil ───────────────────────────────────────────── */
const RESERVED_HANDLE = /^(bruno|brunetti|admin|soporte|moderador|academy|pimp|pimpstudio)/
function normalizeLink(kind, raw) {
  const v = String(raw ?? '').trim()
  if (!v) return null
  const handle = v.replace(/^@/, '')
  if (kind === 'instagram' && /^[A-Za-z0-9._]{1,30}$/.test(handle)) return `https://instagram.com/${handle}`
  if (kind === 'tiktok' && /^[A-Za-z0-9._]{2,24}$/.test(handle)) return `https://www.tiktok.com/@${handle}`
  if (kind === 'whatsapp') {
    const d = v.replace(/\D/g, '')
    if (d.length >= 8 && d.length <= 15 && !/[a-z]/i.test(v)) return `https://wa.me/${d.length === 9 ? `56${d}` : d}`
  }
  const url = safeUrl(/^https?:\/\//i.test(v) ? v : `https://${v}`)
  if (!url || url.startsWith('/')) return undefined
  const host = new URL(url).hostname
  const hosts = { instagram: /(^|\.)instagram\.com$/, tiktok: /(^|\.)tiktok\.com$/, whatsapp: /(^|\.)(wa\.me|whatsapp\.com)$/ }
  if (hosts[kind] && !hosts[kind].test(host)) return undefined
  return url
}
const LINK_LABEL = { instagram: 'Instagram', tiktok: 'TikTok', whatsapp: 'WhatsApp', web: 'sitio web' }
function sanitizePrefs(p) {
  if (!p || typeof p !== 'object') return {}
  const out = {}
  const bools = (obj, keys) => {
    const r = {}
    for (const k of keys) if (typeof obj?.[k] === 'boolean') r[k] = obj[k]
    return r
  }
  if (p.notif) out.notif = bools(p.notif, ['push', 'email', 'likes', 'comments', 'mentions', 'follows', 'events'])
  if (p.chat) out.chat = bools(p.chat, ['enabled', 'previews'])
  if (p.privacy) out.privacy = bools(p.privacy, ['hideActivity', 'hideOnline'])
  if (p.onboarding) {
    out.onboarding = bools(p.onboarding, ['dismissed'])
    if (Array.isArray(p.onboarding.done)) out.onboarding.done = [...new Set(p.onboarding.done.filter((x) => typeof x === 'string' && x.length <= 30))].slice(0, 20)
  }
  if (['claro', 'oscuro', 'auto'].includes(p.theme)) out.theme = p.theme
  if (typeof p.tz === 'string' && p.tz.length <= 60) {
    try { new Intl.DateTimeFormat('es-CL', { timeZone: p.tz }); out.tz = p.tz } catch { throw bad('Esa zona horaria no es válida.') }
  }
  return out
}

function groupPayload(state) {
  const s = settingsOf(state)
  return {
    name: s.group.name, description: s.group.description, initials: s.group.initials, iconUrl: s.group.iconUrl, coverUrl: s.group.coverUrl,
    color: s.group.color, url: HOST.brand.groupUrlLabel, links: s.group.links, tabs: s.tabs, levels: { names: s.levels.names },
    sync: s.sync, plugins: { minPostLevel: s.plugins.minPostLevel, minChatLevel: s.plugins.minChatLevel, welcomeVideoId: s.plugins.welcomeVideoId },
  }
}

const actorId = (ctx) => ctx.admin?.memberId ?? ctx.member?.id ?? null
const viewerOf = (ctx) => ctx.member || ctx.admin || null

/* ── Handlers ─────────────────────────────────────────────────────────── */
export const handlers = {
  /* ── Cuenta (§5.1) ── */
  async login(ctx) {
    const { state, body, ip } = ctx
    const email = emailNorm(body.email)
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password) throw bad('Escribe tu correo y tu contraseña.')
    const keys = [`aca-login-user:${email}`, `aca-login-ip:${ip}`]
    const wait = lockedFor(state, keys)
    if (wait) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.', 'locked', { retryAfter: wait })
    const m = memberByEmail(state, email)
    const ok = m && m.status === 'activo' && !m.deleted_at && checkPassword(m, password)
    if (!ok) {
      const w = registerFailure(state, [[keys[0], 5], [keys[1], 20]])
      if (w) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.', 'locked', { retryAfter: w })
      throw new HttpError(401, 'Correo o contraseña incorrectos', 'bad_credentials')
    }
    // Solo DESPUÉS de que la clave calzó se revela que la temporal venció.
    if (m.must_change_password && m.temp_password_expires_at && Date.parse(m.temp_password_expires_at) < Date.now()) {
      throw new HttpError(401, 'Tu contraseña temporal venció. Pide una nueva con «¿Olvidaste tu contraseña?».', 'temp_expired')
    }
    delete state.mock.loginFails[keys[0]]
    Object.assign(m, { last_login_at: nowIso(), last_seen_at: nowIso() })
    const token = issueMemberToken(state, m, { pwc: Boolean(m.must_change_password) })
    return { token, member: meOf(state, m), mustChangePassword: Boolean(m.must_change_password) }
  },

  async 'password-change'(ctx) {
    const { state, body } = ctx
    const m = ctx.member.row
    const forced = Boolean(m.must_change_password || ctx.member.mustChangePassword)
    if (!forced) {
      if (!body.currentPassword) throw bad('Escribe tu contraseña actual.')
      if (!checkPassword(m, body.currentPassword)) throw new HttpError(403, 'La contraseña actual no es correcta.', 'bad_password')
    }
    const problem = passwordProblem(body.newPassword, m.email)
    if (problem) throw bad(problem, 'weak_password')
    if (forced && checkPassword(m, body.newPassword)) throw bad('La contraseña nueva tiene que ser distinta de la temporal.', 'weak_password')
    setPassword(state, m, body.newPassword)
    const token = issueMemberToken(state, m, { pwc: false })
    return { token, member: meOf(state, m) }
  },

  async 'password-reset-request'(ctx) {
    const { state, body, ip } = ctx
    const email = emailNorm(body.email)
    if (!EMAIL_RE.test(email) || email.length > 120) throw bad('Escribe un correo válido.')
    // Siempre la misma respuesta: no se revela si el correo existe.
    if (!hit(state, `aca-reset-ip:${ip}`, 10, HOUR) || !hit(state, `aca-reset-mail:${email}`, 3, DAY)) return {}
    const m = memberByEmail(state, email)
    if (m && m.status === 'activo' && !m.deleted_at) sendResetLink(state, m, { ip })
    return {}
  },

  async 'password-reset-confirm'(ctx) {
    const { state, body, ip } = ctx
    if (!hit(state, `aca-reset-confirm:${ip}`, 10, 15 * MIN)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.', 'rate', { retryAfter: 900 })
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const row = token && state.academy_auth_tokens.find((t) => t.token_hash === sha256(token) && t.purpose === 'reset')
    if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) throw bad('Este enlace ya se usó o venció. Pide uno nuevo.', 'bad_token')
    const m = memberById(state, row.member_id)
    if (!m || m.status !== 'activo' || m.deleted_at) throw bad('Este enlace ya se usó o venció. Pide uno nuevo.', 'bad_token')
    const problem = passwordProblem(body.password, m.email)
    if (problem) throw bad(problem, 'weak_password')
    row.used_at = nowIso()
    setPassword(state, m, body.password)
    delete state.mock.loginFails[`aca-login-user:${m.email_norm}`]
    dropPushSubs(state, m.id)
    const t = issueMemberToken(state, m, { pwc: false })
    return { token: t, member: meOf(state, m) }
  },

  async me(ctx) {
    const { state } = ctx
    const m = ctx.member.row
    // touchSeen: como mucho cada 5 minutos (§3.4).
    if (!m.last_seen_at || Date.parse(m.last_seen_at) < Date.now() - 5 * MIN) m.last_seen_at = nowIso()
    const out = { member: meOf(state, m), group: groupPayload(state) }
    const tok = ctx.tokenInfo
    // Renueva tokens de más de un día; un token "debes crear tu contraseña" nunca se renueva a uno completo.
    if (tok && !tok.pwc && !m.must_change_password && Date.now() - tok.iat > DAY) out.token = issueMemberToken(state, m, { pwc: false })
    return out
  },

  async 'me-update'(ctx) {
    const { state, body } = ctx
    const m = ctx.member.row
    const patch = {}
    if (body.name !== undefined) {
      const name = cleanText(body.name, 60).replace(/\n/g, ' ')
      if (!name) throw bad('Escribe tu nombre.')
      patch.name = name
    }
    if (body.bio !== undefined) patch.bio = cleanText(body.bio, 300) || null
    if (body.location !== undefined) patch.location = cleanText(body.location, 60).replace(/\n/g, ' ') || null
    if (body.links !== undefined) {
      if (body.links !== null && typeof body.links !== 'object') throw bad('Enlaces inválidos.')
      const links = { ...(m.links || {}) }
      for (const k of ['instagram', 'tiktok', 'whatsapp', 'web']) {
        if (!body.links || body.links[k] === undefined) continue
        const url = normalizeLink(k, body.links[k])
        if (url === undefined) throw bad(`El enlace de ${LINK_LABEL[k]} no es válido.`)
        if (url === null) delete links[k]; else links[k] = url
      }
      patch.links = links
    }
    if (body.avatarUrl !== undefined) {
      if (body.avatarUrl === null || body.avatarUrl === '') patch.avatar_url = null
      else if (isImageUrl(body.avatarUrl)) patch.avatar_url = body.avatarUrl
      else throw bad('La foto de perfil tiene que subirse desde acá.')
    }
    if (body.handle !== undefined && body.handle !== m.handle) {
      const h = String(body.handle || '').trim().toLowerCase()
      if (!/^[a-z0-9-]{3,40}$/.test(h)) throw bad('Tu usuario debe tener entre 3 y 40 letras, números o guiones.')
      if (RESERVED_HANDLE.test(h) && !isAdmin(m)) throw bad('Ese usuario está reservado.')
      if (state.academy_members.some((x) => x.handle === h && x.id !== m.id)) throw new HttpError(409, 'Ese usuario ya está tomado.', 'handle_taken')
      patch.handle = h
    }
    if (body.prefs !== undefined) patch.prefs = deepMerge(m.prefs || {}, sanitizePrefs(body.prefs))
    Object.assign(m, patch, { updated_at: nowIso() })
    return { member: meOf(state, m) }
  },

  async 'email-change'(ctx) {
    const { state, body } = ctx
    const m = ctx.member.row
    if (!m.password_hash) throw bad('Primero crea una contraseña desde «¿Olvidaste tu contraseña?».')
    if (!checkPassword(m, body.password)) throw new HttpError(403, 'La contraseña no es correcta.', 'bad_password')
    const email = emailNorm(body.newEmail)
    if (!EMAIL_RE.test(email) || email.length > 120) throw bad('Escribe un correo válido.')
    if (email === m.email_norm) throw bad('Ese ya es tu correo.')
    if (memberByEmail(state, email)) throw new HttpError(409, 'Ese correo ya está en uso.', 'email_taken')
    const token = crypto.randomBytes(32).toString('hex')
    state.academy_auth_tokens.push({ token_hash: sha256(token), member_id: m.id, purpose: 'email', payload: { newEmail: email }, expires_at: nowIso(new Date(Date.now() + 30 * MIN)), used_at: null, requested_ip: ctx.ip, created_at: nowIso() })
    outbox(state, { kind: 'email', to: email, subject: `Confirma tu nuevo correo de ${HOST.brand.name}`, text: `Hola ${m.name}: confirma el cambio de correo (vence en 30 minutos).`, data: { url: `${HOST.base}/confirmar-correo?token=${token}` } })
    return {}
  },

  async 'email-change-confirm'(ctx) {
    const { state, body } = ctx
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const row = token && state.academy_auth_tokens.find((t) => t.token_hash === sha256(token) && t.purpose === 'email')
    if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) throw bad('Este enlace ya se usó o venció.', 'bad_token')
    const m = memberById(state, row.member_id)
    const next = row.payload?.newEmail
    if (!m || !next) throw bad('Este enlace ya se usó o venció.', 'bad_token')
    if (memberByEmail(state, next)) throw new HttpError(409, 'Ese correo ya está en uso.', 'email_taken')
    const old = m.email
    row.used_at = nowIso()
    Object.assign(m, { email: next, email_norm: next, session_version: m.session_version + 1, updated_at: nowIso() })
    outbox(state, { kind: 'email_cambiado', to: old, subject: `Tu correo de ${HOST.brand.name} cambió`, text: `Hola ${m.name}: el correo de tu cuenta ahora es ${maskEmail(next)}.`, data: { newEmailMasked: maskEmail(next) } })
    return {}
  },

  async 'logout-all'(ctx) {
    const m = ctx.member.row
    Object.assign(m, { session_version: m.session_version + 1, updated_at: nowIso() })
    dropPushSubs(ctx.state, m.id)
    return {}
  },

  async 'me-export'(ctx) {
    const { state } = ctx
    const m = ctx.member.row
    const mine = (table, col = 'member_id') => state[table].filter((r) => r[col] === m.id)
    const { password_hash: _p, ...profile } = m
    return {
      data: {
        exportedAt: nowIso(), member: profile,
        posts: mine('academy_posts', 'author_id'), comments: mine('academy_comments', 'author_id'), likes: mine('academy_likes'),
        pollVotes: mine('academy_poll_votes'), follows: mine('academy_follows'), notifications: mine('academy_notifications'),
        messages: mine('academy_messages', 'author_id'), lessonProgress: mine('academy_lesson_progress'),
        grants: mine('academy_grants'), cohorts: mine('academy_cohort_members'), uploads: mine('academy_uploads'),
        orders: state.academy_orders.filter((o) => o.email_norm === m.email_norm).map((o) => orderAdmin(state, o)),
      },
    }
  },

  async 'me-delete'(ctx) {
    const { state, body } = ctx
    const m = ctx.member.row
    if (m.role === 'propietario') throw bad('El propietario no puede eliminar su cuenta.')
    if (!checkPassword(m, body.password)) throw new HttpError(403, 'La contraseña no es correcta.', 'bad_password')
    const dmIds = new Set(state.academy_chats.filter((c) => c.kind === 'directo' && state.academy_chat_members.some((cm) => cm.chat_id === c.id && cm.member_id === m.id)).map((c) => c.id))
    state.academy_messages = state.academy_messages.filter((x) => !(dmIds.has(x.chat_id) && x.author_id === m.id))
    state.academy_chat_members = state.academy_chat_members.filter((cm) => !(dmIds.has(cm.chat_id) && cm.member_id === m.id))
    dropPushSubs(state, m.id)
    state.academy_auth_tokens = state.academy_auth_tokens.filter((t) => t.member_id !== m.id)
    state.academy_lesson_progress = state.academy_lesson_progress.filter((p) => p.member_id !== m.id)
    Object.assign(m, {
      name: 'Miembro eliminado', email_norm: `deleted-${m.id}@invalid`, email: `deleted-${m.id}@invalid`, handle: `eliminado-${m.id}`,
      phone: null, bio: null, location: null, links: {}, avatar_url: null, prefs: {}, password_hash: null, password_set_at: null,
      status: 'cancelado', deleted_at: nowIso(), session_version: m.session_version + 1, updated_at: nowIso(),
    })
    return {}
  },

  async about(ctx) {
    const { state } = ctx
    const s = settingsOf(state)
    const owner = state.academy_members.find((m) => m.role === 'propietario' && !m.deleted_at)
    const prices = state.academy_courses.filter((c) => c.published && c.sales_open).flatMap((c) => [c.price_online, c.price_presencial]).filter((n) => Number.isInteger(n))
    return {
      __cache: 'public, s-maxage=300, stale-while-revalidate=600',
      group: { name: s.group.name, description: s.group.description, coverUrl: s.group.coverUrl, media: s.group.media, initials: s.group.initials, color: s.group.color },
      meta: {
        memberCount: state.academy_members.filter((m) => m.status === 'activo' && !m.deleted_at).length,
        owner: owner ? { name: owner.name } : null, priceFrom: prices.length ? Math.min(...prices) : null,
      },
    }
  },

  async 'owner-session'(ctx) {
    const { state } = ctx
    const barber = ctx.barber
    let owner = state.academy_members.find((m) => m.role === 'propietario' && !m.deleted_at)
    if (!owner) {
      const b = state.barbers.find((x) => x.id === barber.id) || barber
      owner = insertMember(state, { name: b.name || 'Propietario', email: b.email || `owner-${barber.id}@${HOST.brand.emailDomain}`, source: 'propietario', role: 'propietario', barberId: barber.id, mustChange: false })
    } else if (owner.barber_id == null) owner.barber_id = barber.id
    Object.assign(owner, { status: 'activo', last_login_at: nowIso(), last_seen_at: nowIso() })
    return { token: issueMemberToken(state, owner, { pwc: false }), member: meOf(state, owner) }
  },

  async idle(ctx) {
    ctx.member.row.last_sync_at = null
    return {}
  },

  /* ── Cursos (§5.2) ── */
  async courses(ctx) {
    const { state } = ctx
    const admin = isAdmin(ctx.member)
    const list = state.academy_courses.filter((c) => admin || c.published).sort(byPos)
    return { courses: list.map((c) => courseCard(state, ctx.member, c)) }
  },

  async course(ctx) {
    const { state, query } = ctx
    const admin = isAdmin(ctx.member)
    const c = state.academy_courses.find((x) => x.slug === String(query.slug || ''))
    if (!c || (!c.published && !admin)) throw notFound('Curso no encontrado')
    const prog = progressMap(state, ctx.member.id)
    const lessons = state.academy_lessons.filter((l) => l.course_id === c.id && (admin || l.published)).sort(byPos)
    const row = (l) => ({ id: l.id, slug: l.slug, title: l.title, durationSec: l.duration_sec ?? null, completed: Boolean(prog.get(l.id)?.completed_at), published: Boolean(l.published) })
    const sections = state.academy_sections.filter((s) => s.course_id === c.id).sort(byPos)
      .map((s) => ({ id: s.id, title: s.title, lessons: lessons.filter((l) => l.section_id === s.id).map(row) }))
      .filter((s) => admin || s.lessons.length)
    const known = new Set(state.academy_sections.filter((s) => s.course_id === c.id).map((s) => s.id))
    return { course: courseCard(state, ctx.member, c), sections, unsectioned: lessons.filter((l) => l.section_id == null || !known.has(l.section_id)).map(row) }
  },

  async lesson(ctx) {
    const { state, query } = ctx
    const admin = isAdmin(ctx.member)
    const c = state.academy_courses.find((x) => x.slug === String(query.course || ''))
    if (!c || (!c.published && !admin)) throw notFound('Curso no encontrado')
    const l = state.academy_lessons.find((x) => x.course_id === c.id && x.slug === String(query.lesson || ''))
    if (!l || (!l.published && !admin)) throw notFound('Lección no encontrada')
    const acc = canAccessCourse(state, ctx.member, c)
    // Bloqueada: ni video ni texto en la respuesta (§5.2).
    if (!acc.ok) throw new HttpError(403, 'Esta lección es parte de un curso bloqueado.', 'locked', { lockReason: acc.reason })
    const order = orderedLessons(state, c.id, { includeDrafts: admin })
    const i = order.findIndex((x) => x.id === l.id)
    const p = state.academy_lesson_progress.find((x) => x.member_id === ctx.member.id && x.lesson_id === l.id)
    const brief = (x) => (x ? { slug: x.slug, title: x.title } : null)
    return {
      course: { slug: c.slug, title: c.title },
      lesson: {
        id: l.id, slug: l.slug, title: l.title, body: l.body || '', resources: l.resources || [], videoProvider: l.video_provider,
        videoId: l.video_id || null, durationSec: l.duration_sec ?? null, positionSec: p?.position_sec ?? 0, completed: Boolean(p?.completed_at),
        sectionTitle: state.academy_sections.find((s) => s.id === l.section_id)?.title || null, published: Boolean(l.published),
      },
      prev: brief(order[i - 1]), next: brief(i >= 0 ? order[i + 1] : null),
    }
  },

  async 'lesson-progress'(ctx) {
    const { state, body } = ctx
    const lessonId = reqInt(body.lessonId, 'Falta la lección.')
    const l = state.academy_lessons.find((x) => x.id === lessonId)
    if (!l) throw notFound('Lección no encontrada')
    if (!canAccessLesson(state, ctx.member, l)) throw new HttpError(403, 'Esta lección es parte de un curso bloqueado.', 'locked')
    const pos = body.positionSec === undefined || body.positionSec === null ? null : Math.min(86_400, Math.max(0, Math.floor(Number(body.positionSec) || 0)))
    const completed = typeof body.completed === 'boolean' ? body.completed : undefined
    if (pos === null && completed === undefined) throw bad('Nada que guardar.')
    let row = state.academy_lesson_progress.find((x) => x.member_id === ctx.member.id && x.lesson_id === l.id)
    const fresh = !row
    if (!row) {
      row = { member_id: ctx.member.id, lesson_id: l.id, position_sec: 0, completed_at: null, updated_at: nowIso() }
      state.academy_lesson_progress.push(row)
    }
    if (completed !== undefined) {
      row.completed_at = completed ? (row.completed_at || nowIso()) : null
      if (pos !== null) row.position_sec = pos
      row.updated_at = nowIso()
    } else if (fresh || Date.parse(row.updated_at) < Date.now() - 20_000) {
      // Solo posición y más seguido que cada 20 s: se ignora (el real ahorra escrituras).
      row.position_sec = pos
      row.updated_at = nowIso()
    }
    return { completed: Boolean(row.completed_at), positionSec: row.position_sec, courseProgress: courseProgressPct(state, ctx.member.id, l.course_id) }
  },

  async catalog(ctx) {
    const { state } = ctx
    const published = state.academy_courses.filter((c) => c.published).sort(byPos)
    const bySlug = new Map(state.academy_courses.map((c) => [c.id, c]))
    return {
      __cache: 'public, s-maxage=300, stale-while-revalidate=600',
      courses: published.map((c) => ({
        catalogId: c.catalog_id || null, slug: c.slug, title: c.title, subtitle: c.subtitle || null, coverUrl: c.cover_url || null,
        priceOnline: c.price_online ?? null, pricePresencial: c.price_presencial ?? null, salesOpen: Boolean(c.sales_open), published: true,
        lessonCount: state.academy_lessons.filter((l) => l.course_id === c.id && l.published).length,
      })),
      cohorts: state.academy_cohorts.filter((co) => !co.archived_at && bySlug.get(co.course_id)?.published).map((co) => ({
        id: co.id, courseSlug: bySlug.get(co.course_id)?.slug || null, name: co.name, startsOn: co.starts_on || null,
        seats: co.seats ?? null, seatsLeft: cohortSeatsLeft(state, co), salesOpen: Boolean(co.sales_open),
      })),
      checkoutEnabled: process.env.DEV_MOCK_CHECKOUT !== 'off',
    }
  },

  async 'admin-courses'(ctx) {
    return { courses: ctx.state.academy_courses.slice().sort(byPos).map((c) => courseAdmin(ctx.state, c)) }
  },

  async 'admin-course-save'(ctx) {
    const { state, body } = ctx
    const id = optInt(body.id)
    const existing = id ? state.academy_courses.find((c) => c.id === id) : null
    if (id && !existing) throw notFound('Curso no encontrado')
    const v = (k, fallback) => (body[k] === undefined ? fallback : body[k])
    const title = cleanText(v('title', existing?.title), 120).replace(/\n/g, ' ')
    if (!title) throw bad('El curso necesita un título.')
    const slug = slugify(v('slug', existing?.slug) || title)
    if (!slug) throw bad('El enlace del curso no es válido.')
    if (state.academy_courses.some((c) => c.slug === slug && c.id !== id)) throw new HttpError(409, 'Ya existe un curso con ese enlace.', 'slug_taken')
    const access = v('access', existing?.access || 'compra')
    if (!['compra', 'abierto', 'nivel'].includes(access)) throw bad('Tipo de acceso inválido.')
    const unlock = access === 'nivel' ? toInt(v('unlockLevel', existing?.unlock_level)) : null
    if (access === 'nivel' && !(unlock >= 2 && unlock <= 9)) throw bad('Elige un nivel de desbloqueo entre 2 y 9.')
    const price = (k, col) => {
      const raw = v(k, existing?.[col] ?? null)
      if (raw === null || raw === '') return null
      const n = toInt(raw)
      if (!(n >= 1000 && n <= 10_000_000)) throw bad('El precio debe estar entre $1.000 y $10.000.000.')
      return n
    }
    const cover = v('coverUrl', existing?.cover_url ?? null)
    if (cover && !isImageUrl(cover)) throw bad('La portada tiene que ser una imagen subida acá.')
    const catalogId = v('catalogId', existing?.catalog_id ?? null)
    const row = existing || { id: nextId(state, 'academy_courses'), created_at: nowIso() }
    Object.assign(row, {
      slug, catalog_id: catalogId ? String(catalogId).slice(0, 60) : null, title,
      subtitle: cleanText(v('subtitle', existing?.subtitle), 200) || null, description: cleanText(v('description', existing?.description), 5000) || null,
      cover_url: cover || null, position: Number.isInteger(toInt(v('position', existing?.position))) ? toInt(v('position', existing?.position)) : state.academy_courses.length,
      published: Boolean(v('published', existing?.published ?? false)), access, unlock_level: unlock,
      price_online: price('priceOnline', 'price_online'), price_presencial: price('pricePresencial', 'price_presencial'),
      sales_open: Boolean(v('salesOpen', existing?.sales_open ?? false)), updated_at: nowIso(),
    })
    if (!existing) state.academy_courses.push(row)
    return { course: courseAdmin(state, row) }
  },

  async 'admin-course-delete'(ctx) {
    const { state, body } = ctx
    const id = reqInt(body.id)
    const c = state.academy_courses.find((x) => x.id === id)
    if (!c) throw notFound('Curso no encontrado')
    // Con pedidos no se borra (se perdería la historia de pagos): se archiva.
    if (state.academy_orders.some((o) => o.course_id === id)) {
      Object.assign(c, { published: false, sales_open: false, updated_at: nowIso() })
      return { archived: true, deleted: false }
    }
    const lessonIds = new Set(state.academy_lessons.filter((l) => l.course_id === id).map((l) => l.id))
    state.academy_lesson_progress = state.academy_lesson_progress.filter((p) => !lessonIds.has(p.lesson_id))
    state.academy_comments = state.academy_comments.filter((x) => !lessonIds.has(x.lesson_id))
    state.academy_lessons = state.academy_lessons.filter((l) => l.course_id !== id)
    state.academy_sections = state.academy_sections.filter((s) => s.course_id !== id)
    state.academy_grants = state.academy_grants.filter((g) => g.course_id !== id)
    for (const co of state.academy_cohorts) if (co.course_id === id) co.course_id = null
    state.academy_courses = state.academy_courses.filter((x) => x.id !== id)
    return { deleted: true, archived: false }
  },

  async 'admin-section-save'(ctx) {
    const { state, body } = ctx
    const id = optInt(body.id)
    const existing = id ? state.academy_sections.find((s) => s.id === id) : null
    if (id && !existing) throw notFound('Sección no encontrada')
    const courseId = existing ? existing.course_id : reqInt(body.courseId, 'Falta el curso.')
    if (!state.academy_courses.some((c) => c.id === courseId)) throw notFound('Curso no encontrado')
    const title = cleanText(body.title ?? existing?.title, 120).replace(/\n/g, ' ')
    if (!title) throw bad('La sección necesita un título.')
    const pos = toInt(body.position)
    const row = existing || { id: nextId(state, 'academy_sections'), course_id: courseId, created_at: nowIso() }
    Object.assign(row, { title, position: Number.isInteger(pos) ? pos : (existing?.position ?? state.academy_sections.filter((s) => s.course_id === courseId).length) })
    if (!existing) state.academy_sections.push(row)
    return { section: { id: row.id, courseId: row.course_id, title: row.title, position: row.position } }
  },

  async 'admin-section-delete'(ctx) {
    const { state, body } = ctx
    const id = reqInt(body.id)
    if (!state.academy_sections.some((s) => s.id === id)) throw notFound('Sección no encontrada')
    for (const l of state.academy_lessons) if (l.section_id === id) l.section_id = null
    state.academy_sections = state.academy_sections.filter((s) => s.id !== id)
    return {}
  },

  async 'admin-lesson-save'(ctx) {
    const { state, body } = ctx
    const id = optInt(body.id)
    const existing = id ? state.academy_lessons.find((l) => l.id === id) : null
    if (id && !existing) throw notFound('Lección no encontrada')
    const courseId = existing ? existing.course_id : reqInt(body.courseId, 'Falta el curso.')
    if (!state.academy_courses.some((c) => c.id === courseId)) throw notFound('Curso no encontrado')
    const v = (k, fallback) => (body[k] === undefined ? fallback : body[k])
    const title = cleanText(v('title', existing?.title), 160).replace(/\n/g, ' ')
    if (!title) throw bad('La lección necesita un título.')
    let sectionId = v('sectionId', existing?.section_id ?? null)
    sectionId = sectionId === null || sectionId === '' ? null : toInt(sectionId)
    if (sectionId !== null && !state.academy_sections.some((s) => s.id === sectionId && s.course_id === courseId)) throw bad('Esa sección no es de este curso.')
    let videoId = existing?.video_id ?? null
    if (body.video !== undefined) {
      const raw = body.video == null ? '' : String(body.video).trim()
      videoId = raw ? parseYouTubeId(raw) : null
      if (raw && !videoId) throw bad('Ese enlace de YouTube no es válido.', 'bad_video')
    }
    const lessonBody = cleanText(v('body', existing?.body ?? ''), 20000)
    const published = Boolean(v('published', existing?.published ?? false))
    if (published && !videoId && !lessonBody) throw bad('Para publicar la lección agrega un video o un texto.')
    let resources = existing?.resources || []
    // Igual que resourcesIn() de api/_academyCourses.js: filas vacías del
    // editor se ignoran, el título cae al enlace y un enlace malo es 400.
    if (body.resources != null) {
      if (!Array.isArray(body.resources)) throw bad('Los recursos deben venir como lista')
      if (body.resources.length > 20) throw bad('Máximo 20 recursos por lección')
      resources = []
      body.resources.forEach((r, i) => {
        const rawUrl = String(r?.url || '').trim()
        const t = cleanText(r?.title, 120).replace(/\n/g, ' ')
        if (!rawUrl && !t) return
        const url = safeUrl(rawUrl)
        if (!url) throw bad(`El enlace del recurso ${i + 1} no es válido`)
        resources.push({ title: t || url, url })
      })
    } else if (body.resources === null) resources = []
    const wanted = slugify(v('slug', existing?.slug) || title) || 'leccion'
    let slug = wanted
    const taken = (s) => state.academy_lessons.some((l) => l.course_id === courseId && l.slug === s && l.id !== id)
    if (taken(slug)) {
      if (body.slug) throw new HttpError(409, 'Ya hay una lección con ese enlace en este curso.', 'slug_taken')
      for (let k = 2; taken(slug); k++) slug = `${wanted.slice(0, 36)}-${k}`
    }
    const dur = v('durationSec', existing?.duration_sec ?? null)
    const pos = toInt(v('position', existing?.position))
    const row = existing || { id: nextId(state, 'academy_lessons'), course_id: courseId, video_provider: 'youtube', created_at: nowIso() }
    Object.assign(row, {
      section_id: sectionId, slug, title, video_id: videoId, duration_sec: dur === null || dur === '' ? null : Math.max(0, toInt(dur) || 0),
      body: lessonBody, resources, published, updated_at: nowIso(),
      position: Number.isInteger(pos) ? pos : state.academy_lessons.filter((l) => l.course_id === courseId && l.section_id === sectionId).length,
    })
    if (!existing) state.academy_lessons.push(row)
    return { lesson: lessonAdmin(row) }
  },

  async 'admin-lesson-delete'(ctx) {
    const { state, body } = ctx
    const id = reqInt(body.id)
    if (!state.academy_lessons.some((l) => l.id === id)) throw notFound('Lección no encontrada')
    state.academy_lessons = state.academy_lessons.filter((l) => l.id !== id)
    state.academy_lesson_progress = state.academy_lesson_progress.filter((p) => p.lesson_id !== id)
    state.academy_comments = state.academy_comments.filter((c) => c.lesson_id !== id)
    return {}
  },

  async 'admin-reorder'(ctx) {
    const { state, body } = ctx
    const table = { course: 'academy_courses', section: 'academy_sections', lesson: 'academy_lessons' }[body.type]
    if (!table) throw bad('Tipo de orden inválido.')
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 500) throw bad('Faltan los elementos a ordenar.')
    body.ids.forEach((raw, i) => {
      const row = state[table].find((r) => r.id === toInt(raw))
      if (row) { row.position = i; if ('updated_at' in row) row.updated_at = nowIso() }
    })
    return {}
  },

  async 'admin-seed'(ctx) {
    const { state, body } = ctx
    const created = { courses: 0, sections: 0, lessons: 0, categories: 0 }
    const list = Array.isArray(body.courses) ? body.courses : []
    for (const c of list) {
      const slug = slugify(c?.slug || c?.title)
      const title = cleanText(c?.title, 120).replace(/\n/g, ' ')
      // Idempotente por slug: un curso que ya existe se salta entero.
      if (!slug || !title || state.academy_courses.some((x) => x.slug === slug)) continue
      const now = nowIso()
      const priceOk = (n) => (Number.isInteger(n) && n >= 1000 && n <= 10_000_000 ? n : null)
      const cover = c.coverUrl && isImageUrl(c.coverUrl) ? c.coverUrl : null
      const course = {
        id: nextId(state, 'academy_courses'), slug, catalog_id: c.catalogId ? String(c.catalogId).slice(0, 60) : null, title,
        subtitle: cleanText(c.subtitle, 200) || null, description: cleanText(c.description, 5000) || null, cover_url: cover,
        position: state.academy_courses.length, published: false, access: ['compra', 'abierto', 'nivel'].includes(c.access) && c.access !== 'nivel' ? c.access : 'compra',
        unlock_level: null, price_online: priceOk(c.priceOnline), price_presencial: priceOk(c.pricePresencial), sales_open: false, created_at: now, updated_at: now,
      }
      state.academy_courses.push(course)
      created.courses++
      ;(Array.isArray(c.sections) ? c.sections : []).forEach((s, si) => {
        const section = { id: nextId(state, 'academy_sections'), course_id: course.id, title: cleanText(s?.title, 120).replace(/\n/g, ' ') || `Sección ${si + 1}`, position: si, created_at: now }
        state.academy_sections.push(section)
        created.sections++
        const used = new Set(state.academy_lessons.filter((l) => l.course_id === course.id).map((l) => l.slug))
        ;(Array.isArray(s?.lessons) ? s.lessons : []).forEach((ls, li) => {
          const lt = cleanText(ls?.title, 160).replace(/\n/g, ' ')
          if (!lt) return
          let lslug = slugify(lt) || `leccion-${li + 1}`
          for (let k = 2; used.has(lslug); k++) lslug = `${slugify(lt).slice(0, 36) || 'leccion'}-${k}`
          used.add(lslug)
          state.academy_lessons.push({
            id: nextId(state, 'academy_lessons'), course_id: course.id, section_id: section.id, slug: lslug, title: lt, position: li,
            video_provider: 'youtube', video_id: null, duration_sec: null, body: cleanText(ls?.body, 20000), resources: [], published: false, created_at: now, updated_at: now,
          })
          created.lessons++
        })
      })
    }
    if (!state.academy_categories.length) {
      const cats = Array.isArray(body.categories) && body.categories.length ? body.categories : DEFAULT_CATEGORIES.map((c) => ({ name: c.name, emoji: c.emoji, writeRole: c.write_role }))
      cats.slice(0, 10).forEach((c, i) => {
        const name = cleanText(c?.name, 30).replace(/\n/g, ' ')
        if (!name) return
        state.academy_categories.push({ id: nextId(state, 'academy_categories'), name, emoji: c.emoji ? String(c.emoji).slice(0, 8) : null, position: i, write_role: c.writeRole === 'admins' ? 'admins' : 'miembros', default_sort: 'default', cohort_id: null, created_at: nowIso() })
        created.categories++
      })
    }
    return { created }
  },

  async upload(ctx) {
    const { state, body } = ctx
    const kinds = ['avatar', 'portada', 'post', 'chat', 'galeria', 'curso', 'evento']
    if (!kinds.includes(body.kind)) throw bad('Tipo de imagen no válido.')
    if (['curso', 'evento', 'galeria', 'portada'].includes(body.kind) && !isAdmin(ctx.member)) throw new HttpError(403, 'Solo un administrador puede subir este tipo de imagen.', 'forbidden')
    const m = String(body.dataUrl || '').match(/^data:image\/(webp|jpeg|jpg|png);base64,([A-Za-z0-9+/=\s]+)$/)
    if (!m) throw bad('La imagen no es válida.')
    const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64')
    if (!buf.length) throw bad('La imagen no es válida.')
    if (buf.length > 2 * 1024 * 1024) throw bad('La imagen pesa más de 2 MB.')
    // Se decide por los bytes, no por lo que dice el data URL.
    let ext = null
    if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') ext = 'webp'
    else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = 'jpg'
    else if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = 'png'
    if (!ext) throw bad('Solo aceptamos imágenes JPG, PNG o WebP.')
    if (ext === 'jpg' && hasExif(buf)) throw bad('La foto trae metadatos (como la ubicación). Vuelve a elegirla para que la comprimamos antes de subir.', 'exif')
    const mid = ctx.member.id
    const mine = state.academy_uploads.filter((u) => u.member_id === mid)
    const dayAgo = Date.now() - DAY
    const month = santiagoDateKey().slice(0, 7)
    if (mine.filter((u) => Date.parse(u.created_at) > dayAgo).length >= 20) throw new HttpError(429, 'Llegaste al límite de 20 imágenes por día.', 'rate')
    if (mine.filter((u) => santiagoDateKey(u.created_at).startsWith(month)).length >= 100) throw new HttpError(429, 'Llegaste al límite de imágenes de este mes.', 'rate')
    if (state.academy_uploads.filter((u) => santiagoDateKey(u.created_at).startsWith(month)).length >= 1200) throw new HttpError(429, 'La Academy llegó al límite de imágenes de este mes.', 'rate')
    const id = nextId(state, 'academy_uploads')
    // Mismo origen bajo /assets/ (isImageUrl lo acepta): index.mjs sirve los
    // bytes desde memoria. Las privadas (chat) no se sirven por acá: van por el modo `file`.
    const url = `/assets/__mock-uploads/${body.kind}/${mid}-${Date.now()}-${id}.${ext}`
    const contentType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
    const priv = Boolean(body.private) || body.kind === 'chat'
    state.academy_uploads.push({ id, member_id: mid, kind: body.kind, url, bytes: buf.length, private: priv, created_at: nowIso() })
    state.mock.blobs.set(id, { buffer: buf, contentType, private: priv, url })
    return { upload: { id, url: priv ? `/api/academy?mode=file&id=${id}` : url } }
  },

  /* ── Admin (§5.6) ── */
  async 'admin-members'(ctx) {
    const { state, query } = ctx
    const q = String(query.q || '').trim().toLowerCase()
    const status = ['activo', 'cancelado', 'expulsado'].includes(query.status) ? query.status : null
    const courseId = optInt(query.courseId)
    const cohortId = optInt(query.cohortId)
    let list = state.academy_members.slice()
    const counts = { total: list.length, activo: 0, cancelado: 0, expulsado: 0, pendientes: 0 }
    for (const m of list) { counts[m.status] = (counts[m.status] || 0) + 1; if (!m.password_set_at && m.status === 'activo' && m.role !== 'propietario') counts.pendientes++ }
    if (status) list = list.filter((m) => m.status === status)
    if (q) list = list.filter((m) => [m.name, m.email, m.handle].some((x) => String(x || '').toLowerCase().includes(q)))
    if (courseId) list = list.filter((m) => state.academy_grants.some((g) => g.member_id === m.id && g.course_id === courseId && g.state === 'activa'))
    if (cohortId) list = list.filter((m) => state.academy_cohort_members.some((cm) => cm.member_id === m.id && cm.cohort_id === cohortId))
    list.sort((a, b) => b.joined_at.localeCompare(a.joined_at) || b.id - a.id)
    if (String(query.all) === '1') return { members: list.map((m) => memberAdmin(state, m)), total: list.length, counts, page: 1, pages: 1 }
    const pg = paginate(list, { page: query.page, perPage: 30 })
    return { members: pg.items.map((m) => memberAdmin(state, m)), total: pg.total, counts, page: pg.page, pages: pg.pages }
  },

  async 'admin-invite'(ctx) {
    const { state, body } = ctx
    const actor = actorId(ctx) ?? `b${ctx.admin?.barberId}`
    const name = cleanText(body.name, 80).replace(/\n/g, ' ')
    const email = emailNorm(body.email)
    if (!name) throw bad('Escribe el nombre.')
    if (!EMAIL_RE.test(email) || email.length > 120) throw bad('Escribe un correo válido.')
    const courseIds = [...new Set((Array.isArray(body.courseIds) ? body.courseIds : []).map(toInt))]
    if (!courseIds.length || courseIds.some((id) => !state.academy_courses.some((c) => c.id === id))) throw bad('Elige al menos un curso válido para la invitación.')
    const cohortId = optInt(body.cohortId)
    if (cohortId && !state.academy_cohorts.some((c) => c.id === cohortId && !c.archived_at)) throw bad('Ese grupo no existe.')
    const existing = memberByEmail(state, email)
    if (existing?.status === 'expulsado') throw new HttpError(409, 'Ese correo pertenece a un miembro expulsado. Reactívalo primero.', 'expulsado')
    if (!hit(state, `aca-invite:${actor}`, 10, DAY)) throw new HttpError(429, 'Llegaste al límite de 10 invitaciones por día.', 'rate')
    const r = provisionManualGrant(state, { name, email, courseIds, cohortId, source: 'invitacion', actor: actorId(ctx) })
    return { member: memberAdmin(state, r.member), created: r.created, credentials: r.credentials }
  },

  async 'admin-member-update'(ctx) {
    const { state, body } = ctx
    const id = reqInt(body.id)
    const m = memberById(state, id)
    if (!m || m.deleted_at) throw notFound('Miembro no encontrado')
    const actorRole = ctx.admin.role
    if (m.role === 'propietario') throw new HttpError(403, 'La cuenta del propietario no se puede modificar desde acá.', 'forbidden')
    if (actorRole !== 'propietario' && m.role === 'admin') throw new HttpError(403, 'Solo el propietario puede modificar a otro administrador.', 'forbidden')
    if (m.id === actorId(ctx)) throw bad('No puedes cambiar tu propia cuenta desde acá.')
    if ((body.role !== undefined || body.email !== undefined) && actorRole !== 'propietario') throw new HttpError(403, 'Solo el propietario puede cambiar roles o correos.', 'forbidden')
    if (body.role !== undefined) {
      if (body.role === 'propietario') throw bad('Nadie puede asignar el rol de propietario.')
      if (!['admin', 'moderador', 'miembro'].includes(body.role)) throw bad('Rol inválido.')
      m.role = body.role
    }
    if (body.status !== undefined) {
      if (!['activo', 'cancelado', 'expulsado'].includes(body.status)) throw bad('Estado inválido.')
      if (body.status === 'expulsado' && m.status !== 'expulsado') {
        Object.assign(m, { status: 'expulsado', banned_at: nowIso(), session_version: m.session_version + 1 })
        dropPushSubs(state, m.id)
        if (body.purgeRecent) {
          const since = Date.now() - 7 * DAY
          for (const p of state.academy_posts) if (p.author_id === m.id && !p.deleted_at && Date.parse(p.created_at) > since) p.deleted_at = nowIso()
          const touched = new Set()
          for (const c of state.academy_comments) if (c.author_id === m.id && !c.deleted_at && Date.parse(c.created_at) > since) { c.deleted_at = nowIso(); if (c.post_id) touched.add(c.post_id) }
          for (const pid of touched) {
            const p = state.academy_posts.find((x) => x.id === pid)
            if (p) p.comment_count = state.academy_comments.filter((c) => c.post_id === pid && !c.deleted_at).length
          }
        }
      } else if (body.status === 'activo') {
        Object.assign(m, { status: 'activo', banned_at: null })
      } else if (body.status === 'cancelado') {
        Object.assign(m, { status: 'cancelado', session_version: m.session_version + 1 })
        dropPushSubs(state, m.id)
      }
    }
    if (body.email !== undefined && emailNorm(body.email) !== m.email_norm) {
      // §6.6: cambiar el correo es traspasar la cuenta (nueva contraseña temporal).
      const email = emailNorm(body.email)
      if (!EMAIL_RE.test(email) || email.length > 120) throw bad('Escribe un correo válido.')
      if (memberByEmail(state, email)) throw new HttpError(409, 'Ese correo ya está en uso.', 'email_taken')
      Object.assign(m, {
        email, email_norm: email, session_version: m.session_version + 1, password_hash: null, password_set_at: null, must_change_password: true,
        credentials_sent_at: null, credentials_claimed_at: null, credentials_attempts: 0, credentials_retry_at: null,
      })
      state.academy_auth_tokens = state.academy_auth_tokens.filter((t) => t.member_id !== m.id)
      dropPushSubs(state, m.id)
      claimAndSendCredentials(state, m.id)
    }
    m.updated_at = nowIso()
    return { member: memberAdmin(state, m) }
  },

  async 'admin-resend-access'(ctx) {
    const { state, body } = ctx
    const m = memberById(state, reqInt(body.id))
    if (!m || m.deleted_at) throw notFound('Miembro no encontrado')
    if (m.status !== 'activo') throw new HttpError(409, 'Ese miembro no está activo.', 'inactivo')
    if (!m.password_set_at) {
      Object.assign(m, { credentials_sent_at: null, credentials_claimed_at: null, credentials_attempts: 0, credentials_retry_at: null })
      return { credentials: claimAndSendCredentials(state, m.id) }
    }
    sendResetLink(state, m)
    return { credentials: 'cuenta_existente' }
  },

  async 'admin-password-link'(ctx) {
    const { state, body } = ctx
    const m = memberById(state, reqInt(body.id))
    if (!m || m.deleted_at) throw notFound('Miembro no encontrado')
    sendResetLink(state, m)
    return {}
  },

  async 'admin-grant'(ctx) {
    const { state, body } = ctx
    const m = memberById(state, reqInt(body.memberId, 'Falta el miembro.'))
    if (!m || m.deleted_at) throw notFound('Miembro no encontrado')
    const c = state.academy_courses.find((x) => x.id === toInt(body.courseId))
    if (!c) throw notFound('Curso no encontrado')
    if (m.status === 'expulsado') throw new HttpError(409, 'Ese miembro está expulsado. Reactívalo primero.', 'expulsado')
    if (m.status === 'cancelado') Object.assign(m, { status: 'activo', updated_at: nowIso() })
    const { grant, created } = ensureGrant(state, { memberId: m.id, courseId: c.id, source: 'manual', grantedBy: actorId(ctx) })
    if (created) {
      notify(state, { memberId: m.id, kind: 'curso', targetType: 'curso', targetId: c.id, preview: c.title })
      if (m.password_set_at) sendAlready(state, m, c, grant); else claimAndSendCredentials(state, m.id, { course: c })
    }
    return { grant: { id: grant.id, memberId: m.id, courseId: c.id, courseTitle: c.title, state: grant.state, source: grant.source, createdAt: grant.created_at } }
  },

  async 'admin-revoke'(ctx) {
    const { state, body } = ctx
    const g = state.academy_grants.find((x) => x.id === toInt(body.grantId))
    if (!g) throw notFound('Acceso no encontrado')
    const reason = cleanText(body.reason, 200).replace(/\n/g, ' ')
    revokeGrant(state, g, `manual: ${reason || 'sin motivo'}`)
    return {}
  },

  async 'admin-orders'(ctx) {
    const { state, query } = ctx
    const status = ['pendiente', 'pagada', 'revision', 'reembolsada', 'anulada'].includes(query.status) ? query.status : null
    const list = state.academy_orders.filter((o) => !status || o.status === status).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    const pg = paginate(list, { page: query.page, perPage: 30 })
    return { orders: pg.items.map((o) => orderAdmin(state, o)), total: pg.total, page: pg.page, pages: pg.pages }
  },

  async 'admin-verify-order'(ctx) {
    const { state, body } = ctx
    const ref = String(body.ref || '')
    const o = state.academy_orders.find((x) => x.public_ref === ref)
    if (!o) throw notFound('Orden no encontrada')
    // Como reconcileOrder: solo aplica si "Mercado Pago" (el mock) tiene un pago para ese ref.
    const pay = state.mock.mpPayments[ref]
    if (o.status === 'pendiente' && pay) return { order: applyMockPayment(state, ref, pay.status) }
    return { order: orderAdmin(state, o) }
  },

  async 'admin-import-grant'(ctx) {
    const { state, body } = ctx
    const name = cleanText(body.name, 80).replace(/\n/g, ' ')
    const email = emailNorm(body.email)
    if (!name) throw bad('Escribe el nombre.')
    if (!EMAIL_RE.test(email) || email.length > 120) throw bad('Escribe un correo válido.')
    const c = state.academy_courses.find((x) => x.id === toInt(body.courseId))
    if (!c) throw bad('Elige un curso válido.')
    const ext = body.externalRef == null || body.externalRef === '' ? null : String(body.externalRef).trim()
    if (ext && !/^[A-Za-z0-9:_.-]{3,80}$/.test(ext)) throw bad('La referencia externa no es válida.')
    if (memberByEmail(state, email)?.status === 'expulsado') throw new HttpError(409, 'Ese correo pertenece a un miembro expulsado.', 'expulsado')
    const r = provisionManualGrant(state, { name, email, courseIds: [c.id], source: ext ? 'puente' : 'manual', externalRef: ext, actor: actorId(ctx) })
    return { member: memberAdmin(state, r.member), created: r.created, credentials: r.credentials }
  },

  async 'admin-settings'(ctx) {
    const { state, body } = ctx
    if (ctx.method === 'GET') return { settings: settingsOf(state) }
    const cur = settingsOf(state)
    const patch = {}
    if (body.group !== undefined) {
      const g = body.group || {}
      const out = {}
      if (g.name !== undefined) { out.name = cleanText(g.name, 60).replace(/\n/g, ' '); if (!out.name) throw bad('El grupo necesita un nombre.') }
      if (g.description !== undefined) out.description = cleanText(g.description, 5000)
      if (g.initials !== undefined) out.initials = cleanText(g.initials, 3).toUpperCase() || HOST.brand.initials
      if (g.color !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(String(g.color))) throw bad('Color inválido.'); out.color = g.color }
      for (const k of ['coverUrl', 'iconUrl']) {
        if (g[k] === undefined) continue
        if (g[k] && !isImageUrl(g[k])) throw bad('Las imágenes del grupo tienen que subirse desde acá.')
        out[k] = g[k] || null
      }
      if (g.links !== undefined) {
        if (!Array.isArray(g.links) || g.links.length > 5) throw bad('Máximo 5 enlaces.')
        out.links = g.links.map((l) => {
          const url = safeUrl(l?.url); const title = cleanText(l?.title, 60).replace(/\n/g, ' ')
          if (!url || !title) throw bad('Uno de los enlaces no es válido.')
          return { title, url }
        })
      }
      if (g.rules !== undefined) {
        if (!Array.isArray(g.rules) || g.rules.length > 20) throw bad('Máximo 20 reglas.')
        out.rules = g.rules.map((r) => ({ title: cleanText(r?.title, 120).replace(/\n/g, ' '), body: cleanText(r?.body, 1000) })).filter((r) => r.title)
      }
      if (g.media !== undefined) {
        if (!Array.isArray(g.media) || g.media.length > 12) throw bad('Máximo 12 imágenes o videos.')
        out.media = g.media.map((x) => {
          if (x?.kind === 'youtube') { const videoId = parseYouTubeId(String(x.videoId || x.url || '')); if (!videoId) throw bad('Uno de los videos no es válido.'); return { kind: 'youtube', videoId } }
          if (x?.kind === 'image' && isImageUrl(x.url)) return { kind: 'image', url: x.url }
          throw bad('Una de las imágenes no es válida.')
        })
      }
      patch.group = out
    }
    if (body.levels !== undefined) {
      const names = body.levels?.names
      if (!Array.isArray(names) || names.length !== 9) throw bad('Tienen que ser 9 nombres de nivel.')
      const clean = names.map((n) => cleanText(n, 20).replace(/\n/g, ' '))
      if (clean.some((n) => !n) || names.some((n) => String(n).trim().length > 20)) throw bad('Cada nivel necesita un nombre de hasta 20 caracteres.')
      patch.levels = { names: clean }
    }
    if (body.plugins !== undefined) {
      const p = body.plugins || {}
      const out = {}
      for (const k of ['minPostLevel', 'minChatLevel']) {
        if (p[k] === undefined) continue
        if (p[k] === null || p[k] === '') { out[k] = null; continue }
        const n = toInt(p[k]); if (!(n >= 1 && n <= 9)) throw bad('El nivel mínimo va de 1 a 9.'); out[k] = n
      }
      if (p.autoDm !== undefined) {
        out.autoDm = {}
        if (typeof p.autoDm?.enabled === 'boolean') out.autoDm.enabled = p.autoDm.enabled
        if (p.autoDm?.text !== undefined) out.autoDm.text = cleanText(p.autoDm.text, 1000)
      }
      if (p.welcomeVideoId !== undefined) {
        const vid = p.welcomeVideoId ? parseYouTubeId(String(p.welcomeVideoId)) : null
        if (p.welcomeVideoId && !vid) throw bad('Ese video de YouTube no es válido.')
        out.welcomeVideoId = vid
      }
      patch.plugins = out
    }
    if (body.tabs !== undefined) {
      const out = {}
      for (const k of ['comunidad', 'calendario', 'clasificacion']) if (typeof body.tabs?.[k] === 'boolean') out[k] = body.tabs[k]
      patch.tabs = out
    }
    if (body.sync !== undefined && typeof body.sync?.enabled === 'boolean') patch.sync = { enabled: body.sync.enabled }
    if (body.autoprovision !== undefined) patch.autoprovision = Boolean(body.autoprovision)
    const next = deepMerge(cur, patch)
    // Guarda solo lo que difiere de los defaults no hace falta en el mock: se guarda todo.
    if (!state.academy_settings.length) state.academy_settings.push({ id: 1, settings: {}, updated_at: nowIso() })
    Object.assign(state.academy_settings[0], { settings: next, updated_at: nowIso() })
    return { settings: deepMerge(DEFAULT_SETTINGS, next) }
  },

  async 'admin-stats'(ctx) {
    const { state } = ctx
    const now = Date.now()
    const since = (d) => now - d * DAY
    const active = state.academy_members.filter((m) => m.status === 'activo' && !m.deleted_at)
    const paid30 = state.academy_orders.filter((o) => o.status === 'pagada' && o.paid_at && Date.parse(o.paid_at) > since(30))
    const month = santiagoDateKey().slice(0, 7)
    const today = santiagoDateKey()
    return {
      members: {
        active: active.length,
        new7: active.filter((m) => Date.parse(m.joined_at) > since(7)).length,
        new30: active.filter((m) => Date.parse(m.joined_at) > since(30)).length,
        active7: active.filter((m) => m.last_seen_at && Date.parse(m.last_seen_at) > since(7)).length,
      },
      courses: state.academy_courses.slice().sort(byPos).map((c) => {
        const owners = [...new Set(state.academy_grants.filter((g) => g.course_id === c.id && g.state === 'activa').map((g) => g.member_id))]
        const pct = owners.length ? Math.round(owners.reduce((s, mid) => s + courseProgressPct(state, mid, c.id), 0) / owners.length) : 0
        return { id: c.id, title: c.title, owners: owners.length, completedPct: pct }
      }),
      orders: { paid30: paid30.length, revenue30: paid30.reduce((s, o) => s + (o.paid_amount ?? o.amount), 0), pending: state.academy_orders.filter((o) => o.status === 'pendiente').length },
      community: {
        posts7: state.academy_posts.filter((p) => !p.deleted_at && Date.parse(p.created_at) > since(7)).length,
        comments7: state.academy_comments.filter((c) => !c.deleted_at && Date.parse(c.created_at) > since(7)).length,
      },
      uploads: { month: state.academy_uploads.filter((u) => santiagoDateKey(u.created_at).startsWith(month)).length, limit: 1200 },
      email: { today: state.outbox.filter((e) => santiagoDateKey(e.createdAt) === today).length, budget: 60 },
    }
  },
}

// JPEG: busca un segmento APP1 "Exif" (trae GPS del teléfono).
function hasExif(buf) {
  let i = 2
  while (i + 4 < buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (marker === 0xe1 && buf.subarray(i + 4, i + 10).toString('latin1') === 'Exif\0\0') return true
    if (marker === 0xda) break // empieza la imagen: ya no hay metadatos
    i += 2 + len
  }
  return false
}

/* ── Checkout de cursos (§6.1, §13) ───────────────────────────────────── */
export const checkout = {
  // POST <MOCK_HOST.checkoutPath> con kind:'course'. Aprueba al instante (como si el
  // webhook ya hubiera llegado) salvo DEV_MOCK_CHECKOUT=pending.
  async post(ctx) {
    const { state, body, ip } = ctx
    if (process.env.DEV_MOCK_CHECKOUT === 'off') throw new HttpError(503, 'Las inscripciones de Academy todavía no abren')
    if (!hit(state, `checkout:${ip}`, 10, 5 * MIN)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.')
    const name = cleanText(body.name, 80).replace(/\n/g, ' ')
    const email = emailNorm(body.email)
    const modality = body.modality
    if (!name) throw bad('Escribe tu nombre.')
    if (!EMAIL_RE.test(email) || email.length > 120) throw bad('Escribe un correo válido.')
    if (emailNorm(body.emailConfirm) !== email) throw bad('Los correos no coinciden.', 'email_mismatch')
    if (body.acceptTerms !== true) throw bad('Tienes que aceptar los términos para continuar.', 'terms')
    if (!['online', 'presencial'].includes(modality)) throw bad('Elige la modalidad.')
    const phoneDigits = String(body.phone || '').replace(/\D/g, '')
    const phone = phoneDigits ? phoneDigits.slice(-9) : null
    if (phone && phone.length !== 9) throw bad('El teléfono debe tener 9 dígitos.')
    const cohortId = modality === 'presencial' ? optInt(body.cohortId) : null
    if (modality === 'presencial' && !cohortId) throw bad('Elige la generación.')
    const existing = memberByEmail(state, email)
    if (existing?.status === 'expulsado') throw new HttpError(409, 'No podemos procesar esta compra, escríbenos.')
    const course = state.academy_courses.find((c) => c.slug === String(body.courseSlug || ''))
    if (existing && course && state.academy_grants.some((g) => g.member_id === existing.id && g.course_id === course.id && g.state === 'activa')) {
      throw new HttpError(409, 'Ya tienes este curso', 'ya_tienes')
    }
    const amount = modality === 'presencial' ? course?.price_presencial : course?.price_online
    if (!course || !course.published || !course.sales_open || amount == null) throw new HttpError(409, 'Ese curso no está disponible')
    if (cohortId) {
      const co = state.academy_cohorts.find((c) => c.id === cohortId)
      if (!co || co.archived_at || !co.sales_open || co.course_id !== course.id) throw new HttpError(409, 'Ese curso no está disponible')
      if (cohortSeatsLeft(state, co) === 0) throw new HttpError(409, 'No quedan cupos en esa generación', 'sin_cupos')
    }
    const now = nowIso()
    const order = {
      id: nextId(state, 'academy_orders'), public_ref: `aca-${crypto.randomBytes(16).toString('hex')}`, course_id: course.id, cohort_id: cohortId,
      modality, title_snapshot: course.title, amount, name, email: String(body.email).trim(), email_norm: email, phone, user_id: null,
      status: 'pendiente', mp_preference_id: `mock-pref-${Date.now()}`, mp_payment_id: null, mp_last_status: null, mp_payer_email: null,
      live_mode: null, paid_at: null, paid_amount: null, refunded_at: null, refund_reason: null, created_at: now, updated_at: now,
    }
    state.academy_orders.push(order)
    if (process.env.DEV_MOCK_CHECKOUT !== 'pending') {
      state.mock.mpPayments[order.public_ref] = { status: 'approved', at: now }
      const r = grantFromOrder(state, order, { paymentId: `mock-${Date.now()}` })
      console.log(`  ✓ Mock Academy · pago aprobado al instante: ${course.title} (${modality}) $${amount.toLocaleString('es-CL')} → ${r.member.email} · credenciales: ${r.credentials}`)
    } else {
      console.log(`  … Mock Academy · orden ${order.public_ref} queda pendiente (DEV_MOCK_CHECKOUT=pending). Apruébala con POST /api/__mock/mp?ref=${order.public_ref}&status=approved`)
    }
    return { ref: order.public_ref, total: amount, initPoint: `${HOST.base}/gracias?ref=${order.public_ref}&mock=1` }
  },

  // GET <MOCK_HOST.checkoutPath>?ref=aca-… (PimpStudio: /api/checkout?ref=…,
  // BrunettiCutz: /api/mp-payments?status=1&ref=…)
  async status(ctx) {
    const { state, query } = ctx
    const ref = String(query.ref || '')
    if (!/^aca-[a-f0-9]{32}$/.test(ref)) throw bad('Referencia inválida')
    const o = state.academy_orders.find((x) => x.public_ref === ref)
    if (!o) throw notFound('Orden no encontrada')
    const c = state.academy_courses.find((x) => x.id === o.course_id)
    return { kind: 'course', ref, status: o.status, course: { slug: c?.slug || null, title: o.title_snapshot }, modality: o.modality, total: o.amount, emailMasked: maskEmail(o.email) }
  },
}

/* ── Ayudas de /api/__mock ────────────────────────────────────────────── */
export function mockLoginAs(state, { member, email } = {}) {
  const m = member ? memberById(state, toInt(member)) : memberByEmail(state, email)
  if (!m) throw notFound('Miembro no encontrado')
  if (m.status !== 'activo' || m.deleted_at) throw new HttpError(409, `Ese miembro está ${m.status}: no puede entrar.`)
  Object.assign(m, { last_login_at: nowIso(), last_seen_at: nowIso() })
  return { token: issueMemberToken(state, m, { pwc: Boolean(m.must_change_password) }), member: meOf(state, m) }
}

export function mockMemberList(state) {
  return state.academy_members.map((m) => ({
    id: m.id, name: m.name, email: m.email, handle: m.handle, role: m.role, status: m.status,
    level: levelFor(pointsOf(state, m.id)).level, mustChangePassword: Boolean(m.must_change_password),
    courses: activeGrantCourseIds(state, m.id).length,
  }))
}

// Re-export para index.mjs (Me de login-as) y para pruebas.
export { memberMini, isStaff, viewerOf }
