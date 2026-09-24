import { neon } from "@neondatabase/serverless"
import { readSession, requireInternal } from "./_auth.js"
import { notifyBarber, notifyAll } from "./push.js"
import { sendBookingConfirmationEmail } from "./_email.js"
import { syncBookingToNotion, updateNotionBookingStatus } from "./_notion.js"
import { rateLimit, clientIp } from "./_rateLimit.js"
import { logBookingAttempt } from "./_bookingAudit.js"
import { blocksForDuration, slotsForBooking, busySlotsForBarberDate } from "./_slots.js"
// Estrellas y canje del corte gratis: el único escritor es api/_bookingLife.js
// (ver ahí y CLAUDE.md). Este archivo no llama al puente de fidelidad directo.
import { loyaltyForTransition, redeemForBooking, afterCompletion, loyaltySnapshot } from "./_bookingLife.js"
// Puente de servicio para PimpStudio: Bruno tiene una sola agenda, pero se
// reserva/gestiona desde dos sitios con bases de datos separadas. PimpStudio
// llama estos endpoints servidor-a-servidor (nunca desde el navegador del
// cliente) con un secreto compartido, acotado siempre a su propio barbero
// (BRIDGE_BARBER_ID). La comprobación del secreto vive en api/_bridge.js.
import { isBridgeRequest, BRIDGE_BARBER_ID, normalizePhone, EMAIL_RE } from "./_bridge.js"

const MIN_CANCEL_NOTICE_HOURS = 10
const MAX_LEAD_DAYS = 10  // debe coincidir con el del calendario en src/pages/Booking.jsx
const MIN_BOOKING_LEAD_MINUTES = 55
const MAX_BOOKINGS_PER_DAY = 2
const BUSINESS_TZ = "America/Santiago"
const BOOKING_STATUSES = new Set(["pendiente", "confirmada", "en curso", "completada", "cancelada"])

// Vercel ejecuta las funciones en UTC: calcular "hoy" con new Date() ahí
// corre la fecha un día durante la noche/madrugada en Chile. Formateamos en
// la zona horaria del negocio para que coincida con lo que ve el cliente.
function businessDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}
function businessNowMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date)
  const h = Number(parts.find((p) => p.type === "hour").value)
  const m = Number(parts.find((p) => p.type === "minute").value)
  return h * 60 + m
}

const DEMO_BOOKINGS = [
  { id: 1, time: "09:00", date: "2026-06-12", client: "Carlos Rodriguez", phone: "987654321", service: "Corte + perfilado de barba", barberId: 4, price: 22990, status: "confirmada" },
  { id: 2, time: "10:00", date: "2026-06-12", client: "Diego Salinas", phone: "934567890", service: "Corte de cabello", barberId: 4, price: 15990, status: "en curso" },
  { id: 3, time: "12:00", date: "2026-06-12", client: "Joaquin Reyes", phone: "912300000", service: "Solo fade", barberId: 6, price: 9990, status: "pendiente" },
]

const isDbId = (n) => Number.isInteger(n) && n > 0 && n <= 2147483647

