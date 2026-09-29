/* ACADEMY — Cuenta del miembro (SPEC §5.1)
   ------------------------------------------------------------------
   login, cambio/restablecimiento de contraseña, `me`, perfil, cambio de
   correo, cerrar sesión en todos lados, exportar/eliminar mis datos, la
   página pública "Acerca de", la entrada del dueño desde el panel
   (owner-session) e `idle`.

   Reglas que este archivo no rompe:
     - NINGÚN modo de acá llama a ensureAcademyTables (el router lo hace
       solo para `me` y owner-session). login y los resets son públicos: una
       tabla que falta (42P01) se responde como "correo o contraseña
       incorrectos" o con el mensaje genérico, nunca con DDL.
     - El login no revela qué correos compraron: mismo mensaje, mismo tiempo
       (PBKDF2 en falso) y mismo contador para un correo inexistente que
       para una contraseña mala. 'temp_expired' e 'inactive' solo se dicen
       DESPUÉS de que la contraseña calzó.
     - El tope global (30/min) va ANTES de cualquier PBKDF2: el plan Hobby
       tiene poca CPU y un login público es la forma más barata de
       quemarla.
     - Toda escritura que invalida sesiones sube session_version en la
       misma sentencia.
   Prefijo `_`: no cuenta como función serverless. */

import { createMemberSession } from "./_academySession.js"
import {
  hashPasswordAsync, verifyPasswordAsync, dummyVerifyAsync, canonicalTemp,
  isValidMemberPassword, MEMBER_PASSWORD_RULES, generateResetToken, hashResetToken,
} from "./_academyPassword.js"
import { rateLimit, checkLock, registerFailure, clearFailures } from "./_academyLimits.js"
import { sendAcademyEmail, sendAcademyResetEmail, sendAcademyEmailChangeEmail, sendAcademyEmailChangedNotice } from "./_academyEmail.js"
import { HOST, siteUrl } from "./_academyHost.js"
import { loadMe, touchSeen } from "./_academyAuth.js"
import { HttpError, getSettings, normalizePrefs, DEFAULT_PREFS, runInBackground, pgCode, isAdminRole } from "./_academyHttp.js"
import { normalizeEmail, cleanText, cleanLine, safeUrl, isImageUrl, slugify, maskEmail, syntheticOwnerEmail } from "./_academyText.js"

// Páginas de la Academy en este sitio (https://pimpstudio.cl/academy).
const academyUrl = () => `${siteUrl()}${HOST.basePath}`
const RESET_TTL_MIN = 30
const EMAIL_TTL_MIN = 30
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000

const LOGIN_FAIL = "Correo o contraseña incorrectos"
const AUTH_ERROR = "Sesión de Academy requerida"
const EXPIRED_LINK = "Este enlace ya se usó o venció. Pide uno nuevo."
const GENERIC_RESET = "Si ese correo tiene acceso a la Academy, te enviamos un enlace para crear una contraseña nueva."

/* Bloqueo por fallos, con prefijo propio: compartir `login-ip:` con el panel
   haría que alumnos equivocándose en el Wi-Fi del local bloquearan el login
   de Bruno desde esa IP. 5 por correo; 20 por IP porque un curso presencial
   entra entero detrás del mismo router. */
const USER_LOCK = { max: 5, lockSeconds: 300 }
const IP_LOCK = { max: 20, lockSeconds: 300 }
const userKey = (emailNorm) => `aca-login-user:${emailNorm}`
const ipKey = (ip) => `aca-login-ip:${ip}`

const isPlainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v)
const str = (v) => (typeof v === "string" ? v : "")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function lockedError(retryAfterSeconds, unavailable) {
  const secs = Math.max(1, Math.ceil(Number(retryAfterSeconds) || 60))
  const minutes = Math.max(1, Math.ceil(secs / 60))
  return new HttpError(
    429,
    unavailable
      ? "No pudimos verificar tu acceso en este momento. Intenta de nuevo en un minuto."
      : `Demasiados intentos fallidos. Vuelve a intentar en ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`,
    "locked",
    { retryAfter: secs },
  )
}

/* Registra el fallo en las dos llaves (cada una con su tope) y lanza el
   error que corresponde. Mismo camino para correo inexistente y contraseña
   mala: distinguirlos convierte el login en un verificador de compradores. */
async function failLogin(sql, emailNorm, ip) {
  const [u, i] = await Promise.all([
    registerFailure(sql, [userKey(emailNorm)], USER_LOCK),
    registerFailure(sql, [ipKey(ip)], IP_LOCK),
  ])
  if (u.locked || i.locked) throw lockedError(Math.max(u.locked ? u.retryAfterSeconds : 0, i.locked ? i.retryAfterSeconds : 0))
  throw new HttpError(401, LOGIN_FAIL, "invalid_credentials", { remainingAttempts: u.remainingAttempts })
}

function sessionOrFail(opts) {
  const token = createMemberSession(opts)
  if (!token) throw new HttpError(503, "La autenticación de la Academy no está configurada en el servidor.", "unavailable")
  return token
}

