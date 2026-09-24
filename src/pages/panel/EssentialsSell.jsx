import React, { useEffect, useMemo, useState } from 'react'
import { CLP } from '../../data.js'
import { METHODS } from '../../components/ChargeSheet.jsx'
import {
  ModuleHeader, Card, List, ListRow, Button, Chip, EmptyState, SearchField, Sheet,
  ChoiceGrid, Field, InlineAlert, ToggleRow, Note, Avatar,
} from '../../components/panel/index.js'
import { Icon } from '../../components/ui.jsx'
import '../../styles/panel/essentials.css'

/* Essentials → «Vender»: venta de productos en el mesón, sin reserva.

   Acá hay un solo barbero y nada se reparte: la venta es plata de la casa y
   queda en la Caja del día como una venta de productos, aparte de los
   servicios, para que el arqueo y el stock cuadren. Muestra solo lo vendible
   (publicado, no archivado y con stock: GET /api/services?scope=shop&for=venta,
   `ctx.sellable`) y registra con POST /api/bookings?mode=sale sin reserva
   (`ctx.registerSale`). El precio y el 30% los decide el servidor: acá solo se
   muestra la cuenta que va a hacer.

   30% de fidelidad: beneficio permanente desde las 5 estrellas de la tarjeta
   (no gasta estrellas). Se ofrece solo si se elige un cliente que ya lo tiene
   según su saldo, y el servidor lo vuelve a verificar con el puente en el
   momento: si PimpStudio no responde, la venta vuelve con un error (503) y se
   puede cobrar sin el descuento.

   Props: ctx; embedded (true dentro del Segmented de EssentialsTab, que ya
   dibuja el ModuleHeader); saleFor/onSaleForChange para que EssentialsTab
   abra la hoja desde su acción primaria (sin ellos, el estado es interno). */

const DISCOUNT_STARS = 5
const DISCOUNT_PCT = 30
const LOW_STOCK = 2

// El servidor rechaza "cortesía" en una venta de productos: un producto que
// sale del mesón se cobra.
const SALE_METHODS = METHODS.filter(([id]) => id !== 'cortesia')

// Mismo redondeo que api/bookings.js (?mode=sale): por unidad, después × cantidad.
const unitAfter = (price, pct) => Math.round((Number(price) || 0) * (100 - pct) / 100)

function discountOf(loyalty) {
  if (!loyalty) return { known: false, ready: false, pct: DISCOUNT_PCT, stars: 0, missing: DISCOUNT_STARS }
  const stars = Number(loyalty.stars) || 0
  const ready = loyalty.productDiscountReady === true || stars >= DISCOUNT_STARS
  return {
    known: true,
    ready,
    pct: Number(loyalty.productDiscountPct) || DISCOUNT_PCT,
    stars,
    missing: Math.max(0, DISCOUNT_STARS - stars),
  }
}

function fmtPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  return d.length === 9 ? `+56 ${d[0]} ${d.slice(1, 5)} ${d.slice(5)}` : String(phone || '')
}

function ProductThumb({ product }) {
  const src = product.photo || product.imgFront
  return (
    <span className="pn-thumb">
      {src ? <img src={src} alt="" loading="lazy" /> : <Icon name="gift" size={18} />}
    </span>
  )
}

function StarsChip({ loyalty }) {
  if (!loyalty) return null
  const d = discountOf(loyalty)
  return <Chip tone={d.ready ? 'ok' : 'muted'} icon="star">{d.stars}</Chip>
}

/* Cliente opcional de la venta: solo hace falta para el 30%. Busca en la
   lista de clientes del panel (ctx.clients) por nombre o teléfono. */
