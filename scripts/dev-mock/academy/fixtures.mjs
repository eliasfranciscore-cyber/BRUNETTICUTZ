/* Datos en memoria del mock de Academy (SPEC §13). createState() arma un
   estado nuevo cada vez (al arrancar y en POST /api/__mock/reset).

   Forma: state.<tabla> = filas con EXACTAMENTE las columnas del DDL de
   SPEC §2 (snake_case), state.seq.<tabla> = último id, state.outbox = [].
   Ver el encabezado de lib.mjs para el resto (barbers, notifications, mock).

   Las fechas son RELATIVAS al momento de crear el estado (hace N días, en N
   días), así el calendario siempre tiene eventos próximos, el "En línea"
   tiene gente y las tablas de 7/30 días tienen actividad sin importar
   cuándo se levante el mock. El azar es de semilla fija: mismos datos en
   cada reinicio, salvo la hora.

   Lo propio de cada sitio sale de MOCK_HOST (./host.mjs): la marca
   (HOST.brand: nombre, dominio de los correos del staff, enlaces), el
   barbero del panel (HOST.barber) y los cursos (HOST.seedCourses()). Los
   slugs de demo que el host no traiga se rellenan con un curso genérico,
   así compras, grupos y progreso de abajo siempre cuadran.

   Cuentas de prueba (todas con la contraseña DEMO_PASSWORD = 'academy123'):
     HOST.barber.email        Bruno Herrera · propietario (también vía panel: owner-session)
                              (PimpStudio: bruno@pimpstudio.cl)
     valentina@<dominio>      admin      (<dominio> = HOST.brand.emailDomain)
     matias@<dominio>         moderador
     diego@demo.cl            miembro demo (Nivel 2): tiene 2 cursos, está en 2 grupos
     ignacio@demo.cl          recién comprado, debe crear contraseña: temporal K7QM-4RTX-9PWD
   El resto: <nombre>@demo.cl (ver MEMBERS). Kevin (expulsado) y Paula
   (cancelada por reembolso) no pueden entrar. */

import { nowIso, slugify, DEFAULT_SETTINGS, deepMerge, DAY, HOUR, MIN, sha256, zonedToUtc, santiagoDateKey, zonedParts, HOST } from './lib.mjs'

const B = HOST.brand

export const DEMO_PASSWORD = 'academy123'
export const OWNER_ID = 1
export const ADMIN_ID = 2
export const MOD_ID = 3
export const DEMO_MEMBER_ID = 4
export const BARBER_ID = HOST.barber?.id ?? 1
export const TEMP_MEMBER_ID = 27
export const TEMP_PASSWORD = { display: 'K7QM-4RTX-9PWD', canonical: 'K7QM4RTX9PWD' }
// Videos públicos y embebibles (SPEC §13), para que el reproductor funcione.
export const YT_IDS = ['dQw4w9WgXcQ', 'M7lc1UVf-VE', 'aqz-KE-bpKQ', 'ScMzIvxBSi4']
export const mockHash = (pw) => `mock$${pw}`

/* Método Brunetti: módulos y lecciones copiados de BrunettiCutz
   (src/data/content/cursos.json, "curriculum.modules"). Se copian y no se
   importan porque ese repo no tiene por qué estar clonado al lado. La
   lección "Cómo usar Skool" pasa a "la Academy": Skool es lo que esto
   reemplaza. */
export const BRUNETTI_MODULES = [
  { t: 'Bienvenida', lessons: ['Mi historia como barbero — por qué creé esto', 'Qué vas a lograr en esta comunidad', 'Cómo usar la Academy en 3 minutos'] },
  { t: 'El Protocolo Pre-Corte', lessons: ['El error que comete el 90% antes de cortar', 'Las 5 preguntas explicadas una por una', 'Las 5 preguntas en vivo con cliente real', 'Cómo el protocolo cambia lo que cobrás'] },
  { t: 'El Sistema de Fade', lessons: ['Cómo leer el cráneo antes de empezar', 'Low fade — paso a paso', 'Mid fade y high fade — las diferencias clave', 'Cómo borrar manchas y líneas duras'] },
  { t: 'El Orden del Corte', lessons: ['Por qué el orden importa más que la técnica', 'Secciones anatómicas: occipital, parietal y temporal', 'El mapa del cráneo — zonas y orden de trabajo'] },
  { t: 'Marca Personal', lessons: ['El barbero que no se ve no existe', 'Qué publicar en TikTok e Instagram como barbero', 'Cómo documentar un corte en 60 segundos'] },
  { t: 'Cómo Cobrar Más', lessons: ['Por qué los barberos cobran poco', 'El caso Brunetti — de $12.000 a $20.000', 'Cómo comunicar la subida sin perder clientes', 'Tu plan de los próximos 30 días'] },
]

// El curso que existe en los dos sitios: MOCK_HOST.seedCourses() lo recibe
// armado para ponerlo donde quiera (o dejarlo fuera).
export const METODO_BRUNETTI = Object.freeze({
  slug: 'brunetti-metodo', catalog_id: null, title: 'Método Brunetti · Visagismo & Barbería',
  subtitle: 'El sistema completo de Brunetti: del protocolo pre-corte a cobrar más.',
  description: 'Seis módulos grabados por Bruno: el protocolo pre-corte, el sistema de fade, el orden del corte, marca personal y cómo subir tus precios sin perder clientes. Pago único, acceso de por vida.',
  cover_url: '/assets/bruno-feature.jpg', sections: BRUNETTI_MODULES.map((mod) => ({ title: mod.t, lessons: mod.lessons })),
})

/* Slugs que usan las compras, grupos, progreso y comentarios de abajo. Los
   que MOCK_HOST.seedCourses() no traiga se rellenan con un curso genérico
   (5 clases × 5 lecciones) para que los fixtures no se rompan. */
const DEMO_SLUGS = {
  'brunetti-metodo': METODO_BRUNETTI.title,
  'barberia-basico': 'Barbería · Nivel Básico', 'barberia-finde': 'Barbería · 2 Fines de Semana',
  barba: 'Especialización en Barba', 'barberia-pro': 'Barbería · Nivel Pro',
  'tijeras-formas': 'Tijeras y Formas', 'color-fundamental': 'Colorimetría Fundamental',
}
const fillerCourse = (slug, title) => ({
  slug, catalog_id: null, title, subtitle: null, description: 'Curso de demostración del mock.', cover_url: null,
  sections: Array.from({ length: 5 }, (_, i) => ({ title: `Clase ${i + 1}`, lessons: Array.from({ length: 5 }, (_, j) => `${title} · Lección ${i + 1}.${j + 1}`) })),
})
// seedCourses() puede ser async: se resuelve una vez, al cargar.
const HOST_COURSES = (await HOST.seedCourses?.({ metodoBrunetti: METODO_BRUNETTI })) || [METODO_BRUNETTI]
const COURSE_DEFS = [
  ...HOST_COURSES,
  ...Object.entries(DEMO_SLUGS).filter(([slug]) => !HOST_COURSES.some((c) => c.slug === slug)).map(([slug, title]) => fillerCourse(slug, title)),
]

export const DEFAULT_CATEGORIES = [
  { name: 'Anuncios', emoji: '📣', write_role: 'admins' },
  { name: 'Preséntate', emoji: '👋', write_role: 'miembros' },
  { name: 'Preguntas', emoji: '❓', write_role: 'miembros' },
  { name: 'Logros', emoji: '🏆', write_role: 'miembros' },
  { name: 'Mis cortes', emoji: '✂️', write_role: 'miembros' },
  { name: 'Recursos', emoji: '📚', write_role: 'miembros' },
]

// Azar determinista (mulberry32): mismos datos en cada reinicio.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ── Miembros ───────────────────────────────────────────────────────────
   pts = puntos objetivo (likes recibidos) → reparte a los 9 niveles:
   0 · 5 · 20 · 65 · 155 · 515 … (LEVEL_THRESHOLDS). joined = hace N días. */
