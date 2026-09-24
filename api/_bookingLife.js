/* BRUNETTI — Ciclo de vida de una atención: estrellas y canje (escritor único)
   ------------------------------------------------------------------
   Este es el ÚNICO archivo del proyecto que importa creditStar, revertStar,
   redeemFreeCut y cancelRedeem de api/_loyaltyBridge.js ("un solo escritor",
   ver CLAUDE.md). La estrella la acredita siempre este backend, aunque el
   programa viva en PimpStudio: la reserva de Bruno se puede completar desde
   los dos paneles, y el de PimpStudio lo hace llamando al PATCH de acá con el
   secreto del puente. Un solo camino = una estrella por corte. Pasan por acá:

     - el PATCH de api/bookings.js (panel de acá, app de iOS y puente)
     - el alta manual que nace 'completada' (panel con sesión y bridge-manual)
     - el canje explícito del corte gratis (redeemForBooking)
     - la cancelación pública desde /cuenta
     - el borrado definitivo de una reserva (purge) y el de un cliente con
       todas sus reservas (api/clients.js DELETE)
     - el autocompletado de las atenciones "en curso" (autoCompleteStarted,
       acá mismo), desde el GET del panel y desde el cron de push.js

   La única escritura de afuera es la reposición del cron de PimpStudio
   (GET /api/bookings?mode=bridge-completed), con la misma llave y solo para
   sumar. creditStar() es idempotente allá por bridge_ref = "brunetti:<id>":
   un reintento no suma dos.

   Best-effort, SIEMPRE: si PimpStudio no responde, el cambio de estado (lo
   importante, ya guardado) no se revierte ni falla la respuesta. Ninguna
   función de acá lanza; cada llamada al puente tiene su propio try/catch.

   Además vive acá lo que pasa DESPUÉS de completar (afterCompletion: la fila
   de reseña y el correo de gracias, una vez por visita) y el autocompletado
   de las atenciones que quedaron "en curso" (autoCompleteStarted), que acredita
   por el mismo loyaltyForTransition.

   Prefijo `_`: no consume slot de función serverless. No importa push.js a
   propósito (bookings.js ya lo importa, y push.js puede necesitar este
   archivo desde el cron): así no se cierra ningún ciclo. Quien quiera el push
   de "confirma cómo pagó" del autocompletado pasa su notifyBarber.
   ================================================================ */

import { randomBytes } from "node:crypto"
import { creditStar, revertStar, redeemFreeCut, cancelRedeem } from "./_loyaltyBridge.js"
import { ensureBookingColumns, ensureReviewsTable } from "./_schema.js"
import { sendVisitThanksEmail } from "./_email.js"
import { updateNotionBookingStatus } from "./_notion.js"

const COMPLETED = "completada"
const CANCELLED = "cancelada"
const REDEEM_STATES = new Set(["redeemed", "voided"])
const BUSINESS_TZ = "America/Santiago"

/* Los efectos que escriben en la base de producción o le hablan a un cliente
   —autocompletar, el correo de gracias y la fila de reseña— corren solo en el
   deploy de producción. Un preview o un `vercel dev` pueden apuntar a la
   misma base (el .env.local de este proyecto es el de producción): sin esta
   puerta, completarían atenciones reales, acreditarían estrellas y mandarían
   correos desde una rama a medio probar. AUTO_COMPLETE_SANDBOX=1 la abre a
   propósito, contra una base de prueba. */
export function lifecycleEffectsEnabled() {
  return process.env.VERCEL_ENV === "production" || process.env.AUTO_COMPLETE_SANDBOX === "1"
}

/* Día de calendario en Santiago ('YYYY-MM-DD'), corrido `offsetDays`. Vercel
   corre en UTC: new Date() a secas cambia de día a las 20:00/21:00 de Chile. */
function santiagoDateKey(offsetDays = 0) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  if (!offsetDays) return today
  const [y, m, d] = today.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10)
}

/* "Fresca" = de hoy o de ayer. El gracias por tu visita de una atención de
   hace semanas (cobrada tarde desde "Sin cerrar", o cargada a mano como
   historial) confunde más de lo que agradece. */
