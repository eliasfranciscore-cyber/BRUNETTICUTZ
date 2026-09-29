import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import { Button, ActionMenu, ConfirmDialog, Sheet, Field } from '../panel/index.js'
import MemberAvatar from './MemberAvatar.jsx'
import RichText from './RichText.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { cx, ago, fullDate, errMsg, LikeButton, AuthorName, AuthorAvatar } from './PostCard.jsx'
import { MentionTextarea, readDraftObj, writeDraftObj, dropDraft } from './PostComposer.jsx'
import '../../styles/academy/comunidad.css'

/* ============================================================
   Comentarios de una publicación (SPEC §5.3), dos niveles como recomienda
   el informe de Skool: comentario → respuestas. Responder a una respuesta
   la cuelga del mismo hilo con "@handle " al principio.

   · ♥ optimista (no se puede dar a lo propio: el backend responde 400).
   · Editar / Eliminar lo propio; el equipo (moderador para arriba) puede
     eliminar lo de otros; los demás pueden Reportar.
   · Un comentario borrado con respuestas queda como "Comentario eliminado"
     para no romper el hilo; sin respuestas desaparece.

   También exporta CommentComposer (el pie de la hoja de la publicación) y
   ReportSheet (Reportar publicación/comentario → mode report).
   ============================================================ */

const REPLIES_VISIBLE = 3

export function canModerate(ctx) {
  return Boolean(ctx?.isStaff || ctx?.isModerator || ctx?.isAdmin || ctx?.isOwner)
}

/* ---------- Reportar ---------- */
const REPORT_REASONS = [
  'Spam o publicidad',
  'Acoso o lenguaje ofensivo',
  'Contenido inapropiado',
  'Información falsa o engañosa',
  'Otro motivo',
]

export function ReportSheet({ open, onClose, targetType, targetId, title }) {
  const { toast } = useAcademy()
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) { setReason(''); setDetail(''); setError(''); setBusy(false) }
  }, [open])

  const send = async () => {
    if (!reason) { setError('Elige un motivo'); return }
    const text = [reason, detail.trim()].filter(Boolean).join(': ').slice(0, 500)
    setBusy(true)
    setError('')
    try {
      await academyApi('report', { method: 'POST', body: { targetType, targetId, reason: text } })
      toast?.('Gracias. El equipo de la Academy va a revisarlo.', 'ok')
      onClose?.()
    } catch (e) {
      setError(errMsg(e, 'No se pudo enviar el reporte'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={busy ? undefined : onClose}
      title={title || 'Reportar a los administradores'}
      subtitle="Solo lo ve el equipo de la Academy. La persona no sabe quién reportó."
      size="sm"
      dismissible={!busy}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="danger-solid" onClick={send} loading={busy} disabled={!reason}>Reportar</Button>
        </>
      )}
    >
      <div className="aca-cm-report" role="radiogroup" aria-label="Motivo">
        {REPORT_REASONS.map((r) => (
          <label key={r} className={cx('aca-cm-report-opt', reason === r && 'is-on')}>
            <input type="radio" name="aca-cm-report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
            <span>{r}</span>
          </label>
        ))}
      </div>
      <Field label="Detalle" optional>
        <textarea
          className="aca-cm-textarea aca-cm-input"
          rows={3}
          maxLength={400}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Cuéntanos qué pasó (opcional)"
        />
      </Field>
      {error && <p className="aca-cm-field-error" role="alert">{error}</p>}
    </Sheet>
  )
}

/* ---------- Caja para comentar / responder ----------
   Enter hace salto de línea (los comentarios pueden ser largos);
   Ctrl/⌘+Enter envía. El comentario principal guarda borrador por post. */
