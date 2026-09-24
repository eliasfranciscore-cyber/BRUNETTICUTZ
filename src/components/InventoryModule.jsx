import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './ui.jsx'
import { CLP, fmtDate, santiagoDateKey } from '../data.js'
import {
  Card, DataTable, Chip, Button, Field, ChoiceGrid, Sheet, ConfirmDialog, InlineAlert, Note,
  KpiGrid, EmptyState, SkeletonRows,
} from './panel/index.js'
import '../styles/panel/essentials.css'

/* ============================================================================
   INVENTARIO — pestaña Essentials → Inventario
   ----------------------------------------------------------------------------
   products.stock ES LA VERDAD: es lo que leen y descuentan la tienda web
   (Mercado Pago) y la venta en el mesón. El libro de movimientos es la
   HISTORIA de por qué cambió. Cada escritura de stock del panel deja su
   movimiento en el mismo statement; lo que no pasó por ahí (un producto de
   antes del libro, un camino viejo) se ve acá como DESFASE = stock − suma del
   libro, y «Cuadrar» registra un 'ajuste' por esa diferencia. Nunca se
   reescribe el stock desde el libro (ver api/_products.js).

   Datos:
     GET  /api/services?scope=inventory[&productId=]
     POST /api/services?scope=inventory { productId, kind, qty, reason, unitCost? }
                                        | { productId, action:'reconcile' }

   La hoja "Declarar movimiento" la abre la acción primaria del ModuleHeader
   de EssentialsTab ("+ Movimiento", una sola por pantalla), que la controla
   con `moveOpen`/`onCloseMove`. El kardex lo abre tocar una fila, y desde ahí se
   puede declarar un movimiento de ese producto o cuadrarlo.

   Props: ctx (admin, authHeaders, pushToast, loadSellable, setProducts); los
   props sueltos, si vienen, mandan sobre ctx.
   ========================================================================= */

/* Espejo de MANUAL_MOVE_KINDS / MOVE_SIGN en api/_products.js. 'venta' la
   escriben la venta en el mesón y el webhook de la tienda, no una persona:
   declarada a mano no entraría a la Caja, así que a propósito NO es opción.
   [id, etiqueta, ayuda, pideCosto, signo, ícono] */
const MOVE_KINDS = [
  ['compra', 'Compra', 'Llegó mercadería nueva.', true, 1, 'plus'],
  ['devolucion', 'Devolución', 'Un cliente devolvió el producto.', false, 1, 'plus'],
  ['merma', 'Merma', 'Rotura, vencimiento, robo o pérdida.', false, -1, 'minus'],
  ['ajuste', 'Ajuste', 'Corrección tras contar el stock a mano.', false, 0, 'refresh'],
]

/* Palabras que delatan una salida. Si el motivo trae una de estas y el
   movimiento SUMA, se avisa: es el error típico de cargar una salida como
   Compra (cada una sumaba stock en vez de restarlo). */
const SALIDA_RE = /\b(venta|vendi|vendí|vendido|vendida|sali[oó]|salida|entreg|regal|us[eé]|usado|gast)/i

const KIND_LABELS = {
  inicial: 'Saldo inicial', compra: 'Compra', venta: 'Venta',
  devolucion: 'Devolución', merma: 'Merma', ajuste: 'Ajuste',
}

const LOW_STOCK = 3

const signed = (n) => (n > 0 ? `+${n}` : String(n))
const moveDay = (m) => fmtDate(m.date || santiagoDateKey(m.createdAt), 'dm')
const stockClass = (stock) => (stock <= 0 ? 'pn-ess-inv-bad' : stock <= LOW_STOCK ? 'pn-ess-inv-low' : undefined)

// El servidor ya manda los totales; esto es el respaldo para lo que falte
// (p. ej. `withDrift` en una respuesta más vieja).
function totalsOf(items, server = {}) {
  const computed = {
    units: items.reduce((n, p) => n + (Number(p.stock) || 0), 0),
    value: items.reduce((n, p) => n + (Number(p.value) || 0), 0),
    outOfStock: items.filter((p) => Number(p.stock) <= 0).length,
    oversold: items.filter((p) => p.oversold).length,
    withoutCost: items.filter((p) => p.cost == null).length,
    withDrift: items.filter((p) => Number(p.drift) !== 0).length,
  }
  return { ...computed, ...Object.fromEntries(Object.entries(server || {}).filter(([, v]) => v != null)) }
}

