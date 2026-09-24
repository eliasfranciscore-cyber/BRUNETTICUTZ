import React, { useEffect, useRef, useState } from 'react'
import {
  Sheet, ConfirmDialog, ActionMenu, Segmented, Field, ChoiceGrid, Button, InlineAlert,
} from '../../components/panel/index.js'
import { CLP } from '../../data.js'
import { FEATURES } from '../../features.js'
import { isoDate } from './shared.jsx'
import '../../styles/panel/finanzas.css'

/* ============================================================
   La hoja de movimiento manual: un gasto o un ingreso.
   ------------------------------------------------------------
   Una sola hoja para Finanzas (botón "Movimiento" y la tarjeta
   "Movimientos manuales") y para Gastos (botón "Gasto" y tocar una fila):
   mismo formulario, mismo resultado; solo cambia el tipo con que abre.

   Props (congeladas por Dashboard.jsx):
     open        boolean
     movement    null | { kind: 'gasto' | 'ingreso', initial?: fila de /api/expenses }
                 con `initial` es edición (y el "···" ofrece eliminar)
     onClose()
     onSave(draft)      draft = { id?, kind, date, category, detail, amount }
                        (más lo que ya traía la fila al editar, p. ej. owner).
                        Dashboard decide: con id → PATCH, sin id → POST, y el
                        responsable por defecto lo pone él ("Brunetti").
                        Si devuelve { ok:false, error } o lanza, la hoja queda
                        abierta con el error a la vista.
     onDelete(expense)
     barbers     se acepta por compatibilidad y se ignora: en BrunettiCutz
                 hay un solo barbero, así que no hay a quién asignarle el
                 movimiento (Dashboard pasa []).

   El Segmented Gasto | Ingreso aparece solo con FEATURES.manualIncome: sin
   `expenses.kind` en el servidor, un "ingreso" terminaría guardado (y
   restado) como gasto.

   CATEGORY_META / EXPENSE_CATEGORIES viven acá y ExpensesModule.jsx los
   reexporta (ConfigTab los importa desde allá): la dependencia va en un solo
   sentido (Gastos → esta hoja) y no hay ciclo entre los dos archivos.
   ============================================================ */

// Categorías de GASTO: ícono + color (la hoja, la lista de Gastos y
// Ajustes → Presupuestos).
export const CATEGORY_META = {
  Insumos:      { icon: 'scissors', color: '#c9a14e' },
  Equipamiento: { icon: 'grid',     color: '#7ea8ff' },
  Arriendo:     { icon: 'pin',      color: '#b98cff' },
  Marketing:    { icon: 'spark',    color: '#f2a65a' },
  Personal:     { icon: 'users',    color: '#6fbf86' },
  Servicios:    { icon: 'wallet',   color: '#5bc0be' },
  Otros:        { icon: 'gift',     color: '#9aa0a6' },
}
export const EXPENSE_CATEGORIES = Object.keys(CATEGORY_META)

// Categorías de INGRESO manual, aparte de las de gasto: una propina no cabe
// en una categoría pensada para egresos.
export const INCOME_CATEGORY_META = {
  Propina:              { icon: 'gift',     color: '#e2b45c' },
  'Venta de producto':  { icon: 'cart',     color: '#6fbf86' },
  'Servicio adicional': { icon: 'scissors', color: '#92b4ff' },
  'Otro ingreso':       { icon: 'spark',    color: '#9aa0a6' },
}
export const INCOME_CATEGORIES = Object.keys(INCOME_CATEGORY_META)

export function metaFor(kind, category) {
  const table = kind === 'ingreso' ? INCOME_CATEGORY_META : CATEGORY_META
  return table[category] || (kind === 'ingreso' ? table['Otro ingreso'] : table.Otros)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '')