function ClientPicker({ clients, value, onChange, disabled }) {
  const [q, setQ] = useState('')
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (t.length < 2) return []
    const digits = t.replace(/\D/g, '')
    return clients
      .filter((c) => String(c.name || '').toLowerCase().includes(t) || (digits.length >= 3 && String(c.phone || '').includes(digits)))
      .slice(0, 5)
  }, [q, clients])

  if (value) {
    return (
      <div className="pn-card is-flush pn-ess-inset">
        <List>
          <ListRow
            lead={<Avatar name={value.name} size={36} />}
            title={value.name || 'Sin nombre'}
            titleWrap
            subtitle={fmtPhone(value.phone)}
            trailing={<StarsChip loyalty={value.loyalty} />}
            actions={<Button variant="plain" size="sm" onClick={() => onChange(null)} disabled={disabled}>Quitar</Button>}
          />
        </List>
      </div>
    )
  }

  return (
    <div className="pn-stack">
      <SearchField value={q} onChange={setQ} placeholder="Nombre o teléfono" ariaLabel="Buscar cliente" />
      {matches.length > 0 && (
        <div className="pn-card is-flush pn-ess-inset">
          <List>
            {matches.map((c) => (
              <ListRow
                key={c.id ?? c.phone}
                lead={<Avatar name={c.name} size={36} />}
                title={c.name || 'Sin nombre'}
                titleWrap
                subtitle={fmtPhone(c.phone)}
                trailing={<StarsChip loyalty={c.loyalty} />}
                onClick={() => { onChange(c); setQ('') }}
              />
            ))}
          </List>
        </div>
      )}
      {q.trim().length >= 2 && matches.length === 0 && (
        <span className="pn-field-hint">Ningún cliente coincide con “{q.trim()}”.</span>
      )}
    </div>
  )
}

