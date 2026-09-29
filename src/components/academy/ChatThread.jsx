import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Button, IconButton, ActionMenu, ConfirmDialog, Sheet, Field, InlineAlert, initialsOf } from '../panel/index.js'
import MemberAvatar from './MemberAvatar.jsx'
import RichText from './RichText.jsx'
import PageState from './PageState.jsx'
import { academyApi } from '../../academy/api.js'
import { getToken } from '../../academy/session.js'
import { useAcademy } from '../../academy/context.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { useSync } from '../../academy/useSync.js'
import { loadDraft, saveDraft, clearDraft } from '../../academy/drafts.js'
import { uploadImage } from '../../academy/upload.js'
import { isImageUrl, isChatFileUrl, isLocalPreviewUrl } from '../../academy/url.js'
import { r } from '../../academy/routes.js'
import { viewerTz, dayKeyIn, fmtTime24, longDate, capitalize, addDaysKey } from './MonthGrid.jsx'
import '../../styles/academy/chat.css'

/* ============================================================
   ChatThread — el hilo de un chat (DM o grupo). Lo usan la ventana
   acoplada de escritorio (ChatWindow), la pantalla completa del celular
   (ChatPage) y la sala de un grupo (GrupoPage). SPEC §5.4, §7.4, §9.

   - Carga `chat` (≤ 40 mensajes) y "Cargar mensajes anteriores" con `before`.
   - Lo nuevo llega por useSync({chatId, since}) — el único polling
     permitido, con sus propias reglas de visibilidad/foco/actividad.
   - Separador "Nuevos mensajes" en el último leído al abrir, y "Visto"
     bajo mi último mensaje si alguien más ya leyó hasta ahí.
   - Envío optimista (`chat-send`); si falla, la burbuja queda con
     "Reintentar". Borrador por chat en localStorage (drafts.js).
   - Imágenes privadas: se suben con uploadImage('chat', f, {private:true})
     y se muestran pidiendo el proxy `file` con fetch + Authorization (un
     <img src> no manda el token) → blob: local.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')
const PAGE_SIZE = 40
const MAX_ATTACHMENTS = 4
const MAX_BODY = 4000
const GROUP_WINDOW_MS = 5 * 60 * 1000

/* ---------- Imágenes privadas del chat ---------- */

// url del proxy → Promise<blob: URL>. Se cachea por sesión (una foto del chat
// no cambia) y se descartan las más viejas para no acumular memoria.
const privateCache = new Map()
function fetchPrivateImage(url) {
  if (privateCache.has(url)) return privateCache.get(url)
  const token = getToken()
  const p = fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'same-origin',
  })
    .then((res) => {
      const type = res.headers.get('content-type') || ''
      if (!res.ok || /json|html|text\//i.test(type)) throw new Error(`file ${res.status}`)
      return res.blob()
    })
    .then((blob) => URL.createObjectURL(blob))
  p.catch(() => privateCache.delete(url))
  privateCache.set(url, p)
  if (privateCache.size > 80) {
    const [oldKey, oldPromise] = privateCache.entries().next().value
    privateCache.delete(oldKey)
    oldPromise.then((u) => setTimeout(() => URL.revokeObjectURL(u), 60000)).catch(() => {})
  }
  return p
}

/* Imagen de un mensaje: vista previa local (blob:/data: creada en este
   navegador), proxy privado del chat, o imagen pública del Blob/assets.
   Cualquier otra cosa no se pinta. */
