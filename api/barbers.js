import { neon } from "@neondatabase/serverless"
import crypto from "crypto"
import { requireInternal } from "./_auth.js"
// Misma regla de contraseña que el login y el cambio de contraseña: una sola
// definición (igual que bookings.js importa notifyBarber de push.js).
import { isValidPassword } from "./auth-barber.js"
import { ensureSettingsTable } from "./_schema.js"
import { rateLimit, clientIp } from "./_rateLimit.js"

const STATIC_BARBERS = [
  { id: 4,  name: "Juan Carlos",         short: "Juan Carlos", code: "juan-carlos",         role: "Barbero Senior",      exp: "8 años",  rating: 4.9, tier: "general" },
  { id: 5,  name: "Andryz",              short: "Andryz",      code: "andryz",              role: "Barbero",             exp: "5 años",  rating: 4.8, tier: "general" },
  { id: 6,  name: "Brunetti",            short: "Brunetti",    code: "bruno-herrera",       role: "Visagista · Premium", exp: "12 años", rating: 5.0, tier: "premium" },
  { id: 7,  name: "Diego Moya",          short: "Diego",       code: "diego-moya",          role: "Barbero",             exp: "6 años",  rating: 4.7, tier: "general" },
  { id: 8,  name: "Thinn Sayen Herrera", short: "Thinn S.",    code: "thinn-sayen-herrera", role: "Barbero",             exp: "4 años",  rating: 4.8, tier: "general" },
  { id: 9,  name: "Vicente Pietrapiana", short: "Vicente",     code: "vicente-pietrapiana", role: "Barbero",             exp: "5 años",  rating: 4.9, tier: "general" },
  { id: 10, name: "Rodrigo Godoy",       short: "Rodrigo",     code: "rodrigo-godoy",       role: "Barbero",             exp: "7 años",  rating: 4.8, tier: "general" },
  { id: 11, name: "Matías Inostroza",    short: "Matías",      code: "matias-inostroza",    role: "Barbero Junior",      exp: "3 años",  rating: 4.6, tier: "general" },
]

/* ===========================================================================
   Modos (?mode=…) del panel nuevo y de la página pública /resena
   ---------------------------------------------------------------------------
     PATCH     ?mode=me             sesión   nombre propio (Ajustes → Mi cuenta)
     GET|PATCH ?mode=settings       sesión   notificaciones, WhatsApp y horario
                                             del propio barbero
     GET|PATCH ?mode=shop-settings  admin    datos del negocio, presupuestos de
                                             gastos y "Completar solas"
     GET       ?mode=reviews        sesión   resumen y últimas reseñas
     GET|POST  ?mode=review         PÚBLICO  la página /resena del correo de
                                             "Gracias por tu visita"

   Se despachan al principio de handler(), ANTES del gate de admin de más
   abajo (un cliente jamás tuvo sesión, y "Mi cuenta" o los ajustes propios
   son de cualquier barbero), y cada uno con su propio try/catch: un error es
   un 500 en JSON, NUNCA la lista estática de barberos del catch general —
   eso le haría creer al panel que guardó algo que no se escribió, o le
   pintaría una lista de barberos donde esperaba reseñas.

   Todo lo guardado vive en la tabla `settings` (clave → JSON en texto, la
   misma de los precios del Workshop en api/mp-payments.js), bajo claves que
   mp-payments NO expone en su GET público:
     panel:barber:<id>    { notif, whatsapp, horario }
     panel:business       { name, address, phone }
     panel:budgets        { [categoría]: monto }
     panel:auto_complete  true | false (lo lee el autocompletar de
                          api/_bookingLife.js; sin la clave, apagado)
   =========================================================================== */

const MODES = new Set(["me", "settings", "shop-settings", "reviews", "review"])

const SETTINGS_KEY_BUSINESS = "panel:business"
const SETTINGS_KEY_BUDGETS = "panel:budgets"
const SETTINGS_KEY_AUTO_COMPLETE = "panel:auto_complete"
const barberSettingsKey = (id) => `panel:barber:${Number(id)}`

// La tabla `settings` todavía no existe (nadie guardó nada aún): las lecturas
// la tratan como vacía en vez de correr DDL en un GET.
const isMissingTable = (err) => err?.code === "42P01"

