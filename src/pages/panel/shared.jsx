import React from 'react'
import { CLPk } from '../../data.js'
import { Icon } from '../../components/ui.jsx'

/* Ayudantes que comparten Dashboard.jsx y las pestañas del panel
   (src/pages/panel/*Tab.jsx), extraídos tal cual de Dashboard.jsx. */

export const AGENDA_SLOTS = ["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00"]
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 min sin actividad → cerrar sesión
export const DAY_LABELS = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"]
export const DOW_LONG = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
export const MONTH_LONG = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

// Duración de un servicio expresada en bloques de 1h (lo que realmente
// bloquea en la agenda — ver api/_slots.js), redondeando hacia arriba: un
// servicio de 75 min sigue ocupando 2 horarios seguidos.
export function minToBlocks(min) {
  return Math.max(1, Math.ceil(Number(min || 60) / 60))
}
export function blocksToMin(blocks) {
  return Math.max(1, Number(blocks) || 1) * 60
}

export function getSvcIcon(svc) {
  const n = ((svc.name || '') + ' ' + (svc.cat || '')).toLowerCase()
  if (n.includes('asesor') || n.includes('visag') || n.includes('imagen')) return 'user'
  if (n.includes('barba') || n.includes('beard')) return 'cut'
  if (n.includes('quim') || n.includes('color') || n.includes('platin')) return 'spark'
  if (n.includes('fade') || n.includes('degra')) return 'trend'
  return 'scissors'
}

export function isoDate(date) {
  // Componentes locales, no UTC: en Chile (UTC-3/-4) toISOString() hace
  // rollover al día siguiente durante la noche, lo que desalineaba "hoy" y
  // la semana activa de la agenda para quien la usa después del atardecer.
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function buildWeek(offset = 0) {
  const now = new Date()
  const monday = new Date(now)
  const day = monday.getDay() || 7
  monday.setDate(now.getDate() - day + 1 + offset * 7)
  // Atiende los 7 días de la semana, incluido domingo.
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    return { key: isoDate(date), label: `${DAY_LABELS[date.getDay()]} ${date.getDate()}` }
  })
}

// Ventana reservable del cliente (espejo de src/pages/Booking.jsx y de
// api/bookings.js, que rechaza con 422 fuera de rango).
export const MAX_LEAD_DAYS = 10

/* Último día que la agenda deja administrar hacia adelante. Es el mayor entre
   el domingo de la semana siguiente y hoy+MAX_LEAD_DAYS: el tope viejo era solo
   lo primero, y un viernes/sábado/domingo eso cae a +9/+8/+7, o sea menos que
   la ventana del cliente — el barbero no podía abrir ni bloquear días que sí
   eran reservables. El max también conserva lo de antes (preparar la semana
   siguiente completa, hasta +13 un lunes). */
export function AGENDA_MAX_KEY() {
  const endOfNextWeek = buildWeek(1)[6].key
  const lead = new Date()
  lead.setDate(lead.getDate() + MAX_LEAD_DAYS)
  const leadKey = isoDate(lead)
  return endOfNextWeek > leadKey ? endOfNextWeek : leadKey
}

export function localBlockKey(barberId, date, slot) {
  return `${barberId}|${date}|${slot}`
}

export function readLocalBlocks() {
  try { return JSON.parse(localStorage.getItem("ps_availability_blocks") || "{}") } catch { return {} }
}

export function writeLocalBlocks(blocks) {
  localStorage.setItem("ps_availability_blocks", JSON.stringify(blocks))
}

export function BarChart({ data, fmt }) {
  const max = Math.max(...data.map((d) => d.v))
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: ".7rem", height: 160, padding: "0 .2rem" }}>
      {data.map((d, i) => (
        <div key={d.d} style={{ flex: 1, display: "grid", justifyItems: "center", gap: ".5rem", height: "100%", gridTemplateRows: "1fr auto auto" }}>
          <div style={{ width: "100%", display: "flex", alignItems: "flex-end", height: "100%" }}>
            <div title={fmt(d.v)} style={{ width: "100%", height: `${(d.v / max) * 100}%`, borderRadius: "6px 6px 0 0", background: i === data.length - 1 ? "var(--gold-grad)" : "linear-gradient(180deg,#3a3935,#222220)" }} />
          </div>
          <span style={{ fontSize: ".66rem", color: "var(--muted-2)" }}>{CLPk(d.v)}</span>
          <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>{d.d}</span>
        </div>
      ))}
    </div>
  )
}

