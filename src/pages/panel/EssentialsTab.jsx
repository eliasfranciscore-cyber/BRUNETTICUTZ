import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/ui.jsx'
import { CLP } from '../../data.js'
import { FEATURES } from '../../features.js'
import {
  ModuleHeader, Card, List, ListRow, Chip, Button, ActionMenu, Sheet, ConfirmDialog,
  Segmented, FilterChips, Field, ToggleRow, EmptyState, SearchField, Note,
} from '../../components/panel/index.js'
import InventoryModule from '../../components/InventoryModule.jsx'
import EssentialsSell from './EssentialsSell.jsx'
import '../../styles/panel/essentials.css'

/* Pestaña «essentials» del panel interno: Vender | Catálogo | Inventario.
   Solo admin (el nav la muestra solo al admin, y la venta, el catálogo y el
   inventario responden 403 al resto). Vender aparece con FEATURES.sales e
   Inventario con FEATURES.inventory; sin ninguno de los dos no hay
   segmentado, solo el catálogo.

   Un solo interruptor de visibilidad: «Publicado» = `active`. La regla
   pública de siempre sigue igual: publicado Y con stock → se ve en
   brunetticutz.cl/essentials (y se puede vender en el mesón).

   «Eliminar» archiva: sale de la tienda y de la venta, pero sus movimientos
   y ventas se conservan (el servidor solo lo borra de verdad si nunca tuvo
   ninguno; DELETE devuelve { ok, archived, deleted }).

   Las confirmaciones y la hoja de producto viven acá; EssentialsDialogs
   quedó vacío (Dashboard todavía lo monta: ver requests del port). */

const PHOTO_SLOTS = [['imgFront', 'front', 'Portada'], ['imgBack', 'back', 'Hover'], ['imgDetail', 'detail', 'Detalle']]

const digits = (v, max = 8) => String(v ?? '').replace(/\D/g, '').slice(0, max)

function ProductThumb({ product }) {
  return (
    <span className="pn-thumb">
      {product.imgFront ? <img src={product.imgFront} alt="" loading="lazy" /> : <Icon name="gift" size={18} />}
    </span>
  )
}

// En la web = publicado y con stock (la regla de /essentials).
const isOnWeb = (p) => p.active !== false && Number(p.stock) > 0

function CatalogStatusChip({ product }) {
  if (product.active === false) return <Chip tone="muted">Oculto</Chip>
  if (Number(product.stock) <= 0) return <Chip tone="warn">Sin stock</Chip>
  return <Chip tone="ok">En la web</Chip>
}

/* Crear y editar comparten esta hoja. Igual que en Servicios: crear lee y
   escribe ctx.productDraft (Dashboard.saveProduct usa el borrador cuando el
   objeto no trae id), editar usa un borrador local y arma el objeto completo
   recién al guardar. Las fotos son la excepción: se suben al elegir el
   archivo (necesitan un id ya creado), no esperan al botón Guardar. */