export function isFreshBookingDate(date) {
  const key = String(date || "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && key >= santiagoDateKey(-1)
}

/* Lo que hace falta saber de la reserva para decidir, leído sin depender de
   la migración (to_jsonb da NULL si la columna todavía no existe):
     eligible     "Suma estrella" del servicio. Sin servicio de catálogo
                  (servicio personalizado) no hay flag que la excluya: suma.
     redeemState  NULL | 'redeemed' | 'voided'
     customPrice  0 con redeemState NULL = canje de antes de redeem_state
                  (o un precio puesto en 0 a mano: cancelRedeem lo distingue).
     serviceId    para no borrarle el precio a un servicio personalizado. */
export async function loyaltySnapshot(sql, bookingId) {
  const [row] = await sql`
    SELECT b.id, b.status, b.service_id AS "serviceId", b.custom_price AS "customPrice",
           to_jsonb(b)->>'redeem_state' AS "redeemState",
           COALESCE((to_jsonb(s)->>'loyalty_eligible')::boolean, true) AS eligible,
           u.phone, u.name
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN users u ON u.id = b.client_id
    WHERE b.id = ${Number(bookingId)}
  `
  return row ? normalizeSnapshot(row) : null
}

function normalizeSnapshot(row) {
  return {
    status: row.status ?? null,
    serviceId: row.serviceId ?? null,
    eligible: row.eligible !== false && row.eligible !== "false",
    redeemState: REDEEM_STATES.has(row.redeemState) ? row.redeemState : null,
    customPrice: row.customPrice == null ? null : Number(row.customPrice),
    phone: row.phone ?? null,
    name: row.name ?? null,
  }
}

/* Deja la reserva en redeem_state = state. Si no se puede escribir (la
   migración no corrió y no se pudo correr), el canje se da por caído y la
   reserva vuelve a precio de lista: sin la marca, deshacer la cancelación
   dejaría un corte gratis sin estrellas descontadas. */
async function markRedeemState(sql, bookingId, state) {
  try {
    await ensureBookingColumns(sql)
    await sql`UPDATE bookings SET redeem_state = ${state}::text, updated_at = NOW() WHERE id = ${Number(bookingId)}`
    return true
  } catch (err) {
    console.error("redeem_state write error:", err?.message || err)
    if (state === "voided") {
      try {
        await sql`
          UPDATE bookings SET custom_price = CASE WHEN service_id IS NULL THEN custom_price ELSE NULL END, updated_at = NOW()
          WHERE id = ${Number(bookingId)}
        `
      } catch (dropErr) {
        console.error("redeem drop fallback error:", dropErr?.message || dropErr)
      }
    }
    return false
  }
}

/* Entrar a 'cancelada' (o borrar la reserva) con el corte gratis canjeado:
   el cliente no recibió el corte, así que recupera sus 10 estrellas. Antes
   la fila del canje quedaba intacta en PimpStudio y el cliente perdía el
   premio. cancelRedeem es idempotente: si no había canje, no hace nada. */
async function voidRedeem(sql, { bookingId, snap, ip, purged, out }) {
  const redeemed = snap.redeemState === "redeemed"
  const legacy = snap.redeemState === null && snap.customPrice === 0
  if (!redeemed && !legacy) return

  out.attempted = true
  let ok = false
  let data = null
  try {
    const result = await cancelRedeem({ bookingId, ip })
    ok = result?.status < 400 && result?.data?.ok !== false
    data = result?.data || null
  } catch (err) {
    console.error("loyalty cancelRedeem error:", err?.message || err)
  }
  if (!ok) {
    out.ok = false
    out.notice = "No se pudieron devolver las estrellas del corte gratis (PimpStudio no respondió)."
    return
  }
  if (data?.loyalty) out.loyalty = data.loyalty
  // Un $0 de antes sin fila de canje allá era un precio puesto a mano, no un
  // canje: no hay nada que marcar.
  if (!redeemed && !data?.cancelled) return
  out.redeem = "voided"
  if (!purged) await markRedeemState(sql, bookingId, "voided")
}

/* Salir de 'cancelada' (deshacer una cancelación) con el canje anulado: se
   vuelve a canjear. El puente de PimpStudio no tiene "reponer": su
   cancelación borra la fila, así que esto vuelve a debitar las 10 estrellas.
   Si ya no le alcanzan (o PimpStudio no responde), la reserva vuelve a precio
   de lista con un aviso — nunca queda un corte gratis sin estrellas
   descontadas. */
async function restoreRedeem(sql, { bookingId, snap, phone, name, ip, out }) {
  out.attempted = true
  let result = null
  try {
    result = await redeemFreeCut({ bookingId, phone, name, ip })
  } catch (err) {
    console.error("loyalty redeemFreeCut error:", err?.message || err)
  }
  // 409 = esa reserva ya tiene el canje allá: las estrellas están debitadas.
  if (result?.ok || result?.status === 409) {
    if (result?.loyalty) out.loyalty = result.loyalty
    out.redeem = "restored"
    await markRedeemState(sql, bookingId, "redeemed")
    return
  }

  out.ok = false
  out.redeem = "dropped"
  const custom = snap.serviceId == null
  try {
    await sql`
      UPDATE bookings
      SET custom_price = CASE WHEN service_id IS NULL THEN custom_price ELSE NULL END,
          redeem_state = NULL, updated_at = NOW()
      WHERE id = ${Number(bookingId)}
    `
  } catch (err) {
    console.error("redeem drop error:", err?.message || err)
  }
  const why = result?.status === 422
    ? "al cliente ya no le alcanzan las estrellas"
    : "PimpStudio no respondió"
  out.notice = custom
    ? `El corte gratis no se pudo volver a aplicar (${why}). Revisa el precio de la reserva.`
    : `El corte gratis no se pudo volver a aplicar (${why}). La reserva quedó a precio normal.`
}

/* La estrella (y el canje) siguen al estado de la reserva.

     → completada        acredita la estrella, si el servicio "Suma estrella"
     completada → otro   la devuelve (siempre: es idempotente allá, y una que
                         se acreditó antes de apagar el flag también se va)
     → cancelada         además devuelve las estrellas del corte gratis
     cancelada → otro    vuelve a canjearlo (ver restoreRedeem)
     purged              la reserva se borró: devuelve la estrella y el canje

   `row` es la foto de la reserva (loyaltySnapshot); si no viene, se lee acá.
   Un borrado DEBE pasar la foto capturada ANTES del DELETE.

   Devuelve { attempted, ok, loyalty, earned, redeem, notice }:
     attempted  hubo al menos una llamada al puente
     ok         ninguna falló
     loyalty    el saldo que devolvió PimpStudio (o null)
     earned     esta llamada sumó la estrella (no un reintento que ya estaba)
     redeem     null | 'voided' | 'restored' | 'dropped'
     notice     texto para el panel cuando algo del canje no salió */
export async function loyaltyForTransition(sql, { bookingId, from, to, phone, name, ip, row = null, purged = false }) {
  const out = { attempted: false, ok: true, loyalty: null, earned: false, redeem: null, notice: null }
  const earn = !purged && from !== COMPLETED && to === COMPLETED
  const revert = from === COMPLETED && (purged || to !== COMPLETED)
  const entersCancel = purged || (from !== CANCELLED && to === CANCELLED)
  const leavesCancel = !purged && from === CANCELLED && to !== CANCELLED
  if (!earn && !revert && !entersCancel && !leavesCancel) return out

  let snap = row ? normalizeSnapshot(row) : null
  if (!snap && (earn || entersCancel || leavesCancel)) {
    try {
      snap = await loyaltySnapshot(sql, bookingId)
    } catch (err) {
      // Sin foto: la estrella sigue como siempre (suma) y el canje no se toca.
      console.error("loyalty snapshot error:", err?.message || err)
    }
  }
  const who = { phone: phone ?? snap?.phone ?? null, name: name ?? snap?.name ?? null }

  // 1) El canje primero: deja resuelto el precio antes de la estrella.
  if (snap && entersCancel) await voidRedeem(sql, { bookingId, snap, ip, purged, out })
  if (snap && leavesCancel && snap.redeemState === "voided") {
    await restoreRedeem(sql, { bookingId, snap, ...who, ip, out })
  }

  // 2) La estrella.
  try {
    if (earn && snap?.eligible !== false) {
      out.attempted = true
      const result = await creditStar({ bookingId, ...who, ip })
      if (!result?.ok) out.ok = false
      if (result?.loyalty) out.loyalty = result.loyalty
      out.earned = Boolean(result?.ok && result?.earned)
    } else if (revert) {
      out.attempted = true
      const result = await revertStar({ bookingId, ip })
      if (!result?.ok) out.ok = false
      if (result?.loyalty) out.loyalty = result.loyalty
    }
  } catch (err) {
    console.error("loyalty bridge error:", err?.message || err)
    out.attempted = true
    out.ok = false
  }
  return out
}

/* Canje explícito del corte gratis (PATCH { id, redeem: "free_cut" }).
   Orden a propósito: primero se debitan las estrellas en PimpStudio (la
   fuente de verdad, con su propio índice de idempotencia) y recién después
   se deja la reserva en $0 acá. Si el segundo paso falla, se devuelven las
   estrellas: el cliente nunca queda debitado sin premio.
   Devuelve { ok, status, error?, loyalty }. */
export async function redeemForBooking(sql, { bookingId, phone, name, ip }) {
  let result
  try {
    result = await redeemFreeCut({ bookingId, phone, name, ip })
  } catch (err) {
    console.error("loyalty redeemFreeCut error:", err?.message || err)
    result = { ok: false, status: 502 }
  }
  if (!result?.ok) {
    return {
      ok: false,
      status: result?.status >= 400 ? result.status : 502,
      error: result?.error || "No se pudo canjear el corte gratis",
      loyalty: result?.loyalty || null,
    }
  }
  try {
    let marked = false
    try {
      await ensureBookingColumns(sql)
      await sql`UPDATE bookings SET custom_price = 0, redeem_state = 'redeemed', updated_at = NOW() WHERE id = ${Number(bookingId)}`
      marked = true
    } catch (err) {
      // Sin la columna, el canje queda en la forma de antes (custom_price = 0),
      // que loyaltyForTransition también reconoce al cancelar.
      console.error("redeem_state no disponible:", err?.message || err)
    }
    if (!marked) await sql`UPDATE bookings SET custom_price = 0, updated_at = NOW() WHERE id = ${Number(bookingId)}`
  } catch (err) {
    console.error("redeem local update error:", err)
    await cancelRedeem({ bookingId, ip }).catch(() => {})
    return { ok: false, status: 500, error: "No se pudo aplicar el corte gratis. Intenta de nuevo.", loyalty: null }
  }
  return { ok: true, status: 200, loyalty: result.loyalty || null }
}

/* Lo que pasa DESPUÉS de que una atención entra a 'completada': la fila de
   reseña (barber_reviews) y el correo de gracias con el link para calificar y
   el estado de la tarjeta.

   UNA VEZ POR VISITA. La fila es la marca: INSERT … ON CONFLICT (booking_id)
   DO NOTHING RETURNING token solo devuelve el token la primera vez. Des-
   completar y volver a completar, confirmar el pago de una autocompletada, o
   que una persona la complete justo mientras el sistema la autocompleta: en
   todos, el segundo INSERT no devuelve nada y no sale un segundo correo.

   El correo sale solo si además la atención es fresca (hoy o ayer, en
   Santiago) y el cliente tiene correo. La fila se crea igual (es la marca de
   "ya se pidió reseña por esta visita"), así que cobrar mañana una atención de
   hace un mes nunca manda un gracias atrasado.

   `before` trae lo que tenga el llamador —{ status, barberId, clientId?,
   client, phone, email?, service, barber?, date, time? }—; lo que falte se lee
   de la reserva. `earned` = esta completada sumó la estrella (el bloque del
   correo dice "Sumaste 1 estrella"). Nunca lanza, y solo corre en producción
   (lifecycleEffectsEnabled). */
export async function afterCompletion(sql, { bookingId, before = null, loyalty = null, earned = false } = {}) {
  if (!lifecycleEffectsEnabled()) return
  try {
    let info = { ...(before || {}) }
    const missing = ["barberId", "clientId", "email", "client", "service", "barber", "date"]
      .some((key) => info[key] === undefined)
    if (missing) {
      const [row] = await sql`
        SELECT b.barber_id AS "barberId", b.client_id AS "clientId", b.booking_date::text AS date,
               u.name AS client, u.email, br.name AS barber,
               COALESCE(b.custom_service, s.name) AS service
        FROM bookings b
        LEFT JOIN users u ON u.id = b.client_id
        LEFT JOIN services s ON s.id = b.service_id
        LEFT JOIN barbers br ON br.id = b.barber_id
        WHERE b.id = ${Number(bookingId)}
      `
      if (!row) return
      // Lo que mandó el llamador gana (ya lo tenía resuelto); la base rellena.
      info = { ...row, ...Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined && v !== null)) }
    }
    if (!info.barberId) return

    await ensureReviewsTable(sql)
    const [review] = await sql`
      INSERT INTO barber_reviews (booking_id, barber_id, user_id, token)
      VALUES (${Number(bookingId)}, ${Number(info.barberId)}, ${info.clientId ?? null}, ${randomBytes(16).toString("hex")})
      ON CONFLICT (booking_id) DO NOTHING
      RETURNING token
    `
    if (!review?.token) return
    if (!isFreshBookingDate(info.date) || !info.email) return

    await sendVisitThanksEmail({
      to: info.email,
      name: info.client,
      service: info.service,
      barber: info.barber,
      date: info.date,
      reviewToken: review.token,
      ...(loyalty || {}),
      // "Sumaste 1 estrella" solo si hay saldo que mostrar: sin él, la tarjeta
      // del correo diría "0 de 10" justo cuando acaba de sumar.
      earned: Boolean(earned && loyalty),
    })
  } catch (err) {
    console.error("afterCompletion error:", err?.message || err)
  }
}

