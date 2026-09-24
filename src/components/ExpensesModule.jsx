import React, { useMemo, useState } from 'react'
import { CLP, CLPk, fmtDate } from '../data.js'
import { Icon } from './ui.jsx'
import { CountUp } from './DashKit.jsx'
import {
  ModuleHeader, Toolbar, Card, ProgressBar, PeriodNav, FilterChips, List, ListRow, EmptyState,
} from './panel/index.js'
import FinanceMovementSheet, { CATEGORY_META, EXPENSE_CATEGORIES, metaFor } from '../pages/panel/FinanceMovementSheet.jsx'
import '../styles/panel/finanzas.css'

/**
 * Gastos de Brunetti, mes por mes: total con barra de presupuesto y tres
 * mini KPI, chips por categoría y la lista de gastos (tocar una fila la
 * edita). El alta y la edición usan la MISMA hoja que Finanzas
 * (`FinanceMovementSheet`, en ../pages/panel/).
 *
 * Solo gastos: `expenses` puede traer también los ingresos manuales
 * (?kind=all comparte endpoint), y acá se vuelven a filtrar por `kind` por
 * si alguien pasa la lista completa. Los ingresos se ven en Finanzas →
 * "Movimientos manuales".
 *
 * El detalle por categoría (semáforo de presupuestos) se explica y se edita
 * una sola vez, en Ajustes → Presupuestos. Acá queda el total agregado (la
 * barra de arriba) y, fila por fila, el detalle real.
 *
 * `CATEGORY_META` / `EXPENSE_CATEGORIES` se REEXPORTAN desde acá (ConfigTab
 * las importa de este archivo); la fuente vive en FinanceMovementSheet.jsx
 * para que la dependencia vaya en un solo sentido.
 *
 * Props: { expenses, budgets, onCreate(draft), onUpdate(expense), onDelete(expense), ctx? }
 *   budgets  { [categoría]: número } — hoy en localStorage `ps_expense_budgets`
 *   ctx      opcional: el atajo "Presupuestos" del "···" (ctx.setTab('config')
 *            y, si existe, ctx.setConfigSection('presupuestos')) y el aviso
 *            (ctx.pushToast) cuando desde acá se registra un ingreso.
 */

