import { neon } from "@neondatabase/serverless"
import { createSession, requireInternal } from "./_auth.js"
import {
  hashPassword,
  verifyPassword,
  dummyVerify,
  generateResetToken,
  hashResetToken,
  isValidPassword as isStrongPassword,
  PASSWORD_RULES as STRONG_PASSWORD_RULES,
} from "./_password.js"
import { clientIp, rateLimit, checkLoginLock, registerLoginFailure, clearLoginFailures } from "./_rateLimit.js"
import { ensureAuthColumns } from "./_schema.js"
import { sendPasswordResetEmail } from "./_email.js"

/* BRUNETTI — Autenticación de barberos del panel interno
   ------------------------------------------------------------------
   POST                 login con { username, password }
   POST ?reset=request  pide el correo de restablecimiento  { email }
   POST ?reset=confirm  fija la contraseña nueva            { token, password }
   GET  ?me=1           perfil fresco del barbero de la sesión (+ token nuevo)
   PATCH                cambia la contraseña y/o el correo propios:
                        { currentPassword, newPassword?, email? }. La
                        contraseña actual es obligatoria SIEMPRE, también para
                        poner el correo.

   Todo vive en UN archivo porque el plan Hobby de Vercel topa en 12
   Serverless Functions (ver CLAUDE.md); lo compartido está en los módulos con
   guion bajo (_password, _rateLimit, _schema, _email), que Vercel no cuenta.

   Contraseñas: PBKDF2 con sal por usuario (api/_password.js, portado de
   PimpStudio). Los SHA-256 viejos siguen entrando. El re-hash al entrar está
   APAGADO hasta PASSWORD_REHASH=1 (ver maybeRehash); las contraseñas nuevas
   (cambio y restablecimiento) ya se guardan en PBKDF2.

   Bloqueo: 3 fallos → 5 minutos, contados en la base por usuario y por IP
   (api/_rateLimit.js). Reemplaza al de localStorage de BarberLogin.jsx, que
   se saltaba borrando el storage o con curl.

   Fuente de credenciales:
     1) Neon (barbers.password_hash) cuando DATABASE_URL está activo.
     2) Respaldo: BARBER_PASSWORDS (JSON code → hash, SHA-256 o PBKDF2) cuando
        la base no responde. Es también lo ÚNICO que se prueba si no se puede
        leer el contador de bloqueo: sin contador, tantear claves contra la
        base quedaría libre. */

const RESET_TTL_MINUTES = 30
// Dominio de producción. El respaldo importa: sin SITE_URL, el enlace del
// correo de restablecimiento apuntaría a otro dominio y no serviría.
const SITE_URL = (process.env.SITE_URL || "https://brunetticutz.cl").replace(/\/+$/, "")
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* ── Regla de contraseña NUEVA ─────────────────────────────────────────────
   Aplica al cambio, al restablecimiento y al alta de barbero de
   api/barbers.js (que importa isValidPassword de acá). Las contraseñas ya
   guardadas siguen entrando igual, cumplan la regla que cumplan.

   Hoy rige la de siempre de BrunettiCutz: de 8 a 64 letras y números, con al
   menos 1 mayúscula y 1 número (espejo de src/passwordRules.js). La de
   PimpStudio —10+ caracteres, mayúscula, minúscula y número, símbolos
   permitidos— queda lista detrás de PASSWORD_RULE=strong. Se enciende en el
   MISMO deploy en que src/passwordRules.js pasa a esa regla
   (FEATURES.passwordReset); si el front pide una y el servidor otra, la
   persona recién se entera al guardar, por el error del servidor.
   Se lee en cada request (no al cargar el módulo) para que cambiar la
   variable en Vercel no dependa de qué lambdas siguen tibias. */
export function usesStrongPasswordRule() {
  return process.env.PASSWORD_RULE === "strong"
}

const BRUNETTI_PASSWORD_RULES = "La contraseña debe tener de 8 a 64 letras y números (sin símbolos), con al menos 1 mayúscula y 1 número."

export function passwordRulesText() {
  return usesStrongPasswordRule() ? STRONG_PASSWORD_RULES : BRUNETTI_PASSWORD_RULES
}

export function isValidPassword(pw) {
  if (usesStrongPasswordRule()) return isStrongPassword(pw)
  return typeof pw === "string" && /^[A-Za-z0-9]{8,64}$/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw)
}

