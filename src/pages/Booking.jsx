import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Emblem, Icon, MobileScreen } from '../components/ui.jsx'
import { GlareCard } from '../components/GlareCard.jsx'
import { BARBERS, SERVICES, SERVICE_BARBERS, SLOT_GROUPS, CAT_LABEL, DAYS_ES, MONTHS_ES, slotState, barberById, CLP } from '../data.js'
import { addLocalBooking } from '../bookingsStore.js'
import { FEATURES } from '../features.js'
import WalletPrompt, { useAutoWalletPrompt } from '../components/WalletPrompt.jsx'

const ALL_BOOKING_SLOTS = Object.values(SLOT_GROUPS).flat()

function genIdempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function localBlockKey(barberId, date, slot) {
  return `${barberId}|${date}|${slot}`
}

// Cuántos bloques de 1h consecutivos ocupa un servicio (75 min → 2 bloques),
// y qué horarios exactos ocuparía si empezara en `startSlot`. null si no
// alcanza a caber antes del cierre.
function blocksFor(service) {
  return Math.max(1, Math.ceil((service?.min || 60) / 60))
}
function spanFor(startSlot, blocks) {
  const idx = ALL_BOOKING_SLOTS.indexOf(startSlot)
  if (idx === -1 || idx + blocks > ALL_BOOKING_SLOTS.length) return null
  return ALL_BOOKING_SLOTS.slice(idx, idx + blocks)
}

// Componentes locales, no UTC: en Chile (UTC-3/-4) toISOString() hace
// rollover al día siguiente durante la noche, lo que corría la ventana de
// reserva un día antes de lo esperado para quien reserva de noche.
function localDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function readLocalBlocks() {
  try { return JSON.parse(localStorage.getItem("ps_availability_blocks") || "{}") } catch { return {} }
}

// El cliente debe reservar con al menos MIN_LEAD_MINUTES de anticipación
// (ej: a las 15:53 ya no puede tomar la hora de las 16:00, pero sí la de
// las 17:00). Solo aplica al día de hoy — días futuros no tienen "pasado".
const MIN_LEAD_MINUTES = 55
function isSlotTooSoon(dateKey, slot, todayKey, now) {
  if (dateKey !== todayKey) return false
  const [h, m] = slot.split(":").map(Number)
  const slotDate = new Date(now)
  slotDate.setHours(h, m, 0, 0)
  return (slotDate - now) / 60000 < MIN_LEAD_MINUTES
}

// Orden de las categorías en el paso "Servicio". Cualquier categoría que
// aparezca en la base y no esté acá se agrega al final en vez de desaparecer.
const CAT_ORDER = ["general", "premium", "quimico"]

function groupByCategory(list) {
  const extras = [...new Set(list.map((s) => s.cat).filter((cat) => cat && !CAT_ORDER.includes(cat)))]
  return [...CAT_ORDER, ...extras]
    .map((cat) => ({ cat, label: CAT_LABEL[cat] || cat, items: list.filter((s) => s.cat === cat) }))
    .filter((group) => group.items.length)
}

// Un servicio de un solo día guarda su fecha como día de calendario
// ("2026-11-15"), no como instante: se arma en UTC y se formatea en UTC para
// que no se corra un día según la zona del navegador (mismo criterio que
// api/_email.js).
function dateParts(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""))
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null
}
function longDate(key) {
  const d = dateParts(key)
  if (!d) return key
  // "jueves, 15 de octubre" -> "Jueves, 15 de octubre". Se sube solo la
  // primera letra a mano en vez de con textTransform: capitalize, que en
  // español también levantaría la preposición ("15 De Octubre").
  const txt = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(d)
  return txt.charAt(0).toUpperCase() + txt.slice(1)
}
function shortDate(key) {
  const d = dateParts(key)
  if (!d) return key
  return new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "numeric", month: "short" }).format(d).replace(".", "")
}