export { CATEGORY_META, EXPENSE_CATEGORIES }
const metaOf = (cat) => metaFor('gasto', cat)
const isGasto = (e) => (e?.kind || 'gasto') === 'gasto'

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate() }
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function exportExpensesCSV(rows, ym) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const toCSV = (headers, list) => [headers.join(','), ...list.map((r) => r.map(esc).join(','))].join('\n')
  const csv = toCSV(['Fecha', 'Categoria', 'Detalle', 'Monto', 'Responsable'], rows.map((e) => [e.date, e.category, e.detail, e.amount, e.owner]))
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `brunetti-gastos-${ym}.csv`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ExpensesModule({ expenses = [], budgets = {}, onCreate = () => {}, onUpdate = () => {}, onDelete = () => {}, ctx }) {
  // null | { kind } (nuevo) | { kind, initial } (editar): la forma que espera la hoja.
  const [sheet, setSheet] = useState(null)
  const [ym, setYm] = useState(() => monthKey())
  const [categoryFilter, setCategoryFilter] = useState('all')

  const shiftMonth = (delta) => {
    const [y, m] = ym.split('-').map(Number)
    setYm(monthKey(new Date(y, m - 1 + delta, 1)))
    setCategoryFilter('all')
  }
  const monthLabel = (() => {
    const [y, m] = ym.split('-').map(Number)
    return cap(new Date(y, m - 1, 1).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' }))
  })()
  const monthName = (() => {
    const [y, m] = ym.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString('es-CL', { month: 'long' })
  })()
  const isCurrentMonth = ym === monthKey()

  const monthExpenses = useMemo(
    () => (Array.isArray(expenses) ? expenses : []).filter((e) => isGasto(e) && String(e.date || '').slice(0, 7) === ym),
    [expenses, ym],
  )
  const monthTotal = monthExpenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const byCategory = useMemo(() => {
    const m = {}
    for (const e of monthExpenses) m[e.category || 'Otros'] = (m[e.category || 'Otros'] || 0) + Number(e.amount || 0)
    return m
  }, [monthExpenses])

  // Días para el promedio diario: en el mes en curso, los transcurridos; en
  // uno pasado, el mes completo (ya cerrado).
  const daysElapsed = isCurrentMonth ? new Date().getDate() : daysInMonth(ym)
  const dailyAvg = daysElapsed ? Math.round(monthTotal / daysElapsed) : 0

  // Un filtro que quedó apuntando a una categoría sin gastos este mes vuelve a "Todas".
  const activeFilter = categoryFilter !== 'all' && !byCategory[categoryFilter] ? 'all' : categoryFilter
  const filteredMovements = useMemo(() => {
    const list = activeFilter === 'all' ? monthExpenses : monthExpenses.filter((e) => (e.category || 'Otros') === activeFilter)
    return [...list].sort((a, b) => (b.date || '').localeCompare(a.date || '') || Number(b.id || 0) - Number(a.id || 0))
  }, [monthExpenses, activeFilter])
  const topCat = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]
  const budgetTotal = EXPENSE_CATEGORIES.reduce((s, c) => s + (Number(budgets?.[c]) || 0), 0)
  const budgetPct = budgetTotal ? (monthTotal / budgetTotal) * 100 : 0
  const statusColor = (pct) => (pct >= 100 ? 'var(--pn-bad)' : pct >= 85 ? 'var(--pn-warn)' : 'var(--pn-ok)')

  // Las categorías conocidas primero (en su orden) y después cualquier otra
  // que venga guardada (p. ej. desde la app de iOS), para que ninguna quede
  // sin chip.
  const monthCategories = [
    ...EXPENSE_CATEGORIES.filter((c) => byCategory[c] > 0),
    ...Object.keys(byCategory).filter((c) => !EXPENSE_CATEGORIES.includes(c) && byCategory[c] > 0),
  ]
  const chipOptions = [
    { value: 'all', label: 'Todas', count: CLPk(monthTotal) },
    ...monthCategories.map((c) => ({ value: c, label: c, icon: metaOf(c).icon, count: CLPk(byCategory[c]) })),
  ]

  const openBudgets = () => {
    ctx?.setConfigSection?.('presupuestos')
    ctx?.setTab?.('config')
  }
  const menuActions = [
    { label: 'Exportar CSV', icon: 'download', onClick: () => exportExpensesCSV(filteredMovements, ym), disabled: !filteredMovements.length },
    ctx?.setTab ? { label: 'Presupuestos', icon: 'chart', onClick: openBudgets } : null,
  ]

  // La hoja devuelve el borrador: con id se edita, sin id se crea. Si desde
  // acá se cambia a "Ingreso", el movimiento sale de esta lista (Gastos es
  // solo de gastos) y se avisa dónde quedó.
  const saveMovement = async (draft) => {
    const result = draft?.id ? await onUpdate(draft) : await onCreate(draft)
    if (draft?.kind === 'ingreso') ctx?.pushToast?.('✓', 'Ingreso registrado: lo ves en Finanzas, en "Movimientos manuales"', 5000)
    return result
  }

  return (
    <div className="pn-page">
      <ModuleHeader
        title="Gastos"
        primary={{ label: 'Gasto', icon: 'plus', onClick: () => setSheet({ kind: 'gasto' }) }}
        actions={menuActions}
      />

      <Toolbar>
        <PeriodNav
          label={monthLabel}
          onPrev={() => shiftMonth(-1)}
          onNext={() => shiftMonth(1)}
          canNext={ym < monthKey()}
          prevLabel="Mes anterior"
          nextLabel="Mes siguiente"
        />
      </Toolbar>

      <Card>
        <div className="pn-fin-exp-total">
          <span className="pn-fin-exp-total-label">{isCurrentMonth ? 'Total del mes' : `Total de ${monthLabel.toLowerCase()}`}</span>
          <span className="pn-fin-exp-total-value"><CountUp value={monthTotal} format={CLP} /></span>
          {budgetTotal > 0 && (
            <div className="pn-fin-exp-budget">
              <ProgressBar value={monthTotal} max={budgetTotal} color={statusColor(budgetPct)} label="Presupuesto del mes" />
              <span className="pn-fin-exp-budget-note">{Math.round(budgetPct)}% de {CLP(budgetTotal)} presupuestado</span>
            </div>
          )}
        </div>
        <div className="pn-kpis pn-fin-exp-mini">
          <MiniKpi icon="chart" label="Por día" value={CLP(dailyAvg)} />
          <MiniKpi icon="receipt" label="Registrados" value={String(monthExpenses.length)} />
          <MiniKpi icon="trend" label="Principal" value={topCat ? CLP(topCat[1]) : '—'} sub={topCat ? topCat[0] : 'Sin gastos'} />
        </div>
      </Card>

      {chipOptions.length > 1 && (
        <FilterChips ariaLabel="Categoría" options={chipOptions} value={activeFilter} onChange={setCategoryFilter} />
      )}

      <Card
        title={`Gastos de ${monthName}`}
        subtitle={filteredMovements.length === monthExpenses.length ? `${monthExpenses.length} en el mes` : `${filteredMovements.length} de ${monthExpenses.length} · ${activeFilter}`}
        flush
      >
        {filteredMovements.length === 0 ? (
          <EmptyState
            compact
            icon="wallet"
            title={monthExpenses.length === 0 ? `Sin gastos registrados en ${monthLabel.toLowerCase()}` : 'Sin gastos que coincidan'}
            action={monthExpenses.length === 0 ? { label: 'Registrar un gasto', icon: 'plus', onClick: () => setSheet({ kind: 'gasto' }) } : undefined}
          />
        ) : (
          <List>
            {filteredMovements.map((e) => {
              const m = metaOf(e.category)
              return (
                <ListRow
                  key={e.id}
                  lead={<span className="pn-fin-cat-ic" style={{ '--c': m.color }}><Icon name={m.icon} size={16} /></span>}
                  title={e.detail || e.category}
                  titleWrap
                  // Sin el responsable: con un solo barbero es el mismo en todas
                  // las filas (queda en el CSV, columna "Responsable").
                  subtitle={`${e.category || 'Otros'} · ${fmtDate(e.date, 'dm')}`}
                  value={CLP(e.amount)}
                  chevron
                  ariaLabel={`Editar gasto: ${e.detail || e.category}, ${CLP(e.amount)}`}
                  onClick={() => setSheet({ kind: 'gasto', initial: e })}
                />
              )
            })}
          </List>
        )}
      </Card>

      <FinanceMovementSheet
        open={Boolean(sheet)}
        movement={sheet}
        barbers={[]}
        onClose={() => setSheet(null)}
        onSave={saveMovement}
        onDelete={onDelete}
      />
    </div>
  )
}

/* Mini KPI de la tarjeta de arriba: más chico que <Kpi>, tres en fila fija
   (el <Kpi> normal trae un tamaño pensado para 2-4 por pantalla, no tres
   apretados dentro de una tarjeta). */
function MiniKpi({ icon, label, value, sub }) {
  return (
    <div className="pn-fin-mini-kpi">
      <span className="pn-fin-mini-kpi-label"><Icon name={icon} size={12} /><span>{label}</span></span>
      <span className="pn-fin-mini-kpi-value">{value}</span>
      {sub && <span className="pn-fin-mini-kpi-sub">{sub}</span>}
    </div>
  )
}
