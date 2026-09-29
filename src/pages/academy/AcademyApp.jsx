import React, { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AcademyContext } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import {
  getToken, getMember, setSession, setStoredMember, clearSession, isTokenExpired, isPwcSession,
} from '../../academy/session.js'
import { clearQueryCache } from '../../academy/useQuery.js'
import { useSync, requestSync } from '../../academy/useSync.js'
import { levelName as baseLevelName, DEFAULT_LEVEL_NAMES } from '../../academy/levels.js'
import { DEFAULT_TZ } from '../../academy/time.js'
import { isAcademyPath } from '../../academy/url.js'
import { r } from '../../academy/routes.js'
import { ACADEMY_BRAND } from '../../academy/hostConfig.js'
import { useMediaQuery, Button } from '../../components/panel/index.js'
import AcademyShell from '../../components/academy/AcademyShell.jsx'
import PageState, { useAcaMode } from '../../components/academy/PageState.jsx'
import '../../styles/academy/app.css'

/* ============================================================
   AcademyApp — la app del miembro bajo <base>/* (SPEC §7.1–7.3).

   1. Guardia: sin token (o vencido) → <base>/ingreso?next=…; token de
      "crea tu contraseña" (pwc) → <base>/crear-contrasena. Navegación
      dura con replace: el botón Atrás no vuelve a una pantalla que rebota.
   2. `me` al montar: perfil + resumen del grupo (+ token renovado, que se
      guarda). Si ya había un perfil guardado se pinta al tiro y `me`
      revalida por detrás; si no, esqueleto hasta que llegue.
   3. Contexto (AcademyContext): me, group, contadores sin leer (del modo
      `sync`: al montar, al volver a la pestaña y con refreshUnread()),
      chats abiertos, popovers, roles, nombres de nivel, toast, logout.
   4. body.aca-mode mientras está montada (fondo propio, sin el toggle
      flotante de tema ni el degradé del sitio público).
   5. Escucha `ps-navigate` del service worker (tocar un push con la app ya
      abierta navega sin recargar).
   6. Rutas anidadas, todas perezosas con <Suspense> → PageState.
   ============================================================ */

const ComunidadTab = lazy(() => import('./tabs/ComunidadTab.jsx'))
const CursosTab = lazy(() => import('./tabs/CursosTab.jsx'))
const CalendarioTab = lazy(() => import('./tabs/CalendarioTab.jsx'))
const MiembrosTab = lazy(() => import('./tabs/MiembrosTab.jsx'))
const ClasificacionTab = lazy(() => import('./tabs/ClasificacionTab.jsx'))
const AcercaTab = lazy(() => import('./tabs/AcercaTab.jsx'))
const CursoPage = lazy(() => import('./CursoPage.jsx'))
const LeccionPage = lazy(() => import('./LeccionPage.jsx'))
const PerfilPage = lazy(() => import('./PerfilPage.jsx'))
const AjustesPage = lazy(() => import('./AjustesPage.jsx'))
const ReglasPage = lazy(() => import('./ReglasPage.jsx'))
const BuscarPage = lazy(() => import('./BuscarPage.jsx'))
const ChatPage = lazy(() => import('./ChatPage.jsx'))
const GrupoPage = lazy(() => import('./GrupoPage.jsx'))

const GROUP_KEY = 'ps_academy_group'
const MAX_DOCKED = 2
// Mismo corte que ChatDock (DOCK_MIN_QUERY en ChatWindow.jsx): desde 900 px
// el chat se abre acoplado; más angosto, como página <base>/chat/:id. Se
// repite acá para no cargar el chunk del chat solo por una constante.
const DOCK_QUERY = '(min-width: 900px)'

/* Resumen del grupo guardado (nombre, iniciales, color, pestañas): así la
   barra se pinta con el nombre correcto antes de que responda `me`. No es
   dato sensible — es lo mismo que muestra la página pública. */
function readGroup() {
  try {
    const raw = localStorage.getItem(GROUP_KEY)
    const g = raw ? JSON.parse(raw) : null
    return g && typeof g === 'object' ? g : null
  } catch {
    return null
  }
}
function writeGroup(g) {
  try { if (g && typeof g === 'object') localStorage.setItem(GROUP_KEY, JSON.stringify(g)) } catch { /* sin storage */ }
}

function currentNext() {
  try {
    const p = window.location.pathname + window.location.search
    return isAcademyPath(p) ? p : ''
  } catch {
    return ''
  }
}

function initialGuard() {
  const token = getToken()
  if (!token || isTokenExpired(token)) return 'login'
  if (isPwcSession()) return 'pwc'
  return 'ok'
}

function normalizeKind(kind) {
  if (kind === 'success' || kind === 'ok') return 'ok'
  if (kind === 'error' || kind === 'danger') return 'error'
  if (kind === 'warn' || kind === 'warning') return 'warn'
  return 'info'
}