function parseJson(text) {
  if (text === null || text === undefined) return null
  try { return JSON.parse(text) } catch { return null }
}

const isPlainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v)

/* Misma regla de admin que el login (isAdmin en api/auth-barber.js y
   createSession en api/_auth.js): se decide por nombre, usuario y rol. Por
   eso el nombre propio no puede cambiarse libremente — ver handleMe(). */
const ADMIN_RE = /brunetti|bruno|admin/i
const isAdminProfile = (b) => ADMIN_RE.test(`${b.name || ""} ${b.code || ""} ${b.role || ""}`)

/* --- Ajustes del barbero: listas blancas de PimpStudio, tal cual ------------
   Nunca se guarda el objeto tal como llega: solo las llaves conocidas de cada
   grupo, coaccionadas a lo que cada campo realmente es en el panel (booleans
   para los interruptores, textos cortos para los selects del horario). */
const NOTIF_KEYS = ["reserva", "cancelacion", "recordatorio", "marketing"]
const WHATSAPP_KEYS = ["activo", "recordatorio24h", "recordatorio2h", "confirmacion"]
const HORARIO_KEYS = ["apertura", "cierre", "anticipacion", "ventana", "domingo", "cancelacion"]

function sanitizeFlags(input, keys) {
  if (!isPlainObject(input)) return null
  const out = {}
  for (const key of keys) {
    if (key in input) out[key] = Boolean(input[key])
  }
  return out
}

function sanitizeHorario(input) {
  if (!isPlainObject(input)) return null
  const out = {}
  for (const key of HORARIO_KEYS) {
    if (key in input && typeof input[key] === "string") out[key] = input[key].slice(0, 20)
  }
  return out
}

// Lo guardado pasa por las mismas listas blancas al leerlo: si algún día la
// fila trae algo raro, al panel no le llega.
function readBarberSettings(text) {
  const stored = parseJson(text)
  const obj = isPlainObject(stored) ? stored : {}
  return {
    notif: sanitizeFlags(obj.notif, NOTIF_KEYS) || {},
    whatsapp: sanitizeFlags(obj.whatsapp, WHATSAPP_KEYS) || {},
    horario: sanitizeHorario(obj.horario) || {},
  }
}

/* --- Ajustes del negocio ----------------------------------------------------
   Datos del negocio: antes vivían solo en el localStorage del dispositivo de
   quien los editara. Lista blanca de llaves y largo acotado. */
const BUSINESS_KEYS = ["name", "address", "phone"]
function sanitizeBusiness(input) {
  if (!isPlainObject(input)) return null
  const out = {}
  for (const key of BUSINESS_KEYS) {
    if (key in input) out[key] = String(input[key] ?? "").trim().slice(0, 120)
  }
  return Object.keys(out).length ? out : null
}

/* Presupuesto mensual por categoría de gasto. Espejo de CATEGORY_META en
   src/components/ExpensesModule.jsx — ese archivo es JSX y no se puede
   importar desde una función serverless, así que la lista se repite acá (si
   se agrega una categoría allá, agregarla acá también). `null` en una
   categoría = borrar su presupuesto; ausente = no tocarla. */
const BUDGET_CATEGORIES = ["Insumos", "Equipamiento", "Arriendo", "Marketing", "Personal", "Servicios", "Otros"]
function sanitizeBudgets(input) {
  if (!isPlainObject(input)) return null
  const out = {}
  for (const cat of BUDGET_CATEGORIES) {
    if (!(cat in input)) continue
    if (input[cat] === null) { out[cat] = null; continue }
    const n = Number(input[cat])
    if (Number.isFinite(n) && n > 0) out[cat] = Math.min(Math.round(n), 1_000_000_000)
  }
  return Object.keys(out).length ? out : null
}

