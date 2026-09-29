import React, { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Button, InlineAlert } from '../../components/panel/index.js'
import { useAcaMode } from '../../components/academy/PageState.jsx'
import { academyApi, ApiError } from '../../academy/api.js'
import { getToken, setSession, clearSession, isTokenExpired, isPwcSession } from '../../academy/session.js'
import { clearQueryCache } from '../../academy/useQuery.js'
import { isAcademyPath } from '../../academy/url.js'
import { r, AUTH_PATHS } from '../../academy/routes.js'
import { ACADEMY_BRAND } from '../../academy/hostConfig.js'
import '../../styles/academy/app.css'

/* ============================================================
   <base>/ingreso — correo + contraseña del miembro (SPEC §5.1, §7.1).

   - El servidor responde igual para "correo que no existe" y "contraseña
     mala" (401 genérico): acá tampoco se distingue.
   - 429 `locked`/`busy` trae retryAfter: el botón queda bloqueado con una
     cuenta regresiva, que sobrevive a recargar (sessionStorage).
   - 401 `temp_expired`: la temporal de 72 h venció → se ofrece el enlace
     para crear una nueva (mismo formulario de "¿Olvidaste tu contraseña?").
   - Con sesión abierta no se muestra el formulario: se entra directo.
   - `?next=` solo se respeta si es una ruta de la Academy.

   También exporta las piezas que usan las otras páginas de acceso:
   AuthShell, PasswordInput, ResetRequestForm, useCountdown, fmtWait.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')
const GROUP_KEY = 'ps_academy_group'
const LOCK_KEY = 'ps_academy_login_lock'
const CHECKOUT_KEY = 'ps_academy_checkout'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function readGroupName() {
  try {
    const g = JSON.parse(localStorage.getItem(GROUP_KEY) || 'null')
    return g && typeof g.name === 'string' && g.name.trim() ? g : null
  } catch {
    return null
  }
}

function checkoutEmail() {
  try {
    const d = JSON.parse(sessionStorage.getItem(CHECKOUT_KEY) || 'null')
    return d && typeof d.email === 'string' ? d.email : ''
  } catch {
    return ''
  }
}

export function safeNext(raw) {
  const s = typeof raw === 'string' ? raw : ''
  if (!s || !isAcademyPath(s)) return r.home
  if (AUTH_PATHS.some((p) => s === p || s.startsWith(`${p}?`) || s.startsWith(`${p}/`))) return r.home
  return s
}

/* "4:05" / "45 s" */
export function fmtWait(sec) {
  const s = Math.max(0, Math.ceil(Number(sec) || 0))
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/* Cuenta regresiva hasta `until` (ms epoch). → segundos que faltan (0 = libre). */
export function useCountdown(until) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until || until <= Date.now()) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [until])
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0
}

/* Marco de todas las páginas de acceso: tarjeta blanca centrada sobre el
   fondo de la Academy, con el tile del grupo arriba (como el login de Skool). */
export function AuthShell({ title, subtitle, children, footer, wide = false }) {
  useAcaMode()
  const g = readGroupName()
  const name = g?.name || ACADEMY_BRAND.name
  const initials = String(g?.initials || ACADEMY_BRAND.initials).slice(0, 2).toUpperCase()
  useEffect(() => {
    const prev = document.title
    document.title = title ? `${title} · ${name}` : name
    return () => { document.title = prev }
  }, [title, name])
  return (
    <div className="aca-auth">
      <a className="aca-auth-brand" href={r.catalog} aria-label={`${name} — catálogo de cursos`}>
        <span className="aca-gtile" style={{ '--gt-s': '40px' }} aria-hidden="true">{initials}</span>
        <span>{name}</span>
      </a>
      <main className={cx('aca-auth-card', wide && 'is-wide')}>
        {title && <h1 className="aca-auth-title">{title}</h1>}
        {subtitle && <p className="aca-auth-sub">{subtitle}</p>}
        {children}
      </main>
      {footer && <div className="aca-auth-foot">{footer}</div>}
    </div>
  )
}