/* Barrera de las rutas: si una pestaña revienta, se muestra un error con
   "Reintentar" dentro del shell (la barra sigue viva). Se limpia sola al
   cambiar de ruta. */
class RouteBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, path: props.path }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  static getDerivedStateFromProps(props, state) {
    if (props.path !== state.path) return { error: null, path: props.path }
    return null
  }
  componentDidCatch(error) {
    console.error('[academy:route]', error)
  }
  render() {
    if (!this.state.error) return this.props.children
    // Un chunk que no carga suele ser un deploy nuevo: recargar lo arregla.
    const chunk = /Loading chunk|dynamically imported module|Importing a module script failed/i.test(String(this.state.error?.message || ''))
    return (
      <PageState
        error={{ message: chunk ? 'Hay una versión nueva de la Academy. Recarga para seguir.' : 'Algo falló al mostrar esta página.' }}
        errorTitle={chunk ? 'Actualización disponible' : 'No se pudo cargar'}
        onRetry={() => (chunk ? window.location.reload() : this.setState({ error: null }))}
      />
    )
  }
}

/* Motor de contadores: useSync sin chat (60 s, solo con la pestaña activa y
   el miembro usándola). Tiene que vivir DENTRO del proveedor para leer
   group.sync.enabled del contexto. */
function UnreadWatcher({ onData }) {
  useSync({ onData })
  return null
}

let toastSeq = 0

