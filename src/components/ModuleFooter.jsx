import React from 'react'
import { Link } from 'react-router-dom'

/* ============================================================
   Footer compartido (estilo del workshop) para Home y Cursos.
   Usa clases genéricas .mfooter-* que toman el color del módulo
   vía las variables --gold* (dorado en Home, azul en /cursos).
   El logo ASCENSIÓN es exclusivo del workshop, así que aquí va
   la marca BRUNETTI. Sin direcciones.
   Al final, el enlace a /privacidad (Ley 21.719: la política tiene que
   estar siempre a la vista en el sitio).
   ============================================================ */

const ICONS = {
  whatsapp: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM17 6.5h.01',
  calendar: 'M7 3v3M17 3v3M3.5 9h17M5 5h14a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6.5A1.5 1.5 0 0 1 5 5z',
}
function Ic({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  )
}

export default function ModuleFooter({
  brandName = 'BRUNETTI',
  tagline = 'Visagismo, barbería de precisión y dirección de estilo personal — el método de Bruno Herrera.',
  links = [],
  whatsapp = '56987483279',
  instagram = 'brunetticutz',
  igHandle = '@brunetticutz',
  onPrimary,
  primaryLabel = 'Reservar hora',
  bottomLeft = '© 2026 Brunetti · Bruno Herrera',
  bottomRight = 'Barbería premium · Visagismo',
  logoSrc = null,
}) {
  return (
    <footer className="mfooter">
      <div className="mfooter-wide">
        <div className="mfooter-cols">
          <div className="mfooter-brand">
            <div className="mfooter-word">
              {logoSrc ? (
                <img className="mfooter-wordmark" src={logoSrc} alt={brandName} />
              ) : (
                <span className="mfooter-wordmark" aria-label={brandName}>Brunetti Cutz</span>
              )}
            </div>
            <p className="mfooter-tag">{tagline}</p>
            {onPrimary && (
              <button type="button" className="mfooter-cta" onClick={onPrimary}>
                <Ic name="calendar" /> {primaryLabel}
              </button>
            )}
          </div>

          {links.length > 0 && (
            <nav className="mfooter-col">
              <span className="mfooter-h">Explora</span>
              {links.map(([fn, label]) => (
                <button key={label} type="button" className="mfooter-link" onClick={fn}>{label}</button>
              ))}
            </nav>
          )}

          <div className="mfooter-col">
            <span className="mfooter-h">Hablemos</span>
            <a className="mfooter-link" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer"><Ic name="whatsapp" /> WhatsApp directo</a>
            <a className="mfooter-link" href={`https://instagram.com/${instagram}`} target="_blank" rel="noopener noreferrer"><Ic name="instagram" /> {igHandle}</a>
          </div>
        </div>

        <div className="mfooter-bottom">
          <span>{bottomLeft}</span>
          <Link className="mfooter-legal" to="/privacidad">Privacidad y protección de datos</Link>
          <span>{bottomRight}</span>
        </div>
      </div>
    </footer>
  )
}
