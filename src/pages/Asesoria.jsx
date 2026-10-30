import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SiteNav from '../components/SiteNav.jsx'
import ModuleFooter from '../components/ModuleFooter.jsx'
import WhatsAppFab from '../components/WhatsAppFab.jsx'
import { Icon } from '../components/ui.jsx'
import { useBrunettiFx, scrollToId } from '../components/brunetti.jsx'
import { CLP, cleanPhone, waShopHref } from '../data.js'
import { MODALITIES, CHECKOUT_KEY } from '../imagen/vocab.js'
import { track, readUtm } from '../track.js'
import '../styles/asesoria.css'

/* ================================================================
   BRUNETTI IMAGE STUDIO — /asesoria, la página pública de la asesoría de
   imagen masculina (sección 14 del documento de Image Studio): qué es, qué
   incluye, cómo funciona, quién la realiza, un ejemplo del informe y cómo
   comprarla.

   Cada modalidad (presencial / online) trae su precio y lo que incluye de
   los ajustes del panel (GET /api/mp-payments?settings=1 → asesoria). Con el
   cobro encendido se paga con Mercado Pago (POST source:'asesoria'); con el
   cobro apagado, la tarjeta ofrece WhatsApp (venta manual, la etapa piloto
   que permite el documento). Después del pago, /asesoria/gracias abre el
   formulario de datos y fotos (/asesoria/datos?t=…).

   Estilo: el plata del informe PDF (papel perla y cromo), en
   styles/asesoria.css sobre la base de brunetti.css.
   ================================================================ */

const WA_TEXT = 'Hola Bruno, quiero saber más de la asesoría de imagen.'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const INCLUDES = [
  { icon: 'user', title: 'Diagnóstico facial y estructural', text: 'Tu tipo de rostro, las proporciones de tu cráneo y lo que eso significa para tu corte.' },
  { icon: 'scissors', title: 'Diagnóstico capilar', text: 'Tipo de pelo, grosor, densidad, condición del cuero cabelludo, frizz y volumen.' },
  { icon: 'sparkles', title: 'Cortes recomendados', text: 'Los que te favorecen —largo, volumen, textura y degradado— y los que conviene evitar, con el porqué.' },
  { icon: 'box', title: 'Productos de peinado', text: 'Qué usar, cuánto y cómo aplicarlo según tu pelo y el acabado que buscas.' },
  { icon: 'refresh', title: 'Champú, acondicionador y rutina', text: 'Tu rutina de lavado paso a paso, con la frecuencia y la técnica que te sirven.' },
  { icon: 'receipt', title: 'Informe personalizado', text: 'Todo en un PDF con tu nombre, tu plan de mantenimiento y tu próximo seguimiento.' },
]

const STEPS = [
  ['Eliges y pagas', 'Presencial en la barbería u online desde tu casa.'],
  ['Nos cuentas de ti', 'Tu objetivo, tus hábitos y, si es online, 4 fotos de tu cabeza.'],
  ['Bruno te diagnostica', 'Revisa tu información y registra tu diagnóstico de rostro, cráneo y cabello.'],
  ['Elige para ti', 'Cortes, productos y rutina: la app propone y Bruno aprueba cada recomendación.'],
  ['Recibes tu informe', 'En tu correo (y por WhatsApp si quieres), listo para llevar a cada corte.'],
]

const FAQ = [
  ['¿Tengo que ir a la barbería?', 'Solo en la modalidad presencial. La online la haces desde tu casa: respondes unas preguntas, subes 4 fotos y Bruno trabaja con eso.'],
  ['¿Qué fotos necesito?', 'De frente, ambos perfiles y desde atrás, con luz natural, sin filtros ni gorro y con el pelo como lo usas a diario. El formulario te guía.'],
  ['¿Cuánto demora el informe?', 'Bruno revisa tu información y te manda el informe por correo apenas lo termina; si tarda más de lo habitual, te avisamos por WhatsApp.'],
  ['¿La app decide por Bruno?', 'No. La tecnología organiza y propone; el diagnóstico y cada recomendación los revisa y aprueba Bruno.'],
  ['¿Me van a vender productos?', 'Te recomendamos lo que le sirve a tu pelo. Algunos se venden en la barbería; otros son solo recomendaciones y el informe lo dice claramente.'],
]

