import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../components/theme.jsx'
import SiteNav from '../components/SiteNav.jsx'
import ModuleFooter from '../components/ModuleFooter.jsx'
import { FACE_SHAPES, GALLERY_CATS, GALLERY, HERO_PHOTOS, u } from '../data/estilo.js'
import { EditableText } from '../components/edit/EditableText.jsx'
import { Editable } from '../components/edit/Editable.jsx'
import { Sparkles } from '../components/ui/sparkles.jsx'
import ESTILO from '../data/content/estilo.json'
import '../styles/estilo.css'

/* ============================================================
   ENCUENTRA TU ESTILO — Visagismo interactivo + galería
   Port a React del módulo del paquete (eu/estilo.*). Contenido
   scopeado bajo .ete (tokens premium propios), pero envuelto en
   .brunetti-site para COMPARTIR el chrome del sitio:
   - Nav global (SiteNav): mismo navbar + menú móvil para navegar
     todo el proyecto + botón flotante "Reservar hora" en móvil.
   - Footer global (ModuleFooter): mismo footer de Home/Cursos.
   El tema lo controla el toggle GLOBAL (FloatingThemeToggle):
   reflejamos `theme` en data-theme del root .ete para activar los
   tokens de modo claro premium definidos en estilo.css.
   Se omite el panel de Tweaks; reservar usa el flujo real /reservar.
   ============================================================ */

/* ---- iconos (stroke) ---- */
function Icon({ name, size = 20 }) {
  const p = {
    target: (<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" /></>),
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    alert: (<><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></>),
    spark: <path d="M12 2l2.2 6.8H21l-5.5 4 2.1 6.8L12 15.6 6.4 19.6l2.1-6.8L3 8.8h6.8z" />,
    insta: (<><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" /></>),
  }[name]
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{p}</svg>
  )
}

/* ---- imagen con respaldo (degrada a placeholder etiquetado) ---- */
function SmartImg({ src, alt, label }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={'ete-img' + (failed ? ' is-failed' : '')} data-label={label || alt || 'Foto'}>
      <img src={src} alt={alt || ''} loading="lazy" onError={() => setFailed(true)} />
    </div>
  )
}

/* ---- silueta de forma de rostro ---- */
function FaceGlyph({ path }) {
  return <svg viewBox="0 0 100 120" aria-hidden="true"><path d={path} /></svg>
}

/* ---- reveal on scroll ---- */
function useReveal() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('is-in')
      return
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) } })
    }, { threshold: 0.12 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return ref
}
function Reveal({ children, className = '', style }) {
  const ref = useReveal()
  return <div ref={ref} className={'ete-reveal ' + className} style={style}>{children}</div>
}

function smoothScroll(id) {
  const el = document.getElementById(id)
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY - 64
  const reduce = 'matchMedia' in window && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
}