export function PasswordInput({ id, value, onChange, autoComplete = 'current-password', placeholder, autoFocus, disabled, invalid, describedBy }) {
  const [show, setShow] = useState(false)
  return (
    <div className="aca-input-wrap">
      <input
        id={id}
        className={cx('aca-input', invalid && 'is-invalid')}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        maxLength={200}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      <button type="button" className="aca-input-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} tabIndex={-1}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
      </button>
    </div>
  )
}

/* "¿Olvidaste tu contraseña?" — pide el enlace por correo. La respuesta es
   SIEMPRE la misma (exista o no la cuenta): no sirve para averiguar quién
   compró. */
export function ResetRequestForm({ initialEmail = '', onBack, backLabel = 'Volver a ingresar' }) {
  const emailId = useId()
  const [email, setEmail] = useState(initialEmail)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')
  const [until, setUntil] = useState(0)
  const wait = useCountdown(until)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const v = email.trim()
    if (!EMAIL_RE.test(v)) { setError('Escribe un correo válido.'); return }
    setBusy(true)
    try {
      const d = await academyApi('password-reset-request', { method: 'POST', body: { email: v } })
      setSent(d?.message || 'Si ese correo tiene acceso a la Academy, te enviamos un enlace para crear una contraseña nueva.')
      setUntil(Date.now() + 60_000)
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setUntil(Date.now() + (err.retryAfter || 900) * 1000)
      }
      setError(err?.message || 'No pudimos enviar el enlace. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="aca-auth-form" onSubmit={submit} noValidate>
      {sent ? (
        <InlineAlert tone="success" title="Revisa tu correo">
          {sent} El enlace dura 30 minutos. Mira también en Spam o Promociones.
        </InlineAlert>
      ) : (
        <p className="aca-auth-text">Escribe el correo con el que compraste y te mandamos un enlace para crear una contraseña nueva.</p>
      )}
      <div className="aca-field">
        <label htmlFor={emailId}>Correo</label>
        <input
          id={emailId}
          className="aca-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={120}
          required
        />
      </div>
      {error && <p className="aca-auth-error" role="alert">{error}</p>}
      <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={wait > 0}>
        {wait > 0 ? `Puedes pedir otro en ${fmtWait(wait)}` : sent ? 'Enviar de nuevo' : 'Enviar enlace'}
      </Button>
      {onBack && (
        <button type="button" className="aca-link-btn aca-auth-back" onClick={onBack}>
          <Icon name="arrowLeft" size={15} /> {backLabel}
        </button>
      )}
    </form>
  )
}

function readLock() {
  try {
    const v = Number(sessionStorage.getItem(LOCK_KEY) || 0)
    return v > Date.now() ? v : 0
  } catch {
    return 0
  }
}
function writeLock(until) {
  try {
    if (until) sessionStorage.setItem(LOCK_KEY, String(until))
    else sessionStorage.removeItem(LOCK_KEY)
  } catch { /* sin storage */ }
}