function isRealDate(value) {
  const [y, m, d] = String(value).split("-").map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/* Alta MANUAL de una reserva. La usan dos llamadores:
     - el panel de acá (POST con sesión de barbero), con `bridge: false`
     - PimpStudio por el puente (POST ?mode=bridge-manual), con `bridge: true`
   Sin límite de fecha (sirve para cargar a alguien que llegó sin hora, o
   para backfill), servicio del catálogo o personalizado, y precio editable
   que se congela en custom_price al reservar.

   Devuelve { status, body } en vez de responder, para que cada llamador
   decida cómo contestar.

   Con `bridge: false` hace EXACTAMENTE lo que hacía la rama del panel antes
   de extraerla a esta función: mismas validaciones, mismos mensajes, mismo
   orden de escrituras (el cliente se guarda antes del chequeo de horario).
   Desde 2026-09-24 también acredita la estrella si nace 'completada' (antes
   no, y esas atenciones quedaban sin estrella). Todo lo extra va bajo `bridge`:
     - teléfono normalizado como en PimpStudio (últimos 9 dígitos)
     - validación de fecha real, hora, largos, precio y existencia del servicio
     - barbero activo, y además Bruno: el secreto nunca agenda a otra persona
       (422, no 403: PimpStudio lee un 401/403/404 como "el puente no aceptó
       el secreto")
     - no escribe NADA si la reserva no se puede crear: cliente y reserva
       entran en un solo statement, después del chequeo de horario
     - email opcional, que solo se escribe si viene y es válido
     - 409 también si otro alta gana la carrera por el índice único del horario */
async function createManualBooking(sql, body, { bridge = false, ip = null } = {}) {
  const { client, phone, barberId, serviceId, service, price, date, time, status } = body || {}
  const fail = (code, error) => ({ status: code, body: { ok: false, error } })
  // Panel: el front ya manda los 9 dígitos limpios. Puente: puede venir con
  // +56 o un 0 delante, y el teléfono es la llave del cruce entre negocios.
  const cleanPhone = bridge ? normalizePhone(phone) : String(phone || "").replace(/\D/g, "")
  const st = BOOKING_STATUSES.has(status) ? status : "confirmada"
  const clientName = String(client || "").trim()
  const customService = String(service || "").trim()
  if (!clientName) return fail(400, "Nombre del cliente requerido")
  if (cleanPhone.length !== 9) return fail(400, "El teléfono debe tener 9 dígitos")
  if (!barberId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || !/^\d{2}:\d{2}/.test(String(time || ""))) {
    return fail(400, "Datos incompletos")
  }
  if (!serviceId && !customService) return fail(400, "Elige un servicio o escribe uno personalizado")
  const customPrice = price != null && price !== "" && Number.isFinite(Number(price)) ? Math.round(Number(price)) : null

  let email = null
  const notices = []
  if (bridge) {
    if (clientName.length > 200) return fail(400, "El nombre del cliente es demasiado largo")
    if (!serviceId && customService.length > 200) return fail(400, "El nombre del servicio es demasiado largo")
    if (!isRealDate(date)) return fail(400, "Fecha inválida")
    // Rango real, no solo la forma: "10:00:75" pasaba el patrón y el ::time
    // del INSERT lo rechazaba como un 500 en vez de un 400.
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(time))) return fail(400, "Hora inválida")
    if (price != null && price !== "" && (customPrice == null || customPrice < 0 || customPrice > 10_000_000)) {
      return fail(400, "Precio inválido")
    }
    if (!serviceId && customPrice == null) return fail(400, "Ingresa el precio del servicio personalizado")
    const rawEmail = String(body?.email || "").trim().toLowerCase()
    if (rawEmail) {
      if (rawEmail.length <= 300 && EMAIL_RE.test(rawEmail)) email = rawEmail
      else notices.push("El correo no es válido y no se guardó.")
    }
    // Ids dentro del rango de INTEGER: uno fuera de rango (o "6e0") llegaba
    // crudo a Postgres y era un 500 en vez de un rechazo.
    const barberNum = Number(barberId)
    const [barber] = isDbId(barberNum)
      ? await sql`SELECT id FROM barbers WHERE id = ${barberNum} AND active IS NOT FALSE`
      : []
    if (!barber) return fail(422, "Barbero no válido")
    if (barberNum !== BRIDGE_BARBER_ID) return fail(422, "El puente solo puede agendar en la agenda de Bruno")
    if (serviceId && !isDbId(Number(serviceId))) return fail(422, "Servicio no encontrado")
  }

  // Panel: upsert del cliente por teléfono ANTES del chequeo de horario, sin
  // pisar el nombre con vacío ni tocar el email guardado (así era y así
  // sigue). El puente lo hace más abajo, en el mismo statement de la reserva.
  const user = bridge ? null : (await sql`
    INSERT INTO users (name, phone, updated_at)
    VALUES (${clientName}, ${cleanPhone}, NOW())
    ON CONFLICT (phone) DO UPDATE SET
      name = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
      updated_at = NOW()
    RETURNING id
  `)[0]

  // Un servicio de más de 1h bloquea varios horarios consecutivos, no
  // solo el que se eligió: hay que revisar que TODOS estén libres.
  const [svcRow] = serviceId ? await sql`SELECT name, duration_min FROM services WHERE id = ${Number(serviceId)}` : [null]
  if (bridge && serviceId && !svcRow) return fail(422, "Servicio no encontrado")
  const blocks = blocksForDuration(svcRow?.duration_min)
  const requiredSlots = slotsForBooking(String(time).slice(0, 5), blocks)
  if (!requiredSlots) return fail(422, "Este servicio no cabe en el horario disponible. Elige una hora más temprana.")
  // Puente: el id ya validado (un "6.0" pasa como 6 arriba pero Postgres no lo
  // acepta como INTEGER). Panel: tal cual llega, como siempre.
  const busy = await busySlotsForBarberDate(sql, bridge ? Number(barberId) : barberId, date)
  if (requiredSlots.some((s) => busy.has(s))) return fail(409, "Ese horario ya está tomado")

  let booking
  if (bridge) {
    // Cliente + reserva en UN statement, que es una transacción: si la
    // reserva no entra, el cliente tampoco queda escrito. El upsert no pisa
    // el nombre con vacío y el email solo se escribe si vino uno válido.
    // Casts explícitos porque el driver manda todo como parámetro sin tipo.
    try {
      ;[booking] = await sql`
        WITH u AS (
          INSERT INTO users (name, phone, email, updated_at)
          VALUES (${clientName}::text, ${cleanPhone}::text, ${email}::text, NOW())
          ON CONFLICT (phone) DO UPDATE SET
            name = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
            email = COALESCE(EXCLUDED.email, users.email),
            updated_at = NOW()
          RETURNING id
        )
        INSERT INTO bookings (client_id, barber_id, service_id, booking_date, booking_time, status, custom_service, custom_price)
        SELECT u.id, ${Number(barberId)}::int, ${serviceId ? Number(serviceId) : null}::int, ${date}::date, ${time}::time,
               ${st}::text, ${serviceId ? null : customService}::text, ${customPrice}::int
        FROM u
        RETURNING id, booking_date::text as date, booking_time::text as time, status
      `
    } catch (err) {
      // Otra reserva tomó el horario entre el chequeo y el INSERT: el índice
      // único bookings_slot_unique la frenó. Es un 409, no una caída.
      if (err?.code === "23505") return fail(409, "Ese horario ya está tomado")
      throw err
    }
  } else {
    ;[booking] = await sql`
      INSERT INTO bookings (client_id, barber_id, service_id, booking_date, booking_time, status, custom_service, custom_price)
      VALUES (${user.id}, ${Number(barberId)}, ${serviceId ? Number(serviceId) : null}, ${date}, ${time}, ${st},
              ${serviceId ? null : customService}, ${customPrice})
      RETURNING id, booking_date::text as date, booking_time::text as time, status
    `
  }

  // Sincronizar con Notion Calendar. No bloquea la respuesta ni la
  // reserva ya creada si Notion no está configurado o falla. Una reserva que
  // nace completada entra directo en la etapa "Listo" (mapStatusToStage), que
  // es donde la deja el PATCH al completarla.
  try {
    const [barberRow] = await sql`SELECT name FROM barbers WHERE id = ${Number(barberId)}`
    const synced = await syncBookingToNotion({
      client: clientName,
      phone: cleanPhone,
      service: serviceId ? svcRow?.name : customService,
      barber: barberRow?.name,
      date,
      time,
      price: customPrice,
      status: st,
      durationMin: svcRow?.duration_min,
    })
    if (synced.ok) {
      await sql`UPDATE bookings SET notion_page_id = ${synced.pageId} WHERE id = ${booking.id}`
    }
  } catch (notionErr) {
    console.error(`notion sync (${bridge ? "puente" : "panel"}) error:`, notionErr)
  }

  const out = { ok: true, booking: { ...booking, time: booking.time?.slice(0, 5) } }
  if (st === "completada") {
    // Nace completada → estrella, igual que crearla y completarla con el
    // PATCH. Vale para el panel de acá y para el puente: antes el panel no la
    // acreditaba nunca (el mismo bug que PimpStudio tuvo con su "Nueva
    // reserva" hasta 2026-09-23). El nombre no viene vacío (se validó arriba),
    // así que el upsert dejó guardados exactamente clientName y cleanPhone: lo
    // mismo que el PATCH leería de la base al completarla. El saldo no viaja
    // en la respuesta: PimpStudio es la fuente de verdad de las estrellas.
    // Un servicio que no "Suma estrella" no pide nada (ok, sin aviso).
    const star = await loyaltyForTransition(sql, { bookingId: booking.id, from: null, to: st, phone: cleanPhone, name: clientName, ip })
    if (!star.ok) notices.push("La reserva quedó completada, pero la estrella de fidelidad no se pudo acreditar.")
    await afterCompletion(sql, {
      bookingId: booking.id,
      before: { status: null, barberId: Number(barberId), client: clientName, phone: cleanPhone, email, service: serviceId ? svcRow?.name : customService, date, time },
      loyalty: star.loyalty,
    })
  }
  if (notices.length) out.notice = notices.join(" ")
  return { status: 200, body: out }
}