export function ChatImage({ src, className, alt = '' }) {
  const local = isLocalPreviewUrl(src)
  const pub = !local && isImageUrl(src)
  const priv = !local && !pub && isChatFileUrl(src)
  const [url, setUrl] = useState(local || pub ? src : null)
  const [failed, setFailed] = useState(!local && !pub && !priv)

  useEffect(() => {
    if (!priv) return undefined
    let alive = true
    setFailed(false)
    fetchPrivateImage(src)
      .then((u) => { if (alive) setUrl(u) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [src, priv])

  if (failed) {
    return (
      <span className={cx('aca-msg-img is-failed', className)}>
        <Icon name="image" size={16} /> Imagen no disponible
      </span>
    )
  }
  if (!url) return <span className={cx('aca-msg-img is-loading', className)} aria-label="Cargando imagen" />
  return <img className={cx('aca-msg-img', className)} src={url} alt={alt} loading="lazy" decoding="async" />
}

/* Mosaico de un grupo (portada o iniciales), para listas y encabezados. */
export function GroupTile({ cohort, name, size = 40 }) {
  const cover = cohort?.coverUrl && isImageUrl(cohort.coverUrl) ? cohort.coverUrl : null
  const label = cohort?.name || name || 'Grupo'
  return (
    <span className="aca-grouptile" style={{ '--s': `${size}px` }} aria-hidden="true">
      {cover ? <img src={cover} alt="" loading="lazy" /> : initialsOf(label)}
    </span>
  )
}

/* Nombre visible de un chat: la otra persona en un DM, el grupo en un grupo. */
export function chatTitle(chat) {
  if (!chat) return 'Chat'
  if (chat.kind === 'grupo') return chat.cohort?.name || chat.name || 'Grupo'
  return chat.other?.name || chat.name || 'Chat'
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'este miembro'
}

function mergeMessages(prev, incoming) {
  if (!incoming || !incoming.length) return prev
  const map = new Map(prev.map((m) => [m.id, m]))
  for (const raw of incoming) {
    const id = Number(raw?.id)
    if (!raw || !Number.isFinite(id)) continue
    map.set(id, { ...raw, id })
  }
  return [...map.values()].sort((a, b) => a.id - b.id)
}

function sendErrorText(err) {
  if (!err) return 'No se pudo enviar.'
  if (err.status === 429) return 'Vas muy rápido. Espera unos segundos y reintenta.'
  if (err.status === 0) return 'Sin conexión. Reintenta cuando vuelvas a tener internet.'
  return err.message || 'No se pudo enviar.'
}

// `chat` trae canSend/cantSendReason: se explica el motivo en vez de dejar
// escribir y que el envío falle con 403.
function lockedText(reason, other) {
  switch (reason) {
    case 'archived': return 'Este grupo está archivado: el chat quedó en solo lectura.'
    case 'inactive': return 'Este miembro ya no está en la Academy.'
    case 'no_dm': return 'No puedes chatear con este miembro.'
    case 'chat_off_self': return 'Tienes el chat apagado. Actívalo en Ajustes → Chat.'
    case 'chat_off': return `${firstName(other?.name)} tiene el chat apagado.`
    case 'level': return 'El chat se desbloquea al subir de nivel.'
    default: return 'No puedes escribir en este chat.'
  }
}

function dayLabel(key, todayKey, tz, date) {
  if (key === todayKey) return 'Hoy'
  if (key === addDaysKey(todayKey, -1)) return 'Ayer'
  return capitalize(longDate(date, tz))
}

const isCoarse = () => {
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}

let tmpSeq = 0

/* ------------------------------------------------------------------ */

function ThreadHeader({ chat, members, variant, minimized, onMinimize, onClose, onBack, menuItems }) {
  const navigate = useNavigate()
  const isGroup = chat?.kind === 'grupo'
  const other = chat?.other
  const title = chatTitle(chat)
  const sub = isGroup
    ? `${members?.length || 0} ${members?.length === 1 ? 'miembro' : 'miembros'}`
    : other?.handle ? `@${other.handle}` : ''

  const onTitle = () => {
    if (variant === 'window' && onMinimize) { onMinimize(); return }
    if (isGroup && chat?.cohort?.id) navigate(r.group(chat.cohort.id))
    else if (other?.handle) navigate(r.profile(other.handle))
  }

  return (
    <header className={cx('aca-thread-head', variant === 'window' && 'is-window')}>
      {onBack && <IconButton icon="chevronLeft" label="Volver" plain small onClick={onBack} className="aca-thread-back" />}
      <button type="button" className="aca-thread-who" onClick={onTitle} aria-label={variant === 'window' ? (minimized ? `Abrir chat con ${title}` : `Minimizar chat con ${title}`) : title}>
        <span className="aca-thread-avatar">
          {isGroup
            ? <GroupTile cohort={chat?.cohort} name={title} size={32} />
            : <MemberAvatar member={other || { name: title }} size={32} showLevel={false} />}
        </span>
        <span className="aca-thread-names">
          <span className="aca-thread-title">{title}</span>
          {sub && <span className="aca-thread-sub">{sub}</span>}
        </span>
      </button>
      <span className="aca-thread-actions">
        {!minimized && menuItems?.length > 0 && <ActionMenu items={menuItems} label="Opciones del chat" small />}
        {variant === 'window' && onMinimize && (
          <IconButton icon={minimized ? 'chevronUp' : 'minus'} label={minimized ? 'Abrir' : 'Minimizar'} plain small onClick={onMinimize} />
        )}
        {onClose && <IconButton icon="close" label="Cerrar chat" plain small onClick={onClose} />}
      </span>
    </header>
  )
}

/* ------------------------------------------------------------------ */

function ChatThreadInner({ chatId, fullHeight = false, variant = 'page', minimized = false, onMinimize, onClose, onBack, headerless = false }) {
  const { me, toast, refreshUnread } = useAcademy()
  const navigate = useNavigate()
  const tz = viewerTz(me)
  const id = Number(chatId)

  const q = useAcademyQuery(
    `chat:${id}`,
    () => academyApi('chat', { query: { id } }),
    { deps: [id], refetchOnFocus: false, enabled: Number.isInteger(id) && id > 0 },
  )
  const data = q.data
  const chat = data?.chat || null
  const isGroup = chat?.kind === 'grupo'
  const other = chat?.other || null

  const [msgs, setMsgs] = useState([])
  const [pending, setPending] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [othersRead, setOthersRead] = useState(0)
  const [muted, setMuted] = useState(false)
  const [notice, setNotice] = useState('')
  const [newBelow, setNewBelow] = useState(0)
  const [lightbox, setLightbox] = useState(null)
  const [report, setReport] = useState(null) // { targetType, targetId, label }
  const [reportReason, setReportReason] = useState('')
  const [reporting, setReporting] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [visible, setVisible] = useState(() => (typeof document === 'undefined' ? true : document.visibilityState === 'visible'))

  const initialReadRef = useRef(null)
  const readSentRef = useRef(0)
  const suppressReadRef = useRef(false)
  const unreadRefreshAt = useRef(0)
  const scrollRef = useRef(null)
  const stickRef = useRef(true)
  const didInitialScroll = useRef(false)
  const restoreRef = useRef(null)
  const lastSeenIdRef = useRef(0)

  // Datos del servidor → estado local (se mezcla por id: un refetch no borra
  // lo que ya se cargó con "anteriores" ni lo que llegó por sync).
  useEffect(() => {
    if (!data) return
    const list = Array.isArray(data.messages) ? data.messages : []
    setMsgs((prev) => mergeMessages(prev, list))
    if (initialReadRef.current === null) {
      initialReadRef.current = Number(data.myLastRead) || 0
      readSentRef.current = Math.max(readSentRef.current, initialReadRef.current)
      // El servidor dice si hay más (`hasMore`); contar 40 da un "Cargar
      // anteriores" de más cuando el chat tiene justo 40 mensajes.
      setHasMore(typeof data.hasMore === 'boolean' ? data.hasMore : list.length >= PAGE_SIZE)
    }
    setOthersRead((v) => Math.max(v, Number(data.lastReadByOthers) || 0))
    setMuted(Boolean(data.muted ?? chat?.muted))
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const lastId = msgs.length ? msgs[msgs.length - 1].id : 0
  const emptyRef = useRef(true)
  emptyRef.current = msgs.length === 0
  const unreadChatsRef = useRef(null)
  const refetchRef = useRef(q.refetch)
  refetchRef.current = q.refetch

  /* ---------- Sync (mensajes nuevos) ---------- */
  const onSync = useCallback((res) => {
    // useSync solo pide mensajes con `since` > 0: en un chat todavía vacío el
    // primer mensaje no llegaría nunca. Si sube el contador de chats sin leer
    // mientras este está vacío, se vuelve a pedir `chat` (una consulta, solo
    // en ese caso raro; no es polling).
    const uc = Number(res?.unreadChats)
    if (Number.isFinite(uc)) {
      const prevUc = unreadChatsRef.current
      unreadChatsRef.current = uc
      if (emptyRef.current && prevUc !== null && uc > prevUc) refetchRef.current?.()
    }
    const incoming = Array.isArray(res?.messages)
      ? res.messages.filter((m) => m && (m.chatId == null || Number(m.chatId) === id))
      : []
    if (incoming.length) {
      setMsgs((prev) => mergeMessages(prev, incoming))
      // Quien escribe después de mi mensaje ya lo leyó (chat-send marca al
      // que envía como leído hasta su propio mensaje).
      const othersMax = incoming.filter((m) => !m.mine).reduce((mx, m) => Math.max(mx, Number(m.id) || 0), 0)
      if (othersMax) setOthersRead((v) => Math.max(v, othersMax))
    }
    if (Number.isFinite(Number(res?.lastReadByOthers))) setOthersRead((v) => Math.max(v, Number(res.lastReadByOthers)))
  }, [id])
  useSync({ chatId: id, since: lastId, onData: onSync, active: Boolean(data) && !minimized })

  /* ---------- Marcar leído al ver ---------- */
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  useEffect(() => {
    if (!data || minimized || !visible || suppressReadRef.current) return
    if (!lastId || lastId <= readSentRef.current) return
    readSentRef.current = lastId
    academyApi('chat-read', { method: 'POST', body: { chatId: id, messageId: lastId } })
      .then(() => {
        // El badge se refresca como mucho cada 15 s: en una conversación
        // activa el siguiente sync ya trae el contador.
        const nowMs = Date.now()
        if (nowMs - unreadRefreshAt.current > 15000) {
          unreadRefreshAt.current = nowMs
          refreshUnread?.()
        }
      })
      .catch(() => { readSentRef.current = 0 })
  }, [lastId, data, minimized, visible, id, refreshUnread])

  /* ---------- Scroll ---------- */
  const scrollToBottom = (smooth) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (stickRef.current && newBelow) setNewBelow(0)
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || minimized) return
    if (restoreRef.current) {
      const { height, top } = restoreRef.current
      restoreRef.current = null
      el.scrollTop = el.scrollHeight - height + top
      return
    }
    if (!didInitialScroll.current && msgs.length) {
      didInitialScroll.current = true
      const sep = el.querySelector('[data-new-sep]')
      if (sep) el.scrollTop = Math.max(0, sep.offsetTop - 48)
      else el.scrollTop = el.scrollHeight
      stickRef.current = !sep
      lastSeenIdRef.current = lastId
      return
    }
    if (lastId > lastSeenIdRef.current) {
      const fresh = msgs.filter((m) => m.id > lastSeenIdRef.current)
      lastSeenIdRef.current = lastId
      if (stickRef.current || fresh.some((m) => m.mine)) scrollToBottom(true)
      else setNewBelow((n) => n + fresh.filter((m) => !m.mine).length)
    }
  }, [msgs, minimized]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (pending.length) scrollToBottom(true)
  }, [pending.length])

  // Al volver de minimizado, al final.
  useEffect(() => { if (!minimized) requestAnimationFrame(() => { if (stickRef.current) scrollToBottom(false) }) }, [minimized])

  const loadOlder = async () => {
    if (loadingOlder || !msgs.length) return
    setLoadingOlder(true)
    try {
      const res = await academyApi('chat', { query: { id, before: msgs[0].id } })
      const list = Array.isArray(res?.messages) ? res.messages : []
      const el = scrollRef.current
      if (el) restoreRef.current = { height: el.scrollHeight, top: el.scrollTop }
      setMsgs((prev) => mergeMessages(prev, list))
      setHasMore(typeof res?.hasMore === 'boolean' ? res.hasMore : list.length >= PAGE_SIZE)
    } catch (err) {
      toast?.(err?.message || 'No se pudieron cargar los mensajes anteriores.', 'error')
    } finally {
      setLoadingOlder(false)
    }
  }

  /* ---------- Compositor ---------- */
  const draftKey = `chat:${id}`
  const [text, setText] = useState(() => {
    const d = loadDraft(draftKey)
    return typeof d === 'string' ? d : (d && typeof d.text === 'string' ? d.text : '')
  })
  const [atts, setAtts] = useState([]) // { key, localUrl, status: 'uploading'|'done'|'error', uploadId, preview }
  const taRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => { if (text.trim()) saveDraft(draftKey, text); else clearDraft(draftKey) }, 400)
    return () => clearTimeout(t)
  }, [text, draftKey])

  // Alto automático del textarea (1 a ~6 líneas).
  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(140, ta.scrollHeight)}px`
  }, [text])

  // Las vistas previas locales se liberan al desmontar.
  const allLocalUrls = useRef(new Set())
  useEffect(() => () => {
    for (const u of allLocalUrls.current) { try { URL.revokeObjectURL(u) } catch { /* ya liberada */ } }
  }, [])

  const onPickFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const room = MAX_ATTACHMENTS - atts.length
    if (room <= 0) { toast?.(`Máximo ${MAX_ATTACHMENTS} imágenes por mensaje.`, 'error'); return }
    const chosen = files.slice(0, room)
    if (files.length > room) toast?.(`Máximo ${MAX_ATTACHMENTS} imágenes por mensaje.`, 'info')
    const items = chosen.map((file) => {
      let localUrl = null
      try { localUrl = URL.createObjectURL(file); allLocalUrls.current.add(localUrl) } catch { /* sin vista previa */ }
      tmpSeq += 1
      return { key: `att-${Date.now()}-${tmpSeq}`, localUrl, status: 'uploading', uploadId: null, file }
    })
    setAtts((prev) => [...prev, ...items])
    await Promise.all(items.map(async (item) => {
      try {
        const up = await uploadImage('chat', item.file, { private: true })
        setAtts((prev) => prev.map((a) => (a.key === item.key ? { ...a, status: 'done', uploadId: up?.id, preview: up?.preview || null } : a)))
      } catch (err) {
        setAtts((prev) => prev.map((a) => (a.key === item.key ? { ...a, status: 'error' } : a)))
        toast?.(err?.message || 'No se pudo subir la imagen.', 'error')
      }
    }))
  }

  const removeAtt = (key) => setAtts((prev) => prev.filter((a) => a.key !== key))

  const meMini = useMemo(() => (me ? { id: me.id, handle: me.handle, name: me.name, avatarUrl: me.avatarUrl, level: me.level, role: me.role } : null), [me])

  const doSend = useCallback(async (item) => {
    setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'sending', error: '' } : p)))
    try {
      const res = await academyApi('chat-send', { method: 'POST', body: item.payload })
      const msg = res?.message
      setPending((prev) => prev.filter((p) => p.id !== item.id))
      if (msg && Number.isFinite(Number(msg.id))) {
        readSentRef.current = Math.max(readSentRef.current, Number(msg.id))
        setMsgs((prev) => mergeMessages(prev, [{ ...msg, mine: true }]))
      }
      setNotice('')
      // Aviso a useSync (si lo escucha) de que hubo actividad: vuelve a 5 s.
      try { window.dispatchEvent(new CustomEvent('aca:chat-activity', { detail: { chatId: id } })) } catch { /* sin window */ }
    } catch (err) {
      const errText = sendErrorText(err)
      setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: 'error', error: errText } : p)))
      if (err?.status === 403) setNotice(errText)
    }
  }, [id])

  const uploading = atts.some((a) => a.status === 'uploading')
  const readyAtts = atts.filter((a) => a.status === 'done' && a.uploadId)
  const canSend = (text.trim().length > 0 || readyAtts.length > 0) && !uploading

  const send = () => {
    if (uploading) { toast?.('Espera a que terminen de subir las imágenes.', 'info'); return }
    const body = text.trim().slice(0, MAX_BODY)
    if (!body && !readyAtts.length) return
    tmpSeq += 1
    const item = {
      id: `tmp-${Date.now()}-${tmpSeq}`,
      chatId: id,
      author: meMini,
      body,
      attachments: readyAtts.map((a) => ({ kind: 'image', url: a.localUrl || a.preview })).filter((a) => a.url),
      createdAt: new Date().toISOString(),
      mine: true,
      status: 'sending',
      payload: { chatId: id, body, attachments: readyAtts.map((a) => ({ uploadId: a.uploadId })) },
    }
    setPending((prev) => [...prev, item])
    setText('')
    setAtts((prev) => prev.filter((a) => a.status === 'error'))
    clearDraft(draftKey)
    stickRef.current = true
    doSend(item)
    taRef.current?.focus()
  }

  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey) return
    if (e.nativeEvent?.isComposing || e.keyCode === 229) return
    // En el celular Enter es salto de línea (teclado sin Shift): se envía con el botón.
    if (isCoarse()) return
    e.preventDefault()
    send()
  }

  /* ---------- Menú ⋯ ---------- */
  const leave = () => { if (onClose) onClose(); else if (onBack) onBack() }

  const markUnread = async () => {
    suppressReadRef.current = true
    try {
      await academyApi('chat-mark-unread', { method: 'POST', body: { chatId: id } })
      toast?.('Marcado como no leído', 'ok')
      refreshUnread?.()
      leave()
    } catch (err) {
      suppressReadRef.current = false
      toast?.(err?.message || 'No se pudo marcar como no leído.', 'error')
    }
  }

  const toggleMute = async () => {
    const next = !muted
    setMuted(next)
    try {
      await academyApi('chat-mute', { method: 'POST', body: { chatId: id, muted: next } })
      toast?.(next ? 'Chat silenciado: no te llegarán avisos push' : 'Notificaciones del chat activadas', 'ok')
    } catch (err) {
      setMuted(!next)
      toast?.(err?.message || 'No se pudo cambiar el silencio.', 'error')
    }
  }

  const doBlock = async () => {
    if (!other?.id) return
    setBlocking(true)
    try {
      await academyApi('block', { method: 'POST', body: { memberId: other.id, block: true } })
      toast?.(`Bloqueaste a ${firstName(other.name)}. Puedes desbloquearlo en Ajustes → Chat.`, 'ok')
      setConfirmBlock(false)
      refreshUnread?.()
      leave()
    } catch (err) {
      toast?.(err?.message || 'No se pudo bloquear.', 'error')
    } finally {
      setBlocking(false)
    }
  }

  const sendReport = async () => {
    if (!report) return
    setReporting(true)
    try {
      await academyApi('report', { method: 'POST', body: { targetType: report.targetType, targetId: report.targetId, reason: reportReason.trim().slice(0, 1000) } })
      toast?.('Reporte enviado a los administradores', 'ok')
      setReport(null)
      setReportReason('')
    } catch (err) {
      toast?.(err?.message || 'No se pudo enviar el reporte.', 'error')
    } finally {
      setReporting(false)
    }
  }

  const menuItems = chat ? [
    { label: 'Ver perfil', icon: 'user', onClick: () => navigate(r.profile(other.handle)), hidden: isGroup || !other?.handle },
    { label: 'Ver grupo', icon: 'users', onClick: () => navigate(r.group(chat.cohort.id)), hidden: !isGroup || !chat.cohort?.id || variant === 'embed' },
    { label: 'Marcar como no leído', icon: 'eye', onClick: markUnread },
    { label: muted ? 'Reactivar notificaciones' : 'Silenciar', icon: 'bell', onClick: toggleMute, hint: muted ? 'Ahora está silenciado' : undefined },
    { label: 'Reportar', icon: 'flag', danger: true, hidden: isGroup || !other?.id, onClick: () => setReport({ targetType: 'miembro', targetId: other.id, label: other.name }) },
    { label: `Bloquear a ${firstName(other?.name)}`, icon: 'shield', danger: true, hidden: isGroup || !other?.id, onClick: () => setConfirmBlock(true) },
  ] : []

  /* ---------- Render de la lista ---------- */
  const todayKey = dayKeyIn(Date.now(), tz)
  const all = useMemo(() => [...msgs, ...pending], [msgs, pending])
  const myLastRealId = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i -= 1) if (msgs[i].mine) return msgs[i].id
    return 0
  }, [msgs])

  const rows = useMemo(() => {
    const out = []
    let prevDay = null
    let prevAuthor = null
    let prevTime = 0
    let sepShown = false
    const initialRead = initialReadRef.current
    all.forEach((m, i) => {
      const t = Date.parse(m.createdAt) || Date.now()
      const dk = dayKeyIn(t, tz)
      if (dk !== prevDay) {
        out.push({ type: 'day', key: `day-${dk}`, label: dayLabel(dk, todayKey, tz, new Date(t)) })
        prevDay = dk
        prevAuthor = null
      }
      if (!sepShown && initialRead !== null && typeof m.id === 'number' && m.id > initialRead && !m.mine && i > 0) {
        out.push({ type: 'new', key: 'new-sep' })
        sepShown = true
        prevAuthor = null
      }
      const authorId = m.author?.id ?? (m.mine ? me?.id : null)
      const grouped = prevAuthor !== null && prevAuthor === authorId && t - prevTime < GROUP_WINDOW_MS
      out.push({ type: 'msg', key: `m-${m.id}`, msg: m, grouped, time: t, authorId })
      prevAuthor = authorId
      prevTime = t
    })
    // ¿Última burbuja de su racha? (ahí va la hora).
    for (let i = 0; i < out.length; i += 1) {
      if (out[i].type !== 'msg') continue
      const next = out[i + 1]
      out[i].last = !next || next.type !== 'msg' || !next.grouped
    }
    return out
  }, [all, tz, todayKey, me?.id])

  /* ---------- Estados ---------- */
  if (!Number.isInteger(id) || id <= 0) {
    return <div className="aca-thread is-empty"><p className="aca-thread-note">Chat no encontrado.</p></div>
  }

  const notMember = q.error && (q.error.status === 404 || q.error.status === 403)
  const locked = data && data.canSend === false ? lockedText(data.cantSendReason, other) : ''

  return (
    <div className={cx('aca-thread', `is-${variant}`, fullHeight && 'is-full', minimized && 'is-min')}>
      {!headerless && (
        <ThreadHeader
          chat={chat || (q.loading ? null : { kind: 'directo', name: 'Chat' })}
          members={data?.members}
          variant={variant}
          minimized={minimized}
          onMinimize={onMinimize}
          onClose={onClose}
          onBack={onBack}
          menuItems={menuItems}
        />
      )}
      {headerless && chat && menuItems.length > 0 && !minimized && (
        <div className="aca-thread-toolbar">
          <ActionMenu items={menuItems} label="Opciones del chat" small />
        </div>
      )}

      {!minimized && (
        <>
          <div className="aca-thread-scroll" ref={scrollRef} onScroll={onScroll} aria-live="polite" aria-relevant="additions">
            {notMember ? (
              <div className="aca-thread-empty">
                <Icon name="lock" size={20} />
                <p>Este chat no existe o ya no eres parte de él.</p>
              </div>
            ) : q.error && !data ? (
              <PageState error={q.error} onRetry={q.refetch} />
            ) : !data ? (
              <PageState loading />
            ) : (
              <>
                {hasMore && (
                  <div className="aca-thread-older">
                    <Button variant="plain" size="sm" onClick={loadOlder} loading={loadingOlder}>Cargar mensajes anteriores</Button>
                  </div>
                )}
                {!all.length && (
                  <div className="aca-thread-empty">
                    {isGroup
                      ? <GroupTile cohort={chat?.cohort} name={chatTitle(chat)} size={56} />
                      : <MemberAvatar member={other || { name: chatTitle(chat) }} size={56} />}
                    <p className="aca-thread-empty-title">{chatTitle(chat)}</p>
                    <p>Envía un mensaje para empezar la conversación.</p>
                  </div>
                )}
                {rows.map((row) => {
                  if (row.type === 'day') return <div key={row.key} className="aca-thread-day" role="separator"><span>{row.label}</span></div>
                  if (row.type === 'new') return <div key={row.key} className="aca-thread-new" role="separator" data-new-sep=""><span>Nuevos mensajes</span></div>
                  const m = row.msg
                  const mine = Boolean(m.mine)
                  const isPending = typeof m.id !== 'number'
                  const images = (Array.isArray(m.attachments) ? m.attachments : []).filter((a) => a && a.kind === 'image' && a.url)
                  const showSeen = mine && !isPending && m.id === myLastRealId && othersRead >= m.id && !pending.length
                  return (
                    <div key={row.key} className={cx('aca-msg', mine && 'is-mine', row.grouped && 'is-grouped', isPending && `is-${m.status}`)}>
                      {!mine && (
                        <span className="aca-msg-avatar">
                          {!row.grouped && <MemberAvatar member={m.author || { name: '?' }} size={28} showLevel={false} />}
                        </span>
                      )}
                      <div className="aca-msg-col">
                        {!mine && !row.grouped && isGroup && <span className="aca-msg-author">{m.author?.name || 'Miembro'}</span>}
                        {m.body ? (
                          <div className="aca-msg-bubble" title={fmtTime24(row.time, tz)}>
                            <RichText text={m.body} />
                          </div>
                        ) : null}
                        {images.length > 0 && (
                          <div className={cx('aca-msg-imgs', images.length > 1 && 'is-multi')}>
                            {images.map((a, i) => (
                              <button key={`${a.url}-${i}`} type="button" className="aca-msg-imgbtn" onClick={() => setLightbox(a.url)} aria-label="Ver imagen">
                                <ChatImage src={a.url} />
                              </button>
                            ))}
                          </div>
                        )}
                        {(row.last || isPending) && (
                          <span className="aca-msg-meta">
                            {m.status === 'sending' ? 'Enviando…' : fmtTime24(row.time, tz)}
                          </span>
                        )}
                        {m.status === 'error' && (
                          <span className="aca-msg-error" role="alert">
                            {m.error || 'No se envió.'}{' '}
                            <button type="button" className="aca-link-btn" onClick={() => doSend(m)}>Reintentar</button>
                            {' · '}
                            <button type="button" className="aca-link-btn" onClick={() => setPending((prev) => prev.filter((p) => p.id !== m.id))}>Descartar</button>
                          </span>
                        )}
                        {showSeen && <span className="aca-msg-seen">Visto</span>}
                      </div>
                      {!mine && !isPending && (
                        <button
                          type="button"
                          className="aca-msg-report"
                          aria-label="Reportar mensaje"
                          title="Reportar mensaje"
                          onClick={() => setReport({ targetType: 'message', targetId: m.id, label: 'este mensaje' })}
                        >
                          <Icon name="flag" size={13} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>

          {newBelow > 0 && (
            <button type="button" className="aca-thread-newbelow" onClick={() => { setNewBelow(0); scrollToBottom(true) }}>
              {newBelow === 1 ? '1 mensaje nuevo' : `${newBelow} mensajes nuevos`} <Icon name="chevronDown" size={14} />
            </button>
          )}

          {data && !notMember && locked && (
            <div className="aca-composer is-locked" role="status">
              <Icon name="lock" size={15} />
              <span>{locked}</span>
            </div>
          )}

          {data && !notMember && !locked && (
            <form
              className="aca-composer"
              onSubmit={(e) => { e.preventDefault(); send() }}
              {...(text.trim() || atts.length ? { 'data-hold-reload': 'chat' } : {})}
            >
              {notice && <InlineAlert tone="warn" onClose={() => setNotice('')}>{notice}</InlineAlert>}
              {atts.length > 0 && (
                <div className="aca-composer-atts">
                  {atts.map((a) => (
                    <div key={a.key} className={cx('aca-composer-att', `is-${a.status}`)}>
                      {a.localUrl || a.preview ? <img src={a.localUrl || a.preview} alt="" /> : <Icon name="image" size={18} />}
                      {a.status === 'uploading' && <span className="aca-composer-att-spin" aria-label="Subiendo" />}
                      {a.status === 'error' && <span className="aca-composer-att-err" title="No se pudo subir"><Icon name="alert" size={14} /></span>}
                      <button type="button" className="aca-composer-att-x" aria-label="Quitar imagen" onClick={() => removeAtt(a.key)}>
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="aca-composer-row">
                <IconButton
                  icon="image"
                  label="Adjuntar imagen"
                  plain
                  small
                  onClick={() => fileRef.current?.click()}
                  disabled={atts.length >= MAX_ATTACHMENTS}
                />
                <textarea
                  ref={taRef}
                  className="aca-composer-input"
                  rows={1}
                  value={text}
                  maxLength={MAX_BODY}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={isGroup ? 'Escribe al grupo…' : other ? `Escríbele a ${firstName(other.name)}…` : 'Escribe un mensaje…'}
                  aria-label="Mensaje"
                  enterKeyHint="send"
                />
                <button type="submit" className="aca-composer-send" disabled={!canSend} aria-label="Enviar mensaje" title="Enviar">
                  <Icon name="send" size={17} />
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={onPickFiles} />
            </form>
          )}
        </>
      )}

      <Sheet open={Boolean(lightbox)} onClose={() => setLightbox(null)} title="Imagen" size="lg" bodyClassName="aca-lightbox-body">
        {lightbox && <ChatImage src={lightbox} className="aca-lightbox-img" />}
      </Sheet>

      <Sheet
        open={Boolean(report)}
        onClose={reporting ? undefined : () => setReport(null)}
        dismissible={!reporting}
        title="Reportar a los administradores"
        subtitle={report?.label ? `Sobre ${report.label}` : undefined}
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setReport(null)} disabled={reporting}>Cancelar</Button>
            <Button variant="danger-solid" onClick={sendReport} loading={reporting}>Enviar reporte</Button>
          </>
        )}
      >
        <div className="pn-form">
          <p className="aca-thread-note">Solo lo ven los administradores de la Academy. La otra persona no se entera.</p>
          <Field label="¿Qué pasó?" optional htmlFor="aca-report-reason">
            <textarea
              id="aca-report-reason"
              className="input"
              rows={4}
              maxLength={1000}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Spam, acoso, contenido inapropiado…"
            />
          </Field>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmBlock}
        tone="danger"
        title={`¿Bloquear a ${other?.name || 'este miembro'}?`}
        message="No podrán escribirse por chat y dejarás de recibir sus notificaciones. No le avisaremos."
        confirmLabel="Bloquear"
        busy={blocking}
        onConfirm={doBlock}
        onCancel={() => setConfirmBlock(false)}
      />
    </div>
  )
}

/**
 * ChatThread({ chatId, fullHeight }) — hilo completo con encabezado y compositor.
 * Extras opcionales: variant 'window'|'page'|'embed', minimized, onMinimize,
 * onClose, onBack, headerless (el contenedor dibuja su propio encabezado).
 * Se re-monta al cambiar de chat (key) para no mezclar estados.
 */
export default function ChatThread(props) {
  return <ChatThreadInner key={String(props.chatId)} {...props} />
}