/* Re-hash al entrar (SHA-256 viejo → PBKDF2). Apagado por defecto: una fila
   ya pasada a PBKDF2 no la lee ningún build anterior a este (comparaba
   SHA-256 en el SQL), así que un Instant Rollback o un preview contra la base
   de producción dejarían a Bruno afuera de la web y de la app de iOS. Se
   enciende con PASSWORD_REHASH=1 después de ~1 semana estable. */
function rehashOnLoginEnabled() {
  return process.env.PASSWORD_REHASH === "1"
}

const isAdmin = (b) => /brunetti|bruno|admin/i.test(`${b.name || ""} ${b.code || ""} ${b.role || ""}`)

// Perfiles base (públicos) usados con el respaldo por variable de entorno.
const BARBER_PROFILES = [
  { id: 4,  name: "Juan Carlos",         code: "juan-carlos",         role: "Barbero Senior",      tier: "general" },
  { id: 5,  name: "Andryz",              code: "andryz",              role: "Barbero",             tier: "general" },
  { id: 6,  name: "Brunetti",            code: "bruno-herrera",       role: "Visagista · Premium", tier: "premium" },
  { id: 7,  name: "Diego Moya",          code: "diego-moya",          role: "Barbero",             tier: "general" },
  { id: 8,  name: "Thinn Sayen Herrera", code: "thinn-sayen-herrera", role: "Barbero",             tier: "general" },
  { id: 9,  name: "Vicente Pietrapiana", code: "vicente-pietrapiana", role: "Barbero",             tier: "general" },
  { id: 10, name: "Rodrigo Godoy",       code: "rodrigo-godoy",       role: "Barbero",             tier: "general" },
  { id: 11, name: "Matías Inostroza",    code: "matias-inostroza",    role: "Barbero Junior",      tier: "general" },
]

// Coincidencia EXACTA (sin mayúsculas ni espacios de los bordes). Nada de
// ILIKE: ahí `%` y `_` son comodines y un usuario "%" calzaba con cualquiera.
const normUser = (u) => String(u || "").toLowerCase().trim()

/* Lo que el panel y la app de iOS reciben del barbero: las mismas llaves de
   siempre, nunca el hash. `admin` sale de la misma regla que usa
   createSession() (api/_auth.js). */
function publicBarber(row) {
  return { id: row.id, name: row.name, code: row.code, role: row.role, tier: row.tier, admin: isAdmin(row) }
}

function fallbackPasswords() {
  try { return JSON.parse(process.env.BARBER_PASSWORDS || "{}") } catch { return {} }
}

function fallbackLogin(user, password) {
  const map = fallbackPasswords()
  const profile = BARBER_PROFILES.find((b) => b.code === user || b.name.toLowerCase() === user)
  if (!profile) return null
  const expected = map[profile.code]
  if (!expected) return null
  // verifyPassword acepta los dos formatos: la variable puede seguir con el
  // SHA-256 de siempre o pasar a PBKDF2 sin tocar el código.
  return verifyPassword(password, expected).ok ? publicBarber(profile) : null
}

/* Claves del contador de fallos. Se cuenta por usuario y por IP a la vez: por
   usuario para que no sirva repartir los intentos entre muchas IPs, y por IP
   para que una máquina no pueda barrer usuario por usuario. */
function lockKeys(req, user) {
  return [`login-user:${user.slice(0, 100)}`, `login-ip:${clientIp(req)}`]
}

/* Un barbero entra con su código o con su nombre: las dos formas son la misma
   cuenta. Los fallos se anotan en las dos, así alternar entre "bruno-herrera"
   y "brunetti" no duplica los intentos, y el chequeo previo (que solo conoce
   lo que se tecleó) igual encuentra el bloqueo. */
function accountKeys(row) {
  return [row.code, row.name]
    .map((v) => normUser(v).slice(0, 100))
    .filter(Boolean)
    .map((v) => `login-user:${v}`)
}

// Sin repetidos: el INSERT … ON CONFLICT del contador no puede tocar dos
// veces la misma fila en una sola sentencia.
const uniq = (list) => [...new Set(list)]

function loginSuccess(res, barber) {
  const token = createSession(barber)
  if (!token) return res.status(503).json({ ok: false, error: "Autenticación no configurada en el servidor (PS_SESSION_SECRET)." })
  return res.json({ ok: true, barber, token })
}