/* ---------------------------------------------------------------------------
   AUTOCOMPLETAR
   "Si se inició es porque vino": una atención que pasó a "en curso" y lleva
   más de AUTO_COMPLETE_MIN minutos (o lo que dura el servicio, si es más
   largo) se completa sola, con los mismos efectos que completarla a mano:
   Notion, la estrella (por loyaltyForTransition, el escritor único) y la
   reseña con su correo (afterCompletion).

   EL COBRO. El sistema NUNCA inventa un medio de pago. La autocompletada queda
   "pago por confirmar" (completed_at puesto, paid_at NULL) y aparece en Sin
   cerrar y en Caja para que alguien diga cómo se pagó (PATCH completada con el
   cobro, que no vuelve a sumar estrella ni a mandar el correo). La plata ya
   cuenta al precio que corresponde. Si ese precio es $0 (corte gratis, corte
   de la casa) no hay nada que confirmar: queda como cortesía.

   LAS PUERTAS, en este orden (las baratas primero):
     1. solo en producción (lifecycleEffectsEnabled);
     2. una vez cada THROTTLE_MS por lambda, salvo `force` (el cron);
     3. el interruptor `panel:auto_complete` de la tabla settings, que ARRANCA
        APAGADO: sin la fila, o con la tabla sin crear, no hace nada. Se
        enciende desde Ajustes (barbers ?mode=shop-settings);
     4. piso de 30 días: una "en curso" olvidada de hace meses no se completa
        (ni acredita una estrella) sola el día que se enciende el interruptor.
        Esas se cierran a mano desde Sin cerrar.

   LA CARRERA. La lista del panel y el cron pueden llamar a la vez desde
   lambdas distintas. La reserva se RECLAMA con un solo UPDATE … WHERE status =
   'en curso' … RETURNING con FOR UPDATE SKIP LOCKED: si dos lambdas la eligen,
   solo una la recibe en RETURNING, y la otra la salta sin esperar.

   LO QUE NO TOCA:
     · reservas cuyo horario AGENDADO todavía no termina (hora de la reserva +
       lo que dura, mínimo 60 min, en hora de Santiago): marcar "en curso" por
       error la de las 18:00 a las 10:00 no la completa a las 11:00;
     · reservas sin cliente o sin barbero válidos (el PATCH respondería 404 y
       no se podrían confirmar después).

   Debe ser barato: corre al principio del GET de la lista del panel, de
   "Sin cerrar" y de Caja. Sin candidatas es una consulta (el UPDATE no
   encuentra nada) sobre el índice parcial de las "en curso".

   EL TIEMPO. El cron horario de push.js lo llama DESPUÉS de los
   recordatorios, con `limit: 25`, y no puede pasarse del tiempo de la
   función. Por eso no reclama todo de una: reclama de a AUTO_COMPLETE_BATCH
   (los efectos de un tramo corren en paralelo, de a pocos para no disparar
   decenas de llamadas a Notion/Resend/PimpStudio a la vez) y, antes de
   reclamar el siguiente, mira el presupuesto total (`budgetMs`, ~8 s). Nunca
   reclama una reserva que no alcance a procesar. Si un tramo se cuelga (Notion
   y Resend no tienen timeout propio), se deja de esperar al agotarse el
   presupuesto: la reserva ya quedó completada y cobrable, y la estrella que no
   alcanzó a salir la repone el repaso de PimpStudio (bridge-completed).

   `notifyBarber` lo pasa quien llama (bookings.js su import, push.js el
   suyo): este archivo no importa push.js. Devuelve { completed, skipped? }
   (+ `stoppedEarly: true` si cortó por tiempo con más candidatas posibles);
   lanza si la base falla (el GET lo envuelve en su propio try/catch).
--------------------------------------------------------------------------- */
export const AUTO_COMPLETE_MIN = 60
export const AUTO_COMPLETE_FLOOR_DAYS = 30
export const AUTO_COMPLETE_SETTING = "panel:auto_complete"
export const AUTO_COMPLETE_BATCH = 4
export const AUTO_COMPLETE_BUDGET_MS = 8_000
const THROTTLE_MS = 15_000
let lastRunAt = 0