/* ── login ─────────────────────────────────────────────────────────────── */
async function login(ctx) {
  const { sql, body, ip } = ctx
  const email = normalizeEmail(body.email)
  const password = str(body.password)
  if (!email || !password) throw new HttpError(400, "Escribe tu correo y tu contraseña.", "invalid")

  const allowed = await rateLimit(sql, "aca-login-global", { max: 30, windowSeconds: 60 })
  if (!allowed) throw new HttpError(429, "Hay muchos intentos de ingreso en este momento. Espera un minuto y vuelve a intentar.", "busy", { retryAfter: 60 })

  // El bloqueo se mira ANTES de tocar la contraseña: bloqueado no gasta
  // PBKDF2 ni revela nada. checkLock falla cerrado si la base no
  // responde.
  const lock = await checkLock(sql, [userKey(email), ipKey(ip)])
  if (lock.locked) throw lockedError(lock.retryAfterSeconds, lock.unavailable)

  // Más de 200 caracteres no es una contraseña válida de nadie: fallo
  // directo, sin gastar un PBKDF2 en hashear un megabyte.
  if (password.length > 200) return failLogin(sql, email, ip)

  let row = null
  try {
    ;[row] = await sql`
      SELECT id, email, role, status, password_hash, must_change_password, session_version,
             (temp_password_expires_at IS NOT NULL AND temp_password_expires_at < NOW()) AS temp_expired
      FROM academy_members
      WHERE email_norm = ${email} AND deleted_at IS NULL
    `
  } catch (err) {
    // Sin tablas todavía: nadie puede tener cuenta. Se responde como un
    // correo inexistente (sin DDL en este camino, SPEC §0.3).
    if (pgCode(err) !== "42P01") {
      console.error("[academy:login] db:", err?.code || err?.message || err)
      throw new HttpError(503, "No pudimos verificar tu acceso en este momento. Intenta de nuevo en un momento.", "unavailable")
    }
    row = null
  }

  // Sin fila, o fila sin contraseña (el propietario entra por el panel; una
  // compra cuyas credenciales aún no salen): mismo trato que un correo que
  // no existe.
  if (!row || !row.password_hash) {
    await dummyVerifyAsync()
    return failLogin(sql, email, ip)
  }

  let check = await verifyPasswordAsync(password, row.password_hash)
  // La temporal se guarda en forma canónica (K7QM4RTX9PWD). Si la persona la
  // escribió con guiones, espacios o minúsculas, se reintenta canonizada.
  // Solo para cuentas que están en contraseña temporal.
  if (!check.ok && row.must_change_password) {
    const canon = canonicalTemp(password)
    if (canon && canon !== password) check = await verifyPasswordAsync(canon, row.password_hash)
  }
  if (!check.ok) return failLogin(sql, email, ip)

  // Desde acá la contraseña calzó: recién ahora se puede decir algo más
  // específico sin regalar información a quien no la sabe.
  if (row.must_change_password && row.temp_expired) {
    throw new HttpError(401, "Tu contraseña temporal venció. Toca «¿Olvidaste tu contraseña?» y te mandamos un enlace para crear una nueva.", "temp_expired")
  }
  if (row.status !== "activo") {
    throw new HttpError(403, "Tu acceso a la Academy no está activo. Si crees que es un error, escríbenos.", "inactive")
  }

  // Solo se limpia la llave del correo. La de la IP no: si no, alguien con
  // una cuenta válida podría intercalar logins buenos para seguir probando
  // contraseñas ajenas desde la misma IP sin llegar nunca al tope.
  await clearFailures(sql, [userKey(email)])
  try {
    if (check.needsRehash && !row.must_change_password) {
      const rehashed = await hashPasswordAsync(password)
      await sql`UPDATE academy_members SET password_hash = ${rehashed}, last_login_at = NOW() WHERE id = ${row.id}`
    } else {
      await sql`UPDATE academy_members SET last_login_at = NOW() WHERE id = ${row.id}`
    }
  } catch (err) {
    console.error("[academy:login] last_login_at:", err?.code || err?.message || err)
  }

  const mustChangePassword = Boolean(row.must_change_password)
  const token = sessionOrFail({ id: Number(row.id), sessionVersion: Number(row.session_version), mustChangePassword })
  const member = await loadMe(sql, row.id)
  return { token, member, mustChangePassword }
}

/* ── password-change (admite el token pwc) ─────────────────────────────── */
async function passwordChange(ctx) {
  const { sql, body, member } = ctx
  const newPassword = str(body.newPassword)
  const [row] = await sql`
    SELECT id, email, email_norm, password_hash, must_change_password
    FROM academy_members WHERE id = ${member.id}
  `
  if (!row) throw new HttpError(401, AUTH_ERROR, "auth")
  if (!isValidMemberPassword(newPassword, row.email)) throw new HttpError(400, MEMBER_PASSWORD_RULES, "weak_password")

  // Con contraseña temporal (o token pwc) no se pide la actual: la persona
  // acaba de probarla en el login hace menos de 15 minutos.
  const forced = Boolean(row.must_change_password) || member.token?.pwc
  if (!forced) {
    const current = str(body.currentPassword)
    if (!current) throw new HttpError(400, "Escribe tu contraseña actual.", "current_required")
    const key = userKey(row.email_norm)
    const lock = await checkLock(sql, [key])
    if (lock.locked) throw lockedError(lock.retryAfterSeconds, lock.unavailable)
    const ok = row.password_hash ? (await verifyPasswordAsync(current, row.password_hash)).ok : false
    if (!ok) {
      // Adivinar la actual desde una sesión robada cuenta para el mismo
      // bloqueo que el login.
      const f = await registerFailure(sql, [key], USER_LOCK)
      if (f.locked) throw lockedError(f.retryAfterSeconds)
      throw new HttpError(400, "Tu contraseña actual no es correcta.", "wrong_password")
    }
  } else if (row.password_hash) {
    // La temporal viajó por correo: quedarse con ella es quedarse con una
    // contraseña que cualquiera con acceso a esa casilla conoce.
    const same = await verifyPasswordAsync(canonicalTemp(newPassword) || newPassword, row.password_hash)
    if (same.ok) throw new HttpError(400, "Elige una contraseña distinta a la temporal.", "same_as_temp")
  }

  const hash = await hashPasswordAsync(newPassword)
  // session_version se compara con el del token: si en paralelo alguien
  // cerró sesión en todos lados, este cambio no "revive" la sesión vieja.
  const [upd] = await sql`
    WITH m AS (
      UPDATE academy_members
         SET password_hash = ${hash}, password_set_at = NOW(), must_change_password = false,
             temp_password_expires_at = NULL, session_version = session_version + 1, updated_at = NOW()
       WHERE id = ${member.id} AND session_version = ${member.sessionVersion} AND status = 'activo'
      RETURNING id, session_version
    ), t AS (
      UPDATE academy_auth_tokens SET used_at = NOW()
       WHERE member_id IN (SELECT id FROM m) AND purpose = 'reset' AND used_at IS NULL
      RETURNING 1
    )
    SELECT id, session_version FROM m
  `
  if (!upd) throw new HttpError(401, "Tu sesión cambió mientras tanto. Vuelve a entrar.", "auth")
  await clearFailures(sql, [userKey(row.email_norm)])
  const token = sessionOrFail({ id: member.id, sessionVersion: Number(upd.session_version), mustChangePassword: false })
  return { token, member: await loadMe(sql, member.id) }
}