function lockedResponse(res, retryAfterSeconds, unavailable) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  res.setHeader("Retry-After", String(retryAfterSeconds))
  return res.status(429).json({
    ok: false,
    locked: true,
    retryAfterSeconds,
    error: unavailable
      ? "No se pudo verificar tu acceso en este momento. Intenta de nuevo en un minuto."
      : `Demasiados intentos fallidos. Vuelve a intentar en ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`,
  })
}

/* Mismo mensaje para "usuario no existe" y "contraseña mala": distinguirlos
   convierte el login en un verificador de qué usuarios existen. El conteo va
   en el texto (BarberLogin lo muestra tal cual) y también suelto, en
   `remaining` / `remainingAttempts`. */
function failedLogin(res, fail) {
  if (fail.locked) return lockedResponse(res, fail.retryAfterSeconds, false)
  const left = fail.remainingAttempts
  return res.status(401).json({
    ok: false,
    remaining: left,
    remainingAttempts: left,
    error: `Usuario o contraseña incorrectos${left > 0 ? ` (${left} ${left === 1 ? "intento restante" : "intentos restantes"})` : ""}`,
  })
}

function envFallback(res, user, secret) {
  const fb = fallbackLogin(user, secret)
  if (fb) return loginSuccess(res, fb)
  return res.status(401).json({ ok: false, error: "Usuario o contraseña incorrectos" })
}

/* Verifica contra cada fila que calzó con el usuario (en la práctica, una).
   Hace SIEMPRE al menos un PBKDF2: sin eso, un usuario inexistente —o uno con
   el SHA-256 viejo, que se compara al toque— respondería más rápido que uno
   con PBKDF2, y esa diferencia de tiempo delata qué cuentas existen. */
function matchBarber(rows, secret) {
  let pbkdf2Done = false
  for (const row of rows) {
    const stored = String(row.password_hash || "")
    if (stored.startsWith("pbkdf2$")) pbkdf2Done = true
    const { ok, needsRehash } = verifyPassword(secret, stored)
    if (ok) {
      if (!pbkdf2Done) dummyVerify()
      return { barber: row, needsRehash }
    }
  }
  if (!pbkdf2Done) dummyVerify()
  return { barber: null, needsRehash: false }
}

async function maybeRehash(sql, barber, secret) {
  if (!rehashOnLoginEnabled()) return
  try {
    // password_hash era VARCHAR(64): el formato PBKDF2 no cabe hasta que
    // ensureAuthColumns lo pasa a TEXT.
    await ensureAuthColumns(sql)
    // Solo si nadie la cambió entre la lectura y acá.
    await sql`
      UPDATE barbers SET password_hash = ${hashPassword(secret)}
      WHERE id = ${barber.id} AND password_hash = ${barber.password_hash}
    `
  } catch (err) {
    console.error("no se pudo re-hashear la contraseña:", err?.message || err)
  }
}

async function handleLogin(req, res) {
  const { username, password, pin } = req.body || {}
  const raw = password || pin // compat: clientes antiguos enviaban "pin"
  if (!username || !raw) return res.status(400).json({ ok: false, error: "Usuario y contraseña requeridos" })
  const secret = String(raw)
  const user = normUser(username)
  if (!user) return res.status(400).json({ ok: false, error: "Usuario y contraseña requeridos" })

  let sql = null
  try {
    sql = neon(process.env.DATABASE_URL)
  } catch {
    sql = null
  }
  // Sin base configurada no hay contador ni cuentas: solo el respaldo.
  if (!sql) return envFallback(res, user, secret)

  const keys = lockKeys(req, user)

  // El bloqueo se consulta ANTES de tocar la contraseña: si está bloqueado, no
  // se gasta un PBKDF2 ni se revela si el usuario existe.
  const lock = await checkLoginLock(sql, keys)
  if (lock.unavailable) {
    // No se pudo leer el contador (la base no responde): probar contra la base
    // sin contador dejaría el tanteo libre. Queda el respaldo por variable, y
    // solo si alguien lo configuró a propósito.
    const fb = fallbackLogin(user, secret)
    if (fb) return loginSuccess(res, fb)
    return lockedResponse(res, lock.retryAfterSeconds, true)
  }
  if (lock.locked) return lockedResponse(res, lock.retryAfterSeconds, false)

  try {
    const rows = await sql`
      SELECT id, name, code, role, tier, password_hash
      FROM barbers
      WHERE (code = ${user} OR lower(name) = ${user}) AND active = true
      ORDER BY (code = ${user}) DESC, id
      LIMIT 3
    `
    const { barber, needsRehash } = matchBarber(rows, secret)
    if (!barber) {
      const fail = await registerLoginFailure(sql, uniq([...keys, ...rows.flatMap(accountKeys)]))
      return failedLogin(res, fail)
    }
    if (needsRehash) await maybeRehash(sql, barber, secret)
    await clearLoginFailures(sql, uniq([...keys, ...accountKeys(barber)]))
    return loginSuccess(res, publicBarber(barber))
  } catch (err) {
    console.error("auth-barber DB error, usando respaldo:", err?.message || err)
    // La base respondió al chequeo del bloqueo pero falló después → respaldo
    // por variable de entorno, como siempre.
    return envFallback(res, user, secret)
  }
}

