/* ============================================================
   ACADEMY — fichas de venta de los cursos (vitrina pública)
   ------------------------------------------------------------
   Ficha de venta de cada programa (textos, malla, fotos). Código
   COMPARTIDO entre pimpstudio.cl/academy y brunetticutz.cl/cursos
   (scripts/academy-sync.mjs): la Academy es una sola, con una sola
   base, y las dos vitrinas muestran lo mismo. Qué curso sale en la
   web lo decide la base (publicado en el panel), no este archivo.
   Sin imports a propósito: el mock de desarrollo (Node) y la carga
   inicial del panel ("Cargar cursos iniciales", que arma los cursos
   de la Academy con esta malla) lo importan tal cual.

   PRECIOS: `price: null` significa "por definir". Los precios reales
   se publican desde el panel (Academy → Cursos), no acá: el catálogo
   usa los de la base y el checkout los vuelve a leer en el servidor.

   Cada curso declara sus dos modalidades por separado porque no son
   el mismo producto: la presencial se mide en días y cupos, la
   online en clases grabadas. El acceso online es DE POR VIDA (pago
   único): no hay suscripción ni vencimiento en la Academy.

   Desde que existe la Academy, los precios y "ventas abiertas" que
   manda son los de la base (modo `catalog` de /api/academy, editables
   en el panel → Academy → Cursos). Este archivo queda como la ficha
   de venta (textos, malla, fotos) y como respaldo si la API no
   responde — y en ese caso todo se muestra "Por definir", nunca a la
   venta con un precio de acá.

   IMÁGENES: `image` / `imageAlt` apuntan por ahora a /assets/estilo,
   que son fotos de clientes del estudio, no de clases. Sirven para ver
   el módulo montado; hay que reemplazarlas por fotos reales de la
   Academy.

   PRECIOS EN LA WEB: la vitrina pública (src/pages/academy/Vitrina.jsx)
   no muestra precios, ni los de acá ni los de la base.
   ============================================================ */

/* Instagram propio de la Academy (la misma en los dos sitios). Es una
   cuenta DISTINTA de la de cada barbería, que sigue rigiendo en el resto
   de cada sitio: solo las páginas de la Academy apuntan acá. */
export const ACADEMY_INSTAGRAM = 'pimpacademy.cl'

export const TRACKS = {
  barberia: { label: 'Barbería',     tint: 'gold'  },
  barba:    { label: 'Barba',        tint: 'warm'  },
  tijeras:  { label: 'Tijeras',      tint: 'steel' },
  color:    { label: 'Colorimetría', tint: 'cool'  },
}

export const LEVELS = ['Inicial', 'Intermedio', 'Avanzado']

/* Un solo programa desde 2026-09-30: "Formación inicial en barbería",
   copiado de la malla curricular de Pimpacademy.cl (4 módulos, 16 clases).
   Los ocho programas anteriores (Básico, Fines de semana, Barba, Pro,
   Tijeras, Colorimetría ×2, Cortes de mujer) se retiraron del catálogo.

   `modules` agrupa las 16 clases de `malla` (cada clase dice a qué módulo
   pertenece con `module`). "Cargar cursos iniciales" crea una sección por
   módulo y una lección por clase, con su objetivo, contenidos, actividad y
   resultado como texto (src/academy/host.jsx).

   Online: todavía no existe. `online: null` lo saca de todo lo que se
   vende y `onlineSoon` lo rotula "Próximamente" en la vitrina. */
