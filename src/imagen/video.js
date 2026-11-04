/* Video corto de antes/después de Brunetti Image Studio (solo el panel).

   No se puede mandar por la API como las fotos: una función de Vercel corta
   el cuerpo en 4,5 MB y 15 segundos de video pesan 15 MB o más. Por eso el
   navegador pide un token (?mode=imagen&videoToken=1, con la sesión del
   panel), sube el archivo directo al Blob privado con @vercel/blob/client y
   después lo registra (?mode=imagen&video=1), donde el servidor revisa que
   exista, su tipo y su peso. El SDK se carga recién al subir un video.

   Con el mock de desarrollo (VITE_DEV_MOCKS=1) no hay Blob: el video va en
   el JSON y queda en memoria. */

import { VIDEO_MAX_SECONDS, VIDEO_MAX_MB, VIDEO_TYPES } from './vocab.js'

const EXT = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }
const BY_NAME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }
const DEV_MOCK = import.meta.env.DEV && import.meta.env.VITE_DEV_MOCKS === '1'

// Algunos navegadores dejan vacío el tipo de un .mov: se deduce del nombre.
function typeOf(file) {
  const t = String(file.type || '').toLowerCase()
  if (VIDEO_TYPES.includes(t)) return t
  if (t === 'video/x-m4v') return 'video/mp4'
  return BY_NAME[String(file.name || '').split('.').pop().toLowerCase()] || ''
}

// Duración leída del propio archivo. null si el navegador no la sabe leer
// (un HEVC en Chrome de Windows, por ejemplo): entonces no se bloquea.
function durationOf(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    const done = (value) => { URL.revokeObjectURL(url); resolve(value) }
    const timer = setTimeout(() => done(null), 8000)
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => { clearTimeout(timer); done(Number.isFinite(v.duration) ? v.duration : null) }
    v.onerror = () => { clearTimeout(timer); done(null) }
    v.src = url
  })
}

export async function checkVideo(file) {
  if (!file) throw new Error('Elige un video')
  const contentType = typeOf(file)
  if (!contentType) throw new Error('El video tiene que ser MP4, MOV o WebM')
  if (file.size > VIDEO_MAX_MB * 1024 * 1024) {
    throw new Error(`El video pesa más de ${VIDEO_MAX_MB} MB. Grábalo en 1080p o más corto.`)
  }
  const seconds = await durationOf(file)
  if (seconds != null && seconds > VIDEO_MAX_SECONDS + 0.5) {
    throw new Error(`El video dura ${Math.round(seconds)} s: el máximo es ${VIDEO_MAX_SECONDS} s.`)
  }
  return { contentType, ext: EXT[contentType] }
}

function asDataUrl(file, contentType) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]*;/, `data:${contentType};`))
    reader.onerror = () => reject(new Error('No se pudo leer el video'))
    reader.readAsDataURL(file)
  })
}

export async function uploadVideo({ file, id, slot, api, call, authHeaders, onProgress }) {
  const { contentType, ext } = await checkVideo(file)
  if (DEV_MOCK) {
    const dataUrl = await asDataUrl(file, contentType)
    return call(`${api}&video=1`, { method: 'POST', body: { id, slot, dataUrl } })
  }
  const { upload } = await import('@vercel/blob/client')
  let blob
  try {
    blob = await upload(`imagen/${id}/${slot}.${ext}`, file, {
      access: 'private',
      contentType,
      handleUploadUrl: `${api}&videoToken=1`,
      headers: authHeaders(),
      clientPayload: JSON.stringify({ id, slot }),
      multipart: file.size > 10 * 1024 * 1024,
      onUploadProgress: ({ percentage }) => onProgress?.(Math.round(percentage)),
    })
  } catch (err) {
    console.error('imagen: no se subió el video:', err)
    throw new Error('No se pudo subir el video. Revisa la conexión y prueba de nuevo.')
  }
  return call(`${api}&video=1`, { method: 'POST', body: { id, slot, url: blob.url } })
}
