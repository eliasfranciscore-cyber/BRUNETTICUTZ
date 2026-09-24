import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Emblem, Icon } from '../ui.jsx'
import { useTheme } from '../theme.jsx'
import MobileDock from '../MobileDock.jsx'
import { Avatar, IconButton, List, ListRow, EmptyState } from './kit.jsx'
import { Sheet } from './Sheet.jsx'
import { useIsPhone, useOutsideClose, useTopLayerEscape } from './hooks.js'

/* ============================================================
   Shell del panel: menú lateral (escritorio), barra superior y dock.
   El menú se agrupa en "Día a día" y "Negocio" en los tres lugares donde
   aparece (sidebar, dock y su hoja), para que la misma pestaña esté siempre
   en el mismo sitio.
   ============================================================ */

export const NAV_GROUPS = [
  ['dia', 'Día a día'],
  ['negocio', 'Negocio'],
]

const cx = (...p) => p.filter(Boolean).join(' ')

export function PanelShell({ tab, setTab, nav, dockItems, barber, photo, onLogout, onNewBooking, children }) {
  const groups = NAV_GROUPS
    .map(([id, label]) => [id, label, nav.filter((n) => n[3] === id)])
    .filter(([, , items]) => items.length)
  const settings = nav.find((n) => n[0] === 'config')
  const item = ([id, ic, label]) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={cx('dashboard-nav-item', tab === id && 'is-active')}
      aria-current={tab === id ? 'page' : undefined}
    >
      <Icon name={ic} size={18} /> {label}
    </button>
  )
  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar" aria-label="Menú del panel">
        {/* El Emblem ya es el wordmark BRUNETTI: al lado va solo el rótulo. */}
        <div className="pn-side-brand">
          <Emblem size={30} />
          <div className="pn-side-brand-text">
            <small>Panel interno</small>
          </div>
        </div>
        <nav className="dashboard-nav" aria-label="Módulos">
          {groups.map(([gid, glabel, items]) => (
            <div className="pn-nav-group" key={gid}>
              <div className="pn-nav-label">{glabel}</div>
              {items.map(item)}
            </div>
          ))}
          {settings && <div className="pn-nav-group">{item(settings)}</div>}
        </nav>
        <SidebarUser barber={barber} photo={photo} onLogout={onLogout} onSettings={settings ? () => setTab('config') : undefined} />
      </aside>
      {children}
      <MobileDock tab={tab} setTab={setTab} nav={nav} groups={NAV_GROUPS} shortcuts={dockItems} onNewBooking={onNewBooking} />
    </div>
  )
}

/* ---------- Menú del usuario (sidebar y avatar de la barra) ---------- */
// Subtítulo bajo el nombre: el rol propio del barbero ("Visagista · Director
// de imagen" para Bruno) y, si no tiene, si es administrador o no.
const roleLabel = (barber) => barber?.role || (barber?.admin ? 'Administrador' : 'Barbero')

function UserMenuItems({ barber, photo, onLogout, onSettings, onClose }) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  const run = (fn) => () => { onClose?.(); fn?.() }
  return (
    <>
      <div className="pn-usermenu-head">
        <Avatar src={photo} name={barber?.name} size={40} accent />
        <div className="pn-side-user-text">
          <strong>{barber?.name || 'Cuenta'}</strong>
          <small>{roleLabel(barber)}</small>
        </div>
      </div>
      <div className="pn-menu-sep" />
      {onSettings && (
        <button type="button" className="pn-menu-item" onClick={run(onSettings)}>
          <Icon name="settings" size={17} /><span>Ajustes</span>
        </button>
      )}
      <button type="button" className="pn-menu-item" onClick={toggle}>
        <Icon name={isDark ? 'sun' : 'moon'} size={17} />
        <span>{isDark ? 'Usar tema claro' : 'Usar tema oscuro'}</span>
      </button>
      <div className="pn-menu-sep" />
      <button type="button" className="pn-menu-item is-danger" onClick={run(onLogout)}>
        <Icon name="logout" size={17} /><span>Cerrar sesión</span>
      </button>
    </>
  )
}

function SidebarUser({ barber, photo, onLogout, onSettings }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useOutsideClose(wrap, open, close)
  useTopLayerEscape(open, close)
  return (
    <div className="pn-side-user-wrap" ref={wrap}>
      <button type="button" className="pn-side-user" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar src={photo} name={barber?.name} size={34} accent />
        <span className="pn-side-user-text">
          <strong>{barber?.name || 'Cuenta'}</strong>
          <small>{roleLabel(barber)}</small>
        </span>
        <Icon name="chevronUp" size={15} />
      </button>
      {open && (
        <div className="pn-menu is-start" role="menu">
          <UserMenuItems barber={barber} photo={photo} onLogout={onLogout} onSettings={onSettings} onClose={close} />
        </div>
      )}
    </div>
  )
}

function UserMenuButton({ barber, photo, onLogout, onSettings }) {
  const isPhone = useIsPhone()
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useOutsideClose(wrap, open && !isPhone, close)
  useTopLayerEscape(open && !isPhone, close)
  return (
    <div className="pn-menu-wrap" ref={wrap}>
      <button type="button" className="pn-topbar-avatar" onClick={() => setOpen((v) => !v)} aria-label="Tu cuenta" aria-haspopup="menu" aria-expanded={open}>
        <Avatar src={photo} name={barber?.name} size={38} accent />
      </button>
      {open && !isPhone && (
        <div className="pn-menu" role="menu">
          <UserMenuItems barber={barber} photo={photo} onLogout={onLogout} onSettings={onSettings} onClose={close} />
        </div>
      )}
      {isPhone && (
        <Sheet open={open} onClose={close} title="Tu cuenta" size="sm" bodyClassName="is-flush">
          <div className="pn-actsheet">
            <UserMenuItems barber={barber} photo={photo} onLogout={onLogout} onSettings={onSettings} onClose={close} />
          </div>
        </Sheet>
      )}
    </div>
  )
}