export default function FinanceMovementSheet({ open, movement, onClose, onSave, onDelete }) {
  // Dashboard pone `movement` en null en el mismo render en que cierra: se
  // recuerda el último para que la hoja no cambie de título ("Editar" →
  // "Nuevo") durante la animación de salida.
  const lastMovement = useRef(movement)
  if (movement) lastMovement.current = movement
  const shown = movement || lastMovement.current
  const initial = shown?.initial || null
  const isEdit = Boolean(initial)
  const openKind = (FEATURES.manualIncome && (initial?.kind || shown?.kind)) === 'ingreso' ? 'ingreso' : 'gasto'

  const [kind, setKind] = useState(openKind)
  const [category, setCategory] = useState('')
  const [detail, setDetail] = useState('')
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)

  // Se rearma cada vez que la hoja abre (o cambia el movimiento que muestra).
  useEffect(() => {
    if (!open) return
    setConfirmDel(false)
    setBusy(false)
    setError('')
    setKind(openKind)
    setCategory(initial?.category || '')
    setDetail(initial?.detail || '')
    setDate(initial?.date ? String(initial.date).slice(0, 10) : isoDate(new Date()))
    setAmount(initial ? onlyDigits(initial.amount) : '')
  }, [open, initial, openKind])

  const kindLabel = kind === 'ingreso' ? 'ingreso' : 'gasto'
  const baseCategories = kind === 'ingreso' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  // Una fila guardada con una categoría que ya no está en la lista (o que
  // vino de la app de iOS) se sigue viendo elegida, no queda en blanco.
  const categories = category && !baseCategories.includes(category) ? [...baseCategories, category] : baseCategories

  const close = () => { if (!busy) onClose?.() }

  const submit = async () => {
    const amt = Number(onlyDigits(amount))
    if (!category) { setError('Elige una categoría.'); return }
    if (!detail.trim()) { setError('Escribe un detalle.'); return }
    if (!DATE_RE.test(date)) { setError('Elige la fecha.'); return }
    if (!amt || amt <= 0) { setError('Escribe un monto mayor que cero.'); return }
    setBusy(true); setError('')
    const draft = { ...(initial || {}), kind, category, detail: detail.trim(), date, amount: amt }
    try {
      const result = await onSave?.(draft)
      if (result && result.ok === false) {
        setBusy(false)
        setError(result.error || `No se pudo guardar el ${kindLabel}.`)
        return
      }
    } catch (err) {
      setBusy(false)
      setError(err?.message || `No se pudo guardar el ${kindLabel}.`)
      return
    }
    setBusy(false)
    onClose?.()
  }

  const remove = async () => {
    setBusy(true)
    try {
      await onDelete?.(initial)
    } catch {
      setBusy(false)
      setConfirmDel(false)
      setError(`No se pudo eliminar el ${kindLabel}.`)
      return
    }
    setBusy(false)
    setConfirmDel(false)
    onClose?.()
  }

  const amountNum = Number(onlyDigits(amount))

  return (
    <>
      <Sheet
        open={open}
        onClose={busy ? undefined : close}
        dismissible={!busy}
        title={isEdit ? `Editar ${kindLabel}` : `Nuevo ${kindLabel}`}
        icon={kind === 'ingreso' ? 'spark' : 'wallet'}
        size="sm"
        headActions={isEdit && onDelete ? (
          <ActionMenu
            label="Más opciones"
            items={[{ label: 'Eliminar movimiento', icon: 'trash', danger: true, onClick: () => setConfirmDel(true) }]}
          />
        ) : null}
        footer={(
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>Cancelar</Button>
            <Button variant="primary" onClick={submit} loading={busy}>{isEdit ? 'Guardar' : 'Registrar'}</Button>
          </>
        )}
      >
        <div className="pn-stack">
          {error && <InlineAlert tone="error">{error}</InlineAlert>}
          {FEATURES.manualIncome && (
            <Segmented
              ariaLabel="Tipo de movimiento"
              full
              value={kind}
              onChange={(v) => { setKind(v); setCategory(''); setError('') }}
              options={[{ value: 'gasto', label: 'Gasto', icon: 'wallet' }, { value: 'ingreso', label: 'Ingreso', icon: 'spark' }]}
            />
          )}
          <Field label="Categoría">
            <ChoiceGrid
              ariaLabel="Categoría"
              cols={2}
              value={category}
              onChange={(v) => { setCategory(v); setError('') }}
              options={categories.map((c) => ({ value: c, label: c, icon: metaFor(kind, c).icon }))}
            />
          </Field>
          <Field label="Detalle">
            <input
              className="input"
              placeholder={kind === 'ingreso' ? 'Ej.: propina de la tarde' : 'Ej.: navajas y cuchillas'}
              value={detail}
              maxLength={160}
              onChange={(e) => setDetail(e.target.value)}
              autoFocus={!isEdit}
            />
          </Field>
          <div className="pn-form-row is-keep">
            <Field label="Fecha">
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Monto">
              {/* Se muestra con puntos de miles ("15.000") y se guarda en dígitos. */}
              <input
                className="input"
                inputMode="numeric"
                placeholder="0"
                aria-label="Monto en pesos"
                value={amountNum > 0 ? amountNum.toLocaleString('es-CL') : amount}
                onChange={(e) => setAmount(onlyDigits(e.target.value).slice(0, 10))}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              />
            </Field>
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDel}
        tone="danger"
        icon="trash"
        title={`¿Eliminar este ${kindLabel}?`}
        message={`${detail || 'Este movimiento'}${amountNum ? ` · ${kind === 'ingreso' ? '+' : '−'}${CLP(amountNum)}` : ''}. Esta acción no se puede deshacer.`}
        confirmLabel="Sí, eliminar"
        cancelLabel="Volver"
        busy={busy}
        onCancel={() => setConfirmDel(false)}
        onConfirm={remove}
      />
    </>
  )
}

export { FinanceMovementSheet }