export function CommentComposer({ postId, parentId = null, initialText = '', onPosted, onCancel, autoFocus = false, compact = false, draftKey, placeholder }) {
  const { me } = useAcademy()
  const [text, setText] = useState(() => {
    if (initialText) return initialText
    const d = draftKey ? readDraftObj(draftKey) : null
    return d && typeof d.text === 'string' ? d.text : ''
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!autoFocus) return
    const t = setTimeout(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      try { el.setSelectionRange(el.value.length, el.value.length) } catch { /* nada */ }
    }, 40)
    return () => clearTimeout(t)
  }, [autoFocus])

  useEffect(() => {
    if (!draftKey) return undefined
    const t = setTimeout(() => {
      if (text.trim()) writeDraftObj(draftKey, { text })
      else dropDraft(draftKey)
    }, 400)
    return () => clearTimeout(t)
  }, [text, draftKey])

  const send = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setError('')
    try {
      const d = await academyApi('comment-save', { method: 'POST', body: { postId, parentId: parentId || null, body } })
      setText('')
      if (draftKey) dropDraft(draftKey)
      onPosted?.(d?.comment || null)
    } catch (e) {
      setError(errMsg(e, 'No se pudo publicar tu comentario'))
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
    if (e.key === 'Escape' && onCancel && !text.trim()) { e.preventDefault(); e.stopPropagation(); onCancel() }
  }

  return (
    <div className={cx('aca-cm-ccomposer', compact && 'is-compact')} data-hold-reload={text.trim() ? '' : undefined}>
      {!compact && <MemberAvatar member={me} size={32} showLevel={false} />}
      <div className="aca-cm-ccomposer-box">
        <MentionTextarea
          inputRef={ref}
          value={text}
          onChange={setText}
          placeholder={placeholder || (parentId ? 'Escribe una respuesta…' : 'Escribe un comentario…')}
          ariaLabel={parentId ? 'Respuesta' : 'Comentario'}
          rows={1}
          maxRows={8}
          maxLength={5000}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        <div className="aca-cm-ccomposer-actions">
          {onCancel && <Button variant="plain" size="sm" onClick={onCancel} disabled={busy}>Cancelar</Button>}
          <Button variant="primary" size="sm" className="aca-cm-btn-accent" onClick={send} loading={busy} disabled={!text.trim()}>
            {parentId ? 'Responder' : 'Comentar'}
          </Button>
        </div>
        {error && <p className="aca-cm-field-error" role="alert">{error}</p>}
      </div>
    </div>
  )
}

