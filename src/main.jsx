import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// CSS global primero: así el CSS de componentes (SiteNav.css, workshop.css)
// se importa después y gana en conflictos de igual especificidad.
import './styles/pimp.css'
import './styles/modules.css'
import './styles/brunetti.css'
// Tailwind (solo utilidades, preflight OFF) — alimenta el componente de lámpara.
import './styles/tailwind.css'
import App from './App.jsx'
import { Analytics } from '@vercel/analytics/react'
// Sólo por el efecto de importarlo: engancha `beforeinstallprompt` antes de
// que React monte. Chrome emite ese evento una vez y muy temprano; si el
// listener se registrara dentro de un componente, llegaríamos tarde y el
// botón "Instalar" del panel no tendría con qué disparar el diálogo nativo.
import './installPrompt.js'
// La PWA instalada no recarga sola: iOS la restaura con el JS que tenía en
// memoria. Sin esto, un arreglo desplegado puede tardar días en llegarle a
// Bruno en el panel (ver src/buildWatch.js).
import { watchForNewBuild } from './buildWatch.js'

watchForNewBuild()

// Service worker para PWA + notificaciones push (iOS instalado en inicio).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
    <Analytics />
  </BrowserRouter>
)
