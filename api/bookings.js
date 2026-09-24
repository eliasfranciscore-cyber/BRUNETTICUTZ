import { neon } from "@neondatabase/serverless"
import { readSession, requireInternal } from "./_auth.js"
import { notifyBarber, notifyAll } from "./push.js"
import { sendBookingConfirmationEmail } from "./_email.js"
import { syncBookingToNotion, updateNotionBookingStatus, updateNotionBookingSchedule } from "./_notion.js"
import { rateLimit, clientIp } from "./_rateLimit.js"
import { logBookingAttempt } from "./_bookingAudit.js"
import { blocksForDuration, slotsForBooking, busySlotsForBarberDate } from "./_slots.js"
// Estrellas y canje del corte gratis: el único escritor es api/_bookingLife.js
// (ver ahí y CLAUDE.md). Este archivo no llama al puente de fidelidad directo:
// del puente solo LEE el saldo (loyaltyFor) para el 30% en productos.
import {
  loyaltyForTransition, redeemForBooking, afterCompletion, loyaltySnapshot, autoCompleteStarted,
} from "./_bookingLife.js"
import { loyaltyFor } from "./_loyaltyBridge.js"
import {
  readPayment, onlineSales, summarizeCash, PAYMENT_METHODS, MAX_AMOUNT,
  PRODUCT_DISCOUNT_STARS, PRODUCT_DISCOUNT_PCT,
} from "./_money.js"
import { ensureBookingColumns, ensureProductsLedger } from "./_schema.js"
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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

/* Un instante leído con to_jsonb (texto tipo "2026-09-24T15:04:05.123+00:00")
   → ISO sin milisegundos, que es el formato de fechas de toda la API. */
function isoNoMs(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, "Z")
}

/* ---------------------------------------------------------------------------
   Ciclo de vida al CREAR una reserva que ya nace en curso o completada.
   El INSERT no nombra las columnas nuevas (así el alta funciona aunque la
   migración no haya corrido); esto las pone después, best-effort:
     en curso    started_at = ahora (el reloj del autocompletar)
     completada  completed_at = ahora y el precio de catálogo congelado
   Si falla, la reserva queda como antes de estas columnas (una completada sin
   completed_at cuenta al precio, igual que las viejas). Devuelve si pudo. */
async function stampNewBooking(sql, bookingId, status) {
  if (status !== "en curso" && status !== "completada") return false
  try {
    await ensureBookingColumns(sql)
    await sql`
      UPDATE bookings b
      SET started_at = CASE WHEN ${status}::text = 'en curso' THEN NOW() ELSE b.started_at END,
          completed_at = CASE WHEN ${status}::text = 'completada' THEN NOW() ELSE b.completed_at END,
          price_snapshot = CASE WHEN ${status}::text = 'completada'
                                THEN COALESCE(b.price_snapshot, (SELECT s.price FROM services s WHERE s.id = b.service_id))
                                ELSE b.price_snapshot END,
          updated_at = NOW()
      WHERE b.id = ${Number(bookingId)}
    `
    return true
  } catch (err) {
    console.error("booking lifecycle stamp error:", err?.message || err)
    return false
  }
}

/* Una completada sin cobro cuyo precio es $0 (corte gratis canjeado, corte de
   la casa) no tiene nada que confirmar: queda como cortesía, monto 0, en vez de
   aparecer como "pago por confirmar" por $0. Se decide DESPUÉS de la estrella y
   el canje (loyaltyForTransition), con el precio que de verdad quedó: si al
   deshacer una cancelación el canje no se pudo volver a aplicar, la reserva
   volvió a precio de lista y NO es cortesía. Requiere la migración corrida. */
async function settleCortesia(sql, bookingId, chargedBy = null) {
  try {
    const [row] = await sql`
      UPDATE bookings b
      SET paid_amount = 0, payment_method = 'cortesia', payment_ref = NULL, paid_at = NOW(),
          charged_by = ${chargedBy}::int, updated_at = NOW()
      WHERE b.id = ${Number(bookingId)}
        AND b.status = 'completada'
        AND b.paid_at IS NULL
        AND COALESCE(b.custom_price, b.price_snapshot, (SELECT s.price FROM services s WHERE s.id = b.service_id), 0) = 0
      RETURNING b.id
    `
    return Boolean(row)
  } catch (err) {
    console.error("cortesia settle error:", err?.message || err)
    return false
  }
}

/* Alta MANUAL de una reserva. La usan dos llamadores:
     - el panel de acá (POST con sesión de barbero), con `bridge: false`
     - PimpStudio por el puente (POST ?mode=bridge-manual), con `bridge: true`
   Sin límite de fecha (sirve para cargar a alguien que llegó sin hora, o
   para backfill), servicio del catálogo o personalizado, y precio editable
   que se congela en custom_price al reservar.

   Devuelve { status, body } en vez de responder, para que cada llamador
   decida cómo contestar.

   Con `bridge: false` hace lo que hacía la rama del panel antes de extraerla
   a esta función: mismas validaciones, mismos mensajes, mismo orden de
   escrituras (el cliente se guarda antes del chequeo de horario). Desde
   2026-09-24 también acredita la estrella si nace 'completada' (antes no, y
   esas atenciones quedaban sin estrella). Dos cosas nuevas para los dos:
     - una reserva que nace en curso o completada lleva su started_at /
       completed_at (stampNewBooking), y una completada de $0 queda como
       cortesía
     - `chargeOnCreate: true` (solo el panel nuevo lo manda): una 'completada'
       se guarda 'en curso' y la respuesta trae `charging: true`, para que el
       panel abra la hoja de cobro. Completar es cobrar; sin el flag (panel
       viejo, iOS, el puente) sigue naciendo completada, con el pago por
       confirmar.
   Todo lo extra del puente va bajo `bridge`:
     - teléfono normalizado como en PimpStudio (últimos 9 dígitos)
     - validación de fecha real, hora, largos, precio y existencia del servicio
     - barbero activo, y además Bruno: el secreto nunca agenda a otra persona
       (422, no 403: PimpStudio lee un 401/403/404 como "el puente no aceptó
       el secreto")
     - no escribe NADA si la reserva no se puede crear: cliente y reserva
       entran en un solo statement, después del chequeo de horario
     - email opcional, que solo se escribe si viene y es válido
     - 409 también si otro alta gana la carrera por el índice único del horario */
