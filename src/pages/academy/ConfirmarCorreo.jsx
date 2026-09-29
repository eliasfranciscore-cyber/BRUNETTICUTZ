import React, { useEffect, useState } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import { Button, InlineAlert } from '../../components/panel/index.js'
import { AuthShell } from './Ingreso.jsx'
import { academyApi } from '../../academy/api.js'
import { clearSession } from '../../academy/session.js'
import { clearQueryCache } from '../../academy/useQuery.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/app.css'

/* ============================================================
   <base>/confirmar-correo?token=… — el enlace que llega al correo NUEVO
   cuando un miembro cambia su correo en Ajustes.

   El token se saca de la URL al leerlo (historial/Referer). Se confirma con
   un botón y no solo con abrir la página: algunos filtros de correo abren
   los enlaces para revisarlos, y eso no debe cambiar el correo de nadie.
   Al confirmar, el servidor cierra la sesión en todos los dispositivos
   (session_version + 1) y avisa al correo anterior: acá se borra la sesión
   local y se ofrece volver a entrar con el correo nuevo.
   ============================================================ */

const TOKEN_RE = /^[A-Za-z0-9_.~-]{20,200}$/

export default function ConfirmarCorreo() {
  const [token] = useState(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('token') || ''
      return TOKEN_RE.test(t) ? t : ''
    } catch {
      return ''
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null) // { email }

  useEffect(() => {
    try {
      if (window.location.search) window.history.replaceState(window.history.state, '', r.confirmarCorreo)
    } catch { /* sin history */ }
  }, [])

  const confirm = async () => {
    if (busy || !token) return
    setBusy(true)
    setError('')
    try {
      const d = await academyApi('email-change-confirm', { method: 'POST', body: { token } })
      // La sesión de este navegador ya no sirve (el servidor subió
      // session_version): borrarla evita un rebote por 401 más adelante.
      clearSession()
      clearQueryCache()
      setDone({ email: d?.email || '' })
    } catch (err) {
      setError(err?.message || 'No se pudo confirmar el cambio de correo.')
    } finally {
      setBusy(false)
    }
  }

  const footer = <a className="aca-link-btn" href={r.catalog}><Icon name="arrowLeft" size={15} /> Volver al catálogo</a>

  if (done) {
    return (
      <AuthShell title="Correo actualizado" footer={footer}>
        <div className="aca-auth-form">
          <InlineAlert tone="success" title="¡Listo!">
            {done.email ? `Desde ahora entras con ${done.email}.` : 'Desde ahora entras con tu correo nuevo.'} Por seguridad cerramos tu sesión en todos los dispositivos.
          </InlineAlert>
          <Button variant="primary" size="lg" block onClick={() => window.location.assign(r.ingreso)}>Entrar con mi correo nuevo</Button>
        </div>
      </AuthShell>
    )
  }

  if (!token) {
    return (
      <AuthShell title="Enlace inválido" subtitle="Este enlace está incompleto. Ábrelo directo desde el correo o pide el cambio de nuevo en Ajustes." footer={footer}>
        <div className="aca-auth-form">
          <Button variant="primary" size="lg" block onClick={() => window.location.assign(r.ingreso)}>Ir a ingresar</Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Confirma tu correo nuevo" subtitle="Toca el botón para usar este correo en tu cuenta de la Academy." footer={footer}>
      <div className="aca-auth-form">
        {error && (
          <InlineAlert tone="error" title="No se pudo confirmar">
            {error}
          </InlineAlert>
        )}
        <Button variant="primary" size="lg" block loading={busy} onClick={confirm}>Confirmar cambio de correo</Button>
        <p className="aca-auth-text is-small">El enlace dura 30 minutos. Si no pediste este cambio, ignora este mensaje: tu correo sigue igual.</p>
      </div>
    </AuthShell>
  )
}