function SaleSheet({ open, onClose, sellable, initialId, registerSale, pushToast, clients, onSold }) {
  const [lines, setLines] = useState([])
  const [method, setMethod] = useState('efectivo')
  const [ref, setRef] = useState('')
  const [client, setClient] = useState(null)
  const [useDiscount, setUseDiscount] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const byId = useMemo(() => new Map(sellable.map((p) => [p.id, p])), [sellable])

  // Al abrir: arranca con el producto elegido (o vacía, desde el encabezado).
  useEffect(() => {
    if (!open) return
    setLines(initialId != null && byId.has(initialId) ? [{ productId: initialId, qty: 1 }] : [])
    setMethod('efectivo'); setRef(''); setClient(null); setUseDiscount(false); setError(''); setBusy(false)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const disc = discountOf(client?.loyalty)
  const pct = client && useDiscount && disc.ready ? disc.pct : 0
  const listTotal = lines.reduce((n, l) => n + (Number(byId.get(l.productId)?.price) || 0) * l.qty, 0)
  const total = lines.reduce((n, l) => n + unitAfter(byId.get(l.productId)?.price, pct) * l.qty, 0)
  const units = lines.reduce((n, l) => n + l.qty, 0)
  const refLabel = SALE_METHODS.find(([id]) => id === method)?.[3] || null
  const others = sellable.filter((p) => !lines.some((l) => l.productId === p.id))

  const changeQty = (id, delta) => setLines((cur) => cur.flatMap((l) => {
    if (l.productId !== id) return [l]
    const max = Number(byId.get(id)?.stock) || 1
    const qty = Math.max(0, Math.min(l.qty + delta, max))
    return qty ? [{ ...l, qty }] : []
  }))

  const pickClient = (c) => {
    setClient(c)
    setError('')
    // Si ya tiene el 30%, se ofrece prendido: es lo que el cliente espera.
    setUseDiscount(Boolean(c && discountOf(c.loyalty).ready))
  }

  const submit = async () => {
    if (!lines.length || busy) return
    setBusy(true); setError('')
    const sale = await registerSale({
      clientId: client?.id ?? undefined,
      products: lines,
      paymentMethod: method,
      paymentRef: refLabel ? ref.trim() : '',
      applyLoyaltyDiscount: pct > 0,
    })
    setBusy(false)
    if (!sale?.ok) { setError(sale?.error || 'No se pudo registrar la venta.'); return }
    const charged = sale.sale?.total ?? total
    const off = Number(sale.sale?.discountPct) || 0
    pushToast?.('✓', `Venta registrada · ${CLP(charged)}${off ? ` (con ${off}% de fidelidad)` : ''}`)
    onSold?.(lines)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={busy ? undefined : onClose}
      title="Venta en el mesón"
      subtitle="Sin reserva: queda en la Caja del día"
      icon="cart"
      size="md"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!lines.length}>
            {lines.length ? `Cobrar ${CLP(total)}` : 'Cobrar'}
          </Button>
        </>
      )}
    >
      <div className="pn-stack is-lg">
        {error && <InlineAlert tone="error">{error}</InlineAlert>}

        {lines.length === 0 ? (
          <EmptyState compact icon="cart" title="Elige un producto para vender" />
        ) : (
          <div className="pn-card is-flush pn-ess-inset">
            <List>
              {lines.map((l) => {
                const p = byId.get(l.productId)
                if (!p) return null
                const unit = unitAfter(p.price, pct)
                return (
                  <ListRow
                    key={l.productId}
                    lead={<ProductThumb product={p} />}
                    title={p.name}
                    titleWrap
                    subtitle={pct ? <>{CLP(unit)} c/u <s className="pn-ess-old">{CLP(p.price)}</s> · quedan {p.stock}</> : `${CLP(p.price)} c/u · quedan ${p.stock}`}
                    subtitleWrap
                    trailing={(
                      <span className="pn-qty" onClick={(e) => e.stopPropagation()}>
                        <button type="button" aria-label={`Quitar un ${p.name}`} onClick={() => changeQty(l.productId, -1)} disabled={busy}><Icon name="minus" size={14} /></button>
                        <b className="pn-num">{l.qty}</b>
                        <button type="button" aria-label={`Agregar un ${p.name}`} disabled={busy || l.qty >= Number(p.stock)} onClick={() => changeQty(l.productId, 1)}><Icon name="plus" size={14} /></button>
                      </span>
                    )}
                  />
                )
              })}
            </List>
          </div>
        )}

        {others.length > 0 && (
          <Field label={lines.length ? 'Agregar otro producto' : 'Producto'}>
            <select
              className="input"
              value=""
              disabled={busy}
              onChange={(e) => { const id = Number(e.target.value); if (id) setLines((cur) => [...cur, { productId: id, qty: 1 }]) }}
            >
              <option value="">Elegir…</option>
              {others.map((p) => <option key={p.id} value={p.id}>{p.name} · {CLP(p.price)} ({p.stock} en stock)</option>)}
            </select>
          </Field>
        )}

        <Field label="Cliente" optional hint={client ? undefined : 'Solo hace falta para el 30% de fidelidad.'}>
          <ClientPicker clients={clients} value={client} onChange={pickClient} disabled={busy} />
        </Field>

        {client && (disc.ready ? (
          <div className="pn-card is-flush pn-ess-inset">
            <List>
              <ToggleRow
                title={`${disc.pct}% de fidelidad`}
                description={`Tiene ${disc.stars} estrellas. No gasta estrellas; se verifica con su tarjeta al cobrar.`}
                checked={useDiscount}
                onChange={setUseDiscount}
                disabled={busy}
              />
            </List>
          </div>
        ) : disc.known ? (
          <Note icon="star">
            {disc.missing === 1 ? 'Le falta 1 estrella' : `Le faltan ${disc.missing} estrellas`} para el {disc.pct}% en productos.
          </Note>
        ) : (
          <Note icon="info">No se pudo leer su tarjeta de fidelidad: la venta va sin descuento.</Note>
        ))}

        <Field label="Medio de pago">
          <ChoiceGrid
            ariaLabel="Medio de pago"
            value={method}
            onChange={setMethod}
            options={SALE_METHODS.map(([id, label, icon]) => ({ value: id, label, icon, disabled: busy }))}
          />
        </Field>
        {refLabel && (
          <Field label={refLabel} optional>
            <input className="input" value={ref} onChange={(e) => setRef(e.target.value.slice(0, 60))} inputMode="numeric" placeholder={refLabel} disabled={busy} />
          </Field>
        )}

        {lines.length > 0 && (
          <div className="pn-between pn-sale-total">
            <span className="pn-muted">
              Total · {units} {units === 1 ? 'unidad' : 'unidades'}{pct ? ` · ${pct}% de fidelidad` : ''}
            </span>
            <span className="pn-ess-total">
              {pct > 0 && listTotal !== total && <s className="pn-ess-old">{CLP(listTotal)}</s>}
              <b className="pn-num">{CLP(total)}</b>
            </span>
          </div>
        )}
      </div>
    </Sheet>
  )
}

