import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Emblem, Icon } from '../components/ui.jsx'
import { BARBERS } from '../data.js'
import { FEATURES } from '../features.js'

/* El bloqueo por intentos fallidos vive EN EL SERVIDOR (api/_rateLimit.js,
   tabla login_attempts): 3 fallos → 5 minutos, contados en la base por
   usuario y por IP. El que había acá se guardaba en localStorage, así que se
   saltaba borrando el storage, abriendo una ventana de incógnito o llamando
   al endpoint con curl: no protegía de nadie que quisiera saltárselo. Esta
   pantalla ya solo MUESTRA lo que responde el servidor: el 401 trae los
   intentos que quedan (en el texto y en `remaining`) y el 429 los segundos
   que faltan (`retryAfterSeconds`), que acá se cuentan hacia atrás. */

// Clave del bloqueo viejo en el navegador: se borra para no dejar basura.
const LEGACY_LOCKOUT_KEY = 'ps_login_lockout'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// El shell fuerza data-theme="dark", pero con la web en claro la regla
// `[data-theme="light"] .input` de pimp.css (fondo blanco) igual le aplica y
// el texto claro del tema oscuro quedaba blanco sobre blanco. El estilo en
// línea gana sin !important y usa los tokens del shell oscuro.
const SHELL_INPUT = { background: "var(--fill-card)", color: "var(--ink)" }

// Cuenta regresiva del botón: "4:32" o "45 s".
function clockWait(seconds) {
  const s = Math.max(0, Math.ceil(seconds))
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return `${s} s`
}
// Texto del aviso, a propósito en minutos: cambia pocas veces, así el lector
// de pantalla no lo repite cada segundo.
function wordsWait(seconds) {
  if (seconds > 60) {
    const min = Math.ceil(seconds / 60)
    return `${min} minutos`
  }
  return 'menos de un minuto'
}

function attemptsLeftText(n) {
  return `${n} ${n === 1 ? 'intento restante' : 'intentos restantes'}`
}

