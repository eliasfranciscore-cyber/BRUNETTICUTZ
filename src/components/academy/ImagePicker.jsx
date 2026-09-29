import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import { uploadImage } from '../../academy/upload.js'
import { isImageUrl, isLocalPreviewUrl } from '../../academy/url.js'
import '../../styles/academy/app.css'

/* ============================================================
   ImagePicker — elegir, comprimir y subir fotos (publicaciones, galería
   de "Acerca de", portadas, adjuntos privados del chat).

     <ImagePicker kind="post" max={4} value={images} onChange={setImages} />

   - `value`: [{ id, url, w, h, preview? }] — SOLO imágenes ya subidas. Las
     que están subiendo viven adentro del componente y aparecen en `value`
     recién cuando el servidor devolvió la URL: así un formulario nunca
     guarda una miniatura local creyendo que es la foto publicada.
   - Cada foto se re-codifica en un canvas antes de subir (upload.js): se
     pierden los EXIF (la ubicación GPS de la casa del alumno) y pesa menos.
   - Miniaturas: la URL del Blob si es una imagen permitida, o la vista
     previa local (dataURL / blob: de este navegador) para los adjuntos
     privados del chat, que el <img> no puede pedir sin el token.
   - `private`: sube con access 'private' (chat).
   - `onBusyChange(bool)`: avisa si hay subidas en curso (para deshabilitar
     "Publicar" mientras tanto).
   ============================================================ */

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif'
const cx = (...p) => p.filter(Boolean).join(' ')

let seq = 0

function thumbOf(item) {
  if (!item) return null
  if (item.preview && isLocalPreviewUrl(item.preview)) return item.preview
  if (item.url && isImageUrl(item.url)) return item.url
  return null
}

export default function ImagePicker({
  kind = 'post',
  max = 4,
  value,
  onChange,
  private: isPrivate = false,
  disabled = false,
  label = 'Agregar foto',
  onBusyChange,
  className,
}) {
  const inputId = useId()
  const inputRef = useRef(null)
  const list = Array.isArray(value) ? value.filter((v) => v && (v.url || v.preview)) : []
  // Lo ya confirmado, al día de forma síncrona: dos subidas que terminan casi
  // juntas no pueden pisarse porque el padre aún no re-renderizó con la
  // primera.
  const committed = useRef(list)
  useEffect(() => { committed.current = list }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const [pending, setPending] = useState([]) // [{ key, preview, error }]
  const alive = useRef(true)
  const objectUrls = useRef(new Set())

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      for (const u of objectUrls.current) URL.revokeObjectURL(u)
      objectUrls.current.clear()
    }
  }, [])

  const uploading = pending.some((p) => !p.error)
  const busyRef = useRef(onBusyChange)
  busyRef.current = onBusyChange
  useEffect(() => { busyRef.current?.(uploading) }, [uploading])

  const limit = Math.max(0, Number(max) || 0)
  const room = Math.max(0, limit - list.length - pending.filter((p) => !p.error).length)

  const commit = useCallback((item) => {
    const next = [...committed.current, item].slice(0, limit || undefined)
    committed.current = next
    onChange?.(next)
  }, [onChange, limit])

  const startUpload = useCallback(async (file, key) => {
    try {
      const up = await uploadImage(kind, file, { private: Boolean(isPrivate) })
      if (!alive.current) return
      if (!up || (!up.url && !up.id)) throw new Error('El servidor no devolvió la imagen.')
      setPending((ps) => ps.filter((p) => p.key !== key))
      commit({ id: up.id, url: up.url, w: up.w, h: up.h, preview: up.preview })
    } catch (err) {
      if (!alive.current) return
      const msg = err?.message || 'No se pudo subir la imagen.'
      setPending((ps) => ps.map((p) => (p.key === key ? { ...p, error: msg, file } : p)))
    }
  }, [kind, isPrivate, commit])

  const onFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean).slice(0, room)
    if (!files.length) return
    const added = files.map((file) => {
      let preview = null
      try {
        preview = URL.createObjectURL(file)
        objectUrls.current.add(preview)
      } catch { /* sin vista previa: igual se sube */ }
      return { key: `up-${++seq}`, preview, file, error: null }
    })
    setPending((ps) => [...ps, ...added])
    for (const p of added) startUpload(p.file, p.key)
  }

  const retry = (p) => {
    if (!p.file) return
    setPending((ps) => ps.map((x) => (x.key === p.key ? { ...x, error: null } : x)))
    startUpload(p.file, p.key)
  }

  const discard = (p) => {
    if (p.preview && objectUrls.current.has(p.preview)) {
      URL.revokeObjectURL(p.preview)
      objectUrls.current.delete(p.preview)
    }
    setPending((ps) => ps.filter((x) => x.key !== p.key))
  }

  const remove = (i) => {
    const next = committed.current.filter((_, k) => k !== i)
    committed.current = next
    onChange?.(next)
  }

  const errors = pending.filter((p) => p.error)

  return (
    <div className={cx('aca-imgpick', className)}>
      <ul className="aca-imgpick-grid">
        {list.map((item, i) => {
          const src = thumbOf(item)
          return (
            <li key={item.id ?? item.url ?? i} className="aca-imgpick-tile">
              {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className="aca-imgpick-ph"><Icon name="image" size={20} /></span>}
              {!disabled && (
                <button type="button" className="aca-imgpick-x" onClick={() => remove(i)} aria-label={`Quitar imagen ${i + 1}`}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </li>
          )
        })}
        {pending.map((p) => (
          <li key={p.key} className={cx('aca-imgpick-tile', p.error ? 'is-error' : 'is-uploading')}>
            {p.preview ? <img src={p.preview} alt="" /> : <span className="aca-imgpick-ph"><Icon name="image" size={20} /></span>}
            {p.error ? (
              <span className="aca-imgpick-over">
                <button type="button" className="aca-imgpick-retry" onClick={() => retry(p)} aria-label="Reintentar subida">
                  <Icon name="refresh" size={16} />
                </button>
              </span>
            ) : (
              <span className="aca-imgpick-over" role="status" aria-label="Subiendo imagen">
                <span className="aca-spinner" aria-hidden="true" />
              </span>
            )}
            <button type="button" className="aca-imgpick-x" onClick={() => discard(p)} aria-label="Descartar imagen">
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
        {room > 0 && !disabled && (
          <li className="aca-imgpick-tile is-add">
            <label htmlFor={inputId} className="aca-imgpick-add">
              <Icon name="camera" size={20} />
              <span>{label}</span>
              {limit > 1 && <small>{list.length + pending.filter((p) => !p.error).length}/{limit}</small>}
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept={ACCEPT}
              multiple={room > 1}
              className="aca-visually-hidden"
              onChange={(e) => {
                onFiles(e.target.files)
                // Permite volver a elegir la misma foto después de quitarla.
                e.target.value = ''
              }}
            />
          </li>
        )}
      </ul>
      {errors.length > 0 && (
        <p className="aca-imgpick-error" role="alert">
          {errors[errors.length - 1].error}
        </p>
      )}
    </div>
  )
}

export { ImagePicker }
