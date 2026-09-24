import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './ui.jsx'
import { CAT_LABEL, CLP, cleanPhone, fmtDate } from '../data.js'
import { Sheet, Field, SectionLabel, List, ListRow, ChoiceGrid, Button, InlineAlert, Skeleton, Note } from './panel/index.js'
import '../styles/panel/booking-sheets.css'

/**
 * NewBookingModal — reserva manual desde el panel, en 3 pasos (Cliente &
 * servicio → Fecha & hora → Confirmar), conectada a datos reales.
 *
 * A diferencia del flujo público, el barbero puede: elegir CUALQUIER fecha
 * (sin el límite de días de /reservar), tomar un cliente existente
 * (autocompletar) o escribir uno nuevo (se crea por teléfono), y usar un
 * servicio del menú o uno personalizado; el precio es editable siempre y se
 * congela en la reserva (custom_price).
 *
 * Props:
 *  open, onClose
 *  clients, services      — para autocompletar y la lista de servicios
 *  barbers                — acá es uno solo (Brunetti): el selector solo se
 *                           dibuja si alguna vez hay más de uno
 *  defaultBarberId        — la agenda de la reserva (Bruno, id 6)
 *  agendaSlots            — horarios base para el picker (respaldo sin API)
 *  onCreate(draft) => Promise<{ok, error?}>  — persiste (Dashboard.createBooking)
 *  prefill                — { name, phone, email, barberId } al abrir desde la
 *                           ficha de un cliente ("Agendar"); null = hoja en blanco
 *
 * "Estado completada → hoja de cobro" lo resuelve Dashboard después de
 * `onCreate` (manda chargeOnCreate: el servidor la deja en curso y se abre la
 * hoja de cobro sola); este componente solo entrega el draft. Sin API, el
 * draft se guarda local igual (addLocalBooking en createBooking).
 *
 * La agenda de Brunetti va en bloques de 1 hora y el servidor rechaza tanto
 * una hora fuera de la grilla (422) como un horario bloqueado (409, igual que
 * uno reservado): por eso no hay "Otra hora" y un bloque bloqueado no se
 * ofrece. Un bloque que ya pasó sí se puede tomar: es el de alguien que llegó
 * sin hora.
 */

const cx = (...parts) => parts.filter(Boolean).join(' ')

const STATUS_OPTIONS = ['pendiente', 'confirmada', 'en curso', 'completada', 'cancelada']
const DEFAULT_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00']
const STEP_LABELS = { 1: 'Cliente y servicio', 2: 'Fecha y hora', 3: 'Confirmar' }
const jsonOrReject = (r) => (r.headers.get('content-type')?.includes('application/json') ? r.json() : Promise.reject(new Error('api unavailable')))
// Lo que el servidor no deja tomar (busySlotsForBarberDate: reservas y bloqueos).
const isTaken = (state) => state === 'booked' || state === 'blocked'
// Un servicio de varias horas necesita libres (y existentes) los bloques
// siguientes al elegido, no solo ese.
const spanTakenAt = (list, i, blocks) => {
  for (let k = 0; k < blocks; k++) {
    const item = list[i + k]
    if (!item || isTaken(item.state)) return true
  }
  return false
}

const svcIcon = (svc) => {
  const n = ((svc.name || '') + ' ' + (svc.cat || '')).toLowerCase()
  if (n.includes('asesor') || n.includes('visag') || n.includes('imagen')) return 'user'
  if (n.includes('quim') || n.includes('color') || n.includes('platin')) return 'spark'
  if (n.includes('fade') || n.includes('degra')) return 'trend'
  return 'scissors'
}

