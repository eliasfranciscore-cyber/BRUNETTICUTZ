import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Sheet, useIsPhone } from '../panel/index.js'
import { useOutsideClose, useTopLayerEscape } from '../panel/hooks.js'
import MemberAvatar from './MemberAvatar.jsx'
import PollBlock from './PollBlock.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { isImageUrl } from '../../academy/url.js'
import { thumbUrl } from '../../academy/youtube.js'
import { timeAgo, timeAgoLong, fmtDateTime } from '../../academy/time.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/comunidad.css'

/* ============================================================
   Tarjeta de publicación del feed de Comunidad (como las de Skool):
   autor con su nivel, "hace 2 h · 📣 Anuncios", título en negrita, extracto
   de 3 líneas, la primera imagen a la derecha, la encuesta resumida y el pie
   con ♥ (optimista), 💬, las caras de quienes comentaron y "Último
   comentario hace X".

   Acá también viven los helpers chicos que comparten las piezas de
   FE-COMUNIDAD (tiempo relativo, mensaje de error, menú desplegable con
   check): src/academy/ es de FE-CORE y cada agente edita solo sus archivos.

   Uso desde otras pantallas (perfil, búsqueda):
     <PostCard post={p} onChange={(np) => …} />      // abre /academy/comunidad/:id
     <PostCard post={p} onOpen={(p) => …} />          // o lo que decida el padre
   ============================================================ */

export const cx = (...p) => p.filter(Boolean).join(' ')

const YT_ID = /^[A-Za-z0-9_-]{11}$/

/* "hace 2 h" / "hace un momento" / "el ago. 25" (timeAgoLong de
   src/academy/time.js, que ya trae el "hace"/"el" para usar en frases). */
export function ago(iso, tz) {
  if (!iso) return ''
  try { return String(timeAgoLong(iso, tz ? { tz } : undefined) || '') } catch { return '' }
}

/* Para frases del tipo "Último comentario hace 2 h" / "… el ago. 25". */
export const agoPhrase = ago

/* Forma corta de Skool ('3 h', '13 d', 'ago. 25') para filas apretadas. */
export function agoShort(iso, tz) {
  if (!iso) return ''
  try { return String(timeAgo(iso, tz ? { tz } : undefined) || '') } catch { return '' }
}

export function fullDate(iso, tz) {
  if (!iso) return undefined
  try { return fmtDateTime(iso, tz ? { tz, long: true } : { long: true }) || undefined } catch { return undefined }
}

/* Mensaje para el usuario a partir de un ApiError. Los mensajes del backend
   ya vienen en español; lo técnico (sin red, HTML en vez de JSON) cae al
   texto por defecto de la acción. */
export function errMsg(e, fallback = 'Algo salió mal. Intenta de nuevo.') {
  const m = e && typeof e.message === 'string' ? e.message.trim() : ''
  if (!m || m === 'Error' || m === 'Error interno' || /^(Failed to fetch|NetworkError|Load failed|unavailable|Cancelado)/i.test(m)) return fallback
  return m
}

