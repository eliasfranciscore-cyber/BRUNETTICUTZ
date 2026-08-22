export const WORKSHOP_HIGHLIGHTS = [
  "Sube tu valor percibido y cobra mejor",
  "Convierte Instagram en agenda real",
  "Aprende grabación y edición desde el celular",
]

export const TESTIMONIALS = [
  {
    quote: "Llegué sin saber qué corte me quedaba y salí con el mejor look de mi vida. La asesoría visagista de Brunetti es otro nivel.",
    name: "Matías Fuentes",
    role: "Cliente Brunetti Experience",
    img: "/assets/gallery-2.jpg",
  },
  {
    quote: "El fade más limpio que me han hecho en Maipú. Ambiente premium, atención impecable y siempre puntuales con la hora reservada.",
    name: "Cristóbal Reyes",
    role: "Corte + Perfilado de barba",
    img: "/assets/gallery-1.jpg",
  },
  {
    quote: "Me hice un platinado global y quedó exactamente como lo imaginaba. Se nota el dominio técnico del equipo en color.",
    name: "Ignacio Soto",
    role: "Servicio químico",
    img: "/assets/gallery-3.jpg",
  },
]

export const FEATURE_CARDS = [
  {
    cat: "Brunetti Experience",
    title: "Asesoría de imagen visagista",
    img: "/assets/gallery-2.jpg",
    body: "Una consulta personalizada donde analizamos rostro, estilo de vida y objetivos para definir una dirección visual coherente, no solo un corte.",
  },
  {
    cat: "Servicio general",
    title: "El fade perfecto",
    img: "/assets/gallery-1.jpg",
    body: "Degradados limpios, transiciones más suaves y un acabado pensado para verse bien en persona y en cámara.",
  },
  {
    cat: "Color",
    title: "Platinado y visos",
    img: "/assets/gallery-3.jpg",
    body: "Trabajo técnico de color con una lectura más premium del resultado final, sin perder estructura ni textura.",
  },
  {
    cat: "Experiencia",
    title: "Detalle de barba",
    img: "/assets/gallery-2.jpg",
    body: "Perfilado de barba, simetría y líneas bien construidas para complementar el corte y reforzar la presencia del cliente.",
  },
  {
    cat: "Workshop",
    title: "Contenido que vende",
    img: "/assets/gallery-1.jpg",
    body: "Formación intensiva para barberos que quieren mostrar mejor su trabajo, atraer mejor cliente y convertir visibilidad en agenda.",
  },
]

export const WORKSHOP_MODULES = [
  {
    title: "Contenido estratégico",
    items: [
      "Hooks para detener el scroll en los primeros segundos.",
      "Guiones cortos orientados a reservas, no solo vistas.",
      "Posicionamiento personal según tu especialidad.",
    ],
  },
  {
    title: "Grabación en barbería",
    items: [
      "Cómo usar la luz del local a tu favor.",
      "Planos clave para cortes, barba y transformaciones.",
      "Audio limpio para reels con sensación premium.",
    ],
  },
  {
    title: "Edición con intención",
    items: [
      "Workflow rápido en CapCut desde el móvil.",
      "Subtítulos, ritmo y cortes que sostienen atención.",
      "Formatos listos para publicar durante la misma semana.",
    ],
  },
]

export const WORKSHOP_TIMELINE = [
  { time: "09:30", label: "Café, diagnóstico y enfoque de marca" },
  { time: "10:15", label: "Estrategia de contenido para barbería premium" },
  { time: "11:20", label: "Grabación guiada con casos reales" },
  { time: "12:20", label: "Sprint de edición y storytelling" },
  { time: "13:10", label: "Plan de publicación y cierre" },
]

export const WORKSHOP_INCLUDES = [
  "Certificado de participación",
  "Plantillas de guion y estructura visual",
  "Checklist de grabación para el salón",
  "Acceso a comunidad privada de seguimiento",
]

export const WORKSHOP_DATES = [
  {
    title: "Edición Maipú · Intensivo presencial",
    date: "Sábado 28 de junio · 09:30 a 13:30",
    location: "Brunetti Barber Studio, Monumento 1750 Local C",
    seats: "20 cupos",
    price: "$97.000",
  },
  {
    title: "Edición Santiago Centro · Grupo reducido",
    date: "Domingo 13 de julio · 10:00 a 14:00",
    location: "Ubicación por confirmar",
    seats: "16 cupos",
    price: "$97.000",
  },
]

export const WORKSHOP_VIDEOS = [
  {
    title: "Cómo planear un reel que sí genera citas",
    description: "Mapa de ideas, gancho inicial y CTA para convertir atención en agenda.",
  },
  {
    title: "Planos que hacen ver premium un corte normal",
    description: "Encuadres simples para mostrar técnica, detalle y resultado final con más impacto.",
  },
]

