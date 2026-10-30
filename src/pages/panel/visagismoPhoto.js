/* Foto del antes / después del brief de visagismo → dataURL JPEG.

   Siempre se vuelve a codificar en un canvas, como en src/academy/upload.js
   (que no se toca acá: es código compartido con PimpStudio y el sync lo
   pisaría). Dos diferencias con aquel:
     - Siempre JPEG, nunca WebP: el PDF lo arma pdf-lib en el servidor y
       pdf-lib no sabe leer WebP.
     - Un poco más grande (1600 px): la foto va a media plana de un A4.
   Re-codificar también saca el EXIF (la ubicación GPS de la foto) y endereza
   la orientación del iPhone. Un HEIC lo decodifica Safari; si el navegador
   no puede, se avisa en vez de mandar algo que el servidor va a rechazar. */

const MAX_SIDE = 1600
const QUALITY = 0.85

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

export async function photoToJpeg(file) {
  if (!file) throw new Error('Elige una foto')
  if (file.size > 30 * 1024 * 1024) throw new Error('La foto es demasiado grande')
  let source
  try {
    source = await decode(file)
  } catch {
    throw new Error('No se pudo leer la foto. Prueba con otra (JPG o PNG).')
  }
  const srcW = source.width || source.naturalWidth
  const srcH = source.height || source.naturalHeight
  const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(srcW * scale))
  canvas.height = Math.max(1, Math.round(srcH * scale))
  const ctx = canvas.getContext('2d')
  // Fondo blanco: un PNG con transparencia pasado a JPEG quedaría negro.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  if (typeof source.close === 'function') source.close()
  return canvas.toDataURL('image/jpeg', QUALITY)
}