function readShopSettings(rows) {
  const byKey = new Map(rows.map((r) => [r.key, parseJson(r.value)]))
  const business = sanitizeBusiness(byKey.get(SETTINGS_KEY_BUSINESS)) || {}
  const budgets = {}
  for (const [cat, value] of Object.entries(sanitizeBudgets(byKey.get(SETTINGS_KEY_BUDGETS)) || {})) {
    if (value !== null) budgets[cat] = value
  }
  // Solo un `true` guardado lo enciende: sin la clave, o con cualquier otra
  // cosa, "Completar solas" queda apagado (así arranca, a propósito).
  const autoComplete = byKey.get(SETTINGS_KEY_AUTO_COMPLETE) === true
  // `settings` repite los tres grupos con la forma del panel de PimpStudio
  // (d.settings.business…), para que su ConfigTab portado lea igual.
  return { business, budgets, autoComplete, settings: { business, budgets, autoComplete } }
}

async function selectShopSettings(sql) {
  try {
    return await sql`
      SELECT key, value FROM settings
      WHERE key = ANY(${[SETTINGS_KEY_BUSINESS, SETTINGS_KEY_BUDGETS, SETTINGS_KEY_AUTO_COMPLETE]}::text[])
    `
  } catch (err) {
    if (isMissingTable(err)) return []
    throw err
  }
}

/* --- Reseñas ----------------------------------------------------------------
   Token: 32 hex al azar, lo crea afterCompletion() de api/_bookingLife.js al
   completar la atención (ver ensureReviewsTable en api/_schema.js). "No
   existe" y "formato inválido" responden EXACTAMENTE el mismo 404: si
   difirieran, la respuesta serviría para tantear tokens por fuerza bruta. */
