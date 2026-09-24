import { neon } from "@neondatabase/serverless"
import { requireInternal } from "./_auth.js"
import { ensureExpenseColumns } from "./_schema.js"

/* BRUNETTI — Movimientos manuales de Finanzas (solo admin)
   ------------------------------------------------------------------
   Cada fila es un gasto o un ingreso manual (`kind`, columna que crea
   ensureExpenseColumns en api/_schema.js con default 'gasto': todo lo que ya
   estaba guardado es gasto).

   GET ?kind=gasto|ingreso|all — SIN parámetro devuelve solo gastos, a
   propósito: la app de iOS llama GET /api/expenses a secas y suma cada fila
   como gasto (DashboardModel.expensesTotal), así que un ingreso en esa lista
   le restaría plata al margen en vez de sumarla. El panel nuevo pide
   ?kind=all y separa los dos por `kind`. Cada fila trae `kind`.
   POST/PATCH aceptan `kind` ('gasto' | 'ingreso'); sin él, POST guarda un
   gasto y PATCH no lo toca. */

const DEMO_EXPENSES = [
  { id: 1, date: "2026-06-03", category: "Insumos", detail: "Cera, navajas y peines", amount: 145000, owner: "Brunetti", kind: "gasto" },
  { id: 2, date: "2026-06-05", category: "Marketing", detail: "Campana Instagram", amount: 85000, owner: "Brunetti", kind: "gasto" },
  { id: 3, date: "2026-06-08", category: "Arriendo", detail: "Local Monumento 1750", amount: 620000, owner: "Administracion", kind: "gasto" },
]

const KINDS = ["gasto", "ingreso"]

/* `kind` que viene en el body: ausente (undefined/null/"") → null, para que
   cada método ponga su default; uno que no es gasto/ingreso → error, en vez
   de guardarlo en silencio como gasto (un "Ingreso" mal escrito terminaría
   restando). */
function readKind(value) {
  if (value === undefined || value === null || value === "") return { kind: null }
  const kind = String(value).trim().toLowerCase()
  if (!KINDS.includes(kind)) return { error: "Tipo invalido (gasto o ingreso)" }
  return { kind }
}

/* Filtro del GET: sin parámetro, gasto (ver cabecera). */
function readKindFilter(value) {
  if (value === undefined || value === null || value === "") return { filter: "gasto" }
  const filter = String(value).trim().toLowerCase()
  if (filter === "all" || KINDS.includes(filter)) return { filter }
  return { error: "kind invalido (all, gasto o ingreso)" }
}

function validateExpense(body = {}) {
  const date = String(body.date || "").slice(0, 10)
  const category = String(body.category || "").trim()
  const detail = String(body.detail || "").trim()
  const amount = Number(body.amount || 0)
  const owner = String(body.owner || "Brunetti").trim()
  const { kind, error: kindError } = readKind(body.kind)
  if (!date) return { error: "Fecha requerida" }
  if (!category) return { error: "Categoria requerida" }
  if (!detail) return { error: "Detalle requerido" }
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Monto invalido" }
  if (kindError) return { error: kindError }
  return { date, category, detail, amount: Math.round(amount), owner, kind: kind || "gasto" }
}

export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL)
    const session = requireInternal(req, res, { admin: true })
    if (!session) return

    // Después del gate: nadie sin sesión admin dispara DDL. Con la columna
    // ya creada (lo normal) es un SELECT por instancia fría y nada más.
    await ensureExpenseColumns(sql)

    // owner con COALESCE: la columna admite NULL y la app de iOS lo decodifica
    // como String obligatorio (una fila vieja sin dueño le rompería la lista).
    if (req.method === "GET") {
      const { filter, error } = readKindFilter(req.query?.kind)
      if (error) return res.status(400).json({ ok: false, error })
      const expenses = filter === "all"
        ? await sql`
            SELECT id, expense_date::text as date, category, detail, amount, COALESCE(owner, 'Brunetti') as owner, kind
            FROM expenses
            ORDER BY expense_date DESC, id DESC
            LIMIT 120
          `
        : await sql`
            SELECT id, expense_date::text as date, category, detail, amount, COALESCE(owner, 'Brunetti') as owner, kind
            FROM expenses
            WHERE kind = ${filter}
            ORDER BY expense_date DESC, id DESC
            LIMIT 120
          `
      return res.json({ ok: true, expenses })
    }

    if (req.method === "POST") {
      const payload = validateExpense(req.body)
      if (payload.error) return res.status(400).json({ ok: false, error: payload.error })
      const [expense] = await sql`
        INSERT INTO expenses (expense_date, category, detail, amount, owner, kind)
        VALUES (${payload.date}, ${payload.category}, ${payload.detail}, ${payload.amount}, ${payload.owner}, ${payload.kind})
        RETURNING id, expense_date::text as date, category, detail, amount, COALESCE(owner, 'Brunetti') as owner, kind
      `
      return res.json({ ok: true, expense })
    }

    if (req.method === "PATCH") {
      const { id, date, category, detail, amount } = req.body || {}
      if (!Number(id)) return res.status(400).json({ ok: false, error: "id requerido" })
      const amt = amount != null && amount !== "" ? Math.round(Number(amount)) : null
      if (amt != null && (!Number.isFinite(amt) || amt <= 0)) return res.status(400).json({ ok: false, error: "Monto invalido" })
      const { kind, error: kindError } = readKind(req.body?.kind)
      if (kindError) return res.status(400).json({ ok: false, error: kindError })
      const [expense] = await sql`
        UPDATE expenses SET
          expense_date = COALESCE(${date ? String(date).slice(0, 10) : null}, expense_date),
          category = COALESCE(${String(category || "").trim() || null}, category),
          detail = COALESCE(${String(detail || "").trim() || null}, detail),
          amount = COALESCE(${amt}, amount),
          kind = COALESCE(${kind}, kind)
        WHERE id = ${Number(id)}
        RETURNING id, expense_date::text as date, category, detail, amount, COALESCE(owner, 'Brunetti') as owner, kind
      `
      if (!expense) return res.status(404).json({ ok: false, error: "Gasto no encontrado" })
      return res.json({ ok: true, expense })
    }

    if (req.method === "DELETE") {
      const id = Number(req.query.id)
      if (!id) return res.status(400).json({ ok: false, error: "id requerido" })
      await sql`DELETE FROM expenses WHERE id = ${id}`
      return res.json({ ok: true })
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" })
  } catch (err) {
    console.error("expenses error:", err)
    const session = requireInternal(req, res, { admin: true })
    if (!session) return
    if (req.method === "GET") {
      const { filter, error } = readKindFilter(req.query?.kind)
      if (error) return res.status(400).json({ ok: false, error })
      return res.json({ ok: true, expenses: filter === "all" ? DEMO_EXPENSES : DEMO_EXPENSES.filter((e) => e.kind === filter) })
    }
    if (req.method === "POST") {
      const payload = validateExpense(req.body)
      if (payload.error) return res.status(400).json({ ok: false, error: payload.error })
      return res.json({ ok: true, expense: { id: Date.now(), ...payload } })
    }
    if (req.method === "PATCH") return res.json({ ok: true, expense: req.body })
    if (req.method === "DELETE") return res.json({ ok: true })
    return res.status(500).json({ ok: false, error: "No se pudo procesar gastos" })
  }
}
