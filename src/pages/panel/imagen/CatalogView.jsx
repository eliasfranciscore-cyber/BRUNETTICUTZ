import React, { useEffect, useMemo, useState } from 'react'
import {
  Card, DataTable, Button, Field, Sheet, Chip, EmptyState, SkeletonRows, InlineAlert, ConfirmDialog, ActionMenu, FilterChips,
  SearchField, List, ToggleRow, Note,
} from '../../../components/panel/index.js'
import {
  CATEGORIES, CATEGORY_GROUPS, HOLDS, SHINES, HAIR_TYPES, THICKNESSES, CONDITIONS, PRODUCT_NEEDS, labelOf,
} from '../../../imagen/vocab.js'
import { photoToJpeg } from '../../../imagen/photo.js'
import { API, clp, fmtStamp } from './shared.jsx'

/* Catálogo de Image Studio: los productos que la app puede sugerir (peinado,
   champú, acondicionador) con sus atributos verificados. Regla del
   documento: nada se inventa — los productos los carga Bruno, o se importan
   desde Essentials (los que se venden en la barbería, con su precio y stock). */

const groupOf = (category) => CATEGORIES.find((c) => c.id === category)?.group || 'peinado'
const EMPTY = {
  name: '', brand: '', category: 'pomada', description: '', hold: '', shine: '', amount: '', application: '', usage: '', frequency: '',
  hairTypes: [], thickness: [], conditions: [], needs: [], soldHere: false, productId: null, price: '', buyUrl: '', active: true,
}

export default function CatalogView({ call, toast }) {
  const [products, setProducts] = useState(null)
  const [error, setError] = useState('')
  const [group, setGroup] = useState('todos')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [importing, setImporting] = useState(false)

  const load = () => call(`${API}&catalog=1`).then((json) => setProducts(json.products || [])).catch((err) => { setError(err.message); setProducts([]) })
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (products || []).filter((p) => (group === 'todos' || groupOf(p.category) === group)
      && (!q || [p.name, p.brand].some((v) => String(v || '').toLowerCase().includes(q))))
  }, [products, group, query])

  const upsert = (p) => setProducts((list) => [p, ...list.filter((x) => x.id !== p.id)])
  const pending = (products || []).filter((p) => p.active && !p.reviewedAt).length

  const columns = [
    { key: 'name', label: 'Producto', strong: true, render: (p) => [p.brand, p.name].filter(Boolean).join(' ') },
    { key: 'cat', label: 'Categoría', render: (p) => labelOf(CATEGORIES, p.category) },
    { key: 'where', label: 'Venta', render: (p) => (p.soldHere ? <Chip tone="ok">En la barbería{p.price ? ` · ${clp(p.price)}` : ''}</Chip> : <Chip tone="muted">Solo recomendado</Chip>) },
    { key: 'rev', label: 'Revisado', muted: true, nowrap: true, render: (p) => (p.reviewedAt ? fmtStamp(p.reviewedAt) : <Chip tone="warn" dot>Por revisar</Chip>) },
    { key: 'state', label: '', render: (p) => (p.active ? null : <Chip tone="muted">Inactivo</Chip>) },
  ]

  return (
    <>
      {error && <InlineAlert tone="warn" onClose={() => setError('')}>{error}</InlineAlert>}
      <Note icon="info">La app solo sugiere productos de esta lista y nunca inventa marcas, precios ni propiedades. Marca cada producto como revisado cuando confirmes sus datos.</Note>
      <div className="pn-stack">
        <div className="pn-img-catbar">
          <SearchField value={query} onChange={setQuery} placeholder="Nombre o marca" ariaLabel="Buscar productos" />
          <Button variant="secondary" icon="download" onClick={() => setImporting(true)}>Importar de Essentials</Button>
          <Button variant="primary" icon="plus" onClick={() => setEditing({ ...EMPTY })}>Producto</Button>
        </div>
        <FilterChips ariaLabel="Filtrar por tipo" value={group} onChange={setGroup}
          options={[{ value: 'todos', label: 'Todos', count: products?.length || 0 }, ...CATEGORY_GROUPS.map((g) => ({ value: g.id, label: g.label, count: (products || []).filter((p) => groupOf(p.category) === g.id).length }))]} />
        {pending > 0 && <p className="pn-img-muted">{pending} producto{pending === 1 ? '' : 's'} por revisar.</p>}
      </div>
      <Card flush>
        {products === null ? <SkeletonRows rows={4} /> : (
          <DataTable
            ariaLabel="Catálogo de Image Studio"
            columns={columns}
            rows={filtered}
            rowDim={(p) => !p.active}
            onRowClick={(p) => setEditing({ ...EMPTY, ...p, price: p.productId ? '' : (p.price ?? '') })}
            mobile={(p) => ({
              title: [p.brand, p.name].filter(Boolean).join(' '),
              subtitle: `${labelOf(CATEGORIES, p.category)} · ${p.soldHere ? `En la barbería${p.price ? ` ${clp(p.price)}` : ''}` : 'Solo recomendado'}`,
              children: !p.reviewedAt ? <span className="pn-row-chips"><Chip tone="warn" dot>Por revisar</Chip></span> : null,
              chevron: true,
            })}
            empty={<EmptyState icon="box" title="El catálogo está vacío" text="Importa los productos que vendes en Essentials o agrega los que recomiendas. Sin catálogo, la app avisa en vez de sugerir productos."
              action={{ label: 'Importar de Essentials', icon: 'download', onClick: () => setImporting(true) }} />}
          />
        )}
      </Card>

      <ProductSheet product={editing} onClose={() => setEditing(null)} call={call} toast={toast}
        onSaved={(p) => { upsert(p); setEditing(null) }}
        onRemoved={(res, id) => { if (res.deleted) setProducts((l) => l.filter((x) => x.id !== id)); else if (res.product) upsert(res.product); setEditing(null) }} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} call={call} toast={toast}
        onDone={(list) => { setProducts(list); setImporting(false) }} />
    </>
  )
}

