/* BRUNETTI — PDF del brief de visagismo
   ------------------------------------------------------------------
   buildVisagismoPdf(brief, { theme, compact }) → Uint8Array (application/pdf)

   Se arma en el servidor con pdf-lib: la vista previa del panel y el adjunto
   del correo son el MISMO archivo. Tres temas (THEMES): oro (negro y oro),
   plata (papel perla y cromo) y morado (violeta del Workshop).

   Lo que pdf-lib no sabe dibujar (degradados, brillos, grano, el wordmark
   metálico) es arte fijo por tema en api/_assets/visagismo/, generado con
   scripts/brand/build-visagismo-assets.mjs. Tipografías de la marca, las
   mismas del sitio: Pirata One (títulos góticos), Manufacturing Consent (la
   firma) y Sora (texto). TTF de Google Fonts en api/_assets/visagismo/fonts/.

   Completo = 2 páginas:
     1. Wordmark, cliente, antes / después en marcos (arco gótico en oro,
        rectángulo editorial en plata, arco redondo en morado) y el tipo de
        rostro con su diagrama de proporciones.
     2. Corte ideal (foto de referencia + objetivo / evita), otros cortes que
        le favorecen, tips numerados, la nota firmada por Bruno y el cierre
        para reservar.
   `compact: true` = mini resumen de UNA plana, sin fotos (fase 2,
   autoevaluación): lo que no cabe se corta, la promesa es "1 plana".

   Fotos: JPEG o PNG (pdf-lib no lee WebP). Las de Bruno vienen del Blob (o
   dataURL en el mock); las de referencia son rutas /assets/estilo/… del
   sitio, que se leen del disco (vercel.json las incluye en la función) o,
   si no están, de SITE_URL. Una foto que no se puede leer se salta.
   ------------------------------------------------------------------ */

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  PDFDocument, rgb, pushGraphicsState, popGraphicsState, moveTo, lineTo, appendBezierCurve,
  closePath, clip, endPath, setCharacterSpacing,
} from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"

const ASSETS = fileURLToPath(new URL("./_assets/visagismo/", import.meta.url))
const SITE_URL = (process.env.SITE_URL || "https://brunetticutz.cl").replace(/\/$/, "")
const SITE = SITE_URL.replace(/^https?:\/\//, "")
const WHATSAPP = "+56 9 8748 3279"
const INSTAGRAM = "@brunetticutz"

const W = 595.28
const H = 841.89
const M = 50 // margen del contenido (el marco del fondo va a 15-20 pt)

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)

export const THEMES = {
  oro: {
    label: "Oro",
    dark: true,
    photo: "arch",
    ink: hex("#f4ecd8"),
    muted: hex("#b3a68a"),
    accent: hex("#d9b866"),
    accentHi: hex("#f3e2ad"),
    accentDeep: hex("#7a5e26"),
    card: hex("#16130e"),
    paper: hex("#0b0a08"),
  },
  plata: {
    label: "Plata",
    dark: false,
    photo: "rect",
    ink: hex("#1d1f23"),
    muted: hex("#5e636b"),
    accent: hex("#5f646c"),
    accentHi: hex("#ffffff"),
    accentDeep: hex("#a5aab2"),
    card: hex("#ffffff"),
    paper: hex("#f2f1ee"),
  },
  morado: {
    label: "Morado",
    dark: true,
    photo: "round",
    ink: hex("#f3ecfc"),
    muted: hex("#b7a5cf"),
    accent: hex("#c7a1fa"),
    accentHi: hex("#efe0ff"),
    accentDeep: hex("#4a1a8a"),
    card: hex("#170d22"),
    paper: hex("#0c0613"),
  },
}
export const THEME_IDS = Object.keys(THEMES)
// El diseño oficial: el de los briefs nuevos y el de respaldo.
export const DEFAULT_THEME = "plata"

/* ---------- carga de recursos (memo por instancia tibia) ---------- */
const fileCache = new Map()
function asset(name) {
  if (!fileCache.has(name)) fileCache.set(name, fs.readFile(path.join(ASSETS, name)).catch((err) => { fileCache.delete(name); throw err }))
  return fileCache.get(name)
}

