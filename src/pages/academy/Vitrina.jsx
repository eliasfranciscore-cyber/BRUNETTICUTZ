import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../components/theme.jsx'
import { cleanPhone } from '../../data.js'
import { ACADEMY_COURSES, TRACKS, MODALITY_LABEL, ACADEMY_INSTAGRAM } from '../../academy/courses.js'
import { readCart, addToCart, removeFromCart, inCart } from '../../academy/cart.js'
import { checkoutApi } from '../../academy/api.js'
import { useAcademyCatalog } from '../../academy/catalog.js'
import { hasSession } from '../../academy/session.js'
import { isImageUrl } from '../../academy/url.js'
import { r } from '../../academy/routes.js'
import { ACADEMY_BRAND } from '../../academy/hostConfig.js'
/* Menú, pie, íconos, efectos y el chrome de compra de Essentials (FAB del
   carrito, scrim, modal y drawer) son de cada sitio: llegan del host. */
import { SiteNav, ModuleFooter, Icon, Sparkles, useSiteFx, scrollToId, LANDING } from '../../academy/hostLanding.jsx'
import '../../styles/academy/vitrina.css'

/* ================================================================
   ACADEMY — vitrina pública (<base>: /academy en PimpStudio, /cursos en
   BrunettiCutz): catálogo y compra.

   CÓDIGO COMPARTIDO (scripts/academy-sync.mjs): la Academy es UNA sola,
   con una sola base, y esta página es la misma en los dos sitios. Cada
   sitio pone solo su menú, su pie y su marca (src/academy/hostLanding.jsx
   y hostConfig.js). Un curso publicado en el panel de cualquiera de los
   dos aparece en las dos vitrinas.

   Misma gramática visual que Essentials (tarjeta → modal → carrito
   lateral), porque es el mismo gesto de compra.

   Qué cursos se muestran, sus precios y "a la venta" vienen de la
   base (modo `catalog`), no de src/academy/courses.js: ese archivo es
   la ficha de venta (textos, malla, fotos) de los cursos que un
   admin ya publicó en el panel (Academy → Cursos). Mientras no haya
   ninguno publicado —o si la API no responde— la página dice
   "Próximamente" en vez del catálogo: nunca una malla que nadie
   decidió publicar.

   SIN PRECIOS (desde 2026-09-30): la vitrina no muestra montos, ni en
   las tarjetas, ni en la ficha, ni en el carrito. El precio de la base
   sigue decidiendo si un curso se puede pagar; el monto lo ve la persona
   recién en Mercado Pago.

   Compra: un curso por pago (Mercado Pago Checkout Pro, con la cuenta
   del sitio donde se compra). El carrito sirve para elegir; se paga de a
   uno y el resto queda guardado. Al volver de Mercado Pago,
   <base>/gracias muestra el estado y el correo con la contraseña
   temporal llega solo. La cuenta sirve en los dos sitios.

   Las entradas a la Academy de miembros (<base>/ingreso,
   <base>/comunidad) son navegaciones DURAS: <base>/* tiene su propio
   CSP y un documento conserva el CSP con que cargó.
   ================================================================ */

const MODALITIES = ['presencial', 'online']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const CHECKOUT_KEY = 'ps_academy_checkout'
const itemKey = (courseId, modality) => `${courseId}::${modality}`

/* Errores de tipeo frecuentes en el dominio del correo. La cuenta de la
   Academy se crea con ESE correo y ahí llega la contraseña: un "gmial"
   deja al alumno pagado y sin acceso. */
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

/* ---------------- Catálogo: base + ficha ---------------- */

/* Curso que existe solo en la base (creado en el panel, sin ficha en
   courses.js): se arma una ficha mínima para la tarjeta y el modal, solo
   online. */
function dbOnlyCourse(d) {
  return {
    id: d.slug,
    name: d.title,
    tagline: d.subtitle || '',
    track: null,
    level: 'Online',
    image: isImageUrl(d.coverUrl) ? d.coverUrl : null,
    imageAlt: null,
    summary: d.subtitle || '',
    long: d.subtitle || '',
    outcomes: [],
    includes: ['Acceso de por vida a todas las lecciones', 'Comunidad de la Academy', 'Clases en vivo en el calendario'],
    requirements: null,
    presencial: null,
    online: { price: null, lessons: d.lessonCount || null, hours: null, access: 'de por vida' },
    malla: [],
    mallaPending: 'La malla completa, lección por lección, está dentro de la Academy.',
    dbOnly: true,
    db: d,
  }
}

/* Precio de venta: SOLO el de la base, y solo si el curso está publicado y
   con ventas abiertas. `null` = "Por definir". */
