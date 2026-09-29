/* ACADEMY — niveles (gamificación tipo Skool)
   ------------------------------------------------------------------
   Mismos números que api/_academyHttp.js (SPEC §4.2): 1 punto = 1 "me gusta"
   recibido de otra persona. ESM puro, sin JSX ni import.meta.env (lo importa
   el mock de desarrollo desde Node). */

// Puntos mínimos para cada nivel 1..9 (índice 0 = nivel 1). Los de Skool.
export const LEVEL_THRESHOLDS = [0, 5, 20, 65, 155, 515, 2015, 8015, 33015]
export const MAX_LEVEL = LEVEL_THRESHOLDS.length

// Nombres por defecto; el dueño los cambia en Ajustes (settings.levels.names).
export const DEFAULT_LEVEL_NAMES = ['Aprendiz', 'Ayudante', 'Barbero', 'Barbero Pro', 'Fader', 'Estilista', 'Maestro', 'Leyenda', 'Élite']

/* levelFor(points) → { level, points, currentMin, nextMin|null, pointsToNext, progress 0..1 } */
export function levelFor(points) {
  const p = Math.max(0, Math.floor(Number(points) || 0))
  let level = 1
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (p >= LEVEL_THRESHOLDS[i]) { level = i + 1; break }
  }
  const currentMin = LEVEL_THRESHOLDS[level - 1]
  const nextMin = level < MAX_LEVEL ? LEVEL_THRESHOLDS[level] : null
  const pointsToNext = nextMin === null ? 0 : nextMin - p
  const progress = nextMin === null ? 1 : Math.max(0, Math.min(1, (p - currentMin) / (nextMin - currentMin)))
  return { level, points: p, currentMin, nextMin, pointsToNext, progress }
}

// Nombre de un nivel con los nombres del grupo (o los por defecto).
export function levelName(n, names) {
  const i = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(n) || 1))) - 1
  const list = Array.isArray(names) && names.length ? names : DEFAULT_LEVEL_NAMES
  const name = typeof list[i] === 'string' && list[i].trim() ? list[i].trim() : DEFAULT_LEVEL_NAMES[i]
  return name
}

// "Nivel 3 · Barbero"
export function levelLabel(n, names) {
  const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(n) || 1)))
  return `Nivel ${lvl} · ${levelName(lvl, names)}`
}
