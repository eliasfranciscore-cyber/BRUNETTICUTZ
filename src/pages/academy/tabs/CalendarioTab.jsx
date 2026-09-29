import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../../academy/Icon.jsx'
import { Button, IconButton, Segmented, Sheet, useIsPhone } from '../../../components/panel/index.js'
import PageState from '../../../components/academy/PageState.jsx'
import MonthGrid, {
  MONTHS_ES, viewerTz, wallClock, dayKeyIn, addDaysKey, monthRange, groupByDay, eventStart, eventEnd,
  fmtTime24, fmtTime12, tzPhrase, longDateOfKey, capitalize, occurrenceKey, parseKey,
} from '../../../components/academy/MonthGrid.jsx'
import EventSheet, { lockText } from '../../../components/academy/EventSheet.jsx'
import EventEditor, { EVENT_TEMPLATES, locationMeta } from '../../../components/academy/EventEditor.jsx'
import { academyApi } from '../../../academy/api.js'
import { useAcademy } from '../../../academy/context.js'
import { useAcademyQuery } from '../../../academy/useQuery.js'
import { isImageUrl } from '../../../academy/url.js'
import '../../../styles/academy/calendario.css'

/* ============================================================
   Calendario (SPEC §7.4, captura 2 de Skool).
   - Encabezado: [Hoy] ‹ septiembre 2026 › + reloj "9:40 pm hora de
     Santiago" (zona de quien mira) + [+] (staff) + vista lista/mes.
   - Mes: grilla lunes-domingo con chips y "+N más". En el celular, puntos
     por día y la lista del día elegido debajo (los chips no caben en 50 px).
   - Lista: próximos eventos (ventana de 62 días, el tope de `events`),
     paginada de a 10, con "Ver más adelante" para correr la ventana.
   - Vacío: staff ve "Crea tu primer evento" con los 4 formatos de Skool;
     un miembro ve "No hay eventos próximos".
   Lecturas: una por mes/ventana visitada (cache de useAcademyQuery) y al
   volver a la pestaña. Sin polling: el reloj del encabezado es solo un
   setInterval local, no toca la red.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')
const VIEW_KEY = 'ps_academy_cal_view'
const PAGE = 10
const WINDOW_DAYS = 61 // from..to inclusivo = 62 días (tope del backend)

function readView() {
  try { return localStorage.getItem(VIEW_KEY) === 'lista' ? 'lista' : 'mes' } catch { return 'mes' }
}
function storeView(v) {
  try { localStorage.setItem(VIEW_KEY, v) } catch { /* sin storage */ }
}

// Etiqueta corta de fecha para la columna de la lista: { dow: 'JUE', d: 2, mon: 'OCT' }
function dateBadge(start, tz) {
  const w = wallClock(start, tz)
  if (!w) return null
  const dow = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'][w.dow - 1]
  const mon = MONTHS_ES[w.m].slice(0, 3).toUpperCase()
  return { dow, d: w.d, mon }
}

function EventRow({ ev, tz, now, onOpen, cohortName }) {
  const start = eventStart(ev)
  const end = eventEnd(ev)
  const badge = start ? dateBadge(start, tz) : null
  const past = end && end.getTime() < now
  const live = start && end && start.getTime() <= now && end.getTime() >= now
  const loc = locationMeta(ev.locationType)
  const cover = ev.coverUrl && isImageUrl(ev.coverUrl) ? ev.coverUrl : null
  return (
    <button type="button" className={cx('aca-cal-row', past && 'is-past')} onClick={() => onOpen(ev)}>
      {badge && (
        <span className="aca-cal-badge" aria-hidden="true">
          <small>{badge.dow}</small>
          <strong>{badge.d}</strong>
          <small>{badge.mon}</small>
        </span>
      )}
      <span className="aca-cal-row-main">
        <span className="aca-cal-row-title">
          {live && <span className="aca-cal-live">En vivo</span>}
          {ev.title}
        </span>
        <span className="aca-cal-row-meta">
          {start ? `${fmtTime24(start, tz)} – ${fmtTime24(end, tz)}` : ''}
          <span aria-hidden="true"> · </span>
          <Icon name={ev.locked ? 'lock' : loc.icon} size={13} />
          <span>{ev.locked ? lockText(ev, { cohortName }) : loc.label}</span>
          {ev.repeatWeekly && <><span aria-hidden="true"> · </span><span>Semanal</span></>}
        </span>
      </span>
      {cover && <img className="aca-cal-row-cover" src={cover} alt="" loading="lazy" />}
      <Icon name="chevronRight" size={16} />
    </button>
  )
}

