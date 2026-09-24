import React, { useState, useEffect, useRef } from 'react'

export function Emblem({ size = 46 }) {
  return (
    <img
      className="pimp-mark"
      src="/assets/brunetti-hero-wordmark.webp"
      alt="Brunetticutz"
      style={{ height: size }}
    />
  )
}

export function Brandmark({ size = 44, sub = "Barber Studio", onClick }) {
  return (
    <div className="brandmark" onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
      <Emblem size={size} />
      {sub && <small className="brandmark-sub">{sub}</small>}
    </div>
  )
}

export const ICONS = {
  scissors: "M6 6l12 12M6 18L18 6M8 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM8 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",
  calendar: "M7 3v3M17 3v3M3.5 9h17M5 5h14a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6.5A1.5 1.5 0 0 1 5 5z",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0",
  users: "M16 14a4 4 0 1 0-4-4M2 20a6 6 0 0 1 12 0M22 20a5 5 0 0 0-7-4.6",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h2l6 4V6L6 10H4a1 1 0 0 0-1 1zM16 9a4 4 0 0 1 0 6M6 14v5",
  apple: "M12 7c-1.6-1.9-4.3-1.6-5.6.3-1.4 2-1 5.2.7 7.9 1 1.6 2.1 2.8 3.2 2.8.8 0 1.2-.5 2.2-.5s1.3.5 2.2.5c1.1 0 2.1-1.2 3-2.7.6-1 .9-1.9 1-2.2-2.2-.9-2.6-4-.4-5.3-.9-1.2-2.3-1.6-3.5-1.3M12.5 5.5a2.7 2.7 0 0 0 1.9-2.4 2.8 2.8 0 0 0-2.2 1",
  android: "M6 11a6 6 0 0 1 12 0v6a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM8 8L6.5 5.5M16 8l1.5-2.5M9.5 11h.01M14.5 11h.01",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  mail: "M3.5 6h17a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3 7l9 6 9-6",
  send: "M21 3L10.5 13.5M21 3l-6.5 18-4-8-8-4L21 3z",
  percent: "M6 18L18 6M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  phone: "M5 4h3l1.5 5-2 1.5a11 11 0 0 0 5 5l1.5-2 5 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  chart: "M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6M20 16v-9",
  wallet: "M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4zM4 7V6a2 2 0 0 1 2-2h10M17 13h.5",
  star: "M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8 6.8 19l1-5.8L3.6 9.1l5.8-.8z",
  spark: "M12 3v6M12 15v6M3 12h6M15 12h6",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  check: "M5 12.5l4.5 4.5L19 7",
  pin: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  bell: "M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 20a2 2 0 0 0 4 0",
  logout: "M15 12H4M11 8l-4 4 4 4M14 4h4a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20h-4",
  trend: "M3 17l6-6 4 4 8-8M21 7v5M21 7h-5",
  gift: "M12 8v13M3.5 8h17v3.5h-17zM4.5 11.5h15V20a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM12 8S10.5 3.5 8 4.5 9.5 8 12 8zM12 8s1.5-4.5 4-3.5S14.5 8 12 8z",
  cut: "M14.5 9.5L21 3M14.5 14.5L21 21M9.5 12l-6.5-9M9.5 12l-6.5 9M9.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  whatsapp: "M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3z",
  key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  instagram: "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM17.5 6.5h.01",
  refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  cart: "M6 7V6a6 6 0 0 1 12 0v1M3.5 7h17l-1.2 12.1a2 2 0 0 1-2 1.9H6.7a2 2 0 0 1-2-1.9L3.5 7z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  image: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM3 16l5-5 4 4 3-3 6 6",
  /* Íconos del rediseño del panel (trazo 24×24 estilo Lucide, licencia ISC).
     Cada módulo tiene el suyo: antes Finanzas, Caja y Gastos
     compartían `wallet` y en el menú no se distinguían. */
  more: "M5 12a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0M10.7 12a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0M16.4 12a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0",
  chevronRight: "M9 6l6 6-6 6",
  chevronLeft: "M15 6l-6 6 6 6",
  chevronDown: "M6 9l6 6 6-6",
  chevronUp: "M6 15l6-6 6 6",
  search: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-3.6-3.6",
  filter: "M4 6h9M17 6h3M15 4v4M4 12h3M11 12h9M9 10v4M4 18h11M19 18h1M17 16v4",
  settings: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6",
  cash: "M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M6 12h.01M18 12h.01",
  receipt: "M5 2.5v19l2.3-1.4 2.3 1.4 2.4-1.4 2.4 1.4 2.3-1.4 2.3 1.4v-19l-2.3 1.4-2.3-1.4-2.4 1.4-2.4-1.4-2.3 1.4zM9 8h6M9 12h6M9 16h3.5",
  box: "M16.5 9.4L7.5 4.2M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.3 7L12 12l8.7-5M12 22V12",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  alert: "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  info: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20M12 16v-4M12 8h.01",
  checkCircle: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4L12 14l-3-3",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6",
  eyeOff: "M9.9 4.2A10.9 10.9 0 0 1 12 4c6.4 0 10 8 10 8a18 18 0 0 1-2.2 3.2M6.6 6.6A17.8 17.8 0 0 0 2 12s3.6 8 10 8a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 1 0 4.2 4.2M3 3l18 18",
  lock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  moon: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z",
  sun: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41",
  layout: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM3 9h18M9 20V9",
  database: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  store: "M3 9l1.6-5h14.8L21 9M3 9v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9M3 9h18M9 21v-6h6v6",
  pie: "M21.2 15.9A10 10 0 1 1 8 2.8M22 12A10 10 0 0 0 12 2v10z",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6",
  pencil: "M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4zM14 6l4 4",
  reschedule: "M21 12a9 9 0 1 1-3-6.7M21 3v5h-5",
  list: "M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01",
  play: "M7 4.5v15l12-7.5z",
  camera: "M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 10.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7",
  sparkles: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
}

