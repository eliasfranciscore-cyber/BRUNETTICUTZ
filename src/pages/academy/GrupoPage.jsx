import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Button, Chip, ConfirmDialog, EmptyState, Sheet, SearchField, Note } from '../../components/panel/index.js'
import PageState from '../../components/academy/PageState.jsx'
import MemberAvatar from '../../components/academy/MemberAvatar.jsx'
import ChatThread, { GroupTile } from '../../components/academy/ChatThread.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { useAcademyQuery, invalidateQuery } from '../../academy/useQuery.js'
import { isImageUrl } from '../../academy/url.js'
import { fmtDate } from '../../academy/time.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/chat.css'

/* ============================================================
   /academy/grupos/:id — la sala de un Grupo (generación / cohort).
   SPEC §5.4, §7.4. Encabezado (portada, nombre, N miembros, curso), tira de
   miembros y el chat del grupo a todo el alto (ChatThread 'embed').

   `cohort` responde 403 si no eres del grupo y no eres staff. Un moderador
   que no es del grupo ve la sala pero su chat da 404 (`inChat:false`): se le
   explica en vez de mostrar un error. "Gestionar miembros" es solo para
   propietario/admin, que es lo que exige `admin-cohort-members`.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')
const STRIP_MAX = 14
const SEARCH_MIN = 2

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
// starts_on es una fecha sin hora ("2026-03-02"): se formatea en UTC para que
// la zona del miembro no la corra al día anterior.
const startsText = (key) => (key ? fmtDate(`${key}T12:00:00Z`, { tz: 'UTC', year: 'auto' }) : '')

function GroupCover({ cohort }) {
  const cover = cohort?.coverUrl && isImageUrl(cohort.coverUrl) ? cohort.coverUrl : null
  if (cover) {
    return (
      <div className="aca-grupo-cover has-img">
        <img src={cover} alt="" loading="lazy" decoding="async" />
      </div>
    )
  }
  return (
    <div className="aca-grupo-cover">
      <GroupTile cohort={cohort} size={64} />
    </div>
  )
}

/* ---------- Hoja de miembros (lista para todos; gestión para admins) ---------- */
function MembersSheet({ open, onClose, cohort, members, manage, onChanged }) {
  const { me, toast } = useAcademy()
  const [q, setQ] = useState('')
  const [found, setFound] = useState({ status: 'idle', list: [], error: null })
  const [busy, setBusy] = useState(null) // memberId en curso
  const [confirmRemove, setConfirmRemove] = useState(null)
  const memberIds = new Set((members || []).map((m) => Number(m.id)))

  useEffect(() => { if (!open) { setQ(''); setFound({ status: 'idle', list: [], error: null }) } }, [open])

  // Búsqueda con espera entre teclas: cada letra no es una consulta a Neon.
  useEffect(() => {
    const term = q.trim()
    if (!open || !manage || term.length < SEARCH_MIN) {
      setFound({ status: 'idle', list: [], error: null })
      return undefined
    }
    let alive = true
    setFound((s) => ({ ...s, status: 'loading' }))
    const t = setTimeout(async () => {
      try {
        const d = await academyApi('members', { query: { q: term, tab: 'miembros' } })
        if (alive) setFound({ status: 'ready', list: Array.isArray(d?.members) ? d.members.slice(0, 20) : [], error: null })
      } catch (e) {
        if (alive) setFound({ status: 'error', list: [], error: e })
      }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q, open, manage])

  const change = async (member, action) => {
    setBusy(member.id)
    try {
      const body = { cohortId: cohort.id, [action]: [member.id] }
      await academyApi('admin-cohort-members', { method: 'POST', body })
      toast?.(action === 'add' ? `${member.name} ahora es parte del grupo` : `${member.name} ya no está en el grupo`)
      setConfirmRemove(null)
      await onChanged?.()
    } catch (e) {
      toast?.(e?.message || 'No se pudo actualizar el grupo', 'error')
    } finally {
      setBusy(null)
    }
  }

  const row = (m, trailing) => (
    <li key={m.id} className="aca-grupo-mrow">
      <Link to={r.profile(m.handle)} className="aca-grupo-mrow-who" onClick={onClose}>
        <MemberAvatar member={m} size={36} />
        <span className="aca-grupo-mrow-names">
          <span className="aca-grupo-mrow-name">{m.name}{Number(m.id) === Number(me?.id) ? ' (tú)' : ''}</span>
          {m.handle && <span className="aca-grupo-mrow-handle">@{m.handle}</span>}
        </span>
      </Link>
      {trailing}
    </li>
  )

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={manage ? 'Gestionar miembros' : 'Miembros del grupo'}
        subtitle={cohort ? `${cohort.name} · ${plural(members?.length || 0, 'miembro', 'miembros')}` : undefined}
        size="md"
        className="aca-grupo-sheet"
      >
        {manage && (
          <div className="aca-grupo-sheet-add">
            {cohort?.archived && <Note icon="alert">El grupo está archivado: no se pueden agregar miembros.</Note>}
            <SearchField value={q} onChange={setQ} placeholder="Buscar miembros para agregar" />
            {found.status === 'loading' && <PageState loading skeleton="rows" rows={2} compact />}
            {found.status === 'error' && <p className="aca-chat-error" role="alert">{found.error?.message || 'No se pudo buscar.'}</p>}
            {found.status === 'ready' && !found.list.length && <p className="aca-chat-empty">No encontramos miembros con “{q.trim()}”</p>}
            {found.status === 'ready' && found.list.length > 0 && (
              <ul className="aca-grupo-mlist">
                {found.list.map((m) => row(m, memberIds.has(Number(m.id))
                  ? <Chip tone="ok">En el grupo</Chip>
                  : (
                    <Button size="sm" icon="userPlus" onClick={() => change(m, 'add')} loading={busy === m.id} disabled={Boolean(busy) || cohort?.archived}>
                      Agregar
                    </Button>
                  )))}
              </ul>
            )}
            <h3 className="aca-grupo-sheet-sub">En el grupo</h3>
          </div>
        )}
        {!members?.length ? (
          <p className="aca-chat-empty">Este grupo todavía no tiene miembros.</p>
        ) : (
          <ul className="aca-grupo-mlist">
            {members.map((m) => row(m, manage ? (
              <Button size="sm" variant="plain" onClick={() => setConfirmRemove(m)} disabled={Boolean(busy)}>Quitar</Button>
            ) : null))}
          </ul>
        )}
      </Sheet>
      <ConfirmDialog
        open={Boolean(confirmRemove)}
        tone="danger"
        title={`¿Quitar a ${confirmRemove?.name || 'este miembro'} del grupo?`}
        message="Deja de ver el chat del grupo y sus publicaciones privadas. No pierde sus cursos."
        confirmLabel="Quitar"
        busy={Boolean(busy)}
        onConfirm={() => confirmRemove && change(confirmRemove, 'remove')}
        onCancel={() => setConfirmRemove(null)}
      />
    </>
  )
}

export default function GrupoPage() {
  const { id } = useParams()
  const cohortId = Number(id)
  const valid = Number.isInteger(cohortId) && cohortId > 0
  const { isAdmin, closeChat } = useAcademy()
  const navigate = useNavigate()
  const [sheet, setSheet] = useState(null) // 'ver' | 'gestionar'

  const { data, error, loading, refetch } = useAcademyQuery(
    `grupo:${cohortId}`,
    () => academyApi('cohort', { query: { id: cohortId } }),
    { deps: [cohortId], enabled: valid },
  )

  const cohort = data?.cohort || null
  const members = Array.isArray(data?.members) ? data.members : []
  const chatId = Number(data?.chatId || cohort?.chatId) || null
  // `inChat` lo manda el backend real; si no viene (mock viejo) se intenta el
  // chat igual: ChatThread ya explica el 404 si no eres parte.
  const inChat = Boolean(cohort) && cohort.inChat !== false
  const archived = Boolean(cohort?.archived || cohort?.archivedAt)

  // El chat del grupo ya se ve acá: si estaba acoplado abajo, se cierra.
  useEffect(() => {
    if (chatId && inChat) closeChat?.(chatId)
  }, [chatId, inChat]) // eslint-disable-line react-hooks/exhaustive-deps

  const onChanged = async () => {
    await refetch()
    // La lista de grupos del riel y del selector cambió de conteo.
    invalidateQuery('cohorts')
  }

  if (!valid || (error && error.status === 404 && !data)) {
    return (
      <div className="aca-grupo is-missing">
        <EmptyState icon="users" title="No encontramos este grupo" text="Puede que el enlace esté mal o que el grupo ya no exista." />
        <Link className="aca-chat-linkbtn" to={r.path('/comunidad')}>Volver a la Comunidad</Link>
      </div>
    )
  }
  if (error && error.status === 403 && !data) {
    return (
      <div className="aca-grupo is-missing">
        <EmptyState icon="lock" title="Este grupo es privado" text="Solo sus miembros pueden entrar. Si crees que deberías estar, escríbele a un administrador." />
        <Link className="aca-chat-linkbtn" to={r.path('/comunidad')}>Volver a la Comunidad</Link>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="aca-grupo">
        <PageState loading={loading || !error} error={error} onRetry={refetch} />
      </div>
    )
  }

  const shown = members.slice(0, STRIP_MAX)
  const extra = members.length - shown.length
  const count = Number(cohort?.memberCount) || members.length

  return (
    <div className="aca-grupo">
      <header className="aca-grupo-head">
        <GroupCover cohort={cohort} />
        <div className="aca-grupo-info">
          <div className="aca-grupo-titlerow">
            <h1 className="aca-grupo-name">{cohort?.name || 'Grupo'}</h1>
            {archived && <Chip tone="warn">Archivado</Chip>}
          </div>
          <p className="aca-grupo-meta">
            <span><Icon name="users" size={15} /> {plural(count, 'miembro', 'miembros')}</span>
            {cohort?.course?.slug && (
              <Link to={r.course(cohort.course.slug)} className="aca-grupo-course">
                <Icon name="book" size={15} /> {cohort.course.title}
              </Link>
            )}
            {cohort?.startsOn && <span><Icon name="calendar" size={15} /> Inicio {startsText(cohort.startsOn)}</span>}
          </p>
          {cohort?.description && <p className="aca-grupo-desc">{cohort.description}</p>}
        </div>
        {isAdmin && (
          <div className="aca-grupo-headactions">
            <Button icon="userPlus" onClick={() => setSheet('gestionar')}>Gestionar miembros</Button>
          </div>
        )}
      </header>

      {members.length > 0 && (
        <div className="aca-grupo-strip" aria-label="Miembros del grupo">
          <ul className="aca-grupo-strip-list">
            {shown.map((m) => (
              <li key={m.id}><MemberAvatar member={m} size={36} link title={m.name} /></li>
            ))}
          </ul>
          <button type="button" className="aca-chat-linkbtn" onClick={() => setSheet('ver')}>
            {extra > 0 ? `+${extra} · Ver todos` : 'Ver todos'}
          </button>
        </div>
      )}

      <section className={cx('aca-grupo-chat', !inChat && 'is-locked')} aria-label="Chat del grupo">
        {chatId && inChat ? (
          // onBack: "Marcar como no leído" sale de la sala (si se quedara
          // acá, el hilo lo volvería a marcar leído al verlo).
          <ChatThread chatId={chatId} variant="embed" headerless fullHeight onBack={() => navigate(r.path('/comunidad'))} />
        ) : (
          <div className="aca-grupo-chat-note">
            <EmptyState
              icon="message"
              title="No estás en el chat de este grupo"
              text={isAdmin
                ? 'Puedes ver la sala porque eres administrador. Agrégate en “Gestionar miembros” para escribir en el chat.'
                : 'Puedes ver la sala por tu rol, pero el chat es solo para los miembros del grupo.'}
            />
          </div>
        )}
      </section>

      <MembersSheet
        open={Boolean(sheet)}
        onClose={() => setSheet(null)}
        cohort={cohort ? { ...cohort, archived } : cohort}
        members={members}
        manage={sheet === 'gestionar' && isAdmin}
        onChanged={onChanged}
      />
    </div>
  )
}
