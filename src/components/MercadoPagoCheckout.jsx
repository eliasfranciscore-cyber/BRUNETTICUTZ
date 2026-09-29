import React, { useEffect, useState } from 'react'
import { CLP } from '../data.js'
import { scrollToId } from './brunetti.jsx'
import { academyApi, checkoutApi } from '../academy/api.js'
import { r } from '../academy/routes.js'
import { ACADEMY_BRAND } from '../academy/hostConfig.js'

/* ================================================================
   Compra del curso en /cursos → Brunetti Academy.

   Antes cobraba `source:'cursos'` y el acceso era un link a Skool. Ahora
   compra el curso de la Academy ('brunetti-metodo') con el checkout de
   cursos (checkoutApi → POST /api/mp-payments {kind:'course'}): al
   confirmarse el pago, el webhook crea la cuenta y manda por correo el
   usuario y una contraseña temporal. La vuelta de Mercado Pago cae en
   /cursos/gracias (página de la Academy), no acá.

   Precio y "a la venta" salen de la base (academyApi('catalog')), no de este
   archivo: si el curso no está publicado con ventas abiertas (o la API no
   responde) no se vende — "Inscripciones abren pronto" —, y el precio que se
   muestra de referencia es el de Ajustes del panel (?settings=1), como antes.
   El que se cobra es SIEMPRE el de la base: lo fija el servidor, no este
   archivo.

   La vieja pantalla de resultado por ?status= se queda para quien vuelva de
   una preferencia antigua (compras de antes de la Academy).
   ================================================================ */

const COURSE_SLUG = 'brunetti-metodo'
const MODALITY = 'online'
// Gracias.jsx (Academy) lee esta clave para mostrar a qué correo llega el acceso.
const CHECKOUT_KEY = 'ps_academy_checkout'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const INSTAGRAM = ACADEMY_BRAND.instagram || 'brunetticutz'

const CHECKOUT_ITEMS = [
  '6 módulos · 21 lecciones en video',
  'Acceso inmediato a la Brunetti Academy',
  'Método de visagismo aplicado — lectura de rostro',
  'Sistema de fade, orden de corte y marca personal',
  'Acceso de por vida al material y a la comunidad',
]

/* Errores de tipeo frecuentes en el dominio del correo (misma lista que el
   catálogo de PimpStudio). La cuenta de la Academy se crea con ESE correo y
   ahí llega la contraseña: un "gmial" deja al alumno pagado y sin acceso. */
const DOMAIN_FIXES = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cl': 'gmail.com',
  'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com', 'gmail.comm': 'gmail.com', 'gmali.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmil.com': 'hotmail.com',
  'hotamil.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.cm': 'hotmail.com', 'homail.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.con': 'outlook.com', 'outlook.co': 'outlook.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'icloud.con': 'icloud.com', 'iclod.com': 'icloud.com', 'icoud.com': 'icloud.com', 'icloud.co': 'icloud.com',
  'live.con': 'live.com', 'live.co': 'live.com',
}

export function emailSuggestion(value) {
  const v = String(value || '').trim().toLowerCase()
  const at = v.lastIndexOf('@')
  if (at < 1) return null
  const domain = v.slice(at + 1)
  let fixed = DOMAIN_FIXES[domain]
  if (!fixed && /\.con$/.test(domain)) fixed = domain.replace(/\.con$/, '.com')
  if (!fixed || fixed === domain) return null
  return `${v.slice(0, at)}@${fixed}`
}

/* Teléfono opcional → 9 dígitos. Quita el 56 / 0056 / 0 de adelante solo
   cuando sobran (igual que el normalizador del puente con PimpStudio); con
   otro largo se devuelve tal cual y la validación de 9 dígitos lo frena. */
function phoneDigits(v) {
  const d = String(v ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('56')) return d.slice(2)
  if (d.length === 13 && d.startsWith('0056')) return d.slice(4)
  if (d.length === 10 && d.startsWith('0')) return d.slice(1)
  return d
}

/* El curso en la base. `sellable` = publicado, con ventas abiertas, con
   precio y con Mercado Pago configurado: lo mismo que exige el checkout.
   Sin API (o con la base caída) nada está a la venta. */
