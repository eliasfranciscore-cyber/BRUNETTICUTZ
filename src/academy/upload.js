/* ACADEMY — subida de imágenes
   ------------------------------------------------------------------
   Mismo patrón que los productos del panel: la imagen viaja como dataURL en
   JSON a nuestra API, que valida los bytes y la guarda con @vercel/blob put().
   Nada de subir directo al Blob desde el navegador (@vercel/blob/client): eso
   obligaría a abrir el host del Blob en connect-src del CSP de la Academy.

   Siempre se RE-CODIFICA en un canvas, aunque la foto ya sea chica: así se
   pierden los metadatos EXIF (la ubicación GPS de una foto tomada en la casa
   del alumno no puede terminar publicada en el feed) y el servidor, que
   rechaza JPEG con bloque Exif, nunca la rebota. WebP si el navegador sabe
   codificarlo; si no (Safari), JPEG. */

import { academyApi, ApiError } from './api.js'

const MAX_INPUT_BYTES = 30 * 1024 * 1024
// El servidor acepta ≤ 2 MB decodificados; se apunta más abajo por margen.
const TARGET_BYTES = 1.6 * 1024 * 1024

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result || ''))
    fr.onerror = () => reject(fr.error || new Error('No se pudo leer el archivo'))
    fr.readAsDataURL(blob)
  })
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch { /* Safari viejo no acepta opciones: se intenta con <img> */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
    img.src = url
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob((b) => resolve(b), type, quality)
    else resolve(null)
  })
}

async function encode(source, srcW, srcH, max, quality) {
  const scale = Math.min(1, max / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  // Fondo blanco: un PNG con transparencia pasado a JPEG quedaría negro.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  let blob = await canvasToBlob(canvas, 'image/webp', quality)
  if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', quality)
  if (!blob) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    return { dataUrl, w, h, bytes: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75) }
  }
  return { dataUrl: await readAsDataUrl(blob), w, h, bytes: blob.size }
}

/* compressImageInfo(file, { max, quality }) → { dataUrl, w, h, bytes } */
export async function compressImageInfo(file, { max = 1280, quality = 0.82 } = {}) {
  if (!file || !(file instanceof Blob)) throw new Error('Elige una imagen.')
  if (file.type && !file.type.startsWith('image/')) throw new Error('Ese archivo no es una imagen.')
  if (file.size > MAX_INPUT_BYTES) throw new Error('La imagen pesa demasiado (máximo 30 MB).')
  let source
  try {
    source = await decode(file)
  } catch {
    throw new Error('No pudimos leer esa imagen. Prueba con una foto JPG o PNG.')
  }
  const srcW = source.width || source.naturalWidth
  const srcH = source.height || source.naturalHeight
  if (!srcW || !srcH) throw new Error('No pudimos leer esa imagen. Prueba con una foto JPG o PNG.')
  try {
    let out = await encode(source, srcW, srcH, max, quality)
    // Si quedó pesada (foto muy detallada), se baja calidad y luego tamaño.
    if (out.bytes > TARGET_BYTES) out = await encode(source, srcW, srcH, max, 0.68)
    if (out.bytes > TARGET_BYTES) out = await encode(source, srcW, srcH, Math.round(max * 0.75), 0.68)
    if (out.bytes > TARGET_BYTES) throw new Error('La imagen es demasiado pesada incluso comprimida.')
    return out
  } finally {
    try { source.close?.() } catch { /* ImageBitmap ya liberado */ }
  }
}

/* compressImage(file, opts) → dataURL (webp, o jpeg en Safari). */
export async function compressImage(file, opts) {
  return (await compressImageInfo(file, opts)).dataUrl
}

/* uploadImage('post', file, { private: false }) → { id, url, w, h, preview }
   `preview` es el dataURL local (sirve para mostrar un adjunto privado del
   chat sin volver a pedirlo al proxy). Lanza Error/ApiError con un mensaje
   listo para mostrar. */
export async function uploadImage(kind, file, { private: isPrivate = false, max, quality } = {}) {
  const img = await compressImageInfo(file, { max, quality })
  try {
    const res = await academyApi('upload', {
      method: 'POST',
      body: { kind, dataUrl: img.dataUrl, private: Boolean(isPrivate) },
      timeoutMs: 90000,
    })
    const up = res.upload || {}
    return { id: up.id ?? null, url: up.url ?? null, w: img.w, h: img.h, preview: img.dataUrl }
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) throw new ApiError(429, e.code, e.message || 'Llegaste al límite de subidas por hoy. Intenta mañana.', e.data)
    throw e
  }
}
