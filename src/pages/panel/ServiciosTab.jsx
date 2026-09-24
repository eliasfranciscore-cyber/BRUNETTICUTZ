import React from 'react'
import { Icon } from '../../components/ui.jsx'
import { CLP } from '../../data.js'
import { Panel, blocksToMin, getSvcIcon, minToBlocks } from './shared.jsx'

/* Pestaña «servicios» del panel interno, extraída tal cual de Dashboard.jsx
   para que cada módulo viva en su propio archivo. Recibe en `ctx` el estado
   y las acciones de Dashboard que usa (ver el objeto `dash` que arma
   Dashboard.jsx).
   Lista de servicios + drawer de edición; ver también ServiciosDialogs. */
export default function ServiciosTab({ ctx }) {
  const {
    admin,
    editSvcId,
    saveService,
    services,
    setDeleteSvc,
    setEditSvcId,
    setServiceOpen,
    setServices,
  } = ctx
  return (
    <>
          <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
            <button className="btn btn-gold btn-block" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: ".5rem" }} onClick={() => setServiceOpen(true)}>
              <Icon name="spark" size={16} /> Nuevo servicio
            </button>
            <Panel title="Servicios publicados" action={<span className="chip chip-gold">{services.filter((s) => s.active !== false).length} activos</span>}>
              <div className="svc-grid">
                {services.map((svc) => (
                  <button key={svc.id} type="button" className="svc-card" onClick={() => setEditSvcId(svc.id)}>
                    <div className="svc-card-ic"><Icon name={getSvcIcon(svc)} size={20} /></div>
                    <div className="svc-card-name">{svc.name}</div>
                    <div className="svc-card-price">{CLP(svc.price)}</div>
                    <div className="svc-card-meta"><Icon name="clock" size={11} /> {svc.min} min · bloquea {minToBlocks(svc.min)}h · {svc.cat}</div>
                    <span className={svc.active === false ? "chip" : "chip chip-gold"} style={{ fontSize: ".68rem" }}>{svc.active === false ? "Oculto" : "Publicado"}</span>
                  </button>
                ))}
              </div>
            </Panel>
          </div>

        {/* DRAWER edición de servicio (antes expandía la card a fila completa) */}
        {editSvcId != null && (() => {
          const svc = services.find((item) => item.id === editSvcId)
          if (!svc) return null
          return (
            <div className="psn-modal is-drawer" role="dialog" aria-modal="true">
              <button className="psn-scrim" aria-label="Cerrar" onClick={() => setEditSvcId(null)} />
              <div className="psn-modal-card psn-newbk psn-drawer-card">
                <button className="psn-close" onClick={() => setEditSvcId(null)} aria-label="Cerrar"><Icon name="close" size={17} /></button>
                <h3><Icon name={getSvcIcon(svc)} size={20} /> Editar servicio</h3>
                <div className="psn-newbk-sec">
                  <label className="dk-field-lbl">Nombre</label>
                  <input className="input" value={svc.name} onChange={(e) => setServices((items) => items.map((item) => item.id === svc.id ? { ...item, name: e.target.value } : item))} />
                </div>
                <div className="psn-newbk-sec" style={{ gridTemplateColumns: "1fr 1fr", display: "grid", gap: ".5rem" }}>
                  <div><label className="dk-field-lbl">Precio</label><input className="input" inputMode="numeric" value={svc.price} onChange={(e) => setServices((items) => items.map((item) => item.id === svc.id ? { ...item, price: e.target.value.replace(/\D/g, "") } : item))} /></div>
                  <div>
                    <label className="dk-field-lbl">Bloquea en agenda</label>
                    <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                      <button type="button" className="chip" style={{ padding: ".3rem .6rem" }}
                        onClick={() => setServices((items) => items.map((item) => item.id === svc.id ? { ...item, min: String(blocksToMin(minToBlocks(item.min) - 1)) } : item))}
                        disabled={minToBlocks(svc.min) <= 1}>−</button>
                      <span style={{ flex: 1, textAlign: "center", fontSize: ".85rem" }}>{minToBlocks(svc.min)} {minToBlocks(svc.min) === 1 ? "bloque" : "bloques"}</span>
                      <button type="button" className="chip" style={{ padding: ".3rem .6rem" }}
                        onClick={() => setServices((items) => items.map((item) => item.id === svc.id ? { ...item, min: String(blocksToMin(minToBlocks(item.min) + 1)) } : item))}>+</button>
                    </div>
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: ".7rem", color: "var(--muted)" }}>1 bloque = 1 hora de agenda. Duración real guardada: {svc.min} min.</p>
                <div className="psn-confirm-actions" style={{ gridTemplateColumns: admin ? "1fr 1fr 1fr" : "1fr 1fr" }}>
                  <button className={svc.active === false ? "chip" : "chip chip-gold"} onClick={() => saveService({ ...svc, active: svc.active === false })}>{svc.active === false ? "Oculto" : "Publicado"}</button>
                  {admin && (
                    <button className="btn btn-sm psn-res-delete" onClick={() => setDeleteSvc(svc)}><Icon name="close" size={14} /> Eliminar</button>
                  )}
                  <button className="btn btn-gold btn-sm" onClick={() => { saveService(svc); setEditSvcId(null) }}><Icon name="check" size={14} /> Guardar</button>
                </div>
              </div>
            </div>
          )
        })()}
    </>
  )
}

