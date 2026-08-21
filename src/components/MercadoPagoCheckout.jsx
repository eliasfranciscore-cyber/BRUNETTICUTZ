import React, { useEffect, useState } from 'react'

const CURSO_PRICE = '9990' // CLP
const CHECKOUT_ITEMS = [
  '6 módulos · 21 lecciones en video',
  'Acceso inmediato a la comunidad Brunetti en Skool',
  'Método de visagismo aplicado — lectura de rostro',
  'Sistema de fade, orden de corte y marca personal',
  'Acceso de por vida al material y actualizaciones',
]

export default function MercadoPagoCheckout() {
  const [form, setForm] = useState({ name: '', email: '', phone: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [redirecting, setRedirecting] = useState(false)
  const [returnStatus, setReturnStatus] = useState(null) // null | 'checking' | 'paid' | 'pending' | 'failed'

  // Si volvemos desde Mercado Pago, agrega status/payment_id a la URL de retorno.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('status') || params.get('collection_status')
    const paymentId = params.get('payment_id') || params.get('collection_id')
    if (!status) return

    if (status === 'approved' && paymentId) {
      setReturnStatus('checking')
      fetch(`/api/mp-payments?status=1&payment_id=${encodeURIComponent(paymentId)}`)
        .then((r) => r.json())
        .then((data) => setReturnStatus(data.paid ? 'paid' : data.status === 'pending' ? 'pending' : 'failed'))
        .catch(() => setReturnStatus('failed'))
    } else {
      setReturnStatus(status === 'pending' || status === 'in_process' ? 'pending' : 'failed')
    }

    // Limpia los parámetros de Mercado Pago de la URL sin recargar.
    ;['status', 'collection_status', 'payment_id', 'collection_id', 'preference_id', 'merchant_order_id', 'external_reference', 'payment_type'].forEach((k) => params.delete(k))
    const clean = window.location.pathname + (params.toString() ? `?${params}` : '')
    window.history.replaceState({}, '', clean)
  }, [])

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    const validPhone = form.phone.replace(/\D/g, '').length >= 8

    if (!form.name.trim() || !validEmail || !validPhone) {
      setError('Revisa todos los campos requeridos.')
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/mp-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'cursos',
          email: form.email.trim(),
          name: form.name.trim(),
          phone: form.phone,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Error al crear sesión de pago')
      }

      const data = await response.json()
      setRedirecting(true)
      window.location.href = data.checkoutUrl
    } catch (err) {
      setError(err.message || 'Error al procesar pago')
      setLoading(false)
    }
  }

  // Volviendo desde Mercado Pago: mostramos el resultado de la verificación.
  if (returnStatus) {
    if (returnStatus === 'checking') {
      return (
        <div className="checkout-card checkout-widget-mode" data-reveal>
          <div className="checkout-widget-wrapper checkout-redirecting">
            <p>Verificando tu pago...</p>
          </div>
        </div>
      )
    }
    if (returnStatus === 'paid') {
      return (
        <div className="checkout-card" data-reveal>
          <div className="checkout-info">
            <div className="checkout-success-icon">✓</div>
            <h3 className="checkout-success-title">¡Pago completado!</h3>
            <p className="checkout-success-text">
              Tu inscripción fue confirmada. Te enviaremos un email con el enlace de acceso a la comunidad Brunetti en Skool.
            </p>
            <p className="checkout-success-subtext">
              Revisa tu bandeja de entrada (y spam) en los próximos minutos.
            </p>
          </div>
        </div>
      )
    }
    if (returnStatus === 'pending') {
      return (
        <div className="checkout-card" data-reveal>
          <div className="checkout-info">
            <h3 className="checkout-success-title">Pago en proceso</h3>
            <p className="checkout-success-text">
              Tu pago está siendo confirmado por el medio de pago. Te avisaremos por email apenas se confirme.
            </p>
          </div>
        </div>
      )
    }
    return (
      <div className="checkout-card" data-reveal>
        <div className="checkout-info">
          <h3 className="checkout-success-title">El pago no se completó</h3>
          <p className="checkout-success-text">
            No alcanzamos a confirmar tu pago. Si el cargo se realizó, escríbenos; si no, puedes intentarlo de nuevo.
          </p>
          <button type="button" className="btn btn-primary checkout-cta" onClick={() => setReturnStatus(null)}>
            Volver a intentar
          </button>
        </div>
      </div>
    )
  }

  if (redirecting) {
    return (
      <div className="checkout-card checkout-widget-mode" data-reveal>
        <div className="checkout-widget-wrapper checkout-redirecting">
          <p>Redirigiendo a Mercado Pago para completar tu pago...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="checkout-card" data-reveal>
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
            <span className="checkout-amount">${CURSO_PRICE.slice(0, -3)}.{CURSO_PRICE.slice(-3)}</span>
            <span className="checkout-currency">CLP</span>
          </div>
          <span className="checkout-price-sub">Pago único · sin cuotas · sin renovación</span>
        </div>

        <form onSubmit={onSubmit} className="checkout-form">
          <div className="frow">
            <label htmlFor="mp-name">Nombre completo</label>
            <input
              type="text"
              id="mp-name"
              name="name"
              placeholder="Tu nombre"
              value={form.name}
              onChange={onChange}
              required
            />
          </div>

          <div className="frow two">
            <div className="frow">
              <label htmlFor="mp-email">Email</label>
              <input
                type="email"
                id="mp-email"
                name="email"
                placeholder="tu@email.com"
                value={form.email}
                onChange={onChange}
                required
              />
            </div>
            <div className="frow">
              <label htmlFor="mp-phone">Teléfono</label>
              <input
                type="tel"
                id="mp-phone"
                name="phone"
                placeholder="9 1234 5678"
                value={form.phone}
                onChange={onChange}
                required
              />
            </div>
          </div>

          {error && <p className="checkout-error">{error}</p>}

          <button
            type="submit"
            className="btn btn-primary checkout-cta"
            disabled={loading}
          >
            {loading ? 'Procesando...' : 'ACCEDER AL CURSO AHORA'}
          </button>
        </form>

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
          Tras el pago recibirás acceso a la comunidad Brunetti en Skool con todos los módulos desbloqueados.
        </p>
      </div>
    </div>
  )
}
