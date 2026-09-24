import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Icon } from './ui.jsx'
import './SiteNav.css'

/* Navbar global del sitio. Persiste en todas las páginas (Home, Workshop, ...).
   Escritorio: logo + enlaces de módulos + botón Reservar (en la barra superior).
   Móvil: logo + botón de menú desplegable (módulos) y una barra inferior fija
   con el CTA Reservar (estilo workshop), full-width.
   - Secciones (Servicios/Barberos/Nosotros/Ubicación): scroll en Home,
     o navegan a "/" y Home hace scroll a la sección (location.state.section).
   - "Workshop" siempre enruta a /workshop (es una página más).
   - Reservar: en workshop "Reservar asiento" (→ formulario #inscribir);
     en el resto "Reservar hora en la agenda" (→ /login). */
const NAV = [
  ["inicio",    "Inicio"],
  ["visagismo", "Visagismo"],
  ["sobre",     "Sobre Bruno"],
  ["servicios", "Servicios"],
  ["style",     "Tu estilo"],
  ["cursos",    "Cursos"],
  ["workshop",  "Workshop"],
  ["essentials","Essentials"],
  ["contacto",  "Contacto"],
]

export default function SiteNav({ onSection, scrolled: scrolledProp }) {
  const navigate = useNavigate()
  const location = useLocation()
  const isHome = location.pathname === "/"
  const isWorkshop = location.pathname === "/workshop"
  const isCursos = location.pathname === "/cursos"
  const isStyle = location.pathname === "/style"
  const isEssentials = location.pathname === "/essentials"
  const [scrolledWin, setScrolledWin] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // Detección de scroll por ventana cuando el navbar no es controlado (p. ej. /workshop).
  useEffect(() => {
    if (scrolledProp !== undefined) return
    const on = () => setScrolledWin(window.scrollY > 40)
    on()
    window.addEventListener("scroll", on, { passive: true })
    return () => window.removeEventListener("scroll", on)
  }, [scrolledProp])

  // Cerrar el menú al cambiar de ruta.
  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  /* Marca el documento mientras esta barra existe. El toggle flotante de tema
     (FloatingThemeToggle, montado en App.jsx) se ancla DENTRO de la fila del
     botón "Reservar" en móvil cuando la marca está puesta (ver brunetti.css,
     body.has-cta-bar), en vez de quedar flotando sobre el contenido: a 6.4rem
     del borde caía justo encima del "Reservar hora" de las tarjetas de
     servicio y se robaba el tap. En las páginas sin esta barra (/reservar,
     /cuenta, /ingreso) el toggle conserva su posición elevada de siempre. */
  useEffect(() => {
    document.body.classList.add('has-cta-bar')
    return () => document.body.classList.remove('has-cta-bar')
  }, [])

  const scrolled = scrolledProp !== undefined ? scrolledProp : scrolledWin

  const goSection = (id) => {
    if (isHome && onSection) onSection(id)
    else navigate("/", { state: { section: id } })
  }
  const handleNav = (id) => {
    setMenuOpen(false)
    if (id === "workshop") navigate("/workshop")
    else if (id === "cursos") navigate("/cursos")
    else if (id === "style") navigate("/style")
    else if (id === "essentials") navigate("/essentials")
    else if (id === "inicio") { navigate("/"); window.scrollTo({ top: 0, behavior: "smooth" }) }
    else goSection(id)
  }

  const reserveLabel = isWorkshop ? "Reservar asiento" : isCursos ? "Inscribirme" : "Reservar hora"
  const reserve = () => {
    setMenuOpen(false)
    if (isWorkshop) {
      const el = document.getElementById("inscribir")
      if (el) { window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: "smooth" }); return }
    }
    if (isCursos) {
      const el = document.getElementById("inscripcion")
      if (el) { window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: "smooth" }); return }
    }
    navigate("/login")
  }

  return (
    <React.Fragment>
      <header className={`home-nav ${scrolled || menuOpen ? "is-scrolled" : ""}`}>
        <a
          href="#"
          className="site-nav-brand"
          aria-label="Brunetti Cutz — Barber Studio"
          onClick={(e) => { e.preventDefault(); navigate("/") }}
        >
          <img
            className="site-nav-brand-word"
            src={isWorkshop ? "/assets/brunetti-workshop-wordmark.webp" : isCursos ? "/assets/brunetti-cursos-wordmark.webp" : "/assets/brunetti-hero-wordmark.webp"}
            alt="Brunetticutz"
          />
        </a>
        <nav className="home-nav-links">
          {NAV.map(([id, label]) => (
            <button
              key={id}
              onClick={() => handleNav(id)}
              className="nav-link"
              style={(id === "workshop" && isWorkshop) || (id === "cursos" && isCursos) || (id === "style" && isStyle) || (id === "essentials" && isEssentials) ? { color: "var(--gold-lt)" } : undefined}
            >
              {label}
            </button>
          ))}
          <button className="btn btn-ghost btn-sm site-nav-barber-desktop" onClick={() => navigate("/ingreso")} aria-label="Acceso interno">
            <Icon name="key" size={16} />
          </button>
          <button className="btn btn-gold btn-sm site-nav-reserve-desktop" onClick={() => navigate("/login")}>
            <Icon name="calendar" size={14} /> Reservar
          </button>
        </nav>
        <button
          className="site-nav-burger"
          aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Icon name={menuOpen ? "close" : "menu"} size={22} />
        </button>
      </header>

      {menuOpen && <div className="site-nav-backdrop" onClick={() => setMenuOpen(false)} />}

      <div className={`site-nav-sheet ${menuOpen ? "is-open" : ""}`} role="menu">
        {NAV.map(([id, label]) => (
          <button
            key={id}
            role="menuitem"
            onClick={() => handleNav(id)}
            className={(id === "workshop" && isWorkshop) || (id === "cursos" && isCursos) || (id === "style" && isStyle) || (id === "essentials" && isEssentials) ? "is-active" : ""}
          >
            {label}
          </button>
        ))}
        <button
          role="menuitem"
          className="site-nav-sheet-barber"
          onClick={() => { setMenuOpen(false); navigate("/ingreso") }}
        >
          <Icon name="key" size={15} /> Acceso interno
        </button>
      </div>

      <div className="site-nav-cta-bar">
        <button className="btn btn-gold" onClick={reserve}>
          <Icon name="calendar" size={15} /> {reserveLabel}
        </button>
      </div>
    </React.Fragment>
  )
}
