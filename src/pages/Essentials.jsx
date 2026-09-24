import React, { useEffect, useRef, useState } from 'react'
import SiteNav from '../components/SiteNav.jsx'
import ModuleFooter from '../components/ModuleFooter.jsx'
import { Icon } from '../components/ui.jsx'
import { useBrunettiFx, scrollToId } from '../components/brunetti.jsx'
import { useTheme } from '../components/theme.jsx'
import { Sparkles } from '../components/ui/sparkles.jsx'
import { InteractiveSelector } from '../components/ui/interactive-selector.jsx'
import { CLP } from '../data.js'
import { readCart, addToCart, setQty, removeFromCart, clearCart, cartCount } from '../cartStore.js'
import '../styles/essentials.css'

/* ================================================================
   ESSENTIALS — Tienda de productos para clientes (/essentials)
   Hero + grilla de productos (portada / hover / detalle en modal) +
   carrito local (localStorage) + checkout con Mercado Pago Checkout Pro.
   Comparte SiteNav + ModuleFooter con el resto del sitio.

   Los precios que se muestran son informativos: el checkout los revalida
   contra la base, así que editar el localStorage no compra nada más barato.
   Mercado Pago devuelve al comprador a /essentials/gracias
   (EssentialsGracias.jsx), que confirma el pago con el servidor y vacía el
   carrito. El manejo de ?status= que sigue acá abajo es para las
   preferencias viejas, que todavía vuelven a /essentials.
   ================================================================ */

// Foto del pedido que se guarda justo antes de irse a Mercado Pago, para que
// /essentials/gracias pueda mostrar el comprobante (qué se compró y a nombre
// de quién). sessionStorage: vive lo que la pestaña, no queda en el equipo.
const LAST_ORDER_KEY = 'bc_last_order'
const WA_SHOP = '56987483279'

// Si ya reservó alguna vez, sus datos están en localStorage (ps_user): no se
// los volvemos a pedir para pagar.
function readBuyer() {
  try {
    const u = JSON.parse(localStorage.getItem('ps_user') || 'null')
    return { name: u?.name || '', email: u?.email || '', phone: u?.phone || '' }
  } catch {
    return { name: '', email: '', phone: '' }
  }
}

// El login por teléfono deliberadamente no trae el email de vuelta (evita un
// oráculo de enumeración, ver api/auth-login.js), así que un cliente que solo
// inició sesión nunca lo tiene en ps_user. Al pagar en Essentials sí lo
// escribe él mismo: se lo guardamos para la próxima compra sin tocar nada
// más de ps_user (ni nombre ni teléfono, que ya vienen de otra parte).
function rememberEmail(email) {
  try {
    const current = JSON.parse(localStorage.getItem('ps_user') || 'null') || {}
    if (current.email === email) return
    localStorage.setItem('ps_user', JSON.stringify({ ...current, email }))
  } catch { /* localStorage bloqueado: el prefill de la próxima vez no mejora, el pago sigue igual */ }
}

