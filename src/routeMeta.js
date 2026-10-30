/* BRUNETTI — Título, descripción y vista previa por ruta
   ------------------------------------------------------------------
   Una sola fuente para dos usos:

   1. En el build (vite.config.js, plugin `routeHtml`): por cada ruta de
      ROUTE_META se escribe dist/<ruta>.html, una copia de index.html con su
      propio <title>, description, canonical, og:* y twitter:*. vercel.json
      sirve /metodo → /metodo.html, etc. Es lo que leen WhatsApp, Instagram y
      Facebook al armar la vista previa de un enlace: esos robots no corren
      JavaScript, así que sin esto todas las rutas decían "Barbería Premium
      Maipú".
   2. En el navegador (src/App.jsx): al navegar dentro del SPA se aplica el
      título y la descripción de la ruta nueva (applyRouteMeta).

   Sin dependencias del navegador arriba: vite.config.js lo importa en Node. */

export const SITE_URL = 'https://brunetticutz.cl'

/* Lo que ya decía index.html (la barbería). */
export const DEFAULT_META = {
  title: 'Brunetti · Barbería Premium Maipú',
  description: 'Barbería premium en Maipú, Santiago. Reserva tu cita online con Bruno Herrera. Brunetti — visagismo y estilo masculino de excelencia.',
  ogTitle: 'Brunetti · Barbería Premium',
  ogDescription: 'Reserva tu cita en segundos. Visagismo, cortes y experiencia premium en Maipú, Santiago.',
  image: null,
}

export const ROUTE_META = {
  '/metodo': {
    title: 'Método Brunetti: el protocolo para cobrar más por el corte',
    description: 'Para barberos que ya cortan bien y siguen cobrando $12.000: el protocolo con que un corte pasa a valer $20.000, sin perder clientes. 6 módulos y 21 lecciones de Bruno «Brunetti» Herrera. Mira gratis el caso.',
    image: '/assets/og-metodo.jpg',
  },
  '/cursos': {
    title: 'Brunetti Academy · Cursos de barbería',
    description: 'Cursos de barbería de la Brunetti Academy: pago único con Mercado Pago, acceso de por vida a las lecciones y comunidad de alumnos.',
    image: null,
  },
  '/asesoria': {
    title: 'Asesoría de imagen masculina · Brunetti Image Studio',
    description: 'Diagnóstico de rostro, cráneo y cabello con Bruno «Brunetti» Herrera: tus cortes, tus productos y tu rutina en un informe personalizado. Presencial en Maipú u online.',
    image: '/assets/asesoria/og-asesoria.jpg',
  },
  '/workshop': {
    title: 'Workshop Contenido que Vende · para barberos',
    description: 'Una jornada intensiva para barberos que ya dominan la técnica: sube tu valor percibido, convierte Instagram en agenda real y aprende a grabar y editar desde el celular.',
    image: null,
  },
}

export function metaFor(path) {
  const p = String(path || '/').replace(/\/+$/, '') || '/'
  const m = ROUTE_META[p]
  if (!m) return { path: p, ...DEFAULT_META, own: false }
  return { path: p, title: m.title, description: m.description, ogTitle: m.title, ogDescription: m.description, image: m.image, own: true }
}

/* Navegador: título, descripción y canonical de la ruta. */
export function applyRouteMeta(path) {
  if (typeof document === 'undefined') return
  const m = metaFor(path)
  document.title = m.title
  document.querySelector('meta[name="description"]')?.setAttribute('content', m.description)
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', `${SITE_URL}${m.own ? m.path : '/'}`)
}