/* ID del barbero de la sesión, o null. Un token sin id (o con uno raro) no
   sirve para nada de lo que sigue. */
function sessionBarberId(session) {
  const id = Number(session?.id)
  return Number.isInteger(id) && id > 0 ? id : null
}

/* GET ?me=1 — perfil FRESCO del barbero de la sesión, con las mismas llaves
   que el login (sin arreglo `modules`: acá no hay permisos por módulo). El
   panel lo llama al montar y reescribe ps_barber y ps_barber_token con lo que
   vuelve. Así, aunque el token dure 30 días, un cambio de nombre o una baja
   se notan en la próxima apertura en vez de al caducar la sesión. */
async function handleMe(req, res) {
  const session = requireInternal(req, res)
  if (!session) return
  const id = sessionBarberId(session)
  if (!id) return res.status(401).json({ ok: false, error: "Sesión sin barbero asociado" })
  try {
    const sql = neon(process.env.DATABASE_URL)
    const [row] = await sql`SELECT id, name, code, role, tier, active FROM barbers WHERE id = ${id}`
    // Barbero desactivado (o borrado): se le corta el acceso acá, sin esperar
    // a que expire su token. El panel cierra la sesión con un 401.
    if (!row || row.active === false) return res.status(401).json({ ok: false, error: "Cuenta desactivada" })
    const barber = publicBarber(row)
    const token = createSession(barber)
    if (!token) return res.json({ ok: false, error: "Autenticación no configurada en el servidor (PS_SESSION_SECRET)." })
    res.setHeader("Cache-Control", "no-store")
    return res.json({ ok: true, barber, token })
  } catch (err) {
    console.error("auth-barber ?me=1 error:", err?.message || err)
    // Sin base no se puede refrescar: el panel sigue con lo que ya tenía en
    // localStorage. 200 con ok:false para no desloguear por un hipo de Neon.
    return res.json({ ok: false, error: "No se pudo refrescar la sesión" })
  }
}

/* Correo del PATCH: undefined = inválido; null = borrarlo ("" o null);
   string = el correo normalizado. */
function parseEmail(value) {
  if (value === null) return null
  if (typeof value !== "string") return undefined
  const email = value.trim().toLowerCase()
  if (!email) return null
  if (email.length > 300 || !EMAIL_RE.test(email)) return undefined
  return email
}

/* PATCH — el barbero cambia SU contraseña y/o SU correo (el de restablecer).
   Solo la propia cuenta: acá no hay admin que le cambie la clave a otro.

   La contraseña actual es obligatoria siempre: si fuera opcional, cualquier
   token robado se convertiría en una toma de cuenta permanente. Una actual
   equivocada responde 403 (como siempre), no 401, para que ningún cliente lo
   confunda con una sesión vencida y cierre la sesión por un error de tipeo. */
