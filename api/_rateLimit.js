/* PIMP STUDIO — Rate limiting simple sobre Postgres (Neon).
   ------------------------------------------------------------------
   Vercel ejecuta cada función serverless sin estado compartido entre
   invocaciones, así que un contador en memoria no sirve para limitar
   nada entre requests reales. Usamos la misma base de datos que ya
   tiene el proyecto en vez de sumar un servicio nuevo (Upstash/Redis) —
   a esta escala, una tabla con un UPSERT atómico por ventana fija
   alcanza de sobra.

   Si el rate limiter mismo falla (tabla bloqueada, DB caída), se abre
   en vez de cerrar: nunca debe ser la causa de que una reserva real no
   se pueda hacer — sería el mismo tipo de bug que ya corregimos hoy,
   aplicado al propio mecanismo de protección. */

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"]
  if (fwd) return String(fwd).split(",")[0].trim()
  return req.socket?.remoteAddress || "unknown"
}

/* Devuelve true si la request puede seguir, false si se pasó del límite.
   `key` debe incluir el nombre del endpoint (ej. "bookings-post:1.2.3.4")
   para que los límites de distintas rutas no se mezclen entre sí. */
export async function rateLimit(sql, key, { max = 20, windowSeconds = 60 } = {}) {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key          TEXT PRIMARY KEY,
        count        INTEGER NOT NULL DEFAULT 1,
        window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    const [row] = await sql`
      INSERT INTO rate_limits (key, count, window_start)
      VALUES (${key}, 1, NOW())
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.window_start < NOW() - (${windowSeconds} || ' seconds')::interval THEN 1
          ELSE rate_limits.count + 1
        END,
        window_start = CASE
          WHEN rate_limits.window_start < NOW() - (${windowSeconds} || ' seconds')::interval THEN NOW()
          ELSE rate_limits.window_start
        END
      RETURNING count
    `
    return row.count <= max
  } catch (err) {
    console.error("rateLimit error (fail-open):", err)
    return true
  }
}

/* ── Bloqueo de login por intentos fallidos ────────────────────────────────
   Distinto del rateLimit de arriba: ahí se cuentan REQUESTS, acá se cuentan
   FALLOS. Un barbero que entra bien diez veces seguidas no debe acercarse a
   ningún límite; uno que falla tres veces sí.

   Reemplaza el bloqueo que vivía en localStorage (BarberLogin.jsx), que no
   protegía nada: bastaba borrar el storage, abrir una pestaña de incógnito o
   pegarle al endpoint con curl para saltárselo. Este vive en la base, así que
   aplica igual venga de donde venga.

   Se cuenta por usuario Y por IP a la vez:
     - por usuario, para que no se pueda tantear la clave de alguien desde
       muchas IPs (una botnet chica basta para eso);
     - por IP, para que una sola máquina no pueda barrer usuario por usuario.

   A diferencia del rateLimit genérico, este FALLA CERRADO en la lectura: si
   no se puede consultar el contador, se rechaza el login. Un atacante que
   pudiera tumbar la base tendría, si no, vía libre para probar claves.

   Portado de PimpStudio. Lo usa el login de api/auth-barber.js (y el
   restablecimiento por correo, que limpia las claves del barbero al fijar la
   contraseña nueva). Única diferencia con allá: el CREATE TABLE se recuerda
   por instancia (ver ensureAttemptsTable) en vez de repetirse en cada
   consulta. */

const MAX_FAILED_ATTEMPTS = 3
const LOCKOUT_SECONDS = 5 * 60

/* Un solo CREATE TABLE por instancia tibia: cada login pasa por acá dos veces
   (chequeo + fallo o limpieza) y con Neon por HTTP cada sentencia es un viaje.
   Si falla se olvida la promesa, así el próximo request lo reintenta en vez
   de quedar roto hasta el redeploy (mismo patrón que once() en _schema.js). */
let attemptsTableReady = null
function ensureAttemptsTable(sql) {
  if (!attemptsTableReady) {
    attemptsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS login_attempts (
          key           TEXT PRIMARY KEY,
          failures      INTEGER NOT NULL DEFAULT 0,
          locked_until  TIMESTAMPTZ,
          last_failure  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
    })().catch((err) => { attemptsTableReady = null; throw err })
  }
  return attemptsTableReady
}

/* ¿Está bloqueado? Devuelve { locked, retryAfterSeconds }. */
export async function checkLoginLock(sql, keys) {
  try {
    await ensureAttemptsTable(sql)
    const [row] = await sql`
      SELECT MAX(EXTRACT(EPOCH FROM (locked_until - NOW()))) as remaining
      FROM login_attempts
      WHERE key = ANY(${keys}) AND locked_until > NOW()
    `
    const remaining = Math.ceil(Number(row?.remaining || 0))
    return remaining > 0
      ? { locked: true, retryAfterSeconds: remaining }
      : { locked: false, retryAfterSeconds: 0 }
  } catch (err) {
    console.error("checkLoginLock error (fail-closed):", err?.message || err)
    return { locked: true, retryAfterSeconds: 60, unavailable: true }
  }
}

/* Registra un fallo en cada clave y bloquea la que llegue al tope.
   Devuelve { locked, remainingAttempts, retryAfterSeconds }. */
export async function registerLoginFailure(sql, keys) {
  try {
    await ensureAttemptsTable(sql)
    const rows = await sql`
      INSERT INTO login_attempts (key, failures, last_failure)
      SELECT unnest(${keys}::text[]), 1, NOW()
      ON CONFLICT (key) DO UPDATE SET
        -- Un fallo pasada la ventana de bloqueo reinicia la cuenta: si no, el
        -- contador nunca bajaría y una persona distraída quedaría bloqueada
        -- para siempre por errores repartidos en meses.
        failures = CASE
          WHEN login_attempts.last_failure < NOW() - (${LOCKOUT_SECONDS} || ' seconds')::interval THEN 1
          ELSE login_attempts.failures + 1
        END,
        locked_until = CASE
          WHEN (CASE
                  WHEN login_attempts.last_failure < NOW() - (${LOCKOUT_SECONDS} || ' seconds')::interval THEN 1
                  ELSE login_attempts.failures + 1
                END) >= ${MAX_FAILED_ATTEMPTS}
          THEN NOW() + (${LOCKOUT_SECONDS} || ' seconds')::interval
          ELSE NULL
        END,
        last_failure = NOW()
      RETURNING failures, EXTRACT(EPOCH FROM (locked_until - NOW())) as remaining
    `
    const worst = rows.reduce((acc, r) => (r.failures > (acc?.failures || 0) ? r : acc), null)
    const failures = Number(worst?.failures || 1)
    const remaining = Math.ceil(Number(worst?.remaining || 0))
    return {
      locked: failures >= MAX_FAILED_ATTEMPTS,
      remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - failures),
      retryAfterSeconds: remaining > 0 ? remaining : LOCKOUT_SECONDS,
    }
  } catch (err) {
    console.error("registerLoginFailure error:", err?.message || err)
    return { locked: false, remainingAttempts: 0, retryAfterSeconds: LOCKOUT_SECONDS }
  }
}

/* Login correcto: se borra el historial de fallos de esas claves. */
export async function clearLoginFailures(sql, keys) {
  try {
    await sql`DELETE FROM login_attempts WHERE key = ANY(${keys})`
  } catch (err) {
    console.error("clearLoginFailures error:", err?.message || err)
  }
}

export const LOGIN_LOCK = { MAX_FAILED_ATTEMPTS, LOCKOUT_SECONDS }
