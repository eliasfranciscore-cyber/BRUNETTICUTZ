import React from 'react'
import { Icon } from '../../components/ui.jsx'
import { CLP } from '../../data.js'
import { Panel } from './shared.jsx'

/* Pestaña «essentials» del panel interno, extraída tal cual de Dashboard.jsx
   para que cada módulo viva en su propio archivo. Recibe en `ctx` el estado
   y las acciones de Dashboard que usa (ver el objeto `dash` que arma
   Dashboard.jsx).
   Lista de productos + drawer de edición; ver también EssentialsDialogs. */
export default function EssentialsTab({ ctx }) {
  const {
    admin,
    editProductId,
    productUploading,
    products,
    saveProduct,
    setDeleteProduct,
    setEditProductId,
    setProductOpen,
    setProducts,
    uploadProductPhoto,
  } = ctx
  return (
    <>
        {admin && (
          <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
            <button className="btn btn-gold btn-block" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: ".5rem" }} onClick={() => setProductOpen(true)}>
              <Icon name="spark" size={16} /> Nuevo producto
            </button>
            <Panel title="Productos" action={<span className="chip chip-gold">{products.filter((p) => p.active !== false).length} activos</span>}>
              {products.length === 0 ? (
                <p style={{ margin: 0, color: "var(--muted)", fontSize: ".88rem" }}>Aún no hay productos. Crea el primero con el botón de arriba.</p>
              ) : (
                <div className="svc-grid">
                  {products.map((p) => (
                    <button key={p.id} type="button" className="svc-card" onClick={() => setEditProductId(p.id)}>
                      <div className="svc-card-ic" style={{ width: 36, height: 36, overflow: "hidden", padding: 0 }}>
                        {p.imgFront ? <img src={p.imgFront} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="gift" size={18} />}
                      </div>
                      <div className="svc-card-name">{p.name}</div>
                      <div className="svc-card-price">{CLP(p.price)}</div>
                      <div className="svc-card-meta"><Icon name="wallet" size={11} /> Stock {p.stock}</div>
                      <span className={p.active === false ? "chip" : "chip chip-gold"} style={{ fontSize: ".68rem" }}>{p.active === false ? "Oculto" : "Publicado"}</span>
                    </button>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        )}

        {/* DRAWER edición de producto */}
        {editProductId != null && (() => {
          const p = products.find((item) => item.id === editProductId)
          if (!p) return null
          const slots = [["imgFront", "front", "Portada"], ["imgBack", "back", "Hover"], ["imgDetail", "detail", "Detalle / modal"]]
          return (
            <div className="psn-modal is-drawer" role="dialog" aria-modal="true">
              <button className="psn-scrim" aria-label="Cerrar" onClick={() => setEditProductId(null)} />
              <div className="psn-modal-card psn-newbk psn-drawer-card">
                <button className="psn-close" onClick={() => setEditProductId(null)} aria-label="Cerrar"><Icon name="close" size={17} /></button>
                <h3><Icon name="gift" size={20} /> Editar producto</h3>

                <div style={{ display: "flex", gap: ".6rem", marginBottom: ".2rem" }}>
                  {slots.map(([field, slot, label]) => (
                    <label key={slot} style={{ flex: 1, aspectRatio: "4/5", borderRadius: 10, overflow: "hidden", position: "relative", border: "1px dashed var(--hair-2)", cursor: "pointer", background: "var(--panel)", display: "block" }}>
                      {p[field]
                        ? <img src={p[field]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--muted-2)" }}><Icon name="image" size={18} /></div>}
                      <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "2px", textAlign: "center", fontSize: ".58rem", letterSpacing: ".03em", background: "rgba(0,0,0,.55)", color: "#e6cd90" }}>
                        {productUploading === `${p.id}-${slot}` ? "Subiendo…" : label}
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadProductPhoto(p.id, slot, f) }}
                      />
                    </label>
                  ))}
                </div>

                <div className="psn-newbk-sec">
                  <label className="dk-field-lbl">Nombre</label>
                  <input className="input" value={p.name} onChange={(e) => setProducts((items) => items.map((item) => item.id === p.id ? { ...item, name: e.target.value } : item))} />
                </div>
                <div className="psn-newbk-sec">
                  <label className="dk-field-lbl">Marca</label>
                  <input className="input" value={p.brand || ""} onChange={(e) => setProducts((items) => items.map((item) => item.id === p.id ? { ...item, brand: e.target.value } : item))} />
                </div>
                <div className="psn-newbk-sec">
                  <label className="dk-field-lbl">Descripción</label>
                  <input className="input" value={p.description || ""} onChange={(e) => setProducts((items) => items.map((item) => item.id === p.id ? { ...item, description: e.target.value } : item))} />
                </div>
                <div className="psn-newbk-sec" style={{ gridTemplateColumns: "1fr 1fr", display: "grid", gap: ".5rem" }}>
                  <div><label className="dk-field-lbl">Precio</label><input className="input" inputMode="numeric" value={p.price} onChange={(e) => setProducts((items) => items.map((item) => item.id === p.id ? { ...item, price: e.target.value.replace(/\D/g, "") } : item))} /></div>
                  <div><label className="dk-field-lbl">Stock</label><input className="input" inputMode="numeric" value={p.stock} onChange={(e) => setProducts((items) => items.map((item) => item.id === p.id ? { ...item, stock: e.target.value.replace(/\D/g, "") } : item))} /></div>
                </div>
                <div className="psn-confirm-actions" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                  <button className={p.active === false ? "chip" : "chip chip-gold"} onClick={() => saveProduct({ ...p, active: p.active === false })}>{p.active === false ? "Oculto" : "Publicado"}</button>
                  <button className="btn btn-sm psn-res-delete" onClick={() => setDeleteProduct(p)}><Icon name="close" size={14} /> Eliminar</button>
                  <button className="btn btn-gold btn-sm" onClick={() => { saveProduct(p); setEditProductId(null) }}><Icon name="check" size={14} /> Guardar</button>
                </div>
              </div>
            </div>
          )
        })()}
    </>
  )
}

