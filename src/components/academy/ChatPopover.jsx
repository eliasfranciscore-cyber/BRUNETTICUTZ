import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Sheet, ConfirmDialog, useIsPhone } from '../panel/index.js'
import { useOutsideClose, useTopLayerEscape } from '../panel/hooks.js'
import MemberAvatar from './MemberAvatar.jsx'
import PageState from './PageState.jsx'
import { GroupTile } from './ChatThread.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { timeAgo, fmtDateTime } from '../../academy/time.js'
import '../../styles/academy/chat.css'

/* ============================================================
   Popover de Chats (captura 5 de Skool). SPEC §7.4.
   Escritorio: panel de ~420 px anclado bajo el ícono de chat (fijo arriba a
   la derecha, justo bajo la barra de 64 px; va por portal a <body> para no
   depender de dónde lo monte el shell ni de un backdrop-filter del topbar).
   Celular: hoja a pantalla completa.

   · Lee `chats` cada vez que se abre (y al cambiar el filtro). Nada de
     sondeos: el globito del ícono lo mantiene el shell con useSync.
   · "Buscar usuarios" consulta `members?q=` (con espera de 300 ms entre
     teclas) → `chat-start` → openChat(chatId) del contexto, que decide si
     abre la ventana acoplada (escritorio) o /academy/chat/:id (celular).
   · "Marcar todo como leído" pide confirmación → `chats-read-all`.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')
const SEARCH_MIN = 2
const SEARCH_DELAY_MS = 300

function errText(err, fallback) {
  return (err && err.message) || fallback
}

// Vista previa del último mensaje: texto plano (React lo escapa), nunca HTML.
function snippetOf(chat, meId) {
  const lm = chat.lastMessage
  if (!lm) return chat.kind === 'grupo' ? 'Aún no hay mensajes en el grupo' : ''
  const mine = meId && Number(lm.authorId) === Number(meId)
  const body = String(lm.body || '').replace(/\s+/g, ' ').trim()
  const text = body || (Number(lm.attachments) > 0 ? '📷 Imagen' : 'Mensaje eliminado')
  return mine ? `Tú: ${text}` : text
}

function ChatRow({ chat, meId, tz, onOpen }) {
  const unread = (Number(chat.unread) || 0) > 0 || Boolean(chat.markedUnread)
  const isGroup = chat.kind === 'grupo'
  const name = isGroup ? (chat.cohort?.name || chat.name || 'Grupo') : (chat.other?.name || chat.name || 'Miembro')
  const at = chat.lastMessage?.createdAt
  return (
    <button type="button" className={cx('aca-chat-row', unread && 'is-unread')} onClick={() => onOpen(chat)}>
      <span className="aca-chat-row-av">
        {isGroup
          ? <GroupTile cohort={chat.cohort} name={name} size={44} />
          : <MemberAvatar member={chat.other || { name }} size={44} />}
      </span>
      <span className="aca-chat-row-main">
        <span className="aca-chat-row-top">
          <span className="aca-chat-row-name">{name}</span>
          {isGroup && <span className="aca-chat-row-tag">Grupo</span>}
          {chat.muted && (
            <span className="aca-chat-row-muted" title="Silenciado" aria-label="Silenciado">
              <Icon name="bellOff" size={13} />
            </span>
          )}
          {at && <span className="aca-chat-row-time" title={fmtDateTime(at, { tz })}>{timeAgo(at, { tz })}</span>}
        </span>
        <span className="aca-chat-row-snippet">{snippetOf(chat, meId)}</span>
      </span>
      {unread && (
        <span className="aca-chat-row-dot" role="img" aria-label={chat.unread > 0 ? `${chat.unread} sin leer` : 'Marcado como no leído'} />
      )}
    </button>
  )
}

function PersonRow({ member, busy, onPick }) {
  return (
    <button type="button" className="aca-chat-row is-person" onClick={() => onPick(member)} disabled={busy}>
      <span className="aca-chat-row-av"><MemberAvatar member={member} size={40} /></span>
      <span className="aca-chat-row-main">
        <span className="aca-chat-row-top"><span className="aca-chat-row-name">{member.name}</span></span>
        {member.handle && <span className="aca-chat-row-snippet">@{member.handle}</span>}
      </span>
      <span className="aca-chat-row-go" aria-hidden="true">
        {busy ? <span className="aca-chat-spin" /> : <Icon name="message" size={16} />}
      </span>
    </button>
  )
}

/* Filtro "Todos ⌄" (Todos / No leídos). Un menú chico propio en vez de
   ActionMenu: acá el disparador es texto, no un ícono, y dentro de la hoja
   del celular no conviene abrir otra hoja encima. */
