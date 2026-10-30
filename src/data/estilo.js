/* ============================================================
   ENCUENTRA TU ESTILO — datos del módulo
   Visagismo interactivo + galería de estilos · Brunetti
   Fotos reales del estudio (fondo blanco). Cada una degrada a
   un placeholder con etiqueta si no carga (ver SmartImg).
   ============================================================ */

// helper de URL local de assets del módulo
export const u = (name) => `/assets/estilo/${name}`

// ---- FORMAS DE ROSTRO (paso 1 del workflow) ----
// path = silueta SVG simple dentro de viewBox 0 0 100 120
// tips = consejos que el Image Studio del panel ofrece como sugerencias para el
//        informe (Bruno los aprueba o descarta; /style no los muestra)
// El orden importa: content/estilo.json → faceShapes se empareja por índice.
export const FACE_SHAPES = [
  {
    id: 'ovalado',
    name: 'Ovalado',
    tagline: 'El equilibrio natural',
    path: 'M50 6 C72 6 84 30 84 60 C84 92 70 114 50 114 C30 114 16 92 16 60 C16 30 28 6 50 6 Z',
    traits: ['Frente y mandíbula proporcionadas', 'Largo mayor que el ancho', 'Líneas suaves'],
    diagnosis:
      'El rostro más versátil. Las proporciones ya están equilibradas, así que casi cualquier corte funciona — el objetivo es resaltar tu estilo, no corregir.',
    goal: 'Mantener la armonía y jugar con la personalidad.',
    best: [
      { name: 'Texturizado medio', img: u('estilo-crop-texturizado.jpg'), note: 'Movimiento natural sin perder estructura.' },
      { name: 'Fade clásico', img: u('estilo-skin-fade.jpg'), note: 'Limpio en los lados, definido arriba.' },
      { name: 'Pompadour suave', img: u('estilo-pompadour-clasico.jpg'), note: 'Volumen frontal para un aire elegante.' },
    ],
    avoid: 'Flequillos muy pesados que tapen la frente y rompan la proporción.',
    tips: [
      'Tu rostro admite casi todo: cambia de largo o textura según la temporada.',
      'Mantén los lados limpios y repásalos cada 3 a 4 semanas.',
      'Una pasta de fijación media da movimiento sin endurecer el pelo.',
    ],
  },
  {
    id: 'redondo',
    name: 'Redondo',
    tagline: 'Suavidad que pide ángulos',
    path: 'M50 8 C76 8 90 30 90 60 C90 90 76 112 50 112 C24 112 10 90 10 60 C10 30 24 8 50 8 Z',
    traits: ['Ancho y largo similares', 'Mejillas llenas', 'Mandíbula redondeada'],
    diagnosis:
      'Buscamos crear altura y ángulos para estilizar el rostro. Volumen arriba y lados más cerrados alargan visualmente la cara.',
    goal: 'Añadir altura y definición vertical.',
    best: [
      { name: 'Pompadour / Quiff', img: u('estilo-pompadour-color.jpg'), note: 'Altura arriba que estiliza el conjunto.' },
      { name: 'Undercut con volumen', img: u('estilo-fade-clasico.jpg'), note: 'Contraste marcado lados-tope.' },
      { name: 'Fade alto', img: u('estilo-crop-texturizado-oscuro.jpg'), note: 'Cierra los lados y sube la mirada.' },
    ],
    avoid: 'Cortes redondeados y volumen a los costados — ensanchan aún más.',
    tips: [
      'Seca con secador de abajo hacia arriba para ganar altura.',
      'Usa pasta o cera mate: el brillo aplana y redondea.',
      'Lados cortos y repasados cada 3 semanas para mantener el efecto vertical.',
    ],
  },
  {
    id: 'cuadrado',
    name: 'Cuadrado',
    tagline: 'Mandíbula de carácter',
    path: 'M22 10 L78 10 Q86 10 86 22 L86 92 Q86 112 66 112 L34 112 Q14 112 14 92 L14 22 Q14 10 22 10 Z',
    traits: ['Mandíbula marcada y ancha', 'Frente angular', 'Líneas fuertes'],
    diagnosis:
      'Una estructura fuerte que admite cortes potentes. Podemos exaltar la mandíbula o suavizarla según el resultado que busques.',
    goal: 'Resaltar la fuerza o equilibrar con textura.',
    best: [
      { name: 'Crop texturizado', img: u('estilo-crop-rizado.jpg'), note: 'Textura arriba que moderna la estructura.' },
      { name: 'Buzz / corte corto', img: u('estilo-textura-spiky.jpg'), note: 'Limpio, deja hablar a la mandíbula.' },
      { name: 'Fade + barba definida', img: u('estilo-textura-barba.jpg'), note: 'Combo de carácter, muy fotogénico.' },
    ],
    avoid: 'Volúmenes extremos que exageren demasiado la angulosidad.',
    tips: [
      'Un poco de textura arriba suaviza la mandíbula marcada.',
      'Evita las líneas demasiado rectas en la frente: mejor un borde natural.',
      'Una barba corta y prolija acompaña los ángulos sin endurecerlos.',
    ],
  },
  {
    // id histórico; el documento de Image Studio lo llama "rectangular".
    id: 'alargado',
    name: 'Rectangular',
    tagline: 'Vertical y elegante',
    path: 'M50 6 C70 6 80 26 80 56 C80 96 68 116 50 116 C32 116 20 96 20 56 C20 26 30 6 50 6 Z',
    traits: ['Rostro más largo que ancho', 'Frente alta', 'Mentón alargado'],
    diagnosis:
      'El objetivo es acortar visualmente el rostro: menos altura arriba y algo de volumen a los lados crean equilibrio.',
    goal: 'Restar largo y sumar ancho.',
    best: [
      { name: 'Flequillo / French crop', img: u('estilo-flequillo-largo.jpg'), note: 'Baja la frente y acorta el rostro.' },
      { name: 'Lados con cuerpo', img: u('estilo-mullet-shag.jpg'), note: 'Algo de volumen lateral para ensanchar.' },
      { name: 'Barba media', img: u('estilo-barba-canosa.jpg'), note: 'Da peso al tercio inferior.' },
    ],
    avoid: 'Mucho volumen arriba y lados rapados al cero — alargan más.',
    tips: [
      'Deja algo de largo a los costados para dar ancho visual.',
      'Un flequillo o un peinado hacia adelante acorta la frente.',
      'Peina con los dedos y producto liviano: volumen controlado, no altura.',
    ],
  },
  {
    id: 'triangular',
    name: 'Triangular',
    tagline: 'Base fuerte, frente fina',
    path: 'M50 8 C62 8 70 22 72 40 L86 104 Q88 112 78 112 L22 112 Q12 112 14 104 L28 40 C30 22 38 8 50 8 Z',
    traits: ['Mandíbula ancha', 'Frente más estrecha', 'Pómulos discretos'],
    diagnosis:
      'Compensamos llevando volumen y amplitud a la zona superior, para equilibrar una mandíbula más ancha que la frente.',
    goal: 'Sumar volumen en la parte alta.',
    best: [
      { name: 'Volumen arriba', img: u('estilo-side-part.jpg'), note: 'Ensancha la frente ópticamente.' },
      { name: 'Pompadour', img: u('estilo-pompadour-clasico.jpg'), note: 'Altura y cuerpo en el tope.' },
      { name: 'Lados moderados', img: u('estilo-crop-rizado-corto.jpg'), note: 'Ni muy abiertos ni rapados.' },
    ],
    avoid: 'Lados muy voluminosos que ensanchen aún más la mandíbula.',
    tips: [
      'Suma volumen arriba para equilibrar una mandíbula más ancha.',
      'Lados más cerrados, degradados suaves, sin cortes bruscos.',
      'Una barba perfilada en el mentón ayuda a afinar la línea inferior.',
    ],
  },
  {
    id: 'diamante',
    name: 'Diamante',
    tagline: 'Pómulos protagonistas',
    path: 'M50 6 L74 38 C82 50 82 62 72 78 L54 110 Q50 116 46 110 L28 78 C18 62 18 50 26 38 Z',
    traits: ['Pómulos anchos', 'Frente y mentón más estrechos', 'Rasgos definidos'],
    diagnosis:
      'Aprovechamos los pómulos marcados. Damos amplitud a frente y mentón para equilibrar el centro más ancho.',
    goal: 'Ensanchar frente y mentón.',
    best: [
      { name: 'Flequillo texturizado', img: u('estilo-mullet-rizado.jpg'), note: 'Suma ancho en la frente.' },
      { name: 'Volumen frontal', img: u('estilo-pompadour-color.jpg'), note: 'Equilibra el tercio superior.' },
      { name: 'Barba en la mandíbula', img: u('estilo-barba-canosa.jpg'), note: 'Da peso y ancho al mentón.' },
    ],
    avoid: 'Lados rapados al extremo que estrechen el rostro.',
    tips: [
      'Deja algo de largo en los lados para ensanchar la frente y el mentón.',
      'Un flequillo texturizado suaviza los pómulos marcados.',
      'Una barba con algo de cuerpo en el mentón equilibra el rostro.',
    ],
  },
  {
    // Textos por revisar con Bruno (2026-10-30).
    id: 'corazon',
    name: 'Corazón',
    tagline: 'Frente amplia, mentón fino',
    path: 'M50 112 C40 104 22 86 17 64 C13 46 14 26 24 14 C30 8 40 6 50 6 C60 6 70 8 76 14 C86 26 87 46 83 64 C78 86 60 104 50 112 Z',
    traits: ['Frente ancha', 'Pómulos marcados', 'Mentón estrecho'],
    diagnosis:
      'Equilibramos una frente más ancha que la mandíbula: menos volumen arriba y algo de peso en la zona baja suavizan el contraste.',
    goal: 'Restar ancho a la frente y dar cuerpo al mentón.',
    best: [
      { name: 'Flequillo ligero', img: u('estilo-flequillo-largo.jpg'), note: 'Cubre parte de la frente y la suaviza.' },
      { name: 'Texturizado medio', img: u('estilo-crop-texturizado.jpg'), note: 'Movimiento sin sumar altura.' },
      { name: 'Barba con cuerpo', img: u('estilo-textura-barba.jpg'), note: 'Da ancho y peso al mentón.' },
    ],
    avoid: 'Mucho volumen arriba o peinados hacia atrás que dejan la frente al descubierto.',
    tips: [
      'Peina hacia adelante o de lado para restar ancho a la frente.',
      'Mantén algo de largo a los lados: un fade muy alto agranda la parte de arriba.',
      'Una barba con cuerpo en el mentón equilibra el rostro.',
    ],
  },
]

