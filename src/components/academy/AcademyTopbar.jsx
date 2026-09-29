import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { useIsPhone } from '../panel/index.js'
import GroupSwitcher from './GroupSwitcher.jsx'
import UserMenu from './UserMenu.jsx'
import { useAcademy } from '../../academy/context.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/app.css'

/* ============================================================
   Barra superior de la Academy (sticky, 64 px, capturas 1/5/6 de Skool):
   selector del grupo · buscador · chats (con contador) · campana (con
   contador rojo) · avatar.

   Los popovers de Chats y Notificaciones los monta el shell; acá solo se
   abren/cierran (`popover` + `onToggle`). Los contadores vienen del
   contexto (unread), que los mantiene `sync` sin polling propio.
   En el celular el buscador es un botón que abre <base>/buscar.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

function Badge({ n, label }) {
  const v = Number(n) || 0
  if (v <= 0) return null
  return (
    <span className="aca-topbar-badge" aria-label={label}>
      {v > 99 ? '99+' : v}
    </span>
  )
}

function SearchBox({ onMembers }) {
  const navigate = useNavigate()
  const location = useLocation()
  const onSearchPage = location.pathname === r.path('/buscar')
  const urlQ = onSearchPage ? new URLSearchParams(location.search).get('q') || '' : ''
  const [q, setQ] = useState(urlQ)
  // Al entrar/salir de la página de búsqueda, el campo refleja la URL.
  useEffect(() => { setQ(urlQ) }, [urlQ, onSearchPage])

  const submit = (e) => {
    e.preventDefault()
    const text = q.trim()
    navigate(r.buscar(text, onMembers ? 'miembros' : undefined))
  }

  return (
    <form className="aca-search" role="search" onSubmit={submit}>
      <Icon name="search" size={18} />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={onMembers ? 'Buscar miembros' : 'Buscar'}
        aria-label={onMembers ? 'Buscar miembros' : 'Buscar en la Academy'}
        enterKeyHint="search"
        maxLength={80}
        autoComplete="off"
      />
    </form>
  )
}

export default function AcademyTopbar({ popover, onToggle }) {
  const { unread } = useAcademy()
  const isPhone = useIsPhone()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const onMembers = pathname.startsWith(r.miembros)
  const chats = Number(unread?.chats) || 0
  const notifs = Number(unread?.notifications) || 0

  return (
    <div className="aca-topbar">
      <div className="aca-topbar-left">
        <GroupSwitcher />
      </div>

      {!isPhone && <SearchBox onMembers={onMembers} />}

      <div className="aca-topbar-actions">
        {isPhone && (
          <button
            type="button"
            className="aca-topbar-btn"
            aria-label="Buscar"
            onClick={() => navigate(r.buscar('', onMembers ? 'miembros' : undefined))}
          >
            <Icon name="search" size={21} />
          </button>
        )}
        <button
          type="button"
          className={cx('aca-topbar-btn', popover === 'chats' && 'is-open')}
          aria-label={chats ? `Chats, ${chats} sin leer` : 'Chats'}
          aria-haspopup="dialog"
          aria-expanded={popover === 'chats'}
          title="Chats"
          onClick={() => onToggle?.('chats')}
        >
          <Icon name="message" size={22} />
          <Badge n={chats} label={`${chats} chats sin leer`} />
        </button>
        <button
          type="button"
          className={cx('aca-topbar-btn', popover === 'notifications' && 'is-open')}
          aria-label={notifs ? `Notificaciones, ${notifs} sin leer` : 'Notificaciones'}
          aria-haspopup="dialog"
          aria-expanded={popover === 'notifications'}
          title="Notificaciones"
          onClick={() => onToggle?.('notifications')}
        >
          <Icon name="bell" size={22} />
          <Badge n={notifs} label={`${notifs} notificaciones sin leer`} />
        </button>
        <UserMenu />
      </div>
    </div>
  )
}

export { AcademyTopbar }
