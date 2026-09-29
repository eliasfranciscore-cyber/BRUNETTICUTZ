import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../academy/Icon.jsx'
import { Button, Sheet, Field, InlineAlert } from '../../../components/panel/index.js'
import { academyApi } from '../../../academy/api.js'
import { useAcademyQuery } from '../../../academy/useQuery.js'
import { useAcademy } from '../../../academy/context.js'
import { isImageUrl } from '../../../academy/url.js'
import { parseYouTubeId, embedUrl, thumbUrl } from '../../../academy/youtube.js'
import { ACADEMY_BRAND } from '../../../academy/hostConfig.js'
import PageState from '../../../components/academy/PageState.jsx'
import MemberAvatar from '../../../components/academy/MemberAvatar.jsx'
import ImagePicker from '../../../components/academy/ImagePicker.jsx'
import GroupCard from '../../../components/academy/GroupCard.jsx'
import '../../../styles/academy/cursos.css'

/* ============================================================
   Pestaña "Acerca de" (captura 5): título, galería de imágenes y videos,
   la fila "🔒 Privado · N miembros · Pago único · Por <dueño>", la
   descripción en texto plano (Skool tampoco deja links ahí) y, a la derecha,
   la tarjeta del grupo (GroupCard, de FE-MIEMBROS).

   Datos: mode `about` (público, cacheado 5 min en la CDN). Por esa caché,
   después de guardar la galería se actualiza la copia local con lo que
   devuelve admin-settings en vez de volver a pedir `about`.

   Galería (settings.group.media, ≤12): {kind:'image', url} solo si la URL es
   del Blob del proyecto o /assets/ (isImageUrl); {kind:'youtube', videoId}
   solo con un id válido de 11 caracteres. Lo demás no se pinta.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')
const MAX_MEDIA = 12

function cleanMedia(list) {
  return (Array.isArray(list) ? list : [])
    .map((m) => {
      if (!m || typeof m !== 'object') return null
      if (m.kind === 'youtube') {
        const id = parseYouTubeId(String(m.videoId || ''))
        return id ? { kind: 'youtube', videoId: id } : null
      }
      if (m.kind === 'image' && m.url && isImageUrl(m.url)) return { kind: 'image', url: m.url }
      return null
    })
    .filter(Boolean)
    .slice(0, MAX_MEDIA)
}

function mediaThumb(m) {
  return m.kind === 'youtube' ? thumbUrl(m.videoId) : m.url
}

function fmtCount(n) {
  const v = Math.max(0, Number(n) || 0)
  try { return new Intl.NumberFormat('es-CL').format(v) } catch { return String(v) }
}

/* ---------- Visor ampliado ---------- */
function Lightbox({ items, index, onIndex, onClose }) {
  const open = index != null && items[index]
  const m = open ? items[index] : null
  const n = items.length
  useEffect(() => {
    if (!open || n < 2) return undefined
    const onKey = (e) => {
      if (e.key === 'ArrowRight') onIndex((index + 1) % n)
      if (e.key === 'ArrowLeft') onIndex((index - 1 + n) % n)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, index, n, onIndex])

  return (
    <Sheet
      open={Boolean(open)}
      onClose={onClose}
      size="xl"
      title={n > 1 ? `${(index ?? 0) + 1} de ${n}` : 'Galería'}
      bodyClassName="aca-alightbox-body"
    >
      {m && (
        <div className="aca-alightbox">
          {m.kind === 'youtube' ? (
            <div className="aca-alightbox-video">
              <iframe
                key={m.videoId}
                src={embedUrl(m.videoId, { autoplay: true })}
                title="Video de la galería"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          ) : (
            <img className="aca-alightbox-img" src={m.url} alt="" decoding="async" />
          )}
          {n > 1 && (
            <>
              <button type="button" className="aca-alightbox-nav is-prev" aria-label="Anterior" onClick={() => onIndex((index - 1 + n) % n)}>
                <Icon name="chevronLeft" size={22} />
              </button>
              <button type="button" className="aca-alightbox-nav is-next" aria-label="Siguiente" onClick={() => onIndex((index + 1) % n)}>
                <Icon name="chevronRight" size={22} />
              </button>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}

/* ---------- Galería (carrusel + miniaturas) ---------- */
function MediaGallery({ items, canEdit, onEdit, fallbackCover }) {
  const [i, setI] = useState(0)
  const [zoom, setZoom] = useState(null)
  const touch = useRef(null)
  const n = items.length
  useEffect(() => { if (i >= n) setI(0) }, [n, i])

  if (!n) {
    if (canEdit) {
      return (
        <button type="button" className="aca-amedia-stage is-empty" onClick={onEdit}>
          <Icon name="upload" size={22} />
          <span>Subir imágenes / videos</span>
        </button>
      )
    }
    if (fallbackCover) {
      return (
        <div className="aca-amedia-stage">
          <img src={fallbackCover} alt="" decoding="async" />
        </div>
      )
    }
    return null
  }

  const cur = items[Math.min(i, n - 1)]
  const go = (d) => setI((v) => (v + d + n) % n)
  const onTouchStart = (e) => { touch.current = e.touches?.[0]?.clientX ?? null }
  const onTouchEnd = (e) => {
    const x0 = touch.current
    touch.current = null
    const x1 = e.changedTouches?.[0]?.clientX
    if (x0 == null || x1 == null || n < 2) return
    if (x1 - x0 > 40) go(-1)
    else if (x0 - x1 > 40) go(1)
  }

  return (
    <div className="aca-amedia">
      <div className="aca-amedia-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <button
          type="button"
          className="aca-amedia-open"
          onClick={() => setZoom(Math.min(i, n - 1))}
          aria-label={cur.kind === 'youtube' ? 'Reproducir video' : 'Ver imagen'}
        >
          <img src={mediaThumb(cur)} alt="" decoding="async" />
          {cur.kind === 'youtube' && (
            <span className="aca-amedia-play" aria-hidden="true"><Icon name="play" size={26} stroke={1.5} /></span>
          )}
        </button>
        {n > 1 && (
          <>
            <button type="button" className="aca-amedia-nav is-prev" aria-label="Anterior" onClick={() => go(-1)}>
              <Icon name="chevronLeft" size={20} />
            </button>
            <button type="button" className="aca-amedia-nav is-next" aria-label="Siguiente" onClick={() => go(1)}>
              <Icon name="chevronRight" size={20} />
            </button>
          </>
        )}
        {canEdit && (
          <button type="button" className="aca-amedia-edit" onClick={onEdit}>
            <Icon name="upload" size={15} />
            <span>Subir imágenes / videos</span>
          </button>
        )}
      </div>
      {n > 1 && (
        <div className="aca-amedia-thumbs" role="tablist" aria-label="Galería">
          {items.map((m, k) => (
            <button
              key={`${m.kind}-${m.videoId || m.url}-${k}`}
              type="button"
              role="tab"
              aria-selected={k === i}
              aria-label={`${m.kind === 'youtube' ? 'Video' : 'Imagen'} ${k + 1}`}
              className={cx('aca-amedia-thumb', k === i && 'is-on')}
              onClick={() => setI(k)}
            >
              <img src={mediaThumb(m)} alt="" loading="lazy" decoding="async" />
              {m.kind === 'youtube' && <span className="aca-amedia-thumb-play" aria-hidden="true"><Icon name="play" size={12} stroke={1.5} /></span>}
            </button>
          ))}
        </div>
      )}
      <Lightbox items={items} index={zoom} onIndex={setZoom} onClose={() => setZoom(null)} />
    </div>
  )
}

/* ---------- Editor de la galería (solo admins) ---------- */
function uploadUrl(u) {
  if (!u) return null
  if (typeof u === 'string') return u
  return u.url || null
}

function MediaEditor({ open, initial, onClose, onSaved }) {
  const { toast } = useAcademy() || {}
  const [items, setItems] = useState(initial)
  const [uploads, setUploads] = useState([])
  const [yt, setYt] = useState('')
  const [ytError, setYtError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setItems(initial)
      setUploads([])
      setYt('')
      setYtError('')
      setError('')
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const newImages = (Array.isArray(uploads) ? uploads : [])
    .map(uploadUrl)
    .filter((u) => u && isImageUrl(u))
    .map((url) => ({ kind: 'image', url }))
  const count = items.length + newImages.length
  const room = Math.max(0, MAX_MEDIA - items.length)

  const move = (k, d) => setItems((list) => {
    const j = k + d
    if (j < 0 || j >= list.length) return list
    const next = list.slice()
    const [x] = next.splice(k, 1)
    next.splice(j, 0, x)
    return next
  })
  const remove = (k) => setItems((list) => list.filter((_, idx) => idx !== k))

  const addYoutube = () => {
    const id = parseYouTubeId(yt.trim())
    if (!id) { setYtError('Ese enlace no es de un video de YouTube.'); return }
    if (count >= MAX_MEDIA) { setYtError(`Máximo ${MAX_MEDIA} elementos en la galería.`); return }
    if (items.some((m) => m.kind === 'youtube' && m.videoId === id)) { setYtError('Ese video ya está en la galería.'); return }
    setItems((list) => [...list, { kind: 'youtube', videoId: id }])
    setYt('')
    setYtError('')
  }

  const save = async () => {
    const media = cleanMedia([...items, ...newImages])
    setSaving(true)
    setError('')
    try {
      const res = await academyApi('admin-settings', { method: 'POST', body: { group: { media } } })
      const savedMedia = Array.isArray(res?.settings?.group?.media) ? cleanMedia(res.settings.group.media) : media
      onSaved(savedMedia)
      try { toast?.('Galería actualizada', 'ok') } catch {}
      onClose()
    } catch (err) {
      setError((err && err.message) || 'No se pudo guardar la galería')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={saving ? undefined : onClose}
      dismissible={!saving}
      size="lg"
      title="Imágenes y videos"
      subtitle={`Se muestran en Acerca de · ${count}/${MAX_MEDIA}`}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={save} loading={saving}>Guardar</Button>
        </>
      )}
    >
      <div className="aca-medit">
        {error && <InlineAlert tone="error">{error}</InlineAlert>}

        {items.length > 0 ? (
          <ul className="aca-medit-grid">
            {items.map((m, k) => (
              <li key={`${m.kind}-${m.videoId || m.url}-${k}`} className="aca-medit-item">
                <span className="aca-medit-thumb">
                  <img src={mediaThumb(m)} alt="" loading="lazy" decoding="async" />
                  {m.kind === 'youtube' && <span className="aca-amedia-thumb-play" aria-hidden="true"><Icon name="play" size={12} stroke={1.5} /></span>}
                  {k === 0 && <span className="aca-medit-first">Portada</span>}
                </span>
                <span className="aca-medit-tools">
                  <button type="button" aria-label="Mover antes" disabled={k === 0} onClick={() => move(k, -1)}><Icon name="chevronLeft" size={15} /></button>
                  <button type="button" aria-label="Mover después" disabled={k === items.length - 1} onClick={() => move(k, 1)}><Icon name="chevronRight" size={15} /></button>
                  <button type="button" aria-label="Quitar" className="is-danger" onClick={() => remove(k)}><Icon name="trash" size={15} /></button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="aca-c-muted">Todavía no hay nada en la galería. La primera imagen o video es lo primero que ve un miembro.</p>
        )}

        <Field label="Agregar imágenes" hint="JPG, PNG o WebP. Se comprimen antes de subir.">
          {room > 0
            ? <ImagePicker kind="galeria" max={room} value={uploads} onChange={setUploads} private={false} />
            : <p className="aca-c-muted">La galería está llena ({MAX_MEDIA}). Quita algo para sumar más.</p>}
        </Field>

        <Field
          label="Agregar video de YouTube"
          htmlFor="aca-medit-yt"
          error={ytError || undefined}
          hint="El video debe estar como «No listado» y con «Permitir insertar» activado."
        >
          <div className="aca-medit-yt">
            <input
              id="aca-medit-yt"
              className="aca-c-input"
              type="url"
              inputMode="url"
              placeholder="https://youtu.be/…"
              value={yt}
              onChange={(e) => { setYt(e.target.value); if (ytError) setYtError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addYoutube() } }}
            />
            <Button variant="secondary" icon="plus" onClick={addYoutube} disabled={!yt.trim()}>Agregar</Button>
          </div>
        </Field>
      </div>
    </Sheet>
  )
}

/* ---------- Pestaña ---------- */
export default function AcercaTab() {
  const { group: ctxGroup, isAdmin, isOwner } = useAcademy() || {}
  const canEdit = Boolean(isAdmin || isOwner)
  const q = useAcademyQuery('about', () => academyApi('about'))
  const latest = useRef(q.data)
  latest.current = q.data
  const [editing, setEditing] = useState(false)

  const group = q.data?.group || {}
  const meta = q.data?.meta || {}
  const media = cleanMedia(group.media)
  const name = group.name || ctxGroup?.name || ACADEMY_BRAND.name
  const cover = group.coverUrl && isImageUrl(group.coverUrl) ? group.coverUrl : null
  const owner = meta.owner || null
  const members = Number(meta.memberCount) || 0

  const onSaved = (nextMedia) => {
    const cur = latest.current || {}
    const next = { ...cur, group: { ...(cur.group || {}), media: nextMedia } }
    latest.current = next
    q.setData(next)
  }

  return (
    <div className="aca-about">
      <div className="aca-about-main">
        <PageState
          loading={q.loading && !q.data}
          error={q.data ? null : q.error}
          onRetry={q.refetch}
        >
          <section className="aca-about-card">
            <h1 className="aca-about-title">{name}</h1>

            <MediaGallery items={media} canEdit={canEdit} onEdit={() => setEditing(true)} fallbackCover={cover} />

            <ul className="aca-about-meta">
              <li><Icon name="lock" size={19} /><span>Privado</span></li>
              <li><Icon name="users" size={19} /><span>{fmtCount(members)} {members === 1 ? 'miembro' : 'miembros'}</span></li>
              <li><Icon name="receipt" size={19} /><span>Pago único</span></li>
              {owner?.name && (
                <li className="aca-about-owner">
                  <MemberAvatar member={{ name: owner.name, avatarUrl: owner.avatarUrl || null, handle: owner.handle }} size={24} showLevel={false} />
                  <span>Por {owner.name}</span>
                </li>
              )}
            </ul>

            {group.description ? (
              <p className="aca-about-desc">{group.description}</p>
            ) : canEdit ? (
              <p className="aca-c-muted aca-about-desc">Agrega la descripción de la Academy desde CONFIGURACIÓN, en la tarjeta del grupo.</p>
            ) : null}
          </section>
        </PageState>
      </div>

      <aside className="aca-about-side">
        <GroupCard />
      </aside>

      {canEdit && (
        <MediaEditor open={editing} initial={media} onClose={() => setEditing(false)} onSaved={onSaved} />
      )}
    </div>
  )
}
