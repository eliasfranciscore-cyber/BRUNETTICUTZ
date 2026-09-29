import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../../academy/Icon.jsx'
import { Sheet, Button, Field, Segmented, InlineAlert } from '../../../components/panel/index.js'
import PageState from '../../../components/academy/PageState.jsx'
import MemberCard, { cx, errorText, todayStamp, downloadBlob, ROLE_LABEL, STATUS_LABEL, SOURCE_LABEL, fmtDay, fmtDayTime } from '../../../components/academy/MemberCard.jsx'
import GroupCard from '../../../components/academy/GroupCard.jsx'
import MemberAdminSheet from '../../../components/academy/MemberAdminSheet.jsx'
import InviteSheet from '../../../components/academy/InviteSheet.jsx'
import { useAcademy } from '../../../academy/context.js'
import { academyApi } from '../../../academy/api.js'
import { useAcademyQuery } from '../../../academy/useQuery.js'
import { csvCell } from '../../../academy/csv.js'
import '../../../styles/academy/miembros.css'

/* ============================================================
   Pestaña Miembros (captura 3 de Skool).
   - Miembros ven: Miembros · Admins · En línea.
   - Admins/propietario ven: Activos · Cancelando · Cancelado · Expulsado
     (esas cuatro listas son solo-admin en el servidor; un moderador ve
     las de miembro).
   - 30 por página, filtro (nivel, grupo, orden), Exportar (CSV armado en
     el navegador con admin-members?all=1) e INVITAR.
   ============================================================ */

const PAGE_SIZE = 30

const MEMBER_TABS = [
  { value: 'miembros', label: 'Miembros', count: 'miembros' },
  { value: 'admins', label: 'Admins', count: 'admins' },
  { value: 'en-linea', label: 'En línea', count: 'enLinea' },
]
const ADMIN_TABS = [
  { value: 'activos', label: 'Activos', count: 'activos', status: 'activo' },
  { value: 'cancelando', label: 'Cancelando', count: 'cancelando', status: null },
  { value: 'cancelado', label: 'Cancelado', count: 'cancelado', status: 'cancelado' },
  { value: 'expulsado', label: 'Expulsado', count: 'expulsado', status: 'expulsado' },
]
const SORTS = [
  { value: 'nuevos', label: 'Más nuevos' },
  { value: 'actividad', label: 'Última actividad' },
  { value: 'puntos', label: 'Más puntos' },
]
const EMPTY_TEXT = {
  miembros: 'Todavía no hay miembros.',
  admins: 'No hay administradores.',
  'en-linea': 'No hay nadie en línea en este momento.',
  activos: 'No hay miembros activos con estos filtros.',
  cancelando: 'Nadie está cancelando: el acceso de la Academy es de pago único.',
  cancelado: 'No hay membresías canceladas.',
  expulsado: 'No hay miembros expulsados.',
}
const NO_FILTERS = { level: '', cohortId: '', sort: 'nuevos' }

function clean(obj) {
  const out = {}
  Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v != null) out[k] = v })
  return out
}

function buildCsv(rows) {
  const header = ['Nombre', 'Correo', 'Teléfono', 'Usuario', 'Rol', 'Estado', 'Origen', 'Nivel', 'Puntos', 'Se unió', 'Último ingreso', 'Cursos', 'Grupos']
  const lines = [header, ...rows.map((m) => [
    m.name,
    m.email,
    m.phone ? `+56${m.phone}` : '',
    m.handle ? `@${m.handle}` : '',
    ROLE_LABEL[m.role] || m.role,
    STATUS_LABEL[m.status] || m.status,
    SOURCE_LABEL[m.source] || m.source,
    m.level,
    m.points,
    m.joinedAt ? fmtDay(m.joinedAt) : '',
    m.lastLoginAt ? fmtDayTime(m.lastLoginAt) : '',
    (m.grants || []).filter((g) => g.state === 'activa').map((g) => g.courseTitle).join(' | '),
    (m.cohorts || []).map((c) => c.name).join(' | '),
  ])]
  // csvCell neutraliza fórmulas (=, +, -, @) y escapa comillas: el CSV lo
  // abre Excel y un nombre como "=HYPERLINK(…)" no debe ejecutarse.
  return '﻿' + lines.map((cells) => cells.map((v) => csvCell(v == null ? '' : v)).join(',')).join('\r\n')
}

