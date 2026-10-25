import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import SiteNav from '../components/SiteNav.jsx'
import ModuleFooter from '../components/ModuleFooter.jsx'
import WhatsAppFab from '../components/WhatsAppFab.jsx'
import { Icon } from '../components/ui.jsx'
import { Sparkles } from '../components/ui/sparkles.jsx'
import { useBrunettiFx, scrollToId } from '../components/brunetti.jsx'
import { useTheme } from '../components/theme.jsx'
import { EditableText } from '../components/edit/EditableText.jsx'
import { CLP, cleanPhone, waShopHref } from '../data.js'
import { useAcademyCatalog } from '../academy/catalog.js'
import { checkoutApi } from '../academy/api.js'
import { r as academyRoutes } from '../academy/routes.js'
import { METODO_COURSE, TARGET_CUT_PRICE, FREE_LESSON, LEAD_KEY } from '../data/metodo.js'
import { track, readUtm } from '../track.js'
import C from '../data/content/metodo.json'
// La misma paleta azul de /cursos (desde 2026-10-25 el Método va con el
// estilo de Cursos, no con el dorado del resto del sitio).
import '../styles/cursos-azul.css'
import '../styles/metodo.css'

/* ================================================================
   MÉTODO BRUNETTI — página de venta (/metodo), propia de este sitio.

   /cursos es la vitrina de la Academy, compartida con pimpstudio.cl
   (src/pages/academy/Vitrina.jsx, no se edita acá). Esta página vende UN
   programa, el Método, al barbero que ya corta y cobra poco, según el
   informe "Método Brunetti: diagnóstico y pivotes" (oct-2026): hero con
   llamado, prueba bajo el titular, lección de muestra a cambio de WhatsApp
   y correo, precio a la vista (anclado) y WhatsApp a mano.

   La compra es la misma de la Academy: POST {kind:'course'} a
   /api/mp-payments (checkoutApi), Mercado Pago, y la vuelta a
   /cursos/gracias, que confirma y manda la contraseña. Precio y "a la
   venta" salen del catálogo de la base (useAcademyCatalog), nunca de acá.

   Medición (src/track.js): ViewContent al entrar, Lead al pedir la
   lección, InitiateCheckout al ir a pagar y Contact al tocar WhatsApp; la
   compra la marca public/pixel.js en /cursos/gracias.

   Estilo: el de /cursos (azul y la misma gramática del diseño "Curso
   primero" de la vitrina): héroe en dos columnas, paneles partidos por
   líneas en vez de tarjetas sueltas y la lección gratis en una franja
   azul de lado a lado. Paleta en styles/cursos-azul.css.
   ================================================================ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
// La misma clave que la vitrina: /cursos/gracias la lee para decir a qué
// correo llega el acceso.
const CHECKOUT_KEY = 'ps_academy_checkout'
const WA_TEXT = 'Hola Bruno, quiero saber del Método Brunetti'

/* Errores de tipeo frecuentes en el dominio (la cuenta de la Academy se
   crea con ESE correo: un "gmial" deja al alumno pagado y sin acceso). */
const DOMAIN_FIXES = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gmail.co': 'gmail.com', 'gmail.cl': 'gmail.com', 'gmail.con': 'gmail.com', 'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com', 'icloud.con': 'icloud.com',
}
function emailSuggestion(value) {
  const v = String(value || '').trim().toLowerCase()
  const at = v.lastIndexOf('@')
  if (at < 1) return null
  const domain = v.slice(at + 1)
  const fixed = DOMAIN_FIXES[domain] || (/\.con$/.test(domain) ? domain.replace(/\.con$/, '.com') : null)
  return fixed && fixed !== domain ? `${v.slice(0, at)}@${fixed}` : null
}

const T = ({ path, as, className, children }) => (
  <EditableText file="metodo" path={path} as={as} className={className}>{children}</EditableText>
)

function readLead() {
  try { return localStorage.getItem(LEAD_KEY) === '1' } catch { return false }
}