function FilterMenu({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useOutsideClose(wrap, open, close)
  useTopLayerEscape(open, close)
  const opts = [['todos', 'Todos'], ['no-leidos', 'No leídos']]
  const label = value === 'no-leidos' ? 'No leídos' : 'Todos'
  return (
    <div className="pn-menu-wrap aca-chat-filter" ref={wrap}>
      <button
        type="button"
        className="aca-chat-filter-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Mostrar: ${label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{label}</span>
        <Icon name="chevronDown" size={15} />
      </button>
      {open && (
        <div className="pn-menu aca-chat-filter-menu" role="menu">
          {opts.map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="menuitemradio"
              aria-checked={value === v}
              className={cx('pn-menu-item', value === v && 'is-checked')}
              onClick={() => { setOpen(false); if (v !== value) onChange(v) }}
            >
              <span>{l}</span>
              {value === v && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ChatPopover({ open, onClose }) {
  const isPhone = useIsPhone()
  const { me, tz, openChat, refreshUnread, toast } = useAcademy()
  const [filter, setFilter] = useState('todos')
  const [state, setState] = useState({ status: 'idle', chats: [], error: null, filter: 'todos' })
  const [confirmAll, setConfirmAll] = useState(false)
  const [marking, setMarking] = useState(false)

  const [q, setQ] = useState('')
  const [search, setSearch] = useState({ status: 'idle', q: '', members: [], error: null })
  const [starting, setStarting] = useState(null) // memberId en curso
  const [startError, setStartError] = useState('')
  const [searchNonce, setSearchNonce] = useState(0) // "Reintentar" de la búsqueda

  const panelRef = useRef(null)
  const reqId = useRef(0)
  const searchId = useRef(0)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  /* ---------- Lista ---------- */
  const load = useCallback(async (f) => {
    const my = ++reqId.current
    setState((s) => ({ ...s, status: 'loading', error: null, ...(s.filter !== f ? { chats: [] } : {}), filter: f }))
    try {
      const d = await academyApi('chats', { query: { filter: f } })
      if (my !== reqId.current) return
      setState({ status: 'ready', chats: Array.isArray(d?.chats) ? d.chats : [], error: null, filter: f })
    } catch (e) {
      if (my !== reqId.current) return
      setState((s) => ({ ...s, status: 'error', error: e }))
    }
  }, [])

  useEffect(() => { if (open) load(filter) }, [open, filter, load])

  // Al cerrar se limpia la búsqueda: la próxima apertura muestra los chats.
  useEffect(() => {
    if (open) return
    setQ('')
    setStartError('')
    setSearch({ status: 'idle', q: '', members: [], error: null })
  }, [open])

  /* ---------- Búsqueda de miembros ---------- */
  useEffect(() => {
    const term = q.trim()
    if (!open || term.length < SEARCH_MIN) {
      searchId.current += 1
      setSearch({ status: 'idle', q: term, members: [], error: null })
      return undefined
    }
    const my = ++searchId.current
    setSearch((s) => ({ ...s, status: 'loading', q: term, error: null }))
    const t = setTimeout(async () => {
      try {
        const d = await academyApi('members', { query: { q: term, tab: 'miembros' } })
        if (my !== searchId.current) return
        const list = (Array.isArray(d?.members) ? d.members : []).filter((m) => m && Number(m.id) !== Number(me?.id))
        setSearch({ status: 'ready', q: term, members: list.slice(0, 20), error: null })
      } catch (e) {
        if (my !== searchId.current) return
        setSearch({ status: 'error', q: term, members: [], error: e })
      }
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(t)
  }, [q, open, me?.id, searchNonce])

  const pickMember = async (member) => {
    if (starting) return
    setStarting(member.id)
    setStartError('')
    try {
      const d = await academyApi('chat-start', { method: 'POST', body: { memberId: member.id } })
      const chatId = Number(d?.chatId)
      if (!chatId) throw new Error('No se pudo abrir el chat.')
      closeRef.current?.()
      await openChat?.(chatId)
    } catch (e) {
      // 403 chat_off / bloqueado / nivel: el servidor manda el motivo en español.
      setStartError(errText(e, 'No se pudo abrir el chat.'))
    } finally {
      setStarting(null)
    }
  }

  const openRow = (chat) => {
    closeRef.current?.()
    // El badge baja cuando ChatThread marca leído al verlo.
    openChat?.(chat.id)
  }

  /* ---------- Marcar todo ---------- */
  const markAll = async () => {
    setMarking(true)
    try {
      await academyApi('chats-read-all', { method: 'POST' })
      setState((s) => ({
        ...s,
        chats: s.filter === 'no-leidos' ? [] : s.chats.map((c) => ({ ...c, unread: 0, markedUnread: false })),
      }))
      setConfirmAll(false)
      refreshUnread?.()
    } catch (e) {
      toast?.(errText(e, 'No se pudieron marcar como leídos'), 'error')
    } finally {
      setMarking(false)
    }
  }

  /* ---------- Cerrar (escritorio) ---------- */
  // Con `click` (no `mousedown`): el toque en el ícono de chat lo resuelve el
  // shell y no se abre-cierra-abre. Lo que pasa dentro de una hoja o una
  // confirmación (portales) no cuenta como "afuera".
  useEffect(() => {
    if (!open || isPhone) return undefined
    let armed = false
    const t = setTimeout(() => { armed = true }, 0)
    const onDoc = (e) => {
      if (!armed) return
      const el = panelRef.current
      const target = e.target
      if (!el || (target instanceof Node && el.contains(target))) return
      if (target instanceof Element && target.closest('.pn-sheet-root')) return
      closeRef.current?.()
    }
    document.addEventListener('click', onDoc)
    return () => { clearTimeout(t); document.removeEventListener('click', onDoc) }
  }, [open, isPhone])
  useTopLayerEscape(open && !isPhone, () => closeRef.current?.())

  const hasUnread = state.chats.some((c) => (Number(c.unread) || 0) > 0 || c.markedUnread)
  const searching = q.trim().length >= SEARCH_MIN

  const actions = (
    <div className="aca-chat-pop-actions">
      <button type="button" className="aca-chat-linkbtn" onClick={() => setConfirmAll(true)} disabled={!hasUnread}>
        Marcar todo como leído
      </button>
      <FilterMenu value={filter} onChange={setFilter} />
    </div>
  )

  const searchBox = (
    <div className="aca-chat-search">
      <label className="aca-chat-search-field">
        <Icon name="search" size={17} />
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setStartError('') }}
          placeholder="Buscar usuarios"
          aria-label="Buscar usuarios"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={80}
          autoFocus={!isPhone}
        />
        {q && (
          <button type="button" className="aca-chat-search-clear" aria-label="Borrar búsqueda" onClick={() => setQ('')}>
            <Icon name="close" size={12} />
          </button>
        )}
      </label>
    </div>
  )

  const results = (
    <div className="aca-chat-pop-body">
      {startError && <p className="aca-chat-error" role="alert">{startError}</p>}
      {search.status === 'error' ? (
        <PageState error={search.error} onRetry={() => setSearchNonce((n) => n + 1)} compact className="aca-chat-state" />
      ) : search.status !== 'ready' ? (
        <PageState loading skeleton="rows" rows={4} compact className="aca-chat-state" />
      ) : !search.members.length ? (
        <p className="aca-chat-empty">No encontramos miembros con “{search.q}”</p>
      ) : (
        <ul className="aca-chat-list">
          {search.members.map((m) => (
            <li key={m.id}><PersonRow member={m} busy={starting === m.id} onPick={pickMember} /></li>
          ))}
        </ul>
      )}
    </div>
  )

  const chats = state.chats
  const list = (
    <div className="aca-chat-pop-body">
      {state.status === 'error' && !chats.length ? (
        <PageState error={state.error} onRetry={() => load(filter)} compact className="aca-chat-state" />
      ) : state.status !== 'ready' && !chats.length ? (
        <PageState loading skeleton="rows" rows={4} compact className="aca-chat-state" />
      ) : !chats.length ? (
        <p className="aca-chat-empty">{filter === 'no-leidos' ? 'No tienes chats sin leer' : 'Aún no hay chats'}</p>
      ) : (
        <ul className="aca-chat-list">
          {chats.map((c) => (
            <li key={c.id}><ChatRow chat={c} meId={me?.id} tz={tz} onOpen={openRow} /></li>
          ))}
        </ul>
      )}
    </div>
  )

  const confirm = (
    <ConfirmDialog
      open={confirmAll}
      title="¿Marcar todo como leído?"
      message="Tus chats se quedan en la lista, pero sin el punto de no leído."
      confirmLabel="Marcar como leídos"
      busy={marking}
      onConfirm={markAll}
      onCancel={() => setConfirmAll(false)}
    />
  )

  if (isPhone) {
    return (
      <>
        <Sheet
          open={open}
          onClose={onClose}
          title="Chats"
          full
          size="md"
          className="aca-chat-sheet"
          bodyClassName="is-flush aca-chat-sheet-body"
        >
          {actions}
          {searchBox}
          {searching ? results : list}
        </Sheet>
        {confirm}
      </>
    )
  }

  if (!open || typeof document === 'undefined') return confirm
  return (
    <>
      {createPortal(
        <div ref={panelRef} className="aca-chat-pop" role="dialog" aria-label="Chats">
          <div className="aca-chat-pop-head">
            <h2>Chats</h2>
            {actions}
          </div>
          {searchBox}
          {searching ? results : list}
        </div>,
        document.body,
      )}
      {confirm}
    </>
  )
}
