import React, { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import {
  Button, Field, List, ListRow, ToggleRow, Segmented, InlineAlert, Note, ConfirmDialog, SkeletonRows, SavedTick,
} from '../../components/panel/index.js'
import MemberAvatar from '../../components/academy/MemberAvatar.jsx'
import {
  LINK_KEYS, LINK_META, toLinkUrl, errorText, downloadBlob, todayStamp, cx,
} from '../../components/academy/MemberCard.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { setSession, clearSession } from '../../academy/session.js'
import { memberPasswordProblem } from '../../academy/passwordRule.js'
import { uploadImage } from '../../academy/upload.js'
import { isImageUrl } from '../../academy/url.js'
import { r } from '../../academy/routes.js'
import { ACADEMY_BRAND } from '../../academy/hostConfig.js'
import { useTheme } from '../../components/theme.jsx'
import '../../styles/academy/miembros.css'

/* ============================================================
   Ajustes del miembro (/academy/ajustes?seccion=…).
   Los interruptores se guardan al tocarlos (optimista, con vuelta atrás
   si falla); los campos de texto con su botón Guardar. Las preferencias
   se mandan COMPLETAS en `me-update` para no depender de si el servidor
   hace merge profundo o reemplaza el objeto.
   ============================================================ */

const SECTIONS = [
  ['perfil', 'Perfil', 'user'],
  ['cuenta', 'Cuenta', 'key'],
  ['notificaciones', 'Notificaciones', 'bell'],
  ['chat', 'Chat', 'message'],
  ['privacidad', 'Privacidad', 'eyeOff'],
  ['zona-horaria', 'Zona horaria', 'globe'],
  ['tema', 'Tema', 'sun'],
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const HANDLE_RE = /^[a-z0-9-]{3,40}$/

// Marca del sitio (hostConfig): "pimpstudio.cl" para la pista del usuario y
// "pimp" para el nombre del archivo de "Descargar mis datos".
const SITE_HOST = String(ACADEMY_BRAND.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
const EXPORT_SLUG = String(ACADEMY_BRAND.siteName || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'mi'

const TIMEZONES = [
  ['America/Santiago', 'Santiago (Chile continental)'],
  ['America/Punta_Arenas', 'Punta Arenas (Magallanes)'],
  ['Pacific/Easter', 'Isla de Pascua'],
  ['America/Argentina/Buenos_Aires', 'Buenos Aires'],
  ['America/Lima', 'Lima'],
  ['America/Bogota', 'Bogotá'],
  ['America/La_Paz', 'La Paz'],
  ['America/Asuncion', 'Asunción'],
  ['America/Montevideo', 'Montevideo'],
  ['America/Sao_Paulo', 'São Paulo'],
  ['America/Caracas', 'Caracas'],
  ['America/Mexico_City', 'Ciudad de México'],
  ['America/New_York', 'Nueva York'],
  ['America/Los_Angeles', 'Los Ángeles'],
  ['Europe/Madrid', 'Madrid'],
  ['Europe/London', 'Londres'],
  ['UTC', 'UTC'],
]

const NOTIF_TYPES = [
  ['likes', 'Me gusta', 'Cuando alguien le da me gusta a lo que publicas o comentas.'],
  ['comments', 'Comentarios y respuestas', 'En tus publicaciones, tus comentarios y lo que sigues.'],
  ['mentions', 'Menciones', 'Cuando alguien te nombra con @.'],
  ['follows', 'Seguidores', 'Nuevos seguidores y publicaciones de quienes sigues.'],
  ['events', 'Eventos', 'Recordatorios de clases en vivo y eventos del calendario.'],
]

const PREF_DEFAULTS = {
  notif: { push: true, email: true, likes: true, comments: true, mentions: true, follows: true, events: true },
  chat: { enabled: true, previews: false },
  privacy: { hideActivity: false, hideOnline: false },
}

function fullPrefs(prefs) {
  const p = prefs && typeof prefs === 'object' ? prefs : {}
  return {
    ...p,
    notif: { ...PREF_DEFAULTS.notif, ...(p.notif || {}) },
    chat: { ...PREF_DEFAULTS.chat, ...(p.chat || {}) },
    privacy: { ...PREF_DEFAULTS.privacy, ...(p.privacy || {}) },
  }
}

function nowIn(tz) {
  try {
    return new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date())
  } catch {
    return ''
  }
}

function deviceTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' }
}

/* Guardado de preferencias compartido por las secciones de interruptores. */
function usePrefsSaver() {
  const { me, setMe, toast } = useAcademy()
  const [savedAt, setSavedAt] = useState(0)
  const pending = useRef(null)
  const prefs = fullPrefs(me?.prefs)
  const save = async (mutate) => {
    const prev = fullPrefs(me?.prefs)
    const next = mutate(JSON.parse(JSON.stringify(prev)))
    setMe?.({ ...me, prefs: next })
    const token = {}
    pending.current = token
    try {
      const res = await academyApi('me-update', { method: 'POST', body: { prefs: next } })
      if (pending.current === token && res?.member) setMe?.(res.member)
      setSavedAt(Date.now())
      return true
    } catch (e) {
      if (pending.current === token) setMe?.({ ...me, prefs: prev })
      toast?.(errorText(e, 'No se pudo guardar el cambio'), 'error')
      return false
    }
  }
  useEffect(() => {
    if (!savedAt) return undefined
    const t = setTimeout(() => setSavedAt(0), 1800)
    return () => clearTimeout(t)
  }, [savedAt])
  return { prefs, save, saved: Boolean(savedAt) }
}

function SectionHead({ title, children, saved }) {
  return (
    <header className="aca-set-head">
      <div>
        <h2>{title}</h2>
        {children && <p>{children}</p>}
      </div>
      <SavedTick show={saved} />
    </header>
  )
}

/* ---------------- Perfil ---------------- */
function profileDraft(m) {
  return {
    name: m?.name || '',
    handle: m?.handle || '',
    bio: m?.bio || '',
    location: m?.location || '',
    links: Object.fromEntries(LINK_KEYS.map((k) => [k, String(m?.links?.[k] || '')])),
  }
}

function PerfilSection() {
  const { me, setMe, toast } = useAcademy()
  // `base` = lo último guardado; `d` = lo que se está editando. Tras
  // guardar, las dos pasan a ser la respuesta del servidor (que puede
  // normalizar el usuario o los enlaces).
  const [base, setBase] = useState(() => profileDraft(me))
  const [d, setD] = useState(base)
  const initial = base
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)
  const set = (patch) => setD((x) => ({ ...x, ...patch }))
  const setLink = (k, v) => setD((x) => ({ ...x, links: { ...x.links, [k]: v } }))

  const onAvatar = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const up = await uploadImage('avatar', file)
      if (!up?.url || !isImageUrl(up.url)) throw new Error('La foto no se pudo subir.')
      const res = await academyApi('me-update', { method: 'POST', body: { avatarUrl: up.url } })
      if (res?.member) setMe?.(res.member)
      toast?.('Foto actualizada')
    } catch (err) {
      toast?.(errorText(err, 'No se pudo subir la foto'), 'error')
    } finally {
      setUploading(false)
    }
  }
  const removeAvatar = async () => {
    setUploading(true)
    try {
      const res = await academyApi('me-update', { method: 'POST', body: { avatarUrl: null } })
      if (res?.member) setMe?.(res.member)
      toast?.('Quitaste tu foto')
    } catch (err) {
      toast?.(errorText(err, 'No se pudo quitar la foto'), 'error')
    } finally {
      setUploading(false)
    }
  }

  const submit = async (ev) => {
    ev?.preventDefault?.()
    const e = {}
    const name = d.name.trim()
    const handle = d.handle.trim().toLowerCase()
    if (name.length < 2) e.name = 'Escribe tu nombre.'
    else if (name.length > 80) e.name = 'Máximo 80 caracteres.'
    if (!HANDLE_RE.test(handle)) e.handle = 'Entre 3 y 40 caracteres: letras minúsculas, números y guiones.'
    if (d.bio.length > 300) e.bio = 'Máximo 300 caracteres.'
    if (d.location.length > 60) e.location = 'Máximo 60 caracteres.'
    const links = {}
    LINK_KEYS.forEach((k) => {
      const url = toLinkUrl(k, d.links[k])
      if (url === null) e[`link_${k}`] = 'Este enlace no es válido.'
      else links[k] = url
    })
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    try {
      const body = { name, bio: d.bio.trim(), location: d.location.trim(), links }
      if (handle !== (me?.handle || '')) body.handle = handle
      const res = await academyApi('me-update', { method: 'POST', body })
      if (res?.member) {
        setMe?.(res.member)
        const fresh = profileDraft(res.member)
        setBase(fresh)
        setD(fresh)
      }
      toast?.('Perfil guardado')
    } catch (err) {
      if (err?.status === 409) setErrors({ handle: errorText(err, 'Ese usuario ya está en uso.') })
      else toast?.(errorText(err, 'No se pudo guardar el perfil'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const hasAvatar = me?.avatarUrl && isImageUrl(me.avatarUrl)

  return (
    <form className="aca-set-section" onSubmit={submit} noValidate>
      <SectionHead title="Perfil">Así te ven los demás miembros. Tu correo nunca se muestra.</SectionHead>

      <div className="aca-set-avatar">
        <MemberAvatar member={me} size={88} />
        <div className="aca-set-avatar-actions">
          <Button icon="camera" loading={uploading} onClick={() => fileRef.current?.click()}>{hasAvatar ? 'Cambiar foto' : 'Subir foto'}</Button>
          {hasAvatar && <Button variant="plain" disabled={uploading} onClick={removeAvatar}>Quitar</Button>}
          <small className="aca-mi-muted">JPG, PNG o WebP. La recortamos y comprimimos antes de subirla.</small>
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onAvatar} />
      </div>

      <Field label="Nombre" error={errors.name} htmlFor="aca-set-name">
        <input id="aca-set-name" className="aca-mi-input" value={d.name} maxLength={80} autoComplete="name" onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field
        label="Usuario"
        error={errors.handle}
        hint={HANDLE_RE.test(d.handle) ? `Tu perfil: ${SITE_HOST}${r.profile(d.handle)}` : 'Letras minúsculas, números y guiones.'}
        htmlFor="aca-set-handle"
      >
        <div className="aca-set-prefix">
          <span>@</span>
          <input
            id="aca-set-handle"
            className="aca-mi-input"
            value={d.handle}
            maxLength={40}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => set({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
          />
        </div>
      </Field>
      <Field label="Biografía" optional error={errors.bio} hint={`${d.bio.length}/300`} htmlFor="aca-set-bio">
        <textarea id="aca-set-bio" className="aca-mi-input" rows={3} maxLength={300} value={d.bio} placeholder="Barbero en Santiago, fan de los fades." onChange={(e) => set({ bio: e.target.value })} />
      </Field>
      <Field label="Ubicación" optional error={errors.location} htmlFor="aca-set-loc">
        <input id="aca-set-loc" className="aca-mi-input" value={d.location} maxLength={60} placeholder="Ñuñoa, Santiago" onChange={(e) => set({ location: e.target.value })} />
      </Field>

      <fieldset className="aca-set-links">
        <legend>Enlaces</legend>
        {LINK_KEYS.map((k) => (
          <Field key={k} label={LINK_META[k].label} optional error={errors[`link_${k}`]} htmlFor={`aca-set-link-${k}`}>
            <div className="aca-set-prefix is-icon">
              <span><Icon name={LINK_META[k].icon} size={16} /></span>
              <input
                id={`aca-set-link-${k}`}
                className="aca-mi-input"
                value={d.links[k]}
                inputMode={k === 'whatsapp' ? 'tel' : 'url'}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={LINK_META[k].placeholder}
                onChange={(e) => setLink(k, e.target.value)}
              />
            </div>
          </Field>
        ))}
      </fieldset>

      <div className="aca-set-save">
        {dirty && <Button variant="plain" onClick={() => { setD(initial); setErrors({}) }} disabled={saving}>Descartar</Button>}
        <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>Guardar cambios</Button>
      </div>
    </form>
  )
}

/* ---------------- Cuenta ---------------- */
function CuentaSection() {
  const { me, setMe, toast } = useAcademy()
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [mail, setMail] = useState({ email: '', password: '' })
  const [mailErr, setMailErr] = useState('')
  const [mailSent, setMailSent] = useState('')
  const [mailBusy, setMailBusy] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [deletePw, setDeletePw] = useState('')
  const [deleteErr, setDeleteErr] = useState('')
  const [busy, setBusy] = useState('')

  const problem = pw.next ? (memberPasswordProblem?.(pw.next, me?.email) || '') : ''

  const changePassword = async (ev) => {
    ev?.preventDefault?.()
    setPwErr('')
    if (!pw.current) return setPwErr('Escribe tu contraseña actual.')
    if (problem) return setPwErr(problem)
    if (pw.next !== pw.confirm) return setPwErr('Las contraseñas nuevas no coinciden.')
    setPwBusy(true)
    try {
      const res = await academyApi('password-change', { method: 'POST', body: { currentPassword: pw.current, newPassword: pw.next } })
      if (res?.token) setSession(res.token, res.member || me)
      if (res?.member) setMe?.(res.member)
      setPw({ current: '', next: '', confirm: '' })
      toast?.('Contraseña actualizada. Cerramos tus sesiones en otros dispositivos.')
    } catch (e) {
      setPwErr(errorText(e, 'No se pudo cambiar la contraseña.'))
    } finally {
      setPwBusy(false)
    }
  }

  const changeEmail = async (ev) => {
    ev?.preventDefault?.()
    setMailErr('')
    setMailSent('')
    const email = mail.email.trim()
    if (!EMAIL_RE.test(email) || email.length > 120) return setMailErr('Escribe un correo válido.')
    if (email.toLowerCase() === String(me?.email || '').toLowerCase()) return setMailErr('Ese ya es tu correo.')
    if (!mail.password) return setMailErr('Confirma con tu contraseña.')
    setMailBusy(true)
    try {
      await academyApi('email-change', { method: 'POST', body: { password: mail.password, newEmail: email } })
      setMailSent(email)
      setMail({ email: '', password: '' })
    } catch (e) {
      setMailErr(errorText(e, 'No se pudo iniciar el cambio de correo.'))
    } finally {
      setMailBusy(false)
    }
  }

  const logoutAll = async () => {
    setBusy('logout')
    try {
      await academyApi('logout-all', { method: 'POST' })
      clearSession()
      window.location.assign(r.login())
    } catch (e) {
      toast?.(errorText(e, 'No se pudo cerrar las sesiones'), 'error')
      setBusy('')
    }
  }

  const exportData = async () => {
    setBusy('export')
    try {
      const res = await academyApi('me-export')
      downloadBlob(`mis-datos-${EXPORT_SLUG}-academy-${todayStamp()}.json`, JSON.stringify(res?.data ?? res ?? {}, null, 2), 'application/json')
      toast?.('Descargamos tus datos')
    } catch (e) {
      toast?.(errorText(e, 'No se pudieron descargar tus datos'), 'error')
    } finally {
      setBusy('')
    }
  }

  const deleteAccount = async () => {
    setDeleteErr('')
    if (!deletePw) return setDeleteErr('Escribe tu contraseña para confirmar.')
    setBusy('delete')
    try {
      await academyApi('me-delete', { method: 'POST', body: { password: deletePw } })
      clearSession()
      window.location.assign(r.base())
    } catch (e) {
      setDeleteErr(errorText(e, 'No se pudo eliminar la cuenta.'))
      setBusy('')
    }
  }

  return (
    <div className="aca-set-section">
      <SectionHead title="Cuenta">Tu correo de acceso, tu contraseña y tus datos.</SectionHead>

      <form className="aca-mi-card is-inset" onSubmit={changePassword} noValidate>
        <h3 className="aca-set-sub">Cambiar contraseña</h3>
        {pwErr && <InlineAlert tone="error">{pwErr}</InlineAlert>}
        <Field label="Contraseña actual" htmlFor="aca-pw-cur">
          <input id="aca-pw-cur" className="aca-mi-input" type="password" autoComplete="current-password" value={pw.current} maxLength={200} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </Field>
        <Field label="Contraseña nueva" hint={problem || 'Al menos 10 caracteres. Una frase fácil de recordar funciona bien.'} htmlFor="aca-pw-new">
          <input id="aca-pw-new" className="aca-mi-input" type="password" autoComplete="new-password" value={pw.next} maxLength={200} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </Field>
        <Field label="Repite la contraseña nueva" error={pw.confirm && pw.confirm !== pw.next ? 'No coincide.' : null} htmlFor="aca-pw-rep">
          <input id="aca-pw-rep" className="aca-mi-input" type="password" autoComplete="new-password" value={pw.confirm} maxLength={200} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </Field>
        <div className="aca-set-save">
          <Button type="submit" variant="primary" loading={pwBusy} disabled={!pw.current || !pw.next || !pw.confirm}>Cambiar contraseña</Button>
        </div>
      </form>

      <form className="aca-mi-card is-inset" onSubmit={changeEmail} noValidate>
        <h3 className="aca-set-sub">Correo de acceso</h3>
        <p className="aca-mi-muted">Hoy entras con <strong>{me?.email}</strong>.</p>
        {mailSent && (
          <InlineAlert tone="success" onClose={() => setMailSent('')}>
            Te enviamos un enlace a {mailSent}. Ábrelo antes de 30 minutos para confirmar el cambio; hasta entonces sigues entrando con tu correo actual.
          </InlineAlert>
        )}
        {mailErr && <InlineAlert tone="error">{mailErr}</InlineAlert>}
        <Field label="Correo nuevo" htmlFor="aca-mail-new">
          <input id="aca-mail-new" className="aca-mi-input" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" value={mail.email} maxLength={120} onChange={(e) => setMail({ ...mail, email: e.target.value })} />
        </Field>
        <Field label="Tu contraseña" htmlFor="aca-mail-pw">
          <input id="aca-mail-pw" className="aca-mi-input" type="password" autoComplete="current-password" value={mail.password} maxLength={200} onChange={(e) => setMail({ ...mail, password: e.target.value })} />
        </Field>
        <div className="aca-set-save">
          <Button type="submit" loading={mailBusy} disabled={!mail.email || !mail.password}>Enviar enlace de confirmación</Button>
        </div>
      </form>

      <List className="aca-set-list">
        <ListRow
          lead={<span className="aca-set-ico"><Icon name="logout" size={17} /></span>}
          title="Cerrar sesión en todos los dispositivos"
          titleWrap
          subtitle="Útil si entraste en un computador ajeno. Vas a tener que volver a entrar acá también."
          subtitleWrap
          actions={<Button size="sm" loading={busy === 'logout'} onClick={() => setConfirm('logout')}>Cerrar sesiones</Button>}
        />
        <ListRow
          lead={<span className="aca-set-ico"><Icon name="download" size={17} /></span>}
          title="Descargar mis datos"
          titleWrap
          subtitle="Un archivo JSON con tu perfil, publicaciones, comentarios, progreso y mensajes."
          subtitleWrap
          actions={<Button size="sm" loading={busy === 'export'} onClick={exportData}>Descargar</Button>}
        />
        <ListRow
          lead={<span className="aca-set-ico is-danger"><Icon name="trash" size={17} /></span>}
          title="Eliminar mi cuenta"
          titleWrap
          subtitle="Borra tu perfil, tus mensajes directos y tu progreso. Pierdes el acceso a tus cursos y no se puede deshacer."
          subtitleWrap
          actions={<Button size="sm" variant="danger" onClick={() => { setDeletePw(''); setDeleteErr(''); setConfirm('delete') }}>Eliminar</Button>}
        />
      </List>

      <ConfirmDialog
        open={confirm === 'logout'}
        title="¿Cerrar sesión en todos los dispositivos?"
        message="Se cierra en todos lados, incluido este. Después entras con tu correo y contraseña."
        confirmLabel="Cerrar sesiones"
        busy={busy === 'logout'}
        onCancel={() => setConfirm('')}
        onConfirm={logoutAll}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        tone="danger"
        title="¿Eliminar tu cuenta?"
        message="Pierdes el acceso a la Academy y a los cursos que compraste. Esta acción no se puede deshacer."
        confirmLabel="Eliminar cuenta"
        busy={busy === 'delete'}
        onCancel={() => setConfirm('')}
        onConfirm={deleteAccount}
      >
        <Field label="Tu contraseña" error={deleteErr || null} htmlFor="aca-del-pw">
          <input id="aca-del-pw" className="aca-mi-input" type="password" autoComplete="current-password" value={deletePw} maxLength={200} onChange={(e) => setDeletePw(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  )
}

/* ---------------- Notificaciones ---------------- */
function pushSupport() {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' }
  const has = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
  if (!has) {
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent || '')
    return { ok: false, reason: ios ? 'ios' : 'unsupported' }
  }
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
  return { ok: true }
}

function readPushFlag() {
  try { return localStorage.getItem('ps_academy_push_enabled') === '1' } catch { return false }
}

function NotificacionesSection() {
  const { toast } = useAcademy()
  const { prefs, save, saved } = usePrefsSaver()
  const [support, setSupport] = useState(pushSupport)
  const [pushOn, setPushOn] = useState(() => readPushFlag() && typeof Notification !== 'undefined' && Notification.permission === 'granted')
  const [pushBusy, setPushBusy] = useState(false)

  const togglePush = async (on) => {
    setPushBusy(true)
    try {
      const mod = await import('../../academy/push.js')
      if (on) {
        const res = await mod.enableAcademyPush()
        if (res === false || (res && res.ok === false)) {
          setSupport(pushSupport())
          throw new Error(res?.error || res?.reason || 'No se pudieron activar las notificaciones en este dispositivo.')
        }
        setPushOn(true)
        await save((p) => { p.notif.push = true; return p })
        toast?.('Notificaciones activadas en este dispositivo')
      } else {
        await mod.disableAcademyPush()
        setPushOn(false)
        await save((p) => { p.notif.push = false; return p })
      }
    } catch (e) {
      setSupport(pushSupport())
      toast?.(errorText(e, 'No se pudo cambiar las notificaciones'), 'error')
    } finally {
      setPushBusy(false)
    }
  }

  return (
    <div className="aca-set-section">
      <SectionHead title="Notificaciones" saved={saved}>Elige qué te avisamos y por dónde.</SectionHead>

      <List>
        <ToggleRow
          lead={<span className="aca-set-ico"><Icon name="bell" size={17} /></span>}
          title="Notificaciones en este dispositivo"
          description={pushOn ? 'Te avisamos al instante de mensajes y actividad.' : 'Recibe avisos aunque la Academy esté cerrada.'}
          checked={pushOn}
          disabled={pushBusy || (!support.ok && !pushOn)}
          onChange={togglePush}
        />
        <ToggleRow
          lead={<span className="aca-set-ico"><Icon name="mail" size={17} /></span>}
          title="Resumen por correo"
          description="Si no entras en un rato, te mandamos por correo lo que te perdiste (máximo uno al día)."
          checked={prefs.notif.email !== false}
          onChange={(v) => save((p) => { p.notif.email = v; return p })}
        />
      </List>
      {!support.ok && support.reason === 'ios' && (
        <Note icon="info">En iPhone, primero instala la Academy: en Safari toca Compartir → “Agregar a inicio” y ábrela desde el ícono.</Note>
      )}
      {!support.ok && support.reason === 'denied' && (
        <Note icon="alert">Bloqueaste las notificaciones para este sitio. Actívalas en los ajustes del navegador y vuelve a intentarlo.</Note>
      )}
      {!support.ok && support.reason === 'unsupported' && (
        <Note icon="info">Este navegador no permite notificaciones push.</Note>
      )}

      <h3 className="aca-set-sub">Qué te avisamos</h3>
      <List>
        {NOTIF_TYPES.map(([k, title, desc]) => (
          <ToggleRow
            key={k}
            title={title}
            description={desc}
            checked={prefs.notif[k] !== false}
            onChange={(v) => save((p) => { p.notif[k] = v; return p })}
          />
        ))}
      </List>
    </div>
  )
}

/* ---------------- Chat ---------------- */
function ChatSection() {
  const { toast } = useAcademy()
  const { prefs, save, saved } = usePrefsSaver()
  const blocks = useAcademyQuery('mi:blocks', () => academyApi('blocks'))
  const [busy, setBusy] = useState(0)
  const list = Array.isArray(blocks.data?.members) ? blocks.data.members : []

  const unblock = async (m) => {
    setBusy(m.id)
    try {
      await academyApi('block', { method: 'POST', body: { memberId: m.id, block: false } })
      blocks.setData?.({ ...(blocks.data || {}), members: list.filter((x) => x.id !== m.id) })
      toast?.(`Desbloqueaste a ${m.name}`)
    } catch (e) {
      toast?.(errorText(e, 'No se pudo desbloquear'), 'error')
    } finally {
      setBusy(0)
    }
  }

  return (
    <div className="aca-set-section">
      <SectionHead title="Chat" saved={saved}>Mensajes directos con otros miembros.</SectionHead>
      <List>
        <ToggleRow
          title="Recibir mensajes directos"
          description="Si lo apagas, nadie puede escribirte (los chats de tus grupos siguen funcionando)."
          checked={prefs.chat.enabled !== false}
          onChange={(v) => save((p) => { p.chat.enabled = v; return p })}
        />
        <ToggleRow
          title="Vista previa en las notificaciones"
          description="Muestra el texto del mensaje en el aviso. Apagado, solo dice quién te escribió."
          checked={Boolean(prefs.chat.previews)}
          onChange={(v) => save((p) => { p.chat.previews = v; return p })}
        />
      </List>

      <h3 className="aca-set-sub">Bloqueados</h3>
      {blocks.loading && !blocks.data ? (
        <SkeletonRows rows={2} />
      ) : blocks.error && !blocks.data ? (
        <InlineAlert tone="error" action={{ label: 'Reintentar', onClick: blocks.refetch }}>No se pudo cargar la lista.</InlineAlert>
      ) : list.length === 0 ? (
        <p className="aca-mi-muted">No has bloqueado a nadie.</p>
      ) : (
        <List>
          {list.map((m) => (
            <ListRow
              key={m.id}
              lead={<MemberAvatar member={m} size={36} showLevel={false} />}
              title={m.name}
              subtitle={m.handle ? `@${m.handle}` : undefined}
              actions={<Button size="sm" loading={busy === m.id} onClick={() => unblock(m)}>Desbloquear</Button>}
            />
          ))}
        </List>
      )}
    </div>
  )
}

/* ---------------- Privacidad ---------------- */
function PrivacidadSection() {
  const { me } = useAcademy()
  const { prefs, save, saved } = usePrefsSaver()
  return (
    <div className="aca-set-section">
      <SectionHead title="Privacidad" saved={saved}>Controla qué ven los demás de tu actividad.</SectionHead>
      <List>
        <ToggleRow
          title="Ocultar mi actividad"
          description="Nadie ve tu mapa de actividad ni cuándo estuviste por última vez."
          checked={Boolean(prefs.privacy.hideActivity)}
          onChange={(v) => save((p) => { p.privacy.hideActivity = v; return p })}
        />
        <ToggleRow
          title="Ocultar “En línea”"
          description="No apareces como conectado aunque estés usando la Academy."
          checked={Boolean(prefs.privacy.hideOnline)}
          onChange={(v) => save((p) => { p.privacy.hideOnline = v; return p })}
        />
      </List>
      {me?.handle && (
        <p className="aca-mi-muted">
          <Link className="aca-mi-link" to={r.profile(me.handle)}>Ver mi perfil como lo ven otros</Link>
        </p>
      )}
    </div>
  )
}

/* ---------------- Zona horaria ---------------- */
function ZonaHorariaSection() {
  const { prefs, save, saved } = usePrefsSaver()
  const current = prefs.tz || 'America/Santiago'
  const device = deviceTz()
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])
  const options = TIMEZONES.some(([id]) => id === current) ? TIMEZONES : [[current, current], ...TIMEZONES]
  const label = (id) => (options.find(([x]) => x === id) || [id, id])[1]
  return (
    <div className="aca-set-section">
      <SectionHead title="Zona horaria" saved={saved}>Las horas de eventos y recordatorios se muestran en esta zona.</SectionHead>
      <Field label="Zona horaria" htmlFor="aca-set-tz" hint={nowIn(current) ? `Ahora son las ${nowIn(current)} en ${label(current)}.` : null}>
        <select id="aca-set-tz" className="aca-mi-input" value={current} onChange={(e) => save((p) => { p.tz = e.target.value; return p })}>
          {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </Field>
      {device && device !== current && (
        <Note icon="globe">
          Tu dispositivo está en {device}.{' '}
          <button type="button" className="aca-mi-linkbtn" onClick={() => save((p) => { p.tz = device; return p })}>Usar esta zona</button>
        </Note>
      )}
    </div>
  )
}

/* ---------------- Tema ---------------- */
function TemaSection() {
  const theme = useTheme() || {}
  const { save } = usePrefsSaver()
  const value = theme.auto ? 'auto' : theme.theme === 'light' ? 'claro' : 'oscuro'
  const choose = (v) => {
    if (v === 'auto') theme.setAuto?.(true)
    else theme.setTheme?.(v === 'claro' ? 'light' : 'dark')
    // Se guarda también en la cuenta para que otro dispositivo pueda
    // tomarlo; si falla no importa, el tema local ya cambió.
    save((p) => { p.theme = v; return p })
  }
  return (
    <div className="aca-set-section">
      <SectionHead title="Tema">Claro, oscuro o automático según la hora de Santiago (claro de 7:00 a 18:59).</SectionHead>
      <Segmented
        full
        value={value}
        onChange={choose}
        ariaLabel="Tema"
        options={[
          { value: 'claro', label: 'Claro', icon: 'sun' },
          { value: 'oscuro', label: 'Oscuro', icon: 'moon' },
          { value: 'auto', label: 'Automático', icon: 'clock' },
        ]}
      />
    </div>
  )
}

/* ---------------- Página ---------------- */
export default function AjustesPage() {
  const { me } = useAcademy()
  const [params, setParams] = useSearchParams()
  const requested = params.get('seccion')
  const section = SECTIONS.some(([id]) => id === requested) ? requested : 'perfil'
  const go = (id) => {
    const next = new URLSearchParams(params)
    next.set('seccion', id)
    setParams(next, { replace: true })
  }

  if (!me) {
    return <div className="aca-set-page"><SkeletonRows rows={4} /></div>
  }

  return (
    <div className="aca-set-page">
      <nav className="aca-set-nav" aria-label="Secciones de ajustes">
        <h1 className="aca-set-title">Ajustes</h1>
        <div className="aca-set-navlist">
          {SECTIONS.map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              className={cx('aca-set-navbtn', section === id && 'is-on')}
              aria-current={section === id ? 'page' : undefined}
              onClick={() => go(id)}
            >
              <Icon name={icon} size={17} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>
      <div className="aca-set-content aca-mi-card">
        {section === 'perfil' && <PerfilSection key={me.id} />}
        {section === 'cuenta' && <CuentaSection />}
        {section === 'notificaciones' && <NotificacionesSection />}
        {section === 'chat' && <ChatSection />}
        {section === 'privacidad' && <PrivacidadSection />}
        {section === 'zona-horaria' && <ZonaHorariaSection />}
        {section === 'tema' && <TemaSection />}
      </div>
    </div>
  )
}
