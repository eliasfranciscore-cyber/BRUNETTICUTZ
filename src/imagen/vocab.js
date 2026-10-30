/* Brunetti Image Studio — vocabulario compartido.
   Lo usan el panel (src/pages/panel/ImagenTab.jsx), el formulario público
   (src/pages/AsesoriaDatos.jsx) y la API (api/_imagen*.js), así una opción
   nueva aparece igual en los tres. Solo datos: sin JSX ni imports, porque
   también se carga desde Node. */

export const MODALITIES = [
  { id: 'presencial', label: 'Presencial', hint: 'En la barbería, con Bruno' },
  { id: 'online', label: 'Online', hint: 'Con tus fotos y respuestas' },
]

export const STATUSES = [
  { id: 'pago_pendiente', label: 'Pago pendiente', tone: 'muted' },
  { id: 'datos_pendientes', label: 'Datos pendientes', tone: 'warn' },
  { id: 'en_revision', label: 'Por revisar', tone: 'info' },
  { id: 'informe_listo', label: 'Informe listo', tone: 'accent' },
  { id: 'entregada', label: 'Entregada', tone: 'ok' },
  { id: 'cancelada', label: 'Cancelada', tone: 'bad' },
]

export const PAYMENT_STATUSES = [
  { id: 'pendiente', label: 'Sin pagar' },
  { id: 'pagada', label: 'Pagada' },
  { id: 'en_local', label: 'Cobro aparte' }, // en el local o por transferencia, fuera de la web
]

// Fotos de diagnóstico: frontal, ambos perfiles y posterior (+ superior si hace falta).
export const ANGLES = [
  { id: 'frontal', label: 'Frontal', hint: 'De frente, mirando a la cámara, con el pelo como lo usas.', required: true },
  { id: 'perfil_izq', label: 'Perfil izquierdo', hint: 'De lado, con la oreja izquierda hacia la cámara.', required: true },
  { id: 'perfil_der', label: 'Perfil derecho', hint: 'De lado, con la oreja derecha hacia la cámara.', required: true },
  { id: 'posterior', label: 'Posterior', hint: 'Desde atrás, a la altura de la nuca (que te ayude alguien).', required: true },
  { id: 'superior', label: 'Superior', hint: 'Opcional: la coronilla desde arriba.', required: false },
]

export const PHOTO_TIPS = [
  'Luz natural de frente (junto a una ventana), sin contraluz.',
  'Sin filtros, sin modo retrato y sin gorro ni lentes.',
  'Pelo seco y peinado como lo llevas a diario.',
  'Cámara a la altura de la cara, a un brazo de distancia.',
]

/* ---------- ficha de ingreso (lo que declara el cliente) ---------- */
export const INTAKE = {
  style: { label: 'Estilo que te representa', options: ['Clásico', 'Moderno', 'Natural', 'Atrevido'] },
  styleTime: { label: 'Tiempo que le dedicas a peinarte', options: ['Nada', 'Hasta 5 minutos', 'Más de 5 minutos'] },
  finish: { label: 'Acabado que prefieres', options: ['Mate', 'Natural', 'Con brillo'] },
  length: { label: 'Largo', options: ['Más corto', 'Mantener', 'Dejar crecer'] },
  washFreq: { label: '¿Cada cuánto te lavas el pelo?', options: ['A diario', 'Día por medio', '2 a 3 veces por semana', '1 vez por semana o menos'] },
  water: { label: 'Temperatura del agua', options: ['Caliente', 'Tibia', 'Fría'] },
  drying: { label: 'Cómo te secas el pelo', options: ['Toalla', 'Al aire', 'Secador'] },
  needs: {
    label: 'Lo que notas en tu pelo',
    options: ['Grasa', 'Resequedad', 'Caspa', 'Frizz', 'Caída', 'Cuero cabelludo sensible', 'Poco volumen', 'Canas o pelo teñido'],
  },
}

/* ---------- diagnóstico (lo registra Bruno) ---------- */
export const SKULL = {
  occipital: { label: 'Zona occipital', options: ['Plana', 'Normal', 'Prominente'] },
  projection: { label: 'Proyección posterior', options: ['Baja', 'Media', 'Alta'] },
  height: { label: 'Altura del cráneo', options: ['Baja', 'Media', 'Alta'] },
  sides: { label: 'Proporciones laterales', options: ['Estrechas', 'Equilibradas', 'Anchas'] },
}

