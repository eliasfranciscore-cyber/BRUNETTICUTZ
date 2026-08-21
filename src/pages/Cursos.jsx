import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBrunettiFx, scrollToId } from '../components/brunetti.jsx'
import SiteNav from '../components/SiteNav.jsx'
import ModuleFooter from '../components/ModuleFooter.jsx'
import { Lamp } from '../components/ui/lamp.jsx'
import { Sparkles } from '../components/ui/sparkles.jsx'
import MercadoPagoCheckout from '../components/MercadoPagoCheckout.jsx'
import { EditableText } from '../components/edit/EditableText.jsx'
import { Editable } from '../components/edit/Editable.jsx'
import CURSOS from '../data/content/cursos.json'

/* ================================================================
   CURSOS BRUNETTI — Formación en visagismo & barbería
   Flujo: usuario ve módulos → paga vía Mercado Pago → accede a Skool
   ================================================================ */

// La duración de cada lección es dato fijo (no editable por texto libre); el
// título de la lección y del módulo sí viven en cursos.json y llegan por índice.
const LESSON_DURATIONS = [
  ['07:30', '05:30', '05:00'],
  ['07:30', '08:30', '08:30', '07:30'],
  ['07:30', '08:30', '09:30', '08:30'],
  ['07:30', '09:30', '07:30'],
  ['07:30', '08:30', '07:30'],
  ['07:30', '08:30', '08:30', '07:30'],
]
const MODULES = CURSOS.curriculum.modules.map((m, i) => ({
  t: m.t,
  d: m.d,
  lessons: m.lessons.map((title, j) => [title, LESSON_DURATIONS[i][j]]),
}))

