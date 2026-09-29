import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Button, ActionMenu, ConfirmDialog, Sheet, Field } from '../panel/index.js'
import { academyApi } from '../../academy/api.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { useAcademy } from '../../academy/context.js'
import { timeAgo } from '../../academy/time.js'
import { loadDraft, saveDraft, clearDraft } from '../../academy/drafts.js'
import { r } from '../../academy/routes.js'
import MemberAvatar from './MemberAvatar.jsx'
import RichText from './RichText.jsx'
import PageState from './PageState.jsx'
import '../../styles/academy/cursos.css'

/* ============================================================
   Comentarios de una lección (mode lesson-comments / comment-save /
   comment-delete / like / report). Dos niveles, como Skool: comentario y
   respuestas; responder a una respuesta cuelga del mismo comentario raíz y
   precarga "@handle ".
   El texto se pinta con RichText (nodos de texto de React, nunca HTML).
   Borrador del comentario en localStorage (drafts.js): si buildWatch recarga
   por un deploy, lo escrito no se pierde.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')
const MAX_BODY = 5000
const REPLIES_PREVIEW = 3

const byDate = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || (Number(a.id) - Number(b.id))

function errText(err, fallback) {
  return (err && err.message) || fallback
}

/* ---------- Caja de texto (nuevo comentario, respuesta, edición) ---------- */
function Composer({ me, initial = '', draftKey, placeholder, autoFocus, submitLabel = 'Comentar', onSubmit, onCancel, compact }) {
  const [text, setText] = useState(() => {
    if (initial) return initial
    if (!draftKey) return ''
    try { return loadDraft(draftKey) || '' } catch { return '' }
  })
  const [busy, setBusy] = useState(false)
  const [focused, setFocused] = useState(Boolean(autoFocus))
  const ta = useRef(null)

  const grow = () => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }
  useEffect(() => {
    grow()
    if (autoFocus && ta.current) {
      const el = ta.current
      el.focus({ preventScroll: false })
      const end = el.value.length
      try { el.setSelectionRange(end, end) } catch {}
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const change = (v) => {
    setText(v)
    if (draftKey) {
      try { v ? saveDraft(draftKey, v) : clearDraft(draftKey) } catch {}
    }
    requestAnimationFrame(grow)
  }

  const submit = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      const ok = await onSubmit(body)
      if (ok !== false) {
        setText('')
        if (draftKey) { try { clearDraft(draftKey) } catch {} }
        requestAnimationFrame(grow)
        if (!onCancel) setFocused(false)
      }
    } finally {
      setBusy(false)
    }
  }

  const expanded = focused || Boolean(text) || Boolean(onCancel)
  return (
    <div className={cx('aca-lcom-composer', compact && 'is-compact', expanded && 'is-expanded')}>
      {me && <MemberAvatar member={me} size={compact ? 30 : 36} showLevel={false} />}
      <div className="aca-lcom-input">
        <textarea
          ref={ta}
          rows={1}
          value={text}
          maxLength={MAX_BODY}
          placeholder={placeholder}
          aria-label={placeholder}
          onFocus={() => setFocused(true)}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() }
            if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel() }
          }}
        />
        {expanded && (
          <div className="aca-lcom-input-actions">
            {onCancel && <Button variant="plain" size="sm" onClick={onCancel} disabled={busy}>Cancelar</Button>}
            <button type="button" className="aca-cbtn is-accent is-sm" disabled={!text.trim() || busy} onClick={submit} aria-busy={busy || undefined}>
              {busy ? 'Enviando…' : submitLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- Un comentario ---------- */
function CommentItem({ c, me, canModerate, isReply, onReply, onEdit, onDelete, onLike, onReport, editing, setEditing }) {
  const mine = me && c.author && Number(c.author.id) === Number(me.id)
  if (c.deleted) {
    return (
      <div className={cx('aca-lcom', isReply && 'is-reply', 'is-deleted')}>
        <span className="aca-lcom-deleted-ava" aria-hidden="true"><Icon name="trash" size={14} /></span>
        <p className="aca-lcom-deleted">Comentario eliminado</p>
      </div>
    )
  }
  const author = c.author || {}
  const items = [
    mine && { label: 'Editar', icon: 'pencil', onClick: () => setEditing(c.id) },
    !mine && { label: 'Reportar', icon: 'flag', onClick: () => onReport(c) },
    (mine || canModerate) && { label: 'Eliminar', icon: 'trash', danger: true, onClick: () => onDelete(c) },
  ].filter(Boolean)

  return (
    <div className={cx('aca-lcom', isReply && 'is-reply')} id={`comentario-${c.id}`}>
      {author.handle
        ? <Link to={r.profile(author.handle)} className="aca-lcom-ava" aria-label={author.name}><MemberAvatar member={author} size={isReply ? 30 : 36} /></Link>
        : <span className="aca-lcom-ava"><MemberAvatar member={author} size={isReply ? 30 : 36} /></span>}
      <div className="aca-lcom-main">
        {editing ? (
          <Composer
            me={null}
            initial={c.body}
            placeholder="Edita tu comentario"
            autoFocus
            compact
            submitLabel="Guardar"
            onCancel={() => setEditing(null)}
            onSubmit={async (body) => { const ok = await onEdit(c, body); if (ok) setEditing(null); return ok }}
          />
        ) : (
          <>
            <div className="aca-lcom-bubble">
              <div className="aca-lcom-meta">
                {author.handle
                  ? <Link to={r.profile(author.handle)} className="aca-lcom-name">{author.name || 'Miembro'}</Link>
                  : <span className="aca-lcom-name">{author.name || 'Miembro'}</span>}
                {c.createdAt && <span className="aca-lcom-time">· {timeAgo(c.createdAt)}</span>}
                {c.editedAt && <span className="aca-lcom-time">(editado)</span>}
                {items.length > 0 && (
                  <ActionMenu items={items} small className="aca-lcom-menu" label="Opciones del comentario" />
                )}
              </div>
              <RichText text={c.body || ''} className="aca-lcom-body" />
            </div>
            <div className="aca-lcom-actions">
              <button
                type="button"
                className={cx('aca-lcom-like', c.liked && 'is-on')}
                onClick={() => onLike(c)}
                disabled={mine}
                aria-pressed={Boolean(c.liked)}
                aria-label={mine ? 'No puedes darle me gusta a tu propio comentario' : c.liked ? 'Quitar me gusta' : 'Me gusta'}
                title={mine ? 'No puedes darle me gusta a tu propio comentario' : undefined}
              >
                <Icon name={c.liked ? 'heartFill' : 'heart'} size={15} stroke={1.9} />
                {Number(c.likeCount) > 0 && <span>{c.likeCount}</span>}
              </button>
              <button type="button" className="aca-lcom-reply" onClick={() => onReply(c)}>
                <Icon name="reply" size={15} stroke={1.9} />
                <span>Responder</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- Lista completa ---------- */
export default function LessonComments({ lessonId }) {
  const { me, isStaff, isModerator, isAdmin, isOwner, toast } = useAcademy() || {}
  const canModerate = Boolean(isStaff || isModerator || isAdmin || isOwner)
  const notify = (msg, kind) => { try { toast?.(msg, kind) } catch {} }

  const q = useAcademyQuery(
    `lesson-comments:${lessonId}`,
    () => academyApi('lesson-comments', { query: { lessonId } }),
    { deps: [lessonId], enabled: Boolean(lessonId) },
  )
  // Última versión de los datos, para encadenar actualizaciones sin depender
  // de si setData acepta una función.
  const latest = useRef(q.data)
  latest.current = q.data
  const update = (fn) => {
    const cur = latest.current || { comments: [] }
    const next = { ...cur, comments: fn(Array.isArray(cur.comments) ? cur.comments : []) }
    latest.current = next
    q.setData(next)
  }

  const [replyTo, setReplyTo] = useState(null) // { rootId, prefill }
  const [editing, setEditing] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [reporting, setReporting] = useState(null)
  const [reportReason, setReportReason] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())

  const comments = Array.isArray(q.data?.comments) ? q.data.comments : []
  const { tops, children, visibleCount } = useMemo(() => {
    const ids = new Set(comments.map((c) => c.id))
    const kids = new Map()
    const roots = []
    for (const c of comments) {
      if (c.parentId && ids.has(c.parentId)) {
        if (!kids.has(c.parentId)) kids.set(c.parentId, [])
        kids.get(c.parentId).push(c)
      } else {
        roots.push(c)
      }
    }
    for (const list of kids.values()) list.sort(byDate)
    // Raíces de la más nueva a la más vieja (la caja está arriba: lo que uno
    // acaba de escribir queda a la vista); respuestas en orden de conversación.
    // Un comentario eliminado sin respuestas no deja rastro.
    const shownRoots = roots.sort((a, b) => byDate(b, a)).filter((c) => !c.deleted || (kids.get(c.id) || []).some((k) => !k.deleted))
    return { tops: shownRoots, children: kids, visibleCount: comments.filter((c) => !c.deleted).length }
  }, [comments])

  const submitNew = async (body, parentId = null) => {
    try {
      const res = await academyApi('comment-save', { method: 'POST', body: { lessonId, parentId: parentId || undefined, body } })
      if (res?.comment) update((list) => [...list.filter((x) => x.id !== res.comment.id), res.comment])
      else q.refetch?.()
      return true
    } catch (err) {
      notify(errText(err, 'No se pudo publicar el comentario'), 'error')
      return false
    }
  }

  const onEdit = async (c, body) => {
    try {
      const res = await academyApi('comment-save', { method: 'POST', body: { id: c.id, lessonId, body } })
      const saved = res?.comment || { ...c, body, editedAt: new Date().toISOString() }
      update((list) => list.map((x) => (x.id === c.id ? { ...x, ...saved } : x)))
      return true
    } catch (err) {
      notify(errText(err, 'No se pudo guardar el cambio'), 'error')
      return false
    }
  }

  const doDelete = async () => {
    const c = confirmDel
    if (!c) return
    setDeleting(true)
    try {
      await academyApi('comment-delete', { method: 'POST', body: { id: c.id } })
      update((list) => list.map((x) => (x.id === c.id ? { ...x, deleted: true, body: '' } : x)))
      setConfirmDel(null)
    } catch (err) {
      notify(errText(err, 'No se pudo eliminar el comentario'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const onLike = async (c) => {
    const want = !c.liked
    const prev = { liked: c.liked, likeCount: c.likeCount }
    update((list) => list.map((x) => (x.id === c.id ? { ...x, liked: want, likeCount: Math.max(0, (Number(x.likeCount) || 0) + (want ? 1 : -1)) } : x)))
    try {
      const res = await academyApi('like', { method: 'POST', body: { targetType: 'comment', targetId: c.id, like: want } })
      if (res && typeof res.likeCount === 'number') {
        update((list) => list.map((x) => (x.id === c.id ? { ...x, liked: Boolean(res.liked), likeCount: res.likeCount } : x)))
      }
    } catch (err) {
      update((list) => list.map((x) => (x.id === c.id ? { ...x, ...prev } : x)))
      notify(errText(err, 'No se pudo registrar el me gusta'), 'error')
    }
  }

  const onReply = (c) => {
    const rootId = c.parentId && children.has(c.parentId) ? c.parentId : c.id
    const isNested = rootId !== c.id
    const handle = c.author?.handle
    const mineTarget = me && c.author && Number(c.author.id) === Number(me.id)
    setReplyTo({ rootId, prefill: isNested && handle && !mineTarget ? `@${handle} ` : '', key: `${c.id}-${Date.now()}` })
    setExpanded((prev) => new Set(prev).add(rootId))
  }

  const sendReport = async () => {
    const c = reporting
    if (!c) return
    setReportBusy(true)
    try {
      await academyApi('report', { method: 'POST', body: { targetType: 'comment', targetId: c.id, reason: reportReason.trim() } })
      notify('Gracias. El equipo lo va a revisar.')
      setReporting(null)
      setReportReason('')
    } catch (err) {
      notify(errText(err, 'No se pudo enviar el reporte'), 'error')
    } finally {
      setReportBusy(false)
    }
  }

  const itemProps = {
    me, canModerate, onReply, onEdit, onLike,
    onDelete: (c) => setConfirmDel(c),
    onReport: (c) => { setReporting(c); setReportReason('') },
    setEditing,
  }

  return (
    <section className="aca-lcoms" aria-label="Comentarios">
      <h2 className="aca-lcoms-title">
        Comentarios{visibleCount > 0 && <span className="aca-lcoms-count">{visibleCount}</span>}
      </h2>

      <Composer
        me={me}
        draftKey={lessonId ? `lesson-comment:${lessonId}` : null}
        placeholder="Escribe un comentario…"
        onSubmit={(body) => submitNew(body)}
      />

      <PageState
        loading={q.loading && !q.data}
        error={q.data ? null : q.error}
        onRetry={q.refetch}
        empty={!q.loading && !q.error && tops.length === 0}
        emptyText="Aún no hay comentarios. Pregunta lo que quieras sobre esta clase."
      >
        <ul className="aca-lcom-list">
          {tops.map((c) => {
            const kids = children.get(c.id) || []
            const showAll = expanded.has(c.id) || kids.length <= REPLIES_PREVIEW
            const shown = showAll ? kids : kids.slice(0, REPLIES_PREVIEW)
            return (
              <li key={c.id} className="aca-lcom-thread">
                <CommentItem c={c} editing={editing === c.id} {...itemProps} />
                {(kids.length > 0 || replyTo?.rootId === c.id) && (
                  <ul className="aca-lcom-replies">
                    {shown.map((k) => (
                      <li key={k.id}><CommentItem c={k} isReply editing={editing === k.id} {...itemProps} /></li>
                    ))}
                    {!showAll && (
                      <li>
                        <button type="button" className="aca-lcom-more" onClick={() => setExpanded((prev) => new Set(prev).add(c.id))}>
                          Ver {kids.length - REPLIES_PREVIEW} {kids.length - REPLIES_PREVIEW === 1 ? 'respuesta más' : 'respuestas más'}
                        </button>
                      </li>
                    )}
                    {replyTo?.rootId === c.id && (
                      <li>
                        <Composer
                          key={replyTo.key}
                          me={me}
                          compact
                          autoFocus
                          initial={replyTo.prefill}
                          placeholder="Escribe una respuesta…"
                          submitLabel="Responder"
                          onCancel={() => setReplyTo(null)}
                          onSubmit={async (body) => {
                            const ok = await submitNew(body, c.id)
                            if (ok) setReplyTo(null)
                            return ok
                          }}
                        />
                      </li>
                    )}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </PageState>

      <ConfirmDialog
        open={Boolean(confirmDel)}
        title="¿Eliminar este comentario?"
        message="No se puede deshacer."
        confirmLabel="Eliminar"
        tone="danger"
        busy={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDel(null)}
      />

      <Sheet
        open={Boolean(reporting)}
        onClose={() => { if (!reportBusy) setReporting(null) }}
        title="Reportar comentario"
        subtitle="Solo lo ve el equipo de la Academy."
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setReporting(null)} disabled={reportBusy}>Cancelar</Button>
            <Button variant="primary" onClick={sendReport} loading={reportBusy}>Reportar</Button>
          </>
        )}
      >
        <Field label="Motivo" optional htmlFor="aca-report-reason">
          <textarea
            id="aca-report-reason"
            className="aca-c-textarea"
            rows={3}
            maxLength={500}
            value={reportReason}
            placeholder="Cuéntanos qué pasa (spam, ofensivo…)"
            onChange={(e) => setReportReason(e.target.value)}
          />
        </Field>
      </Sheet>
    </section>
  )
}
