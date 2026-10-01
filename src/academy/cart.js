/* ACADEMY — selección de cursos de la vitrina (localStorage)
   ------------------------------------------------------------------
   La unidad es el par (curso, modalidad): el mismo curso presencial y online
   son dos productos distintos. Sin cantidad: un curso no se compra "de a
   dos". Se paga de a un curso por vez (Mercado Pago), y el resto queda
   guardado acá en este dispositivo.

   La clave es la misma que leía src/academyStore.js de PimpStudio (una
   selección ya guardada sigue ahí) y la que limpia Gracias.jsx al volver de
   Mercado Pago. Compartido entre los dos sitios (scripts/academy-sync.mjs). */

const CART_KEY = 'ps_academy_cart'

const keyOf = (courseId, modality) => `${courseId}::${modality}`

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(CART_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function write(items) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(items)) } catch { /* sin storage: vive en memoria */ }
  return items
}

export function readCart() {
  return read()
}

export function addToCart(courseId, modality) {
  const items = read()
  if (items.some((i) => keyOf(i.courseId, i.modality) === keyOf(courseId, modality))) return items
  items.push({ courseId, modality, addedAt: new Date().toISOString() })
  return write(items)
}

export function removeFromCart(courseId, modality) {
  return write(read().filter((i) => keyOf(i.courseId, i.modality) !== keyOf(courseId, modality)))
}

export function inCart(items, courseId, modality) {
  return items.some((i) => keyOf(i.courseId, i.modality) === keyOf(courseId, modality))
}

export function clearCart() {
  return write([])
}
