import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ACADEMY_BASE } from '../academy/hostConfig.js'
import { readConsent, saveConsent, onOpenConsent } from '../consent.js'
import '../styles/cookie-consent.css'

/* ============================================================
   Aviso de cookies (Ley 21.719): pregunta una vez si se puede activar el
   píxel de Meta. "Rechazar" y "Aceptar" pesan lo mismo; sin respuesta no
   se carga nada (ver src/consent.js y public/pixel.js). Se vuelve a abrir
   desde "Preferencias de cookies" en el pie y en /privacidad.
   Mismo componente en pimpstudio.cl.
   ============================================================ */

// No pregunta en el panel ni en sus accesos (uso interno), ni dentro de la
// app de alumnos de la Academy, donde el píxel nunca corre.
function hiddenOn(pathname) {
  if (pathname === '/panel' || pathname.startsWith('/panel/')) return true
  if (pathname === '/ingreso' || pathname === '/restablecer') return true
  return pathname.startsWith(`${ACADEMY_BASE}/`) && !pathname.startsWith(`${ACADEMY_BASE}/gracias`)
}

export default function CookieConsent() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(() => readConsent() === null)

  useEffect(() => onOpenConsent(() => setOpen(true)), [])

  if (!open || hiddenOn(pathname)) return null

  const choose = (ads) => {
    saveConsent(ads)
    setOpen(false)
  }

  return (
    <section className="cookie-consent" role="dialog" aria-labelledby="cc-title" aria-describedby="cc-text">
      <p className="cc-title" id="cc-title">Cookies</p>
      <p className="cc-text" id="cc-text">
        Usamos lo necesario para que el sitio funcione. Si aceptas, también el píxel de Meta, para medir nuestros
        anuncios en Facebook e Instagram. Puedes cambiar de opinión cuando quieras desde el pie de página.{' '}
        <Link to="/privacidad">Más detalles</Link>
      </p>
      <div className="cc-actions">
        <button type="button" className="cc-btn" onClick={() => choose(false)}>Rechazar</button>
        <button type="button" className="cc-btn cc-btn-accept" onClick={() => choose(true)}>Aceptar</button>
      </div>
    </section>
  )
}