/* ============================================================
   Workshop "Contenido que Vende" — Rediseño 2026
   Modelo de datos para la página /workshop (src/pages/Workshop.jsx).
   Reemplaza los enlaces de photos por /assets propias cuando tengas las fotos definitivas.
   ============================================================ */

/* Fecha del workshop: 30 de agosto. Si ya pasó respecto al reloj actual,
   avanza al próximo año para que el countdown nunca quede en 00.
   Para fijar una fecha exacta, edita BASE_MONTH/BASE_DAY/BASE_HOUR. */
const WK_BASE = { month: 8, day: 30, hour: 9, minute: 30 };
const WK_MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const WK_DIAS = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

/* Formatea una fecha de edición del workshop a {iso,label,long}. Se usa
   tanto para la fecha por defecto (WK_BASE, hardcodeada acá) como para la
   que llega del panel interno (Config → Precios y fechas, ver Workshop.jsx). */
export function formatWorkshopDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return {
    iso: d.toISOString(),
    label: `${dd} · ${mm} · ${d.getFullYear()}`,
    long: `${WK_DIAS[d.getDay()].charAt(0).toUpperCase() + WK_DIAS[d.getDay()].slice(1)} ${d.getDate()} de ${WK_MESES[d.getMonth()]} · ${hh}:${min}`,
  };
}
function wkEditionDate() {
  const now = new Date();
  let year = now.getFullYear();
  let d = new Date(year, WK_BASE.month - 1, WK_BASE.day, WK_BASE.hour, WK_BASE.minute, 0);
  if (d.getTime() < now.getTime()) { year += 1; d = new Date(year, WK_BASE.month - 1, WK_BASE.day, WK_BASE.hour, WK_BASE.minute, 0); }
  const dd = String(WK_BASE.day).padStart(2, "0");
  const mm = String(WK_BASE.month).padStart(2, "0");
  return {
    iso: d.toISOString(),
    label: `${dd} · ${mm} · ${year}`,
    long: `${WK_DIAS[d.getDay()].charAt(0).toUpperCase() + WK_DIAS[d.getDay()].slice(1)} ${WK_BASE.day} de ${WK_MESES[WK_BASE.month - 1]} · 09:30 a 13:00`,
  };
}
const WK_ED = wkEditionDate();

