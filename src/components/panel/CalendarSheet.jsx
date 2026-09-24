import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../ui.jsx'
import { Sheet } from './Sheet.jsx'
import { Button } from './kit.jsx'

/* Selector de fecha único del panel (Agenda, Reservas, Caja…). Reemplaza al
   popover sin fondo de Agenda y al modal de 4 semanas de Reservas, que eran
   dos paradigmas distintos para lo mismo.

   value / min / max: "YYYY-MM-DD" (min/max opcionales).
   counts: { "YYYY-MM-DD": n } → puntito con el número de reservas del día.
   onMonthChange(firstKey, lastKey): se llama al mostrar un mes; si devuelve
   una promesa se muestra "Cargando…" mientras se resuelve (así los contadores
   de meses pasados no salen en cero por no estar pedidos). */

const pad = (n) => String(n).padStart(2, '0')
const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const todayKey = () => {
  const n = new Date()
  return keyOf(n.getFullYear(), n.getMonth(), n.getDate())
}
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DOW = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do']

function parse(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null
}

export function CalendarSheet({ open, onClose, value, onChange, min, max, counts, onMonthChange, title = 'Elegir fecha', subtitle }) {
  const initial = parse(value) || parse(todayKey())
  const [view, setView] = useState({ y: initial.y, m: initial.m })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    const p = parse(value) || parse(todayKey())
    setView({ y: p.y, m: p.m })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !onMonthChange) return undefined
    const last = new Date(view.y, view.m + 1, 0).getDate()
    const result = onMonthChange(keyOf(view.y, view.m, 1), keyOf(view.y, view.m, last))
    if (!result || typeof result.then !== 'function') return undefined
    let alive = true
    setLoading(true)
    result.finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open, view.y, view.m]) // eslint-disable-line react-hooks/exhaustive-deps

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1)
    const offset = (first.getDay() + 6) % 7 // la semana parte el lunes
    const days = new Date(view.y, view.m + 1, 0).getDate()
    return [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  }, [view])

  const today = todayKey()
  const move = (delta) => setView((v) => {
    const d = new Date(v.y, v.m + delta, 1)
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const firstOfView = keyOf(view.y, view.m, 1)
  const lastOfView = keyOf(view.y, view.m, new Date(view.y, view.m + 1, 0).getDate())
  const canPrev = !min || firstOfView > min
  const canNext = !max || lastOfView < max
  const pick = (key) => { onChange?.(key); onClose?.() }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      icon="calendar"
      size="sm"
      footer={(
        <>
          <Button variant="plain" onClick={onClose} className="pn-foot-start">Cerrar</Button>
          <Button variant="secondary" icon="clock" onClick={() => pick(today)} disabled={(min && today < min) || (max && today > max)}>Hoy</Button>
        </>
      )}
    >
      <div className="pn-cal">
        <div className="pn-cal-head">
          <button type="button" className="pn-period-arrow" onClick={() => move(-1)} disabled={!canPrev} aria-label="Mes anterior"><Icon name="chevronLeft" size={16} /></button>
          <span className="pn-cal-month">{MONTHS[view.m]} {view.y}{loading && <em> · cargando…</em>}</span>
          <button type="button" className="pn-period-arrow" onClick={() => move(1)} disabled={!canNext} aria-label="Mes siguiente"><Icon name="chevronRight" size={16} /></button>
        </div>
        <div className="pn-cal-grid" role="grid">
          {DOW.map((d) => <span key={d} className="pn-cal-dow">{d}</span>)}
          {cells.map((d, i) => {
            if (!d) return <span key={`e${i}`} />
            const key = keyOf(view.y, view.m, d)
            const disabled = (min && key < min) || (max && key > max)
            const n = counts?.[key] || 0
            const cls = ['pn-cal-day', key === value && 'is-sel', key === today && 'is-today', n > 0 && 'has-dot'].filter(Boolean).join(' ')
            return (
              <button key={key} type="button" className={cls} disabled={disabled} onClick={() => pick(key)} aria-label={`${d} de ${MONTHS[view.m]}${n ? `, ${n} reservas` : ''}`}>
                <span>{d}</span>
                {n > 0 && <i>{n}</i>}
              </button>
            )
          })}
        </div>
      </div>
    </Sheet>
  )
}
