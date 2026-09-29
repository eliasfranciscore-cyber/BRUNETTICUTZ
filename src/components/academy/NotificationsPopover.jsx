import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Sheet, ConfirmDialog, Button, useIsPhone } from '../panel/index.js'
import { useTopLayerEscape } from '../panel/hooks.js'
import MemberAvatar from './MemberAvatar.jsx'
import PageState from './PageState.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { r } from '../../academy/routes.js'
import { cx, MenuButton, errMsg, fullDate, agoShort } from './PostCard.jsx'
import '../../styles/academy/comunidad.css'

/* ============================================================
   Popover de la campana (captura 6 de Skool).
   Escritorio: panel de ~400 px anclado bajo la barra superior, a la derecha
   del contenido (va por portal a <body> con position:fixed para no depender
   de dónde lo monte el shell ni de un backdrop-filter del topbar).
   Celular: hoja a pantalla completa.

   · Lee `notifications` cada vez que se abre (y al cambiar el filtro); nada
     de sondeos: el contador de la campana lo mantiene el shell (useSync).
   · "Marcar todo como leído" pide confirmación; tocar una fila la marca
     leída, navega a su `route` (solo rutas /academy/…) y cierra.
   · Después de marcar, refreshUnread() del contexto actualiza el contador.
   ============================================================ */

const KIND_ICON = {
  evento: 'calendar', nivel: 'trophy', curso: 'book', grupo: 'users', bienvenida: 'sparkles',
  reporte: 'flag', anuncio: 'megaphone', actividad: 'message', miembro_nuevo: 'users',
}

// El texto viene armado por el backend en español (notificationText, §8.1).
// El backend manda además `parts: [{text, bold}]` (notificationParts): si
// vienen, esas marcan qué va en negrita. Si no, **marcas** en el texto o, en
// último caso, el nombre del actor. Siempre nodos de texto de React, nunca HTML.
function renderText(text, actorName, parts) {
  if (Array.isArray(parts) && parts.length && parts.every((p) => p && typeof p.text === 'string')) {
    return parts.map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <React.Fragment key={i}>{p.text}</React.Fragment>))
  }
  const t = String(text || '')
  if (t.includes('**')) {
    return t.split('**').map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : <React.Fragment key={i}>{part}</React.Fragment>))
  }
  const name = String(actorName || '')
  const i = name ? t.indexOf(name) : -1
  if (i >= 0) return <>{t.slice(0, i)}<b>{name}</b>{t.slice(i + name.length)}</>
  return t
}

// Solo rutas de la Academy: la base del sitio (/academy o /cursos) seguida de
// nada, "/", "?" o "#".
function safeRoute(route) {
  if (typeof route !== 'string') return null
  const base = r.base()
  const next = route.charAt(base.length)
  if (route.startsWith('//') || !route.startsWith(base) || (next && !'/?#'.includes(next))) return null
  return route
}

function NotifRow({ n, onOpen, tz }) {
  const icon = KIND_ICON[n.kind] || 'bell'
  const when = agoShort(n.createdAt, tz)
  return (
    <button type="button" className={cx('aca-cm-notif-row', !n.read && 'is-unread')} onClick={() => onOpen(n)}>
      <span className="aca-cm-notif-av">
        {n.actor
          ? <MemberAvatar member={n.actor} size={44} />
          : <span className="aca-cm-notif-icon"><Icon name={icon} size={20} /></span>}
      </span>
      <span className="aca-cm-notif-main">
        <span className="aca-cm-notif-text">
          {renderText(n.text, n.actor?.name, n.parts)}
          {when && <span className="aca-cm-notif-time" title={fullDate(n.createdAt, tz)}> · {when}</span>}
        </span>
        {n.preview && <span className="aca-cm-notif-preview">{n.preview}</span>}
      </span>
      {!n.read && <span className="aca-cm-notif-dot" role="img" aria-label="No leída" />}
    </button>
  )
}