/* Confirmación de borrado y modal "Nuevo producto". No dependen de la pestaña
   activa (nunca lo hicieron): Dashboard los monta fuera del filtro de pestaña,
   en el mismo lugar de siempre. */
export function EssentialsDialogs({ ctx }) {
  const {
    deleteProduct,
    productDraft,
    productOpen,
    removeProduct,
    saveProduct,
    setDeleteProduct,
    setProductDraft,
    setProductOpen,
  } = ctx
  return (
    <>
        {/* CONFIRMAR ELIMINAR PRODUCTO */}
        {deleteProduct && (
          <div className="psn-modal psn-modal-top" role="alertdialog" aria-modal="true">
            <button className="psn-scrim" aria-label="Cerrar" onClick={() => setDeleteProduct(null)} />
            <div className="psn-modal-card psn-confirm">
              <span className="psn-confirm-ic"><Icon name="close" size={22} /></span>
              <h3 className="font-display">¿Eliminar “{deleteProduct.name}”?</h3>
              <p>Esta acción no se puede deshacer. El producto desaparece de inmediato del catálogo público.</p>
              <div className="psn-confirm-actions">
                <button className="btn btn-ghost btn-block" onClick={() => setDeleteProduct(null)}>Volver</button>
                <button className="btn btn-danger btn-block" onClick={() => { removeProduct(deleteProduct); setDeleteProduct(null) }}>Sí, eliminar</button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL NUEVO PRODUCTO */}
        {productOpen && (
          <div style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={() => setProductOpen(false)}>
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} />
            <div className="card" style={{ position: "relative", width: "100%", maxWidth: 420, padding: "1.6rem", display: "grid", gap: "1.1rem", zIndex: 1 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 className="font-display" style={{ margin: 0, fontSize: "1.1rem" }}>Nuevo producto</h3>
                <button style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer", padding: ".3rem" }} onClick={() => setProductOpen(false)} aria-label="Cerrar">
                  <Icon name="close" size={18} />
                </button>
              </div>
              <span className="chip" style={{ justifySelf: "start" }}>Impacta la web pública · agrega las fotos después de crearlo</span>
              <div className="admin-form-grid">
                <input className="input" placeholder="Nombre del producto" value={productDraft.name} onChange={(e) => setProductDraft({ ...productDraft, name: e.target.value })} />
                <input className="input" placeholder="Marca" value={productDraft.brand} onChange={(e) => setProductDraft({ ...productDraft, brand: e.target.value })} />
                <input className="input" placeholder="Precio (CLP)" inputMode="numeric" value={productDraft.price} onChange={(e) => setProductDraft({ ...productDraft, price: e.target.value.replace(/\D/g, "") })} />
                <input className="input" placeholder="Stock inicial" inputMode="numeric" value={productDraft.stock} onChange={(e) => setProductDraft({ ...productDraft, stock: e.target.value.replace(/\D/g, "") })} />
                <input className="input" placeholder="Descripción" value={productDraft.description} onChange={(e) => setProductDraft({ ...productDraft, description: e.target.value })} />
                <button className="btn btn-gold btn-block" onClick={async () => { await saveProduct(); setProductOpen(false) }}><Icon name="check" size={15} /> Crear producto</button>
              </div>
            </div>
          </div>
        )}
    </>
  )
}
