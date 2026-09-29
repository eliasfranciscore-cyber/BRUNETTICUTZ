import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import { Button, InlineAlert } from '../../components/panel/index.js'
import { AuthShell } from './Ingreso.jsx'
import { checkoutStatus, ApiError } from '../../academy/api.js'
import { hasSession } from '../../academy/session.js'
import { CLP } from '../../data.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/app.css'

/* ============================================================
   <base>/gracias?ref=aca-… — vuelta desde Mercado Pago.

   El estado NO se lee de los parámetros que agrega Mercado Pago (los puede
   escribir cualquiera en la barra): se pregunta al servidor por el ref, y
   el servidor solo da la compra por pagada cuando el webhook —firmado— o
   su propia consulta a Mercado Pago la confirmó.

   Como el webhook puede tardar unos segundos, mientras siga `pendiente` se
   vuelve a preguntar cada 2,5 s, hasta 10 veces. Después se ofrece
   "Actualizar" en vez de decir "no se pagó", que sería mentirle a alguien
   que acaba de pagar. La única excepción: si Mercado Pago volvió diciendo
   que el pago fue rechazado o abandonado (collection_status), no se le pide
   que espere ni se le dice "no hace falta pagar de nuevo" — se le ofrece
   reintentar. Ese parámetro solo cambia el mensaje, nunca da acceso. El acceso (usuario + contraseña temporal) llega por
   correo: acá solo se muestra a qué correo (enmascarado).

   El botón de entrar es navegación dura: esta página puede haberse abierto
   con el CSP de otra ruta.
   ============================================================ */

const INTERVAL_MS = 2500
const MAX_TRIES = 10
const REF_RE = /^[A-Za-z0-9_-]{6,80}$/
const CHECKOUT_KEY = 'ps_academy_checkout'
// Carrito del catálogo público (si el host tiene uno: en PimpStudio lo
// maneja src/academyStore.js). Se toca directo por su clave para que esta
// página no dependa de un archivo del host; sin carrito, no hace nada.
const CART_KEY = 'ps_academy_cart'

function removeFromCart(courseId, modality) {
  const raw = localStorage.getItem(CART_KEY)
  if (!raw) return
  const items = JSON.parse(raw)
  if (!Array.isArray(items)) return
  const key = `${courseId}::${modality}`
  const next = items.filter((i) => `${i?.courseId}::${i?.modality}` !== key)
  if (next.length !== items.length) localStorage.setItem(CART_KEY, JSON.stringify(next))
}

function readCheckout() {
  try {
    const d = JSON.parse(sessionStorage.getItem(CHECKOUT_KEY) || 'null')
    return d && typeof d === 'object' ? d : null
  } catch {
    return null
  }
}

