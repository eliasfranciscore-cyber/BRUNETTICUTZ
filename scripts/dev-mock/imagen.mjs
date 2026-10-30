/* Dev mock — Brunetti Image Studio (?mode=imagen, imagen-form, imagen-informe)
   Mismas formas que api/_imagen.js y api/_imagenForm.js, en memoria. Las
   reglas (api/_imagenRules.js) y el PDF (api/_imagenPdf.js) son los MISMOS
   módulos de producción. Las fotos quedan como dataURL (o una ruta
   /assets/… en los fixtures) y el correo no sale de verdad. */

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { suggest } from '../../api/_imagenRules.js'
import { cleanIntake } from '../../api/_imagenCore.js'
import { addDays } from './fixtures.mjs'
import { ANGLES, REC_KINDS, CATEGORIES, KIND_GROUP, CONSENT_VERSION } from '../../src/imagen/vocab.js'

const E = (status, error, extra = {}) => [status, { ok: false, error, ...extra }]
const OK = (data = {}) => [200, { ok: true, ...data }]
const iso = () => new Date().toISOString()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TOKEN_RE = /^[a-f0-9]{32}$/
const SITE = 'http://localhost:3000'
const KIND_ORDER = Object.fromEntries(REC_KINDS.map((k, i) => [k.id, i]))
const PRODUCT_KINDS = REC_KINDS.filter((k) => k.product).map((k) => k.id)
const cleanPhone = (v) => {
  let d = String(v || '').replace(/\D/g, '')
  if (d.length > 9 && d.startsWith('56')) d = d.slice(2)
  return d.slice(-9)
}
const token = () => crypto.randomBytes(16).toString('hex')
const store = (st) => (st.imagen ||= { consultations: [], photos: [], recs: [], reports: [], events: [], products: [], seq: {} })
const next = (im, k) => (im.seq[k] = (im.seq[k] || 0) + 1)

export function logEvent(st, consultationId, { actor = 'sistema', action, detail = null }) {
  const im = store(st)
  im.events.unshift({ id: next(im, 'event'), consultationId, actor, actorName: actor === 'barbero' ? 'Bruno Herrera' : null, action, detail, at: iso() })
}

// Catálogo con el precio y el stock de Essentials cuando está atado a un producto.
function catalog(st) {
  return store(st).products.map((p) => {
    const shop = p.productId ? st.products.find((x) => x.id === p.productId) : null
    return { ...p, price: shop ? shop.price : p.price ?? null, stock: shop ? shop.stock : null, shopActive: shop ? shop.active : null }
  })
}

const withLinks = (c) => ({ ...c, formUrl: c.formToken ? `${SITE}/asesoria/datos?t=${c.formToken}` : null })
const reportOut = (r) => {
  const live = r.shareToken && r.shareExpiresAt && new Date(r.shareExpiresAt) > new Date()
  return {
    id: r.id, consultationId: r.consultationId, version: r.version, createdAt: r.createdAt, createdByName: 'Bruno Herrera',
    hasPdf: true, sentAt: r.sentAt, sentTo: r.sentTo, sendCount: r.sendCount || 0,
    shareUrl: live ? `${SITE}/asesoria/informe/${r.shareToken}` : null, shareExpiresAt: live ? r.shareExpiresAt : null,
  }
}

function full(st, id) {
  const im = store(st)
  const c = im.consultations.find((x) => x.id === id)
  if (!c) return null
  return {
    consultation: withLinks(c),
    photos: im.photos.filter((p) => p.consultationId === id).map(({ id: pid, angle, uploadedBy, createdAt }) => ({ id: pid, angle, uploadedBy, createdAt })),
    recs: im.recs.filter((r) => r.consultationId === id).sort((a, b) => a.position - b.position || a.id - b.id),
    reports: im.reports.filter((r) => r.consultationId === id).sort((a, b) => b.version - a.version).map(reportOut),
    events: im.events.filter((e) => e.consultationId === id).slice(0, 100),
  }
}

