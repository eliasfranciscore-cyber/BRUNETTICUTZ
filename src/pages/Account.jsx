import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brandmark, Icon, MobileScreen } from '../components/ui.jsx'
import { CLIENT_APPTS, barberById, CLP, MONTHS_ES } from '../data.js'
import { readLocalBookings, cancelLocalBooking, isCancelled, isOrphanLocalBooking, removeOrphanLocalBooking, markLocalBookingSynced } from '../bookingsStore.js'
import WalletPrompt, { useAutoWalletPrompt } from '../components/WalletPrompt.jsx'
import { walletPlatform, walletPassURL, fetchGoogleWalletSaveURL } from '../walletPrompt.js'

/* Reservas locales "huérfanas" (creadas offline, sin id real del backend):
   reintenta guardarlas de verdad ahora que hay conexión, y si el servidor
   confirma que ya existen o que ese horario ya no es válido, deja de
   mostrarlas como si fueran una cita real. Best-effort: sin esto no rompe
   nada, solo evita que una reserva fantasma quede pegada para siempre. */
async function reconcileOrphanLocalBookings(serverBookings, phone) {
  const orphans = readLocalBookings().filter((b) => isOrphanLocalBooking(b) && String(b.phone || "").replace(/\D/g, "") === phone)
  for (const orphan of orphans) {
    const existsOnServer = serverBookings.some((sb) =>
      Number(sb.barberId) === Number(orphan.barberId) && sb.date === orphan.date && sb.time === orphan.time)
    if (existsOnServer) { removeOrphanLocalBooking(orphan); continue }
    if (new Date(`${orphan.date}T${orphan.time}`).getTime() < Date.now()) { removeOrphanLocalBooking(orphan); continue }
    if (!orphan.serviceId) continue // sin servicio no se puede reintentar; se revisa de nuevo en la próxima carga
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone, barberId: orphan.barberId, serviceId: orphan.serviceId, date: orphan.date, time: orphan.time,
          idempotencyKey: `reconcile-${orphan.id}`,
        }),
      })
      if (!res.headers.get("content-type")?.includes("application/json")) continue
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.booking?.id) {
        markLocalBookingSynced(orphan, data.booking.id)
      } else if (res.status === 409 || res.status === 422) {
        // Rechazo definitivo (horario ya tomado / fuera de la ventana permitida): no insistir más.
        removeOrphanLocalBooking(orphan)
      }
      // Otros errores (500, 429, etc.): se deja para reintentar en la próxima carga de la página.
    } catch { /* sigue sin conexión real: se reintenta en la próxima carga */ }
  }
}

// Combina las citas (API/demo) con las reservas locales del cliente para que su
// reserva recién hecha aparezca de inmediato en "Próxima cita" / historial.
function withLocalAppts(appts, phone) {
  // Componentes locales, no UTC: toISOString() adelanta la fecha durante la
  // noche en Chile (UTC-3/-4), lo que corría citas de "próxima" a "pasada"
  // antes de tiempo.
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  const clean = String(phone || "").replace(/\D/g, "")
  const local = readLocalBookings()
    .filter((b) => String(b.phone || "").replace(/\D/g, "") === clean)
    .map((b) => ({ ...b, when: b.date >= todayKey ? "next" : "past" }))
  const byKey = new Map()
  const keyOf = (a) => `${a.date}|${a.time}|${Number(a.barberId)}`
  ;[...appts, ...local].forEach((a) => byKey.set(keyOf(a), a))
  return [...byKey.values()]
    .filter((a) => !isCancelled(a)) // ocultar citas canceladas
    .sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")))
}

