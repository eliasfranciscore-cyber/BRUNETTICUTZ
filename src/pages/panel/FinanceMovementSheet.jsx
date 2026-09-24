/* Hoja de movimiento manual de Finanzas: un gasto o un ingreso (ESQUELETO).

   TODO(T8 · Finanzas + Gastos, ola C): portar FinanceMovementModal de
   PimpStudio (35e44d6 src/pages/panel/FinanceMovementSheet.jsx) sobre esta
   firma. El selector de barbero se oculta solo: Dashboard pasa `barbers={[]}`.
   El Segmented Gasto | Ingreso aparece únicamente con FEATURES.manualIncome,
   para que un ingreso no termine guardado como gasto antes de que exista
   expenses.kind en el servidor.

   Props (congeladas):
     open        boolean
     movement    null | { kind: 'gasto' | 'ingreso', initial?: fila de /api/expenses }
                 (lo que se tocó en Finanzas o en Gastos; con `initial` es edición)
     onClose()
     onSave(draft)      draft = { id?, kind, date, category, detail, amount }
                        Dashboard decide: con id → PATCH, sin id → POST
                        (el dueño por defecto es "Brunetti")
     onDelete(expense)
     barbers     [] en BrunettiCutz (un solo barbero)
   Mientras tanto no dibuja nada. */
export default function FinanceMovementSheet({ open, movement, onClose, onSave, onDelete, barbers = [] }) {
  return null
}

export { FinanceMovementSheet }
