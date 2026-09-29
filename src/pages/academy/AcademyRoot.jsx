import React, { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { hasSession, getMember } from '../../academy/session.js'
import { r } from '../../academy/routes.js'
import { PublicLanding } from '../../academy/host.jsx'

/* ============================================================
   <base>/* — reparte entre la página pública del host, las páginas de
   acceso y la app del miembro (SPEC §7.1). <base> es ACADEMY_BASE
   (hostConfig.js): /academy en PimpStudio, /cursos en BrunettiCutz. Cada
   una es su propio chunk: un visitante del catálogo no descarga la app, y
   un alumno no descarga el catálogo al abrir su comunidad.

     <base>                   página pública (host.jsx → PublicLanding; si
                              hay sesión, muestra "Entrar a la Academy" sin
                              redirigir)
     <base>/gracias?ref=      vuelta de Mercado Pago
     <base>/ingreso           correo + contraseña
     <base>/crear-contrasena  cambio obligatorio (token pwc)
     <base>/restablecer       enlace del correo (?token=)
     <base>/confirmar-correo  confirmación de correo nuevo (?token=)
     <base>/perfil            (viejo) → mi perfil o ingreso
     <base>/*                 app del miembro (AcademyApp, con su guardia)
   ============================================================ */

const AcademyApp = lazy(() => import('./AcademyApp.jsx'))
const Ingreso = lazy(() => import('./Ingreso.jsx'))
const CrearContrasena = lazy(() => import('./CrearContrasena.jsx'))
const Restablecer = lazy(() => import('./Restablecer.jsx'))
const ConfirmarCorreo = lazy(() => import('./ConfirmarCorreo.jsx'))
const Gracias = lazy(() => import('./Gracias.jsx'))

// Estilo en línea a propósito: este componente carga antes que app.css (que
// viaja con cada página) y el catálogo no necesita esa hoja.
function Fallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }} aria-busy="true">
      <span className="route-spinner" aria-label="Cargando" />
    </div>
  )
}

/* La vieja "Zona de alumnos" vivía en <base>/perfil (sesión por teléfono).
   Ahora el perfil es <base>/perfil/:handle y exige sesión de miembro. */
function LegacyPerfil() {
  if (!hasSession()) return <Navigate to={r.ingreso} replace />
  const m = getMember()
  return <Navigate to={m && m.handle ? r.profile(m.handle) : r.home} replace />
}

export default function AcademyRoot() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route index element={<PublicLanding />} />
        <Route path="gracias" element={<Gracias />} />
        <Route path="ingreso" element={<Ingreso />} />
        <Route path="crear-contrasena" element={<CrearContrasena />} />
        <Route path="restablecer" element={<Restablecer />} />
        <Route path="confirmar-correo" element={<ConfirmarCorreo />} />
        <Route path="perfil" element={<LegacyPerfil />} />
        <Route path="*" element={<AcademyApp />} />
      </Routes>
    </Suspense>
  )
}