const REVIEW_TOKEN_RE = /^[a-f0-9]{32}$/
const REVIEW_NOT_FOUND = "Link inválido o vencido"
const EMPTY_DISTRIBUTION = () => ({ "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 })

function readBody(req) {
  const body = req.body
  if (typeof body === "string") {
    try { return JSON.parse(body) || {} } catch { return {} }
  }
  return isPlainObject(body) ? body : {}
}

const methodNotAllowed = (res) => res.status(405).json({ ok: false, error: "Method not allowed" })

/* PATCH ?mode=me — nombre propio. A propósito acepta SOLO el nombre: el
   usuario (code) es el login y lo cambia un admin desde Equipo (PATCH general,
   detrás del gate de admin). Como la regla de admin mira el nombre, un
   barbero sin admin no puede tomar un nombre que lo volvería admin en su
   próximo login, y el admin no puede tomar uno que lo dejaría sin serlo. */
async function handleMe(req, res) {
  if (req.method !== "PATCH") return methodNotAllowed(res)
  const session = requireInternal(req, res)
  if (!session) return
  if (!Number(session.id)) return res.status(403).json({ ok: false, error: "Sesión sin barbero asociado" })
  const name = String(readBody(req).name ?? "").trim().replace(/\s+/g, " ")
  if (!name) return res.status(400).json({ ok: false, error: "El nombre no puede estar vacío" })
  if (name.length > 80) return res.status(400).json({ ok: false, error: "Nombre demasiado largo" })
  try {
    const sql = neon(process.env.DATABASE_URL)
    const id = Number(session.id)
    const [current] = await sql`SELECT id, code, role FROM barbers WHERE id = ${id} AND active = true`
    if (!current) return res.status(404).json({ ok: false, error: "Barbero no encontrado" })
    const nextAdmin = isAdminProfile({ name, code: current.code, role: current.role })
    if (!session.admin && nextAdmin) return res.status(400).json({ ok: false, error: "Ese nombre no está disponible." })
    if (session.admin && !nextAdmin) {
      return res.status(400).json({ ok: false, error: "Con ese nombre perderías el acceso de administrador. Pídele el cambio a soporte." })
    }
    const [row] = await sql`
      UPDATE barbers SET name = ${name}, short_name = ${name.split(" ")[0]}
      WHERE id = ${id} AND active = true
      RETURNING id, name, short_name as short, code, role, tier
    `
    if (!row) return res.status(404).json({ ok: false, error: "Barbero no encontrado" })
    return res.json({ ok: true, barber: { ...row, admin: isAdminProfile(row) } })
  } catch (err) {
    console.error("barbers me error:", err?.message || err)
    return res.status(500).json({ ok: false, error: "No se pudo guardar el nombre" })
  }
}

/* GET|PATCH ?mode=settings — ajustes del PROPIO barbero de la sesión (nunca
   de otro: el id sale del token, no del body). PATCH acepta cualquier
   subconjunto de {notif, whatsapp, horario} y devuelve todo mezclado. */
async function handleSettings(req, res) {
  if (req.method !== "GET" && req.method !== "PATCH") return methodNotAllowed(res)
  const session = requireInternal(req, res)
  if (!session) return
  if (!Number(session.id)) return res.status(403).json({ ok: false, error: "Sesión sin barbero asociado" })
  const key = barberSettingsKey(session.id)
  try {
    const sql = neon(process.env.DATABASE_URL)
    const readCurrent = async () => {
      try {
        const [row] = await sql`SELECT value FROM settings WHERE key = ${key}`
        return readBarberSettings(row?.value)
      } catch (err) {
        if (isMissingTable(err)) return readBarberSettings(null)
        throw err
      }
    }
    if (req.method === "GET") return res.json({ ok: true, settings: await readCurrent() })

    const body = readBody(req)
    const notif = sanitizeFlags(body.notif, NOTIF_KEYS)
    const whatsapp = sanitizeFlags(body.whatsapp, WHATSAPP_KEYS)
    const horario = sanitizeHorario(body.horario)
    const patch = { notif: notif || {}, whatsapp: whatsapp || {}, horario: horario || {} }
    // Nada reconocible: no se escribe nada y vuelve lo guardado.
    if (!Object.values(patch).some((group) => Object.keys(group).length)) {
      return res.json({ ok: true, settings: await readCurrent() })
    }
    await ensureSettingsTable(sql)
    /* Mezcla llave por llave DENTRO de cada grupo, y en el mismo statement
       que la escritura: el panel guarda cada grupo por separado y puede
       mandar dos PATCH a la vez (uno por grupo al cargar). Leer en JS,
       mezclar y escribir perdería uno de los dos; el ON CONFLICT … DO UPDATE
       toma el candado de la fila y mezcla sobre su valor vigente. */
    const [row] = await sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES (${key}, ${JSON.stringify(patch)}, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = (
          (CASE WHEN jsonb_typeof(settings.value::jsonb) = 'object' THEN settings.value::jsonb ELSE '{}'::jsonb END)
          || jsonb_build_object(
            'notif',
              (CASE WHEN jsonb_typeof(settings.value::jsonb -> 'notif') = 'object' THEN settings.value::jsonb -> 'notif' ELSE '{}'::jsonb END)
              || ${JSON.stringify(patch.notif)}::jsonb,
            'whatsapp',
              (CASE WHEN jsonb_typeof(settings.value::jsonb -> 'whatsapp') = 'object' THEN settings.value::jsonb -> 'whatsapp' ELSE '{}'::jsonb END)
              || ${JSON.stringify(patch.whatsapp)}::jsonb,
            'horario',
              (CASE WHEN jsonb_typeof(settings.value::jsonb -> 'horario') = 'object' THEN settings.value::jsonb -> 'horario' ELSE '{}'::jsonb END)
              || ${JSON.stringify(patch.horario)}::jsonb
          )
        )::text,
        updated_at = NOW()
      RETURNING value
    `
    return res.json({ ok: true, settings: readBarberSettings(row?.value) })
  } catch (err) {
    console.error("barbers settings error:", err?.message || err)
    return res.status(500).json({ ok: false, error: "No se pudieron guardar los ajustes" })
  }
}

/* GET|PATCH ?mode=shop-settings — ajustes del NEGOCIO, solo admin (Bruno).
   Tres grupos independientes: un PATCH puede traer cualquier combinación de
   business, budgets y autoComplete; lo que no viene no se toca. Sin
   comisiones: BrunettiCutz es un solo barbero. */
async function handleShopSettings(req, res) {
  if (req.method !== "GET" && req.method !== "PATCH") return methodNotAllowed(res)
  const session = requireInternal(req, res, { admin: true })
  if (!session) return
  try {
    const sql = neon(process.env.DATABASE_URL)
    if (req.method === "GET") return res.json({ ok: true, ...readShopSettings(await selectShopSettings(sql)) })

    const body = readBody(req)
    const business = sanitizeBusiness(body.business)
    const budgets = sanitizeBudgets(body.budgets)
    const autoComplete = typeof body.autoComplete === "boolean" ? body.autoComplete : null
    if (!business && !budgets && autoComplete === null) {
      return res.status(400).json({ ok: false, error: "Nada que actualizar" })
    }
    await ensureSettingsTable(sql)
    // Cada grupo es su propia clave y su propio statement atómico: la mezcla
    // llave por llave ocurre sobre el valor vigente de la fila, no sobre una
    // lectura previa en JS.
    if (business) {
      await sql`
        INSERT INTO settings (key, value, updated_at)
        VALUES (${SETTINGS_KEY_BUSINESS}, ${JSON.stringify(business)}, NOW())
        ON CONFLICT (key) DO UPDATE SET
          value = ((CASE WHEN jsonb_typeof(settings.value::jsonb) = 'object' THEN settings.value::jsonb ELSE '{}'::jsonb END)
                   || ${JSON.stringify(business)}::jsonb)::text,
          updated_at = NOW()
      `
    }
    if (budgets) {
      // null en una categoría = borrarla (sin presupuesto); el resto se mezcla.
      const set = {}
      const drop = []
      for (const [cat, value] of Object.entries(budgets)) {
        if (value === null) drop.push(cat)
        else set[cat] = value
      }
      await sql`
        INSERT INTO settings (key, value, updated_at)
        VALUES (${SETTINGS_KEY_BUDGETS}, ${JSON.stringify(set)}, NOW())
        ON CONFLICT (key) DO UPDATE SET
          value = (((CASE WHEN jsonb_typeof(settings.value::jsonb) = 'object' THEN settings.value::jsonb ELSE '{}'::jsonb END)
                    || ${JSON.stringify(set)}::jsonb) - ${drop}::text[])::text,
          updated_at = NOW()
      `
    }
    if (autoComplete !== null) {
      await sql`
        INSERT INTO settings (key, value, updated_at)
        VALUES (${SETTINGS_KEY_AUTO_COMPLETE}, ${JSON.stringify(autoComplete)}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `
    }
    return res.json({ ok: true, ...readShopSettings(await selectShopSettings(sql)) })
  } catch (err) {
    console.error("barbers shop-settings error:", err?.message || err)
    return res.status(500).json({ ok: false, error: "No se pudieron guardar los ajustes del negocio" })
  }
}

/* GET ?mode=reviews[&barberId=N] — PANEL. Promedio, conteo, distribución
   1..5 y las últimas 30 calificadas. El admin ve todas (o las de un barbero
   con ?barberId); cualquier otra sesión, siempre las suyas, ignore lo que
   venga en la URL. Sin la tabla todavía (nadie completó una atención desde
   que existen las reseñas) vuelve el resumen vacío; cualquier otro error es
   un 500, que la tarjeta de Resumen trata como "sin datos". */
async function handleReviews(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res)
  const session = requireInternal(req, res)
  if (!session) return
  const empty = { ok: true, summary: { avg: null, count: 0, distribution: EMPTY_DISTRIBUTION() }, reviews: [] }
  const requested = Number(req.query.barberId)
  const scopeBarberId = session.admin
    ? (Number.isInteger(requested) && requested > 0 ? requested : null)
    : Number(session.id)
  if (!session.admin && !(Number.isInteger(scopeBarberId) && scopeBarberId > 0)) return res.json(empty)
  try {
    const sql = neon(process.env.DATABASE_URL)
    const distRows = await sql`
      SELECT rating, COUNT(*)::int AS n
      FROM barber_reviews
      WHERE rating IS NOT NULL AND (${scopeBarberId}::int IS NULL OR barber_id = ${scopeBarberId}::int)
      GROUP BY rating
    `
    const distribution = EMPTY_DISTRIBUTION()
    let count = 0
    let sum = 0
    for (const r of distRows) {
      const rating = Number(r.rating)
      if (!(rating >= 1 && rating <= 5)) continue
      distribution[String(rating)] = Number(r.n) || 0
      count += Number(r.n) || 0
      sum += rating * (Number(r.n) || 0)
    }
    const avg = count ? Math.round((sum / count) * 10) / 10 : null
    const reviews = await sql`
      SELECT r.id, r.rating, r.comment, r.barber_id AS "barberId",
             to_char(r.rated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "ratedAt",
             b.short_name AS barber, u.name AS client,
             COALESCE(bk.custom_service, s.name) AS service, bk.booking_date::text AS date
      FROM barber_reviews r
      JOIN barbers b ON b.id = r.barber_id
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN bookings bk ON bk.id = r.booking_id
      LEFT JOIN services s ON s.id = bk.service_id
      WHERE r.rating IS NOT NULL AND (${scopeBarberId}::int IS NULL OR r.barber_id = ${scopeBarberId}::int)
      ORDER BY r.rated_at DESC NULLS LAST, r.id DESC
      LIMIT 30
    `
    return res.json({
      ok: true,
      summary: { avg, count, distribution },
      reviews: reviews.map((r) => ({
        id: r.id, rating: r.rating, comment: r.comment || null,
        client: r.client || "Cliente", service: r.service || null, date: r.date || null, ratedAt: r.ratedAt || null,
        barberId: r.barberId, barber: r.barber || null,
      })),
    })
  } catch (err) {
    if (isMissingTable(err)) return res.json(empty)
    console.error("barbers reviews error:", err?.message || err)
    return res.status(500).json({ ok: false, error: "No se pudieron cargar las reseñas" })
  }
}

/* GET|POST ?mode=review — PÚBLICO, sin sesión. La página /resena que abre el
   cliente desde el correo de "Gracias por tu visita" (sendVisitThanksEmail en
   api/_email.js): GET carga los datos para pintarla, POST guarda la
   calificación. Con límite por IP (GET 40/min, POST 10 cada 10 min) porque
   es una puerta abierta a la base. El link vale 90 días desde la visita; se
   puede volver a calificar mientras no venza (vale la última: el cliente a
   veces toca una estrella y cambia de opinión antes de irse).

   Sin DDL acá: si la tabla no existe todavía, ningún token puede existir, y
   la respuesta es el mismo 404 de un token cualquiera. */
async function handleReview(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res)
  // El link lleva un token personal: que ningún intermediario lo guarde.
  res.setHeader("Cache-Control", "no-store")
  try {
    const sql = neon(process.env.DATABASE_URL)

    if (req.method === "GET") {
      const allowed = await rateLimit(sql, `review-get:${clientIp(req)}`, { max: 40, windowSeconds: 60 })
      if (!allowed) return res.status(429).json({ ok: false, error: "Demasiadas solicitudes. Intenta de nuevo en un momento." })
      const token = String(req.query.t || "")
      if (!REVIEW_TOKEN_RE.test(token)) return res.status(404).json({ ok: false, error: REVIEW_NOT_FOUND })
      let row = null
      try {
        ;[row] = await sql`
          SELECT b.short_name AS "barberShort", b.name AS "barberName",
                 bk.booking_date::text AS date, COALESCE(bk.custom_service, s.name) AS service,
                 u.name AS "clientName", br.rating, br.comment,
                 (br.created_at < NOW() - INTERVAL '90 days') AS expired
          FROM barber_reviews br
          JOIN barbers b ON b.id = br.barber_id
          LEFT JOIN bookings bk ON bk.id = br.booking_id
          LEFT JOIN services s ON s.id = bk.service_id
          LEFT JOIN users u ON u.id = br.user_id
          WHERE br.token = ${token}
        `
      } catch (err) {
        if (!isMissingTable(err)) throw err
      }
      if (!row) return res.status(404).json({ ok: false, error: REVIEW_NOT_FOUND })
      const barberName = row.barberName || row.barberShort || "Brunetti"
      const barber = { name: barberName, short: row.barberShort || barberName.split(" ")[0], photo: null }
      const rating = row.rating === null || row.rating === undefined ? null : Number(row.rating)
      const comment = row.comment || null
      const service = row.service || null
      const date = row.date || null
      return res.json({
        ok: true,
        // Forma de la página /resena de PimpStudio (review.barber, .service…).
        review: {
          barber, service, date,
          // Solo el primer nombre: esta página la abre cualquiera que tenga
          // el link (no hay sesión), así que no se expone el apellido.
          clientFirstName: row.clientName ? String(row.clientName).trim().split(/\s+/)[0] || null : null,
          rating, comment, rated: rating !== null, expired: Boolean(row.expired),
        },
        barber,
        booking: { service, date },
      })
    }

    const allowed = await rateLimit(sql, `review-post:${clientIp(req)}`, { max: 10, windowSeconds: 600 })
    if (!allowed) return res.status(429).json({ ok: false, error: "Demasiadas solicitudes. Intenta de nuevo más tarde." })
    const body = readBody(req)
    const token = String(body.t || "")
    if (!REVIEW_TOKEN_RE.test(token)) return res.status(404).json({ ok: false, error: REVIEW_NOT_FOUND })
    const rating = Number(body.rating)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ ok: false, error: "Elige una calificación de 1 a 5 estrellas" })
    }
    const comment = String(body.comment ?? "").trim().slice(0, 600) || null
    try {
      const [updated] = await sql`
        UPDATE barber_reviews
        SET rating = ${rating}, comment = ${comment}, rated_at = NOW()
        WHERE token = ${token} AND created_at > NOW() - INTERVAL '90 days'
        RETURNING id
      `
      if (updated) return res.json({ ok: true })
      // Distingue "no existe" (404) de "existe pero venció" (410): el link
      // pudo ser válido al cargar la página y vencer recién al enviar.
      const [exists] = await sql`SELECT 1 AS found FROM barber_reviews WHERE token = ${token}`
      if (exists) return res.status(410).json({ ok: false, error: "Este link ya venció" })
    } catch (err) {
      if (!isMissingTable(err)) throw err
    }
    return res.status(404).json({ ok: false, error: REVIEW_NOT_FOUND })
  } catch (err) {
    console.error("barbers review error:", err?.message || err)
    return res.status(500).json({ ok: false, error: "No pudimos procesar tu calificación. Intenta de nuevo." })
  }
}

async function handleMode(req, res, mode) {
  if (mode === "me") return handleMe(req, res)
  if (mode === "settings") return handleSettings(req, res)
  if (mode === "shop-settings") return handleShopSettings(req, res)
  if (mode === "reviews") return handleReviews(req, res)
  return handleReview(req, res)
}

export default async function handler(req, res) {
  // Los modos van primero, antes del gate de admin y del catch general (ver
  // el bloque de arriba). Un ?mode desconocido es un 404 con cualquier método,
  // no la lista de barberos ni la edición general: el panel nuevo pide modos
  // que un deploy viejo no conoce, y recibir la lista en su lugar le rompía la
  // pantalla; un PATCH con un modo mal escrito tampoco debe editar un barbero.
  const mode = req.query?.mode ? String(req.query.mode) : ""
  if (mode) {
    if (MODES.has(mode)) return handleMode(req, res, mode)
    return res.status(404).json({ ok: false, error: "Modo no reconocido" })
  }
  // La lista completa (inactivos + permisos de cada uno) es solo para el
  // panel: antes cualquiera que agregara ?includeInactive=true a la URL la
  // veía. Se exige la sesión ANTES de tocar la base. iOS ya manda el token.
  const includeInactive = req.method === "GET" && req.query.includeInactive === "true"
  if (includeInactive && !requireInternal(req, res)) return

  try {
    const sql = neon(process.env.DATABASE_URL)
    if (req.method === "GET") {
      const barbers = includeInactive
        ? await sql`SELECT b.id, b.name, b.short_name as short, b.code, b.role, b.tier, b.exp_years as exp, b.rating, b.active,
                           COALESCE(p.can_view_finance, false) as "canViewFinance",
                           COALESCE(p.can_manage_team, false) as "canManageTeam",
                           COALESCE(p.can_edit_services, false) as "canEditServices",
                           COALESCE(p.can_manage_blocks, true) as "canManageBlocks"
                    FROM barbers b
                    LEFT JOIN barber_permissions p ON p.barber_id = b.id
                    ORDER BY b.id`
        : await sql`SELECT id, name, short_name as short, code, role, tier, exp_years as exp, rating, active FROM barbers WHERE active = true ORDER BY id`
      return res.json({ ok: true, barbers })
    }

    const session = requireInternal(req, res, { admin: true })
    if (!session) return

    if (req.method === "POST") {
      const { name, code, role, tier = "general", password, canViewFinance = false, canManageTeam = false, canEditServices = false, canManageBlocks = true } = req.body || {}
      if (!String(name || "").trim() || !String(code || "").trim()) return res.status(400).json({ ok: false, error: "Nombre y usuario requeridos" })
      // Sin PIN "1234" por defecto: una cuenta nueva nacía con una clave que
      // cualquiera podía adivinar. Ahora trae su contraseña, con la misma regla
      // del cambio de contraseña, y se guarda en password_hash (la que lee el
      // login). pin_hash quedó obsoleto: nadie lo lee ni lo escribe.
      if (!isValidPassword(password)) {
        return res.status(400).json({ ok: false, error: "Define una contraseña de 8 caracteres alfanuméricos, con al menos 1 mayúscula y 1 número." })
      }
      const passwordHash = crypto.createHash("sha256").update(String(password)).digest("hex")
      const [barber] = await sql`
        INSERT INTO barbers (id, name, short_name, code, role, tier, exp_years, rating, active, password_hash)
        VALUES ((SELECT COALESCE(MAX(id), 3) + 1 FROM barbers), ${String(name).trim()}, ${String(name).trim().split(" ")[0]}, ${String(code).trim().toLowerCase()}, ${String(role || "Barbero").trim()}, ${tier}, 0, 5.0, true, ${passwordHash})
        RETURNING id, name, short_name as short, code, role, tier, exp_years as exp, rating, active
      `
      await sql`
        INSERT INTO barber_permissions (barber_id, can_view_finance, can_manage_team, can_edit_services, can_manage_blocks)
        VALUES (${barber.id}, ${Boolean(canViewFinance)}, ${Boolean(canManageTeam)}, ${Boolean(canEditServices)}, ${Boolean(canManageBlocks)})
        ON CONFLICT (barber_id) DO UPDATE SET
          can_view_finance = EXCLUDED.can_view_finance,
          can_manage_team = EXCLUDED.can_manage_team,
          can_edit_services = EXCLUDED.can_edit_services,
          can_manage_blocks = EXCLUDED.can_manage_blocks,
          updated_at = NOW()
      `
      return res.json({ ok: true, barber })
    }

    if (req.method === "PATCH") {
      const { id, name, code, role, tier, active, canViewFinance, canManageTeam, canEditServices, canManageBlocks } = req.body || {}
      if (!id) return res.status(400).json({ ok: false, error: "id requerido" })
      const [barber] = await sql`
        UPDATE barbers SET
          name = COALESCE(${name || null}, name),
          short_name = COALESCE(${name ? String(name).trim().split(" ")[0] : null}, short_name),
          code = COALESCE(${code ? String(code).trim().toLowerCase() : null}, code),
          role = COALESCE(${role || null}, role),
          tier = COALESCE(${tier || null}, tier),
          active = COALESCE(${typeof active === "boolean" ? active : null}, active)
        WHERE id = ${Number(id)}
        RETURNING id, name, short_name as short, code, role, tier, exp_years as exp, rating, active
      `
      if (!barber) return res.status(404).json({ ok: false, error: "Barbero no encontrado" })
      await sql`
        INSERT INTO barber_permissions (barber_id, can_view_finance, can_manage_team, can_edit_services, can_manage_blocks)
        VALUES (${Number(id)}, ${Boolean(canViewFinance)}, ${Boolean(canManageTeam)}, ${Boolean(canEditServices)}, ${canManageBlocks !== false})
        ON CONFLICT (barber_id) DO UPDATE SET
          can_view_finance = EXCLUDED.can_view_finance,
          can_manage_team = EXCLUDED.can_manage_team,
          can_edit_services = EXCLUDED.can_edit_services,
          can_manage_blocks = EXCLUDED.can_manage_blocks,
          updated_at = NOW()
      `
      return res.json({ ok: true, barber })
    }

    return res.status(405).json({ error: "Method not allowed" })
  } catch (err) {
    console.error("barbers error:", err)
    if (req.method === "GET") return res.json({ ok: true, barbers: STATIC_BARBERS.map((item) => ({ ...item, active: true })) })
    // POST/PATCH crean o editan un barbero real: fingir éxito aquí deja al
    // admin creyendo que guardó un barbero (o un permiso) que nunca se
    // escribió, igual que el bug de reservas.
    return res.status(500).json({ ok: false, error: "No se pudo procesar barberos" })
  }
}