async function createManualBooking(sql, body, { bridge = false, ip = null, chargedBy = null } = {}) {
  const { client, phone, barberId, serviceId, service, price, date, time, status } = body || {}
  const fail = (code, error) => ({ status: code, body: { ok: false, error } })
  // Panel: el front ya manda los 9 dígitos limpios. Puente: puede venir con
  // +56 o un 0 delante, y el teléfono es la llave del cruce entre negocios.
  const cleanPhone = bridge ? normalizePhone(phone) : String(phone || "").replace(/\D/g, "")
  const requested = BOOKING_STATUSES.has(status) ? status : "confirmada"
  const charging = !bridge && body?.chargeOnCreate === true && requested === "completada"
  const st = charging ? "en curso" : requested
  let clientName = String(client || "").trim()
  const customService = String(service || "").trim()
  // La app de iOS crea la reserva con {phone, barberId, serviceId, date, time}
  // y sin `client`: antes registra al cliente aparte con POST
  // /api/register-client (→ clients.js?mode=register), que ahora, con sesión,
  // deja el nombre en `users`. Solo para el panel (sesión, no puente): si no
  // vino nombre, se busca el que ya está guardado para ese teléfono en vez de
  // rechazar la reserva. Si tampoco hay uno guardado, sigue fallando como
  // antes.
  if (!bridge && !clientName && cleanPhone.length === 9) {
    const [existing] = await sql`SELECT name FROM users WHERE phone = ${cleanPhone}`
    if (existing?.name) clientName = existing.name
  }
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

  // started_at / completed_at / precio congelado (best-effort, ver arriba).
  const stamped = await stampNewBooking(sql, booking.id, st)

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
    // $0 = cortesía (no queda "por confirmar"). Solo con la migración corrida.
    if (stamped) await settleCortesia(sql, booking.id, chargedBy)
    await afterCompletion(sql, {
      bookingId: booking.id,
      before: { status: null, barberId: Number(barberId), client: clientName, phone: cleanPhone, email: bridge ? email : undefined, service: serviceId ? svcRow?.name : customService, date, time },
      loyalty: star.loyalty,
      earned: star.earned,
    })
  }
  if (charging) {
    notices.push("Quedó en curso: cóbrala para completarla.")
    out.charging = true
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

/* ---------------------------------------------------------------------------
   Filas de reserva del panel (con sesión). Una sola consulta para la lista,
   "Sin cerrar", "Pago por confirmar" y Caja, así las cuatro vistas hablan de
   la misma fila con los mismos campos.

   Las columnas del ciclo de vida y del cobro se leen con to_jsonb(b)->>'…':
   devuelve NULL si la columna todavía no existe, así que la lista NUNCA
   depende de que la migración haya corrido (si dependiera y fallara, el panel
   quedaría sin agenda). El LATERAL arma el jsonb una vez por fila.

   Los filtros van como parámetros opcionales (NULL = sin filtro) porque el
   driver de Neon no acepta fragmentos de SQL anidados.

   Campos: los de siempre (id, date, time, barberId, barber, client, phone,
   service, price, status) + clientId, profession, serviceId, listPrice,
   paidAmount, paymentMethod, paymentRef, noShow, freeCut, createdAt,
   startedAt, autoCompleted y paymentPending (completada con completed_at y
   sin cobro). client, service y price nunca son null: la app de iOS los exige.
   ------------------------------------------------------------------------- */
async function panelRows(sql, {
  barberId = null, date = null, from = null, to = null, before = null,
  open = false, pending = false, active = false, limit = 160,
} = {}) {
  const rows = await sql`
    SELECT b.id, b.booking_date::text as date, b.booking_time::text as time,
           b.barber_id as "barberId", br.name as barber, COALESCE(u.name, '') as client, u.phone,
           COALESCE(b.custom_service, s.name, '') as service,
           COALESCE(b.custom_price, (bj.j->>'price_snapshot')::int, s.price, 0)::int as price, b.status,
           b.client_id as "clientId", to_jsonb(u)->>'profession' as profession, b.service_id as "serviceId",
           COALESCE((bj.j->>'price_snapshot')::int, s.price, b.custom_price, 0)::int as "listPrice",
           (bj.j->>'paid_amount')::int as "paidAmount",
           bj.j->>'payment_method' as "paymentMethod",
           bj.j->>'payment_ref' as "paymentRef",
           COALESCE((bj.j->>'no_show')::boolean, false) as "noShow",
           COALESCE(bj.j->>'redeem_state' = 'redeemed', false) as "freeCut",
           to_char(b.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "createdAt",
           bj.j->>'started_at' as "startedAt",
           (bj.j->>'auto_completed_at') IS NOT NULL as "autoCompleted",
           (b.status = 'completada' AND bj.j->>'completed_at' IS NOT NULL AND bj.j->>'paid_at' IS NULL) as "paymentPending"
    FROM bookings b
    CROSS JOIN LATERAL (SELECT to_jsonb(b) AS j) bj
    JOIN users u ON b.client_id = u.id
    LEFT JOIN services s ON b.service_id = s.id
    JOIN barbers br ON b.barber_id = br.id
    WHERE (${barberId}::int IS NULL OR b.barber_id = ${barberId}::int)
      AND (${date}::date IS NULL OR b.booking_date = ${date}::date)
      AND (${from}::date IS NULL OR b.booking_date >= ${from}::date)
      AND (${to}::date IS NULL OR b.booking_date <= ${to}::date)
      AND (${before}::date IS NULL OR b.booking_date < ${before}::date)
      AND (NOT ${open}::boolean OR b.status IN ('pendiente', 'confirmada', 'en curso'))
      AND (NOT ${pending}::boolean OR (b.status = 'completada' AND bj.j->>'completed_at' IS NOT NULL AND bj.j->>'paid_at' IS NULL))
      AND (NOT ${active}::boolean OR b.status <> 'cancelada')
    ORDER BY b.booking_date DESC, b.booking_time DESC
    LIMIT ${limit}::int
  `
  return rows.map((row) => ({
    ...row,
    time: row.time?.slice(0, 5),
    noShow: row.noShow === true,
    freeCut: row.freeCut === true,
    autoCompleted: row.autoCompleted === true,
    paymentPending: row.paymentPending === true,
    startedAt: isoNoMs(row.startedAt),
  }))
}

/* Autocompletar (api/_bookingLife.js) antes de leer, para que la lista ya
   muestre "completada" lo que se completó solo. Nunca tumba el GET que lo
   llama: si falla, la lista sale igual y lo intenta el próximo request (o el
   cron). Apagado por defecto (settings 'panel:auto_complete') y solo en
   producción; con el interruptor apagado cuesta a lo más una consulta cada
   15 s por lambda. Presupuesto de tiempo más corto que el del cron: acá hay
   un panel esperando la lista, y lo que no alcance lo toma la próxima pasada. */
async function autoCompleteSafely(sql) {
  try {
    await autoCompleteStarted(sql, { notifyBarber, budgetMs: 4_000 })
  } catch (err) {
    console.error("autocomplete error:", err?.message || err)
  }
}

/* GET ?mode=unclosed[&summary=1] (admin) — atenciones pasadas sin cerrar y
   pagos por confirmar. Alimenta "Sin cerrar" (Caja) y el aviso del Resumen.
     items      reservas de días ANTERIORES a hoy (Santiago) que siguen
                pendientes, confirmadas o en curso: no suman estrella ni
                entran a la caja. Se cierran cobrándolas (PATCH completada con
                el cobro) o con "No vino" (PATCH cancelada + noShow).
     toConfirm  completadas sin cobro registrado (paymentPending): las que
                completó el sistema, la app de iOS o el panel de PimpStudio,
                que no mandan medio de pago. De cualquier día, hoy incluido.
   summary=1 devuelve solo los conteos. JOIN users también en los conteos: sin
   cliente, el PATCH respondería 404 y la fila no se podría cerrar. Nunca
   datos de demo: una lista inventada haría "cerrar" reservas que no existen. */
async function handleUnclosed(req, res, sql) {
  const session = requireInternal(req, res, { admin: true })
  if (!session) return
  await autoCompleteSafely(sql)
  try {
    const today = businessDateKey(new Date())
    const [counts] = await sql`
      SELECT COUNT(*) FILTER (WHERE b.booking_date < ${today}::date
                                AND b.status IN ('pendiente', 'confirmada', 'en curso'))::int AS unclosed,
             COUNT(*) FILTER (WHERE b.status = 'completada'
                                AND bj.j->>'completed_at' IS NOT NULL
                                AND bj.j->>'paid_at' IS NULL)::int AS "toConfirm"
      FROM bookings b
      CROSS JOIN LATERAL (SELECT to_jsonb(b) AS j) bj
      JOIN users u ON u.id = b.client_id
      JOIN barbers br ON br.id = b.barber_id
    `
    const count = Number(counts?.unclosed || 0)
    const toConfirmCount = Number(counts?.toConfirm || 0)
    if (req.query.summary) return res.json({ ok: true, count, toConfirmCount })
    const items = await panelRows(sql, { before: today, open: true, limit: 500 })
    const toConfirm = await panelRows(sql, { pending: true, limit: 200 })
    return res.json({ ok: true, count, items, toConfirm, toConfirmCount })
  } catch (err) {
    console.error("unclosed error:", err?.message || err)
    return res.status(500).json({ ok: false, error: "No se pudieron cargar las atenciones sin cerrar" })
  }
}

/* GET ?mode=cash&date=YYYY-MM-DD (admin) — el arqueo del día: qué entró y por
   qué medio. Las reservas del día (sin canceladas), las ventas de producto
   pagadas del día y lo que entró online por Mercado Pago (onlineSales: pedidos
   de Essentials e inscripciones de Cursos/Workshop). La aritmética vive en
   summarizeCash() (api/_money.js). Las ventas y lo online son best-effort: sin
   la tabla de ventas (nadie vendió nunca) o con Mercado Pago caído, el arqueo
   de servicios sale igual. */
async function handleCash(req, res, sql) {
  const session = requireInternal(req, res, { admin: true })
  if (!session) return
  const day = DATE_RE.test(String(req.query.date || "")) && isRealDate(req.query.date)
    ? String(req.query.date)
    : businessDateKey(new Date())
  await autoCompleteSafely(sql)
  try {
    const rows = await panelRows(sql, { date: day, active: true, limit: 500 })
    const bookings = rows.sort((a, b) => String(a.time).localeCompare(String(b.time)))

    let sales = []
    try {
      sales = await sql`
        SELECT ps.id, ps.booking_id AS "bookingId", ps.total, ps.payment_method AS "paymentMethod",
               ps.payment_ref AS "paymentRef", ps.status,
               (SELECT COALESCE(json_agg(json_build_object('name', i.name_snapshot, 'qty', i.qty, 'lineTotal', i.line_total) ORDER BY i.id), '[]'::json)
                  FROM product_sale_items i WHERE i.sale_id = ps.id) AS items
        FROM product_sales ps
        WHERE ps.sale_date = ${day}::date AND ps.status = 'pagada'
        ORDER BY ps.paid_at NULLS LAST, ps.id
      `
      sales = sales.map((s) => ({
        ...s,
        total: Number(s.total) || 0,
        items: (typeof s.items === "string" ? JSON.parse(s.items) : s.items) || [],
      }))
    } catch (err) {
      if (err?.code !== "42P01") console.error("cash sales error:", err?.message || err)
      sales = []
    }

    let online = null
    try {
      online = await onlineSales(sql, { from: day, to: day, withOrders: true })
    } catch (err) {
      console.error("cash online error:", err?.message || err)
    }

    const totals = summarizeCash({ bookings, sales, online })
    return res.json({
      ok: true,
      date: day,
      ...totals,
      bookings,
      sales,
      online: (online?.orders || []).map((o) => ({
        id: o.id, type: o.type, name: o.name, amount: o.amount, detail: o.detail, created_at: o.created_at,
      })),
    })
  } catch (err) {
    console.error("cash error:", err?.message || err)
    return res.status(500).json({ ok: false, error: "No se pudo cargar la caja del día" })
  }
}

/* GET ?mode=sales&from&to (admin) — ventas de producto pagadas de un rango,
   una fila por línea (es el grano que necesitan Finanzas y la exportación).
   Sin la tabla (nadie vendió nunca) es una lista vacía, no un error. */
async function handleSalesList(req, res, sql) {
  const session = requireInternal(req, res, { admin: true })
  if (!session) return
  const today = businessDateKey(new Date())
  const from = DATE_RE.test(String(req.query.from || "")) && isRealDate(req.query.from) ? String(req.query.from) : today
  const to = DATE_RE.test(String(req.query.to || "")) && isRealDate(req.query.to) ? String(req.query.to) : from
  if (to < from) return res.status(400).json({ ok: false, error: "Rango inválido" })
  let items = []
  try {
    items = await sql`
      SELECT ps.id AS "saleId", ps.booking_id AS "bookingId", ps.sale_date::text AS date,
             i.product_id AS "productId", i.name_snapshot AS name, i.qty,
             i.unit_price AS "unitPrice", i.unit_collected AS "unitCollected", i.line_total AS "lineTotal",
             ps.payment_method AS "paymentMethod", ps.status
      FROM product_sale_items i
      JOIN product_sales ps ON ps.id = i.sale_id
      WHERE ps.status = 'pagada'
        AND ps.sale_date >= ${from}::date
        AND ps.sale_date <= ${to}::date
      ORDER BY ps.sale_date, ps.id, i.id
    `
  } catch (err) {
    if (err?.code !== "42P01") {
      console.error("sales list error:", err?.message || err)
      return res.status(500).json({ ok: false, error: "No se pudieron cargar las ventas" })
    }
  }
  return res.json({
    ok: true,
    range: { from, to },
    items,
    totals: {
      units: items.reduce((n, r) => n + Number(r.qty || 0), 0),
      collected: items.reduce((n, r) => n + Number(r.lineTotal || 0), 0),
    },
  })
}

/* POST ?mode=sale (admin) — venta de productos en el mesón, con reserva (se
   agregan a una atención) o sin ella (mostrador). Sin comisión: BrunettiCutz
   es un solo barbero.

   LA PLATA DEL PRODUCTO NO TOCA bookings.paid_amount: son dos plata distintas
   que se cobran juntas, y el arqueo las suma en el mismo byMethod.

   Precios SIEMPRE desde la base, nunca desde el body. El 30% de fidelidad
   solo si el puente confirma ≥5 estrellas en el momento (503 si el puente no
   responde y se pidió el descuento: nunca se regala a ciegas).

   products.stock ES LA VERDAD (lo lee y descuenta también el checkout de
   Mercado Pago). Cabecera + líneas + movimiento 'venta' del libro + el
   descuento de stock van en UN statement: o entra todo o no entra nada. El
   UPDATE de stock solo toca filas con stock suficiente, y si alguna no
   alcanzó (otra venta se la llevó entre la lectura y esto), la división por
   cero del final aborta el statement entero —cabecera y stock incluidos— y
   la respuesta es 409. Nunca queda stock negativo ni una venta a medias. */
async function handleSaleCreate(req, res, sql) {
  const session = requireInternal(req, res, { admin: true })
  if (!session) return
  try {
    const body = req.body || {}
    const items = Array.isArray(body.items) ? body.items : []
    if (!items.length || items.length > 50) return res.status(400).json({ ok: false, error: "Agrega al menos un producto" })
    const method = String(body.paymentMethod || "").trim()
    if (!PAYMENT_METHODS.includes(method)) return res.status(400).json({ ok: false, error: "Indica el medio de pago" })
    // La cortesía es para el servicio (corte gratis, corte de la casa). Un
    // producto que sale del mesón se cobra: registrarlo como cortesía dejaría
    // plata sin medio en el arqueo, o productos regalados sin querer.
    if (method === "cortesia") {
      return res.status(400).json({ ok: false, error: "Los productos no se registran como cortesía: indica cómo se pagaron." })
    }
    const ref = body.paymentRef == null ? null : String(body.paymentRef).trim().slice(0, 60) || null

    const wanted = new Map()
    for (const raw of items) {
      const id = Number(raw?.productId)
      const qty = Number(raw?.qty)
      if (!isDbId(id) || !Number.isInteger(qty) || qty <= 0 || qty > 999) {
        return res.status(400).json({ ok: false, error: "Cantidad inválida" })
      }
      wanted.set(id, (wanted.get(id) || 0) + qty)
    }

    await ensureProductsLedger(sql)

    let booking = null
    if (body.bookingId != null && body.bookingId !== "") {
      const bookingId = Number(body.bookingId)
      if (isDbId(bookingId)) {
        ;[booking] = await sql`
          SELECT id, client_id AS "clientId", booking_date::text AS date, status
          FROM bookings WHERE id = ${bookingId}
        `
      }
      if (!booking) return res.status(404).json({ ok: false, error: "Reserva no encontrada" })
      if (booking.status === "cancelada") {
        return res.status(409).json({ ok: false, error: "No se le pueden agregar productos a una reserva cancelada" })
      }
    }

    let clientId = booking?.clientId ?? null
    if (clientId == null && body.clientId != null && body.clientId !== "") {
      clientId = Number(body.clientId)
      if (!isDbId(clientId)) return res.status(404).json({ ok: false, error: "Cliente no encontrado" })
    }
    let clientPhone = null
    if (clientId != null) {
      const [client] = await sql`SELECT id, phone FROM users WHERE id = ${clientId}`
      if (!client && !booking) return res.status(404).json({ ok: false, error: "Cliente no encontrado" })
      if (!client) clientId = null
      clientPhone = client?.phone || null
    }

    let discountPct = 0
    if (body.applyLoyaltyDiscount === true) {
      const phone = normalizePhone(clientPhone)
      if (phone.length !== 9) {
        return res.status(422).json({ ok: false, error: "Este cliente todavía no tiene el descuento de productos" })
      }
      // Solo LECTURA del saldo en PimpStudio (el programa vive allá).
      const info = await loyaltyFor(phone, clientIp(req))
      if (!info) {
        return res.status(503).json({ ok: false, error: "No se pudo verificar la tarjeta de fidelidad. Intenta de nuevo o cobra sin el descuento." })
      }
      const stars = Number(info.loyalty?.stars)
      const ready = info.loyalty?.productDiscountReady === true || (Number.isFinite(stars) && stars >= PRODUCT_DISCOUNT_STARS)
      if (!ready) return res.status(422).json({ ok: false, error: "Este cliente todavía no tiene el descuento de productos" })
      discountPct = PRODUCT_DISCOUNT_PCT
    }

    const ids = [...wanted.keys()]
    const products = await sql`
      SELECT id, name, price, cost, stock, active
      FROM products
      WHERE id = ANY(${ids}::int[]) AND archived_at IS NULL
    `
    if (products.length !== ids.length) return res.status(404).json({ ok: false, error: "Algún producto ya no existe" })

    const lines = []
    for (const product of products) {
      const qty = wanted.get(Number(product.id))
      if (product.active === false) return res.status(422).json({ ok: false, error: `${product.name} no está a la venta` })
      if (Number(product.stock) < qty) {
        return res.status(409).json({ ok: false, error: `${product.name}: solo quedan ${Math.max(0, Number(product.stock))}` })
      }
      const unitPrice = Number(product.price)
      const unitCollected = Math.round(unitPrice * (100 - discountPct) / 100)
      lines.push({
        product_id: Number(product.id),
        qty,
        name: product.name,
        unit_price: unitPrice,
        unit_collected: unitCollected,
        unit_cost: product.cost == null ? null : Number(product.cost),
        line_total: unitCollected * qty,
      })
    }
    const total = lines.reduce((n, l) => n + l.line_total, 0)
    if (total > MAX_AMOUNT) return res.status(400).json({ ok: false, error: "El total de la venta no es válido" })
    const saleDate = booking?.date || businessDateKey(new Date())
    const chargedBy = isDbId(Number(session.id)) ? Number(session.id) : null

    let sale
    try {
      ;[sale] = await sql`
        WITH wanted AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(lines)}::jsonb) AS x(
            product_id int, qty int, name text, unit_price int, unit_collected int, unit_cost int, line_total int
          )
        ), stock AS (
          UPDATE products p
          SET stock = p.stock - w.qty, updated_at = NOW()
          FROM wanted w
          WHERE p.id = w.product_id AND p.stock >= w.qty AND p.archived_at IS NULL
          RETURNING p.id
        ), new_sale AS (
          INSERT INTO product_sales
            (booking_id, client_id, sale_date, source, status, payment_method, payment_ref, discount_pct, total, paid_at, charged_by)
          SELECT ${booking?.id ?? null}::int, ${clientId}::int, ${saleDate}::date, ${booking ? "atencion" : "mostrador"}::text,
                 'pagada', ${method}::text, ${ref}::text, ${discountPct}::int, ${total}::int, NOW(), ${chargedBy}::int
          WHERE (SELECT COUNT(*) FROM stock) = ${lines.length}::int
          RETURNING id
        ), new_items AS (
          INSERT INTO product_sale_items
            (sale_id, product_id, qty, name_snapshot, unit_price, unit_collected, unit_cost, line_total)
          SELECT ns.id, w.product_id, w.qty, w.name, w.unit_price, w.unit_collected, w.unit_cost, w.line_total
          FROM new_sale ns, wanted w
          RETURNING id, product_id, qty
        ), moves AS (
          INSERT INTO product_stock_moves (product_id, delta, kind, reason, sale_item_id, created_by)
          SELECT ni.product_id, -ni.qty, 'venta', ${booking ? `Venta en la atención #${booking.id}` : "Venta en mesón"}::text, ni.id, ${chargedBy}::int
          FROM new_items ni
          RETURNING id
        )
        SELECT (SELECT id FROM new_sale) AS id,
               1 / (CASE WHEN (SELECT COUNT(*) FROM stock) = ${lines.length}::int THEN 1 ELSE 0 END) AS ok
      `
    } catch (err) {
      // 22012 = la división del final: alguna línea se quedó sin stock en la
      // carrera. El statement entero se deshizo.
      if (err?.code === "22012") {
        return res.status(409).json({ ok: false, error: "Otra venta se llevó parte del stock recién. Revisa las cantidades e intenta de nuevo." })
      }
      throw err
    }

    return res.json({
      ok: true,
      sale: {
        id: sale?.id ?? null,
        bookingId: booking?.id ?? null,
        date: saleDate,
        total,
        paymentMethod: method,
        paymentRef: ref,
        discountPct,
        items: lines.map((l) => ({
          productId: l.product_id, name: l.name, qty: l.qty,
          unitPrice: l.unit_price, unitCollected: l.unit_collected, lineTotal: l.line_total,
        })),
      },
    })
  } catch (err) {
    console.error("sale error:", err?.message || err)
    return res.status(500).json({ ok: false, error: "No se pudo registrar la venta. Intenta de nuevo." })
  }
}

/* DELETE ?mode=sale&saleId= (admin) — anular una venta. No borra: la marca
   'anulada', escribe un movimiento 'devolucion' por línea y devuelve el stock,
   todo en un statement. El UPDATE de la cabecera exige status = 'pagada', así
   que dos anulaciones a la vez devuelven el stock una sola vez. */
async function handleSaleVoid(req, res, sql) {
  const session = requireInternal(req, res, { admin: true })
  if (!session) return
  const saleId = Number(req.query.saleId)
  if (!isDbId(saleId)) return res.status(400).json({ ok: false, error: "Falta saleId" })
  try {
    let found
    try {
      ;[found] = await sql`SELECT id, status FROM product_sales WHERE id = ${saleId}`
    } catch (err) {
      if (err?.code !== "42P01") throw err
    }
    if (!found) return res.status(404).json({ ok: false, error: "Venta no encontrada" })
    if (found.status === "anulada") return res.status(409).json({ ok: false, error: "Esa venta ya está anulada" })
    const chargedBy = isDbId(Number(session.id)) ? Number(session.id) : null
    const [voided] = await sql`
      WITH voided AS (
        UPDATE product_sales SET status = 'anulada'
        WHERE id = ${saleId} AND status = 'pagada'
        RETURNING id
      ), sold_lines AS (
        SELECT i.id, i.product_id, i.qty
        FROM product_sale_items i
        JOIN voided v ON v.id = i.sale_id
      ), moves AS (
        INSERT INTO product_stock_moves (product_id, delta, kind, reason, sale_item_id, created_by)
        SELECT l.product_id, l.qty, 'devolucion', ${`Anulación de la venta #${saleId}`}::text, l.id, ${chargedBy}::int
        FROM sold_lines l
        RETURNING id
      ), restock AS (
        UPDATE products p
        SET stock = p.stock + x.qty, updated_at = NOW()
        FROM (SELECT product_id, SUM(qty)::int AS qty FROM sold_lines GROUP BY product_id) x
        WHERE p.id = x.product_id
        RETURNING p.id
      )
      SELECT id FROM voided
    `
    if (!voided) return res.status(409).json({ ok: false, error: "Esa venta ya está anulada" })
    return res.json({ ok: true, sale: { id: saleId, status: "anulada" } })
  } catch (err) {
    console.error("sale void error:", err?.message || err)
    return res.status(500).json({ ok: false, error: "No se pudo anular la venta. Intenta de nuevo." })
  }
}

/* La reserva tal como la devuelve el PATCH: la forma de siempre (la app de
   iOS la decodifica como Booking completo: client, service y price nunca
   null) + el cobro. Se lee DESPUÉS de todas las escrituras (estado, canje,
   cortesía), así el precio es el que de verdad quedó. Si esta lectura falla,
   el cambio ya está guardado: se responde con `fallback` en vez de un 500 que
   haría creer que no se guardó. */
async function bookingForResponse(sql, id, fallback) {
  try {
    const [row] = await sql`
      SELECT b.id, b.booking_date::text as date, b.booking_time::text as time,
             b.barber_id as "barberId", b.status, b.notion_page_id as "notionPageId",
             COALESCE(u.name, '') as client, u.phone,
             COALESCE(b.custom_service, s.name, '') as service,
             COALESCE(b.custom_price, (bj.j->>'price_snapshot')::int, s.price, 0)::int as price,
             (bj.j->>'paid_amount')::int as "paidAmount",
             bj.j->>'payment_method' as "paymentMethod",
             bj.j->>'payment_ref' as "paymentRef",
             COALESCE((bj.j->>'no_show')::boolean, false) as "noShow",
             (b.status = 'completada' AND bj.j->>'completed_at' IS NOT NULL AND bj.j->>'paid_at' IS NULL) as "paymentPending"
      FROM bookings b
      CROSS JOIN LATERAL (SELECT to_jsonb(b) AS j) bj
      LEFT JOIN users u ON u.id = b.client_id
      LEFT JOIN services s ON s.id = b.service_id
      WHERE b.id = ${Number(id)}
    `
    if (row) {
      return {
        ...row,
        time: row.time?.slice(0, 5),
        phone: row.phone || null,
        noShow: row.noShow === true,
        paymentPending: row.paymentPending === true,
      }
    }
  } catch (err) {
    console.error("booking response read error:", err?.message || err)
  }
  return fallback
}

/* PATCH — operaciones sobre una reserva existente:
     { id, status, paidAmount?, paymentMethod?, paymentRef?, noShow?, price? }
                                          → cambio de estado (y cobro)
     { id, date?, time?, serviceId? }     → reagendar (con sesión)
     { id, price }                        → editar el precio (admin)
     { id, redeem: "free_cut" }           → canjear el corte gratis

   El puente de PimpStudio solo puede mandar { id, status, redeem }: el resto
   del body se ignora (su panel no cobra ni reagenda la agenda de Bruno).

   Las estrellas las escribe SOLO este backend, aunque el programa viva en
   PimpStudio: la reserva de Bruno se puede completar desde los dos paneles, y
   el de PimpStudio lo hace llamando justo acá (con el secreto del puente).
   Todos los caminos que tocan estrellas o el canje pasan por
   api/_bookingLife.js, el único escritor. Un solo escritor = una estrella por
   corte.

   QUIÉN ESCRIBE custom_price: el canje escribe 0; el precio editado a mano
   (admin) escribe el suyo, pero nunca > 0 sobre un canje; reagendar NO lo toca
   nunca (moverla no puede des-canjearla ni repreciarla). */
async function handlePatch(req, res, sql) {
  const bridge = isBridgeRequest(req)
  let session = null
  if (!bridge) {
    session = requireInternal(req, res)
    if (!session) return
  }
  const body = req.body || {}
  const input = bridge ? { id: body.id, status: body.status, redeem: body.redeem } : body
  const { id, status, redeem } = input
  if (!id) return res.status(400).json({ ok: false, error: "Falta id" })
  if (!isDbId(Number(id))) return res.status(404).json({ ok: false, error: "Reserva no encontrada" })
  const bookingId = Number(id)

  // Estado previo + datos del cliente: hacen falta para el control del
  // puente, para decidir si la transición otorga o quita la estrella, para
  // identificar al cliente en PimpStudio (se cruzan por teléfono), para el
  // correo de gracias (afterCompletion) y el de "tu hora cambió", y para la
  // respuesta, que la app de iOS decodifica como Booking completo.
  // Las columnas opcionales van por to_jsonb: no dependen de la migración.
  const [before] = await sql`
    SELECT b.id, b.status, b.barber_id as "barberId", b.client_id as "clientId",
           u.name as client, u.phone, u.email,
           COALESCE(b.custom_service, s.name) as service,
           COALESCE(b.custom_price, (to_jsonb(b)->>'price_snapshot')::int, s.price)::int as price,
           COALESCE((to_jsonb(b)->>'price_snapshot')::int, s.price)::int as "listPrice",
           b.service_id as "serviceId", s.duration_min as "durationMin",
           b.booking_date::text as date, b.booking_time::text as time, br.name as barber,
           b.notion_page_id as "notionPageId",
           to_jsonb(b)->>'redeem_state' as "redeemState"
    FROM bookings b
    LEFT JOIN users u ON u.id = b.client_id
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN barbers br ON br.id = b.barber_id
    WHERE b.id = ${bookingId}
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
  const fallbackBooking = (extra = {}) => ({
    id: bookingId,
    date: before.date,
    time: before.time?.slice(0, 5),
    barberId: before.barberId,
    status: before.status,
    notionPageId: before.notionPageId || null,
    client: before.client || "",
    phone: before.phone || null,
    service: before.service || "",
    price: before.price ?? 0,
    paidAmount: null,
    paymentMethod: null,
    paymentRef: null,
    noShow: false,
    paymentPending: false,
    ...extra,
  })

  // --- Canje del corte gratis -------------------------------------------
  // Primero se debitan las estrellas en PimpStudio y recién después se
  // deja la reserva en $0 acá (con redeem_state = 'redeemed'); si eso
  // falla, se devuelven. Ver redeemForBooking() en api/_bookingLife.js.
  if (redeem === "free_cut") {
    const result = await redeemForBooking(sql, { bookingId, phone: before.phone, name: before.client, ip })
    if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error })
    return res.json({ ok: true, price: 0, loyalty: result.loyalty })
  }

  // --- Reagendar (solo con sesión) ----------------------------------------
  const wantsDate = input.date !== undefined && input.date !== null && input.date !== ""
  const wantsTime = input.time !== undefined && input.time !== null && input.time !== ""
  const wantsService = input.serviceId !== undefined && input.serviceId !== null && input.serviceId !== ""
  if (!bridge && (wantsDate || wantsTime || wantsService)) {
    return reschedule(res, sql, { before, input, bookingId, wantsDate, wantsTime, wantsService, fallbackBooking })
  }

  // --- Precio editado a mano (admin) --------------------------------------
  // Puede venir solo (ajuste sin cambiar estado) o junto a un cambio de estado.
  let priceOverride = null
  if (!bridge && input.price !== undefined && input.price !== null && input.price !== "") {
    if (!session.admin) return res.status(403).json({ ok: false, error: "Solo un admin puede editar el precio de una reserva" })
    const n = typeof input.price === "string" ? Number(input.price.trim()) : Number(input.price)
    if (!Number.isInteger(n) || n < 0 || n > MAX_AMOUNT) return res.status(400).json({ ok: false, error: "Precio inválido" })
    if (before.redeemState === "redeemed" && n > 0) {
      return res.status(409).json({ ok: false, error: "Esta reserva tiene el corte gratis canjeado: su precio no se puede cambiar." })
    }
    priceOverride = n
  }

  if (status === undefined && priceOverride !== null) {
    await sql`UPDATE bookings SET custom_price = ${priceOverride}::int, updated_at = NOW() WHERE id = ${bookingId}`
    // Una completada que queda en $0 sin cobro pasa a cortesía, igual que al
    // completarla (si la migración no está, no hay columnas que tocar).
    if (before.status === "completada" && priceOverride === 0) {
      const migrated = await ensureBookingColumns(sql).then(() => true, () => false)
      if (migrated) await settleCortesia(sql, bookingId, session?.id ?? null)
    }
    const booking = await bookingForResponse(sql, bookingId, fallbackBooking({ price: priceOverride }))
    return res.json({ ok: true, booking })
  }

  // --- Cambio de estado ----------------------------------------------------
  if (!BOOKING_STATUSES.has(status)) return res.status(400).json({ ok: false, error: "Estado invalido" })

  /* El cobro es OPCIONAL en el servidor (ver api/_money.js): ni iOS ni el
     puente mandan medio de pago, y el servidor no distingue el panel web de
     la app. Solo la hoja de cobro del panel web lo exige. Sin cobro, una
     completada queda "pago por confirmar" (o cortesía si es $0). Solo se lee
     al completar; en otro estado se ignora. */
  const payment = session && status === "completada" ? readPayment(input) : null
  if (payment?.error) return res.status(400).json({ ok: false, error: payment.error })
  // "No vino" (inasistencia) = cancelada + no_show. Solo con sesión.
  const noShowParam = session && typeof input.noShow === "boolean" ? input.noShow : null
  const chargedBy = session && isDbId(Number(session.id)) ? Number(session.id) : null

  // Las columnas nuevas hacen falta para escribir el ciclo de vida. Si la
  // migración no se puede correr ahora (un candado que no se consigue), el
  // cambio de estado igual sale —como antes de estas columnas—, salvo que
  // traiga un cobro o un "No vino", que sin columnas no hay dónde guardar.
  const migrated = await ensureBookingColumns(sql).then(() => true, (err) => {
    console.error("ensureBookingColumns (PATCH) error:", err?.message || err)
    return false
  })
  if (!migrated && (payment || noShowParam === true)) {
    return res.status(503).json({ ok: false, error: "No se pudo guardar el cobro ahora. Intenta de nuevo en un momento." })
  }

  const collected = payment ? payment.collected : null
  let updated
  try {
    if (migrated) {
      ;[updated] = await sql`
        UPDATE bookings
        SET status = ${status}::text, updated_at = NOW(),
            -- A la derecha del = las columnas tienen el valor ANTERIOR.
            -- "No vino" solo vale en cancelada; cualquier otro estado lo limpia,
            -- y una cancelada que sigue cancelada sin decir nada lo conserva.
            no_show = CASE WHEN ${status}::text <> 'cancelada' THEN false
                           WHEN ${noShowParam}::boolean IS NOT NULL THEN ${noShowParam}::boolean
                           WHEN status = 'cancelada' THEN no_show
                           ELSE false END,
            custom_price = COALESCE(${priceOverride}::int, custom_price),
            -- El precio de catálogo se congela UNA vez, al completar.
            price_snapshot = CASE WHEN ${status}::text = 'completada'
                                  THEN COALESCE(price_snapshot, (SELECT s.price FROM services s WHERE s.id = bookings.service_id))
                                  ELSE price_snapshot END,
            -- Desde cuándo está completada: se pone al entrar, se conserva al
            -- corregir (completada → completada) y se borra al salir.
            completed_at = CASE WHEN ${status}::text <> 'completada' THEN NULL
                                WHEN status = 'completada' THEN completed_at
                                ELSE NOW() END,
            -- El cobro se escribe entero cuando viene uno (el comprobante
            -- también: pasar de tarjeta a efectivo tiene que poder dejarlo
            -- vacío). Sin cobro, queda lo que había.
            paid_amount    = CASE WHEN ${collected}::int IS NULL THEN paid_amount ELSE ${collected}::int END,
            payment_method = CASE WHEN ${collected}::int IS NULL THEN payment_method ELSE ${payment?.method ?? null}::text END,
            payment_ref    = CASE WHEN ${collected}::int IS NULL THEN payment_ref ELSE ${payment?.ref ?? null}::text END,
            paid_at        = CASE WHEN ${collected}::int IS NULL THEN paid_at ELSE NOW() END,
            charged_by     = CASE WHEN ${collected}::int IS NULL THEN charged_by ELSE ${chargedBy}::int END,
            -- Reloj del autocompletar: entrar a "en curso" lo pone en ahora
            -- (volver de completada no la completa sola al instante), repetir
            -- "en curso" lo deja, completar lo conserva, el resto lo limpia.
            started_at = CASE WHEN ${status}::text = 'en curso'
                              THEN CASE WHEN status = 'en curso' THEN COALESCE(started_at, NOW()) ELSE NOW() END
                              WHEN ${status}::text = 'completada' THEN started_at
                              ELSE NULL END,
            -- "La completó el sistema" solo sobrevive a una corrección.
            auto_completed_at = CASE WHEN ${status}::text = 'completada' AND status = 'completada'
                                     THEN auto_completed_at ELSE NULL END
        WHERE id = ${bookingId}
        RETURNING id, booking_date::text as date, booking_time::text as time, barber_id as "barberId", status,
                  notion_page_id as "notionPageId", paid_amount as "paidAmount",
                  payment_method as "paymentMethod", payment_ref as "paymentRef", no_show as "noShow",
                  (status = 'completada' AND paid_at IS NULL AND completed_at IS NOT NULL) as "paymentPending"
      `
    } else {
      ;[updated] = await sql`
        UPDATE bookings
        SET status = ${status}::text, updated_at = NOW(), custom_price = COALESCE(${priceOverride}::int, custom_price)
        WHERE id = ${bookingId}
        RETURNING id, booking_date::text as date, booking_time::text as time, barber_id as "barberId", status, notion_page_id as "notionPageId"
      `
    }
  } catch (err) {
    // Deshacer una cancelación hacia un horario que otra reserva ya tomó: el
    // índice único bookings_slot_unique la frena. Conflicto de agenda, no caída.
    if (err?.code === "23505") return res.status(409).json({ ok: false, error: "Ese horario ya está tomado por otra reserva" })
    throw err
  }
  if (!updated) return res.status(404).json({ ok: false, error: "Reserva no encontrada" })
  if (updated.notionPageId) {
    updateNotionBookingStatus(updated.notionPageId, status).catch((err) => console.error("notion status update error:", err))
  }

  // Fidelidad: la estrella (y el canje del corte gratis) siguen al estado
  // de la reserva. Best-effort — ver loyaltyForTransition() en
  // api/_bookingLife.js, el mismo camino del alta manual que ya nace
  // completada. Cancelar una reserva con el corte gratis canjeado le
  // devuelve las 10 estrellas al cliente; deshacer la cancelación lo
  // vuelve a canjear o, si ya no se puede, la deja a precio normal.
  // completada → completada (confirmar o corregir un cobro) no mueve nada.
  const life = await loyaltyForTransition(sql, {
    bookingId, from: before.status, to: status, phone: before.phone, name: before.client, ip,
  })
  // Completada sin cobro y en $0 → cortesía, con el precio que quedó después
  // del canje (ver settleCortesia).
  if (migrated && status === "completada" && !payment) await settleCortesia(sql, bookingId, chargedBy)
  if (before.status !== "completada" && status === "completada") {
    await afterCompletion(sql, { bookingId, before, loyalty: life.loyalty, earned: life.earned })
  }

  const booking = await bookingForResponse(sql, bookingId, fallbackBooking({
    ...updated,
    time: updated.time?.slice(0, 5),
    // Si el canje no se pudo volver a aplicar, la reserva quedó a precio de
    // lista (un servicio personalizado conserva el suyo).
    price: priceOverride ?? (life.redeem === "dropped" ? (before.listPrice ?? before.price ?? 0) : (before.price ?? 0)),
    paidAmount: updated.paidAmount ?? null,
    paymentMethod: updated.paymentMethod ?? null,
    paymentRef: updated.paymentRef ?? null,
    noShow: updated.noShow === true,
    paymentPending: updated.paymentPending === true,
  }))

  // Mismas llaves de siempre (ok, booking, loyalty, notice?) y booking con
  // client/phone/service/price nunca null: la app de iOS decodifica `booking`
  // como un Booking completo y sin ellos revertía el cambio en pantalla.
  return res.json({
    ok: true,
    booking,
    loyalty: life.loyalty,
    ...(life.notice ? { notice: life.notice } : {}),
  })
}