function priceOf(course, modality) {
  const d = course?.db
  if (!d || !d.published || !d.salesOpen) return null
  const v = modality === 'online' ? d.priceOnline : d.pricePresencial
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/* En vez del precio: si el curso ya se puede pagar o no. */
function EnrollTag({ open, size = 'md' }) {
  return (
    <div className={`academy-price-block is-${size}`}>
      <b className="academy-price is-pending">{open ? 'Inscripciones abiertas' : 'Inscripciones pronto'}</b>
    </div>
  )
}

function MetaChip({ icon, children }) {
  return (
    <span className="academy-chip">
      <Icon name={icon} size={13} /> {children}
    </span>
  )
}

/* "16 clases" / "21 lecciones": la ficha dice cómo se llama su unidad. */
function units(course, n) {
  const unit = course?.unit === 'lección' ? ['lección', 'lecciones'] : ['clase', 'clases']
  return `${n} ${n === 1 ? unit[0] : unit[1]}`
}

/* Lo que se publicó, para que los textos de la página digan la verdad:
   hay presencial, hay online, o el online todavía viene. */
function offerOf(courses) {
  const presencial = courses.some((c) => c.presencial)
  const online = courses.some((c) => c.online)
  return { presencial, online, onlineSoon: !online && courses.some((c) => c.onlineSoon) }
}

function heroSub(offer) {
  if (offer.presencial && offer.online) {
    return 'Formación en barbería, de los fundamentos a la atención completa de un cliente real. Presencial en el estudio, con grupos de máximo cuatro alumnos por jornada, y online, a tu ritmo y con acceso de por vida.'
  }
  if (offer.online && !offer.presencial) {
    return 'Formación en barbería online, a tu ritmo y desde donde estés: pagas una sola vez y vuelves a cada lección las veces que necesites.'
  }
  return 'Formación inicial en barbería: de los fundamentos a la atención completa de un cliente real. Presencial en el estudio, con grupos de máximo cuatro alumnos por jornada — y pronto también online.'
}

/* Datos de cabecera de una modalidad: lo que cambia entre ir a la
   barbería tres semanas y ver clases grabadas. */
function modalityMeta(course, modality) {
  if (modality === 'online') {
    const o = course.online || {}
    return [
      o.lessons ? ['grid', `${units(course, o.lessons)} grabadas`] : null,
      o.hours ? ['clock', `${o.hours} horas de video`] : null,
      ['star', 'Acceso de por vida'],
      ['spark', 'A tu ritmo, desde donde estés'],
    ].filter(Boolean)
  }
  const p = course.presencial || {}
  return [
    ['calendar', `${p.days} clases · ${p.span}`],
    ['clock', p.schedule ? `${p.hours} horas · ${p.schedule}` : `${p.hours} horas`],
    ['users', `Máximo ${p.seats} alumnos${p.shifts ? ' por jornada' : ''}`],
    p.shifts ? ['sun', p.shifts] : null,
    p.models ? ['cut', `${p.models} ${p.models === 1 ? 'modelo real' : 'modelos reales'}`] : null,
  ].filter(Boolean)
}

function goToAcademy() {
  window.location.assign(hasSession() ? r.home : r.ingreso)
}

export default function Vitrina() {
  const rootRef = useRef(null)
  const { theme } = useTheme()
  const catalog = useAcademyCatalog()
  const [modality, setModality] = useState('presencial')
  const [track, setTrack] = useState('todos')
  const [cart, setCart] = useState(() => readCart())
  const [cartOpen, setCartOpen] = useState(false)
  const [active, setActive] = useState(null)          // curso abierto en el modal
  const [modalModality, setModalModality] = useState('presencial')
  const [openDay, setOpenDay] = useState(null)        // acordeón de la malla
  const [member] = useState(() => hasSession())

  useSiteFx(rootRef, { parallax: false })

  // Ficha estática + datos de la base (por catalogId, o por slug = id).
  const allCourses = useMemo(() => {
    const byCatalog = new Map()
    const bySlug = new Map()
    for (const d of catalog.courses) {
      if (d.catalogId) byCatalog.set(d.catalogId, d)
      if (d.slug) bySlug.set(d.slug, d)
    }
    // Solo lo publicado: la ficha estática aporta textos, malla y fotos,
    // pero no decide qué sale en la web.
    const merged = ACADEMY_COURSES
      .map((c) => ({ ...c, db: byCatalog.get(c.id) || bySlug.get(c.id) || null }))
      .filter((c) => c.db?.published)
    const used = new Set(merged.map((c) => c.db.slug))
    const extra = catalog.courses.filter((d) => d.published && d.slug && !used.has(d.slug)).map(dbOnlyCourse)
    return [...merged, ...extra]
  }, [catalog.courses])

  const loading = catalog.status === 'loading'
  const comingSoon = !loading && allCourses.length === 0

  // Modalidades y líneas que de verdad tienen algún curso publicado: si solo
  // hay cursos online, el filtro no puede arrancar en "Presencial" vacío.
  const modalities = MODALITIES.filter((m) => allCourses.some((c) => (m === 'online' ? c.online : c.presencial)))
  const tracks = Object.entries(TRACKS).filter(([id]) => allCourses.some((c) => c.track === id))
  useEffect(() => {
    if (modalities.length && !modalities.includes(modality)) setModality(modalities[0])
  }, [modalities.join(','), modality]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (track !== 'todos' && !tracks.some(([id]) => id === track)) setTrack('todos')
  }, [tracks.length, track]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Lo que aparece recién cuando llega el catálogo (la franja de datos del
     héroe, el "Próximamente") no existía cuando useSiteFx buscó los
     [data-reveal] al montar: quedaba con opacidad 0 para siempre, un hueco
     vacío bajo el héroe. Se observan acá, con el mismo umbral y el mismo
     respaldo de 2,6 s. */
  useEffect(() => {
    if (loading) return undefined
    const root = rootRef.current
    if (!root) return undefined
    const nodes = Array.from(root.querySelectorAll('[data-reveal]:not(.is-in)'))
    if (!nodes.length) return undefined
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce || !('IntersectionObserver' in window)) {
      nodes.forEach((n) => n.classList.add('is-in'))
      return undefined
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) }
      })
    }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' })
    nodes.forEach((n) => io.observe(n))
    const t = setTimeout(() => nodes.forEach((n) => n.classList.add('is-in')), 2600)
    return () => { io.disconnect(); clearTimeout(t) }
  }, [loading, allCourses.length])

  const courseById = useMemo(() => new Map(allCourses.map((c) => [c.id, c])), [allCourses])

  const cohortsFor = (course) => {
    const slug = course?.db?.slug
    if (!slug) return []
    return catalog.cohorts.filter((g) => g.courseSlug === slug && g.salesOpen)
  }
  const sellable = (course, mod) => {
    if (!catalog.checkoutEnabled || !course || priceOf(course, mod) === null) return false
    if (mod === 'presencial') {
      if (!course.presencial) return false
      return cohortsFor(course).some((g) => g.seatsLeft == null || g.seatsLeft > 0)
    }
    return Boolean(course.online)
  }
  const anyForSale = allCourses.some((c) => sellable(c, 'online') || sellable(c, 'presencial'))

  const courses = useMemo(() => allCourses.filter((c) => {
    if (modality === 'presencial' && !c.presencial) return false
    if (modality === 'online' && !c.online) return false
    if (track === 'todos') return true
    return c.track === track
  }), [allCourses, modality, track])

  // Cerrar el modal con Escape, como el resto de las hojas del sitio.
  useEffect(() => {
    if (!active && !cartOpen) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (active) setActive(null)
      else setCartOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, cartOpen])

  // Deep link #curso-<id> (el botón "Comprar" de un curso bloqueado dentro de
  // la Academy apunta acá): baja a la tarjeta y abre su ficha.
  useEffect(() => {
    const m = /^#curso-([a-z0-9-]+)$/.exec(window.location.hash || '')
    if (!m) return
    const course = courseById.get(m[1])
    if (!course) return
    const mod = course.presencial ? 'presencial' : 'online'
    if (!course.presencial) setModality('online')
    setTimeout(() => {
      document.getElementById(`curso-${course.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      openCourse(course, mod)
    }, 250)
  }, [courseById]) // eslint-disable-line react-hooks/exhaustive-deps

  const openCourse = (course, mod = modality) => {
    const m = course.presencial ? mod : 'online'
    setActive(course)
    setModalModality(m)
    setOpenDay(course.malla?.[0]?.n ?? null)
  }

  const toggleCart = (courseId, mod) => {
    setCart(inCart(cart, courseId, mod) ? removeFromCart(courseId, mod) : addToCart(courseId, mod))
  }

  const count = cart.length
  const visibleCount = allCourses.length
  const offer = offerOf(allCourses)
  // Con un solo programa la franja habla de ese programa; con varios, del total.
  const one = visibleCount === 1 ? allCourses[0] : null
  const seatsMax = Math.max(0, ...allCourses.map((c) => c.presencial?.seats || 0))
  const certified = allCourses.some((c) => c.certification)
  const stats = (one
    ? [
      ['grid', one.presencial?.days || one.online?.lessons || '—', one.unit === 'lección' ? 'lecciones' : 'clases'],
      one.presencial?.hours || one.online?.hours ? ['clock', one.presencial?.hours || one.online?.hours, 'horas'] : null,
      seatsMax ? ['users', seatsMax, one.presencial?.shifts ? 'alumnos por jornada' : 'alumnos máx. por grupo'] : null,
      one.online ? ['star', 'De por vida', 'acceso online'] : null,
    ]
    : [
      ['grid', visibleCount, 'cursos'],
      ['play', allCourses.reduce((n, c) => n + (c.presencial?.days || c.online?.lessons || 0), 0), 'clases y lecciones'],
      seatsMax ? ['users', seatsMax, 'alumnos máx. por grupo'] : null,
      offer.online ? ['star', 'De por vida', 'acceso online'] : null,
    ]
  ).filter(Boolean)
  // A lo más cuatro: la franja es una fila de cuatro en escritorio.
  if (certified && stats.length < 4) stats.push(['award', 'Certificado', 'al aprobar'])

  return (
    <div className="brunetti-site academy-page" ref={rootRef}>
      <SiteNav />

      {!comingSoon && (
        <button type="button" className="essentials-cart-fab" onClick={() => setCartOpen(true)} aria-label="Ver mi selección de cursos">
          <Icon name="cart" size={19} />
          {count > 0 && <span className="essentials-cart-badge">{count}</span>}
        </button>
      )}

      <main>
        {/* ============ HERO ============ */}
        <section className="academy-hero">
          <div className="bwrap academy-hero-inner" data-reveal>
            <span className="bhero-kicker"><span className="dot" /> {ACADEMY_BRAND.name}</span>
            <h1 className="academy-hero-title">Aprende el oficio donde se practica</h1>
            <p className="academy-hero-sub">{heroSub(offer)}</p>
            {/* Con sesión de alumno en este dispositivo, la entrada va acá,
                en el flujo del héroe y bajo el texto: antes era un botón
                pegajoso (sticky) que al bajar se montaba sobre el título. */}
            {member && (
              <div className="academy-hero-actions">
                <button type="button" className="btn btn-gold" onClick={goToAcademy}>
                  Entrar a la Academy <Icon name="arrowRight" size={15} />
                </button>
              </div>
            )}
            {!loading && (
              <div className={`academy-hero-flag${comingSoon ? ' is-soon' : ''}`}>
                <Icon name="bell" size={14} />
                <span>
                  {comingSoon
                    ? <><b>Próximamente.</b> Estamos preparando los cursos: síguenos en Instagram para enterarte primero.</>
                    : anyForSale
                      ? 'Inscripciones abiertas: pagas una sola vez, con Mercado Pago.'
                      : 'Las inscripciones abren pronto. Mientras tanto revisa la malla completa, clase por clase.'}
                </span>
              </div>
            )}

            <a
              className="academy-hero-ig"
              href={`https://instagram.com/${ACADEMY_INSTAGRAM}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="instagram" size={15} /> @{ACADEMY_INSTAGRAM}
              <em>El día a día de los cursos</em>
            </a>
          </div>

          {visibleCount > 0 && (
            <div className="bwrap academy-stats" data-reveal style={{ '--n': stats.length }}>
              {stats.map(([icon, n, label]) => (
                <div className="academy-stat" key={label}>
                  <Icon name={icon} size={16} />
                  <b>{n}</b>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="bru-sparkles-zone">
          {theme !== 'light' && <Sparkles className="bru-sparkles--bg" />}

          {/* ============ MODALIDADES ============ */}
          <section className="bsection academy-modes" id="modalidades">
            <div className="bwrap">
              <div className="bhead center" data-reveal>
                <p className="kicker">Cómo se cursa</p>
                <h2>{offer.online && !allCourses.some((c) => c.presencial && c.online) ? 'Dos formas de aprender' : 'Dos formas, el mismo programa'}</h2>
              </div>
              <div className="academy-modes-grid">
                <article className="academy-mode-card" data-reveal>
                  <span className="academy-mode-tag">Presencial</span>
                  <h3>En el estudio, con tijera en mano</h3>
                  <p>
                    Grupos de máximo cuatro alumnos por jornada, diurna o vespertina, para que el educador alcance a
                    corregirte mirando por encima del hombro. Desde la clase 12 atiendes clientes reales: cortas tú, no ves cortar.
                  </p>
                  <ul>
                    <li><Icon name="check" size={13} /> Teoría, demostración, práctica guiada y corrección en cada clase</li>
                    <li><Icon name="check" size={13} /> Evaluación intermedia, simulacro cronometrado y evaluación final</li>
                    <li><Icon name="check" size={13} /> Certificado y ceremonia de titulación al aprobar</li>
                  </ul>
                </article>
                {offer.online ? (
                  <article className="academy-mode-card" data-reveal>
                    <span className="academy-mode-tag is-online">Online</span>
                    <h3>A tu ritmo, desde donde estés</h3>
                    <p>
                      Lecciones grabadas para verlas cuando quieras y repetirlas las veces que haga falta. Pagas una
                      sola vez y el acceso a ese curso es de por vida, con la comunidad de la Academy al lado.
                    </p>
                    <ul>
                      <li><Icon name="check" size={13} /> Acceso de por vida: pagas una sola vez</li>
                      <li><Icon name="check" size={13} /> Comunidad, clases en vivo y chat con otros alumnos</li>
                    </ul>
                  </article>
                ) : (
                  <article className="academy-mode-card" data-reveal>
                    <span className="academy-mode-tag is-online">Online · Próximamente</span>
                    <h3>Las mismas clases, pronto en línea</h3>
                    <p>
                      La modalidad online viene pronto: el mismo programa para verlo a tu ritmo y repetir cada clase las
                      veces que haga falta. Síguenos en Instagram para enterarte cuando abra.
                    </p>
                    <ul>
                      <li><Icon name="check" size={13} /> Acceso de por vida: pagas una sola vez</li>
                      <li><Icon name="check" size={13} /> Comunidad, clases en vivo y chat con tu generación</li>
                    </ul>
                  </article>
                )}
              </div>
            </div>
          </section>

          {/* ============ CATÁLOGO ============ */}
          <section className="bsection academy-section" id="cursos">
            <div className="bwrap">
              {comingSoon ? (
                <div className="academy-soon" data-reveal>
                  <Icon name="spark" size={26} />
                  <p className="kicker">Programas</p>
                  <h2>Próximamente</h2>
                  <p>
                    Estamos terminando de armar cada curso. Apenas se publiquen, aparecen acá con su malla completa,
                    clase por clase, y la fecha de las inscripciones.
                  </p>
                  <a
                    className="btn btn-gold"
                    href={`https://instagram.com/${ACADEMY_INSTAGRAM}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="instagram" size={15} /> Seguir a @{ACADEMY_INSTAGRAM}
                  </a>
                </div>
              ) : (
                <>
                  <div className="bhead center" data-reveal>
                    <p className="kicker">Programas</p>
                    <h2>Elige por dónde partir</h2>
                    <p>Toca cualquier curso para ver la malla completa, clase por clase.</p>
                  </div>

                  {!loading && (modalities.length > 1 || tracks.length > 1) && (
                    <div className="academy-controls" data-reveal>
                      {modalities.length > 1 && (
                        <div className="academy-toggle" role="tablist" aria-label="Modalidad">
                          {modalities.map((m) => (
                            <button
                              key={m}
                              role="tab"
                              aria-selected={modality === m}
                              className={modality === m ? 'is-on' : ''}
                              onClick={() => setModality(m)}
                            >
                              {MODALITY_LABEL[m]}
                            </button>
                          ))}
                        </div>
                      )}
                      {tracks.length > 1 && (
                        <div className="academy-filters">
                          <button className={track === 'todos' ? 'is-on' : ''} onClick={() => setTrack('todos')}>Todos</button>
                          {tracks.map(([id, t]) => (
                            <button key={id} className={track === id ? 'is-on' : ''} onClick={() => setTrack(id)}>{t.label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {!loading && courses.length === 0 && (
                    <p className="academy-grid-empty">No hay cursos {MODALITY_LABEL[modality].toLowerCase()} en esta línea por ahora.</p>
                  )}

                  <div className={`academy-grid${courses.length === 1 ? ' is-single' : ''}`} aria-busy={loading || undefined}>
                    {courses.map((course, i) => {
                      const added = inCart(cart, course.id, modality)
                      return (
                        <article className="academy-card" style={{ '--i': i }} key={course.id} id={`curso-${course.id}`}>
                          <button
                            type="button"
                            className="academy-card-media"
                            onClick={() => openCourse(course)}
                            aria-label={`Ver la malla de ${course.name}`}
                          >
                            {course.image ? (
                              <img className="academy-img-front" src={course.image} alt={course.name} loading="lazy" />
                            ) : (
                              <span className="academy-img-front" aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', background: 'var(--g-tint-strong, rgba(255,255,255,.06))' }}>
                                <Icon name="play" size={34} />
                              </span>
                            )}
                            {course.imageAlt && (
                              <img className="academy-img-back" src={course.imageAlt} alt="" aria-hidden="true" loading="lazy" />
                            )}
                            <span className="academy-level">{course.level}</span>
                            {course.featured && <span className="essentials-badge">Más pedido</span>}
                            {course.track && <span className="academy-card-track">{TRACKS[course.track]?.label}</span>}
                          </button>

                          <div className="academy-card-body">
                            <h3 className="academy-name">{course.name}</h3>
                            {course.tagline && <p className="academy-tagline">{course.tagline}</p>}
                            {course.summary && course.summary !== course.tagline && <p className="academy-desc">{course.summary}</p>}

                            <div className="academy-card-meta">
                              {modality === 'presencial' && course.presencial ? (
                                <>
                                  <MetaChip icon="calendar">{course.presencial.days} clases</MetaChip>
                                  <MetaChip icon="clock">{course.presencial.hours} h</MetaChip>
                                  <MetaChip icon="users">Máx. {course.presencial.seats}</MetaChip>
                                  {course.onlineSoon && <MetaChip icon="play">Online pronto</MetaChip>}
                                </>
                              ) : (
                                <>
                                  {course.online?.lessons ? <MetaChip icon="grid">{units(course, course.online.lessons)}</MetaChip> : null}
                                  {course.online?.hours ? <MetaChip icon="clock">{course.online.hours} h</MetaChip> : null}
                                  <MetaChip icon="star">De por vida</MetaChip>
                                </>
                              )}
                            </div>

                            <div className="academy-card-foot">
                              <EnrollTag open={sellable(course, modality)} />
                              <div className="academy-card-actions">
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openCourse(course)}>
                                  Ver malla
                                </button>
                                <button
                                  type="button"
                                  className={`btn btn-sm ${added ? 'btn-ghost is-added' : 'btn-gold'}`}
                                  onClick={() => toggleCart(course.id, modality)}
                                >
                                  <Icon name={added ? 'check' : 'plus'} size={14} /> {added ? 'Agregado' : 'Agregar'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ============ ENTRAR A LA ACADEMY ============ */}
          {/* Sin cursos publicados no hay alumnos que entren: el equipo entra
              desde el panel (o con el botón del héroe si ya tiene sesión). */}
          {!comingSoon && (
          <section className="bsection academy-cta" id="alumnos">
            <div className="bwrap academy-cta-inner" data-reveal>
              <div>
                <p className="kicker">Academy</p>
                <h2>Tus cursos y tu comunidad, en un solo lugar</h2>
                <p>
                  Al pagar te llega un correo con tu usuario y una contraseña temporal. Adentro están tus clases, la
                  comunidad, el calendario de clases en vivo y el chat con tu generación.
                </p>
              </div>
              <div className="academy-cta-actions">
                <button className="btn btn-gold" onClick={goToAcademy}>
                  <Icon name="user" size={15} /> Entrar a la Academy
                </button>
                {member && <span className="academy-cta-hi">Ya tienes una sesión abierta en este dispositivo</span>}
              </div>
            </div>
          </section>
          )}

          {/* ============ TÉRMINOS Y PRIVACIDAD ============ */}
          {!comingSoon && <TermsSection />}
        </div>
      </main>

      <ModuleFooter
        logoSrc={LANDING.footerLogo}
        instagram={ACADEMY_INSTAGRAM}
        igHandle={`@${ACADEMY_INSTAGRAM}`}
        tagline={offer.online
          ? 'Formación en barbería — presencial en el estudio y online, a tu ritmo.'
          : 'Formación inicial en barbería — presencial en el estudio, y pronto online.'}
        links={comingSoon ? [
          [() => scrollToId('modalidades'), 'Modalidades'],
          [() => scrollToId('cursos'), 'Próximamente'],
        ] : [
          [() => scrollToId('cursos'), 'Cursos'],
          [() => scrollToId('modalidades'), 'Modalidades'],
          [() => scrollToId('terminos'), 'Términos y privacidad'],
          [goToAcademy, 'Entrar a la Academy'],
        ]}
      />

      {/* ============ MODAL DE CURSO ============ */}
      {active && (
        <div className="essentials-modal-wrap" role="dialog" aria-modal="true" aria-label={active.name}>
          <button className="essentials-modal-scrim" aria-label="Cerrar" onClick={() => setActive(null)} />
          <div className="academy-modal">
            <button className="essentials-modal-close" onClick={() => setActive(null)} aria-label="Cerrar">
              <Icon name="close" size={17} />
            </button>

            <header className="academy-modal-head">
              {active.image && <img src={active.image} alt="" aria-hidden="true" />}
              <div className="academy-modal-head-text">
                <span className="academy-modal-track">{[TRACKS[active.track]?.label, active.level].filter(Boolean).join(' · ')}</span>
                <h3>{active.name}</h3>
                {active.tagline && <p>{active.tagline}</p>}
              </div>
            </header>

            <div className="academy-modal-body">
              {active.presencial && active.online && (
                <div className="academy-toggle academy-modal-toggle" role="tablist" aria-label="Modalidad">
                  {MODALITIES.map((m) => (
                    <button key={m} role="tab" aria-selected={modalModality === m} className={modalModality === m ? 'is-on' : ''} onClick={() => setModalModality(m)}>
                      {MODALITY_LABEL[m]}
                    </button>
                  ))}
                </div>
              )}

              {active.long && <p className="academy-modal-long">{active.long}</p>}

              <ul className="academy-modal-meta">
                {modalityMeta(active, modalModality).map(([icon, text]) => (
                  <li key={text}><Icon name={icon} size={14} /> {text}</li>
                ))}
              </ul>

              {active.onlineSoon && (
                <p className="academy-modal-soon"><Icon name="bell" size={14} /> <span><b>Online:</b> próximamente.</span></p>
              )}

              {modalModality === 'presencial' && active.presencial && active.db && (
                <CohortInfo cohorts={cohortsFor(active)} />
              )}

              {active.objective && (
                <section className="academy-block">
                  <h4><Icon name="target" size={14} /> Objetivo general</h4>
                  <p className="academy-block-text">{active.objective}</p>
                </section>
              )}

              {active.includes?.length > 0 && (
                <section className="academy-block">
                  <h4><Icon name="gift" size={14} /> Qué incluye</h4>
                  <ul className="academy-list">
                    {active.includes.map((o) => <li key={o}><Icon name="check" size={13} /> {o}</li>)}
                  </ul>
                </section>
              )}

              <section className="academy-block">
                <h4>
                  <Icon name="grid" size={14} /> Malla del curso
                  {active.modules?.length > 0 && ` · ${active.modules.length} módulos · ${units(active, active.malla.length)}`}
                </h4>
                {!active.malla?.length ? (
                  <p className="academy-malla-pending">{active.mallaPending}</p>
                ) : active.modules?.length ? (
                  <div className="academy-modules">
                    {active.modules.map((mod) => {
                      const classes = active.malla.filter((day) => day.module === mod.n)
                      return (
                        <div className="academy-module" key={mod.n}>
                          <div className="academy-module-head">
                            <span className="academy-module-n">Módulo {mod.n}</span>
                            <span className="academy-module-meta">{[classRange(classes, active.unit), mod.hours ? `${mod.hours} h` : null].filter(Boolean).join(' · ')}</span>
                          </div>
                          <h5 className="academy-module-title">{mod.title}</h5>
                          {mod.summary && <p className="academy-module-summary">{mod.summary}</p>}
                          <MallaDays days={classes} openDay={openDay} setOpenDay={setOpenDay} />
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <MallaDays days={active.malla} openDay={openDay} setOpenDay={setOpenDay} />
                )}
              </section>

              {active.methodology?.length > 0 && (
                <section className="academy-block">
                  <h4><Icon name="clock" size={14} /> Cómo es cada clase{active.presencial?.sessionHours ? ` · ${active.presencial.sessionHours} horas` : ''}</h4>
                  <ol className="academy-steps">
                    {active.methodology.map(([block, dur, what]) => (
                      <li key={block}>
                        <span className="academy-steps-dur">{dur}</span>
                        <span><b>{block}.</b> {what}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {active.evaluation?.length > 0 && (
                <section className="academy-block">
                  <h4><Icon name="award" size={14} /> Evaluación final y certificación</h4>
                  <ul className="academy-eval">
                    {active.evaluation.map(([criterion, pct]) => (
                      <li key={criterion}>
                        <span>{criterion}</span>
                        <b>{pct}%</b>
                        <i style={{ '--pct': `${pct * 4}%` }} aria-hidden="true" />
                      </li>
                    ))}
                  </ul>
                  {active.certification && <p className="academy-block-text">{active.certification}</p>}
                </section>
              )}

              {active.outcomes?.length > 0 && (
                <section className="academy-block">
                  <h4><Icon name="checkCircle" size={14} /> Qué vas a saber hacer al egresar</h4>
                  <ul className="academy-list">
                    {active.outcomes.map((o) => <li key={o}><Icon name="check" size={13} /> {o}</li>)}
                  </ul>
                </section>
              )}

              {active.evidences?.length > 0 && (
                <section className="academy-block">
                  <h4><Icon name="camera" size={14} /> Evidencias de aprendizaje</h4>
                  <ul className="academy-list">
                    {active.evidences.map((o) => <li key={o}><Icon name="check" size={13} /> {o}</li>)}
                  </ul>
                </section>
              )}

              {active.requirements && (
                <p className="academy-req"><b>Requisitos:</b> {active.requirements}</p>
              )}
            </div>

            <footer className="academy-modal-foot">
              <EnrollTag open={sellable(active, modalModality)} size="lg" />
              <button
                type="button"
                className={`btn ${inCart(cart, active.id, modalModality) ? 'btn-ghost' : 'btn-gold'} academy-modal-add`}
                onClick={() => toggleCart(active.id, modalModality)}
              >
                <Icon name={inCart(cart, active.id, modalModality) ? 'check' : 'cart'} size={15} />
                {inCart(cart, active.id, modalModality) ? 'En tu selección' : `Agregar ${MODALITY_LABEL[modalModality].toLowerCase()}`}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* ============ DRAWER ============ */}
      {cartOpen && (
        <CartDrawer
          cart={cart}
          setCart={setCart}
          courseById={courseById}
          catalog={catalog}
          sellable={sellable}
          cohortsFor={cohortsFor}
          onClose={() => setCartOpen(false)}
        />
      )}
    </div>
  )
}

/* "Clases 1 a 4", "Clases 15 y 16", "Clase 3" (o "Lecciones …"). */
function classRange(days, unit) {
  const ns = days.map((d) => d.n)
  if (!ns.length) return ''
  const [one, many] = unit === 'lección' ? ['Lección', 'Lecciones'] : ['Clase', 'Clases']
  if (ns.length === 1) return `${one} ${ns[0]}`
  const first = ns[0]
  const last = ns[ns.length - 1]
  return `${many} ${first} ${ns.length === 2 ? 'y' : 'a'} ${last}`
}

/* Acordeón de clases. Una clase de la malla nueva trae objetivo, actividad y
   resultado además de sus contenidos (`items`); una vieja, solo los temas. */
function MallaDays({ days, openDay, setOpenDay }) {
  return (
    <div className="academy-malla">
      {days.map((day) => {
        const open = openDay === day.n
        return (
          <div className={`academy-day ${open ? 'is-open' : ''}`} key={day.n}>
            <button type="button" onClick={() => setOpenDay(open ? null : day.n)} aria-expanded={open}>
              <span className="academy-day-n">{day.n === 0 ? '00' : String(day.n).padStart(2, '0')}</span>
              <span className="academy-day-title">{day.title}</span>
              <Icon name={open ? 'minus' : 'plus'} size={14} />
            </button>
            {open && (
              <div className="academy-day-detail">
                {day.objective && <p><b>Objetivo:</b> {day.objective}</p>}
                {day.items?.length > 0 && (
                  <ul>
                    {day.items.map((it) => <li key={it}>{it}</li>)}
                  </ul>
                )}
                {day.activity && <p><b>Actividad práctica:</b> {day.activity}</p>}
                {day.result && <p><b>Resultado esperado:</b> {day.result}</p>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* Generaciones presenciales a la venta de un curso (en el modal). */
function CohortInfo({ cohorts }) {
  return (
    <section className="academy-block">
      <h4><Icon name="calendar" size={14} /> Próximas generaciones</h4>
      {cohorts.length === 0 ? (
        <p className="academy-malla-pending">Todavía no hay fecha para la próxima generación presencial. Agrégalo a tu selección y síguenos en Instagram para enterarte.</p>
      ) : (
        <ul className="academy-list">
          {cohorts.map((g) => (
            <li key={g.id}>
              <Icon name="calendar" size={13} /> {g.name}
              {g.startsOn ? ` · parte el ${fmtDayKey(g.startsOn)}` : ''}
              {g.seatsLeft != null ? ` · ${g.seatsLeft > 0 ? `quedan ${g.seatsLeft} ${g.seatsLeft === 1 ? 'cupo' : 'cupos'}` : 'sin cupos'}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function fmtDayKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''))
  if (!m) return key
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(d)
}

/* ---------------- Carrito + checkout (un curso por pago) ---------------- */

function CartDrawer({ cart, setCart, courseById, catalog, sellable, cohortsFor, onClose }) {
  const items = cart
    .map((it) => ({ ...it, course: courseById.get(it.courseId) }))
    .filter((it) => it.course)
  const payable = items.filter((it) => sellable(it.course, it.modality))
  const [payKey, setPayKey] = useState(() => (payable[0] ? itemKey(payable[0].courseId, payable[0].modality) : null))
  const target = payable.find((it) => itemKey(it.courseId, it.modality) === payKey) || payable[0] || null

  const [buyer, setBuyer] = useState({ name: '', email: '', emailConfirm: '', phone: '', cohortId: '', accept: false })
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState(null) // { text, login? }
  const patch = (p) => { setBuyer((b) => ({ ...b, ...p })); setError(null) }

  const cohorts = target && target.modality === 'presencial' ? cohortsFor(target.course).filter((g) => g.seatsLeft == null || g.seatsLeft > 0) : []
  useEffect(() => {
    // Una sola generación a la venta: se preselecciona.
    if (cohorts.length === 1 && String(buyer.cohortId) !== String(cohorts[0].id)) setBuyer((b) => ({ ...b, cohortId: String(cohorts[0].id) }))
  }, [target?.courseId, target?.modality, cohorts.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const suggestion = emailSuggestion(buyer.email)
  const phone = cleanPhone(buyer.phone)

  const validate = () => {
    if (!target) return 'Elige un curso para pagar.'
    const name = buyer.name.trim()
    const email = buyer.email.trim()
    if (!name) return 'Escribe tu nombre.'
    if (name.length > 80) return 'El nombre es muy largo.'
    if (!EMAIL_RE.test(email) || email.length > 120) return 'Revisa tu correo: ahí te llega la contraseña.'
    if (email.toLowerCase() !== buyer.emailConfirm.trim().toLowerCase()) return 'Los dos correos no coinciden.'
    if (buyer.phone.trim() && phone.length !== 9) return 'El teléfono debe tener 9 dígitos (o déjalo vacío).'
    if (target.modality === 'presencial' && !buyer.cohortId) return 'Elige tu generación.'
    if (!buyer.accept) return 'Tienes que aceptar los términos y el aviso de privacidad.'
    return null
  }

  const pay = async (e) => {
    e?.preventDefault?.()
    if (paying) return
    const problem = validate()
    if (problem) { setError({ text: problem }); return }
    setPaying(true)
    setError(null)
    try {
      const email = buyer.email.trim()
      const out = await checkoutApi({
        kind: 'course',
        courseSlug: target.course.db.slug,
        modality: target.modality,
        cohortId: target.modality === 'presencial' ? Number(buyer.cohortId) : undefined,
        name: buyer.name.trim(),
        email,
        emailConfirm: buyer.emailConfirm.trim(),
        phone: phone.length === 9 ? phone : undefined,
        acceptTerms: true,
      })
      if (!out?.initPoint) throw Object.assign(new Error('No pudimos iniciar el pago.'), { status: 502 })
      // /academy/gracias lee esto para mostrar a qué correo llega el acceso
      // (y para sacar del carrito el curso ya pagado).
      try {
        sessionStorage.setItem(CHECKOUT_KEY, JSON.stringify({ email, ref: out.ref, courseId: target.courseId, modality: target.modality }))
      } catch { /* sin storage: la página de gracias igual consulta por ref */ }
      // El carrito NO se vacía acá: si la persona vuelve atrás desde Mercado
      // Pago, su selección tiene que seguir ahí.
      window.location.href = out.initPoint
    } catch (err) {
      setPaying(false)
      const status = err?.status
      if (status === 409 && err?.code === 'ya_tienes') {
        setError({ text: 'Ya tienes este curso con ese correo.', login: true })
      } else if (status === 503) {
        setError({ text: 'Las inscripciones abren pronto. Tu selección queda guardada.' })
      } else if (status === 429) {
        setError({ text: 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentar.' })
      } else if (status === 0) {
        setError({ text: 'Sin conexión. Revisa tu internet e intenta de nuevo.' })
      } else {
        setError({ text: err?.message || 'No pudimos iniciar el pago. Intenta de nuevo en un momento.' })
      }
    }
  }

  const checkoutOpen = catalog.checkoutEnabled && payable.length > 0

  return (
    <div className="essentials-drawer-wrap" role="dialog" aria-modal="true" aria-label="Tu selección de cursos">
      <button className="essentials-modal-scrim" aria-label="Cerrar" onClick={onClose} />
      <aside className="essentials-drawer">
        <div className="essentials-drawer-head">
          <h3>Tu selección <span>· {items.length}</span></h3>
          <button onClick={onClose} aria-label="Cerrar"><Icon name="close" size={16} /></button>
        </div>

        <div className="essentials-drawer-body">
          {items.length === 0 ? (
            <div className="essentials-drawer-empty">
              <Icon name="grid" size={38} />
              <p>Todavía no eliges ningún curso</p>
            </div>
          ) : items.map((it) => {
            const { course } = it
            const key = itemKey(it.courseId, it.modality)
            const canPay = sellable(course, it.modality)
            const selected = target && itemKey(target.courseId, target.modality) === key
            return (
              <div className="essentials-drawer-item" key={key}>
                {course.image ? <img src={course.image} alt="" /> : <span style={{ width: 56, height: 56, flex: 'none' }} aria-hidden="true" />}
                <div className="essentials-drawer-item-info">
                  <div className="essentials-drawer-item-name">{course.name}</div>
                  <div className="essentials-drawer-item-brand">{MODALITY_LABEL[it.modality]}</div>
                  <div className="essentials-drawer-item-row">
                    <span className="academy-drawer-hours">
                      {canPay
                        ? (payable.length > 1
                          ? <button type="button" className={`btn btn-sm ${selected ? 'btn-gold' : 'btn-ghost'}`} onClick={() => { setPayKey(key); setError(null) }} aria-pressed={selected}>{selected ? 'Pagas este' : 'Pagar este'}</button>
                          : 'A la venta')
                        : 'Aún no a la venta'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="essentials-drawer-item-remove"
                  onClick={() => setCart(removeFromCart(it.courseId, it.modality))}
                  aria-label={`Quitar ${course.name}`}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            )
          })}

          {items.length > 0 && checkoutOpen && target && (
            <form id="aca-checkout" className="essentials-checkout-fields" onSubmit={pay} noValidate style={{ marginTop: '1rem' }}>
              <p className="essentials-drawer-note" style={{ textAlign: 'left' }}>
                Vas a pagar <b>{target.course.name}</b> · {MODALITY_LABEL[target.modality]}.
                {items.length > 1 && ' Mercado Pago cobra un curso por pago: el resto queda guardado en tu selección para después.'}
              </p>
              <input className="input" placeholder="Tu nombre y apellido" autoComplete="name" value={buyer.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} />
              <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="Tu correo (ahí llega tu acceso)" value={buyer.email} maxLength={120} onChange={(e) => patch({ email: e.target.value })} />
              {suggestion && (
                <button type="button" className="essentials-drawer-note" style={{ textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => patch({ email: suggestion, emailConfirm: buyer.emailConfirm ? suggestion : buyer.emailConfirm })}>
                  ¿Quisiste decir {suggestion}?
                </button>
              )}
              <input className="input" type="email" inputMode="email" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="Repite tu correo" value={buyer.emailConfirm} maxLength={120} onChange={(e) => patch({ emailConfirm: e.target.value })} onPaste={(e) => e.preventDefault()} />
              <input className="input" inputMode="numeric" autoComplete="tel-national" placeholder="Teléfono (opcional, 9 dígitos)" value={buyer.phone} onChange={(e) => patch({ phone: e.target.value.replace(/[^\d+ ]/g, '').slice(0, 15) })} />
              {target.modality === 'presencial' && (
                <select className="input" value={buyer.cohortId} onChange={(e) => patch({ cohortId: e.target.value })} aria-label="Generación">
                  <option value="">Elige tu generación</option>
                  {cohorts.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}{g.startsOn ? ` · ${fmtDayKey(g.startsOn)}` : ''}{g.seatsLeft != null ? ` · quedan ${g.seatsLeft}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <label style={{ display: 'flex', gap: '.55rem', alignItems: 'flex-start', fontSize: '.78rem', lineHeight: 1.45, color: 'var(--muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={buyer.accept} onChange={(e) => patch({ accept: e.target.checked })} style={{ marginTop: '.15rem', width: 18, height: 18, flex: 'none' }} />
                <span>
                  Acepto los <a href="#terminos" onClick={(e) => { e.preventDefault(); onClose(); setTimeout(() => scrollToId('terminos'), 50) }} style={{ color: 'inherit', textDecoration: 'underline' }}>términos y el aviso de privacidad</a>.
                </span>
              </label>
            </form>
          )}
        </div>

        {items.length > 0 && (
          <div className="essentials-drawer-foot">
            {error && (
              <p className="essentials-pay-error" role="alert">
                {error.text}{' '}
                {error.login && <a href={r.ingreso} style={{ color: 'inherit', textDecoration: 'underline' }}>Entra a la Academy</a>}
              </p>
            )}
            {checkoutOpen && target ? (
              <>
                <button type="submit" form="aca-checkout" className="btn btn-gold btn-block essentials-checkout-btn" disabled={paying}>
                  {paying ? 'Redirigiendo a Mercado Pago…' : 'Pagar con Mercado Pago'}
                </button>
                <p className="essentials-drawer-note">
                  Pago único: el monto lo ves en Mercado Pago antes de confirmar. Te llega un correo con tu usuario y una contraseña temporal apenas se confirme el pago.
                </p>
              </>
            ) : (
              <p className="essentials-drawer-note">
                {catalog.status === 'loading'
                  ? 'Revisando cupos…'
                  : 'Las inscripciones de estos cursos abren pronto. Tu selección queda guardada en este dispositivo; síguenos en Instagram para enterarte primero.'}
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

/* ---------------- Términos y aviso de privacidad (#terminos) ---------------- */

function TermsSection() {
  return (
    <section className="bsection academy-modes" id="terminos">
      <div className="bwrap">
        <div className="bhead center" data-reveal>
          <p className="kicker">Antes de comprar</p>
          <h2>Términos y aviso de privacidad</h2>
        </div>
        <div className="academy-modes-grid">
          <article className="academy-mode-card" data-reveal>
            <span className="academy-mode-tag">Compra</span>
            <h3>Qué compras</h3>
            <ul>
              <li><Icon name="check" size={13} /> Un pago único por curso, con Mercado Pago. No es una suscripción: no hay cobros mensuales.</li>
              <li><Icon name="check" size={13} /> Online: acceso de por vida a las lecciones del curso dentro de la Academy, más la comunidad.</li>
              <li><Icon name="check" size={13} /> Presencial: tu cupo en la generación que elijas y el material online del curso. Si una fecha cambia, te avisamos por correo.</li>
              <li><Icon name="check" size={13} /> Tu acceso es personal: la cuenta es tuya y no se comparte.</li>
              <li><Icon name="check" size={13} /> Si hay un problema con tu compra, escríbenos. Los reembolsos se hacen por Mercado Pago y cierran el acceso a ese curso.</li>
              <li><Icon name="check" size={13} /> En la comunidad rigen sus reglas (respeto, nada de spam). Quien no las cumpla puede perder su cuenta.</li>
            </ul>
          </article>
          <article className="academy-mode-card" data-reveal>
            <span className="academy-mode-tag is-online">Privacidad</span>
            <h3>Qué hacemos con tus datos</h3>
            <ul>
              <li><Icon name="check" size={13} /> <span><b>Responsables:</b> Pimp Studio (pimpstudio.cl) y Brunetti (brunetticutz.cl). La Academy es una sola en los dos sitios: tu cuenta, tus cursos y tus datos son los mismos en pimpstudio.cl/academy y en brunetticutz.cl/cursos.</span></li>
              <li><Icon name="check" size={13} /> <span><b>Qué datos:</b> nombre, correo, teléfono si lo das y los datos de tu compra. Dentro de la Academy, lo que publiques, tu avance y tus mensajes.</span></li>
              <li><Icon name="check" size={13} /> <span><b>Para qué:</b> crear tu cuenta y darte acceso, enviarte tu contraseña y avisos de la Academy, gestionar pagos y reembolsos, darte soporte y cuidar la comunidad. No vendemos tus datos ni te mandamos publicidad por correo.</span></li>
              <li><Icon name="check" size={13} /> <span><b>Quién más los procesa (encargados):</b> Neon (base de datos), Vercel (sitio e imágenes), Resend (envío de correos), Google (YouTube, para reproducir las lecciones) y Mercado Pago (el pago; tus datos de tarjeta nunca pasan por nosotros).</span></li>
              <li><Icon name="check" size={13} /> <span><b>Tus derechos:</b> puedes pedir acceso, corrección o eliminación de tus datos. Dentro de la Academy, en Ajustes, descargas tus datos o eliminas tu cuenta; también puedes escribirnos a @{ACADEMY_INSTAGRAM}.</span></li>
              {LANDING.metaPixel && (
                <li><Icon name="check" size={13} /> <span>Esta página de venta usa Meta Pixel para medir anuncios. Dentro de la Academy no.</span></li>
              )}
            </ul>
          </article>
        </div>
      </div>
    </section>
  )
}