export default function NotificationsPopover({ open, onClose }) {
  const isPhone = useIsPhone()
  const navigate = useNavigate()
  const { refreshUnread, toast, tz } = useAcademy()
  const [filter, setFilter] = useState('todas')
  const [state, setState] = useState({ status: 'idle', items: [], nextCursor: null, error: null, unread: 0, filter: 'todas' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const [marking, setMarking] = useState(false)
  const panelRef = useRef(null)
  const reqId = useRef(0)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const load = useCallback(async (f) => {
    const my = ++reqId.current
    setState((s) => ({ ...s, status: 'loading', error: null, ...(s.filter !== f ? { items: [], nextCursor: null } : {}), filter: f }))
    try {
      const d = await academyApi('notifications', { query: { filter: f } })
      if (my !== reqId.current) return
      setState({
        status: 'ready',
        items: Array.isArray(d?.notifications) ? d.notifications : [],
        nextCursor: d?.nextCursor || null,
        error: null,
        unread: Number(d?.unread) || 0,
        filter: f,
      })
    } catch (e) {
      if (my !== reqId.current) return
      setState((s) => ({ ...s, status: 'error', error: e }))
    }
  }, [])

  useEffect(() => { if (open) load(filter) }, [open, filter, load])

  // Escritorio: cerrar al tocar fuera (con `click`, no `mousedown`: así el
  // toque en la campana lo resuelve el shell y no se abre-cierra-abre) y con
  // Escape. Lo que pasa dentro de una hoja o confirmación (portales) no cuenta.
  useEffect(() => {
    if (!open || isPhone) return undefined
    let armed = false
    const t = setTimeout(() => { armed = true }, 0)
    const onDoc = (e) => {
      if (!armed) return
      const el = panelRef.current
      const target = e.target
      if (!el || (target instanceof Node && el.contains(target))) return
      if (target instanceof Element && target.closest('.pn-sheet-root')) return
      closeRef.current?.()
    }
    document.addEventListener('click', onDoc)
    return () => { clearTimeout(t); document.removeEventListener('click', onDoc) }
  }, [open, isPhone])
  useTopLayerEscape(open && !isPhone, () => closeRef.current?.())

  useEffect(() => {
    if (!open || isPhone) return undefined
    const t = setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 20)
    return () => clearTimeout(t)
  }, [open, isPhone])

  const loadMore = async () => {
    if (!state.nextCursor || loadingMore) return
    setLoadingMore(true)
    const f = filter
    try {
      const d = await academyApi('notifications', { query: { filter: f, cursor: state.nextCursor } })
      setState((s) => {
        if (s.filter !== f) return s
        const seen = new Set(s.items.map((x) => x.id))
        const add = (Array.isArray(d?.notifications) ? d.notifications : []).filter((n) => !seen.has(n.id))
        return { ...s, items: [...s.items, ...add], nextCursor: d?.nextCursor || null }
      })
    } catch (e) {
      toast?.(errMsg(e, 'No se pudieron cargar más notificaciones'), 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  const openItem = (n) => {
    const route = safeRoute(n.route)
    if (!n.read) {
      setState((s) => ({ ...s, items: s.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)), unread: Math.max(0, s.unread - 1) }))
      academyApi('notifications-read', { method: 'POST', body: { ids: [n.id] } })
        .then(() => refreshUnread?.())
        .catch(() => { /* la próxima apertura la vuelve a mostrar sin leer */ })
    }
    closeRef.current?.()
    if (route) navigate(route)
  }

  const markAll = async () => {
    setMarking(true)
    try {
      await academyApi('notifications-read', { method: 'POST', body: { all: true } })
      setState((s) => ({ ...s, items: s.items.map((x) => ({ ...x, read: true })), unread: 0 }))
      setConfirmAll(false)
      refreshUnread?.()
    } catch (e) {
      toast?.(errMsg(e, 'No se pudieron marcar como leídas'), 'error')
    } finally {
      setMarking(false)
    }
  }

  const hasUnread = state.unread > 0 || state.items.some((n) => !n.read)
  const items = state.items

  const actions = (
    <div className="aca-cm-notif-actions">
      <button type="button" className="aca-cm-linkbtn is-blue" onClick={() => setConfirmAll(true)} disabled={!hasUnread}>
        Marcar todo como leído
      </button>
      <MenuButton
        label={filter === 'no-leidas' ? 'No leídas' : 'Todos'}
        ariaLabel="Filtrar notificaciones"
        title="Mostrar"
        buttonClassName="aca-cm-notif-filter"
        items={[
          { key: 'todas', label: 'Todas', checked: filter === 'todas', onClick: () => setFilter('todas') },
          { key: 'no-leidas', label: 'No leídas', checked: filter === 'no-leidas', onClick: () => setFilter('no-leidas') },
        ]}
      />
    </div>
  )

  const list = (
    <div className="aca-cm-notif-body">
      <PageState
        loading={state.status !== 'error' && state.status !== 'ready' && !items.length}
        error={state.status === 'error' && !items.length ? state.error : null}
        onRetry={() => load(filter)}
        empty={state.status === 'ready' && !items.length}
        emptyText={filter === 'no-leidas' ? 'No tienes notificaciones sin leer' : 'Aún no hay notificaciones'}
      >
        <ul className="aca-cm-notif-list">
          {items.map((n) => (
            <li key={n.id}><NotifRow n={n} onOpen={openItem} tz={tz} /></li>
          ))}
        </ul>
        {state.nextCursor && (
          <div className="aca-cm-notif-more">
            <Button variant="plain" size="sm" onClick={loadMore} loading={loadingMore}>Cargar más</Button>
          </div>
        )}
      </PageState>
    </div>
  )

  const confirm = (
    <ConfirmDialog
      open={confirmAll}
      title="¿Marcar todo como leído?"
      message="Las notificaciones se quedan en la lista, pero sin el punto azul."
      confirmLabel="Marcar como leídas"
      busy={marking}
      onConfirm={markAll}
      onCancel={() => setConfirmAll(false)}
    />
  )

  if (isPhone) {
    return (
      <>
        <Sheet open={open} onClose={onClose} title="Notificaciones" full size="md" bodyClassName="is-flush aca-cm-notif-sheet-body" className="aca-cm-notif-sheet">
          {actions}
          {list}
        </Sheet>
        {confirm}
      </>
    )
  }

  if (!open || typeof document === 'undefined') return confirm
  return (
    <>
      {createPortal(
        <div ref={panelRef} className="aca-cm-notif-pop" role="dialog" aria-label="Notificaciones" tabIndex={-1}>
          <div className="aca-cm-notif-head">
            <h2>Notificaciones</h2>
            {actions}
          </div>
          {list}
        </div>,
        document.body,
      )}
      {confirm}
    </>
  )
}