function EmptyOverlay({ staff, pastMonth, monthName, onTemplate, onCreate }) {
  if (staff && !pastMonth) {
    return (
      <div className="aca-cal-empty-card" role="region" aria-label="Crea tu primer evento">
        <h2>Crea tu primer evento</h2>
        <p>
          Una de las formas más rápidas de construir comunidad es reunir a los miembros para pasar el rato
          en una llamada de Zoom, Google Meet o en persona.
        </p>
        <p className="aca-cal-empty-strong">Prueba uno de estos formatos divertidos:</p>
        <ul className="aca-cal-templates">
          {EVENT_TEMPLATES.map((t) => (
            <li key={t.id}>
              <span aria-hidden="true">{t.emoji}</span>
              <button type="button" className="aca-link-btn" onClick={() => onTemplate(t)}>{t.title}</button>
            </li>
          ))}
        </ul>
        <p>O, <button type="button" className="aca-link-btn" onClick={onCreate}>crea mi propio evento</button></p>
      </div>
    )
  }
  return (
    <div className="aca-cal-empty-card is-small" role="status">
      <span className="aca-cal-empty-icon"><Icon name="calendar" size={20} /></span>
      <h2>{pastMonth ? `No hubo eventos en ${monthName}` : 'No hay eventos próximos'}</h2>
      <p>{pastMonth ? 'Revisa los meses siguientes.' : 'Cuando se agende una clase en vivo o un Q&A, aparece acá y te avisamos.'}</p>
      {staff && <Button variant="primary" className="aca-btn-accent" size="sm" icon="plus" onClick={onCreate}>Crear evento</Button>}
    </div>
  )
}