/* El interruptor. El valor es JSON en TEXT (como el resto de la tabla
   settings: barbers ?mode=shop-settings guarda el texto 'true' o 'false').
   Encendido SOLO si JSON.parse(value) === true; una fila que falta, un valor
   que no es JSON o cualquier otra cosa es apagado. */
export async function autoCompleteEnabled(sql) {
  try {
    const [row] = await sql`SELECT value FROM settings WHERE key = ${AUTO_COMPLETE_SETTING}`
    if (!row) return false
    try {
      return JSON.parse(row.value) === true
    } catch {
      return false
    }
  } catch (err) {
    if (err?.code === "42P01") return false   // tabla settings todavía sin crear
    throw err
  }
}

/* Espera `promise` a lo más `ms`. No la cancela: si se pasa, se deja de
   esperar y sigue sola. El timer no mantiene viva la lambda. */
function waitAtMost(promise, ms) {
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(0, ms))
    timer.unref?.()
  })
  return Promise.race([promise.then(() => "done"), timeout]).finally(() => clearTimeout(timer))
}

function claimDue(sql, limit) {
  return sql`
    UPDATE bookings b
    SET status = 'completada',
        updated_at = NOW(),
        completed_at = NOW(),
        auto_completed_at = NOW(),
        no_show = false,
        price_snapshot = COALESCE(b.price_snapshot, (SELECT s.price FROM services s WHERE s.id = b.service_id)),
        -- Precio 0 = cortesía: no queda nada que confirmar. A la derecha del = todo es
        -- el valor ANTERIOR de la fila, así que un cobro ya registrado manda.
        paid_amount = CASE WHEN b.paid_at IS NULL
                            AND COALESCE(b.custom_price, b.price_snapshot, (SELECT s.price FROM services s WHERE s.id = b.service_id), 0) = 0
                           THEN 0 ELSE b.paid_amount END,
        payment_method = CASE WHEN b.paid_at IS NULL
                               AND COALESCE(b.custom_price, b.price_snapshot, (SELECT s.price FROM services s WHERE s.id = b.service_id), 0) = 0
                              THEN 'cortesia' ELSE b.payment_method END,
        payment_ref = CASE WHEN b.paid_at IS NULL
                            AND COALESCE(b.custom_price, b.price_snapshot, (SELECT s.price FROM services s WHERE s.id = b.service_id), 0) = 0
                           THEN NULL ELSE b.payment_ref END,
        paid_at = CASE WHEN b.paid_at IS NULL
                        AND COALESCE(b.custom_price, b.price_snapshot, (SELECT s.price FROM services s WHERE s.id = b.service_id), 0) = 0
                       THEN NOW() ELSE b.paid_at END
    FROM users u, barbers br
    WHERE b.id IN (
        SELECT c.id
        FROM bookings c
        JOIN users cu ON cu.id = c.client_id
        JOIN barbers cb ON cb.id = c.barber_id
        LEFT JOIN services cs ON cs.id = c.service_id
        WHERE c.status = 'en curso'
          AND c.booking_date <= (NOW() AT TIME ZONE 'America/Santiago')::date
          AND c.booking_date >= (NOW() AT TIME ZONE 'America/Santiago')::date - ${AUTO_COMPLETE_FLOOR_DAYS}::int
          AND COALESCE(c.started_at, c.updated_at AT TIME ZONE 'UTC', c.created_at AT TIME ZONE 'UTC')
              + make_interval(mins => GREATEST(${AUTO_COMPLETE_MIN}::int, COALESCE(cs.duration_min, ${AUTO_COMPLETE_MIN}::int)))
              <= NOW()
          AND (c.booking_date + c.booking_time)
              + make_interval(mins => GREATEST(${AUTO_COMPLETE_MIN}::int, COALESCE(cs.duration_min, ${AUTO_COMPLETE_MIN}::int)))
              <= (NOW() AT TIME ZONE 'America/Santiago')
        ORDER BY c.id
        LIMIT ${limit}::int
        FOR UPDATE OF c SKIP LOCKED
      )
      AND b.status = 'en curso'
      AND u.id = b.client_id
      AND br.id = b.barber_id
    RETURNING b.id, b.booking_date::text AS date, b.booking_time::text AS time,
              b.barber_id AS "barberId", b.client_id AS "clientId", b.service_id AS "serviceId",
              b.notion_page_id AS "notionPageId",
              u.name AS client, u.email, u.phone, br.name AS barber,
              COALESCE(b.custom_service, (SELECT s.name FROM services s WHERE s.id = b.service_id)) AS service,
              COALESCE(b.custom_price, b.price_snapshot, (SELECT s.price FROM services s WHERE s.id = b.service_id), 0)::int AS price,
              (b.payment_method = 'cortesia' AND b.paid_at IS NOT NULL) AS cortesia,
              (b.booking_date >= (NOW() AT TIME ZONE 'America/Santiago')::date - 1) AS fresh
  `
}

