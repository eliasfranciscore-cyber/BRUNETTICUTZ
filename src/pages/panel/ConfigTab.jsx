import React, { useState, useEffect } from 'react'
import {
  pushEnabledFor, enablePush, disablePush, notifyLocal, permissionState,
  pushSupported, isIOS, isStandalone,
} from '../../push.js'
import { Icon } from '../../components/ui.jsx'
import { useTheme } from '../../components/theme.jsx'
import { EXPENSE_CATEGORIES, CATEGORY_META } from '../../components/ExpensesModule.jsx'
import BarberModal from '../../components/BarberModal.jsx'

/* ============================================================
   Config Panel — Santa Julieta style two-column settings
   ============================================================ */
export const CFG_SECTIONS = [
  { id: "cuenta",        icon: "user",     label: "Cuenta y seguridad", kw: "contraseña password usuario nombre rol" },
  { id: "apariencia",    icon: "star",     label: "Apariencia", kw: "tema modo claro oscuro" },
  { id: "accesos",       icon: "pin",      label: "Accesos directos", kw: "dock atajos shortcuts" },
  { id: "navegacion",    icon: "grid",     label: "Navegacion", kw: "pestañas tabs orden menu" },
  { id: "notificaciones",icon: "bell",     label: "Notificaciones", kw: "push alertas avisos" },
  { id: "whatsapp",      icon: "whatsapp", label: "WhatsApp", kw: "recordatorio plantillas mensajes" },
  { id: "negocio",       icon: "scissors", label: "Negocio", kw: "horario direccion telefono nombre local" },
  { id: "precios",       icon: "wallet",   label: "Precios y fechas", kw: "cursos workshop precio fecha mercado pago" },
  { id: "presupuestos",  icon: "wallet",   label: "Presupuestos", kw: "gastos categoria limite" },
  { id: "equipo",        icon: "key",      label: "Equipo y permisos", kw: "barberos permisos roles" },
  { id: "datos",         icon: "wallet",   label: "Datos y respaldos", kw: "exportar csv respaldo backup" },
  { id: "acerca",        icon: "spark",    label: "Acerca de", kw: "version creditos" },
]

export function ConfigSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 26, borderRadius: 13, border: "none", cursor: disabled ? "default" : "pointer",
        background: checked ? "var(--gold)" : "var(--hair-2)",
        position: "relative", flexShrink: 0, transition: "background .2s",
        opacity: disabled ? .45 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: checked ? 21 : 3, width: 20, height: 20,
        borderRadius: "50%", background: "#fff", transition: "left .2s",
        boxShadow: "0 1px 4px rgba(0,0,0,.35)",
      }} />
    </button>
  )
}

