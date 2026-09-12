import React, { useContext, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useBrunettiFx, scrollToId } from '../components/brunetti.jsx'
import SiteNav from '../components/SiteNav.jsx'
import ModuleFooter from '../components/ModuleFooter.jsx'
import { Lamp } from '../components/ui/lamp.jsx'
import { ContainerScroll } from '../components/ui/container-scroll-animation.jsx'
import { InteractiveSelector } from '../components/ui/interactive-selector.jsx'
import { Sparkles } from '../components/ui/sparkles.jsx'
import { CLP } from '../data.js'
import { EditableText, EditContext } from '../components/edit/EditableText.jsx'
import { Editable } from '../components/edit/Editable.jsx'
import HERO from '../data/content/home-hero.json'
import VISAGISMO from '../data/content/home-visagismo.json'
import ESTILO_TEASER from '../data/content/home-estilo-teaser.json'
import SOBRE from '../data/content/home-sobre.json'
import SERVICIOS_INTRO from '../data/content/home-servicios.json'
import TRANSFORMACIONES from '../data/content/home-transformaciones.json'
import EXPERIENCIAS from '../data/content/home-experiencias.json'
import CURSOS_TEASER from '../data/content/home-cursos-teaser.json'
import TESTIMONIOS_INTRO from '../data/content/home-testimonios.json'
import CONTACTO from '../data/content/home-contacto.json'

/* ============================================================
   BRUNETTI — Landing de marca personal (Bruno Herrera)
   Recreación 1:1 del design handoff en React.
   ============================================================ */

// Los íconos son SVG fijos (no son copy editable); el número/título/cuerpo
// de cada pilar sí viven en JSON (home-visagismo.json) y llegan por índice.
const PILLAR_ICONS = [
  (<><circle cx="12" cy="12" r="9" /><path d="M9 10h.01M15 10h.01M8.5 15c1 1 2.2 1.4 3.5 1.4s2.5-.4 3.5-1.4" /></>),
  (<path d="M12 3v18M5 8l7-5 7 5M5 8v8l7 5 7-5V8" />),
  (<path d="M14 4l6 6M3 21l3-1 11-11-2-2L4 18z" />),
  (<><path d="M3 12a9 9 0 1 0 9-9M3 12l3-3M3 12l3 3" /><path d="M12 8v4l3 2" /></>),
  (<><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></>),
]
// Medios de fondo de cada panel del carrusel de visagismo: fotos reales en los
// pasos 1-4 y un video en loop en el paso 5. Sin `image`/`video` el panel cae
// al ícono sobre tinte dorado (fallback del InteractiveSelector).
const PILLAR_MEDIA = [
  { image: '/assets/visagismo-paso-1.jpg' },
  { image: '/assets/visagismo-paso-2.jpg' },
  { image: '/assets/visagismo-paso-3.jpg' },
  { image: '/assets/visagismo-paso-4.jpg' },
  { video: '/assets/visagismo-paso-5.mp4', poster: '/assets/visagismo-paso-5-poster.jpg' },
]
const PILLARS = VISAGISMO.pillars.map((p, i) => ({ ...p, icon: PILLAR_ICONS[i], ...PILLAR_MEDIA[i] }))

// Respaldo solo para cuando /api/services no responde (ver graceful degradation
// en CLAUDE.md). La fuente real son los servicios activos configurados en el
// panel interno — antes esta lista vivía hardcodeada acá y nunca reflejaba
// los precios ni el ocultar/mostrar que hacía el barbero desde Servicios.
const FALLBACK_SERVICES = [
  { id: 10, tag: 'Visagismo', featured: true, title: 'Asesoría de Imagen — Visagista', desc: 'Análisis de tu fisonomía para definir el estilo que te favorece y cómo llevarlo.', price: '$49.990', dur: '120 min', cta: 'Reservar hora' },
  { id: 11, tag: 'Corte', title: 'Corte de cabello', desc: 'Corte completo de principio a fin: largo, forma y terminación. El indicado si es tu primera vez.', price: '$19.990', dur: '60 min', cta: 'Reservar hora' },
  { id: 12, tag: 'Corte + Barba', title: 'Corte de cabello y barba', desc: 'Corte completo y barba perfilada, con terminación de detalle.', price: '$29.990', dur: '90 min', cta: 'Reservar hora' },
]