export const HAIR = {
  type: { label: 'Tipo de cabello', options: ['Liso', 'Ondulado', 'Rizado', 'Crespo'] },
  thickness: { label: 'Grosor', options: ['Fino', 'Medio', 'Grueso'] },
  density: { label: 'Densidad', options: ['Baja', 'Media', 'Alta'] },
  condition: { label: 'Condición', options: ['Normal', 'Seco', 'Graso', 'Mixto'] },
  frizz: { label: 'Frizz', options: ['No', 'Leve', 'Moderado', 'Alto'] },
  volume: { label: 'Volumen', options: ['Bajo', 'Medio', 'Alto'] },
  porosity: { label: 'Porosidad', options: ['Baja', 'Media', 'Alta', 'No evaluada'] },
  sensitivity: { label: 'Cuero cabelludo sensible', options: ['No', 'Sí'] },
  loss: { label: 'Caída percibida', options: ['No', 'Leve', 'Moderada', 'Alta'] },
}

// Qué declaró el cliente que se relaciona con cada campo del diagnóstico capilar.
export const HAIR_FROM_INTAKE = {
  condition: ['Grasa', 'Resequedad'],
  frizz: ['Frizz'],
  volume: ['Poco volumen'],
  sensitivity: ['Cuero cabelludo sensible'],
  loss: ['Caída'],
}

/* ---------- catálogo ---------- */
export const CATEGORY_GROUPS = [
  { id: 'peinado', label: 'Peinado' },
  { id: 'champu', label: 'Champú' },
  { id: 'acondicionador', label: 'Acondicionador' },
]

export const CATEGORIES = [
  { id: 'pomada', label: 'Pomada', group: 'peinado' },
  { id: 'cera', label: 'Cera', group: 'peinado' },
  { id: 'arcilla', label: 'Arcilla / clay', group: 'peinado' },
  { id: 'polvo', label: 'Polvo texturizador', group: 'peinado' },
  { id: 'crema', label: 'Crema de peinado', group: 'peinado' },
  { id: 'gel', label: 'Gel', group: 'peinado' },
  { id: 'spray', label: 'Spray fijador', group: 'peinado' },
  { id: 'sea_salt', label: 'Sea salt spray', group: 'peinado' },
  { id: 'champu', label: 'Champú', group: 'champu' },
  { id: 'acondicionador', label: 'Acondicionador', group: 'acondicionador' },
]

export const HOLDS = ['Baja', 'Media', 'Alta']
export const SHINES = ['Mate', 'Natural', 'Alto']
export const HAIR_TYPES = HAIR.type.options
export const THICKNESSES = HAIR.thickness.options
export const CONDITIONS = HAIR.condition.options
// Para qué está indicado un champú o acondicionador.
export const PRODUCT_NEEDS = [
  'Cabello graso', 'Hidratante', 'Cabello seco', 'Uso diario', 'Anticaspa', 'Cuero cabelludo sensible',
  'Limpieza profunda', 'Reparador', 'Cabello fino', 'Cabello grueso', 'Rizos', 'Cabello teñido', 'Frizz', 'Volumen',
]

/* ---------- recomendaciones ---------- */
export const REC_KINDS = [
  { id: 'corte', label: 'Cortes recomendados', single: 'Corte' },
  { id: 'evitar', label: 'Conviene evitar', single: 'Evitar' },
  { id: 'peinado', label: 'Productos de peinado', single: 'Peinado', product: true },
  { id: 'champu', label: 'Champú', single: 'Champú', product: true },
  { id: 'acondicionador', label: 'Acondicionador', single: 'Acondicionador', product: true },
  { id: 'rutina', label: 'Rutina de lavado', single: 'Rutina' },
  { id: 'consejo', label: 'Consejos', single: 'Consejo' },
  { id: 'mantenimiento', label: 'Plan de mantenimiento', single: 'Mantenimiento' },
]

// Qué categorías del catálogo valen para cada tipo de recomendación de producto.
export const KIND_GROUP = { peinado: 'peinado', champu: 'champu', acondicionador: 'acondicionador' }

export const labelOf = (list, id) => list.find((x) => x.id === id)?.label || id || ''

// sessionStorage: el token que /asesoria guarda antes de ir a Mercado Pago y
// que /asesoria/gracias lee a la vuelta.
export const CHECKOUT_KEY = 'bc_asesoria_checkout'

// Versión del texto de consentimiento (se guarda junto a la fecha).
export const CONSENT_VERSION = '2026-10'