const MEMBERS = [
  { id: 1, name: 'Bruno Herrera', email: HOST.barber?.email || `bruno@${B.emailDomain}`, role: 'propietario', source: 'propietario', pts: 180, joined: 210, avatar: '/assets/avatars/barber-bruno.jpg', bio: `Fundador de ${B.siteName}. 12 años detrás de la silla y enseñando lo que aprendí a la mala.`, location: 'Santiago', links: { instagram: B.siteInstagram || B.instagram, web: B.siteUrl } },
  { id: 2, name: 'Valentina Soto', email: `valentina@${B.emailDomain}`, role: 'admin', source: 'invitacion', pts: 70, joined: 200, bio: 'Coordinación de Academy. Escríbeme por cualquier tema de pagos o accesos.', location: 'Santiago' },
  { id: 3, name: 'Matías Fuentes', email: `matias@${B.emailDomain}`, role: 'moderador', source: 'invitacion', pts: 90, joined: 190, avatar: '/assets/avatars/barber-matias.jpg', bio: `Barbero en ${B.siteName}. Modero la comunidad: si ves algo raro, repórtalo.`, location: 'Providencia' },
  { id: 4, name: 'Diego Muñoz', email: 'diego@demo.cl', pts: 12, joined: 34, bio: 'Aprendiendo a cortar en Valparaíso. Fan de los fades limpios.', location: 'Valparaíso', prefs: { onboarding: { dismissed: false, done: ['perfil'] } } },
  { id: 5, name: 'Camila Rojas', email: 'camila@demo.cl', pts: 210, joined: 150, bio: 'Barbera en Ñuñoa. Skin fades y diseños.', location: 'Ñuñoa', links: { instagram: 'https://instagram.com/camila.cuts' } },
  { id: 6, name: 'Joaquín Pérez', email: 'joaquin@demo.cl', pts: 160, joined: 140, bio: 'Barba y navaja. 5 años en el oficio.', location: 'Maipú' },
  { id: 7, name: 'Sofía Castillo', email: 'sofia@demo.cl', pts: 120, joined: 120, bio: 'Estilista pasándome a barbería.', location: 'La Florida' },
  { id: 8, name: 'Benjamín Torres', email: 'benjamin@demo.cl', pts: 95, joined: 110, location: 'Puente Alto' },
  { id: 9, name: 'Martina González', email: 'martina@demo.cl', pts: 70, joined: 100, bio: 'Tengo mi silla en un local de barrio y quiero profesionalizarme.', location: 'San Miguel' },
  { id: 10, name: 'Tomás Silva', email: 'tomas@demo.cl', pts: 48, joined: 90, location: 'Rancagua' },
  { id: 11, name: 'Isidora Morales', email: 'isidora@demo.cl', pts: 40, joined: 85, bio: '2 años cortando en Concepción.', location: 'Concepción' },
  { id: 12, name: 'Vicente Araya', email: 'vicente@demo.cl', pts: 33, joined: 80, avatar: '/assets/avatars/barber-vicente.jpg', location: 'Santiago Centro' },
  { id: 13, name: 'Florencia Díaz', email: 'florencia@demo.cl', pts: 25, joined: 70, location: 'Viña del Mar' },
  { id: 14, name: 'Agustín Reyes', email: 'agustin@demo.cl', pts: 21, joined: 66, location: 'Temuco' },
  { id: 15, name: 'Antonia Herrera', email: 'antonia@demo.cl', pts: 17, joined: 60, bio: 'Recién empezando 💈', location: 'Talca' },
  { id: 16, name: 'Maximiliano Vargas', email: 'maximiliano@demo.cl', pts: 11, joined: 55, avatar: '/assets/avatars/barber-maximo.jpg', location: 'Quilicura' },
  { id: 17, name: 'Catalina Espinoza', email: 'catalina@demo.cl', pts: 8, joined: 50, location: 'Temuco' },
  { id: 18, name: 'Lucas Contreras', email: 'lucas@demo.cl', pts: 6, joined: 45, location: 'Antofagasta' },
  { id: 19, name: 'Fernanda Núñez', email: 'fernanda@demo.cl', pts: 4, joined: 40, location: 'La Serena', prefs: { chat: { enabled: false } } },
  { id: 20, name: 'Rodrigo Pizarro', email: 'rodrigo@demo.cl', pts: 3, joined: 30, avatar: '/assets/avatars/barber-rodrigo.jpg', location: 'Puente Alto' },
  { id: 21, name: 'Javiera Sepúlveda', email: 'javiera@demo.cl', pts: 2, joined: 26, location: 'Iquique' },
  { id: 22, name: 'Cristóbal Jara', email: 'cristobal@demo.cl', pts: 1, joined: 22, location: 'Chillán' },
  { id: 23, name: 'Emilia Carrasco', email: 'emilia@demo.cl', pts: 0, joined: 18, location: 'Osorno', prefs: { privacy: { hideActivity: true, hideOnline: true } } },
  { id: 24, name: 'Alberto Mena', email: 'alberto@demo.cl', source: 'puente', pts: 26, joined: 75, avatar: '/assets/avatars/barber-alberto.jpg', bio: 'Llegué desde el curso de Brunetti en Skool.', location: 'Santiago' },
  { id: 25, name: 'Renata Olivares', email: 'renata@demo.cl', pts: 0, joined: 12, location: 'Arica' },
  { id: 26, name: 'Gaspar Tapia', email: 'gaspar@demo.cl', source: 'invitacion', pts: 0, joined: 1, location: 'Coquimbo' },
  { id: 27, name: 'Ignacio Vega', email: 'ignacio@demo.cl', pts: 0, joined: 0.1, temp: true },
  { id: 28, name: 'Kevin Rojas', email: 'kevin@demo.cl', status: 'expulsado', pts: 5, joined: 95 },
  { id: 29, name: 'Paula Fuentes', email: 'paula@demo.cl', status: 'cancelado', pts: 0, joined: 44 },
  { id: 30, name: 'Dreyk Salinas', email: 'dreyk@demo.cl', source: 'puente', pts: 60, joined: 72, avatar: '/assets/avatars/barber-dreyk.jpg', bio: 'Fader. Si no queda perfecto, no sale.', location: 'Pudahuel' },
]
// Siempre "En línea" (index.mjs les refresca last_sync_at en cada request).
const ALWAYS_ONLINE = [5, 9, 12, 30]

/* ── Cursos ─────────────────────────────────────────────────────────────
   Precios de DEMO (el catálogo real los tiene en null): así el checkout se
   puede probar punta a punta. Uno por nivel, uno abierto, dos borradores. */
const COURSE_CFG = {
  'brunetti-metodo': { published: true, access: 'compra', price_online: 97000, sales_open: true },
  'barberia-basico': { published: true, access: 'compra', price_online: 149000, price_presencial: 390000, sales_open: true },
  'barberia-finde': { published: true, access: 'compra', price_online: 149000, price_presencial: 350000, sales_open: true },
  barba: { published: true, access: 'nivel', unlock_level: 3, price_online: 89000, price_presencial: 290000, sales_open: true },
  'barberia-pro': { published: true, access: 'compra' },
  'tijeras-formas': { published: true, access: 'abierto' },
  'color-fundamental': { published: true, access: 'compra', price_online: 99000, sales_open: true },
  'color-profesional': { published: false, access: 'compra' },
  'cortes-mujer': { published: false, access: 'compra', price_online: 119000 },
}
const DEFAULT_COURSE_CFG = { published: false, access: 'compra' }
// El host puede ajustar un curso (BrunettiCutz vende el Método Brunetti a otro precio).
for (const [slug, over] of Object.entries(HOST.courseCfg || {})) COURSE_CFG[slug] = { ...(COURSE_CFG[slug] || DEFAULT_COURSE_CFG), ...over }

/* ── Comunidad ──────────────────────────────────────────────────────────
   cat = índice en DEFAULT_CATEGORIES (6 = categoría privada del Grupo 1).
   ago = hace cuántas horas. c = cantidad de comentarios de primer nivel. */
