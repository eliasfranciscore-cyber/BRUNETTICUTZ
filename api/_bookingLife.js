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

   La única escritura de afuera es la reposición del cron de PimpStudio
   (GET /api/bookings?mode=bridge-completed), con la misma llave y solo para
   sumar. creditStar() es idempotente allá por bridge_ref = "brunetti:<id>":
   un reintento no suma dos.

   Best-effort, SIEMPRE: si PimpStudio no responde, el cambio de estado (lo
   importante, ya guardado) no se revierte ni falla la respuesta. Ninguna
   función de acá lanza; cada llamada al puente tiene su propio try/catch.

   Prefijo `_`: no consume slot de función serverless. No importa push.js a
   propósito (bookings.js ya lo importa, y push.js puede necesitar este
   archivo desde el cron): así no se cierra ningún ciclo.
   ================================================================ */

import { creditStar, revertStar, redeemFreeCut, cancelRedeem } from "./_loyaltyBridge.js"
import { ensureBookingColumns } from "./_schema.js"

const COMPLETED = "completada"
const CANCELLED = "cancelada"
const REDEEM_STATES = new Set(["redeemed", "voided"])

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

   Devuelve { attempted, ok, loyalty, redeem, notice }:
     attempted  hubo al menos una llamada al puente
     ok         ninguna falló
     loyalty    el saldo que devolvió PimpStudio (o null)
     redeem     null | 'voided' | 'restored' | 'dropped'
     notice     texto para el panel cuando algo del canje no salió */
export async function loyaltyForTransition(sql, { bookingId, from, to, phone, name, ip, row = null, purged = false }) {
  const out = { attempted: false, ok: true, loyalty: null, redeem: null, notice: null }
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

/* Lo que pasa DESPUÉS de que una atención entra a 'completada' (hoy: nada).
   Punto de enganche para el correo de agradecimiento y la reseña: quien lo
   llene recibe `before` con lo que haya del llamador —{ status, barberId,
   clientId?, client, phone, email?, service, date, time? }— y tiene que
   tolerar campos ausentes. Nunca lanza. */
// eslint-disable-next-line no-unused-vars
export async function afterCompletion(sql, { bookingId, before, loyalty } = {}) {}

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
