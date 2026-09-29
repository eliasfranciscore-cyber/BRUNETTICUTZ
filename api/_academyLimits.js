/* ACADEMY — Límites por ventana y bloqueo de login
   ------------------------------------------------------------------
   Copia propia de la Academy (antes usaba api/_rateLimit.js del panel), en
   su propia tabla academy_rate_limits, para que el módulo se pueda llevar
   tal cual a otro sitio y para que un alumno equivocándose nunca comparta
   contador con el login del barbero.

   Vercel no comparte memoria entre invocaciones, así que el contador vive
   en Postgres: un UPSERT atómico por llave. La tabla la crea
   ensureAcademyTables (api/_academySchema.js); acá NO se corre DDL nunca,
   porque el login y los resets son públicos (SPEC §0.3).

   Una sola tabla con dos usos, separados por prefijo interno de la llave:
     rl:<llave>  requests en una ventana fija (count, window_start)
     lk:<llave>  fallos de login y bloqueo (failures, locked_until,
                 updated_at = último fallo)
   así un límite y un bloqueo con la misma llave nunca se pisan.

   Cómo falla cada uno (a propósito distinto):
     rateLimit     ABIERTO: el limitador nunca debe ser la razón de que una
                   acción legítima no se pueda hacer.
     checkLock     CERRADO: si no se puede leer el contador se rechaza el
                   login (quien pudiera tumbar la base tendría vía libre
                   para probar claves). Excepción: la tabla todavía no
                   existe (42P01) → nadie puede estar bloqueado.
     registerFailure / clearFailures: best-effort, nunca lanzan.
   Prefijo `_`: no cuenta como función serverless. */

const RL = "rl:"
const LK = "lk:"
const DEFAULT_MAX_FAILURES = 3
const DEFAULT_LOCK_SECONDS = 5 * 60

export function clientIp(req) {
  const fwd = req?.headers?.["x-forwarded-for"]
  if (fwd) return String(fwd).split(",")[0].trim()
  return req?.socket?.remoteAddress || "unknown"
}

const keyList = (keys) => (Array.isArray(keys) ? keys : [keys]).map((k) => String(k ?? "")).filter(Boolean)
const lockKeys = (keys) => keyList(keys).map((k) => `${LK}${k}`.slice(0, 300))
const posInt = (v, fallback) => (Number.isInteger(v) && v > 0 ? v : fallback)

/* true si la request puede seguir, false si se pasó del límite. `key` debe
   incluir el nombre de la acción ("aca-reset-ip:1.2.3.4") para que los
   límites de distintas rutas no se mezclen. */
export async function rateLimit(sql, key, { max = 20, windowSeconds = 60 } = {}) {
  const k = `${RL}${String(key ?? "")}`.slice(0, 300)
  const win = posInt(Math.round(Number(windowSeconds)), 60)
  try {
    const [row] = await sql`
      INSERT INTO academy_rate_limits (key, count, window_start, updated_at)
      VALUES (${k}, 1, NOW(), NOW())
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN academy_rate_limits.window_start IS NULL
            OR academy_rate_limits.window_start < NOW() - make_interval(secs => ${win}::int) THEN 1
          ELSE academy_rate_limits.count + 1
        END,
        window_start = CASE
          WHEN academy_rate_limits.window_start IS NULL
            OR academy_rate_limits.window_start < NOW() - make_interval(secs => ${win}::int) THEN NOW()
          ELSE academy_rate_limits.window_start
        END,
        updated_at = NOW()
      RETURNING count
    `
    return Number(row?.count || 0) <= max
  } catch (err) {
    if (err?.code !== "42P01") console.error("[academy:limits] rateLimit (abierto):", err?.code || err?.message || err)
    return true
  }
}

/* ¿Alguna de estas llaves está bloqueada? → { locked, retryAfterSeconds,
   unavailable? } */
