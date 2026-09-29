import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import { Button, IconButton, InlineAlert, Sheet, ConfirmDialog, useIsPhone } from '../panel/index.js'
import MemberAvatar from './MemberAvatar.jsx'
import ImagePicker from './ImagePicker.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { parseYouTubeId, thumbUrl } from '../../academy/youtube.js'
import { isImageUrl } from '../../academy/url.js'
import { loadDraft, saveDraft, clearDraft } from '../../academy/drafts.js'
import { cx, errMsg, categoryLabel } from './PostCard.jsx'
import '../../styles/academy/comunidad.css'

/* ============================================================
   Compositor de publicaciones (Comunidad, SPEC §7.4).
   Cerrado: la tarjeta "Escribe algo…" de Skool. Abierto: título, texto con
   autocompletado de @menciones, categoría, hasta 4 imágenes (ImagePicker,
   kind 'post'), un enlace de YouTube y una encuesta de 2 a 10 opciones.

   · Escritorio: se expande en el lugar. Celular: hoja a pantalla completa
     (el teclado de iOS no tapa "Publicar", que queda en el pie fijo).
   · Borrador local (src/academy/drafts.js) mientras se escribe: cerrar la
     hoja o que el build se recargue no pierde el texto. "Cancelar" con algo
     escrito pregunta antes de botarlo.
   · data-hold-reload mientras hay texto: buildWatch no recarga la página a
     mitad de una publicación (SPEC §11).
   · Editar usa la misma forma (PostEditorSheet), sin borrador. La encuesta
     no se puede cambiar si ya tiene votos (el backend tampoco lo permite).
   ============================================================ */

export const NEW_POST_DRAFT = 'aca:post:new'
const MAX_IMAGES = 4
const MAX_POLL = 10

/* drafts.js guarda lo que se le pase; acá siempre va un string JSON y se
   lee de vuelta tolerando cualquiera de las dos formas. */
export function readDraftObj(key) {
  try {
    const v = loadDraft(key)
    if (!v) return null
    if (typeof v === 'string') {
      try { return JSON.parse(v) } catch { return null }
    }
    return typeof v === 'object' ? v : null
  } catch {
    return null
  }
}
export function writeDraftObj(key, obj) {
  try { saveDraft(key, JSON.stringify(obj)) } catch { /* sin storage: solo en memoria */ }
}
export function dropDraft(key) {
  try { clearDraft(key) } catch { /* nada */ }
}

/* ---------- Textarea con autocompletado de @menciones ----------
   Busca con members?q= (con espera de 220 ms y descartando respuestas
   viejas) e inserta "@handle ". Flechas/Enter/Tab eligen, Escape cierra el
   menú sin cerrar la hoja de abajo. Crece con el texto hasta maxRows. */