export default function Ingreso() {
  const navigate = useNavigate()
  const emailId = useId()
  const pwId = useId()
  const errId = useId()
  const [next] = useState(() => {
    try { return safeNext(new URLSearchParams(window.location.search).get('next')) } catch { return r.home }
  })
  const [view, setView] = useState('login') // login | reset
  const [email, setEmail] = useState(checkoutEmail)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null) // { text, code, remaining }
  const [lockUntil, setLockUntil] = useState(readLock)
  const wait = useCountdown(lockUntil)
  const pwRef = useRef(null)

  // Sesión ya abierta (y vigente): directo adentro, sin formulario.
  const [redirecting] = useState(() => {
    const t = getToken()
    if (!t) return false
    if (isTokenExpired(t)) { clearSession(); return false }
    return true
  })
  useEffect(() => {
    if (!redirecting) return
    navigate(isPwcSession() ? r.crearContrasena : next, { replace: true })
  }, [redirecting]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!wait && lockUntil) { setLockUntil(0); writeLock(0) } }, [wait, lockUntil])

  const submit = async (e) => {
    e.preventDefault()
    if (busy || wait > 0) return
    setError(null)
    const v = email.trim()
    if (!EMAIL_RE.test(v)) { setError({ text: 'Escribe un correo válido.' }); return }
    if (!password) { setError({ text: 'Escribe tu contraseña.' }); return }
    setBusy(true)
    try {
      const d = await academyApi('login', { method: 'POST', body: { email: v, password } })
      if (!d?.token) throw new ApiError(503, 'unavailable', 'La Academy no respondió bien. Intenta de nuevo.')
      clearQueryCache()
      setSession(d.token, d.member)
      writeLock(0)
      navigate(d.mustChangePassword || d.member?.mustChangePassword ? r.crearContrasena : next, { replace: true })
    } catch (err) {
      setPassword('')
      if (err instanceof ApiError && err.status === 429) {
        const until = Date.now() + (err.retryAfter || 60) * 1000
        setLockUntil(until)
        writeLock(until)
      }
      const remaining = err?.data?.remainingAttempts
      setError({ text: err?.message || 'No pudimos iniciar sesión.', code: err?.code || null, remaining: Number.isFinite(Number(remaining)) ? Number(remaining) : null })
      setTimeout(() => pwRef.current?.querySelector('input')?.focus(), 0)
    } finally {
      setBusy(false)
    }
  }

  if (redirecting) {
    return (
      <div className="aca-boot" aria-busy="true">
        <span className="route-spinner" aria-label="Entrando" />
      </div>
    )
  }

  const footer = (
    <>
      <a className="aca-link-btn" href={r.catalog}><Icon name="arrowLeft" size={15} /> Volver al catálogo</a>
      <span className="aca-auth-foot-note">¿Aún no tienes acceso? Compra un curso en el catálogo y te llega por correo.</span>
    </>
  )

  if (view === 'reset') {
    return (
      <AuthShell title="Crea una contraseña nueva" footer={footer}>
        <ResetRequestForm initialEmail={email} onBack={() => setView('login')} />
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Entra a la Academy" subtitle="Usa el correo con el que compraste tu curso." footer={footer}>
      <form className="aca-auth-form" onSubmit={submit} noValidate>
        <div className="aca-field">
          <label htmlFor={emailId}>Correo</label>
          <input
            id={emailId}
            className="aca-input"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={120}
            autoFocus={!email}
            required
          />
        </div>
        <div className="aca-field" ref={pwRef}>
          <div className="aca-field-row">
            <label htmlFor={pwId}>Contraseña</label>
            <button type="button" className="aca-link-btn" onClick={() => { setError(null); setView('reset') }}>
              ¿Olvidaste tu contraseña?
            </button>
          </div>
          <PasswordInput
            id={pwId}
            value={password}
            onChange={setPassword}
            autoFocus={Boolean(email)}
            invalid={Boolean(error && error.code === 'invalid_credentials')}
            describedBy={error ? errId : undefined}
          />
          <small className="aca-field-hint">Si es tu primera vez, usa la contraseña temporal que te llegó por correo (con o sin guiones).</small>
        </div>

        {error && (
          <div id={errId} className="aca-auth-error" role="alert">
            <p>{error.text}</p>
            {error.code === 'invalid_credentials' && error.remaining !== null && error.remaining > 0 && error.remaining <= 2 && (
              <p className="aca-auth-error-sub">
                Te {error.remaining === 1 ? 'queda 1 intento' : `quedan ${error.remaining} intentos`} antes de un bloqueo de 5 minutos.
              </p>
            )}
            {error.code === 'temp_expired' && (
              <button type="button" className="aca-link-btn" onClick={() => { setError(null); setView('reset') }}>
                Pedir un enlace para crear mi contraseña
              </button>
            )}
          </div>
        )}

        <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={wait > 0}>
          {wait > 0 ? `Vuelve a intentar en ${fmtWait(wait)}` : 'Entrar'}
        </Button>
      </form>
    </AuthShell>
  )
}
