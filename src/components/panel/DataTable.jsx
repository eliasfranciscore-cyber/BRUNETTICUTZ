import React from 'react'
import { ListRow } from './kit.jsx'
import { useIsPhone } from './hooks.js'

const cx = (...p) => p.filter(Boolean).join(' ')

/* Tabla en escritorio, lista en el celular.
   Las tablas anchas con scroll lateral escondían justo el dato importante
   en el iPhone (el monto de Caja, el total de un pedido). Bajo
   640 px cada fila se dibuja como ListRow con lo que devuelva `mobile(row)`.

   columns: [{ key, label, num, strong, muted, nowrap, className, render(row) }]
   mobile(row) → props de ListRow ({ lead, title, subtitle, value, meta, trailing, chevron, dim })
   footer: arreglo de celdas (una por columna) para la fila de totales. */
export function DataTable({ columns: rawColumns, rows, rowKey, onRowClick, rowDim, mobile, empty = null, footer, className, ariaLabel }) {
  // Una columna condicional se escribe `cond && {…}`: los `false` se sueltan acá.
  const columns = (rawColumns || []).filter(Boolean)
  const isPhone = useIsPhone()
  if (!rows || rows.length === 0) return empty
  const keyOf = (row, i) => (rowKey ? rowKey(row, i) : row.id ?? i)

  if (isPhone && mobile) {
    return (
      <div className={cx('pn-list', className)} aria-label={ariaLabel}>
        {rows.map((row, i) => {
          const m = mobile(row, i) || {}
          return (
            <ListRow
              key={keyOf(row, i)}
              {...m}
              dim={m.dim ?? rowDim?.(row)}
              onClick={m.onClick || (onRowClick ? () => onRowClick(row) : undefined)}
              chevron={m.chevron ?? Boolean(onRowClick)}
            />
          )
        })}
      </div>
    )
  }

  const cellClass = (c) => cx(c.num && 'is-num', c.strong && 'is-strong', c.muted && 'is-muted', c.nowrap && 'is-nowrap', c.className)
  return (
    <div className={cx('pn-table-wrap', className)}>
      <table className="pn-table" aria-label={ariaLabel}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.num ? 'is-num' : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={keyOf(row, i)}
              className={cx(onRowClick && 'is-link', rowDim?.(row) && 'is-dim')}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row) } : undefined}
            >
              {columns.map((c) => <td key={c.key} className={cellClass(c)}>{c.render ? c.render(row, i) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr>{footer.map((cell, i) => <td key={i} className={columns[i] ? cellClass(columns[i]) : undefined}>{cell}</td>)}</tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