/* Modos del puente (?mode=bridge-*). Van ANTES del dispatch normal y con
   su propio try/catch: sin el secreto correcto responden 404 —para
   cualquier otro, estos modos no existen— y nunca caen al fallback de demo
   ni a la alerta push del POST público. */
async function handleBridgeMode(req, res, mode) {
  if (!isBridgeRequest(req)) return res.status(404).json({ ok: false, error: "No encontrado" })

  /* GET ?mode=bridge-completed&days=N — las reservas COMPLETADAS cuya última
     escritura cae en los últimos N días (1–14, por defecto 3) y que llevan al
     menos 10 minutos quietas. Es la lista con que el cron horario de
     PimpStudio (healBrunettiStars) repone las estrellas que no llegaron: la
     que se pide al completar es best-effort y, si falla, nadie la reintenta.
     Solo lectura. La estrella la sigue acreditando PimpStudio por la misma
     llave (brunetti:<id>), así que no puede sumarse dos veces.
     Las de servicios que no "Suman estrella" (services.loyalty_eligible =
     false) NO salen: si salieran, el repaso de allá las acreditaría igual y
     se saltaría la regla que loyaltyForTransition aplica acá. Se lee con
     to_jsonb, así que funciona aunque la columna todavía no exista. */
  if (mode === "bridge-completed") {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" })
    res.setHeader("Cache-Control", "no-store")
    const days = Math.min(14, Math.max(1, parseInt(String(req.query?.days || "3"), 10) || 3))
    try {
      const sql = neon(process.env.DATABASE_URL)
      const rows = await sql`
        SELECT b.id, u.phone, COALESCE(u.name, '') AS name
        FROM bookings b
        JOIN users u ON u.id = b.client_id
        LEFT JOIN services s ON s.id = b.service_id
        WHERE b.status = 'completada'
          AND COALESCE((to_jsonb(s)->>'loyalty_eligible')::boolean, true)
          AND b.updated_at >= NOW() - make_interval(days => ${days}::int)
          AND b.updated_at <= NOW() - INTERVAL '10 minutes'
        ORDER BY b.id
        LIMIT 500
      `
      const bookings = []
      let skipped = 0
      for (const row of rows) {
        const phone = normalizePhone(row.phone)
        if (phone.length !== 9) { skipped++; continue }
        bookings.push({ id: row.id, phone, name: row.name })
      }
      return res.json({ ok: true, bookings, skipped })
    } catch (err) {
      console.error("bookings bridge-completed error:", err)
      return res.status(500).json({ ok: false, error: "No se pudo leer las reservas completadas" })
    }
  }

  if (mode !== "bridge-manual") return res.status(404).json({ ok: false, error: "Modo no reconocido" })
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" })
  try {
    const sql = neon(process.env.DATABASE_URL)
    const result = await createManualBooking(sql, req.body || {}, { bridge: true, ip: clientIp(req) })
    return res.status(result.status).json(result.body)
  } catch (err) {
    console.error("bookings bridge-manual error:", err)
    return res.status(500).json({ ok: false, error: "No se pudo crear la reserva en BrunettiCutz. Intenta de nuevo." })
  }
}