/* ---------- Notificaciones (campana) ----------
   Últimas notificaciones — ver GET /api/push (sin ?job=) en api/push.js. El
   contador cuenta las que llegaron después de la última vez que se abrió
   (marca local por barbero, mismo patrón que ps_push_enabled_${id}). */
function timeAgo(iso) {
  if (!iso) return ''
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (diffMin < 1) return 'ahora'
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `hace ${diffH} h`
  const d = Math.round(diffH / 24)
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`
}

function NotificationsButton({ barber, navigate }) {
  const isPhone = useIsPhone()
  const seenKey = `ps_notif_seen_at_${barber?.id ?? 'me'}`
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [seenAt, setSeenAt] = useState(() => { try { return Number(localStorage.getItem(seenKey) || 0) } catch { return 0 } })
  const wrap = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useOutsideClose(wrap, open && !isPhone, close)
  useTopLayerEscape(open && !isPhone, close)

  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem('ps_barber_token') || ''
      const res = await fetch('/api/push', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      const data = await res.json()
      setItems(Array.isArray(data.notifications) ? data.notifications : [])
    } catch {
      setItems([])
    }
  }, [])
  // Carga inicial: el contador tiene datos apenas se abre el panel.
  useEffect(() => { load() }, [load])

  const unseen = items.filter((n) => new Date(n.createdAt).getTime() > seenAt).length
  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v
      if (next) {
        load()
        const now = Date.now()
        setSeenAt(now)
        try { localStorage.setItem(seenKey, String(now)) } catch { /* sin storage */ }
      }
      return next
    })
  }
  const openItem = (n) => { setOpen(false); if (n.url) navigate?.(n.url) }
  const list = items.length ? (
    <List>
      {items.map((n) => (
        <ListRow
          key={n.id}
          lead={<span className="pn-empty-icon" style={{ width: 34, height: 34, margin: 0 }}><Icon name="bell" size={15} /></span>}
          title={n.title}
          subtitle={n.body}
          meta={timeAgo(n.createdAt)}
          onClick={n.url ? () => openItem(n) : undefined}
        />
      ))}
    </List>
  ) : <EmptyState icon="bell" title="Sin notificaciones recientes" compact />

  return (
    <div className="pn-menu-wrap" ref={wrap}>
      <IconButton icon="bell" label={unseen ? `${unseen} notificación(es) nueva(s)` : 'Notificaciones'} badge={unseen} onClick={toggleOpen} aria-haspopup="true" aria-expanded={open} />
      {open && !isPhone && (
        <div className="pn-menu pn-notif-pop" role="menu">
          <div className="pn-notif-head">Notificaciones</div>
          {list}
        </div>
      )}
      {isPhone && (
        <Sheet open={open} onClose={close} title="Notificaciones" size="sm" bodyClassName="is-flush">
          {list}
        </Sheet>
      )}
    </div>
  )
}

/* ---------- Barra superior ---------- */
/* Botón de tema de la barra (escritorio; en el celular vive en el menú de la
   cuenta y en Ajustes, para no amontonar la barra). Cambiarlo a mano apaga el
   automático por hora, que se vuelve a encender en Ajustes → Apariencia. */
function ThemeButton() {
  const { theme, toggle, auto } = useTheme()
  const isDark = theme === 'dark'
  const label = `${isDark ? 'Usar tema claro' : 'Usar tema oscuro'}${auto ? ' (hoy va automático por la hora)' : ''}`
  return <IconButton icon={isDark ? 'sun' : 'moon'} label={label} onClick={toggle} className="pn-topbar-theme" />
}

/* ¿El scroller bajó más de 40 px? Escucha el propio scroller (pasivo, un
   cálculo por cuadro con rAF) y solo cambia estado al CRUZAR el umbral, así que
   el scroll nunca redibuja nada más que esta barra, y eso una vez. */
function useScrolledPast(scrollRef, threshold = 40) {
  const [past, setPast] = React.useState(false)
  React.useEffect(() => {
    const el = scrollRef?.current
    if (!el) return undefined
    let frame = 0
    let last = el.scrollTop > threshold
    setPast(last)
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const now = el.scrollTop > threshold
        if (now !== last) { last = now; setPast(now) }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame) }
  }, [scrollRef, threshold])
  return past
}

export function PanelTopbar({ title, barber, photo, onLogout, onSettings, onRefresh, refreshing = false, scrolled: scrolledProp, scrollRef, navigate, search = null, searchButton = null }) {
  const scrolledSelf = useScrolledPast(scrollRef)
  const scrolled = scrollRef ? scrolledSelf : Boolean(scrolledProp)
  return (
    <header className={cx('dashboard-topbar', scrolled && 'is-scrolled')}>
      <div className="pn-topbar-left">
        <span className="pn-topbar-brand" aria-hidden="true"><Emblem size={28} /></span>
        <span className="pn-topbar-title" aria-hidden={!scrolled}>{title}</span>
      </div>
      <div className="pn-topbar-actions">
        {search}
        {searchButton}
        <IconButton
          icon="refresh"
          label={refreshing ? 'Actualizando…' : 'Actualizar datos'}
          onClick={onRefresh}
          disabled={refreshing}
          className={refreshing ? 'is-spinning' : undefined}
        />
        <ThemeButton />
        <NotificationsButton barber={barber} navigate={navigate} />
        <UserMenuButton barber={barber} photo={photo} onLogout={onLogout} onSettings={onSettings} />
      </div>
    </header>
  )
}