const POSTS = [
  { a: 1, cat: 0, pin: 3, ago: 24 * 60, c: 8, title: `Bienvenidos a ${B.name} 👋`, body: 'Esta es la casa de todos los que estamos aprendiendo (y enseñando) barbería.\n\nPara partir:\n1. Preséntate en 👋 Preséntate.\n2. Mira la primera lección de tu curso.\n3. Los miércoles a las 19:00 hacemos Q&A en vivo.\n\nCualquier duda con tu acceso, escríbele a @valentina-soto-2.' },
  { a: 1, cat: 0, pin: 2, ago: 24 * 40, c: 5, title: 'Q&A con Bruno todos los miércoles 19:00', body: 'Cada miércoles respondo en vivo las preguntas de la semana. Déjalas en ❓ Preguntas o tráelas a la llamada. El enlace está en Calendario.' },
  { a: 2, cat: 5, pin: 1, ago: 24 * 30, c: 4, title: 'Guía: cómo sacar buenas fotos de tus cortes', body: 'Luz natural de frente, fondo liso y tres ángulos: perfil, nuca y tres cuartos. Limpia los pelitos del cuello antes de la foto.\n\nAcá dos ejemplos de cómo se ve bien:', images: ['estilo-fade-clasico', 'estilo-crop-texturizado-oscuro'] },
  { a: 5, cat: 4, ago: 30, c: 7, title: 'Mi primer skin fade limpio 🔥', body: 'Después de mil intentos por fin me salió sin líneas. Usé 0 → 0.5 → 1 y terminé con la trimmer.', images: ['estilo-skin-fade'] },
  { a: 6, cat: 2, ago: 52, c: 6, title: '¿Qué máquina me recomiendan para empezar?', body: 'Tengo presupuesto para una sola máquina buena. ¿Con cuál partirían?', poll: ['Wahl Magic Clip', 'Babyliss FX', 'Andis Master', 'Otra (comenten)'] },
  { a: 4, cat: 1, ago: 24 * 33, c: 4, title: 'Hola! Soy Diego, de Valparaíso', body: 'Llevo 6 meses cortando a amigos y familia. Me uní por el Método Brunetti y quiero mejorar mis fades. ¡Saludos a todos!' },
  { a: 7, cat: 3, ago: 24 * 3, c: 5, title: 'Llegué a 30 clientes fijos 🙌', body: 'Hace tres meses tenía 8. Lo que más me ayudó fue el protocolo pre-corte y mandar recordatorio por WhatsApp el día antes.' },
  { a: 3, cat: 5, ago: 24 * 12, c: 3, title: 'Checklist de higiene y desinfección', body: `Entre cada cliente: peinetas al barbicida, cuchillas con spray, capa limpia y toalla nueva. La guía completa está en ${B.bookingUrl} (pregúntanos en el local).` },
  { a: 8, cat: 4, ago: 20, c: 4, title: 'Mid fade + diseño', body: 'Primer diseño a mano alzada. Críticas bienvenidas.', images: ['estilo-fade-diseno'] },
  { a: 1, cat: 0, ago: 24 * 6, c: 6, title: 'Nuevo módulo: Cómo cobrar más', body: 'Ya está disponible el módulo 6 del Método Brunetti. Cuento el caso real de cómo pasé de $12.000 a $20.000 por corte.', video: 'M7lc1UVf-VE' },
  { a: 9, cat: 2, ago: 24 * 2, c: 5, title: '¿Cómo manejan a los clientes que llegan tarde?', body: 'Tengo agenda cada 45 minutos y si alguien llega 15 tarde se me corre todo el día. ¿Qué política usan?' },
  { a: 10, cat: 4, ago: 10, c: 3, title: 'Crop texturizado — ¿feedback?', body: 'Siento que me quedó muy pesado arriba. ¿Qué harían distinto?', images: ['estilo-crop-texturizado'] },
  { a: 5, cat: 3, ago: 24 * 9, c: 6, title: 'Subí mis precios de $10.000 a $15.000 y no perdí a nadie', body: 'Seguí el módulo de Cómo Cobrar Más al pie de la letra. Avisé con dos semanas y expliqué qué incluye el servicio.' },
  { a: 11, cat: 1, ago: 24 * 20, c: 3, title: 'Isidora, Concepción, 2 años cortando', body: 'Hola comunidad, trabajo en un local en el centro de Conce. Quiero aprender colorimetría.' },
  { a: 12, cat: 2, ago: 24 * 5, c: 4, title: 'Navaja: ¿desechable o de hoja cambiable?', body: 'Pregunta de higiene y de costos.', poll: ['Desechable', 'Hoja cambiable', 'Depende del cliente'] },
  { a: 13, cat: 4, ago: 24 * 4, c: 3, title: 'Pompadour clásico para matrimonio', body: 'El novio quería algo clásico pero que aguantara todo el día. Cera mate y secador.', images: ['estilo-pompadour-clasico'] },
  { a: 6, cat: 5, ago: 24 * 15, c: 2, title: 'Lista de productos que uso en el mesón', body: 'Cera mate, pomada de brillo medio, polvo texturizador, aceite de barba y after shave sin alcohol. Nada de marcas caras para partir.' },
  { a: 14, cat: 2, ago: 26, c: 4, title: '¿Cómo borran las líneas en un low fade?', body: 'Siempre me queda una línea marcada entre la 0.5 y la 1.' },
  { a: 1, cat: 2, ago: 24 * 8, c: 5, title: 'Pregunta de la semana: ¿cuál es su corte más pedido?', body: 'Voten y comenten por qué creen que es.', poll: ['Low fade', 'Mid fade', 'Crop texturizado', 'Mullet'] },
  { a: 15, cat: 1, ago: 24 * 11, c: 3, title: 'Antonia, recién empezando 💈', body: 'Me inscribí en el Básico online. ¿Algún consejo para practicar sin modelos?' },
  { a: 24, cat: 4, ago: 24 * 7, c: 2, title: 'Barba canosa: perfilado y color', body: 'Pigmento suave para no dejarla plana.', images: ['estilo-barba-canosa'] },
  { a: 30, cat: 3, ago: 24 * 13, c: 6, title: 'Abrí mi propia barbería 🎉', body: 'Después de 3 años arrendando silla, hoy abrí mi local en Pudahuel. Gracias a todos por los consejos.' },
  { a: 7, cat: 4, ago: 24 * 16, c: 3, title: 'Mullet rizado — antes y después', body: 'Rizos naturales, solo tijera arriba.', images: ['estilo-mullet-rizado', 'estilo-mullet-shag'] },
  { a: 16, cat: 2, ago: 24 * 18, c: 4, title: '¿Cuánto cobran por corte + barba?', body: 'Estoy en Quilicura y no sé si estoy muy barato.' },
  { a: 3, cat: 5, ago: 24 * 22, c: 2, title: 'Glosario de términos de barbería', body: 'Fade, taper, blowout, tomada in/out, línea de contorno… armé un glosario para los que recién parten. Pregunten los que falten.' },
  { a: 17, cat: 1, ago: 24 * 25, c: 2, title: 'Catalina desde Temuco', body: '¡Hola! Vengo por el curso de Barbería de fin de semana.' },
  { a: 9, cat: 4, ago: 24 * 10, c: 2, title: 'Side part ejecutivo', body: 'Para un cliente de oficina. Raya marcada con navaja.', images: ['estilo-side-part'] },
  { a: 1, cat: 6, ago: 24 * 5, c: 3, title: 'Generación Octubre: materiales para el día 1', body: 'Traigan su máquina, peinetas y capa. Nosotros ponemos los modelos. Nos vemos en el estudio.' },
  { a: 5, cat: 6, ago: 30, c: 2, title: '¿Alguien para practicar el sábado?', body: 'Busco compañero de la generación para practicar fades antes del día 1.' },
  { a: 18, cat: 2, ago: 24 * 14, c: 3, title: '¿Sirve el curso online si nunca he cortado?', body: 'Nunca he tomado una máquina. ¿Parto por el Básico o por el Método Brunetti?' },
  { a: 8, cat: 2, ago: 24 * 19, c: 3, locked: true, title: 'Sorteo de máquina (cerrado)', body: 'Gracias a todos los que participaron. El ganador ya fue contactado por chat.' },
  { a: 28, cat: 4, ago: 24 * 9, c: 0, deleted: true, title: 'VENDO SEGUIDORES BARATOS', body: 'Escríbeme por interno.' },
  { a: 10, cat: 3, ago: 24 * 2.5, c: 3, title: 'Mi primer cliente pagado', body: 'Lo grabé para no olvidarlo nunca.', video: 'aqz-KE-bpKQ' },
]

const COMMENT_POOL = [
  '¡Qué buen trabajo! 🔥', 'Muy limpio ese degradado', '¿Qué número de peineta usaste?', 'Gracias por compartir, me sirve harto',
  'Yo uso la Magic Clip y me va bien', 'Totalmente de acuerdo', 'Brutal la terminación', '¿Cuánto te demoraste?',
  'Me pasa lo mismo con los clientes nuevos', 'Buena pregunta, yo también quiero saber', 'Excelente aporte 🙌',
  'Eso lo vimos en la clase 3 del Básico', 'Prueba con la tomada in/out', 'Se nota la práctica, sigue así',
  'Yo cobro $15.000 en Ñuñoa y me va bien', 'La clave está en la luz natural para la foto', '¡Bienvenida/o! Pregunta nomás',
  'Qué bacán, felicidades 🎉', 'Me encantó el diseño', '¿Tienes foto del antes?', 'Guardado para verlo con calma',
  'A mí me sirvió practicar con cabezas de maniquí', 'Yo cobro un 20% más por la barba', 'Con la 0.5 a contrapelo se arregla',
]
const REPLY_POOL = [
  '¡Gracias! Usé la 1.5 y después a mano alzada', 'Jaja sí, a todos nos pasa', 'Te escribo por chat', 'Buena, lo voy a probar',
  'Exacto, eso mismo', 'Gracias por el dato 🙏', 'Uff sí, me costó harto', 'Lo vemos el miércoles en el Q&A',
]
const OWNER_POOL = [
  'Muy bien. Fíjate en la transición de la zona parietal.', 'Esto lo vemos el miércoles en el Q&A.', 'Excelente, así se hace 💈',
  'Ojo con la luz: se ven los escalones. Repasa la lección de manchas y líneas duras.', 'Me encanta ver este progreso.',
]