function Tags({ options, value, onChange }) {
  return (
    <div className="pn-img-tags">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button key={o} type="button" aria-pressed={on} className={`pn-img-tagbtn${on ? ' is-on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>{o}</button>
        )
      })}
    </div>
  )
}

function ProductSheet({ product, onClose, call, toast, onSaved, onRemoved }) {
  const open = Boolean(product)
  const [p, setP] = useState(product || EMPTY)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  useEffect(() => { if (product) { setP(product); setError('') } }, [product])
  const set = (patch) => setP((cur) => ({ ...cur, ...patch }))
  const group = groupOf(p.category)
  const isStyling = group === 'peinado'

  const save = async (reviewed = false) => {
    setBusy(reviewed ? 'review' : 'save'); setError('')
    try {
      const body = { ...p, reviewed, price: p.productId ? null : p.price }
      const json = await call(p.id ? `${API}&catalog=1&pid=${p.id}` : `${API}&catalog=1`, { method: p.id ? 'PATCH' : 'POST', body })
      toast('✓', reviewed ? 'Producto guardado y revisado' : 'Producto guardado')
      onSaved(json.product)
    } catch (err) { setError(err.message) } finally { setBusy('') }
  }
  const onPhoto = async (file) => {
    if (!file || !p.id) return
    setBusy('photo'); setError('')
    try {
      const dataUrl = await photoToJpeg(file)
      const json = await call(`${API}&catalog=1&upload=1`, { method: 'POST', body: { pid: p.id, dataUrl } })
      set({ imgUrl: json.product.imgUrl })
    } catch (err) { setError(err.message) } finally { setBusy('') }
  }
  const remove = async () => {
    setBusy('delete')
    try {
      const json = await call(`${API}&catalog=1&pid=${p.id}`, { method: 'DELETE' })
      toast('🗑️', json.deleted ? 'Producto eliminado' : 'Producto desactivado (ya se recomendó en una asesoría)')
      setConfirmDel(false)
      onRemoved(json, p.id)
    } catch (err) { setError(err.message) } finally { setBusy('') }
  }

  return (
    <>
      <Sheet open={open} onClose={() => !busy && onClose()} size="lg" icon="box"
        title={p.id ? [p.brand, p.name].filter(Boolean).join(' ') || 'Producto' : 'Nuevo producto'}
        subtitle={p.reviewedAt ? `Revisado el ${fmtStamp(p.reviewedAt)}` : 'Sin revisar'}
        headActions={p.id ? <ActionMenu label="Más opciones" items={[{ label: 'Eliminar producto', icon: 'trash', danger: true, onClick: () => setConfirmDel(true) }]} /> : null}
        footer={(
          <>
            <Button variant="secondary" onClick={() => save(false)} loading={busy === 'save'} disabled={Boolean(busy) || !p.name.trim()}>Guardar</Button>
            <Button variant="primary" icon="check" onClick={() => save(true)} loading={busy === 'review'} disabled={Boolean(busy) || !p.name.trim()}>Guardar como revisado</Button>
          </>
        )}>
        <div className="pn-form">
          {error && <InlineAlert tone="error" onClose={() => setError('')}>{error}</InlineAlert>}
          <div className="pn-form-row">
            <Field label="Nombre" htmlFor="ip-name"><input id="ip-name" className="input" maxLength={200} value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Marca" htmlFor="ip-brand" optional><input id="ip-brand" className="input" maxLength={120} value={p.brand || ''} onChange={(e) => set({ brand: e.target.value })} /></Field>
          </div>
          <div className="pn-form-row">
            <Field label="Categoría" htmlFor="ip-cat">
              <select id="ip-cat" className="input" value={p.category} onChange={(e) => set({ category: e.target.value })}>
                {CATEGORY_GROUPS.map((g) => (
                  <optgroup key={g.id} label={g.label}>
                    {CATEGORIES.filter((c) => c.group === g.id).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
            {isStyling ? (
              <div className="pn-form-row">
                <Field label="Fijación" htmlFor="ip-hold" optional>
                  <select id="ip-hold" className="input" value={p.hold || ''} onChange={(e) => set({ hold: e.target.value })}><option value="">—</option>{HOLDS.map((h) => <option key={h}>{h}</option>)}</select>
                </Field>
                <Field label="Brillo" htmlFor="ip-shine" optional>
                  <select id="ip-shine" className="input" value={p.shine || ''} onChange={(e) => set({ shine: e.target.value })}><option value="">—</option>{SHINES.map((h) => <option key={h}>{h}</option>)}</select>
                </Field>
              </div>
            ) : <span />}
          </div>
          <Field label="Descripción y atributos verificados" htmlFor="ip-desc" optional hint="Solo lo que dice el fabricante o comprobaste: nada de propiedades inventadas.">
            <textarea id="ip-desc" className="input" rows={2} maxLength={1000} value={p.description || ''} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="Tipos de cabello" hint="Vacío = sirve para todos"><Tags options={HAIR_TYPES} value={p.hairTypes} onChange={(v) => set({ hairTypes: v })} /></Field>
          <Field label="Grosor" hint="Vacío = cualquiera"><Tags options={THICKNESSES} value={p.thickness} onChange={(v) => set({ thickness: v })} /></Field>
          {!isStyling && <Field label="Condición del cuero cabelludo" optional><Tags options={CONDITIONS} value={p.conditions} onChange={(v) => set({ conditions: v })} /></Field>}
          <Field label="Indicado para" hint={isStyling ? 'Opcional en peinado' : 'Así lo encuentra la app según el diagnóstico'}><Tags options={PRODUCT_NEEDS} value={p.needs} onChange={(v) => set({ needs: v })} /></Field>
          <div className="pn-form-row">
            <Field label="Cantidad" htmlFor="ip-amount" optional><input id="ip-amount" className="input" maxLength={200} value={p.amount || ''} onChange={(e) => set({ amount: e.target.value })} placeholder="Del tamaño de una arveja" /></Field>
            <Field label="Frecuencia" htmlFor="ip-freq" optional><input id="ip-freq" className="input" maxLength={200} value={p.frequency || ''} onChange={(e) => set({ frequency: e.target.value })} placeholder="A diario" /></Field>
          </div>
          <Field label="Cómo aplicarlo" htmlFor="ip-app" optional><textarea id="ip-app" className="input" rows={2} maxLength={600} value={p.application || ''} onChange={(e) => set({ application: e.target.value })} /></Field>
          {!isStyling && <Field label="Modo de uso" htmlFor="ip-usage" optional><textarea id="ip-usage" className="input" rows={2} maxLength={600} value={p.usage || ''} onChange={(e) => set({ usage: e.target.value })} /></Field>}

          <List>
            <ToggleRow title="Se vende en la barbería" description={p.productId ? 'Atado a Essentials: el precio y el stock salen de la tienda.' : 'Si no, sale en el informe como "solo recomendado".'}
              checked={p.soldHere} onChange={(v) => set({ soldHere: v })} />
            <ToggleRow title="Activo" description="Un producto inactivo no se sugiere." checked={p.active !== false} onChange={(v) => set({ active: v })} />
          </List>
          <div className="pn-form-row">
            {!p.productId && (
              <Field label="Precio" htmlFor="ip-price" optional>
                <input id="ip-price" className="input" inputMode="numeric" value={p.price ?? ''} onChange={(e) => set({ price: e.target.value.replace(/\D/g, '') })} />
              </Field>
            )}
            <Field label="Enlace de compra" htmlFor="ip-url" optional hint="https://…">
              <input id="ip-url" className="input" type="url" maxLength={500} value={p.buyUrl || ''} onChange={(e) => set({ buyUrl: e.target.value })} />
            </Field>
          </div>
          {p.id && (
            <Field label="Foto" hint="JPEG o PNG. Sale en el informe junto al producto.">
              <label className="pn-img-catphoto">
                {p.imgUrl && /^(https:|data:|\/assets\/)/.test(p.imgUrl) ? <img src={p.imgUrl} alt="" /> : <span>Sin foto</span>}
                <input type="file" accept="image/*" disabled={Boolean(busy)} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPhoto(f) }} />
                <em>{busy === 'photo' ? 'Subiendo…' : 'Cambiar foto'}</em>
              </label>
            </Field>
          )}
        </div>
      </Sheet>
      <ConfirmDialog open={confirmDel} tone="danger" title="Eliminar producto"
        message="Si ya se recomendó en alguna asesoría, se desactiva en vez de borrarse (los informes guardados no cambian)."
        confirmLabel="Eliminar" busy={busy === 'delete'} onConfirm={remove} onCancel={() => setConfirmDel(false)} />
    </>
  )
}

function ImportSheet({ open, onClose, call, toast, onDone }) {
  const [list, setList] = useState(null)
  const [picked, setPicked] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setList(null); setPicked({}); setError('')
    call(`${API}&catalog=1&essentials=1`).then((json) => setList(json.products || [])).catch((err) => { setError(err.message); setList([]) })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const items = Object.entries(picked).filter(([, cat]) => cat).map(([productId, category]) => ({ productId: Number(productId), category }))
  const submit = async () => {
    setBusy(true); setError('')
    try {
      const json = await call(`${API}&catalog=1&import=1`, { method: 'POST', body: { items } })
      toast('✓', `${json.created} producto${json.created === 1 ? '' : 's'} importado${json.created === 1 ? '' : 's'}: completa sus atributos y márcalos revisados`, 5000)
      onDone(json.products || [])
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="md" icon="download" title="Importar de Essentials" subtitle="Elige la categoría de los que quieras recomendar"
      footer={<Button variant="primary" onClick={submit} loading={busy} disabled={!items.length}>Importar {items.length || ''}</Button>}>
      <div className="pn-stack">
        {error && <InlineAlert tone="warn">{error}</InlineAlert>}
        {list === null ? <SkeletonRows rows={4} /> : list.length === 0 ? <p className="pn-img-muted">No hay productos en Essentials.</p> : (
          <ul className="pn-img-import">
            {list.map((p) => (
              <li key={p.id} className={p.imported ? 'is-done' : ''}>
                <div>
                  <strong>{[p.brand, p.name].filter(Boolean).join(' ')}</strong>
                  <span>{clp(p.price)} · stock {p.stock}</span>
                </div>
                {p.imported ? <Chip tone="ok" icon="check">Ya está</Chip> : (
                  <select className="input" aria-label={`Categoría de ${p.name}`} value={picked[p.id] || ''} onChange={(e) => setPicked((cur) => ({ ...cur, [p.id]: e.target.value }))}>
                    <option value="">No importar</option>
                    {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