const CAT_TAG = { premium: 'Premium', quimico: 'Color', general: 'Corte' }

// Solo UN servicio lleva la insignia de destacado: el primer premium, o si no
// hay ninguno, el primero de la lista.
function pickFeaturedId(list) {
  return (list.find((s) => s.cat === 'premium') || list[0])?.id
}

function toDisplayService(svc, featuredId) {
  return {
    id: svc.id,
    tag: CAT_TAG[svc.cat] || (svc.cat ? svc.cat[0].toUpperCase() + svc.cat.slice(1) : 'Servicio'),
    featured: svc.id === featuredId,
    title: svc.name,
    desc: svc.desc || '',
    price: CLP(svc.price),
    dur: `${svc.min} min`,
    cta: 'Reservar hora',
  }
}

// Las imágenes son rutas fijas (no son copy editable); cat/título/cuerpo de
// cada tarjeta sí vive en JSON (home-experiencias.json) y llega por índice.
const CARD_IMAGES = ['/assets/bruno-feature.jpg', '/assets/gallery-1.jpg', '/assets/gallery-2.jpg', '/assets/gallery-3.jpg', '/assets/workshop-2026.jpg', '/assets/bruno-portrait.jpg']
const CARDS = EXPERIENCIAS.cards.map((c, i) => ({ ...c, img: CARD_IMAGES[i] }))

// Antes las 4 reseñas reutilizaban fotos de Bruno (el barbero) en vez de
// clientes reales. Se reemplazan por fotos de la galería de "Tu estilo"
// (/tu-estilo), eligiendo una persona distinta y reconocible por reseña.
const TESTIMONIAL_IMAGES = [
  '/assets/estilo/estilo-fade-clasico.jpg',
  '/assets/estilo/estilo-side-part.jpg',
  '/assets/estilo/estilo-textura-barba.jpg',
  '/assets/estilo/estilo-skin-fade.jpg',
]
const TESTIMONIALS = TESTIMONIOS_INTRO.items.map((t, i) => ({ ...t, img: TESTIMONIAL_IMAGES[i] }))

