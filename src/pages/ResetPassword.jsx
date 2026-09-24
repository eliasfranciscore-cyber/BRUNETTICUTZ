import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Emblem, Icon } from '../components/ui.jsx'
import { isValidPassword, passwordProblem, PASSWORD_RULES } from '../passwordRules.js'

/* /restablecer — la página del enlace que llega por correo cuando alguien
   pide "¿Olvidaste tu contraseña?" en /ingreso.

   El token viaja en la URL (`?token=`, o `?t=` en los correos más antiguos) y
   se saca de la barra de direcciones apenas se lee: así no queda en el
   historial del navegador ni se filtra por el header Referer. La validez de
   verdad la decide el servidor al enviarlo (POST /api/auth-barber
   ?reset=confirm): para el navegador el token es opaco. El enlace dura 30
   minutos y sirve una sola vez.

   La regla de la contraseña es la de src/passwordRules.js (espejo de la del
   servidor), solo para avisar mientras se escribe: quien manda es el
   servidor, que revalida al guardar. */

const REQUEST_NEW = '/ingreso?recuperar=1'

// El shell fuerza data-theme="dark", pero con la web en claro la regla
// `[data-theme="light"] .input` de pimp.css (fondo blanco) igual le aplica y
// el texto claro del tema oscuro quedaba blanco sobre blanco. El estilo en
// línea gana sin !important y usa los tokens del shell oscuro.
const SHELL_INPUT = { background: 'var(--fill-card)', color: 'var(--ink)' }