// La misma tarjeta se usa en la fila de destacados y dentro de cada categoría,
// así que vive suelta en vez de duplicar los estilos inline en los dos sitios.
function ServiceCard({ service, selected, onSelect, showBadge }) {
  return (
    <GlareCard
      as="button"
      type="button"
      onClick={() => onSelect(service.id)}
      aria-pressed={selected}
      style={{
        border: selected ? "2px solid var(--gold-line)" : "1px solid var(--hair-2)",
        padding: ".7rem",
        display: "grid",
        gap: ".3rem",
        cursor: "pointer",
        textAlign: "center",
        background: selected ? "linear-gradient(135deg, rgba(214, 188, 70, 0.15), rgba(214, 188, 70, 0.05))" : "var(--fill-card)",
        transition: "all .2s",
        borderRadius: "12px",
        width: "100%",
      }}
    >
      {showBadge && (
        <span className="chip chip-gold" style={{ justifySelf: "center", fontSize: ".6rem", padding: ".1rem .45rem" }}>Destacado</span>
      )}
      {/* Servicio de un solo día: la fecha va en la tarjeta, no escondida en el
          paso siguiente — es lo primero que decide si te sirve o no. */}
      {service.onlyOnDate && (
        <span className="chip chip-gold" style={{ justifySelf: "center", fontSize: ".6rem", padding: ".1rem .45rem" }}>Solo el {shortDate(service.onlyOnDate)}</span>
      )}
      <span className="font-display" style={{ fontWeight: 600, fontSize: ".85rem" }}>{service.name}</span>
      <span className="font-display gold-text" style={{ fontWeight: 700, fontSize: "1.1rem" }}>{CLP(service.price)}</span>
      <div style={{ display: "flex", gap: ".3rem", color: "var(--muted)", fontSize: ".7rem", alignItems: "center", justifyContent: "center" }}>
        <Icon name="clock" size={12} /> {service.min} min
      </div>
      {/* La descripción se muestra dentro de la tarjeta elegida, no bajo la
          grilla: en un teléfono el catálogo es más alto que la pantalla, así
          que una nota al final queda fuera de vista justo cuando hay que
          leerla. Acá aparece bajo el dedo que acaba de elegir. "Solo fade" es
          el caso que lo motivó — se elegía creyendo que era el precio del
          corte, cuando cubre solo la mantención del degradado. El texto vive
          en `description` del servicio, que edita el panel. */}
      {selected && service.desc && (
        <span style={{ display: "block", marginTop: ".15rem", paddingTop: ".35rem", borderTop: "1px solid var(--hair-2)", color: "var(--muted)", fontSize: ".68rem", lineHeight: 1.4, whiteSpace: "normal" }}>
          {service.desc}
        </span>
      )}
    </GlareCard>
  )
}

// `min` baja a 140px dentro de las categorías: ahí la grilla vive con el
// padding del acordeón encima y con 160px no alcanzaban dos columnas en un
// teléfono, así que cada servicio ocupaba una fila entera.
function ServiceGrid({ children, min = 160 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: ".6rem" }}>
      {children}
    </div>
  )
}