export default function AcademyApp() {
  const navigate = useNavigate()
  const location = useLocation()
  const dockable = useMediaQuery(DOCK_QUERY)
  useAcaMode()

  const [guard] = useState(initialGuard)
  const [me, setMeState] = useState(() => (guard === 'ok' ? getMember() : null))
  const [group, setGroup] = useState(readGroup)
  const [status, setStatus] = useState(() => (guard === 'ok' && getMember() ? 'ready' : 'loading'))
  const [loadError, setLoadError] = useState(null)
  const [unread, setUnread] = useState({ notifications: 0, chats: 0 })
  const [popover, setPopover] = useState(null)
  const [openChats, setOpenChats] = useState([])
  const [toasts, setToasts] = useState([])

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const meRef = useRef(me)
  meRef.current = me
  const dockableRef = useRef(dockable)
  dockableRef.current = dockable

  // 1. Guardia (navegación dura: <base>/ingreso y la app comparten CSP,
  // pero así la app arranca limpia después de entrar).
  useEffect(() => {
    if (guard === 'login') {
      clearSession()
      const next = currentNext()
      window.location.replace(r.login(next))
    } else if (guard === 'pwc') {
      window.location.replace(r.crearContrasena)
    }
  }, [guard])

  // --- toasts ---
  const toast = useCallback((message, kind = 'info') => {
    if (message === undefined || message === null || message === '') return
    const text = String(message)
    const k = normalizeKind(kind)
    const id = ++toastSeq
    setToasts((ts) => [...ts.filter((t) => t.message !== text), { id, message: text, kind: k }].slice(-3))
    setTimeout(() => {
      if (alive.current) setToasts((ts) => ts.filter((t) => t.id !== id))
    }, k === 'error' ? 6500 : 4000)
  }, [])
  const dismissToast = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])

  // --- me ---
  const setMe = useCallback((next) => {
    setMeState((prev) => (typeof next === 'function' ? next(prev) : next))
  }, [])
  useEffect(() => { if (me) setStoredMember(me) }, [me])

  const loadMe = useCallback(async () => {
    try {
      const d = await academyApi('me')
      const m = d && d.member
      if (!m || typeof m !== 'object') throw Object.assign(new Error('La Academy no respondió bien. Intenta de nuevo.'), { status: 503 })
      // Renovación deslizante: el servidor manda un token nuevo si el actual
      // tiene más de un día. Nunca convierte un pwc en uno completo.
      if (d.token) setSession(d.token, m)
      else setStoredMember(m)
      if (!alive.current) return m
      setMeState(m)
      if (d.group && typeof d.group === 'object') {
        setGroup(d.group)
        writeGroup(d.group)
      }
      setLoadError(null)
      setStatus('ready')
      if (m.mustChangePassword) window.location.replace(r.crearContrasena)
      return m
    } catch (err) {
      // 401/403-pwc: api.js ya borró la sesión y está redirigiendo.
      if (err && (err.status === 401 || err.code === 'password_change_required')) return null
      if (!alive.current) return null
      setLoadError(err)
      setStatus((s) => (s === 'ready' ? s : 'error'))
      return null
    }
  }, [])

  useEffect(() => {
    if (guard !== 'ok') return
    loadMe().then((m) => {
      // Ya se veía con el perfil guardado: el fallo de la revalidación es
      // solo un aviso, no una pantalla de error.
      if (!m && meRef.current && alive.current) toast('No pudimos actualizar tu perfil. Revisa tu conexión.', 'error')
    })
  }, [guard]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshMe = useCallback(() => loadMe(), [loadMe])

  // Avisos push: si el miembro los tenía activos, re-registrar este
  // dispositivo en el servidor (silencioso; nunca pide permiso).
  const pushSynced = useRef(false)
  useEffect(() => {
    if (status !== 'ready' || pushSynced.current) return
    pushSynced.current = true
    import('../../academy/push.js').then((m) => m.syncAcademyPush?.()).catch(() => {})
  }, [status])

  // --- contadores sin leer (modo sync) ---
  const applySync = useCallback((d) => {
    if (!d || typeof d !== 'object') return
    setUnread((u) => {
      const n = Number.isFinite(Number(d.unreadNotifications)) ? Number(d.unreadNotifications) : u.notifications
      const c = Number.isFinite(Number(d.unreadChats)) ? Number(d.unreadChats) : u.chats
      return n === u.notifications && c === u.chats ? u : { notifications: n, chats: c }
    })
  }, [])

  const refreshUnread = useCallback(async () => {
    try {
      const d = await requestSync()
      applySync(d)
      return d
    } catch {
      return null
    }
  }, [applySync])

  useEffect(() => {
    if (status !== 'ready') return undefined
    const onVisible = () => { if (document.visibilityState === 'visible') refreshUnread() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [status, refreshUnread])

  // --- popovers ---
  // `setPopover` acepta un valor o una función (el shell cierra "solo si
  // sigue siendo el abierto"). Abrir cualquiera refresca los contadores.
  const openNotifications = useCallback(() => setPopover('notifications'), [])
  const openChatsList = useCallback(() => setPopover('chats'), [])
  const closePopover = useCallback(() => setPopover(null), [])
  useEffect(() => { if (popover) refreshUnread() }, [popover]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cambiar de ruta cierra los popovers (tocar una notificación navega).
  useEffect(() => { setPopover(null) }, [location.pathname])

  // --- chats ---
  const openChat = useCallback(async (target) => {
    let chatId = null
    if (target && typeof target === 'object') {
      if (target.chatId) chatId = Number(target.chatId) || null
      else if (target.memberId) {
        try {
          const d = await academyApi('chat-start', { method: 'POST', body: { memberId: Number(target.memberId) } })
          chatId = Number(d?.chatId) || null
        } catch (err) {
          toast(err?.message || 'No se pudo abrir el chat.', 'error')
          return null
        }
      }
    } else {
      chatId = Number(target) || null
    }
    if (!chatId || !alive.current) return null
    setPopover(null)
    if (!dockableRef.current) {
      navigate(r.chat(chatId))
      return chatId
    }
    setOpenChats((list) => (list.includes(chatId) ? list : [...list, chatId].slice(-MAX_DOCKED)))
    return chatId
  }, [navigate, toast])

  const closeChat = useCallback((chatId) => {
    const id = Number(chatId)
    setOpenChats((list) => list.filter((x) => x !== id))
  }, [])

  // --- onboarding ---
  const markOnboarding = useCallback(async (id) => {
    const cur = meRef.current
    if (!cur || !id) return
    const ob = cur.prefs?.onboarding || {}
    const done = Array.isArray(ob.done) ? ob.done : []
    if (done.includes(id)) return
    const nextDone = [...done, String(id)].slice(-20)
    setMe((p) => (p ? { ...p, prefs: { ...(p.prefs || {}), onboarding: { ...(p.prefs?.onboarding || {}), done: nextDone } } } : p))
    try {
      const d = await academyApi('me-update', { method: 'POST', body: { prefs: { onboarding: { done: nextDone } } } })
      if (d?.member && alive.current) setMe(d.member)
    } catch { /* queda marcado en este dispositivo; se reintenta la próxima vez */ }
  }, [setMe])

  // --- logout ---
  const logout = useCallback(async () => {
    // Primero bajar los avisos de ESTE miembro en este dispositivo (el
    // siguiente que entre no debe recibirlos), con tope de espera.
    try {
      const m = await import('../../academy/push.js')
      await Promise.race([m.disableAcademyPush?.(), new Promise((res) => setTimeout(res, 2500))])
    } catch { /* sin push */ }
    clearSession()
    clearQueryCache()
    window.location.assign(r.ingreso)
  }, [])

  // --- service worker: tocar un push con la app abierta ---
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined
    const onMessage = (event) => {
      const url = event?.data?.type === 'ps-navigate' ? event.data.url : null
      if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return
      if (isAcademyPath(url)) navigate(url)
      else window.location.assign(url)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])

  // --- título de la pestaña con el total sin leer ---
  const groupName = group?.name || ACADEMY_BRAND.name
  const unreadTotal = (Number(unread.notifications) || 0) + (Number(unread.chats) || 0)
  useEffect(() => {
    const prev = document.title
    return () => { document.title = prev }
  }, [])
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal > 99 ? '99+' : unreadTotal}) ${groupName}` : groupName
  }, [unreadTotal, groupName])

  // --- roles y derivados ---
  const role = me?.role
  const isOwner = Boolean(me?.isOwner || role === 'propietario')
  const isAdmin = Boolean(me?.isAdmin || isOwner || role === 'admin')
  // El backend manda isModerator = cualquier rol del equipo (propietario,
  // admin, moderador): se respeta esa semántica.
  const isStaff = Boolean(me?.isModerator || isAdmin || role === 'moderador')
  const isModerator = isStaff
  const levelNames = useMemo(() => {
    const names = group?.levels?.names
    return Array.isArray(names) && names.length ? names : DEFAULT_LEVEL_NAMES
  }, [group])
  const levelName = useCallback((n) => baseLevelName(n, levelNames), [levelNames])
  const tz = (me?.prefs && typeof me.prefs.tz === 'string' && me.prefs.tz) || DEFAULT_TZ

  const value = useMemo(() => ({
    me,
    group,
    setMe,
    refreshMe,
    unread,
    setUnread,
    refreshUnread,
    openChat,
    closeChat,
    openChats,
    openNotifications,
    openChatsList,
    closePopover,
    isStaff,
    isAdmin,
    isOwner,
    isModerator,
    levelName,
    levelNames,
    tz,
    toast,
    markOnboarding,
    logout,
  }), [me, group, setMe, refreshMe, unread, refreshUnread, openChat, closeChat, openChats, openNotifications,
    openChatsList, closePopover, isStaff, isAdmin, isOwner, isModerator, levelName, levelNames, tz, toast, markOnboarding, logout])

  if (guard !== 'ok') {
    return (
      <div className="aca-boot" aria-busy="true">
        <span className="route-spinner" aria-label="Cargando" />
      </div>
    )
  }

  const tabs = group?.tabs || {}
  const on = (k) => tabs[k] !== false
  const home = on('comunidad') ? 'comunidad' : 'cursos'
  const gate = (k, el) => (on(k) ? el : <Navigate to={r.path(home)} replace />)
  const bare = location.pathname.startsWith(r.path('/chat/'))

  let content
  if (!me) {
    content = status === 'error' ? (
      <div className="aca-boot-error">
        <PageState
          error={loadError || { message: 'No pudimos cargar la Academy.' }}
          errorTitle="No se pudo abrir la Academy"
          onRetry={() => { setStatus('loading'); loadMe() }}
        />
        <p className="aca-boot-alt">
          <Button variant="plain" size="sm" onClick={logout}>Cerrar sesión</Button>
        </p>
      </div>
    ) : (
      <PageState loading />
    )
  } else {
    content = (
      <RouteBoundary path={location.pathname}>
        <Suspense fallback={<PageState loading />}>
          <Routes>
            <Route index element={<Navigate to={home} replace />} />
            <Route path="comunidad" element={gate('comunidad', <ComunidadTab />)} />
            <Route path="comunidad/:postId" element={gate('comunidad', <ComunidadTab />)} />
            <Route path="cursos" element={<CursosTab />} />
            <Route path="cursos/:curso" element={<CursoPage />} />
            <Route path="cursos/:curso/:leccion" element={<LeccionPage />} />
            <Route path="calendario" element={gate('calendario', <CalendarioTab />)} />
            <Route path="miembros" element={<MiembrosTab />} />
            <Route path="clasificacion" element={gate('clasificacion', <ClasificacionTab />)} />
            <Route path="acerca" element={<AcercaTab />} />
            <Route path="perfil/:handle" element={<PerfilPage />} />
            <Route path="perfil" element={<Navigate to={me.handle ? r.profile(me.handle) : r.path(home)} replace />} />
            <Route path="ajustes" element={<AjustesPage />} />
            <Route path="reglas" element={<ReglasPage />} />
            <Route path="buscar" element={<BuscarPage />} />
            <Route path="chat/:id" element={<ChatPage />} />
            <Route path="grupos/:id" element={<GrupoPage />} />
            <Route path="*" element={<Navigate to={r.path(home)} replace />} />
          </Routes>
        </Suspense>
      </RouteBoundary>
    )
  }

  return (
    <AcademyContext.Provider value={value}>
      {status === 'ready' && <UnreadWatcher onData={applySync} />}
      <AcademyShell
        popover={popover}
        onPopover={setPopover}
        bare={bare}
        openChats={openChats}
        toasts={toasts}
        onDismissToast={dismissToast}
      >
        {content}
      </AcademyShell>
    </AcademyContext.Provider>
  )
}