export default function ResetPassword() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Se lee en el primer render (no en un efecto) para no mostrar un instante
  // el aviso de "enlace no válido" antes de tener el token.
  const [token, setToken] = useState(() => params.get('token') || params.get('t') || '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // El servidor dijo que el enlace no sirve (vencido, usado o inválido): se
  // ofrece pedir uno nuevo en vez de dejar reintentar con el mismo.
  const [linkDead, setLinkDead] = useState(false)
  const [done, setDone] = useState(false)
  const leaveTimer = useRef(null)

  useEffect(() => {
    if (params.get('token') || params.get('t')) navigate('/restablecer', { replace: true })
    return () => clearTimeout(leaveTimer.current)
    // Solo al montar: después de limpiar la URL, `params` queda vacío a
    // propósito y el token ya vive en el estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const problem = password ? passwordProblem(password) : ''
  const mismatch = Boolean(confirm) && confirm !== password

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setErr('')
    if (!token) { setLinkDead(true); return }
    const why = passwordProblem(password)
    if (why) { setErr(why); return }
    if (password !== confirm) { setErr('Las contraseñas no coinciden.'); return }

    setBusy(true)
    try {
      const res = await fetch('/api/auth-barber?reset=confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setDone(true)
        setPassword(''); setConfirm(''); setToken('')
        leaveTimer.current = setTimeout(() => navigate('/ingreso', { replace: true }), 2500)
        return
      }
      const msg = data.error || 'No se pudo cambiar la contraseña.'
      // 400 por la contraseña (la regla del servidor) deja reintentar; 400 por
      // el enlace no tiene arreglo con el mismo token.
      if (res.status === 400 && /enlace|link|token|venci|us[oó]/i.test(msg)) setLinkDead(true)
      setErr(msg)
    } catch {
      setErr('No se pudo conectar con el servidor. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  const noToken = !token && !done

  return (
    // Igual que /ingreso: el acceso interno es siempre de estética oscura.
    <div className="barber-login-shell" data-theme="dark">
      <div className="barber-login-card">
        <div className="barber-login-visual">
          <img src="/assets/bruno-portrait.jpg" alt="Brunetti" />
          <div className="barber-login-overlay" />
          <div className="barber-login-copy">
            <span className="eyebrow">Acceso Brunetti</span>
            <Emblem size={88} />
            <h1 className="font-display">Crea una contraseña nueva.</h1>
            <p>
              Este enlace sirve una sola vez y dura 30 minutos. Después de guardarla,
              entra al panel de Brunetti con tu usuario de siempre.
            </p>
          </div>
        </div>

        <div className="barber-login-form-wrap">
          <div className="barber-login-form-panel">
            <div>
              <span className="eyebrow">Restablecer</span>
              <h2 className="font-display">Contraseña nueva</h2>
            </div>

            {done ? (
              <div style={{ display: 'grid', gap: '.7rem', justifyItems: 'start' }} role="status">
                <span className="chip chip-gold"><Icon name="check" size={13} /> Contraseña actualizada</span>
                <p style={{ color: 'var(--muted)', fontSize: '.85rem', margin: 0 }}>
                  Listo. Ya puedes entrar con tu contraseña nueva; te llevamos al acceso…
                </p>
                <button type="button" className="btn btn-gold btn-block" onClick={() => navigate('/ingreso', { replace: true })}>
                  Ir al acceso <Icon name="arrowRight" size={15} />
                </button>
              </div>
            ) : noToken || linkDead ? (
              <div style={{ display: 'grid', gap: '.8rem', justifyItems: 'start' }} role="alert">
                <div className="barber-login-error">
                  <Icon name="bell" size={14} />
                  {linkDead && err
                    ? err
                    : 'Este enlace no es válido o está incompleto. Ábrelo tal cual llegó al correo, o pide uno nuevo.'}
                </div>
                <p style={{ color: 'var(--muted)', fontSize: '.82rem', margin: 0 }}>
                  Los enlaces duran 30 minutos y sirven una sola vez. Pedir uno nuevo anula los anteriores.
                </p>
                <button type="button" className="btn btn-gold btn-block" onClick={() => navigate(REQUEST_NEW)}>
                  Pedir un enlace nuevo <Icon name="mail" size={15} />
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="barber-login-form" noValidate>
                <div className="field">
                  <label htmlFor="rp-password">Contraseña nueva</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="rp-password"
                      className="input"
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value.slice(0, 200)); setErr('') }}
                      placeholder="Mínimo 10 caracteres"
                      autoComplete="new-password"
                      aria-describedby="rp-rule"
                      aria-invalid={password ? !isValidPassword(password) : undefined}
                      style={{ ...SHELL_INPUT, paddingRight: '3.2rem' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      style={{ position: 'absolute', right: '.6rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 0, color: 'var(--muted)', fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', padding: '.3rem' }}
                    >{showPw ? 'Ocultar' : 'Ver'}</button>
                  </div>
                  <span
                    id="rp-rule"
                    aria-live="polite"
                    style={{ fontSize: '.72rem', display: 'inline-flex', alignItems: 'center', gap: '.3rem', color: !password ? 'var(--muted-2)' : problem ? 'var(--red)' : 'var(--gold-lt)' }}
                  >
                    {password && !problem && <Icon name="check" size={12} />}
                    {password ? (problem || 'Cumple los requisitos.') : PASSWORD_RULES}
                  </span>
                </div>

                <div className="field">
                  <label htmlFor="rp-confirm">Repite la contraseña</label>
                  <input
                    id="rp-confirm"
                    className="input"
                    style={SHELL_INPUT}
                    type={showPw ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => { setConfirm(e.target.value.slice(0, 200)); setErr('') }}
                    placeholder="La misma de arriba"
                    autoComplete="new-password"
                    aria-invalid={mismatch || undefined}
                  />
                  {mismatch && (
                    <span style={{ fontSize: '.72rem', color: 'var(--red)' }}>Todavía no coinciden.</span>
                  )}
                </div>

                {err && (
                  <div className="barber-login-error" role="alert"><Icon name="bell" size={14} /> {err}</div>
                )}

                <button className="btn btn-gold btn-block" type="submit" disabled={busy} style={{ opacity: busy ? 0.45 : 1 }}>
                  {busy ? 'Guardando…' : 'Guardar contraseña'}
                  {!busy && <Icon name="check" size={15} />}
                </button>
              </form>
            )}

            <div className="barber-login-links">
              <button onClick={() => navigate('/ingreso')} type="button">← Volver al acceso</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