const INCLUDE_ICONS = [
  (<><circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" /></>),
  (<path d="M14 4l6 6M3 21l3-1 11-11-2-2L4 18z" />),
  (<><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 3l-4 4-4-4" /></>),
  (<path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2-6.3-4.6L5.7 21l2.3-7.2-6-4.4h7.6z" />),
]
const INCLUDES = CURSOS.intro.includes.map((it, i) => ({ ...it, icon: INCLUDE_ICONS[i] }))

export default function Cursos() {
  const navigate = useNavigate()
  const rootRef = useRef(null)
  const [openIdx, setOpenIdx] = useState(-1)

  useBrunettiFx(rootRef, { parallax: false })

  const goHomeSection = (section) => navigate('/', { state: { section } })
  const goAnchor = (id) => scrollToId(id)

  return (
    <div className="brunetti-site cursos-page" ref={rootRef}>
      <SiteNav />

      <main>
        {/* ============ HERO ============ */}
        <section className="course-hero">
          <div className="course-hero-bg" aria-hidden="true"><Editable as="img" editId="cursos:heroBg" src="/assets/bruno-hero-bg.webp" alt="" fetchpriority="high" decoding="async" /></div>
          <div className="course-hero-inner">
            <span className="bhero-kicker"><span className="dot" /><EditableText file="cursos" path="hero.kicker">{CURSOS.hero.kicker}</EditableText></span>
            <h1><EditableText file="cursos" path="hero.title1">{CURSOS.hero.title1}</EditableText><br /><EditableText file="cursos" path="hero.title2">{CURSOS.hero.title2}</EditableText></h1>
            <p className="sub"><EditableText file="cursos" path="hero.sub" as="span">{CURSOS.hero.sub}</EditableText></p>
            <div className="actions">
              <a className="btn btn-primary" onClick={() => goAnchor('inscripcion')}><EditableText file="cursos" path="hero.ctaPrimary">{CURSOS.hero.ctaPrimary}</EditableText></a>
              <a className="btn btn-ghost" onClick={() => goAnchor('curriculum')}><EditableText file="cursos" path="hero.ctaSecondary">{CURSOS.hero.ctaSecondary}</EditableText></a>
            </div>
            <div className="course-stats">
              <div className="cst"><strong data-count="6">0</strong><span><EditableText file="cursos" path="hero.stat1Label">{CURSOS.hero.stat1Label}</EditableText></span></div>
              <div className="cst"><strong data-count="21">0</strong><span><EditableText file="cursos" path="hero.stat2Label">{CURSOS.hero.stat2Label}</EditableText></span></div>
              <div className="cst"><strong data-count="100" data-suffix="%">0</strong><span><EditableText file="cursos" path="hero.stat3Label">{CURSOS.hero.stat3Label}</EditableText></span></div>
              <div className="cst"><strong>∞</strong><span><EditableText file="cursos" path="hero.stat4Label">{CURSOS.hero.stat4Label}</EditableText></span></div>
            </div>
          </div>
          <div className="course-hero-figwrap" aria-hidden="true">
            <Editable as="img" editId="cursos:heroCutout" src="/assets/cursos-hero-cutout.webp" alt="" />
          </div>
        </section>

        {/* Fondo de partículas azules para el cuerpo de cursos (hero fuera). */}
        <div className="bru-sparkles-zone">
          <Sparkles className="bru-sparkles--bg" color="107, 116, 240" />

        {/* ============ INTRO ============ */}
        <section className="bsection">
          <div className="bwrap">
            <div className="bhead center" data-reveal>
              <p className="kicker"><EditableText file="cursos" path="intro.kicker">{CURSOS.intro.kicker}</EditableText></p>
              <h2><EditableText file="cursos" path="intro.h2" as="span">{CURSOS.intro.h2}</EditableText></h2>
              <p><EditableText file="cursos" path="intro.body" as="span">{CURSOS.intro.body}</EditableText></p>
            </div>
            <div className="includes-grid">
              {INCLUDES.map((it, i) => (
                <div className="include" data-reveal style={{ '--i': i }} key={it.b}>
                  <svg viewBox="0 0 24 24">{it.icon}</svg>
                  <div>
                    <b><EditableText file="cursos" path={`intro.includes.${i}.b`}>{it.b}</EditableText></b>
                    <span><EditableText file="cursos" path={`intro.includes.${i}.s`}>{it.s}</EditableText></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ CURRICULUM ============ */}
        <section className="bsection wk-alt" id="curriculum">
          <div className="bwrap">
            <div className="bhead center" data-reveal>
              <p className="kicker"><EditableText file="cursos" path="curriculum.kicker">{CURSOS.curriculum.kicker}</EditableText></p>
              <h2><EditableText file="cursos" path="curriculum.h2" as="span">{CURSOS.curriculum.h2}</EditableText></h2>
              <p><EditableText file="cursos" path="curriculum.body" as="span">{CURSOS.curriculum.body}</EditableText></p>
            </div>
            <div className="modules">
              {MODULES.map((m, i) => {
                const num = (i + 1 < 10 ? '0' : '') + (i + 1)
                const open = openIdx === i
                return (
                  <article className={`module${open ? ' is-open' : ''}`} key={m.t}>
                    <button className="module-head" type="button" aria-expanded={open} onClick={() => setOpenIdx(open ? -1 : i)}>
                      <span className="module-num">{num}</span>
                      <span className="module-titles">
                        <h3><EditableText file="cursos" path={`curriculum.modules.${i}.t`} as="span">{m.t}</EditableText></h3>
                        <p><EditableText file="cursos" path={`curriculum.modules.${i}.d`} as="span">{m.d}</EditableText></p>
                      </span>
                      <span className="module-meta">
                        <span className="module-count">{m.lessons.length} lecciones</span>
                        <span className="module-chevron"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg></span>
                      </span>
                    </button>
                    <div className="module-body"><div className="module-body-inner"><ul className="lessons">
                      {m.lessons.map((l, j) => (
                        <li className="lesson" key={l[0]}>
                          <span className="play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
                          <span className="ltitle"><EditableText file="cursos" path={`curriculum.modules.${i}.lessons.${j}`} as="span">{l[0]}</EditableText></span>
                          <span className="ldur">{l[1]}</span>
                          <span className="lock"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span>
                        </li>
                      ))}
                    </ul></div></div>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        {/* ============ CHECKOUT ============ */}
        <section className="bsection bsection-lamp" id="inscripcion">
          <div className="bwrap">
            <div className="bhead center" data-reveal>
              <Lamp className="bru-lamp--sec" />
              <p className="kicker"><EditableText file="cursos" path="checkout.kicker">{CURSOS.checkout.kicker}</EditableText></p>
              <h2><EditableText file="cursos" path="checkout.h2" as="span">{CURSOS.checkout.h2}</EditableText></h2>
              <p><EditableText file="cursos" path="checkout.body" as="span">{CURSOS.checkout.body}</EditableText></p>
            </div>

            <MercadoPagoCheckout />
          </div>
        </section>
        </div>
      </main>

      <ModuleFooter
        logoSrc="/assets/brunetti-cursos-wordmark.webp"
        links={[
          [() => goAnchor('curriculum'), 'Programa'],
          [() => goAnchor('inscripcion'), 'Acceder'],
          [() => goHomeSection('visagismo'), 'Visagismo'],
          [() => navigate('/workshop'), 'Workshop'],
          [() => goHomeSection('contacto'), 'Contacto'],
        ]}
        onPrimary={() => goAnchor('inscripcion')}
        primaryLabel="Acceder al curso"
      />
    </div>
  )
}