export function MentionTextarea({
  value, onChange, placeholder, className, rows = 3, maxRows = 14, maxLength, autoFocus,
  onKeyDown, inputRef, ariaLabel, disabled, onFocus, enterKeyHint,
}) {
  const ta = useRef(null)
  const [menu, setMenu] = useState(null) // { token, start, end, items, active, loading }
  const seq = useRef(0)
  const timer = useRef(null)
  const blurTimer = useRef(null)

  const setRef = (el) => {
    ta.current = el
    if (typeof inputRef === 'function') inputRef(el)
    else if (inputRef) inputRef.current = el
  }

  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    let lh = 22
    try { lh = parseFloat(window.getComputedStyle(el).lineHeight) || 22 } catch { /* nada */ }
    const max = lh * maxRows + 24
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value, maxRows])

  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(blurTimer.current) }, [])

  const detect = (text, caret) => {
    const upto = text.slice(0, caret)
    const m = /(^|[\s(¿¡])@([^\s@]{1,40})$/u.exec(upto)
    if (!m) return null
    const token = m[2]
    return { token, start: caret - token.length - 1, end: caret }
  }

  const search = (info) => {
    clearTimeout(timer.current)
    if (!info) {
      seq.current += 1
      setMenu(null)
      return
    }
    setMenu((m) => ({ items: m?.items || [], active: 0, ...info, loading: true }))
    const id = ++seq.current
    timer.current = setTimeout(async () => {
      try {
        const d = await academyApi('members', { query: { q: info.token } })
        if (id !== seq.current) return
        const items = (Array.isArray(d?.members) ? d.members : []).filter((x) => x && x.handle).slice(0, 6)
        setMenu((m) => (m ? { ...m, items, active: 0, loading: false } : m))
      } catch {
        if (id === seq.current) setMenu((m) => (m ? { ...m, items: [], loading: false } : m))
      }
    }, 220)
  }

  const pick = (member) => {
    if (!member || !menu) return
    const before = value.slice(0, menu.start)
    const after = value.slice(menu.end)
    const ins = `@${member.handle} `
    onChange(before + ins + after)
    seq.current += 1
    setMenu(null)
    const pos = before.length + ins.length
    requestAnimationFrame(() => {
      const el = ta.current
      if (!el) return
      el.focus()
      try { el.setSelectionRange(pos, pos) } catch { /* nada */ }
    })
  }

  const handleChange = (e) => {
    const v = e.target.value
    onChange(v)
    const caret = typeof e.target.selectionStart === 'number' ? e.target.selectionStart : v.length
    search(detect(v, caret))
  }

  const handleKeyDown = (e) => {
    if (menu && menu.items.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu((m) => ({ ...m, active: (m.active + 1) % m.items.length })); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenu((m) => ({ ...m, active: (m.active - 1 + m.items.length) % m.items.length })); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(menu.items[menu.active]); return }
    }
    if (menu && e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      seq.current += 1
      setMenu(null)
      return
    }
    onKeyDown?.(e)
  }

  const showMenu = menu && (menu.items.length > 0 || menu.loading)

  return (
    <div className="aca-cm-mention-wrap">
      <textarea
        ref={setRef}
        className={cx('aca-cm-textarea', className)}
        value={value}
        rows={rows}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        disabled={disabled}
        enterKeyHint={enterKeyHint}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={(e) => { clearTimeout(blurTimer.current); onFocus?.(e) }}
        onBlur={() => { blurTimer.current = setTimeout(() => { seq.current += 1; setMenu(null) }, 160) }}
        aria-autocomplete="list"
        aria-expanded={Boolean(showMenu)}
      />
      {showMenu && (
        <div className="aca-cm-mention-menu" role="listbox" aria-label="Mencionar a un miembro">
          {menu.items.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={i === menu.active}
              className={cx('aca-cm-mention-opt', i === menu.active && 'is-active')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(m)}
            >
              <MemberAvatar member={m} size={28} showLevel={false} />
              <span className="aca-cm-mention-name">
                <b>{m.name}</b>
                <small>@{m.handle}</small>
              </span>
            </button>
          ))}
          {menu.loading && !menu.items.length && <div className="aca-cm-mention-empty">Buscando…</div>}
        </div>
      )}
    </div>
  )
}

/* ---------- Estado de la forma ---------- */
function emptyForm(categoryId) {
  return { categoryId: categoryId ? String(categoryId) : '', title: '', body: '', images: [], videoInput: '', poll: null, showImages: false, showVideo: false }
}

function fromPost(post) {
  const images = (Array.isArray(post?.attachments) ? post.attachments : [])
    .filter((a) => a && (a.kind === 'image' || !a.kind) && isImageUrl(a.url))
    .map((a) => ({ url: a.url, w: a.w, h: a.h }))
  const poll = post?.poll && Array.isArray(post.poll.options) && post.poll.options.length
    ? { options: post.poll.options.map((o) => String(o?.text || '')) }
    : null
  return {
    categoryId: post?.category?.id ? String(post.category.id) : '',
    title: post?.title || '',
    body: post?.body || '',
    images,
    videoInput: post?.videoId || '',
    poll,
    showImages: images.length > 0,
    showVideo: Boolean(post?.videoId),
  }
}

function sameForm(a, b) {
  const pick = (f) => JSON.stringify([f.categoryId, f.title.trim(), f.body.trim(), f.images.map((i) => i.url), f.videoInput.trim(), f.poll ? f.poll.options : null])
  return pick(a) === pick(b)
}

function hasContent(f) {
  return Boolean(f.title.trim() || f.body.trim() || f.images.length || f.videoInput.trim() || (f.poll && f.poll.options.some((o) => o.trim())))
}

