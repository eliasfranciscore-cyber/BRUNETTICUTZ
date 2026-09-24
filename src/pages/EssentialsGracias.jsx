import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import SiteNav from '../components/SiteNav.jsx'
import ModuleFooter from '../components/ModuleFooter.jsx'
import { Icon } from '../components/ui.jsx'
import { CLP } from '../data.js'
import { clearCart } from '../cartStore.js'
import '../styles/essentials.css'

/* ============================================================================
   /essentials/gracias — vuelta desde Mercado Pago (Essentials).
   ----------------------------------------------------------------------------
   Mercado Pago vuelve acá con `payment_id` y `status` (o `collection_id` y
   `collection_status`) en la URL. Esos parámetros los puede escribir
   cualquiera en la barra de direcciones, así que solo dicen QUÉ pago revisar:
   si se pagó o no lo contesta el servidor (GET /api/mp-payments?status=1,
   que le pregunta a Mercado Pago). Esta página no escribe nada: el pedido lo
   marca pagado el webhook.

   Un pago puede llegar acá todavía "pending" / "in_process" (transferencia,
   algunos medios que tardan): mientras siga así se vuelve a preguntar cada
   3 s, hasta 10 veces, en vez de decirle "no se pagó" a alguien que acaba de
   pagar. Aprobado → se vacía el carrito y se muestra el comprobante con la
   foto del pedido que Essentials guardó en sessionStorage (bc_last_order)
   justo antes de irse a Mercado Pago.
   ========================================================================= */

const POLL_MS = 3000
const MAX_CHECKS = 10
const LAST_ORDER_KEY = 'bc_last_order'
const WA_SHOP = '56987483279'

// Estados de Mercado Pago (payment.status) que todavía pueden terminar en
// aprobado, y los que ya no.
const WAITING = new Set(['pending', 'in_process', 'authorized', 'in_mediation'])
const FAILED = new Set(['rejected', 'cancelled', 'refunded', 'charged_back'])

// Mercado Pago manda "null" (texto) cuando el comprador vuelve sin pagar.
function param(value) {
  const s = String(value || '').trim()
  return s && s !== 'null' && s !== 'undefined' ? s : ''
}

// Sin payment_id no hay nada que preguntarle al servidor: queda lo que dice
// la URL, que solo sirve para elegir el mensaje (nunca para confirmar). Si
// viene de Mercado Pago pero sin pago (el comprador tocó "volver al sitio",
// que llega con status=null), el pago no se completó; si no trae nada de
// Mercado Pago, no hay pago que mostrar.
const MP_KEYS = ['status', 'collection_status', 'payment_id', 'collection_id', 'preference_id', 'merchant_order_id']
function phaseFromUrl(status, fromMp) {
  if (WAITING.has(status)) return 'pending'
  if (FAILED.has(status) || status === 'failure' || fromMp) return 'failed'
  return 'missing'
}

// La foto del pedido sirve solo para el pago que la reclamó primero: si otra
// compra ya la marcó con su payment_id, este comprobante no es de ella.
function readSnapshot(paymentId) {
  try {
    const snap = JSON.parse(sessionStorage.getItem(LAST_ORDER_KEY) || 'null')
    if (!snap || !Array.isArray(snap.items)) return null
    if (snap.paymentId && snap.paymentId !== paymentId) return null
    return snap
  } catch {
    return null
  }
}

function claimSnapshot(snap, paymentId) {
  try { sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify({ ...snap, paymentId })) } catch {}
}

function helpHref(paymentId) {
  const ref = paymentId ? ` (pago N° ${paymentId})` : ''
  return `https://wa.me/${WA_SHOP}?text=${encodeURIComponent(`Hola Bruno, hice una compra en Essentials y quiero confirmar el pago${ref}.`)}`
}