/* ── password-reset-request (público) ──────────────────────────────────── */
async function passwordResetRequest(ctx) {
  const { sql, body, ip } = ctx
  const email = normalizeEmail(body.email)
  if (!email) throw new HttpError(400, "Escribe un correo válido.", "invalid")

  // Por IP (que nadie mande correos masivos con esto) y por correo (que a
  // nadie le lluevan enlaces). La respuesta del tope no depende de si el
  // correo existe.
  const ipOk = await rateLimit(sql, `aca-reset-ip:${ip}`, { max: 10, windowSeconds: 3600 })
  const mailOk = ipOk && (await rateLimit(sql, `aca-reset-mail:${email}`, { max: 3, windowSeconds: 86400 }))
  if (!ipOk || !mailOk) throw new HttpError(429, "Pediste varios enlaces seguidos. Espera un rato antes de pedir otro.", "rate_limited", { retryAfter: 900 })

  const work = (async () => {
    let row = null
    try {
      ;[row] = await sql`
        SELECT id, name, email FROM academy_members
        WHERE email_norm = ${email} AND status = 'activo' AND deleted_at IS NULL
      `
    } catch (err) {
      if (pgCode(err) === "42P01") return false
      throw err
    }
    if (!row) return false
    const { token, tokenHash } = generateResetToken()
    // Pedir un enlace nuevo anula los anteriores: un correo viejo filtrado
    // no debe seguir sirviendo.
    await sql.transaction([
      sql`UPDATE academy_auth_tokens SET used_at = NOW() WHERE member_id = ${row.id} AND purpose = 'reset' AND used_at IS NULL`,
      sql`
        INSERT INTO academy_auth_tokens (token_hash, member_id, purpose, expires_at, requested_ip)
        VALUES (${tokenHash}, ${row.id}, 'reset', NOW() + make_interval(mins => ${RESET_TTL_MIN}::int), ${ip})
      `,
    ])
    const resetUrl = `${academyUrl()}/restablecer?token=${encodeURIComponent(token)}`
    await sendAcademyEmail(sql, "reset", sendAcademyResetEmail, { to: row.email, name: row.name, resetUrl, minutes: RESET_TTL_MIN })
    return true
  })()

  /* La respuesta es la misma exista o no el correo. Para que tampoco la
     DELATE EL TIEMPO (buscar + guardar + mandar tarda ~1 s; "no existe"
     tarda lo que una consulta), el trabajo se deja corriendo después de
     responder cuando el runtime lo permite (waitUntil de Vercel). Si no se
     puede, se espera y el caso "no existe" se rellena con una pausa. */
  if (runInBackground(work)) return { message: GENERIC_RESET }
  let found = false
  try {
    found = await work
  } catch (err) {
    console.error("[academy:password-reset-request]", err?.code || err?.message || err)
    throw new HttpError(503, "No pudimos procesar la solicitud. Intenta más tarde.", "unavailable")
  }
  if (!found) await sleep(350 + Math.floor(Math.random() * 500))
  return { message: GENERIC_RESET }
}

/* ── password-reset-confirm (público) ──────────────────────────────────── */
async function passwordResetConfirm(ctx) {
  const { sql, body, ip } = ctx
  const token = str(body.token).trim()
  const password = str(body.password)
  if (token.length < 20 || token.length > 200) throw new HttpError(400, "Enlace inválido.", "invalid_token")

  const allowed = await rateLimit(sql, `aca-reset-confirm:${ip}`, { max: 10, windowSeconds: 900 })
  if (!allowed) throw new HttpError(429, "Demasiados intentos. Espera unos minutos.", "rate_limited", { retryAfter: 900 })

  const tokenHash = hashResetToken(token)
  // Se MIRA el token (sin gastarlo) para validar la contraseña contra el
  // correo de la cuenta: gastarlo primero y rechazar la contraseña después
  // obligaría a pedir otro enlace por un error de tipeo.
  let peek = null
  try {
    ;[peek] = await sql`
      SELECT t.member_id, m.email
      FROM academy_auth_tokens t
      JOIN academy_members m ON m.id = t.member_id
      WHERE t.token_hash = ${tokenHash} AND t.purpose = 'reset' AND t.used_at IS NULL
        AND t.expires_at > NOW() AND m.status = 'activo'
    `
  } catch (err) {
    if (pgCode(err) !== "42P01") throw err
  }
  if (!peek) throw new HttpError(400, EXPIRED_LINK, "invalid_token")
  if (!isValidMemberPassword(password, peek.email)) throw new HttpError(400, MEMBER_PASSWORD_RULES, "weak_password")

  const hash = await hashPasswordAsync(password)
  /* Una sola sentencia: gastar el token, fijar la contraseña (activa
     también una cuenta que nunca tuvo una), subir session_version (cierra
     todas las sesiones: si alguien pidió el reset es porque algo pasó),
     borrar las suscripciones push de esos dispositivos y anular los demás
     enlaces pendientes (reset y cambio de correo). Dos envíos simultáneos
     del mismo enlace: el UPDATE ... used_at IS NULL deja pasar a uno solo. */
  const [row] = await sql`
    WITH t AS (
      UPDATE academy_auth_tokens SET used_at = NOW()
       WHERE token_hash = ${tokenHash} AND purpose = 'reset' AND used_at IS NULL AND expires_at > NOW()
      RETURNING member_id
    ), m AS (
      UPDATE academy_members
         SET password_hash = ${hash}, password_set_at = NOW(), must_change_password = false,
             temp_password_expires_at = NULL, session_version = session_version + 1, updated_at = NOW()
       WHERE id = (SELECT member_id FROM t) AND status = 'activo'
      RETURNING id, email_norm, session_version
    ), p AS (
      DELETE FROM academy_push_subscriptions WHERE member_id IN (SELECT id FROM m) RETURNING 1
    ), o AS (
      UPDATE academy_auth_tokens SET used_at = NOW()
       WHERE member_id IN (SELECT id FROM m) AND purpose IN ('reset', 'email') AND used_at IS NULL
         AND token_hash <> ${tokenHash}
      RETURNING 1
    )
    SELECT id, email_norm, session_version FROM m
  `
  if (!row) throw new HttpError(400, EXPIRED_LINK, "invalid_token")
  // Quien recupera su cuenta no debe quedar bloqueado por los intentos que
  // hizo antes de acordarse de que no se acordaba.
  await clearFailures(sql, [userKey(row.email_norm)])
  const sessionToken = sessionOrFail({ id: Number(row.id), sessionVersion: Number(row.session_version) })
  return { token: sessionToken, member: await loadMe(sql, row.id) }
}