export async function checkLock(sql, keys) {
  const list = lockKeys(keys)
  if (!list.length) return { locked: false, retryAfterSeconds: 0 }
  try {
    const [row] = await sql`
      SELECT MAX(EXTRACT(EPOCH FROM (locked_until - NOW()))) AS remaining
      FROM academy_rate_limits
      WHERE key = ANY(${list}::text[]) AND locked_until > NOW()
    `
    const remaining = Math.ceil(Number(row?.remaining || 0))
    return remaining > 0 ? { locked: true, retryAfterSeconds: remaining } : { locked: false, retryAfterSeconds: 0 }
  } catch (err) {
    if (err?.code === "42P01") return { locked: false, retryAfterSeconds: 0 }
    console.error("[academy:limits] checkLock (cerrado):", err?.code || err?.message || err)
    return { locked: true, retryAfterSeconds: 60, unavailable: true }
  }
}

/* Registra un fallo en la(s) llave(s) y bloquea la que llegue a `max`.
   → { locked, remainingAttempts, retryAfterSeconds }
   Un fallo pasada la ventana de bloqueo reinicia la cuenta: si no, una
   persona distraída quedaría bloqueada por errores repartidos en meses.
   Topes por llamada: quien necesita topes distintos por llave (5 por
   correo, 20 por IP) llama una vez por llave. */
export async function registerFailure(sql, key, { max = DEFAULT_MAX_FAILURES, lockSeconds = DEFAULT_LOCK_SECONDS } = {}) {
  const cap = posInt(max, DEFAULT_MAX_FAILURES)
  const lock = posInt(lockSeconds, DEFAULT_LOCK_SECONDS)
  const list = lockKeys(key)
  if (!list.length) return { locked: false, remainingAttempts: cap, retryAfterSeconds: 0 }
  try {
    const rows = await sql`
      INSERT INTO academy_rate_limits (key, failures, locked_until, updated_at)
      SELECT k, 1, CASE WHEN 1 >= ${cap}::int THEN NOW() + make_interval(secs => ${lock}::int) ELSE NULL END, NOW()
      FROM unnest(${list}::text[]) AS k
      ON CONFLICT (key) DO UPDATE SET
        failures = CASE
          WHEN academy_rate_limits.updated_at < NOW() - make_interval(secs => ${lock}::int) THEN 1
          ELSE academy_rate_limits.failures + 1
        END,
        locked_until = CASE
          WHEN (CASE
                  WHEN academy_rate_limits.updated_at < NOW() - make_interval(secs => ${lock}::int) THEN 1
                  ELSE academy_rate_limits.failures + 1
                END) >= ${cap}::int
          THEN NOW() + make_interval(secs => ${lock}::int)
          ELSE NULL
        END,
        updated_at = NOW()
      RETURNING failures, EXTRACT(EPOCH FROM (locked_until - NOW())) AS remaining
    `
    const worst = rows.reduce((acc, r) => (Number(r.failures) > Number(acc?.failures || 0) ? r : acc), null)
    const failures = Number(worst?.failures || 1)
    const remaining = Math.ceil(Number(worst?.remaining || 0))
    return {
      locked: failures >= cap,
      remainingAttempts: Math.max(0, cap - failures),
      retryAfterSeconds: remaining > 0 ? remaining : lock,
    }
  } catch (err) {
    if (err?.code !== "42P01") console.error("[academy:limits] registerFailure:", err?.code || err?.message || err)
    return { locked: false, remainingAttempts: 0, retryAfterSeconds: lock }
  }
}

/* Login correcto: se borra el historial de fallos de esas llaves. */
export async function clearFailures(sql, keys) {
  const list = lockKeys(keys)
  if (!list.length) return
  try {
    await sql`DELETE FROM academy_rate_limits WHERE key = ANY(${list}::text[])`
  } catch (err) {
    if (err?.code !== "42P01") console.error("[academy:limits] clearFailures:", err?.code || err?.message || err)
  }
}
