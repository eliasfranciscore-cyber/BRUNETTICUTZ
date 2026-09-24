import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './ui.jsx'
import { installState, promptInstall, rememberDismissal, shouldAutoPromptInstall, onInstallStateChange } from '../installPrompt.js'

/* Aviso para instalar la app en la pantalla de inicio.

   Tres cuerpos distintos porque las plataformas no dan lo mismo (el detalle
   está en src/installPrompt.js): en Chrome se instala con un botón, en Safari
   de iPhone hay que enseñar el gesto porque no existe API de instalación, y
   dentro del navegador de Instagram/WhatsApp la opción ni siquiera aparece en
   el menú, así que primero hay que salir a Safari.

   `audience` sólo cambia el texto, y acá existe uno solo: el del barbero.
   La app instalada de brunetticutz.cl es el panel (start_url /panel en el
   manifest; ver PWALaunchRouter en src/App.jsx), así que a un cliente que
   la instalara lo dejaría en el login del barbero. Si algún día se abre a
   clientes, su texto va acá. */

const COPY = {
  barber: {
    title: 'Tu agenda a un toque',
    body: 'Instala el panel en tu pantalla de inicio para abrir tus reservas al instante y recibir los avisos de cada hora nueva.',
  },
}

/* El ícono de Compartir de iOS no está en el set de la app y es justo lo que
   la persona tiene que buscar en la barra de Safari, así que va dibujado. */
function ShareIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V3M8.5 6.5L12 3l3.5 3.5M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" />
    </svg>
  )
}

function Step({ n, children }) {
  return (
    <li style={{ display: 'flex', gap: '.6rem', alignItems: 'center', textAlign: 'left' }}>
      <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center', border: '1px solid var(--gold-line)', color: 'var(--gold-lt)', fontSize: '.7rem' }}>{n}</span>
      <span style={{ fontSize: '.85rem', color: 'var(--muted)' }}>{children}</span>
    </li>
  )
}

export default function InstallPrompt({ audience = 'barber', open, onClose }) {
  const [, forceRender] = useState(0)
  const [copied, setCopied] = useState(false)

  // El estado se calcula en cada render en vez de guardarse: si se congelara
  // al montar, el componente se quedaría con la foto del primer instante (por
  // ejemplo "acá no se puede instalar" en un montaje temprano). La suscripción
  // sólo sirve para volver a pintar cuando Chrome emite `beforeinstallprompt`,
  // que puede llegar bastante después del montaje.
  useEffect(() => onInstallStateChange(() => forceRender((n) => n + 1)), [])
  const state = installState()

  if (!open || state === 'installed' || state === 'unavailable') return null

  const copy = COPY[audience] || COPY.barber

  const dismiss = () => { rememberDismissal(); onClose?.() }

  const install = async () => {
    const accepted = await promptInstall()
    if (!accepted) rememberDismissal()
    onClose?.()
  }

  // El link del panel, no la portada: pegado en Safari, deja al barbero
  // directo en su login para instalar desde ahí.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/panel`)
      setCopied(true)
    } catch (e) {
      setCopied(false)
    }
  }

  return createPortal((
    <div className="psn-modal psn-modal-top" role="dialog" aria-modal="true" aria-label="Instalar la app">
      <button className="psn-scrim" aria-label="Cerrar" onClick={dismiss} />
      <div className="psn-modal-card psn-confirm">
        <span className="psn-confirm-ic" style={{ background: 'rgba(201,161,78,.12)', color: 'var(--gold-lt)', borderColor: 'var(--gold-line)' }}>
          <Icon name="spark" size={22} />
        </span>
        <h3 className="font-display">{copy.title}</h3>
        <p>{copy.body}</p>

        {state === 'ios-safari' && (
          <ol style={{ display: 'grid', gap: '.5rem', margin: '0 0 .9rem', padding: 0, listStyle: 'none', width: '100%' }}>
            <Step n="1">Toca <ShareIcon /> <b>Compartir</b> en la barra de Safari.</Step>
            <Step n="2">Elige <b>Agregar a inicio</b>.</Step>
            <Step n="3">Confirma con <b>Agregar</b>. Listo, queda como app.</Step>
          </ol>
        )}

        {state === 'in-app-browser' && (
          <p style={{ marginTop: '-.4rem' }}>
            Estás viendo la web dentro de otra app, y desde acá no se puede instalar.
            Ábrela en <b>Safari</b> o <b>Chrome</b> y vuelve a intentarlo.
          </p>
        )}

        <div className="psn-confirm-actions">
          <button className="btn btn-ghost btn-block" onClick={dismiss}>
            {state === 'native' ? 'Ahora no' : 'Entendido'}
          </button>
          {state === 'native' && (
            <button className="btn btn-gold btn-block" onClick={install}>
              <Icon name="plus" size={15} /> Instalar
            </button>
          )}
          {state === 'in-app-browser' && (
            <button className="btn btn-gold btn-block" onClick={copyLink}>
              {copied && <Icon name="check" size={15} />} {copied ? 'Link copiado' : 'Copiar link'}
            </button>
          )}
          {state === 'ios-safari' && (
            <button className="btn btn-gold btn-block" onClick={dismiss}>
              <ShareIcon size={15} /> Lo hago ahora
            </button>
          )}
        </div>
      </div>
    </div>
  ), document.body)
}

/* Hook para los disparadores automáticos: abre el aviso una sola vez, con un
   respiro después de la acción que lo gatilla (entrar al panel) para no
   tapar esa pantalla apenas aparece. */
export function useAutoInstallPrompt(active, delayMs = 1200) {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!active || shown) return
    if (!shouldAutoPromptInstall()) return
    const t = setTimeout(() => { setOpen(true); setShown(true) }, delayMs)
    return () => clearTimeout(t)
  }, [active, shown, delayMs])
  return [open, () => setOpen(false)]
}