export default function MiembrosTab() {
  const { isAdmin, isOwner, levelName, toast } = useAcademy()
  const admin = Boolean(isAdmin || isOwner)
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') || '').trim().slice(0, 80)
  const tabs = admin ? ADMIN_TABS : MEMBER_TABS
  const [tab, setTab] = useState(admin ? 'activos' : 'miembros')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [page, setPage] = useState(1)
  const [filterOpen, setFilterOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [selected, setSelected] = useState(null)
  const topRef = useRef(null)

  // Si el rol cambia después del primer render (me recargado), la pestaña
  // tiene que existir en el juego de pestañas actual.
  useEffect(() => {
    if (!tabs.some((t) => t.value === tab)) setTab(tabs[0].value)
  }, [admin]) // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => clean({
    tab,
    q,
    level: filters.level ? Number(filters.level) : '',
    cohortId: admin && filters.cohortId ? Number(filters.cohortId) : '',
    sort: filters.sort || 'nuevos',
    page,
  }), [tab, q, filters, page, admin])
  const key = `mi:members:${JSON.stringify(query)}`
  const { data, error, loading, refetch } = useAcademyQuery(key, () => academyApi('members', { query }), { deps: [key] })

  const cohorts = useAcademyQuery('mi:cohorts', () => academyApi('cohorts'), { enabled: admin, refetchOnFocus: false })

  const counts = data?.counts || {}
  const members = Array.isArray(data?.members) ? data.members : []
  const total = Number(data?.total) || 0
  const pages = Math.max(1, Number(data?.pages) || Math.ceil(total / PAGE_SIZE) || 1)
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0
  const to = Math.min(total, (page - 1) * PAGE_SIZE + members.length)
  const activeFilters = (filters.level ? 1 : 0) + (filters.cohortId ? 1 : 0) + (filters.sort !== 'nuevos' ? 1 : 0) + (q ? 1 : 0)

  // La hoja de admin sigue al miembro por id: tras un cambio se recarga la
  // lista y se toma la versión nueva; si ya no está en esta lista (p. ej.
  // lo expulsaste desde "Activos") se queda con la última conocida.
  const selectedMember = selected ? (members.find((x) => Number(x.id) === Number(selected.id)) || selected) : null

  const changeTab = (value) => { setTab(value); setPage(1) }
  const goPage = (n) => {
    setPage(n)
    topRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }
  const clearSearch = () => {
    const next = new URLSearchParams(params)
    next.delete('q')
    setParams(next, { replace: true })
    setPage(1)
  }

  const exportCsv = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const current = ADMIN_TABS.find((t) => t.value === tab)
      const res = await academyApi('admin-members', {
        query: clean({
          all: 1,
          status: current?.status || '',
          q,
          cohortId: filters.cohortId ? Number(filters.cohortId) : '',
        }),
      })
      let rows = Array.isArray(res?.members) ? res.members : []
      if (filters.level) rows = rows.filter((m) => Number(m.level) === Number(filters.level))
      if (!rows.length) {
        toast?.('No hay miembros para exportar con estos filtros')
        return
      }
      downloadBlob(`miembros-academy-${todayStamp()}.csv`, buildCsv(rows), 'text/csv;charset=utf-8')
      toast?.(`Exportaste ${rows.length} ${rows.length === 1 ? 'miembro' : 'miembros'}`)
    } catch (e) {
      toast?.(errorText(e, 'No se pudo exportar'), 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="aca-members-layout">
      <div className="aca-members-main" ref={topRef}>
        <div className="aca-members-toolbar">
          <div className="aca-mi-pills" role="tablist" aria-label="Listas de miembros">
            {tabs.map((t) => {
              const on = t.value === tab
              const n = counts[t.count]
              return (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={cx('aca-mi-pill', on && 'is-on')}
                  onClick={() => !on && changeTab(t.value)}
                >
                  {t.label}{n != null ? <span className="aca-mi-pill-count">{Number(n) || 0}</span> : null}
                </button>
              )
            })}
          </div>
          <div className="aca-members-tools">
            <button type="button" className={cx('aca-mi-tool', activeFilters && 'is-on')} onClick={() => setFilterOpen(true)}>
              Filtro <Icon name="filter" size={16} />
              {activeFilters ? <span className="aca-mi-tool-count">{activeFilters}</span> : null}
            </button>
            {admin && (
              <button type="button" className="aca-mi-tool" onClick={exportCsv} disabled={exporting}>
                {exporting ? 'Exportando…' : 'Exportar'} <Icon name="download" size={16} />
              </button>
            )}
            {admin && (
              <button type="button" className="aca-mi-invite-btn" onClick={() => setInviteOpen(true)}>Invitar</button>
            )}
          </div>
        </div>

        {q && (
          <div className="aca-members-search">
            <span>Resultados para “{q}”</span>
            <button type="button" onClick={clearSearch}>Quitar búsqueda</button>
          </div>
        )}

        <PageState
          loading={loading && !data}
          error={!data ? error : null}
          onRetry={refetch}
          empty={Boolean(data) && members.length === 0}
          emptyText={q || filters.level || filters.cohortId ? 'Nadie coincide con estos filtros.' : EMPTY_TEXT[tab]}
        >
          {error && data && (
            <InlineAlert tone="error" action={{ label: 'Reintentar', onClick: refetch }}>No se pudo actualizar la lista. {errorText(error, '')}</InlineAlert>
          )}
          <div className={cx('aca-members-list', loading && data && 'is-busy')}>
            {members.map((m) => (
              <MemberCard key={m.id} member={m} adminView={admin} onManage={admin ? setSelected : undefined} />
            ))}
          </div>
          {total > 0 && (
            <div className="aca-members-pager">
              <span>
                {pages > 1 ? `Mostrando ${from}–${to} de ${total}` : `Mostrando ${members.length} de ${total}`}
              </span>
              {pages > 1 && (
                <span className="aca-members-pager-btns">
                  <Button size="sm" icon="chevronLeft" disabled={page <= 1 || loading} onClick={() => goPage(page - 1)}>Anterior</Button>
                  <span className="aca-mi-muted">{page} / {pages}</span>
                  <Button size="sm" iconRight="chevronRight" disabled={page >= pages || loading} onClick={() => goPage(page + 1)}>Siguiente</Button>
                </span>
              )}
            </div>
          )}
        </PageState>
      </div>

      <aside className="aca-members-aside">
        <GroupCard />
      </aside>

      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        value={filters}
        admin={admin}
        cohorts={cohorts.data?.cohorts || []}
        levelName={levelName}
        q={q}
        onApply={(next, nextQ) => {
          setFilters(next)
          setPage(1)
          const p = new URLSearchParams(params)
          if (nextQ) p.set('q', nextQ); else p.delete('q')
          setParams(p, { replace: true })
          setFilterOpen(false)
        }}
      />

      {admin && (
        <>
          <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={() => refetch?.()} />
          <MemberAdminSheet
            open={Boolean(selected)}
            member={selectedMember}
            onClose={() => setSelected(null)}
            onChanged={() => refetch?.()}
          />
        </>
      )}
    </div>
  )
}