async function handleAccountUpdate(req, res) {
  const session = requireInternal(req, res)
  if (!session) return
  const body = req.body || {}
  const { currentPassword, newPassword } = body
  const wantsPassword = newPassword !== undefined && newPassword !== null && newPassword !== ""
  const wantsEmail = Object.prototype.hasOwnProperty.call(body, "email")

  if (!currentPassword) return res.status(400).json({ ok: false, error: "Ingresa tu contraseña actual." })
  if (!wantsPassword && !wantsEmail) return res.status(400).json({ ok: false, error: "No hay nada que cambiar." })
  if (wantsPassword && !isValidPassword(newPassword)) return res.status(400).json({ ok: false, error: passwordRulesText() })
  const email = wantsEmail ? parseEmail(body.email) : null
  if (email === undefined) return res.status(400).json({ ok: false, error: "Escribe un correo válido." })
  const id = sessionBarberId(session)
  if (!id) return res.status(403).json({ ok: false, error: "Sesión sin barbero asociado" })

  try {
    const sql = neon(process.env.DATABASE_URL)
    // Con un token robado, esto sería un tanteador de la contraseña actual sin
    // límite. El login tiene su bloqueo; acá basta un tope de requests.
    const allowed = await rateLimit(sql, `password-change:${id}`, { max: 10, windowSeconds: 900 })
    if (!allowed) return res.status(429).json({ ok: false, error: "Demasiados intentos. Espera unos minutos." })

    const [current] = await sql`SELECT password_hash FROM barbers WHERE id = ${id} AND active = true`
    if (!current) return res.status(401).json({ ok: false, error: "Cuenta no disponible" })
    // Una cuenta SIN hash no tiene contra qué comparar: es la que entró por el
    // respaldo BARBER_PASSWORDS y está poniendo su primera contraseña en la
    // base (igual que en PimpStudio). Con hash, la actual se verifica siempre.
    if (current.password_hash) {
      const { ok } = verifyPassword(String(currentPassword), current.password_hash)
      if (!ok) return res.status(403).json({ ok: false, error: "La contraseña actual no es correcta." })
    }

    // TEXT para el PBKDF2, columna email y tabla password_resets.
    await ensureAuthColumns(sql)
    const newHash = wantsPassword ? hashPassword(String(newPassword)) : null
    // Una sola sentencia: si el correo choca con el de otra cuenta, tampoco
    // cambia la contraseña (nada a medias).
    try {
      await sql`
        UPDATE barbers SET
          password_hash = CASE WHEN ${wantsPassword}::boolean THEN ${newHash}::text ELSE password_hash END,
          email         = CASE WHEN ${wantsEmail}::boolean THEN ${email}::text ELSE email END
        WHERE id = ${id}
      `
    } catch (err) {
      if (err?.code === "23505") return res.status(409).json({ ok: false, error: "Ese correo ya está asociado a otra cuenta." })
      throw err
    }
    if (wantsPassword) {
      // Una contraseña nueva anula los enlaces de restablecimiento pendientes:
      // un correo viejo no debe seguir sirviendo para pisarla.
      try {
        await sql`UPDATE password_resets SET used_at = NOW() WHERE barber_id = ${id} AND used_at IS NULL`
      } catch (err) {
        console.error("no se pudieron anular los enlaces de restablecimiento:", err?.message || err)
      }
    }
    const message = wantsPassword && wantsEmail ? "Contraseña y correo actualizados."
      : wantsPassword ? "Contraseña actualizada."
      : email ? "Correo actualizado." : "Correo eliminado."
    return res.json({ ok: true, message, ...(wantsEmail ? { email } : {}) })
  } catch (err) {
    console.error("change password DB error:", err?.message || err)
    // Sin base de datos no es posible persistir el cambio en el servidor.
    return res.status(503).json({ ok: false, error: "El cambio de contraseña requiere la base de datos conectada. Inténtalo cuando el sistema esté en línea." })
  }
}

/* ── Restablecer contraseña por correo ─────────────────────────────────────
   Paso 1: se pide con el correo de la ficha (el que el barbero guardó con el
   PATCH). La respuesta es SIEMPRE la misma, exista o no: si dijera "ese correo
   no existe", esto sería un verificador gratis de qué correos trabajan acá. */