const COPY = {
  checking: {
    icon: null,
    title: 'Confirmando tu pago…',
    sub: 'Estamos revisando con Mercado Pago. Toma solo unos segundos.',
  },
  waiting: {
    icon: null,
    title: 'Confirmando tu pago…',
    sub: 'Mercado Pago todavía lo está procesando. No cierres esta página ni pagues de nuevo.',
  },
  paid: {
    icon: 'check',
    kicker: 'Pago confirmado',
    title: '¡Gracias por tu compra!',
    sub: 'Tu pedido quedó confirmado. Te escribimos por WhatsApp para coordinar el retiro en el estudio o el envío.',
  },
  pending: {
    icon: 'clock',
    kicker: 'Pago en proceso',
    title: 'Tu pago sigue en proceso',
    sub: 'Algunos medios de pago tardan más en confirmarse. Apenas Mercado Pago lo apruebe, tu pedido queda listo: no hace falta pagar de nuevo.',
  },
  failed: {
    icon: 'alert',
    kicker: 'Pago no completado',
    title: 'El pago no se completó',
    sub: 'Mercado Pago no aprobó el pago, así que tu pedido no quedó confirmado ni se cobró. Tu carrito sigue como lo dejaste: puedes intentarlo de nuevo.',
  },
  unknown: {
    icon: 'info',
    kicker: 'Sin respuesta',
    title: 'No pudimos confirmar tu pago',
    sub: 'Mercado Pago no nos respondió a tiempo. Si allá te aparece aprobado, tu pedido está bien: escríbenos y lo revisamos al tiro.',
  },
  missing: {
    icon: 'cart',
    kicker: 'Essentials',
    title: 'No encontramos un pago',
    sub: 'Esta página muestra el resultado de una compra en Essentials. Si pagaste y llegaste acá sin datos, escríbenos y lo revisamos.',
  },
}