// Un solo interruptor de visibilidad (Publicado = active); lo demás es stock.
function statusOf(p) {
  if (p.archived) return ['muted', 'Archivado']
  if (p.oversold) return ['bad', 'Sobreventa']
  if (p.active === false) return ['muted', 'Oculto']
  if (Number(p.stock) <= 0) return ['warn', 'Agotado']
  return ['ok', 'Publicado']
}

function InventoryStatusChip({ product }) {
  const [tone, label] = statusOf(product)
  return <Chip tone={tone}>{label}</Chip>
}

function DriftChip({ drift }) {
  const d = Number(drift) || 0
  if (!d) return <span className="pn-muted">—</span>
  return <Chip tone="warn" title="Stock menos la suma de los movimientos">{signed(d)}</Chip>
}

async function readJson(res) {
  if (!res) return {}
  return res.json().catch(() => ({}))
}

export default function InventoryModule({ ctx = {}, admin: adminProp, authHeaders: headersProp, onStockChanged, moveOpen, onCloseMove }) {
  const admin = adminProp ?? ctx.admin
  const authHeaders = headersProp || ctx.authHeaders || ((extra) => ({ ...(extra || {}) }))
  const pushToast = ctx.pushToast
  const stockChanged = onStockChanged || ctx.loadSellable
  const setProducts = ctx.setProducts

  const [data, setData] = useState(undefined) // undefined = cargando, null = error
  const [kardex, setKardex] = useState(null)
  const [kardexOpen, setKardexOpen] = useState(false)
  const [ownMove, setOwnMove] = useState(null) // { productId } = hoja abierta desde el kardex
  const [reconcileFor, setReconcileFor] = useState(null)
  const [reconciling, setReconciling] = useState(false)

  /* authHeaders es una declaración de función en Dashboard: cambia de
     identidad en CADA render del panel. Metida en las dependencias de load(),
     relanzaría la carga del inventario cada vez que el panel se redibuja. Se
     guarda en un ref para que load() sea estable. */
  const headersRef = useRef(authHeaders)
  headersRef.current = authHeaders

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setData(undefined)
    const res = await fetch('/api/services?scope=inventory', { headers: headersRef.current() }).catch(() => null)
    const json = res && res.ok ? await res.json().catch(() => null) : null
    const items = Array.isArray(json?.items) ? json.items : Array.isArray(json?.products) ? json.products : null
    if (!json?.ok || !items) { if (!silent) setData(null); return }
    setData({ items, totals: totalsOf(items, json.totals) })
  }, [])

  useEffect(() => { load() }, [load])

  const fetchKardex = useCallback(async (product) => {
    const res = await fetch(`/api/services?scope=inventory&productId=${product.id}`, { headers: headersRef.current() }).catch(() => null)
    const json = res && res.ok ? await res.json().catch(() => null) : null
    if (!json?.ok) {
      setKardex((cur) => ({ ...(cur || {}), product, loading: false, error: true, moves: [] }))
      return
    }
    const p = { ...product, ...(json.product || {}) }
    const stock = Number(json.stock ?? p.stock ?? 0)
    const ledgerStock = Number(json.ledgerStock ?? p.ledgerStock ?? stock)
    setKardex({
      product: p,
      loading: false,
      error: false,
      moves: Array.isArray(json.moves) ? json.moves : [],
      stock,
      ledgerStock,
      drift: Number(json.drift ?? p.drift ?? stock - ledgerStock),
    })
  }, [])

  const openKardex = (product) => {
    setKardex({ product, loading: true, moves: [] })
    setKardexOpen(true)
    fetchKardex(product)
  }

  const reflectStock = (productId, stock) => {
    if (!Number.isFinite(Number(stock)) || typeof setProducts !== 'function') return
    setProducts((items) => items.map((p) => (p.id === productId ? { ...p, stock: Number(stock) } : p)))
  }

  const moveIsOpen = Boolean(moveOpen) || Boolean(ownMove)
  const closeMove = () => { setOwnMove(null); onCloseMove?.() }

  const afterMove = ({ productId, stock, delta }) => {
    closeMove()
    pushToast?.('✓', `Movimiento registrado · ${signed(delta)} · quedan ${stock}`)
    reflectStock(productId, stock)
    load({ silent: true })
    stockChanged?.() // lo vendible en el mesón y en la hoja de cobro cambió
  }

  const reconcile = async () => {
    const target = reconcileFor
    if (!target || reconciling) return
    setReconciling(true)
    const res = await fetch('/api/services?scope=inventory', {
      method: 'POST',
      headers: headersRef.current({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ productId: target.id, action: 'reconcile' }),
    }).catch(() => null)
    const json = await readJson(res)
    setReconciling(false)
    setReconcileFor(null)
    if (!res || !res.ok || json.ok === false) {
      pushToast?.('⚠️', json.error || 'No se pudo cuadrar el libro', 6000)
      return
    }
    const delta = Number(json.move?.delta ?? target.drift) || 0
    pushToast?.('✓', delta ? `Libro cuadrado · ajuste de ${signed(delta)}` : 'El libro ya cuadraba')
    load({ silent: true })
    if (kardexOpen && kardex?.product?.id === target.id) fetchKardex(kardex.product)
  }

  if (data === undefined) {
    return <Card flush><SkeletonRows rows={4} /></Card>
  }
  if (data === null) {
    return <InlineAlert tone="error" action={{ label: 'Reintentar', onClick: () => load() }}>No se pudo leer el inventario.</InlineAlert>
  }

  const { items, totals } = data
  const movable = items.filter((p) => !p.archived)

  return (
    <div className="pn-stack is-lg">
      <KpiGrid
        cols={4}
        items={[
          { id: 'units', label: 'Unidades', value: totals.units, icon: 'box', hint: 'En bodega' },
          { id: 'value', label: 'Valor al costo', value: totals.value, format: CLP, icon: 'wallet', hint: totals.withoutCost ? `${totals.withoutCost} sin costo cargado` : undefined },
          { id: 'out', label: 'Sin stock', value: totals.outOfStock, icon: 'alert', hint: totals.outOfStock ? 'No se ven en la web' : undefined, hintTone: totals.outOfStock ? 'down' : undefined },
          { id: 'drift', label: 'Con desfase', value: totals.withDrift, icon: 'refresh', hint: totals.withDrift ? 'Tócalos para cuadrar' : 'El libro cuadra', hintTone: totals.withDrift ? 'down' : undefined },
        ]}
      />

      {totals.oversold > 0 && (
        <InlineAlert tone="error" title="Stock negativo">
          {totals.oversold === 1 ? 'Un producto quedó' : `${totals.oversold} productos quedaron`} bajo cero. Declara una compra o un ajuste para dejarlo en lo que hay de verdad.
        </InlineAlert>
      )}
      {totals.withDrift > 0 && (
        <InlineAlert tone="warn" title={totals.withDrift === 1 ? 'Un producto no cuadra con su libro' : `${totals.withDrift} productos no cuadran con su libro`}>
          El stock no es igual a la suma de sus movimientos: algo lo cambió sin dejar registro. El stock manda; ábrelo y usa «Cuadrar» para dejarlo anotado.
        </InlineAlert>
      )}

      {items.length === 0 ? (
        <EmptyState icon="box" title="Todavía no hay productos cargados" text="Créalos en Catálogo: el stock inicial entra al libro como saldo inicial." />
      ) : (
        <Card flush title="Existencias" subtitle={`${items.length} ${items.length === 1 ? 'producto' : 'productos'} · toca uno para ver sus movimientos`}>
          <DataTable
            ariaLabel="Existencias"
            rows={items}
            onRowClick={openKardex}
            columns={[
              {
                key: 'name', label: 'Producto', render: (p) => (
                  <>
                    <b>{p.name}</b>
                    {p.brand ? <span className="pn-ess-inv-brand"> · {p.brand}</span> : null}
                    {p.sku ? <span className="pn-ess-inv-sku">{p.sku}</span> : null}
                  </>
                ),
              },
              { key: 'stock', label: 'Stock', num: true, render: (p) => <span className={stockClass(Number(p.stock))}>{p.stock}</span> },
              { key: 'drift', label: 'Desfase', num: true, render: (p) => <DriftChip drift={p.drift} /> },
              { key: 'cost', label: 'Costo', num: true, muted: true, render: (p) => (p.cost == null ? '—' : CLP(p.cost)) },
              { key: 'value', label: 'Valorizado', num: true, strong: true, render: (p) => (p.cost == null ? '—' : CLP(p.value)) },
              { key: 'status', label: 'Estado', render: (p) => <InventoryStatusChip product={p} /> },
            ]}
            mobile={(p) => ({
              lead: <span className="pn-thumb">{p.imgFront ? <img src={p.imgFront} alt="" loading="lazy" /> : <Icon name="box" size={16} />}</span>,
              title: p.name,
              titleWrap: true,
              // En el celular no hay columna Estado: se nombra solo lo que no es lo normal.
              subtitle: [p.brand, p.sku, statusOf(p)[1] !== 'Publicado' && statusOf(p)[1]].filter(Boolean).join(' · ') || undefined,
              value: <span className={stockClass(Number(p.stock))}>{p.stock} en stock</span>,
              meta: Number(p.drift) ? <span className="pn-ess-inv-low">desfase {signed(Number(p.drift))}</span> : (p.cost == null ? 'sin costo' : CLP(p.value)),
            })}
          />
        </Card>
      )}

      <KardexSheet
        open={kardexOpen}
        state={kardex}
        admin={admin}
        onClose={() => setKardexOpen(false)}
        onRetry={() => kardex?.product && fetchKardex(kardex.product)}
        onReconcile={(p) => setReconcileFor(p)}
        onDeclare={(p) => { setKardexOpen(false); setOwnMove({ productId: p.id }) }}
      />

      <MoveSheet
        open={moveIsOpen}
        products={movable}
        initialProductId={ownMove?.productId ?? null}
        authHeaders={authHeaders}
        onClose={closeMove}
        onDone={afterMove}
      />

      <ConfirmDialog
        open={Boolean(reconcileFor)}
        icon="refresh"
        title={`¿Cuadrar el libro de “${reconcileFor?.name || ''}”?`}
        message={reconcileFor ? `Se registra un ajuste de ${signed(Number(reconcileFor.drift) || 0)} para que los movimientos sumen lo mismo que el stock (${reconcileFor.stock}). El stock no cambia.` : ''}
        confirmLabel="Cuadrar"
        cancelLabel="Volver"
        busy={reconciling}
        onCancel={() => setReconcileFor(null)}
        onConfirm={reconcile}
      />
    </div>
  )
}