function snapshot(st, c, version) {
  const byId = new Map(catalog(st).map((p) => [p.id, p]))
  const recs = store(st).recs
    .filter((r) => r.consultationId === c.id && r.status === 'aprobada')
    .sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.position - b.position)
    .map((r) => {
      const p = r.productId ? byId.get(r.productId) : null
      return { kind: r.kind, title: r.title, detail: r.detail, reason: r.reason, product: p ? { name: p.name, brand: p.brand, category: p.category, soldHere: p.soldHere, price: p.price, buyUrl: p.buyUrl, imgUrl: p.imgUrl } : null }
    })
  return {
    version, generatedAt: iso(),
    client: { name: c.name, email: c.email, phone: c.phone },
    consultation: { id: c.id, modality: c.modality, visitDate: c.visitDate, nextFollowup: c.nextFollowup, notes: c.notes },
    diagnosis: c.diagnosis || {}, recs,
  }
}

async function pdfOf(snap, opts) {
  const { buildImagenPdf, reportFileName } = await import('../../api/_imagenPdf.js')
  return { bytes: Buffer.from(await buildImagenPdf(snap, opts)), name: reportFileName(snap.client?.name, snap.version) }
}

// Una foto del mock: dataURL subido o una ruta /assets/… de los fixtures.
async function photoBytes(p) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(String(p.src || ''))
  if (m) return [200, Buffer.from(m[2], 'base64'), m[1]]
  if (/^\/assets\/[\w./-]+\.(jpe?g|png)$/.test(String(p.src || ''))) {
    try { return [200, await fs.readFile(path.join(process.cwd(), 'public', p.src)), 'image/jpeg'] } catch { /* cae al 404 */ }
  }
  return E(404, 'Foto no encontrada')
}

function stats(st) {
  const im = store(st)
  const cs = im.consultations
  const auto = im.recs.filter((r) => r.source === 'regla')
  return {
    active: cs.filter((c) => ['pagada', 'en_local'].includes(c.paymentStatus) && c.status !== 'cancelada').length,
    delivered: cs.filter((c) => c.status === 'entregada').length,
    toReview: cs.filter((c) => c.status === 'en_revision').length,
    suggestions: {
      approved: auto.filter((r) => r.status === 'aprobada' && !r.edited).length,
      edited: auto.filter((r) => r.status === 'aprobada' && r.edited).length,
      discarded: auto.filter((r) => r.status === 'descartada').length,
    },
    hoursToReport: 26.5,
  }
}

const summary = (st, c) => ({
  id: c.id, name: c.name, phone: c.phone, email: c.email, modality: c.modality, status: c.status, paymentStatus: c.paymentStatus,
  price: c.price, paidAmount: c.paidAmount, visitDate: c.visitDate, source: c.source, faceName: c.diagnosis?.face?.name || null,
  photoCount: store(st).photos.filter((p) => p.consultationId === c.id).length,
  lastVersion: Math.max(0, ...store(st).reports.filter((r) => r.consultationId === c.id).map((r) => r.version)) || null,
  intakeSubmittedAt: c.intakeSubmittedAt, createdAt: c.createdAt, updatedAt: c.updatedAt,
})

