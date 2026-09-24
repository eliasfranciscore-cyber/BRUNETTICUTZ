import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './ui.jsx'
import { CLP, loyaltyFromStars } from '../data.js'
import { FEATURES } from '../features.js'
import { Sheet, Field, SectionLabel, List, ListRow, Button, ChoiceGrid, ToggleRow, EmptyState, SearchField, useIsPhone } from './panel/index.js'
import '../styles/panel/booking-sheets.css'

/**
 * ChargeSheet — cobrar una reserva al completarla, con o sin productos.
 *
 * Completar una atención es cobrarla: queda anotado cuánto entró y cómo (el
 * medio y, si el medio deja uno, el n.º del comprobante), que es lo que la
 * Caja del día necesita para cuadrar contra la máquina y la transferencia.
 *
 * LA INVARIANTE, hecha interfaz: el campo editable "Cobrado por el servicio"
 * es SOLO el servicio. La plata de los productos se suma aparte y viaja en su
 * propia venta (POST ?mode=sale, que además descuenta el stock): el servicio
 * se registra en la reserva y los productos en su venta, así la Caja separa
 * servicios de productos y el stock de Essentials cuadra con lo vendido. Por
 * eso el desglose se muestra siempre que haya productos: el total que se le
 * pide al cliente es uno, los dos montos que se registran son dos.
 *
 * Cuatro modos:
 *  'cobrar'    completar una reserva: servicio (+ productos)
 *  'corregir'  arreglar un cobro ya hecho (desde Caja). Solo el servicio: los
 *              productos de esa atención son ventas aparte y se anulan en su
 *              propia fila.
 *  'confirmar' una atención que se completó sola (autocompletar): el monto
 *              viene precargado y falta decir cómo se pagó
 *  'productos' vender productos sobre una atención YA cerrada: el cliente
 *              vuelve al mesón por una cera.
 * La sección Productos solo aparece con FEATURES.sales y si hay algo con
 * stock; sin productos, el texto es "Carga stock en Essentials para vender acá".
 *
 * Props:
 *  open        boolean — Dashboard la deja montada y la abre/cierra con esto
 *  booking     la reserva (o la fila de Caja) que se cobra
 *  mode        'cobrar' (default) | 'corregir' | 'confirmar' | 'productos'
 *  loyalty     { productDiscountReady, productDiscountPct } | null
 *              (o el saldo del puente { stars }: el 30% se deriva de ahí)
 *  products    catálogo vendible [{ id, name, price, stock, photo }]
 *  onClose()   cancelar: Dashboard resuelve la promesa con null
 *  onSubmit({ paidAmount, paymentMethod, paymentRef, products, applyLoyaltyDiscount })
 *              paidAmount es null en modo 'productos'; products es
 *              [{ productId, qty }] y viaja en su propia venta.
 *
 * Al cerrar, Dashboard pone `open` en false y `booking` en null en el mismo
 * render. La hoja se queda dibujando la última reserva durante su animación
 * de salida (Sheet la juega sola con `open`), en vez de vaciarse de golpe.
 */

const cx = (...parts) => parts.filter(Boolean).join(' ')

/* Espejo de PAYMENT_METHODS / PAYMENT_LABELS / PAYMENT_REF_LABELS de
   api/_money.js (el servidor rechaza cualquier otro medio). Caja y "Sin
   cerrar" los importan de acá.
   'tarjeta' cubre débito y crédito: en el mesón es la misma máquina y la
   distinción no cambia el arqueo.
   'mercadopago' es Mercado Pago en el mesón (QR o link); lo que se paga en
   la web (Cursos, Workshop, Essentials) es otra línea de Caja, "Online".
   'cortesia' cubre el canje de fidelidad y el corte de la casa: monto 0
   registrado a propósito, distinto de "todavía no se cobró".
   El cuarto campo es la etiqueta del comprobante, o null si ese medio no
   deja ninguno: el efectivo no deja rastro que anotar. */
export const METHODS = [
  ['efectivo', 'Efectivo', 'wallet', null],
  ['tarjeta', 'Tarjeta', 'wallet', 'N.º de boleta'],
  ['transferencia', 'Transferencia', 'check', 'N.º de operación'],
  ['mercadopago', 'Mercado Pago', 'spark', 'N.º de operación'],
  ['cortesia', 'Cortesía', 'gift', null],
]