export const ACADEMY_COURSES = [
  {
    id: 'formacion-inicial',
    name: 'Formación inicial en barbería',
    tagline: 'De los fundamentos a tu primer cliente real',
    track: 'barberia',
    level: 'Inicial',
    image: '/assets/estilo/estilo-fade-clasico.jpg',
    imageAlt: '/assets/estilo/estilo-crop-texturizado.jpg',
    summary:
      'Dieciséis clases presenciales en dos meses: herramientas, higiene, degradados, tijera, barba y atención de clientes reales, con evaluación final y certificación.',
    long:
      'Esta malla organiza el aprendizaje desde los fundamentos hasta la atención completa de un cliente real. Cada clase combina teoría, demostración, práctica supervisada y retroalimentación, de modo que los alumnos avancen con una metodología común en las jornadas diurna y vespertina.',
    objective:
      'Formar barberos con una base técnica sólida, capaces de preparar su estación, utilizar correctamente sus herramientas, ejecutar cortes y degradados básicos, realizar perfilado de barba, asesorar al cliente y desarrollar un servicio completo bajo estándares de higiene, calidad y atención profesional.',
    // Competencias de egreso.
    outcomes: [
      'Preparar y desinfectar correctamente la estación de trabajo.',
      'Reconocer las zonas principales de la cabeza y la dirección del cabello.',
      'Utilizar máquina, palanca, peines de alzada, trimmer, tijera y navaja.',
      'Ejecutar degradados bajos, medios y altos de nivel inicial.',
      'Conectar laterales con la zona superior y controlar el volumen.',
      'Realizar terminaciones, patillas, contornos y perfilado básico de barba.',
      'Aplicar técnicas iniciales de tijera, texturizado, secado y styling.',
      'Diagnosticar, asesorar y comunicarse profesionalmente con un cliente.',
      'Realizar un servicio completo bajo un tiempo definido.',
      'Registrar sus resultados y comprender principios básicos de precio, agenda y fidelización.',
    ],
    presencial: {
      price: null,
      days: 16,
      hours: 64,
      span: '2 meses',
      schedule: '2 clases por semana · 4 horas por sesión, con un break de 15 minutos',
      frequency: '2 clases por semana',
      sessionHours: 4,
      seats: 4,
      shifts: 'Jornada diurna y vespertina',
    },
    online: null,
    onlineSoon: true,
    includes: [
      '16 clases presenciales de 4 horas: 64 horas por grupo',
      'Máximo 4 alumnos por jornada, diurna o vespertina',
      'Teoría, demostración, práctica guiada y corrección en cada clase',
      'Atención de clientes reales desde la clase 12',
      'Evaluación intermedia, simulacro cronometrado y evaluación final',
      'Certificado y ceremonia de titulación al aprobar',
    ],
    requirements: 'Ninguno: nivel inicial, sin experiencia previa.',
    modules: [
      {
        n: 1,
        title: 'Fundamentos de barbería',
        short: 'Fundamentos',
        hours: 16,
        purpose: 'Herramientas, higiene, anatomía del corte y primer degradado bajo.',
        summary:
          'El alumno conoce las herramientas, los protocolos de higiene, la estructura de la cabeza y los movimientos básicos necesarios para comenzar a cortar con seguridad.',
      },
      {
        n: 2,
        title: 'Desarrollo técnico',
        short: 'Desarrollo técnico',
        hours: 16,
        purpose: 'Degradados medio y alto, conexión, tijera, terminaciones y barba.',
        summary:
          'El alumno amplía su dominio del fade, aprende a conectar la zona superior y desarrolla terminaciones, tijera y barba.',
      },
      {
        n: 3,
        title: 'Aplicación profesional',
        short: 'Aplicación profesional',
        hours: 24,
        purpose: 'Personalización, servicio completo, clientes reales y negocio.',
        summary:
          'El alumno integra la técnica con diagnóstico, personalización, atención al cliente, práctica real y nociones de negocio.',
      },
      {
        n: 4,
        title: 'Evaluación y cierre',
        short: 'Evaluación y cierre',
        hours: 8,
        purpose: 'Simulacro, evaluación práctica final y certificación.',
        summary:
          'Las dos últimas clases verifican que el alumno pueda organizar y ejecutar un servicio completo bajo un tiempo definido.',
      },
    ],
    // Una entrada por clase. `items` = contenidos.
    malla: [
      {
        n: 1,
        module: 1,
        title: 'Herramientas y fundamentos',
        objective: 'Reconocer las herramientas esenciales y utilizarlas con postura y control adecuados.',
        items: [
          'Funciones de máquina, trimmer, shaver y secador.',
          'Peines de alzada, palanca y medidas de corte.',
          'Tijeras, peinetas, cepillos, navaja, pinzas y atomizador.',
          'Agarre, postura corporal y mantenimiento básico.',
        ],
        activity: 'Ejercicios de agarre, movimiento de máquina, uso de palanca y reconocimiento de medidas sobre cabeza de práctica.',
        result: 'El alumno identifica cada herramienta, explica su función y la manipula de forma segura.',
      },
      {
        n: 2,
        module: 1,
        title: 'Higiene y preparación del servicio',
        objective: 'Preparar una estación limpia, segura y profesional antes y después de cada atención.',
        items: [
          'Higiene personal y presentación profesional.',
          'Desinfección de máquinas y herramientas.',
          'Elementos desechables y prevención de contaminación.',
          'Preparación del cliente, cuello, capa y orden del puesto.',
        ],
        activity: 'Montaje completo de estación, protocolo de desinfección y simulación de recepción y preparación del cliente.',
        result: 'El alumno aplica correctamente el protocolo de higiene y deja su estación lista para atender.',
      },
      {
        n: 3,
        module: 1,
        title: 'Anatomía del corte y uso de máquina',
        objective: 'Comprender las zonas de la cabeza y construir guías limpias con máquina y peines de alzada.',
        items: [
          'Laterales, nuca, cresta parietal y zona superior.',
          'Dirección de crecimiento y líneas de peso.',
          'Guías fijas y móviles.',
          'Palanca abierta, intermedia y cerrada.',
          'Movimiento de cuchareo y eliminación de marcas.',
        ],
        activity: 'Creación de líneas y guías, cambios de palanca y ejercicios progresivos para borrar marcas.',
        result: 'El alumno controla la máquina y reconoce la lógica básica de una transición.',
      },
      {
        n: 4,
        module: 1,
        title: 'Primer degradado bajo',
        objective: 'Ejecutar la estructura inicial de un degradado bajo siguiendo un orden de trabajo definido.',
        items: [
          'Altura y distribución del low fade.',
          'Secuencia de guías y construcción de tonalidades.',
          'Revisión de simetría.',
          'Errores frecuentes y forma de corregirlos.',
        ],
        activity: 'Demostración completa y primera ejecución supervisada en modelo o cabeza de práctica.',
        result: 'El alumno realiza un degradado bajo básico y registra su primer resultado técnico.',
      },
      {
        n: 5,
        module: 2,
        title: 'Degradado medio',
        objective: 'Controlar la altura, las guías y la transición de un degradado medio.',
        items: [
          'Diferencias entre degradado bajo y medio.',
          'Elección de altura según la cabeza.',
          'Construcción de tonalidades.',
          'Detección y eliminación de líneas visibles.',
        ],
        activity: 'Ejecución completa de un mid fade con revisión por etapas.',
        result: 'El alumno realiza una transición media más limpia y uniforme.',
      },
      {
        n: 6,
        module: 2,
        title: 'Degradado alto y conexión',
        objective: 'Ejecutar un degradado alto y conectarlo correctamente con la parte superior.',
        items: [
          'Estructura del high fade.',
          'Manejo de zonas oscuras.',
          'Conexión con cresta parietal.',
          'Máquina sobre peine y revisión desde diferentes ángulos.',
        ],
        activity: 'Degradado alto con conexión básica y corrección de desniveles.',
        result: 'El alumno evita líneas de peso y mantiene una estructura equilibrada.',
      },
      {
        n: 7,
        module: 2,
        title: 'Tijera, texturizado inicial y terminaciones',
        objective: 'Conectar y ordenar la zona superior utilizando técnicas iniciales de tijera.',
        items: [
          'Posición correcta de tijera y peineta.',
          'Secciones y distribución del cabello.',
          'Corte recto, point cutting y texturizado básico.',
          'Tijera sobre peine.',
          'Contornos, patillas, nuca, trimmer y navaja.',
        ],
        activity: 'Corte de zona superior, conexión con laterales y terminaciones completas.',
        result: 'El alumno controla el volumen y entrega una terminación más profesional.',
      },
      {
        n: 8,
        module: 2,
        title: 'Barba I y evaluación intermedia',
        objective: 'Diseñar una barba básica y demostrar dominio de los contenidos técnicos iniciales.',
        items: [
          'Diagnóstico del rostro.',
          'Líneas de mejilla y cuello.',
          'Uso de máquina, trimmer y navaja.',
          'Preparación de la piel, simetría y prevención de irritaciones.',
          'Evaluación de herramientas, higiene, guías, fade y terminaciones.',
        ],
        activity: 'Perfilado de barba y evaluación práctica intermedia con retroalimentación individual.',
        result: 'El alumno reconoce sus fortalezas y brechas antes de trabajar con mayor autonomía.',
      },
      {
        n: 9,
        module: 3,
        title: 'Texturizado y personalización',
        objective: 'Adaptar el corte a la textura del cabello, al rostro y al resultado buscado.',
        items: [
          'Cabello liso, ondulado, rizado y grueso.',
          'Distribución de volumen.',
          'Point cutting y tijera de entresacar.',
          'Elección del corte según rostro y estilo.',
          'Productos, secado y peinado final.',
        ],
        activity: 'Trabajo completo de zona superior, texturizado y styling.',
        result: 'El alumno personaliza el corte y explica por qué eligió cada técnica.',
      },
      {
        n: 10,
        module: 3,
        title: 'Barba II y servicio combinado',
        objective: 'Integrar el corte y la barba dentro de una atención completa.',
        items: [
          'Diseño según tipo de rostro.',
          'Control de volumen y degradado de barba.',
          'Conexión entre patilla y barba.',
          'Preparación para navaja y cuidado posterior.',
        ],
        activity: 'Servicio combinado de corte y barba con terminaciones y productos finales.',
        result: 'El alumno entrega un resultado equilibrado entre cabello, patillas y barba.',
      },
      {
        n: 11,
        module: 3,
        title: 'Atención y asesoría al cliente',
        objective: 'Realizar un diagnóstico claro y comunicar una recomendación profesional.',
        items: [
          'Saludo, recepción y preguntas de diagnóstico.',
          'Análisis del cabello y rostro.',
          'Manejo de expectativas y explicación del servicio.',
          'Comunicación durante la atención.',
          'Presentación del resultado, fotografía y próxima reserva.',
        ],
        activity: 'Simulación completa desde la llegada del cliente hasta la despedida.',
        result: 'El alumno conduce una atención segura, ordenada y centrada en la experiencia del cliente.',
      },
      {
        n: 12,
        module: 3,
        title: 'Práctica con cliente real I',
        objective: 'Aplicar el protocolo completo con acompañamiento permanente del educador.',
        items: [
          'Recepción y diagnóstico.',
          'Preparación de estación y cliente.',
          'Planificación del corte.',
          'Ejecución, terminaciones, peinado y limpieza final.',
        ],
        activity: 'Servicio completo en cliente real; el educador puede detener y corregir durante el proceso.',
        result: 'El alumno completa su primera atención real siguiendo el método de la academia.',
      },
      {
        n: 13,
        module: 3,
        title: 'Práctica con cliente real II',
        objective: 'Realizar un servicio con mayor autonomía y mejor control del tiempo.',
        items: [
          'Planificación previa.',
          'Decisiones técnicas.',
          'Revisión de simetría, transición y terminaciones.',
          'Fotografía del antes y después.',
        ],
        activity: 'Servicio real con correcciones puntuales y evaluación comparativa respecto de la clase anterior.',
        result: 'El alumno mejora su seguridad, ritmo de trabajo y capacidad de autocorrección.',
      },
      {
        n: 14,
        module: 3,
        title: 'Fundamentos de negocio y marca personal',
        objective: 'Comprender cómo comenzar a cobrar, captar clientes y organizar el trabajo profesional.',
        items: [
          'Precio del servicio y costos básicos.',
          'Porcentaje y arriendo de sillón.',
          'Agenda, puntualidad y políticas de atención.',
          'Experiencia, fidelización y próxima reserva.',
          'Fotografía de resultados, contenido y marca personal.',
        ],
        activity: 'Creación de un plan personal de inicio con precio, objetivo de clientes y acciones para redes sociales.',
        result: 'El alumno define una ruta básica para comenzar a generar ingresos como barbero.',
      },
      {
        n: 15,
        module: 4,
        title: 'Simulacro cronometrado',
        objective: 'Detectar y corregir los últimos puntos técnicos antes de la evaluación final.',
        items: [
          'Preparación de herramientas.',
          'Recepción y diagnóstico.',
          'División de zonas y degradado.',
          'Zona superior, contornos, peinado y limpieza.',
          'Organización y control del tiempo.',
        ],
        activity: 'Servicio completo cronometrado con retroalimentación individual al cierre.',
        result: 'El alumno identifica exactamente qué debe corregir antes de certificarse.',
      },
      {
        n: 16,
        module: 4,
        title: 'Evaluación práctica final',
        objective: 'Demostrar de forma autónoma las competencias básicas desarrolladas durante el programa.',
        items: [
          'Planificación y ejecución de un corte completo.',
          'Atención de cliente real.',
          'Presentación del resultado.',
          'Evaluación técnica y cierre académico.',
        ],
        activity: 'Corte completo en cliente real sin intervención constante del educador.',
        result: 'El alumno demuestra que puede realizar un servicio inicial seguro, ordenado y profesional.',
      },
    ],
    // Metodología de cada clase: [bloque, duración, actividad].
    methodology: [
      ['Introducción teórica', '25 min', 'Objetivos y fundamentos del contenido.'],
      ['Demostración del educador', '45 min', 'Ejecución y explicación paso a paso.'],
      ['Práctica guiada', '35 min', 'Primer ejercicio con acompañamiento.'],
      ['Break', '15 min', 'Descanso.'],
      ['Práctica principal', '95 min', 'Aplicación individual y correcciones.'],
      ['Corrección y cierre', '25 min', 'Retroalimentación, registro y tarea de práctica.'],
    ],
    // Pauta de evaluación final: [criterio, ponderación %].
    evaluation: [
      ['Higiene y preparación', 10],
      ['Uso de herramientas', 10],
      ['Diagnóstico y planificación', 10],
      ['Construcción del degradado', 25],
      ['Conexión y zona superior', 15],
      ['Contornos y terminaciones', 10],
      ['Atención al cliente', 10],
      ['Orden y manejo del tiempo', 10],
    ],
    certification:
      'Para certificarte necesitas al menos 70% de logro en la evaluación final y 80% de asistencia al programa. El programa cierra con la evaluación práctica, retroalimentación individual y ceremonia de titulación.',
    evidences: [
      'Registro fotográfico del primer degradado y de las prácticas posteriores.',
      'Lista de cotejo de higiene y preparación de estación.',
      'Evaluación intermedia en la clase 8.',
      'Registro de dos atenciones a clientes reales.',
      'Plan personal de inicio como barbero.',
      'Simulacro cronometrado y evaluación práctica final.',
    ],
  },
  /* Método Brunetti (Bruno Herrera): el curso online que se vendía en
     brunetticutz.cl/cursos, con el temario de su ficha de entonces
     (src/data/content/cursos.json de BrunettiCutz): 6 módulos, 21 lecciones.
     Solo online y de por vida; el precio y 'a la venta' son los de la base
     (slug 'brunetti-metodo'). */
  {
    id: 'brunetti-metodo',
    name: 'Método Brunetti · Visagismo & Barbería',
    tagline: 'De cortar pelo a diseñar imagen',
    track: 'barberia',
    level: 'Online',
    unit: 'lección',
    // La misma portada que tiene el curso en la base (/assets/bruno-hero.jpg
    // está en los dos sitios).
    image: '/assets/bruno-hero.jpg',
    imageAlt: '/assets/estilo/estilo-fade-diseno.jpg',
    summary:
      'Aprende a leer el rostro, dominar la técnica y construir tu marca personal. 6 módulos pensados para barberos que quieren dejar de copiar tendencias y empezar a diseñar imagen.',
    long:
      'Bruno comparte el mismo método que aplica en su estudio: visagismo, técnica de precisión, dirección de estilo y construcción de marca personal. Un programa práctico para que eleves tu trabajo, tu imagen y tu negocio.',
    outcomes: [],
    presencial: null,
    online: { price: null, lessons: 21, hours: null, access: 'de por vida' },
    includes: [
      'Acceso de por vida a los 6 módulos, a tu ritmo',
      'Método de Visagismo Aplicado: lee proporciones y rasgos para decidir cada corte con criterio, no por moda.',
      'Técnica de Precisión: degradados, texturas y acabados explicados paso a paso.',
      'Marca Personal & Contenido: cómo mostrar tu trabajo y construir una identidad reconocible.',
      'Crecimiento & Negocio: mentalidad y orden para profesionalizar tu servicio.',
      'Comunidad de la Academy, clases en vivo y chat',
    ],
    requirements: null,
    modules: [
      {
        n: 1,
        title: 'Bienvenida',
        summary: 'Quién soy y qué vas a lograr aquí — el método, la comunidad y cómo aprovechar la Academy.',
      },
      {
        n: 2,
        title: 'El Protocolo Pre-Corte',
        summary: 'Por qué el 90% falla antes de tomar la máquina — las 5 preguntas que cambian la experiencia del cliente.',
      },
      {
        n: 3,
        title: 'El Sistema de Fade',
        summary: 'Low, mid y high fade desde cero — lectura del cráneo, ejecución y corrección de errores.',
      },
      {
        n: 4,
        title: 'El Orden del Corte',
        summary: 'Patrón de crecimiento, secciones y zonas anatómicas — un sistema que da resultados consistentes.',
      },
      {
        n: 5,
        title: 'Marca Personal',
        summary: 'Cómo posicionarte como EL barbero de tu ciudad — qué publicar y cómo documentar tu trabajo.',
      },
      {
        n: 6,
        title: 'Cómo Cobrar Más',
        summary: 'De $12.000 a $20.000 — el caso real de Brunetti, la mentalidad y el método paso a paso.',
      }
    ],
    malla: [
      { n: 1, module: 1, title: 'Mi historia como barbero — por qué creé esto' },
      { n: 2, module: 1, title: 'Qué vas a lograr en esta comunidad' },
      { n: 3, module: 1, title: 'Cómo usar la Academy en 3 minutos' },
      { n: 4, module: 2, title: 'El error que comete el 90% antes de cortar' },
      { n: 5, module: 2, title: 'Las 5 preguntas explicadas una por una' },
      { n: 6, module: 2, title: 'Las 5 preguntas en vivo con cliente real' },
      { n: 7, module: 2, title: 'Cómo el protocolo cambia lo que cobrás' },
      { n: 8, module: 3, title: 'Cómo leer el cráneo antes de empezar' },
      { n: 9, module: 3, title: 'Low fade — paso a paso' },
      { n: 10, module: 3, title: 'Mid fade y high fade — las diferencias clave' },
      { n: 11, module: 3, title: 'Cómo borrar manchas y líneas duras' },
      { n: 12, module: 4, title: 'Por qué el orden importa más que la técnica' },
      { n: 13, module: 4, title: 'Secciones anatómicas: occipital, parietal y temporal' },
      { n: 14, module: 4, title: 'El mapa del cráneo — zonas y orden de trabajo' },
      { n: 15, module: 5, title: 'El barbero que no se ve no existe' },
      { n: 16, module: 5, title: 'Qué publicar en TikTok e Instagram como barbero' },
      { n: 17, module: 5, title: 'Cómo documentar un corte en 60 segundos' },
      { n: 18, module: 6, title: 'Por qué los barberos cobran poco' },
      { n: 19, module: 6, title: 'El caso Brunetti — de $12.000 a $20.000' },
      { n: 20, module: 6, title: 'Cómo comunicar la subida sin perder clientes' },
      { n: 21, module: 6, title: 'Tu plan de los próximos 30 días' }
    ],
  },
]

export const courseById = (id) => ACADEMY_COURSES.find((c) => c.id === id) || null

/* Total de horas de un curso según la modalidad elegida. */
export function courseHours(course, modality) {
  return (modality === 'online' ? course.online?.hours : course.presencial?.hours) || 0
}

/* Precio de una modalidad. `null` = por definir; la UI lo rotula. */
export function coursePrice(course, modality) {
  const block = modality === 'online' ? course.online : course.presencial
  return block && typeof block.price === 'number' ? block.price : null
}

export const MODALITY_LABEL = { presencial: 'Presencial', online: 'Online' }