export default function BarberLogin() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPass, setShowPass] = useState(false)
  const [err, setErr] = useState("")
  const [loading, setLoading] = useState(false)
  // Bloqueo que informó el servidor: hasta cuándo (ms) y de qué tipo
  // ('attempts' = intentos fallidos; 'other' = no pudo verificar, p. ej. la
  // tabla de intentos no respondió, y su propio texto se muestra tal cual).
  const [lockUntil, setLockUntil] = useState(0)
  const [lockKind, setLockKind] = useState('attempts')
  const [now, setNow] = useState(() => Date.now())
  // "¿Olvidaste tu contraseña?": se despliega en la misma pantalla en vez de
  // abrir un modal (es un solo campo y así no tapa el formulario). `?recuperar=1`
  // lo abre de entrada: es el botón "Pedir un enlace nuevo" de /restablecer.
  const [forgotOpen, setForgotOpen] = useState(() => FEATURES.passwordReset && params.get('recuperar') === '1')
  const [forgotEmail, setForgotEmail] = useState("")
  const [forgotMsg, setForgotMsg] = useState(null)
  const [forgotBusy, setForgotBusy] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const forgotInputRef = useRef(null)

  const lockLeft = lockUntil > now ? Math.ceil((lockUntil - now) / 1000) : 0
  const locked = lockLeft > 0

  // Si ya hay una sesión guardada y vigente, entra directo al panel sin pedir
  // login otra vez (el panel cierra sesión solo tras 30 min de inactividad).
  useEffect(() => {
    try { localStorage.removeItem(LEGACY_LOCKOUT_KEY) } catch {}
    if (localStorage.getItem("ps_barber")) navigate("/panel", { replace: true })
  }, [])

  // Cuenta regresiva del bloqueo. Se compara contra el reloj (no se resta 1
  // por tick) para que no se atrase si el navegador frena la pestaña.
  useEffect(() => {
    if (!lockUntil) return
    const iv = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= lockUntil) { setLockUntil(0); setErr("") }
    }, 1000)
    return () => clearInterval(iv)
  }, [lockUntil])

  useEffect(() => {
    if (forgotOpen) forgotInputRef.current?.focus()
  }, [forgotOpen])

  // Único camino de "entró bien": lo comparten el login real y el respaldo de
  // desarrollo, para que no se desincronicen las cosas que hay que guardar.
  const applyLogin = (data) => {
    localStorage.setItem("ps_barber", JSON.stringify(data.barber))
    localStorage.setItem("ps_barber_token", data.token || "")
    navigate("/panel")
  }

  const startLock = (seconds, kind) => {
    const t = Date.now()
    setNow(t)
    setLockKind(kind)
    setLockUntil(t + seconds * 1000)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (locked || loading) return
    if (!username.trim() || password.length < 8) { setErr("Ingresa tu usuario y contraseña (mínimo 8 caracteres)."); return }
    setErr("")
    setLoading(true)
    try {
      const res = await fetch("/api/auth-barber", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      // Sin try/catch propio a propósito: una respuesta que no es JSON (Vite
      // sin funciones, un 504 en HTML) cae al catch de abajo como "sin
      // conexión", que es donde vive el respaldo de desarrollo.
      const data = await res.json()
      if (data.ok) {
        applyLogin(data)
        return
      }
      if (res.status === 429) {
        const seconds = Number(data.retryAfterSeconds) || Number(res.headers.get("Retry-After")) || 0
        const kind = !data.error || /intento/i.test(data.error) ? 'attempts' : 'other'
        if (seconds > 0) startLock(seconds, kind)
        setErr(data.error || "Demasiados intentos fallidos.")
        return
      }
      let msg = data.error || "Usuario o contraseña incorrectos"
      // El servidor ya pone el conteo en el texto; si no viniera, se arma con
      // `remaining` (sin inventarlo: sin número no se muestra nada).
      const left = Number(data.remaining ?? data.remainingAttempts)
      if (res.status === 401 && Number.isFinite(left) && left > 0 && !/intento/i.test(msg)) {
        msg = `${msg} (${attemptsLeftText(left)})`
      }
      setErr(msg)
    } catch {
      // Respaldo local para desarrollo (Vite no sirve serverless functions).
      // Credenciales: usuario = code del barbero | contraseña = 8+ caracteres.
      if (import.meta.env.DEV) {
        const typed = username.trim().toLowerCase()
        const devBarber = BARBERS.find((b) => b.code === typed || b.name.toLowerCase() === typed) || BARBERS[0]
        if (devBarber && password.length >= 8) {
          applyLogin({ barber: { ...devBarber, admin: true }, token: "dev-token" })
          return
        }
      }
      setErr("No se pudo conectar. Revisa tu conexión.")
    } finally {
      setLoading(false)
    }
  }

  /* Pedir el enlace para restablecer. La respuesta del servidor es la misma
     exista o no el correo, así que acá tampoco se distingue: decir "ese
     correo no existe" convertiría esta pantalla en un verificador de quién
     tiene acceso al panel. */
  const requestReset = async (e) => {
    e.preventDefault()
    if (forgotBusy) return
    const email = forgotEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) {
      setForgotMsg({ tone: "err", text: "Escribe un correo válido." })
      return
    }
    setForgotBusy(true); setForgotMsg(null)
    try {
      const res = await fetch("/api/auth-barber?reset=request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.ok) {
        setForgotSent(true)
        setForgotMsg({ tone: "ok", text: data.message || "Si ese correo está registrado, te enviamos un enlace para crear una contraseña nueva." })
      } else {
        setForgotMsg({ tone: "err", text: data.error || "No se pudo enviar el enlace. Intenta de nuevo." })
      }
    } catch {
      setForgotMsg({ tone: "err", text: "No se pudo conectar con el servidor." })
    } finally {
      setForgotBusy(false)
    }
  }

  const closeForgot = () => { setForgotOpen(false); setForgotMsg(null) }

  const errText = locked && lockKind === 'attempts'
    ? `Demasiados intentos fallidos. Reintenta en ${wordsWait(lockLeft)}.`
    : err

  return (
    // El acceso interno es siempre de estética oscura (foto + panel negro).
    // Forzamos la paleta dark localmente para que los textos (título, labels)
    // sean legibles aunque la web pública esté en tema claro.
    <div className="barber-login-shell" data-theme="dark">
      <div className="barber-login-card">
        <div className="barber-login-visual">
          <img src="/assets/gallery-2.jpg" alt="Brunetti interior" />
          <div className="barber-login-overlay" />
          <div className="barber-login-copy">
            <span className="eyebrow">Acceso Brunetti</span>
            <Emblem size={88} />
            <h1 className="font-display">Panel interno · agenda de Brunetti.</h1>
            <p>
              Desde aquí Bruno gestiona su agenda y sus reservas en BRUNETTI.
              Acceso exclusivo de administración.
            </p>
            <div className="barber-login-pill-row">
              <span className="chip chip-gold">Agenda</span>
              <span className="chip">Reservas</span>
            </div>
          </div>
        </div>

        <div className="barber-login-form-wrap">
          <div className="barber-login-form-panel">
            <div>
              <span className="eyebrow">Acceso equipo</span>
              <h2 className="font-display">Ingresa a tu panel</h2>
            </div>
            <form onSubmit={submit} className="barber-login-form">
              <div className="field">
                <label htmlFor="bl-user">Usuario</label>
                <input id="bl-user" className="input" style={SHELL_INPUT} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="tu-usuario" autoComplete="username" />
              </div>
              <div className="field">
                <label htmlFor="bl-pass">Contraseña</label>
                <div style={{ position: "relative" }}>
                  <input
                    id="bl-pass"
                    className="input"
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value.slice(0, 200))}
                    placeholder="Tu contraseña"
                    autoComplete="current-password"
                    style={{ ...SHELL_INPUT, paddingRight: "3rem" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                    style={{ position: "absolute", right: ".6rem", top: "50%", transform: "translateY(-50%)", background: "none", border: 0, color: "var(--muted)", fontSize: ".72rem", letterSpacing: ".08em", textTransform: "uppercase", padding: ".3rem" }}
                  >
                    {showPass ? "Ocultar" : "Ver"}
                  </button>
                </div>
              </div>
              {errText && (
                <div className="barber-login-error" role="alert">
                  <Icon name="bell" size={14} />
                  {errText}
                </div>
              )}
              <button
                className="btn btn-gold btn-block"
                type="submit"
                disabled={loading || locked}
                style={{ opacity: (loading || locked) ? 0.45 : 1 }}
              >
                {loading
                  ? "Verificando…"
                  : locked
                    ? `Bloqueado · ${clockWait(lockLeft)}`
                    : "Entrar al panel"}
                {!loading && !locked && <Icon name="arrowRight" size={15} />}
              </button>
            </form>

            {FEATURES.passwordReset && forgotOpen && (
              <form
                id="bl-forgot"
                noValidate
                onSubmit={requestReset}
                onKeyDown={(e) => { if (e.key === "Escape") closeForgot() }}
                aria-label="Recuperar el acceso"
                style={{ display: "grid", gap: ".5rem", padding: ".9rem", borderRadius: 14, border: "1px solid var(--hair-2)", background: "var(--fill-soft)" }}
              >
                <span className="font-display" style={{ fontSize: ".85rem", fontWeight: 600 }}>Recuperar el acceso</span>
                <p style={{ margin: 0, fontSize: ".75rem", color: "var(--muted)" }}>
                  Escribe el correo asociado a tu cuenta y te mandamos un enlace para crear una contraseña nueva. Dura 30 minutos.
                </p>
                <input
                  ref={forgotInputRef}
                  className="input"
                  style={SHELL_INPUT}
                  type="email"
                  inputMode="email"
                  value={forgotEmail}
                  onChange={(e) => { setForgotEmail(e.target.value); setForgotMsg(null); setForgotSent(false) }}
                  placeholder="tucorreo@gmail.com"
                  autoComplete="email"
                  aria-label="Correo"
                />
                {forgotMsg && (
                  <span role={forgotMsg.tone === "ok" ? "status" : "alert"} style={{ fontSize: ".75rem", color: forgotMsg.tone === "ok" ? "var(--gold-lt)" : "var(--red)" }}>{forgotMsg.text}</span>
                )}
                <div style={{ display: "flex", gap: ".5rem" }}>
                  <button className="btn btn-gold btn-sm" type="submit" disabled={forgotBusy || forgotSent} style={{ flex: 1, opacity: (forgotBusy || forgotSent) ? 0.6 : 1 }}>
                    {forgotBusy ? "Enviando…" : forgotSent ? "Enlace enviado" : "Enviar enlace"}
                  </button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={closeForgot}>Cancelar</button>
                </div>
              </form>
            )}

            <div className="barber-login-links">
              <button onClick={() => navigate("/")} type="button">← Ver web</button>
              {FEATURES.passwordReset ? (
                <button
                  type="button"
                  aria-expanded={forgotOpen}
                  aria-controls="bl-forgot"
                  onClick={() => { setForgotOpen((v) => !v); setForgotMsg(null) }}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              ) : (
                <button type="button" onClick={() => setErr("Pide a la administración que restablezca tu contraseña, o cámbiala en Ajustes una vez dentro.")}>¿Olvidaste tu contraseña?</button>
              )}
            </div>
            <div className="barber-login-demo">
              ¿Primera vez? La administración te entrega tu contraseña.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