export default function Home() {
  const navigate = useNavigate()
  const location = useLocation()
  const rootRef = useRef(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [modal, setModal] = useState(null) // índice de CARDS o null
  const [tmIdx, setTmIdx] = useState(0)
  const [tmReveal, setTmReveal] = useState(0) // contador para re-disparar animación de palabras
  const trackRef = useRef(null)
  const [services, setServices] = useState(FALLBACK_SERVICES)
  const { editing } = useContext(EditContext)

  useBrunettiFx(rootRef)

  // El scroll-reveal (useBrunettiFx) arma su IntersectionObserver una sola
  // vez al montar, sobre los 3 servicios de respaldo. Cuando llegan los
  // reales y reemplazan esos nodos, las tarjetas nuevas nunca quedan
  // observadas y se quedan invisibles (opacity:0) para siempre — con la
  // grilla ocupando igual su espacio, se veía como huecos negros gigantes.
  // Como esta sección carga después del montaje, la revelamos a mano en vez
  // de depender del observer genérico.
  useEffect(() => {
    if (services === FALLBACK_SERVICES) return
    const t = setTimeout(() => {
      document.querySelectorAll('.bserv-grid [data-reveal]').forEach((n) => n.classList.add('is-in'))
    }, 30)
    return () => clearTimeout(t)
  }, [services])

  // Servicios reales configurados en el panel interno: precio, visibilidad
  // (oculto/publicado) y textos vienen todos de acá, no de una lista fija.
  useEffect(() => {
    fetch('/api/services')
      .then((r) => r.json())
      .then((data) => {
        if (data.services?.length) {
          const featuredId = pickFeaturedId(data.services)
          const mapped = data.services.map((svc) => toDisplayService(svc, featuredId))
          // La landing es una vitrina, no el catálogo completo: destacado
          // primero (si hay) y hasta 2 más, igual que la curaduría original.
          const featured = mapped.find((s) => s.featured)
          const rest = mapped.filter((s) => !s.featured)
          setServices(featured ? [featured, ...rest.slice(0, 2)] : mapped.slice(0, 3))
        }
      })
      .catch(() => {})
  }, [])

  const goReserve = () => navigate('/reservar')
  const bookService = (id) => { try { localStorage.setItem('ps_pending_service', String(id)) } catch (e) {} navigate('/reservar') }
  const goCursos = () => navigate('/cursos')
  const goWorkshop = () => navigate('/workshop')
  const goStyle = () => navigate('/style')

  const navTo = (id) => { setMenuOpen(false); scrollToId(id) }

  /* Llegada desde otra página (p. ej. /cursos) con sección destino. */
  useEffect(() => {
    const section = location.state?.section
    if (!section) return
    const t = setTimeout(() => scrollToId(section), 200)
    return () => clearTimeout(t)
  }, [location.state])

  /* ---- Testimonios: autoplay ---- */
  useEffect(() => {
    const t = setInterval(() => { setTmIdx((i) => (i + 1) % TESTIMONIALS.length); setTmReveal((r) => r + 1) }, 8000)
    return () => clearInterval(t)
  }, [])
  const tmGo = (dir) => { setTmIdx((i) => (i + dir + TESTIMONIALS.length) % TESTIMONIALS.length); setTmReveal((r) => r + 1) }

  /* ---- Compare slider (drag + hover-follow) ---- */
  useEffect(() => {
    const frame = rootRef.current?.querySelector('#compare-frame')
    if (!frame) return
    const before = frame.querySelector('.cmp-before')
    const divider = frame.querySelector('.cmp-divider')
    const handle = frame.querySelector('.cmp-handle')
    let dragging = false
    const setPos = (p) => {
      const pos = Math.max(2, Math.min(98, p))
      before.style.clipPath = `inset(0 ${100 - pos}% 0 0)`
      divider.style.left = pos + '%'
      handle.style.left = pos + '%'
    }
    const fromEvent = (e) => {
      const rect = frame.getBoundingClientRect()
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
      setPos((x / rect.width) * 100)
    }
    const down = (e) => { dragging = true; fromEvent(e) }
    const move = (e) => { if (dragging) fromEvent(e) }
    const up = () => { dragging = false }
    const hover = (e) => { if (!dragging) fromEvent(e) }
    frame.addEventListener('mousedown', down)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    frame.addEventListener('touchstart', down, { passive: true })
    frame.addEventListener('touchmove', move, { passive: true })
    frame.addEventListener('touchend', up)
    frame.addEventListener('mousemove', hover)
    setPos(50)
    return () => {
      frame.removeEventListener('mousedown', down)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      frame.removeEventListener('touchstart', down)
      frame.removeEventListener('touchmove', move)
      frame.removeEventListener('touchend', up)
      frame.removeEventListener('mousemove', hover)
    }
  }, [])

  /* ---- Carousel: cerrar modal con Escape + bloquear scroll ---- */
  useEffect(() => {
    if (modal === null) return
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setModal(null) }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', onKey) }
  }, [modal])

  const scrollTrack = (dir) => {
    const track = trackRef.current
    if (!track) return
    const card = track.querySelector('.ac-card')
    const step = card ? card.offsetWidth + 16 : 300
    track.scrollBy({ left: dir * step, behavior: 'smooth' })
  }

  const marquee = (
    <span>
      <b>Análisis de fisonomía</b><span className="sep">✦</span>Dirección de estilo<span className="sep">✦</span>
      <b>Cortes a medida</b><span className="sep">✦</span>Transformación de imagen<span className="sep">✦</span>
      <b>Contenido de marca</b><span className="sep">✦</span>Formación profesional<span className="sep">✦</span>
    </span>
  )

  const tm = TESTIMONIALS[tmIdx]

  return (
    <div className="brunetti-site" ref={rootRef}>
      <div className="bg-blobs" aria-hidden="true">
        <div className="bg-blob bg-blob-1" />
        <div className="bg-blob bg-blob-2" />
        <div className="bg-blob bg-blob-3" />
      </div>

      <SiteNav onSection={navTo} />

      <main>
        {/* ============ HERO ============ */}
        <section id="hero" className="bhero">
          <div className="bhero-bgphoto" aria-hidden="true">
            <Editable as="img" editId="home-hero:bg" src="/assets/bruno-hero-bg.webp" alt="" fetchpriority="high" decoding="async" />
          </div>
          <Lamp className="bru-lamp--hero" />
          <div className="bhero-grid">
            <div className="bhero-text">
              <h1 className="bhero-name bhero-name--img" aria-label="Brunetticutz">
                <Editable as="img" editId="home-hero:wordmark" className="bhero-name-img" src="/assets/brunetti-hero-wordmark.webp" alt="Brunetticutz" fetchpriority="high" decoding="async" />
              </h1>
              <span className="bhero-kicker"><span className="dot" /><EditableText file="home-hero" path="kicker">{HERO.kicker}</EditableText></span>
              <p className="bhero-role">
                <EditableText file="home-hero" path="rolePrefix">{HERO.rolePrefix}</EditableText>
                <b><EditableText file="home-hero" path="roleHighlight">{HERO.roleHighlight}</EditableText></b>
              </p>
              <p className="bhero-sub"><EditableText file="home-hero" path="sub" as="span">{HERO.sub}</EditableText></p>
              <div className="bhero-actions">
                <a className="btn btn-primary" onClick={goReserve}><EditableText file="home-hero" path="ctaPrimary">{HERO.ctaPrimary}</EditableText></a>
                <a className="btn btn-ghost" onClick={goCursos}><EditableText file="home-hero" path="ctaSecondary">{HERO.ctaSecondary}</EditableText></a>
              </div>
              <div className="bhero-meta">
                <div className="stat"><strong><EditableText file="home-hero" path="stat1Label">{HERO.stat1Label}</EditableText></strong><span><EditableText file="home-hero" path="stat1Sub">{HERO.stat1Sub}</EditableText></span></div>
                <div className="stat"><strong><EditableText file="home-hero" path="stat2Label">{HERO.stat2Label}</EditableText></strong><span><EditableText file="home-hero" path="stat2Sub">{HERO.stat2Sub}</EditableText></span></div>
                <div className="stat"><strong><EditableText file="home-hero" path="stat3Label">{HERO.stat3Label}</EditableText></strong><span><EditableText file="home-hero" path="stat3Sub">{HERO.stat3Sub}</EditableText></span></div>
              </div>
            </div>

            <div className="bhero-figwrap">
              <div className="bhero-figure bhero-figure--cutout" data-tilt>
                <a className="bhero-fig-link" href="https://instagram.com/brunetticutz" target="_blank" rel="noopener noreferrer" aria-label="Ver Instagram de @brunetticutz">
                  <Editable as="img" editId="home-hero:cutout" src="/assets/bruno-hero-cutout.webp" alt="Bruno Herrera, Brunetti — visagista" fetchpriority="high" decoding="async" />
                  <div className="fig-tag">
                    <span><EditableText file="home-hero" path="figHandle">{HERO.figHandle}</EditableText></span>
                  </div>
                </a>
              </div>
            </div>
          </div>

          <div className="bhero-cue">
            <span><EditableText file="home-hero" path="scrollCue">{HERO.scrollCue}</EditableText></span>
            <div className="mouse" />
          </div>
        </section>

        <div className="bru-sparkles-zone">
          <Sparkles className="bru-sparkles--bg" />

        {/* ============ MARQUEE ============ */}
        <div className="bmarquee" aria-hidden="true">
          <div className="bmarquee-track">{marquee}{marquee}</div>
        </div>

        {/* ============ VISAGISMO ============ */}
        <section id="visagismo" className="bsection bsection--full">
          <div className="bwrap">
            <div className="bhead center" data-reveal>
              <p className="kicker"><EditableText file="home-visagismo" path="kicker">{VISAGISMO.kicker}</EditableText></p>
              <h2><EditableText file="home-visagismo" path="h2" as="span">{VISAGISMO.h2}</EditableText></h2>
              <p><EditableText file="home-visagismo" path="body" as="span">{VISAGISMO.body}</EditableText></p>
            </div>
          </div>
          <div className="bwrap">
            <InteractiveSelector
              items={PILLARS.map((p, i) => ({
                num: p.num,
                icon: p.icon,
                image: p.image,
                video: p.video,
                poster: p.poster,
                title: <EditableText file="home-visagismo" path={`pillars.${i}.title`} as="span">{p.title}</EditableText>,
                body: <EditableText file="home-visagismo" path={`pillars.${i}.body`} as="span">{p.body}</EditableText>,
              }))}
            />
          </div>
        </section>

        {/* ============ ENCUENTRA TU ESTILO (teaser → /style) ============ */}
        <section className="bsection" id="estilo-teaser">
          <div className="bwrap">
            <div className="bteaser" data-reveal="scale">
              <div className="bteaser-bg"><Editable as="img" editId="home-estilo:teaserBg" src="/assets/estilo-teaser.jpg" alt="Asesoría de visagismo Brunetti" loading="lazy" decoding="async" /></div>
              <div className="bteaser-inner">
                <p className="kicker"><EditableText file="home-estilo-teaser" path="kicker">{ESTILO_TEASER.kicker}</EditableText></p>
                <h2><EditableText file="home-estilo-teaser" path="h2" as="span">{ESTILO_TEASER.h2}</EditableText></h2>
                <p><EditableText file="home-estilo-teaser" path="body" as="span">{ESTILO_TEASER.body}</EditableText></p>
                <div className="bteaser-modchips">
                  <span><EditableText file="home-estilo-teaser" path="chip1">{ESTILO_TEASER.chip1}</EditableText></span>
                  <span><EditableText file="home-estilo-teaser" path="chip2">{ESTILO_TEASER.chip2}</EditableText></span>
                  <span><EditableText file="home-estilo-teaser" path="chip3">{ESTILO_TEASER.chip3}</EditableText></span>
                </div>
                <a className="btn btn-primary" onClick={goStyle}><EditableText file="home-estilo-teaser" path="cta">{ESTILO_TEASER.cta}</EditableText></a>
              </div>
            </div>
          </div>
        </section>

        {/* ============ SOBRE BRUNO ============ */}
        <section id="sobre" className="bsection">
          <div className="bwrap babout">
            <div data-reveal="left">
              <ContainerScroll>
                <figure className="babout-figure">
                  <Editable as="img" editId="home-sobre:figure" src="/assets/workshop-2026.jpg" alt="Bruno Herrera con su comunidad de barberos" loading="lazy" decoding="async" />
                  <figcaption className="sig"><EditableText file="home-sobre" path="figCaption">{SOBRE.figCaption}</EditableText></figcaption>
                </figure>
              </ContainerScroll>
            </div>
            <div className="babout-body" data-reveal="right">
              <Lamp className="bru-lamp--sec" />
              <p className="kicker" style={{ letterSpacing: '0.3em', textTransform: 'uppercase', fontSize: '0.72rem', color: 'var(--gold-bright)', margin: '0 0 0.8rem' }}><EditableText file="home-sobre" path="kicker">{SOBRE.kicker}</EditableText></p>
              <h2><EditableText file="home-sobre" path="h2" as="span">{SOBRE.h2}</EditableText></h2>
              <p><span className="lead"><EditableText file="home-sobre" path="leadText" as="span">{SOBRE.leadText}</EditableText></span> <EditableText file="home-sobre" path="bodyText" as="span">{SOBRE.bodyText}</EditableText></p>
              <p><EditableText file="home-sobre" path="bodyText2" as="span">{SOBRE.bodyText2}</EditableText></p>
              <div className="babout-stats">
                <div className="st"><strong data-count="6">0</strong><span><EditableText file="home-sobre" path="stat1Label">{SOBRE.stat1Label}</EditableText></span></div>
                <div className="st"><strong data-count="5">0</strong><span><EditableText file="home-sobre" path="stat2Label">{SOBRE.stat2Label}</EditableText></span></div>
                <div className="st"><strong data-count="100" data-suffix="%">0</strong><span><EditableText file="home-sobre" path="stat3Label">{SOBRE.stat3Label}</EditableText></span></div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ SERVICIOS ============ */}
        <section id="servicios" className="bsection">
          <div className="bwrap">
            <div className="bhead center" data-reveal>
              <p className="kicker"><EditableText file="home-servicios" path="kicker">{SERVICIOS_INTRO.kicker}</EditableText></p>
              <h2><EditableText file="home-servicios" path="h2" as="span">{SERVICIOS_INTRO.h2}</EditableText></h2>
              <p><EditableText file="home-servicios" path="body" as="span">{SERVICIOS_INTRO.body}</EditableText></p>
            </div>
            <div className="bserv-grid">
              {services.map((s, i) => (
                <article className={`bserv${s.featured ? ' featured' : ''}`} data-reveal style={{ '--i': i }} key={s.id ?? s.title}>
                  {s.featured && <span className="badge">Insignia</span>}
                  <span className="stag">{s.tag}</span>
                  <h3>{s.title}</h3>
                  <p className="desc">{s.desc}</p>
                  <div className="meta">
                    <span className="price">{s.price}</span>
                    <span className="dur">{s.dur}</span>
                  </div>
                  <a className="book" onClick={() => bookService(s.id)}>{s.cta}</a>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ============ TRANSFORMACIONES ============ */}
        <section className="feature-section compare-section" id="transformaciones">
          <div className="feature-head" data-reveal>
            <p className="kicker"><EditableText file="home-transformaciones" path="kicker">{TRANSFORMACIONES.kicker}</EditableText></p>
            <h2><EditableText file="home-transformaciones" path="h2" as="span">{TRANSFORMACIONES.h2}</EditableText></h2>
            <p><EditableText file="home-transformaciones" path="body" as="span">{TRANSFORMACIONES.body}</EditableText></p>
          </div>
          <div className="compare" data-reveal="scale">
            <div className="cmp-frame" id="compare-frame">
              <Editable as="img" editId="home:compareAfter" className="cmp-img cmp-after" src="/assets/compare-after.jpg" alt="Después del corte" loading="lazy" decoding="async" />
              <Editable as="img" editId="home:compareBefore" className="cmp-img cmp-before" src="/assets/compare-before.jpg" alt="Antes del corte" loading="lazy" decoding="async" />
              <span className="cmp-tag before"><EditableText file="home-transformaciones" path="tagBefore">{TRANSFORMACIONES.tagBefore}</EditableText></span>
              <span className="cmp-tag after"><EditableText file="home-transformaciones" path="tagAfter">{TRANSFORMACIONES.tagAfter}</EditableText></span>
              <div className="cmp-divider" />
              <div className="cmp-handle">
                <svg viewBox="0 0 24 24"><path d="M8 7l-4 5 4 5M16 7l4 5-4 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
            </div>
          </div>
        </section>

        {/* ============ EXPERIENCIAS (carousel) ============ */}
        <section className="feature-section apple-carousel" id="experiencias">
          <div className="feature-head" data-reveal>
            <p className="kicker"><EditableText file="home-experiencias" path="kicker">{EXPERIENCIAS.kicker}</EditableText></p>
            <h2><EditableText file="home-experiencias" path="h2" as="span">{EXPERIENCIAS.h2}</EditableText></h2>
            <p><EditableText file="home-experiencias" path="body" as="span">{EXPERIENCIAS.body}</EditableText></p>
          </div>
          <div className="ac-arrows">
            <button className="ac-arrow" type="button" aria-label="Anterior" onClick={() => scrollTrack(-1)}>
              <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button className="ac-arrow" type="button" aria-label="Siguiente" onClick={() => scrollTrack(1)}>
              <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
          <div className="ac-track" ref={trackRef}>
            {CARDS.map((c, i) => (
              <article className="ac-card" tabIndex={0} key={i}
                onClick={() => setModal(i)}
                onKeyDown={(e) => { if (e.key === 'Enter') setModal(i) }}>
                <img src={c.img} alt={c.title} loading="lazy" />
                <div className="ac-text">
                  <p className="ac-cat"><EditableText file="home-experiencias" path={`cards.${i}.cat`}>{c.cat}</EditableText></p>
                  <h3 className="ac-title"><EditableText file="home-experiencias" path={`cards.${i}.title`}>{c.title}</EditableText></h3>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ============ CURSOS TEASER ============ */}
        <section className="bsection" id="cursos-teaser">
          <div className="bwrap">
            <div className="bteaser" data-reveal="scale">
              <div className="bteaser-bg"><Editable as="img" editId="home-cursos:teaserBg" src="/assets/workshop-2026.jpg" alt="Workshop Brunetti con su comunidad de barberos" loading="lazy" decoding="async" /></div>
              <div className="bteaser-inner">
                <Lamp className="bru-lamp--teaser" />
                <p className="kicker"><EditableText file="home-cursos-teaser" path="kicker">{CURSOS_TEASER.kicker}</EditableText></p>
                <h2><EditableText file="home-cursos-teaser" path="h2" as="span">{CURSOS_TEASER.h2}</EditableText></h2>
                <p><EditableText file="home-cursos-teaser" path="body" as="span">{CURSOS_TEASER.body}</EditableText></p>
                <div className="bteaser-modchips">
                  <span><EditableText file="home-cursos-teaser" path="chip1">{CURSOS_TEASER.chip1}</EditableText></span>
                  <span><EditableText file="home-cursos-teaser" path="chip2">{CURSOS_TEASER.chip2}</EditableText></span>
                  <span><EditableText file="home-cursos-teaser" path="chip3">{CURSOS_TEASER.chip3}</EditableText></span>
                </div>
                <a className="btn btn-primary" onClick={goCursos}><EditableText file="home-cursos-teaser" path="cta">{CURSOS_TEASER.cta}</EditableText></a>
              </div>
            </div>
          </div>
        </section>

        {/* ============ TESTIMONIOS ============ */}
        <section className="feature-section testimonials-section" id="opiniones">
          <div className="feature-head" data-reveal>
            <p className="kicker"><EditableText file="home-testimonios" path="kicker">{TESTIMONIOS_INTRO.kicker}</EditableText></p>
            <h2><EditableText file="home-testimonios" path="h2" as="span">{TESTIMONIOS_INTRO.h2}</EditableText></h2>
          </div>
          <div className="testimonials" data-reveal>
            <div className="tm-stage">
              {TESTIMONIALS.map((t, i) => (
                <figure className={`tm-photo${i === tmIdx ? ' is-active' : ''}${i === (tmIdx - 1 + TESTIMONIALS.length) % TESTIMONIALS.length ? ' is-prev' : ''}`} key={t.name}>
                  <img src={t.img} alt={`Cliente Brunetti: ${t.name}`} loading="lazy" />
                </figure>
              ))}
            </div>
            <div className="tm-body">
              {editing ? (
                // En modo edición mostramos el texto plano y editable, sin la
                // animación palabra por palabra (que no convive bien con
                // contentEditable).
                <p className="tm-quote">
                  <EditableText file="home-testimonios" path={`items.${tmIdx}.quote`} as="span">{tm.quote}</EditableText>
                </p>
              ) : (
                <p className="tm-quote" key={tmReveal}>
                  {tm.quote.split(' ').map((w, i) => (
                    <TmWord key={i} delay={40 + i * 24}>{w}</TmWord>
                  ))}
                </p>
              )}
              <div className="tm-meta">
                <strong className="tm-name"><EditableText file="home-testimonios" path={`items.${tmIdx}.name`}>{tm.name}</EditableText></strong>
                <span className="tm-role"><EditableText file="home-testimonios" path={`items.${tmIdx}.role`}>{tm.role}</EditableText></span>
              </div>
              <div className="tm-controls">
                <button className="tm-btn" type="button" aria-label="Anterior" onClick={() => tmGo(-1)}>
                  <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button className="tm-btn" type="button" aria-label="Siguiente" onClick={() => tmGo(1)}>
                  <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ============ CONTACTO ============ */}
        <section id="contacto" className="bsection">
          <div className="bwrap">
            <div className="bhead center" data-reveal>
              <p className="kicker"><EditableText file="home-contacto" path="kicker">{CONTACTO.kicker}</EditableText></p>
              <h2><EditableText file="home-contacto" path="h2" as="span">{CONTACTO.h2}</EditableText></h2>
              <p><EditableText file="home-contacto" path="body" as="span">{CONTACTO.body}</EditableText></p>
            </div>
            <div className="bcontact-grid">
              <div className="bcard" data-reveal="left">
                <h3><EditableText file="home-contacto" path="cardTitle">{CONTACTO.cardTitle}</EditableText></h3>
                <ul className="bcontact-list">
                  <li><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg><EditableText file="home-contacto" path="hours">{CONTACTO.hours}</EditableText></li>
                  <li><svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.5a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" /></svg><a href="tel:+56987483279">(+56) 9 8748 3279</a></li>
                  <li><svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" /></svg><a href="mailto:hola@brunetti.cl">hola@brunetti.cl</a></li>
                </ul>
                <div className="bcontact-actions" style={{ marginTop: '1.4rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <a className="btn btn-primary" onClick={goReserve}><EditableText file="home-contacto" path="ctaReserve">{CONTACTO.ctaReserve}</EditableText></a>
                  <a className="btn btn-ghost" onClick={goCursos}><EditableText file="home-contacto" path="ctaCursos">{CONTACTO.ctaCursos}</EditableText></a>
                </div>
              </div>
              <div className="bsocial" data-reveal="right">
                <a className="bwa-btn" href="https://wa.me/56987483279?text=Hola%20Bruno%2C%20quiero%20agendar%20una%20hora." target="_blank" rel="noopener noreferrer">
                  <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
                  <EditableText file="home-contacto" path="waLabel">{CONTACTO.waLabel}</EditableText>
                </a>
                <a className="bsocial-ig" href="https://instagram.com/brunetticutz" target="_blank" rel="noopener noreferrer">
                  <span className="ig-ic">
                    <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" /></svg>
                  </span>
                  <span>
                    <b><EditableText file="home-contacto" path="igHandle">{CONTACTO.igHandle}</EditableText></b>
                    <span><EditableText file="home-contacto" path="igLabel">{CONTACTO.igLabel}</EditableText></span>
                  </span>
                </a>
                <div className="bcard" style={{ padding: '1.2rem' }}>
                  <p style={{ margin: 0, color: 'var(--ink-2)', lineHeight: 1.6 }}>¿Eres barbero y quieres formarte? El módulo de <a onClick={goCursos} style={{ color: 'var(--gold-bright)', cursor: 'pointer' }}>Cursos</a> tiene toda la información e inscripción.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
        </div>

      </main>

      <ModuleFooter
        logoSrc="/assets/brunetti-hero-wordmark.webp"
        links={[
          [() => navTo('visagismo'), 'Visagismo'],
          [() => navTo('servicios'), 'Servicios'],
          [goStyle, 'Encuentra tu estilo'],
          [goCursos, 'Cursos'],
          [goWorkshop, 'Workshop'],
          [() => navTo('contacto'), 'Contacto'],
        ]}
        onPrimary={goReserve}
        primaryLabel="Reservar hora"
      />

      {/* ============ MODAL CARRUSEL ============ */}
      <div className={`ac-modal${modal !== null ? ' is-open' : ''}`} role="dialog" aria-modal="true">
        <div className="ac-modal-scrim" onClick={() => setModal(null)} />
        <div className="ac-modal-card">
          <button className="ac-close" type="button" aria-label="Cerrar" onClick={() => setModal(null)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>
          {modal !== null && (
            <>
              <img className="ac-m-img" src={CARDS[modal].img} alt={CARDS[modal].title} />
              <div className="ac-modal-body">
                <p className="ac-cat"><EditableText file="home-experiencias" path={`cards.${modal}.cat`}>{CARDS[modal].cat}</EditableText></p>
                <h3><EditableText file="home-experiencias" path={`cards.${modal}.title`} as="span">{CARDS[modal].title}</EditableText></h3>
                <p className="ac-m-body-text"><EditableText file="home-experiencias" path={`cards.${modal}.body`} as="span">{CARDS[modal].body}</EditableText></p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* Palabra de testimonio: entra con blur/translate (efecto word-by-word). */
function TmWord({ children, delay }) {
  const [pre, setPre] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setPre(false), delay)
    return () => clearTimeout(t)
  }, [delay])
  return <span className={pre ? 'pre' : ''}>{children} </span>
}
