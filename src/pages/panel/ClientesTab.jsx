import React from 'react'
import { Icon } from '../../components/ui.jsx'
import { CLP } from '../../data.js'
import ClientModal from '../../components/ClientModal.jsx'
import { Panel } from './shared.jsx'

/* Pestaña «clientes» del panel interno, extraída tal cual de Dashboard.jsx
   para que cada módulo viva en su propio archivo. Recibe en `ctx` el estado
   y las acciones de Dashboard que usa (ver el objeto `dash` que arma
   Dashboard.jsx).
   Incluye la ficha del cliente (ClientModal), que antes era un bloque aparte
   con el mismo filtro de pestaña. */
export default function ClientesTab({ ctx }) {
  const {
    activeClients,
    barbers,
    clientEditing,
    clientFilter,
    clientHistory,
    clientQuery,
    clientSort,
    deleteClient,
    inactiveClients,
    navigate,
    openClient,
    saveClient,
    selectedClient,
    sendLoyaltyCard,
    setClientFilter,
    setClientQuery,
    setNewClientOpen,
    setSelectedClient,
    sortedClients,
    toggleClientSort,
    topClients,
  } = ctx
  return (
    <>
          <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
            <div className="client-filter-grid">
              <button type="button" className={`client-filter-card ${clientFilter === "active" ? "is-active" : ""}`} onClick={() => setClientFilter((f) => f === "active" ? "all" : "active")}>
                <span className="cf-ic"><Icon name="user" size={16} /></span>
                <span className="cf-body"><strong>{activeClients.length}</strong><span className="cf-label">Activos</span></span>
              </button>
              <button type="button" className={`client-filter-card ${clientFilter === "inactive" ? "is-active" : ""}`} onClick={() => setClientFilter((f) => f === "inactive" ? "all" : "inactive")}>
                <span className="cf-ic"><Icon name="clock" size={16} /></span>
                <span className="cf-body"><strong>{inactiveClients.length}</strong><span className="cf-label">Inactivos 30+ días</span></span>
              </button>
              <button type="button" className={`client-filter-card ${clientFilter === "top" ? "is-active" : ""}`} onClick={() => setClientFilter((f) => f === "top" ? "all" : "top")}>
                <span className="cf-ic"><Icon name="star" size={16} /></span>
                <span className="cf-body"><strong>{topClients.length}</strong><span className="cf-label">Más activos</span></span>
              </button>
            </div>
            <Panel
              title="Panel de clientes"
              action={(
                <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
                  <span className="chip chip-gold">Teléfono como ID</span>
                  <button className="btn btn-gold btn-sm" onClick={() => setNewClientOpen(true)}>
                    <Icon name="user" size={14} /> Nuevo
                  </button>
                </div>
              )}
            >
              <div className="client-search">
                <Icon name="user" size={15} />
                <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Buscar por nombre, telefono o correo" />
              </div>
              <div className="client-table-head">
                <button type="button" onClick={() => toggleClientSort("name")} className={clientSort.key === "name" ? "is-sorted" : ""}>
                  Cliente {clientSort.key === "name" && (clientSort.dir === "asc" ? "↑" : "↓")}
                </button>
                <button type="button" onClick={() => toggleClientSort("visits")} className={clientSort.key === "visits" ? "is-sorted" : ""}>
                  Visitas {clientSort.key === "visits" && (clientSort.dir === "asc" ? "↑" : "↓")}
                </button>
                <button type="button" onClick={() => toggleClientSort("totalSpent")} className={clientSort.key === "totalSpent" ? "is-sorted" : ""}>
                  Total {clientSort.key === "totalSpent" && (clientSort.dir === "asc" ? "↑" : "↓")}
                </button>
                <span />
              </div>
              <div className="client-list">
                {sortedClients.map((client) => (
                  <div key={client.id || client.phone} className="client-row" onClick={() => openClient(client)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openClient(client) }}>
                    <div style={{ minWidth: 0 }}>
                      <strong>{client.name}</strong>
                      <span>+56 {client.phone} · {client.email || "sin correo"}</span>
                    </div>
                    <div>
                      <strong>{client.visits || 0}</strong>
                      <span>
                        visitas
                        {client.loyalty && (
                          <span className="chip chip-gold" style={{ marginLeft: ".35rem", fontSize: ".62rem", padding: ".1rem .35rem" }} title={`${client.loyalty.stars} de ${client.loyalty.goal} estrellas`}>
                            <Icon name="star" size={9} /> {client.loyalty.stars}
                          </span>
                        )}
                      </span>
                    </div>
                    <div><strong>{CLP(client.totalSpent || 0)}</strong><span>{client.lastVisit || "sin visitas"}</span></div>
                    <div style={{ display: "flex", gap: ".3rem", justifyContent: "flex-end" }}>
                      {/* Enviar la tarjeta por WhatsApp: solo a quien todavía no
                          la tiene agregada — a los demás no hay nada que
                          ofrecerles. */}
                      {!client.walletHasPass && (
                        <button className="btn btn-dark btn-sm client-row-edit" title="Enviar tarjeta de fidelización por WhatsApp"
                          onClick={(e) => { e.stopPropagation(); sendLoyaltyCard(client) }}>
                          <Icon name="wallet" size={13} /> <span className="btn-label">Tarjeta</span>
                        </button>
                      )}
                      <button className="btn btn-dark btn-sm client-row-edit" onClick={(e) => { e.stopPropagation(); openClient(client, { edit: true }) }}>
                        <Icon name="user" size={13} /> <span className="btn-label">Editar</span>
                      </button>
                    </div>
                  </div>
                ))}
                {!sortedClients.length && (
                  <div className="empty-state" style={{ display: "grid", gap: ".7rem", justifyItems: "center" }}>
                    <span>No hay clientes que coincidan con la busqueda.</span>
                    <button type="button" className="btn btn-gold btn-sm" onClick={() => setNewClientOpen(true)}>
                      <Icon name="user" size={14} /> Nuevo cliente
                    </button>
                  </div>
                )}
              </div>
            </Panel>
          </div>

        {selectedClient && (
          <ClientModal
            client={selectedClient}
            history={clientHistory}
            barbers={barbers}
            startEditing={clientEditing}
            onClose={() => setSelectedClient(null)}
            onSave={saveClient}
            onDelete={deleteClient}
            onSchedule={() => navigate("/reservar")}
          />
        )}
    </>
  )
}