/* ── me (admite pwc; el router ya corrió ensureAcademyTables) ──────────── */
function groupSummary(settings) {
  const g = settings.group
  return {
    name: g.name,
    initials: g.initials,
    iconUrl: g.iconUrl,
    color: g.color,
    tabs: settings.tabs,
    levels: { names: settings.levels.names },
    sync: settings.sync,
    plugins: { minPostLevel: settings.plugins.minPostLevel, minChatLevel: settings.plugins.minChatLevel },
  }
}

async function me(ctx) {
  const { sql, member } = ctx
  if (member.seenStale) await touchSeen(sql, member.id)
  const [profile, settings] = await Promise.all([loadMe(sql, member.id), getSettings(sql)])
  if (!profile) throw new HttpError(401, AUTH_ERROR, "auth")
  const out = { member: profile, group: groupSummary(settings) }
  // Renovación deslizante: un token de más de un día se cambia por uno
  // nuevo con el mismo session_version. Un token pwc NUNCA se renueva a uno
  // completo — la única salida de "crea tu contraseña" es crearla.
  const age = Date.now() - (member.token?.iat || 0)
  if (!member.token?.pwc && !profile.mustChangePassword && age > RENEW_AFTER_MS) {
    const token = createMemberSession({ id: member.id, sessionVersion: member.sessionVersion })
    if (token) out.token = token
  }
  return out
}

/* ── me-update ─────────────────────────────────────────────────────────── */
const HANDLE_RE = /^[a-z0-9-]{3,40}$/
const RESERVED_HANDLE = /^(bruno|brunetti|admin|soporte|moderador|academy|pimp|pimpstudio)/
const LINK_LABEL = { instagram: "Instagram", tiktok: "TikTok", whatsapp: "WhatsApp", web: "tu sitio web" }

/* Un link del perfil. Además de URLs completas se aceptan las formas que la
   gente escribe de verdad (@usuario, un número de WhatsApp, "misitio.cl") y
   se convierten a URL — que después pasa por safeUrl igual que todo. */
function normalizeProfileLink(key, value) {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  if (raw.length > 300) throw new HttpError(400, `El enlace de ${LINK_LABEL[key]} es demasiado largo.`, "invalid_link")
  let candidate = raw
  if (!/^https?:\/\//i.test(raw)) {
    const handle = raw.replace(/^@/, "")
    if (key === "instagram" && /^[A-Za-z0-9._]{1,30}$/.test(handle)) candidate = `https://www.instagram.com/${handle}`
    else if (key === "tiktok" && /^[A-Za-z0-9._]{2,24}$/.test(handle)) candidate = `https://www.tiktok.com/@${handle}`
    else if (key === "whatsapp") {
      const digits = raw.replace(/\D/g, "")
      // 9 dígitos = celular chileno sin código de país.
      if (digits.length >= 8 && digits.length <= 15) candidate = `https://wa.me/${digits.length === 9 ? `56${digits}` : digits}`
    } else if (key === "web" && /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/[^\s]*)?$/.test(raw)) candidate = `https://${raw}`
  }
  const url = safeUrl(candidate)
  if (!url || url.startsWith("/")) throw new HttpError(400, `El enlace de ${LINK_LABEL[key]} no es válido.`, "invalid_link")
  return url
}

function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/* Aplica un parche de prefs sobre las actuales. Solo llaves conocidas y
   del tipo correcto; cualquier otra cosa es 400 (no se guarda basura que
   después otro módulo tenga que interpretar). */
function applyPrefsPatch(current, patch) {
  if (!isPlainObject(patch)) throw new HttpError(400, "Preferencias inválidas.", "invalid")
  const next = normalizePrefs(current)
  const bad = () => new HttpError(400, "Preferencias inválidas.", "invalid")
  const boolGroup = (group, keys) => {
    if (patch[group] === undefined) return
    if (!isPlainObject(patch[group])) throw bad()
    for (const k of keys) {
      const v = patch[group][k]
      if (v === undefined) continue
      if (typeof v !== "boolean") throw bad()
      next[group][k] = v
    }
  }
  boolGroup("notif", Object.keys(DEFAULT_PREFS.notif))
  boolGroup("chat", ["enabled", "previews"])
  boolGroup("privacy", ["hideActivity", "hideOnline"])
  if (patch.onboarding !== undefined) {
    if (!isPlainObject(patch.onboarding)) throw bad()
    const { dismissed, done } = patch.onboarding
    if (dismissed !== undefined) {
      if (typeof dismissed !== "boolean") throw bad()
      next.onboarding.dismissed = dismissed
    }
    if (done !== undefined) {
      if (!Array.isArray(done) || done.length > 20 || done.some((d) => typeof d !== "string" || !/^[a-z0-9-]{1,40}$/.test(d))) throw bad()
      next.onboarding.done = [...new Set(done)]
    }
  }
  if (patch.tz !== undefined) {
    if (patch.tz === null || patch.tz === "") delete next.tz
    else if (validTimeZone(patch.tz)) next.tz = patch.tz
    else throw new HttpError(400, "Zona horaria inválida.", "invalid")
  }
  if (patch.theme !== undefined) {
    if (patch.theme === null || patch.theme === "") delete next.theme
    else if (["claro", "oscuro", "auto"].includes(patch.theme)) next.theme = patch.theme
    else throw bad()
  }
  return next
}