/* ---------- panel ---------- */
export async function imagenApi(c) {
  const { st, method, q, body, h } = c
  if (!c.session) return E(401, 'Sesion interna requerida')
  const im = store(st)
  const id = Number(q.id) || null
  const find = (cid) => im.consultations.find((x) => x.id === cid)

  if (q.catalog) return catalogApi(c)

  if (q.photo) {
    const p = im.photos.find((x) => x.id === Number(q.photo))
    if (!p) return E(404, 'Foto no encontrada')
    if (method === 'GET') return photoBytes(p)
    if (method === 'DELETE') {
      im.photos = im.photos.filter((x) => x !== p)
      logEvent(st, p.consultationId, { actor: 'barbero', action: 'foto_borrada', detail: { angle: p.angle } })
      return OK()
    }
  }
  if (method === 'POST' && q.upload) {
    const cons = find(Number(body.id))
    if (!cons) return E(404, 'Asesoría no encontrada')
    if (!ANGLES.some((a) => a.id === body.angle)) return E(400, 'Ángulo inválido')
    if (!cons.consentAt && !body.consent) return E(400, 'Falta el consentimiento del cliente para guardar sus fotos.')
    if (!/^data:image\/(png|jpeg|jpg);base64,/.test(String(body.dataUrl || ''))) return E(400, 'La foto tiene que ser JPEG o PNG')
    if (!cons.consentAt) Object.assign(cons, { consentAt: iso(), consentBy: 'barbero:6', consentVersion: CONSENT_VERSION })
    im.photos = im.photos.filter((x) => !(x.consultationId === cons.id && x.angle === body.angle))
    const photo = { id: next(im, 'photo'), consultationId: cons.id, angle: body.angle, src: body.dataUrl, uploadedBy: 'barbero:6', createdAt: iso() }
    im.photos.push(photo)
    cons.updatedAt = iso()
    logEvent(st, cons.id, { actor: 'barbero', action: 'foto', detail: { angle: body.angle } })
    return [201, { ok: true, photo: { id: photo.id, angle: photo.angle } }]
  }

  if (q.rec && method !== 'POST') {
    const r = im.recs.find((x) => x.id === Number(q.rec))
    if (!r) return E(404, 'Recomendación no encontrada')
    if (method === 'DELETE') {
      if (r.source !== 'manual') return E(400, 'Las sugerencias no se borran: descártalas.')
      im.recs = im.recs.filter((x) => x !== r)
      return OK()
    }
    const editing = ['title', 'detail', 'reason', 'productId'].some((k) => body[k] !== undefined)
    if (editing) {
      if (body.title) r.title = String(body.title).slice(0, 200)
      if (body.detail !== undefined) r.detail = body.detail || {}
      if (body.reason !== undefined) r.reason = body.reason || null
      if (body.productId !== undefined && PRODUCT_KINDS.includes(r.kind)) r.productId = Number(body.productId) || r.productId
      if (r.source !== 'manual') r.edited = true
      if (!body.status) r.status = 'aprobada'
    }
    if (['sugerida', 'aprobada', 'descartada'].includes(body.status)) r.status = body.status
    Object.assign(r, { decidedBy: 6, decidedByName: 'Bruno Herrera', decidedAt: iso() })
    logEvent(st, r.consultationId, { actor: 'barbero', action: editing ? 'rec_editada' : `rec_${r.status}`, detail: { kind: r.kind, title: r.title } })
    return OK({ rec: r })
  }

  if (q.report) {
    const r = im.reports.find((x) => x.id === Number(q.report))
    if (!r) return E(404, 'Informe no encontrado')
    const cons = find(r.consultationId)
    if (method === 'GET' && q.pdf) {
      r.snapshot ||= snapshot(st, cons, r.version)
      const { bytes } = await pdfOf(r.snapshot)
      return [200, bytes, 'application/pdf']
    }
    const ensureShare = () => {
      if (!r.shareToken || new Date(r.shareExpiresAt) <= new Date()) {
        r.shareToken = token()
        r.shareExpiresAt = new Date(Date.now() + 30 * 864e5).toISOString()
      }
    }
    if (method === 'POST' && q.send) {
      const to = String(body.email || cons?.email || '').trim().toLowerCase()
      if (!EMAIL_RE.test(to)) return E(400, 'Falta un correo válido del cliente')
      ensureShare()
      Object.assign(r, { sentAt: iso(), sentTo: to, sendCount: (r.sendCount || 0) + 1 })
      Object.assign(cons, { status: 'entregada', email: cons.email || to, updatedAt: iso() })
      logEvent(st, cons.id, { actor: 'barbero', action: 'envio_correo', detail: { version: r.version, to } })
      console.log(`✓ Mock de API · informe v${r.version} "enviado" a ${to} (no sale correo real)`)
      return OK({ report: reportOut(r), mocked: true })
    }
    if (method === 'POST' && q.share) {
      ensureShare()
      const url = `${SITE}/asesoria/informe/${r.shareToken}`
      const first = String(cons.name || '').split(/\s+/)[0]
      const message = `Hola${first ? ` ${first}` : ''}, te dejo tu asesoría de imagen de Brunetti Image Studio: ${url} (el enlace dura 30 días).`
      if (cons.status !== 'cancelada') cons.status = 'entregada'
      logEvent(st, cons.id, { actor: 'barbero', action: 'envio_whatsapp', detail: { version: r.version } })
      return OK({ report: reportOut(r), url, message, waUrl: `https://wa.me/56${cons.phone || ''}?text=${encodeURIComponent(message)}` })
    }
    return E(405, 'Method not allowed')
  }

  if (method === 'GET') {
    if (q.candidates) {
      const date = DATE_RE.test(String(q.date || '')) ? q.date : addDays(h.today, -1)
      const bookings = st.bookings
        .filter((b) => b.date === date && ['completada', 'en curso'].includes(b.status))
        .sort((a, b) => (b.serviceId === 10) - (a.serviceId === 10) || a.time.localeCompare(b.time))
        .map((b) => {
          const cl = h.clientOf(b.clientId)
          const cons = [...im.consultations].reverse().find((x) => x.bookingId === b.id)
          return {
            bookingId: b.id, date: b.date, time: b.time, status: b.status, serviceId: b.serviceId,
            service: h.svcOf(b.serviceId)?.name || b.customService || 'Servicio',
            clientId: cl?.id ?? null, name: cl?.name || '', phone: cl?.phone || null, email: cl?.email || null,
            consultationId: cons?.id ?? null, consultationStatus: cons?.status ?? null,
          }
        })
      return OK({ date, bookings })
    }
    if (id && q.preview) {
      const cons = find(id)
      if (!cons) return E(404, 'Asesoría no encontrada')
      const v = Math.max(0, ...im.reports.filter((r) => r.consultationId === id).map((r) => r.version)) + 1
      const { bytes } = await pdfOf(snapshot(st, cons, v), { draft: true })
      return [200, bytes, 'application/pdf']
    }
    if (id) { const f = full(st, id); return f ? OK(f) : E(404, 'Asesoría no encontrada') }
    const phone = cleanPhone(q.phone)
    const list = [...im.consultations].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    if (phone.length === 9) return OK({ consultations: list.filter((x) => x.phone === phone).map((x) => summary(st, x)) })
    return OK({ consultations: list.map((x) => summary(st, x)), stats: stats(st) })
  }

  if (method === 'POST' && id && q.suggest) {
    const cons = find(id)
    if (!cons) return E(404, 'Asesoría no encontrada')
    const out = suggest({ diagnosis: cons.diagnosis, intake: cons.intake, catalog: catalog(st).filter((p) => p.active) })
    const existing = im.recs.filter((r) => r.consultationId === id)
    im.recs = im.recs.filter((r) => !(r.consultationId === id && r.source === 'regla' && r.status === 'sugerida' && !r.edited))
    const kept = new Set(im.recs.filter((r) => r.consultationId === id).map((r) => r.ruleId).filter(Boolean))
    let position = existing.reduce((m, r) => Math.max(m, r.position || 0), 0)
    for (const it of out.items) {
      if (it.ruleId && kept.has(it.ruleId)) continue
      im.recs.push({ id: next(im, 'rec'), consultationId: id, kind: it.kind, productId: it.productId ?? null, title: it.title, detail: it.detail || {}, reason: it.reason || null, source: 'regla', ruleId: it.ruleId, status: 'sugerida', edited: false, decidedBy: null, decidedByName: null, decidedAt: null, position: ++position })
    }
    logEvent(st, id, { actor: 'barbero', action: 'sugerencias', detail: { items: out.items.length, warnings: out.warnings.length } })
    return OK({ recs: full(st, id).recs, warnings: out.warnings })
  }
  if (method === 'POST' && id && q.rec) {
    const kind = REC_KINDS.find((k) => k.id === body.kind)?.id
    if (!kind) return E(400, 'Tipo de recomendación inválido')
    let title = String(body.title || '').trim()
    let productId = null
    if (PRODUCT_KINDS.includes(kind)) {
      const cats = CATEGORIES.filter((x) => x.group === KIND_GROUP[kind]).map((x) => x.id)
      const p = im.products.find((x) => x.id === Number(body.productId) && cats.includes(x.category))
      if (!p) return E(400, 'Elige un producto del catálogo')
      productId = p.id
      title ||= [p.brand, p.name].filter(Boolean).join(' ')
    }
    if (!title) return E(400, 'Escribe la recomendación')
    const position = Math.max(0, ...im.recs.filter((r) => r.consultationId === id).map((r) => r.position)) + 1
    const rec = { id: next(im, 'rec'), consultationId: id, kind, productId, title, detail: body.detail || {}, reason: body.reason || null, source: 'manual', ruleId: null, status: 'aprobada', edited: false, decidedBy: 6, decidedByName: 'Bruno Herrera', decidedAt: iso(), position }
    im.recs.push(rec)
    logEvent(st, id, { actor: 'barbero', action: 'rec_manual', detail: { kind, title } })
    return [201, { ok: true, rec }]
  }
  if (method === 'POST' && id && q.generate) {
    const cons = find(id)
    if (!cons) return E(404, 'Asesoría no encontrada')
    if (!cons.diagnosis?.face?.id) return E(400, 'Falta el tipo de rostro en el diagnóstico.')
    if (!im.recs.some((r) => r.consultationId === id && r.kind === 'corte' && r.status === 'aprobada')) return E(400, 'Aprueba al menos un corte antes de generar el informe.')
    const version = Math.max(0, ...im.reports.filter((r) => r.consultationId === id).map((r) => r.version)) + 1
    const report = { id: next(im, 'report'), consultationId: id, version, snapshot: snapshot(st, cons, version), createdAt: iso(), sentAt: null, sentTo: null, sendCount: 0, shareToken: null, shareExpiresAt: null }
    im.reports.push(report)
    if (cons.status !== 'cancelada') cons.status = 'informe_listo'
    cons.updatedAt = iso()
    logEvent(st, id, { actor: 'barbero', action: 'informe', detail: { version, recs: report.snapshot.recs.length } })
    return [201, { ok: true, report: reportOut(report) }]
  }
  if (method === 'POST' && id && q.paid) {
    const cons = find(id)
    if (!cons) return E(404, 'Asesoría no encontrada')
    const amount = Math.round(Number(body.amount))
    if (!Number.isFinite(amount) || amount < 0 || !['efectivo', 'transferencia', 'tarjeta', 'reserva'].includes(body.method)) return E(400, 'Monto o medio de pago inválido')
    Object.assign(cons, { paymentStatus: 'pagada', paidAmount: amount, paymentMethod: body.method, paidAt: iso(), updatedAt: iso() })
    if (cons.status === 'pago_pendiente') cons.status = 'datos_pendientes'
    logEvent(st, id, { actor: 'barbero', action: 'pago', detail: { amount, method: body.method } })
    return OK({ consultation: withLinks(cons) })
  }
  if (method === 'POST') {
    const phone = cleanPhone(body.phone)
    const name = String(body.name || '').trim()
    if (!name && phone.length !== 9) return E(400, 'Falta el cliente')
    const cons = {
      id: next(im, 'consultation'), clientId: h.clientByPhone(phone)?.id ?? null, bookingId: Number(body.bookingId) || null, source: 'panel',
      modality: body.modality === 'online' ? 'online' : 'presencial', status: 'datos_pendientes', paymentStatus: 'en_local', price: null, paidAmount: null,
      paymentMethod: null, paymentRef: null, paidAt: null, name: name || null, phone: phone.length === 9 ? phone : null,
      email: EMAIL_RE.test(String(body.email || '')) ? String(body.email).trim().toLowerCase() : null, age: null,
      visitDate: DATE_RE.test(String(body.visitDate || '')) ? body.visitDate : null, intake: {}, intakeSubmittedAt: null,
      consentAt: null, consentBy: null, consentVersion: null, formToken: token(), diagnosis: {}, diagnosedBy: null, diagnosedAt: null,
      nextFollowup: null, notes: null, utm: null, createdBy: 6, createdAt: iso(), updatedAt: iso(),
    }
    im.consultations.push(cons)
    logEvent(st, cons.id, { actor: 'barbero', action: 'creada', detail: { modality: cons.modality, bookingId: cons.bookingId } })
    return [201, { ok: true, ...full(st, cons.id) }]
  }
  if (method === 'PATCH') {
    const cons = find(id)
    if (!cons) return E(404, 'Asesoría no encontrada')
    const before = JSON.stringify(cons.diagnosis || {})
    for (const k of ['name', 'email', 'age', 'visitDate', 'nextFollowup', 'notes']) if (body[k] !== undefined) cons[k] = body[k] === '' ? null : body[k]
    if (body.phone !== undefined) cons.phone = cleanPhone(body.phone).length === 9 ? cleanPhone(body.phone) : null
    if (['presencial', 'online'].includes(body.modality)) cons.modality = body.modality
    if (body.intake !== undefined) cons.intake = cleanIntake(body.intake)
    if (body.diagnosis !== undefined) cons.diagnosis = body.diagnosis || {}
    const changed = body.diagnosis !== undefined && JSON.stringify(cons.diagnosis) !== before
    if (changed) Object.assign(cons, { diagnosedBy: 6, diagnosedAt: iso() })
    const from = cons.status
    if (body.status === 'cancelada') cons.status = 'cancelada'
    else if (body.status === 'reabrir' && cons.status === 'cancelada') cons.status = cons.intakeSubmittedAt || cons.diagnosedAt ? 'en_revision' : 'datos_pendientes'
    else if (changed && cons.status === 'datos_pendientes') cons.status = 'en_revision'
    if (body.consent && !cons.consentAt) Object.assign(cons, { consentAt: iso(), consentBy: 'barbero:6', consentVersion: CONSENT_VERSION })
    cons.clientId = h.clientByPhone(cons.phone)?.id ?? cons.clientId
    cons.updatedAt = iso()
    if (changed) logEvent(st, id, { actor: 'barbero', action: 'diagnostico', detail: { face: cons.diagnosis?.face?.name || null } })
    if (from !== cons.status) logEvent(st, id, { actor: 'barbero', action: 'estado', detail: { from, to: cons.status } })
    return OK(full(st, id))
  }
  if (method === 'DELETE') {
    if (!find(id)) return E(404, 'Asesoría no encontrada')
    im.consultations = im.consultations.filter((x) => x.id !== id)
    for (const k of ['photos', 'recs', 'reports', 'events']) im[k] = im[k].filter((x) => x.consultationId !== id)
    return OK()
  }
  return E(405, 'Method not allowed')
}