/* Confirmación de borrado y modal "Nuevo servicio". No dependen de la pestaña
   activa (nunca lo hicieron): Dashboard los monta fuera del filtro de pestaña,
   en el mismo lugar de siempre. */
export function ServiciosDialogs({ ctx }) {
  const {
    deleteService,
    deleteSvc,
    saveService,
    serviceDraft,
    serviceOpen,
    setDeleteSvc,
    setServiceDraft,
    setServiceOpen,
  } = ctx
  return (
    <>
        {/* CONFIRMAR ELIMINAR SERVICIO */}
        {deleteSvc && (
          <div className="psn-modal psn-modal-top" role="alertdialog" aria-modal="true">
            <button className="psn-scrim" aria-label="Cerrar" onClick={() => setDeleteSvc(null)} />
            <div className="psn-modal-card psn-confirm">
              <span className="psn-confirm-ic"><Icon name="close" size={22} /></span>
              <h3 className="font-display">¿Eliminar “{deleteSvc.name}”?</h3>
              <p>Las reservas existentes conservarán su nombre y precio. Esta acción no se puede deshacer.</p>
              <div className="psn-confirm-actions">
                <button className="btn btn-ghost btn-block" onClick={() => setDeleteSvc(null)}>Volver</button>
                <button className="btn btn-danger btn-block" onClick={() => { deleteService(deleteSvc); setDeleteSvc(null) }}>Sí, eliminar</button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL NUEVO SERVICIO */}
        {serviceOpen && (
          <div style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={() => setServiceOpen(false)}>
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} />
            <div className="card" style={{ position: "relative", width: "100%", maxWidth: 420, padding: "1.6rem", display: "grid", gap: "1.1rem", zIndex: 1 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 className="font-display" style={{ margin: 0, fontSize: "1.1rem" }}>Nuevo servicio</h3>
                <button style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer", padding: ".3rem" }} onClick={() => setServiceOpen(false)} aria-label="Cerrar">
                  <Icon name="close" size={18} />
                </button>
              </div>
              <span className="chip" style={{ justifySelf: "start" }}>Impacta la web pública</span>
              <div className="admin-form-grid">
                <input className="input" placeholder="Nombre del servicio" value={serviceDraft.name} onChange={(e) => setServiceDraft({ ...serviceDraft, name: e.target.value })} />
                <input className="input" placeholder="Precio (CLP)" inputMode="numeric" value={serviceDraft.price} onChange={(e) => setServiceDraft({ ...serviceDraft, price: e.target.value.replace(/\D/g, "") })} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem", padding: ".55rem .7rem", border: "1px solid var(--hair-2)", borderRadius: 10 }}>
                  <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>Bloquea en agenda</span>
                  <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                    <button type="button" className="chip" style={{ padding: ".3rem .6rem" }}
                      onClick={() => setServiceDraft((d) => ({ ...d, min: String(blocksToMin(minToBlocks(d.min) - 1)) }))}
                      disabled={minToBlocks(serviceDraft.min) <= 1}>−</button>
                    <span style={{ fontSize: ".85rem", minWidth: 64, textAlign: "center" }}>{minToBlocks(serviceDraft.min)} {minToBlocks(serviceDraft.min) === 1 ? "bloque" : "bloques"}</span>
                    <button type="button" className="chip" style={{ padding: ".3rem .6rem" }}
                      onClick={() => setServiceDraft((d) => ({ ...d, min: String(blocksToMin(minToBlocks(d.min) + 1)) }))}>+</button>
                  </div>
                </div>
                <select className="input" value={serviceDraft.cat} onChange={(e) => setServiceDraft({ ...serviceDraft, cat: e.target.value })}>
                  <option value="general">General</option>
                  <option value="premium">Premium</option>
                  <option value="quimico">Quimico</option>
                </select>
                <input className="input" placeholder="Descripción" value={serviceDraft.desc} onChange={(e) => setServiceDraft({ ...serviceDraft, desc: e.target.value })} />
                <button className="btn btn-gold btn-block" onClick={() => { saveService(); setServiceOpen(false) }}><Icon name="check" size={15} /> Crear servicio</button>
              </div>
            </div>
          </div>
        )}
    </>
  )
}
