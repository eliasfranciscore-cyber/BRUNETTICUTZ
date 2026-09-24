import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  permissionState, pushEnabledFor, pushSupported, isIOS, isStandalone,
  disablePush, enablePush, sendTestPush, syncPush, notifyLocal,
} from '../../push.js'
import { canOfferInstall, onInstallStateChange } from '../../installPrompt.js'
import { Icon, Emblem } from '../../components/ui.jsx'
import InstallPrompt from '../../components/InstallPrompt.jsx'
import { passwordProblem, PASSWORD_RULES, isValidPassword } from '../../passwordRules.js'
import { useTheme } from '../../components/theme.jsx'
import { EXPENSE_CATEGORIES, CATEGORY_META } from '../../components/ExpensesModule.jsx'
import { FEATURES } from '../../features.js'
import { ALWAYS_NAV } from './shared.jsx'
import {
  ModuleHeader, Card, SectionLabel, List, ListRow, Avatar, Field, ToggleRow,
  SaveBar, SavedTick, Note, InlineAlert, Button, Chip, EmptyState, SearchField,
  ConfirmDialog, useIsPhone,
} from '../../components/panel/index.js'
import '../../styles/panel/ajustes.css'

/* ============================================================
   Ajustes — lista agrupada estilo Ajustes de iOS (portado de PimpStudio,
   con lo de Brunetti: sin Equipo ni Comisiones, un solo barbero).

   Escritorio (≥641px): dos paneles, lista + detalle lado a lado, con la
   primera sección abierta. En ≥1025px los dos paneles quedan fijos y cada
   uno scrollea por su cuenta (ver ajustes.css).
   Celular (≤640px): la lista y, al entrar, la sección con "‹ Ajustes" arriba.

   Una sola regla de guardado: los campos de texto usan SaveBar (aparece solo
   con cambios pendientes); interruptores y selects se guardan solos al
   tocarlos, con un "Guardado" (SavedTick) en la cabecera de su tarjeta. Si el
   servidor dice que no, el control vuelve a como estaba y la tarjeta lo
   avisa: nunca se muestra un estado que el servidor no tiene.

   Qué guarda dónde:
   - Nombre → PATCH /api/barbers?mode=me.
   - Contraseña y correo para recuperarla → PATCH /api/auth-barber (siempre
     con la contraseña actual).
   - Alertas, WhatsApp y horario (por barbero) → /api/barbers?mode=settings.
   - Negocio, presupuestos y "Completar solas" (admin) → ?mode=shop-settings.
   - Cursos y Workshop → /api/mp-payments?settings=1 (lo lee el cobro real y
     las páginas públicas; el interruptor de pagos guarda solo).
   - Tema, módulos visibles y dock → este dispositivo.
   ============================================================ */
// Sin export a propósito: un archivo que exporta algo que no es componente
// pierde el Fast Refresh de Vite (recarga la página entera en cada cambio).
const CFG_GROUPS = [
  {
    id: 'cuenta', label: 'Mi cuenta',
    items: [
      { id: 'cuenta', icon: 'user', label: 'Perfil y contraseña', kw: 'nombre usuario cargo contraseña password correo email recuperar olvidé sesión salir' },
      { id: 'notificaciones', icon: 'bell', label: 'Notificaciones', kw: 'push alertas avisos prueba instalar app inicio' },
      { id: 'apariencia', icon: 'moon', label: 'Apariencia', kw: 'tema modo claro oscuro automático hora' },
    ],
  },
  {
    id: 'panel', label: 'Panel',
    items: [
      { id: 'navegacion', icon: 'grid', label: 'Navegación y accesos', kw: 'pestañas tabs módulos orden menú dock atajos accesos directos shortcuts' },
    ],
  },
  {
    id: 'negocio', label: 'Negocio',
    items: [
      { id: 'negocio', icon: 'store', label: 'Datos del negocio', kw: 'dirección teléfono nombre local whatsapp business' },
      { id: 'horario', icon: 'clock', label: 'Horario y reservas', kw: 'apertura cierre anticipación ventana domingo cancelación' },
      { id: 'cierre', icon: 'checkCircle', label: 'Cierre automático', kw: 'completar solas autocompletar atenciones en curso iniciadas pago por confirmar', admin: true, server: true },
      { id: 'whatsapp', icon: 'whatsapp', label: 'Mensajes de WhatsApp', kw: 'recordatorio plantillas mensajes' },
      { id: 'precios', icon: 'sparkles', label: 'Cursos y Workshop', kw: 'cursos workshop precio fecha mercado pago pagos pausa' },
      { id: 'presupuestos', icon: 'wallet', label: 'Presupuestos', kw: 'gastos categoría límite tope semáforo', admin: true },
    ],
  },
  {
    id: 'datos', label: 'Datos',
    items: [
      { id: 'datos', icon: 'download', label: 'Datos y respaldos', kw: 'exportar csv respaldo backup' },
      { id: 'acerca', icon: 'info', label: 'Acerca de', kw: 'versión créditos brunetti' },
    ],
  },
]

// Búsqueda sin tildes ni mayúsculas: "configuracion" encuentra "Configuración".
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BIZ_FALLBACK = { name: 'Brunetti Barber Studio', address: 'Maipú, Santiago', phone: '' }
const NOTIF_DEFAULT = { reserva: true, cancelacion: true, recordatorio: true, marketing: false }
const WA_DEFAULT = { activo: true, recordatorio24h: true, recordatorio2h: false, confirmacion: true }
const HORARIO_DEFAULT = { apertura: '09:00', cierre: '20:00', anticipacion: '120', ventana: '30', domingo: 'closed', cancelacion: '24h' }

// Respaldo por si el panel monta esta pestaña sin ctx.authHeaders.
function tokenHeaders(extra = {}) {
  let token = ''
  try { token = localStorage.getItem('ps_barber_token') || '' } catch {}
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra
}

/* La fecha del Workshop viaja como instante ISO (UTC) y el <input
   type="datetime-local"> trabaja en la hora de este dispositivo. Antes se
   cortaba el ISO tal cual (toISOString().slice(0, 16)): el panel mostraba la
   hora UTC —3 o 4 horas corrida— y al volver a guardar, la fecha se corría
   otra vez. La web pública siempre la mostró bien (new Date(iso)). */