function catalogApi(c) {
  const { st, method, q, body } = c
  const im = store(st)
  const pid = Number(q.pid) || null
  if (method === 'GET') {
    if (q.essentials) {
      return OK({ products: st.products.filter((p) => !p.archivedAt).map((p) => ({ id: p.id, name: p.name, brand: p.brand, price: p.price, stock: p.stock, imgFront: p.imgFront, imported: im.products.some((x) => x.productId === p.id) })) })
    }
    return OK({ products: catalog(st) })
  }
  if (method === 'POST' && q.import) {
    let created = 0
    for (const it of Array.isArray(body.items) ? body.items : []) {
      const shop = st.products.find((p) => p.id === Number(it.productId))
      if (!shop || !CATEGORIES.some((x) => x.id === it.category) || im.products.some((x) => x.productId === shop.id)) continue
      im.products.push(product({ name: shop.name, brand: shop.brand, category: it.category, imgUrl: shop.imgFront, description: shop.description, soldHere: true, productId: shop.id }, next(im, 'product')))
      created += 1
    }
    return OK({ created, products: catalog(st) })
  }
  if (method === 'POST' && q.upload) {
    const p = im.products.find((x) => x.id === Number(body.pid))
    if (!p || !/^data:image\/(png|jpeg|jpg);base64,/.test(String(body.dataUrl || ''))) return E(400, 'Falta el producto o la foto')
    p.imgUrl = body.dataUrl
    return OK({ product: p })
  }
  if (method === 'POST' || method === 'PATCH') {
    if (method === 'PATCH' && body.reviewed && Object.keys(body).length === 1) {
      const p = im.products.find((x) => x.id === pid)
      if (!p) return E(404, 'Producto no encontrado')
      p.reviewedAt = iso()
      return OK({ product: p })
    }
    if (!String(body.name || '').trim() || !CATEGORIES.some((x) => x.id === body.category)) return E(400, 'Falta el nombre o la categoría')
    if (method === 'POST') {
      const p = product({ ...body, reviewedAt: body.reviewed ? iso() : null }, next(im, 'product'))
      im.products.push(p)
      return [201, { ok: true, product: p }]
    }
    const i = im.products.findIndex((x) => x.id === pid)
    if (i < 0) return E(404, 'Producto no encontrado')
    im.products[i] = product({ ...im.products[i], ...body, reviewedAt: body.reviewed ? iso() : im.products[i].reviewedAt }, pid)
    return OK({ product: im.products[i] })
  }
  if (method === 'DELETE') {
    const p = im.products.find((x) => x.id === pid)
    if (!p) return E(404, 'Producto no encontrado')
    if (im.recs.some((r) => r.productId === pid)) { p.active = false; return OK({ archived: true, deleted: false, product: p }) }
    im.products = im.products.filter((x) => x !== p)
    return OK({ archived: false, deleted: true })
  }
  return E(405, 'Method not allowed')
}