export default function Account() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [appts, setAppts] = useState(CLIENT_APPTS)

  useEffect(() => {
    const stored = localStorage.getItem("ps_user")
    if (!stored) { navigate("/login"); return }
    const parsed = JSON.parse(stored)
    setUser(parsed)
    // Mostrar de inmediato la reserva local recién creada.
    setAppts((current) => withLocalAppts(current, parsed.phone))
    fetch("/api/clients?phone=" + parsed.phone)
      .then(r => r.json())
      .then(data => { if (data.client) setUser((current) => ({ ...current, ...data.client })) })
      .catch(() => {})
    fetch("/api/bookings?phone=" + parsed.phone)
      .then(r => r.json())
      .then(async (data) => {
        const serverBookings = data.bookings || []
        setAppts(withLocalAppts(serverBookings.length ? serverBookings : CLIENT_APPTS, parsed.phone))
        if (data.ok) {
          await reconcileOrphanLocalBookings(serverBookings, parsed.phone)
          setAppts(withLocalAppts(serverBookings.length ? serverBookings : CLIENT_APPTS, parsed.phone))
        }
      })
      .catch(() => {})
  }, [])

  const logout = () => { localStorage.removeItem("ps_user"); navigate("/") }

  const MIN_CANCEL_NOTICE_HOURS = 10
  const cancelAppt = async (appt) => {
    if (!appt) return
    const apptAt = new Date(`${appt.date}T${appt.time}`)
    const hoursLeft = (apptAt.getTime() - Date.now()) / 3_600_000
    if (hoursLeft < MIN_CANCEL_NOTICE_HOURS) {
      window.alert(`Solo puedes cancelar con al menos ${MIN_CANCEL_NOTICE_HOURS} horas de anticipación. Contáctanos directamente para resolverlo.`)
      return
    }
    if (!window.confirm("¿Cancelar esta cita? Esta acción no se puede deshacer.")) return
    // Mejor esfuerzo contra el backend (marca cancelada + avisa al barbero);
    // el estado local es la fuente inmediata para la UI.
    if (appt.id) {
      const res = await fetch(`/api/bookings?id=${appt.id}`, { method: "DELETE" }).catch(() => null)
      if (res && !res.ok) {
        const data = await res.json().catch(() => null)
        window.alert(data?.error || "No se pudo cancelar la cita. Intenta de nuevo.")
        return
      }
    }
    cancelLocalBooking(appt)
    setAppts((current) => current.filter((a) => !(a.date === appt.date && a.time === appt.time && Number(a.barberId) === Number(appt.barberId))))
  }

  const next = appts.find((a) => a.when === "next")
  const past = appts.filter((a) => a.when === "past")
  const nb = next && barberById(next.barberId)

  // Fidelidad: el saldo viene del programa de Pimp Studio (la misma tarjeta
  // sirve en los dos locales) a través del puente del backend. `loyalty` va
  // null si el puente no está disponible: en ese caso no se muestra nada, en
  // vez de inventar un saldo en 0 que confundiría al cliente.
  const loyalty = user?.loyalty || null
  const [walletOpen, closeWallet] = useAutoWalletPrompt(Boolean(user?.phone) && !user?.walletHasPass, user?.phone)
  const [walletBusy, setWalletBusy] = useState(false)
  const platform = walletPlatform()

  const addToWallet = async () => {
    if (platform === "android") {
      setWalletBusy(true)
      try {
        window.location.href = await fetchGoogleWalletSaveURL(user.phone)
      } catch {
        window.alert("No se pudo generar el pase. Intenta de nuevo más tarde.")
      } finally {
        setWalletBusy(false)
      }
      return
    }
    window.location.href = walletPassURL(user.phone)
  }

  if (!user) return null

  return (
    <MobileScreen>
      <div style={{ padding: "0.6rem 1.3rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Brandmark size={34} />
        <button onClick={logout} className="chip" style={{ cursor: "pointer" }}><Icon name="logout" size={14} /> Salir</button>
      </div>

      <div style={{ padding: "0 1.3rem 2.2rem", display: "grid", gap: ".8rem", maxWidth: "900px", margin: "0 auto" }}>
        <div className="card animate-up" style={{ padding: "1rem", display: "flex", alignItems: "center", gap: ".8rem" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--gold-grad)", display: "grid", placeItems: "center", fontSize: "1.2rem", fontWeight: 700, color: "#1a1407", flexShrink: 0 }}>
            {(user.name || "C")[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="font-display" style={{ fontWeight: 600, fontSize: "1rem" }}>{user.name || "Cliente"}</div>
            <div style={{ color: "var(--muted)", fontSize: ".75rem" }}>+56 {user.phone?.replace(/(\d)(\d{4})(\d{4})/, "$1 $2 $3")}</div>
          </div>
          <span className="chip chip-gold" style={{ flexShrink: 0, fontSize: ".7rem" }}><Icon name="star" size={11} /> {past.length || user.visits || 0}</span>
        </div>

        <div className="account-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: ".6rem" }}>
          <div className="card"><strong style={{ fontSize: "1.3rem" }}>{past.length || user.visits || 0}</strong><span>Cortes</span></div>
          <div className="card"><strong style={{ fontSize: "1.1rem" }}>{CLP(user.totalSpent || past.reduce((sum, item) => sum + Number(item.price || 0), 0))}</strong><span>Gastado</span></div>
          <div className="card"><strong style={{ fontSize: "1rem" }}>{next ? next.date : "Sin cita"}</strong><span>Próxima</span></div>
        </div>

        {loyalty && (
          <div className="card card-line animate-up" style={{ padding: ".9rem", display: "grid", gap: ".6rem", animationDelay: ".03s" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem" }}>
              <div>
                <div className="font-display" style={{ fontWeight: 600, fontSize: ".95rem" }}>Tarjeta de fidelidad</div>
                <div style={{ color: "var(--muted)", fontSize: ".72rem" }}>
                  {loyalty.freeCutReady
                    ? "¡Tu próximo corte va gratis! Avísale a tu barbero."
                    : `${loyalty.cutsToFreeCut} ${loyalty.cutsToFreeCut === 1 ? "corte más" : "cortes más"} para tu corte gratis`}
                </div>
              </div>
              <span className="chip chip-gold" style={{ flexShrink: 0, fontSize: ".7rem" }}>
                <Icon name="star" size={11} /> {loyalty.stars}/{loyalty.goal}
              </span>
            </div>

            {/* Diez sellos, uno por estrella — el mismo dibujo que trae el pase
                en Wallet, para que el cliente reconozca que es lo mismo. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: ".25rem" }}>
              {Array.from({ length: loyalty.goal }, (_, i) => (
                <span key={i} style={{
                  aspectRatio: "1", borderRadius: 999, display: "grid", placeItems: "center",
                  background: i < loyalty.stars ? "var(--gold-grad)" : "rgba(255,255,255,.04)",
                  border: `1px solid ${i < loyalty.stars ? "transparent" : "var(--hair-2)"}`,
                  color: i < loyalty.stars ? "var(--on-gold)" : "var(--muted-2)",
                }}>
                  <Icon name="star" size={10} />
                </span>
              ))}
            </div>

            {loyalty.productDiscountReady && (
              <div className="chip" style={{ fontSize: ".68rem", justifySelf: "start" }}>
                {loyalty.productDiscountPct}% de descuento en productos, activo en tu próxima visita
              </div>
            )}

            {platform && !user.walletHasPass && (
              <button className="btn btn-gold btn-block" onClick={addToWallet} disabled={walletBusy} style={{ fontSize: ".75rem", padding: ".5rem" }}>
                <Icon name="wallet" size={14} /> {walletBusy ? "Generando…" : `Agregar a ${platform === "android" ? "Google Wallet" : "Apple Wallet"}`}
              </button>
            )}
          </div>
        )}

        <div className="animate-up" style={{ animationDelay: ".06s" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".4rem" }}>
            <span className="eyebrow" style={{ fontSize: ".75rem" }}>Próxima cita</span>
            <button onClick={() => navigate("/reservar")} style={{ background: "none", border: 0, color: "var(--gold)", fontSize: ".65rem", letterSpacing: ".08em", textTransform: "uppercase" }}>+ Nueva</button>
          </div>
          {next ? (
            <div className="card card-line" style={{ padding: ".8rem", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(300px 120px at 90% 0%, rgba(201,161,78,0.12), transparent 70%)" }} />
              <div style={{ position: "relative", display: "grid", gap: ".5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: ".5rem" }}>
                  <div>
                    <div className="font-display" style={{ fontSize: ".95rem", fontWeight: 600 }}>{next.service}</div>
                    <div style={{ color: "var(--muted)", fontSize: ".75rem" }}>con {nb?.name}</div>
                  </div>
                  <span className="chip chip-gold" style={{ textTransform: "uppercase", fontSize: ".6rem", padding: ".25rem .5rem", flexShrink: 0 }}>{next.status}</span>
                </div>
                <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap" }}>
                  <span className="chip" style={{ fontSize: ".65rem", padding: ".3rem .5rem" }}><Icon name="calendar" size={11} color="var(--gold)" /> {next.date}</span>
                  <span className="chip" style={{ fontSize: ".65rem", padding: ".3rem .5rem" }}><Icon name="clock" size={11} color="var(--gold)" /> {next.time} hrs</span>
                  <span className="chip" style={{ fontSize: ".65rem", padding: ".3rem .5rem" }}>{CLP(next.price)}</span>
                </div>
                <div style={{ display: "flex", gap: ".4rem" }}>
                  <button className="btn btn-dark btn-sm" style={{ flex: 1, fontSize: ".65rem", padding: ".35rem" }} onClick={() => navigate("/reservar")}>Reagendar</button>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1, fontSize: ".65rem", padding: ".35rem" }} onClick={() => cancelAppt(next)}>Cancelar</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: "1rem", textAlign: "center", color: "var(--muted)", fontSize: ".8rem" }}>No tienes citas próximas.</div>
          )}
        </div>

        <div className="animate-up" style={{ animationDelay: ".12s" }}>
          <span className="eyebrow" style={{ display: "block", marginBottom: ".4rem", fontSize: ".75rem" }}>Historial</span>
          <div style={{ display: "grid", gap: ".4rem" }}>
            {past.slice(0, 5).map((a) => {
              const b = barberById(a.barberId)
              return (
                <div key={a.id} className="card" style={{ padding: ".6rem .8rem", display: "flex", alignItems: "center", gap: ".6rem", fontSize: ".8rem" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(201,161,78,0.08)", border: "1px solid var(--gold-line)", display: "grid", placeItems: "center", color: "var(--gold)", flexShrink: 0 }}>
                    <Icon name="cut" size={14} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{a.service}</div>
                    <div style={{ color: "var(--muted)", fontSize: ".7rem" }}>{b?.short} · {a.date?.split("-").reverse().join("/")}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 600, color: "var(--gold)" }}>{CLP(a.price)}</div>
                    <div style={{ fontSize: ".65rem", color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".04em" }}>{a.status}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <button className="btn btn-gold btn-block" onClick={() => navigate("/reservar")} style={{ fontSize: ".8rem", padding: ".6rem" }}><Icon name="calendar" size={14} /> Agendar nueva cita</button>
      </div>

      <WalletPrompt open={walletOpen} onClose={closeWallet} phone={user?.phone} />
    </MobileScreen>
  )
}