/* Los efectos de completar para una fila ya reclamada. Cada uno aislado: un
   Notion caído no puede dejar sin estrella al cliente, ni un Resend caído sin
   aviso al barbero. */
async function afterAutoComplete(sql, row, notifyBarber) {
  // Mismo `before` que arma el PATCH: la reserva tal como estaba, en curso.
  const before = {
    id: row.id, status: "en curso", clientId: row.clientId, barberId: row.barberId,
    serviceId: row.serviceId, date: row.date, time: row.time,
    client: row.client, email: row.email ?? null, phone: row.phone,
    barber: row.barber, service: row.service, price: row.price,
  }
  if (row.notionPageId) {
    await updateNotionBookingStatus(row.notionPageId, COMPLETED).catch((err) => console.error("notion status update error:", err?.message || err))
  }
  const life = await loyaltyForTransition(sql, {
    bookingId: row.id, from: "en curso", to: COMPLETED, phone: row.phone, name: row.client,
  })
  await afterCompletion(sql, { bookingId: row.id, before, loyalty: life.loyalty, earned: life.earned })
  // Solo si hay algo que confirmar (una cortesía no) y es de hoy o ayer: el
  // aviso de una atención olvidada hace semanas no le sirve a nadie.
  if (!row.fresh || row.cortesia || typeof notifyBarber !== "function") return
  try {
    // "Se completó Ana" se leía como si la completada fuera Ana.
    const who = String(row.client || "").trim().split(/\s+/)[0] || "tu cliente"
    await notifyBarber(row.barberId, {
      title: "Atención completada",
      body: `La atención de ${who} se completó sola. Confirma cómo pagó.`,
      url: "/panel?tab=resumen",
      tag: `autocompletada-${row.id}`,
    })
  } catch (err) {
    console.error("autocomplete push error:", err?.message || err)
  }
}