async function readImageBytes(src) {
  if (!src) return null
  const data = /^data:image\/[a-z]+;base64,(.+)$/i.exec(src)
  if (data) return Buffer.from(data[1], "base64")
  if (/^\/assets\/[\w./-]+\.(jpe?g|png)$/i.test(src) && !src.includes("..")) {
    try {
      return await fs.readFile(path.join(process.cwd(), "public", src))
    } catch { /* en producción puede no estar en el disco: se baja del sitio */ }
    src = `${SITE_URL}${src}`
  }
  if (!/^https:\/\//.test(src)) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(src, { signal: ctrl.signal })
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
  } finally {
    clearTimeout(timer)
  }
}

async function embedImage(pdf, src) {
  try {
    const bytes = await readImageBytes(src)
    if (!bytes) return null
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await pdf.embedPng(bytes)
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await pdf.embedJpg(bytes)
    return null
  } catch (err) {
    console.error("visagismo pdf: foto no legible:", err?.message || err)
    return null
  }
}

function prettyDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""))
  const day = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date()
  try {
    return new Intl.DateTimeFormat("es-CL", { timeZone: m ? "UTC" : "America/Santiago", day: "numeric", month: "long", year: "numeric" }).format(day)
  } catch {
    return ""
  }
}

/* ---------- formas: comandos [M|L|C|Z] en coordenadas de página "desde arriba" ---------- */
const K = 0.5523
function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2)
  return [
    ["M", x + r, y], ["L", x + w - r, y], ["C", x + w - r + r * K, y, x + w, y + r - r * K, x + w, y + r],
    ["L", x + w, y + h - r], ["C", x + w, y + h - r + r * K, x + w - r + r * K, y + h, x + w - r, y + h],
    ["L", x + r, y + h], ["C", x + r - r * K, y + h, x, y + h - r + r * K, x, y + h - r],
    ["L", x, y + r], ["C", x, y + r - r * K, x + r - r * K, y, x + r, y], ["Z"],
  ]
}
// Arco ojival (gótico): los dos lados suben y se juntan en punta.
function gothicArch(x, y, w, h) {
  const rise = w * 0.62
  const top = y + rise
  return [
    ["M", x, y + h], ["L", x, top],
    ["C", x, y + rise * 0.42, x + w * 0.28, y + rise * 0.08, x + w / 2, y],
    ["C", x + w * 0.72, y + rise * 0.08, x + w, y + rise * 0.42, x + w, top],
    ["L", x + w, y + h], ["Z"],
  ]
}
// Arco de medio punto (redondo).
function roundArch(x, y, w, h) {
  const r = w / 2
  return [
    ["M", x, y + h], ["L", x, y + r],
    ["C", x, y + r - r * K, x + r - r * K, y, x + r, y],
    ["C", x + r + r * K, y, x + w, y + r - r * K, x + w, y + r],
    ["L", x + w, y + h], ["Z"],
  ]
}
function frameShape(kind, x, y, w, h) {
  if (kind === "arch") return gothicArch(x, y, w, h)
  if (kind === "round") return roundArch(x, y, w, h)
  return roundRect(x, y, w, h, 2)
}
// Estrella de cuatro puntas, como las del monograma.
function sparkle(cx, cy, r, k = 0.16) {
  const c = r * k
  return [
    ["M", cx, cy - r], ["C", cx + c, cy - c, cx + c, cy - c, cx + r, cy],
    ["C", cx + c, cy + c, cx + c, cy + c, cx, cy + r], ["C", cx - c, cy + c, cx - c, cy + c, cx - r, cy],
    ["C", cx - c, cy - c, cx - c, cy - c, cx, cy - r], ["Z"],
  ]
}
const toSvg = (cmds) => cmds.map(([op, ...n]) => op + n.map((v) => Math.round(v * 100) / 100).join(" ")).join(" ")
const toOps = (cmds) => cmds.map(([op, ...n]) => {
  if (op === "M") return moveTo(n[0], H - n[1])
  if (op === "L") return lineTo(n[0], H - n[1])
  if (op === "C") return appendBezierCurve(n[0], H - n[1], n[2], H - n[3], n[4], H - n[5])
  return closePath()
})