async function handleResetRequest(req, res) {
  const email = String((req.body || {}).email || "").trim().toLowerCase()
  const genericOk = () => res.json({ ok: true, message: "Si ese correo está registrado, te enviamos un enlace para crear una contraseña nueva." })

  if (!email || email.length > 300 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: "Escribe un correo válido." })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)
    // Dos límites: por IP (que nadie use esto para mandar correos masivos) y
    // por correo (que a nadie le lluevan enlaces por acoso).
    const ipOk = await rateLimit(sql, `reset-ip:${clientIp(req)}`, { max: 5, windowSeconds: 900 })
    const mailOk = await rateLimit(sql, `reset-mail:${email}`, { max: 3, windowSeconds: 900 })
    if (!ipOk || !mailOk) {
      return res.status(429).json({ ok: false, error: "Demasiadas solicitudes. Espera unos minutos antes de pedir otro enlace." })
    }

    await ensureAuthColumns(sql)
    const [barber] = await sql`SELECT id, name, email FROM barbers WHERE lower(email) = ${email} AND active = true`
    if (!barber) return genericOk()

    const { token, tokenHash } = generateResetToken()
    // Pedir un enlace nuevo anula los anteriores: si no, un correo antiguo
    // filtrado seguiría sirviendo.
    await sql`UPDATE password_resets SET used_at = NOW() WHERE barber_id = ${barber.id} AND used_at IS NULL`
    await sql`
      INSERT INTO password_resets (token_hash, barber_id, expires_at, requested_ip)
      VALUES (${tokenHash}, ${barber.id}, NOW() + (${RESET_TTL_MINUTES} || ' minutes')::interval, ${clientIp(req)})
    `

    const resetUrl = `${SITE_URL}/restablecer?token=${encodeURIComponent(token)}`
    const sent = await sendPasswordResetEmail({ to: barber.email, name: barber.name, resetUrl, minutes: RESET_TTL_MINUTES })
      .catch((err) => ({ ok: false, reason: err?.message || "error" }))
    if (!sent?.ok) console.error("reset: no se pudo enviar el correo:", sent?.reason)
    return genericOk()
  } catch (err) {
    console.error("reset request error:", err?.message || err)
    return res.status(503).json({ ok: false, error: "No se pudo procesar la solicitud. Intenta más tarde." })
  }
}

/* Paso 2: el enlace trae el token en claro; en la base solo está su SHA-256.
   Consumir el token y fijar la contraseña van en UNA sentencia: dos envíos
   simultáneos no pueden usar el mismo enlace, y no queda un token gastado con
   la contraseña sin cambiar. */
async function handleResetConfirm(req, res) {
  const { token, password } = req.body || {}
  if (!token || typeof token !== "string" || token.length > 200) return res.status(400).json({ ok: false, error: "Enlace inválido." })
  if (!isValidPassword(password)) return res.status(400).json({ ok: false, error: passwordRulesText() })

  try {
    const sql = neon(process.env.DATABASE_URL)
    const allowed = await rateLimit(sql, `reset-confirm:${clientIp(req)}`, { max: 10, windowSeconds: 900 })
    if (!allowed) return res.status(429).json({ ok: false, error: "Demasiados intentos. Espera unos minutos." })

    await ensureAuthColumns(sql)
    const [row] = await sql`
      WITH consumed AS (
        UPDATE password_resets SET used_at = NOW()
        WHERE token_hash = ${hashResetToken(token)} AND used_at IS NULL AND expires_at > NOW()
        RETURNING barber_id
      )
      UPDATE barbers b SET password_hash = ${hashPassword(password)}
      FROM consumed c
      WHERE b.id = c.barber_id AND b.active = true
      RETURNING b.id, b.code, b.name
    `
    if (!row) return res.status(400).json({ ok: false, error: "Este enlace ya se usó o venció. Pide uno nuevo." })

    // Los otros enlaces pendientes de esa persona ya no sirven.
    try {
      await sql`UPDATE password_resets SET used_at = NOW() WHERE barber_id = ${row.id} AND used_at IS NULL`
    } catch (err) {
      console.error("reset: no se pudieron anular los otros enlaces:", err?.message || err)
    }
    // Quien recupera su cuenta no debe quedar bloqueado por los intentos que
    // hizo antes de acordarse de que no se acordaba.
    await clearLoginFailures(sql, accountKeys(row))
    return res.json({ ok: true, message: "Listo. Ya puedes entrar con tu contraseña nueva." })
  } catch (err) {
    console.error("reset confirm error:", err?.message || err)
    return res.status(503).json({ ok: false, error: "No se pudo guardar la contraseña. Intenta más tarde." })
  }
}

export default async function handler(req, res) {
  const query = req.query || {}
  if (req.method === "GET" && query.me) return handleMe(req, res)
  if (req.method === "POST") {
    if (query.reset === "request") return handleResetRequest(req, res)
    if (query.reset === "confirm") return handleResetConfirm(req, res)
    if (query.reset) return res.status(404).json({ ok: false, error: "No encontrado" })
    return handleLogin(req, res)
  }
  if (req.method === "PATCH" || req.method === "PUT") return handleAccountUpdate(req, res)
  return res.status(405).json({ error: "Method not allowed" })
}
