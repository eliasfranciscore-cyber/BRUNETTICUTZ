import React, { useEffect, useState } from 'react'
import { Chip } from '../../../components/panel/index.js'
import { FACE_SHAPES } from '../../../data/estilo.js'
import ESTILO from '../../../data/content/estilo.json'
import { STATUSES, PAYMENT_STATUSES, MODALITIES, labelOf } from '../../../imagen/vocab.js'

/* Piezas comunes de la pestaña Image Studio (ImagenTab.jsx y sus vistas). */

export const API = '/api/clients?mode=imagen'
export const isJson = (res) => Boolean(res?.headers?.get('content-type')?.includes('application/json'))
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* fetch con sesión que tira el error del servidor como Error. */
export function makeCall(authHeaders) {
  return async (url, { method = 'GET', body } = {}) => {
    const res = await fetch(url, {
      method,
      headers: authHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const json = isJson(res) ? await res.json() : null
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'No se pudo completar. Intenta de nuevo.')
    return json
  }
}

// Forma de rostro completa: silueta y tips del .js, textos del .json (lo que
// se edita con `npm run edit`), emparejados por índice como en /style.
export const SHAPES = FACE_SHAPES.map((s, i) => {
  const t = ESTILO.faceShapes?.[i] || {}
  return { ...s, ...t, best: s.best.map((b, j) => ({ ...b, ...(t.best?.[j] || {}) })), tips: s.tips || [] }
})
export const shapeById = (id) => SHAPES.find((s) => s.id === id) || null
// Lo que se guarda en el diagnóstico: una copia, para que un informe viejo no
// cambie si después se editan los textos de /style.
export const faceSnapshot = (s) => (s ? {
  id: s.id, name: s.name, tagline: s.tagline, traits: s.traits, diagnosis: s.diagnosis, goal: s.goal, avoid: s.avoid,
  path: s.path, tips: s.tips, best: s.best.map(({ name, note, img }) => ({ name, note, img })),
} : null)

export function FaceGlyph({ path }) {
  return <svg viewBox="0 0 100 120" aria-hidden="true"><path d={path} /></svg>
}

export function yesterdayKey() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
export const addDaysKey = (key, n) => {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export const fmtDay = (key) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''))
  if (!m) return ''
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])))
}
export const fmtStamp = (v, withTime = false) => {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short', ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(d)
}
export const clp = (n) => (n == null ? '' : `$${Math.round(Number(n)).toLocaleString('es-CL')}`)

const STATUS_ICON = { entregada: 'check', informe_listo: 'receipt', en_revision: 'eye' }
export function StatusChip({ status }) {
  const s = STATUSES.find((x) => x.id === status)
  if (!s) return <Chip tone="muted">{status || '—'}</Chip>
  return <Chip tone={s.tone} icon={STATUS_ICON[status]} dot={!STATUS_ICON[status]}>{s.label}</Chip>
}
export function PaymentChip({ c }) {
  if (c.paymentStatus === 'pagada') return <Chip tone="ok">{clp(c.paidAmount)} pagada</Chip>
  return <Chip tone={c.paymentStatus === 'pendiente' ? 'warn' : 'muted'}>{labelOf(PAYMENT_STATUSES, c.paymentStatus)}</Chip>
}
export const modalityLabel = (id) => labelOf(MODALITIES, id)

/* Una foto privada: se pide con la sesión y se muestra como objectURL (un
   <img src> no puede mandar el header de autorización). */
export function useAuthedImage(url, authHeaders) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    if (!url) { setSrc(null); return undefined }
    let live = true
    let objectUrl = null
    fetch(url, { headers: authHeaders() })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!live || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => {})
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  return src
}

/* Abre un PDF que necesita la sesión: se baja como blob y se abre en otra
   pestaña. La ventana se abre ANTES del await (si no, Safari la bloquea por
   no venir directo del toque). */
export async function openAuthedPdf(url, authHeaders, filename = 'Asesoria-de-imagen.pdf') {
  const win = window.open('', '_blank')
  try {
    const res = await fetch(url, { headers: authHeaders() })
    if (!res.ok) {
      const json = isJson(res) ? await res.json() : null
      throw new Error(json?.error || 'No se pudo abrir el PDF.')
    }
    const blobUrl = URL.createObjectURL(await res.blob())
    if (win) win.location.href = blobUrl
    else {
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      a.click()
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
  } catch (err) {
    win?.close()
    throw err
  }
}