function ProductSheet({
  open, isEdit, product, draft, onDraftChange, stockBefore, productUploading, onUpload,
  onClose, onSave, onRequestDelete,
}) {
  const [local, setLocal] = useState(() => (product ? { ...product } : {}))

  // Se reinicia al abrir (o al cambiar de producto), NO cada vez que el
  // producto cambia de identidad: subir una foto actualiza la lista y, con
  // `product` en las dependencias, borraría lo que se venía escribiendo.
  useEffect(() => {
    if (open && isEdit) setLocal(product ? { ...product } : {})
  }, [open, isEdit, product?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = isEdit ? local : draft
  const patch = (fields) => {
    if (isEdit) setLocal((d) => ({ ...d, ...fields }))
    else onDraftChange({ ...draft, ...fields })
  }

  const price = Number(value?.price) || 0
  const oldPrice = Number(value?.oldPrice) || 0
  const canSubmit = Boolean(String(value?.name || '').trim()) && price > 0

  const submit = () => {
    if (!canSubmit) return
    if (isEdit) onSave({ ...product, ...local, id: product.id })
    else onSave()
    onClose()
  }

  const stockNow = Number(local.stock) || 0
  const stockDelta = stockBefore != null ? stockNow - Number(stockBefore) : 0
  const stockHint = !FEATURES.inventory
    ? undefined
    : stockBefore != null && String(local.stock ?? '') !== String(stockBefore)
    ? `${stockBefore} → ${stockNow}: queda un ajuste de ${stockDelta > 0 ? `+${stockDelta}` : stockDelta} en el inventario.`
    : 'Si lo cambias, queda un ajuste anotado en el inventario.'

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar producto' : 'Nuevo producto'}
      icon="gift"
      size="md"
      headActions={isEdit ? (
        <ActionMenu
          title="Producto"
          items={[{ label: 'Eliminar', icon: 'trash', danger: true, onClick: () => onRequestDelete(product) }]}
        />
      ) : undefined}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {isEdit ? 'Guardar' : 'Crear producto'}
          </Button>
        </>
      )}
    >
      <div className="pn-stack is-lg">
        {isEdit && (
          <div className="pn-ess-photos">
            {PHOTO_SLOTS.map(([field, slot, label]) => {
              const uploading = productUploading === `${product?.id}-${slot}`
              return (
                <label key={slot} className={`pn-ess-photo${uploading ? ' is-busy' : ''}`}>
                  {product?.[field]
                    ? <img src={product[field]} alt="" />
                    : <span className="pn-ess-photo-empty"><Icon name="image" size={18} /></span>}
                  <span className="pn-ess-photo-label">{uploading ? 'Subiendo…' : label}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label={`Foto: ${label}`}
                    disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f && product?.id) onUpload(product.id, slot, f) }}
                  />
                </label>
              )
            })}
          </div>
        )}

        <Field label="Nombre">
          <input className="input" value={value?.name || ''} onChange={(e) => patch({ name: e.target.value.slice(0, 200) })} />
        </Field>

        <div className="pn-form-row pn-ess-row-top">
          <Field label="Marca" optional>
            <input className="input" value={value?.brand || ''} onChange={(e) => patch({ brand: e.target.value.slice(0, 120) })} />
          </Field>
          {FEATURES.inventory && (
            <Field label="SKU" optional>
              <input className="input" value={value?.sku || ''} onChange={(e) => patch({ sku: e.target.value.slice(0, 60) })} />
            </Field>
          )}
        </div>

        <div className="pn-form-row pn-ess-row-top">
          <Field label="Precio">
            <input className="input" inputMode="numeric" value={value?.price ?? ''} onChange={(e) => patch({ price: digits(e.target.value) })} />
          </Field>
          <Field
            label="Precio anterior"
            optional
            hint={oldPrice && price && oldPrice <= price
              ? 'Es igual o menor al precio: no se va a leer como descuento.'
              : 'Se muestra tachado junto al precio, para marcar un descuento.'}
          >
            <input className="input" inputMode="numeric" value={value?.oldPrice ?? ''} onChange={(e) => patch({ oldPrice: digits(e.target.value) })} />
          </Field>
        </div>

        <Field label="Descripción" optional>
          <input className="input" value={value?.description || ''} onChange={(e) => patch({ description: e.target.value })} />
        </Field>

        {isEdit ? (
          <Field label="Stock disponible" hint={stockHint}>
            <input className="input" inputMode="numeric" value={local.stock ?? ''} onChange={(e) => patch({ stock: digits(e.target.value, 6) })} />
          </Field>
        ) : (
          <Field
            label="Stock inicial"
            optional
            hint={FEATURES.inventory ? 'Entra al inventario como saldo inicial.' : undefined}
          >
            <input className="input" inputMode="numeric" value={value?.stock ?? ''} onChange={(e) => patch({ stock: digits(e.target.value, 6) })} />
          </Field>
        )}

        {FEATURES.inventory && (
          <Field label="Costo de compra" optional hint="Por unidad. Con esto se valoriza el inventario; no se muestra en la web.">
            <input className="input" inputMode="numeric" value={value?.cost ?? ''} onChange={(e) => patch({ cost: digits(e.target.value) })} />
          </Field>
        )}

        {isEdit ? (
          <div className="pn-card is-flush pn-ess-toggles">
            <List>
              <ToggleRow
                title="Publicado"
                description={Number(local.stock) > 0
                  ? 'Se ve en brunetticutz.cl/essentials y se puede vender en el mesón.'
                  : 'Sin stock no se ve en la web ni se vende, aunque esté publicado.'}
                checked={value?.active !== false}
                onChange={(v) => patch({ active: v })}
              />
            </List>
          </div>
        ) : (
          <Note icon="info">Nace publicado: con stock, aparece altiro en brunetticutz.cl/essentials. Las fotos se suben en su ficha, una vez creado.</Note>
        )}
      </div>
    </Sheet>
  )
}

