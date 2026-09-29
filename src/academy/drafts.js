/* ACADEMY — borradores locales (compositor, comentarios, chat)
   ------------------------------------------------------------------
   La PWA se recarga sola cuando hay un deploy nuevo (src/buildWatch.js) y iOS
   mata pestañas en segundo plano sin avisar: un post a medio escribir no puede
   depender de que la pestaña siga viva. Se guarda en localStorage, por miembro
   (dos cuentas en el mismo teléfono no se ven los borradores) y con
   vencimiento de 14 días. Todo con try/catch: sin storage, simplemente no hay
   borrador. */

import { getMember } from './session.js'

const PREFIX = 'ps_academy_draft:'
const TTL_MS = 14 * 24 * 60 * 60 * 1000
const MAX_CHARS = 20000

function fullKey(key) {
  const id = getMember()?.id ?? 'anon'
  return `${PREFIX}${id}:${String(key)}`
}

export function loadDraft(key) {
  try {
    const raw = localStorage.getItem(fullKey(key))
    if (!raw) return null
    const { v, t } = JSON.parse(raw)
    if (!t || Date.now() - t > TTL_MS) {
      localStorage.removeItem(fullKey(key))
      return null
    }
    return v ?? null
  } catch {
    return null
  }
}

/* Guarda cualquier valor serializable. Un valor vacío ('' / null / {} sin
   contenido) borra el borrador en vez de guardarlo. */
export function saveDraft(key, value) {
  try {
    const empty = value === null || value === undefined || value === '' ||
      (typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((x) => x === '' || x === null || x === undefined || (Array.isArray(x) && !x.length)))
    if (empty) { localStorage.removeItem(fullKey(key)); return }
    const raw = JSON.stringify({ v: value, t: Date.now() })
    if (raw.length > MAX_CHARS) return
    localStorage.setItem(fullKey(key), raw)
  } catch { /* storage lleno o bloqueado */ }
}

export function clearDraft(key) {
  try { localStorage.removeItem(fullKey(key)) } catch { /* sin storage */ }
}

// Limpieza oportunista de borradores vencidos (se llama al montar la app).
export function pruneDrafts() {
  try {
    const now = Date.now()
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      try {
        const { t } = JSON.parse(localStorage.getItem(k) || '{}')
        if (!t || now - t > TTL_MS) localStorage.removeItem(k)
      } catch { localStorage.removeItem(k) }
    }
  } catch { /* sin storage */ }
}