export function Icon({ name, size = 20, stroke = 1.6, color = "currentColor", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d={ICONS[name] || ICONS.spark} />
    </svg>
  )
}

export function useInView(opts = { threshold: 0.18 }) {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) { setSeen(true); return }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setSeen(true); io.unobserve(el) } })
    }, opts)
    io.observe(el)
    const fallback = setTimeout(() => setSeen(true), 1100)
    return () => { io.disconnect(); clearTimeout(fallback) }
  }, [])
  return [ref, seen]
}

export function Reveal({ children, className = "", as = "div", stagger = false, style }) {
  const [ref, seen] = useInView()
  const Tag = as
  const base = stagger ? "stagger" : "reveal"
  return <Tag ref={ref} className={`${base} ${seen ? "is-in" : ""} ${className}`} style={style}>{children}</Tag>
}

export function Stat({ icon, label, value, delta, suffix, accent, hint }) {
  const up = delta >= 0
  return (
    <div className="card" style={{ padding: "1.1rem 1.2rem", display: "grid", gap: ".6rem", borderTop: accent ? "1px solid var(--gold-line)" : undefined }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: ".5rem" }}>
        {/* El label se parte en hasta 2 líneas en vez de cortarse con "…":
            en el ancho de un celular, etiquetas como "Corte gratis listo"
            quedaban ilegibles con un solo renglón y ellipsis. */}
        <span style={{ fontSize: ".66rem", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)", fontFamily: "var(--font-display)", minWidth: 0, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{label}</span>
        <span style={{ color: accent ? "var(--gold)" : "var(--muted)", flexShrink: 0, display: "inline-flex", marginTop: "-.1rem" }}><Icon name={icon} size={17} /></span>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.35rem, 5vw, 1.85rem)", fontWeight: 600, letterSpacing: "-.01em", fontVariantNumeric: "tabular-nums", color: accent ? "var(--gold)" : "var(--ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}{suffix && <span style={{ fontSize: "1rem", color: "var(--muted)", marginLeft: ".15em" }}>{suffix}</span>}
      </div>
      {hint && <div style={{ fontSize: ".7rem", color: "var(--muted-2)", lineHeight: 1.35, marginTop: "-.2rem" }}>{hint}</div>}
      {delta != null && (
        <div style={{ display: "flex", alignItems: "center", gap: ".35rem", fontSize: ".74rem", color: up ? "#9fd0a0" : "#d99a8f" }}>
          <Icon name="trend" size={14} style={{ transform: up ? "none" : "scaleY(-1)" }} />
          <span>{up ? "+" : ""}{delta}%</span>
          <span style={{ color: "var(--muted-2)" }}>vs semana ant.</span>
        </div>
      )}
    </div>
  )
}

export function SectionHead({ eyebrow, title, sub, center }) {
  return (
    <Reveal style={{ textAlign: center ? "center" : "left", marginBottom: "2.4rem", display: "grid", gap: ".7rem", justifyItems: center ? "center" : "start" }}>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2 className="font-display" style={{ margin: 0, fontSize: "clamp(1.7rem,3.4vw,2.7rem)", fontWeight: 600, letterSpacing: "-.01em", lineHeight: 1.05 }}>{title}</h2>
      <span style={{ width: 64, height: 2, background: "var(--gold-grad)" }} />
      {sub && <p style={{ margin: 0, color: "var(--muted)", maxWidth: 560, fontSize: ".98rem" }}>{sub}</p>}
    </Reveal>
  )
}

export function MobileScreen({ children }) {
  return (
    <div style={{
      minHeight: "100vh",
      overflowX: "hidden",
      background: "var(--bg)",
      // safe-area-inset-top: evita que el contenido superior quede bajo el
      // notch/cámara cuando la web corre como app instalada en iOS.
      paddingTop: "env(safe-area-inset-top)",
    }}>
      {children}
    </div>
  )
}

export function StatusBar() {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.7rem 1.6rem 0.2rem", fontSize: ".78rem", fontWeight: 600, color: "var(--ink)", letterSpacing: ".02em" }}>
      <span>9:41</span>
      <span style={{ display: "flex", gap: 5, alignItems: "center", opacity: .85 }}>
        <span>●●●</span><span>5G</span><span>▮</span>
      </span>
    </div>
  )
}
