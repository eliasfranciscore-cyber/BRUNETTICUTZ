/* BRUNETTI IMAGE STUDIO — informe PDF de la asesoría de imagen
   ------------------------------------------------------------------
   buildImagenPdf(snapshot, { draft }) → Uint8Array (application/pdf)

   Se arma en el servidor con pdf-lib a partir del SNAPSHOT de un informe
   (api/_imagen.js → reportSnapshot): el diagnóstico de Bruno y solo las
   recomendaciones que aprobó. Así cada versión guardada se puede volver a
   dibujar igual, aunque después cambien el catálogo o la asesoría.

   Diseño Plata (papel perla y cromo), el oficial. Lo que pdf-lib no sabe
   dibujar (degradado, grano, marco con estrellas, wordmark cromado) es arte
   fijo en api/_assets/imagen/, generado con
   scripts/brand/build-imagen-assets.mjs. Tipografías de la marca: Pirata One
   (títulos), Manufacturing Consent (la firma) y Sora (texto).

   Contenido (sección 10 del documento de Image Studio), en flujo: cada
   bloque mide su alto antes de dibujarse y, si no cabe, pasa a la página
   siguiente.
     1. Portada: marca, cliente, fecha, modalidad, versión.
     2. Diagnóstico: rostro (diagrama), estructura (cráneo), cabello.
     3. Cortes recomendados con referencia visual, y lo que conviene evitar.
     4. Productos de peinado, champú y acondicionador, con modo de uso.
     5. Rutina de lavado paso a paso, consejos y plan de mantenimiento.
     6. Productos disponibles (en la barbería o solo recomendados), el
        próximo seguimiento, la nota de Bruno y el cierre.
   Letra de cuerpo ≥ 8,5 pt: se tiene que leer en el celular.

   Imágenes: JPEG o PNG (pdf-lib no lee WebP). Las de referencia son rutas
   /assets/… del sitio (del disco en local, de SITE_URL en producción); una
   que no se puede leer se salta.
   ------------------------------------------------------------------ */

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  PDFDocument, rgb, pushGraphicsState, popGraphicsState, moveTo, lineTo, appendBezierCurve,
  closePath, clip, endPath, setCharacterSpacing,
} from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import { MODALITIES, CATEGORIES, SKULL, HAIR, labelOf } from "../src/imagen/vocab.js"

const ASSETS = fileURLToPath(new URL("./_assets/imagen/", import.meta.url))
const SITE_URL = (process.env.SITE_URL || "https://brunetticutz.cl").replace(/\/$/, "")
const SITE = SITE_URL.replace(/^https?:\/\//, "")
const WHATSAPP = "+56 9 8748 3279"
const INSTAGRAM = "@brunetticutz"

const W = 595.28
const H = 841.89
const M = 50 // margen del contenido (el marco del fondo va a 15-20 pt)
const BOTTOM = H - 66 // lo que queda sobre el pie de página

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)