/* ---------- Un comentario ---------- */
function CommentItem({ c, isReply, onReply, onUpdate, onAskDelete, onReport }) {
  const ctx = useAcademy()
  const { me, toast } = ctx
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c.body || '')
  const [saving, setSaving] = useState(false)
  const [over, setOver] = useState(null)
  const liking = useRef(false)
  useEffect(() => { setOver(null) }, [c])
  const cur = over ? { ...c, ...over } : c
  const mine = Boolean(me && cur.author && Number(cur.author.id) === Number(me.id))
  const mod = canModerate(ctx)

  if (cur.deleted) {
    return (
      <div className={cx('aca-cm-comment', 'is-deleted', isReply && 'is-reply')}>
        <span className="aca-cm-comment-ghost" aria-hidden="true"><Icon name="trash" size={14} /></span>
        <p className="aca-cm-comment-deleted">Comentario eliminado</p>
      </div>
    )
  }

  const toggleLike = async () => {
    if (mine || liking.current) return
    liking.current = true
    const prev = { liked: Boolean(cur.liked), likeCount: Number(cur.likeCount) || 0 }
    const next = { liked: !prev.liked, likeCount: Math.max(0, prev.likeCount + (prev.liked ? -1 : 1)) }
    setOver(next)
    try {
      const d = await academyApi('like', { method: 'POST', body: { targetType: 'comment', targetId: cur.id, like: next.liked } })
      const fin = { liked: Boolean(d?.liked), likeCount: Number(d?.likeCount) || 0 }
      onUpdate({ ...c, ...fin })
    } catch (e) {
      setOver(prev)
      toast?.(errMsg(e, 'No se pudo registrar tu me gusta'), 'error')
    } finally {
      liking.current = false
    }
  }

  const saveEdit = async () => {
    const body = draft.trim()
    if (!body) return
    if (body === String(c.body || '').trim()) { setEditing(false); return }
    setSaving(true)
    try {
      const d = await academyApi('comment-save', { method: 'POST', body: { id: c.id, body } })
      onUpdate(d?.comment ? { ...c, ...d.comment } : { ...c, body, editedAt: new Date().toISOString() })
      setEditing(false)
    } catch (e) {
      toast?.(errMsg(e, 'No se pudo guardar el comentario'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const items = [
    { label: 'Editar', icon: 'pencil', onClick: () => { setDraft(c.body || ''); setEditing(true) }, hidden: !mine },
    { label: 'Reportar', icon: 'flag', onClick: () => onReport(c), hidden: mine },
    { label: 'Eliminar', icon: 'trash', danger: true, onClick: () => onAskDelete(c), hidden: !(mine || mod) },
  ]

  return (
    <div className={cx('aca-cm-comment', isReply && 'is-reply')} id={`comentario-${c.id}`}>
      <AuthorAvatar author={cur.author} size={isReply ? 28 : 32} />
      <div className="aca-cm-comment-main">
        <div className="aca-cm-comment-bubble">
          <div className="aca-cm-comment-head">
            <AuthorName author={cur.author} className="aca-cm-comment-author" />
            <span className="aca-cm-dot-sep" aria-hidden="true">·</span>
            <time dateTime={cur.createdAt} title={fullDate(cur.createdAt)}>{ago(cur.createdAt)}</time>
            {cur.editedAt && <span className="aca-cm-comment-edited">(editado)</span>}
            <span className="aca-cm-comment-menu">
              <ActionMenu items={items} small label="Opciones del comentario" title="Comentario" />
            </span>
          </div>
          {editing ? (
            <div className="aca-cm-comment-edit">
              <MentionTextarea
                value={draft}
                onChange={setDraft}
                ariaLabel="Editar comentario"
                rows={2}
                maxRows={10}
                maxLength={5000}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit() }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(false) }
                }}
              />
              <div className="aca-cm-ccomposer-actions">
                <Button variant="plain" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancelar</Button>
                <Button variant="primary" size="sm" className="aca-cm-btn-accent" onClick={saveEdit} loading={saving} disabled={!draft.trim()}>Guardar</Button>
              </div>
            </div>
          ) : (
            <RichText text={cur.body || ''} className="aca-cm-comment-body" />
          )}
        </div>
        {!editing && (
          <div className="aca-cm-comment-actions">
            <LikeButton liked={cur.liked} count={cur.likeCount} onClick={toggleLike} disabled={mine} small />
            {onReply && (
              <button type="button" className="aca-cm-comment-reply" onClick={() => onReply(c)}>
                <Icon name="reply" size={15} /> Responder
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   comments: lista plana del backend (post.comments). onChange recibe la
   lista nueva completa; onCountDelta(±1) ajusta commentCount del post.
   ============================================================ */
export default function CommentThread({ postId, comments = [], onChange, locked = false, onCountDelta, highlightId }) {
  const ctx = useAcademy()
  const { toast } = ctx
  const [replyTo, setReplyTo] = useState(null) // { rootId, prefill, key }
  const [expanded, setExpanded] = useState(() => new Set())
  const [toDelete, setToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [reporting, setReporting] = useState(null)
  const list = Array.isArray(comments) ? comments : []

  // Árbol de dos niveles: cada respuesta cuelga de su comentario raíz.
  const { roots, children } = useMemo(() => {
    const byId = new Map(list.map((c) => [c.id, c]))
    const rootOf = (c) => {
      let cur = c
      for (let i = 0; i < 6 && cur && cur.parentId && byId.has(cur.parentId); i++) cur = byId.get(cur.parentId)
      return cur
    }
    const time = (c) => new Date(c.createdAt || 0).getTime() || 0
    const rs = []
    const ch = new Map()
    for (const c of list) {
      if (!c.parentId || !byId.has(c.parentId)) { rs.push(c); continue }
      const root = rootOf(c)
      const key = root ? root.id : c.parentId
      if (!ch.has(key)) ch.set(key, [])
      ch.get(key).push(c)
    }
    rs.sort((a, b) => time(a) - time(b))
    for (const arr of ch.values()) arr.sort((a, b) => time(a) - time(b))
    return { roots: rs, children: ch }
  }, [list])

  // Un enlace a un comentario (#comentario-12 desde una notificación) lo muestra.
  useEffect(() => {
    if (!highlightId) return undefined
    const t = setTimeout(() => {
      const el = document.getElementById(`comentario-${highlightId}`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.classList.add('is-highlight')
      }
    }, 120)
    return () => clearTimeout(t)
  }, [highlightId, list.length])

  const update = (nc) => onChange?.(list.map((c) => (c.id === nc.id ? { ...c, ...nc } : c)))

  const startReply = (c) => {
    const rootId = c.parentId ? (roots.find((r) => (children.get(r.id) || []).some((x) => x.id === c.id))?.id || c.parentId) : c.id
    const prefill = c.parentId && c.author?.handle ? `@${c.author.handle} ` : ''
    setExpanded((s) => new Set(s).add(rootId))
    setReplyTo({ rootId, prefill, key: `${c.id}-${Date.now()}` })
  }

  const onPostedReply = (nc) => {
    if (nc) {
      onChange?.([...list, nc])
      onCountDelta?.(1)
    }
    setReplyTo(null)
  }

  const confirmDelete = async () => {
    const c = toDelete
    if (!c) return
    setDeleting(true)
    try {
      await academyApi('comment-delete', { method: 'POST', body: { id: c.id } })
      onChange?.(list.map((x) => (x.id === c.id ? { ...x, deleted: true, body: '' } : x)))
      onCountDelta?.(-1)
      setToDelete(null)
      toast?.('Comentario eliminado', 'ok')
    } catch (e) {
      toast?.(errMsg(e, 'No se pudo eliminar el comentario'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const visibleRoots = roots.filter((c) => !c.deleted || (children.get(c.id) || []).some((x) => !x.deleted))

  return (
    <div className="aca-cm-thread">
      {visibleRoots.length === 0 && (
        <p className="aca-cm-thread-empty">{locked ? 'No hay comentarios.' : 'Aún no hay comentarios. ¡Sé el primero en comentar!'}</p>
      )}
      {visibleRoots.map((c) => {
        const kids = (children.get(c.id) || []).filter((x) => !x.deleted)
        const open = expanded.has(c.id) || kids.length <= REPLIES_VISIBLE
        const shown = open ? kids : kids.slice(-REPLIES_VISIBLE)
        const hiddenN = kids.length - shown.length
        return (
          <div className="aca-cm-thread-item" key={c.id}>
            <CommentItem
              c={c}
              onReply={locked ? null : startReply}
              onUpdate={update}
              onAskDelete={setToDelete}
              onReport={setReporting}
            />
            {(kids.length > 0 || replyTo?.rootId === c.id) && (
              <div className="aca-cm-thread-replies">
                {hiddenN > 0 && (
                  <button type="button" className="aca-cm-linkbtn aca-cm-thread-more" onClick={() => setExpanded((s) => new Set(s).add(c.id))}>
                    Ver {hiddenN} {hiddenN === 1 ? 'respuesta anterior' : 'respuestas anteriores'}
                  </button>
                )}
                {shown.map((k) => (
                  <CommentItem
                    key={k.id}
                    c={k}
                    isReply
                    onReply={locked ? null : startReply}
                    onUpdate={update}
                    onAskDelete={setToDelete}
                    onReport={setReporting}
                  />
                ))}
                {replyTo?.rootId === c.id && !locked && (
                  <CommentComposer
                    key={replyTo.key}
                    postId={postId}
                    parentId={c.id}
                    initialText={replyTo.prefill}
                    autoFocus
                    compact
                    onPosted={onPostedReply}
                    onCancel={() => setReplyTo(null)}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="¿Eliminar comentario?"
        message="Se borra para todos. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        tone="danger"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
      <ReportSheet
        open={Boolean(reporting)}
        onClose={() => setReporting(null)}
        targetType="comment"
        targetId={reporting?.id}
        title="Reportar comentario"
      />
    </div>
  )
}