// Chats: mensajes [autor, texto, hace cuántos minutos]
const COHORTS = [
  {
    name: 'Generación Octubre 2026', course: 'barberia-basico', startsIn: 9, seats: 7, sales_open: true,
    description: 'Presencial en el estudio · lunes, miércoles y viernes de 9 a 12.', cover: '/assets/estilo/estilo-fade-clasico.jpg',
    members: [4, 5, 10, 13, 16, 20],
    messages: [[1, '¡Bienvenidos a la Generación Octubre! Acá vamos a coordinar todo.', 60 * 24 * 6], [5, '¡Hola a todos! 👋', 60 * 24 * 6 - 30], [10, 'Hola! ¿A qué hora llegamos el primer día?', 60 * 24 * 5], [1, '8:45 para instalar todo. Partimos 9:00 en punto.', 60 * 24 * 5 - 20], [13, 'Perfecto, gracias', 60 * 24 * 5 - 15], [4, '¿Hay estacionamiento cerca?', 60 * 26], [16, 'Hay uno en la esquina, $2.000 la mañana', 60 * 25], [5, 'Yo me voy en metro, si alguien quiere nos juntamos en la estación', 90], [20, 'Me sumo!', 45]],
  },
  {
    name: 'Generación Barba · Septiembre 2026', course: 'barba', startsIn: -21, seats: 7, sales_open: false,
    description: 'Especialización en barba presencial · 3 semanas.', cover: '/assets/estilo/estilo-textura-barba.jpg',
    members: [6, 7, 9, 11],
    messages: [[1, 'Recuerden traer navaja propia la próxima clase.', 60 * 24 * 10], [7, 'Listo!', 60 * 24 * 10 - 5], [9, '¿Alguien tiene el PDF de la clase 2?', 60 * 24 * 3], [6, 'Está en la lección, abajo del video', 60 * 24 * 3 - 12], [9, 'Gracias 🙏', 60 * 24 * 3 - 10]],
  },
  {
    name: 'Método Brunetti · Comunidad', course: 'brunetti-metodo', startsIn: null, seats: null, sales_open: false,
    description: 'Todos los que compraron el Método Brunetti.', cover: '/assets/bruno-portrait.jpg',
    members: [4, 5, 6, 8, 12, 14, 24, 30, 2],
    messages: [[1, 'Este es el grupo del Método. Suban acá sus dudas de cada módulo.', 60 * 24 * 20], [24, 'Vengo desde Skool, ¡qué bueno que ahora está todo acá!', 60 * 24 * 19], [30, 'El módulo del fade me cambió la vida jaja', 60 * 24 * 2], [8, '¿Cuándo sale el próximo en vivo?', 60 * 5], [2, 'Este miércoles 19:00, en Calendario está el enlace', 60 * 4], [12, 'Ahí estaré', 20]],
  },
]
const DMS = [
  { a: 1, b: 4, messages: [[1, `¡Hola Diego! Bienvenido a ${B.name}. Cualquier duda, escríbeme por acá.`, 60 * 24 * 34], [4, '¡Gracias Bruno! Feliz de estar acá', 60 * 24 * 34 - 60], [4, 'Una consulta: ¿el Método Brunetti tiene certificado?', 60 * 24 * 2], [1, 'Sí, al completar todas las lecciones te llega por correo.', 60 * 24 * 2 - 30]], readA: 'all', readB: 'all' },
  { a: 4, b: 5, messages: [[5, 'Hola! Vi tu post de presentación, yo también partí cortando a amigos', 60 * 24 * 30], [4, 'Hola Camila! Qué bueno, ¿cómo practicabas los fades?', 60 * 24 * 30 - 10], [5, 'Con cabezas de maniquí y mucha paciencia jaja', 60 * 24 * 29], [5, '¿Vas a ir el sábado a practicar?', 50], [5, 'Somos 3 por ahora', 48]], readA: 2, readB: 'all' },
  { a: 5, b: 6, messages: [[6, 'Oye, ¿me pasas el dato de la barbería donde arriendas silla?', 60 * 24 * 7], [5, 'Te lo mando por WhatsApp mejor', 60 * 24 * 7 - 5]], readA: 'all', readB: 'all' },
  { a: 1, b: 7, messages: [[1, '¡Felicitaciones por los 30 clientes! ¿Te puedo usar de ejemplo en el Q&A?', 60 * 24 * 2], [7, '¡Claro que sí! 🙌', 60 * 24 * 2 - 90]], readA: 'all', readB: 'all' },
  { a: 3, b: 12, messages: [[12, 'Kevin me está mandando spam por interno', 60 * 24 * 8], [3, 'Gracias por avisar, ya lo revisamos con Bruno.', 60 * 24 * 8 - 40]], readA: 'all', readB: 'all' },
]

const IMG = (name) => ({ kind: 'image', url: `/assets/estilo/${name}.jpg`, w: /barba-canosa|mullet-rizado|skin-fade|textura-barba/.test(name) ? 1050 : 933, h: 1400 })