async function meUpdate(ctx) {
  const { sql, body, member } = ctx
  const has = { name: false, bio: false, location: false, links: false, avatar: false, handle: false, prefs: false }
  const v = { name: null, bio: null, location: null, links: "{}", avatar: null, handle: null, prefs: "{}" }

  if (body.name !== undefined) {
    const name = cleanLine(str(body.name), 60)
    if (Array.from(name).length < 2) throw new HttpError(400, "Escribe tu nombre (al menos 2 letras).", "invalid_name")
    has.name = true
    v.name = name
  }
  if (body.bio !== undefined) {
    has.bio = true
    v.bio = cleanText(str(body.bio), 300) || null
  }
  if (body.location !== undefined) {
    has.location = true
    v.location = cleanLine(str(body.location), 60) || null
  }
  if (body.links !== undefined) {
    if (body.links !== null && !isPlainObject(body.links)) throw new HttpError(400, "Enlaces inválidos.", "invalid_link")
    const links = {}
    for (const key of ["instagram", "tiktok", "whatsapp", "web"]) {
      const url = normalizeProfileLink(key, body.links?.[key])
      if (url) links[key] = url
    }
    has.links = true
    v.links = JSON.stringify(links)
  }
  if (body.avatarUrl !== undefined) {
    has.avatar = true
    if (body.avatarUrl === null || body.avatarUrl === "") v.avatar = null
    else {
      // Solo fotos subidas por la propia Academy (Blob del proyecto) o
      // /assets/: una imagen remota cualquiera es un pixel de rastreo.
      if (!isImageUrl(body.avatarUrl)) throw new HttpError(400, "La foto tiene que subirse desde la Academy.", "invalid_avatar")
      v.avatar = safeUrl(String(body.avatarUrl))
      if (!v.avatar) throw new HttpError(400, "La foto tiene que subirse desde la Academy.", "invalid_avatar")
    }
  }
  if (body.handle !== undefined) {
    const handle = str(body.handle).trim().toLowerCase()
    if (!HANDLE_RE.test(handle)) throw new HttpError(400, "El nombre de usuario debe tener de 3 a 40 letras minúsculas, números o guiones.", "invalid_handle")
    if (RESERVED_HANDLE.test(handle) && !isAdminRole(member.role)) throw new HttpError(400, "Ese nombre de usuario está reservado.", "reserved_handle")
    // Los handles automáticos son "<nombre>-<id>". Uno que termina en
    // "-<número>" ajeno le robaría el handle al miembro con ese id el día
    // que se cree, y el alta de esa persona fallaría.
    const suffix = /-(\d+)$/.exec(handle)
    if (suffix && Number(suffix[1]) !== member.id) throw new HttpError(400, "Ese nombre de usuario no está disponible.", "handle_taken")
    has.handle = true
    v.handle = handle
  }
  if (body.prefs !== undefined) {
    has.prefs = true
    v.prefs = JSON.stringify(applyPrefsPatch(member.prefs, body.prefs))
  }

  if (Object.values(has).some(Boolean)) {
    try {
      const rows = await sql`
        UPDATE academy_members SET
          name       = CASE WHEN ${has.name}::boolean     THEN ${v.name}::text       ELSE name END,
          bio        = CASE WHEN ${has.bio}::boolean      THEN ${v.bio}::text        ELSE bio END,
          location   = CASE WHEN ${has.location}::boolean THEN ${v.location}::text   ELSE location END,
          links      = CASE WHEN ${has.links}::boolean    THEN ${v.links}::jsonb     ELSE links END,
          avatar_url = CASE WHEN ${has.avatar}::boolean   THEN ${v.avatar}::text     ELSE avatar_url END,
          handle     = CASE WHEN ${has.handle}::boolean   THEN ${v.handle}::text     ELSE handle END,
          prefs      = CASE WHEN ${has.prefs}::boolean    THEN ${v.prefs}::jsonb     ELSE prefs END,
          updated_at = NOW()
        WHERE id = ${member.id} AND status = 'activo'
        RETURNING id
      `
      if (!rows.length) throw new HttpError(401, AUTH_ERROR, "auth")
    } catch (err) {
      if (pgCode(err) === "23505") throw new HttpError(409, "Ese nombre de usuario ya está en uso.", "handle_taken")
      throw err
    }
  }
  return { member: await loadMe(sql, member.id) }
}

/* ── email-change ──────────────────────────────────────────────────────── */
async function emailChange(ctx) {
  const { sql, body, member, ip } = ctx
  const password = str(body.password)
  const newEmailNorm = normalizeEmail(body.newEmail)
  if (!newEmailNorm) throw new HttpError(400, "Escribe un correo válido.", "invalid")
  if (!password) throw new HttpError(400, "Escribe tu contraseña.", "current_required")
  // Se guarda como lo escribió (mayúsculas incluidas) si es el mismo correo.
  const typed = str(body.newEmail).trim()
  const newEmail = typed.toLowerCase() === newEmailNorm ? typed : newEmailNorm

  const [row] = await sql`SELECT id, name, email_norm, password_hash FROM academy_members WHERE id = ${member.id}`
  if (!row) throw new HttpError(401, AUTH_ERROR, "auth")
  if (!row.password_hash) throw new HttpError(400, "Primero crea tu contraseña.", "no_password")
  if (newEmailNorm === row.email_norm) throw new HttpError(400, "Ese ya es tu correo.", "same_email")

  const allowed = await rateLimit(sql, `aca-email-change:${member.id}`, { max: 5, windowSeconds: 86400 })
  if (!allowed) throw new HttpError(429, "Ya pediste varios cambios de correo hoy. Intenta mañana.", "rate_limited", { retryAfter: 3600 })

  const key = userKey(row.email_norm)
  const lock = await checkLock(sql, [key])
  if (lock.locked) throw lockedError(lock.retryAfterSeconds, lock.unavailable)
  const check = await verifyPasswordAsync(password, row.password_hash)
  if (!check.ok) {
    const f = await registerFailure(sql, [key], USER_LOCK)
    if (f.locked) throw lockedError(f.retryAfterSeconds)
    throw new HttpError(400, "La contraseña no es correcta.", "wrong_password")
  }

  /* No se dice si el correo nuevo ya lo usa otra cuenta: eso permitiría
     averiguar quién es alumno de la Academy probando correos. El enlace se
     manda igual y, si al confirmarlo el correo está tomado, el que controla
     esa casilla (y por lo tanto ya lo sabe) ve "ya está en uso". */
  const { token, tokenHash } = generateResetToken()
  const payload = JSON.stringify({ newEmail, newEmailNorm })
  await sql.transaction([
    sql`UPDATE academy_auth_tokens SET used_at = NOW() WHERE member_id = ${row.id} AND purpose = 'email' AND used_at IS NULL`,
    sql`
      INSERT INTO academy_auth_tokens (token_hash, member_id, purpose, payload, expires_at, requested_ip)
      VALUES (${tokenHash}, ${row.id}, 'email', ${payload}::jsonb, NOW() + make_interval(mins => ${EMAIL_TTL_MIN}::int), ${ip})
    `,
  ])
  const confirmUrl = `${academyUrl()}/confirmar-correo?token=${encodeURIComponent(token)}`
  const sent = await sendAcademyEmail(sql, "email", sendAcademyEmailChangeEmail, { to: newEmail, name: row.name, confirmUrl, minutes: EMAIL_TTL_MIN })
  if (!sent.ok) {
    throw new HttpError(503, sent.skipped
      ? "Hoy ya no podemos mandar más correos de confirmación. Intenta mañana."
      : "No pudimos mandar el correo de confirmación. Intenta de nuevo en un rato.", "email_failed")
  }
  return { sentTo: maskEmail(newEmailNorm) }
}