export function Panel({ title, action, children, style }) {
  return (
    <div className="card dashboard-panel" style={{ padding: "1.3rem", ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
        <h3 className="font-display" style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

// Popover de calendario propio de Agenda: sólo dentro de la ventana
// administrable (semana actual + siguiente) los días son elegibles; el resto
// se muestran deshabilitados para no sugerir una selección que igual va a
// rebotar con el toast de "fuera de rango".
export function AgendaDatePicker({ month, year, selectedKey, onPrevMonth, onNextMonth, onPick, maxKey }) {
  const todayKey = isoDate(new Date())
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7 // semana empieza lunes
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  return (
    <div className="agenda-cal" role="dialog" aria-label="Elegir fecha">
      <div className="agenda-cal-head">
        <button type="button" onClick={onPrevMonth} aria-label="Mes anterior"><Icon name="arrowLeft" size={13} /></button>
        <span>{MONTH_LONG[month]} {year}</span>
        <button type="button" onClick={onNextMonth} aria-label="Mes siguiente"><Icon name="arrowRight" size={13} /></button>
      </div>
      <div className="agenda-cal-grid">
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <span key={i} className="agenda-cal-dow">{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />
          const key = isoDate(new Date(year, month, d))
          const isSel = key === selectedKey
          const isToday = key === todayKey
          // El pasado siempre se puede revisar; solo se bloquea el futuro más
          // allá de la semana siguiente (fuera del rango reservable).
          const selectable = !maxKey || key <= maxKey
          return (
            <button
              key={key}
              type="button"
              className={`agenda-cal-day ${isSel ? "is-sel" : ""} ${isToday && !isSel ? "is-today" : ""}`}
              disabled={!selectable}
              onClick={() => onPick(key)}
            >
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ============================================================
   Campañas por Wallet — audiencias y plantillas
   ------------------------------------------------------------
   Los ids TIENEN que calzar con CAMPAIGN_AUDIENCES en api/_loyalty.js del
   proyecto PimpStudio: es allá donde se traducen a un SELECT (el programa de
   fidelidad es uno solo, ver CLAUDE.md). Si acá aparece un id que allá no
   existe, el backend lo degrada silenciosamente a "todos" — que es
   exactamente el error caro: mandarle a los 200 lo que era para 12.

   Brunetti y Pimp Studio comparten el pase, pero no el ticket: los servicios
   de Brunetti valen bastante más, así que las audiencias `brunetti` / `pimp`
   existen para poder mandar promos con precios distintos a cada grupo sin
   que se crucen. Quien va a los dos locales cuenta como cliente de Brunetti.
   ============================================================ */
export const AUDIENCES = [
  { id: "all",            icon: "users",     label: "Todos",            desc: "Todos los que tienen la tarjeta agregada." },
  { id: "brunetti",       icon: "scissors",  label: "Solo Brunetti",    desc: "Clientes que se atienden acá. Ticket más alto: promos propias." },
  { id: "pimp",           icon: "star",      label: "Solo Pimp Studio", desc: "Clientes del otro local. Quien va a los dos cuenta como Brunetti." },
  { id: "free_cut_ready", icon: "gift",      label: "Corte gratis",     desc: "Con 10 estrellas: el próximo corte les sale gratis." },
  { id: "almost_free",    icon: "target",    label: "A punto",          desc: "Entre 7 y 9 estrellas. Les falta poco, es el mejor empujón." },
  { id: "five_plus",      icon: "percent",   label: "5+ estrellas",     desc: "Ya tienen 30% en productos." },
  { id: "starters",       icon: "user",      label: "Recién parten",    desc: "0 o 1 estrella: todavía hay que engancharlos." },
  { id: "active",         icon: "trend",     label: "Vinieron hace poco", desc: "Con una hora en los últimos 30 días." },
  { id: "inactive",       icon: "clock",     label: "Sin venir 30+ días", desc: "El público de una promo de reactivación." },
]
export const AUDIENCE_BY_ID = Object.fromEntries(AUDIENCES.map((a) => [a.id, a]))
export const AUDIENCE_LABEL = Object.fromEntries(AUDIENCES.map((a) => [a.id, a.label]))

/* Arranques de mensaje, no textos definitivos: rellenan el textarea para que
   el barbero edite en vez de mirar un campo en blanco. */
export const CAMPAIGN_TEMPLATES = [
  "Esta semana: 20% en perfilado de barba de lunes a miércoles.",
  "Te queda poco para el corte gratis. Te esperamos.",
  "Liberamos horas para el fin de semana — reserva en brunetticutz.cl",
  "Tanto tiempo. Vuelve esta semana y te dejamos el corte listo.",
]

// Módulos que la preferencia "Módulos visibles" (Config → Navegación) no
// puede ocultar: Resumen y Config siempre están disponibles.
export const ALWAYS_NAV = ["resumen", "config"]