function normImages(v) {
  const arr = Array.isArray(v) ? v : v ? [v] : []
  return arr.filter((i) => i && typeof i.url === 'string').slice(0, MAX_IMAGES)
}

/* ---------- Forma (en línea o en hoja) ---------- */
function ComposerForm({ variant, open, onClose, categories, initial, draftKey, defaultCategoryId, onSaved, onDraftChange }) {
  const { me, isAdmin, isOwner, toast } = useAcademy()
  const isPhone = useIsPhone()
  const editing = Boolean(initial?.id)
  const canAdmin = Boolean(isAdmin || isOwner)
  const writable = categories.filter((c) => c.writeRole !== 'admins' || canAdmin || (editing && initial?.category && Number(initial.category.id) === Number(c.id)))
  const pickDefault = () => {
    if (defaultCategoryId && writable.some((c) => String(c.id) === String(defaultCategoryId))) return defaultCategoryId
    return writable.length === 1 ? writable[0].id : ''
  }
  const makeInitial = () => {
    if (editing) return fromPost(initial)
    const d = readDraftObj(draftKey)
    if (d && typeof d === 'object') {
      const base = emptyForm(pickDefault())
      return {
        ...base,
        categoryId: d.categoryId ? String(d.categoryId) : base.categoryId,
        title: String(d.title || ''),
        body: String(d.body || ''),
        images: normImages(d.images),
        videoInput: String(d.videoInput || ''),
        poll: d.poll && Array.isArray(d.poll.options) ? { options: d.poll.options.map(String).slice(0, MAX_POLL) } : null,
        showImages: normImages(d.images).length > 0,
        showVideo: Boolean(d.videoInput),
      }
    }
    return emptyForm(pickDefault())
  }

  const [form, setForm] = useState(makeInitial)
  const [base, setBase] = useState(() => (editing ? fromPost(initial) : emptyForm(pickDefault())))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const bodyRef = useRef(null)
  const titleRef = useRef(null)
  const wasOpen = useRef(open)

  // Cada vez que se abre, parte desde el borrador (o la publicación a editar).
  useEffect(() => {
    if (open && !wasOpen.current) {
      setForm(makeInitial())
      setBase(editing ? fromPost(initial) : emptyForm(pickDefault()))
      setError('')
      setSaving(false)
    }
    wasOpen.current = open
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Las categorías llegan con el feed: si no había ninguna elegida, se
  // preselecciona la del filtro activo (o la única escribible).
  useEffect(() => {
    if (form.categoryId) return
    const d = pickDefault()
    if (d) setForm((f) => (f.categoryId ? f : { ...f, categoryId: String(d) }))
  }, [categories.length, defaultCategoryId]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setForm((f) => ({ ...f, ...(typeof patch === 'function' ? patch(f) : patch) }))
  const dirty = editing ? !sameForm(form, base) : hasContent(form)

  // Borrador local (solo publicaciones nuevas), con 400 ms de respiro.
  useEffect(() => {
    if (editing || !draftKey || !open) return undefined
    const t = setTimeout(() => {
      if (hasContent(form)) {
        writeDraftObj(draftKey, {
          categoryId: form.categoryId, title: form.title, body: form.body,
          images: form.images.map(({ url, w, h }) => ({ url, w, h })),
          videoInput: form.videoInput, poll: form.poll,
        })
        onDraftChange?.(true)
      } else {
        dropDraft(draftKey)
        onDraftChange?.(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [form, editing, draftKey, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const videoText = form.videoInput.trim()
  let vid = null
  try { vid = videoText ? parseYouTubeId(videoText) : null } catch { vid = null }
  const pollLocked = Boolean(editing && initial?.poll && Number(initial.poll.total) > 0)
  const needsCategory = categories.length > 0
  const canSubmit = Boolean(form.title.trim()) && !saving

  const discard = () => {
    if (!editing && draftKey) { dropDraft(draftKey); onDraftChange?.(false) }
    setForm(emptyForm(pickDefault()))
    setConfirm(false)
    setError('')
    onClose?.()
  }
  const cancel = () => {
    if (saving) return
    if (dirty) setConfirm(true)
    else onClose?.()
  }
  // X / fondo / Escape de la hoja: una publicación nueva queda en borrador;
  // una edición con cambios pregunta.
  const dismiss = () => {
    if (saving) return
    if (editing && dirty) setConfirm(true)
    else onClose?.()
  }

  const insertAt = () => {
    const el = bodyRef.current
    const v = form.body
    const caret = el && typeof el.selectionStart === 'number' ? el.selectionStart : v.length
    const pre = v.slice(0, caret)
    const ins = (pre && !/\s$/.test(pre) ? ' ' : '') + '@'
    const next = pre + ins + v.slice(caret)
    set({ body: next })
    const pos = pre.length + ins.length
    requestAnimationFrame(() => {
      if (!bodyRef.current) return
      bodyRef.current.focus()
      try { bodyRef.current.setSelectionRange(pos, pos) } catch { /* nada */ }
    })
  }

  const togglePoll = () => {
    if (pollLocked) return
    set((f) => ({ poll: f.poll ? null : { options: ['', ''] } }))
  }
  const setPollOpt = (i, text) => set((f) => ({ poll: { options: f.poll.options.map((o, j) => (j === i ? text : o)) } }))
  const addPollOpt = () => set((f) => ({ poll: { options: f.poll.options.length < MAX_POLL ? [...f.poll.options, ''] : f.poll.options } }))
  const removePollOpt = (i) => set((f) => ({ poll: { options: f.poll.options.filter((_, j) => j !== i) } }))

  const submit = async () => {
    setError('')
    const title = form.title.trim()
    if (!title) { setError('Escribe un título'); titleRef.current?.focus(); return }
    if (needsCategory && !form.categoryId) { setError('Elige una categoría'); return }
    if (videoText && !vid) { setError('Ese enlace de YouTube no es válido'); return }
    let poll = null
    if (form.poll) {
      const opts = form.poll.options.map((o) => o.trim()).filter(Boolean)
      if (!pollLocked) {
        if (opts.length < 2) { setError('La encuesta necesita al menos 2 opciones'); return }
        if (opts.length > MAX_POLL) { setError(`La encuesta admite hasta ${MAX_POLL} opciones`); return }
        if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) { setError('Hay opciones repetidas en la encuesta'); return }
      }
      poll = { options: opts }
    }
    const payload = {
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      title,
      body: form.body.trim(),
      attachments: form.images.filter((i) => i && i.url).map(({ url, w, h }) => ({ url, w, h })),
      video: vid || null,
      poll,
    }
    if (editing) payload.id = initial.id
    setSaving(true)
    try {
      const d = await academyApi('post-save', { method: 'POST', body: payload })
      if (!editing && draftKey) { dropDraft(draftKey); onDraftChange?.(false) }
      setForm(emptyForm(pickDefault()))
      toast?.(editing ? 'Publicación actualizada' : 'Publicación creada', 'ok')
      onSaved?.(d?.post || null)
      onClose?.()
    } catch (e) {
      setError(errMsg(e, editing ? 'No se pudieron guardar los cambios' : 'No se pudo publicar'))
    } finally {
      setSaving(false)
    }
  }

  const onBodyKey = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() }
  }

  const categorySelect = needsCategory ? (
    <label className="aca-cm-composer-cat">
      <span className="aca-cm-sr">Categoría</span>
      <select value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })} disabled={saving}>
        <option value="">Elige una categoría</option>
        {writable.map((c) => <option key={c.id} value={String(c.id)}>{categoryLabel(c)}</option>)}
      </select>
      <Icon name="chevronDown" size={14} />
    </label>
  ) : null

  const fields = (
    <div className="aca-cm-composer-fields" data-hold-reload={dirty ? '' : undefined}>
      <div className="aca-cm-composer-who">
        <MemberAvatar member={me} size={36} />
        <div className="aca-cm-composer-who-text">
          <b>{me?.name || 'Tú'}</b>
          {needsCategory && <span> publicando en</span>}
        </div>
        {needsCategory && <div className="aca-cm-composer-who-cat">{categorySelect}</div>}
      </div>
      <input
        ref={titleRef}
        className="aca-cm-composer-title"
        type="text"
        value={form.title}
        onChange={(e) => set({ title: e.target.value })}
        placeholder="Título"
        aria-label="Título"
        maxLength={160}
        autoFocus={variant === 'inline' || !isPhone}
        enterKeyHint="next"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); bodyRef.current?.focus() } }}
      />
      <MentionTextarea
        inputRef={bodyRef}
        className="aca-cm-composer-text"
        value={form.body}
        onChange={(v) => set({ body: v })}
        placeholder="Escribe algo… (usa @ para mencionar)"
        ariaLabel="Texto de la publicación"
        rows={variant === 'sheet' ? 6 : 4}
        maxLength={10000}
        onKeyDown={onBodyKey}
      />

      {form.showImages && (
        <div className="aca-cm-composer-block">
          <div className="aca-cm-composer-block-head">
            <span><Icon name="image" size={15} /> Imágenes <small>hasta {MAX_IMAGES}</small></span>
            {!form.images.length && (
              <button type="button" className="aca-cm-linkbtn" onClick={() => set({ showImages: false })}>Quitar</button>
            )}
          </div>
          <ImagePicker kind="post" max={MAX_IMAGES} value={form.images} onChange={(v) => set({ images: normImages(v) })} />
        </div>
      )}

      {form.showVideo && (
        <div className="aca-cm-composer-block">
          <div className="aca-cm-composer-block-head">
            <span><Icon name="video" size={15} /> Video de YouTube</span>
            <button type="button" className="aca-cm-linkbtn" onClick={() => set({ showVideo: false, videoInput: '' })}>Quitar video</button>
          </div>
          <input
            className="aca-cm-input"
            type="url"
            inputMode="url"
            value={form.videoInput}
            onChange={(e) => set({ videoInput: e.target.value })}
            placeholder="https://youtu.be/…"
            aria-label="Enlace de YouTube"
            maxLength={300}
          />
          {vid ? (
            <div className="aca-cm-composer-vprev">
              <img src={thumbUrl(vid)} alt="" loading="lazy" />
              <span aria-hidden="true"><Icon name="play" size={18} /></span>
            </div>
          ) : videoText ? (
            <p className="aca-cm-field-error">Ese enlace de YouTube no es válido</p>
          ) : (
            <p className="aca-cm-hint">Pega el enlace de un video (también sirven los no listados con "Permitir insertar").</p>
          )}
        </div>
      )}

      {form.poll && (
        <div className="aca-cm-composer-block aca-cm-pollb">
          <div className="aca-cm-composer-block-head">
            <span><Icon name="chart" size={15} /> Encuesta</span>
            {!pollLocked && <button type="button" className="aca-cm-linkbtn" onClick={togglePoll}>Quitar encuesta</button>}
          </div>
          {pollLocked && <p className="aca-cm-hint">La encuesta ya tiene votos: sus opciones no se pueden cambiar.</p>}
          {form.poll.options.map((o, i) => (
            <div className="aca-cm-pollb-row" key={i}>
              <input
                className="aca-cm-input"
                type="text"
                value={o}
                onChange={(e) => setPollOpt(i, e.target.value)}
                placeholder={`Opción ${i + 1}`}
                aria-label={`Opción ${i + 1}`}
                maxLength={80}
                disabled={pollLocked}
              />
              {!pollLocked && form.poll.options.length > 2 && (
                <IconButton icon="close" label={`Quitar opción ${i + 1}`} plain small onClick={() => removePollOpt(i)} />
              )}
            </div>
          ))}
          {!pollLocked && form.poll.options.length < MAX_POLL && (
            <button type="button" className="aca-cm-linkbtn aca-cm-pollb-add" onClick={addPollOpt}>
              <Icon name="plus" size={14} /> Agregar opción
            </button>
          )}
        </div>
      )}

      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </div>
  )

  const tools = (
    <div className="aca-cm-composer-tools" role="toolbar" aria-label="Agregar a la publicación">
      <IconButton
        icon="image"
        label="Agregar imágenes"
        plain
        className={cx(form.showImages && 'is-on')}
        onClick={() => set({ showImages: true })}
        disabled={saving}
      />
      <IconButton
        icon="video"
        label="Agregar un video de YouTube"
        plain
        className={cx(form.showVideo && 'is-on')}
        onClick={() => set({ showVideo: true })}
        disabled={saving}
      />
      <IconButton
        icon="chart"
        label={form.poll ? 'Quitar encuesta' : 'Agregar encuesta'}
        plain
        className={cx(form.poll && 'is-on')}
        onClick={togglePoll}
        disabled={saving || pollLocked}
      />
      <IconButton icon="at" label="Mencionar a alguien" plain onClick={insertAt} disabled={saving} />
    </div>
  )

  const actions = (
    <div className="aca-cm-composer-actions">
      <Button variant="plain" onClick={cancel} disabled={saving} className="aca-cm-composer-cancel">Cancelar</Button>
      <Button variant="primary" className="aca-cm-btn-accent" onClick={submit} loading={saving} disabled={!canSubmit}>
        {editing ? 'Guardar' : 'Publicar'}
      </Button>
    </div>
  )

  const confirmDialog = (
    <ConfirmDialog
      open={confirm}
      title={editing ? '¿Descartar los cambios?' : '¿Descartar la publicación?'}
      message={editing ? 'Lo que cambiaste no se va a guardar.' : 'Se borra lo que escribiste, también el borrador guardado.'}
      confirmLabel="Descartar"
      cancelLabel="Seguir escribiendo"
      tone="danger"
      onConfirm={discard}
      onCancel={() => setConfirm(false)}
    />
  )

  if (variant === 'sheet') {
    return (
      <>
        <Sheet
          open={open}
          onClose={dismiss}
          title={editing ? 'Editar publicación' : 'Crear publicación'}
          size="md"
          full={isPhone}
          className="aca-cm-composer-sheet"
          dismissible={!saving}
          initialFocusRef={editing ? undefined : titleRef}
          footer={<div className="aca-cm-composer-foot is-sheet">{tools}{actions}</div>}
        >
          {fields}
        </Sheet>
        {confirmDialog}
      </>
    )
  }

  return (
    <div className="aca-cm-composer is-open aca-cm-card">
      {fields}
      <div className="aca-cm-composer-foot">
        {tools}
        {actions}
      </div>
      {confirmDialog}
    </div>
  )
}