export default function Gracias() {
  const [ref] = useState(() => {
    try {
      const v = new URLSearchParams(window.location.search).get('ref') || ''
      return REF_RE.test(v) ? v : ''
    } catch {
      return ''
    }
  })
  // Pista de la URL de vuelta de Mercado Pago (la escribe cualquiera: solo
  // decide el mensaje de una orden que el servidor todavía ve pendiente).
  const [notPaidHint] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      return ['rejected', 'cancelled', 'null'].includes(q.get('collection_status') || q.get('status') || '')
    } catch {
      return false
    }
  })
  const [order, setOrder] = useState(undefined) // undefined = cargando, null = no existe
  const [error, setError] = useState(null)
  const [tries, setTries] = useState(0)
  const cleaned = useRef(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const check = useCallback(async () => {
    try {
      const d = await checkoutStatus(ref)
      if (!alive.current) return
      setError(null)
      setOrder(d || null)
      if (d?.status === 'pagada' && !cleaned.current) {
        cleaned.current = true
        // El curso ya es suyo: sacarlo del carrito del catálogo.
        const c = readCheckout()
        if (c && c.ref === ref && c.courseId && c.modality) {
          try { removeFromCart(c.courseId, c.modality) } catch { /* carrito ilegible */ }
        }
      }
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setOrder(null)
      else setError(err)
    }
  }, [ref])

  useEffect(() => {
    if (!ref) { setOrder(null); return }
    check()
  }, [ref, tries, check])

  const status = order?.status
  // Mientras siga pendiente (o la consulta falló por red), reintentar.
  useEffect(() => {
    if (!ref || tries >= MAX_TRIES) return undefined
    if (!((status === 'pendiente' && !notPaidHint) || (order === undefined && error))) return undefined
    const t = setTimeout(() => setTries((n) => n + 1), INTERVAL_MS)
    return () => clearTimeout(t)
  }, [ref, status, order, error, tries, notPaidHint])

  const waiting = tries < MAX_TRIES && (order === undefined || (status === 'pendiente' && !notPaidHint))
  const stillPending = status === 'pendiente'
  const email = order?.emailMasked || ''
  const courseTitle = order?.course?.title || ''
  const enter = () => window.location.assign(hasSession() ? r.home : r.ingreso)
  const retry = () => setTries(0)

  const footer = (
    <>
      <a className="aca-link-btn" href={r.catalog}><Icon name="arrowLeft" size={15} /> Volver al catálogo</a>
      <span className="aca-auth-foot-note">¿Algún problema con tu compra? Escríbenos por Instagram o WhatsApp y lo resolvemos.</span>
    </>
  )

  const receipt = order && courseTitle ? (
    <dl className="aca-receipt">
      <div><dt>Curso</dt><dd>{courseTitle}</dd></div>
      {order.modality && <div><dt>Modalidad</dt><dd>{order.modality === 'presencial' ? 'Presencial' : 'Online'}</dd></div>}
      {Number(order.total) > 0 && <div><dt>Total</dt><dd>{CLP(Number(order.total))}</dd></div>}
      <div><dt>Acceso</dt><dd>De por vida</dd></div>
    </dl>
  ) : null

  if (!ref || order === null) {
    return (
      <AuthShell title="No encontramos esa compra" subtitle="Si te cobraron, escríbenos con el comprobante de Mercado Pago y lo resolvemos al tiro." footer={footer}>
        <div className="aca-auth-form">
          <Button variant="primary" size="lg" block onClick={() => window.location.assign(r.catalog)}>Ir al catálogo</Button>
        </div>
      </AuthShell>
    )
  }

  if (status === 'pagada') {
    return (
      <AuthShell title="¡Compra confirmada!" subtitle={courseTitle ? `Ya tienes acceso de por vida a ${courseTitle}.` : 'Ya tienes acceso de por vida a tu curso.'} footer={footer}>
        <div className="aca-auth-form">
          <div className="aca-gracias-hero" aria-hidden="true"><Icon name="checkCircle" size={34} /></div>
          <InlineAlert tone="success" title="Revisa tu correo">
            {email ? <>Te enviamos tu usuario y una contraseña temporal a <b>{email}</b>.</> : 'Te enviamos tu usuario y una contraseña temporal por correo.'}{' '}
            Si no aparece en unos minutos, mira en Spam o Promociones.
          </InlineAlert>
          {receipt}
          <Button variant="primary" size="lg" block onClick={enter}>Entrar a la Academy</Button>
          <p className="aca-auth-text is-small">¿Ya tenías cuenta? Entra con tu contraseña de siempre: el curso nuevo ya está en tu Academy.</p>
        </div>
      </AuthShell>
    )
  }

  if (waiting) {
    return (
      <AuthShell title="Confirmando tu pago…" subtitle="Mercado Pago nos está avisando. Esto toma unos segundos, no cierres esta página." footer={footer}>
        <div className="aca-auth-form" aria-busy="true">
          <div className="aca-gracias-wait"><span className="aca-spinner is-lg" aria-hidden="true" /></div>
          {receipt}
        </div>
      </AuthShell>
    )
  }

  if (status === 'anulada') {
    return (
      <AuthShell title="El pago no se completó" subtitle="No se te cobró nada. Puedes intentarlo de nuevo desde el catálogo cuando quieras." footer={footer}>
        <div className="aca-auth-form">
          <Button variant="primary" size="lg" block onClick={() => window.location.assign(r.catalog)}>Volver al catálogo</Button>
        </div>
      </AuthShell>
    )
  }

  if (status === 'reembolsada') {
    return (
      <AuthShell title="Compra reembolsada" subtitle="Esta compra fue devuelta. Si crees que es un error, escríbenos." footer={footer}>
        <div className="aca-auth-form">{receipt}</div>
      </AuthShell>
    )
  }

  if (status === 'revision') {
    return (
      <AuthShell title="Estamos revisando tu pago" subtitle="El pago llegó, pero necesitamos confirmarlo a mano. Te escribimos apenas esté listo (normalmente el mismo día)." footer={footer}>
        <div className="aca-auth-form">{receipt}</div>
      </AuthShell>
    )
  }

  if (stillPending && notPaidHint) {
    return (
      <AuthShell title="El pago no se completó" subtitle="Mercado Pago no aprobó el pago, así que no se te cobró. Puedes intentarlo de nuevo con otro medio de pago." footer={footer}>
        <div className="aca-auth-form">
          {receipt}
          <Button variant="primary" size="lg" block onClick={() => window.location.assign(r.catalog)}>Intentar de nuevo</Button>
        </div>
      </AuthShell>
    )
  }

  // Pendiente después de los reintentos, o sin conexión.
  return (
    <AuthShell
      title={stillPending ? 'Tu pago sigue en proceso' : 'No pudimos confirmar tu compra'}
      subtitle={
        stillPending
          ? 'Apenas Mercado Pago lo confirme te llega el correo con tu acceso. No hace falta pagar de nuevo.'
          : 'Revisa tu conexión y vuelve a intentar. Si ya pagaste, tu acceso igual llega por correo.'
      }
      footer={footer}
    >
      <div className="aca-auth-form">
        {receipt}
        {email && <p className="aca-auth-text">Te avisaremos a <b>{email}</b>.</p>}
        <Button variant="primary" size="lg" block icon="refresh" onClick={retry}>Actualizar</Button>
      </div>
    </AuthShell>
  )
}
