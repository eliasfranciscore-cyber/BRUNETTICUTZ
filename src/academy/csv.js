/* ACADEMY — exportar a CSV (Miembros → Exportar)
   ------------------------------------------------------------------
   csvCell es espejo de api/_academyText.js: una celda que empieza con
   = + - @ (o tab/CR) se ejecuta como fórmula al abrir el archivo en Excel o
   Sheets — un miembro llamado `=HYPERLINK("…")` se convertiría en un link en
   la planilla del dueño. Se antepone ' y siempre va entre comillas.

   El archivo lleva BOM UTF-8 para que Excel lea bien tildes y eñes. */

export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

/* rows: arreglo de arreglos (la primera fila es el encabezado) o arreglo de
   objetos (el encabezado sale de las claves del primero, o de `columns`:
   [{ key, label }]). `delimiter` por defecto ','; ';' para Excel en español. */
export function toCsv(rows, { columns, delimiter = ',' } = {}) {
  const list = Array.isArray(rows) ? rows : []
  let matrix
  if (columns && columns.length) {
    matrix = [columns.map((c) => c.label ?? c.key), ...list.map((row) => columns.map((c) => (typeof c.value === 'function' ? c.value(row) : row?.[c.key])))]
  } else if (list.length && !Array.isArray(list[0]) && typeof list[0] === 'object') {
    const keys = Object.keys(list[0])
    matrix = [keys, ...list.map((row) => keys.map((k) => row?.[k]))]
  } else {
    matrix = list
  }
  return matrix.map((r) => (Array.isArray(r) ? r : [r]).map(csvCell).join(delimiter)).join('\r\n') + '\r\n'
}

export function downloadCsv(rows, filename = 'export.csv', opts = {}) {
  const text = '﻿' + toCsv(rows, opts)
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = /\.csv$/i.test(filename) ? filename : `${filename}.csv`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10000)
}