export async function buildVisagismoPdf(brief = {}, { compact = false, theme } = {}) {
  const T = THEMES[theme] || THEMES[brief.theme] || THEMES[DEFAULT_THEME]
  const themeId = Object.keys(THEMES).find((k) => THEMES[k] === T)

  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  pdf.setTitle(`Brief de visagismo · ${brief.name || "Brunetticutz"}`)
  pdf.setAuthor("Bruno · Brunetticutz")
  pdf.setCreator(SITE)

  const [goth, sign, light, regular, semi, bgBytes, wmBytes, monoBytes] = await Promise.all([
    asset("fonts/PirataOne-Regular.ttf"), asset("fonts/ManufacturingConsent-Regular.ttf"),
    asset("fonts/Sora-Light.ttf"), asset("fonts/Sora-Regular.ttf"), asset("fonts/Sora-SemiBold.ttf"),
    asset(`bg-${themeId}.jpg`), asset(`wordmark-${themeId}.png`), asset(`monogram-${themeId}.png`),
  ])
  const F = {
    goth: await pdf.embedFont(goth, { subset: true }),
    sign: await pdf.embedFont(sign, { subset: true }),
    light: await pdf.embedFont(light, { subset: true }),
    regular: await pdf.embedFont(regular, { subset: true }),
    semi: await pdf.embedFont(semi, { subset: true }),
  }
  const bg = await pdf.embedJpg(bgBytes)
  const wordmark = await pdf.embedPng(wmBytes)
  const monogram = await pdf.embedPng(monoBytes)

  // Lo que la fuente no tiene (emojis, símbolos raros) se suelta en vez de
  // dibujar un cuadrito.
  const charsets = new Map()
  const safe = (font, text) => {
    if (!charsets.has(font)) charsets.set(font, new Set(font.getCharacterSet()))
    const set = charsets.get(font)
    const swapped = String(text ?? "").replace(/\s+/g, " ").trim()
    let out = ""
    for (const ch of swapped) if (set.has(ch.codePointAt(0))) out += ch
    return out.replace(/\s+/g, " ").replace(/\s+([.,;:!?)])/g, "$1").trim()
  }

  let page
  const newPage = () => {
    page = pdf.addPage([W, H])
    page.drawImage(bg, { x: 0, y: 0, width: W, height: H })
    return page
  }

  /* ---------- primitivas de dibujo (y medida desde arriba) ---------- */
  const text = (str, { x, y, size, font = F.regular, color = T.ink, align = "left", track = 0, opacity = 1, maxWidth }) => {
    let s = safe(font, str)
    if (!s) return 0
    const widthOf = (t) => font.widthOfTextAtSize(t, size) + track * Math.max(0, [...t].length - 1)
    if (maxWidth) while (s.length > 1 && widthOf(s) > maxWidth) s = `${s.slice(0, -2).trimEnd()}…`
    const w = widthOf(s)
    const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x
    if (track) page.pushOperators(setCharacterSpacing(track))
    page.drawText(s, { x: left, y: H - y - size * 0.78, size, font, color, opacity })
    if (track) page.pushOperators(setCharacterSpacing(0))
    return w
  }
  // Título con relieve: una sombra en el tono profundo debajo del color.
  const embossed = (str, opts) => {
    const shadow = T.dark ? { color: T.accentDeep, dx: 0.9, dy: 1.1, opacity: 0.9 } : { color: T.accentHi, dx: 0, dy: 0.9, opacity: 1 }
    text(str, { ...opts, x: opts.x + shadow.dx, y: opts.y + shadow.dy, color: shadow.color, opacity: shadow.opacity })
    return text(str, opts)
  }
  const label = (str, opts) => text(String(str).toUpperCase(), { font: F.semi, size: 6.6, track: 2.2, color: T.accent, ...opts })

  const wrap = (str, font, size, width) => {
    const words = safe(font, str).split(" ").filter(Boolean)
    const lines = []
    let line = ""
    for (const w of words) {
      const next = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next
      else { lines.push(line); line = w }
    }
    if (line) lines.push(line)
    return lines
  }
  const para = (str, { x, y, width, size = 9.5, font = F.light, color = T.ink, lead = 1.55, maxLines = 99, align = "left" }) => {
    let lines = wrap(str, font, size, width)
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines)
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s,.;:]+\S*$/, "")}…`
    }
    lines.forEach((l, i) => text(l, { x: align === "center" ? x + width / 2 : x, y: y + i * size * lead, size, font, color, align }))
    return lines.length * size * lead
  }

  const svg = (cmds, opts) => page.drawSvgPath(toSvg(cmds), { x: 0, y: H, ...opts })
  const star = (cx, cy, r, color = T.accent, opacity = 1) => svg(sparkle(cx, cy, r), { color, opacity, borderWidth: 0 })

  // Divisor: línea — estrella — línea.
  const divider = (cx, y, half, { r = 3.4, color = T.accent, opacity = 0.75 } = {}) => {
    page.drawLine({ start: { x: cx - half, y: H - y }, end: { x: cx - r * 2.6, y: H - y }, thickness: 0.6, color, opacity })
    page.drawLine({ start: { x: cx + r * 2.6, y: H - y }, end: { x: cx + half, y: H - y }, thickness: 0.6, color, opacity })
    star(cx, y, r, color)
  }

  // Encabezado de sección: rótulo espaciado + línea corta con estrella.
  const kicker = (str, x, y, { align = "left" } = {}) => {
    const w = label(str, { x, y, align })
    const lineX = align === "center" ? x - 16 : x
    page.drawLine({ start: { x: lineX, y: H - (y + 13) }, end: { x: lineX + 26, y: H - (y + 13) }, thickness: 0.9, color: T.accent })
    star(lineX + 32, y + 13, 2.6)
    return w
  }

  // Foto recortada (cover) dentro de una forma, con el marco doble encima.
  const framedPhoto = (img, kind, x, y, w, h, { focusY = 0.22 } = {}) => {
    const shape = frameShape(kind, x, y, w, h)
    svg(shape, { color: T.card, opacity: T.dark ? 0.9 : 1, borderWidth: 0 })
    if (img) {
      const scale = Math.max(w / img.width, h / img.height)
      const iw = img.width * scale
      const ih = img.height * scale
      const left = x + (w - iw) / 2
      const top = y - (ih - h) * focusY
      page.pushOperators(pushGraphicsState(), ...toOps(shape), clip(), endPath())
      page.drawImage(img, { x: left, y: H - top - ih, width: iw, height: ih })
      page.pushOperators(popGraphicsState())
    }
    // Marco: línea fina por fuera, separada, y una más fina por dentro.
    const pad = 5
    svg(frameShape(kind, x - pad, y - pad, w + pad * 2, h + pad * 2), { borderColor: T.accent, borderWidth: 0.9, borderOpacity: 0.95 })
    svg(shape, { borderColor: T.accentHi, borderWidth: 0.5, borderOpacity: T.dark ? 0.35 : 0.9 })
  }

  /* ---------- bloques ---------- */
  const header = (y, { small = false, ww = 236 } = {}) => {
    if (small) {
      const mh = 34
      const mw = (monogram.width / monogram.height) * mh
      page.drawImage(monogram, { x: W / 2 - mw / 2, y: H - y - mh, width: mw, height: mh })
      label(`Brief de visagismo  ·  ${brief.name || ""}`, { x: W / 2, y: y + mh + 10, align: "center", size: 6.2, color: T.muted })
      return y + mh + 30
    }
    const wh = (wordmark.height / wordmark.width) * ww
    page.drawImage(wordmark, { x: W / 2 - ww / 2, y: H - y - wh, width: ww, height: wh })
    y += wh + 8
    const tw = label("Asesoría de visagismo", { x: W / 2, y, align: "center", size: 7, track: 3.2 })
    page.drawLine({ start: { x: W / 2 - tw / 2 - 64, y: H - y - 3.5 }, end: { x: W / 2 - tw / 2 - 14, y: H - y - 3.5 }, thickness: 0.6, color: T.accent, opacity: 0.8 })
    page.drawLine({ start: { x: W / 2 + tw / 2 + 14, y: H - y - 3.5 }, end: { x: W / 2 + tw / 2 + 64, y: H - y - 3.5 }, thickness: 0.6, color: T.accent, opacity: 0.8 })
    star(W / 2 - tw / 2 - 8, y + 3.5, 2.6)
    star(W / 2 + tw / 2 + 8, y + 3.5, 2.6)
    return y + 22
  }

  const clientBlock = (y) => {
    text("Preparado para", { x: W / 2, y, size: 8, font: F.light, color: T.muted, align: "center", track: 0.6 })
    y += 14
    embossed(brief.name || "Cliente", { x: W / 2, y, size: 34, font: F.goth, color: T.dark ? T.accentHi : T.ink, align: "center", maxWidth: W - 2 * M })
    y += 42
    const date = prettyDate(brief.visitDate || brief.sentAt)
    text([date, "Asesoría con Bruno, visagista"].filter(Boolean).join("   ·   "), { x: W / 2, y, size: 8, font: F.regular, color: T.muted, align: "center", track: 0.4 })
    return y + 22
  }

  const photosBlock = async (y) => {
    const [before, after] = await Promise.all([embedImage(pdf, brief.beforeUrl), embedImage(pdf, brief.afterUrl)])
    const items = [[before, "Antes", "Tu punto de partida"], [after, "Después", "Tu nuevo estilo"]].filter(([img]) => img)
    if (!items.length) return y
    const gap = 44
    const pw = items.length === 2 ? 210 : 250
    const ph = items.length === 2 ? 268 : 300
    const total = items.length * pw + (items.length - 1) * gap
    const x0 = (W - total) / 2
    items.forEach(([img, name, sub], i) => {
      const x = x0 + i * (pw + gap)
      framedPhoto(img, T.photo, x, y, pw, ph)
      embossed(name, { x: x + pw / 2, y: y + ph + 14, size: 21, font: F.goth, color: T.accent, align: "center" })
      label(sub, { x: x + pw / 2, y: y + ph + 42, align: "center", size: 5.8, color: T.muted })
    })
    if (items.length === 2) {
      const cx = W / 2
      const cy = y + ph * 0.55
      star(cx, cy, 9, T.accent)
      star(cx, cy - 22, 3, T.accent, 0.7)
      star(cx, cy + 22, 3, T.accent, 0.7)
    }
    return y + ph + 66
  }

  // Diagrama del rostro: silueta + guías de frente, pómulos, mandíbula y largo.
  const faceDiagram = (shape, x, y, w) => {
    const h = w * 1.2
    const s = w / 100
    if (shape.path) {
      page.drawSvgPath(shape.path, { x, y: H - y, scale: s, color: T.accent, opacity: T.dark ? 0.12 : 0.1, borderColor: T.accent, borderWidth: 1.6 })
    }
    const guides = [[0.27, "Frente"], [0.5, "Pómulos"], [0.78, "Mandíbula"]]
    for (const [k, name] of guides) {
      const gy = y + h * k
      page.drawLine({ start: { x: x - 6, y: H - gy }, end: { x: x + w + 6, y: H - gy }, thickness: 0.5, color: T.muted, opacity: 0.7, dashArray: [2, 2.4] })
      page.drawCircle({ x: x + w + 6, y: H - gy, size: 1.6, color: T.accent })
      text(name.toUpperCase(), { x: x + w + 12, y: gy - 3, size: 5.4, font: F.semi, color: T.muted, track: 1.2 })
    }
    page.drawLine({ start: { x: x + w / 2, y: H - (y - 6) }, end: { x: x + w / 2, y: H - (y + h + 6) }, thickness: 0.5, color: T.muted, opacity: 0.7, dashArray: [2, 2.4] })
    text("LARGO", { x: x + w / 2, y: y + h + 10, size: 5.4, font: F.semi, color: T.muted, align: "center", track: 1.2 })
    return h + 22
  }

  const faceBlock = (y, { compactMode = false } = {}) => {
    const shape = brief.shape || {}
    if (!shape.name) return y
    const dw = compactMode ? 86 : 104
    const dx = M + 8
    const hDiagram = faceDiagram(shape, dx, y + 14, dw)
    const tx = M + dw + 92
    const tw = W - M - tx
    let ty = y
    kicker("Tu tipo de rostro", tx, ty)
    ty += 26
    embossed(shape.name, { x: tx, y: ty, size: compactMode ? 38 : 46, font: F.goth, color: T.accent })
    ty += compactMode ? 46 : 54
    if (shape.tagline) { text(shape.tagline, { x: tx, y: ty, size: 10.5, font: F.regular, color: T.ink }); ty += 20 }
    if (shape.diagnosis) ty += para(shape.diagnosis, { x: tx, y: ty, width: tw, size: 8.8, color: T.dark ? T.muted : T.muted, maxLines: compactMode ? 4 : 6 }) + 8
    // Rasgos como etiquetas con borde.
    let cx = tx
    let cy = ty
    for (const trait of (shape.traits || []).slice(0, 4)) {
      const t = safe(F.regular, trait)
      const pw = F.regular.widthOfTextAtSize(t, 7) + 16
      if (cx + pw > W - M) { cx = tx; cy += 21 }
      svg(roundRect(cx, cy, pw, 16, 8), { borderColor: T.accent, borderWidth: 0.6, borderOpacity: 0.8, color: T.accent, opacity: 0.07 })
      text(t, { x: cx + 8, y: cy + 4.6, size: 7, font: F.regular, color: T.ink })
      cx += pw + 6
    }
    ty = cy + 26
    return Math.max(y + hDiagram + 14, ty) + 6
  }

  // Ícono: círculo con ✓ (objetivo) o ✕ (evita).
  const markIcon = (kind, cx, cy) => {
    page.drawCircle({ x: cx, y: H - cy, size: 7, borderColor: T.accent, borderWidth: 0.8, color: T.accent, opacity: 0.1, borderOpacity: 1 })
    if (kind === "ok") {
      page.drawLine({ start: { x: cx - 3, y: H - cy }, end: { x: cx - 0.8, y: H - cy - 2.4 }, thickness: 1.1, color: T.accent })
      page.drawLine({ start: { x: cx - 0.8, y: H - cy - 2.4 }, end: { x: cx + 3.4, y: H - cy + 2.6 }, thickness: 1.1, color: T.accent })
    } else {
      page.drawLine({ start: { x: cx - 2.4, y: H - cy - 2.4 }, end: { x: cx + 2.4, y: H - cy + 2.4 }, thickness: 1.1, color: T.accent })
      page.drawLine({ start: { x: cx - 2.4, y: H - cy + 2.4 }, end: { x: cx + 2.4, y: H - cy - 2.4 }, thickness: 1.1, color: T.accent })
    }
  }

  const cutBlock = async (y, { compactMode = false } = {}) => {
    const shape = brief.shape || {}
    if (!brief.cutName && !shape.goal) return y
    const ref = compactMode ? null : await embedImage(pdf, brief.cutImg)
    const pw = 150
    const ph = 190
    let tx = M
    if (ref) {
      framedPhoto(ref, T.photo, M + 6, y + 6, pw, ph, { focusY: 0.12 })
      label("Referencia", { x: M + 6 + pw / 2, y: y + ph + 20, align: "center", size: 5.6, color: T.muted })
      tx = M + pw + 44
    }
    const tw = W - M - tx
    let ty = y + (ref ? 14 : 0)
    kicker("Tu corte ideal", tx, ty)
    ty += 26
    if (brief.cutName) {
      const lines = wrap(brief.cutName, F.goth, compactMode ? 28 : 34, tw)
      if (lines.length > 2) lines[1] = `${lines[1]}…`
      for (const l of lines.slice(0, 2)) { embossed(l, { x: tx, y: ty, size: compactMode ? 28 : 34, font: F.goth, color: T.accent }); ty += compactMode ? 32 : 38 }
      ty += 4
    }
    if (brief.cutNote) ty += para(brief.cutNote, { x: tx, y: ty, width: tw, size: 10, font: F.regular, color: T.ink, maxLines: 4 }) + 10
    const marks = [["ok", "Objetivo", shape.goal], ["no", "Evita", shape.avoid]].filter(([, , body]) => body)
    if (compactMode) {
      // Una al lado de la otra: en la plana única cada línea cuenta.
      const colW = (tw - 20) / 2
      let used = 0
      marks.forEach(([kind, title, body], i) => {
        const cx = tx + i * (colW + 20)
        markIcon(kind, cx + 7, ty + 7)
        label(title, { x: cx + 22, y: ty + 1, size: 6, color: T.accent })
        used = Math.max(used, 12 + para(body, { x: cx + 22, y: ty + 12, width: colW - 22, size: 8.4, color: T.muted, maxLines: 3 }))
      })
      return ty + used + 14
    }
    for (const [kind, title, body] of marks) {
      markIcon(kind, tx + 7, ty + 7)
      label(title, { x: tx + 22, y: ty + 1, size: 6, color: T.accent })
      ty += 12
      ty += para(body, { x: tx + 22, y: ty, width: tw - 22, size: 8.6, color: T.muted, maxLines: 3 }) + 8
    }
    return Math.max(ty, ref ? y + ph + 34 : ty) + 8
  }

  // "También te favorecen": los otros cortes del catálogo para su rostro.
  const alternativesBlock = async (y) => {
    const alts = (brief.shape?.best || []).filter((b) => b?.img && b.name !== brief.cutName).slice(0, 3)
    if (!alts.length) return y
    const imgs = await Promise.all(alts.map((b) => embedImage(pdf, b.img)))
    const items = alts.map((b, i) => [b, imgs[i]]).filter(([, img]) => img)
    if (!items.length) return y
    label("También te favorecen", { x: M, y, size: 6.4 })
    y += 18
    const tw = 64
    const th = 80
    const colW = (W - 2 * M) / items.length
    items.forEach(([b, img], i) => {
      const x = M + i * colW
      framedPhoto(img, "rect", x + 4, y + 4, tw, th, { focusY: 0.1 })
      text(b.name, { x: x + tw + 18, y: y + 20, size: 13, font: F.goth, color: T.accent, maxWidth: colW - tw - 24 })
      para(b.note || "", { x: x + tw + 18, y: y + 40, width: colW - tw - 26, size: 7.2, color: T.muted, maxLines: 4, lead: 1.45 })
    })
    return y + th + 26
  }

  // Tips en columnas con numeral gótico. `measure` solo calcula el alto (para
  // decidir si cabe en la página antes de dibujar).
  const tipsLayout = (max) => {
    const tips = (Array.isArray(brief.tips) ? brief.tips : []).map((t) => String(t || "").trim()).filter(Boolean).slice(0, max)
    const cols = tips.length <= 3 ? Math.max(1, tips.length) : 2
    const gap = 22
    const colW = (W - 2 * M - gap * (cols - 1)) / cols
    const rows = []
    for (let i = 0; i < tips.length; i += cols) {
      const cells = tips.slice(i, i + cols).map((t, c) => ({ text: t, n: i + c + 1, lines: Math.min(5, wrap(t, F.light, 8.8, colW).length) }))
      rows.push({ cells, h: 30 + Math.max(...cells.map((c) => c.lines)) * 8.8 * 1.55 })
    }
    return { tips, cols, gap, colW, rows, h: tips.length ? 30 + rows.reduce((a, r) => a + r.h + 10, 0) : 0 }
  }
  const tipsBlock = (y, { max = 6 } = {}) => {
    const L = tipsLayout(max)
    if (!L.tips.length) return y
    kicker("Tips de Bruno", M, y)
    let rowTop = y + 30
    for (const row of L.rows) {
      row.cells.forEach((cell, c) => {
        const x = M + c * (L.colW + L.gap)
        embossed(String(cell.n).padStart(2, "0"), { x, y: rowTop, size: 22, font: F.goth, color: T.accent })
        page.drawLine({ start: { x: x + 30, y: H - (rowTop + 12) }, end: { x: x + L.colW, y: H - (rowTop + 12) }, thickness: 0.5, color: T.accent, opacity: 0.45 })
        para(cell.text, { x, y: rowTop + 30, width: L.colW, size: 8.8, color: T.ink, maxLines: 5 })
      })
      rowTop += row.h + 10
    }
    return rowTop
  }

  const noteLines = () => (brief.notes ? wrap(brief.notes, F.regular, 10, W - 2 * M - 74).slice(0, 7) : [])
  const noteHeight = () => { const n = noteLines().length; return n ? 34 + n * 15.5 + 30 : 0 }
  const noteBlock = (y) => {
    const lines = noteLines()
    if (!lines.length) return y
    const boxW = W - 2 * M
    const boxH = noteHeight()
    svg(roundRect(M, y, boxW, boxH, 6), { color: T.card, opacity: T.dark ? 0.75 : 0.85, borderColor: T.accent, borderWidth: 0.6, borderOpacity: 0.6 })
    text("“", { x: M + 18, y: y + 2, size: 58, font: F.goth, color: T.accent, opacity: 0.55 })
    label("Una nota de Bruno", { x: M + 52, y: y + 16, size: 6 })
    lines.forEach((l, i) => text(l, { x: M + 52, y: y + 32 + i * 15.5, size: 10, font: F.regular, color: T.ink }))
    text("Bruno", { x: W - M - 22, y: y + boxH - 30, size: 22, font: F.sign, color: T.accent, align: "right" })
    return y + boxH + 14
  }

  // Cierre: reservar la próxima hora + contacto. Va anclado abajo, sobre el pie.
  const CTA_H = 66
  const CTA_TOP = H - 60 - CTA_H
  const ctaBlock = ({ closing } = {}) => {
    const y = CTA_TOP
    const boxW = W - 2 * M
    svg(roundRect(M, y, boxW, CTA_H, 6), { color: T.accent, opacity: T.dark ? 0.1 : 0.08, borderColor: T.accent, borderWidth: 0.9 })
    embossed(closing ? "Tu asesoría te espera" : "Tu próxima visita", { x: M + 20, y: y + 12, size: 19, font: F.goth, color: T.accent })
    para(closing || "Mantén la forma de tu corte: repásalo cada 3 a 4 semanas.", { x: M + 20, y: y + 38, width: boxW * 0.52, size: 7.8, color: T.muted, maxLines: 2, lead: 1.4 })
    const rx = W - M - 20
    text(`${SITE}/reservar`, { x: rx, y: y + 14, size: 10, font: F.semi, color: T.dark ? T.accentHi : T.ink, align: "right" })
    text(`WhatsApp ${WHATSAPP}`, { x: rx, y: y + 32, size: 7.8, font: F.regular, color: T.muted, align: "right" })
    text(`Instagram ${INSTAGRAM}`, { x: rx, y: y + 45, size: 7.8, font: F.regular, color: T.muted, align: "right" })
  }

  const footer = (n, total) => {
    divider(W / 2, H - 44, 120, { r: 2.8, opacity: 0.6 })
    text(`${SITE}   ·   ${n} / ${total}`, { x: W / 2, y: H - 36, size: 6, font: F.semi, color: T.muted, align: "center", track: 1.6 })
  }

  /* ---------- composición ---------- */
  if (compact) {
    newPage()
    let y = header(42, { ww: 200 })
    y = clientBlock(y - 6)
    divider(W / 2, y - 4, 150)
    y = faceBlock(y + 16, { compactMode: true })
    divider(W / 2, y - 6, 150)
    y = await cutBlock(y + 14, { compactMode: true })
    // Lo que no cabe en la plana se suelta: primero se achican los tips.
    let max = 3
    while (max > 0 && y + tipsLayout(max).h > CTA_TOP - 8) max--
    if (max) tipsBlock(y, { max })
    ctaBlock({ closing: brief.closing })
    footer(1, 1)
    return pdf.save()
  }

  // Página 1: portada, antes / después y rostro.
  newPage()
  let y = header(46)
  y = clientBlock(y)
  y = await photosBlock(y + 6)
  divider(W / 2, y - 8, 170)
  faceBlock(y + 16)

  // Página 2 (y 3 si los tips o la nota son largos): corte, alternativas,
  // tips, nota y el cierre anclado abajo.
  newPage()
  y = header(44, { small: true })
  y = await cutBlock(y + 4)
  y = await alternativesBlock(y + 2)
  const fits = (h) => y + h <= CTA_TOP - 10
  const nextPage = () => { newPage(); y = header(44, { small: true }) }
  if (!fits(tipsLayout(6).h)) nextPage()
  y = tipsBlock(y + 4)
  if (!fits(noteHeight())) nextPage()
  y = noteBlock(y + 4)
  ctaBlock()

  const total = pdf.getPageCount()
  pdf.getPages().forEach((p, i) => { page = p; footer(i + 1, total) })
  return pdf.save()
}

export function briefFileName(name) {
  const clean = String(name || "cliente")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 40) || "cliente"
  return `Brief-visagismo-${clean}.pdf`
}