function isoToLocalInput(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

async function readJson(res) {
  if (!res) return null
  return res.json().catch(() => null)
}

/* Muestra "Guardado" un rato en la cabecera de una tarjeta. */
function useFlash() {
  const [on, setOn] = useState({})
  const flash = (key) => {
    setOn((f) => ({ ...f, [key]: true }))
    setTimeout(() => setOn((f) => ({ ...f, [key]: false })), 1800)
  }
  return [on, flash]
}

/* Notificaciones push (en iPhone, solo con la app instalada en inicio).
   Solo activa avisos para el barbero autenticado: recibe un push cuando un
   cliente agenda una hora con él. */
export function PushCard({ barber }) {
  const [perm, setPerm] = useState(() => permissionState())
  const [enabled, setEnabled] = useState(() => pushEnabledFor(barber))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { tone, text }
  // Entrada permanente al aviso de instalación, para quien lo descartó al
  // entrar al panel (el automático no vuelve a salir por 30 días).
  const [showInstall, setShowInstall] = useState(false)
  // Chrome avisa que se puede instalar (beforeinstallprompt) cuando quiere,
  // a veces bastante después de montar: sin esto la fila no aparecía nunca.
  const [, repaint] = useState(0)
  useEffect(() => onInstallStateChange(() => repaint((n) => n + 1)), [])
  const supported = pushSupported()
  const iosNeedsInstall = isIOS() && !isStandalone()

  const toggle = async (next) => {
    setBusy(true); setMsg(null)
    if (!next) {
      await disablePush(barber)
      setEnabled(false)
      setMsg({ tone: 'info', text: 'Notificaciones desactivadas.' })
    } else {
      const r = await enablePush(barber)
      setPerm(r.permission)
      if (r.ok) {
        setEnabled(true)
        setMsg({ tone: 'success', text: 'Listo. Te avisaremos cuando agenden una hora contigo.' })
      } else if (r.reason === 'ios-needs-install') {
        setMsg({ tone: 'info', text: 'En iPhone: abre el menú Compartir y elige "Agregar a inicio". Luego abre la app instalada y actívalas acá.' })
      } else if (r.reason === 'denied') {
        setMsg({ tone: 'warn', text: 'Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador o de la app.' })
      } else if (r.reason === 'unsupported') {
        setMsg({ tone: 'warn', text: 'Este navegador no soporta notificaciones push.' })
      } else {
        setMsg({ tone: 'error', text: 'No se pudo activar. Intenta de nuevo.' })
      }
    }
    setBusy(false)
  }

  /* Prueba REAL (FEATURES.testPush): la manda el servidor por Web Push y
     responde a cuántos dispositivos llegó. La local de antes se veía igual
     con la suscripción del servidor borrada, así que no probaba nada de lo
     que falla. Con el interruptor apagado queda la local de siempre. */
  const test = async () => {
    if (!FEATURES.testPush) {
      const ok = await notifyLocal({ title: 'Brunetti', body: `Prueba de notificación para ${barber?.name || 'ti'}.` })
      setMsg(ok
        ? { tone: 'success', text: 'Notificación de prueba enviada.' }
        : { tone: 'warn', text: 'Activa primero las notificaciones para probar.' })
      return
    }
    setBusy(true); setMsg({ tone: 'info', text: 'Enviando…' })
    let r = await sendTestPush()
    // `sent: 0` = ningún canal vivo para este barbero. Casi siempre es la
    // suscripción caída, así que se re-registra (syncPush) y se prueba de
    // nuevo, en vez de mandarlo a resolverlo a mano.
    if (r.ok && r.sent === 0) {
      const s = await syncPush(barber)
      if (s.ok) r = await sendTestPush()
    }
    if (!r.ok) {
      setMsg({ tone: 'error', text: 'No se pudo enviar la prueba. Revisa tu conexión e intenta de nuevo.' })
    } else if (r.sent > 0) {
      setMsg({ tone: 'success', text: `Listo: llegó a ${r.sent} dispositivo${r.sent === 1 ? '' : 's'}.` })
    } else {
      // syncPush borra la marca local cuando no puede re-registrar: el
      // interruptor se realinea con eso en vez de seguir diciendo "activado".
      setEnabled(pushEnabledFor(barber))
      setMsg({ tone: 'warn', text: 'No llegó a ningún dispositivo. Vuelve a activar el interruptor de arriba' + (iosNeedsInstall ? ', con la app instalada en tu pantalla de inicio.' : '.') })
    }
    setBusy(false)
  }

  const offerInstall = !isStandalone() && canOfferInstall()

  return (
    <Card title="Notificaciones push">
      <List>
        <ToggleRow
          title="Avisarme de nuevas reservas"
          description="Recibe un aviso cuando un cliente agende una hora contigo."
          checked={enabled}
          disabled={busy || iosNeedsInstall}
          onChange={toggle}
        />
        {offerInstall && (
          <ListRow
            title="Instalar el panel"
            titleWrap
            subtitle={iosNeedsInstall
              ? 'En iPhone las notificaciones solo funcionan con la app instalada en la pantalla de inicio.'
              : 'Deja el panel como app en tu pantalla de inicio y ábrelo de un toque.'}
            subtitleWrap
            trailing={<Button variant="secondary" size="sm" icon="plus" onClick={() => setShowInstall(true)}>Instalar</Button>}
          />
        )}
      </List>
      <InstallPrompt audience="barber" open={showInstall} onClose={() => setShowInstall(false)} />

      {!supported && !iosNeedsInstall && <Note icon="alert">Este dispositivo o navegador no soporta notificaciones push.</Note>}

      {enabled && (
        <div className="pn-ajustes-inline-action">
          <Button variant="secondary" size="sm" icon="bell" onClick={test} disabled={busy}>Enviar notificación de prueba</Button>
        </div>
      )}

      {msg && (
        <InlineAlert tone={msg.tone} className="pn-ajustes-alert" onClose={busy ? undefined : () => setMsg(null)}>
          {msg.text}
        </InlineAlert>
      )}

      <p className="pn-ajustes-footnote">Solo tú recibes estos avisos en tu cuenta. Permiso del navegador: <b>{perm}</b>.</p>
    </Card>
  )
}

export function ConfigPanel({
  barber, setBarber, myPhoto, admin, authHeaders, has,
  onExport, onLogout, nav = [], navSettings = {}, setNavSettings, dockShortcuts = [], setDockShortcuts,
  expenseBudgets = {}, setExpenseBudgets = () => {}, scrollRef, initialSection, onSectionConsumed,
}) {
  const isPhone = useIsPhone()
  const { theme, auto, setAuto, setTheme } = useTheme()
  const auth = typeof authHeaders === 'function' ? authHeaders : tokenHeaders
  const canUse = (id) => (typeof has === 'function' ? has(id) : true)

  // Presupuestos y "Completar solas" son del admin (finanzas y reglas del
  // negocio). "Completar solas" además vive solo en el servidor.
  const groups = useMemo(() => CFG_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((s) => (!s.admin || admin) && (!s.server || FEATURES.serverSettings)) }))
    .filter((g) => g.items.length > 0), [admin])
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const firstId = flatItems[0]?.id || null
  const known = (id) => flatItems.some((s) => s.id === id)

  // Escritorio: la primera sección abre sola (dos paneles, nunca media
  // pantalla vacía). Celular: arranca en la lista, salvo un ?section= válido.
  const [section, setSection] = useState(() => (known(initialSection) ? initialSection : (isPhone ? null : firstId)))
  // Deep link desde otra pestaña (Gastos → "Presupuestos"): se abre esa
  // sección y se consume, para que la próxima visita a Ajustes vuelva a la
  // lista en vez de repetir el salto.
  useEffect(() => {
    if (!initialSection) return
    if (known(initialSection)) setSection(initialSection)
    onSectionConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSection])
  useEffect(() => {
    // Al pasar de celular a escritorio sin sección abierta, o si la abierta
    // dejó de existir, el panel derecho no puede quedar vacío.
    if (!isPhone && (!section || !known(section))) setSection(firstId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhone, firstId])
  const openSection = (id) => setSection(id)
  /* Cada sección abre desde arriba. En el celular (y en tablet, donde todo
     scrollea junto) el detalle se abría a la altura de la fila tocada, a
     mitad del contenido; en escritorio el panel derecho scrollea solo y
     quedaba donde lo dejó la sección anterior. No corre al montar. */
  const detailRef = useRef(null)
  const firstSectionRef = useRef(true)
  useEffect(() => {
    if (firstSectionRef.current) { firstSectionRef.current = false; return }
    try { if (detailRef.current) detailRef.current.scrollTop = 0 } catch {}
    try { scrollRef?.current?.scrollTo({ top: 0 }) } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])
  const [sectionQuery, setSectionQuery] = useState('')
  const visibleGroups = useMemo(() => {
    const q = fold(sectionQuery.trim())
    if (!q) return groups
    return groups
      .map((g) => ({ ...g, items: g.items.filter((s) => fold(s.label).includes(q) || fold(s.kw).includes(q)) }))
      .filter((g) => g.items.length > 0)
  }, [groups, sectionQuery])
  const current = flatItems.find((s) => s.id === section)
  const [flashOn, flash] = useFlash()

  /* ============================================================
     MI CUENTA
     ============================================================ */

  // Nombre → PATCH ?mode=me. El usuario (code) es de solo lectura: es el login.
  const [nameDraft, setNameDraft] = useState(barber?.name || '')
  useEffect(() => { setNameDraft(barber?.name || '') }, [barber?.name])
  const nameDirty = nameDraft.trim() !== (barber?.name || '').trim()
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const persistBarber = (patch) => {
    const updated = { ...barber, ...patch }
    setBarber?.(updated)
    try { localStorage.setItem('ps_barber', JSON.stringify(updated)) } catch {}
  }
  const saveName = async () => {
    const name = nameDraft.trim()
    setNameError('')
    if (!name) { setNameError('Escribe tu nombre.'); return }
    if (name.length > 80) { setNameError('El nombre puede tener hasta 80 caracteres.'); return }
    if (!FEATURES.serverSettings) {
      persistBarber({ name })
      flash('name')
      return
    }
    setNameSaving(true)
    const res = await fetch('/api/barbers?mode=me', {
      method: 'PATCH',
      headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name }),
    }).catch(() => null)
    const data = await readJson(res)
    setNameSaving(false)
    if (res?.ok && data?.ok) {
      persistBarber(data.barber || { name })
      flash('name')
    } else {
      setNameError(data?.error || (res ? 'No se pudo guardar el nombre.' : 'No se pudo conectar con el servidor.'))
    }
  }

  // Cambiar la propia contraseña: siempre con la actual, y la nueva distinta.
  const [pwOpen, setPwOpen] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwStatus, setPwStatus] = useState('') // "", "saving", "done"
  const [pwError, setPwError] = useState('')
  const openPassword = (open) => {
    setPwOpen(open); setPwError(''); setPwStatus('')
    setPwForm({ current: '', next: '', confirm: '' })
  }
  const changePassword = async () => {
    setPwError('')
    if (!pwForm.current) { setPwError('Ingresa tu contraseña actual.'); return }
    if (!isValidPassword(pwForm.next)) { setPwError(passwordProblem(pwForm.next) || PASSWORD_RULES); return }
    if (pwForm.next === pwForm.current) { setPwError('La contraseña nueva tiene que ser distinta a la actual.'); return }
    if (pwForm.next !== pwForm.confirm) { setPwError('Las contraseñas no coinciden.'); return }
    setPwStatus('saving')
    const res = await fetch('/api/auth-barber', {
      method: 'PATCH',
      headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
    }).catch(() => null)
    const data = await readJson(res)
    if (res?.ok && data?.ok) {
      setPwStatus('done')
      setPwForm({ current: '', next: '', confirm: '' })
      setTimeout(() => { setPwStatus(''); setPwOpen(false) }, 2200)
    } else {
      setPwStatus('')
      setPwError(data?.error || (res ? 'No se pudo cambiar la contraseña.' : 'No se pudo conectar con el servidor.'))
    }
  }

  /* Correo para recuperar la contraseña (FEATURES.passwordReset). Hoy la
     sesión (?me=1) no lo trae, así que el campo arranca con el que se guardó
     desde este dispositivo: barber.email string = ese, null = se sabe que no
     hay, undefined = no se sabe (y se avisa). Guardar pide la contraseña
     actual, igual que cambiarla: con un correo ajeno se podría restablecer. */
  const savedEmail = barber?.email || ''
  const emailKnown = barber?.email !== undefined
  const [emailDraft, setEmailDraft] = useState(savedEmail)
  useEffect(() => { setEmailDraft(savedEmail) }, [savedEmail])
  const [emailPw, setEmailPw] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailMsg, setEmailMsg] = useState(null) // { tone, text }
  const emailDirty = emailDraft.trim().toLowerCase() !== savedEmail.trim().toLowerCase()
  const discardEmail = () => { setEmailDraft(savedEmail); setEmailPw(''); setEmailMsg(null) }
  const saveEmail = async () => {
    const email = emailDraft.trim().toLowerCase()
    setEmailMsg(null)
    if (email && !EMAIL_RE.test(email)) { setEmailMsg({ tone: 'error', text: 'Escribe un correo válido, como nombre@gmail.com.' }); return }
    if (!emailPw) { setEmailMsg({ tone: 'error', text: 'Confirma con tu contraseña actual.' }); return }
    setEmailSaving(true)
    const res = await fetch('/api/auth-barber', {
      method: 'PATCH',
      headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ currentPassword: emailPw, email }),
    }).catch(() => null)
    const data = await readJson(res)
    setEmailSaving(false)
    if (res?.ok && data?.ok) {
      const stored = data.email === undefined ? email : (data.email || '')
      persistBarber({ email: stored || null })
      setEmailDraft(stored)
      setEmailPw('')
      setEmailMsg({ tone: 'success', text: data.message || (stored ? 'Correo actualizado.' : 'Correo eliminado.') })
      flash('email')
    } else {
      setEmailMsg({ tone: 'error', text: data?.error || (res ? 'No se pudo guardar el correo.' : 'No se pudo conectar con el servidor.') })
    }
  }

  /* ============================================================
     NOTIFICACIONES, WHATSAPP Y HORARIO — por barbero (?mode=settings).
     Cada cambio viaja solo, apenas se toca: el servidor mezcla clave por
     clave dentro del grupo. Nada se escribe al abrir la pantalla.
     ============================================================ */
  const [prefs, setPrefs] = useState({ notif: NOTIF_DEFAULT, whatsapp: WA_DEFAULT, horario: HORARIO_DEFAULT })
  const [prefsReady, setPrefsReady] = useState(!FEATURES.serverSettings)
  const [prefsError, setPrefsError] = useState({})
  useEffect(() => {
    if (!FEATURES.serverSettings) return undefined
    let cancelled = false
    fetch('/api/barbers?mode=settings', { headers: auth() })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.ok) return
        const s = data.settings || {}
        setPrefs((p) => ({
          notif: { ...p.notif, ...(s.notif || {}) },
          whatsapp: { ...p.whatsapp, ...(s.whatsapp || {}) },
          horario: { ...p.horario, ...(s.horario || {}) },
        }))
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPrefsReady(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const setPref = async (group, key, value) => {
    const prev = prefs[group][key]
    if (prev === value) return
    setPrefs((p) => ({ ...p, [group]: { ...p[group], [key]: value } }))
    setPrefsError((e) => ({ ...e, [group]: '' }))
    if (!FEATURES.serverSettings) { flash(group); return }
    const res = await fetch('/api/barbers?mode=settings', {
      method: 'PATCH',
      headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ [group]: { [key]: value } }),
    }).catch(() => null)
    const data = await readJson(res)
    if (res?.ok && data?.ok) {
      flash(group)
    } else {
      setPrefs((p) => ({ ...p, [group]: { ...p[group], [key]: prev } }))
      setPrefsError((e) => ({ ...e, [group]: data?.error || 'No se pudo guardar. Intenta de nuevo.' }))
    }
  }
  const notif = prefs.notif
  const wa = prefs.whatsapp
  const horario = prefs.horario

  /* ============================================================
     NEGOCIO, PRESUPUESTOS Y "COMPLETAR SOLAS" — del local (?mode=shop-settings,
     solo admin). Si el servidor todavía no tiene negocio o presupuestos, se
     precarga lo de este dispositivo y el próximo "Guardar" lo sube.
     ============================================================ */
  const [biz, setBiz] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('ps_biz') || '{}')
      // waPhone era un segundo teléfono duplicado: se consolida en uno.
      const phone = stored.phone || stored.waPhone || BIZ_FALLBACK.phone
      return { name: stored.name || BIZ_FALLBACK.name, address: stored.address || BIZ_FALLBACK.address, phone }
    } catch { return BIZ_FALLBACK }
  })
  const [bizDraft, setBizDraft] = useState(biz)
  useEffect(() => { setBizDraft(biz) }, [biz])
  const bizDirty = ['name', 'address', 'phone'].some((k) => (bizDraft[k] || '') !== (biz[k] || ''))
  const [bizSaving, setBizSaving] = useState(false)
  const [bizError, setBizError] = useState('')

  const [budgetsDraft, setBudgetsDraft] = useState(expenseBudgets)
  useEffect(() => { setBudgetsDraft(expenseBudgets) }, [expenseBudgets])
  const budgetsDirty = EXPENSE_CATEGORIES.some((c) => Number(budgetsDraft[c] || 0) !== Number(expenseBudgets[c] || 0))
  const [budgetsSaving, setBudgetsSaving] = useState(false)
  const [budgetsError, setBudgetsError] = useState('')

  // null = todavía no se sabe (el interruptor queda quieto hasta saberlo).
  const [autoComplete, setAutoComplete] = useState(null)
  const [acBusy, setAcBusy] = useState(false)
  const [acError, setAcError] = useState('')
  const [acConfirm, setAcConfirm] = useState(false)
  const [shopLoad, setShopLoad] = useState(0) // para "Reintentar"

  useEffect(() => {
    if (!FEATURES.serverSettings || !admin) return undefined
    let cancelled = false
    setAcError('')
    fetch('/api/barbers?mode=shop-settings', { headers: auth() })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (!d?.ok) { setAcError(d?.error || 'No se pudieron cargar los ajustes del negocio.'); return }
        const s = d.settings || d
        if (s.business && Object.keys(s.business).length) setBiz((b) => ({ ...b, ...s.business }))
        if (s.budgets && Object.keys(s.budgets).length) setExpenseBudgets(s.budgets)
        setAutoComplete(s.autoComplete === true)
      })
      .catch(() => { if (!cancelled) setAcError('No se pudieron cargar los ajustes del negocio.') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, shopLoad])

  const patchShop = async (payload) => {
    const res = await fetch('/api/barbers?mode=shop-settings', {
      method: 'PATCH',
      headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    }).catch(() => null)
    const data = await readJson(res)
    if (res?.ok && data?.ok) return { ok: true, data }
    return { ok: false, error: data?.error || (res ? 'No se pudo guardar.' : 'No se pudo conectar con el servidor.') }
  }

  const saveBiz = async () => {
    const next = { name: bizDraft.name.trim(), address: bizDraft.address.trim(), phone: bizDraft.phone.trim() }
    setBizError('')
    if (FEATURES.serverSettings && admin) {
      setBizSaving(true)
      const r = await patchShop({ business: next })
      setBizSaving(false)
      if (!r.ok) { setBizError(r.error); return }
    }
    setBiz(next)
    try { localStorage.setItem('ps_biz', JSON.stringify(next)) } catch {}
    flash('biz')
  }

  const saveBudgets = async () => {
    const next = {}
    for (const cat of EXPENSE_CATEGORIES) if (Number(budgetsDraft[cat]) > 0) next[cat] = Number(budgetsDraft[cat])
    setBudgetsError('')
    if (FEATURES.serverSettings && admin) {
      // null = borrar ese presupuesto en el servidor: siempre viaja la lista
      // completa, así una categoría vaciada acá también se borra allá.
      const payload = {}
      for (const cat of EXPENSE_CATEGORIES) payload[cat] = next[cat] || null
      setBudgetsSaving(true)
      const r = await patchShop({ budgets: payload })
      setBudgetsSaving(false)
      if (!r.ok) { setBudgetsError(r.error); return }
    }
    setExpenseBudgets(next)
    flash('budgets')
  }

  const applyAutoComplete = async (v) => {
    const prev = autoComplete
    setAcConfirm(false)
    setAcBusy(true); setAcError('')
    setAutoComplete(v)
    const r = await patchShop({ autoComplete: v })
    setAcBusy(false)
    if (r.ok) {
      const s = r.data.settings || r.data
      if (typeof s.autoComplete === 'boolean') setAutoComplete(s.autoComplete)
      flash('ac')
    } else {
      setAutoComplete(prev)
      setAcError(r.error)
    }
  }
  // Encenderlo pide confirmación (completa atenciones y suma estrellas sin
  // que nadie toque nada); apagarlo, no.
  const toggleAutoComplete = (v) => { if (v) setAcConfirm(true); else applyAutoComplete(false) }

  /* ============================================================
     CURSOS Y WORKSHOP — a diferencia del resto, esto lo lee el cobro real de
     Mercado Pago (api/mp-payments.js) y las páginas públicas de Cursos y
     Workshop. Comportamiento de siempre: precios y fecha con "Guardar"; el
     interruptor de pagos guarda solo y se revierte si el PATCH falla.
     ============================================================ */
  const [precios, setPrecios] = useState({ cursosPrice: '', workshopPrice: '', workshopDate: '', workshopPaymentsEnabled: false })
  const [preciosBase, setPreciosBase] = useState({ cursosPrice: '', workshopPrice: '', workshopDate: '' })
  const [preciosLoading, setPreciosLoading] = useState(true)
  const [preciosStatus, setPreciosStatus] = useState('') // "", "saving"
  const [preciosError, setPreciosError] = useState('')
  const [pagosBusy, setPagosBusy] = useState(false)
  const [pagosError, setPagosError] = useState('')
  useEffect(() => {
    let cancelled = false
    fetch('/api/mp-payments?settings=1')
      .then((r) => r.json())
      .then((s) => {
        if (cancelled) return
        const loaded = {
          cursosPrice: s.cursosPrice != null ? String(s.cursosPrice) : '',
          workshopPrice: s.workshopPrice != null ? String(s.workshopPrice) : '',
          workshopDate: isoToLocalInput(s.workshopDate),
        }
        setPrecios({ ...loaded, workshopPaymentsEnabled: !!s.workshopPaymentsEnabled })
        setPreciosBase(loaded)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPreciosLoading(false) })
    return () => { cancelled = true }
  }, [])
  // El interruptor no cuenta: se guarda solo.
  const preciosDirty = ['cursosPrice', 'workshopPrice', 'workshopDate'].some((k) => (precios[k] || '') !== (preciosBase[k] || ''))
  const savePrecios = async () => {
    setPreciosStatus('saving'); setPreciosError('')
    try {
      const res = await fetch('/api/mp-payments?settings=1', {
        method: 'PATCH',
        headers: auth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          cursosPrice: Number(precios.cursosPrice) || 0,
          workshopPrice: Number(precios.workshopPrice) || 0,
          workshopDate: precios.workshopDate ? new Date(precios.workshopDate).toISOString() : '',
          workshopPaymentsEnabled: precios.workshopPaymentsEnabled,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar')
      setPreciosBase({ cursosPrice: precios.cursosPrice, workshopPrice: precios.workshopPrice, workshopDate: precios.workshopDate })
      setPreciosStatus('')
      flash('precios')
    } catch (err) {
      setPreciosStatus('')
      setPreciosError(err.message || 'No se pudo conectar con el servidor.')
    }
  }

  /* El interruptor guarda solo, sin pasar por "Guardar": cortar los cobros es
     algo que se hace de urgencia y no puede quedar a medias en pantalla. Si el
     PATCH falla se revierte para no mostrar un estado que el servidor no tiene. */
  const toggleWorkshopPagos = async (v) => {
    const prev = precios.workshopPaymentsEnabled
    setPagosBusy(true); setPagosError('')
    setPrecios((p) => ({ ...p, workshopPaymentsEnabled: v }))
    try {
      const res = await fetch('/api/mp-payments?settings=1', {
        method: 'PATCH',
        headers: auth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ workshopPaymentsEnabled: v }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar')
      flash('pagos')
    } catch (err) {
      setPrecios((p) => ({ ...p, workshopPaymentsEnabled: prev }))
      setPagosError(err.message || 'No se pudo conectar con el servidor.')
    } finally {
      setPagosBusy(false)
    }
  }

  /* ============================================================ */

  const navItems = nav.filter(([id]) => id !== 'config' && canUse(id))
  const roleLabel = barber?.role || (admin ? 'Administrador' : 'Barbero')
  const exports = [
    ['Clientes', 'CSV con historial y contactos', 'user', 'clientes'],
    ['Reservas', 'Historial completo de citas', 'calendar', 'reservas'],
    ['Finanzas', 'Movimientos de ingresos del período activo', 'chart', 'finanzas'],
    ['Gastos', 'Registro de egresos por categoría', 'wallet', 'gastos'],
    ['Servicios', 'Catálogo actual publicado', 'scissors', 'servicios'],
  ].filter(([, , , tab]) => canUse(tab))
  const showList = !isPhone || !section

  return (
    <div className="animate-in">
      <div className="pn-ajustes-shell">
        <div className="pn-ajustes-left">
          {showList && <ModuleHeader title="Ajustes" />}

          {showList && (
            <div className="pn-ajustes-list-screen">
              <SearchField value={sectionQuery} onChange={setSectionQuery} placeholder="Buscar un ajuste…" />
              {visibleGroups.map((g) => (
                <div key={g.id} className="pn-ajustes-group">
                  <SectionLabel>{g.label}</SectionLabel>
                  <div className="pn-ajustes-list-card">
                    <List>
                      {g.items.map((s) => (
                        <ListRow
                          key={s.id}
                          lead={<span className="pn-ajustes-lead"><Icon name={s.icon} size={17} /></span>}
                          title={s.label}
                          chevron
                          onClick={() => openSection(s.id)}
                          className={!isPhone && section === s.id ? 'is-active' : undefined}
                        />
                      ))}
                    </List>
                  </div>
                </div>
              ))}
              {!visibleGroups.length && <EmptyState compact icon="search" text="Sin ajustes que coincidan." className="pn-ajustes-empty" />}
            </div>
          )}
        </div>

        {(!isPhone || section) && current && (
          <div className="pn-ajustes-detail-screen" ref={detailRef}>
            {isPhone && (
              <button type="button" className="pn-ajustes-back" onClick={() => setSection(null)}>
                <Icon name="chevronLeft" size={18} /> Ajustes
              </button>
            )}
            <h2 className="pn-ajustes-detail-title">{current.label}</h2>

            {/* PERFIL Y CONTRASEÑA */}
            {section === 'cuenta' && (
              <div className="pn-ajustes-section">
                <Card title="Datos personales" action={<SavedTick show={flashOn.name} />}>
                  <div className="pn-ajustes-profile">
                    <Avatar src={myPhoto} name={barber?.name} size={64} />
                    <div className="pn-ajustes-profile-text">
                      <strong>{barber?.name}</strong>
                      <span>{roleLabel}</span>
                    </div>
                  </div>
                  <div className="pn-form">
                    <Field label="Nombre">
                      <input className="input" value={nameDraft} maxLength={80} autoComplete="name" onChange={(e) => setNameDraft(e.target.value)} placeholder="Nombre completo" />
                    </Field>
                    <div className="pn-form-row">
                      <Field label="Usuario" hint="Es tu usuario para entrar al panel.">
                        <input className="input" value={barber?.code || ''} disabled />
                      </Field>
                      <Field label="Cargo">
                        <input className="input" value={roleLabel} disabled />
                      </Field>
                    </div>
                    {nameError && <InlineAlert tone="error">{nameError}</InlineAlert>}
                  </div>
                  <div className="pn-ajustes-savebar-wrap">
                    <SaveBar visible={nameDirty} saving={nameSaving} onSave={saveName} onDiscard={() => { setNameDraft(barber?.name || ''); setNameError('') }} />
                  </div>
                </Card>

                <Card title="Contraseña">
                  {!pwOpen && (
                    <div className="pn-ajustes-inline-action">
                      <Button variant="secondary" icon="key" onClick={() => openPassword(true)}>Cambiar contraseña</Button>
                    </div>
                  )}
                  {pwOpen && (
                    <div className="pn-form">
                      <Field label="Contraseña actual">
                        <input className="input" type="password" autoComplete="current-password" value={pwForm.current} onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))} placeholder="Tu contraseña actual" />
                      </Field>
                      <Field
                        label="Nueva contraseña"
                        hint={pwForm.next ? (passwordProblem(pwForm.next) || 'Cumple los requisitos.') : PASSWORD_RULES}
                      >
                        <input className="input" type="password" autoComplete="new-password" value={pwForm.next} onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value.slice(0, 200) }))} placeholder="Tu contraseña nueva" />
                      </Field>
                      <Field
                        label="Confirmar nueva contraseña"
                        error={pwForm.confirm && pwForm.next && pwForm.confirm !== pwForm.next.slice(0, pwForm.confirm.length) ? 'No coincide con la nueva.' : undefined}
                      >
                        <input className="input" type="password" autoComplete="new-password" value={pwForm.confirm} onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value.slice(0, 200) }))} placeholder="Repite la nueva contraseña" />
                      </Field>
                      {pwError && <InlineAlert tone="error">{pwError}</InlineAlert>}
                      {pwStatus === 'done' && <InlineAlert tone="success">Contraseña actualizada.</InlineAlert>}
                      <div className="pn-ajustes-actions">
                        <Button variant="primary" size="sm" loading={pwStatus === 'saving'} disabled={pwStatus === 'done'} onClick={changePassword}>Guardar contraseña</Button>
                        <Button variant="plain" size="sm" disabled={pwStatus === 'saving'} onClick={() => openPassword(false)}>Cancelar</Button>
                      </div>
                    </div>
                  )}
                </Card>

                {FEATURES.passwordReset && (
                  <Card
                    title="Correo para recuperar la contraseña"
                    subtitle="Si la olvidas, toca «¿Olvidaste tu contraseña?» al ingresar y te mandamos a este correo un enlace para crear una nueva."
                    action={<SavedTick show={flashOn.email} />}
                  >
                    <div className="pn-form">
                      <Field
                        label="Correo"
                        hint={emailKnown ? undefined : 'Por seguridad no mostramos el correo guardado. Si escribes uno, reemplaza al anterior.'}
                      >
                        <input
                          className="input"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          value={emailDraft}
                          maxLength={300}
                          onChange={(e) => { setEmailDraft(e.target.value); if (emailMsg?.tone === 'success') setEmailMsg(null) }}
                          placeholder="nombre@gmail.com"
                        />
                      </Field>
                      {emailDirty && (
                        <Field label="Contraseña actual" hint="Para confirmar que eres tú.">
                          <input className="input" type="password" autoComplete="current-password" value={emailPw} onChange={(e) => setEmailPw(e.target.value)} placeholder="Tu contraseña actual" />
                        </Field>
                      )}
                      {emailMsg && <InlineAlert tone={emailMsg.tone}>{emailMsg.text}</InlineAlert>}
                    </div>
                    <div className="pn-ajustes-savebar-wrap">
                      <SaveBar
                        visible={emailDirty}
                        saving={emailSaving}
                        onSave={saveEmail}
                        onDiscard={discardEmail}
                        message={emailDraft.trim() ? 'Correo sin guardar' : 'Se va a borrar el correo'}
                        saveLabel={emailDraft.trim() ? 'Guardar correo' : 'Borrar correo'}
                      />
                    </div>
                  </Card>
                )}

                <Card title="Sesión">
                  <List>
                    <ListRow
                      title="Cerrar sesión"
                      subtitle="Vuelves a la pantalla de ingreso."
                      subtitleWrap
                      trailing={<Button variant="secondary" size="sm" icon="logout" onClick={() => onLogout?.()}>Salir</Button>}
                    />
                  </List>
                </Card>
              </div>
            )}

            {/* NOTIFICACIONES */}
            {section === 'notificaciones' && (
              <div className="pn-ajustes-section">
                <PushCard barber={barber} />
                <Card title="Alertas internas" action={<SavedTick show={flashOn.notif} />}>
                  <Note>Todavía no se aplica: se guarda para cuando se conecte.</Note>
                  <List>
                    <ToggleRow title="Nueva reserva" description="Cuando un cliente agenda" checked={notif.reserva} disabled={!prefsReady} onChange={(v) => setPref('notif', 'reserva', v)} />
                    <ToggleRow title="Cancelación" description="Cuando un cliente cancela su hora" checked={notif.cancelacion} disabled={!prefsReady} onChange={(v) => setPref('notif', 'cancelacion', v)} />
                    <ToggleRow title="Recordatorio de cita" description="Un aviso antes de cada hora agendada" checked={notif.recordatorio} disabled={!prefsReady} onChange={(v) => setPref('notif', 'recordatorio', v)} />
                    <ToggleRow title="Novedades del panel" description="Cambios y mejoras del sistema" checked={notif.marketing} disabled={!prefsReady} onChange={(v) => setPref('notif', 'marketing', v)} />
                  </List>
                  {prefsError.notif && <InlineAlert tone="error" className="pn-ajustes-alert">{prefsError.notif}</InlineAlert>}
                </Card>
              </div>
            )}

            {/* APARIENCIA — data-theme es global: el tema elegido también
                pinta la web pública en este dispositivo. */}
            {section === 'apariencia' && (
              <div className="pn-ajustes-section">
                <Card title="Tema de la interfaz">
                  <List>
                    <ToggleRow
                      title="Automático según la hora"
                      description="Claro de 7:00 a 19:00, oscuro el resto."
                      checked={auto}
                      onChange={setAuto}
                    />
                  </List>
                  <div className="pn-ajustes-theme-grid" role="radiogroup" aria-label="Tema">
                    {[['dark', 'Oscuro'], ['light', 'Claro']].map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={theme === id}
                        className={`pn-ajustes-theme-tile ${theme === id ? 'is-active' : ''}`}
                        onClick={() => setTheme(id)}
                      >
                        <span className={`pn-ajustes-theme-thumb ${id}`} aria-hidden="true" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                  <Note>{auto
                    ? 'Elegir uno de los dos apaga el automático. Aplica a este dispositivo: el panel y la web.'
                    : 'Aplica a este dispositivo: el panel y la web.'}</Note>
                </Card>
              </div>
            )}

            {/* NAVEGACIÓN Y ACCESOS */}
            {section === 'navegacion' && (
              <div className="pn-ajustes-section">
                <Card title="Módulos visibles" subtitle="Elige qué módulos aparecen en el menú y en el dock. Esconder uno no borra nada.">
                  <List>
                    {navItems.map(([id, ic, label]) => {
                      const fixed = ALWAYS_NAV.includes(id)
                      return (
                        <ToggleRow
                          key={id}
                          lead={<Icon name={ic} size={17} />}
                          title={label}
                          description={fixed ? 'Siempre visible' : undefined}
                          checked={fixed || navSettings[id] !== false}
                          disabled={fixed}
                          onChange={(v) => setNavSettings?.((s) => ({ ...s, [id]: v }))}
                        />
                      )
                    })}
                  </List>
                </Card>
                <Card title="Accesos del dock" subtitle="Los 4 módulos de la barra de abajo en el celular. El botón del centro siempre abre el menú completo.">
                  <List>
                    {navItems.map(([id, ic, label]) => {
                      const on = dockShortcuts.includes(id)
                      const full = !on && dockShortcuts.length >= 4
                      const hidden = !ALWAYS_NAV.includes(id) && navSettings[id] === false
                      return (
                        <ToggleRow
                          key={id}
                          lead={<Icon name={ic} size={17} />}
                          title={label}
                          description={full ? 'Ya tienes 4 elegidos' : (on && hidden ? 'Escondido en el menú: no sale en el dock' : undefined)}
                          checked={on}
                          disabled={full}
                          onChange={(v) => setDockShortcuts?.(v ? [...dockShortcuts, id] : dockShortcuts.filter((s) => s !== id))}
                        />
                      )
                    })}
                  </List>
                  <Note icon={dockShortcuts.length === 4 ? 'checkCircle' : 'info'}>
                    {dockShortcuts.length === 4 ? '4 accesos elegidos.' : `Llevas ${dockShortcuts.length} de 4.`}
                  </Note>
                </Card>
              </div>
            )}

            {/* DATOS DEL NEGOCIO (el teléfono es también el de WhatsApp Business) */}
            {section === 'negocio' && (
              <div className="pn-ajustes-section">
                <Card title="Datos del negocio" subtitle={admin ? undefined : 'Solo el administrador puede editarlos.'} action={<SavedTick show={flashOn.biz} />}>
                  <Note>Todavía no se muestran en la web: se guardan para cuando se conecten.</Note>
                  <div className="pn-form">
                    <Field label="Nombre">
                      <input className="input" value={bizDraft.name} maxLength={120} disabled={!admin} onChange={(e) => setBizDraft((b) => ({ ...b, name: e.target.value }))} />
                    </Field>
                    <Field label="Dirección">
                      <input className="input" value={bizDraft.address} maxLength={120} disabled={!admin} onChange={(e) => setBizDraft((b) => ({ ...b, address: e.target.value }))} />
                    </Field>
                    <Field label="Teléfono" hint="También es el número de WhatsApp Business.">
                      <input className="input" type="tel" inputMode="tel" value={bizDraft.phone} maxLength={120} disabled={!admin} placeholder="+56 9 xxxx xxxx" onChange={(e) => setBizDraft((b) => ({ ...b, phone: e.target.value }))} />
                    </Field>
                    {bizError && <InlineAlert tone="error">{bizError}</InlineAlert>}
                  </div>
                  {admin && (
                    <div className="pn-ajustes-savebar-wrap">
                      <SaveBar visible={bizDirty} saving={bizSaving} onSave={saveBiz} onDiscard={() => { setBizDraft(biz); setBizError('') }} />
                    </div>
                  )}
                </Card>
              </div>
            )}

            {/* HORARIO Y RESERVAS */}
            {section === 'horario' && (
              <div className="pn-ajustes-section">
                <Card title="Horario operativo" action={<SavedTick show={flashOn.horario} />}>
                  <Note>Todavía no se aplica: se guarda para cuando se conecte.</Note>
                  <div className="pn-form-row pn-ajustes-selects">
                    <Field label="Apertura">
                      <select className="input" value={horario.apertura} disabled={!prefsReady} onChange={(e) => setPref('horario', 'apertura', e.target.value)}><option>09:00</option><option>10:00</option></select>
                    </Field>
                    <Field label="Cierre">
                      <select className="input" value={horario.cierre} disabled={!prefsReady} onChange={(e) => setPref('horario', 'cierre', e.target.value)}><option>19:00</option><option>20:00</option><option>21:00</option></select>
                    </Field>
                    <Field label="Anticipación mínima">
                      <select className="input" value={horario.anticipacion} disabled={!prefsReady} onChange={(e) => setPref('horario', 'anticipacion', e.target.value)}><option value="60">1 hora</option><option value="120">2 horas</option><option value="240">4 horas</option></select>
                    </Field>
                    <Field label="Ventana de reservas">
                      <select className="input" value={horario.ventana} disabled={!prefsReady} onChange={(e) => setPref('horario', 'ventana', e.target.value)}><option value="14">14 días</option><option value="30">30 días</option></select>
                    </Field>
                    <Field label="Domingos">
                      <select className="input" value={horario.domingo} disabled={!prefsReady} onChange={(e) => setPref('horario', 'domingo', e.target.value)}><option value="closed">Cerrado</option><option value="open">Abierto</option></select>
                    </Field>
                    <Field label="Cancelación del cliente">
                      <select className="input" value={horario.cancelacion} disabled={!prefsReady} onChange={(e) => setPref('horario', 'cancelacion', e.target.value)}><option value="manual">Solo manual</option><option value="24h">Hasta 24 h antes</option><option value="12h">Hasta 12 h antes</option></select>
                    </Field>
                  </div>
                  {prefsError.horario && <InlineAlert tone="error" className="pn-ajustes-alert">{prefsError.horario}</InlineAlert>}
                </Card>
              </div>
            )}

            {/* CIERRE AUTOMÁTICO (admin, servidor) */}
            {section === 'cierre' && (
              <div className="pn-ajustes-section">
                <Card title="Atenciones en curso" action={<SavedTick show={flashOn.ac} />}>
                  <List>
                    <ToggleRow
                      title="Completar solas las atenciones iniciadas"
                      description={autoComplete === null && !acError
                        ? 'Cargando…'
                        : autoComplete
                          ? 'Encendido: una atención iniciada que nadie cerró se completa sola.'
                          : 'Apagado: una atención iniciada queda «en curso» hasta que la cierres tú.'}
                      checked={Boolean(autoComplete)}
                      disabled={autoComplete === null || acBusy}
                      onChange={toggleAutoComplete}
                    />
                  </List>
                  {acError && (
                    <InlineAlert
                      tone="error"
                      className="pn-ajustes-alert"
                      action={autoComplete === null ? { label: 'Reintentar', onClick: () => setShopLoad((n) => n + 1) } : undefined}
                    >
                      {acError}
                    </InlineAlert>
                  )}
                  <div className="pn-ajustes-explain">
                    <p>Sirve para el día en que se te olvida cerrar una atención. Solo toma las que marcaste <b>En curso</b>: una reserva pendiente o confirmada nunca se completa sola.</p>
                    <ul>
                      <li>Se completa cuando ya pasó la duración del servicio (mínimo 1 hora) desde que la iniciaste y desde la hora agendada.</li>
                      <li>El cliente suma su estrella, igual que si la cerraras tú.</li>
                      <li>El cobro queda <b>por confirmar</b> en Resumen y Caja, y te llega un aviso para que anotes cómo pagó. Un servicio de $0 queda como cortesía.</li>
                      <li>Se revisa al abrir el panel y cada hora. Solo mira los últimos 30 días: las más antiguas quedan como están.</li>
                    </ul>
                  </div>
                </Card>
              </div>
            )}

            {/* MENSAJES DE WHATSAPP (el teléfono está en Datos del negocio) */}
            {section === 'whatsapp' && (
              <div className="pn-ajustes-section">
                <Card title="Mensajería automática" action={<SavedTick show={flashOn.whatsapp} />}>
                  <Note>Todavía no se aplica: se guarda para cuando se conecte.</Note>
                  <List>
                    <ToggleRow title="WhatsApp activo" description="Envío automático de mensajes a clientes" checked={wa.activo} disabled={!prefsReady} onChange={(v) => setPref('whatsapp', 'activo', v)} />
                    <ToggleRow title="Recordatorio 24 h" description="Mensaje el día anterior a la hora" checked={wa.recordatorio24h} disabled={!prefsReady || !wa.activo} onChange={(v) => setPref('whatsapp', 'recordatorio24h', v)} />
                    <ToggleRow title="Recordatorio 2 h" description="Mensaje dos horas antes" checked={wa.recordatorio2h} disabled={!prefsReady || !wa.activo} onChange={(v) => setPref('whatsapp', 'recordatorio2h', v)} />
                    <ToggleRow title="Confirmación de reserva" description="Mensaje apenas agendan" checked={wa.confirmacion} disabled={!prefsReady || !wa.activo} onChange={(v) => setPref('whatsapp', 'confirmacion', v)} />
                  </List>
                  {prefsError.whatsapp && <InlineAlert tone="error" className="pn-ajustes-alert">{prefsError.whatsapp}</InlineAlert>}
                </Card>
              </div>
            )}

            {/* CURSOS Y WORKSHOP — precio de Cursos, precio y fecha del Workshop
                y el interruptor de pagos del Workshop (pausa). */}
            {section === 'precios' && (
              <div className="pn-ajustes-section">
                <Card title="Pagos del Workshop" action={<SavedTick show={flashOn.pagos} />}>
                  <List>
                    <ToggleRow
                      title="Aceptar pagos en la web"
                      description={preciosLoading
                        ? 'Cargando…'
                        : precios.workshopPaymentsEnabled
                          ? 'Activos: la web cobra por Mercado Pago para la fecha de abajo.'
                          : 'En pausa: nadie puede pagar. La web solo ofrece la lista de espera y no muestra fecha.'}
                      checked={precios.workshopPaymentsEnabled}
                      disabled={preciosLoading || pagosBusy}
                      onChange={toggleWorkshopPagos}
                    />
                  </List>
                  {pagosError && <InlineAlert tone="error" className="pn-ajustes-alert">{pagosError}</InlineAlert>}
                  <p className="pn-ajustes-footnote">Se guarda al tocarlo, sin pasar por «Guardar». Cursos y Essentials no se ven afectados.</p>
                </Card>

                <Card title="Precios y fecha" subtitle="El precio real que se cobra por Mercado Pago y la fecha de la próxima edición del Workshop." action={<SavedTick show={flashOn.precios} />}>
                  <div className="pn-form">
                    <div className="pn-form-row">
                      <Field label="Precio Cursos (CLP)">
                        <input
                          className="input"
                          inputMode="numeric"
                          value={precios.cursosPrice}
                          disabled={preciosLoading}
                          onChange={(e) => setPrecios((p) => ({ ...p, cursosPrice: e.target.value.replace(/\D/g, '') }))}
                          placeholder="9990"
                        />
                      </Field>
                      <Field label="Precio Workshop (CLP)">
                        <input
                          className="input"
                          inputMode="numeric"
                          value={precios.workshopPrice}
                          disabled={preciosLoading}
                          onChange={(e) => setPrecios((p) => ({ ...p, workshopPrice: e.target.value.replace(/\D/g, '') }))}
                          placeholder="49990"
                        />
                      </Field>
                    </div>
                    <Field label="Fecha del Workshop" hint="Guarda la fecha nueva y recién ahí enciende los pagos.">
                      <input
                        className="input"
                        type="datetime-local"
                        value={precios.workshopDate}
                        disabled={preciosLoading}
                        onChange={(e) => setPrecios((p) => ({ ...p, workshopDate: e.target.value }))}
                      />
                    </Field>
                    {preciosError && <InlineAlert tone="error">{preciosError}</InlineAlert>}
                  </div>
                  <div className="pn-ajustes-savebar-wrap">
                    <SaveBar
                      visible={preciosDirty}
                      saving={preciosStatus === 'saving' || pagosBusy}
                      onSave={savePrecios}
                      onDiscard={() => { setPrecios((p) => ({ ...p, ...preciosBase })); setPreciosError('') }}
                    />
                  </div>
                </Card>
              </div>
            )}

            {/* PRESUPUESTOS (solo admin: filtrado más arriba en `groups`) */}
            {section === 'presupuestos' && (
              <div className="pn-ajustes-section">
                <Card title="Presupuesto mensual por categoría" subtitle="Un tope por categoría enciende el semáforo de Gastos. Déjalo vacío para no poner tope." action={<SavedTick show={flashOn.budgets} />}>
                  <div className="pn-ajustes-budgets">
                    {EXPENSE_CATEGORIES.map((cat) => {
                      const m = CATEGORY_META[cat]
                      return (
                        <label key={cat} className="pn-ajustes-budget-row">
                          <Chip tone="muted" icon={m.icon}>{cat}</Chip>
                          <input
                            className="input"
                            inputMode="numeric"
                            placeholder="Sin tope"
                            aria-label={`Presupuesto de ${cat}`}
                            value={budgetsDraft[cat] ? String(budgetsDraft[cat]) : ''}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\D/g, '').slice(0, 10)
                              setBudgetsDraft((b) => { const next = { ...b }; if (Number(v) > 0) next[cat] = Number(v); else delete next[cat]; return next })
                            }}
                          />
                        </label>
                      )
                    })}
                  </div>
                  {budgetsError && <InlineAlert tone="error" className="pn-ajustes-alert">{budgetsError}</InlineAlert>}
                  <div className="pn-ajustes-savebar-wrap">
                    <SaveBar visible={budgetsDirty} saving={budgetsSaving} onSave={saveBudgets} onDiscard={() => { setBudgetsDraft(expenseBudgets); setBudgetsError('') }} />
                  </div>
                </Card>
              </div>
            )}

            {/* DATOS Y RESPALDOS */}
            {section === 'datos' && (
              <div className="pn-ajustes-section">
                <Card title="Exportar datos" subtitle="Un CSV con lo que el panel tiene cargado, para abrir en Excel o Google Sheets.">
                  <List>
                    {exports.map(([label, sub, icon]) => (
                      <ListRow
                        key={label}
                        lead={<Icon name={icon} size={17} />}
                        title={label}
                        subtitle={sub}
                        subtitleWrap
                        trailing={<Button variant="secondary" size="sm" icon="download" onClick={() => onExport?.(label)}>CSV</Button>}
                      />
                    ))}
                  </List>
                </Card>
                <Card title="Base de datos">
                  <div className="pn-ajustes-kv">
                    <div><strong>Neon PostgreSQL</strong><span>Respaldo automático diario. Revisa el snapshot antes de cambios masivos.</span></div>
                    <div><strong>Auditoría</strong><span>Los cambios de agenda y servicios quedan en el registro del servidor.</span></div>
                  </div>
                </Card>
              </div>
            )}

            {/* ACERCA DE */}
            {section === 'acerca' && (
              <div className="pn-ajustes-section">
                <Card>
                  <div className="pn-ajustes-about-hero">
                    <Emblem size={56} />
                    <h3 className="font-display">BRUNETTI</h3>
                    <p>Panel interno v2.0</p>
                    <p>Barbería Premium · Maipú, Santiago</p>
                  </div>
                </Card>
                <Card>
                  <div className="pn-ajustes-kv">
                    <div><strong>Versión</strong><span>2.0.0 — React + Vite + Vercel</span></div>
                    <div><strong>Ambiente</strong><span>Producción — brunetticutz.cl</span></div>
                    <div><strong>Soporte</strong><span>Panel gestionado internamente.</span></div>
                  </div>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={acConfirm}
        icon="checkCircle"
        title="¿Completar solas las atenciones iniciadas?"
        message="Las que queden «en curso» se van a completar solas cuando pase su duración: el cliente suma su estrella y el cobro queda por confirmar. Lo puedes apagar cuando quieras."
        confirmLabel="Encender"
        busy={acBusy}
        onConfirm={() => applyAutoComplete(true)}
        onCancel={() => setAcConfirm(false)}
      />
    </div>
  )
}