function FilterSheet({ open, onClose, value, admin, cohorts, levelName, q, onApply }) {
  const [d, setD] = useState(value)
  const [text, setText] = useState(q)
  useEffect(() => { if (open) { setD(value); setText(q) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const name = (n) => {
    try { return levelName?.(n) || '' } catch { return '' }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filtro"
      icon="filter"
      size="sm"
      footer={(
        <>
          <Button variant="plain" onClick={() => onApply(NO_FILTERS, '')}>Limpiar</Button>
          <Button variant="primary" onClick={() => onApply(d, text.trim().slice(0, 80))}>Aplicar</Button>
        </>
      )}
    >
      <div className="aca-mi-form">
        <Field label="Nombre o usuario" htmlFor="aca-mf-q">
          <input
            id="aca-mf-q"
            className="aca-mi-input"
            type="search"
            value={text}
            maxLength={80}
            placeholder="Buscar miembros"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onApply(d, text.trim().slice(0, 80)) }}
          />
        </Field>
        <Field label="Nivel" htmlFor="aca-mf-level">
          <select id="aca-mf-level" className="aca-mi-input" value={d.level} onChange={(e) => setD({ ...d, level: e.target.value })}>
            <option value="">Todos los niveles</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>Nivel {n}{name(n) ? ` · ${name(n)}` : ''}</option>
            ))}
          </select>
        </Field>
        {admin && (
          <Field label="Grupo" htmlFor="aca-mf-cohort">
            <select id="aca-mf-cohort" className="aca-mi-input" value={d.cohortId} onChange={(e) => setD({ ...d, cohortId: e.target.value })}>
              <option value="">Todos los grupos</option>
              {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Ordenar por">
          <Segmented options={SORTS} value={d.sort} onChange={(v) => setD({ ...d, sort: v })} full ariaLabel="Ordenar por" />
        </Field>
      </div>
    </Sheet>
  )
}
