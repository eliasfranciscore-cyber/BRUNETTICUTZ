import { lazy } from 'react'
import { ACADEMY_BASE } from './hostConfig.js'

/* ============================================================
   ACADEMY — piezas del HOST con React (BrunettiCutz)

   Uno de los 4 archivos propios de cada repo (docs/academy/PORTABLE.md §2):
   `scripts/academy-sync.mjs` NUNCA lo copia. Los datos puros van en
   hostConfig.js; acá solo lo que necesita React o los datos del sitio.

     PublicLanding             la página pública de <base> (venta del curso)
     await buildSeedPayload()  cuerpo de admin-seed ("Cargar cursos iniciales")
     catalogHref(course)       a dónde manda "Comprar" un curso bloqueado

   Este archivo lo importa el router de la Academy (AcademyRoot) en TODAS sus
   páginas: nada pesado arriba. El temario (src/data/content/cursos.json) se
   carga recién dentro de buildSeedPayload(), que solo corre en el panel.
   ============================================================ */

// /cursos sin sesión: la página de venta de siempre (hero, temario y compra),
// ahora cobrando el curso de la Academy. PimpStudio: ../pages/Academy.jsx
export const PublicLanding = lazy(() => import('../pages/Cursos.jsx'))

/* "Comprar" de un curso bloqueado dentro de la app. Acá hay un solo curso a
   la venta y su formulario vive en la sección #inscripcion de la landing,
   así que cualquier curso manda ahí. Es navegación dura: la landing (/cursos)
   y la app (/cursos/…) tienen CSP distintos (SPEC §7.1). El parámetro queda
   por el contrato de PORTABLE.md §2 (PimpStudio sí lo usa). */
export function catalogHref(course) { // eslint-disable-line no-unused-vars
  return `${ACADEMY_BASE}#inscripcion`
}

/* ============================================================
   "Cargar cursos iniciales" → cuerpo de admin-seed.

   Un solo curso, solo online: el "Método Brunetti", con los 6 módulos y las
   21 lecciones del temario que ya se muestra en /cursos
   (src/data/content/cursos.json → curriculum.modules). Se lee de ese JSON y
   no de una copia para que el temario sembrado sea el mismo que el que se
   vende (y el editor visual lo puede cambiar). Cada módulo es una sección
   ("Módulo N · título") y cada lección queda en BORRADOR (sin video
   todavía: el backend crea todo con published:false y sales_open:false).

   La lección 1.3 era "Cómo usar Skool…": acá ya no es Skool, así que si el
   JSON todavía la trae con ese nombre se siembra como "Cómo usar la Academy
   en 3 minutos".

   Mismo slug que en PimpStudio ('brunetti-metodo'): el curso existe en los
   dos sitios y el mock de desarrollo lo usa de fixture.

   admin-seed es idempotente por slug: un curso que ya existe se salta
   entero, así que apretar dos veces no duplica nada. No se mandan
   `categories`: igual que PimpStudio, el backend pone las de por defecto si
   la comunidad todavía no tiene ninguna.

   buildSeedPayload() es async (carga cursos.json aparte): quien llama hace
   `await` (CursosSection lo pasa por Promise.resolve()).
   ============================================================ */

export const BRUNETTI_METODO = {
  slug: 'brunetti-metodo',
  title: 'Método Brunetti · Visagismo & Barbería',
  subtitle: 'De la consulta al cobro: el sistema de Bruno Brunetti',
  description:
    'Seis módulos para cortar con método y cobrar lo que vale tu trabajo: el protocolo antes de tomar la máquina, ' +
    'el sistema de fade, el orden del corte, tu marca personal y cómo subir tus precios sin perder clientes. ' +
    'Pago único, acceso de por vida.',
  // Portada: foto real del mismo origen (el CSP de la Academy solo deja
  // imágenes de /assets/). No el recorte del hero, que sin fondo se ve vacío
  // dentro de una tarjeta.
  coverUrl: '/assets/bruno-hero.jpg',
  // El precio con el que se vende hoy en /cursos (el `cursos_price` de
  // Ajustes, $16.990 desde septiembre de 2026). Viaja en el seed, pero el
  // curso nace sin publicar y con las ventas cerradas: se abre desde el panel.
  priceOnline: 16990,
}

const ACADEMY_HOWTO = 'Cómo usar la Academy en 3 minutos'

// La lección del tutorial de Skool pasa a ser la de la Academy.
function lessonTitle(raw) {
  const title = String(raw || '').trim()
  return /skool/i.test(title) ? ACADEMY_HOWTO : title
}

export function brunettiSeedCourse(modules) {
  return {
    slug: BRUNETTI_METODO.slug,
    title: BRUNETTI_METODO.title,
    subtitle: BRUNETTI_METODO.subtitle,
    description: BRUNETTI_METODO.description,
    coverUrl: BRUNETTI_METODO.coverUrl,
    priceOnline: BRUNETTI_METODO.priceOnline,
    pricePresencial: null,
    access: 'compra',
    sections: (modules || []).map((mod, i) => ({
      title: `Módulo ${i + 1} · ${String(mod?.t || '').trim()}`,
      lessons: (mod?.lessons || [])
        .map(lessonTitle)
        .filter(Boolean)
        .map((title) => ({ title })),
    })),
  }
}

// Cuerpo completo de admin-seed: { courses: [...] }.
export async function buildSeedPayload() {
  const mod = await import('../data/content/cursos.json')
  const cursos = mod?.default || mod
  return { courses: [brunettiSeedCourse(cursos?.curriculum?.modules)] }
}