/* ---------- HERO ---------- */
function Hero() {
  const [heroIndex, setHeroIndex] = useState(0)

  useEffect(() => {
    const reduce = 'matchMedia' in window && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || HERO_PHOTOS.length < 2) return
    const id = setInterval(() => setHeroIndex((i) => (i + 1) % HERO_PHOTOS.length), 4000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="ete-hero">
      <div className="ete-hero-media">
        {HERO_PHOTOS.map((file, i) => (
          <Editable key={file} as="img" editId={`estilo-hero:${i}`} src={u(file)} alt={i === 0 ? 'Asesoría de imagen en Brunetti' : ''}
            className={i === heroIndex ? 'is-active' : ''}
            onError={(e) => { e.target.parentElement.style.background = 'linear-gradient(160deg,#1a1916,#0a0a09)' }} />
        ))}
      </div>
      <div className="ete-hero-overlay" />
      <div className="ete-wrap ete-hero-inner">
        <div className="ete-hero-kicker">
          <span className="ete-eyebrow"><EditableText file="estilo" path="hero.eyebrow">{ESTILO.hero.eyebrow}</EditableText></span>
          <span className="ete-chip"><Icon name="spark" size={13} /> <EditableText file="estilo" path="hero.chip">{ESTILO.hero.chip}</EditableText></span>
        </div>
        <h1><EditableText file="estilo" path="hero.title1">{ESTILO.hero.title1}</EditableText><span className="l2"><EditableText file="estilo" path="hero.title2">{ESTILO.hero.title2}</EditableText></span></h1>
        <p className="ete-hero-sub">
          <EditableText file="estilo" path="hero.sub" as="span">{ESTILO.hero.sub}</EditableText>
        </p>
        <div className="ete-hero-actions">
          <button className="ete-btn ete-btn-gold" type="button" onClick={() => smoothScroll('visagismo')}>
            <EditableText file="estilo" path="hero.ctaPrimary">{ESTILO.hero.ctaPrimary}</EditableText> <Icon name="arrow" size={16} />
          </button>
          <button className="ete-btn ete-btn-ghost" type="button" onClick={() => smoothScroll('galeria')}><EditableText file="estilo" path="hero.ctaSecondary">{ESTILO.hero.ctaSecondary}</EditableText></button>
        </div>
        <div className="ete-hero-stats">
          <div className="s"><b>6</b><span><EditableText file="estilo" path="hero.stat1Label">{ESTILO.hero.stat1Label}</EditableText></span></div>
          <div className="s"><b>+30</b><span><EditableText file="estilo" path="hero.stat2Label">{ESTILO.hero.stat2Label}</EditableText></span></div>
          <div className="s"><b>100%</b><span><EditableText file="estilo" path="hero.stat3Label">{ESTILO.hero.stat3Label}</EditableText></span></div>
        </div>
      </div>
    </header>
  )
}

/* ---------- VISAGISMO ---------- */
function Visagismo({ onReserveService }) {
  const [sel, setSel] = useState(null)
  const shapeIdx = FACE_SHAPES.findIndex((s) => s.id === sel)
  const shape = shapeIdx >= 0 ? FACE_SHAPES[shapeIdx] : null
  const sc = shapeIdx >= 0 ? ESTILO.faceShapes[shapeIdx] : null
  return (
    <section className="ete-section" id="visagismo">
      <div className="ete-wrap">
        <Reveal>
          <div className="ete-head">
            <span className="ete-eyebrow"><EditableText file="estilo" path="visagismo.eyebrow">{ESTILO.visagismo.eyebrow}</EditableText></span>
            <h2 className="ete-h2"><EditableText file="estilo" path="visagismo.h2">{ESTILO.visagismo.h2}</EditableText> <span className="ete-gold-text"><EditableText file="estilo" path="visagismo.h2Highlight">{ESTILO.visagismo.h2Highlight}</EditableText></span></h2>
            <p className="ete-lead">
              <EditableText file="estilo" path="visagismo.lead" as="span">{ESTILO.visagismo.lead}</EditableText>
            </p>
          </div>
        </Reveal>

        <Reveal>
          <div className="ete-vis-steps">
            <span className="ete-step-pill is-active"><b>1</b> <EditableText file="estilo" path="visagismo.step1">{ESTILO.visagismo.step1}</EditableText></span>
            <span className={'ete-step-pill' + (shape ? ' is-active' : '')}><b>2</b> <EditableText file="estilo" path="visagismo.step2">{ESTILO.visagismo.step2}</EditableText></span>
            <span className="ete-step-pill"><b>3</b> <EditableText file="estilo" path="visagismo.step3">{ESTILO.visagismo.step3}</EditableText></span>
          </div>

          <div className="ete-shape-grid">
            {FACE_SHAPES.map((s, i) => (
              <button key={s.id} className={'ete-shape' + (sel === s.id ? ' is-active' : '')}
                type="button" onClick={() => setSel(s.id)} aria-pressed={sel === s.id}>
                <FaceGlyph path={s.path} />
                <span className="nm"><EditableText file="estilo" path={`faceShapes.${i}.name`}>{ESTILO.faceShapes[i].name}</EditableText></span>
                <span className="tg"><EditableText file="estilo" path={`faceShapes.${i}.tagline`}>{ESTILO.faceShapes[i].tagline}</EditableText></span>
              </button>
            ))}
          </div>
        </Reveal>

        {!shape && (
          <div className="ete-empty">
            <Icon name="target" size={40} />
            <p style={{ margin: 0 }}><EditableText file="estilo" path="visagismo.emptyText" as="span">{ESTILO.visagismo.emptyText}</EditableText></p>
          </div>
        )}

        {shape && (
          <div className="ete-result" key={shape.id}>
            <div className="ete-result-top">
              <div className="ete-result-diag">
                <span className="ete-eyebrow">Rostro {sc.name.toLowerCase()}</span>
                <h3><EditableText file="estilo" path={`faceShapes.${shapeIdx}.tagline`} as="span">{sc.tagline}</EditableText></h3>
                <p className="diag"><EditableText file="estilo" path={`faceShapes.${shapeIdx}.diagnosis`} as="span">{sc.diagnosis}</EditableText></p>
                <div className="ete-traits">
                  {sc.traits.map((t, i) => <span className="ete-chip" key={i}><EditableText file="estilo" path={`faceShapes.${shapeIdx}.traits.${i}`}>{t}</EditableText></span>)}
                </div>
                <div className="ete-goal">
                  <span className="ic"><Icon name="target" size={20} /></span>
                  <span><b>Objetivo: </b><span><EditableText file="estilo" path={`faceShapes.${shapeIdx}.goal`} as="span">{sc.goal}</EditableText></span></span>
                </div>
              </div>
              <div className="ete-result-figure">
                <SmartImg src={shape.best[0].img} alt={'Estilo recomendado para rostro ' + sc.name} label={'Rostro ' + sc.name} />
                <span className="ete-chip tag">Look de referencia</span>
              </div>
            </div>

            <div className="ete-best">
              <p className="ete-best-label"><EditableText file="estilo" path="visagismo.bestLabel">{ESTILO.visagismo.bestLabel}</EditableText></p>
              <div className="ete-best-grid">
                {shape.best.map((c, i) => (
                  <article className="ete-cut" key={i}>
                    <SmartImg src={c.img} alt={sc.best[i].name} label={sc.best[i].name} />
                    <div className="ete-cut-body">
                      <h4><EditableText file="estilo" path={`faceShapes.${shapeIdx}.best.${i}.name`} as="span">{sc.best[i].name}</EditableText></h4>
                      <p><EditableText file="estilo" path={`faceShapes.${shapeIdx}.best.${i}.note`} as="span">{sc.best[i].note}</EditableText></p>
                    </div>
                  </article>
                ))}
              </div>
              <p className="ete-avoid">
                <span className="ic"><Icon name="alert" size={18} /></span>
                <span><b>Evita: </b><EditableText file="estilo" path={`faceShapes.${shapeIdx}.avoid`} as="span">{sc.avoid}</EditableText></span>
              </p>
              <div className="ete-best-cta">
                <button className="ete-btn ete-btn-gold" type="button" onClick={() => onReserveService(10)}><EditableText file="estilo" path="visagismo.ctaPrimary">{ESTILO.visagismo.ctaPrimary}</EditableText><span className="ete-hide-mobile">&nbsp;<EditableText file="estilo" path="visagismo.ctaPrimarySuffix">{ESTILO.visagismo.ctaPrimarySuffix}</EditableText></span> <Icon name="arrow" size={16} /></button>
                <button className="ete-btn ete-btn-ghost" type="button" onClick={() => smoothScroll('galeria')}><EditableText file="estilo" path="visagismo.ctaSecondary">{ESTILO.visagismo.ctaSecondary}</EditableText></button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/* ---------- GALERÍA ---------- */
function Galeria() {
  const [cat, setCat] = useState('Todos')
  // Conservamos el índice ORIGINAL de cada item (antes de filtrar) para que
  // apunte siempre a la misma entrada de estilo.json, sin importar qué
  // categoría esté activa.
  const indexed = GALLERY.map((g, originalIndex) => ({ ...g, originalIndex }))
  const items = cat === 'Todos' ? indexed : indexed.filter((g) => g.cat === cat)
  return (
    <section className="ete-section ete-section-alt" id="galeria">
      <div className="ete-wrap">
        <Reveal>
          <div className="ete-head">
            <span className="ete-eyebrow"><EditableText file="estilo" path="galeria.eyebrow">{ESTILO.galeria.eyebrow}</EditableText></span>
            <h2 className="ete-h2"><EditableText file="estilo" path="galeria.h2">{ESTILO.galeria.h2}</EditableText> <span className="ete-gold-text"><EditableText file="estilo" path="galeria.h2Highlight">{ESTILO.galeria.h2Highlight}</EditableText></span></h2>
            <p className="ete-lead">
              <EditableText file="estilo" path="galeria.lead" as="span">{ESTILO.galeria.lead}</EditableText>
            </p>
          </div>
        </Reveal>

        <Reveal>
          <div className="ete-filters">
            {GALLERY_CATS.map((c) => (
              <button key={c} type="button" className={'ete-filter' + (cat === c ? ' is-active' : '')} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
        </Reveal>

        <div className="ete-gallery">
          {items.map((g) => (
            <article className="ete-gcard" key={g.title + g.originalIndex}>
              <span className="ete-gcard-cat">{g.cat}</span>
              <SmartImg src={g.img} alt={ESTILO.galeria.items[g.originalIndex].title} label={ESTILO.galeria.items[g.originalIndex].title} />
              <div className="ete-gcard-body">
                <h4><EditableText file="estilo" path={`galeria.items.${g.originalIndex}.title`} as="span">{ESTILO.galeria.items[g.originalIndex].title}</EditableText></h4>
                <p><EditableText file="estilo" path={`galeria.items.${g.originalIndex}.sub`} as="span">{ESTILO.galeria.items[g.originalIndex].sub}</EditableText></p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------- CTA ---------- */
function CtaBand({ onReserveService }) {
  return (
    <section className="ete-section ete-cta">
      <div className="ete-cta-bg">
        <Editable as="img" editId="estilo:ctaBg" src={u('estilo-textura-spiky.jpg')} alt="" aria-hidden="true"
          onError={(e) => { e.target.parentElement.style.background = 'var(--bg-1)' }} />
      </div>
      <div className="ete-wrap">
        <Reveal>
          <div className="ete-cta-card">
            <span className="ete-eyebrow is-center"><EditableText file="estilo" path="cta.eyebrow">{ESTILO.cta.eyebrow}</EditableText></span>
            <h2><EditableText file="estilo" path="cta.h2" as="span">{ESTILO.cta.h2}</EditableText></h2>
            <p><EditableText file="estilo" path="cta.body" as="span">{ESTILO.cta.body}</EditableText></p>
            <div className="ete-cta-actions">
              <button className="ete-btn ete-btn-gold" type="button" onClick={() => onReserveService(10)}><EditableText file="estilo" path="cta.ctaPrimary">{ESTILO.cta.ctaPrimary}</EditableText> <Icon name="arrow" size={16} /></button>
              <a className="ete-btn ete-btn-ghost" href="https://instagram.com/brunetticutz" target="_blank" rel="noopener noreferrer">
                <Icon name="insta" size={16} /> <EditableText file="estilo" path="cta.igHandle">{ESTILO.cta.igHandle}</EditableText>
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ---------- PÁGINA ---------- */
export default function EncuentraEstilo() {
  const navigate = useNavigate()
  const { theme } = useTheme()

  const reserve = () => navigate('/reservar')
  const reserveService = (id) => {
    try { localStorage.setItem('ps_pending_service', String(id)) } catch (e) { /* noop */ }
    navigate('/reservar')
  }

  return (
    <div className="brunetti-site estilo-page">
      <SiteNav />
      <div className="ete" data-theme={theme}>
        <div className="ete-shell">
          <Hero />
          {/* Fondo de partículas doradas para el cuerpo (hero fuera). Es un
              efecto de fondo oscuro: en claro no se monta. */}
          <div className="bru-sparkles-zone">
            {theme !== 'light' && <Sparkles className="bru-sparkles--bg" color="201, 161, 78" />}
            <Visagismo onReserveService={reserveService} />
            <Galeria />
            <CtaBand onReserveService={reserveService} />
          </div>
        </div>
      </div>
      <ModuleFooter
        logoSrc="/assets/brunetti-hero-wordmark.webp"
        links={[
          [() => smoothScroll('visagismo'), 'Visagismo'],
          [() => smoothScroll('galeria'), 'Galería'],
          [() => navigate('/cursos'), 'Cursos'],
          [() => navigate('/workshop'), 'Workshop'],
        ]}
        onPrimary={reserve}
        primaryLabel="Reservar hora"
      />
    </div>
  )
}
