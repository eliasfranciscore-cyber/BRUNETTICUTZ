import React from 'react'
import { Icon, Stat } from '../../components/ui.jsx'
import { CLP, barberById } from '../../data.js'
import { BarChart, Panel } from './shared.jsx'

/* Pestaña «finanzas» del panel interno, extraída tal cual de Dashboard.jsx
   para que cada módulo viva en su propio archivo. Recibe en `ctx` el estado
   y las acciones de Dashboard que usa (ver el objeto `dash` que arma
   Dashboard.jsx). */
export default function FinanzasTab({ ctx }) {
  const {
    admin,
    avgTicket,
    barbers,
    completedBookings,
    exportCSV,
    financePeriod,
    financeSort,
    monthExpensesTotal,
    ranking,
    revenueByDate,
    revenueByService,
    revenueTotal,
    setFinancePeriod,
    setNewBookingOpen,
    sortedFinanceRows,
    toggleFinanceSort,
  } = ctx
  return (
          <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
            <div className="fin-toolbar">
              <div className="psn-seg" role="group" aria-label="Periodo">
                <button type="button" className={financePeriod === "semana" ? "is-on" : ""} onClick={() => setFinancePeriod("semana")}>Semana</button>
                <button type="button" className={financePeriod === "mes" ? "is-on" : ""} onClick={() => setFinancePeriod("mes")}>Mes</button>
                <button type="button" className={financePeriod === "año" ? "is-on" : ""} onClick={() => setFinancePeriod("año")}>Año</button>
              </div>
              <button type="button" className="btn btn-dark btn-sm" onClick={() => exportCSV("Finanzas")}>
                <Icon name="wallet" size={13} /> Exportar CSV
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "1rem" }}>
              <Stat icon="wallet"   label="Ingresos del periodo" value={CLP(revenueTotal)} accent />
              <Stat icon="chart"    label="Ticket promedio" value={CLP(avgTicket)} />
              <Stat icon="scissors" label="Servicios"       value={completedBookings.length} />
              <Stat icon="wallet"   label="Gastos del mes"  value={CLP(monthExpensesTotal)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "1.1rem" }}>
              <Panel title="Ingresos por día">
                {revenueByDate.length
                  ? <BarChart data={revenueByDate} fmt={CLP} />
                  : <p style={{ color: "var(--muted)", fontSize: ".84rem" }}>Sin datos en este periodo.</p>}
              </Panel>
              <Panel title="Ingresos por servicio">
                <div style={{ display: "grid", gap: ".75rem" }}>
                  {!revenueByService.length && <p style={{ color: "var(--muted)", fontSize: ".84rem" }}>Sin datos en este periodo.</p>}
                  {revenueByService.slice(0, 5).map((item) => {
                    const p = Math.round((item.total / Math.max(1, revenueTotal)) * 100)
                    return (
                      <div key={item.name} style={{ display: "grid", gap: ".3rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".82rem" }}><span style={{ color: "var(--ink-soft)" }}>{item.name}</span><span className="gold-text" style={{ fontWeight: 600 }}>{p}%</span></div>
                        <div style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}><div style={{ height: "100%", width: `${p}%`, background: "var(--gold-grad)", borderRadius: 99 }} /></div>
                      </div>
                    )
                  })}
                </div>
              </Panel>
            </div>
            <Panel title="Ingresos por barbero">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: ".8rem" }}>
                {!ranking.length && <p style={{ color: "var(--muted)", fontSize: ".84rem" }}>Sin datos en este periodo.</p>}
                {ranking.map((r) => {
                  const b = barbers.find((item) => item.id === r.id) || barberById(r.id)
                  return (
                    <div key={r.id} style={{ padding: "1rem", border: "1px solid var(--hair)", borderRadius: 12, background: "rgba(0,0,0,0.25)" }}>
                      <span style={{ fontSize: ".8rem", color: "var(--muted)", display: "block", marginBottom: ".3rem" }}>{b?.short}</span>
                      <span className="font-display gold-text" style={{ fontSize: "1.1rem", fontWeight: 700 }}>{CLP(r.rev)}</span>
                      <span style={{ fontSize: ".72rem", color: "var(--muted-2)", display: "block", marginTop: ".2rem" }}>{r.cuts} servicios</span>
                    </div>
                  )
                })}
              </div>
            </Panel>

            <Panel title="Movimientos" action={<span className="chip">{sortedFinanceRows.length} en el periodo</span>}>
              <div className="fin-table-head" style={{ "--fin-cols": admin ? "100px 1.3fr 1.1fr 110px 90px 100px" : "100px 1.3fr 1.1fr 90px 100px" }}>
                <button type="button" onClick={() => toggleFinanceSort("date")} className={financeSort.key === "date" ? "is-sorted" : ""}>Fecha {financeSort.key === "date" && (financeSort.dir === "asc" ? "↑" : "↓")}</button>
                <button type="button" onClick={() => toggleFinanceSort("client")} className={financeSort.key === "client" ? "is-sorted" : ""}>Cliente {financeSort.key === "client" && (financeSort.dir === "asc" ? "↑" : "↓")}</button>
                <button type="button" onClick={() => toggleFinanceSort("service")} className={financeSort.key === "service" ? "is-sorted" : ""}>Servicio {financeSort.key === "service" && (financeSort.dir === "asc" ? "↑" : "↓")}</button>
                {admin && <button type="button" onClick={() => toggleFinanceSort("barber")} className={financeSort.key === "barber" ? "is-sorted" : ""}>Barbero {financeSort.key === "barber" && (financeSort.dir === "asc" ? "↑" : "↓")}</button>}
                <button type="button" onClick={() => toggleFinanceSort("price")} className={financeSort.key === "price" ? "is-sorted" : ""}>Precio {financeSort.key === "price" && (financeSort.dir === "asc" ? "↑" : "↓")}</button>
                <span>Estado</span>
              </div>
              <div className="fin-mov-scroll">
                <div className="fin-mov-list">
                  {sortedFinanceRows.map((b) => {
                    const bb = barberById(b.barberId)
                    return (
                      <div key={b.id} className="fin-row" style={{ "--fin-cols": admin ? "100px 1.3fr 1.1fr 110px 90px 100px" : "100px 1.3fr 1.1fr 90px 100px" }}>
                        <div className="fin-c-date"><strong>{b.date?.slice(5)}</strong><span>{b.time}</span></div>
                        <div className="fin-c-client"><strong>{b.client}</strong></div>
                        <div className="fin-c-svc"><span>{b.service}</span></div>
                        {admin && <div className="fin-c-barber"><span>{bb?.short || bb?.name || "—"}</span></div>}
                        <div className="fin-c-price"><strong className="gold-text">{CLP(b.price)}</strong></div>
                        <span className="chip fin-c-status">{b.status}</span>
                      </div>
                    )
                  })}
                  {!sortedFinanceRows.length && (
                    <div className="empty-state" style={{ display: "grid", gap: ".7rem", justifyItems: "center" }}>
                      <span>Sin movimientos en este periodo.</span>
                      <button type="button" className="btn btn-gold btn-sm" onClick={() => setNewBookingOpen(true)}>
                        <Icon name="calendar" size={14} /> Nueva reserva
                      </button>
                    </div>
                  )}
                </div>
                {sortedFinanceRows.length > 0 && (
                  <div className="fin-row-total">
                    <span>Total del periodo</span>
                    <b className="gold-text">{CLP(revenueTotal)}</b>
                  </div>
                )}
              </div>
            </Panel>
          </div>
  )
}