export function categoryLabel(cat) {
  if (!cat) return ''
  const name = String(cat.name || '').trim()
  const emoji = String(cat.emoji || '').trim()
  return emoji && !name.startsWith(emoji) ? `${emoji} ${name}` : name
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* cae al método viejo */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/* Primera imagen de la publicación (o la miniatura del video de YouTube).
   Solo URLs del Blob del proyecto o /assets/ (isImageUrl); la miniatura de
   YouTube se arma con un id ya validado, nunca con texto del usuario. */
export function postThumb(post) {
  const imgs = (Array.isArray(post?.attachments) ? post.attachments : [])
    .filter((a) => a && (a.kind === 'image' || !a.kind) && isImageUrl(a.url))
  if (imgs.length) return { src: imgs[0].url, video: false, extra: imgs.length - 1 }
  if (post?.videoId && YT_ID.test(post.videoId)) {
    try { return { src: thumbUrl(post.videoId), video: true, extra: 0 } } catch { return null }
  }
  return null
}

/* ---------- Menú desplegable con check (orden del feed, "Todos ⌄") ----------
   Mismo patrón que ActionMenu del panel: popover anclado en escritorio, hoja
   de acciones en el celular. items: [{ key, label, checked, onClick, hidden }]
   o { section: 'Título' } para un rótulo de grupo. */
export function MenuButton({ label, icon, items = [], title, align = 'end', className, buttonClassName, ariaLabel }) {
  const isPhone = useIsPhone()
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useOutsideClose(wrap, open && !isPhone, close)
  useTopLayerEscape(open && !isPhone, close)
  const visible = items.filter((i) => i && !i.hidden)
  const run = (item) => {
    setOpen(false)
    setTimeout(() => item.onClick?.(), isPhone ? 200 : 0)
  }
  const list = visible.map((item, i) => (item.section
    ? <div key={`s-${item.section}-${i}`} className="aca-cm-menu-section" role="presentation">{item.section}</div>
    : (
      <button
        key={item.key || item.label}
        type="button"
        role="menuitemradio"
        aria-checked={Boolean(item.checked)}
        className={cx('pn-menu-item', 'aca-cm-menu-item', item.checked && 'is-checked')}
        onClick={() => run(item)}
      >
        {item.icon && <Icon name={item.icon} size={17} />}
        <span>{item.label}</span>
        {item.checked && <Icon name="check" size={16} />}
      </button>
    )))
  return (
    <div className={cx('pn-menu-wrap', 'aca-cm-menubtn', className)} ref={wrap}>
      <button
        type="button"
        className={cx('aca-cm-menubtn-trigger', buttonClassName)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {icon && <Icon name={icon} size={16} />}
        {label != null && <span>{label}</span>}
        <Icon name="chevronDown" size={15} />
      </button>
      {open && !isPhone && (
        <div className={cx('pn-menu', 'aca-cm-menu', align === 'start' && 'is-start')} role="menu">{list}</div>
      )}
      {isPhone && (
        <Sheet open={open} onClose={close} title={title || ariaLabel || label} size="sm" bodyClassName="is-flush">
          <div className="pn-actsheet aca-cm-actsheet" role="menu">{list}</div>
        </Sheet>
      )}
    </div>
  )
}

/* ---------- Botón ♥ (publicaciones y comentarios) ---------- */
export function LikeButton({ liked, count, onClick, disabled, small, label }) {
  const n = Number(count) || 0
  return (
    <button
      type="button"
      className={cx('aca-cm-like', liked && 'is-on', small && 'is-sm')}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={Boolean(liked)}
      aria-label={label || (liked ? `Quitar me gusta (${n})` : `Me gusta (${n})`)}
      title={disabled ? 'No puedes darle me gusta a lo tuyo' : undefined}
    >
      <Icon name="heart" size={small ? 16 : 18} />
      <span>{n}</span>
    </button>
  )
}

/* Autor: enlace a su perfil (o texto si la cuenta ya no existe). */
export function AuthorName({ author, className }) {
  const name = author?.name || 'Miembro eliminado'
  if (!author?.handle) return <span className={className}>{name}</span>
  return <Link className={className} to={r.profile(author.handle)}>{name}</Link>
}

export function AuthorAvatar({ author, size = 40 }) {
  const av = <MemberAvatar member={author || { name: 'Miembro eliminado' }} size={size} />
  if (!author?.handle) return <span className="aca-cm-post-avatar">{av}</span>
  return <Link className="aca-cm-post-avatar" to={r.profile(author.handle)} aria-label={`Perfil de ${author.name || 'miembro'}`} tabIndex={-1}>{av}</Link>
}

function excerptOf(post) {
  const raw = post?.excerpt != null ? post.excerpt : String(post?.body || '').slice(0, 220)
  return String(raw || '').replace(/\s+/g, ' ').trim()
}

/* ============================================================ */
export default function PostCard({ post, onChange, onOpen, showPinned = true, className }) {
  const navigate = useNavigate()
  const { me, toast } = useAcademy()
  // Cambios optimistas (♥, voto) encima de lo que manda el padre. Se botan
  // cuando el padre entrega una versión nueva de la publicación.
  const [over, setOver] = useState(null)
  useEffect(() => { setOver(null) }, [post])
  const busy = useRef(false)
  if (!post) return null
  const p = over ? { ...post, ...over } : post
  const mine = Boolean(me && p.author && Number(p.author.id) === Number(me.id))

  const open = () => (onOpen ? onOpen(p) : navigate(r.post(p.id)))

  const onCardClick = (e) => {
    if (e.defaultPrevented) return
    if (e.target.closest('a, button, input, textarea, select, label, iframe, [data-stop]')) return
    // Seleccionar texto para copiarlo no abre la publicación.
    try { if (String(window.getSelection?.() || '').length > 0) return } catch { /* nada */ }
    open()
  }

  const onTitleClick = (e) => {
    if (!onOpen || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    onOpen(p)
  }

  const toggleLike = async () => {
    if (mine || busy.current) return
    busy.current = true
    const prev = { liked: Boolean(p.liked), likeCount: Number(p.likeCount) || 0 }
    const next = { liked: !prev.liked, likeCount: Math.max(0, prev.likeCount + (prev.liked ? -1 : 1)) }
    setOver((o) => ({ ...(o || {}), ...next }))
    try {
      const d = await academyApi('like', { method: 'POST', body: { targetType: 'post', targetId: p.id, like: next.liked } })
      const fin = { liked: Boolean(d?.liked), likeCount: Number(d?.likeCount) || 0 }
      setOver((o) => ({ ...(o || {}), ...fin }))
      onChange?.({ ...post, ...(over || {}), ...fin })
    } catch (e) {
      setOver((o) => ({ ...(o || {}), ...prev }))
      toast?.(errMsg(e, 'No se pudo registrar tu me gusta'), 'error')
    } finally {
      busy.current = false
    }
  }

  const onPoll = (poll) => {
    setOver((o) => ({ ...(o || {}), poll }))
    onChange?.({ ...post, ...(over || {}), poll })
  }

  const thumb = postThumb(p)
  const excerpt = excerptOf(p)
  const commenters = (Array.isArray(p.commenters) ? p.commenters : []).slice(0, 4)
  const comments = Number(p.commentCount) || 0
  const cat = categoryLabel(p.category)
  const link = r.post(p.id)

  return (
    <article className={cx('aca-cm-post', p.pinned && showPinned && 'is-pinned', p.unread && 'is-unread', className)} onClick={onCardClick}>
      <header className="aca-cm-post-head">
        <AuthorAvatar author={p.author} size={40} />
        <div className="aca-cm-post-meta">
          <AuthorName author={p.author} className="aca-cm-post-author" />
          <div className="aca-cm-post-sub">
            <time dateTime={p.createdAt} title={fullDate(p.createdAt)}>{ago(p.createdAt)}</time>
            {cat && (
              <>
                <span className="aca-cm-dot-sep" aria-hidden="true">·</span>
                <span className="aca-cm-post-cat">{cat}</span>
              </>
            )}
          </div>
        </div>
        {p.pinned && showPinned && (
          <span className="aca-cm-post-pin"><Icon name="pin" size={14} /> Fijado</span>
        )}
        {p.unread && !mine && <span className="aca-cm-unread-dot" title="No leída" aria-label="No leída" />}
      </header>

      <div className={cx('aca-cm-post-content', thumb && 'has-thumb')}>
        <div className="aca-cm-post-text">
          <h3 className="aca-cm-post-title">
            <Link to={link} onClick={onTitleClick}>{p.title || 'Sin título'}</Link>
          </h3>
          {excerpt && <p className="aca-cm-post-excerpt">{excerpt}</p>}
        </div>
        {thumb && (
          <button type="button" className="aca-cm-post-thumb" onClick={open} aria-label="Ver publicación" tabIndex={-1}>
            <img src={thumb.src} alt="" loading="lazy" decoding="async" />
            {thumb.video && <span className="aca-cm-post-play" aria-hidden="true"><Icon name="play" size={18} /></span>}
            {thumb.extra > 0 && <span className="aca-cm-post-more" aria-hidden="true">+{thumb.extra}</span>}
          </button>
        )}
      </div>

      {p.poll && Array.isArray(p.poll.options) && p.poll.options.length > 0 && (
        <PollBlock postId={p.id} poll={p.poll} compact onChange={onPoll} onMore={open} />
      )}

      <footer className="aca-cm-post-foot">
        <LikeButton liked={p.liked} count={p.likeCount} onClick={toggleLike} disabled={mine} />
        <button type="button" className="aca-cm-post-stat" onClick={open} aria-label={`${comments} ${comments === 1 ? 'comentario' : 'comentarios'}`}>
          <Icon name="message" size={18} />
          <span>{comments}</span>
        </button>
        {commenters.length > 0 && (
          <span className="aca-cm-post-commenters" aria-hidden="true">
            {commenters.map((m) => (
              <span key={m.id} className="aca-cm-post-commenter"><MemberAvatar member={m} size={26} showLevel={false} /></span>
            ))}
          </span>
        )}
        {p.lastCommentAt && comments > 0 && (
          <span className={cx('aca-cm-post-last', p.unread && 'is-new')} title={fullDate(p.lastCommentAt)}>
            Último comentario {agoPhrase(p.lastCommentAt)}
          </span>
        )}
      </footer>
    </article>
  )
}