export default function Booking() {
  const navigate = useNavigate()
  // Marca personal de un solo barbero: Brunetti. Se reserva siempre con él.
  const SINGLE_BARBER = BARBERS[0]?.id ?? 6
  const [barbers] = useState(BARBERS)
  // El catálogo estático es lo que se ve hasta que responde /api/services, así
  // que se filtra igual que la respuesta real: sin esto, los servicios que el
  // panel tiene apagados alcanzaban a mostrarse — en este local, el corte de
  // $15.990, que no se vende acá (el corte de Brunetti es el de $19.990).
  const [services, setServices] = useState(() => SERVICES.filter((item) => item.active !== false))
  // ¿La lista ya es la de /api/services? El mapeo estático SERVICE_BARBERS
  // solo vale para el catálogo de respaldo: aplicado a la respuesta real,
  // escondía todo servicio creado en el panel (un id que no estaba en la
  // lista fija), y con eso los destacados y los de un solo día nunca
  // llegaban a /reservar.
  const [servicesFromApi, setServicesFromApi] = useState(false)
  // ¿Ya contestó /api/services (bien o mal)? Hasta entonces no se abre
  // ninguna categoría sola: el catálogo de respaldo no trae destacados, y
  // abrir la primera para cerrarla un instante después se ve como un salto.
  const [catalogReady, setCatalogReady] = useState(false)
  // Categorías desplegadas en el paso "Servicio". `null` = todavía nadie las
  // tocó: se abre la primera solo si no hay fila de destacados, para que el
  // paso nunca se vea como tres títulos cerrados y nada que elegir.
  const [openCats, setOpenCats] = useState(null)
  const [availableSlots, setAvailableSlots] = useState([])
  // El paso "Barbero" se omite: arrancamos en Servicio con Brunetti ya elegido.
  const [step, setStep] = useState(1)
  const [barberId, setBarberId] = useState(SINGLE_BARBER)
  const [serviceId, setServiceId] = useState(null)
  const [month, setMonth] = useState(new Date().getMonth())
  const [year] = useState(new Date().getFullYear())
  const [dateKey, setDateKey] = useState(null)
  const [slot, setSlot] = useState(null)
  const [saving, setSaving] = useState(false)

  // Idempotency key para la creación de la reserva: se mantiene estable
  // mientras no cambie lo que se va a reservar, así que un doble-tap en
  // "Confirmar" (fácil en mobile) reusa la misma key y el backend lo
  // deduplica. Cambiar de servicio/fecha/hora genera una key nueva, porque
  // ahí sí es un intento de reserva distinto.
  const idempotencyKeyRef = useRef(genIdempotencyKey())
  useEffect(() => { idempotencyKeyRef.current = genIdempotencyKey() }, [barberId, serviceId, dateKey, slot])

  useEffect(() => {
    const user = localStorage.getItem("ps_user")
    if (!user) navigate("/login")

    // Servicio pre-seleccionado desde la web pública (tarjeta de servicio → reservar).
    // Entra con el servicio ya elegido y salta directo al paso de fecha/hora.
    const pendingSvc = localStorage.getItem("ps_pending_service")
    if (pendingSvc) {
      localStorage.removeItem("ps_pending_service")
      setServiceId(Number(pendingSvc))
      setStep(2) // paso de fecha + hora
    }

    // ?includeSingleDay=1: la lista pública simple deja fuera los servicios de
    // un solo día a propósito (PimpStudio la lee para agendar a Bruno y no
    // entiende la fecha única); esta página sí los muestra, con su fecha.
    const url = FEATURES.singleDay ? "/api/services?includeSingleDay=1" : "/api/services"
    fetch(url).then((r) => r.json()).then((data) => {
      if (!data.services?.length) return
      setServices(data.services.filter((item) => item.active !== false))
      setServicesFromApi(true)
    }).catch(() => {}).finally(() => setCatalogReady(true))
  }, [])

  useEffect(() => {
    if (!barberId || !dateKey) { setAvailableSlots([]); return }
    fetch(`/api/availability?barberId=${barberId}&date=${dateKey}`)
      .then((r) => r.headers.get("content-type")?.includes("application/json") ? r.json() : Promise.reject(new Error("api unavailable")))
      .then((data) => {
        const localBlocks = readLocalBlocks()
        const slots = (data.slots?.length ? data.slots : ALL_BOOKING_SLOTS.map((slot) => ({ slot, available: true }))).map((item) => {
          if (localBlocks[localBlockKey(barberId, dateKey, item.slot)]) return { ...item, available: false, state: "blocked" }
          return item
        })
        setAvailableSlots(slots)
      })
      .catch(() => {
        const localBlocks = readLocalBlocks()
        setAvailableSlots(ALL_BOOKING_SLOTS.map((slot) => ({ slot, available: !localBlocks[localBlockKey(barberId, dateKey, slot)] })))
      })
  }, [barberId, dateKey])

  const barber = barbers.find((b) => b.id === barberId) || barberById(barberId)
  const service = services.find((s) => s.id === serviceId)
  // Fecha única del servicio elegido (services.only_on_date), si la tiene.
  const onlyOnDate = (FEATURES.singleDay && service?.onlyOnDate) || null
  const now = new Date()
  const todayKey = localDateKey(now)
  const allowedServices = !barberId ? [] : services.filter((s) => {
    if (!servicesFromApi && SERVICE_BARBERS[barberId] && !SERVICE_BARBERS[barberId].includes(s.id)) return false
    // Un servicio de un solo día que ya pasó no se ofrece (el servidor ya no
    // lo lista, pero el borde puede servir una copia de hasta 15 min).
    if (s.onlyOnDate && (!FEATURES.singleDay || s.onlyOnDate < todayKey)) return false
    return true
  })
  const featuredServices = FEATURES.featuredServices ? allowedServices.filter((s) => s.featured) : []
  const serviceGroups = groupByCategory(allowedServices)
  const defaultCats = !catalogReady || featuredServices.length || !serviceGroups.length ? [] : [serviceGroups[0].cat]
  const shownCats = openCats ?? defaultCats
  const toggleCat = (cat) => setOpenCats((prev) => {
    const base = prev ?? defaultCats
    return base.includes(cat) ? base.filter((c) => c !== cat) : [...base, cat]
  })

  // Si se llega con un servicio ya elegido (tarjeta del home →
  // ps_pending_service) su categoría se abre sola. Si no, al volver al paso 1
  // la selección quedaría escondida dentro de un acordeón cerrado.
  useEffect(() => {
    if (!serviceId) return
    const chosen = allowedServices.find((s) => s.id === serviceId)
    if (!chosen || (FEATURES.featuredServices && chosen.featured)) return
    setOpenCats((prev) => {
      const base = prev ?? defaultCats
      return base.includes(chosen.cat) ? base : [...base, chosen.cat]
    })
  }, [serviceId, services])
  const steps = ["Servicio", "Fecha", "Listo"]
  const canNext = (step === 1 && serviceId) || (step === 2 && dateKey && slot)

  const reset = () => { setStep(1); setServiceId(null); setDateKey(null); setSlot(null) }

  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // El cliente solo puede reservar dentro de los próximos MAX_LEAD_DAYS días:
  // más allá de eso el barbero todavía no publicó su disponibilidad (ver
  // agenda del panel interno, que se administra semana a semana).
  // Debe coincidir con MAX_LEAD_DAYS en api/bookings.js — el servidor rechaza
  // con 422 lo que quede fuera, así que subir solo este número deja días
  // clicleables que fallan al confirmar.
  const MAX_LEAD_DAYS = 10
  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + MAX_LEAD_DAYS)
  const maxDateKey = localDateKey(maxDate)
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const dk = (d) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  const isPast = (d) => dk(d) < todayKey
  const isTooFar = (d) => dk(d) > maxDateKey
  // No tiene sentido dejar avanzar de mes si ningún día del mes siguiente cae
  // dentro de la ventana de MAX_LEAD_DAYS días (p. ej. a inicios de mes).
  const nextMonthFirstKey = `${month === 11 ? year + 1 : year}-${String(month === 11 ? 1 : month + 2).padStart(2, "0")}-01`
  const canGoNextMonth = month < 11 && nextMonthFirstKey <= maxDateKey

  // Un servicio de un solo día trae su fecha puesta: es la única posible, así
  // que se elige sola, aunque caiga más allá de los MAX_LEAD_DAYS (la ventana
  // no aplica a ese servicio; el servidor hace la misma excepción). Y al
  // volver a un servicio normal hay que soltarla, o quedaría apuntando a un
  // día fuera de la ventana y el servidor rechazaría la reserva recién al
  // confirmar.
  useEffect(() => {
    if (!service) return
    if (onlyOnDate) {
      if (dateKey !== onlyOnDate) { setDateKey(onlyOnDate); setSlot(null) }
    } else if (dateKey && dateKey > maxDateKey) {
      setDateKey(null)
      setSlot(null)
    }
  }, [serviceId, services])

  const [bookingError, setBookingError] = useState(null)

  // Tarjeta de fidelidad: se ofrece recién en el paso 3 (reserva confirmada) y
  // con unos segundos de respiro, para no tapar el "¡Reserva confirmada!" que
  // el cliente vino a ver. Si ya la tiene instalada, no aparece.
  const clientPhone = (() => {
    try { return JSON.parse(localStorage.getItem("ps_user") || "{}")?.phone || null } catch { return null }
  })()
  const [walletOpen, closeWallet] = useAutoWalletPrompt(step === 3, clientPhone, 4500)

  const confirm = async () => {
    setSaving(true)
    setBookingError(null)
    const user = JSON.parse(localStorage.getItem("ps_user") || "{}")
    let savedId = null
    let reachedServer = false
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: user.phone, barberId, serviceId, date: dateKey, time: slot, idempotencyKey: idempotencyKeyRef.current }),
      })
      // API real (JSON) vs. sin backend disponible (ej. `npm run dev` sin
      // `vercel dev`, que responde 404 vacío): solo un error JSON real del
      // endpoint debe bloquear la reserva; la ausencia total de API cae al
      // respaldo local (modo offline documentado en CLAUDE.md).
      if (res.headers.get("content-type")?.includes("application/json")) {
        reachedServer = true
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.error || !data?.booking?.id) {
          setSaving(false)
          setBookingError(data?.error || "No se pudo confirmar la reserva. Intenta de nuevo.")
          return
        }
        savedId = data.booking.id
      }
    } catch {
      // Sin conexión al servidor: seguimos con respaldo local (modo offline).
      // Si sí llegamos al servidor y este respondió con error, ya se manejó arriba.
    }
    if (reachedServer && !savedId) { setSaving(false); return }

    // Respaldo local: la reserva aparece de inmediato en el panel interno
    // (Reservas) aunque el backend no esté disponible (modo offline real).
    addLocalBooking({
      id: savedId,
      barberId,
      serviceId,
      service: service?.name,
      price: service?.price,
      client: user.name || "Cliente",
      phone: user.phone,
      date: dateKey,
      time: slot,
      status: "confirmada",
    })

    setSaving(false)
    setStep(3)
  }

  return (
    <MobileScreen>
      <div style={{ padding: "0.5rem 1.2rem 0.9rem", display: "flex", alignItems: "center", gap: ".8rem" }}>
        <button onClick={() => (step > 1 ? setStep(step - 1) : navigate("/"))} style={{ background: "var(--fill-soft)", border: "1px solid var(--hair)", borderRadius: 999, width: 38, height: 38, display: "grid", placeItems: "center", color: "var(--ink)", flexShrink: 0 }}>
          <Icon name="arrowLeft" size={17} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: ".68rem", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" }}>Paso {Math.min(step, 3)} de 3</div>
          <div className="font-display" style={{ fontSize: "1.05rem", fontWeight: 600 }}>Reservar cita</div>
        </div>
        <Emblem size={34} />
      </div>

      <div style={{ padding: "0 1.2rem 1rem", display: "flex", gap: ".4rem" }}>
        {steps.map((_, i) => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: (i + 1) <= step ? "var(--gold-grad)" : "var(--fill-track)", transition: "background .4s" }} />
        ))}
      </div>

      <div className="booking-shell" style={{ padding: "0 1.2rem 5rem", display: "grid", gap: ".8rem", maxWidth: "1000px", margin: "0 auto" }}>
        {/* PASO 0 — BARBERO */}
        {step === 0 && (
          <div className="animate-in" style={{ display: "grid", gap: ".8rem" }}>
            <h3 className="font-display" style={{ margin: ".2rem 0", fontSize: "1.05rem" }}>Elige tu barbero</h3>
            {(() => {
              const LOGO = "/assets/brunetti-logo-icon.svg"
              const onImgErr = (e) => { if (e.currentTarget.src !== window.location.origin + LOGO) e.currentTarget.src = LOGO }
              const ordered = [...barbers].sort((a, b) => (b.tier === "premium" ? 1 : 0) - (a.tier === "premium" ? 1 : 0))
              const featured = ordered.find((b) => b.tier === "premium")
              const rest = ordered.filter((b) => b !== featured)
              return (
                <>
                  {featured && (
                    <button type="button" onClick={() => { setBarberId(featured.id); setServiceId(null) }}
                      className={`booking-barber featured ${barberId === featured.id ? "is-sel" : ""}`}>
                      <div className="booking-barber-av lg"><img src={featured.photo || LOGO} alt={featured.name} onError={onImgErr} /></div>
                      <div className="booking-barber-meta">
                        <div className="nm">{featured.name} <Icon name="star" size={13} color="var(--gold)" /></div>
                        <div className="role">{featured.role}{featured.exp ? ` · ${featured.exp}` : ""}</div>
                      </div>
                      {barberId === featured.id && <span className="booking-barber-check"><Icon name="check" size={14} /></span>}
                    </button>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: ".6rem" }}>
                    {rest.map((b) => (
                      <button key={b.id} type="button" onClick={() => { setBarberId(b.id); setServiceId(null) }}
                        className={`booking-barber ${barberId === b.id ? "is-sel" : ""}`}>
                        <div className="booking-barber-av"><img src={b.photo || LOGO} alt={b.name} onError={onImgErr} /></div>
                        <div className="font-display nm-sm">{b.name}</div>
                      </button>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>
        )}

        {/* PASO 1 — SERVICIO */}
        {step === 1 && (
          <div className="animate-in" style={{ display: "grid", gap: ".8rem" }}>
            <h3 className="font-display" style={{ margin: ".2rem 0", fontSize: "1.05rem" }}>Servicio con {barber?.short}</h3>

            {/* Destacados: siempre a la vista, fuera del acordeón. Son los que
                el panel marca como destacados (Servicios → "Los más pedidos"). */}
            {featuredServices.length > 0 && (
              <div style={{ display: "grid", gap: ".5rem" }}>
                <span className="font-display" style={{ fontSize: ".72rem", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--gold-lt)" }}>Los más pedidos</span>
                <ServiceGrid>
                  {featuredServices.map((s) => (
                    <ServiceCard key={s.id} service={s} selected={serviceId === s.id} onSelect={setServiceId} />
                  ))}
                </ServiceGrid>
              </div>
            )}

            {/* Resto del catálogo por categoría, plegable: la grilla plana
                obligaba a scrollear el paso entero para ver las opciones de
                cada tipo. */}
            <div style={{ display: "grid", gap: ".45rem" }}>
              {serviceGroups.map((group) => {
                const isOpen = shownCats.includes(group.cat)
                const panelId = `svc-cat-${group.cat}`
                return (
                  <div key={group.cat} className="card" style={{ padding: 0, overflow: "hidden", borderRadius: "12px" }}>
                    <button
                      type="button"
                      onClick={() => toggleCat(group.cat)}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: ".6rem",
                        padding: ".75rem .85rem",
                        background: "none",
                        border: 0,
                        color: "inherit",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <Icon name="chevronRight" size={15} color="var(--gold-lt)" style={{ transition: "transform .2s", transform: isOpen ? "rotate(90deg)" : "none", flexShrink: 0 }} />
                      <span className="font-display" style={{ fontWeight: 600, fontSize: ".9rem", flex: 1 }}>{group.label}</span>
                      <span style={{ color: "var(--muted)", fontSize: ".75rem" }}>{group.items.length}</span>
                    </button>
                    {isOpen && (
                      <div id={panelId} style={{ padding: "0 .7rem .7rem" }}>
                        <ServiceGrid min={140}>
                          {group.items.map((s) => (
                            <ServiceCard key={s.id} service={s} selected={serviceId === s.id} onSelect={setServiceId} showBadge={FEATURES.featuredServices && s.featured} />
                          ))}
                        </ServiceGrid>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* PASO 2 — FECHA + HORA */}
        {step === 2 && (
          <div className="animate-in" style={{ display: "grid", gap: ".8rem" }}>
            <h3 className="font-display" style={{ margin: ".2rem 0", fontSize: "1.05rem" }}>Elige fecha y hora</h3>
            <div className="booking-datetime">
              {/* Un servicio de un solo día no tiene calendario que elegir, tiene
                  UNA fecha. Mostrar el mes entero apagado para que el cliente
                  cace el único día encendido es peor que decirle cuál es. */}
              {onlyOnDate ? (
                <div className="card booking-cal" style={{ padding: "1rem .8rem", display: "grid", gap: ".3rem", alignContent: "center", textAlign: "center" }}>
                  <span style={{ fontSize: ".6rem", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--gold-lt)" }}>Fecha única</span>
                  <span className="font-display" style={{ fontSize: "1rem", fontWeight: 700 }}>{longDate(onlyOnDate)}</span>
                  <span style={{ fontSize: ".68rem", color: "var(--muted)", lineHeight: 1.4 }}>{service?.name} se hace solo este día.</span>
                </div>
              ) : (
              /* CALENDARIO COMPACTO */
              <div className="card booking-cal" style={{ padding: ".7rem", display: "grid", gap: ".5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".3rem" }}>
                  <button
                    onClick={() => setMonth((mm) => Math.max(new Date().getMonth(), mm - 1))}
                    disabled={month <= new Date().getMonth()}
                    aria-label="Mes anterior"
                    style={{ background: "none", border: 0, color: "var(--gold-lt)", padding: 2, opacity: month <= new Date().getMonth() ? 0.3 : 1, cursor: month <= new Date().getMonth() ? "default" : "pointer" }}
                  ><Icon name="arrowLeft" size={16} /></button>
                  <span className="font-display booking-cal-month" style={{ fontWeight: 600, fontSize: ".85rem", letterSpacing: ".02em" }}>{MONTHS_ES[month]} {year}</span>
                  <button
                    onClick={() => setMonth((mm) => Math.min(11, mm + 1))}
                    disabled={!canGoNextMonth}
                    aria-label="Mes siguiente"
                    style={{ background: "none", border: 0, color: "var(--gold-lt)", padding: 2, opacity: !canGoNextMonth ? 0.3 : 1, cursor: !canGoNextMonth ? "default" : "pointer" }}
                  ><Icon name="arrowRight" size={16} /></button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: ".2rem", marginBottom: ".3rem" }}>
                  {DAYS_ES.map((d) => <div key={d} className="booking-cal-dow" style={{ textAlign: "center", fontSize: ".5rem", letterSpacing: ".04em", color: "var(--muted-2)", textTransform: "uppercase", padding: ".1rem 0" }}>{d[0]}</div>)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: ".2rem" }}>
                  {cells.map((d, i) => {
                    if (!d) return <div key={i} />
                    const k = dk(d)
                    const disabled = isPast(d) || isTooFar(d)
                    const sel = dateKey === k
                    return (
                      <button key={i} disabled={disabled} onClick={() => { setDateKey(k); setSlot(null) }} className="booking-cal-day" style={{
                        aspectRatio: "1", borderRadius: 6, border: sel ? "0" : "1px solid transparent",
                        background: sel ? "var(--gold-grad)" : disabled ? "transparent" : "var(--fill-softer)",
                        color: sel ? "var(--on-gold)" : disabled ? "var(--muted-2)" : "var(--ink)",
                        fontSize: ".65rem", fontWeight: sel ? 700 : 400, cursor: disabled ? "default" : "pointer",
                        opacity: disabled ? .35 : 1, transition: "all .15s", padding: 0
                      }}>{d}</button>
                    )
                  })}
                </div>
                <div style={{ fontSize: ".6rem", color: "var(--muted-2)", textAlign: "center", marginTop: ".3rem" }}>Reservas hasta {MAX_LEAD_DAYS} días antes</div>
              </div>
              )}

              {/* HORAS DISPONIBLES */}
              {dateKey && (
                <div className="animate-up booking-hours" style={{ display: "grid", gap: ".6rem" }}>
                  {service && blocksFor(service) > 1 && (
                    <div style={{ fontSize: ".68rem", color: "var(--muted)" }}>
                      Este servicio dura {blocksFor(service)} horas: se bloquean {blocksFor(service)} horarios seguidos.
                    </div>
                  )}
                  {Object.entries(SLOT_GROUPS).map(([grp, list]) => (
                    <div key={grp}>
                      <div style={{ fontSize: ".65rem", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)", marginBottom: ".4rem", fontWeight: 600 }}>{grp}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: ".3rem" }}>
                        {list.map((t) => {
                          const slotFree = (s) => {
                            const fromApi = availableSlots.find((item) => item.slot === s)
                            const st = fromApi ? (fromApi.available ? "free" : "booked") : slotState(barberId, dateKey, s)
                            return st === "free" && !isSlotTooSoon(dateKey, s, todayKey, now)
                          }
                          const span = spanFor(t, blocksFor(service))
                          const taken = !span || !span.every(slotFree)
                          const sel = slot === t
                          return (
                            <button key={t} disabled={taken} onClick={() => setSlot(t)} className="booking-slot" style={{
                              padding: ".4rem 0", borderRadius: 6, fontSize: ".7rem", fontWeight: sel ? 700 : 400,
                              border: sel ? "0" : "1px solid var(--hair-2)",
                              background: sel ? "var(--gold-grad)" : taken ? "var(--fill-faint)" : "var(--fill-soft)",
                              color: sel ? "var(--on-gold)" : taken ? "var(--muted-2)" : "var(--ink)",
                              textDecoration: taken ? "line-through" : "none", cursor: taken ? "default" : "pointer",
                              opacity: taken ? .45 : 1, transition: "all .15s",
                            }}>{t}</button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PASO 3 — CONFIRMADO */}
        {step === 3 && (
          <div className="animate-scale" style={{ display: "grid", justifyItems: "center", gap: ".7rem", textAlign: "center", padding: "1rem 0", maxWidth: "600px", margin: "0 auto" }}>
            <div style={{ width: 60, height: 60, borderRadius: 999, background: "var(--gold-grad)", display: "grid", placeItems: "center", color: "var(--on-gold)", boxShadow: "var(--shadow-gold)" }}>
              <Icon name="check" size={32} stroke={2.4} />
            </div>
            <div>
              <h2 className="font-display" style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>¡Reserva confirmada!</h2>
              <p style={{ margin: ".3rem 0 0", color: "var(--muted)", fontSize: ".8rem" }}>Te enviamos la confirmación por correo.</p>
            </div>
            <div className="card card-line" style={{ width: "100%", padding: ".8rem", display: "grid", gap: ".5rem", textAlign: "left", fontSize: ".8rem" }}>
              {[["Barbero", barber?.name], ["Servicio", service?.name], ["Fecha", dateKey && `${dateKey.split("-")[2]} ${MONTHS_ES[parseInt(dateKey.split("-")[1]) - 1]}`], ["Hora", `${slot} hrs`], ["Total", service && CLP(service.price)]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "var(--muted)", fontSize: ".75rem" }}>{k}</span>
                  <span className="font-display" style={{ fontWeight: 600, fontSize: ".85rem", color: k === "Total" ? "var(--gold-lt)" : "var(--ink)" }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".4rem", width: "100%" }}>
              <button className="btn btn-gold" style={{ padding: ".4rem .6rem", fontSize: ".7rem" }} onClick={() => navigate("/cuenta")}>Ver citas</button>
              <button className="btn btn-ghost" style={{ padding: ".4rem .6rem", fontSize: ".7rem" }} onClick={reset}>Reservar otra</button>
            </div>
          </div>
        )}
      </div>

      {bookingError && step === 2 && (
        <div style={{ margin: "0 1.2rem .6rem", padding: ".6rem .8rem", borderRadius: 10, background: "rgba(220,80,60,0.1)", border: "1px solid rgba(220,80,60,0.35)", color: "#c94b3a", fontSize: ".75rem" }}>
          {bookingError}
        </div>
      )}

      {step < 3 && (
        <div className="booking-footer">
          {(barber || service) && (
            <div style={{ display: "flex", flexDirection: "column", gap: ".3rem", fontSize: ".7rem", color: "var(--muted)", flex: 1 }}>
              <span>{barber?.short}{service ? ` · ${service.name}` : ""}</span>
              {service && <span className="gold-text font-display" style={{ fontWeight: 700, fontSize: ".85rem" }}>{CLP(service.price)}</span>}
            </div>
          )}
          <button className="btn btn-gold booking-continue-btn" disabled={!canNext || saving}
            onClick={step === 2 ? confirm : () => setStep(step + 1)}
            style={{ opacity: (canNext && !saving) ? 1 : .4, pointerEvents: (canNext && !saving) ? "auto" : "none", padding: ".45rem .8rem", fontSize: ".7rem", flexShrink: 0, whiteSpace: "nowrap" }}>
            {saving ? "Confirmando…" : (step === 2 ? "Confirmar" : "Continuar")} {!saving && <Icon name="arrowRight" size={12} />}
          </button>
        </div>
      )}

      <WalletPrompt open={walletOpen} onClose={closeWallet} phone={clientPhone} />
    </MobileScreen>
  )
}