export default function EssentialsTab({ ctx }) {
  const {
    admin, deleteProduct, editProductId, essentialsView, productDraft, productOpen,
    productUploading, products, pushToast, removeProduct, saveProduct, sellable,
    setDeleteProduct, setEditProductId, setEssentialsView, setProductDraft, setProductOpen,
    setStockBefore, stockBefore, uploadProductPhoto,
  } = ctx

  const [moveOpen, setMoveOpen] = useState(false)
  const [saleFor, setSaleFor] = useState(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('todos')
  const list = Array.isArray(products) ? products : []

  const views = [
    FEATURES.sales && { value: 'vender', label: 'Vender' },
    { value: 'catalogo', label: 'Catálogo' },
    FEATURES.inventory && { value: 'inventario', label: 'Inventario' },
  ].filter(Boolean)
  const view = views.some((v) => v.value === essentialsView) ? essentialsView : 'catalogo'

  const counts = useMemo(() => ({
    todos: list.length,
    web: list.filter(isOnWeb).length,
    ocultos: list.filter((p) => p.active === false).length,
    sinStock: list.filter((p) => p.active !== false && Number(p.stock) <= 0).length,
  }), [list])

  // Con 4 productos o menos no hay buscador ni chips, así que tampoco filtro.
  // Y los chips "Sin stock" y "Ocultos" desaparecen al llegar a 0: si era el
  // filtro elegido, se vuelve a Todos en vez de dejar una lista vacía sin
  // ningún chip marcado.
  const tools = list.length > 4
  const activeFilter = !tools || (filter === 'sinStock' && !counts.sinStock) || (filter === 'ocultos' && !counts.ocultos) ? 'todos' : filter

  const shown = useMemo(() => {
    const t = tools ? q.trim().toLowerCase() : ''
    return list.filter((p) => {
      if (activeFilter === 'web' && !isOnWeb(p)) return false
      if (activeFilter === 'ocultos' && p.active !== false) return false
      if (activeFilter === 'sinStock' && !(p.active !== false && Number(p.stock) <= 0)) return false
      return !t || `${p.name} ${p.brand || ''} ${p.sku || ''}`.toLowerCase().includes(t)
    })
  }, [q, tools, activeFilter, list])

  const liveEditing = editProductId != null ? list.find((p) => p.id === editProductId) || null : null
  const sheetOpen = Boolean(productOpen) || Boolean(liveEditing)

  // Mismo motivo que en Servicios: se congela el objetivo de la hoja mientras
  // está abierta, para que cerrarla no cambie su contenido a mitad de la
  // animación de salida.
  const targetRef = useRef({ isEdit: false, product: null })
  if (sheetOpen) targetRef.current = productOpen ? { isEdit: false, product: null } : { isEdit: true, product: liveEditing }
  const target = targetRef.current

  if (!admin) {
    return (
      <div className="pn-page pn-ess-page">
        <ModuleHeader title="Essentials" />
        <EmptyState icon="lock" title="Solo un administrador ve Essentials" text="El catálogo, la venta en el mesón y el inventario son del administrador del local." />
      </div>
    )
  }

  const activeCount = list.filter((p) => p.active !== false).length
  const units = list.reduce((n, p) => n + (Number(p.stock) || 0), 0)
  const sellList = Array.isArray(sellable) ? sellable : []
  const sellUnits = sellList.reduce((n, p) => n + (Number(p.stock) || 0), 0)

  const primary = view === 'catalogo'
    ? { label: 'Producto', icon: 'plus', onClick: () => { setEditProductId(null); setProductOpen(true) } }
    : view === 'inventario'
    ? { label: 'Movimiento', icon: 'plus', onClick: () => setMoveOpen(true) }
    : sellList.length
    ? { label: 'Vender', icon: 'cart', onClick: () => setSaleFor({ id: null }) }
    : undefined

  const subtitle = view === 'catalogo'
    ? (list.length ? `${activeCount} ${activeCount === 1 ? 'publicado' : 'publicados'} de ${list.length} · ${units} en stock` : 'Sin productos todavía')
    : view === 'inventario'
    ? 'Existencias y movimientos declarados'
    : (sellList.length ? `${sellList.length} para vender · ${sellUnits} en stock` : 'Venta en el mesón, sin reserva')

  const closeProductSheet = () => { setProductOpen(false); setEditProductId(null); setStockBefore(null) }

  const confirmDelete = () => {
    const p = deleteProduct
    setDeleteProduct(null)
    setStockBefore(null)
    if (!p) return
    // removeProduct es optimista (lo saca de la lista y lo devuelve si el
    // servidor falla). Si devuelve la respuesta del DELETE, se avisa qué pasó.
    Promise.resolve(removeProduct(p)).then((r) => {
      if (!r || r.ok === false) return
      pushToast?.('✓', r.archived ? `“${p.name}” archivado: su historia queda en el inventario` : `“${p.name}” eliminado`)
    }).catch(() => {})
  }

  return (
    <div className="pn-page pn-ess-page">
      <ModuleHeader title="Essentials" subtitle={subtitle} primary={primary} />
      {views.length > 1 && (
        <Segmented
          ariaLabel="Vista de Essentials"
          full
          value={view}
          onChange={setEssentialsView}
          options={views}
        />
      )}

      {view === 'vender' && (
        <EssentialsSell ctx={ctx} embedded saleFor={saleFor} onSaleForChange={setSaleFor} />
      )}

      {view === 'catalogo' && (
        list.length === 0 ? (
          <EmptyState
            icon="gift"
            title="Todavía no hay productos"
            text="Crea el primero: con stock, aparece en brunetticutz.cl/essentials."
            action={{ label: 'Nuevo producto', icon: 'plus', onClick: () => setProductOpen(true) }}
          />
        ) : (
          <>
            {tools && (
              <>
                <SearchField value={q} onChange={setQ} placeholder="Buscar producto, marca o SKU" />
                <FilterChips
                  ariaLabel="Filtrar productos"
                  value={activeFilter}
                  onChange={setFilter}
                  options={[
                    { value: 'todos', label: 'Todos', count: counts.todos },
                    { value: 'web', label: 'En la web', count: counts.web },
                    counts.sinStock > 0 && { value: 'sinStock', label: 'Sin stock', count: counts.sinStock },
                    counts.ocultos > 0 && { value: 'ocultos', label: 'Ocultos', count: counts.ocultos },
                  ]}
                />
              </>
            )}
            <Card flush>
              {shown.length === 0 ? (
                <EmptyState compact icon="search" title={q.trim() ? `Sin resultados para “${q.trim()}”` : 'Ningún producto en este filtro'} />
              ) : (
                <List>
                  {shown.map((p) => {
                    const low = Number(p.stock) <= 0
                    const old = Number(p.oldPrice) > Number(p.price) ? Number(p.oldPrice) : 0
                    return (
                      <ListRow
                        key={p.id}
                        lead={<ProductThumb product={p} />}
                        title={p.name}
                        titleWrap
                        subtitle={(
                          <>
                            {p.brand ? `${p.brand} · ` : ''}{CLP(p.price)}
                            {old ? <> <s className="pn-ess-old">{CLP(old)}</s></> : null}
                            {' · '}
                            <span className={low ? 'pn-warn-text' : undefined}>{low ? 'sin stock' : `${p.stock} en stock`}</span>
                          </>
                        )}
                        subtitleWrap
                        trailing={<CatalogStatusChip product={p} />}
                        chevron
                        onClick={() => { setProductOpen(false); setEditProductId(p.id); setStockBefore(p.stock) }}
                      />
                    )
                  })}
                </List>
              )}
            </Card>
          </>
        )
      )}

      {view === 'inventario' && (
        <InventoryModule ctx={ctx} moveOpen={moveOpen} onCloseMove={() => setMoveOpen(false)} />
      )}

      <ProductSheet
        open={sheetOpen}
        isEdit={target.isEdit}
        product={target.product}
        draft={productDraft || {}}
        onDraftChange={setProductDraft}
        stockBefore={stockBefore}
        productUploading={productUploading}
        onUpload={uploadProductPhoto}
        onClose={closeProductSheet}
        onSave={saveProduct}
        onRequestDelete={setDeleteProduct}
      />

      <ConfirmDialog
        open={Boolean(deleteProduct)}
        tone="danger"
        icon="trash"
        title={`¿Eliminar “${deleteProduct?.name || ''}”?`}
        message="Sale de brunetticutz.cl/essentials y de la venta en el mesón. Si ya tuvo movimientos o ventas, queda archivado con toda su historia; si nunca se movió, se borra."
        confirmLabel="Sí, eliminar"
        cancelLabel="Volver"
        onCancel={() => setDeleteProduct(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

/* Antes: la confirmación de borrado y el modal "Nuevo producto", montados por
   Dashboard fuera del filtro de pestaña. Ahora viven dentro de EssentialsTab
   (ProductSheet y ConfirmDialog), así que esto no dibuja nada. Se deja
   exportado mientras Dashboard lo siga montando. */
export function EssentialsDialogs() {
  return null
}