/* ── email-change-confirm (público; el token es la credencial) ─────────── */
async function emailChangeConfirm(ctx) {
  const { sql, body, ip } = ctx
  const token = str(body.token).trim()
  if (token.length < 20 || token.length > 200) throw new HttpError(400, "Enlace inválido.", "invalid_token")
  const allowed = await rateLimit(sql, `aca-email-confirm:${ip}`, { max: 10, windowSeconds: 900 })
  if (!allowed) throw new HttpError(429, "Demasiados intentos. Espera unos minutos.", "rate_limited", { retryAfter: 900 })

  const tokenHash = hashResetToken(token)
  /* Una sentencia: gastar el token, cambiar el correo, subir
     session_version (sale de todos lados), borrar push y anular los enlaces
     de reset pendientes — esos se mandaron al correo VIEJO y no deben
     seguir sirviendo para recuperar la cuenta desde allá. `old` lee la fila
     ANTES del UPDATE (todas las CTE ven la misma foto) para avisarle al
     correo anterior. Si el correo nuevo ya lo tomó otra cuenta, el índice
     único corta TODA la sentencia (el token queda sin gastar) → 409. */
  let row
  try {
    ;[row] = await sql`
      WITH t AS (
        UPDATE academy_auth_tokens SET used_at = NOW()
         WHERE token_hash = ${tokenHash} AND purpose = 'email' AND used_at IS NULL AND expires_at > NOW()
        RETURNING member_id, payload
      ), old AS (
        SELECT am.id, am.email AS old_email, am.name FROM academy_members am JOIN t ON t.member_id = am.id
      ), m AS (
        UPDATE academy_members
           SET email = t.payload->>'newEmail', email_norm = t.payload->>'newEmailNorm',
               session_version = academy_members.session_version + 1, updated_at = NOW()
          FROM t
         WHERE academy_members.id = t.member_id AND academy_members.status = 'activo'
           AND COALESCE(t.payload->>'newEmailNorm', '') <> ''
        RETURNING academy_members.id, academy_members.email
      ), p AS (
        DELETE FROM academy_push_subscriptions WHERE member_id IN (SELECT id FROM m) RETURNING 1
      ), r AS (
        UPDATE academy_auth_tokens SET used_at = NOW()
         WHERE member_id IN (SELECT id FROM m) AND purpose = 'reset' AND used_at IS NULL
        RETURNING 1
      )
      SELECT m.id, m.email AS new_email, old.old_email, old.name
      FROM m JOIN old ON old.id = m.id
    `
  } catch (err) {
    if (pgCode(err) === "23505") throw new HttpError(409, "Ese correo ya está en uso por otra cuenta de la Academy.", "email_taken")
    if (pgCode(err) === "42P01") throw new HttpError(400, EXPIRED_LINK, "invalid_token")
    throw err
  }
  if (!row) throw new HttpError(400, EXPIRED_LINK, "invalid_token")

  // El aviso al correo viejo es el único rastro si el cambio no lo hizo el
  // dueño: va siempre, y un fallo no deshace el cambio.
  await sendAcademyEmail(sql, "email", sendAcademyEmailChangedNotice, {
    to: row.old_email,
    name: row.name,
    newEmailMasked: maskEmail(row.new_email),
  })
  return { email: maskEmail(row.new_email) }
}

/* ── logout-all (admite pwc) ───────────────────────────────────────────── */
async function logoutAll(ctx) {
  const { sql, member } = ctx
  await sql`
    WITH m AS (
      UPDATE academy_members SET session_version = session_version + 1, updated_at = NOW()
       WHERE id = ${member.id}
      RETURNING id
    )
    DELETE FROM academy_push_subscriptions WHERE member_id IN (SELECT id FROM m)
  `
  return {}
}