export default function Essentials() {
  const rootRef = useRef(null)
  const { theme } = useTheme()
  const [products, setProducts] = useState([])
  // ¿Hay pasarela viva? Lo dice el servidor (sin MP_ACCESS_TOKEN, o con la
  // base caída y el catálogo de respaldo, viene en false): ofrecer un botón
  // que muere al tocarlo es peor que ofrecer coordinar por WhatsApp. Si la
  // respuesta no trae el dato, se asume que sí hay, como antes.
  const [checkoutEnabled, setCheckoutEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [cart, setCart] = useState(() => readCart())
  const [cartOpen, setCartOpen] = useState(false)
  const [activeProduct, setActiveProduct] = useState(null)
  const [modalQty, setModalQty] = useState(1)
  const [contact, setContact] = useState(readBuyer)
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState('')
  const [returnStatus, setReturnStatus] = useState(null) // null | 'checking' | 'paid' | 'pending' | 'failed'

  useBrunettiFx(rootRef, { parallax: false })

  useEffect(() => {
    fetch('/api/services?scope=shop')
      .then((r) => r.json())
      .then((data) => {
        setProducts(data.products || [])
        setCheckoutEnabled(data.checkoutEnabled !== false)
      })
      .catch(() => setProducts([]))
      .finally(() => setLoading(false))
  }, [])

  // Si volvemos desde Mercado Pago, lee status/payment_id de la URL de retorno.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('status') || params.get('collection_status')
    const paymentId = params.get('payment_id') || params.get('collection_id')
    if (!status) return

    if (status === 'approved' && paymentId) {
      setReturnStatus('checking')
      fetch(`/api/mp-payments?status=1&payment_id=${encodeURIComponent(paymentId)}`)
        .then((r) => r.json())
        .then((data) => {
          setReturnStatus(data.paid ? 'paid' : data.status === 'pending' ? 'pending' : 'failed')
          if (data.paid) { setCart(clearCart()); setCartOpen(false) }
        })
        .catch(() => setReturnStatus('failed'))
    } else {
      setReturnStatus(status === 'pending' || status === 'in_process' ? 'pending' : 'failed')
    }

    ;['status', 'collection_status', 'payment_id', 'collection_id', 'preference_id', 'merchant_order_id', 'external_reference', 'payment_type'].forEach((k) => params.delete(k))
    const clean = window.location.pathname + (params.toString() ? `?${params}` : '')
    window.history.replaceState({}, '', clean)
  }, [])

  const byId = new Map(products.map((p) => [p.id, p]))
  const count = cartCount(cart)
  const subtotal = cart.reduce((n, item) => {
    const p = byId.get(item.productId)
    return n + (p ? p.price * item.qty : 0)
  }, 0)

  const openProduct = (p) => { setActiveProduct(p); setModalQty(1) }
  const closeProduct = () => setActiveProduct(null)

  const confirmAdd = () => {
    if (!activeProduct) return
    setCart(addToCart(activeProduct.id, modalQty))
    setActiveProduct(null)
    setCartOpen(true)
  }

  const changeQty = (id, delta) => {
    const item = cart.find((i) => i.productId === id)
    setCart(setQty(id, (item?.qty || 0) + delta))
  }

  const setContactField = (k) => (e) => setContact((c) => ({ ...c, [k]: e.target.value }))

  // El checkout rechaza un producto que se despublicó o archivó después de
  // entrar al carrito ("ya no está disponible"), pero no dice cuál. Se vuelve
  // a pedir el catálogo y se sacan del carrito guardado los que ya no están;
  // si no, el cliente quedaría atrapado reintentando un pago que nunca pasa.
  const dropUnavailable = async () => {
    const fresh = await fetch('/api/services?scope=shop', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => (Array.isArray(data.products) ? data.products : null))
      .catch(() => null)
    if (!fresh) return false
    setProducts(fresh)
    const alive = new Set(fresh.map((p) => p.id))
    const stale = readCart().filter((i) => !alive.has(i.productId))
    let next = readCart()
    for (const item of stale) next = removeFromCart(item.productId)
    setCart(next)
    return stale.length > 0
  }

  const checkout = async () => {
    setPayError('')
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())
    const validPhone = contact.phone.replace(/\D/g, '').length >= 8
    if (!contact.name.trim() || !validEmail || !validPhone) {
      setPayError('Completa nombre, email y teléfono para pagar.')
      return
    }

    setPayLoading(true)
    try {
      const response = await fetch('/api/mp-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'essentials',
          name: contact.name.trim(),
          email: contact.email.trim(),
          phone: contact.phone,
          items: cart.map((i) => ({ productId: i.productId, qty: i.qty })),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (/ya no está disponible/i.test(data.error || '')) {
          const dropped = await dropUnavailable()
          throw new Error(dropped
            ? 'Sacamos de tu carrito lo que ya no está disponible. Revisa tu pedido y vuelve a pagar.'
            : 'Uno de los productos ya no está disponible. Quítalo del carrito y vuelve a intentarlo.')
        }
        throw new Error(data.error || 'Error al crear sesión de pago')
      }
      const data = await response.json()
      if (!data.checkoutUrl) throw new Error('No pudimos iniciar el pago. Intenta de nuevo en un momento.')
      // Checkout iniciado con éxito: guarda el correo para precargarlo la
      // próxima vez (Q22). No espera al webhook de Mercado Pago porque el
      // navegador nunca se entera de si ese pago se aprobó.
      rememberEmail(contact.email.trim())
      // El carrito NO se vacía acá: se vacía en /essentials/gracias cuando el
      // pago aparece aprobado. Si alguien se arrepiente en Mercado Pago y
      // vuelve atrás, su carrito tiene que seguir ahí.
      try {
        const items = cart
          .map((i) => { const p = byId.get(i.productId); return p ? { productId: p.id, name: p.name, qty: i.qty, price: p.price } : null })
          .filter(Boolean)
        sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify({
          items,
          total: items.reduce((n, i) => n + i.price * i.qty, 0),
          name: contact.name.trim(),
          email: contact.email.trim(),
          at: Date.now(),
        }))
      } catch { /* sin sessionStorage el comprobante sale sin detalle; el pago sigue igual */ }
      window.location.href = data.checkoutUrl
    } catch (err) {
      setPayError(err.message || 'Error al procesar pago')
      setPayLoading(false)
    }
  }

  return (
    <div className="brunetti-site essentials-page" ref={rootRef}>
      <SiteNav />

      <button type="button" className="essentials-cart-fab" onClick={() => setCartOpen(true)} aria-label="Ver carrito">
        <Icon name="cart" size={19} />
        {count > 0 && <span className="essentials-cart-badge">{count}</span>}
      </button>

      <main>
        {/* ============ HERO ============ */}
        <section className="essentials-hero">
          <div className="bwrap essentials-hero-inner" data-reveal>
            <span className="bhero-kicker"><span className="dot" /> Selección de Bruno</span>
            <h1 className="essentials-hero-title">Essentials para el ritual en casa</h1>
            <p className="essentials-hero-sub">
              Los mismos productos que uso en el estudio. Curados uno a uno — nada de relleno, solo lo que de verdad funciona.
            </p>
          </div>
        </section>

        {returnStatus && (
          <section className="bsection" style={{ paddingTop: 0, paddingBottom: 0 }}>
            <div className="bwrap" style={{ textAlign: 'center', padding: '1.4rem 1.2rem', margin: '0 0 1rem' }}>
              {returnStatus === 'checking' && <p>Verificando tu pago...</p>}
              {returnStatus === 'paid' && (
                <>
                  <h3 style={{ margin: '0 0 0.4rem' }}>¡Pago completado!</h3>
                  <p style={{ margin: 0 }}>Tu pedido fue confirmado. Te contactaremos para coordinar el retiro o envío.</p>
                </>
              )}
              {returnStatus === 'pending' && (
                <>
                  <h3 style={{ margin: '0 0 0.4rem' }}>Pago en proceso</h3>
                  <p style={{ margin: 0 }}>Tu pago está siendo confirmado por el medio de pago. Te avisaremos apenas se confirme.</p>
                </>
              )}
              {returnStatus === 'failed' && (
                <>
                  <h3 style={{ margin: '0 0 0.4rem' }}>El pago no se completó</h3>
                  <p style={{ margin: 0 }}>No alcanzamos a confirmar tu pago. Si el cargo se realizó, escríbenos; si no, puedes intentarlo de nuevo.</p>
                </>
              )}
            </div>
          </section>
        )}

        {/* Fondo de partículas doradas, igual que Home/Cursos (hero fuera). */}
        <div className="bru-sparkles-zone">
          {/* Solo en oscuro: es un efecto pensado para fondo negro. */}
          {theme !== 'light' && <Sparkles className="bru-sparkles--bg" />}

        {/* ============ SELECTOR INTERACTIVO DE PRODUCTOS (igual que Visagismo en Home) ============ */}
        {!loading && products.length > 0 && (
          <section className="bsection" id="destacados">
            <div className="bwrap">
              <div className="bhead center" data-reveal>
                <p className="kicker">Destacados</p>
                <h2>Lo que más se lleva del estudio</h2>
                <p>Pasa el mouse o toca cualquiera para verlo de cerca.</p>
              </div>
            </div>
            <div className="bwrap">
              <InteractiveSelector
                items={products.map((p, i) => ({
                  num: String(i + 1).padStart(2, '0'),
                  image: p.imgFront,
                  title: p.name,
                  body: <>{p.description} <b className="essentials-selector-price">{CLP(p.price)}</b></>,
                  product: p,
                }))}
                onSelect={(item) => openProduct(item.product)}
              />
            </div>
          </section>
        )}

        {/* ============ GRILLA ============ */}
        <section className="bsection essentials-section" id="productos">
          <div className="bwrap">
            {loading ? (
              <div className="essentials-grid">
                {Array.from({ length: 3 }).map((_, i) => <div className="essentials-card is-skeleton" key={i} />)}
              </div>
            ) : products.length === 0 ? (
              <p className="essentials-empty">Muy pronto vuelven los productos disponibles. Escríbenos por WhatsApp si buscas algo en particular.</p>
            ) : (
              <div className="essentials-grid">
                {products.map((p, i) => {
                  const soldOut = p.stock <= 0
                  const onSale = p.oldPrice > p.price
                  return (
                    <article className="essentials-card" style={{ '--i': i }} key={p.id}>
                      <button
                        type="button"
                        className="essentials-card-media"
                        onClick={() => !soldOut && openProduct(p)}
                        aria-label={`Ver ${p.name}`}
                      >
                        <img className="essentials-img-front" src={p.imgFront} alt={p.name} loading="lazy" />
                        {p.imgBack && <img className="essentials-img-back" src={p.imgBack} alt="" aria-hidden="true" loading="lazy" />}
                        {onSale && !soldOut && <span className="essentials-badge">Oferta</span>}
                        {soldOut && <div className="essentials-soldout"><span>Agotado</span></div>}
                      </button>
                      <div className="essentials-card-body">
                        {p.brand && <span className="essentials-brand">{p.brand}</span>}
                        <h3 className="essentials-name">{p.name}</h3>
                        {p.description && <p className="essentials-desc">{p.description}</p>}
                        <div className="essentials-card-foot">
                          <div className="essentials-price-block">
                            {onSale && <span className="essentials-price-old">{CLP(p.oldPrice)}</span>}
                            <b className="essentials-price">{CLP(p.price)}</b>
                          </div>
                          <button type="button" className="btn btn-gold btn-sm" disabled={soldOut} onClick={() => openProduct(p)}>
                            <Icon name="plus" size={14} /> Agregar
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </section>
        </div>
      </main>

      <ModuleFooter
        logoSrc="/assets/brunetti-hero-wordmark.webp"
        links={[[() => scrollToId('productos'), 'Essentials']]}
      />

      {/* ============ MODAL PRODUCTO ============ */}
      {activeProduct && (
        <div className="essentials-modal-wrap" role="dialog" aria-modal="true">
          <button className="essentials-modal-scrim" aria-label="Cerrar" onClick={closeProduct} />
          <div className="essentials-modal">
            <button className="essentials-modal-close" onClick={closeProduct} aria-label="Cerrar">
              <Icon name="close" size={17} />
            </button>
            {activeProduct.imgDetail && (
              <div className="essentials-modal-media">
                <img src={activeProduct.imgDetail} alt={activeProduct.name} />
              </div>
            )}
            <div className="essentials-modal-body">
              {activeProduct.brand && <span className="essentials-brand">{activeProduct.brand}</span>}
              <h3 className="essentials-name">{activeProduct.name}</h3>
              {activeProduct.description && <p className="essentials-modal-desc">{activeProduct.description}</p>}
              <b className="essentials-price essentials-modal-price">{CLP(activeProduct.price)}</b>
              <div className="essentials-qty-row">
                <div className="essentials-stepper">
                  <button type="button" onClick={() => setModalQty((q) => Math.max(1, q - 1))} aria-label="Restar cantidad">
                    <Icon name="minus" size={14} />
                  </button>
                  <span>{modalQty}</span>
                  <button type="button" onClick={() => setModalQty((q) => q + 1)} aria-label="Sumar cantidad">
                    <Icon name="plus" size={14} />
                  </button>
                </div>
                <button type="button" className="btn btn-gold essentials-modal-add" onClick={confirmAdd}>
                  <Icon name="cart" size={15} /> Agregar al carrito
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ CART DRAWER ============ */}
      {cartOpen && (
        <div className="essentials-drawer-wrap" role="dialog" aria-modal="true">
          <button className="essentials-modal-scrim" aria-label="Cerrar" onClick={() => setCartOpen(false)} />
          <aside className="essentials-drawer">
            <div className="essentials-drawer-head">
              <h3>Tu carrito <span>· {count}</span></h3>
              <button onClick={() => setCartOpen(false)} aria-label="Cerrar carrito"><Icon name="close" size={16} /></button>
            </div>
            <div className="essentials-drawer-body">
              {cart.length === 0 ? (
                <div className="essentials-drawer-empty">
                  <Icon name="cart" size={38} />
                  <p>Tu carrito está vacío</p>
                </div>
              ) : cart.map((item) => {
                const p = byId.get(item.productId)
                if (!p) return null
                return (
                  <div className="essentials-drawer-item" key={item.productId}>
                    <img src={p.imgFront} alt="" />
                    <div className="essentials-drawer-item-info">
                      <div className="essentials-drawer-item-name">{p.name}</div>
                      {p.brand && <div className="essentials-drawer-item-brand">{p.brand}</div>}
                      <div className="essentials-drawer-item-row">
                        <div className="essentials-stepper essentials-stepper-sm">
                          <button type="button" onClick={() => changeQty(item.productId, -1)} aria-label="Restar"><Icon name="minus" size={12} /></button>
                          <span>{item.qty}</span>
                          <button type="button" onClick={() => changeQty(item.productId, 1)} aria-label="Sumar"><Icon name="plus" size={12} /></button>
                        </div>
                        <b>{CLP(p.price * item.qty)}</b>
                      </div>
                    </div>
                    <button type="button" className="essentials-drawer-item-remove" onClick={() => setCart(removeFromCart(item.productId))} aria-label="Quitar del carrito">
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
            {cart.length > 0 && (
              <div className="essentials-drawer-foot">
                <div className="essentials-drawer-subtotal"><span>Subtotal</span><b>{CLP(subtotal)}</b></div>
                {checkoutEnabled ? (
                  <>
                    <div className="essentials-drawer-contact">
                      <input type="text" placeholder="Nombre completo" autoComplete="name" value={contact.name} onChange={setContactField('name')} />
                      <input type="email" placeholder="tu@email.com" autoComplete="email" value={contact.email} onChange={setContactField('email')} />
                      <input type="tel" placeholder="Teléfono (WhatsApp)" autoComplete="tel" inputMode="tel" value={contact.phone} onChange={setContactField('phone')} />
                    </div>
                    {payError && <p className="essentials-pay-error" role="alert">{payError}</p>}
                    <button type="button" className="btn btn-gold btn-block essentials-checkout-btn" onClick={checkout} disabled={payLoading}>
                      {payLoading ? 'Redirigiendo a Mercado Pago…' : 'Pagar con Mercado Pago'}
                    </button>
                  </>
                ) : (
                  <>
                    <a
                      className="btn btn-gold btn-block essentials-checkout-btn"
                      href={`https://wa.me/${WA_SHOP}?text=${encodeURIComponent(
                        `Hola Bruno, quiero comprar en Essentials:\n${cart.map((i) => { const p = byId.get(i.productId); return p ? `· ${i.qty}× ${p.name}` : '' }).filter(Boolean).join('\n')}\nTotal: ${CLP(subtotal)}`
                      )}`}
                      target="_blank" rel="noopener noreferrer"
                    >
                      <Icon name="whatsapp" size={15} /> Coordinar por WhatsApp
                    </a>
                    <p className="essentials-drawer-note">El pago en línea vuelve pronto. Mientras tanto te lo dejamos apartado y lo pagas en el estudio.</p>
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