export default function EssentialsSell({ ctx, embedded = false, saleFor: saleForProp, onSaleForChange }) {
  const { sellable = [], registerSale, pushToast, clients = [], setProducts } = ctx
  const [q, setQ] = useState('')
  // null = cerrada · { id } = abierta con ese producto · { id: null } = vacía
  const [ownSaleFor, setOwnSaleFor] = useState(null)
  const controlled = typeof onSaleForChange === 'function'
  const saleFor = controlled ? saleForProp : ownSaleFor
  const setSaleFor = controlled ? onSaleForChange : setOwnSaleFor

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? sellable.filter((p) => `${p.name} ${p.brand || ''} ${p.sku || ''}`.toLowerCase().includes(t)) : sellable
  }, [q, sellable])
  const units = sellable.reduce((n, p) => n + (Number(p.stock) || 0), 0)

  // El catálogo de la pestaña (ctx.products) no se recarga con la venta:
  // se le descuenta acá lo vendido para que Catálogo no muestre stock viejo.
  const onSold = (lines) => {
    if (typeof setProducts !== 'function') return
    setProducts((items) => items.map((p) => {
      const line = lines.find((l) => l.productId === p.id)
      return line ? { ...p, stock: Math.max(0, (Number(p.stock) || 0) - line.qty) } : p
    }))
  }

  return (
    <div className="pn-page">
      {!embedded && (
        <ModuleHeader
          title="Essentials"
          subtitle={sellable.length ? `${sellable.length} ${sellable.length === 1 ? 'producto' : 'productos'} · ${units} en stock` : 'Productos para vender en el mesón'}
          primary={sellable.length ? { label: 'Vender', icon: 'cart', onClick: () => setSaleFor({ id: null }) } : undefined}
        />
      )}
      {sellable.length > 4 && <SearchField value={q} onChange={setQ} placeholder="Buscar producto" />}
      <Card flush title={embedded ? 'Vender en el mesón' : undefined} subtitle={embedded ? 'Productos publicados y con stock' : undefined}>
        {sellable.length === 0 ? (
          <EmptyState
            icon="gift"
            title="No hay productos para vender"
            text="Acá aparecen los productos publicados y con stock. Cárgalos en Catálogo o declara una compra en Inventario."
          />
        ) : list.length === 0 ? (
          <EmptyState compact icon="search" title={`Sin resultados para “${q.trim()}”`} />
        ) : (
          <List>
            {list.map((p) => {
              const low = Number(p.stock) <= LOW_STOCK
              return (
                <ListRow
                  key={p.id}
                  lead={<ProductThumb product={p} />}
                  title={p.name}
                  titleWrap
                  subtitle={<>{CLP(p.price)} · <span className={low ? 'pn-warn-text' : undefined}>{low ? `Quedan ${p.stock}` : `${p.stock} en stock`}</span></>}
                  actions={<Button variant="secondary" size="sm" icon="cart" onClick={() => setSaleFor({ id: p.id })}>Vender</Button>}
                />
              )
            })}
          </List>
        )}
      </Card>
      <SaleSheet
        open={Boolean(saleFor)}
        onClose={() => setSaleFor(null)}
        sellable={sellable}
        initialId={saleFor?.id ?? null}
        registerSale={registerSale}
        pushToast={pushToast}
        clients={Array.isArray(clients) ? clients : []}
        onSold={onSold}
      />
    </div>
  )
}