// Plata: papel perla y cromo.
const T = {
  ink: hex("#1d1f23"),
  muted: hex("#5e636b"),
  accent: hex("#5f646c"),
  accentHi: hex("#ffffff"),
  card: hex("#ffffff"),
}

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
    console.error("imagen pdf: imagen no legible:", err?.message || err)
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
const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`

/* ---------- formas: comandos [M|L|C|Z] en coordenadas "desde arriba" ---------- */
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

export async function buildImagenPdf(snap = {}, { draft = false } = {}) {
  const client = snap.client || {}
  const cons = snap.consultation || {}
  const dx = snap.diagnosis || {}
  const recs = Array.isArray(snap.recs) ? snap.recs : []
  const byKind = (k) => recs.filter((r) => r.kind === k)

  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  pdf.setTitle(`Asesoría de imagen · ${client.name || "Brunetti Image Studio"}`)
  pdf.setAuthor("Bruno · Brunetti Image Studio")
  pdf.setCreator(SITE)

  const [goth, sign, light, regular, semi, bgBytes, wmBytes, monoBytes] = await Promise.all([
    asset("fonts/PirataOne-Regular.ttf"), asset("fonts/ManufacturingConsent-Regular.ttf"),
    asset("fonts/Sora-Light.ttf"), asset("fonts/Sora-Regular.ttf"), asset("fonts/Sora-SemiBold.ttf"),
    asset("bg.jpg"), asset("wordmark.png"), asset("monogram.png"),
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
  const safe = (font, str) => {
    if (!charsets.has(font)) charsets.set(font, new Set(font.getCharacterSet()))
    const set = charsets.get(font)
    let out = ""
    for (const ch of String(str ?? "").replace(/\s+/g, " ").trim()) if (set.has(ch.codePointAt(0))) out += ch
    return out.replace(/\s+/g, " ").replace(/\s+([.,;:!?)])/g, "$1").trim()
  }

  /* ---------- primitivas (y medida desde arriba) ---------- */
  let page
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
  // Título con relieve: un brillo blanco debajo, como el cromo.
  const embossed = (str, opts) => {
    text(str, { ...opts, y: opts.y + 0.9, color: T.accentHi })
    return text(str, opts)
  }
  const label = (str, opts) => text(String(str).toUpperCase(), { font: F.semi, size: 7, track: 2, color: T.accent, ...opts })

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
  const paraH = (str, { width, size = 9.5, font = F.light, lead = 1.5, maxLines = 99 }) => Math.min(maxLines, wrap(str, font, size, width).length) * size * lead
  const para = (str, { x, y, width, size = 9.5, font = F.light, color = T.ink, lead = 1.5, maxLines = 99 }) => {
    let lines = wrap(str, font, size, width)
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines)
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s,.;:]+\S*$/, "")}…`
    }
    lines.forEach((l, i) => text(l, { x, y: y + i * size * lead, size, font, color }))
    return lines.length * size * lead
  }

  const svg = (cmds, opts) => page.drawSvgPath(toSvg(cmds), { x: 0, y: H, ...opts })
  const star = (cx, cy, r, color = T.accent, opacity = 1) => svg(sparkle(cx, cy, r), { color, opacity, borderWidth: 0 })
  const divider = (cx, y, half, { r = 3.4, opacity = 0.75 } = {}) => {
    page.drawLine({ start: { x: cx - half, y: H - y }, end: { x: cx - r * 2.6, y: H - y }, thickness: 0.6, color: T.accent, opacity })
    page.drawLine({ start: { x: cx + r * 2.6, y: H - y }, end: { x: cx + half, y: H - y }, thickness: 0.6, color: T.accent, opacity })
    star(cx, y, r)
  }
  const card = (x, y, w, h) => svg(roundRect(x, y, w, h, 6), { color: T.card, opacity: 0.85, borderColor: T.accent, borderWidth: 0.5, borderOpacity: 0.55 })

  // Foto recortada (cover) en un marco editorial doble.
  const framedPhoto = (img, x, y, w, h, { focusY = 0.15 } = {}) => {
    const shape = roundRect(x, y, w, h, 2)
    svg(shape, { color: T.card, borderWidth: 0 })
    if (img) {
      const scale = Math.max(w / img.width, h / img.height)
      const iw = img.width * scale
      const ih = img.height * scale
      page.pushOperators(pushGraphicsState(), ...toOps(shape), clip(), endPath())
      page.drawImage(img, { x: x + (w - iw) / 2, y: H - (y - (ih - h) * focusY) - ih, width: iw, height: ih })
      page.pushOperators(popGraphicsState())
    }
    svg(roundRect(x - 4, y - 4, w + 8, h + 8, 3), { borderColor: T.accent, borderWidth: 0.8, borderOpacity: 0.95 })
    svg(shape, { borderColor: T.accentHi, borderWidth: 0.5, borderOpacity: 0.9 })
  }

  const markIcon = (kind, cx, cy) => {
    page.drawCircle({ x: cx, y: H - cy, size: 7, borderColor: T.accent, borderWidth: 0.8, color: T.accent, opacity: 0.08, borderOpacity: 1 })
    if (kind === "ok") {
      page.drawLine({ start: { x: cx - 3, y: H - cy }, end: { x: cx - 0.8, y: H - cy - 2.4 }, thickness: 1.1, color: T.accent })
      page.drawLine({ start: { x: cx - 0.8, y: H - cy - 2.4 }, end: { x: cx + 3.4, y: H - cy + 2.6 }, thickness: 1.1, color: T.accent })
    } else {
      page.drawLine({ start: { x: cx - 2.4, y: H - cy - 2.4 }, end: { x: cx + 2.4, y: H - cy + 2.4 }, thickness: 1.1, color: T.accent })
      page.drawLine({ start: { x: cx - 2.4, y: H - cy + 2.4 }, end: { x: cx + 2.4, y: H - cy - 2.4 }, thickness: 1.1, color: T.accent })
    }
  }

  /* ---------- páginas y flujo ---------- */
  const versionLine = [draft ? "Vista previa" : `Informe v${snap.version || 1}`, prettyDate(snap.generatedAt)].filter(Boolean).join("  ·  ")
  let y = 0
  const newPage = ({ cover = false } = {}) => {
    page = pdf.addPage([W, H])
    page.drawImage(bg, { x: 0, y: 0, width: W, height: H })
    if (draft) text("VISTA PREVIA · BORRADOR", { x: W / 2, y: 26, size: 7, font: F.semi, color: T.accent, align: "center", track: 2.4, opacity: 0.8 })
    if (cover) return
    // Encabezado chico de las páginas siguientes.
    const mh = 30
    const mw = (monogram.width / monogram.height) * mh
    page.drawImage(monogram, { x: W / 2 - mw / 2, y: H - 42 - mh, width: mw, height: mh })
    label(`Brunetti Image Studio  ·  ${client.name || ""}`, { x: W / 2, y: 42 + mh + 9, align: "center", size: 6.4, color: T.muted })
    y = 42 + mh + 34
  }
  // Pasa de página si `h` no cabe.
  const fit = (h) => { if (y + h > BOTTOM) newPage() }

  // Encabezado de sección: rótulo + línea con estrella + título gótico.
  const SECTION_H = 52
  const section = (kicker, title) => {
    label(kicker, { x: M, y })
    page.drawLine({ start: { x: M, y: H - (y + 13) }, end: { x: M + 26, y: H - (y + 13) }, thickness: 0.9, color: T.accent })
    star(M + 32, y + 13, 2.6)
    embossed(title, { x: M, y: y + 20, size: 24, font: F.goth, color: T.ink })
    y += SECTION_H
  }

  /* ---------- 1. portada ---------- */
  newPage({ cover: true })
  y = 46
  {
    const ww = 236
    const wh = (wordmark.height / wordmark.width) * ww
    page.drawImage(wordmark, { x: W / 2 - ww / 2, y: H - y - wh, width: ww, height: wh })
    y += wh + 8
    const tw = label("Brunetti Image Studio", { x: W / 2, y, align: "center", size: 7.4, track: 3.2 })
    page.drawLine({ start: { x: W / 2 - tw / 2 - 64, y: H - y - 3.5 }, end: { x: W / 2 - tw / 2 - 14, y: H - y - 3.5 }, thickness: 0.6, color: T.accent, opacity: 0.8 })
    page.drawLine({ start: { x: W / 2 + tw / 2 + 14, y: H - y - 3.5 }, end: { x: W / 2 + tw / 2 + 64, y: H - y - 3.5 }, thickness: 0.6, color: T.accent, opacity: 0.8 })
    star(W / 2 - tw / 2 - 8, y + 3.5, 2.6)
    star(W / 2 + tw / 2 + 8, y + 3.5, 2.6)
    y += 26
    text("Asesoría de imagen personalizada para", { x: W / 2, y, size: 9, font: F.light, color: T.muted, align: "center", track: 0.5 })
    y += 16
    embossed(client.name || "Cliente", { x: W / 2, y, size: 36, font: F.goth, color: T.ink, align: "center", maxWidth: W - 2 * M })
    y += 46
    const meta = [prettyDate(cons.visitDate || snap.generatedAt), cons.modality ? `Asesoría ${labelOf(MODALITIES, cons.modality).toLowerCase()}` : "", "Con Bruno"].filter(Boolean)
    text(meta.join("   ·   "), { x: W / 2, y, size: 8.6, font: F.regular, color: T.muted, align: "center", track: 0.4 })
    y += 14
    text(versionLine, { x: W / 2, y, size: 7.4, font: F.semi, color: T.accent, align: "center", track: 1.4 })
    y += 22
    divider(W / 2, y, 170)
    y += 22
  }

  /* ---------- 2. diagnóstico ---------- */
  const face = dx.face || null
  const skull = dx.skull || {}
  const hair = dx.hair || {}

  // Diagrama del rostro: silueta + guías de frente, pómulos, mandíbula y largo.
  const faceDiagram = (shape, x, top, w) => {
    const h = w * 1.2
    if (shape.path) {
      page.drawSvgPath(shape.path, { x, y: H - top, scale: w / 100, color: T.accent, opacity: 0.1, borderColor: T.accent, borderWidth: 1.6 })
    }
    for (const [k, name] of [[0.27, "Frente"], [0.5, "Pómulos"], [0.78, "Mandíbula"]]) {
      const gy = top + h * k
      page.drawLine({ start: { x: x - 6, y: H - gy }, end: { x: x + w + 6, y: H - gy }, thickness: 0.5, color: T.muted, opacity: 0.7, dashArray: [2, 2.4] })
      page.drawCircle({ x: x + w + 6, y: H - gy, size: 1.6, color: T.accent })
      text(name.toUpperCase(), { x: x + w + 12, y: gy - 3, size: 5.8, font: F.semi, color: T.muted, track: 1.2 })
    }
    page.drawLine({ start: { x: x + w / 2, y: H - (top - 6) }, end: { x: x + w / 2, y: H - (top + h + 6) }, thickness: 0.5, color: T.muted, opacity: 0.7, dashArray: [2, 2.4] })
    text("LARGO", { x: x + w / 2, y: top + h + 10, size: 5.8, font: F.semi, color: T.muted, align: "center", track: 1.2 })
    return h + 22
  }

  if (face?.name) {
    const dw = 100
    const tx = M + dw + 92
    const tw = W - M - tx
    const diagH = (face.diagnosis ? paraH(face.diagnosis, { width: tw, size: 9.2, maxLines: 6 }) : 0)
    fit(SECTION_H + Math.max(dw * 1.2 + 40, 100 + diagH))
    section("Tu diagnóstico", "Tu tipo de rostro")
    const top = y
    const hDiagram = faceDiagram(face, M + 8, top + 8, dw)
    let ty = top
    embossed(face.name, { x: tx, y: ty, size: 40, font: F.goth, color: T.ink })
    ty += 48
    if (face.tagline) { text(face.tagline, { x: tx, y: ty, size: 10.5, font: F.regular }); ty += 20 }
    if (face.diagnosis) ty += para(face.diagnosis, { x: tx, y: ty, width: tw, size: 9.2, color: T.muted, maxLines: 6 }) + 8
    let cx = tx
    let cy = ty
    for (const trait of (face.traits || []).slice(0, 4)) {
      const t = safe(F.regular, trait)
      const pw = F.regular.widthOfTextAtSize(t, 8) + 16
      if (cx + pw > W - M) { cx = tx; cy += 22 }
      svg(roundRect(cx, cy, pw, 17, 8.5), { borderColor: T.accent, borderWidth: 0.6, borderOpacity: 0.8, color: T.accent, opacity: 0.06 })
      text(t, { x: cx + 8, y: cy + 4.6, size: 8, font: F.regular })
      cx += pw + 6
    }
    y = Math.max(top + hDiagram + 12, cy + 30)
  }

  // Grilla de pares rótulo / valor (estructura y cabello).
  const factsGrid = (pairs, cols) => {
    const gap = 14
    const colW = (W - 2 * M - gap * (cols - 1)) / cols
    const rowH = 40
    const rows = Math.ceil(pairs.length / cols)
    pairs.forEach(([k, v], i) => {
      const x = M + (i % cols) * (colW + gap)
      const top = y + Math.floor(i / cols) * rowH
      card(x, top, colW, rowH - 8)
      label(k, { x: x + 10, y: top + 7, size: 6.2, color: T.muted, track: 1.4 })
      text(v, { x: x + 10, y: top + 17, size: 10, font: F.semi, maxWidth: colW - 20 })
    })
    y += rows * rowH
  }

  const skullPairs = Object.entries(SKULL).map(([k, def]) => [def.label, skull[k]]).filter(([, v]) => v)
  if (skullPairs.length || skull.notes) {
    const notesH = skull.notes ? paraH(skull.notes, { width: W - 2 * M, size: 9 }) + 8 : 0
    fit(SECTION_H + Math.ceil(skullPairs.length / 2) * 40 + notesH)
    section("Estructura", "Cráneo y proporciones")
    if (skullPairs.length) factsGrid(skullPairs, 2)
    if (skull.notes) y += para(skull.notes, { x: M, y: y + 2, width: W - 2 * M, size: 9, color: T.muted }) + 10
    y += 6
  }

  const hairPairs = Object.entries(HAIR).map(([k, def]) => [def.label, hair[k]]).filter(([, v]) => v && v !== "No evaluada")
  if (hairPairs.length || hair.notes) {
    const notesH = hair.notes ? paraH(hair.notes, { width: W - 2 * M, size: 9 }) + 8 : 0
    fit(SECTION_H + Math.ceil(hairPairs.length / 3) * 40 + notesH)
    section("Diagnóstico capilar", "Tu cabello")
    if (hairPairs.length) factsGrid(hairPairs, 3)
    if (hair.notes) y += para(hair.notes, { x: M, y: y + 2, width: W - 2 * M, size: 9, color: T.muted }) + 10
    y += 6
  }

  if (dx.observations) {
    const h = paraH(dx.observations, { width: W - 2 * M - 30, size: 9.5 })
    fit(36 + h)
    label("Observaciones de Bruno", { x: M, y })
    y += 16
    page.drawLine({ start: { x: M + 2, y: H - y }, end: { x: M + 2, y: H - (y + h) }, thickness: 1.2, color: T.accent, opacity: 0.6 })
    y += para(dx.observations, { x: M + 16, y, width: W - 2 * M - 30, size: 9.5 }) + 18
  }

  /* ---------- 3. cortes ---------- */
  const cuts = byKind("corte")
  const avoid = byKind("evitar")
  const DETAIL_ROWS = [["largo", "Largo"], ["volumen", "Volumen"], ["textura", "Textura"], ["degradado", "Degradado"], ["lados", "Lados"]]
  if (cuts.length) {
    const refs = await Promise.all(cuts.map((c) => embedImage(pdf, c.detail?.refImg)))
    fit(SECTION_H + 170)
    section("Cortes y estilo", cuts.length > 1 ? "Tus cortes recomendados" : "Tu corte recomendado")
    cuts.forEach((c, i) => {
      const ref = refs[i]
      const pw = 104
      const ph = 132
      const tx = ref ? M + pw + 30 : M
      const tw = W - M - tx
      const rows = DETAIL_ROWS.filter(([k]) => c.detail?.[k])
      const rowsH = rows.reduce((a, [k]) => a + paraH(c.detail[k], { width: tw - 78, size: 8.8, font: F.regular, lead: 1.4 }) + 4, 0)
      const reasonH = c.reason ? paraH(c.reason, { width: tw, size: 9, maxLines: 5 }) + 18 : 0
      const maintH = c.detail?.mantenimiento ? 18 : 0
      const h = Math.max(ref ? ph + 14 : 0, 34 + rowsH + reasonH + maintH) + 18
      fit(h)
      const top = y
      if (ref) framedPhoto(ref, M + 4, top + 4, pw, ph)
      let ty = top
      embossed(c.title, { x: tx, y: ty, size: 22, font: F.goth, color: T.ink, maxWidth: tw })
      ty += 32
      for (const [k, name] of rows) {
        label(name, { x: tx, y: ty + 1.5, size: 6.2, color: T.muted, track: 1.4 })
        ty += para(c.detail[k], { x: tx + 78, y: ty, width: tw - 78, size: 8.8, font: F.regular, lead: 1.4 }) + 4
      }
      if (c.reason) {
        ty += 6
        label("Por qué", { x: tx, y: ty, size: 6.2 })
        ty += 12
        ty += para(c.reason, { x: tx, y: ty, width: tw, size: 9, color: T.muted, maxLines: 5 })
      }
      if (c.detail?.mantenimiento) {
        ty += 6
        text(c.detail.mantenimiento, { x: tx, y: ty, size: 8.6, font: F.semi, color: T.accent })
        ty += 12
      }
      y = Math.max(ref ? top + ph + 14 : top, ty) + 18
      if (i < cuts.length - 1) { divider(W / 2, y - 9, 120, { r: 2.6, opacity: 0.5 }); y += 6 }
    })
  }
  if (avoid.length) {
    const items = avoid.map((a) => ({ a, h: 6 + paraH(a.title, { width: W - 2 * M - 26, size: 9.6, font: F.regular, lead: 1.4 }) + (a.reason ? paraH(a.reason, { width: W - 2 * M - 26, size: 8.8 }) : 0) + 10 }))
    fit(30 + items[0].h)
    label("Conviene evitar", { x: M, y })
    y += 18
    for (const { a, h } of items) {
      fit(h)
      markIcon("no", M + 7, y + 7)
      let ty = y
      ty += para(a.title, { x: M + 24, y: ty, width: W - 2 * M - 26, size: 9.6, font: F.regular, lead: 1.4 })
      if (a.reason) ty += para(a.reason, { x: M + 24, y: ty + 2, width: W - 2 * M - 26, size: 8.8, color: T.muted })
      y = ty + 12
    }
    y += 8
  }

  /* ---------- 4. productos ---------- */
  const PRODUCT_ROWS = [["cantidad", "Cantidad"], ["aplicacion", "Cómo aplicarlo"], ["modoDeUso", "Modo de uso"], ["frecuencia", "Frecuencia"]]
  const productAvailability = (p) => {
    if (!p) return ""
    if (p.soldHere) return p.price ? `Disponible en la barbería · ${clp(p.price)}` : "Disponible en la barbería"
    return "Recomendado · no se vende en la barbería"
  }
  const productCards = async (list) => {
    const imgs = await Promise.all(list.map((r) => embedImage(pdf, r.product?.imgUrl)))
    list.forEach((r, i) => {
      const img = imgs[i]
      const p = r.product || {}
      const ix = M + 14
      const tx = img ? ix + 64 + 14 : M + 16
      const tw = W - M - 16 - tx
      const meta = [p.brand, labelOf(CATEGORIES, p.category)].filter(Boolean).join("  ·  ")
      const rows = PRODUCT_ROWS.filter(([k]) => r.detail?.[k])
      const extras = [r.detail?.fijacion ? `Fijación ${String(r.detail.fijacion).toLowerCase()}` : "", r.detail?.brillo ? `Brillo ${String(r.detail.brillo).toLowerCase()}` : ""].filter(Boolean).join("  ·  ")
      const rowsH = rows.reduce((a, [k]) => a + paraH(r.detail[k], { width: tw - 88, size: 8.8, font: F.regular, lead: 1.4 }) + 3, 0)
      const reasonH = r.reason ? paraH(r.reason, { width: tw, size: 8.8, maxLines: 4 }) + 6 : 0
      const h = Math.max(img ? 64 + 28 : 0, 16 + 16 + (meta ? 14 : 0) + (extras ? 14 : 0) + rowsH + reasonH + 18 + 12)
      fit(h + 10)
      card(M, y, W - 2 * M, h)
      if (img) framedPhoto(img, ix, y + 14, 64, 64, { focusY: 0.5 })
      let ty = y + 14
      text(r.title, { x: tx, y: ty, size: 11.5, font: F.semi, maxWidth: tw })
      ty += 18
      if (meta) { text(meta, { x: tx, y: ty, size: 8.6, font: F.regular, color: T.muted, maxWidth: tw }); ty += 14 }
      if (extras) { text(extras, { x: tx, y: ty, size: 8.6, font: F.regular, color: T.muted }); ty += 14 }
      for (const [k, name] of rows) {
        label(name, { x: tx, y: ty + 1.5, size: 6, color: T.muted, track: 1.2 })
        ty += para(r.detail[k], { x: tx + 88, y: ty, width: tw - 88, size: 8.8, font: F.regular, lead: 1.4 }) + 3
      }
      if (r.reason) ty += para(r.reason, { x: tx, y: ty + 3, width: tw, size: 8.8, color: T.muted, maxLines: 4 }) + 6
      text(productAvailability(p), { x: tx, y: ty + 4, size: 8.6, font: F.semi, color: T.accent, maxWidth: tw })
      y += h + 10
    })
  }
  const styling = byKind("peinado")
  const care = [...byKind("champu"), ...byKind("acondicionador")]
  if (styling.length) {
    fit(SECTION_H + 120)
    section("Productos de peinado", "Tu peinado")
    await productCards(styling)
    y += 8
  }
  if (care.length) {
    fit(SECTION_H + 120)
    section("Cuidado", "Champú y acondicionador")
    await productCards(care)
    y += 8
  }

  /* ---------- 5. rutina, consejos y mantenimiento ---------- */
  const numbered = (list, { size = 9.4 } = {}) => {
    const width = W - 2 * M - 40
    list.forEach((t, i) => {
      const h = Math.max(26, paraH(t, { width, size, font: F.regular, lead: 1.45 }) + 10)
      fit(h)
      embossed(String(i + 1).padStart(2, "0"), { x: M, y: y - 4, size: 20, font: F.goth, color: T.accent })
      para(t, { x: M + 40, y, width, size, font: F.regular, lead: 1.45 })
      y += h
    })
  }
  for (const r of byKind("rutina")) {
    const steps = (r.detail?.steps || []).filter(Boolean)
    if (!steps.length) continue
    fit(SECTION_H + 60)
    section("Rutina de lavado y cuidado", r.title || "Paso a paso")
    numbered(steps)
    y += 10
  }
  const tips = byKind("consejo")
  if (tips.length) {
    fit(SECTION_H + 60)
    section("Consejos", "Consejos personalizados")
    numbered(tips.map((t) => t.title))
    y += 10
  }

  const maint = byKind("mantenimiento")
  if (maint.length || cons.nextFollowup) {
    const lines = maint.map((m) => [m.title, m.reason].filter(Boolean).join(". "))
    const h = 24 + lines.reduce((a, l) => a + paraH(l, { width: W - 2 * M - 40, size: 9.4, font: F.regular }) + 6, 0) + (cons.nextFollowup ? 44 : 0)
    fit(SECTION_H + h)
    section("Mantenimiento", "Tu plan de mantenimiento")
    for (const l of lines) {
      markIcon("ok", M + 7, y + 7)
      y += para(l, { x: M + 24, y, width: W - 2 * M - 40, size: 9.4, font: F.regular }) + 8
    }
    if (cons.nextFollowup) {
      card(M, y + 4, W - 2 * M, 36)
      label("Próximo seguimiento sugerido", { x: M + 14, y: y + 11, size: 6.4, color: T.muted })
      text(prettyDate(cons.nextFollowup), { x: M + 14, y: y + 22, size: 11, font: F.semi })
      y += 50
    }
    y += 6
  }

  /* ---------- 6. productos disponibles, nota y cierre ---------- */
  const products = recs.filter((r) => r.product?.name)
  if (products.length) {
    const rowH = 30
    fit(SECTION_H + 20 + products.length * rowH)
    section("Dónde comprarlos", "Productos recomendados")
    for (const r of products) {
      const p = r.product
      fit(rowH)
      page.drawLine({ start: { x: M, y: H - (y + rowH - 6) }, end: { x: W - M, y: H - (y + rowH - 6) }, thickness: 0.4, color: T.accent, opacity: 0.4 })
      text([p.brand, p.name].filter(Boolean).join(" "), { x: M, y: y + 2, size: 9.6, font: F.semi, maxWidth: W - 2 * M - 210 })
      text(labelOf(CATEGORIES, p.category), { x: M, y: y + 14, size: 8, font: F.regular, color: T.muted })
      const link = p.soldHere ? `${SITE}/essentials` : (p.buyUrl || "").replace(/^https?:\/\//, "").replace(/\/$/, "")
      const where = p.soldHere ? [p.price ? clp(p.price) : "", "En la barbería"].filter(Boolean).join("  ·  ") : "Solo recomendado"
      text(where, { x: W - M, y: y + 2, size: 9, font: F.semi, color: T.accent, align: "right", maxWidth: 200 })
      if (link) text(link, { x: W - M, y: y + 14, size: 8, font: F.regular, color: T.muted, align: "right", maxWidth: 200 })
      y += rowH
    }
    y += 12
  }

  if (cons.notes) {
    const width = W - 2 * M - 74
    const lines = wrap(cons.notes, F.regular, 10, width).slice(0, 12)
    const boxH = 34 + lines.length * 15.5 + 34
    fit(boxH + 10)
    card(M, y, W - 2 * M, boxH)
    text("“", { x: M + 18, y: y + 2, size: 58, font: F.goth, color: T.accent, opacity: 0.5 })
    label("Una nota de Bruno", { x: M + 52, y: y + 16, size: 6.4 })
    lines.forEach((l, i) => text(l, { x: M + 52, y: y + 32 + i * 15.5, size: 10 }))
    text("Bruno", { x: W - M - 22, y: y + boxH - 32, size: 22, font: F.sign, color: T.accent, align: "right" })
    y += boxH + 16
  }

  // Cierre: reservar + contacto.
  {
    const h = 70
    fit(h + 6)
    svg(roundRect(M, y, W - 2 * M, h, 6), { color: T.accent, opacity: 0.07, borderColor: T.accent, borderWidth: 0.9 })
    embossed("Tu próxima visita", { x: M + 20, y: y + 12, size: 20, font: F.goth, color: T.ink })
    para(cons.nextFollowup ? `Te esperamos cerca del ${prettyDate(cons.nextFollowup)} para el seguimiento.` : "Agenda tu repaso a tiempo para mantener la forma.", { x: M + 20, y: y + 40, width: (W - 2 * M) * 0.5, size: 8.6, color: T.muted, maxLines: 2, lead: 1.35 })
    const rx = W - M - 20
    text(`${SITE}/reservar`, { x: rx, y: y + 14, size: 10.5, font: F.semi, align: "right" })
    text(`WhatsApp ${WHATSAPP}`, { x: rx, y: y + 33, size: 8.6, color: T.muted, align: "right" })
    text(`Instagram ${INSTAGRAM}`, { x: rx, y: y + 47, size: 8.6, color: T.muted, align: "right" })
    y += h + 10
  }

  // Pie: versión y numeración en todas las páginas.
  const total = pdf.getPageCount()
  pdf.getPages().forEach((p, i) => {
    page = p
    divider(W / 2, H - 46, 120, { r: 2.8, opacity: 0.6 })
    text(`${SITE}   ·   ${versionLine}   ·   ${i + 1} / ${total}`, { x: W / 2, y: H - 38, size: 6.4, font: F.semi, color: T.muted, align: "center", track: 1.2 })
  })
  return pdf.save()
}

export function reportFileName(name, version) {
  const clean = String(name || "cliente")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 40) || "cliente"
  return `Asesoria-de-imagen-${clean}${version ? `-v${version}` : ""}.pdf`
}
