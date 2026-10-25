import React from 'react'
import { waShopHref } from '../data.js'
import { track } from '../track.js'
import './WhatsAppFab.css'

/* Botón flotante de WhatsApp a Bruno, con el mensaje ya escrito. En el
   celular sube por encima de la barra inferior de SiteNav (el botón
   "Inscribirme"/"Reservar"); en escritorio queda abajo a la derecha. Cada
   toque se marca como Contact en el píxel. */
export default function WhatsAppFab({ text, label = 'Escríbele a Bruno por WhatsApp' }) {
  return (
    <a
      className="wa-fab"
      href={waShopHref(text)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      onClick={() => track('Contact')}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91A9.85 9.85 0 0 0 12.04 2zm5.8 14.13c-.25.69-1.44 1.32-1.98 1.37-.51.05-.99.24-3.34-.7-2.82-1.11-4.62-3.99-4.76-4.18-.14-.18-1.13-1.5-1.13-2.87 0-1.37.72-2.04.97-2.32.25-.28.55-.35.74-.35l.53.01c.17 0 .4-.06.62.48.23.55.78 1.91.85 2.05.07.14.11.3.02.48-.09.18-.14.3-.28.46-.14.16-.29.36-.41.48-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.9 1.05.94 1.93 1.23 2.21 1.37.28.14.44.12.6-.07.16-.18.69-.8.88-1.08.18-.28.37-.23.62-.14.25.09 1.6.76 1.87.9.28.14.46.21.53.32.07.12.07.67-.18 1.36z"
        />
      </svg>
    </a>
  )
}