export async function autoCompleteStarted(sql, {
  limit = 10, force = false, notifyBarber = null, budgetMs = AUTO_COMPLETE_BUDGET_MS,
} = {}) {
  if (!lifecycleEffectsEnabled()) return { completed: 0, skipped: "env" }
  const startedAt = Date.now()
  if (!force && startedAt - lastRunAt < THROTTLE_MS) return { completed: 0, skipped: "throttle" }
  lastRunAt = startedAt
  const deadline = startedAt + Math.max(0, Number(budgetMs) || 0)
  if (!(await autoCompleteEnabled(sql))) return { completed: 0, skipped: "disabled" }
  await ensureBookingColumns(sql)
  const max = Math.min(50, Math.max(1, Math.round(Number(limit) || 10)))

  let completed = 0
  while (completed < max) {
    // Sin tiempo para procesar otro tramo: no se reclama nada más. Lo que
    // quede lo toma la próxima pasada (otro GET del panel o el cron).
    if (Date.now() >= deadline) return { completed, stoppedEarly: true }
    const want = Math.min(AUTO_COMPLETE_BATCH, max - completed)
    const rows = await claimDue(sql, want)
    completed += rows.length
    if (!rows.length) break
    // Los efectos del tramo en paralelo (casi todo son llamadas a servicios
    // externos: Resend, Notion, el puente de fidelidad), y a lo más hasta el
    // fin del presupuesto.
    const effects = Promise.allSettled(rows.map((row) => afterAutoComplete(sql, row, notifyBarber)))
    const outcome = await waitAtMost(effects, deadline - Date.now())
    if (outcome === "timeout") return { completed, stoppedEarly: true }
    if (rows.length < want) break   // no había más candidatas
  }
  return { completed }
}