export function product(p, id) {
  const arr = (v) => (Array.isArray(v) ? v : [])
  return {
    id, name: String(p.name).trim(), brand: p.brand || null, category: p.category, imgUrl: p.imgUrl || null, description: p.description || null,
    hold: p.hold || null, shine: p.shine || null, amount: p.amount || null, application: p.application || null, usage: p.usage || null,
    frequency: p.frequency || null, hairTypes: arr(p.hairTypes), thickness: arr(p.thickness), conditions: arr(p.conditions), needs: arr(p.needs),
    soldHere: Boolean(p.soldHere), productId: Number(p.productId) || null, price: p.price === '' || p.price == null ? null : Number(p.price),
    buyUrl: p.buyUrl || null, active: p.active !== false, reviewedAt: p.reviewedAt || null, updatedAt: iso(),
  }
}

/* ---------- público: formulario e informe ---------- */
function publicState(st, cons) {
  const photos = store(st).photos.filter((p) => p.consultationId === cons.id)
  return {
    name: cons.name, email: cons.email, phone: cons.phone, age: cons.age, modality: cons.modality, status: cons.status,
    paymentStatus: cons.paymentStatus, paid: cons.paymentStatus === 'pagada',
    canEdit: ['pagada', 'en_local'].includes(cons.paymentStatus) && !cons.intakeSubmittedAt && cons.status !== 'cancelada',
    submitted: Boolean(cons.intakeSubmittedAt), intake: cons.intake || {}, consentAt: cons.consentAt,
    photos: photos.map((p) => ({ id: p.id, angle: p.angle })),
  }
}

