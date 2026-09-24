import React from 'react'
import { Icon, Stat } from '../../components/ui.jsx'
import { CLP } from '../../data.js'
import { Panel } from './shared.jsx'

/* ============================================================
   PEDIDOS — lista unificada de pagos reales (Cursos + Workshop +
   Essentials). Carga desde /api/mp-payments?panel=1 (requiere sesión).
   A diferencia de "Inscripciones" (que también incluye leads de lista de
   espera sin pagar), acá solo aparecen pedidos con pago confirmado.
   ============================================================ */
export const PEDIDOS_BADGE = {
  cursos:     { background: "rgba(11,18,158,0.18)",  color: "#6b74f0", border: "1px solid rgba(107,116,240,0.35)" },
  workshop:   { background: "rgba(136,56,216,0.18)", color: "#b483f3", border: "1px solid rgba(136,56,216,0.35)" },
  essentials: { background: "rgba(111,191,134,0.18)", color: "#9fd7af", border: "1px solid rgba(111,191,134,0.35)" },
}
export const PEDIDOS_LABEL = { cursos: "Cursos", workshop: "Workshop", essentials: "Essentials" }

export function PedidosPanel({ authHeaders = () => ({}) }) {
  const [rows, setRows] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [filter, setFilter] = React.useState("todos") // todos | cursos | workshop | essentials
  const [query, setQuery] = React.useState("")

  React.useEffect(() => {
    fetch("/api/mp-payments?panel=1", { headers: authHeaders() })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok || d?.ok === false) throw new Error(d?.error || "No se pudieron cargar los pedidos")
        setRows(d.orders || [])
        setLoading(false)
      })
      .catch((err) => { setError(err.message || "No se pudieron cargar los pedidos"); setLoading(false) })
  }, [])

  const filtered = rows.filter((r) => {
    if (filter !== "todos" && r.type !== filter) return false
    if (query) {
      const q = query.toLowerCase()
      return r.name?.toLowerCase().includes(q) || r.phone?.includes(q) || r.email?.toLowerCase().includes(q)
    }
    return true
  })

  const total = rows.reduce((n, r) => n + (r.amount || 0), 0)
  const fmtDate = (iso) => {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })
  }

  return (
    <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "1rem" }}>
        <Stat icon="wallet" label="Total recaudado" value={CLP(total)} accent />
        <Stat icon="spark" label="Cursos" value={rows.filter((r) => r.type === "cursos").length} />
        <Stat icon="scissors" label="Workshop" value={rows.filter((r) => r.type === "workshop").length} />
        <Stat icon="gift" label="Essentials" value={rows.filter((r) => r.type === "essentials").length} />
      </div>
      <Panel title="Pedidos" action={
        <div className="psn-seg" role="group" aria-label="Filtrar por origen">
          {["todos", "cursos", "workshop", "essentials"].map((f) => (
            <button key={f} type="button" className={filter === f ? "is-on" : ""} style={{ textTransform: "capitalize" }} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      }>
        <div className="client-search">
          <Icon name="user" size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, teléfono o email" />
        </div>
        <div className="client-table-head" style={{ gridTemplateColumns: "1.4fr 1.4fr auto auto auto" }}>
          <span>Cliente</span>
          <span>Detalle</span>
          <span>Origen</span>
          <span>Monto</span>
          <span>Fecha</span>
        </div>
        <div className="client-list">
          {loading && <div className="empty-state">Cargando pedidos…</div>}
          {!loading && error && <div className="empty-state">{error}</div>}
          {!loading && !error && !filtered.length && <div className="empty-state">No hay pedidos que coincidan.</div>}
          {!loading && !error && filtered.map((r) => (
            <div key={`${r.type}-${r.id}`} className="client-row" style={{ gridTemplateColumns: "1.4fr 1.4fr auto auto auto" }}>
              <div style={{ minWidth: 0 }}>
                <strong>{r.name}</strong>
                <span>{r.phone} · {r.email}</span>
              </div>
              <span style={{ minWidth: 0 }}>{r.detail || "—"}</span>
              <span style={{ fontSize: "0.7rem", padding: "2px 8px", borderRadius: 999, justifySelf: "start", ...PEDIDOS_BADGE[r.type] }}>
                {PEDIDOS_LABEL[r.type]}
              </span>
              <span style={{ fontSize: "0.85rem", color: "var(--ink)", fontWeight: 600 }}>{CLP(r.amount || 0)}</span>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{fmtDate(r.created_at)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

/* Pestaña «pedidos» del panel interno, extraída tal cual de Dashboard.jsx
   para que cada módulo viva en su propio archivo. Recibe en `ctx` el estado
   y las acciones de Dashboard que usa (ver el objeto `dash` que arma
   Dashboard.jsx).
   El módulo sigue siendo PedidosPanel, con las mismas props de siempre. */
export default function PedidosTab({ ctx }) {
  const {
    authHeaders,
  } = ctx
  return (
          <PedidosPanel authHeaders={authHeaders} />
  )
}