/* Borrar un cliente borra TODAS sus reservas (api/clients.js DELETE). Antes
   eso no tocaba la fidelidad: las completadas seguían sumando estrellas en
   PimpStudio y los cortes gratis canjeados nunca se devolvían. Cada reserva
   completada o con canje pasa por loyaltyForTransition({ purged: true }),
   en tandas chicas para no disparar decenas de llamadas a la vez.
   Hay que llamarla ANTES del DELETE. Devuelve { checked, failed }. */
export async function purgeLoyaltyForClient(sql, clientId, { ip = null } = {}) {
  const rows = await sql`
    SELECT b.id, b.status, b.service_id AS "serviceId", b.custom_price AS "customPrice",
           to_jsonb(b)->>'redeem_state' AS "redeemState",
           COALESCE((to_jsonb(s)->>'loyalty_eligible')::boolean, true) AS eligible
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    WHERE b.client_id = ${Number(clientId)}
      AND (b.status = 'completada' OR b.custom_price = 0 OR to_jsonb(b)->>'redeem_state' = 'redeemed')
  `
  let failed = 0
  for (let i = 0; i < rows.length; i += 8) {
    const batch = rows.slice(i, i + 8)
    const results = await Promise.allSettled(batch.map((row) =>
      loyaltyForTransition(sql, { bookingId: row.id, from: row.status, to: null, purged: true, row, ip })))
    failed += results.filter((r) => r.status === "rejected" || r.value?.ok === false).length
  }
  return { checked: rows.length, failed }
}