/* Pestaña «config» del panel interno. Toma del ctx de Dashboard.jsx (el
   objeto `dash`) solo lo que usa y se lo pasa a ConfigPanel como props. */
export default function ConfigTab({ ctx }) {
  const {
    admin,
    authHeaders,
    barber,
    configSection,
    dockShortcuts,
    expenseBudgets,
    exportCSV,
    has,
    logout,
    mainRef,
    myPhoto,
    nav,
    navSettings,
    searchParams,
    setBarber,
    setConfigSection,
    setDockShortcuts,
    setExpenseBudgets,
    setNavSettings,
  } = ctx
  return (
    <ConfigPanel
      barber={barber}
      setBarber={setBarber}
      myPhoto={myPhoto}
      admin={admin}
      authHeaders={authHeaders}
      has={has}
      onExport={exportCSV}
      onLogout={logout}
      nav={nav}
      navSettings={navSettings}
      setNavSettings={setNavSettings}
      dockShortcuts={dockShortcuts}
      setDockShortcuts={setDockShortcuts}
      expenseBudgets={expenseBudgets}
      setExpenseBudgets={setExpenseBudgets}
      scrollRef={mainRef}
      initialSection={configSection || searchParams?.get?.('section') || null}
      onSectionConsumed={setConfigSection ? () => setConfigSection(null) : undefined}
    />
  )
}