const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function NewBookingModal({ open, onClose, clients = [], services = [], barbers = [], defaultBarberId, agendaSlots = DEFAULT_SLOTS, onCreate, prefill = null }) {
  const [step, setStep] = useState(1)
  const [barberId, setBarberId] = useState(defaultBarberId)
  const [clientName, setClientName] = useState('')
  const [phone, setPhone] = useState('')
  const [clientLocked, setClientLocked] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [serviceId, setServiceId] = useState(null)   // null = personalizado
  const [customSvc, setCustomSvc] = useState(false)
  const [svcName, setSvcName] = useState('')
  const [price, setPrice] = useState('')
  const [date, setDate] = useState(todayKey())
  const [time, setTime] = useState('')
  const [slots, setSlots] = useState(null)           // null = cargando
  const [status, setStatus] = useState('confirmada')
  const [errorState, setErrorState] = useState({ msg: '', tick: 0 })
  const error = errorState.msg
  /* El error va al final del cuerpo: en el celular, con el paso 3 largo, quedaba
     debajo del borde visible y "Confirmar reserva" parecía no hacer nada. El
     `tick` hace que el mismo error repetido (tocar otra vez sin corregir)
     vuelva a traerlo a la vista. */
  const setError = (msg) => setErrorState((s) => ({ msg, tick: msg ? s.tick + 1 : s.tick }))
  const errorRef = useRef(null)
  useEffect(() => {
    if (errorState.msg) errorRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [errorState])
  const [saving, setSaving] = useState(false)

  const activeServices = useMemo(() => services.filter((s) => s.active !== false), [services])
  const selectableBarbers = useMemo(() => barbers.filter((b) => b.active !== false), [barbers])
  const selectedBarber = selectableBarbers.find((b) => Number(b.id) === Number(barberId))

  // Servicios agrupados por categoría, en el mismo orden que CAT_LABEL (acá
  // hay dos "Corte de cabello", el general y el Brunetti Experience: sin el
  // grupo no se distinguen); lo que no calce cae en "Otros servicios".
  const servicesByCat = useMemo(() => {
    const groups = new Map()
    activeServices.forEach((svc) => {
      const cat = svc.cat && CAT_LABEL[svc.cat] ? svc.cat : '_other'
      if (!groups.has(cat)) groups.set(cat, [])
      groups.get(cat).push(svc)
    })
    return [...Object.keys(CAT_LABEL), '_other']
      .filter((cat) => groups.has(cat))
      .map((cat) => ({ cat, label: CAT_LABEL[cat] || 'Otros servicios', items: groups.get(cat) }))
  }, [activeServices])

  // Servicios personalizados no tienen duración conocida → 1 bloque. Un
  // servicio del menú de más de 1h bloquea varios horarios seguidos.
  const blocksNeeded = useMemo(() => {
    if (customSvc) return 1
    const svc = activeServices.find((s) => s.id === serviceId)
    return Math.max(1, Math.ceil((svc?.min || 60) / 60))
  }, [customSvc, serviceId, activeServices])

  // Reset al abrir. Desde la ficha de un cliente ("Agendar") llega `prefill`:
  // cliente ya puesto (bloqueado, como si se hubiera elegido de la lista).
  useEffect(() => {
    if (!open) return
    setStep(1)
    const pre = prefill && String(prefill.phone || '').length === 9 ? prefill : null
    setBarberId(pre?.barberId ?? defaultBarberId)
    setClientName(pre?.name || ''); setPhone(pre?.phone || '')
    setClientLocked(Boolean(pre)); setSuggestOpen(false)
    setServiceId(null); setCustomSvc(false); setSvcName(''); setPrice('')
    setDate(todayKey()); setTime('')
    setStatus('confirmada'); setError(''); setSaving(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Si la hoja se abrió antes de tener el barbero por defecto, lo toma apenas
  // exista. Updater funcional: en la primera apertura este efecto corre en el
  // mismo commit que el de arriba y todavía ve `barberId` en null.
  useEffect(() => {
    if (open && barberId == null && defaultBarberId != null) setBarberId((cur) => cur ?? defaultBarberId)
  }, [open, barberId, defaultBarberId])

  // Disponibilidad del día elegido. Sin API (o sin horarios) se muestran
  // todos libres: la reserva igual se guarda local y el servidor, si
  // responde, es el que decide si el horario choca. Se vuelve a pedir cada
  // vez que se entra al paso 2: si "Confirmar reserva" rebotó con "Ese
  // horario ya está tomado" y se vuelve atrás, la grilla ya lo muestra.
  useEffect(() => {
    if (!open || step !== 2 || !date || barberId == null) return
    let alive = true
    setSlots(null)
    const allFree = () => agendaSlots.map((slot) => ({ slot, state: 'free' }))
    fetch(`/api/availability?barberId=${barberId}&date=${date}&detail=true`)
      .then(jsonOrReject)
      .then((data) => { if (alive) setSlots(data.slots?.length ? data.slots : allFree()) })
      .catch(() => { if (alive) setSlots(allFree()) })
    return () => { alive = false }
  }, [open, step, date, barberId, agendaSlots])

  // La hora elegida que dejó de estar libre (la grilla se recargó, o se
  // cambió a un servicio más largo) se suelta: si no, "Continuar" pasaría con
  // un botón marcado pero deshabilitado.
  useEffect(() => {
    if (!slots || !time) return
    const i = slots.findIndex((s) => s.slot === time)
    if (i === -1 || spanTakenAt(slots, i, blocksNeeded)) setTime('')
  }, [slots, time, blocksNeeded])

  const matches = useMemo(() => {
    const q = clientName.trim().toLowerCase()
    if (!q || clientLocked) return []
    return clients
      .filter((c) => `${c.name || ''} ${c.phone || ''}`.toLowerCase().includes(q))
      .slice(0, 5)
  }, [clients, clientName, clientLocked])

  const pickClient = (c) => {
    setClientName(c.name || '')
    setPhone(String(c.phone || ''))
    setClientLocked(true)
    setSuggestOpen(false)
  }
  const unlockClient = () => { setClientLocked(false); setClientName(''); setPhone('') }

  const pickService = (svc) => {
    setServiceId(svc.id)
    setCustomSvc(false)
    setSvcName('')
    setPrice(String(svc.price || ''))
    setError('')
  }
  const pickCustom = () => { setServiceId(null); setCustomSvc(true); setPrice(''); setError('') }

  const selectedService = activeServices.find((s) => s.id === serviceId)

  const validateStep1 = () => {
    const p = cleanPhone(phone)
    if (!clientName.trim()) return 'Escribe el nombre del cliente.'
    if (p.length !== 9) return 'El teléfono debe tener 9 dígitos.'
    if (!serviceId && !customSvc) return 'Elige un servicio.'
    if (customSvc && !svcName.trim()) return 'Escribe el nombre del servicio personalizado.'
    if (!Number(price)) return 'Ingresa el precio.'
    return ''
  }
  const validateStep2 = () => {
    if (!date) return 'Elige la fecha.'
    if (!/^\d{2}:\d{2}$/.test(time)) return 'Elige la hora.'
    return ''
  }
  const goNext = () => {
    const err = step === 1 ? validateStep1() : step === 2 ? validateStep2() : ''
    if (err) { setError(err); return }
    setError('')
    setStep((s) => Math.min(3, s + 1))
  }
  const goBack = () => { setError(''); setStep((s) => Math.max(1, s - 1)) }

  const submit = async () => {
    if (saving) return
    const err = validateStep1() || validateStep2() || (barberId == null ? 'No se encontró la agenda de Brunetti. Recarga el panel.' : '')
    if (err) { setError(err); return }
    setError('')
    setSaving(true)
    const draft = {
      client: clientName.trim(),
      phone: cleanPhone(phone),
      barberId,
      serviceId: serviceId || null,
      service: customSvc ? svcName.trim() : selectedService?.name,
      price: Number(price),
      date, time, status,
    }
    const result = await onCreate(draft)
    setSaving(false)
    if (!result?.ok) { setError(result?.error || 'No se pudo crear la reserva.'); return }
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      dismissible={!saving}
      title="Nueva reserva"
      subtitle={`Paso ${step} de 3 · ${STEP_LABELS[step]}`}
      icon="calendar"
      size="lg"
      className="pn-booking-sheet"
      footer={(
        <>
          <Button variant="secondary" onClick={step === 1 ? onClose : goBack} disabled={saving}>
            {step === 1 ? 'Cancelar' : 'Atrás'}
          </Button>
          {step < 3 ? (
            <Button variant="primary" onClick={goNext}>Continuar</Button>
          ) : (
            <Button variant="primary" icon="check" loading={saving} onClick={submit}>Confirmar reserva</Button>
          )}
        </>
      )}
    >
      <div className="pn-booking-progress" aria-hidden="true">
        {[1, 2, 3].map((s) => <span key={s} className={cx('pn-booking-progress-seg', s <= step && 'is-on')} />)}
      </div>

      {/* PASO 1 · CLIENTE & SERVICIO */}
      {step === 1 && (
        <div className="pn-stack is-lg">
          {selectableBarbers.length > 1 && (
            <Field label="Barbero">
              <select className="input" value={barberId ?? ''} onChange={(e) => setBarberId(Number(e.target.value))}>
                {selectableBarbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          )}

          <Field label="Cliente">
            <div className="pn-booking-field-wrap">
              <input
                className="input"
                placeholder="Nombre (busca o escribe uno nuevo)"
                value={clientName}
                disabled={clientLocked}
                onChange={(e) => { setClientName(e.target.value); setSuggestOpen(true) }}
                onFocus={() => setSuggestOpen(true)}
              />
              {clientLocked && (
                <button type="button" className="pn-booking-field-clear" onClick={unlockClient} aria-label="Cambiar cliente">
                  <Icon name="close" size={14} />
                </button>
              )}
              {suggestOpen && matches.length > 0 && (
                <div className="pn-booking-suggest">
                  <div className="pn-booking-suggest-head">Clientes existentes</div>
                  {matches.map((c) => (
                    <button key={c.id || c.phone} type="button" className="pn-booking-suggest-row" onClick={() => pickClient(c)}>
                      <span><strong>{c.name}</strong><small>+56 {c.phone}</small></span>
                      <span>{Number(c.visits || 0) === 1 ? '1 visita' : `${c.visits || 0} visitas`}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>

          <Field label="Teléfono" hint="9 dígitos, sin el +56">
            <input
              className="input"
              placeholder="9 1234 5678"
              inputMode="tel"
              value={phone}
              disabled={clientLocked}
              onChange={(e) => setPhone(cleanPhone(e.target.value))}
            />
          </Field>

          <Field label="Servicio">
            <div className="pn-stack">
              {servicesByCat.map((group) => (
                <div key={group.cat}>
                  <SectionLabel>{group.label}</SectionLabel>
                  <div className="pn-booking-svc-grid">
                    {group.items.map((svc) => (
                      <button
                        key={svc.id} type="button"
                        className={cx('pn-booking-svc', serviceId === svc.id && 'is-on')}
                        aria-pressed={serviceId === svc.id}
                        onClick={() => pickService(svc)}
                      >
                        <span className="pn-booking-svc-ic"><Icon name={svcIcon(svc)} size={16} /></span>
                        <span className="pn-booking-svc-text">
                          <strong>{svc.name}</strong>
                          <small>{svc.min ? `${svc.min} min · ` : ''}{CLP(svc.price)}</small>
                        </span>
                        {serviceId === svc.id && <span className="pn-booking-svc-check"><Icon name="check" size={16} /></span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button type="button" className={cx('pn-booking-svc', customSvc && 'is-on')} aria-pressed={customSvc} onClick={pickCustom}>
                <span className="pn-booking-svc-ic"><Icon name="spark" size={16} /></span>
                <span className="pn-booking-svc-text"><strong>Personalizado</strong><small>Nombre y precio a mano</small></span>
                {customSvc && <span className="pn-booking-svc-check"><Icon name="check" size={16} /></span>}
              </button>
            </div>
          </Field>

          {customSvc && (
            <Field label="Nombre del servicio">
              <input className="input" value={svcName} onChange={(e) => setSvcName(e.target.value)} />
            </Field>
          )}
          <Field label="Precio" hint="Editable siempre; queda congelado en la reserva.">
            <input className="input" placeholder="0" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
      )}

      {/* PASO 2 · FECHA & HORA */}
      {step === 2 && (
        <div className="pn-stack is-lg">
          <Field label="Fecha">
            <input className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime('') }} />
          </Field>
          <Field label="Hora">
            <div className="pn-stack">
              <div className="pn-booking-slots">
                {slots === null
                  ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={44} radius={10} />)
                  : slots.map(({ slot, state }, i) => {
                      const spanTaken = spanTakenAt(slots, i, blocksNeeded)
                      const title = state === 'booked' ? 'Reservado'
                        : state === 'blocked' ? 'Bloqueado: desbloquéalo en la Agenda'
                        : spanTaken ? `No caben ${blocksNeeded} horas seguidas desde acá`
                        : state === 'past' ? 'Ya pasó: sirve para alguien que llegó sin hora'
                        : blocksNeeded > 1 ? `Bloquea ${blocksNeeded} horas seguidas` : undefined
                      return (
                        <button
                          key={slot} type="button"
                          className={cx('pn-booking-slot', state === 'booked' && 'is-booked', state === 'blocked' && 'is-blocked', state === 'past' && 'is-past', time === slot && 'is-on')}
                          disabled={isTaken(state) || spanTaken}
                          aria-pressed={time === slot}
                          title={title}
                          onClick={() => setTime(slot)}
                        >
                          {slot}
                        </button>
                      )
                    })}
              </div>
              {blocksNeeded > 1 && <p className="pn-field-hint">Este servicio dura {blocksNeeded} horas: se bloquean {blocksNeeded} horarios seguidos.</p>}
              <p className="pn-field-hint">La agenda va en bloques de 1 hora: para alguien que llegó sin hora, elige el bloque en curso.</p>
            </div>
          </Field>
        </div>
      )}

      {/* PASO 3 · CONFIRMAR */}
      {step === 3 && (
        <div className="pn-stack is-lg">
          <div>
            <SectionLabel>Resumen</SectionLabel>
            <List>
              <ListRow title="Cliente" value={clientName} />
              {selectableBarbers.length > 1 && selectedBarber && <ListRow title="Barbero" value={selectedBarber.name} />}
              <ListRow title="Servicio" value={customSvc ? svcName : (selectedService?.name || '—')} />
              <ListRow title="Fecha" value={fmtDate(date, 'dmy')} />
              <ListRow title="Hora" value={time || '—'} />
              <ListRow title="Precio" value={CLP(Number(price || 0))} />
            </List>
          </div>
          <Field label="Estado inicial">
            <ChoiceGrid
              ariaLabel="Estado inicial"
              value={status}
              onChange={setStatus}
              options={STATUS_OPTIONS.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
            />
          </Field>
          {status === 'completada' && (
            <Note icon="cash">
              Completar es cobrar: la reserva queda en curso y enseguida se abre la hoja de cobro. Si la cierras sin cobrar, sigue en curso.
            </Note>
          )}
        </div>
      )}

      {error && <div ref={errorRef}><InlineAlert tone="error">{error}</InlineAlert></div>}
    </Sheet>
  )
}