export async function imagenFormApi(c) {
  const { st, method, q, body } = c
  const im = store(st)
  if (!TOKEN_RE.test(String(q.t || ''))) return E(404, 'Enlace no válido')
  const cons = im.consultations.find((x) => x.formToken === q.t)
  if (!cons) return E(404, 'Enlace no válido')
  const state = publicState(st, cons)
  if (q.photo) {
    const p = im.photos.find((x) => x.id === Number(q.photo) && x.consultationId === cons.id)
    if (!p) return E(404, 'Foto no encontrada')
    if (method === 'GET') return photoBytes(p)
    if (method === 'DELETE') {
      if (!state.canEdit) return E(409, 'Ya no se puede modificar')
      im.photos = im.photos.filter((x) => x !== p)
      return OK()
    }
  }
  if (method === 'GET') return OK({ consultation: state })
  if (!state.canEdit) return E(409, state.submitted ? 'Tus datos ya fueron enviados.' : state.status === 'cancelada' ? 'Esta asesoría fue cancelada.' : 'El pago todavía no está confirmado.', { consultation: state })
  if (method === 'PATCH') {
    if (String(body.name || '').trim()) cons.name = String(body.name).trim()
    if (EMAIL_RE.test(String(body.email || ''))) cons.email = String(body.email).trim().toLowerCase()
    if (cleanPhone(body.phone).length === 9) cons.phone = cleanPhone(body.phone)
    cons.age = Number(body.age) > 0 && Number(body.age) < 120 ? Math.round(Number(body.age)) : null
    cons.intake = cleanIntake(body.intake)
    cons.updatedAt = iso()
    return OK({ consultation: publicState(st, cons) })
  }
  if (method === 'POST' && q.consent) {
    if (!cons.consentAt) {
      Object.assign(cons, { consentAt: iso(), consentBy: 'cliente', consentVersion: CONSENT_VERSION })
      logEvent(st, cons.id, { actor: 'cliente', action: 'consentimiento', detail: { version: CONSENT_VERSION } })
    }
    return OK({ consultation: publicState(st, cons) })
  }
  if (method === 'POST' && q.upload) {
    if (!cons.consentAt) return E(400, 'Primero acepta el uso de tus fotos.')
    if (!ANGLES.some((a) => a.id === body.angle)) return E(400, 'Ángulo inválido')
    if (!/^data:image\/(png|jpeg|jpg);base64,/.test(String(body.dataUrl || ''))) return E(400, 'La foto tiene que ser JPEG o PNG')
    im.photos = im.photos.filter((x) => !(x.consultationId === cons.id && x.angle === body.angle))
    const photo = { id: next(im, 'photo'), consultationId: cons.id, angle: body.angle, src: body.dataUrl, uploadedBy: 'cliente', createdAt: iso() }
    im.photos.push(photo)
    logEvent(st, cons.id, { actor: 'cliente', action: 'foto', detail: { angle: body.angle } })
    return [201, { ok: true, photo: { id: photo.id, angle: photo.angle } }]
  }
  if (method === 'POST' && q.submit) {
    if (!cons.name || !EMAIL_RE.test(String(cons.email || '')) || !/^\d{9}$/.test(String(cons.phone || ''))) return E(400, 'Completa tu nombre, correo y WhatsApp.')
    if (!cons.consentAt) return E(400, 'Falta aceptar el uso de tus fotos.')
    if (cons.modality === 'online') {
      const have = new Set(im.photos.filter((p) => p.consultationId === cons.id).map((p) => p.angle))
      const missing = ANGLES.filter((a) => a.required && !have.has(a.id)).map((a) => a.label.toLowerCase())
      if (missing.length) return E(400, `Faltan fotos: ${missing.join(', ')}.`)
    }
    cons.intakeSubmittedAt = iso()
    if (cons.status === 'datos_pendientes') cons.status = 'en_revision'
    cons.updatedAt = iso()
    logEvent(st, cons.id, { actor: 'cliente', action: 'datos_enviados', detail: { photos: state.photos.length } })
    st.notifications.unshift({ id: Date.now(), title: 'Datos recibidos · Asesoría', body: `${cons.name} completó su ficha.`, url: '/panel?tab=imagen', tag: `asesoria-datos-${cons.id}`, createdAt: iso() })
    return OK({ consultation: publicState(st, cons) })
  }
  return E(405, 'Method not allowed')
}

