import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Button, InlineAlert } from '../../components/panel/index.js'
import { AuthShell, ResetRequestForm } from './Ingreso.jsx'
import { NewPasswordFields } from './CrearContrasena.jsx'
import { academyApi, ApiError } from '../../academy/api.js'
import { setSession } from '../../academy/session.js'
import { clearQueryCache } from '../../academy/useQuery.js'
import { memberPasswordProblem } from '../../academy/passwordRule.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/app.css'

/* ============================================================
   <base>/restablecer?token=… — enlace del correo para crear una
   contraseña nueva (también activa una cuenta que nunca la tuvo).

   El token se saca de la barra de direcciones apenas se lee: así no queda
   en el historial ni viaja en un Referer. Es opaco para el navegador; la
   validez la decide el servidor al usarlo (30 min, un solo uso).
   Sin token → formulario para pedir el enlace.
   ============================================================ */

const TOKEN_RE = /^[A-Za-z0-9_.~-]{20,200}$/

function takeToken() {
  try {
    const t = new URLSearchParams(window.location.search).get('token') || ''
    return TOKEN_RE.test(t) ? t : t ? 'invalid' : ''
  } catch {
    return ''
  }
}

export default function Restablecer() {
  const navigate = useNavigate()
  const [token, setToken] = useState(takeToken)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [badLink, setBadLink] = useState(token === 'invalid')
  const [done, setDone] = useState(false)

  useEffect(() => {
    try {
      if (window.location.search) window.history.replaceState(window.history.state, '', r.restablecer)
    } catch { /* navegador sin history */ }
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setError('')
    const problem = memberPasswordProblem(password, '')
    if (problem) { setError(problem); return }
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return }
    setBusy(true)
    try {
      const d = await academyApi('password-reset-confirm', { method: 'POST', body: { token, password } })
      setToken('')
      setPassword('')
      setConfirm('')
      if (d?.token) {
        clearQueryCache()
        setSession(d.token, d.member)
      }
      setDone(true)
      setTimeout(() => navigate(d?.token ? (d.member?.mustChangePassword ? r.crearContrasena : r.home) : r.ingreso, { replace: true }), 1500)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_token') {
        setBadLink(true)
      } else {
        setError(err?.message || 'No se pudo guardar la contraseña.')
      }
    } finally {
      setBusy(false)
    }
  }

  const footer = <a className="aca-link-btn" href={r.catalog}><Icon name="arrowLeft" size={15} /> Volver al catálogo</a>

  if (done) {
    return (
      <AuthShell title="Contraseña guardada" footer={footer}>
        <div className="aca-auth-form">
          <InlineAlert tone="success" title="¡Listo!">Tu contraseña nueva ya funciona. Te estamos llevando a la Academy.</InlineAlert>
          <Button variant="primary" size="lg" block onClick={() => navigate(r.home, { replace: true })}>Entrar a la Academy</Button>
        </div>
      </AuthShell>
    )
  }

  if (!token || badLink) {
    return (
      <AuthShell
        title={badLink ? 'Este enlace ya no sirve' : 'Crea una contraseña nueva'}
        subtitle={badLink ? 'Los enlaces duran 30 minutos y sirven una sola vez. Pide uno nuevo acá abajo.' : undefined}
        footer={footer}
      >
        <ResetRequestForm onBack={() => navigate(r.ingreso)} />
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Crea una contraseña nueva" subtitle="Elige una contraseña que solo tú sepas. Con ella entras desde cualquier dispositivo." footer={footer}>
      <form className="aca-auth-form" onSubmit={submit} noValidate>
        <NewPasswordFields email="" password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} disabled={busy} />
        {error && <p className="aca-auth-error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>Guardar contraseña</Button>
      </form>
    </AuthShell>
  )
}
