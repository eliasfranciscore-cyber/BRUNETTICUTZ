import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { bookingUid, cleanPhone, fmtDate, fmtRange, santiagoDateKey } from '../../data.js'
import {
  Button, Card, Chip, EmptyState, InlineAlert, KpiGrid, List, ListRow, ModuleHeader, PeriodNav,
  CalendarSheet, Segmented, SearchField, Skeleton, StatusBadge, Time,
  useIsPhone, useMediaQuery, useStoredFlag,
} from '../../components/panel/index.js'
import { AGENDA_MAX_KEY, AGENDA_SLOTS } from './shared.jsx'
import '../../styles/panel/agenda.css'

const cx = (...parts) => parts.filter(Boolean).join(' ')

// Hora actual en Santiago ("HH:MM"), para saber cuál es la PRÓXIMA cita de
// hoy y no la primera del día (a las 17:00 la de las 09:00 ya no es próxima).
const SANTIAGO_HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const santiagoNowHM = () => {
  const parts = Object.fromEntries(SANTIAGO_HM.formatToParts(new Date()).map((p) => [p.type, p.value]))
  return `${parts.hour}:${parts.minute}`
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/* Pestaña «agenda» del panel interno, sobre el sistema nuevo (ModuleHeader,
   Card, List, Sheet…), ajustada a Brunetti: una sola agenda (la de Bruno),
   sin selector de barbero ni alcance de equipo. Recibe
   en `ctx` el estado y las acciones de Dashboard (el objeto `dash`).

   Cambios de fondo respecto de la agenda anterior:
   1) El arrastre para bloquear un rango de horas no servía en el iPhone (con
      el dedo solo cambiaba la primera hora). Queda SOLO para mouse
      (`pointer: fine`); en pantallas táctiles se reemplaza por un modo
      «Seleccionar» con una barra fija de acciones.
   2) Bloquear/Habilitar día y semana completos e «Ir a fecha» se cortaban en
      el celular: ahora viven en el «···» del encabezado. El selector de fecha
      es el CalendarSheet del kit (reemplaza al AgendaDatePicker).
   3) Las horas que ya pasaron ('past' en api/availability.js) llegan como
      libres con `past: true` (normalizeSlots, en Dashboard): se atenúan, no
      se pueden bloquear ni habilitar y no invierten los botones de bloqueo.
      Los días anteriores a hoy se tratan igual (nada de lo pasado se
      gestiona), salvo las reservas, que siempre abren su detalle.
   4) Un día cuya disponibilidad no se pudo leer (horas sin `state`) se
      muestra «Sin datos» en gris — nunca como horas libres — y el aviso de
      arriba ofrece reintentar. Las reservas conocidas de ese día se siguen
      mostrando, porque vienen de /api/bookings y no de la disponibilidad. */
export default function AgendaTab({ ctx }) {
  const {
    agendaBookings,
    agendaBusy,
    agendaDayKey,
    agendaError,
    agendaQuery,
    agendaReady,
    agendaView,
    bookingForSlot,
    bulkAgenda,
    calOpen,
    canBlockAgenda,
    clients,
    dragRef,
    ensurePastBookings,
    goToWeek,
    handleAgendaDaySwipeEnd,
    loadAgenda,
    pickCalendarDay,
    prevWeekStats,
    pushToast,
    setAgendaDayKey,
    setAgendaError,
    setAgendaQuery,
    setAgendaView,
    setCalOpen,
    setDetail,
    setNewBookingOpen,
    slotsFor,
    toggleSlot,
    weekDays,
    weekOffset,
    weekStats,
  } = ctx

  const isPhone = useIsPhone()
  const pointerFine = useMediaQuery('(pointer: fine)')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [applying, setApplying] = useState(false)
  const [rememberTimeline, setRememberTimeline] = useStoredFlag('pn_agenda_view_line', false)

  // Restaura la última vista (Bloques/Línea) al entrar a la pestaña.
  useEffect(() => {
    setAgendaView(rememberTimeline ? 'timeline' : 'grid')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Selección de horas: solo tiene sentido para el día/vista visible.
  useEffect(() => { setSelected(new Set()) }, [agendaDayKey, agendaView])
  useEffect(() => { if (!selectMode) setSelected(new Set()) }, [selectMode])

  const changeView = (v) => { setAgendaView(v); setRememberTimeline(v === 'timeline') }

  if (!agendaDayKey) {
    return (
      <div className="pn-page pn-agenda">
        <ModuleHeader title="Agenda" />
        <Skeleton height={120} radius={16} />
        <Skeleton height={320} radius={16} />
      </div>
    )
  }

  const todayKey = santiagoDateKey()
  const dayIsPast = agendaDayKey < todayKey
  // Bruno puede gestionar su agenda; el resto de las sesiones depende del
  // permiso que calcula Dashboard (canBlockAgenda). Sin permiso, la grilla
  // queda de solo lectura (las reservas siguen abriendo su detalle).
  const canManage = canBlockAgenda !== false
  const selecting = selectMode && !pointerFine && agendaView === 'grid'

  /* ---- Lectura de la grilla -------------------------------------------
     slotsFor() devuelve [] mientras la semana no llegó (o si es de otro
     barbero): eso es "cargando". Un día con horas sin `state` es una
     respuesta degradada: "desconocido". */
  const daySlots = slotsFor(agendaDayKey)
  const dayLoading = !agendaReady || daySlots.length === 0
  const cellOf = (dayKey, dayPast, slots, t) => {
    const info = slots.find((item) => item.slot === t)
    let state = info?.state || null
    let past = Boolean(info?.past)
    if (state === 'past') { state = 'free'; past = true } // por si llegara sin normalizar
    const known = Boolean(state)
    const bk = bookingForSlot(dayKey, t)
    if (!state) state = bk ? 'booked' : 'unknown'
    if (state === 'booked') past = false
    else if (dayPast && state !== 'unknown') past = true
    return { slot: t, state, past, known, bk: state === 'booked' ? bk : null }
  }
  const cells = dayLoading ? [] : AGENDA_SLOTS.map((t) => cellOf(agendaDayKey, dayIsPast, daySlots, t))
  const cellBySlot = Object.fromEntries(cells.map((c) => [c.slot, c]))
  const knownCells = cells.filter((c) => c.known)
  const dayUnknown = !dayLoading && knownCells.length < cells.length

  const bookedDay = knownCells.filter((c) => c.state === 'booked').length
  const freeDay = knownCells.filter((c) => c.state === 'free').length
  const blockedDay = knownCells.filter((c) => c.state === 'blocked').length
  const dayOcc = (bookedDay + freeDay) ? Math.round((bookedDay / (bookedDay + freeDay)) * 100) : 0

  // Lo que todavía se puede bloquear o habilitar: ni reservado, ni pasado,
  // ni sin leer. Es lo que miran los botones de bloqueo.
  const dayManageable = knownCells.filter((c) => c.state !== 'booked' && !c.past)
  const dayFreeCount = dayManageable.filter((c) => c.state === 'free').length
  const dayIsBlocked = dayManageable.length > 0 && dayFreeCount === 0

  // Semana: mismo corte accionable, con la misma regla de lo pasado.
  let weekManageable = 0
  let weekFreeNow = 0
  let weekLoaded = agendaReady
  let weekUnknown = false
  weekDays.forEach((d) => {
    const slots = slotsFor(d.key)
    if (!slots.length) { weekLoaded = false; return }
    const past = d.key < todayKey
    slots.forEach((s) => {
      if (!s.state) { weekUnknown = true; return }
      if (s.state === 'booked' || s.past || s.state === 'past' || past) return
      weekManageable += 1
      if (s.state === 'free') weekFreeNow += 1
    })
  })
  const weekIsBlocked = weekManageable > 0 && weekFreeNow === 0

  const dayBookingsToday = agendaBookings
    .filter((b) => b.date === agendaDayKey && b.status !== 'cancelada')
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
  // Próxima cita: hoy, la primera que todavía no empieza; otro día futuro, la
  // primera; un día pasado no tiene "próxima", se muestra la primera.
  const nowHM = santiagoNowHM()
  const nextBooking = agendaDayKey === todayKey
    ? dayBookingsToday.find((b) => (b.time || '') >= nowHM && b.status !== 'completada')
    : dayBookingsToday[0]
  const nextLabel = dayIsPast ? 'Primera del día' : 'Próxima cita'

  // Nuevos vs recurrentes del día: cruza por teléfono con el registro de
  // clientes. `visits` (api/clients.js) cuenta las reservas no canceladas
  // hasta hoy, así que la de este día entra si el día ya llegó; recurrente =
  // al menos una visita además de esta.
  let newCount = 0
  let recurringCount = 0
  dayBookingsToday.forEach((b) => {
    const phone = cleanPhone(b.phone)
    const c = phone ? clients.find((item) => cleanPhone(item.phone) === phone) : null
    const countsThis = String(b.date || '') <= todayKey ? 1 : 0
    if (c && Number(c.visits || 0) - countsThis >= 1) recurringCount += 1
    else newCount += 1
  })

  // Deltas vs. la semana anterior: si no hay datos previos fiables (API
  // caída) o esta semana tiene días sin leer, no se inventan cifras.
  const weekDelta = prevWeekStats && weekLoaded && !weekUnknown ? {
    booked: weekStats.booked - prevWeekStats.booked,
    free: weekStats.free - prevWeekStats.free,
    blocked: weekStats.blocked - prevWeekStats.blocked,
  } : null
  const fmtDelta = (n) => (n === 0 ? 'Igual que la sem. pasada' : `${n > 0 ? '+' : ''}${n} vs. sem. pasada`)
  const toneOf = (n, upIsGood = true) => (n > 0 ? (upIsGood ? 'up' : 'down') : n < 0 ? (upIsGood ? 'down' : 'up') : undefined)
  const weekSuffix = weekOffset === 0 ? 'esta semana'
    : weekOffset === 1 ? 'próx. semana'
    : weekOffset === -1 ? 'sem. pasada'
    : weekOffset < 0 ? `hace ${-weekOffset} sem.`
    : `en ${weekOffset} sem.`

  const rangeLabel = weekDays.length ? fmtRange(weekDays[0].key, weekDays[weekDays.length - 1].key) : ''

  const headerActions = [
    {
      label: dayIsBlocked ? 'Habilitar día completo' : 'Bloquear día completo',
      icon: dayIsBlocked ? 'check' : 'close',
      hidden: !canManage,
      disabled: Boolean(agendaBusy) || !dayManageable.length,
      hint: !dayLoading && !dayManageable.length ? (dayIsPast ? 'Este día ya pasó' : 'No quedan horas por gestionar') : undefined,
      onClick: () => {
        bulkAgenda('day', dayIsBlocked ? 'enable' : 'block')
        pushToast(dayIsBlocked ? '✓' : '✕', dayIsBlocked ? 'Día habilitado' : 'Día bloqueado')
      },
    },
    {
      label: weekIsBlocked ? 'Habilitar semana completa' : 'Bloquear semana completa',
      icon: weekIsBlocked ? 'check' : 'close',
      hidden: !canManage,
      disabled: Boolean(agendaBusy) || !weekManageable,
      onClick: () => {
        bulkAgenda('week', weekIsBlocked ? 'enable' : 'block')
        pushToast(weekIsBlocked ? '✓' : '✕', weekIsBlocked ? 'Semana habilitada' : 'Semana bloqueada')
      },
    },
    { label: 'Ir a fecha', icon: 'calendar', onClick: () => setCalOpen(true) },
  ]

  const daySearch = agendaQuery.trim().toLowerCase()
  const dayBookingsFiltered = daySearch
    ? dayBookingsToday.filter((b) => `${b.client || ''} ${b.service || ''}`.toLowerCase().includes(daySearch))
    : dayBookingsToday

  const summaryLine = [
    `${plural(dayBookingsToday.length, 'reserva', 'reservas')}${newCount && dayBookingsToday.length ? ` (${plural(newCount, 'cliente nuevo', 'clientes nuevos')})` : ''}`,
    dayUnknown
      ? 'disponibilidad sin leer'
      : dayIsPast
        ? `${freeDay} h sin reserva · ${plural(blockedDay, 'bloqueada', 'bloqueadas')}`
        : `${dayFreeCount} h ${dayFreeCount === 1 ? 'libre' : 'libres'} · ${plural(blockedDay, 'bloqueada', 'bloqueadas')}`,
    `${dayIsPast ? 'Primera' : 'Próxima'} ${nextBooking ? nextBooking.time : '—'}`,
  ].join(' · ')

  const heroKpis = [
    {
      id: 'occ', icon: 'target', label: 'Ocupación del día', animate: false,
      value: dayUnknown && !knownCells.length ? '—' : dayOcc,
      format: (n) => `${n}%`,
      hint: dayUnknown ? 'Hay horas sin leer' : `${bookedDay}/${bookedDay + freeDay} horas`,
    },
    { id: 'booked', icon: 'calendar', label: `Reservados · ${weekSuffix}`, value: weekStats.booked, hint: weekDelta ? fmtDelta(weekDelta.booked) : undefined, hintTone: weekDelta ? toneOf(weekDelta.booked) : undefined },
    { id: 'free', icon: 'clock', label: `Disponibles · ${weekSuffix}`, value: weekStats.free, suffix: 'h', hint: weekDelta ? fmtDelta(weekDelta.free) : undefined, hintTone: weekDelta ? toneOf(weekDelta.free) : undefined },
    { id: 'blocked', icon: 'trend', label: `Bloqueadas · ${weekSuffix}`, value: weekStats.blocked, hint: weekDelta ? fmtDelta(weekDelta.blocked) : undefined, hintTone: weekDelta ? toneOf(weekDelta.blocked, false) : undefined },
    {
      id: 'next', icon: 'spark', label: nextLabel, animate: false,
      value: nextBooking ? nextBooking.time : (dayBookingsToday.length ? 'Sin más hoy' : 'Sin reservas'),
      hint: nextBooking ? `${nextBooking.client} · ${nextBooking.service}` : (dayBookingsToday.length ? 'Ya empezaron todas las de hoy' : 'Nada agendado este día'),
    },
    { id: 'new', icon: 'users', label: 'Nuevos vs recurrentes', value: newCount, format: (n) => `${n}/${recurringCount}`, hint: `${plural(recurringCount, 'recurrente', 'recurrentes')} este día`, animate: false },
  ]

  // ---- Selección múltiple de horas (reemplaza el arrastre táctil) --------
  const toggleSelected = (slot) => setSelected((cur) => {
    const next = new Set(cur)
    if (next.has(slot)) next.delete(slot); else next.add(slot)
    return next
  })
  const selectable = (slot) => { const c = cellBySlot[slot]; return c && c.known && !c.past && c.state !== 'booked' }
  const selectedFree = [...selected].filter((slot) => selectable(slot) && cellBySlot[slot].state === 'free')
  const selectedBlocked = [...selected].filter((slot) => selectable(slot) && cellBySlot[slot].state === 'blocked')
  // No hay endpoint para bloquear/habilitar VARIAS horas sueltas (solo día,
  // semana, mañana o tarde completos): se llama a toggleSlot de a una, en
  // serie. Se corta en el primer rechazo (una sesión vencida haría fallar
  // todas) y, si hubo uno, se relee la semana para no quedar desalineados.
  const applySelection = async (slots, fromState) => {
    if (!slots.length) return
    setApplying(true)
    let done = 0
    let failed = false
    for (const slot of slots) {
      const ok = await toggleSlot(agendaDayKey, slot, fromState)
      if (ok === false) { failed = true; break }
      done += 1
    }
    setApplying(false)
    setSelected((cur) => { const next = new Set(cur); slots.forEach((s) => next.delete(s)); return next })
    if (done) {
      pushToast(fromState === 'free' ? '✕' : '✓', fromState === 'free'
        ? `${plural(done, 'hora bloqueada', 'horas bloqueadas')}`
        : `${plural(done, 'hora habilitada', 'horas habilitadas')}`)
    }
    if (failed) loadAgenda?.()
  }

  // Un toque: bloquea o habilita esa hora. El aviso sale cuando el servidor
  // responde; si toggleSlot devuelve false (rechazo), el error ya quedó
  // arriba y no se muestra un ✓ falso.
  const applyToggle = (t, state) => {
    Promise.resolve(toggleSlot(agendaDayKey, t, state)).then((ok) => {
      if (ok === false) return
      pushToast(state === 'free' ? '✕' : '✓', state === 'free' ? `${t} bloqueado` : `${t} habilitado`)
    })
  }

  const hintText = !canManage
    ? 'Solo lectura: tu sesión no puede bloquear horas.'
    : dayIsPast
      ? 'Este día ya pasó: las horas no se pueden bloquear ni habilitar. Las reservas abren su detalle.'
      : dayUnknown
        ? 'Las horas en gris no se pudieron leer: no se pueden gestionar hasta reintentar.'
      : pointerFine
        ? 'Arrastra sobre las horas para bloquear o habilitar un rango.'
        : selecting
          ? 'Toca las horas que quieras cambiar y confirma abajo.'
          : 'Toca una hora para bloquearla o habilitarla. Para varias a la vez, usa Seleccionar.'

  const renderTile = (t) => {
    const c = cellBySlot[t]
    if (dayLoading || !c) return <Skeleton key={t} height={56} radius={10} />
    const { state, past: isPast, bk } = c
    if (state === 'unknown') {
      return (
        <button key={t} type="button" className="pn-agenda-tile is-unknown" disabled title="No se pudo leer esta hora">
          <span className="pn-agenda-tile-h">{t}</span>
          <span className="pn-agenda-tile-tag">Sin datos</span>
        </button>
      )
    }
    const busy = agendaBusy === `${agendaDayKey}-${t}`
    const manageable = canManage && state !== 'booked' && !isPast
    const isSelected = selected.has(t)
    const tag = state === 'booked' ? 'Reservado' : state === 'blocked' ? 'Bloqueado' : isPast ? 'Pasada' : 'Libre'

    const mouseDragProps = pointerFine && manageable ? {
      onMouseDown: (e) => {
        if (e.button !== 0) return
        dragRef.current = { active: true, mode: state === 'free' ? 'block' : 'enable' }
        applyToggle(t, state)
      },
      onMouseEnter: () => {
        if (!dragRef.current?.active) return
        const { mode } = dragRef.current
        if ((mode === 'block' && state === 'free') || (mode === 'enable' && state === 'blocked')) applyToggle(t, state)
      },
    } : {}
    const handleClick = (e) => {
      if (state === 'booked') { if (bk) setDetail(bk); return }
      if (!manageable) return
      // Con mouse el mousedown ya aplicó el cambio; un click sin mouse
      // (detail 0: Enter o Espacio con el foco en la hora) sí lo aplica.
      if (pointerFine && e.detail !== 0) return
      if (selecting) { toggleSelected(t); return }
      applyToggle(t, state)
    }
    const title = state === 'booked' ? (bk ? `${bk.client} · ${bk.service}` : 'Reservado')
      : isPast ? 'Esta hora ya pasó'
      : !canManage ? 'Solo lectura'
      : selecting ? (isSelected ? 'Tocar para quitar de la selección' : 'Tocar para seleccionar')
      : state === 'blocked' ? 'Tocar para habilitar' : 'Tocar para bloquear'

    return (
      <button
        key={t}
        type="button"
        className={cx('pn-agenda-tile', `is-${state}`, isPast && 'is-past', isSelected && 'is-selected', busy && 'is-busy')}
        disabled={busy || (state !== 'booked' && !manageable)}
        aria-pressed={selecting && manageable ? isSelected : undefined}
        onClick={handleClick}
        {...mouseDragProps}
        title={title}
      >
        <span className="pn-agenda-tile-h">{busy ? '…' : t}</span>
        <span className="pn-agenda-tile-tag">{isSelected ? 'Elegida' : tag}</span>
      </button>
    )
  }

  const renderTimelineRow = (t) => {
    const c = cellBySlot[t]
    if (dayLoading || !c) return <Skeleton key={t} height={44} radius={10} />
    const { state, past: isPast, bk } = c
    const open = state === 'booked' && bk ? () => setDetail(bk) : undefined
    return (
      <div
        key={t}
        className={cx('pn-agenda-tl-row', isPast && 'is-past', state === 'unknown' && 'is-unknown')}
        onClick={open}
        role={open ? 'button' : undefined}
        tabIndex={open ? 0 : undefined}
        onKeyDown={open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } } : undefined}
      >
        <span className="pn-agenda-tl-time">{t}</span>
        <span className={cx('pn-agenda-tl-rail', `is-${state}`)} />
        <div className="pn-agenda-tl-card">
          {state === 'booked' ? (
            <>
              <div className="pn-agenda-tl-info">
                <strong>{bk?.client || 'Reservado'}</strong>
                {bk?.service && <span>{bk.service}</span>}
              </div>
              {bk ? <StatusBadge status={bk.status || 'pendiente'} /> : <Chip tone="accent">Reservado</Chip>}
            </>
          ) : state === 'unknown' ? (
            <><span className="pn-agenda-tl-empty">Sin datos</span><Chip tone="muted">Sin leer</Chip></>
          ) : state === 'blocked' ? (
            <span className="pn-agenda-tl-empty">Bloqueado</span>
          ) : isPast ? (
            <><span className="pn-agenda-tl-empty">Sin reserva</span><Chip tone="muted">Pasada</Chip></>
          ) : (
            <><span className="pn-agenda-tl-empty">Disponible</span><Chip tone="ok">Libre</Chip></>
          )}
        </div>
      </div>
    )
  }

  // Reservas por día para el calendario (el puntito con el número).
  const bookingCounts = {}
  if (calOpen) {
    agendaBookings.forEach((b) => {
      if (!b.date || b.status === 'cancelada') return
      bookingCounts[b.date] = (bookingCounts[b.date] || 0) + 1
    })
  }

  return (
    <div className="pn-page pn-agenda">
      <ModuleHeader
        title="Agenda"
        meta={<Chip tone="muted" icon="user">Agenda de Brunetti</Chip>}
        primary={{ label: 'Reserva', icon: 'plus', onClick: () => setNewBookingOpen(true) }}
        actions={headerActions}
      />

      {agendaError && (
        <InlineAlert
          tone="error"
          action={weekUnknown && loadAgenda ? { label: 'Reintentar', onClick: () => { setAgendaError(''); loadAgenda() } } : undefined}
          onClose={() => setAgendaError('')}
        >
          {agendaError}
        </InlineAlert>
      )}

      <div className="pn-agenda-week">
        <PeriodNav
          label={rangeLabel}
          onPrev={() => goToWeek(weekOffset - 1)}
          onNext={() => goToWeek(weekOffset + 1)}
          onLabelClick={() => setCalOpen(true)}
          prevLabel="Semana anterior"
          nextLabel="Semana siguiente"
        />
        <Button variant="secondary" size="sm" onClick={() => pickCalendarDay(todayKey)} disabled={agendaDayKey === todayKey}>Hoy</Button>
      </div>

      <motion.div
        className="pn-agenda-strip"
        role="group"
        aria-label="Día de la semana"
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.4}
        onDragEnd={handleAgendaDaySwipeEnd}
      >
        {weekDays.map((d) => {
          const isActive = d.key === agendaDayKey
          const isToday = d.key === todayKey
          const hasBookings = slotsFor(d.key).some((s) => s.state === 'booked')
            || agendaBookings.some((b) => b.date === d.key && b.status !== 'cancelada')
          const [dow, num] = d.label.split(' ')
          return (
            <button
              key={d.key}
              type="button"
              className={cx('pn-agenda-day', isActive && 'is-active', isToday && 'is-today')}
              aria-pressed={isActive}
              aria-label={`${fmtDate(d.key, 'long')}${hasBookings ? ', con reservas' : ''}`}
              onClick={() => setAgendaDayKey(d.key)}
            >
              <span className="pn-agenda-day-dow">{isToday ? 'Hoy' : dow}</span>
              <span className="pn-agenda-day-num">{num}</span>
              <span className={cx('pn-agenda-day-dot', !hasBookings && 'is-off')} />
            </button>
          )
        })}
      </motion.div>

      {isPhone ? (
        dayLoading
          ? <Skeleton height={44} radius={14} />
          : <p className="pn-agenda-summary">{summaryLine}</p>
      ) : (
        weekLoaded
          ? <KpiGrid items={heroKpis} visible={4} cols={4} storageKey="agenda-hero" />
          : <Skeleton height={96} radius={16} />
      )}

      <div className="pn-agenda-layout">
        <Card
          title="Horas del día"
          subtitle={fmtDate(agendaDayKey, 'long')}
          action={(
            <div className="pn-agenda-headactions">
              {canManage && !pointerFine && agendaView === 'grid' && (selecting || dayManageable.length > 0) && (
                <Button variant={selecting ? 'primary' : 'secondary'} size="sm" icon="check" onClick={() => setSelectMode((v) => !v)}>
                  {selecting ? 'Cancelar' : 'Seleccionar'}
                </Button>
              )}
              <Segmented
                ariaLabel="Vista de la agenda"
                value={agendaView}
                onChange={changeView}
                options={[{ value: 'grid', label: 'Bloques', icon: 'grid' }, { value: 'timeline', label: 'Línea', icon: 'list' }]}
              />
            </div>
          )}
        >
          <div className="pn-agenda-toolbar">
            <div className="pn-agenda-legend">
              <span><i className="is-free" />Atiende</span>
              <span><i className="is-blocked" />Bloqueado</span>
              <span><i className="is-booked" />Reservado</span>
              {dayUnknown && <span><i className="is-unknown" />Sin datos</span>}
            </div>
            {dayLoading ? null : dayUnknown && !knownCells.length
              ? <Chip tone="muted">Sin datos</Chip>
              : dayIsPast
                ? <Chip tone="muted">Día pasado</Chip>
                : <Chip tone="ok">{dayFreeCount} {dayFreeCount === 1 ? 'libre' : 'libres'}</Chip>}
          </div>
          {agendaView === 'grid' && <p className="pn-agenda-hint">{hintText}</p>}

          {agendaView === 'grid' && ['MAÑANA', 'TARDE'].map((label) => {
            const slots = AGENDA_SLOTS.filter((t) => label === 'MAÑANA' ? Number(t.slice(0, 2)) < 12 : Number(t.slice(0, 2)) >= 12)
            // Las horas ya pasadas o sin leer no se gestionan: si entraran
            // acá, una tarde a las 18:00 se leería como "todo bloqueado".
            const periodActionable = slots.map((t) => cellBySlot[t]).filter((c) => c && c.known && c.state !== 'booked' && !c.past)
            const periodIsBlocked = periodActionable.length > 0 && periodActionable.every((c) => c.state === 'blocked')
            const periodName = label === 'MAÑANA' ? 'Mañana' : 'Tarde'
            return (
              <div key={label} className="pn-agenda-period">
                <div className="pn-agenda-period-head">
                  <p className="pn-agenda-period-title">{label}</p>
                  {canManage && (
                    <Button
                      variant="plain"
                      size="sm"
                      disabled={Boolean(agendaBusy) || !periodActionable.length}
                      onClick={() => {
                        bulkAgenda(label === 'MAÑANA' ? 'morning' : 'afternoon', periodIsBlocked ? 'enable' : 'block')
                        pushToast(periodIsBlocked ? '✓' : '✕', `${periodName} ${periodIsBlocked ? 'habilitada' : 'bloqueada'}`)
                      }}
                    >
                      {periodIsBlocked ? 'Habilitar' : 'Bloquear'}
                    </Button>
                  )}
                </div>
                <div className="pn-agenda-grid">{slots.map(renderTile)}</div>
              </div>
            )
          })}

          {agendaView === 'timeline' && (
            <div className="pn-agenda-timeline">{AGENDA_SLOTS.map(renderTimelineRow)}</div>
          )}
        </Card>

        <Card title="Reservas del día" action={<Chip>{fmtDate(agendaDayKey, 'dm')}</Chip>}>
          <div className="pn-stack">
            {(dayBookingsToday.length > 4 || daySearch) && (
              <SearchField value={agendaQuery} onChange={setAgendaQuery} placeholder="Buscar en el día" />
            )}
            {dayBookingsFiltered.length === 0 ? (
              <EmptyState
                compact
                icon="calendar"
                title={daySearch ? 'Sin resultados' : 'Sin reservas este día'}
                action={daySearch ? { label: 'Limpiar búsqueda', icon: 'close', onClick: () => setAgendaQuery('') } : undefined}
              />
            ) : (
              <List>
                {dayBookingsFiltered.map((b) => (
                  <ListRow
                    key={bookingUid(b)}
                    lead={<Time value={b.time} />}
                    title={b.client}
                    titleWrap
                    subtitle={b.service}
                    trailing={<StatusBadge status={b.status} />}
                    chevron
                    onClick={() => setDetail(b)}
                  />
                ))}
              </List>
            )}
          </div>
        </Card>
      </div>

      {selecting && (
        <div className="pn-agenda-selectbar" role="toolbar" aria-label="Acciones sobre las horas elegidas">
          <span className="pn-agenda-selectbar-msg">Toca varias horas arriba para cambiarlas juntas.</span>
          <Button variant="secondary" size="sm" disabled={!selectedFree.length || applying} onClick={() => applySelection(selectedFree, 'free')}>
            Bloquear {selectedFree.length}
          </Button>
          <Button variant="secondary" size="sm" disabled={!selectedBlocked.length || applying} onClick={() => applySelection(selectedBlocked, 'blocked')}>
            Habilitar {selectedBlocked.length}
          </Button>
          <Button variant="primary" size="sm" disabled={applying} onClick={() => setSelectMode(false)}>Listo</Button>
        </div>
      )}

      <CalendarSheet
        open={Boolean(calOpen)}
        onClose={() => setCalOpen(false)}
        value={agendaDayKey}
        onChange={pickCalendarDay}
        max={AGENDA_MAX_KEY()}
        counts={bookingCounts}
        onMonthChange={ensurePastBookings ? (from, to) => ensurePastBookings(from, to) : undefined}
        title="Ir a fecha"
        subtitle="Cualquier día pasado; hacia adelante, hasta la ventana reservable."
      />
    </div>
  )
}
