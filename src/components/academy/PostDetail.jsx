import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import {
  Sheet, ConfirmDialog, ActionMenu, IconButton, InlineAlert, EmptyState, SkeletonRows, List, ListRow, useIsPhone,
} from '../panel/index.js'
import PageState from './PageState.jsx'
import RichText from './RichText.jsx'
import PollBlock from './PollBlock.jsx'
import CommentThread, { CommentComposer, ReportSheet, canModerate } from './CommentThread.jsx'
import { PostEditorSheet } from './PostComposer.jsx'
import { cx, ago, fullDate, errMsg, categoryLabel, copyText, LikeButton, AuthorName, AuthorAvatar } from './PostCard.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { isImageUrl, safeUrl, UGC_REL } from '../../academy/url.js'
import { embedUrl } from '../../academy/youtube.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/comunidad.css'

/* ============================================================
   Publicación abierta (hoja grande; ruta /academy/comunidad/:postId).
   GET post → {post, comments} y el backend la marca como leída.
   Menú ⋯ según permisos (SPEC §5.3):
     autor o equipo  → Editar, Eliminar
     todos           → Copiar enlace, Seguir/Dejar de seguir
     admin/dueño     → Fijar/Desfijar (máx. 3 → 409)
     moderador+      → Mover de categoría, Apagar/Encender comentarios
     no-autor        → Reportar
   Cada cambio sube al feed con onPostChange para que la tarjeta quede igual.
   ============================================================ */

const YT_ID = /^[A-Za-z0-9_-]{11}$/

function highlightFrom(location) {
  const h = /^#comentario-(\d+)$/.exec(location?.hash || '')
  if (h) return Number(h[1])
  try {
    const q = new URLSearchParams(location?.search || '').get('comentario')
    return q && /^\d+$/.test(q) ? Number(q) : null
  } catch {
    return null
  }
}

/* Hoja para mover la publicación a otra categoría (moderadores). */
function MoveSheet({ open, onClose, categories, currentId, onPick, busy }) {
  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Mover de categoría" size="sm" bodyClassName="is-flush" dismissible={!busy}>
      <List>
        {categories.map((c) => (
          <ListRow
            key={c.id}
            title={categoryLabel(c)}
            subtitle={c.writeRole === 'admins' ? 'Solo admins publican' : undefined}
            trailing={Number(c.id) === Number(currentId) ? <Icon name="check" size={16} /> : null}
            onClick={busy || Number(c.id) === Number(currentId) ? undefined : () => onPick(c)}
            dim={busy}
          />
        ))}
      </List>
    </Sheet>
  )
}

