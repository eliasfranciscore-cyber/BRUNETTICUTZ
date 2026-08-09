import { neon } from "@neondatabase/serverless"
import { readSession, requireInternal } from "./_auth.js"
import { notifyBarber, notifyAll } from "./push.js"
import { sendBookingConfirmationEmail } from "./_email.js"
import { syncBookingToNotion, updateNotionBookingStatus } from "./_notion.js"
import { rateLimit, clientIp } from "./_rateLimit.js"
import { logBookingAttempt } from "./_bookingAudit.js"
import { blocksForDuration, slotsForBooking, busySlotsForBarberDate } from "./_slots.js"

const MIN_CANCEL_NOTICE_HOURS = 10
const MAX_LEAD_DAYS = 7
const MIN_BOOKING_LEAD_MINUTES = 55
const MAX_BOOKINGS_PER_DAY = 2
const BUSINESS_TZ = "America/Santiago"

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

export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL)

    if (req.method === "GET") {
      const { phone, barberId, date, issues } = req.query
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
        const session = requireInternal(req, res)
        if (!session) return
        const bookings = await sql`
          SELECT b.id, b.booking_date::text as date, b.booking_time::text as time,
                 b.barber_id as "barberId", br.name as barber, u.name as client, u.phone,
                 COALESCE(b.custom_service, s.name) as service,
                 COALESCE(b.custom_price, s.price)::int as price, b.status
          FROM bookings b
          JOIN users u ON b.client_id = u.id
          LEFT JOIN services s ON b.service_id = s.id
          JOIN barbers br ON b.barber_id = br.id
          WHERE (${barberId || null}::int IS NULL OR b.barber_id = ${barberId || null}::int)
            AND (${date || null}::date IS NULL OR b.booking_date = ${date || null}::date)
          ORDER BY b.booking_date DESC, b.booking_time DESC
          LIMIT 160
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
      const session = readSession(req)
      if (session) {
        const { client, phone, barberId, serviceId, service, price, date, time, status } = req.body || {}
        const cleanPhone = String(phone || "").replace(/\D/g, "")
        const allowed = new Set(["pendiente", "confirmada", "en curso", "completada", "cancelada"])
        const st = allowed.has(status) ? status : "confirmada"
        if (!String(client || "").trim()) return res.status(400).json({ ok: false, error: "Nombre del cliente requerido" })
        if (cleanPhone.length !== 9) return res.status(400).json({ ok: false, error: "El teléfono debe tener 9 dígitos" })
        if (!barberId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || !/^\d{2}:\d{2}/.test(String(time || ""))) {
          return res.status(400).json({ ok: false, error: "Datos incompletos" })
        }
        if (!serviceId && !String(service || "").trim()) {
          return res.status(400).json({ ok: false, error: "Elige un servicio o escribe uno personalizado" })
        }
        // Upsert del cliente por teléfono, sin pisar el email guardado.
        const [user] = await sql`
          INSERT INTO users (name, phone, updated_at)
          VALUES (${String(client).trim()}, ${cleanPhone}, NOW())
          ON CONFLICT (phone) DO UPDATE SET
            name = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
            updated_at = NOW()
          RETURNING id
        `
        // Un servicio de más de 1h bloquea varios horarios consecutivos, no
        // solo el que se eligió: hay que revisar que TODOS estén libres.
        const [svcRow] = serviceId ? await sql`SELECT name, duration_min FROM services WHERE id = ${Number(serviceId)}` : [null]
        const blocks = blocksForDuration(svcRow?.duration_min)
        const requiredSlots = slotsForBooking(String(time).slice(0, 5), blocks)
        if (!requiredSlots) return res.status(422).json({ ok: false, error: "Este servicio no cabe en el horario disponible. Elige una hora más temprana." })
        const busy = await busySlotsForBarberDate(sql, barberId, date)
        if (requiredSlots.some((s) => busy.has(s))) return res.status(409).json({ ok: false, error: "Ese horario ya está tomado" })
        const customPrice = price != null && price !== "" && Number.isFinite(Number(price)) ? Math.round(Number(price)) : null
        const [booking] = await sql`
          INSERT INTO bookings (client_id, barber_id, service_id, booking_date, booking_time, status, custom_service, custom_price)
          VALUES (${user.id}, ${Number(barberId)}, ${serviceId ? Number(serviceId) : null}, ${date}, ${time}, ${st},
                  ${serviceId ? null : String(service).trim()}, ${customPrice})
          RETURNING id, booking_date::text as date, booking_time::text as time, status
        `
        // Sincronizar con Notion Calendar. No bloquea la respuesta ni la
        // reserva ya creada si Notion no está configurado o falla.
        try {
          const [barberRow] = await sql`SELECT name FROM barbers WHERE id = ${Number(barberId)}`
          const synced = await syncBookingToNotion({
            client: String(client).trim(),
            phone: cleanPhone,
            service: serviceId ? svcRow?.name : String(service).trim(),
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
          console.error("notion sync (panel) error:", notionErr)
        }
        return res.json({ ok: true, booking: { ...booking, time: booking.time?.slice(0, 5) } })
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

    if (req.method === "PATCH") {
      const session = requireInternal(req, res)
      if (!session) return
      const { id, status } = req.body || {}
      const allowed = new Set(["pendiente", "confirmada", "en curso", "completada", "cancelada"])
      if (!id || !allowed.has(status)) return res.status(400).json({ ok: false, error: "Estado invalido" })
      const [booking] = await sql`
        UPDATE bookings
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${Number(id)}
        RETURNING id, booking_date::text as date, booking_time::text as time, barber_id as "barberId", status, notion_page_id as "notionPageId"
      `
      if (booking?.notionPageId) {
        updateNotionBookingStatus(booking.notionPageId, status).catch((err) => console.error("notion status update error:", err))
      }
      return res.json({ ok: true, booking: { ...booking, time: booking.time?.slice(0, 5) } })
    }

    if (req.method === "DELETE") {
      const { id, purge } = req.query
      if (!id) return res.status(400).json({ error: "Falta id" })

      // purge=1: borrado definitivo, solo desde el panel interno (barbero).
      if (purge) {
        const session = requireInternal(req, res)
        if (!session) return
        await sql`DELETE FROM bookings WHERE id = ${Number(id)}`
        return res.json({ ok: true })
      }

      // Cancelación del cliente (público, sin sesión): exige aviso minimo y
      // marca la reserva como cancelada en vez de borrarla.
      const [existing] = await sql`
        SELECT b.id, b.booking_date::text as date, b.booking_time::text as time,
               b.barber_id as "barberId", u.name as client, b.notion_page_id as "notionPageId"
        FROM bookings b JOIN users u ON b.client_id = u.id
        WHERE b.id = ${Number(id)}
      `
      if (!existing) return res.status(404).json({ error: "Reserva no encontrada" })
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
    return res.json({ ok: true, bookings: req.query?.phone ? [] : DEMO_BOOKINGS })
  }
}