/* Precio del Método desde el catálogo: solo si está publicado, a la venta
   y con precio. */
function useMetodoOffer() {
  const catalog = useAcademyCatalog()
  const course = catalog.courses.find((d) => d.catalogId === METODO_COURSE || d.slug === METODO_COURSE) || null
  const price = course && course.published && course.salesOpen && Number(course.priceOnline) > 0 ? Number(course.priceOnline) : null
  return {
    loading: catalog.status === 'loading',
    slug: course?.slug || METODO_COURSE,
    price,
    sellable: Boolean(catalog.checkoutEnabled && price),
  }
}

/* Precio del Workshop (ajustes públicos de mp-payments) para el ancla. */
function useWorkshopPrice() {
  const [price, setPrice] = useState(null)
  useEffect(() => {
    let alive = true
    fetch('/api/mp-payments?settings=1')
      .then((res) => (res.headers.get('content-type')?.includes('application/json') ? res.json() : null))
      .then((d) => { if (alive && Number(d?.workshopPrice) > 0) setPrice(Number(d.workshopPrice)) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return price
}

/* "Menos que un solo corte a $20.000" / "Se paga con 3 cortes a $20.000". */
function cutsLabel(price) {
  if (!price) return null
  if (price <= TARGET_CUT_PRICE) return `Menos que un solo corte a ${CLP(TARGET_CUT_PRICE)}`
  return `Se paga con ${Math.ceil(price / TARGET_CUT_PRICE)} cortes a ${CLP(TARGET_CUT_PRICE)}`
}

export default function Metodo() {
  const rootRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()
  const { theme } = useTheme()
  const offer = useMetodoOffer()
  const workshopPrice = useWorkshopPrice()
  // El enlace del correo (?leccion=gratis) abre la lección sin pedir datos.
  const [unlocked, setUnlocked] = useState(() => readLead() || new URLSearchParams(location.search).get('leccion') === 'gratis')
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [openModule, setOpenModule] = useState(5)

  useBrunettiFx(rootRef, { parallax: false })

  useEffect(() => { track('ViewContent', { content_name: 'Método Brunetti', content_ids: [METODO_COURSE], content_type: 'product' }) }, [])

  // El enlace del correo (?leccion=gratis) baja a la lección. Un #ancla lo
  // resuelve App.jsx (RouteEffects).
  useEffect(() => {
    if (location.hash || !new URLSearchParams(location.search).get('leccion')) return undefined
    const t = setTimeout(() => scrollToId('leccion'), 350)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const proof = C.proof.items.map((it, i) => ({ ...it, i })).filter((it) => it.enabled && it.big)
  const anchorTotal = offer.price && workshopPrice ? offer.price + workshopPrice : null

  const openCheckout = () => {
    if (!offer.sellable) { scrollToId('leccion'); return }
    setCheckoutOpen(true)
  }

  return (
    <div className="brunetti-site metodo-page" ref={rootRef}>
      <SiteNav />
      <WhatsAppFab text={WA_TEXT} />

      <main>
        {/* ============ HERO ============ */}
        <section className="metodo-hero">
          <div className="bwrap metodo-hero-inner" data-reveal>
            <span className="bhero-kicker"><span className="dot" /> <T path="hero.kicker">{C.hero.kicker}</T></span>
            {/* Escritorio: llamado y titular | texto y botones (metodo.css). */}
            <div className="metodo-hero-grid">
              <div className="metodo-hero-main">
                <p className="metodo-callout"><T path="hero.callout">{C.hero.callout}</T></p>
                <T path="hero.title" as="h1" className="metodo-title">{C.hero.title}</T>
              </div>
              <div className="metodo-hero-side">
                <T path="hero.sub" as="p" className="metodo-sub">{C.hero.sub}</T>
                <div className="metodo-actions">
                  <button type="button" className="btn btn-gold" onClick={() => scrollToId('leccion')}>
                    <Icon name="play" size={15} /> <T path="hero.ctaLesson">{C.hero.ctaLesson}</T>
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => scrollToId('inscribirme')}>
                    <T path="hero.ctaEnroll">{C.hero.ctaEnroll}</T> <Icon name="arrowRight" size={15} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ---- Prueba bajo el titular ---- */}
          <div className="bwrap metodo-proof" data-reveal style={{ '--i': 1 }}>
            <div className="metodo-proof-who">
              <img src="/assets/bruno-hero.jpg" alt={C.proof.name} width="72" height="72" loading="eager" />
              <div>
                <T path="proof.name" as="b">{C.proof.name}</T>
                <T path="proof.role" as="span">{C.proof.role}</T>
              </div>
            </div>
            <ul className="metodo-proof-items" style={{ '--n': proof.length }}>
              {proof.map((it) => (
                <li key={it.id}>
                  <T path={`proof.items.${it.i}.big`} as="b">{it.big}</T>
                  <T path={`proof.items.${it.i}.text`} as="span">{it.text}</T>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div className="bru-sparkles-zone">
          {theme !== 'light' && <Sparkles className="bru-sparkles--bg" color="107, 116, 240" />}

          {/* ============ PARA QUIÉN ============ */}
          <section className="bsection metodo-fit">
            <div className="bwrap">
              <div className="bhead center" data-reveal>
                <T path="fit.kicker" as="p" className="kicker">{C.fit.kicker}</T>
                <T path="fit.title" as="h2">{C.fit.title}</T>
                <T path="fit.body" as="p">{C.fit.body}</T>
              </div>
              <div className="metodo-fit-grid">
                <article className="metodo-card" data-reveal>
                  <T path="fit.yesTitle" as="h3">{C.fit.yesTitle}</T>
                  <ul className="metodo-list">
                    {C.fit.yes.map((t, i) => (
                      <li key={i}><Icon name="check" size={15} /> <T path={`fit.yes.${i}`}>{t}</T></li>
                    ))}
                  </ul>
                </article>
                <article className="metodo-card is-muted" data-reveal style={{ '--i': 1 }}>
                  <T path="fit.noTitle" as="h3">{C.fit.noTitle}</T>
                  <ul className="metodo-list is-no">
                    {C.fit.no.map((t, i) => (
                      <li key={i}><Icon name="close" size={14} /> <T path={`fit.no.${i}`}>{t}</T></li>
                    ))}
                  </ul>
                </article>
              </div>
            </div>
          </section>

          {/* ============ LECCIÓN GRATIS ============ */}
          <section className="bsection metodo-lesson" id="leccion">
            <div className="bwrap">
              <div className="metodo-lesson-box" data-reveal>
                <div className="metodo-lesson-copy">
                  <T path="lesson.kicker" as="p" className="metodo-eyebrow">{C.lesson.kicker}</T>
                  <T path="lesson.title" as="h2">{C.lesson.title}</T>
                  <T path="lesson.body" as="p">{C.lesson.body}</T>
                </div>
                {unlocked
                  ? <LessonUnlocked />
                  : <LeadForm onDone={() => setUnlocked(true)} />}
              </div>
            </div>
          </section>

          {/* ============ MALLA ============ */}
          <section className="bsection metodo-malla" id="malla">
            <div className="bwrap">
              <div className="bhead center" data-reveal>
                <T path="malla.kicker" as="p" className="kicker">{C.malla.kicker}</T>
                <T path="malla.title" as="h2">{C.malla.title}</T>
                <T path="malla.body" as="p">{C.malla.body}</T>
              </div>
              <ol className="metodo-modules" data-reveal>
                {C.malla.modules.map((m, i) => {
                  const first = C.malla.modules.slice(0, i).reduce((n, x) => n + x.lessons.length, 0) + 1
                  const open = openModule === i
                  return (
                    <li key={i} className={`metodo-module${open ? ' is-open' : ''}`}>
                      <button type="button" className="metodo-module-head" aria-expanded={open} onClick={() => setOpenModule(open ? null : i)}>
                        <span className="metodo-module-n">Módulo {i + 1}</span>
                        <span className="metodo-module-title">
                          <T path={`malla.modules.${i}.title`} as="b">{m.title}</T>
                          <T path={`malla.modules.${i}.summary`} as="span">{m.summary}</T>
                        </span>
                        <Icon name="chevronDown" size={16} />
                      </button>
                      {open && (
                        <ul className="metodo-lessons">
                          {m.lessons.map((l, j) => {
                            const n = first + j
                            return (
                              <li key={j}>
                                <span className="metodo-lesson-n">{n}</span>
                                <T path={`malla.modules.${i}.lessons.${j}`}>{l}</T>
                                {n === FREE_LESSON.n && (
                                  <button type="button" className="metodo-free-tag" onClick={() => scrollToId('leccion')}>
                                    <Icon name="play" size={11} /> <T path="malla.freeTag">{C.malla.freeTag}</T>
                                  </button>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ol>
            </div>
          </section>

          {/* ============ PRECIO ============ */}
          <section className="bsection metodo-price" id="inscribirme">
            <div className="bwrap">
              <div className="bhead center" data-reveal>
                <T path="price.kicker" as="p" className="kicker">{C.price.kicker}</T>
                <T path="price.title" as="h2">{C.price.title}</T>
              </div>

              <div className="metodo-price-grid">
                {/* Ancla: la opción cara primero. Se arma por WhatsApp. */}
                <article className="metodo-card metodo-anchor" data-reveal>
                  <T path="price.anchorTag" as="span" className="metodo-tag">{C.price.anchorTag}</T>
                  <T path="price.anchorName" as="h3">{C.price.anchorName}</T>
                  <T path="price.anchorBody" as="p">{C.price.anchorBody}</T>
                  {anchorTotal && (
                    <div className="metodo-amount is-anchor">
                      <b>{CLP(anchorTotal)}</b>
                      <T path="price.anchorPriceNote" as="span">{C.price.anchorPriceNote}</T>
                    </div>
                  )}
                  <a
                    className="btn btn-ghost btn-block"
                    href={waShopHref(C.price.anchorWa)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => track('Contact')}
                  >
                    <Icon name="whatsapp" size={15} /> <T path="price.anchorCta">{C.price.anchorCta}</T>
                  </a>
                </article>

                <article className="metodo-card metodo-main" data-reveal style={{ '--i': 1 }}>
                  <T path="price.tag" as="span" className="metodo-tag is-gold">{C.price.tag}</T>
                  <T path="price.name" as="h3">{C.price.name}</T>
                  {offer.loading ? (
                    <p className="metodo-amount-loading">{C.price.loading}</p>
                  ) : offer.sellable ? (
                    <div className="metodo-amount">
                      <b>{CLP(offer.price)}</b>
                      <span>{cutsLabel(offer.price)}</span>
                    </div>
                  ) : (
                    <div className="metodo-soon">
                      <T path="price.soonTitle" as="b">{C.price.soonTitle}</T>
                      <T path="price.soonBody" as="span">{C.price.soonBody}</T>
                    </div>
                  )}
                  <div className="metodo-includes">
                    <T path="price.onceTitle" as="p" className="metodo-eyebrow">{C.price.onceTitle}</T>
                    <ul className="metodo-list">
                      {C.price.once.map((t, i) => <li key={i}><Icon name="check" size={15} /> <T path={`price.once.${i}`}>{t}</T></li>)}
                    </ul>
                    <T path="price.ongoingTitle" as="p" className="metodo-eyebrow">{C.price.ongoingTitle}</T>
                    <ul className="metodo-list">
                      {C.price.ongoing.map((t, i) => <li key={i}><Icon name="users" size={15} /> <T path={`price.ongoing.${i}`}>{t}</T></li>)}
                    </ul>
                  </div>
                  <button type="button" className="btn btn-gold btn-block" onClick={openCheckout} disabled={offer.loading}>
                    {offer.sellable || offer.loading
                      ? <T path="price.cta">{C.price.cta}</T>
                      : <T path="lesson.button">{C.lesson.button}</T>}
                  </button>
                  {offer.sellable && <T path="price.note" as="p" className="metodo-note">{C.price.note}</T>}
                </article>
              </div>
            </div>
          </section>

          {/* ============ PREGUNTAS ============ */}
          <section className="bsection metodo-faq">
            <div className="bwrap">
              <div className="bhead center" data-reveal>
                <T path="faq.kicker" as="p" className="kicker">{C.faq.kicker}</T>
                <T path="faq.title" as="h2">{C.faq.title}</T>
              </div>
              <div className="metodo-faq-list" data-reveal>
                {C.faq.items.map((f, i) => (
                  <details key={i} className="metodo-faq-item">
                    <summary><T path={`faq.items.${i}.q`}>{f.q}</T><Icon name="plus" size={16} /></summary>
                    <T path={`faq.items.${i}.a`} as="p">{f.a}</T>
                  </details>
                ))}
              </div>
              <p className="metodo-member">
                <T path="footer.member">{C.footer.member}</T>{' '}
                {/* Navegación dura: /cursos/… lleva su propio CSP. */}
                <a href={academyRoutes.ingreso}><T path="footer.memberCta">{C.footer.memberCta}</T></a>
              </p>
            </div>
          </section>
        </div>
      </main>

      <ModuleFooter
        logoSrc="/assets/brunetti-cursos-wordmark.webp"
        tagline="El protocolo para cobrar más por el corte — el método de Bruno «Brunetti» Herrera."
        links={[
          [() => scrollToId('leccion'), 'Lección gratis'],
          [() => scrollToId('malla'), 'Malla'],
          [() => scrollToId('inscribirme'), 'Inscripción'],
          [() => navigate('/cursos'), 'Todos los cursos'],
        ]}
        onPrimary={() => scrollToId('inscribirme')}
        primaryLabel="Inscribirme al Método"
        bottomRight="Método Brunetti · Online"
      />

      {checkoutOpen && (
        <CheckoutSheet offer={offer} onClose={() => setCheckoutOpen(false)} />
      )}
    </div>
  )
}

/* ---------------- Lección de muestra ---------------- */

function LessonUnlocked() {
  if (!FREE_LESSON.videoId) {
    return (
      <div className="metodo-lesson-done">
        <Icon name="checkCircle" size={28} />
        <T path="lesson.doneNoVideoTitle" as="h3">{C.lesson.doneNoVideoTitle}</T>
        <T path="lesson.doneNoVideoBody" as="p">{C.lesson.doneNoVideoBody}</T>
        <LessonNext />
      </div>
    )
  }
  return (
    <div className="metodo-lesson-done">
      <T path="lesson.doneTitle" as="h3">{C.lesson.doneTitle}</T>
      <div className="metodo-video">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(FREE_LESSON.videoId)}?rel=0&modestbranding=1`}
          title={`Lección ${FREE_LESSON.n}: ${FREE_LESSON.title}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
      <T path="lesson.doneBody" as="p">{C.lesson.doneBody}</T>
      <LessonNext />
    </div>
  )
}

function LessonNext() {
  return (
    <div className="metodo-lesson-next">
      <button type="button" className="btn btn-gold" onClick={() => scrollToId('inscribirme')}>
        <T path="lesson.doneEnroll">{C.lesson.doneEnroll}</T> <Icon name="arrowRight" size={15} />
      </button>
      <a className="btn btn-ghost" href={waShopHref(WA_TEXT)} target="_blank" rel="noopener noreferrer" onClick={() => track('Contact')}>
        <Icon name="whatsapp" size={15} /> <T path="lesson.doneWa">{C.lesson.doneWa}</T>
      </a>
    </div>
  )
}

function LeadForm({ onDone }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '' })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const patch = (p) => { setForm((f) => ({ ...f, ...p })); setError('') }
  const suggestion = emailSuggestion(form.email)

  const submit = async (e) => {
    e.preventDefault()
    if (sending) return
    const name = form.name.trim()
    const phone = cleanPhone(form.phone)
    const email = form.email.trim().toLowerCase()
    if (!name) return setError('Escribe tu nombre.')
    if (phone.length !== 9) return setError('Tu WhatsApp debe tener 9 dígitos (ej: 9 1234 5678).')
    if (!EMAIL_RE.test(email)) return setError('Revisa tu correo: ahí también te llega la lección.')
    setSending(true)
    try {
      const res = await fetch('/api/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // lessonEmail: el correo con el enlace a la lección solo sirve si la
        // lección ya se puede ver acá (hay videoId).
        body: JSON.stringify({ name, phone, email, source: 'metodo', level: `Lección de muestra ${FREE_LESSON.n}`, utm: readUtm(), lessonEmail: Boolean(FREE_LESSON.videoId) }),
      })
      const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null
      if (res.status === 429) throw new Error(data?.error || 'Demasiados intentos seguidos. Espera unos minutos.')
      if (!res.ok || !data?.ok) throw new Error('No pudimos guardar tus datos. Intenta de nuevo o escríbenos por WhatsApp.')
      try { localStorage.setItem(LEAD_KEY, '1') } catch { /* sin storage: se le vuelve a pedir otra vez */ }
      track('Lead', { content_name: 'Método Brunetti · lección gratis', content_ids: [METODO_COURSE] })
      onDone()
    } catch (err) {
      setError(err?.message || 'No pudimos guardar tus datos.')
      setSending(false)
    }
  }

  return (
    <form className="metodo-lead" onSubmit={submit} noValidate>
      <input className="input" placeholder="Tu nombre" autoComplete="name" maxLength={80} value={form.name} onChange={(e) => patch({ name: e.target.value })} />
      <input className="input" inputMode="tel" autoComplete="tel-national" placeholder="Tu WhatsApp (9 1234 5678)" value={form.phone} onChange={(e) => patch({ phone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 15) })} />
      <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="Tu correo" maxLength={120} value={form.email} onChange={(e) => patch({ email: e.target.value })} />
      {suggestion && (
        <button type="button" className="metodo-suggest" onClick={() => patch({ email: suggestion })}>¿Quisiste decir {suggestion}?</button>
      )}
      {error && <p className="metodo-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-gold btn-block" disabled={sending}>
        {sending ? C.lesson.sending : <><Icon name="play" size={15} /> <T path="lesson.button">{C.lesson.button}</T></>}
      </button>
      <T path="lesson.privacy" as="p" className="metodo-note">{C.lesson.privacy}</T>
    </form>
  )
}

/* ---------------- Pago (mismo checkout de la Academy) ---------------- */

function CheckoutSheet({ offer, onClose }) {
  const [buyer, setBuyer] = useState({ name: '', email: '', emailConfirm: '', phone: '', accept: false })
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState(null) // { text, login? }
  const patch = (p) => { setBuyer((b) => ({ ...b, ...p })); setError(null) }
  const suggestion = emailSuggestion(buyer.email)
  const phone = cleanPhone(buyer.phone)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !paying) onClose() }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('metodo-sheet-open')
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('metodo-sheet-open') }
  }, [paying, onClose])

  const validate = () => {
    const name = buyer.name.trim()
    const email = buyer.email.trim()
    if (!name) return 'Escribe tu nombre.'
    if (name.length > 80) return 'El nombre es muy largo.'
    if (!EMAIL_RE.test(email) || email.length > 120) return 'Revisa tu correo: ahí te llega la contraseña.'
    if (email.toLowerCase() !== buyer.emailConfirm.trim().toLowerCase()) return 'Los dos correos no coinciden.'
    if (buyer.phone.trim() && phone.length !== 9) return 'El teléfono debe tener 9 dígitos (o déjalo vacío).'
    if (!buyer.accept) return 'Tienes que aceptar los términos y el aviso de privacidad.'
    return null
  }

  const pay = async (e) => {
    e.preventDefault()
    if (paying) return
    const problem = validate()
    if (problem) { setError({ text: problem }); return }
    setPaying(true)
    setError(null)
    try {
      const email = buyer.email.trim()
      track('InitiateCheckout', { value: offer.price, currency: 'CLP', content_ids: [METODO_COURSE], content_type: 'product', num_items: 1 })
      const out = await checkoutApi({
        courseSlug: offer.slug,
        modality: 'online',
        name: buyer.name.trim(),
        email,
        emailConfirm: buyer.emailConfirm.trim(),
        phone: phone.length === 9 ? phone : undefined,
        acceptTerms: true,
      })
      if (!out?.initPoint) throw Object.assign(new Error('No pudimos iniciar el pago.'), { status: 502 })
      try {
        sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify({ email, ref: out.ref, courseId: METODO_COURSE, modality: 'online' }))
      } catch { /* sin storage: la página de gracias igual consulta por ref */ }
      window.location.href = out.initPoint
    } catch (err) {
      setPaying(false)
      const status = err?.status
      if (status === 409 && err?.code === 'ya_tienes') setError({ text: 'Ya tienes el Método con ese correo.', login: true })
      else if (status === 503) setError({ text: 'Las inscripciones abren pronto. Pide la lección gratis y te avisamos.' })
      else if (status === 429) setError({ text: 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentar.' })
      else if (status === 0) setError({ text: 'Sin conexión. Revisa tu internet e intenta de nuevo.' })
      else setError({ text: err?.message || 'No pudimos iniciar el pago. Intenta de nuevo en un momento.' })
    }
  }

  return (
    <div className="metodo-sheet-wrap" role="dialog" aria-modal="true" aria-label="Inscribirme al Método">
      <button type="button" className="metodo-sheet-scrim" aria-label="Cerrar" onClick={() => !paying && onClose()} />
      <form className="metodo-sheet" onSubmit={pay} noValidate>
        <div className="metodo-sheet-head">
          <div>
            <b>Método Brunetti</b>
            <span>{CLP(offer.price)} · pago único</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" disabled={paying}><Icon name="close" size={16} /></button>
        </div>
        <div className="metodo-sheet-body">
          <input className="input" placeholder="Tu nombre y apellido" autoComplete="name" value={buyer.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} />
          <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="Tu correo (ahí llega tu acceso)" value={buyer.email} maxLength={120} onChange={(e) => patch({ email: e.target.value })} />
          {suggestion && (
            <button type="button" className="metodo-suggest" onClick={() => patch({ email: suggestion, emailConfirm: buyer.emailConfirm ? suggestion : buyer.emailConfirm })}>¿Quisiste decir {suggestion}?</button>
          )}
          <input className="input" type="email" inputMode="email" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="Repite tu correo" value={buyer.emailConfirm} maxLength={120} onChange={(e) => patch({ emailConfirm: e.target.value })} onPaste={(e) => e.preventDefault()} />
          <input className="input" inputMode="tel" autoComplete="tel-national" placeholder="Teléfono (opcional, 9 dígitos)" value={buyer.phone} onChange={(e) => patch({ phone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 15) })} />
          <label className="metodo-accept">
            <input type="checkbox" checked={buyer.accept} onChange={(e) => patch({ accept: e.target.checked })} />
            <span>
              Acepto los <a href="/cursos#terminos" target="_blank" rel="noopener">términos y el aviso de privacidad</a> de la Academy.
            </span>
          </label>
        </div>
        <div className="metodo-sheet-foot">
          {error && (
            <p className="metodo-error" role="alert">
              {error.text}{' '}
              {error.login && <a href={academyRoutes.ingreso}>Entra a la Academy</a>}
            </p>
          )}
          <button type="submit" className="btn btn-gold btn-block" disabled={paying}>
            {paying ? 'Redirigiendo a Mercado Pago…' : `Pagar ${CLP(offer.price)} con Mercado Pago`}
          </button>
          <p className="metodo-note">Te llega un correo con tu usuario y una contraseña temporal apenas se confirme el pago.</p>
        </div>
      </form>
    </div>
  )
}