export const WORKSHOP = {
  meta: {
    kicker: "Workshop de marca personal para barberos",
    title1: "Contenido",
    title2: "que vende",
    subtitle:
      "Una jornada intensiva para barberos que ya dominan la técnica y ahora necesitan verse premium, comunicar mejor y convertir seguidores en agenda real.",
    dateISO: WK_ED.iso,
    dateLabel: WK_ED.label,
    dateLong: WK_ED.long,
    location: "Viña del Mar",
    handle: "@brunetticutz",
    whatsapp: "+56 9 8748 3279",
    priceNow: 49990,
    priceWas: 99990,
    off: "-50%",
    seatsTotal: 20,
    seatsTaken: 13,
  },

  // Video VSL del workshop — sección dedicada (usa la vista previa de YouTube).
  video: {
    url: "https://youtu.be/8gnNeVWrZG0",
    eyebrow: "El workshop en video",
    title: "Mira de qué se trata, en menos de 3 minutos.",
  },

  // imágenes Unsplash (se fuerzan a B/N por CSS). Reemplazables por /assets propias.
  photos: {
    hero: "/assets/workshop-hero-bg.webp",
    cobrar: "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=900&q=80",
    marca: "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?auto=format&fit=crop&w=900&q=80",
    redes: "https://images.unsplash.com/photo-1633681926035-ec1ac984418a?auto=format&fit=crop&w=900&q=80",
    experiencia: "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=1100&q=80",
    asesoria: "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=1100&q=80",
    bloque1: "https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=1100&q=80",
    bloque2: "https://images.unsplash.com/photo-1517832606299-7ae9b720a186?auto=format&fit=crop&w=1100&q=80",
    bloque3: "https://images.unsplash.com/photo-1634481949659-7c9c0a5c2c08?auto=format&fit=crop&w=1100&q=80",
    pricing: "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1600&q=80",
  },

  transform: [
    {
      n: "01",
      title: "Cobrar más",
      body: "Eleva tu valor percibido y deja de competir por precio. Aprende a justificar un ticket premium.",
      photo: "cobrar",
    },
    {
      n: "02",
      title: "Marca única",
      body: "Diferénciate del barbero de la esquina. Construye una identidad que se reconozca a primera vista.",
      photo: "marca",
    },
    {
      n: "03",
      title: "Redes activas",
      body: "Convierte seguidores en citas. Tu Instagram deja de ser un álbum y pasa a ser tu mejor vendedor.",
      photo: "redes",
    },
  ],

  experiencia: {
    eyebrow: "De servicio a experiencia premium",
    title: "Para cobrar como un experto, debes verte y sentirte como uno.",
    photo: "experiencia",
    items: [
      {
        icon: "gift",
        h: "Amenities de lujo",
        p: "Regalar una bebida premium o café no es un gasto: es una inversión directa en tu ticket promedio.",
      },
      {
        icon: "spark",
        h: "Protocolo de lavado",
        p: "Convierte el lavado capilar en un momento de relajación sensorial inigualable que el cliente recuerda.",
      },
    ],
  },

  asesoria: {
    eyebrow: "Asesoría de imagen · el caso real",
    title: "Una simulación de asesoría High-Ticket, grabada frente a la cámara.",
    photo: "asesoria",
    items: [
      { icon: "user", h: "Escucha activa", p: "Identifica la necesidad real detrás del corte." },
      { icon: "scissors", h: "Asesoramiento técnico", p: "Explica por qué ese look le favorece de verdad." },
      { icon: "star", h: "Satisfacción total", p: "Cómo superar la expectativa del cliente, siempre." },
    ],
  },

  modules: [
    {
      n: "Bloque 01",
      title: "Contenido estratégico",
      photo: "bloque1",
      points: [
        { b: "Hooks magnéticos", s: "Detén el scroll en los primeros 3 segundos con tus cortes." },
        { b: "Estructura VSL", s: "Organiza tus videos para que el cliente desee agendar de inmediato." },
        { b: "Autoridad Pro", s: "Posiciónate como el experto número 1 en degradados o barbas." },
      ],
    },
    {
      n: "Bloque 02",
      title: "Cinematografía móvil",
      photo: "bloque2",
      points: [
        { b: "Iluminación", s: "Aro de luz vs. luz natural del salón: cuándo usar cada una." },
        { b: "Planos clave", s: "Macro, detalle y la reacción del cliente que vende el resultado." },
        { b: "Audio limpio", s: "El secreto del ASMR en barbería para reels premium." },
      ],
    },
    {
      n: "Bloque 03",
      title: "Edición de alto impacto",
      photo: "bloque3",
      video: "/assets/workshop-bloque3.mp4",
      poster: "/assets/workshop-bloque3-poster.jpg",
      points: [
        { b: "Mastery en CapCut", s: "El workflow exacto que usan los creadores top, sin perder tiempo." },
        { b: "Beat matching", s: "Sincroniza tus cortes con la música para máximo ritmo." },
        { b: "Subtítulos & ramping", s: "Textos dinámicos y velocidad para un look cinematográfico." },
      ],
    },
  ],

  timeline: [
    { time: "09:30", b: "Café & Alianzas", s: "Bienvenida, diagnóstico y networking entre barberos." },
    { time: "10:00", b: "Psicología de Contenido", s: "Por qué la gente agenda: estrategia antes que cámara." },
    { time: "11:00", b: "Hands-on Grabación", s: "Grabación guiada con casos reales en el salón." },
    { time: "12:00", b: "Sprint de Edición", s: "Edición en vivo en CapCut, de bruto a publicable." },
    { time: "13:00", b: "Plan de Acción", s: "Calendario de publicación y cierre con compromisos." },
  ],

  give: [
    { b: "Certificado", s: "Validación oficial de tu formación Brunetti." },
    { b: "Comunidad VIP", s: "Acceso al grupo privado de WhatsApp para seguimiento." },
    { b: "Toolkit", s: "5 templates de CapCut de alto CTR, listos para usar." },
  ],

  kit: [
    { b: "Hardware", s: "Celular cargado al 100% y con memoria libre." },
    { b: "Software", s: "CapCut instalado (la versión gratuita es suficiente)." },
    { b: "Mente", s: "Cero excusas y hambre real de crecimiento." },
  ],

  faq: [
    {
      q: "¿Necesito una cámara profesional?",
      a: "No. Todo el workshop se hace desde el celular. Solo necesitas tu teléfono cargado, memoria libre y CapCut instalado.",
    },
    {
      q: "¿Sirve si recién estoy empezando?",
      a: "El workshop está pensado para barberos que ya cortan bien y quieren mostrarlo mejor. Si dominas la técnica, este es tu siguiente paso.",
    },
    {
      q: "¿Cuántos cupos hay por fecha?",
      a: "Solo 20 cupos por edición. Lo mantenemos reducido para garantizar feedback real y trabajo práctico con cada asistente.",
    },
    {
      q: "¿El valor incluye todo?",
      a: "Sí. La inversión de $49.990 incluye la jornada completa, el certificado, el toolkit de templates y el acceso a la comunidad VIP.",
    },
  ],
};
