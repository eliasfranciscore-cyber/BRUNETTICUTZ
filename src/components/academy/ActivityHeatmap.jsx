import React, { useEffect, useMemo, useRef } from 'react'
import { cx } from './MemberCard.jsx'
import '../../styles/academy/miembros.css'

/* ============================================================
   Mapa de actividad del último año (estilo GitHub/Skool): columnas =
   semanas, filas = días de lunes a domingo. `startDate` (YYYY-MM-DD, zona
   de Santiago) es el día de `counts[0]`; el servidor manda 365 enteros.
   Las fechas se calculan en UTC puro (fecha civil), así un cambio de hora
   en Chile no corre ni duplica un día.
   ============================================================ */

const DAY_MS = 86400000
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']
const ROW_LABELS = ['lun', '', 'mié', '', 'vie', '', '']

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''))
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function levelOf(n) {
  if (!n || n <= 0) return 0
  if (n === 1) return 1
  if (n <= 3) return 2
  if (n <= 6) return 3
  return 4
}

function dayLabel(ms) {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export default function ActivityHeatmap({ startDate, counts = [], className }) {
  const scroller = useRef(null)
  const model = useMemo(() => {
    const start = parseDay(startDate)
    const list = Array.isArray(counts) ? counts.map((n) => Math.max(0, Number(n) || 0)) : []
    if (start == null || !list.length) return null
    const offset = (new Date(start).getUTCDay() + 6) % 7 // lunes = 0
    const cells = []
    for (let i = 0; i < offset; i++) cells.push(null)
    list.forEach((n, i) => cells.push({ n, ms: start + i * DAY_MS }))
    while (cells.length % 7) cells.push(null)
    const weeks = cells.length / 7
    // Etiqueta de mes en la primera semana que contiene un día 1..7.
    const months = []
    let lastMonth = -1
    for (let w = 0; w < weeks; w++) {
      const first = cells.slice(w * 7, w * 7 + 7).find(Boolean)
      if (!first) { months.push(''); continue }
      const month = new Date(first.ms).getUTCMonth()
      const day = new Date(first.ms).getUTCDate()
      if (month !== lastMonth && (w === 0 ? day <= 7 : true)) {
        months.push(MONTHS[month])
        lastMonth = month
      } else {
        months.push('')
      }
    }
    const total = list.reduce((a, b) => a + b, 0)
    const activeDays = list.filter((n) => n > 0).length
    return { cells, weeks, months, total, activeDays }
  }, [startDate, counts])

  // Lo reciente queda a la derecha: en el celular se abre ya desplazado ahí.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [model])

  if (!model) {
    return <p className="aca-mi-muted">Sin datos de actividad.</p>
  }

  return (
    <div className={cx('aca-heat', className)}>
      <div className="aca-heat-scroll" ref={scroller}>
        <div className="aca-heat-inner" style={{ '--weeks': model.weeks }}>
          <div className="aca-heat-months" aria-hidden="true">
            <span />
            {model.months.map((m, i) => <span key={i}>{m}</span>)}
          </div>
          <div className="aca-heat-body">
            <div className="aca-heat-days" aria-hidden="true">
              {ROW_LABELS.map((l, i) => <span key={i}>{l}</span>)}
            </div>
            <div
              className="aca-heat-grid"
              role="img"
              aria-label={`${model.total} ${model.total === 1 ? 'actividad' : 'actividades'} en ${model.activeDays} ${model.activeDays === 1 ? 'día' : 'días'} del último año`}
            >
              {model.cells.map((c, i) => (c ? (
                <span
                  key={i}
                  className={`aca-heat-cell l${levelOf(c.n)}`}
                  title={`${c.n} ${c.n === 1 ? 'actividad' : 'actividades'} · ${dayLabel(c.ms)}`}
                />
              ) : <span key={i} className="aca-heat-cell is-pad" />))}
            </div>
          </div>
        </div>
      </div>
      <div className="aca-heat-foot">
        <span className="aca-heat-total">
          {model.total.toLocaleString('es-CL')} {model.total === 1 ? 'actividad' : 'actividades'} en el último año
        </span>
        <span className="aca-heat-legend" aria-hidden="true">
          Menos
          {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`aca-heat-cell l${l}`} />)}
          Más
        </span>
      </div>
    </div>
  )
}

export { ActivityHeatmap }
