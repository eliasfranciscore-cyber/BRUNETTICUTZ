import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBrunettiFx, scrollToId } from '../components/brunetti.jsx'
import SiteNav from '../components/SiteNav.jsx'
import ModuleFooter from '../components/ModuleFooter.jsx'
import { Lamp } from '../components/ui/lamp.jsx'
import { Sparkles } from '../components/ui/sparkles.jsx'
import { useTheme } from '../components/theme.jsx'
import MercadoPagoCheckout from '../components/MercadoPagoCheckout.jsx'
import { EditableText } from '../components/edit/EditableText.jsx'
import { Editable } from '../components/edit/Editable.jsx'
import CURSOS from '../data/content/cursos.json'
import { hasSession } from '../academy/session.js'
import { r } from '../academy/routes.js'
import { ACADEMY_BRAND } from '../academy/hostConfig.js'

/* ================================================================
   CURSOS BRUNETTI — Formación en visagismo & barbería
   Flujo: usuario ve módulos → paga vía Mercado Pago → le llega por correo
   su acceso a la Brunetti Academy (/cursos/ingreso) con el curso adentro.

   Es la página pública (índice) de la Academy: la monta
   src/pages/academy/AcademyRoot.jsx a través de src/academy/host.jsx
   (PublicLanding). Las entradas a la app del miembro (/cursos/ingreso,
   /cursos/comunidad) son navegaciones DURAS: /cursos/(.+) tiene su propio
   CSP y un documento conserva el CSP con el que cargó.
   ================================================================ */

// Con sesión de alumno, a su comunidad; si no, al ingreso.
function goToAcademy() {
  window.location.assign(hasSession() ? r.comunidad : r.ingreso)
}

const INSTAGRAM = ACADEMY_BRAND.instagram || 'brunetticutz'

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
  // Las partículas son un efecto de fondo oscuro: en claro no se montan.
  const { theme } = useTheme()
  // ¿Este navegador ya tiene sesión de alumno? Cambia el texto del acceso.
  const [member] = useState(() => hasSession())

  useBrunettiFx(rootRef, { parallax: false })

  // Deep link /cursos#inscripcion (o #terminos): el "Comprar" de un curso
  // bloqueado dentro de la Academy (host.jsx → catalogHref) llega con
  // navegación dura, y el navegador intenta el ancla antes de que esta página
  // (un chunk diferido) exista. Se baja a mano cuando ya está montada.
  useEffect(() => {
    const id = String(window.location.hash || '').replace(/^#/, '')
    if (id !== 'inscripcion' && id !== 'terminos') return
    const t = setTimeout(() => scrollToId(id), 250)
    return () => clearTimeout(t)
  }, [])

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
          {theme !== 'light' && <Sparkles className="bru-sparkles--bg" color="107, 116, 240" />}

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
              {/* Para quien ya pagó (o vuelve por el link del correo): un <a>
                  común, o sea navegación DURA — /cursos/(.+) tiene su propio
                  CSP y no se entra con el router. */}
              <p style={{ marginTop: '0.9rem', fontSize: '0.92rem' }}>
                {member ? 'Ya eres parte. ' : '¿Ya compraste? '}
                <a href={member ? r.comunidad : r.ingreso} style={{ color: 'inherit', textDecoration: 'underline', fontWeight: 600 }}>
                  Entra a la Academy
                </a>
              </p>
            </div>

            <MercadoPagoCheckout />
          </div>
        </section>

        <TermsSection />
        </div>
      </main>

      <ModuleFooter
        logoSrc="/assets/brunetti-cursos-wordmark.webp"
        links={[
          [() => goAnchor('curriculum'), 'Programa'],
          [() => goAnchor('inscripcion'), 'Acceder'],
          [goToAcademy, 'Entrar a la Academy'],
          [() => goHomeSection('visagismo'), 'Visagismo'],
          [() => navigate('/workshop'), 'Workshop'],
          [() => goAnchor('terminos'), 'Términos y privacidad'],
          [() => goHomeSection('contacto'), 'Contacto'],
        ]}
        onPrimary={() => goAnchor('inscripcion')}
        primaryLabel="Acceder al curso"
      />
    </div>
  )
}

/* ---------------- Términos y aviso de privacidad (#terminos) ----------------
   Lo que acepta el checkbox del formulario de compra. Texto fijo a propósito
   (no pasa por cursos.json ni por el editor visual): es lo que la persona
   aceptó, no copy de marketing. Mismo contenido que el de la Academy de
   PimpStudio, con Brunetti como responsable. */
const TERMS = [
  {
    tag: 'Compra',
    title: 'Qué compras',
    items: [
      'Un pago único con Mercado Pago. No es una suscripción: no hay cobros mensuales.',
      'Acceso de por vida a las lecciones del curso dentro de la Brunetti Academy, más la comunidad.',
      'Tu acceso es personal: la cuenta es tuya y no se comparte.',
      'Si hay un problema con tu compra, escríbenos. Los reembolsos se hacen por Mercado Pago y cierran el acceso al curso.',
      'En la comunidad rigen sus reglas (respeto, nada de spam). Quien no las cumpla puede perder su cuenta.',
    ],
  },
  {
    tag: 'Privacidad',
    title: 'Qué hacemos con tus datos',
    items: [
      ['Responsable:', 'Brunetti (brunetticutz.cl).'],
      ['Qué datos:', 'nombre, correo, teléfono si lo das y los datos de tu compra. Dentro de la Academy, lo que publiques, tu avance y tus mensajes.'],
      ['Para qué:', 'crear tu cuenta y darte acceso, enviarte tu contraseña y los avisos de la Academy, gestionar pagos y reembolsos, darte soporte y cuidar la comunidad. No vendemos tus datos ni te mandamos publicidad por correo.'],
      ['Quién más los procesa (encargados):', 'Neon (base de datos), Vercel (sitio e imágenes), Resend (envío de correos), Google (YouTube, para reproducir las lecciones) y Mercado Pago (el pago; tus datos de tarjeta nunca pasan por nosotros).'],
      ['Tus derechos:', `puedes pedir acceso, corrección o eliminación de tus datos. Dentro de la Academy, en Ajustes, descargas tus datos o eliminas tu cuenta; también puedes escribirnos a @${INSTAGRAM} en Instagram.`],
    ],
  },
]

const CHECK_ICON = (<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" /></svg>)

function TermsSection() {
  return (
    <section className="bsection" id="terminos">
      <div className="bwrap">
        <div className="bhead center" data-reveal>
          <p className="kicker">Antes de comprar</p>
          <h2>Términos y aviso de privacidad</h2>
        </div>
        {/* Reusa la tarjeta del checkout (dos columnas que pasan a una en el
            teléfono) para no sumar CSS nuevo a la página. */}
        <div className="checkout-card" data-reveal>
          {TERMS.map((block, i) => (
            <div className="checkout-info" key={block.tag} style={i === TERMS.length - 1 ? { borderRight: 'none', borderBottom: 'none' } : undefined}>
              <p className="checkout-label">{block.tag}</p>
              <h3 className="checkout-title">{block.title}</h3>
              <ul className="checkout-list">
                {block.items.map((it) => (
                  <li key={Array.isArray(it) ? it[0] : it}>
                    {CHECK_ICON}
                    {Array.isArray(it) ? <span><b>{it[0]}</b> {it[1]}</span> : it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