/* El kardex con SALDO CORRIDO: el número de hoy no dice nada si no se puede
   seguir cómo llegó hasta ahí. `state` se congela mientras la hoja se cierra
   para que la animación de salida no se quede sin contenido. */
function KardexSheet({ open, state, admin, onClose, onRetry, onReconcile, onDeclare }) {
  const frozen = useRef(state)
  if (open && state) frozen.current = state
  const { product, moves, loading, error, stock, ledgerStock, drift } = frozen.current || {}
  const hasDrift = !loading && !error && Number(drift) !== 0 && Number.isFinite(Number(drift))
  const withWho = Array.isArray(moves) && moves.some((m) => m.byName)

  const subtitle = loading
    ? 'Cargando…'
    : error
    ? 'Sin datos'
    : `Stock ${stock} · libro ${ledgerStock}${product?.cost != null ? ` · costo ${CLP(product.cost)}` : ''}`

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={product?.name || 'Producto'}
      subtitle={subtitle}
      icon="box"
      size="md"
      footer={admin && product && !product.archived ? (
        <>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button variant="primary" icon="plus" onClick={() => onDeclare(product)} disabled={loading}>Movimiento</Button>
        </>
      ) : undefined}
    >
      <div className="pn-stack is-lg">
        {hasDrift && (
          <InlineAlert
            tone="warn"
            title="El libro no cuadra"
            action={admin ? { label: 'Cuadrar', onClick: () => onReconcile({ ...product, stock, drift: Number(drift) }) } : undefined}
          >
            El stock dice {stock} y los movimientos suman {ledgerStock} (desfase {signed(Number(drift))}). Cuadrar registra un ajuste por la diferencia; el stock no cambia.
          </InlineAlert>
        )}
        {loading ? (
          <SkeletonRows rows={4} />
        ) : error ? (
          <InlineAlert tone="error" action={{ label: 'Reintentar', onClick: onRetry }}>No se pudieron leer los movimientos.</InlineAlert>
        ) : !moves || moves.length === 0 ? (
          <EmptyState compact icon="list" title="Sin movimientos todavía" text="Una compra, una venta o un ajuste lo dejan anotado acá." />
        ) : (
          <DataTable
            ariaLabel="Movimientos"
            rows={moves}
            rowKey={(m) => m.id}
            columns={[
              { key: 'date', label: 'Fecha', nowrap: true, render: moveDay },
              {
                key: 'kind', label: 'Movimiento', render: (m) => (
                  <>
                    <Chip>{KIND_LABELS[m.kind] || m.kind}</Chip>{m.reason ? <span className="pn-ess-inv-brand"> {m.reason}</span> : null}
                  </>
                ),
              },
              { key: 'delta', label: 'Cant.', num: true, render: (m) => <span className={m.delta < 0 ? 'pn-ess-inv-bad' : 'pn-ess-inv-ok'}>{signed(m.delta)}</span> },
              { key: 'balance', label: 'Saldo', num: true, strong: true, render: (m) => m.balance },
              withWho && { key: 'who', label: 'Quién', muted: true, render: (m) => m.byName || '—' },
            ]}
            mobile={(m) => ({
              title: KIND_LABELS[m.kind] || m.kind,
              subtitle: [moveDay(m), m.reason, m.byName].filter(Boolean).join(' · '),
              subtitleWrap: true,
              value: <span className={m.delta < 0 ? 'pn-ess-inv-bad' : 'pn-ess-inv-ok'}>{signed(m.delta)}</span>,
              meta: `saldo ${m.balance}`,
            })}
          />
        )}
      </div>
    </Sheet>
  )
}