export default async function handler(req, res) {
  const bridgeMode = String(req.query?.mode || "")
  if (bridgeMode.startsWith("bridge-")) return handleBridgeMode(req, res, bridgeMode)

  try {
    const sql = neon(process.env.DATABASE_URL)

    if (req.method === "GET") {
      const { phone, barberId, date, issues, from, to } = req.query
      if (issues) {
        const session = requireInternal(req, res)
        if (!session) return
        // Intentos de reserva rechazados o con error real en los últimos 7
        // días: la razón por la que hoy no se pudo diagnosticar el
        // incidente que originó esto es que esta información solo vivía en
        // logs efímeros de Vercel. Best-effort: si la tabla aún no existe
        // (nadie ha fallado nunca), no es un error, solo no hay nada que ver.
        try {
          const rows = await sql`
            SELECT id, phone, barber_id as "barberId", service_id as "serviceId",
                   booking_date::text as date, booking_time as time, outcome, reason, booking_id as "bookingId",
                   created_at::text as "createdAt"
            FROM booking_attempts
            WHERE outcome IN ('rejected', 'error') AND created_at > NOW() - INTERVAL '7 days'
            ORDER BY created_at DESC
            LIMIT 50
          `
          return res.json({ ok: true, issues: rows })
        } catch {
          return res.json({ ok: true, issues: [] })
        }
      }
      if (!phone) {
        const bridge = isBridgeRequest(req)
        if (!bridge) {
          const session = requireInternal(req, res)
          if (!session) return
        }
        // El puente solo puede ver la agenda de Bruno, sin importar qué
        // barberId le pasen: nunca datos de otros barberos de PimpStudio.
        const scopeBarberId = bridge ? BRIDGE_BARBER_ID : barberId || null
        // Rango opcional (?from=YYYY-MM-DD&to=YYYY-MM-DD): el panel lo usa
        // para traer semanas pasadas que quedan fuera de las últimas 160.
        // Con rango el tope sube (una semana jamás se acerca a 1000 filas,
        // es solo un cinturón de seguridad contra rangos gigantes).
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
        const fromDate = DATE_RE.test(String(from || "")) ? from : null
        const toDate = DATE_RE.test(String(to || "")) ? to : null
        const bookings = await sql`
          SELECT b.id, b.booking_date::text as date, b.booking_time::text as time,
                 b.barber_id as "barberId", br.name as barber, u.name as client, u.phone,
                 COALESCE(b.custom_service, s.name) as service,
                 COALESCE(b.custom_price, s.price)::int as price, b.status
          FROM bookings b
          JOIN users u ON b.client_id = u.id
          LEFT JOIN services s ON b.service_id = s.id
          JOIN barbers br ON b.barber_id = br.id
          WHERE (${scopeBarberId}::int IS NULL OR b.barber_id = ${scopeBarberId}::int)
            AND (${date || null}::date IS NULL OR b.booking_date = ${date || null}::date)
            AND (${fromDate}::date IS NULL OR b.booking_date >= ${fromDate}::date)
            AND (${toDate}::date IS NULL OR b.booking_date <= ${toDate}::date)
          ORDER BY b.booking_date DESC, b.booking_time DESC
          LIMIT ${fromDate || toDate ? 1000 : 160}
        `
        return res.json({ ok: true, bookings: bookings.map((item) => ({ ...item, time: item.time?.slice(0, 5) })) })
      }
      const cleanPhone = String(phone).replace(/\D/g, "")
      // Consulta pública sin sesión (Account.jsx la llama solo con el
      // teléfono): sin límite, cualquiera puede probar teléfonos al azar y
      // ver el historial/precios de otra persona.
      const allowed = await rateLimit(sql, `bookings-get:${clientIp(req)}`, { max: 30, windowSeconds: 60 })
      if (!allowed) return res.status(429).json({ ok: false, error: "Demasiadas solicitudes. Intenta de nuevo en un momento." })
      const bookings = await sql`
        SELECT b.id, b.booking_date::text as date, b.booking_time::text as time,
               b.barber_id as "barberId", COALESCE(b.custom_service, s.name) as service, b.status,
               COALESCE(b.custom_price, s.price)::int as price,
               CASE WHEN b.booking_date > CURRENT_DATE THEN 'next'
                    WHEN b.booking_date = CURRENT_DATE THEN 'next'
                    ELSE 'past' END as "when"
        FROM bookings b
        JOIN users u ON b.client_id = u.id
        LEFT JOIN services s ON b.service_id = s.id
        WHERE u.phone = ${cleanPhone}
        ORDER BY b.booking_date DESC, b.booking_time DESC
        LIMIT 20
      `
      return res.json({ ok: true, bookings: bookings.map((item) => ({ ...item, time: item.time?.slice(0, 5) })) })
    }

    if (req.method === "POST") {
      // Modo interno (panel): reserva manual con sesión de barbero. Sin límite
      // de fecha (permite backfill), servicio existente o personalizado y
      // precio editable (se congela en custom_price al momento de reservar).
      // La lógica vive en createManualBooking(), compartida con el alta
      // manual que PimpStudio hace por el puente (?mode=bridge-manual).
      const session = readSession(req)
      if (session) {
        const result = await createManualBooking(sql, req.body || {}, { ip: clientIp(req) })
        return res.status(result.status).json(result.body)
      }

      const { phone, barberId, serviceId, date, time, idempotencyKey } = req.body || {}
      if (!phone || !barberId || !serviceId || !date || !time) {
        return res.status(400).json({ error: "Datos incompletos" })
      }
      const canBook = await rateLimit(sql, `bookings-post:${clientIp(req)}`, { max: 8, windowSeconds: 60 })
      if (!canBook) return res.status(429).json({ error: "Demasiadas reservas seguidas. Espera un momento e intenta de nuevo." })

      // Idempotencia: un doble-tap en "Confirmar" (muy fácil en mobile) o un
      // reintento de red no debe crear dos reservas para el mismo intento.
      // El front manda la misma key mientras no cambien barbero/servicio/
      // fecha/hora; acá la reclamamos de forma atómica antes de escribir nada.
      if (idempotencyKey) {
        await sql`
          CREATE TABLE IF NOT EXISTS booking_idempotency (
            key        TEXT PRIMARY KEY,
            booking_id INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `
        const [claim] = await sql`
          INSERT INTO booking_idempotency (key) VALUES (${idempotencyKey})
          ON CONFLICT (key) DO NOTHING
          RETURNING key
        `
        if (!claim) {
          // Ya existe un intento con esta key: si ya terminó de crear la
          // reserva, devolvemos esa misma reserva (replay idempotente) en
          // vez de crear una segunda.
          const [prior] = await sql`SELECT booking_id, created_at FROM booking_idempotency WHERE key = ${idempotencyKey}`
          if (prior?.booking_id) {
            const [existingBooking] = await sql`
              SELECT id, booking_date as date, booking_time as time, status
              FROM bookings WHERE id = ${prior.booking_id}
            `
            if (existingBooking) return res.json({ ok: true, booking: existingBooking })
          }
          // Sin booking_id todavía: o hay otro intento en curso ahora mismo,
          // o uno anterior falló a mitad de camino y dejó la key huérfana.
          // Pasados unos segundos asumimos lo segundo y dejamos reintentar
          // en vez de bloquear la reserva para siempre.
          const ageMs = prior ? Date.now() - new Date(prior.created_at).getTime() : Infinity
          if (ageMs < 20_000) {
            return res.status(409).json({ error: "Esta reserva ya se está procesando. Espera un momento." })
          }
          await sql`UPDATE booking_idempotency SET created_at = NOW() WHERE key = ${idempotencyKey}`
        }
      }
      // El cliente solo puede reservar dentro de los próximos MAX_LEAD_DAYS días
      // (el front ya lo oculta, pero validamos también acá para no depender
      // solo de la UI).
      const todayKey = businessDateKey(new Date())
      const maxDate = new Date()
      maxDate.setDate(maxDate.getDate() + MAX_LEAD_DAYS)
      const maxDateKey = businessDateKey(maxDate)
      const auditBase = { phone, barberId, serviceId, date, time }
      if (date < todayKey || date > maxDateKey) {
        await logBookingAttempt(sql, { ...auditBase, outcome: "rejected", reason: "fuera de la ventana de reserva" })
        return res.status(422).json({ error: `Solo puedes reservar dentro de los próximos ${MAX_LEAD_DAYS} días.` })
      }
      // Reservas de hoy requieren al menos MIN_BOOKING_LEAD_MINUTES de anticipación
      // (el front ya oculta las horas muy próximas, esto valida también en el servidor).
      if (date === todayKey) {
        const [slotH, slotM] = String(time).split(":").map(Number)
        if (slotH * 60 + slotM < businessNowMinutes(new Date()) + MIN_BOOKING_LEAD_MINUTES) {
          await logBookingAttempt(sql, { ...auditBase, outcome: "rejected", reason: "anticipación insuficiente" })
          return res.status(422).json({ error: `Debes reservar con al menos ${MIN_BOOKING_LEAD_MINUTES} minutos de anticipación.` })
        }
      }
      const cleanPhone = String(phone).replace(/\D/g, "")
      const [user] = await sql`SELECT id FROM users WHERE phone = ${cleanPhone}`
      if (!user) {
        await logBookingAttempt(sql, { ...auditBase, outcome: "rejected", reason: "usuario no encontrado" })
        return res.status(404).json({ error: "Usuario no encontrado" })
      }

      // Límite anti-spam: máximo MAX_BOOKINGS_PER_DAY reservas activas por
      // usuario por día (evita que una misma persona sature la agenda).
      const [{ count: dayCount }] = await sql`
        SELECT COUNT(*)::int as count FROM bookings
        WHERE client_id = ${user.id} AND booking_date = ${date}
        AND status NOT IN ('cancelada')
      `
      if (dayCount >= MAX_BOOKINGS_PER_DAY) {
        await logBookingAttempt(sql, { ...auditBase, outcome: "rejected", reason: "límite diario alcanzado" })
        return res.status(422).json({ error: `Ya tienes ${MAX_BOOKINGS_PER_DAY} reservas para ese día. No puedes agendar más.` })
      }

      // Datos del servicio/cliente/barbero: se usan para calcular cuántos
      // bloques de 1h ocupa la reserva y también para el aviso al barbero.
      const [info] = await sql`
        SELECT u.name as client, u.email as email, s.name as service, s.price as price,
               s.duration_min as "durationMin", br.name as barber
        FROM users u, services s, barbers br
        WHERE u.id = ${user.id} AND s.id = ${serviceId} AND br.id = ${barberId}
      `

      // Un servicio de más de 1h bloquea varios horarios consecutivos, no
      // solo el que se eligió: hay que revisar que TODOS estén libres.
      const blocks = blocksForDuration(info?.durationMin)
      const requiredSlots = slotsForBooking(String(time).slice(0, 5), blocks)
      if (!requiredSlots) {
        await logBookingAttempt(sql, { ...auditBase, outcome: "rejected", reason: "servicio no cabe en el horario" })
        return res.status(422).json({ error: "Este servicio no cabe en el horario disponible. Elige una hora más temprana." })
      }
      const busy = await busySlotsForBarberDate(sql, barberId, date)
      if (requiredSlots.some((s) => busy.has(s))) {
        await logBookingAttempt(sql, { ...auditBase, outcome: "rejected", reason: "horario no disponible" })
        return res.status(409).json({ error: "Horario no disponible" })
      }

      const [booking] = await sql`
        INSERT INTO bookings (client_id, barber_id, service_id, booking_date, booking_time, status)
        VALUES (${user.id}, ${barberId}, ${serviceId}, ${date}, ${time}, 'confirmada')
        RETURNING id, booking_date as date, booking_time as time, status
      `
      if (idempotencyKey) {
        await sql`UPDATE booking_idempotency SET booking_id = ${booking.id} WHERE key = ${idempotencyKey}`
      }
      await logBookingAttempt(sql, { ...auditBase, outcome: "success", bookingId: booking.id })

      // Aviso push al barbero + correo de confirmación al cliente. Ninguno
      // de los dos bloquea la respuesta ni la reserva ya creada.
      try {
        await notifyBarber(barberId, {
          title: "Nueva reserva",
          body: `${info?.client || "Cliente"} · ${info?.service || "Servicio"} · ${date} ${String(time).slice(0, 5)}`,
          url: `/panel?tab=reservas&date=${date}&bookingId=${booking.id}`,
          tag: `reserva-${booking.id}`,
        })
        await sendBookingConfirmationEmail({
          to: info?.email,
          name: info?.client,
          service: info?.service,
          barber: info?.barber,
          price: info?.price,
          date,
          time,
        })
        const synced = await syncBookingToNotion({
          client: info?.client,
          phone: cleanPhone,
          service: info?.service,
          barber: info?.barber,
          date,
          time,
          price: info?.price,
          status: "confirmada",
          durationMin: info?.durationMin,
        })
        if (synced.ok) {
          await sql`UPDATE bookings SET notion_page_id = ${synced.pageId} WHERE id = ${booking.id}`
        }
      } catch (notifyErr) {
        console.error("notify barber/client error:", notifyErr)
      }

      return res.json({ ok: true, booking })
    }

    /* PATCH — dos operaciones del panel sobre una reserva existente:
         { id, status }                 → cambio de estado
         { id, redeem: "free_cut" }     → canjear el corte gratis de fidelidad

       Las estrellas las escribe SOLO este backend, aunque el programa viva en
       PimpStudio: la reserva de Bruno se puede completar desde los dos
       paneles, y el de PimpStudio lo hace llamando justo acá (con el secreto
       del puente). Todos los caminos que tocan estrellas o el canje —este
       PATCH, el alta manual que ya nace completada, la cancelación pública y
       el borrado— pasan por api/_bookingLife.js, el único escritor. Un solo
       escritor = una estrella por corte. */
    if (req.method === "PATCH") {
      const bridge = isBridgeRequest(req)
      if (!bridge) {
        const session = requireInternal(req, res)
        if (!session) return
      }
      const { id, status, redeem } = req.body || {}
      if (!id) return res.status(400).json({ ok: false, error: "Falta id" })

      // Estado previo + datos del cliente: hacen falta para el control del
      // puente, para decidir si la transición otorga o quita la estrella, y
      // para identificar al cliente en PimpStudio (se cruzan por teléfono).
      // Servicio y precio van también porque la respuesta los devuelve (ver
      // abajo): la app de iOS decodifica `booking` completo.
      // clientId, email, date y barber son para afterCompletion().
      const [before] = await sql`
        SELECT b.id, b.status, b.barber_id as "barberId", b.client_id as "clientId",
               u.name as client, u.phone, u.email,
               COALESCE(b.custom_service, s.name) as service,
               COALESCE(b.custom_price, s.price)::int as price, s.price::int as "listPrice",
               b.booking_date::text as date, b.booking_time::text as time, br.name as barber
        FROM bookings b
        LEFT JOIN users u ON u.id = b.client_id
        LEFT JOIN services s ON s.id = b.service_id
        LEFT JOIN barbers br ON br.id = b.barber_id
        WHERE b.id = ${Number(id)}
      `
      // LEFT JOIN, no JOIN: una reserva cuyo cliente ya no existe igual tiene
      // que poder cambiar de estado — solo se queda sin estrella (sin teléfono
      // no hay a quién acreditársela).
      if (!before) return res.status(404).json({ ok: false, error: "Reserva no encontrada" })
      if (bridge && Number(before.barberId) !== BRIDGE_BARBER_ID) {
        // El secreto compartido nunca debe poder tocar reservas de otro
        // barbero, aunque hoy solo exista Bruno en esta base de datos.
        return res.status(403).json({ ok: false, error: "No autorizado" })
      }

      const ip = clientIp(req)

      // --- Canje del corte gratis -------------------------------------------
      // Primero se debitan las estrellas en PimpStudio y recién después se
      // deja la reserva en $0 acá (con redeem_state = 'redeemed'); si eso
      // falla, se devuelven. Ver redeemForBooking() en api/_bookingLife.js.
      if (redeem === "free_cut") {
        const result = await redeemForBooking(sql, { bookingId: id, phone: before.phone, name: before.client, ip })
        if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error })
        return res.json({ ok: true, price: 0, loyalty: result.loyalty })
      }

      if (!BOOKING_STATUSES.has(status)) return res.status(400).json({ ok: false, error: "Estado invalido" })

      const [booking] = await sql`
        UPDATE bookings
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${Number(id)}
        RETURNING id, booking_date::text as date, booking_time::text as time, barber_id as "barberId", status, notion_page_id as "notionPageId"
      `
      if (booking?.notionPageId) {
        updateNotionBookingStatus(booking.notionPageId, status).catch((err) => console.error("notion status update error:", err))
      }

      // Fidelidad: la estrella (y el canje del corte gratis) siguen al estado
      // de la reserva. Best-effort — ver loyaltyForTransition() en
      // api/_bookingLife.js, el mismo camino del alta manual que ya nace
      // completada. Cancelar una reserva con el corte gratis canjeado le
      // devuelve las 10 estrellas al cliente; deshacer la cancelación lo
      // vuelve a canjear o, si ya no se puede, la deja a precio normal.
      const life = await loyaltyForTransition(sql, {
        bookingId: id, from: before.status, to: status, phone: before.phone, name: before.client, ip,
      })
      if (before.status !== "completada" && status === "completada") {
        await afterCompletion(sql, { bookingId: id, before, loyalty: life.loyalty })
      }
      // Si el canje no se pudo volver a aplicar, la reserva quedó a precio de
      // lista (un servicio personalizado conserva el suyo).
      const price = life.redeem === "dropped" ? (before.listPrice ?? before.price ?? 0) : (before.price ?? 0)

      // client/phone/service/price se suman a la respuesta (superconjunto): la
      // app de iOS decodifica `booking` como un Booking completo —client,
      // service y price obligatorios— y sin ellos fallaba al decodificar,
      // revertía el cambio en pantalla y mostraba "No se pudo actualizar la
      // reserva" aunque el estado sí se hubiera guardado. Nunca null: iOS
      // los exige.
      return res.json({
        ok: true,
        booking: {
          ...booking,
          time: booking.time?.slice(0, 5),
          client: before.client || "",
          phone: before.phone || null,
          service: before.service || "",
          price,
        },
        loyalty: life.loyalty,
        ...(life.notice ? { notice: life.notice } : {}),
      })
    }

    if (req.method === "DELETE") {
      const { id, purge } = req.query
      if (!id) return res.status(400).json({ error: "Falta id" })

      // purge=1: borrado definitivo, solo desde el panel interno (barbero).
      if (purge) {
        const session = requireInternal(req, res)
        if (!session) return
        // La foto va ANTES del DELETE: después ya no hay reserva que leer.
        const snapshot = await loyaltySnapshot(sql, id).catch((err) => {
          console.error("purge snapshot error:", err?.message || err)
          return null
        })
        const [deleted] = await sql`DELETE FROM bookings WHERE id = ${Number(id)} RETURNING status`
        // La estrella de una completada era una proyección de ese estado: sin
        // reserva, no hay estrella. Y un corte gratis canjeado que no se va a
        // dar devuelve sus 10 estrellas.
        if (deleted) {
          const life = await loyaltyForTransition(sql, {
            bookingId: id, from: deleted.status, to: null, purged: true, row: snapshot, ip: clientIp(req),
          })
          if (life.notice) return res.json({ ok: true, notice: life.notice })
        }
        return res.json({ ok: true })
      }

      // Cancelación del cliente (público, sin sesión): exige aviso minimo y
      // marca la reserva como cancelada en vez de borrarla.
      //
      // El teléfono es OBLIGATORIO. Antes bastaba el id, y como los ids son
      // un SERIAL correlativo, un bucle de tres líneas cancelaba la agenda
      // completa sin ninguna credencial. El teléfono no es una contraseña,
      // pero es la misma prueba de identidad que el resto del flujo del
      // cliente (/cuenta entra con él) y corta el barrido por id. Va en el
      // body JSON para que no quede escrito en URLs ni en los logs; ?phone=
      // se acepta igual por si llega así.
      const bodyPhone = req.body && typeof req.body === "object" ? req.body.phone : null
      const claimedPhone = normalizePhone(bodyPhone || req.query.phone)
      if (claimedPhone.length !== 9) {
        return res.status(400).json({ error: "Falta el teléfono de la reserva. Recarga la página e intenta de nuevo." })
      }
      const canCancel = await rateLimit(sql, `bookings-cancel:${clientIp(req)}`, { max: 10, windowSeconds: 300 })
      if (!canCancel) return res.status(429).json({ error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." })

      const [existing] = await sql`
        SELECT b.id, b.booking_date::text as date, b.booking_time::text as time,
               b.barber_id as "barberId", b.status, u.name as client, u.phone,
               b.notion_page_id as "notionPageId"
        FROM bookings b JOIN users u ON b.client_id = u.id
        WHERE b.id = ${Number(id)}
      `
      // Mismo 404 para "no existe" y "no es tuya": distinguirlos permitiría
      // barrer ids para averiguar cuáles son de un teléfono dado.
      if (!existing || normalizePhone(existing.phone) !== claimedPhone) {
        return res.status(404).json({ error: "Reserva no encontrada" })
      }
      const apptAt = new Date(`${existing.date}T${existing.time}`)
      const hoursLeft = (apptAt.getTime() - Date.now()) / 3_600_000
      if (hoursLeft < MIN_CANCEL_NOTICE_HOURS) {
        return res.status(422).json({ error: `Solo puedes cancelar con al menos ${MIN_CANCEL_NOTICE_HOURS} horas de anticipación. Contáctanos directamente.` })
      }

      const [booking] = await sql`
        UPDATE bookings SET status = 'cancelada', updated_at = NOW()
        WHERE id = ${Number(id)}
        RETURNING id, booking_date::text as date, booking_time::text as time, barber_id as "barberId", status
      `
      try {
        await notifyBarber(existing.barberId, {
          title: "Reserva cancelada",
          body: `${existing.client || "Cliente"} canceló su hora del ${existing.date} a las ${String(existing.time).slice(0, 5)}`,
          url: `/panel?tab=reservas&date=${existing.date}&bookingId=${existing.id}`,
          tag: `cancelada-${existing.id}`,
        })
        if (existing.notionPageId) {
          await updateNotionBookingStatus(existing.notionPageId, "cancelada")
        }
      } catch (notifyErr) {
        console.error("notify cancel error:", notifyErr)
      }
      // Si estaba completada se devuelve la estrella, y si tenía el corte
      // gratis canjeado, el cliente recupera sus 10 estrellas: no recibió el
      // corte. Mismo escritor único que el PATCH.
      await loyaltyForTransition(sql, {
        bookingId: id, from: existing.status, to: "cancelada", phone: existing.phone, name: existing.client, ip: clientIp(req),
      })
      return res.json({ ok: true, booking })
    }

    return res.status(405).json({ error: "Method not allowed" })
  } catch (err) {
    console.error("bookings error:", err)
    if (req.method === "POST") {
      // Tanto el panel interno como el flujo público deben ver el error real:
      // fingir éxito en una escritura fallida deja al cliente creyendo que
      // tiene una hora reservada cuando en realidad nunca se guardó.
      // Además avisamos por push: así el barbero se entera por una
      // notificación en vez de por un cliente reclamando una cita que
      // nunca quedó agendada (que fue justo el incidente que originó esto).
      try {
        const sql = neon(process.env.DATABASE_URL)
        const b = req.body || {}
        await logBookingAttempt(sql, {
          phone: b.phone, barberId: b.barberId, serviceId: b.serviceId, date: b.date, time: b.time,
          outcome: "error", reason: String(err?.message || err).slice(0, 300),
        })
        const canAlert = await rateLimit(sql, "booking-fail-alert", { max: 1, windowSeconds: 120 })
        if (canAlert) {
          await notifyAll({
            title: "⚠️ Reserva no se pudo guardar",
            body: `Falló una reserva (tel. ${b.phone || "?"}, ${b.date || "?"} ${b.time || ""}). Revisa si el cliente necesita que la agendes a mano.`,
            url: "/panel?tab=reservas",
            tag: "booking-fail",
          })
        }
      } catch (alertErr) {
        console.error("booking fail alert error:", alertErr)
      }
      return res.status(500).json({ ok: false, error: "No se pudo crear la reserva. Intenta de nuevo." })
    }
    // PATCH (cambio de estado desde el panel) y DELETE (cancelación del
    // cliente) tenían el mismo bug de "éxito falso" que POST: si la
    // escritura real fallaba, igual se le decía ok:true a quien preguntó.
    // Para PATCH eso corrompe reportes de ingresos (una reserva que no se
    // marcó "completada" de verdad); para DELETE, el cliente cree que
    // canceló y el horario le sigue apareciendo tomado a todos los demás.
    if (req.method === "PATCH") {
      return res.status(500).json({ ok: false, error: "No se pudo actualizar el estado de la reserva." })
    }
    if (req.method === "DELETE") {
      return res.status(500).json({ error: "No se pudo cancelar la reserva. Intenta de nuevo." })
    }
    // El puente nunca recibe datos de demo: PimpStudio mostraría esas filas
    // inventadas como si fueran la agenda real de Bruno.
    if (isBridgeRequest(req)) {
      return res.status(500).json({ ok: false, error: "No se pudo leer la agenda en BrunettiCutz" })
    }
    return res.json({ ok: true, bookings: req.query?.phone ? [] : DEMO_BOOKINGS })
  }
}