function useAsesoriaSettings() {
  const [s, setS] = useState(null)
  useEffect(() => {
    let alive = true
    fetch('/api/mp-payments?settings=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (alive) setS(json?.asesoria || {}) })
      .catch(() => { if (alive) setS({}) })
    return () => { alive = false }
  }, [])
  return s
}

export default function Asesoria() {
  const rootRef = useRef(null)
  const navigate = useNavigate()
  const settings = useAsesoriaSettings()
  const [buying, setBuying] = useState(null) // modalidad elegida para pagar
  const [openFaq, setOpenFaq] = useState(0)

  useBrunettiFx(rootRef, { parallax: false })
  useEffect(() => { track('ViewContent', { content_name: 'Asesoría de imagen', content_type: 'product' }) }, [])

  const modalities = MODALITIES.map((m) => ({ ...m, ...(settings?.[m.id] || {}) }))

  return (
    <div className="brunetti-site asesoria-page" ref={rootRef}>
      <SiteNav />
      <WhatsAppFab text={WA_TEXT} />

      <main>
        {/* ============ HERO ============ */}
        <section className="as-hero">
          <div className="bwrap as-hero-grid">
            <div className="as-hero-copy" data-reveal>
              <img className="as-wordmark" src="/assets/email/brunetti-wordmark-plata.png" alt="Brunetticutz" width="560" height="190" />
              <span className="bhero-kicker"><span className="dot" /> Brunetti Image Studio</span>
              <h1 className="as-title">Tu imagen, diseñada con criterio.</h1>
              <p className="as-sub">
                Asesoría de imagen masculina con Bruno «Brunetti» Herrera: tu diagnóstico de rostro, cráneo y cabello,
                los cortes que te favorecen, tus productos y tu rutina, en un informe hecho para ti.
              </p>
              <div className="as-actions">
                <button type="button" className="btn btn-gold" onClick={() => scrollToId('modalidades')}>
                  Reservar mi asesoría <Icon name="arrowRight" size={15} />
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => scrollToId('como-funciona')}>Cómo funciona</button>
              </div>
            </div>
            <div className="as-hero-pages" aria-hidden="true" data-reveal style={{ '--i': 1 }}>
              <img src="/assets/asesoria/informe-1.jpg" alt="" className="as-page as-page--1" loading="eager" />
              <img src="/assets/asesoria/informe-2.jpg" alt="" className="as-page as-page--2" loading="eager" />
            </div>
          </div>
        </section>

        {/* ============ QUÉ INCLUYE ============ */}
        <section className="bsection" id="incluye">
          <div className="bwrap">
            <div className="bhead center" data-reveal>
              <p className="kicker">Qué incluye</p>
              <h2>Un diagnóstico completo, no solo un corte</h2>
              <p>Todo lo que necesitas para verte bien entre visita y visita, explicado y por escrito.</p>
            </div>
            <ul className="as-includes">
              {INCLUDES.map((it, i) => (
                <li key={it.title} data-reveal style={{ '--i': i }}>
                  <span className="as-ico"><Icon name={it.icon} size={20} /></span>
                  <h3>{it.title}</h3>
                  <p>{it.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ============ CÓMO FUNCIONA ============ */}
        <section className="bsection as-band" id="como-funciona">
          <div className="bwrap">
            <div className="bhead center" data-reveal>
              <p className="kicker">Cómo funciona</p>
              <h2>Cinco pasos, de la compra a tu informe</h2>
            </div>
            <ol className="as-steps">
              {STEPS.map(([t, d], i) => (
                <li key={t} data-reveal style={{ '--i': i }}>
                  <span className="as-step-n">{String(i + 1).padStart(2, '0')}</span>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ============ QUIÉN ============ */}
        <section className="bsection" id="bruno">
          <div className="bwrap as-who" data-reveal>
            <img src="/assets/bruno-hero.jpg" alt="Bruno «Brunetti» Herrera" width="420" height="520" loading="lazy" />
            <div>
              <p className="as-k">Quién la realiza</p>
              <h2>Bruno «Brunetti» Herrera</h2>
              <p>
                Barbero y visagista. Cada asesoría la diagnostica y la aprueba él: la tecnología ordena tu información y propone
                opciones, pero el criterio profesional es de Bruno.
              </p>
            </div>
          </div>
        </section>

        {/* ============ EJEMPLO ============ */}
        <section className="bsection as-band" id="informe">
          <div className="bwrap">
            <div className="bhead center" data-reveal>
              <p className="kicker">Así es tu informe</p>
              <h2>Un documento para llevar a cada corte</h2>
              <p>Ejemplo con datos ficticios. El tuyo lleva tu nombre, tu diagnóstico y lo que Bruno eligió para ti.</p>
            </div>
            <div className="as-sample">
              {[1, 2, 3].map((n) => (
                <figure key={n} data-reveal style={{ '--i': n }}>
                  <img src={`/assets/asesoria/informe-${n}.jpg`} alt={`Página ${n} de un informe de ejemplo`} loading="lazy" width="794" height="1123" />
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* ============ MODALIDADES ============ */}
        <section className="bsection" id="modalidades">
          <div className="bwrap">
            <div className="bhead center" data-reveal>
              <p className="kicker">Modalidades</p>
              <h2>Elige cómo quieres hacerla</h2>
            </div>
            <div className="as-offers">
              {modalities.map((m, i) => (
                <article key={m.id} className={`as-offer${m.id === 'online' ? ' is-online' : ''}`} data-reveal style={{ '--i': i }}>
                  <p className="as-k">{m.id === 'online' ? 'Desde tu casa' : 'En la barbería'}</p>
                  <h3>Asesoría {m.label.toLowerCase()}</h3>
                  <p className="as-offer-price">{settings === null ? '…' : m.price ? CLP(m.price) : 'Precio por confirmar'}</p>
                  <p className="as-offer-info">{m.info || m.hint}</p>
                  {m.enabled ? (
                    <button type="button" className="btn btn-gold" onClick={() => { setBuying(m.id); track('AddToCart', { content_name: `Asesoría ${m.id}`, value: m.price, currency: 'CLP' }) }}>
                      Reservar y pagar <Icon name="arrowRight" size={15} />
                    </button>
                  ) : (
                    <a className="btn btn-ghost" href={waShopHref(`Hola Bruno, quiero la asesoría de imagen ${m.label.toLowerCase()}.`)} target="_blank" rel="noopener noreferrer"
                      onClick={() => track('Contact', { content_name: `Asesoría ${m.id}` })}>
                      <Icon name="whatsapp" size={16} /> Coordinar por WhatsApp
                    </a>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ============ PREGUNTAS ============ */}
        <section className="bsection as-band" id="preguntas">
          <div className="bwrap as-faq-wrap">
            <div className="bhead" data-reveal>
              <p className="kicker">Preguntas</p>
              <h2>Lo que nos preguntan</h2>
            </div>
            <div className="as-faq">
              {FAQ.map(([q, a], i) => (
                <div key={q} className={`as-faq-item${openFaq === i ? ' is-open' : ''}`}>
                  <button type="button" aria-expanded={openFaq === i} onClick={() => setOpenFaq(openFaq === i ? -1 : i)}>
                    {q} <Icon name={openFaq === i ? 'minus' : 'plus'} size={16} />
                  </button>
                  {openFaq === i && <p>{a}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ PRIVACIDAD ============ */}
        <section className="bsection as-privacy" id="privacidad">
          <div className="bwrap">
            <h2>Aviso de privacidad</h2>
            <p>
              Para hacer tu asesoría guardamos tus datos de contacto, lo que nos cuentas en el formulario, tus fotos y el diagnóstico.
              Los usamos <strong>solo para tu asesoría</strong> y para darte seguimiento; no los vendemos ni los compartimos.
            </p>
            <p>
              Tus fotos se guardan en almacenamiento privado (no son públicas) y solo las ve Bruno desde el panel de la barbería; nunca
              se publican sin tu permiso. Las subes únicamente si aceptas, de forma explícita, que las guardemos para tu asesoría.
            </p>
            <p>
              Puedes pedir ver tus datos o que los eliminemos —fotos e informes incluidos— escribiéndonos por{' '}
              <a href={waShopHref('Hola, quiero ver o eliminar mis datos de la asesoría de imagen.')} target="_blank" rel="noopener noreferrer">WhatsApp</a>.
              Los pagos los procesa Mercado Pago: no guardamos los datos de tu tarjeta.
            </p>
          </div>
        </section>
      </main>

      <ModuleFooter
        logoSrc="/assets/email/brunetti-wordmark-plata.png"
        tagline="Brunetti Image Studio — asesoría de imagen masculina con Bruno «Brunetti» Herrera."
        links={[
          [() => scrollToId('incluye'), 'Qué incluye'],
          [() => scrollToId('como-funciona'), 'Cómo funciona'],
          [() => scrollToId('modalidades'), 'Modalidades'],
          [() => scrollToId('privacidad'), 'Privacidad'],
          [() => navigate('/'), 'Barbería'],
        ]}
        onPrimary={() => scrollToId('modalidades')}
        primaryLabel="Reservar mi asesoría"
        bottomRight="Brunetti Image Studio"
      />

      {buying && <CheckoutSheet modality={modalities.find((m) => m.id === buying)} onClose={() => setBuying(null)} />}
    </div>
  )
}

/* ---------- Compra: datos mínimos → Mercado Pago ---------- */
function CheckoutSheet({ modality, onClose }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', accept: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const validate = () => {
    if (form.name.trim().length < 3) return 'Escribe tu nombre.'
    if (!EMAIL_RE.test(form.email.trim())) return 'Revisa tu correo: ahí te llega el enlace al formulario.'
    if (cleanPhone(form.phone).length !== 9) return 'Tu WhatsApp tiene que tener 9 dígitos.'
    if (!form.accept) return 'Tienes que aceptar el aviso de privacidad.'
    return ''
  }

  const submit = async (e) => {
    e.preventDefault()
    const v = validate()
    if (v) { setError(v); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/mp-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'asesoria', modality: modality.id, name: form.name.trim(), email: form.email.trim(), phone: cleanPhone(form.phone), utm: readUtm() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.checkoutUrl) throw new Error(data.error || 'No pudimos iniciar el pago. Intenta de nuevo.')
      try { sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify({ token: data.token, modality: modality.id, name: form.name.trim(), at: Date.now() })) } catch { /* modo privado */ }
      track('InitiateCheckout', { content_name: `Asesoría ${modality.id}`, value: modality.price, currency: 'CLP' })
      window.location.href = data.checkoutUrl
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="as-modal" role="dialog" aria-modal="true" aria-labelledby="as-modal-title" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <form className="as-modal-card" onSubmit={submit} noValidate>
        <button type="button" className="as-modal-x" aria-label="Cerrar" onClick={onClose} disabled={busy}><Icon name="close" size={18} /></button>
        <p className="as-k">Brunetti Image Studio</p>
        <h2 id="as-modal-title">Asesoría {modality.label.toLowerCase()}</h2>
        <p className="as-modal-price">{CLP(modality.price)}</p>
        <label className="as-field"><span>Nombre y apellido</span>
          <input autoComplete="name" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} />
        </label>
        <label className="as-field"><span>Correo</span>
          <input type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => set({ email: e.target.value })} maxLength={300} />
        </label>
        <label className="as-field"><span>WhatsApp</span>
          <input type="tel" inputMode="tel" autoComplete="tel" placeholder="9 1234 5678" value={form.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={15} />
        </label>
        <label className="as-check">
          <input type="checkbox" checked={form.accept} onChange={(e) => set({ accept: e.target.checked })} />
          <span>Acepto el <a href="#privacidad" onClick={onClose}>aviso de privacidad</a>.</span>
        </label>
        {error && <p className="as-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-gold as-modal-pay" disabled={busy}>
          {busy ? 'Abriendo Mercado Pago…' : <>Pagar con Mercado Pago <Icon name="arrowRight" size={15} /></>}
        </button>
        <p className="as-modal-note">Después del pago te pedimos tus datos, hábitos{modality.id === 'online' ? ' y 4 fotos' : ''}. También te llega el enlace por correo.</p>
      </form>
    </div>
  )
}