/* Reagendar: fecha, hora y/o servicio. Mismo barbero (acá hay uno solo).
   Re-chequea el horario excluyendo a la propia reserva (si no, cambiarle el
   servicio dejándola en su hora chocaría consigo misma) y deja que el índice
   único bookings_slot_unique frene la carrera (409). Si cambió el día o la
   hora, se rearma el recordatorio de 1 hora (reminder_60_sent), se mueve la
   página de Notion y, si la hora es futura y sigue pendiente o confirmada, el
   cliente recibe el correo "tu hora cambió". No toca custom_price ni el
   precio congelado. */
async function reschedule(res, sql, { before, input, bookingId, wantsDate, wantsTime, wantsService, fallbackBooking }) {
  const targetDate = wantsDate ? String(input.date) : before.date
  const targetTime = String(wantsTime ? input.time : before.time || "").slice(0, 5)
  if (!DATE_RE.test(targetDate) || !isRealDate(targetDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(targetTime)) {
    return res.status(400).json({ ok: false, error: "Fecha u hora inválida" })
  }
  let targetService = before.serviceId ?? null
  let svcRow = null
  if (wantsService) {
    targetService = Number(input.serviceId)
    ;[svcRow] = isDbId(targetService)
      ? await sql`SELECT id, name, duration_min, price FROM services WHERE id = ${targetService}`
      : []
    if (!svcRow) return res.status(422).json({ ok: false, error: "Servicio no encontrado" })
  }
  const serviceChanged = wantsService && Number(targetService) !== Number(before.serviceId)
  const scheduleChanged = targetDate !== before.date || targetTime !== String(before.time || "").slice(0, 5)
  if (!serviceChanged && !scheduleChanged) {
    const booking = await bookingForResponse(sql, bookingId, fallbackBooking())
    return res.json({ ok: true, booking })
  }

  // Sin servicio de catálogo (servicio personalizado) se conserva la
  // duración que ya tenía en vez de asumir 60 min.
  const durationMin = svcRow?.duration_min ?? before.durationMin
  const requiredSlots = slotsForBooking(targetTime, blocksForDuration(durationMin))
  if (!requiredSlots) return res.status(422).json({ ok: false, error: "Este servicio no cabe en ese horario. Elige una hora más temprana." })
  const busy = await busySlotsForBarberDate(sql, Number(before.barberId), targetDate, bookingId)
  if (requiredSlots.some((s) => busy.has(s))) return res.status(409).json({ ok: false, error: "Ese horario ya está tomado" })

  let moved
  try {
    ;[moved] = await sql`
      UPDATE bookings
      SET booking_date = ${targetDate}::date,
          booking_time = ${targetTime}::time,
          service_id = ${targetService}::int,
          -- Elegir un servicio del catálogo reemplaza el nombre personalizado.
          custom_service = CASE WHEN ${serviceChanged}::boolean THEN NULL ELSE custom_service END,
          reminder_60_sent = CASE WHEN ${scheduleChanged}::boolean THEN false ELSE reminder_60_sent END,
          updated_at = NOW()
      WHERE id = ${bookingId}
      RETURNING id, status, notion_page_id as "notionPageId"
    `
  } catch (err) {
    if (err?.code === "23505") return res.status(409).json({ ok: false, error: "Ese horario ya está tomado" })
    throw err
  }
  if (!moved) return res.status(404).json({ ok: false, error: "Reserva no encontrada" })

  const booking = await bookingForResponse(sql, bookingId, fallbackBooking({
    date: targetDate, time: targetTime, service: svcRow?.name || before.service || "",
  }))

  // Avisos: ninguno bloquea la respuesta ni revierte el cambio ya hecho.
  try {
    if (moved.notionPageId) {
      await updateNotionBookingSchedule(moved.notionPageId, {
        date: targetDate, time: targetTime, durationMin,
        service: booking.service, barber: before.barber, price: booking.price, client: before.client,
      })
    }
    const today = businessDateKey(new Date())
    const [h, m] = targetTime.split(":").map(Number)
    const upcoming = targetDate > today || (targetDate === today && h * 60 + m > businessNowMinutes(new Date()))
    if (upcoming && (moved.status === "pendiente" || moved.status === "confirmada")) {
      await sendBookingConfirmationEmail({
        to: before.email,
        name: before.client,
        service: booking.service,
        barber: before.barber,
        price: booking.price,
        date: targetDate,
        time: targetTime,
        kind: "reschedule",
      })
    }
  } catch (notifyErr) {
    console.error("notify reschedule error:", notifyErr)
  }
  return res.json({ ok: true, booking })
}

export default async function handler(req, res) {
  const bridgeMode = String(req.query?.mode || "")
  if (bridgeMode.startsWith("bridge-")) return handleBridgeMode(req, res, bridgeMode)

  try {
    const sql = neon(process.env.DATABASE_URL)
    const mode = String(req.query?.mode || "")

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
      // Vistas del panel nuevo, cada una con su propio try/catch (500, nunca
      // demo): Sin cerrar, Caja del día y ventas de producto.
      if (mode === "unclosed") return handleUnclosed(req, res, sql)
      if (mode === "cash") return handleCash(req, res, sql)
      if (mode === "sales") return handleSalesList(req, res, sql)
      if (!phone) {
        const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
        const fromDate = DATE_ONLY.test(String(from || "")) ? from : null
        const toDate = DATE_ONLY.test(String(to || "")) ? to : null
        if (isBridgeRequest(req)) {
          // El puente solo puede ver la agenda de Bruno, sin importar qué
          // barberId le pasen: nunca datos de otros barberos de PimpStudio.
          // Esta consulta es EXACTAMENTE la de siempre (contrato congelado
          // con api/bruno-agenda.js de PimpStudio) y sin autocompletar.
          // Rango opcional (?from=YYYY-MM-DD&to=YYYY-MM-DD): el panel lo usa
          // para traer semanas pasadas que quedan fuera de las últimas 160.
          // Con rango el tope sube (una semana jamás se acerca a 1000 filas,
          // es solo un cinturón de seguridad contra rangos gigantes).
          const scopeBarberId = BRIDGE_BARBER_ID
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

        const session = requireInternal(req, res)
        if (!session) return
        // Con sesión, un error de base es un 500 y el panel muestra un aviso:
        // nunca filas de demo, sobre las que se podría completar o cobrar
        // (sus ids 1–3 son reservas reales).
        try {
          await autoCompleteSafely(sql)
          const scopeBarberId = isDbId(Number(barberId)) ? Number(barberId) : null
          const dateKey = DATE_ONLY.test(String(date || "")) ? String(date) : null
          const bookings = await panelRows(sql, {
            barberId: scopeBarberId, date: dateKey, from: fromDate, to: toDate,
            limit: fromDate || toDate ? 1000 : 160,
          })
          return res.json({ ok: true, bookings })
        } catch (err) {
          console.error("bookings panel list error:", err?.message || err)
          return res.status(500).json({ ok: false, error: "No se pudieron cargar las reservas. Revisa la conexión e intenta de nuevo." })
        }
      }
      const cleanPhone = String(phone).replace(/\D/g, "")
      // Consulta pública sin sesión (Account.jsx la llama solo con el
      // teléfono): sin límite, cualquiera puede probar teléfonos al azar y
      // ver el historial/precios de otra persona.
      const allowed = await rateLimit(sql, `bookings-get:${clientIp(req)}`, { max: 30, windowSeconds: 60 })
      if (!allowed) return res.status(429).json({ ok: false, error: "Demasiadas solicitudes. Intenta de nuevo en un momento." })
      // El precio de una completada es el que se congeló al completarla
      // (price_snapshot, leído sin depender de la migración). `client`/`phone`
      // siempre se leen (el driver de Neon no acepta fragmentos de SQL
      // condicionales) pero solo viajan en la respuesta con sesión de barbero
      // válida: la app de iOS usa esta misma ruta para el historial de un
      // cliente (loadBookingHistory) y su Booking.client no es opcional; sin
      // sesión, la respuesta pública sigue exactamente igual que siempre —
      // nunca se expone el nombre de otra persona a quien solo prueba
      // teléfonos al azar.
      const session = readSession(req)
      const bookings = await sql`
        SELECT b.id, b.booking_date::text as date, b.booking_time::text as time,
               b.barber_id as "barberId", COALESCE(b.custom_service, s.name) as service, b.status,
               COALESCE(b.custom_price, (to_jsonb(b)->>'price_snapshot')::int, s.price)::int as price,
               COALESCE(u.name, '') as client, u.phone,
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
      return res.json({
        ok: true,
        bookings: bookings.map(({ client, phone: itemPhone, ...item }) => (
          session ? { ...item, client, phone: itemPhone, time: item.time?.slice(0, 5) } : { ...item, time: item.time?.slice(0, 5) }
        )),
      })
    }

    if (req.method === "POST" && mode === "sale") return handleSaleCreate(req, res, sql)

    if (req.method === "POST") {
      // Modo interno (panel): reserva manual con sesión de barbero. Sin límite
      // de fecha (permite backfill), servicio existente o personalizado y
      // precio editable (se congela en custom_price al momento de reservar).
      // La lógica vive en createManualBooking(), compartida con el alta
      // manual que PimpStudio hace por el puente (?mode=bridge-manual).
      const session = readSession(req)
      if (session) {
        const result = await createManualBooking(sql, req.body || {}, {
          ip: clientIp(req), chargedBy: isDbId(Number(session.id)) ? Number(session.id) : null,
        })
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
      // Un servicio de un solo día (services.only_on_date) vive fuera de la
      // ventana de MAX_LEAD_DAYS a propósito: la gracia es poder agendarlo con
      // semanas de anticipación para ese día. A cambio, ese día es su ÚNICA
      // fecha válida. Se lee con to_jsonb: sin la columna, ningún servicio es
      // de un solo día y todo sigue como antes.
      const [svcDay] = isDbId(Number(serviceId))
        ? await sql`SELECT to_jsonb(s)->>'only_on_date' AS day FROM services s WHERE s.id = ${Number(serviceId)}`
        : []
      const onlyOnDate = DATE_RE.test(String(svcDay?.day || "")) ? String(svcDay.day) : null
      if (onlyOnDate && date !== onlyOnDate) {
        await logBookingAttempt(sql, { ...auditBase, outcome: "rejected", reason: "servicio de un solo día en otra fecha" })
        const [y, mo, d] = onlyOnDate.split("-")
        return res.status(422).json({ error: `Este servicio solo se agenda el ${d}-${mo}-${y}.` })
      }
      if (date < todayKey || (date > maxDateKey && !onlyOnDate)) {
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

    if (req.method === "PATCH") return handlePatch(req, res, sql)

    if (req.method === "DELETE" && mode === "sale") return handleSaleVoid(req, res, sql)

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
    // inventadas como si fueran la agenda real de Bruno. Tampoco una sesión
    // del panel o de iOS: sobre una fila de demo se puede completar o cobrar,
    // y sus ids (1–3) son reservas reales.
    if (isBridgeRequest(req)) {
      return res.status(500).json({ ok: false, error: "No se pudo leer la agenda en BrunettiCutz" })
    }
    if (!req.query?.phone && readSession(req)) {
      return res.status(500).json({ ok: false, error: "No se pudieron cargar las reservas. Revisa la conexión e intenta de nuevo." })
    }
    return res.json({ ok: true, bookings: req.query?.phone ? [] : DEMO_BOOKINGS })
  }
}
