/* ============================================================
   "Cargar cursos iniciales" (Cursos → admin-seed).

   El cuerpo lo arma el HOST (src/academy/host.jsx → buildSeedPayload, async:
   `await buildSeedPayload()`): cada sitio siembra sus propios cursos. Acá
   solo queda el resumen que ve el barbero antes de confirmar, que es igual
   en los dos repos. (CursosSection ya importa directo de host.jsx; esto
   queda como reexport por compatibilidad.)
   ============================================================ */

export { buildSeedPayload } from '../../../academy/host.jsx'

/* `existingSlugs` solo sirve para el resumen (el servidor igual salta los
   que existen). */
export function seedSummary(payload, existingSlugs = []) {
  const skip = new Set(existingSlugs)
  const fresh = payload.courses.filter((c) => !skip.has(c.slug))
  const sections = fresh.reduce((n, c) => n + c.sections.length, 0)
  const lessons = fresh.reduce((n, c) => n + c.sections.reduce((k, s) => k + s.lessons.length, 0), 0)
  return { total: payload.courses.length, courses: fresh.length, skipped: payload.courses.length - fresh.length, sections, lessons }
}