function useAcademyCourse() {
  const [state, setState] = useState({ status: 'loading', course: null, checkoutEnabled: false })
  useEffect(() => {
    let alive = true
    academyApi('catalog')
      .then((data) => {
        if (!alive) return
        const list = Array.isArray(data?.courses) ? data.courses : []
        setState({
          status: data?.fallback ? 'fallback' : 'ready',
          course: list.find((c) => c && c.slug === COURSE_SLUG) || null,
          checkoutEnabled: Boolean(data?.checkoutEnabled) && !data?.fallback,
        })
      })
      .catch(() => { if (alive) setState({ status: 'fallback', course: null, checkoutEnabled: false }) })
    return () => { alive = false }
  }, [])
  return state
}

const validPrice = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

export default function MercadoPagoCheckout() {
  const catalog = useAcademyCourse()
  const [form, setForm] = useState({ name: '', email: '', emailConfirm: '', phone: '', accept: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null) // null | { text, login? }
  const [redirecting, setRedirecting] = useState(false)
  const [returnStatus, setReturnStatus] = useState(null) // null | 'checking' | 'paid' | 'pending' | 'failed'
  const [settingsPrice, setSettingsPrice] = useState(9990) // respaldo: Ajustes → Precios y fechas

  const course = catalog.course
  const catalogPrice = course && course.published ? validPrice(course.priceOnline) : null
  const price = catalogPrice ?? settingsPrice
  const sellable = catalog.status === 'ready' && catalog.checkoutEnabled && Boolean(course?.salesOpen) && catalogPrice !== null

  // El precio de Ajustes solo hace falta si la base no trae uno: así no se
  // despierta otra función (y Neon) por nada.
  useEffect(() => {
    if (catalog.status === 'loading' || catalogPrice !== null) return
    let alive = true
    fetch('/api/mp-payments?settings=1')
      .then((res) => res.json())
      .then((s) => { if (alive && validPrice(Number(s?.cursosPrice))) setSettingsPrice(Number(s.cursosPrice)) })
      .catch(() => {})
    return () => { alive = false }
  }, [catalog.status, catalogPrice])

  // Vuelta de una preferencia VIEJA (source:'cursos', antes de la Academy):
  // Mercado Pago agrega status/payment_id a la URL de retorno. Las compras
  // nuevas vuelven a /cursos/gracias?ref=aca-… y no pasan por acá.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('status') || params.get('collection_status')
    const paymentId = params.get('payment_id') || params.get('collection_id')
    if (!status) return

    if (status === 'approved' && paymentId) {
      setReturnStatus('checking')
      fetch(`/api/mp-payments?status=1&payment_id=${encodeURIComponent(paymentId)}`)
        .then((res) => res.json())
        .then((data) => setReturnStatus(data.paid ? 'paid' : data.status === 'pending' ? 'pending' : 'failed'))
        .catch(() => setReturnStatus('failed'))
    } else {
      setReturnStatus(status === 'pending' || status === 'in_process' ? 'pending' : 'failed')
    }

    // Limpia los parámetros de Mercado Pago de la URL sin recargar.
    ;['status', 'collection_status', 'payment_id', 'collection_id', 'preference_id', 'merchant_order_id', 'external_reference', 'payment_type'].forEach((k) => params.delete(k))
    const clean = window.location.pathname + (params.toString() ? `?${params}` : '') + window.location.hash
    window.history.replaceState({}, '', clean)
  }, [])

  const patch = (p) => { setForm((f) => ({ ...f, ...p })); setError(null) }
  const onChange = (e) => patch({ [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const suggestion = emailSuggestion(form.email)

  const validate = () => {
    const name = form.name.trim()
    const email = form.email.trim()
    if (!name) return 'Escribe tu nombre.'
    if (name.length > 80) return 'El nombre es muy largo.'
    if (!EMAIL_RE.test(email) || email.length > 120) return 'Revisa tu correo: ahí te llega la contraseña.'
    if (email.toLowerCase() !== form.emailConfirm.trim().toLowerCase()) return 'Los dos correos no coinciden.'
    if (form.phone.trim() && phoneDigits(form.phone).length !== 9) return 'El teléfono debe tener 9 dígitos (o déjalo vacío).'
    if (!form.accept) return 'Tienes que aceptar los términos y el aviso de privacidad.'
    return null
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    if (loading || !sellable) return
    const problem = validate()
    if (problem) { setError({ text: problem }); return }
    setLoading(true)
    setError(null)
    try {
      const email = form.email.trim()
      const phone = phoneDigits(form.phone)
      const out = await checkoutApi({
        kind: 'course',
        courseSlug: COURSE_SLUG,
        modality: MODALITY,
        name: form.name.trim(),
        email,
        emailConfirm: form.emailConfirm.trim(),
        phone: phone.length === 9 ? phone : undefined,
        acceptTerms: true,
      })
      if (!out?.initPoint) throw Object.assign(new Error('No pudimos iniciar el pago.'), { status: 502 })
      // /cursos/gracias lo lee para decir a qué correo llega el acceso.
      try {
        sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify({ email, ref: out.ref }))
      } catch { /* sin storage: la página de gracias igual consulta por ref */ }
      setRedirecting(true)
      window.location.href = out.initPoint
    } catch (err) {
      setLoading(false)
      const status = err?.status
      if (status === 409 && err?.code === 'ya_tienes') {
        setError({ text: 'Ya tienes este curso con ese correo.', login: true })
      } else if (status === 503) {
        setError({ text: 'Las inscripciones abren pronto.' })
      } else if (status === 429) {
        setError({ text: 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentar.' })
      } else if (status === 0) {
        setError({ text: 'Sin conexión. Revisa tu internet e intenta de nuevo.' })
      } else {
        setError({ text: err?.message || 'No pudimos iniciar el pago. Intenta de nuevo en un momento.' })
      }
    }
  }

  /* Una sola tarjeta raíz con el MISMO className en todos los estados: el
     reveal de useBrunettiFx le agrega `is-in` a mano, y si React cambiara el
     className (como hacía la versión anterior al pasar a "Redirigiendo…")
     se lo borraría y la tarjeta quedaría en opacity 0. El modo de una
     columna va por style, que no toca las clases. */
  const single = Boolean(returnStatus) || redirecting
  const fullInfo = { borderRight: 'none', borderBottom: 'none' }

  let content
  if (redirecting || returnStatus === 'checking') {
    content = (
      <div className="checkout-widget-wrapper checkout-redirecting">
        <p>{redirecting ? 'Redirigiendo a Mercado Pago para completar tu pago...' : 'Verificando tu pago...'}</p>
      </div>
    )
  } else if (returnStatus === 'paid') {
    content = (
      <div className="checkout-info" style={fullInfo}>
        <div className="checkout-success-icon">✓</div>
        <h3 className="checkout-success-title">¡Pago completado!</h3>
        <p className="checkout-success-text">
          Tu inscripción fue confirmada. Te enviaremos un correo con tu acceso.
        </p>
        <p className="checkout-success-subtext">
          Revisa tu bandeja de entrada (y spam) en los próximos minutos.
        </p>
      </div>
    )
  } else if (returnStatus === 'pending') {
    content = (
      <div className="checkout-info" style={fullInfo}>
        <h3 className="checkout-success-title">Pago en proceso</h3>
        <p className="checkout-success-text">
          Tu pago está siendo confirmado por el medio de pago. Te avisaremos por email apenas se confirme.
        </p>
      </div>
    )
  } else if (returnStatus === 'failed') {
    content = (
      <div className="checkout-info" style={fullInfo}>
        <h3 className="checkout-success-title">El pago no se completó</h3>
        <p className="checkout-success-text">
          No alcanzamos a confirmar tu pago. Si el cargo se realizó, escríbenos; si no, puedes intentarlo de nuevo.
        </p>
        <button type="button" className="btn btn-primary checkout-cta" onClick={() => setReturnStatus(null)}>
          Volver a intentar
        </button>
      </div>
    )
  } else {
    content = (
      <>
        {/* — Info — */}
        <div className="checkout-info">
          <p className="checkout-label">Lo que recibes</p>
          <h3 className="checkout-title">Curso Brunetti · Visagismo &amp; Barbería</h3>
          <ul className="checkout-list">
            {CHECKOUT_ITEMS.map((item) => (
              <li key={item}>
                <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" /></svg>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* — Pago — */}
        <div className="checkout-pay">
          <div className="checkout-price-block">
            <span className="checkout-price-label">Precio de lanzamiento</span>
            <div className="checkout-price-row">
              <span className="checkout-amount">{CLP(price)}</span>
              <span className="checkout-currency">CLP</span>
            </div>
            <span className="checkout-price-sub">Pago único · sin cuotas · sin renovación</span>
          </div>

          {catalog.status !== 'loading' && !sellable ? (
            <div role="status" style={{ padding: '0.4rem 0' }}>
              <h4 className="checkout-success-title" style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>Inscripciones abren pronto</h4>
              <p className="checkout-success-text" style={{ fontSize: '0.88rem', marginBottom: 0 }}>
                Estamos preparando la Brunetti Academy. Síguenos en{' '}
                <a href={`https://instagram.com/${INSTAGRAM}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>@{INSTAGRAM}</a>{' '}
                para enterarte primero.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="checkout-form" noValidate>
              <div className="frow">
                <label htmlFor="mp-name">Nombre completo</label>
                <input
                  type="text"
                  id="mp-name"
                  name="name"
                  placeholder="Tu nombre y apellido"
                  autoComplete="name"
                  maxLength={80}
                  value={form.name}
                  onChange={onChange}
                  required
                />
              </div>

              <div className="frow two">
                <div className="frow">
                  <label htmlFor="mp-email">Correo</label>
                  <input
                    type="email"
                    id="mp-email"
                    name="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Ahí llega tu acceso"
                    maxLength={120}
                    value={form.email}
                    onChange={onChange}
                    required
                  />
                </div>
                <div className="frow">
                  <label htmlFor="mp-email2">Confirmar correo</label>
                  {/* Sin pegar a propósito: repetirlo a mano es lo que
                      atrapa el error de tipeo antes de pagar. */}
                  <input
                    type="email"
                    id="mp-email2"
                    name="emailConfirm"
                    inputMode="email"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Repite tu correo"
                    maxLength={120}
                    value={form.emailConfirm}
                    onChange={onChange}
                    onPaste={(e) => e.preventDefault()}
                    required
                  />
                </div>
              </div>
              {suggestion && (
                <button
                  type="button"
                  onClick={() => patch({ email: suggestion, emailConfirm: form.emailConfirm ? suggestion : form.emailConfirm })}
                  style={{ alignSelf: 'flex-start', marginTop: '-0.35rem', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--muted)', fontSize: '0.78rem', textDecoration: 'underline', textAlign: 'left' }}
                >
                  ¿Quisiste decir {suggestion}?
                </button>
              )}

              <div className="frow">
                <label htmlFor="mp-phone">Teléfono (opcional)</label>
                <input
                  type="tel"
                  id="mp-phone"
                  name="phone"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="9 1234 5678"
                  value={form.phone}
                  onChange={(e) => patch({ phone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 15) })}
                />
              </div>

              {/* El label del formulario va en mayúsculas (.checkout-form label):
                  acá se deshace, es una frase y no un rótulo. */}
              <label
                htmlFor="mp-accept"
                style={{ display: 'flex', gap: '0.55rem', alignItems: 'flex-start', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400, fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--muted)', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  id="mp-accept"
                  name="accept"
                  checked={form.accept}
                  onChange={onChange}
                  style={{ width: 18, height: 18, flex: 'none', margin: '0.1rem 0 0', padding: 0, accentColor: 'var(--gold-bright)' }}
                />
                <span>
                  Acepto los{' '}
                  <a
                    href="#terminos"
                    onClick={(e) => { e.preventDefault(); scrollToId('terminos') }}
                    style={{ color: 'inherit', textDecoration: 'underline' }}
                  >
                    términos y el aviso de privacidad
                  </a>.
                </span>
              </label>

              {error && (
                <p className="checkout-error" role="alert">
                  {error.text}{' '}
                  {/* <a> común = navegación dura (CSP propio de /cursos/(.+)). */}
                  {error.login && <a href={r.ingreso} style={{ color: 'inherit', textDecoration: 'underline' }}>Entra a la Academy</a>}
                </p>
              )}

              <button
                type="submit"
                className="btn btn-primary checkout-cta"
                disabled={loading || !sellable}
              >
                {catalog.status === 'loading' ? 'Revisando disponibilidad...' : loading ? 'Procesando...' : 'ACCEDER AL CURSO AHORA'}
              </button>
            </form>
          )}

          <div className="checkout-secure">
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2l7 4v6c0 5-3.5 9-7 10C8.5 21 5 17 5 12V6l7-4z" /></svg>
            Pago seguro con tarjeta, transferencia o billetera vía Mercado Pago
          </div>

          <div className="checkout-flow-badge">
            <span>Procesado por</span>
            <svg viewBox="0 0 110 20" width="72" height="14" aria-label="Mercado Pago">
              <text x="0" y="15" fontFamily="system-ui,sans-serif" fontSize="13" fontWeight="700" fill="currentColor">mercado pago</text>
            </svg>
          </div>

          <p className="checkout-after">
            Tras el pago te llega un correo con tu usuario y una contraseña temporal para entrar a la Brunetti Academy, con todos los módulos desbloqueados.
          </p>
        </div>
      </>
    )
  }

  return (
    <div className="checkout-card" data-reveal style={single ? { gridTemplateColumns: '1fr' } : undefined}>
      {content}
    </div>
  )
}