// ---- FOTOS del hero (carrusel) ----
export const HERO_PHOTOS = [
  'estilo-mullet-rizado.jpg',
  'estilo-fade-clasico.jpg',
  'estilo-pompadour-color.jpg',
  'estilo-crop-rizado.jpg',
  'estilo-side-part.jpg',
  'estilo-textura-barba.jpg',
  'estilo-flequillo-largo.jpg',
  'estilo-crop-texturizado-oscuro.jpg',
  'estilo-mullet-shag.jpg',
  'estilo-crop-plata.jpg',
  'estilo-fade-diseno.jpg',
  'estilo-pompadour-clasico.jpg',
  'estilo-crop-rizado-corto.jpg',
  'estilo-skin-fade.jpg',
  'estilo-barba-canosa.jpg',
  'estilo-textura-spiky.jpg',
  'estilo-fade-diseno-plata.jpg',
  'estilo-crop-texturizado.jpg',
]

// ---- GALERÍA por tipo de corte ----
export const GALLERY_CATS = ['Todos', 'Fade', 'Texturizado', 'Clásico', 'Largo', 'Barba']
export const GALLERY = [
  { cat: 'Fade', title: 'Skin fade', sub: 'Degradado al cero', img: u('estilo-skin-fade.jpg') },
  { cat: 'Fade', title: 'Mid fade + diseño', sub: 'Línea marcada', img: u('estilo-fade-diseno.jpg') },
  { cat: 'Texturizado', title: 'Crop texturizado', sub: 'Movimiento natural', img: u('estilo-crop-texturizado.jpg') },
  { cat: 'Clásico', title: 'Side part', sub: 'Elegancia atemporal', img: u('estilo-side-part.jpg') },
  { cat: 'Barba', title: 'Perfilado de barba', sub: 'Contorno definido', img: u('estilo-barba-canosa.jpg') },
  { cat: 'Fade', title: 'Taper en la nuca', sub: 'Acabado limpio', img: u('estilo-mullet-shag.jpg') },
  { cat: 'Barba', title: 'Afeitado a navaja', sub: 'Ritual clásico', img: u('estilo-fade-clasico.jpg') },
  { cat: 'Clásico', title: 'Corte ejecutivo', sub: 'Pulcro y prolijo', img: u('estilo-crop-plata.jpg') },
  { cat: 'Largo', title: 'Largo con textura', sub: 'Caída con cuerpo', img: u('estilo-flequillo-largo.jpg') },
  { cat: 'Barba', title: 'Barba escultural', sub: 'Trabajo de detalle', img: u('estilo-textura-barba.jpg') },
  { cat: 'Texturizado', title: 'Quiff texturizado', sub: 'Volumen direccional', img: u('estilo-pompadour-color.jpg') },
  { cat: 'Clásico', title: 'El estudio', sub: 'Ambiente Brunetti', img: u('estilo-fade-diseno-plata.jpg') },
]
