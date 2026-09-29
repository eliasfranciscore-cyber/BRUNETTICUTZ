import React, { Component, Suspense, lazy, useEffect, useState } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import { useIsPhone } from '../panel/index.js'
import AcademyTopbar from './AcademyTopbar.jsx'
import AcademyTabs from './AcademyTabs.jsx'
import LeftRail from './LeftRail.jsx'
import '../../styles/academy/app.css'

/* ============================================================
   AcademyShell — el marco de la app del miembro (SPEC §7.3):
   barra superior + pestañas (sticky), riel izquierdo (≥1100 px),
   contenido centrado de 1100 px, popovers de Chats y Notificaciones,
   ventanas de chat acopladas (escritorio) y avisos (toasts).

   Los popovers y el dock se cargan PEREZOSOS y recién la primera vez que
   hacen falta: quien solo mira un curso no descarga el chat. Si el chunk
   no carga (un deploy nuevo en medio de la sesión), una barrera de error
   lo esconde en vez de dejar la app en blanco.

   Props: popover ('chats' | 'notifications' | null), onPopover(kind|null),
   bare (chat a pantalla completa: en el celular sin barra, pestañas ni
   riel), openChats [chatId], toasts [{id, message, kind}],
   onDismissToast(id), children.
   ============================================================ */

const ChatPopover = lazy(() => import('./ChatPopover.jsx'))
const ChatDock = lazy(() => import('./ChatWindow.jsx').then((m) => ({ default: m.ChatDock })))
const NotificationsPopover = lazy(() => import('./NotificationsPopover.jsx'))

const cx = (...p) => p.filter(Boolean).join(' ')

/* Barrera para piezas opcionales (popovers, dock): si fallan, no tumban la app. */
export class QuietBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err) {
    console.error('[academy:shell]', err)
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}

const TOAST_ICON = { ok: 'checkCircle', error: 'alert', warn: 'alert', info: 'info' }

function Toasts({ toasts, onDismiss }) {
  return (
    <div className="aca-toasts" aria-live="polite" aria-atomic="false">
      {(toasts || []).map((t) => (
        <div key={t.id} className={cx('aca-toast', `is-${t.kind || 'info'}`)} role={t.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={TOAST_ICON[t.kind] || 'info'} size={17} />
          <span className="aca-toast-text">{t.message}</span>
          <button type="button" className="aca-toast-x" aria-label="Cerrar aviso" onClick={() => onDismiss?.(t.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

export default function AcademyShell({
  children,
  popover = null,
  onPopover,
  bare = false,
  openChats = [],
  toasts = [],
  onDismissToast,
}) {
  const isPhone = useIsPhone()
  // Una vez abierto, el popover queda montado (cerrado) para no volver a
  // pedir su chunk ni perder su estado de filtro entre aperturas.
  const [loaded, setLoaded] = useState({ chats: false, notifications: false })
  useEffect(() => {
    if (popover && !loaded[popover]) setLoaded((l) => ({ ...l, [popover]: true }))
  }, [popover, loaded])

  const toggle = (kind) => onPopover?.(popover === kind ? null : kind)
  // Cada popover se cierra solo si sigue siendo EL abierto: el clic en la
  // campana con los chats abiertos dispara el "clic afuera" de los chats
  // DESPUÉS de abrir las notificaciones, y no debe cerrarlas.
  const closeIf = (kind) => () => onPopover?.((cur) => (cur === kind ? null : cur))

  const hideHeader = bare && isPhone
  const chats = Array.isArray(openChats) ? openChats : []

  return (
    <div className={cx('aca-app', bare && 'is-bare', hideHeader && 'no-header')}>
      {!hideHeader && (
        <header className="aca-header">
          <div className="aca-wrap">
            <AcademyTopbar popover={popover} onToggle={toggle} />
          </div>
          <div className="aca-wrap">
            <AcademyTabs />
          </div>
        </header>
      )}

      {!hideHeader && <LeftRail />}

      <main className="aca-main" id="aca-main">
        <div className="aca-wrap">{children}</div>
      </main>

      {loaded.chats && (
        <QuietBoundary>
          <Suspense fallback={null}>
            <ChatPopover open={popover === 'chats'} onClose={closeIf('chats')} />
          </Suspense>
        </QuietBoundary>
      )}
      {loaded.notifications && (
        <QuietBoundary>
          <Suspense fallback={null}>
            <NotificationsPopover open={popover === 'notifications'} onClose={closeIf('notifications')} />
          </Suspense>
        </QuietBoundary>
      )}

      {/* ChatDock lee openChats/closeChat del contexto y no dibuja nada bajo
          900 px (ahí el chat es la página <base>/chat/:id). */}
      {chats.length > 0 && (
        <QuietBoundary>
          <Suspense fallback={null}>
            <ChatDock />
          </Suspense>
        </QuietBoundary>
      )}

      <Toasts toasts={toasts} onDismiss={onDismissToast} />
    </div>
  )
}

export { AcademyShell }
