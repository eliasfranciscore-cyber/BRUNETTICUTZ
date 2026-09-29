import React, { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Sheet, useIsPhone } from '../panel/index.js'
import { useOutsideClose, useTopLayerEscape } from '../panel/hooks.js'
import { useTheme } from '../theme.jsx'
import MemberAvatar from './MemberAvatar.jsx'
import { useAcademy } from '../../academy/context.js'
import { setSession } from '../../academy/session.js'
import { clearQueryCache } from '../../academy/useQuery.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/app.css'

/* ============================================================
   Menú del avatar (arriba a la derecha): Perfil, Ajustes, Tema
   (Claro / Oscuro / Automático) y Cerrar sesión.

   El tema es el MISMO del resto del sitio (ThemeProvider, por dispositivo):
   "Automático" sigue la hora de Santiago igual que el panel. Cerrar sesión
   solo toca las claves ps_academy_* (logout() del contexto): un barbero
   con el panel abierto en el mismo teléfono sigue adentro.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

// Solo con el mock de desarrollo (VITE_DEV_MOCKS=1): en producción la
// condición es `false` en tiempo de compilación y esto desaparece del bundle.
const DEV_SWITCHER = import.meta.env.DEV && import.meta.env.VITE_DEV_MOCKS === '1'

function ThemeChoice() {
  const { theme, auto, setTheme, setAuto } = useTheme()
  const current = auto ? 'auto' : theme === 'light' ? 'light' : 'dark'
  const opts = [
    { id: 'light', label: 'Claro', icon: 'sun' },
    { id: 'dark', label: 'Oscuro', icon: 'moon' },
    { id: 'auto', label: 'Automático', icon: 'clock' },
  ]
  const pick = (id) => {
    if (id === 'auto') setAuto(true)
    else setTheme(id)
  }
  return (
    <div className="aca-theme-choice" role="radiogroup" aria-label="Tema">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={current === o.id}
          className={cx('aca-theme-opt', current === o.id && 'is-on')}
          onClick={() => pick(o.id)}
        >
          <Icon name={o.icon} size={15} />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

function DevSwitcher() {
  const [id, setId] = useState('')
  const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    try {
      const res = await fetch(`/api/__mock/login-as?member=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!res.ok || !data?.token) throw new Error(data?.error || 'No existe')
      setSession(data.token, data.member)
      clearQueryCache()
      window.location.assign(r.home)
    } catch (e2) {
      setErr(e2.message || 'Error')
    }
  }
  return (
    <form className="aca-dev-switch" onSubmit={submit}>
      <label>
        <span>Mock · entrar como miembro #</span>
        <input value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="ID" />
      </label>
      <button type="submit" className="aca-link-btn" disabled={!id}>Entrar</button>
      {err && <small className="aca-dev-err">{err}</small>}
    </form>
  )
}

export default function UserMenu() {
  const { me, logout } = useAcademy()
  const navigate = useNavigate()
  const isPhone = useIsPhone()
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const wrap = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useOutsideClose(wrap, open && !isPhone, close)
  useTopLayerEscape(open && !isPhone, close)

  const go = (to) => {
    setOpen(false)
    navigate(to)
  }

  const onLogout = async () => {
    if (leaving) return
    setLeaving(true)
    try { await logout() } finally { setLeaving(false) }
  }

  const name = me?.name || 'Mi cuenta'
  const body = (
    <>
      {me?.handle && (
        <button type="button" className="aca-usermenu-head" onClick={() => go(r.profile(me.handle))}>
          <MemberAvatar member={me} size={40} showLevel={false} />
          <span>
            <strong>{name}</strong>
            <small>@{me.handle}</small>
          </span>
        </button>
      )}
      <div className="pn-menu-sep" role="separator" />
      {me?.handle && (
        <button type="button" className="pn-menu-item" role="menuitem" onClick={() => go(r.profile(me.handle))}>
          <Icon name="user" size={17} />
          <span>Perfil</span>
        </button>
      )}
      <button type="button" className="pn-menu-item" role="menuitem" onClick={() => go(r.ajustes)}>
        <Icon name="settings" size={17} />
        <span>Ajustes</span>
      </button>
      <button type="button" className="pn-menu-item" role="menuitem" onClick={() => go(r.reglas)}>
        <Icon name="book" size={17} />
        <span>Reglas del grupo</span>
      </button>
      <div className="pn-menu-sep" role="separator" />
      <div className="aca-menu-label">Tema</div>
      <ThemeChoice />
      {DEV_SWITCHER && (
        <>
          <div className="pn-menu-sep" role="separator" />
          <DevSwitcher />
        </>
      )}
      <div className="pn-menu-sep" role="separator" />
      <button type="button" className="pn-menu-item is-danger" role="menuitem" onClick={onLogout} disabled={leaving}>
        <Icon name="logout" size={17} />
        <span>{leaving ? 'Cerrando sesión…' : 'Cerrar sesión'}</span>
      </button>
    </>
  )

  return (
    <div className="aca-usermenu pn-menu-wrap" ref={wrap}>
      <button
        type="button"
        className={cx('aca-usermenu-btn', open && 'is-open')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de tu cuenta"
        title={name}
        onClick={() => setOpen((v) => !v)}
      >
        <MemberAvatar member={me} size={isPhone ? 34 : 40} showLevel={false} />
      </button>
      {open && !isPhone && <div className="pn-menu aca-menu aca-usermenu-menu" role="menu">{body}</div>}
      {isPhone && (
        <Sheet open={open} onClose={close} title="Tu cuenta" size="sm" bodyClassName="is-flush">
          <div className="pn-actsheet aca-actsheet" role="menu">{body}</div>
        </Sheet>
      )}
    </div>
  )
}

export { UserMenu }