const REF_LABELS = Object.fromEntries(METHODS.map(([id, , , ref]) => [id, ref]))

export const PAYMENT_LABELS = Object.fromEntries(METHODS.map(([id, label]) => [id, label]))

const MODES = new Set(['cobrar', 'corregir', 'confirmar', 'productos'])

/* El 30% en productos: con el resumen del puente (productDiscountReady) o,
   si solo llegó el saldo, derivado de las estrellas con las mismas reglas
   del programa (loyaltyFromStars). El servidor lo vuelve a verificar. */
function discountPctOf(loyalty) {
  if (!loyalty) return 0
  const summary = loyalty.productDiscountReady == null && Number.isFinite(Number(loyalty.stars))
    ? loyaltyFromStars(loyalty.stars)
    : loyalty
  return summary.productDiscountReady ? Number(summary.productDiscountPct || 0) : 0
}

export default function ChargeSheet({ open, booking, mode = 'cobrar', loyalty = null, products = [], onClose, onSubmit }) {
  const isPhone = useIsPhone()
  const amountRef = useRef(null)

  // Lo último que se abrió: sigue a la vista mientras la hoja se va.
  const lastRef = useRef({ booking: null, mode: 'cobrar', loyalty: null })
  if (open && booking) lastRef.current = { booking, mode: MODES.has(mode) ? mode : 'cobrar', loyalty }
  const { booking: bk, mode: md, loyalty: ly } = lastRef.current
  const shown = Boolean(open && booking)

  const onlyProducts = md === 'productos'
  const listed = Number(bk?.price ?? 0)
  const sellable = Array.isArray(products) ? products : []
  // Corregir es solo el servicio. En 'productos' la sección va siempre (es de
  // lo que se trata la hoja); en los otros modos, solo si hay algo que vender.
  const sellsProducts = FEATURES.sales && md !== 'corregir' && (onlyProducts || sellable.length > 0)

  const [amount, setAmount] = useState(String(listed))
  const [method, setMethod] = useState(listed === 0 ? 'cortesia' : 'efectivo')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState([])      // [{ productId, qty }]
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [useDiscount, setUseDiscount] = useState(false)

  /* Al abrir (o si cambia la reserva o el modo con la hoja abierta) se parte
     de cero. Al corregir se precarga lo ya registrado; al cobrar y al
     confirmar, el precio de la reserva como propuesta. En layout effect para
     que no se alcance a ver ni un cuadro con los datos del cobro anterior. */
  useLayoutEffect(() => {
    if (!shown) return
    const price = Number(bk?.price ?? 0)
    const paid = bk?.paidAmount
    setAmount(String(paid != null ? paid : price))
    // Productos sobre un corte gratis (reserva en $0, cobrada como cortesía):
    // la venta nueva no hereda la cortesía, se cobra.
    const prev = PAYMENT_LABELS[bk?.paymentMethod] && !(md === 'productos' && bk.paymentMethod === 'cortesia') ? bk.paymentMethod : null
    setMethod(prev || (price === 0 && md !== 'productos' ? 'cortesia' : 'efectivo'))
    setRef(bk?.paymentRef || '')
    setLines([])
    setPicking(false)
    setQuery('')
    setUseDiscount(false)
    setBusy(false)
  }, [shown, bk?.id, md]) // eslint-disable-line react-hooks/exhaustive-deps

  const refLabel = REF_LABELS[method] || null
  const byId = useMemo(() => new Map(sellable.map((p) => [p.id, p])), [sellable])

  const discountPct = discountPctOf(ly)
  const unitPriceOf = (p) => (useDiscount && discountPct ? Math.round(p.price * (100 - discountPct) / 100) : p.price)

  // Solo las líneas cuyo producto sigue en el catálogo vendible (se recarga
  // tras cada venta): una que desapareció no se cobra ni se manda.
  const liveLines = lines.filter((l) => byId.has(l.productId))
  const productsTotal = liveLines.reduce((n, l) => n + unitPriceOf(byId.get(l.productId)) * l.qty, 0)
  const unitsCount = liveLines.reduce((n, l) => n + l.qty, 0)

  const parsed = Number(String(amount).replace(/\D/g, ''))
  const serviceAmount = onlyProducts ? 0 : parsed
  const validService = onlyProducts || (String(amount).trim() !== '' && Number.isFinite(parsed) && parsed >= 0)
  const valid = validService && (!onlyProducts || liveLines.length > 0)
  const diff = validService && !onlyProducts ? parsed - listed : 0

  const hint = useMemo(() => {
    if (onlyProducts || !validService) return null
    if (diff === 0) return null
    if (diff < 0) return `Se cobra ${CLP(Math.abs(diff))} menos que el precio de la reserva (${CLP(listed)}).`
    return `Se cobra ${CLP(diff)} más que el precio de la reserva (${CLP(listed)}).`
  }, [diff, validService, listed, onlyProducts])

  const addLine = (product) => {
    setLines((cur) => cur.some((l) => l.productId === product.id)
      ? cur.map((l) => (l.productId === product.id ? { ...l, qty: Math.min(l.qty + 1, product.stock) } : l))
      : [...cur, { productId: product.id, qty: 1 }])
    setPicking(false)
    setQuery('')
  }

  const changeQty = (productId, delta) => {
    setLines((cur) => cur.flatMap((l) => {
      if (l.productId !== productId) return [l]
      // El tope es el stock: el servidor también lo valida (409), pero dejar
      // subir el contador para después rebotar es una mentira de interfaz.
      const max = byId.get(productId)?.stock ?? 1
      const qty = Math.max(0, Math.min(l.qty + delta, max))
      return qty === 0 ? [] : [{ ...l, qty }]
    }))
  }

  const pickable = sellable.filter((p) => {
    if (liveLines.some((l) => l.productId === p.id && l.qty >= p.stock)) return false
    const q = query.trim().toLowerCase()
    return !q || `${p.name} ${p.brand || ''} ${p.sku || ''}`.toLowerCase().includes(q)
  })

  const cancel = () => { if (!busy) onClose?.() }

  const submit = () => {
    if (!valid || busy) return
    setBusy(true)
    // El comprobante solo viaja si el medio lo genera: cambiar de tarjeta a
    // efectivo después de escribir una boleta no debe dejarla pegada.
    onSubmit?.({
      paidAmount: onlyProducts ? null : parsed,
      paymentMethod: method,
      paymentRef: refLabel ? ref.trim() : '',
      products: liveLines.map(({ productId, qty }) => ({ productId, qty })),
      applyLoyaltyDiscount: useDiscount && discountPct > 0 && liveLines.length > 0,
    })
  }

  const grandTotal = serviceAmount + productsTotal
  const title = md === 'confirmar' ? 'Confirmar pago' : md === 'corregir' ? 'Corregir cobro' : onlyProducts ? 'Agregar productos' : 'Cobrar'
  const cta = md === 'confirmar' ? 'Confirmar' : md === 'corregir' ? 'Guardar' : onlyProducts ? 'Registrar venta' : 'Cobrar'
  const subtitle = [bk?.client, bk?.service].filter(Boolean).join(' · ') || undefined

  if (!bk) return null

  return (
    <Sheet
      open={shown}
      onClose={cancel}
      dismissible={!busy}
      title={title}
      subtitle={subtitle}
      icon={onlyProducts ? 'cart' : 'cash'}
      size="md"
      className="pn-charge-sheet"
      initialFocusRef={!onlyProducts && !isPhone ? amountRef : undefined}
      footer={(
        <>
          <Button variant="secondary" onClick={cancel} disabled={busy}>Cancelar</Button>
          <Button variant="primary" icon="check" loading={busy} disabled={!valid} onClick={submit}>
            {valid ? `${cta} ${CLP(grandTotal)}` : cta}
          </Button>
        </>
      )}
    >
      <div className="pn-stack is-lg">
        {!onlyProducts && (
          <Field label={liveLines.length ? 'Cobrado por el servicio' : 'Monto cobrado'}>
            <input
              ref={amountRef}
              className="input"
              type="text"
              inputMode="numeric"
              aria-label={liveLines.length ? 'Cobrado por el servicio' : 'Monto cobrado'}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
            />
            <span className={cx('pn-charge-amount-hint', hint && 'is-warn')}>
              {hint || (md === 'confirmar'
                ? `Se completó sola: el monto es el precio de la reserva (${CLP(listed)}). Falta decir cómo se pagó.`
                : `Precio de la reserva: ${CLP(listed)}`)}
            </span>
          </Field>
        )}

        {/* ---- Productos ---------------------------------------------- */}
        {sellsProducts && (
          <div className="pn-stack">
            <SectionLabel>Productos</SectionLabel>

            {liveLines.length > 0 && (
              <List>
                {liveLines.map((line) => {
                  const p = byId.get(line.productId)
                  return (
                    <ListRow
                      key={line.productId}
                      title={p.name}
                      titleWrap
                      subtitle={`${CLP(unitPriceOf(p))} c/u · quedan ${p.stock}`}
                      value={CLP(unitPriceOf(p) * line.qty)}
                      trailing={(
                        <span className="pn-qty" onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => changeQty(p.id, -1)} aria-label={`Restar ${p.name}`}>
                            <Icon name="minus" size={13} />
                          </button>
                          <b className="pn-num" aria-live="polite">{line.qty}</b>
                          <button type="button" onClick={() => changeQty(p.id, 1)} disabled={line.qty >= p.stock} aria-label={`Sumar ${p.name}`}>
                            <Icon name="plus" size={13} />
                          </button>
                        </span>
                      )}
                    />
                  )
                })}
              </List>
            )}

            {sellable.length === 0 ? (
              <EmptyState compact icon="gift" title="Sin productos para vender" text="Carga stock en Essentials para vender acá." />
            ) : picking ? (
              <div className="pn-stack">
                <SearchField value={query} onChange={setQuery} placeholder="Buscar producto…" autoFocus ariaLabel="Buscar producto" />
                {pickable.length === 0 ? (
                  <EmptyState compact icon="gift" title="Nada que coincida" />
                ) : (
                  <List className="pn-charge-pick">
                    {pickable.map((p) => (
                      <ListRow
                        key={p.id}
                        title={p.name}
                        titleWrap
                        subtitle={p.brand || `Quedan ${p.stock}`}
                        value={CLP(p.price)}
                        onClick={() => addLine(p)}
                        chevron={false}
                      />
                    ))}
                  </List>
                )}
                <Button variant="plain" size="sm" block onClick={() => { setPicking(false); setQuery('') }}>Cerrar</Button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" block icon="plus" onClick={() => setPicking(true)}>Agregar producto</Button>
            )}

            {/* El 30% no es un canje: es un beneficio permanente desde las 5
                estrellas, que el pase de Wallet y el correo ya le prometen al
                cliente. El servidor lo vuelve a verificar con el puente. */}
            {discountPct > 0 && liveLines.length > 0 && (
              <ToggleRow
                title={`Aplicar ${discountPct}% de fidelidad en productos`}
                description="Tiene 5 estrellas o más en la tarjeta."
                checked={useDiscount}
                onChange={setUseDiscount}
              />
            )}
          </div>
        )}

        <Field label="Medio de pago">
          <ChoiceGrid
            ariaLabel="Medio de pago"
            value={method}
            onChange={setMethod}
            options={METHODS.map(([id, label]) => ({ value: id, label }))}
          />
        </Field>

        {/* Comprobante: solo aparece si el medio elegido genera uno. El
            efectivo no deja rastro que anotar y una cortesía no emite
            documento, así que pedirlo ahí sería un campo vacío permanente. */}
        {refLabel && (
          <Field label={refLabel} optional hint="Queda guardado en la reserva para cuadrar la Caja contra el comprobante.">
            <input
              className="input"
              type="text"
              inputMode="numeric"
              aria-label={refLabel}
              value={ref}
              onChange={(e) => setRef(e.target.value.slice(0, 60))}
            />
          </Field>
        )}

        {/* El desglose aparece solo cuando hay dos montos que distinguir. Con
            la reserva sola sería ruido; con productos es lo que evita cobrar
            solo el corte cuando también se llevó una cera. */}
        {liveLines.length > 0 && !onlyProducts && (
          <List>
            <ListRow title="Servicio" value={CLP(serviceAmount)} />
            <ListRow title={`Productos (${unitsCount})`} value={CLP(productsTotal)} />
            <ListRow className="pn-charge-total" title="Total a cobrar" value={CLP(grandTotal)} />
          </List>
        )}
      </div>
    </Sheet>
  )
}