export default function PostDetail({ postId, open, onClose, initialPost, categories = [], onPostChange, onPostDeleted, onPinnedChange }) {
  const ctx = useAcademy()
  const { me, isAdmin, isOwner, toast } = ctx
  const location = useLocation()
  const isPhone = useIsPhone()
  const [post, setPost] = useState(initialPost || null)
  const [comments, setComments] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error | notfound
  const [error, setError] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [busy, setBusy] = useState('')
  const reqId = useRef(0)
  const postRef = useRef(post)
  postRef.current = post
  const cbRef = useRef({ onPostChange, onPostDeleted, onPinnedChange })
  cbRef.current = { onPostChange, onPostDeleted, onPinnedChange }
  const liking = useRef(false)

  const emit = (np) => { if (np) cbRef.current.onPostChange?.(np) }
  const changePost = (patch) => {
    const cur = postRef.current
    if (!cur) return
    const np = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }
    postRef.current = np
    setPost(np)
    emit(np)
  }

  const load = useCallback(async () => {
    const id = Number(postId)
    if (!Number.isInteger(id) || id <= 0) { setStatus('notfound'); return }
    const my = ++reqId.current
    setStatus('loading')
    setError(null)
    try {
      const d = await academyApi('post', { query: { id } })
      if (my !== reqId.current) return
      if (!d?.post) { setStatus('notfound'); return }
      const np = { ...d.post, unread: false }
      postRef.current = np
      setPost(np)
      setComments(Array.isArray(d.comments) ? d.comments : [])
      setStatus('ready')
      emit(np)
    } catch (e) {
      if (my !== reqId.current) return
      if (e?.status === 404 || e?.status === 403) { setStatus('notfound'); return }
      setError(e)
      setStatus('error')
    }
  }, [postId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !postId) return
    setPost(initialPost || null)
    postRef.current = initialPost || null
    setComments([])
    setEditOpen(false); setMoveOpen(false); setReportOpen(false); setAskDelete(false)
    load()
  }, [open, postId]) // eslint-disable-line react-hooks/exhaustive-deps

  const mine = Boolean(me && post?.author && Number(post.author.id) === Number(me.id))
  const mod = canModerate(ctx)
  const admin = Boolean(isAdmin || isOwner)

  /* ---------- acciones ---------- */
  const toggleLike = async () => {
    if (!post || mine || liking.current) return
    liking.current = true
    const prev = { liked: Boolean(post.liked), likeCount: Number(post.likeCount) || 0 }
    const next = { liked: !prev.liked, likeCount: Math.max(0, prev.likeCount + (prev.liked ? -1 : 1)) }
    changePost(next)
    try {
      const d = await academyApi('like', { method: 'POST', body: { targetType: 'post', targetId: post.id, like: next.liked } })
      changePost({ liked: Boolean(d?.liked), likeCount: Number(d?.likeCount) || 0 })
    } catch (e) {
      changePost(prev)
      toast?.(errMsg(e, 'No se pudo registrar tu me gusta'), 'error')
    } finally {
      liking.current = false
    }
  }

  const toggleFollow = async () => {
    if (!post || busy) return
    const want = !post.following
    setBusy('follow')
    changePost({ following: want })
    try {
      const d = await academyApi('follow', { method: 'POST', body: { targetType: 'post', targetId: post.id, follow: want } })
      const f = d && typeof d.following === 'boolean' ? d.following : want
      changePost({ following: f })
      toast?.(f ? 'Te avisaremos de los comentarios nuevos' : 'Ya no sigues esta publicación', 'ok')
    } catch (e) {
      changePost({ following: !want })
      toast?.(errMsg(e, 'No se pudo cambiar el seguimiento'), 'error')
    } finally {
      setBusy('')
    }
  }

  const copyLink = async () => {
    if (!post) return
    let url = r.post(post.id)
    try { url = `${window.location.origin}${url}` } catch { /* nada */ }
    const ok = await copyText(url)
    toast?.(ok ? 'Enlace copiado' : 'No se pudo copiar el enlace', ok ? 'ok' : 'error')
  }

  const togglePin = async () => {
    if (!post || busy) return
    const want = !post.pinned
    setBusy('pin')
    try {
      await academyApi('admin-pin', { method: 'POST', body: { postId: post.id, pinned: want } })
      changePost({ pinned: want })
      cbRef.current.onPinnedChange?.(post.id, want)
      toast?.(want ? 'Publicación fijada arriba del feed' : 'Publicación desfijada', 'ok')
    } catch (e) {
      toast?.(errMsg(e, e?.status === 409 ? 'Solo se pueden fijar 3 publicaciones' : 'No se pudo fijar la publicación'), 'error')
    } finally {
      setBusy('')
    }
  }

  const moderate = async (action, extra = {}) => {
    if (!post || busy) return false
    setBusy(action)
    try {
      await academyApi('admin-post-moderate', { method: 'POST', body: { postId: post.id, action, ...extra } })
      return true
    } catch (e) {
      toast?.(errMsg(e, 'No se pudo aplicar el cambio'), 'error')
      return false
    } finally {
      setBusy('')
    }
  }

  const toggleLock = async () => {
    const lock = !post?.commentsLocked
    if (await moderate(lock ? 'lock' : 'unlock')) {
      changePost({ commentsLocked: lock })
      toast?.(lock ? 'Comentarios apagados' : 'Comentarios encendidos', 'ok')
    }
  }

  const moveTo = async (cat) => {
    if (await moderate('move', { categoryId: cat.id })) {
      changePost({ category: { id: cat.id, name: cat.name, emoji: cat.emoji } })
      setMoveOpen(false)
      toast?.(`Movida a ${categoryLabel(cat)}`, 'ok')
    }
  }

  const doDelete = async () => {
    if (!post) return
    setBusy('delete')
    try {
      await academyApi('post-delete', { method: 'POST', body: { id: post.id } })
      setAskDelete(false)
      toast?.('Publicación eliminada', 'ok')
      cbRef.current.onPostDeleted?.(post.id)
      onClose?.()
    } catch (e) {
      toast?.(errMsg(e, 'No se pudo eliminar la publicación'), 'error')
    } finally {
      setBusy('')
    }
  }

  const onCommentPosted = (nc) => {
    if (!nc) return
    setComments((list) => [...list, nc])
    changePost((p) => ({ commentCount: (Number(p.commentCount) || 0) + 1, lastCommentAt: nc.createdAt || new Date().toISOString(), following: true }))
    setTimeout(() => {
      document.getElementById(`comentario-${nc.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 60)
  }
  const onCountDelta = (d) => changePost((p) => ({ commentCount: Math.max(0, (Number(p.commentCount) || 0) + d) }))

  /* ---------- render ---------- */
  const menuItems = post ? [
    { label: 'Editar', icon: 'pencil', onClick: () => setEditOpen(true), hidden: !(mine || mod) },
    { label: 'Copiar enlace', icon: 'link', onClick: copyLink },
    { label: post.following ? 'Dejar de seguir' : 'Seguir publicación', icon: 'bell', onClick: toggleFollow },
    { label: post.pinned ? 'Desfijar' : 'Fijar en el feed', icon: 'pin', onClick: togglePin, hidden: !admin },
    { label: 'Mover de categoría', icon: 'list', onClick: () => setMoveOpen(true), hidden: !mod || !categories.length },
    { label: post.commentsLocked ? 'Encender comentarios' : 'Apagar comentarios', icon: post.commentsLocked ? 'message' : 'lock', onClick: toggleLock, hidden: !mod },
    { label: 'Reportar', icon: 'flag', onClick: () => setReportOpen(true), hidden: mine },
    { label: 'Eliminar', icon: 'trash', danger: true, onClick: () => setAskDelete(true), hidden: !(mine || mod) },
  ] : []

  const cat = categoryLabel(post?.category)
  const images = post ? (Array.isArray(post.attachments) ? post.attachments : []).filter((a) => a && (a.kind === 'image' || !a.kind) && isImageUrl(a.url)) : []
  const vid = post?.videoId && YT_ID.test(post.videoId) ? post.videoId : null
  let videoSrc = null
  try { videoSrc = vid ? embedUrl(vid) : null } catch { videoSrc = null }
  const highlightId = highlightFrom(location)
  const commentCount = Number(post?.commentCount) || 0

  const head = post ? {
    lead: <AuthorAvatar author={post.author} size={42} />,
    title: <AuthorName author={post.author} className="aca-cm-detail-author" />,
    subtitle: (
      <span className="aca-cm-detail-sub">
        <time dateTime={post.createdAt} title={fullDate(post.createdAt)}>{ago(post.createdAt)}</time>
        {cat && <><span className="aca-cm-dot-sep" aria-hidden="true">·</span><span>{cat}</span></>}
        {post.pinned && <><span className="aca-cm-dot-sep" aria-hidden="true">·</span><span className="aca-cm-post-pin is-inline"><Icon name="pin" size={13} /> Fijado</span></>}
      </span>
    ),
    headActions: (
      <>
        <IconButton
          icon="bell"
          label={post.following ? 'Dejar de seguir esta publicación' : 'Seguir esta publicación'}
          className={cx('aca-cm-follow-btn', post.following && 'is-on')}
          onClick={toggleFollow}
          disabled={busy === 'follow'}
          aria-pressed={Boolean(post.following)}
        />
        <ActionMenu items={menuItems} label="Opciones de la publicación" title="Publicación" />
      </>
    ),
  } : { title: 'Publicación' }

  const footer = post && status === 'ready' ? (
    post.commentsLocked ? (
      <div className="aca-cm-comments-locked"><Icon name="lock" size={15} /> Los comentarios de esta publicación están apagados</div>
    ) : (
      <div className="aca-cm-detail-foot">
        <CommentComposer postId={post.id} onPosted={onCommentPosted} draftKey={`aca:comment:${post.id}`} />
      </div>
    )
  ) : null

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        size="lg"
        full={isPhone}
        className="aca-cm-post-sheet"
        bodyClassName="aca-cm-post-sheet-body"
        ariaLabel={post?.title || 'Publicación'}
        headBorder
        footer={footer}
        {...head}
      >
        {status === 'notfound' ? (
          <EmptyState
            icon="info"
            title="Esta publicación ya no está disponible"
            text="Puede que la hayan eliminado o que sea de un grupo al que no perteneces."
            action={{ label: 'Volver a la comunidad', icon: 'arrowLeft', onClick: onClose }}
          />
        ) : !post ? (
          <PageState loading={status === 'loading'} error={status === 'error' ? error : null} onRetry={load} />
        ) : (
          <>
            <article className="aca-cm-detail">
              <h1 className="aca-cm-detail-title">{post.title || 'Sin título'}</h1>
              {post.body ? <RichText text={post.body} className="aca-cm-detail-body" /> : null}
              {post.editedAt && <p className="aca-cm-detail-edited">Editado {ago(post.editedAt)}</p>}

              {images.length > 0 && (
                <div className={cx('aca-cm-detail-images', `n-${Math.min(images.length, 4)}`)}>
                  {images.map((a, i) => {
                    const href = safeUrl(a.url)
                    const img = <img src={a.url} alt={`Imagen ${i + 1} de la publicación`} loading="lazy" decoding="async" />
                    return href
                      ? <a key={`${a.url}-${i}`} href={href} target="_blank" rel={UGC_REL}>{img}</a>
                      : <span key={`${a.url}-${i}`}>{img}</span>
                  })}
                </div>
              )}

              {videoSrc && (
                <div className="aca-cm-detail-video">
                  <iframe
                    src={videoSrc}
                    title={`Video: ${post.title || 'publicación'}`}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                    loading="lazy"
                  />
                </div>
              )}

              {post.poll && Array.isArray(post.poll.options) && post.poll.options.length > 0 && (
                <PollBlock postId={post.id} poll={post.poll} onChange={(poll) => changePost({ poll })} />
              )}

              <div className="aca-cm-detail-stats">
                <LikeButton liked={post.liked} count={post.likeCount} onClick={toggleLike} disabled={mine} />
                <span className="aca-cm-post-stat is-static">
                  <Icon name="message" size={18} />
                  <span>{commentCount} {commentCount === 1 ? 'comentario' : 'comentarios'}</span>
                </span>
                {post.commentsLocked && <span className="aca-cm-detail-locked"><Icon name="lock" size={14} /> Comentarios apagados</span>}
              </div>
            </article>

            <section className="aca-cm-comments" aria-label="Comentarios">
              {status === 'loading' && <SkeletonRows rows={3} />}
              {status === 'error' && (
                <InlineAlert tone="error" action={{ label: 'Reintentar', onClick: load }}>
                  {errMsg(error, 'No se pudieron cargar los comentarios.')}
                </InlineAlert>
              )}
              {status === 'ready' && (
                <CommentThread
                  postId={post.id}
                  comments={comments}
                  onChange={setComments}
                  locked={Boolean(post.commentsLocked)}
                  onCountDelta={onCountDelta}
                  highlightId={highlightId}
                />
              )}
            </section>
          </>
        )}
      </Sheet>

      {post && (
        <>
          <PostEditorSheet
            open={editOpen}
            post={post}
            categories={categories}
            onClose={() => setEditOpen(false)}
            onSaved={(np) => { if (np) changePost({ ...np }) }}
          />
          <MoveSheet
            open={moveOpen}
            onClose={() => setMoveOpen(false)}
            categories={categories}
            currentId={post.category?.id}
            onPick={moveTo}
            busy={busy === 'move'}
          />
          <ReportSheet
            open={reportOpen}
            onClose={() => setReportOpen(false)}
            targetType="post"
            targetId={post.id}
            title="Reportar publicación"
          />
          <ConfirmDialog
            open={askDelete}
            title="¿Eliminar publicación?"
            message="Se borra para todos, con sus comentarios. Esta acción no se puede deshacer."
            confirmLabel="Eliminar"
            tone="danger"
            busy={busy === 'delete'}
            onConfirm={doDelete}
            onCancel={() => setAskDelete(false)}
          />
        </>
      )}
    </>
  )
}