export function CfgRow({ label, sub, children }) {
  return (
    <div className="cfg-setting-row">
      <div>
        <div className="cfg-setting-label">{label}</div>
        {sub && <div className="cfg-setting-sub">{sub}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

/* Notificaciones push para iOS (app instalada en inicio).
   Solo activa avisos para el barbero autenticado (su usuario): recibirá un push
   cuando un cliente agende una hora con él. */
export function PushCard({ barber }) {
  const [perm, setPerm] = useState(() => permissionState())
  const [enabled, setEnabled] = useState(() => pushEnabledFor(barber))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const supported = pushSupported()
  const iosNeedsInstall = isIOS() && !isStandalone()

  const toggle = async () => {
    setBusy(true); setMsg("")
    if (enabled) {
      await disablePush(barber)
      setEnabled(false)
      setMsg("Notificaciones desactivadas.")
    } else {
      const r = await enablePush(barber)
      setPerm(r.permission)
      if (r.ok) {
        setEnabled(true)
        setMsg("Listo. Te avisaremos cuando agenden una hora contigo.")
      } else if (r.reason === "ios-needs-install") {
        setMsg("En iPhone: abre el menú Compartir y elige “Agregar a inicio”. Luego abre la app instalada y activa aquí.")
      } else if (r.reason === "denied") {
        setMsg("Permiso de notificaciones bloqueado. Actívalo en los ajustes del navegador/app.")
      } else if (r.reason === "unsupported") {
        setMsg("Este navegador no soporta notificaciones push.")
      } else {
        setMsg("No se pudo activar. Intenta nuevamente.")
      }
    }
    setBusy(false)
  }

  const test = async () => {
    const ok = await notifyLocal({
      title: "Brunetti",
      body: `Prueba de notificación para ${barber?.name || "ti"}.`,
    })
    setMsg(ok ? "Notificación de prueba enviada." : "Activa primero las notificaciones para probar.")
  }

  return (
    <div className="cfg-card">
      <p className="cfg-card-head">Notificaciones push · iOS</p>
      <CfgRow
        label="Avisarme de nuevas reservas"
        sub="Recibe un aviso cuando un cliente agende una hora contigo."
      >
        <ConfigSwitch checked={enabled} disabled={busy || iosNeedsInstall} onChange={toggle} />
      </CfgRow>

      {iosNeedsInstall && (
        <div style={{
          marginTop: ".8rem", padding: ".85rem 1rem", borderRadius: 12,
          border: "1px solid var(--gold-line)", background: "rgba(201,161,78,0.07)",
          fontSize: ".82rem", color: "var(--ink-soft)", lineHeight: 1.5,
        }}>
          <strong style={{ color: "var(--gold-lt)" }}>Para activar en iPhone:</strong> abre esta web en Safari,
          toca <b>Compartir</b> → <b>Agregar a inicio</b>. Abre la app instalada y vuelve aquí para activar las push.
        </div>
      )}

      {!supported && !iosNeedsInstall && (
        <p style={{ marginTop: ".7rem", fontSize: ".8rem", color: "var(--muted)" }}>
          Este dispositivo o navegador no soporta notificaciones push.
        </p>
      )}

      {enabled && (
        <button className="btn btn-dark btn-sm" style={{ marginTop: ".9rem" }} onClick={test}>
          <Icon name="bell" size={13} /> Enviar notificación de prueba
        </button>
      )}

      {msg && <p style={{ marginTop: ".8rem", fontSize: ".8rem", color: "var(--gold-lt)" }}>{msg}</p>}

      <p style={{ marginTop: ".9rem", fontSize: ".74rem", color: "var(--muted-2)", lineHeight: 1.5 }}>
        Solo tú recibirás estos avisos en tu cuenta. Estado del permiso: <b>{perm}</b>.
      </p>
    </div>
  )
}

export function isStrongPassword(pw) {
  return /^[A-Za-z0-9]{8,64}$/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw)
}

export function ConfigPanel({ brunettiOnly, barber, barbers, admin, canManageTeam, barberDraft, setBarberDraft, saveBarber, updateBarberLocal, deleteBarber, onExport, onLogout, nav, navSettings, setNavSettings, dockShortcuts, setDockShortcuts, expenseBudgets = {}, setExpenseBudgets = () => {} }) {
  const [section, setSection] = useState(null)
  // En modo "solo Brunetti" se oculta la gestión de Equipo/barberos (código conservado).
  // Presupuestos es exclusivo de admin (gestiona finanzas del negocio).
  const sections = CFG_SECTIONS
    .filter((s) => brunettiOnly ? s.id !== "equipo" : true)
    .filter((s) => s.id !== "presupuestos" || admin)
  const [teamModal, setTeamModal] = useState(null) // null=cerrado; {barber:null}=crear; {barber:obj}=editar
  const [biz, setBiz] = useState(() => {
    try { return { name: "Brunetti Barber Studio", address: "Maipú, Santiago", phone: "+56 9 1234 5678", waPhone: "+56 9 1234 5678", ...JSON.parse(localStorage.getItem("ps_biz") || "{}") } } catch { return { name: "Brunetti Barber Studio", address: "Maipú, Santiago", phone: "+56 9 1234 5678", waPhone: "+56 9 1234 5678" } }
  })
  const [bizSaved, setBizSaved] = useState("")
  const saveBiz = () => {
    try { localStorage.setItem("ps_biz", JSON.stringify(biz)) } catch {}
    setBizSaved("ok"); setTimeout(() => setBizSaved(""), 1800)
  }
  const [pwOpen, setPwOpen] = useState(false)
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" })
  const [pwStatus, setPwStatus] = useState("") // "", "saving", "done"
  const [pwError, setPwError] = useState("")

  const changePassword = async () => {
    setPwError("")
    if (!isStrongPassword(pwForm.next)) {
      setPwError("La nueva contraseña debe tener 8 caracteres alfanuméricos, con al menos 1 mayúscula y 1 número.")
      return
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwError("Las contraseñas no coinciden.")
      return
    }
    setPwStatus("saving")
    try {
      const token = localStorage.getItem("ps_barber_token") || ""
      const res = await fetch("/api/auth-barber", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setPwStatus("done")
        setPwForm({ current: "", next: "", confirm: "" })
        setTimeout(() => { setPwStatus(""); setPwOpen(false) }, 2000)
      } else {
        setPwStatus("")
        setPwError(data.error || "No se pudo cambiar la contraseña.")
      }
    } catch {
      setPwStatus("")
      setPwError("No se pudo conectar con el servidor.")
    }
  }
  const [notifSettings, setNotifSettings] = useState({ reserva: true, cancelacion: true, recordatorio: true, marketing: false })
  const [waSettings, setWaSettings] = useState({ activo: true, recordatorio24h: true, recordatorio2h: false, confirmacion: true })
  const [acct, setAcct] = useState({ name: barber?.name || "", code: barber?.code || "" })
  const [acctSaved, setAcctSaved] = useState(false)
  const saveAccount = () => {
    const updated = { ...barber, name: acct.name.trim() || barber?.name, code: acct.code.trim() || barber?.code }
    try { localStorage.setItem("ps_barber", JSON.stringify(updated)) } catch {}
    setAcctSaved(true)
    setTimeout(() => setAcctSaved(false), 2500)
  }
  const { theme, toggle } = useTheme()

  // PRECIOS Y FECHAS — a diferencia del resto de Config (que vive en
  // localStorage), esto se guarda en la DB porque también lo lee el
  // cobro real de Mercado Pago (api/mp-payments.js) y las páginas
  // públicas de Cursos/Workshop.
  const [precios, setPrecios] = useState({ cursosPrice: "", workshopPrice: "", workshopDate: "", workshopPaymentsEnabled: false })
  const [preciosLoading, setPreciosLoading] = useState(true)
  const [preciosStatus, setPreciosStatus] = useState("") // "", "saving", "done"
  const [preciosError, setPreciosError] = useState("")
  const [pagosBusy, setPagosBusy] = useState(false)
  useEffect(() => {
    fetch("/api/mp-payments?settings=1")
      .then((r) => r.json())
      .then((s) => setPrecios({
        cursosPrice: s.cursosPrice ?? "",
        workshopPrice: s.workshopPrice ?? "",
        workshopDate: s.workshopDate ? new Date(s.workshopDate).toISOString().slice(0, 16) : "",
        workshopPaymentsEnabled: !!s.workshopPaymentsEnabled,
      }))
      .catch(() => {})
      .finally(() => setPreciosLoading(false))
  }, [])
  const savePrecios = async () => {
    setPreciosStatus("saving"); setPreciosError("")
    try {
      const token = localStorage.getItem("ps_barber_token") || ""
      const res = await fetch("/api/mp-payments?settings=1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          cursosPrice: Number(precios.cursosPrice) || 0,
          workshopPrice: Number(precios.workshopPrice) || 0,
          workshopDate: precios.workshopDate ? new Date(precios.workshopDate).toISOString() : "",
          workshopPaymentsEnabled: precios.workshopPaymentsEnabled,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo guardar")
      setPreciosStatus("done")
      setTimeout(() => setPreciosStatus(""), 2000)
    } catch (err) {
      setPreciosStatus("")
      setPreciosError(err.message || "No se pudo conectar con el servidor.")
    }
  }

  /* El interruptor guarda solo, sin pasar por "Guardar": cortar los cobros es
     algo que se hace de urgencia y no puede quedar a medias en pantalla. Si el
     PATCH falla se revierte para no mostrar un estado que el servidor no tiene. */
  const toggleWorkshopPagos = async (v) => {
    const prev = precios.workshopPaymentsEnabled
    setPagosBusy(true); setPreciosError("")
    setPrecios((p) => ({ ...p, workshopPaymentsEnabled: v }))
    try {
      const token = localStorage.getItem("ps_barber_token") || ""
      const res = await fetch("/api/mp-payments?settings=1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ workshopPaymentsEnabled: v }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo guardar")
    } catch (err) {
      setPrecios((p) => ({ ...p, workshopPaymentsEnabled: prev }))
      setPreciosError(err.message || "No se pudo conectar con el servidor.")
    } finally {
      setPagosBusy(false)
    }
  }

  const current = sections.find((s) => s.id === section)
  const [sectionQuery, setSectionQuery] = useState("")
  const visibleSections = sections.filter((s) => {
    const q = sectionQuery.trim().toLowerCase()
    if (!q) return true
    return s.label.toLowerCase().includes(q) || s.kw?.toLowerCase().includes(q)
  })

  // Escritorio (≥1024px): lista + contenido lado a lado, la lista nunca se
  // oculta — "secciones colapsables" en vez de navegar a pantalla completa.
  // Móvil: la lista desaparece mientras hay una sección abierta (regla CSS
  // con :has, ver .cfg-split) — mismo comportamiento de siempre ahí.
  return (
    <div className="animate-in cfg-split">
      <div className="cfg-list-screen">
        <p className="cfg-nav-head">Configuraciones</p>
        <div className="cfg-search">
          <Icon name="user" size={15} />
          <input value={sectionQuery} onChange={(e) => setSectionQuery(e.target.value)} placeholder="Buscar un ajuste…" />
        </div>
        <div className="cfg-list">
          {visibleSections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`cfg-list-item ${section === s.id ? "is-active" : ""}`}
              onClick={() => setSection(section === s.id ? null : s.id)}
            >
              <span className="cfg-list-icon"><Icon name={s.icon} size={18} /></span>
              <span className="cfg-list-label">{s.label}</span>
              <Icon name={section === s.id ? "close" : "arrowRight"} size={16} style={{ opacity: .4 }} />
            </button>
          ))}
          {!visibleSections.length && <p className="empty-state" style={{ fontSize: ".84rem" }}>Sin ajustes que coincidan.</p>}
        </div>
      </div>

      {section && (
      <div className="cfg-detail-screen">
      <button type="button" className="cfg-back" onClick={() => setSection(null)}>
        <Icon name="arrowLeft" size={16} /> Volver a ajustes
      </button>
      <div className="cfg-content">
        <h2 className="cfg-content-title">{current?.label}</h2>

        {/* CUENTA Y SEGURIDAD */}
        {section === "cuenta" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Datos personales</p>
              <div className="cfg-form-grid">
                <div className="cfg-field">
                  <label>Nombre</label>
                  <input className="input" value={acct.name} onChange={(e) => setAcct((a) => ({ ...a, name: e.target.value }))} placeholder="Nombre completo" />
                </div>
                <div className="cfg-field">
                  <label>Usuario</label>
                  <input className="input" value={acct.code} onChange={(e) => setAcct((a) => ({ ...a, code: e.target.value.toLowerCase().replace(/\s+/g, "-") }))} placeholder="usuario" />
                </div>
                <div className="cfg-field">
                  <label>Rol</label>
                  <input className="input" defaultValue={barber?.role || "Barbero"} disabled />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: ".8rem", marginTop: ".5rem" }}>
                <button className="btn btn-gold" onClick={saveAccount}><Icon name="check" size={14} /> Guardar cambios</button>
                {acctSaved && <span className="chip chip-gold" style={{ fontSize: ".72rem" }}><Icon name="check" size={12} /> Guardado</span>}
              </div>
            </div>

            <div className="cfg-card">
              <p className="cfg-card-head">Cambiar contraseña</p>
              {!pwOpen && (
                <button className="btn btn-dark" onClick={() => { setPwOpen(true); setPwError(""); setPwStatus(""); setPwForm({ current: "", next: "", confirm: "" }) }}>
                  <Icon name="key" size={14} /> Cambiar contraseña
                </button>
              )}
              {pwOpen && (
                <div style={{ display: "grid", gap: ".7rem" }}>
                  <div className="cfg-field">
                    <label>Contraseña actual</label>
                    <input className="input" type="password" autoComplete="current-password" value={pwForm.current} onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))} placeholder="Tu contraseña actual" />
                  </div>
                  <div className="cfg-field">
                    <label>Nueva contraseña</label>
                    <input className="input" type="password" autoComplete="new-password" value={pwForm.next} onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value.slice(0, 64) }))} placeholder="8+ caracteres, 1 mayúscula y 1 número" />
                  </div>
                  <div className="cfg-field">
                    <label>Confirmar nueva contraseña</label>
                    <input className="input" type="password" autoComplete="new-password" value={pwForm.confirm} onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value.slice(0, 64) }))} placeholder="Repite la nueva contraseña" />
                  </div>
                  <p style={{ fontSize: ".74rem", color: pwForm.next && !isStrongPassword(pwForm.next) ? "#d99a8f" : "var(--muted-2)", margin: 0 }}>
                    Mínimo 8 caracteres alfanuméricos, con al menos 1 mayúscula y 1 número.
                  </p>
                  {pwError && <p style={{ fontSize: ".8rem", color: "#d99a8f", margin: 0 }}>{pwError}</p>}
                  {pwStatus === "done" && <p style={{ fontSize: ".8rem", color: "var(--gold-lt)", margin: 0 }}><Icon name="check" size={12} /> Contraseña actualizada.</p>}
                  <div style={{ display: "flex", gap: ".5rem", marginTop: ".2rem" }}>
                    <button className="btn btn-gold btn-sm" disabled={pwStatus === "saving"} onClick={changePassword}>
                      {pwStatus === "saving" ? "Guardando…" : "Guardar contraseña"}
                    </button>
                    <button className="btn btn-dark btn-sm" onClick={() => { setPwOpen(false); setPwError(""); setPwStatus("") }}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>

            <div className="cfg-card">
              <p className="cfg-card-head">Sesion</p>
              <CfgRow label="Cerrar sesion" sub="Seras redirigido al ingreso">
                <button className="btn btn-dark btn-sm" onClick={onLogout}><Icon name="logout" size={14} /> Salir</button>
              </CfgRow>
            </div>
          </div>
        )}

        {/* APARIENCIA */}
        {section === "apariencia" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Tema de la interfaz</p>
              <CfgRow label="Modo oscuro" sub="El modo claro solo esta disponible en el panel interno">
                <ConfigSwitch checked={theme === "dark"} onChange={() => toggle()} />
              </CfgRow>
              <div className="cfg-theme-preview">
                <div className={`cfg-theme-tile ${theme === "dark" ? "is-active" : ""}`} onClick={() => theme !== "dark" && toggle()}>
                  <div className="cfg-theme-thumb dark" />
                  <span>Oscuro</span>
                </div>
                <div className={`cfg-theme-tile ${theme === "light" ? "is-active" : ""}`} onClick={() => theme !== "light" && toggle()}>
                  <div className="cfg-theme-thumb light" />
                  <span>Claro</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ACCESOS DIRECTOS */}
        {section === "accesos" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Footer bar — 4 accesos rapidos</p>
              <p style={{ fontSize: ".82rem", color: "var(--muted)", margin: "0 0 1rem" }}>Elige los 4 modulos que aparecen en el dock móvil (el centro siempre abre el menú completo).</p>
              <div style={{ display: "grid", gap: ".6rem" }}>
                {nav.filter((n) => !n[0].includes("config")).map(([id, ic, label]) => (
                  <label key={id} style={{ display: "flex", alignItems: "center", gap: ".8rem", padding: ".6rem .8rem", borderRadius: 10, border: "1px solid var(--border)", cursor: "pointer", transition: "background .15s" }}>
                    <input
                      type="checkbox"
                      checked={dockShortcuts.includes(id)}
                      onChange={(e) => {
                        if (e.target.checked && dockShortcuts.length < 4) {
                          setDockShortcuts([...dockShortcuts, id])
                        } else if (!e.target.checked) {
                          setDockShortcuts(dockShortcuts.filter((s) => s !== id))
                        }
                      }}
                      style={{ accentColor: "var(--gold)", width: 18, height: 18 }}
                    />
                    <Icon name={ic} size={16} style={{ color: dockShortcuts.includes(id) ? "var(--gold)" : "var(--muted)" }} />
                    <span style={{ fontSize: ".88rem", flex: 1 }}>{label}</span>
                    {dockShortcuts.includes(id) && <span className="chip chip-gold" style={{ fontSize: ".66rem" }}>✓</span>}
                  </label>
                ))}
              </div>
              {dockShortcuts.length === 4 && <p style={{ fontSize: ".76rem", color: "var(--muted-2)", margin: "1rem 0 0" }}>✓ 4 accesos seleccionados</p>}
            </div>
          </div>
        )}

        {/* NAVEGACION */}
        {section === "navegacion" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Modulos visibles</p>
              <p style={{ fontSize: ".82rem", color: "var(--muted)", margin: "0 0 1rem" }}>Activa o desactiva los modulos que aparecen en la barra lateral y el dock movil.</p>
              {[
                ["agenda",    "calendar", "Agenda",    true],
                ["reservas",  "scissors", "Reservas",  true],
                ["finanzas",  "wallet",   "Finanzas",  admin],
                ["clientes",  "user",     "Clientes",  true],
                ["servicios", "cut",      "Servicios", admin],
                ["gastos",    "wallet",   "Gastos",    admin],
                ["marketing", "spark",    "Marketing", true],
              ].map(([id, ic, label, allowed]) => (
                <CfgRow key={id} label={label}>
                  <ConfigSwitch
                    checked={navSettings[id] !== false}
                    disabled={!allowed}
                    onChange={(v) => setNavSettings((s) => ({ ...s, [id]: v }))}
                  />
                </CfgRow>
              ))}
            </div>
          </div>
        )}

        {/* NOTIFICACIONES */}
        {section === "notificaciones" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <PushCard barber={barber} />
            <div className="cfg-card">
              <p className="cfg-card-head">Alertas internas</p>
              <CfgRow label="Nueva reserva" sub="Notificacion cuando un cliente agenda">
                <ConfigSwitch checked={notifSettings.reserva} onChange={(v) => setNotifSettings((s) => ({ ...s, reserva: v }))} />
              </CfgRow>
              <CfgRow label="Cancelacion" sub="Cuando un cliente cancela su cita">
                <ConfigSwitch checked={notifSettings.cancelacion} onChange={(v) => setNotifSettings((s) => ({ ...s, cancelacion: v }))} />
              </CfgRow>
              <CfgRow label="Recordatorio de cita" sub="30 minutos antes de cada servicio">
                <ConfigSwitch checked={notifSettings.recordatorio} onChange={(v) => setNotifSettings((s) => ({ ...s, recordatorio: v }))} />
              </CfgRow>
              <CfgRow label="Novedades y marketing" sub="Actualizaciones del sistema">
                <ConfigSwitch checked={notifSettings.marketing} onChange={(v) => setNotifSettings((s) => ({ ...s, marketing: v }))} />
              </CfgRow>
            </div>
          </div>
        )}

        {/* WHATSAPP */}
        {section === "whatsapp" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Mensajeria automatica</p>
              <CfgRow label="WhatsApp activo" sub="Envio automatico de mensajes a clientes">
                <ConfigSwitch checked={waSettings.activo} onChange={(v) => setWaSettings((s) => ({ ...s, activo: v }))} />
              </CfgRow>
              <CfgRow label="Recordatorio 24h" sub="Mensaje el dia previo a la cita">
                <ConfigSwitch checked={waSettings.recordatorio24h} disabled={!waSettings.activo} onChange={(v) => setWaSettings((s) => ({ ...s, recordatorio24h: v }))} />
              </CfgRow>
              <CfgRow label="Recordatorio 2h" sub="Mensaje dos horas antes">
                <ConfigSwitch checked={waSettings.recordatorio2h} disabled={!waSettings.activo} onChange={(v) => setWaSettings((s) => ({ ...s, recordatorio2h: v }))} />
              </CfgRow>
              <CfgRow label="Confirmacion de reserva" sub="Mensaje inmediato al agendar">
                <ConfigSwitch checked={waSettings.confirmacion} disabled={!waSettings.activo} onChange={(v) => setWaSettings((s) => ({ ...s, confirmacion: v }))} />
              </CfgRow>
            </div>
            <div className="cfg-card">
              <p className="cfg-card-head">Numero de negocio</p>
              <div className="cfg-form-grid">
                <div className="cfg-field">
                  <label>Telefono WhatsApp Business</label>
                  <input className="input" placeholder="+56 9 xxxx xxxx" value={biz.waPhone} onChange={(e) => setBiz((b) => ({ ...b, waPhone: e.target.value }))} />
                </div>
              </div>
              <button className="btn btn-gold" style={{ marginTop: ".5rem" }} onClick={saveBiz}><Icon name="check" size={14} /> {bizSaved ? "Guardado ✓" : "Guardar"}</button>
            </div>
          </div>
        )}

        {/* NEGOCIO */}
        {section === "negocio" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Datos del negocio</p>
              <div className="cfg-form-grid">
                <div className="cfg-field"><label>Nombre</label><input className="input" value={biz.name} onChange={(e) => setBiz((b) => ({ ...b, name: e.target.value }))} /></div>
                <div className="cfg-field"><label>Direccion</label><input className="input" value={biz.address} onChange={(e) => setBiz((b) => ({ ...b, address: e.target.value }))} /></div>
                <div className="cfg-field"><label>Telefono</label><input className="input" value={biz.phone} onChange={(e) => setBiz((b) => ({ ...b, phone: e.target.value }))} /></div>
              </div>
              <button className="btn btn-gold" style={{ marginTop: ".5rem" }} onClick={saveBiz}><Icon name="check" size={14} /> {bizSaved ? "Guardado ✓" : "Guardar"}</button>
            </div>
            <div className="cfg-card">
              <p className="cfg-card-head">Horario operativo</p>
              <div className="ops-settings-grid">
                <label><span>Apertura</span><select className="input" defaultValue="09:00"><option>09:00</option><option>10:00</option></select></label>
                <label><span>Cierre</span><select className="input" defaultValue="20:00"><option>19:00</option><option>20:00</option><option>21:00</option></select></label>
                <label><span>Anticipacion minima</span><select className="input" defaultValue="120"><option value="60">1 hora</option><option value="120">2 horas</option><option value="240">4 horas</option></select></label>
                <label><span>Ventana de reservas</span><select className="input" defaultValue="30"><option value="14">14 dias</option><option value="30">30 dias</option></select></label>
                <label><span>Domingos</span><select className="input" defaultValue="closed"><option value="closed">Cerrado</option><option value="open">Abierto</option></select></label>
                <label><span>Cancelacion cliente</span><select className="input" defaultValue="24h"><option value="manual">Solo manual</option><option value="24h">Hasta 24h</option><option value="12h">Hasta 12h</option></select></label>
              </div>
            </div>
          </div>
        )}

        {/* PRECIOS Y FECHAS — precio de Cursos, precio de Workshop, fecha del
            Workshop y el interruptor de pagos del Workshop. Se guarda en la DB:
            lo lee el cobro real y las páginas públicas de Cursos/Workshop. */}
        {section === "precios" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Cursos y Workshop</p>
              <p style={{ fontSize: ".78rem", color: "var(--muted)", margin: "0 0 .8rem" }}>
                Define el precio real que se cobra por Mercado Pago y la fecha de la próxima edición del Workshop.
              </p>
              {preciosLoading ? (
                <p className="empty-state">Cargando…</p>
              ) : (
                <>
                  {/* Corta o abre el cobro del Workshop en la web pública. Se
                      guarda al tiro, sin apretar "Guardar". */}
                  <CfgRow
                    label="Pagos del Workshop"
                    sub={precios.workshopPaymentsEnabled
                      ? "Activos: la web cobra por Mercado Pago para la fecha de abajo."
                      : "En pausa: nadie puede pagar. La web solo ofrece la lista de espera y no muestra fecha."}
                  >
                    <ConfigSwitch
                      checked={precios.workshopPaymentsEnabled}
                      disabled={pagosBusy}
                      onChange={toggleWorkshopPagos}
                    />
                  </CfgRow>
                  <div className="cfg-form-grid" style={{ marginTop: ".8rem" }}>
                    <div className="cfg-field">
                      <label>Precio Cursos (CLP)</label>
                      <input
                        className="input"
                        inputMode="numeric"
                        value={precios.cursosPrice}
                        onChange={(e) => setPrecios((p) => ({ ...p, cursosPrice: e.target.value.replace(/\D/g, "") }))}
                        placeholder="9990"
                      />
                    </div>
                    <div className="cfg-field">
                      <label>Precio Workshop (CLP)</label>
                      <input
                        className="input"
                        inputMode="numeric"
                        value={precios.workshopPrice}
                        onChange={(e) => setPrecios((p) => ({ ...p, workshopPrice: e.target.value.replace(/\D/g, "") }))}
                        placeholder="49990"
                      />
                    </div>
                    <div className="cfg-field">
                      <label>Fecha del Workshop</label>
                      <input
                        className="input"
                        type="datetime-local"
                        value={precios.workshopDate}
                        onChange={(e) => setPrecios((p) => ({ ...p, workshopDate: e.target.value }))}
                      />
                      <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>
                        Guarda la fecha nueva y recién ahí enciende los pagos.
                      </span>
                    </div>
                  </div>
                  {preciosError && <p style={{ fontSize: ".8rem", color: "#d99a8f", margin: ".5rem 0 0" }}>{preciosError}</p>}
                  <div style={{ display: "flex", alignItems: "center", gap: ".8rem", marginTop: ".8rem" }}>
                    <button className="btn btn-gold" disabled={preciosStatus === "saving"} onClick={savePrecios}>
                      <Icon name="check" size={14} /> {preciosStatus === "saving" ? "Guardando…" : "Guardar"}
                    </button>
                    {preciosStatus === "done" && <span className="chip chip-gold" style={{ fontSize: ".72rem" }}><Icon name="check" size={12} /> Guardado</span>}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* PRESUPUESTOS por categoría (se guarda en este dispositivo) */}
        {section === "presupuestos" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Presupuesto mensual por categoría</p>
              <p style={{ fontSize: ".78rem", color: "var(--muted)", margin: "0 0 .8rem" }}>
                Define un tope por categoría para activar el semáforo de gastos. Se guarda en este dispositivo.
              </p>
              <div style={{ display: "grid", gap: ".6rem" }}>
                {EXPENSE_CATEGORIES.map((cat) => {
                  const m = CATEGORY_META[cat]
                  return (
                    <div key={cat} style={{ display: "flex", alignItems: "center", gap: ".7rem" }}>
                      <span className="dk-badge" style={{ "--c": m.color, minWidth: 130 }}><Icon name={m.icon} size={12} /> {cat}</span>
                      <input
                        className="input"
                        inputMode="numeric"
                        placeholder="Sin presupuesto"
                        style={{ flex: 1 }}
                        value={expenseBudgets[cat] ? String(expenseBudgets[cat]) : ""}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, "")
                          setExpenseBudgets((b) => { const next = { ...b }; if (v) next[cat] = Number(v); else delete next[cat]; return next })
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* EQUIPO */}
        {section === "equipo" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <div className="cfg-card-head-row">
                <p className="cfg-card-head" style={{ margin: 0 }}>Usuarios y permisos</p>
                {canManageTeam && (
                  <button className="btn btn-gold btn-sm" onClick={() => setTeamModal({ barber: null })}>
                    <Icon name="user" size={14} /> Nuevo barbero
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gap: ".6rem" }}>
                {barbers.map((item) => {
                  const lockedAdmin = item.name?.toLowerCase().includes("brunetti") || item.admin
                  const activePerms = [["canViewFinance","Finanzas"],["canEditServices","Servicios"],["canManageTeam","Equipo"],["canManageBlocks","Bloques"]]
                    .filter(([k]) => lockedAdmin || (k === "canManageBlocks" ? item[k] !== false : Boolean(item[k])))
                    .map(([, l]) => l)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`cfg-barber-row is-tappable ${item.active === false ? "is-disabled" : ""}`}
                      onClick={() => canManageTeam && setTeamModal({ barber: item })}
                      disabled={!canManageTeam}
                    >
                      <div className="cfg-barber-head">
                        <div className="cfg-barber-avatar">{(item.name || "B")[0].toUpperCase()}</div>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ fontSize: ".9rem" }}>{item.name} {lockedAdmin && <Icon name="key" size={11} color="var(--gold)" />}</strong>
                          <span style={{ fontSize: ".74rem", color: "var(--muted)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {activePerms.length ? activePerms.join(" · ") : "Sin permisos extra"}
                          </span>
                        </div>
                        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: ".5rem", flexShrink: 0 }}>
                          <span className={item.active === false ? "chip" : "chip chip-gold"}>{item.active === false ? "Inactivo" : "Activo"}</span>
                          <Icon name="arrowRight" size={15} color="var(--muted)" />
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* DATOS Y RESPALDOS */}
        {section === "datos" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Exportar datos</p>
              <div style={{ display: "grid", gap: ".7rem" }}>
                {[["Clientes","CSV con historial y contactos","user"],["Reservas","Historial completo de citas","calendar"],["Finanzas","Movimientos de ingresos del periodo activo","chart"],["Gastos","Registro de egresos por categoria","wallet"],["Servicios","Catalogo actual publicado","scissors"]].map(([label, sub, icon]) => (
                  <div key={label} className="cfg-setting-row">
                    <div>
                      <div className="cfg-setting-label">{label}</div>
                      <div className="cfg-setting-sub">{sub}</div>
                    </div>
                    <button className="btn btn-dark btn-sm" onClick={() => onExport(label)}><Icon name={icon} size={13} /> Exportar CSV</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="cfg-card">
              <p className="cfg-card-head">Base de datos</p>
              <div className="settings-grid">
                <div><strong>Neon PostgreSQL</strong><span>Backup automatico diario. Revisar snapshot antes de cambios masivos.</span></div>
                <div><strong>Auditoria</strong><span>Cambios de agenda y servicios quedan trazables en el log del servidor.</span></div>
              </div>
            </div>
          </div>
        )}

        {/* ACERCA DE */}
        {section === "acerca" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card" style={{ textAlign: "center", padding: "2rem 1.5rem" }}>
              <span className="pimp-mark" style={{ width: 72, height: 72, margin: "0 auto 1rem", display: "block" }} />
              <h3 className="font-display" style={{ margin: "0 0 .3rem", fontSize: "1.4rem" }}>BRUNETTI</h3>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: ".84rem" }}>Panel interno v2.0</p>
              <p style={{ margin: ".5rem 0 0", color: "var(--muted-2)", fontSize: ".78rem" }}>Barberia Premium · Maipu, Santiago</p>
            </div>
            <div className="cfg-card">
              <div className="settings-grid">
                <div><strong>Version</strong><span>2.0.0 — React + Vite + Vercel</span></div>
                <div><strong>Ambiente</strong><span>Produccion — rama desarrollo</span></div>
                <div><strong>Soporte</strong><span>Panel gestionado internamente.</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
      )}

      {teamModal && (
        <BarberModal
          barber={teamModal.barber}
          canManage={canManageTeam}
          onClose={() => setTeamModal(null)}
          onSave={(payload) => { saveBarber(payload); setTeamModal(null) }}
          onDelete={(b) => { deleteBarber(b); setTeamModal(null) }}
        />
      )}
    </div>
  )
}

/* Pestaña «config» del panel interno, extraída tal cual de Dashboard.jsx
   para que cada módulo viva en su propio archivo. Recibe en `ctx` el estado
   y las acciones de Dashboard que usa (ver el objeto `dash` que arma
   Dashboard.jsx).
   El módulo sigue siendo ConfigPanel, con las mismas props de siempre. */
export default function ConfigTab({ ctx }) {
  const {
    BRUNETTI_ONLY,
    admin,
    barber,
    barberDraft,
    barbers,
    canManageTeam,
    deleteBarber,
    dockShortcuts,
    expenseBudgets,
    exportCSV,
    logout,
    nav,
    navSettings,
    saveBarber,
    setBarberDraft,
    setDockShortcuts,
    setExpenseBudgets,
    setNavSettings,
    updateBarberLocal,
  } = ctx
  return (
          <ConfigPanel
            brunettiOnly={BRUNETTI_ONLY}
            barber={barber}
            barbers={barbers}
            admin={admin}
            canManageTeam={canManageTeam}
            barberDraft={barberDraft}
            setBarberDraft={setBarberDraft}
            saveBarber={saveBarber}
            updateBarberLocal={updateBarberLocal}
            deleteBarber={deleteBarber}
            onExport={exportCSV}
            onLogout={logout}
            nav={nav}
            navSettings={navSettings}
            setNavSettings={setNavSettings}
            dockShortcuts={dockShortcuts}
            setDockShortcuts={setDockShortcuts}
            expenseBudgets={expenseBudgets}
            setExpenseBudgets={setExpenseBudgets}
          />
  )
}
