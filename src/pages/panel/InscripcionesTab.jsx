import React from 'react'
import { Icon, Stat } from '../../components/ui.jsx'
import { mergeEnrollments, removeLocalEnrollment } from '../../enrollmentsStore.js'
import EnrollmentModal from '../../components/EnrollmentModal.jsx'
import NewEnrollmentModal from '../../components/NewEnrollmentModal.jsx'
import { Panel } from './shared.jsx'

/* ============================================================
   INSCRIPCIONES — lista unificada de Cursos + Workshop
   Carga desde /api/enrollments (requiere sesión interna).
   Categoriza con colores del módulo: azul = cursos, morado = workshop.
   ============================================================ */
export function EnrollmentsPanel({ clients = [], authHeaders = () => ({}), onCreateClient = async () => {}, onToast = () => {} }) {
  const [rows, setRows] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [filter, setFilter] = React.useState("todos") // todos | cursos | workshop
  const [query, setQuery] = React.useState("")
  const [selected, setSelected] = React.useState(null)
  const [creating, setCreating] = React.useState(false)

  React.useEffect(() => {
    // Combina lo del backend con el respaldo local (inscripciones hechas desde
    // Cursos/Workshop), para que aparezcan aunque /api no esté disponible.
    const token = localStorage.getItem("ps_barber_token") || ""
    fetch("/api/enrollments", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.headers.get("content-type")?.includes("application/json") ? r.json() : Promise.reject(new Error("api unavailable")))
      .then((d) => { setRows(mergeEnrollments(d.enrollments || [])); setLoading(false) })
      .catch(() => { setRows(mergeEnrollments([])); setLoading(false) })
  }, [])

  const saveEnrollment = async (updated) => {
    setRows((list) => list.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
    setSelected((r) => (r && r.id === updated.id ? { ...r, ...updated } : r))
    try {
      const res = await fetch(`/api/enrollments?id=${updated.id}`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(updated),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "No se pudo guardar")
    } catch (err) {
      console.error("saveEnrollment:", err?.message)
    }
  }

  const deleteEnrollment = async (enrollment) => {
    setRows((list) => list.filter((r) => r.id !== enrollment.id))
    setSelected(null)
    /* Borrar también la copia del respaldo local: si no, mergeEnrollments la
       vuelve a mostrar al recargar aunque la fila ya no exista en Neon. */
    removeLocalEnrollment(enrollment)
    /* Las inscripciones que solo viven en localStorage (id `local-…`) no
       tienen fila que borrar en el backend. */
    if (!Number(enrollment.id)) return
    fetch(`/api/enrollments?id=${enrollment.id}`, { method: "DELETE", headers: authHeaders() }).catch(() => {})
  }

  /* Correo con la ubicación y el horario del día a quienes ya tienen cupo en
     el Workshop. Primero pregunta al backend a quiénes les llegaría (dryRun),
     confirma con el barbero y recién ahí manda: son correos a clientes
     reales. Quien ya lo recibió queda fuera (details_sent_at). */
  const [sendingDetails, setSendingDetails] = React.useState(false)
  const sendWorkshopDetails = async () => {
    if (sendingDetails) return
    setSendingDetails(true)
    try {
      const preview = await fetch("/api/enrollments?job=workshop-details", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ dryRun: true }),
      }).then((r) => r.json())

      const list = preview?.recipients || []
      if (!list.length) {
        onToast("✉️", preview?.skipped ? "Ya se les había enviado a todos" : "No hay a quién enviarle")
        return
      }
      const names = list.map((r) => `· ${r.name} (${r.email})`).join("\n")
      if (!window.confirm(`Enviar el correo con ubicación y horario a ${list.length} ${list.length === 1 ? "persona" : "personas"}:\n\n${names}`)) return

      const out = await fetch("/api/enrollments?job=workshop-details", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ whenLabel: null }),
      }).then((r) => r.json())

      const okCount = out?.sent?.length || 0
      const badCount = out?.failed?.length || 0
      onToast(badCount ? "⚠️" : "✉️", badCount ? `Enviados ${okCount}, fallaron ${badCount}` : `Correo enviado a ${okCount}`)
      if (badCount) console.error("workshop-details fallidos:", out.failed)
    } catch (err) {
      console.error("sendWorkshopDetails:", err?.message)
      onToast("⚠️", "No se pudo enviar")
    } finally {
      setSendingDetails(false)
    }
  }

  const createEnrollment = async (draft) => {
    const res = await fetch("/api/enrollments", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(draft),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.ok === false) throw new Error(data?.error || "No se pudo guardar la inscripción.")
    setRows((list) => [{ id: data.id, ...draft, created_at: new Date().toISOString() }, ...list])
  }

  const filtered = rows.filter((r) => {
    if (filter !== "todos" && r.source !== filter) return false
    if (query) {
      const q = query.toLowerCase()
      return r.name?.toLowerCase().includes(q) || r.phone?.includes(q) || r.email?.toLowerCase().includes(q)
    }
    return true
  })

  const cursosBadge = { background: "rgba(11,18,158,0.18)", color: "#6b74f0", border: "1px solid rgba(107,116,240,0.35)" }
  const workshopBadge = { background: "rgba(136,56,216,0.18)", color: "#b483f3", border: "1px solid rgba(136,56,216,0.35)" }

  const fmtDate = (iso) => {
    if (!iso) return "—"
    const d = new Date(iso)
    return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })
  }

  return (
    <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "1rem" }}>
        <Stat icon="user"    label="Total inscripciones" value={rows.length} accent />
        <Stat icon="spark"   label="Cursos"   value={rows.filter(r => r.source === "cursos").length} />
        <Stat icon="scissors" label="Workshop" value={rows.filter(r => r.source === "workshop").length} />
      </div>
      <Panel title="Inscripciones" action={
        <div style={{ display: "flex", gap: ".6rem", alignItems: "center", flexWrap: "wrap" }}>
          <div className="psn-seg" role="group" aria-label="Filtrar por origen">
            {["todos","cursos","workshop"].map(f => (
              <button key={f} type="button" className={filter === f ? "is-on" : ""} style={{ textTransform: "capitalize" }} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          <button type="button" className="btn btn-dark btn-sm" disabled={sendingDetails} onClick={sendWorkshopDetails} title="Manda ubicación y horario del día a quienes tienen cupo en el Workshop">
            <Icon name="spark" size={14} /> {sendingDetails ? "Enviando…" : "Enviar detalles"}
          </button>
          <button type="button" className="btn btn-gold btn-sm" onClick={() => setCreating(true)}>
            <Icon name="user" size={14} /> Nueva inscripción
          </button>
        </div>
      }>
        <div className="client-search">
          <Icon name="user" size={15} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre, teléfono o email" />
        </div>
        <div className="client-table-head" style={{ gridTemplateColumns: "1.4fr 1fr auto auto" }}>
          <span>Cliente</span>
          <span>Detalle</span>
          <span>Origen</span>
          <span>Fecha</span>
        </div>
        <div className="client-list">
          {loading && <div className="empty-state">Cargando inscripciones…</div>}
          {!loading && !filtered.length && <div className="empty-state">No hay inscripciones que coincidan.</div>}
          {filtered.map((r) => (
            <div key={r.id} className="client-row" style={{ gridTemplateColumns: "1.4fr 1fr auto auto" }} onClick={() => setSelected(r)}>
              <div style={{ minWidth: 0 }}>
                <strong>{r.name}</strong>
                <span>{r.phone} · {r.email}</span>
              </div>
              <div style={{ minWidth: 0 }}>
                <span>{r.level || "—"}</span>
                {r.edition && <span>Edición: {r.edition}</span>}
              </div>
              <span style={{ fontSize: "0.7rem", padding: "2px 8px", borderRadius: 999, justifySelf: "start", ...( r.source === "cursos" ? cursosBadge : workshopBadge) }}>
                {r.source === "cursos" ? "Cursos" : "Workshop"}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{fmtDate(r.created_at)}</span>
            </div>
          ))}
        </div>
      </Panel>

      {selected && (
        <EnrollmentModal
          enrollment={selected}
          clients={clients}
          onClose={() => setSelected(null)}
          onSave={saveEnrollment}
          onDelete={deleteEnrollment}
          onCreateClient={onCreateClient}
        />
      )}

      <NewEnrollmentModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={createEnrollment}
      />
    </div>
  )
}

/* Pestaña «inscripciones» del panel interno, extraída tal cual de Dashboard.jsx
   para que cada módulo viva en su propio archivo. Recibe en `ctx` el estado
   y las acciones de Dashboard que usa (ver el objeto `dash` que arma
   Dashboard.jsx).
   El módulo sigue siendo EnrollmentsPanel, con las mismas props de siempre. */
export default function InscripcionesTab({ ctx }) {
  const {
    authHeaders,
    clients,
    createClient,
    pushToast,
  } = ctx
  return (
          <EnrollmentsPanel clients={clients} authHeaders={authHeaders} onCreateClient={createClient} onToast={pushToast} />
  )
}