export default function CalendarioTab() {
  const { me, isStaff, toast } = useAcademy()
  const isPhone = useIsPhone()
  const tz = viewerTz(me)
  const staff = Boolean(isStaff)
  const [params, setParams] = useSearchParams()

  // Reloj del encabezado (local; se refresca cada 20 s para que el minuto no se atrase).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(t)
  }, [])
  const today = dayKeyIn(now, tz)

  const [view, setViewState] = useState(readView)
  const setView = (v) => { setViewState(v); storeView(v) }
  const [cursor, setCursor] = useState(() => {
    const w = wallClock(new Date(), tz)
    return { y: w.y, m: w.m }
  })
  const [selectedKey, setSelectedKey] = useState(today)
  const [listStart, setListStart] = useState(today)
  const [page, setPage] = useState(0)
  const [openEvent, setOpenEvent] = useState(null)
  const [editor, setEditor] = useState(null) // { event?, template?, date? }
  const [dayList, setDayList] = useState(null) // { key, events } del "+N más"

  const range = useMemo(() => {
    if (view === 'lista') return { from: listStart, to: addDaysKey(listStart, WINDOW_DAYS) }
    return monthRange(cursor.y, cursor.m)
  }, [view, listStart, cursor.y, cursor.m])

  const q = useAcademyQuery(
    `events:${range.from}:${range.to}:${tz}`,
    () => academyApi('events', { query: { from: range.from, to: range.to, tz } }),
    { deps: [range.from, range.to, tz] },
  )
  const events = useMemo(() => {
    const list = Array.isArray(q.data?.events) ? q.data.events : []
    return [...list].sort((a, b) => (eventStart(a) || 0) - (eventStart(b) || 0))
  }, [q.data])

  // Deep link: /academy/calendario?evento=12[&o=<ISO de la ocurrencia>] —
  // lo usan las notificaciones y el banner de la comunidad.
  const deepId = params.get('evento') || params.get('event')
  const deepOcc = params.get('o') || params.get('occurrence')
  const clearDeepLink = useCallback(() => {
    if (!params.get('evento') && !params.get('event')) return
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('evento'); next.delete('event'); next.delete('o'); next.delete('occurrence')
      return next
    }, { replace: true })
  }, [params, setParams])

  useEffect(() => {
    if (!deepId || !/^\d{1,9}$/.test(deepId)) return undefined
    let alive = true
    const query = { id: deepId }
    if (deepOcc) query.occurrence = deepOcc
    academyApi('event', { query })
      .then((res) => {
        if (!alive || !res?.event) return
        setOpenEvent(res.event)
        const s = eventStart(res.event)
        const w = s ? wallClock(s, tz) : null
        if (w) {
          setCursor({ y: w.y, m: w.m })
          setSelectedKey(dayKeyIn(s, tz))
        }
      })
      .catch((err) => {
        if (!alive) return
        toast?.(err?.status === 404 ? 'Ese evento ya no existe.' : (err?.message || 'No se pudo abrir el evento.'), 'error')
        clearDeepLink()
      })
    return () => { alive = false }
  }, [deepId, deepOcc]) // eslint-disable-line react-hooks/exhaustive-deps

  const closeEvent = () => { setOpenEvent(null); clearDeepLink() }

  const todayParts = parseKey(today)
  const pastMonth = cursor.y < todayParts.y || (cursor.y === todayParts.y && cursor.m < todayParts.m)
  const monthName = MONTHS_ES[cursor.m]

  const goToday = () => {
    const p = parseKey(today)
    setCursor({ y: p.y, m: p.m })
    setSelectedKey(today)
    setListStart(today)
    setPage(0)
  }
  const shiftMonth = (delta) => {
    const total = cursor.y * 12 + cursor.m + delta
    const y = Math.floor(total / 12)
    const m = ((total % 12) + 12) % 12
    setCursor({ y, m })
    // En el celular queda elegido el 1 del mes (o hoy, si es el mes actual).
    setSelectedKey(y === todayParts.y && m === todayParts.m ? today : `${y}-${String(m + 1).padStart(2, '0')}-01`)
  }

  const newEvent = (template = null) => {
    const base = selectedKey && selectedKey >= today ? selectedKey : today
    setEditor({ template, date: base })
  }

  const onSaved = () => { q.refetch() }
  const onDeleted = () => { q.refetch() }

  const cohortName = (ev) => (ev?.access?.type === 'grupo'
    ? (me?.cohorts || []).find((c) => Number(c.id) === Number(ev.access.cohortId))?.name
    : null)

  /* ---------- Lista ---------- */
  const listEvents = view === 'lista' ? events.filter((ev) => {
    const e = eventEnd(ev)
    return listStart !== today || !e || e.getTime() >= now - 60 * 60000
  }) : []
  const pages = Math.max(1, Math.ceil(listEvents.length / PAGE))
  const safePage = Math.min(page, pages - 1)
  const pageItems = listEvents.slice(safePage * PAGE, safePage * PAGE + PAGE)
  const lastInWindow = addDaysKey(listStart, WINDOW_DAYS)

  /* ---------- Celular: lista del día elegido ---------- */
  const byDay = useMemo(() => groupByDay(events, tz), [events, tz])
  const selectedEvents = byDay[selectedKey] || []

  const showEmpty = !q.loading && !q.error && (view === 'lista' ? listEvents.length === 0 : events.length === 0)

  const headLabel = view === 'lista' ? 'Próximos eventos' : `${monthName} ${cursor.y}`

  return (
    <div className="aca-cal">
      <section className="aca-cal-card">
        <header className="aca-cal-head">
          <div className="aca-cal-head-left">
            <Button variant="secondary" size="sm" className="aca-cal-today" onClick={goToday}>Hoy</Button>
          </div>
          <div className="aca-cal-head-center">
            {view === 'mes' ? (
              <div className="aca-cal-nav">
                <IconButton icon="chevronLeft" label="Mes anterior" plain small onClick={() => shiftMonth(-1)} />
                <h1 className="aca-cal-title" aria-live="polite">{headLabel}</h1>
                <IconButton icon="chevronRight" label="Mes siguiente" plain small onClick={() => shiftMonth(1)} />
              </div>
            ) : (
              <h1 className="aca-cal-title">{headLabel}</h1>
            )}
            <p className="aca-cal-clock">{fmtTime12(now, tz)} {tzPhrase(tz)}</p>
          </div>
          <div className="aca-cal-head-right">
            {staff && <IconButton icon="plus" label="Crear evento" onClick={() => newEvent()} className="aca-cal-add" />}
            <Segmented
              size="sm"
              ariaLabel="Vista del calendario"
              value={view}
              onChange={(v) => { setView(v); setPage(0) }}
              options={[
                { value: 'lista', icon: 'list', title: 'Lista' },
                { value: 'mes', icon: 'calendar', title: 'Mes' },
              ]}
            />
          </div>
        </header>

        <div className={cx('aca-cal-body', showEmpty && 'is-empty', view === 'lista' && 'is-list')}>
          {q.error && !q.data ? (
            <PageState error={q.error} onRetry={q.refetch} />
          ) : view === 'mes' ? (
            <>
              <MonthGrid
                year={cursor.y}
                month={cursor.m}
                events={events}
                tz={tz}
                now={now}
                todayKey={today}
                selectedKey={isPhone ? selectedKey : undefined}
                compact={isPhone}
                onSelectDay={isPhone ? setSelectedKey : undefined}
                onOpenEvent={setOpenEvent}
                onMore={(key, list) => setDayList({ key, events: list })}
                className={q.loading && !q.data ? 'is-loading' : undefined}
              />
              {showEmpty && (
                <div className="aca-cal-empty">
                  <EmptyOverlay
                    staff={staff}
                    pastMonth={pastMonth}
                    monthName={monthName}
                    onTemplate={(t) => newEvent(t)}
                    onCreate={() => newEvent()}
                  />
                </div>
              )}
            </>
          ) : (
            <PageState loading={q.loading && !q.data}>
              {showEmpty ? (
                <div className="aca-cal-empty is-static">
                  <EmptyOverlay
                    staff={staff && listStart === today}
                    pastMonth={false}
                    monthName=""
                    onTemplate={(t) => newEvent(t)}
                    onCreate={() => newEvent()}
                  />
                </div>
              ) : (
                <div className="aca-cal-list">
                  {pageItems.map((ev) => (
                    <EventRow key={occurrenceKey(ev)} ev={ev} tz={tz} now={now} onOpen={setOpenEvent} cohortName={cohortName(ev)} />
                  ))}
                </div>
              )}
              <footer className="aca-cal-pager">
                <span className="aca-cal-pager-info">
                  {listEvents.length
                    ? `${safePage * PAGE + 1}–${Math.min(listEvents.length, safePage * PAGE + PAGE)} de ${listEvents.length}`
                    : 'Sin eventos'}
                  <span className="aca-cal-pager-range"> · hasta el {longDateOfKey(lastInWindow)}</span>
                </span>
                <span className="aca-cal-pager-btns">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="chevronLeft"
                    disabled={safePage === 0 && listStart === today}
                    onClick={() => {
                      if (safePage > 0) setPage(safePage - 1)
                      else { setListStart((s) => { const prev = addDaysKey(s, -(WINDOW_DAYS + 1)); return prev < today ? today : prev }); setPage(0) }
                    }}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconRight="chevronRight"
                    onClick={() => {
                      if (safePage < pages - 1) setPage(safePage + 1)
                      else { setListStart(addDaysKey(lastInWindow, 1)); setPage(0) }
                    }}
                  >
                    {safePage < pages - 1 ? 'Siguiente' : 'Ver más adelante'}
                  </Button>
                </span>
              </footer>
            </PageState>
          )}
        </div>
      </section>

      {isPhone && view === 'mes' && !q.error && (
        <section className="aca-cal-day" aria-label={`Eventos del ${longDateOfKey(selectedKey)}`}>
          <h2 className="aca-cal-day-title">{capitalize(selectedKey === today ? `Hoy, ${longDateOfKey(selectedKey)}` : longDateOfKey(selectedKey))}</h2>
          {q.loading && !q.data ? (
            <PageState loading />
          ) : selectedEvents.length ? (
            <div className="aca-cal-list">
              {selectedEvents.map((ev) => (
                <EventRow key={occurrenceKey(ev)} ev={ev} tz={tz} now={now} onOpen={setOpenEvent} cohortName={cohortName(ev)} />
              ))}
            </div>
          ) : (
            <p className="aca-cal-day-empty">No hay eventos este día.</p>
          )}
        </section>
      )}

      <Sheet
        open={Boolean(dayList)}
        onClose={() => setDayList(null)}
        title={dayList ? capitalize(longDateOfKey(dayList.key)) : ''}
        size="sm"
        bodyClassName="is-flush"
      >
        {dayList && (
          <div className="aca-cal-list is-sheet">
            {dayList.events.map((ev) => (
              <EventRow
                key={occurrenceKey(ev)}
                ev={ev}
                tz={tz}
                now={now}
                cohortName={cohortName(ev)}
                onOpen={(e) => { setDayList(null); setTimeout(() => setOpenEvent(e), 200) }}
              />
            ))}
          </div>
        )}
      </Sheet>

      <EventSheet
        open={Boolean(openEvent)}
        event={openEvent}
        tz={tz}
        canManage={staff}
        onClose={closeEvent}
        onEdit={(ev) => { closeEvent(); setTimeout(() => setEditor({ event: ev }), 200) }}
        onDeleted={onDeleted}
      />

      <EventEditor
        open={Boolean(editor)}
        event={editor?.event || null}
        template={editor?.template || null}
        date={editor?.date}
        onClose={() => setEditor(null)}
        onSaved={onSaved}
      />
    </div>
  )
}