/* ── Estado ───────────────────────────────────────────────────────────── */
export function createState() {
  const T0 = Date.now()
  const at = (msAgo) => nowIso(new Date(T0 - msAgo))
  const inDays = (d) => nowIso(new Date(T0 + d * DAY))
  const r = rng(20260928)
  const pick = (arr) => arr[Math.floor(r() * arr.length)]
  const between = (fromIso, toIso = at(0), bias = 1) => {
    const a = Date.parse(fromIso); const b = Date.parse(toIso)
    return nowIso(new Date(a + (b - a) * (r() ** bias)))
  }

  const state = {
    seq: {}, outbox: [],
    barbers: [{ id: BARBER_ID, name: HOST.barber?.name || 'Bruno Herrera', code: HOST.barber?.code || 'bruno-herrera', email: HOST.barber?.email || null, admin: true, role: HOST.barber?.role || 'Barbero', tier: HOST.barber?.tier || null }],
    notifications: [],
    academy_settings: [], academy_members: [], academy_auth_tokens: [], academy_courses: [], academy_sections: [],
    academy_lessons: [], academy_lesson_progress: [], academy_cohorts: [], academy_cohort_members: [], academy_orders: [],
    academy_grants: [], academy_categories: [], academy_posts: [], academy_comments: [], academy_likes: [],
    academy_poll_votes: [], academy_follows: [], academy_post_reads: [], academy_reports: [], academy_notifications: [],
    academy_chats: [], academy_chat_members: [], academy_messages: [], academy_blocks: [], academy_events: [],
    academy_event_reminders: [], academy_push_subscriptions: [], academy_uploads: [], academy_email_log: [],
    mock: { sessions: new Map(), loginFails: {}, blobs: new Map(), rate: {}, mpPayments: {}, alwaysOnline: [...ALWAYS_ONLINE] },
  }
  const id = (table) => { state.seq[table] = (state.seq[table] || 0) + 1; return state.seq[table] }

  /* Ajustes del grupo */
  state.academy_settings.push({
    id: 1, updated_at: at(10 * DAY),
    settings: deepMerge(DEFAULT_SETTINGS, {
      group: {
        description: `La comunidad de ${B.siteName} para aprender barbería de verdad: cursos grabados, clases en vivo cada semana y una comunidad de barberos que se ayudan entre sí.\n\nPagas una vez y el acceso es de por vida.`,
        coverUrl: B.cover || '/assets/bruno-hero-bg.jpg', iconUrl: B.logo,
        links: [...HOST.defaultLinks.map((l) => ({ ...l })), ...(B.instagram ? [{ title: 'Instagram de Academy', url: B.instagram }] : [])],
        rules: [
          { title: 'Respeto ante todo', body: 'Críticas al corte, nunca a la persona.' },
          { title: 'Nada de spam ni ventas', body: 'Ofertas y promociones solo con permiso de un admin.' },
          { title: 'Comparte tu trabajo', body: 'Sube fotos de tus cortes en ✂️ Mis cortes: así se aprende.' },
          { title: 'Pregunta sin miedo', body: 'No hay preguntas tontas en ❓ Preguntas.' },
        ],
        media: [
          { kind: 'image', url: '/assets/bruno-portrait.jpg' }, { kind: 'youtube', videoId: 'M7lc1UVf-VE' },
          { kind: 'image', url: '/assets/gallery-1.jpg' }, { kind: 'image', url: '/assets/gallery-2.jpg' }, { kind: 'image', url: '/assets/gallery-3.jpg' },
        ],
      },
      plugins: { welcomeVideoId: 'M7lc1UVf-VE' },
    }),
  })

  /* Miembros */
  for (const m of MEMBERS) {
    const joinedAt = at(m.joined * DAY)
    const status = m.status || 'activo'
    const row = {
      id: m.id, email_norm: m.email.toLowerCase(), email: m.email, name: m.name,
      handle: `${slugify(m.name) || 'miembro'}-${m.id}`, phone: m.id % 3 === 0 ? null : `9${String(81234560 + m.id).slice(-8)}`,
      user_id: null, bio: m.bio || null, location: m.location || null, links: m.links || {}, avatar_url: m.avatar || null,
      role: m.role || 'miembro', status, source: m.source || 'pago',
      password_hash: mockHash(DEMO_PASSWORD), password_set_at: nowIso(new Date(Date.parse(joinedAt) + HOUR)),
      must_change_password: false, temp_password_expires_at: null, session_version: 0,
      credentials_claimed_at: nowIso(new Date(Date.parse(joinedAt) + MIN)), credentials_sent_at: nowIso(new Date(Date.parse(joinedAt) + MIN)),
      credentials_attempts: 1, credentials_retry_at: null,
      last_login_at: at(Math.min(m.joined * DAY, (1 + (m.id % 9)) * 7 * HOUR)),
      last_seen_at: at(Math.min(m.joined * DAY, (m.id % 7) * 5 * HOUR + 20 * MIN)),
      last_sync_at: ALWAYS_ONLINE.includes(m.id) ? at(10_000) : null,
      activity_email_at: null, barber_id: m.id === OWNER_ID ? BARBER_ID : null, granted_by: m.source === 'invitacion' ? OWNER_ID : null,
      prefs: m.prefs || {}, joined_at: joinedAt,
      banned_at: status === 'expulsado' ? at(9 * DAY) : null, deleted_at: null,
      created_at: joinedAt, updated_at: joinedAt,
    }
    if (m.role === 'propietario' || m.source === 'invitacion') row.credentials_attempts = m.role === 'propietario' ? 0 : 1
    if (m.role === 'propietario') { row.credentials_claimed_at = null; row.credentials_sent_at = null }
    if (m.temp) {
      Object.assign(row, {
        password_hash: mockHash(TEMP_PASSWORD.canonical), password_set_at: null, must_change_password: true,
        temp_password_expires_at: inDays(3), last_login_at: null, last_seen_at: null,
      })
    }
    state.academy_members.push(row)
  }
  state.seq.academy_members = MEMBERS.length
  const member = (mid) => state.academy_members.find((x) => x.id === mid)
  const activeIds = state.academy_members.filter((x) => x.status === 'activo' && x.id !== TEMP_MEMBER_ID).map((x) => x.id)

  /* Cursos, secciones y lecciones */
  const courseDefs = COURSE_DEFS
  let videoIdx = 0
  courseDefs.forEach((def, pos) => {
    const cfg = { ...DEFAULT_COURSE_CFG, ...(COURSE_CFG[def.slug] || {}) }
    const courseId = id('academy_courses')
    const created = at((200 - pos * 5) * DAY)
    state.academy_courses.push({
      id: courseId, slug: def.slug, catalog_id: def.catalog_id, title: def.title, subtitle: def.subtitle, description: def.description,
      cover_url: def.cover_url, position: pos, published: cfg.published, access: cfg.access, unlock_level: cfg.unlock_level ?? null,
      price_online: cfg.price_online ?? null, price_presencial: cfg.price_presencial ?? null, sales_open: Boolean(cfg.sales_open),
      created_at: created, updated_at: created,
    })
    const total = def.sections.reduce((n, s) => n + s.lessons.length, 0)
    // En los cursos publicados, el último ~20% de las lecciones queda en
    // borrador (así el staff ve borradores y los miembros no).
    const publishUpTo = cfg.published ? Math.ceil(total * (def.slug === 'brunetti-metodo' ? 0.91 : 0.8)) : 0
    let n = 0
    def.sections.forEach((sec, si) => {
      const sectionId = id('academy_sections')
      state.academy_sections.push({ id: sectionId, course_id: courseId, title: sec.title, position: si, created_at: created })
      const used = new Set(state.academy_lessons.filter((l) => l.course_id === courseId).map((l) => l.slug))
      sec.lessons.forEach((title, li) => {
        let slug = slugify(title) || `leccion-${n + 1}`
        for (let k = 2; used.has(slug); k++) slug = `${slugify(title).slice(0, 36)}-${k}`
        used.add(slug)
        const textOnly = li === 1 && si === 1 // una lección de solo texto por curso
        const published = n < publishUpTo
        state.academy_lessons.push({
          id: id('academy_lessons'), course_id: courseId, section_id: sectionId, slug, title: String(title).slice(0, 160), position: li,
          video_provider: 'youtube', video_id: textOnly ? null : YT_IDS[videoIdx++ % YT_IDS.length],
          duration_sec: textOnly ? null : 180 + ((n * 137) % 1200),
          body: textOnly
            ? `${title}.\n\nEsta lección es de lectura: repasa los puntos clave antes de la próxima clase práctica.\n\n• Observa antes de cortar.\n• Trabaja por secciones.\n• Revisa con luz natural.`
            : `En esta lección vemos: ${String(title).toLowerCase()}.\n\nMira el video completo y deja tus dudas en los comentarios. Si algo no queda claro, tráelo al Q&A del miércoles.`,
          resources: li === 0 ? [{ title: 'Reserva una práctica con modelo', url: B.bookingUrl }, { title: 'Hoja de referencia', url: '/assets/visagismo-paso-1.jpg' }] : [],
          published, created_at: created, updated_at: created,
        })
        n++
      })
    })
  })
  const courseBy = (slug) => state.academy_courses.find((c) => c.slug === slug)
  const lessonsOf = (slug) => {
    const c = courseBy(slug)
    const secPos = new Map(state.academy_sections.filter((s) => s.course_id === c.id).map((s) => [s.id, s.position]))
    return state.academy_lessons.filter((l) => l.course_id === c.id && l.published)
      .sort((x, y) => (secPos.get(x.section_id) - secPos.get(y.section_id)) || (x.position - y.position))
  }

  /* Grupos (cohortes) con su chat */
  const cohortIds = []
  COHORTS.forEach((co) => {
    const cohortId = id('academy_cohorts')
    const chatId = id('academy_chats')
    cohortIds.push(cohortId)
    const startsOn = co.startsIn == null ? null : santiagoDateKey(new Date(T0 + co.startsIn * DAY))
    state.academy_cohorts.push({
      id: cohortId, name: co.name, description: co.description, cover_url: co.cover, course_id: courseBy(co.course).id,
      starts_on: startsOn, seats: co.seats, sales_open: co.sales_open, chat_id: chatId, archived_at: null, created_by: OWNER_ID,
      created_at: at(30 * DAY), updated_at: at(30 * DAY),
    })
    state.academy_chats.push({ id: chatId, kind: 'grupo', dm_key: null, cohort_id: cohortId, name: co.name, last_message_id: null, last_message_at: null, created_at: at(30 * DAY) })
    for (const mid of [OWNER_ID, ...co.members]) {
      state.academy_cohort_members.push({ cohort_id: cohortId, member_id: mid, added_at: at(Math.min(29, member(mid).id % 20 + 5) * DAY) })
    }
    addMessages(chatId, co.messages, [OWNER_ID, ...co.members], { unreadFor: { [DEMO_MEMBER_ID]: 2 } })
  })

  /* Mensajes directos */
  for (const dm of DMS) {
    const chatId = id('academy_chats')
    const [x, y] = [Math.min(dm.a, dm.b), Math.max(dm.a, dm.b)]
    state.academy_chats.push({ id: chatId, kind: 'directo', dm_key: `${x}:${y}`, cohort_id: null, name: null, last_message_id: null, last_message_at: null, created_at: at(dm.messages[0][2] * MIN + MIN) })
    const unreadFor = {}
    if (dm.readA !== 'all') unreadFor[dm.a] = dm.readA
    if (dm.readB !== 'all') unreadFor[dm.b] = dm.readB
    addMessages(chatId, dm.messages, [dm.a, dm.b], { unreadFor })
  }

  // unreadFor[memberId] = cuántos de los últimos mensajes quedan sin leer.
  function addMessages(chatId, list, memberIds, { unreadFor = {} } = {}) {
    const chat = state.academy_chats.find((c) => c.id === chatId)
    const rows = list.map(([author, body, minAgo]) => {
      const row = { id: id('academy_messages'), chat_id: chatId, author_id: author, body, attachments: [], created_at: at(minAgo * MIN), deleted_at: null }
      state.academy_messages.push(row)
      return row
    })
    const last = rows[rows.length - 1]
    chat.last_message_id = last?.id ?? null
    chat.last_message_at = last?.created_at ?? null
    for (const mid of memberIds) {
      const unread = unreadFor[mid] || 0
      const readable = rows.filter((m) => m.author_id !== mid)
      const lastRead = unread ? (rows[rows.length - 1 - unread]?.id ?? 0) : (last?.id ?? 0)
      state.academy_chat_members.push({
        chat_id: chatId, member_id: mid, last_read_message_id: readable.length ? lastRead : (last?.id ?? 0),
        muted: false, marked_unread: false, joined_at: chat.created_at,
      })
    }
  }

  /* Pedidos y accesos: cada miembro que no es staff tiene al menos un curso. */
  const refFor = (n) => `aca-${sha256(`orden-${n}`).slice(0, 32)}`
  let orderN = 0
  const addOrder = ({ memberId, slug, modality = 'online', cohortId = null, status = 'pagada', daysAgo, payerEmail, name, email, amount }) => {
    const c = courseBy(slug)
    const mem = memberId ? member(memberId) : null
    const price = amount ?? (modality === 'presencial' ? c.price_presencial : c.price_online) ?? 97000
    const created = at(daysAgo * DAY + 3 * MIN)
    const paid = ['pagada', 'reembolsada', 'revision'].includes(status)
    const row = {
      id: id('academy_orders'), public_ref: refFor(++orderN), course_id: c.id, cohort_id: cohortId, modality, title_snapshot: c.title,
      amount: price, name: mem?.name || name, email: mem?.email || email, email_norm: (mem?.email || email).toLowerCase(), phone: mem?.phone || null,
      user_id: null, status, mp_preference_id: paid || status === 'pendiente' ? `mock-pref-${orderN}` : null,
      mp_payment_id: paid ? String(1320000000 + orderN) : null, mp_last_status: paid ? (status === 'reembolsada' ? 'refunded' : 'approved') : (status === 'pendiente' ? null : 'cancelled'),
      mp_payer_email: paid ? (payerEmail || mem?.email || email) : null, live_mode: paid ? false : null,
      paid_at: paid ? at(daysAgo * DAY) : null, paid_amount: paid ? (status === 'revision' ? price - 10000 : price) : null,
      refunded_at: status === 'reembolsada' ? at((daysAgo - 2) * DAY) : null, refund_reason: status === 'reembolsada' ? 'Reembolso solicitado por la clienta' : null,
      created_at: created, updated_at: paid ? at(daysAgo * DAY) : created,
    }
    state.academy_orders.push(row)
    return row
  }
  const addGrant = ({ memberId, slug, order = null, source = 'pago', stateName = 'activa', externalRef = null, daysAgo, reason = null }) => {
    const c = courseBy(slug)
    const when = at(daysAgo * DAY)
    const row = {
      id: id('academy_grants'), member_id: memberId, course_id: c.id, order_id: order?.id ?? null, external_ref: externalRef, source, state: stateName,
      notified_at: when, revoked_at: stateName === 'revocada' ? at(Math.max(0, daysAgo - 2) * DAY) : null,
      revoke_reason: stateName === 'revocada' ? (reason || 'reembolso') : null,
      granted_by: source === 'pago' ? null : OWNER_ID, created_at: when, updated_at: when,
    }
    state.academy_grants.push(row)
    return row
  }
  const joinedDays = (mid) => MEMBERS.find((m) => m.id === mid).joined
  const buy = (mid, slug, opts = {}) => {
    const daysAgo = opts.daysAgo ?? joinedDays(mid)
    const order = addOrder({ memberId: mid, slug, daysAgo, ...opts })
    return addGrant({ memberId: mid, slug, order, daysAgo, stateName: opts.grantState || 'activa', reason: opts.reason })
  }
  // Demo: dos cursos (uno online y el presencial de su generación).
  buy(DEMO_MEMBER_ID, 'brunetti-metodo')
  buy(DEMO_MEMBER_ID, 'barberia-basico', { modality: 'presencial', cohortId: cohortIds[0], daysAgo: 20 })
  for (const mid of [5, 10, 13, 16, 20]) buy(mid, 'barberia-basico', { modality: 'presencial', cohortId: cohortIds[0] })
  for (const mid of [6, 7, 9, 11]) buy(mid, 'barba', { modality: 'presencial', cohortId: cohortIds[1] })
  for (const mid of [5, 6, 8, 12, 14]) buy(mid, 'brunetti-metodo', { daysAgo: Math.max(1, joinedDays(mid) - 3), payerEmail: mid === 8 ? 'pagos.benja@gmail.com' : undefined })
  // Compradores de BrunettiCutz importados por el puente (external_ref).
  addGrant({ memberId: 24, slug: 'brunetti-metodo', source: 'puente', externalRef: 'brunetti:mp:880001', daysAgo: 75 })
  addGrant({ memberId: 30, slug: 'brunetti-metodo', source: 'puente', externalRef: 'brunetti:mp:880002', daysAgo: 72 })
  buy(30, 'barberia-pro', { daysAgo: 40, amount: 180000 })
  for (const [mid, slug] of [[15, 'barberia-basico'], [17, 'barberia-finde'], [18, 'barberia-basico'], [19, 'color-fundamental'], [21, 'barberia-finde'], [22, 'barberia-basico'], [23, 'color-fundamental'], [25, 'barberia-basico'], [8, 'barberia-basico'], [12, 'color-fundamental']]) buy(mid, slug)
  addGrant({ memberId: 26, slug: 'barberia-basico', source: 'invitacion', daysAgo: 1 })
  buy(TEMP_MEMBER_ID, 'brunetti-metodo', { daysAgo: 0.1 })
  buy(28, 'barberia-basico', { grantState: 'revocada', reason: 'manual: expulsado por spam' })
  buy(29, 'barberia-finde', { status: 'reembolsada', grantState: 'revocada', daysAgo: 44 })
  // Otros estados para la tabla de Pedidos del panel.
  addOrder({ slug: 'barberia-finde', status: 'pendiente', daysAgo: 10 / (24 * 60), name: 'Pedro Soto', email: 'pedro@demo.cl' })
  addOrder({ slug: 'color-fundamental', status: 'anulada', daysAgo: 5, name: 'Marcela Ruiz', email: 'marcela@demo.cl' })
  const rev = addOrder({ slug: 'brunetti-metodo', status: 'revision', daysAgo: 3, name: 'Hernán Vidal', email: 'hernan@demo.cl' })
  rev.live_mode = false

  /* Progreso de lecciones */
  const progress = (mid, slug, done, { inProgress = 0 } = {}) => {
    const list = lessonsOf(slug)
    list.slice(0, done).forEach((l, i) => {
      const t = at((done - i) * 1.3 * DAY)
      state.academy_lesson_progress.push({ member_id: mid, lesson_id: l.id, position_sec: l.duration_sec || 0, completed_at: t, updated_at: t })
    })
    if (inProgress && list[done]) state.academy_lesson_progress.push({ member_id: mid, lesson_id: list[done].id, position_sec: inProgress, completed_at: null, updated_at: at(20 * HOUR) })
  }
  progress(DEMO_MEMBER_ID, 'brunetti-metodo', 7, { inProgress: 245 })
  progress(DEMO_MEMBER_ID, 'barberia-basico', 3)
  progress(DEMO_MEMBER_ID, 'tijeras-formas', 1)
  for (const [mid, slug, n] of [[5, 'brunetti-metodo', 19], [6, 'brunetti-metodo', 12], [8, 'brunetti-metodo', 4], [12, 'brunetti-metodo', 19], [24, 'brunetti-metodo', 9], [30, 'brunetti-metodo', 16], [5, 'barberia-basico', 10], [10, 'barberia-basico', 6], [7, 'barba', 8], [9, 'barba', 3]]) progress(mid, slug, n)

  /* Categorías (las por defecto + una privada del Grupo 1) */
  const catIds = DEFAULT_CATEGORIES.map((c, i) => {
    const row = { id: id('academy_categories'), name: c.name, emoji: c.emoji, position: i, write_role: c.write_role, default_sort: 'default', cohort_id: null, created_at: at(200 * DAY) }
    state.academy_categories.push(row)
    return row.id
  })
  const privCat = { id: id('academy_categories'), name: 'Generación Octubre', emoji: '🔒', position: 6, write_role: 'miembros', default_sort: 'nuevos', cohort_id: cohortIds[0], created_at: at(30 * DAY) }
  state.academy_categories.push(privCat)
  catIds.push(privCat.id)

  /* Publicaciones, comentarios (2 niveles), likes, encuestas */
  const weight = (mid) => 1 + (MEMBERS.find((m) => m.id === mid)?.pts || 0) / 12
  const weightedAuthor = (exclude) => {
    const pool = activeIds.filter((x) => x !== exclude)
    const total = pool.reduce((s, x) => s + weight(x), 0)
    let t = r() * total
    for (const x of pool) { t -= weight(x); if (t <= 0) return x }
    return pool[pool.length - 1]
  }
  const commentRow = (fields) => {
    const row = { id: id('academy_comments'), post_id: null, lesson_id: null, parent_id: null, like_count: 0, edited_at: null, deleted_at: null, ...fields }
    row.updated_at = row.created_at
    state.academy_comments.push(row)
    return row
  }
  POSTS.forEach((p) => {
    const created = at(p.ago * HOUR)
    const post = {
      id: id('academy_posts'), author_id: p.a, category_id: catIds[p.cat], title: p.title, body: p.body,
      attachments: (p.images || []).map(IMG), video_id: p.video || null, poll: p.poll ? { options: p.poll.map((text) => ({ text })) } : null,
      pinned_at: p.pin ? at((10 + p.pin) * DAY) : null, comments_locked: Boolean(p.locked), like_count: 0, comment_count: 0,
      last_activity_at: created, last_comment_at: null, edited_at: null, deleted_at: p.deleted ? at((p.ago - 3) * HOUR) : null,
      created_at: created, updated_at: created,
    }
    state.academy_posts.push(post)
    state.academy_follows.push({ member_id: p.a, target_type: 'post', target_id: post.id, created_at: created })
    const inCohortOnly = catIds[p.cat] === privCat.id
    const cohortPool = [OWNER_ID, ...COHORTS[0].members]
    for (let i = 0; i < p.c; i++) {
      let author = inCohortOnly ? pick(cohortPool.filter((x) => x !== p.a)) : weightedAuthor(p.a)
      if (i === 0 && !inCohortOnly && r() < 0.35) author = OWNER_ID
      if (author === p.a) author = pick(activeIds.filter((x) => x !== p.a))
      const body = author === OWNER_ID ? pick(OWNER_POOL) : pick(COMMENT_POOL)
      const c = commentRow({ post_id: post.id, author_id: author, body, created_at: between(created, at(10 * MIN), 1.5) })
      if (r() < 0.35) {
        const replies = 1 + Math.floor(r() * 2)
        for (let k = 0; k < replies; k++) {
          const rAuthor = k === 0 && r() < 0.6 ? p.a : weightedAuthor(c.author_id)
          commentRow({ post_id: post.id, parent_id: c.id, author_id: rAuthor, body: pick(REPLY_POOL), created_at: between(c.created_at, at(5 * MIN), 1.2) })
        }
      }
    }
  })
  const postBy = (title) => state.academy_posts.find((p) => p.title === title)
  const demoPost = postBy('Hola! Soy Diego, de Valparaíso')
  // Mención y comentario de Bruno en la presentación de Diego (→ notificaciones).
  const mention = commentRow({ post_id: demoPost.id, author_id: OWNER_ID, body: '¡Bienvenido @diego-munoz-4! Parte por el módulo 1 del Método Brunetti y cuéntanos cómo te va.', created_at: at(26 * HOUR) })
  const diegoComment = commentRow({ post_id: postBy('¿Qué máquina me recomiendan para empezar?').id, author_id: DEMO_MEMBER_ID, body: 'Yo partí con la Magic Clip y la sigo usando.', created_at: at(40 * HOUR) })
  const reply = commentRow({ post_id: diegoComment.post_id, parent_id: diegoComment.id, author_id: MOD_ID, body: 'Buena elección para partir, @diego-munoz-4. Después súmale una trimmer.', created_at: at(38 * HOUR) })
  // Comentario de Kevin (expulsado) reportado.
  const kevinComment = commentRow({ post_id: postBy('Mi primer skin fade limpio 🔥').id, author_id: 28, body: 'Te hago ese corte a mitad de precio, escríbeme 😉', created_at: at(28 * HOUR) })
  // Comentarios en lecciones (hilos de la lección).
  for (const [slug, idx, list] of [
    ['brunetti-metodo', 0, [[5, '¡Qué buena historia! Me identifiqué mucho.'], [DEMO_MEMBER_ID, 'Gracias por compartir esto Bruno 🙌'], [OWNER_ID, 'Gracias a ustedes por estar acá.']]],
    ['brunetti-metodo', 3, [[12, '¿Las 5 preguntas se hacen antes de lavar?'], [OWNER_ID, 'Sí, siempre en seco y mirando al espejo.']]],
    ['barberia-basico', 0, [[10, '¿Qué capa recomiendan?'], [13, 'Una de nylon liviana, que no dé calor.']]],
  ]) {
    const lesson = lessonsOf(slug)[idx]
    let parent = null
    list.forEach(([author, body], i) => {
      const row = commentRow({ lesson_id: lesson.id, parent_id: i > 0 && parent && author === OWNER_ID ? parent.id : null, author_id: author, body, created_at: at((60 - i * 5) * HOUR) })
      if (i === 0) parent = row
    })
  }
  // Contadores de cada publicación (solo comentarios no borrados).
  const recount = () => {
    for (const post of state.academy_posts) {
      const cs = state.academy_comments.filter((c) => c.post_id === post.id && !c.deleted_at)
      post.comment_count = cs.length
      post.last_comment_at = cs.reduce((mx, c) => (c.created_at > (mx || '') ? c.created_at : mx), null)
      post.last_activity_at = post.last_comment_at && post.last_comment_at > post.created_at ? post.last_comment_at : post.created_at
    }
  }
  recount()

  /* Likes: reparte los puntos objetivo de cada autor entre sus publicaciones y
     comentarios, con fechas sesgadas a lo reciente para que las tablas de 7 y
     30 días tengan gente. Cada like es de un miembro distinto al autor. */
  const likers = state.academy_members.filter((x) => x.status !== 'cancelado' && x.id !== TEMP_MEMBER_ID).map((x) => x.id)
  for (const m of MEMBERS) {
    if (!m.pts) continue
    const targets = [
      ...state.academy_posts.filter((p) => p.author_id === m.id && !p.deleted_at).map((t) => ({ type: 'post', row: t })),
      ...state.academy_comments.filter((c) => c.author_id === m.id && !c.deleted_at).map((t) => ({ type: 'comment', row: t })),
    ]
    if (!targets.length) {
      const host = state.academy_posts.find((p) => !p.deleted_at && p.author_id !== m.id && !state.academy_categories.find((c) => c.id === p.category_id)?.cohort_id)
      targets.push({ type: 'comment', row: commentRow({ post_id: host.id, author_id: m.id, body: pick(COMMENT_POOL), created_at: between(host.created_at, at(HOUR)) }) })
    }
    const used = new Map(targets.map((t) => [t.row, new Set()]))
    let left = m.pts
    let guard = 0
    while (left > 0 && guard++ < m.pts * 20) {
      const t = pick(targets)
      const liker = pick(likers)
      if (liker === m.id || used.get(t.row).has(liker)) continue
      used.get(t.row).add(liker)
      // Como en la vida real: casi todos los likes llegan en los primeros días.
      const when = Math.min(T0 - MIN, Date.parse(t.row.created_at) + -Math.log(1 - r()) * 2.5 * DAY)
      state.academy_likes.push({ member_id: liker, target_type: t.type, target_id: t.row.id, author_id: m.id, created_at: nowIso(new Date(when)) })
      t.row.like_count += 1
      left--
    }
  }
  recount()
  // Un par de likes de Diego a otros (para que vea corazones marcados).
  for (const p of state.academy_posts.filter((x) => [5, 1, 7].includes(x.author_id) && !x.deleted_at).slice(0, 4)) {
    if (!state.academy_likes.some((l) => l.member_id === DEMO_MEMBER_ID && l.target_type === 'post' && l.target_id === p.id)) {
      state.academy_likes.push({ member_id: DEMO_MEMBER_ID, target_type: 'post', target_id: p.id, author_id: p.author_id, created_at: between(p.created_at, at(HOUR)) })
      p.like_count += 1
    }
  }
  // Votos de encuesta.
  for (const p of state.academy_posts.filter((x) => x.poll)) {
    const voters = likers.filter(() => r() < 0.55)
    for (const v of voters) state.academy_poll_votes.push({ post_id: p.id, member_id: v, option_idx: Math.floor((r() ** 1.6) * p.poll.options.length), created_at: between(p.created_at, at(MIN)) })
  }

  /* Leídas y seguimientos del demo */
  state.academy_posts.forEach((p, i) => {
    if (i % 3 !== 0 && !p.deleted_at) state.academy_post_reads.push({ member_id: DEMO_MEMBER_ID, post_id: p.id, read_at: between(p.created_at, p.last_activity_at > p.created_at ? p.last_activity_at : at(0)) })
  })
  for (const target of [OWNER_ID, 5, 7]) state.academy_follows.push({ member_id: DEMO_MEMBER_ID, target_type: 'miembro', target_id: target, created_at: at(30 * DAY) })
  for (const fan of [5, 6, 7, 8, 9, 12, 30, 24]) state.academy_follows.push({ member_id: fan, target_type: 'miembro', target_id: OWNER_ID, created_at: at((20 + fan) * DAY) })
  state.academy_follows.push({ member_id: 5, target_type: 'miembro', target_id: DEMO_MEMBER_ID, created_at: at(29 * DAY) })
  state.academy_follows.push({ member_id: DEMO_MEMBER_ID, target_type: 'post', target_id: postBy('¿Qué máquina me recomiendan para empezar?').id, created_at: at(40 * HOUR) })

  /* Reportes y bloqueos */
  const spam = state.academy_posts.find((p) => p.deleted_at)
  state.academy_reports.push(
    { id: id('academy_reports'), reporter_id: 9, target_type: 'post', target_id: spam.id, reason: 'Spam', status: 'resuelto', resolved_by: MOD_ID, resolved_at: at(8 * DAY), created_at: at(9 * DAY) },
    { id: id('academy_reports'), reporter_id: 12, target_type: 'comment', target_id: kevinComment.id, reason: 'Ofrece servicios por interno', status: 'abierto', resolved_by: null, resolved_at: null, created_at: at(27 * HOUR) },
    { id: id('academy_reports'), reporter_id: DEMO_MEMBER_ID, target_type: 'miembro', target_id: 28, reason: 'Me escribe spam por chat', status: 'abierto', resolved_by: null, resolved_at: null, created_at: at(20 * HOUR) },
  )
  state.academy_blocks.push({ blocker_id: 12, blocked_id: 28, created_at: at(8 * DAY) })

  /* Notificaciones */
  const notif = (memberId, kind, { actor = null, type = null, target = null, parent = null, preview = null, group = null, hoursAgo = 1, read = false } = {}) => {
    state.academy_notifications.push({
      id: id('academy_notifications'), member_id: memberId, kind, actor_id: actor, target_type: type, target_id: target, parent_id: parent,
      preview, group_key: group, read_at: read ? at(Math.max(0, hoursAgo - 0.5) * HOUR) : null, created_at: at(hoursAgo * HOUR),
    })
  }
  const brunetti = courseBy('brunetti-metodo')
  notif(DEMO_MEMBER_ID, 'bienvenida', { hoursAgo: 34 * 24, read: true })
  notif(DEMO_MEMBER_ID, 'curso', { type: 'curso', target: brunetti.id, preview: brunetti.title, hoursAgo: 34 * 24, read: true })
  notif(DEMO_MEMBER_ID, 'grupo', { type: 'grupo', target: cohortIds[0], preview: COHORTS[0].name, hoursAgo: 20 * 24, read: true })
  notif(DEMO_MEMBER_ID, 'nivel', { preview: 'Nivel 2 · Ayudante', hoursAgo: 12 * 24, read: true })
  notif(DEMO_MEMBER_ID, 'seguidor', { actor: 5, type: 'miembro', target: 5, hoursAgo: 29 * 24, read: true })
  notif(DEMO_MEMBER_ID, 'anuncio', { actor: OWNER_ID, type: 'post', target: postBy('Nuevo módulo: Cómo cobrar más').id, preview: 'Nuevo módulo: Cómo cobrar más', hoursAgo: 6 * 24, read: true })
  notif(DEMO_MEMBER_ID, 'respuesta', { actor: MOD_ID, type: 'comment', target: reply.id, parent: reply.post_id, preview: reply.body, hoursAgo: 38 })
  notif(DEMO_MEMBER_ID, 'mencion', { actor: OWNER_ID, type: 'comment', target: mention.id, parent: demoPost.id, preview: mention.body, hoursAgo: 26 })
  notif(DEMO_MEMBER_ID, 'comentario', { actor: OWNER_ID, type: 'comment', target: mention.id, parent: demoPost.id, preview: mention.body, hoursAgo: 26, read: true })
  notif(DEMO_MEMBER_ID, 'like', { actor: 5, type: 'post', target: demoPost.id, preview: demoPost.title, group: `like:post:${demoPost.id}`, hoursAgo: 3 })
  notif(DEMO_MEMBER_ID, 'post_seguido', { actor: 5, type: 'post', target: postBy('¿Alguien para practicar el sábado?').id, preview: '¿Alguien para practicar el sábado?', hoursAgo: 30 })
  notif(DEMO_MEMBER_ID, 'actividad', { actor: 14, type: 'post', target: diegoComment.post_id, preview: '¿Qué máquina me recomiendan para empezar?', hoursAgo: 8 })
  notif(OWNER_ID, 'miembro_nuevo', { actor: 26, type: 'miembro', target: 26, hoursAgo: 24 })
  notif(OWNER_ID, 'miembro_nuevo', { actor: TEMP_MEMBER_ID, type: 'miembro', target: TEMP_MEMBER_ID, hoursAgo: 2 })
  notif(OWNER_ID, 'reporte', { actor: 12, type: 'comment', target: kevinComment.id, parent: kevinComment.post_id, preview: kevinComment.body, hoursAgo: 27 })
  notif(MOD_ID, 'reporte', { actor: 12, type: 'comment', target: kevinComment.id, parent: kevinComment.post_id, preview: kevinComment.body, hoursAgo: 27 })
  notif(OWNER_ID, 'like', { actor: 5, type: 'post', target: state.academy_posts[0].id, preview: state.academy_posts[0].title, group: `like:post:${state.academy_posts[0].id}`, hoursAgo: 5 })
  notif(5, 'comentario', { actor: 10, type: 'post', target: postBy('Mi primer skin fade limpio 🔥').id, preview: 'Muy limpio ese degradado', hoursAgo: 6 })

  /* Eventos: Q&A semanal (miércoles 19:00), coworking (mar/jue) y únicos. */
  const todayKey = santiagoDateKey(new Date(T0))
  const shiftKey = (days) => santiagoDateKey(new Date(Date.parse(`${todayKey}T12:00:00Z`) + days * DAY))
  const weekdayOf = (key) => zonedParts(zonedToUtc(key, '12:00')).weekday
  const lastWeekday = (wd, weeksBack) => {
    const back = (weekdayOf(todayKey) - wd + 7) % 7
    return shiftKey(-back - 7 * weeksBack)
  }
  const ev = (fields) => {
    const row = {
      id: id('academy_events'), description: null, cover_url: null, duration_min: 60, tz: 'America/Santiago', repeat_weekly: false, weekdays: null,
      until_date: null, location_type: 'enlace', location_info: null, access: { type: 'todos' }, email_reminder: true, created_by: OWNER_ID,
      created_at: at(40 * DAY), updated_at: at(40 * DAY), ...fields,
    }
    state.academy_events.push(row)
    return row
  }
  ev({ title: 'Q&A con Bruno', description: 'Preguntas y respuestas en vivo. Trae tus dudas de la semana o déjalas en ❓ Preguntas.', starts_at: nowIso(zonedToUtc(lastWeekday(3, 8), '19:00')), repeat_weekly: true, weekdays: [3], location_type: 'meet', location_info: 'https://meet.google.com/pim-pstu-dio', cover_url: '/assets/bruno-portrait.jpg' })
  ev({ title: 'Sesión de coworking', description: 'Cámaras prendidas, cada uno avanza sus lecciones. 50 minutos de foco.', starts_at: nowIso(zonedToUtc(lastWeekday(2, 3), '10:00')), repeat_weekly: true, weekdays: [2, 4], until_date: shiftKey(45), location_type: 'enlace', location_info: 'https://meet.google.com/abc-defg-hij', email_reminder: false })
  ev({ title: 'Masterclass: el fade perfecto', description: 'Transmisión en vivo con demostración completa de un low fade.', starts_at: nowIso(zonedToUtc(shiftKey(4), '20:00')), duration_min: 90, location_type: 'youtube', location_info: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', cover_url: '/assets/estilo/estilo-skin-fade.jpg' })
  ev({ title: 'Revisión de cortes en vivo (Nivel 3+)', description: 'Suban sus fotos y las revisamos en vivo. Solo desde el Nivel 3.', starts_at: nowIso(zonedToUtc(shiftKey(2), '18:30')), duration_min: 90, location_type: 'zoom', location_info: 'https://zoom.us/j/1234567890', access: { type: 'nivel', level: 3 } })
  ev({ title: 'Práctica presencial · Generación Octubre', description: 'Práctica con modelos en el estudio.', starts_at: nowIso(zonedToUtc(shiftKey(9), '10:00')), duration_min: 180, location_type: 'direccion', location_info: 'Av. Providencia 1234, Providencia, Santiago', access: { type: 'grupo', cohortId: cohortIds[0] } })
  ev({ title: `Lanzamiento de ${B.name}`, description: 'Presentamos la Academy y los primeros cursos.', starts_at: nowIso(zonedToUtc(shiftKey(-10), '19:30')), location_type: 'youtube', location_info: 'https://www.youtube.com/watch?v=M7lc1UVf-VE', email_reminder: false })

  /* Correo ya "enviado" al recién comprado (para poder entrar como él). */
  const temp = member(TEMP_MEMBER_ID)
  temp.credentials_sent_at = at(2 * HOUR)
  temp.credentials_claimed_at = at(2 * HOUR)
  state.outbox.push({
    id: id('outbox'), kind: 'acceso', to: temp.email, subject: `Tu acceso a ${B.name}`,
    text: `Hola ${temp.name}: tu usuario es ${temp.email} y tu contraseña temporal ${TEMP_PASSWORD.display} (válida por 72 h).`,
    data: { tempPassword: TEMP_PASSWORD.display, loginUrl: `${HOST.base}/ingreso`, course: brunetti.title }, createdAt: at(2 * HOUR),
  })

  /* Alertas del panel (tabla `notifications` del barbero) */
  state.notifications.push({ id: 1, barber_id: BARBER_ID, title: 'Nueva inscripción Academy', body: `${brunetti.title} · $${brunetti.price_online.toLocaleString('es-CL')}`, url: '/panel?tab=academy', created_at: at(2 * HOUR) })

  return state
}
