import React from 'react'
import { Icon } from '../../components/ui.jsx'
import { KpiTile, AnimatedRing } from '../../components/DashKit.jsx'
import { barberById, cleanPhone } from '../../data.js'
import { AGENDA_MAX_KEY, AGENDA_SLOTS, AgendaDatePicker, DOW_LONG, MONTH_LONG, Panel, isoDate } from './shared.jsx'

/* Pestaña «agenda» del panel interno, extraída tal cual de Dashboard.jsx
   para que cada módulo viva en su propio archivo. Recibe en `ctx` el estado
   y las acciones de Dashboard que usa (ver el objeto `dash` que arma
   Dashboard.jsx).
   Dashboard la monta solo con `agendaDayKey` ya fijado, igual que antes. */
export default function AgendaTab({ ctx }) {
  const {
    agendaBarber,
    agendaBusy,
    agendaDayKey,
    agendaError,
    agendaQuery,
    agendaView,
    availability,
    barbers,
    bookingForSlot,
    bulkAgenda,
    calMonth,
    calNextMonth,
    calOpen,
    calPrevMonth,
    calRef,
    calYear,
    clients,
    dragRef,
    goToWeek,
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
    toggleSlot,
    visibleBookings,
    weekDays,
    weekOffset,
    weekStats,
  } = ctx
  return (
          <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
            {agendaError && (
              <div className="card" style={{ padding: ".8rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".8rem", border: "1px solid rgba(217,154,143,.4)", background: "rgba(217,154,143,.08)" }}>
                <span style={{ fontSize: ".82rem", color: "#d99a8f" }}>{agendaError}</span>
                <button type="button" className="btn btn-dark btn-sm" onClick={() => setAgendaError("")}>Cerrar</button>
              </div>
            )}

            {/* Cabecera propia del módulo: el topbar global ya trae título/tema/
                campana/avatar/buscador general — acá solo va el kicker y un
                buscador LOCAL de las reservas del día visible. */}
            <div className="agenda-topline">
              <span className="agenda-kicker">PANEL INTERNO</span>
              <div className="agenda-search">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  className="agenda-search-input"
                  placeholder="Buscar reserva del día…"
                  value={agendaQuery}
                  onChange={(e) => setAgendaQuery(e.target.value)}
                />
                {agendaQuery && (
                  <button type="button" className="agenda-search-clear" onClick={() => setAgendaQuery("")} aria-label="Limpiar búsqueda">
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* HERO: ocupación del día + KPIs de la semana + próxima cita. */}
            {(() => {
              const daySlots = availability[agendaDayKey] || []
              const bookedDay = daySlots.filter((s) => s.state === "booked").length
              const freeDay = daySlots.filter((s) => s.state === "free").length
              const dayOcc = (bookedDay + freeDay) ? Math.round((bookedDay / (bookedDay + freeDay)) * 100) : 0
              const [dy, dm, dd] = agendaDayKey.split("-").map(Number)
              const dateObj = new Date(dy, dm - 1, dd)
              const longDate = `${DOW_LONG[dateObj.getDay()]} ${dd} de ${MONTH_LONG[dm - 1]}`
              const weekSuffix = weekOffset === 0 ? "esta semana"
                : weekOffset === 1 ? "próx. semana"
                : weekOffset === -1 ? "sem. pasada"
                : weekOffset < 0 ? `hace ${-weekOffset} sem.`
                : `en ${weekOffset} sem.`
              const dayBookingsToday = visibleBookings
                .filter((b) => b.date === agendaDayKey && b.status !== "cancelada")
                .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
              const nextBooking = dayBookingsToday[0]
              // Nuevos vs recurrentes del día: cruza por teléfono con el
              // registro de clientes (visits > 1 = recurrente).
              let newCount = 0, recurringCount = 0
              dayBookingsToday.forEach((b) => {
                const c = clients.find((item) => cleanPhone(item.phone) === cleanPhone(b.phone))
                if (c && Number(c.visits || 0) > 1) recurringCount += 1
                else newCount += 1
              })
              // Deltas vs. la semana anterior: si no hay datos previos fiables
              // (API caída), no se inventan cifras — se ocultan.
              const weekDelta = prevWeekStats ? {
                booked: weekStats.booked - prevWeekStats.booked,
                free: weekStats.free - prevWeekStats.free,
                blocked: weekStats.blocked - prevWeekStats.blocked,
              } : null
              return (
                <div className="dk-hero">
                  <div className="dk-hero-grid cols-6 dk-stagger">
                    <div className="dk-hero-lead">
                      <AnimatedRing pct={dayOcc} size={84} label="del día" />
                      <div>
                        <span className="agenda-kicker agenda-kicker-hero">AGENDA DE BRUNETTI</span>
                        <h2 className="dk-hero-title">{longDate}</h2>
                        <span className="dk-hero-sub">{bookedDay}/{bookedDay + freeDay} horas reservadas hoy</span>
                        <span className="agenda-next-chip">
                          <Icon name="clock" size={11} /> Próximo: {nextBooking ? `${nextBooking.client} · ${nextBooking.time}` : "sin reservas"}
                        </span>
                      </div>
                    </div>
                    <KpiTile icon="calendar" label={`Reservados · ${weekSuffix}`} value={weekStats.booked} delta={weekDelta?.booked} />
                    <KpiTile icon="clock" label={`Disponibles · ${weekSuffix}`} value={weekStats.free} suffix="h" color="var(--green)" delta={weekDelta?.free} />
                    <KpiTile icon="trend" label={`Bloqueados · ${weekSuffix}`} value={weekStats.blocked} color="var(--red)" delta={weekDelta?.blocked} />
                    <KpiTile icon="user" label="Nuevos vs recurrentes" value={newCount} format={(n) => `${n}/${recurringCount}`} sub={`${recurringCount} recurrentes hoy`} />
                    <button className="btn btn-gold" style={{ display: "inline-flex", alignItems: "center", gap: ".5rem", alignSelf: "center" }} onClick={() => setNewBookingOpen(true)}>
                      <Icon name="plus" size={16} /> Nueva reserva
                    </button>
                  </div>
                </div>
              )
            })()}
            <div className="agenda-controls">
              {/* Selector de barbero retirado: la agenda es exclusiva de Brunetti.
                  (Se conserva agendaBarber fijado a Bruno para la API de disponibilidad.) */}
              {/* La agenda se administra semana por semana. Hacia adelante el tope
                  es AGENDA_MAX_KEY, que siempre alcanza la ventana reservable del
                  cliente (MAX_LEAD_DAYS); hacia atrás no hay tope. */}
              <div className="agenda-bulk-actions">
                {/* Flechas sin tope hacia atrás: las semanas pasadas se pueden
                    revisar (reservas no atendidas, cancelaciones tardías). */}
                <button type="button" className="btn btn-dark btn-sm" onClick={() => goToWeek(weekOffset - 1)} aria-label="Semana anterior">
                  <Icon name="arrowLeft" size={14} />
                </button>
                <button type="button" className={`btn btn-sm ${weekOffset === 0 ? "btn-gold" : "btn-dark"}`} onClick={() => goToWeek(0)}>
                  Esta semana
                </button>
                <button type="button" className="btn btn-dark btn-sm" onClick={() => goToWeek(weekOffset + 1)} aria-label="Semana siguiente">
                  <Icon name="arrowRight" size={14} />
                </button>
                {/* El botón de calendario vive acá (no en la franja de días): a 320px
                    de ancho, sacarlo de esa fila es lo que hace viable mostrar los
                    7 días en una grilla sin scroll horizontal. */}
                <div className="agenda-cal-wrap" ref={calRef}>
                  <button type="button" className="btn btn-dark btn-sm agenda-cal-btn" onClick={() => setCalOpen((v) => !v)} aria-label="Elegir fecha">
                    <Icon name="calendar" size={14} />
                  </button>
                  {calOpen && (
                    <AgendaDatePicker
                      month={calMonth}
                      year={calYear}
                      selectedKey={agendaDayKey}
                      onPrevMonth={calPrevMonth}
                      onNextMonth={calNextMonth}
                      onPick={pickCalendarDay}
                      maxKey={AGENDA_MAX_KEY()}
                    />
                  )}
                </div>
              </div>
              <div className="daypick daypick-sticky" role="group" aria-label="Día de la semana">
                {weekDays.map((d) => {
                  const isActive = d.key === agendaDayKey
                  const isToday = d.key === isoDate(new Date())
                  const hasBookings = (availability[d.key] || []).some((s) => s.state === "booked")
                  const [dow, num] = d.label.split(" ")
                  return (
                    <button
                      key={d.key}
                      type="button"
                      className={`daypick-btn ${isActive ? "is-active" : ""} ${isToday ? "is-today" : ""}`}
                      aria-pressed={isActive}
                      onClick={() => setAgendaDayKey(d.key)}
                    >
                      <span className="dp-dow">{isToday ? "Hoy" : dow}</span>
                      <span className="dp-num">{num}</span>
                      <span className="dp-ind">{hasBookings && <span className="dp-dot" />}</span>
                    </button>
                  )
                })}
              </div>
              {/* Antes eran 6 botones sueltos (mañana/tarde/día/semana × bloquear/
                  habilitar) todos visibles a la vez. Mañana/tarde ahora son un
                  toggle contextual junto al título de cada periodo (más abajo);
                  acá solo quedan día completo y semana completa, y cada uno es
                  un único botón cuya etiqueta cambia según el estado actual. */}
              <div className="agenda-bulk-actions agenda-bulk-row">
                {(() => {
                  const dayFree = (availability[agendaDayKey] || []).filter((s) => s.state === "free").length
                  const dayIsBlocked = dayFree === 0
                  const weekIsBlocked = weekStats.free === 0
                  return (
                    <>
                      <button type="button" className={`btn btn-sm ${dayIsBlocked ? "btn-gold" : "btn-dark"}`} disabled={!!agendaBusy} onClick={() => { bulkAgenda("day", dayIsBlocked ? "enable" : "block"); pushToast(dayIsBlocked ? "✓" : "✕", dayIsBlocked ? "Día habilitado" : "Día bloqueado") }}>
                        <Icon name={dayIsBlocked ? "check" : "close"} size={13} /> {dayIsBlocked ? "Habilitar" : "Bloquear"} día completo
                      </button>
                      <button type="button" className={`btn btn-sm ${weekIsBlocked ? "btn-gold" : "btn-dark"}`} disabled={!!agendaBusy} onClick={() => { bulkAgenda("week", weekIsBlocked ? "enable" : "block"); pushToast(weekIsBlocked ? "✓" : "✕", weekIsBlocked ? "Semana habilitada" : "Semana bloqueada") }}>
                        <Icon name={weekIsBlocked ? "check" : "close"} size={13} /> {weekIsBlocked ? "Habilitar" : "Bloquear"} semana completa
                      </button>
                    </>
                  )
                })()}
                <span className="agenda-drag-hint">Arrastra sobre las horas para bloquear un rango ⇄</span>
              </div>
            </div>
            <div className="agenda-layout">
              <Panel
                title={`${(barbers.find((item) => item.id === agendaBarber) || barberById(agendaBarber))?.name || "Barbero"}`}
                action={(
                  <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span className="chip chip-gold">{(availability[agendaDayKey] || []).filter((s) => s.state === "free").length} libres</span>
                    <div className="agenda-view-toggle" role="group" aria-label="Vista de la agenda">
                      <button type="button" className={`agenda-view-tab ${agendaView === "grid" ? "is-on" : ""}`} onClick={() => setAgendaView("grid")}>▦ Bloques</button>
                      <button type="button" className={`agenda-view-tab ${agendaView === "timeline" ? "is-on" : ""}`} onClick={() => setAgendaView("timeline")}>☰ Línea</button>
                    </div>
                  </div>
                )}
              >
                <div className="agenda-legend">
                  <span><i className="free" /> Atiende</span>
                  <span><i className="blocked" /> Bloqueado</span>
                  <span><i className="booked" /> Reservado</span>
                </div>
                {agendaView === "grid" && ["MAÑANA", "TARDE"].map((label) => {
                  const slots = AGENDA_SLOTS.filter((t) => label === "MAÑANA" ? Number(t.slice(0, 2)) < 12 : Number(t.slice(0, 2)) >= 12)
                  const periodStates = slots.map((t) => (availability[agendaDayKey] || []).find((item) => item.slot === t))
                  const periodIsBlocked = periodStates.every((s) => s?.state !== "free")
                  return (
                    <div key={label} className="agenda-period">
                      <div className="agenda-period-head">
                        <p className="agenda-period-title">{label}</p>
                        <button
                          type="button"
                          className={`agenda-period-toggle ${periodIsBlocked ? "is-blocked" : ""}`}
                          disabled={!!agendaBusy}
                          onClick={() => { bulkAgenda(label === "MAÑANA" ? "morning" : "afternoon", periodIsBlocked ? "enable" : "block"); pushToast(periodIsBlocked ? "✓" : "✕", `${label === "MAÑANA" ? "Mañana" : "Tarde"} ${periodIsBlocked ? "habilitada" : "bloqueada"}`) }}
                        >
                          {periodIsBlocked ? "Habilitar" : "Bloquear"}
                        </button>
                      </div>
                      <div className="agenda-tile-grid">
                        {slots.map((t) => {
                          const slotInfo = (availability[agendaDayKey] || []).find((item) => item.slot === t)
                          const state = slotInfo?.state || (slotInfo?.available === false ? "blocked" : "free")
                          const busy = agendaBusy === `${agendaDayKey}-${t}`
                          const bk = state === "booked" ? bookingForSlot(agendaDayKey, t) : null
                          const tag = state === "booked" ? "Reservado" : state === "blocked" ? "Bloqueado" : "Libre"
                          const applyToggle = () => {
                            toggleSlot(agendaDayKey, t, state)
                            pushToast(state === "free" ? "✕" : "✓", state === "free" ? `${t} bloqueado` : `${t} habilitado`)
                          }
                          return (
                            <button
                              key={t}
                              className={`agenda-tile ${state}`}
                              disabled={busy}
                              onMouseDown={() => {
                                if (state === "booked") return
                                dragRef.current = { active: true, mode: state === "free" ? "block" : "enable" }
                                applyToggle()
                              }}
                              onTouchStart={() => {
                                if (state === "booked") return
                                dragRef.current = { active: true, mode: state === "free" ? "block" : "enable" }
                              }}
                              onMouseEnter={() => {
                                if (!dragRef.current.active || state === "booked") return
                                const { mode } = dragRef.current
                                if ((mode === "block" && state === "free") || (mode === "enable" && state === "blocked")) applyToggle()
                              }}
                              onClick={() => { if (state === "booked" && bk) setDetail(bk) }}
                              title={state === "booked" ? (bk ? `${bk.client} · ${bk.service}` : "Reservado") : state === "blocked" ? "Tocar para atender" : "Tocar para bloquear"}
                            >
                              <span className="agenda-tile-h">{busy ? "…" : t}</span>
                              <span className="agenda-tile-tag">{tag}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {agendaView === "timeline" && (
                  <div className="agenda-timeline">
                    {AGENDA_SLOTS.map((t) => {
                      const slotInfo = (availability[agendaDayKey] || []).find((item) => item.slot === t)
                      const state = slotInfo?.state || (slotInfo?.available === false ? "blocked" : "free")
                      const bk = state === "booked" ? bookingForSlot(agendaDayKey, t) : null
                      return (
                        <div
                          key={t}
                          className={`agenda-tl-row ${state}`}
                          onClick={() => { if (state === "booked" && bk) setDetail(bk) }}
                          role={state === "booked" ? "button" : undefined}
                        >
                          <span className="agenda-tl-time">{t}</span>
                          <span className={`agenda-tl-rail ${state}`} />
                          <div className="agenda-tl-card">
                            {state === "booked" ? (
                              <>
                                <div className="agenda-tl-info">
                                  <strong>{bk?.client || "Reservado"}</strong>
                                  <span>{bk?.service}</span>
                                </div>
                                <span className={`agenda-tl-badge ${bk?.status === "confirmada" ? "is-gold" : ""}`}>{bk?.status === "confirmada" ? "confirmada" : "pendiente"}</span>
                              </>
                            ) : state === "blocked" ? (
                              <span className="agenda-tl-empty">Bloqueado</span>
                            ) : (
                              <>
                                <span className="agenda-tl-empty">Disponible</span>
                                <span className="agenda-tl-badge">Libre</span>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Panel>
              <Panel title="Reservas del día" action={<span className="chip">{(weekDays.find((d) => d.key === agendaDayKey)?.label) || ""}</span>}>
                <div className="agenda-day-panel">
                  {visibleBookings
                    .filter((b) => b.date === agendaDayKey && b.status !== "cancelada")
                    .filter((b) => {
                      const q = agendaQuery.trim().toLowerCase()
                      if (!q) return true
                      return `${b.client || ""} ${b.service || ""}`.toLowerCase().includes(q)
                    })
                    .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
                    .map((b) => (
                      <button key={b.id || `${b.date}-${b.time}-${b.client}`} type="button" className="agenda-day-booking" onClick={() => setDetail(b)}>
                        <span className="adb-time">{b.time}</span>
                        <span className="adb-info">
                          <strong>{b.client}</strong>
                          <span>{b.service}</span>
                        </span>
                        <span className={`chip ${b.status === "confirmada" ? "chip-gold" : ""}`} style={{ fontSize: ".64rem" }}>{b.status}</span>
                      </button>
                    ))}
                  {!visibleBookings.some((b) => b.date === agendaDayKey && b.status !== "cancelada") && (
                    <div className="empty-state">Sin reservas este día.</div>
                  )}
                </div>
              </Panel>
            </div>
          </div>
  )
}