export default function EssentialsGracias() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const paymentId = param(params.get('payment_id')) || param(params.get('collection_id'))
  const urlStatus = (param(params.get('status')) || param(params.get('collection_status'))).toLowerCase()
  const fromMp = MP_KEYS.some((k) => params.has(k))

  const [phase, setPhase] = useState(() => (paymentId ? 'checking' : phaseFromUrl(urlStatus, fromMp)))
  const [checks, setChecks] = useState(0)
  const [round, setRound] = useState(0)       // "Revisar de nuevo" reinicia las 10 consultas
  const [amount, setAmount] = useState(null)  // lo que Mercado Pago dice que se pagó
  const [order, setOrder] = useState(null)    // foto del pedido (bc_last_order)
  const cleared = useRef(null)                // payment_id cuyo carrito ya se vació

  useEffect(() => {
    // Cada pago se revisa desde cero: nada del anterior (monto, foto) se
    // arrastra si la URL cambia a otro payment_id.
    setAmount(null)
    setOrder(null)
    if (!paymentId) { setPhase(phaseFromUrl(urlStatus, fromMp)); return }
    let alive = true
    let timer = null
    let n = 0
    setPhase('checking')
    setChecks(0)

    const onPaid = (data) => {
      const paidAmount = Number(data?.amount)
      if (Number.isFinite(paidAmount) && paidAmount > 0) setAmount(paidAmount)
      const snap = readSnapshot(paymentId)
      // Primera vez que este pago vuelve acá: se vacía el carrito. Si la foto
      // ya estaba reclamada por este mismo pago (recargó la página), el
      // carrito que tenga ahora es otro y no se toca.
      if (cleared.current !== paymentId && !snap?.paymentId) {
        cleared.current = paymentId
        clearCart()
      }
      if (snap) {
        claimSnapshot(snap, paymentId)
        setOrder(snap)
      }
      setPhase('paid')
    }

    const tick = async () => {
      n += 1
      setChecks(n)
      let data = null
      try {
        const res = await fetch(`/api/mp-payments?status=1&payment_id=${encodeURIComponent(paymentId)}`, { cache: 'no-store' })
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) data = await res.json()
      } catch { /* sin conexión: cuenta como un intento más */ }
      if (!alive) return

      const status = String(data?.status || '').toLowerCase()
      if (data?.paid === true || status === 'approved') { onPaid(data); return }
      if (FAILED.has(status)) { setPhase('failed'); return }
      if (n >= MAX_CHECKS) { setPhase(data ? 'pending' : 'unknown'); return }
      setPhase(data ? 'waiting' : 'checking')
      timer = setTimeout(tick, POLL_MS)
    }

    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [paymentId, urlStatus, fromMp, round])

  const copy = COPY[phase] || COPY.missing
  const busy = phase === 'checking' || phase === 'waiting'
  const retryable = Boolean(paymentId) && (phase === 'pending' || phase === 'unknown')
  const needsHelp = phase !== 'paid' && !busy
  // Si Mercado Pago cobró otro monto que el de la foto, la foto no es de este
  // pago (o cambió un precio en el camino): manda lo cobrado, sin el detalle.
  const itemsMatch = Boolean(order?.items?.length) && (amount == null || Number(order.total) === amount)
  const total = amount ?? (itemsMatch ? Number(order.total) : null)

  return (
    <div className="brunetti-site essentials-page essentials-gracias-page">
      <SiteNav />

      <main>
        <section className="essentials-hero essentials-gracias-hero">
          <div className="bwrap essentials-hero-inner" aria-live="polite" aria-busy={busy}>
            <div className={`essentials-gracias-mark is-${phase}`} aria-hidden="true">
              {busy ? <span className="essentials-gracias-spinner" /> : <Icon name={copy.icon} size={26} stroke={2.2} />}
            </div>
            {copy.kicker && <span className="bhero-kicker"><span className="dot" /> {copy.kicker}</span>}
            <h1 className="essentials-hero-title">{copy.title}</h1>
            <p className="essentials-hero-sub">{copy.sub}</p>
            {phase === 'waiting' && (
              <p className="essentials-gracias-progress">Revisión {checks} de {MAX_CHECKS}</p>
            )}
          </div>
        </section>

        <section className="bsection essentials-section essentials-gracias-body">
          <div className="bwrap">
            {phase === 'paid' && (itemsMatch || total != null) && (
              <div className="essentials-receipt">
                <div className="essentials-receipt-head">
                  <span className="essentials-receipt-h">Tu pedido</span>
                  {paymentId && <span className="essentials-receipt-ref">N° {paymentId}</span>}
                </div>
                {itemsMatch && order.items.map((item) => (
                  <div className="essentials-receipt-row" key={item.productId ?? item.name}>
                    <span>{item.qty}× {item.name}</span>
                    <b>{CLP(Number(item.price) * Number(item.qty))}</b>
                  </div>
                ))}
                {total != null && (
                  <div className="essentials-receipt-row is-total">
                    <span>{amount != null ? 'Total pagado' : 'Total'}</span><b>{CLP(total)}</b>
                  </div>
                )}
                {(order?.name || order?.email) && (
                  <p className="essentials-receipt-who">
                    A nombre de {order.name || 'ti'}{order.email ? ` · ${order.email}` : ''}
                  </p>
                )}
              </div>
            )}

            <div className="essentials-gracias-actions">
              {retryable && (
                <button type="button" className="btn btn-gold" onClick={() => setRound((r) => r + 1)}>
                  <Icon name="refresh" size={15} /> Revisar de nuevo
                </button>
              )}
              {!busy && (
                <Link className={`btn ${phase === 'paid' || phase === 'failed' || phase === 'missing' ? 'btn-gold' : 'btn-ghost'}`} to="/essentials">
                  <Icon name="cart" size={15} /> Volver a la tienda
                </Link>
              )}
              {needsHelp && (
                <a className="btn btn-ghost" href={helpHref(paymentId)} target="_blank" rel="noopener noreferrer">
                  <Icon name="whatsapp" size={15} /> Escríbenos por WhatsApp
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      <ModuleFooter
        logoSrc="/assets/brunetti-hero-wordmark.webp"
        links={[[() => navigate('/essentials'), 'Essentials']]}
      />
    </div>
  )
}
