/* ACADEMY — configuración del HOST (BrunettiCutz)
   ------------------------------------------------------------------
   Uno de los 5 archivos propios de cada repo (docs/academy/PORTABLE.md §2):
   `scripts/academy-sync.mjs` NUNCA lo copia. Todo lo que cambia entre
   pimpstudio.cl/academy y brunetticutz.cl/cursos vive acá; el código
   compartido (src/academy/**, src/pages/academy/**, …) lo lee de este
   archivo en vez de escribir "/cursos" o "Brunetti" a mano.

   Datos puros: sin JSX, sin React y sin import.meta.env, porque lo importa
   también el mock de desarrollo desde Node (scripts/dev-mock/academy/host.mjs)
   y src/academy/url.js (que es espejo del servidor). */

// Ruta base de la Academy, sin barra final. Acá la Academy reemplaza a la
// comunidad de Skool: /cursos sigue siendo la página de venta y
// /cursos/<algo> es la app del miembro. PimpStudio: '/academy'.
export const ACADEMY_BASE = '/cursos'

// ¿Se muestra en la navegación del sitio y del panel? En BrunettiCutz la
// Academy es el producto que se vende en /cursos, así que va visible.
// (PimpStudio la tiene oculta por ahora: rutas vivas, sin enlaces.)
export const ACADEMY_VISIBLE = true

export const ACADEMY_BRAND = {
  name: 'Brunetti Academy',           // nombre del grupo por defecto (barra, título, login)
  short: 'Academy',
  initials: 'BA',                     // tile del grupo cuando no hay nombre ni iniciales
  color: '#1c1c1c',
  // El ícono de la PWA del sitio (mismo archivo que el manifest y los push):
  // mismo origen y bajo /assets/, que es lo que el CSP de la Academy permite.
  logo: '/assets/brunetti-logo-icon-192.png',
  siteName: 'Brunetti',
  siteUrl: 'https://brunetticutz.cl', // sin barra final ("Ir a brunetticutz.cl", .ics)
  // La cuenta del local (src/data.js → barbero 6). No hay una cuenta aparte
  // para la Academy como en PimpStudio.
  instagram: 'brunetticutz',
  groupUrlLabel: 'brunetticutz.cl/cursos',
}

// Destinos del sitio (fuera de la Academy: siempre navegación dura).
export const ACADEMY_LINKS = {
  home: '/',
  booking: '/reservar',
  panel: '/panel?tab=academy',        // "Abrir panel" del admin
}

// Compra de un curso: POST {kind:'course', …} y consulta de estado por ref.
// Acá no hay /api/checkout: el cobro de cursos entra por el mismo endpoint
// de Mercado Pago que ya usan Workshop y Essentials (cupo de 12 funciones
// del plan Hobby de Vercel), distinguido por `kind:'course'` y `ref=aca-…`.
export const CHECKOUT = {
  path: '/api/mp-payments',
  statusUrl: (ref) => `/api/mp-payments?status=1&ref=${encodeURIComponent(String(ref ?? ''))}`,
}