export async function imagenInformeApi(c) {
  const { st, q } = c
  const im = store(st)
  const r = im.reports.find((x) => x.shareToken && x.shareToken === q.t)
  if (!r) return E(404, 'Informe no encontrado')
  if (new Date(r.shareExpiresAt) <= new Date()) return E(410, 'Este enlace venció. Pídele uno nuevo a Bruno por WhatsApp.')
  r.snapshot ||= snapshot(st, im.consultations.find((x) => x.id === r.consultationId), r.version)
  const { bytes } = await pdfOf(r.snapshot)
  return [200, bytes, 'application/pdf']
}

/* ---------- checkout (mp-payments del mock) ---------- */
export function asesoriaCheckout(st, { modality, name, phone, email, utm }) {
  const im = store(st)
  const m = st.settings.asesoria?.[modality]
  if (!m) return { error: [400, { error: 'Elige la modalidad de la asesoría' }] }
  if (!m.enabled || !(m.price > 0)) return { error: [409, { error: 'Esta asesoría todavía no se vende en línea. Escríbenos por WhatsApp y la coordinamos.', paused: true }] }
  const cons = {
    id: next(im, 'consultation'), clientId: null, bookingId: null, source: 'web', modality, status: 'datos_pendientes',
    paymentStatus: 'pagada', price: m.price, paidAmount: m.price, paymentMethod: 'mercadopago', paymentRef: `mock_${Date.now()}`, paidAt: iso(),
    name, phone, email, age: null, visitDate: null, intake: {}, intakeSubmittedAt: null, consentAt: null, consentBy: null, consentVersion: null,
    formToken: token(), diagnosis: {}, diagnosedBy: null, diagnosedAt: null, nextFollowup: null, notes: null, utm: utm || null,
    createdBy: null, createdAt: iso(), updatedAt: iso(),
  }
  im.consultations.push(cons)
  logEvent(st, cons.id, { actor: 'cliente', action: 'checkout', detail: { modality, price: m.price } })
  logEvent(st, cons.id, { actor: 'sistema', action: 'pago', detail: { amount: m.price, method: 'mercadopago' } })
  return { cons, amount: m.price }
}

export const asesoriaOrders = (st) => store(st).consultations
  .filter((x) => x.paymentStatus === 'pagada' && x.paymentMethod === 'mercadopago')
  .map((x) => ({ id: x.id, type: 'asesoria', name: x.name, phone: x.phone, email: x.email, amount: x.paidAmount || 0, detail: x.modality === 'online' ? 'Asesoría online' : 'Asesoría presencial', created_at: x.paidAt || x.createdAt }))