/* ============================================================
   Tarjeta del feed. `categories` y `defaultCategoryId` (la categoría del
   filtro activo) vienen del feed. Sin categorías escribibles (p. ej. todas
   son "solo admins" y yo soy miembro) no se muestra nada.
   ============================================================ */
export default function PostComposer({ categories = [], categoriesLoaded = true, defaultCategoryId, onCreated }) {
  const { me, isAdmin, isOwner } = useAcademy()
  const isPhone = useIsPhone()
  const [open, setOpen] = useState(false)
  const [hasDraft, setHasDraft] = useState(() => Boolean(readDraftObj(NEW_POST_DRAFT)))
  const close = useCallback(() => setOpen(false), [])
  const canAdmin = Boolean(isAdmin || isOwner)
  const list = Array.isArray(categories) ? categories : []
  const writable = list.filter((c) => c.writeRole !== 'admins' || canAdmin)
  if (categoriesLoaded && list.length > 0 && writable.length === 0) return null

  const collapsed = (
    <button type="button" className="aca-cm-composer is-collapsed aca-cm-card" onClick={() => setOpen(true)} aria-label="Escribir una publicación">
      <MemberAvatar member={me} size={40} />
      <span className="aca-cm-composer-ph">{hasDraft ? 'Continúa tu borrador…' : 'Escribe algo…'}</span>
      {hasDraft && <span className="aca-cm-composer-draft">Borrador</span>}
    </button>
  )

  const form = (variant) => (
    <ComposerForm
      variant={variant}
      open={open}
      onClose={close}
      categories={list}
      draftKey={NEW_POST_DRAFT}
      defaultCategoryId={defaultCategoryId}
      onSaved={(p) => { if (p) onCreated?.(p) }}
      onDraftChange={setHasDraft}
    />
  )

  if (isPhone) return <>{collapsed}{form('sheet')}</>
  if (!open) return collapsed
  return form('inline')
}

/* Hoja para editar una publicación existente (autor o staff). */
export function PostEditorSheet({ open, post, categories = [], onClose, onSaved }) {
  if (!post) return null
  return (
    <ComposerForm
      variant="sheet"
      open={open}
      onClose={onClose}
      categories={Array.isArray(categories) ? categories : []}
      initial={post}
      onSaved={onSaved}
    />
  )
}
