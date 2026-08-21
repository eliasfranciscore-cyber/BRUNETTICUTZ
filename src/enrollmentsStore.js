/* PIMP STUDIO — Persistencia local de inscripciones (Cursos / Workshop)
   ------------------------------------------------------------------
   Capa de respaldo: guarda las inscripciones del flujo público en
   localStorage para que aparezcan de inmediato en el panel interno
   (Inscripciones), aunque el backend (Neon) no esté disponible o tarde en
   sincronizar — p. ej. en desarrollo (Vite no sirve /api) o si la inserción
   en el servidor falla. El backend sigue siendo la fuente de verdad cuando
   responde; esto sólo garantiza una experiencia verificable de extremo a
   extremo. */

import { cleanPhone } from "./data.js"

const KEY = "ps_enrollments_local"

export function readLocalEnrollments() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") } catch { return [] }
}

function writeLocalEnrollments(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-200))) } catch {}
}

/* Normaliza una inscripción al mismo shape que devuelve /api/enrollments. */
export function addLocalEnrollment(data = {}) {
  const list = readLocalEnrollments()
  const entry = {
    id: data.id || `local-${Date.now()}`,
    name: (data.name || "").trim(),
    phone: cleanPhone(data.phone),
    email: (data.email || "").trim().toLowerCase(),
    source: data.source === "workshop" ? "workshop" : "cursos",
    level: data.level || null,
    message: data.message || null,
    edition: data.edition || null,
    created_at: data.created_at || new Date().toISOString(),
  }
  // Dedup: misma persona + mismo origen (teléfono|source).
  const keyOf = (e) => `${e.phone}|${e.source}`
  const deduped = list.filter((e) => keyOf(e) !== keyOf(entry))
  deduped.push(entry)
  writeLocalEnrollments(deduped)
  return entry
}

/* Combina inscripciones del backend con las locales sin duplicar
   (clave: teléfono|origen). Las del servidor tienen prioridad. */
export function mergeEnrollments(serverRows = []) {
  const local = readLocalEnrollments()
  const byKey = new Map()
  const keyOf = (e) => `${String(e.phone || "").replace(/\D/g, "")}|${e.source}`
  serverRows.forEach((e) => byKey.set(keyOf(e), e))
  local.forEach((e) => { if (!byKey.has(keyOf(e))) byKey.set(keyOf(e), e) })
  // Orden por fecha desc, igual que la API.
  return [...byKey.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}
