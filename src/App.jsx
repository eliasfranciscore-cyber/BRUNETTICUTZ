import React, { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import Home from './pages/Home.jsx'
import { ThemeProvider, FloatingThemeToggle } from './components/theme.jsx'
import EditProvider from './components/edit/EditProvider.jsx'
import OverridesProvider from './components/edit/OverridesProvider.jsx'
import { FEATURES } from './features.js'
import { ACADEMY_BASE } from './academy/hostConfig.js'
import { r as academyRoutes, isUnderBase as inAcademy } from './academy/routes.js'

// ── Ruteo de lanzamiento de la PWA instalada (iOS "Agregar a inicio") ──────
// iOS Safari ignora con frecuencia el start_url del manifest y abre la PWA en
// la última URL vista al instalarla (normalmente la landing "/"). Para que
// cada uno entre SIEMPRE directo a lo suyo, en modo standalone redirigimos el
// primer arranque: barbero con sesión → /panel; alumno de la Academy (sin
// sesión de barbero) → su comunidad; nadie → /ingreso.
// Sólo se aplica una vez por sesión de la app (sessionStorage), para no romper
// el botón "Ver web" ni la navegación interna posterior.
function launchTarget() {
  // El barbero va primero: Bruno suele ser las dos cosas (dueño de la Academy
  // y barbero), y su día a día es el panel.
  try {
    if (localStorage.getItem('ps_barber')) return '/panel'
    if (localStorage.getItem('ps_academy_token')) return academyRoutes.path('/comunidad')
  } catch {
    // storage bloqueado: login de barbero, como sin sesión
  }
  return '/ingreso'
}

function isStandaloneLaunch() {
  if (typeof window === 'undefined') return false
  return window.navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
}

function PWALaunchRouter() {
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => {
    if (!isStandaloneLaunch()) return
    if (sessionStorage.getItem('ps_pwa_routed') === '1') return
    sessionStorage.setItem('ps_pwa_routed', '1')
    const target = launchTarget()
    // Intervenimos si la app abre en la landing (caso del arranque iOS) o en
    // /panel sin sesión de barbero siendo alumno: el start_url del manifest es
    // /panel (Android sí lo respeta), y ahí un alumno caería en el login de
    // barberos. Con sesión de barbero, /panel queda tal cual.
    const atLanding = location.pathname === '/'
    const studentAtPanel = location.pathname === '/panel' && inAcademy(target)
    if (!atLanding && !studentAtPanel) return
    // La Academy (<base>/(.+)) tiene su propio CSP (más estricto): el CSP de un
    // documento queda fijo al cargarlo, así que se entra con navegación dura.
    if (inAcademy(target)) { window.location.replace(target); return }
    navigate(target, { replace: true })
  }, [])
  return null
}

// Code-splitting: la landing (Home) carga de inmediato; el resto se carga bajo
// demanda para que la primera pantalla sea más liviana y rápida.
const Login = lazy(() => import('./pages/Login.jsx'))
const Booking = lazy(() => import('./pages/Booking.jsx'))
const Account = lazy(() => import('./pages/Account.jsx'))
const BarberLogin = lazy(() => import('./pages/BarberLogin.jsx'))
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Workshop = lazy(() => import('./pages/Workshop.jsx'))
// Cursos: la página de venta (/cursos) + páginas de acceso + app del alumno de
// la Brunetti Academy, todo bajo ACADEMY_BASE/* (src/academy/hostConfig.js;
// ver src/pages/academy/AcademyRoot.jsx, cuyo índice es la vitrina compartida
// con pimpstudio.cl/academy, src/pages/academy/Vitrina.jsx, vía host.jsx). La landing y la app del miembro son chunks distintos: un
// visitante no descarga la app.
const AcademyRoot = lazy(() => import('./pages/academy/AcademyRoot.jsx'))
const EncuentraEstilo = lazy(() => import('./pages/EncuentraEstilo.jsx'))
const Essentials = lazy(() => import('./pages/Essentials.jsx'))
const EssentialsGracias = lazy(() => import('./pages/EssentialsGracias.jsx'))
const CardShare = lazy(() => import('./pages/CardShare.jsx'))
const Review = lazy(() => import('./pages/Review.jsx'))
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'))

function RouteFallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg, #080807)' }}>
      <span className="route-spinner" aria-label="Cargando" />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <OverridesProvider>
      <EditProvider>
        <div className="stage">
          <PWALaunchRouter />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/"         element={<Home />} />
              <Route path="/workshop" element={<Workshop />} />
              <Route path={`${ACADEMY_BASE}/*`} element={<AcademyRoot />} />
              <Route path="/style"    element={FEATURES.tuEstilo ? <EncuentraEstilo /> : <Navigate to="/" replace />} />
              <Route path="/essentials" element={<Essentials />} />
              <Route path="/essentials/gracias" element={<EssentialsGracias />} />
              <Route path="/encuentra-tu-estilo" element={<Navigate to={FEATURES.tuEstilo ? '/style' : '/'} replace />} />
              <Route path="/login"    element={<Login />} />
              <Route path="/reservar" element={<Booking />} />
              <Route path="/cuenta"   element={<Account />} />
              <Route path="/tarjeta"  element={<CardShare />} />
              {FEATURES.reviews && <Route path="/resena" element={<Review />} />}
              <Route path="/ingreso"  element={<BarberLogin />} />
              {FEATURES.passwordReset && <Route path="/restablecer" element={<ResetPassword />} />}
              <Route path="/panel"    element={<Dashboard />} />
              <Route path="*"         element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <FloatingThemeToggle />
        </div>
      </EditProvider>
      </OverridesProvider>
    </ThemeProvider>
  )
}