/* ── me-export ─────────────────────────────────────────────────────────── */
async function meExport(ctx) {
  const { sql, member } = ctx
  const allowed = await rateLimit(sql, `aca-export:${member.id}`, { max: 5, windowSeconds: 86400 })
  if (!allowed) throw new HttpError(429, "Ya descargaste tus datos varias veces hoy. Intenta mañana.", "rate_limited", { retryAfter: 3600 })
  const id = member.id
  // Todo en UNA ida a la base (transacción de solo lectura). Nunca
  // password_hash, session_version ni tokens.
  const [
    profile, grants, orders, posts, comments, likes, pollVotes, follows,
    progress, messages, chats, blocks, notifications, uploads, reports, cohorts,
  ] = await sql.transaction([
    sql`SELECT id, email, name, handle, phone, bio, location, links, avatar_url, role, status, source, prefs,
               to_char(joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS joined_at,
               to_char(last_login_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_login_at,
               to_char(password_set_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS password_set_at
        FROM academy_members WHERE id = ${id}`,
    sql`SELECT g.id, g.course_id, c.title AS course_title, g.source, g.state,
               to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
               to_char(g.revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS revoked_at
        FROM academy_grants g JOIN academy_courses c ON c.id = g.course_id
        WHERE g.member_id = ${id} ORDER BY g.id`,
    sql`SELECT o.public_ref, o.title_snapshot, o.modality, o.amount, o.status, o.name, o.email, o.phone,
               to_char(o.paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS paid_at,
               to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM academy_orders o
        WHERE o.email_norm = (SELECT email_norm FROM academy_members WHERE id = ${id})
           OR o.id IN (SELECT order_id FROM academy_grants WHERE member_id = ${id} AND order_id IS NOT NULL)
        ORDER BY o.id`,
    sql`SELECT id, category_id, title, body, attachments, video_id, poll,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
               to_char(edited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS edited_at,
               to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS deleted_at
        FROM academy_posts WHERE author_id = ${id} ORDER BY id LIMIT 2000`,
    sql`SELECT id, post_id, lesson_id, parent_id, body,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
               to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS deleted_at
        FROM academy_comments WHERE author_id = ${id} ORDER BY id LIMIT 5000`,
    sql`SELECT target_type, target_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM academy_likes WHERE member_id = ${id} ORDER BY created_at LIMIT 10000`,
    sql`SELECT post_id, option_idx, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM academy_poll_votes WHERE member_id = ${id}`,
    sql`SELECT target_type, target_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM academy_follows WHERE member_id = ${id}`,
    sql`SELECT lesson_id, position_sec,
               to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS completed_at,
               to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
        FROM academy_lesson_progress WHERE member_id = ${id}`,
    sql`SELECT id, chat_id, body, attachments,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
               to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS deleted_at
        FROM academy_messages WHERE author_id = ${id} ORDER BY id LIMIT 5000`,
    sql`SELECT cm.chat_id, c.kind, c.name, cm.muted,
               to_char(cm.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS joined_at
        FROM academy_chat_members cm JOIN academy_chats c ON c.id = cm.chat_id
        WHERE cm.member_id = ${id}`,
    sql`SELECT blocked_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM academy_blocks WHERE blocker_id = ${id}`,
    sql`SELECT kind, actor_id, target_type, target_id, preview,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
               to_char(read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS read_at
        FROM academy_notifications WHERE member_id = ${id} ORDER BY id DESC LIMIT 1000`,
    sql`SELECT id, kind, url, bytes, private,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM academy_uploads WHERE member_id = ${id} ORDER BY id`,
    sql`SELECT target_type, target_id, reason, status,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM academy_reports WHERE reporter_id = ${id} ORDER BY id`,
    sql`SELECT c.id, c.name, to_char(cm.added_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS added_at
        FROM academy_cohort_members cm JOIN academy_cohorts c ON c.id = cm.cohort_id
        WHERE cm.member_id = ${id}`,
  ], { readOnly: true })
  return {
    data: {
      exportedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      profile: profile[0] || null,
      grants, orders, posts, comments, likes, pollVotes, follows, progress,
      messages, chats, blocks, notifications, uploads, reports, cohorts,
    },
  }
}

/* ── me-delete ─────────────────────────────────────────────────────────── */
async function meDelete(ctx) {
  const { sql, body, member } = ctx
  const password = str(body.password)
  const [row] = await sql`SELECT id, role, email_norm, password_hash FROM academy_members WHERE id = ${member.id}`
  if (!row) throw new HttpError(401, AUTH_ERROR, "auth")
  // El propietario es el dueño del grupo: borrarse dejaría la Academy sin
  // nadie que la administre desde adentro.
  if (row.role === "propietario") throw new HttpError(400, "El propietario no puede eliminar su cuenta desde aquí.", "owner")
  if (!row.password_hash) throw new HttpError(400, "Primero crea tu contraseña.", "no_password")
  if (!password) throw new HttpError(400, "Escribe tu contraseña para confirmar.", "current_required")

  const key = userKey(row.email_norm)
  const lock = await checkLock(sql, [key])
  if (lock.locked) throw lockedError(lock.retryAfterSeconds, lock.unavailable)
  const check = await verifyPasswordAsync(password, row.password_hash)
  if (!check.ok) {
    const f = await registerFailure(sql, [key], USER_LOCK)
    if (f.locked) throw lockedError(f.retryAfterSeconds)
    throw new HttpError(400, "La contraseña no es correcta.", "wrong_password")
  }

  const id = member.id
  /* Anonimizar, no borrar la fila: sus posts y comentarios en hilos ajenos
     siguen existiendo (sin nombre ni foto), los pedidos quedan para la
     contabilidad y las FKs no arrastran contenido de otros. Lo personal sí
     se borra: DMs (el chat entero: una conversación de a dos sin uno de
     los dos no tiene sentido), push, enlaces, progreso, notificaciones,
     seguimientos, bloqueos y su pertenencia a grupos y chats.
     Son sentencias independientes con el id conocido → una transacción. */
  await sql.transaction([
    sql`DELETE FROM academy_chats WHERE kind = 'directo' AND id IN (SELECT chat_id FROM academy_chat_members WHERE member_id = ${id})`,
    sql`DELETE FROM academy_chat_members WHERE member_id = ${id}`,
    sql`DELETE FROM academy_cohort_members WHERE member_id = ${id}`,
    sql`DELETE FROM academy_push_subscriptions WHERE member_id = ${id}`,
    sql`DELETE FROM academy_auth_tokens WHERE member_id = ${id}`,
    sql`DELETE FROM academy_lesson_progress WHERE member_id = ${id}`,
    sql`DELETE FROM academy_notifications WHERE member_id = ${id}`,
    sql`DELETE FROM academy_follows WHERE member_id = ${id} OR (target_type = 'miembro' AND target_id = ${id})`,
    sql`DELETE FROM academy_blocks WHERE blocker_id = ${id} OR blocked_id = ${id}`,
    sql`DELETE FROM academy_post_reads WHERE member_id = ${id}`,
    sql`
      UPDATE academy_members
         SET name = 'Miembro eliminado',
             email = 'deleted-' || id || '@invalid',
             email_norm = 'deleted-' || id || '@invalid',
             handle = NULL, phone = NULL, user_id = NULL, bio = NULL, location = NULL,
             links = '{}'::jsonb, avatar_url = NULL, prefs = '{}'::jsonb,
             password_hash = NULL, password_set_at = NULL, must_change_password = false,
             temp_password_expires_at = NULL,
             status = 'cancelado', deleted_at = NOW(),
             session_version = session_version + 1, updated_at = NOW()
       WHERE id = ${id}
    `,
  ])
  return {}
}

