import React, { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import Home from './pages/Home.jsx'
import { ThemeProvider, FloatingThemeToggle } from './components/theme.jsx'
import EditProvider from './components/edit/EditProvider.jsx'
import OverridesProvider from './components/edit/OverridesProvider.jsx'

// ── Ruteo de lanzamiento de la PWA instalada (iOS "Agregar a inicio") ──────
// iOS Safari ignora con frecuencia el start_url del manifest y abre la PWA en
// la última URL vista al instalarla (normalmente la landing "/"). Para que el
// barbero entre SIEMPRE directo a su acceso, en modo standalone redirigimos el
// primer arranque: si hay sesión válida → /panel, si no → /ingreso.
// Sólo se aplica una vez por sesión de la app (sessionStorage), para no romper
// el botón "Ver web" ni la navegación interna posterior.
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
    // Sólo intervenimos si la app abre en la landing (caso del arranque iOS).
    if (location.pathname !== '/') return
    const hasSession = !!localStorage.getItem('ps_barber')
    navigate(hasSession ? '/panel' : '/ingreso', { replace: true })
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
const Cursos = lazy(() => import('./pages/Cursos.jsx'))
const EncuentraEstilo = lazy(() => import('./pages/EncuentraEstilo.jsx'))
const Essentials = lazy(() => import('./pages/Essentials.jsx'))
const CardShare = lazy(() => import('./pages/CardShare.jsx'))

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
              <Route path="/cursos"   element={<Cursos />} />
              <Route path="/style"    element={<EncuentraEstilo />} />
              <Route path="/essentials" element={<Essentials />} />
              <Route path="/encuentra-tu-estilo" element={<Navigate to="/style" replace />} />
              <Route path="/login"    element={<Login />} />
              <Route path="/reservar" element={<Booking />} />
              <Route path="/cuenta"   element={<Account />} />
              <Route path="/tarjeta"  element={<CardShare />} />
              <Route path="/ingreso"  element={<BarberLogin />} />
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