function MoveSheet({ open, products, initialProductId, authHeaders, onClose, onDone }) {
  const [productId, setProductId] = useState(null)
  // Sin preselección: elegir el tipo es la decisión que define el signo, y
  // dejarla tomada por defecto es lo que hacía entrar salidas como compras.
  const [kind, setKind] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Stock que informó el servidor en un 409 (otro movimiento se adelantó):
  // la vista previa pasa a contar desde ahí.
  const [serverStock, setServerStock] = useState({})

  useEffect(() => {
    if (!open) return
    const preset = initialProductId != null && products.some((p) => p.id === initialProductId) ? initialProductId : products[0]?.id ?? null
    setProductId(preset)
    setKind(''); setQty(''); setReason(''); setUnitCost(''); setBusy(false); setError(''); setServerStock({})
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const meta = MOVE_KINDS.find(([id]) => id === kind)
  const product = products.find((p) => p.id === Number(productId))
  const amount = Number(String(qty).replace(/[^\d-]/g, '') || 'NaN')
  // 'ajuste' (signo 0) es el único que puede ir para los dos lados: ahí el
  // signo lo pone quien declara. En el resto lo pone el tipo.
  const sign = meta?.[4] ?? 0
  const delta = !meta || !Number.isFinite(amount) ? 0 : sign === 0 ? amount : Math.abs(amount) * sign
  const before = Number(serverStock[productId] ?? product?.stock ?? 0)
  const after = before + delta
  const changes = Boolean(meta) && delta !== 0
  const valid = Boolean(product && meta && changes && reason.trim() && after >= 0)
  // El motivo habla de una salida y el saldo sube.
  const contradicts = changes && delta > 0 && SALIDA_RE.test(reason)

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true); setError('')
    const res = await fetch('/api/services?scope=inventory', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        productId: Number(productId),
        kind,
        // Positiva salvo en 'ajuste': el signo lo pone el tipo en el servidor
        // (MOVE_SIGN), igual que acá.
        qty: sign === 0 ? delta : Math.abs(delta),
        reason: reason.trim(),
        unitCost: meta?.[3] && unitCost ? Number(unitCost) : null,
      }),
    }).catch(() => null)
    const data = await readJson(res)
    setBusy(false)
    if (!res || !res.ok || data.ok === false) {
      if (res?.status === 409 && Number.isFinite(Number(data.stock))) {
        setServerStock((cur) => ({ ...cur, [productId]: Number(data.stock) }))
      }
      setError(data.error || 'No se pudo registrar el movimiento.')
      return
    }
    onDone({ productId: Number(productId), stock: Number(data.stock ?? after), delta: Number(data.move?.delta ?? delta), move: data.move })
  }

  return (
    <Sheet
      open={open}
      onClose={busy ? undefined : onClose}
      title="Declarar movimiento"
      subtitle="Todo cambio de stock queda registrado con su motivo"
      icon="box"
      size="md"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!valid}>Registrar</Button>
        </>
      )}
    >
      <div className="pn-stack is-lg">
        {products.length === 0 ? (
          <EmptyState compact icon="box" title="No hay productos para mover" text="Crea uno en Catálogo primero." />
        ) : (
          <>
            <Field label="Producto">
              <select className="input" value={productId ?? ''} onChange={(e) => { setProductId(Number(e.target.value)); setError('') }} disabled={busy}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} — stock {serverStock[p.id] ?? p.stock}</option>)}
              </select>
            </Field>

            <Field label="Tipo" hint={meta?.[2] || 'Elige el tipo: es lo que decide si el stock sube o baja.'}>
              <ChoiceGrid
                ariaLabel="Tipo de movimiento"
                value={kind}
                onChange={(v) => { setKind(v); setError('') }}
                options={MOVE_KINDS.map(([id, label, , , , icon]) => ({ value: id, label, icon, disabled: busy }))}
              />
            </Field>
            <Note icon="info">Una venta no se declara acá: se anota sola al cobrar en el mesón o cuando se paga en la tienda web.</Note>

            <Field
              label={kind === 'ajuste' ? 'Cantidad (usa −5 para descontar)' : 'Cantidad'}
              error={product && changes && after < 0 ? `No alcanza: hay ${before} y quedaría en ${after}.` : undefined}
            >
              <input
                className="input"
                inputMode={kind === 'ajuste' ? 'text' : 'numeric'}
                value={qty}
                disabled={busy}
                onChange={(e) => setQty(e.target.value.replace(kind === 'ajuste' ? /[^\d-]/g : /\D/g, '').replace(/(?!^)-/g, '').slice(0, 7))}
              />
            </Field>
            {product && changes && after >= 0 && (
              <div className={`pn-ess-preview ${delta > 0 ? 'is-up' : 'is-down'}`}>
                <span>{before}</span><b>→</b><span>{after}</span>
                <em>{delta > 0 ? `entran ${delta}` : `salen ${Math.abs(delta)}`}</em>
              </div>
            )}

            {meta?.[3] && (
              <Field label="Costo unitario" optional hint="Con esto se valoriza el inventario. Pasa a ser el costo de referencia del producto.">
                <input className="input" inputMode="numeric" value={unitCost} disabled={busy} onChange={(e) => setUnitCost(e.target.value.replace(/\D/g, '').slice(0, 8))} />
              </Field>
            )}

            <Field label="Motivo">
              <input className="input" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value.slice(0, 200))} placeholder="Obligatorio" />
            </Field>

            {contradicts && (
              <InlineAlert tone="warn">
                El motivo dice que algo salió, pero este movimiento suma {delta} al stock. ¿Querías Merma, o un Ajuste en negativo?
              </InlineAlert>
            )}
            {error && <InlineAlert tone="error">{error}</InlineAlert>}
          </>
        )}
      </div>
    </Sheet>
  )
}