/* ── about (público, cacheable en CDN) ─────────────────────────────────── */
async function about(ctx) {
  const { sql } = ctx
  const settings = await getSettings(sql)
  const g = settings.group
  // Sin fotos ni nombres de miembros en una página pública, salvo el del
  // dueño (que firma el grupo, como en Skool).
  const group = { name: g.name, description: g.description, coverUrl: g.coverUrl, media: g.media, initials: g.initials, color: g.color }
  try {
    const [row] = await sql`
      SELECT
        (SELECT count(*)::int FROM academy_members WHERE status = 'activo' AND deleted_at IS NULL) AS member_count,
        (SELECT name FROM academy_members WHERE role = 'propietario' AND status = 'activo' ORDER BY id LIMIT 1) AS owner_name,
        (SELECT MIN(LEAST(price_online, price_presencial))::int FROM academy_courses WHERE published AND sales_open) AS price_from
    `
    return {
      group,
      meta: {
        memberCount: Number(row?.member_count || 0),
        owner: row?.owner_name ? { name: row.owner_name } : null,
        priceFrom: row?.price_from == null ? null : Number(row.price_from),
      },
      __cache: "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
    }
  } catch (err) {
    // Página pública: un error de base no la deja en blanco. Sin datos de
    // demo — solo los ajustes de fábrica y ceros — y con caché corta.
    console.error("[academy:about]", err?.code || err?.message || err)
    return {
      group,
      meta: { memberCount: 0, owner: null, priceFrom: null },
      fallback: true,
      __cache: "public, max-age=0, s-maxage=60",
    }
  }
}

/* ── owner-session (solo barbero admin del panel) ──────────────────────── */
async function ownerSession(ctx) {
  const { sql, barber } = ctx
  // { barberId, name, email } de requireBarberAdmin (api/_academyHost.js),
  // que ya leyó la ficha del barbero en la base.
  const barberId = Number(barber?.barberId)
  if (!Number.isInteger(barberId) || barberId <= 0) throw new HttpError(403, "Sesión del panel sin barbero asociado.", "forbidden")
  const b = { name: barber.name, email: barber.email }

  let [row] = await sql`
    SELECT id, role, status, session_version, must_change_password
    FROM academy_members WHERE barber_id = ${barberId}
    ORDER BY (role = 'propietario') DESC, id LIMIT 1
  `
  if (!row) {
    /* Primera vez: el primer admin del panel que abre la Academy queda como
       propietario; si ya hay uno, los siguientes entran como admin. Sin
       contraseña (password_hash NULL): el dueño entra siempre por acá, con
       su sesión del panel ya verificada contra la base. */
    const [owner] = await sql`SELECT id FROM academy_members WHERE role = 'propietario' LIMIT 1`
    const role = owner ? "admin" : "propietario"
    const name = cleanLine(b.name, 60) || "Propietario"
    // El correo del barbero, o uno sintético si no tiene (o si ya lo usa
    // otra cuenta de la Academy, p. ej. una compra suya con ese correo).
    const candidates = [...new Set([normalizeEmail(b.email), syntheticOwnerEmail(barberId)].filter(Boolean))]
    for (const email of candidates) {
      const [ins] = await sql`
        INSERT INTO academy_members (email_norm, email, name, role, status, source, barber_id, must_change_password)
        VALUES (${email}, ${email}, ${name}, ${role}, 'activo', 'propietario', ${barberId}, false)
        ON CONFLICT (email_norm) DO NOTHING
        RETURNING id, role, status, session_version, must_change_password
      `
      if (ins) { row = ins; break }
    }
    if (!row) throw new HttpError(409, "No pudimos crear tu cuenta de la Academy: el correo ya está en uso.", "conflict")
    try {
      await sql`UPDATE academy_members SET handle = ${slugify(name) || "miembro"}::text || '-' || id WHERE id = ${row.id} AND handle IS NULL`
    } catch (err) {
      // Un handle tomado no impide entrar: queda NULL y se puede elegir
      // uno en Ajustes.
      console.error("[academy:owner-session] handle:", err?.code || err?.message || err)
    }
  }
  if (row.status !== "activo") throw new HttpError(403, "Tu cuenta de la Academy está desactivada.", "inactive")

  try {
    await sql`UPDATE academy_members SET last_login_at = NOW() WHERE id = ${row.id}`
  } catch (err) {
    console.error("[academy:owner-session] last_login_at:", err?.code || err?.message || err)
  }
  const token = sessionOrFail({ id: Number(row.id), sessionVersion: Number(row.session_version), mustChangePassword: Boolean(row.must_change_password) })
  return { token, member: await loadMe(sql, row.id) }
}

/* ── idle ──────────────────────────────────────────────────────────────── */
/* El front lo manda con fetch keepalive al dejar de usar la app: apaga el
   "En línea" al instante en vez de esperar los 90 s de gracia. */
async function idle(ctx) {
  const { sql, member } = ctx
  await sql`UPDATE academy_members SET last_sync_at = NULL WHERE id = ${member.id} AND last_sync_at IS NOT NULL`
  return {}
}

export const handlers = {
  "login": login,
  "password-change": passwordChange,
  "password-reset-request": passwordResetRequest,
  "password-reset-confirm": passwordResetConfirm,
  "me": me,
  "me-update": meUpdate,
  "email-change": emailChange,
  "email-change-confirm": emailChangeConfirm,
  "logout-all": logoutAll,
  "me-export": meExport,
  "me-delete": meDelete,
  "about": about,
  "owner-session": ownerSession,
  "idle": idle,
}
