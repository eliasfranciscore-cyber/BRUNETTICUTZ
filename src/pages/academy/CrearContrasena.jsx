import React, { useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Button, InlineAlert } from '../../components/panel/index.js'
import { AuthShell, PasswordInput } from './Ingreso.jsx'
import { academyApi, ApiError } from '../../academy/api.js'
import { getToken, getMember, setSession, clearSession, isTokenExpired, isPwcSession } from '../../academy/session.js'
import { memberPasswordProblem, memberPasswordChecks, MEMBER_PASSWORD_HINT } from '../../academy/passwordRule.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/app.css'

/* ============================================================
   <base>/crear-contrasena — cambio OBLIGATORIO después de entrar con la
   contraseña temporal del correo (token "pwc", válido 15 minutos).

   No pide la actual: la persona la acaba de escribir en el login. El
   servidor rechaza repetir la temporal y valida la regla (10+ caracteres,
   distinta del correo, no común); acá se muestra la misma regla en vivo
   para no gastar un viaje. Al guardar llega un token completo y se entra.

   Exporta NewPasswordFields (lo usa también <base>/restablecer).
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

/* Contraseña nueva + confirmación, con la lista de chequeos bajo el campo. */
export function NewPasswordFields({ email, password, confirm, onPassword, onConfirm, disabled }) {
  const pwId = useId()
  const cfId = useId()
  const hintId = useId()
  const checks = memberPasswordChecks(password, email)
  const mismatch = Boolean(confirm) && confirm !== password
  return (
    <>
      <div className="aca-field">
        <label htmlFor={pwId}>Contraseña nueva</label>
        <PasswordInput id={pwId} value={password} onChange={onPassword} autoComplete="new-password" autoFocus disabled={disabled} describedBy={hintId} />
        <small id={hintId} className="aca-field-hint">{MEMBER_PASSWORD_HINT}</small>
        <ul className="aca-pw-checks" aria-label="Requisitos de la contraseña">
          {checks.map((c) => (
            <li key={c.id} className={cx(c.ok && 'is-ok')}>
              <Icon name={c.ok ? 'checkCircle' : 'info'} size={14} />
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="aca-field">
        <label htmlFor={cfId}>Repite la contraseña</label>
        <PasswordInput id={cfId} value={confirm} onChange={onConfirm} autoComplete="new-password" disabled={disabled} invalid={mismatch} />
        {mismatch && <small className="aca-field-error">Las contraseñas no coinciden.</small>}
      </div>
    </>
  )
}

export default function CrearContrasena() {
  const navigate = useNavigate()
  const [member] = useState(() => getMember())
  const [state] = useState(() => {
    const t = getToken()
    if (!t) return 'nosession'
    if (isTokenExpired(t)) return 'expired'
    if (!isPwcSession()) return 'already'
    return 'ok'
  })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(state === 'expired')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (state === 'nosession') window.location.replace(r.ingreso)
    // Sesión normal (ya tiene contraseña): esta pantalla no aplica.
    else if (state === 'already') navigate(r.home, { replace: true })
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  const email = member?.email || ''

  const backToLogin = () => {
    clearSession()
    window.location.assign(r.ingreso)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setError('')
    const problem = memberPasswordProblem(password, email)
    if (problem) { setError(problem); return }
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return }
    if (isTokenExpired()) { setExpired(true); return }
    setBusy(true)
    try {
      const d = await academyApi('password-change', { method: 'POST', body: { newPassword: password } })
      if (!d?.token) throw new ApiError(503, 'unavailable', 'La Academy no respondió bien. Intenta de nuevo.')
      setSession(d.token, d.member)
      setPassword('')
      setConfirm('')
      setDone(true)
      setTimeout(() => navigate(r.home, { replace: true }), 1200)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setExpired(true)
      } else {
        setError(err?.message || 'No se pudo guardar la contraseña.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (state === 'nosession' || state === 'already') {
    return (
      <div className="aca-boot" aria-busy="true">
        <span className="route-spinner" aria-label="Cargando" />
      </div>
    )
  }

  if (expired) {
    return (
      <AuthShell title="Tu sesión venció">
        <div className="aca-auth-form">
          <p className="aca-auth-text">
            Por seguridad tienes 15 minutos para crear tu contraseña después de entrar con la temporal. Vuelve a entrar con la contraseña del correo (sigue sirviendo mientras no venzan sus 72 horas).
          </p>
          <Button variant="primary" size="lg" block onClick={backToLogin}>Volver a entrar</Button>
        </div>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell title="¡Listo!">
        <div className="aca-auth-form">
          <InlineAlert tone="success" title="Contraseña creada">Desde ahora entras con tu correo y esta contraseña.</InlineAlert>
          <Button variant="primary" size="lg" block onClick={() => navigate(r.home, { replace: true })}>Entrar a la Academy</Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Crea tu contraseña"
      subtitle={member?.name ? `¡Hola, ${String(member.name).split(/\s+/)[0]}! Antes de entrar, elige una contraseña que solo tú sepas.` : 'Antes de entrar, elige una contraseña que solo tú sepas.'}
      footer={<button type="button" className="aca-link-btn" onClick={backToLogin}><Icon name="logout" size={15} /> Cerrar sesión</button>}
    >
      <form className="aca-auth-form" onSubmit={submit} noValidate>
        {email && (
          <div className="aca-auth-account">
            <Icon name="mail" size={16} />
            <span>{email}</span>
          </div>
        )}
        <NewPasswordFields email={email} password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} disabled={busy} />
        {error && <p className="aca-auth-error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>Guardar y entrar</Button>
      </form>
    </AuthShell>
  )
}
