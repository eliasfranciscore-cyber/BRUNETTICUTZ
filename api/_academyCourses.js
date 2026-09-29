/* ================================================================
   ACADEMY — Cursos, lecciones, progreso, catálogo y subidas
   ------------------------------------------------------------------
   No es una función serverless: api/_academy.js (el router) carga este
   módulo con import() dinámico y llama a `handlers[mode](ctx)`. Contrato
   completo en docs/academy/SPEC.md §5.2 y §16.

   REGLA DE ACCESO (una sola, en decideAccess):
     - propietario/admin ven TODO, borradores incluidos. El moderador NO: modera
       la comunidad, no es dueño del contenido pagado (SPEC §5.2).
     - para el resto el curso tiene que estar publicado, y además:
         'abierto' → cualquier miembro activo
         'compra'  → un grant activo (academy_grants.state = 'activa')
         'nivel'   → nivel ≥ unlock_level, o un grant activo (el que lo compró
                     no tiene que esperar a subir de nivel)
     - una lección se ve si su curso es accesible y la lección está publicada.

   LO QUE NUNCA SALE de acá hacia un no-staff: videoId, body o recursos de una
   lección bloqueada o en borrador. La lista de títulos de un curso bloqueado
   sí se muestra (es la vitrina: "esto es lo que te llevas si lo compras").

   SIN DDL: este archivo nunca llama a ensureAcademyTables. El router lo hace
   antes de los modos admin; lesson-progress y catalog son rutas calientes o
   públicas y no pueden tomar un ACCESS EXCLUSIVE por un ALTER (SPEC §0.3).

   Driver Neon 0.10.4: nada de fragmentos sql`` anidados. Todo lo interpolado
   es un parámetro, así que "no tocar este campo" es CASE WHEN ${flag} y los
   nombres de tabla van escritos a mano en cada rama.
   ================================================================ */

import { HttpError, levelFor, pointsFor } from "./_academyHttp.js"
import { safeUrl, isImageUrl, parseYouTubeId, cleanText, slugify } from "./_academyText.js"
import { mpConfigured } from "./_academyMp.js"

/* ── Constantes ─────────────────────────────────────────────────────────── */

const ACCESS_TYPES = ["compra", "abierto", "nivel"]
const REORDER_TYPES = ["course", "section", "lesson"]
const YT_ID = /^[A-Za-z0-9_-]{11}$/
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CATALOG_ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/

/* Subidas. Cuotas contadas en academy_uploads (no en Blob, que no sabe de
   miembros). El tope global protege la factura de Blob aunque aparezcan cien
   cuentas nuevas en un día; el por-miembro, que una sola no se lo coma. Se
   exporta para que admin-stats muestre el mismo número que hace cumplir. */
export const UPLOAD_LIMITS = { memberDay: 20, memberMonth: 100, globalMonth: 1200, maxBytes: 2 * 1024 * 1024 }
const UPLOAD_KINDS = ["avatar", "portada", "post", "chat", "galeria", "curso", "evento"]
// Imágenes de la "casa": portada del grupo, galería de Acerca de, portadas de
// cursos. Un miembro no tiene por qué poder subir nada ahí.
const ADMIN_UPLOAD_KINDS = new Set(["curso", "galeria", "portada"])
// Los eventos los crea el staff completo (admin-event-save es 'mod'), así que
// su portada también: si no, un moderador podría crear un evento pero no
// ponerle imagen.
const STAFF_UPLOAD_KINDS = new Set(["evento"])

const DEFAULT_CATEGORIES = [
  { name: "Anuncios", emoji: "📣", writeRole: "admins" },
  { name: "Preséntate", emoji: "👋", writeRole: "miembros" },
  { name: "Preguntas", emoji: "❓", writeRole: "miembros" },
  { name: "Logros", emoji: "🏆", writeRole: "miembros" },
  { name: "Mis cortes", emoji: "✂️", writeRole: "miembros" },
  { name: "Recursos", emoji: "📚", writeRole: "miembros" },
]

/* ── Utilidades chicas ──────────────────────────────────────────────────── */

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key)

function toId(v) {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null
}

function text(v, max) {
  return cleanText(v == null ? "" : String(v), max)
}

// Títulos, nombres y subtítulos: una sola línea. Un salto de línea en un
// título rompe la tarjeta y la barra lateral, y no aporta nada.
function line(v, max) {
  return cleanText(String(v ?? "").replace(/\s*\n\s*/g, " ").replace(/ {2,}/g, " "), max)
}

function pgCode(err) {
  return err?.code || err?.cause?.code || null
}

// Porcentaje entero que solo llega a 100 cuando de verdad está todo hecho:
// con Math.round, 199 de 200 lecciones mostraría "100%" y el curso sin cerrar.
function pct(done, total) {
  if (!total) return 0
  if (done >= total) return 100
  return Math.floor((done * 100) / total)
}

// Una portada se acepta solo si vive en nuestro Blob público o en /assets/
// (SPEC §0.2). Se aplica al guardar Y al devolver, por si una fila vieja o
// escrita a mano trae otra cosa.
function imageUrlOrNull(raw) {
  if (raw == null || raw === "") return null
  const url = safeUrl(String(raw))
  return url && isImageUrl(url) ? url : null
}

function videoIdOrNull(v) {
  return typeof v === "string" && YT_ID.test(v) ? v : null
}

// Recursos al salir: se vuelven a pasar por safeUrl. Si alguien metió un
// `javascript:` directo en la base, acá desaparece en vez de llegar a un href.
function resourcesOut(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const r of list) {
    const url = safeUrl(String(r?.url || ""))
    if (!url) continue
    out.push({ title: line(r?.title, 120) || url, url })
  }
  return out
}

function resourcesIn(list) {
  if (list == null) return []
  if (!Array.isArray(list)) throw new HttpError(400, "Los recursos deben venir como lista")
  if (list.length > 20) throw new HttpError(400, "Máximo 20 recursos por lección")
  const out = []
  list.forEach((r, i) => {
    const rawUrl = String(r?.url || "").trim()
    const title = line(r?.title, 120)
    if (!rawUrl && !title) return // fila vacía del editor
    const url = safeUrl(rawUrl)
    if (!url) throw new HttpError(400, `El enlace del recurso ${i + 1} no es válido`)
    out.push({ title: title || url, url })
  })
  return out
}

function priceIn(v) {
  if (v == null || v === "") return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1000 || n > 10000000) {
    throw new HttpError(400, "El precio debe ser un entero entre $1.000 y $10.000.000")
  }
  return n
}

function intIn(v, min, max, label) {
  if (v == null || v === "") return null
  const n = Number(v)
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} no es válido`)
  return Math.min(max, Math.max(min, Math.round(n)))
}

function isCourseStaff(member) {
  return member?.role === "propietario" || member?.role === "admin"
}

function isActive(member) {
  // requireMember ya garantiza 'activo'; esto es para quien llame a las
  // funciones exportadas con una fila propia (búsqueda, cron, provisión).
  return Boolean(member?.id) && (member.status === undefined || member.status === "activo")
}

async function levelOf(sql, member) {
  if (!member?.id) return 1
  const map = await pointsFor(sql, [member.id])
  const pts = Number(map?.get?.(member.id) ?? map?.get?.(String(member.id)) ?? 0)
  return levelFor(pts).level
}

/* ── Regla de acceso ────────────────────────────────────────────────────── */

/* Pura: decide con lo que ya se sabe. `owned` = hay grant activo; `level` =
   nivel del miembro. Todo lo desconocido cierra (un `access` raro = 'compra'). */
function decideAccess(member, course, { owned = false, level = 1 } = {}) {
  if (!isActive(member)) return { ok: false, reason: "compra" }
  if (isCourseStaff(member)) return { ok: true, reason: null }
  if (!course?.published) return { ok: false, reason: "borrador" }
  if (course.access === "abierto") return { ok: true, reason: null }
  if (owned) return { ok: true, reason: null }
  if (course.access === "nivel") {
    const need = Number(course.unlock_level ?? course.unlockLevel) || 2
    return level >= need ? { ok: true, reason: null } : { ok: false, reason: "nivel" }
  }
  return { ok: false, reason: "compra" }
}

// ¿Hace falta saber el nivel para decidir? Solo si el curso es por nivel y no
// hay grant: así el caso común (curso comprado o abierto) no paga la consulta
// de puntos.
function needsLevel(member, course, owned) {
  return !isCourseStaff(member) && course?.published && course.access === "nivel" && !owned
}

/* SPEC §16: canAccessCourse(sql, member, courseRow) → { ok, reason }.
   `courseRow` puede traer `owned` (boolean) si quien llama ya lo calculó;
   `opts.level` evita recalcular puntos en un bucle. */
export async function canAccessCourse(sql, member, courseRow, opts = {}) {
  if (!courseRow) return { ok: false, reason: "compra" }
  const quick = decideAccess(member, courseRow, { owned: false, level: 1 })
  if (quick.ok || quick.reason === "borrador" || !isActive(member)) return quick
  let owned = typeof courseRow.owned === "boolean" ? courseRow.owned : null
  if (owned === null) {
    const [g] = await sql`
      SELECT 1 AS x FROM academy_grants
      WHERE member_id = ${member.id} AND course_id = ${courseRow.id} AND state = 'activa'
      LIMIT 1
    `
    owned = Boolean(g)
  }
  if (owned) return { ok: true, reason: null }
  if (courseRow.access !== "nivel") return { ok: false, reason: "compra" }
  const level = Number.isInteger(opts.level) ? opts.level : await levelOf(sql, member)
  return decideAccess(member, courseRow, { owned, level })
}

// Una sola consulta con todo lo que hace falta para decidir sobre una lección.
async function lessonAccessRow(sql, member, lessonId) {
  const [row] = await sql`
    SELECT l.id, l.course_id, l.published AS lesson_published, l.duration_sec,
           c.published, c.access, c.unlock_level,
           EXISTS (
             SELECT 1 FROM academy_grants g
             WHERE g.member_id = ${member?.id || 0} AND g.course_id = c.id AND g.state = 'activa'
           ) AS owned
    FROM academy_lessons l
    JOIN academy_courses c ON c.id = l.course_id
    WHERE l.id = ${lessonId}
  `
  return row || null
}

async function decideLesson(sql, member, row) {
  if (!row) return { ok: false, reason: "no_existe" }
  if (!isCourseStaff(member) && !row.lesson_published) return { ok: false, reason: "no_existe" }
  const course = { id: row.course_id, published: row.published, access: row.access, unlock_level: row.unlock_level }
  const level = needsLevel(member, course, row.owned) ? await levelOf(sql, member) : 1
  return decideAccess(member, course, { owned: row.owned, level })
}

/* SPEC §16: canAccessLesson(sql, member, lessonId) → boolean. La usan los
   comentarios de lección y la búsqueda (BE-COMMUNITY). */
export async function canAccessLesson(sql, member, lessonId) {
  const id = toId(lessonId)
  if (!id || !isActive(member)) return false
  const row = await lessonAccessRow(sql, member, id)
  return (await decideLesson(sql, member, row)).ok
}

/* SPEC §16: accessibleCourseIds(sql, member) → int[]. Cursos cuyo contenido
   puede ver. OJO quien la use: dentro de esos cursos, un no-staff igual solo
   ve lecciones con `published = true` — este filtro es por curso, no por
   lección. */
export async function accessibleCourseIds(sql, member) {
  if (!isActive(member)) return []
  if (isCourseStaff(member)) {
    const rows = await sql`SELECT id FROM academy_courses ORDER BY position, id`
    return rows.map((r) => r.id)
  }
  const rows = await sql`
    SELECT c.id, c.published, c.access, c.unlock_level,
           EXISTS (
             SELECT 1 FROM academy_grants g
             WHERE g.member_id = ${member.id} AND g.course_id = c.id AND g.state = 'activa'
           ) AS owned
    FROM academy_courses c
    WHERE c.published
    ORDER BY c.position, c.id
  `
  const level = rows.some((r) => needsLevel(member, r, r.owned)) ? await levelOf(sql, member) : 1
  return rows.filter((r) => decideAccess(member, r, { owned: r.owned, level }).ok).map((r) => r.id)
}

/* ── Proyecciones ───────────────────────────────────────────────────────── */

function courseCard(row, lessons, access) {
  const total = lessons.length
  const done = lessons.filter((l) => l.completed).length
  // Sin acceso no hay "siguiente lección" a la que mandar: el botón llevaría a
  // un 403. La vitrina muestra los títulos desde `course`, no desde acá.
  const next = access.ok ? lessons.find((l) => !l.completed) || null : null
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle || null,
    description: row.description || null,
    coverUrl: imageUrlOrNull(row.cover_url),
    access: row.access,
    unlockLevel: row.unlock_level ?? null,
    owned: Boolean(row.owned),
    locked: !access.ok,
    lockReason: access.ok ? null : access.reason,
    lessonCount: total,
    completedCount: done,
    progress: pct(done, total),
    nextLesson: next ? { slug: next.slug, title: next.title } : null,
    priceOnline: row.price_online ?? null,
    // "En venta" de verdad: el checkout exige publicado + venta abierta + un
    // precio. Devolver sales_open a secas mostraría "Comprar" en un curso que
    // el checkout después rechaza.
    salesOpen: Boolean(row.sales_open && row.published && (row.price_online != null || row.price_presencial != null)),
    published: Boolean(row.published),
  }
}

function lessonAdmin(r) {
  return {
    id: r.id,
    courseId: r.course_id,
    sectionId: r.section_id ?? null,
    slug: r.slug,
    title: r.title,
    position: r.position,
    videoProvider: r.video_provider || "youtube",
    videoId: videoIdOrNull(r.video_id),
    durationSec: r.duration_sec ?? null,
    body: r.body || "",
    resources: resourcesOut(r.resources),
    published: Boolean(r.published),
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null,
  }
}

function courseAdmin(r) {
  return {
    id: r.id,
    slug: r.slug,
    catalogId: r.catalog_id || null,
    title: r.title,
    subtitle: r.subtitle || null,
    description: r.description || null,
    coverUrl: imageUrlOrNull(r.cover_url),
    position: r.position,
    published: Boolean(r.published),
    access: r.access,
    unlockLevel: r.unlock_level ?? null,
    priceOnline: r.price_online ?? null,
    pricePresencial: r.price_presencial ?? null,
    salesOpen: Boolean(r.sales_open),
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null,
  }
}

function sectionOut(r) {
  return { id: r.id, courseId: r.course_id, title: r.title, position: r.position }
}

/* Agrupa las lecciones (ya ordenadas por SQL) en secciones + sueltas. Un
   no-staff no ve secciones vacías: una sección con solo borradores sería un
   título colgando sin nada debajo. */
function groupLessons(sections, lessons, { staff, mapLesson }) {
  const bySection = new Map(sections.map((s) => [s.id, []]))
  const unsectioned = []
  for (const l of lessons) {
    const list = l.section_id != null ? bySection.get(l.section_id) : null
    if (list) list.push(mapLesson(l))
    else unsectioned.push(mapLesson(l))
  }
  const out = []
  for (const s of sections) {
    const items = bySection.get(s.id)
    if (!staff && !items.length) continue
    out.push({ id: s.id, title: s.title, lessons: items })
  }
  return { sections: out, unsectioned }
}

/* ORDEN DE LECCIONES (el mismo en todas las consultas de este archivo, para
   que "siguiente lección", anterior/siguiente y la barra lateral coincidan):
   primero las sueltas (sin sección), después cada sección por su posición, y
   dentro de cada grupo por la posición de la lección. El front debe pintar
   `unsectioned` ANTES de `sections`. */

/* ── Handlers: miembro ──────────────────────────────────────────────────── */

async function listCourses(ctx) {
  const { sql, member } = ctx
  const staff = isCourseStaff(member)
  const [courses, lessons] = await Promise.all([
    sql`
      SELECT c.id, c.slug, c.title, c.subtitle, c.description, c.cover_url, c.access, c.unlock_level,
             c.price_online, c.price_presencial, c.sales_open, c.published,
             EXISTS (
               SELECT 1 FROM academy_grants g
               WHERE g.member_id = ${member.id} AND g.course_id = c.id AND g.state = 'activa'
             ) AS owned
      FROM academy_courses c
      WHERE (${staff}::boolean OR c.published)
      ORDER BY c.position, c.id
    `,
    sql`
      SELECT l.id, l.course_id, l.section_id, l.slug, l.title,
             (p.completed_at IS NOT NULL) AS completed
      FROM academy_lessons l
      JOIN academy_courses c ON c.id = l.course_id
      LEFT JOIN academy_sections s ON s.id = l.section_id
      LEFT JOIN academy_lesson_progress p ON p.lesson_id = l.id AND p.member_id = ${member.id}
      WHERE (${staff}::boolean OR (c.published AND l.published))
      ORDER BY l.course_id, (l.section_id IS NOT NULL), s.position, s.id, l.position, l.id
    `,
  ])
  const byCourse = new Map()
  for (const l of lessons) {
    if (!byCourse.has(l.course_id)) byCourse.set(l.course_id, [])
    byCourse.get(l.course_id).push(l)
  }
  const level = courses.some((c) => needsLevel(member, c, c.owned)) ? await levelOf(sql, member) : 1
  return {
    courses: courses.map((c) => courseCard(c, byCourse.get(c.id) || [], decideAccess(member, c, { owned: c.owned, level }))),
  }
}

async function getCourseRow(sql, member, slug) {
  if (typeof slug !== "string" || slug.length > 60 || !SLUG_RE.test(slug)) return null
  const [row] = await sql`
    SELECT c.id, c.slug, c.title, c.subtitle, c.description, c.cover_url, c.access, c.unlock_level,
           c.price_online, c.price_presencial, c.sales_open, c.published,
           EXISTS (
             SELECT 1 FROM academy_grants g
             WHERE g.member_id = ${member.id} AND g.course_id = c.id AND g.state = 'activa'
           ) AS owned
    FROM academy_courses c
    WHERE c.slug = ${slug}
  `
  // Un borrador no existe para quien no es staff: ni 403 ni "próximamente",
  // para no delatar qué se está preparando.
  if (!row || (!row.published && !isCourseStaff(member))) return null
  return row
}

async function getCourse(ctx) {
  const { sql, member, query } = ctx
  const staff = isCourseStaff(member)
  const row = await getCourseRow(sql, member, query.slug)
  if (!row) throw new HttpError(404, "Curso no encontrado", "not_found")

  const [sections, lessons, level] = await Promise.all([
    sql`SELECT id, course_id, title, position FROM academy_sections WHERE course_id = ${row.id} ORDER BY position, id`,
    sql`
      SELECT l.id, l.section_id, l.slug, l.title, l.duration_sec, l.published,
             (p.completed_at IS NOT NULL) AS completed
      FROM academy_lessons l
      LEFT JOIN academy_sections s ON s.id = l.section_id
      LEFT JOIN academy_lesson_progress p ON p.lesson_id = l.id AND p.member_id = ${member.id}
      WHERE l.course_id = ${row.id} AND (${staff}::boolean OR l.published)
      ORDER BY (l.section_id IS NOT NULL), s.position, s.id, l.position, l.id
    `,
    needsLevel(member, row, row.owned) ? levelOf(sql, member) : Promise.resolve(1),
  ])

  const access = decideAccess(member, row, { owned: row.owned, level })
  // Solo títulos, duración y estado: nada de video ni texto, esté o no
  // bloqueado. El contenido sale únicamente por `lesson`.
  const mapLesson = (l) => ({
    id: l.id,
    slug: l.slug,
    title: l.title,
    durationSec: l.duration_sec ?? null,
    completed: Boolean(l.completed),
    published: Boolean(l.published),
  })
  const grouped = groupLessons(sections, lessons, { staff, mapLesson })
  return { course: courseCard(row, lessons, access), sections: grouped.sections, unsectioned: grouped.unsectioned }
}

/* 403 'locked' con el motivo en `extra` (el router lo mezcla en la
   respuesta): el front decide entre "Comprar" y "Se desbloquea en Nivel N"
   sin tener que pedir el curso de nuevo. Nunca lleva contenido. */
function lockedError(course, access) {
  if (access.reason === "nivel") {
    const need = Number(course.unlock_level) || 2
    return new HttpError(403, `Esta lección se desbloquea en el Nivel ${need}`, "locked", { lockReason: "nivel", unlockLevel: need })
  }
  return new HttpError(403, "Esta lección es parte de un curso que todavía no tienes", "locked", { lockReason: "compra", unlockLevel: null })
}

async function getLesson(ctx) {
  const { sql, member, query } = ctx
  const staff = isCourseStaff(member)
  const course = await getCourseRow(sql, member, query.course)
  if (!course) throw new HttpError(404, "Curso no encontrado", "not_found")

  const level = needsLevel(member, course, course.owned) ? await levelOf(sql, member) : 1
  const access = decideAccess(member, course, { owned: course.owned, level })
  // Se decide ANTES de leer el cuerpo de la lección: si no hay acceso, el
  // video y el texto ni siquiera se consultan.
  if (!access.ok) throw lockedError(course, access)

  const lessonSlug = typeof query.lesson === "string" && query.lesson.length <= 60 && SLUG_RE.test(query.lesson) ? query.lesson : null
  if (!lessonSlug) throw new HttpError(404, "Lección no encontrada", "not_found")

  const [list, [lesson]] = await Promise.all([
    sql`
      SELECT l.id, l.slug, l.title
      FROM academy_lessons l
      LEFT JOIN academy_sections s ON s.id = l.section_id
      WHERE l.course_id = ${course.id} AND (${staff}::boolean OR l.published)
      ORDER BY (l.section_id IS NOT NULL), s.position, s.id, l.position, l.id
    `,
    sql`
      SELECT l.id, l.slug, l.title, l.body, l.resources, l.video_provider, l.video_id, l.duration_sec, l.published,
             s.title AS section_title,
             COALESCE(p.position_sec, 0) AS position_sec,
             (p.completed_at IS NOT NULL) AS completed
      FROM academy_lessons l
      LEFT JOIN academy_sections s ON s.id = l.section_id
      LEFT JOIN academy_lesson_progress p ON p.lesson_id = l.id AND p.member_id = ${member.id}
      WHERE l.course_id = ${course.id} AND l.slug = ${lessonSlug}
    `,
  ])
  if (!lesson || (!lesson.published && !staff)) throw new HttpError(404, "Lección no encontrada", "not_found")

  const idx = list.findIndex((l) => l.id === lesson.id)
  const prev = idx > 0 ? list[idx - 1] : null
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null
  return {
    course: { slug: course.slug, title: course.title },
    lesson: {
      id: lesson.id,
      slug: lesson.slug,
      title: lesson.title,
      body: lesson.body || "",
      resources: resourcesOut(lesson.resources),
      videoProvider: lesson.video_provider || "youtube",
      videoId: videoIdOrNull(lesson.video_id),
      durationSec: lesson.duration_sec ?? null,
      positionSec: Number(lesson.position_sec) || 0,
      completed: Boolean(lesson.completed),
      sectionTitle: lesson.section_title || null,
      published: Boolean(lesson.published),
    },
    prev: prev ? { slug: prev.slug, title: prev.title } : null,
    next: next ? { slug: next.slug, title: next.title } : null,
  }
}

/* Ruta caliente (el reproductor la llama sola): sin ensure*, y una sola
   sentencia para escribir + leer el estado final + el avance del curso. */
async function saveProgress(ctx) {
  const { sql, member, body } = ctx
  const lessonId = toId(body.lessonId)
  if (!lessonId) throw new HttpError(400, "Falta la lección")
  const hasPos = body.positionSec !== undefined && body.positionSec !== null
  const hasCompleted = typeof body.completed === "boolean"
  if (!hasPos && !hasCompleted) throw new HttpError(400, "No hay nada que guardar")
  let pos = 0
  if (hasPos) {
    const n = Number(body.positionSec)
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, "Posición inválida")
    pos = Math.min(86400, Math.floor(n))
  }

  const row = await lessonAccessRow(sql, member, lessonId)
  const access = await decideLesson(sql, member, row)
  if (!access.ok) {
    if (access.reason === "no_existe" || access.reason === "borrador") throw new HttpError(404, "Lección no encontrada", "not_found")
    throw new HttpError(403, "No tienes acceso a esta lección", "locked", { lockReason: access.reason })
  }
  // El reproductor a veces reporta un segundo más que la duración declarada.
  if (row.duration_sec) pos = Math.min(pos, Number(row.duration_sec))
  const staff = isCourseStaff(member)
  const completedVal = hasCompleted ? body.completed : false

  /* Un solo statement:
     - upsert sobre la PK (member_id, lesson_id), nunca sobre un índice parcial;
     - si es solo posición y la fila se tocó hace < 20 s, el DO UPDATE ... WHERE
       no escribe nada (y `up` queda vacío). El reproductor guarda cada 60 s,
       al pausar y al ocultar la pestaña: sin este piso, pausar y reanudar
       diez veces seguidas son diez UPDATE que mantienen despierto a Neon;
     - `completed` siempre se aplica: marcar/desmarcar no puede perderse por el
       throttle. completed_at conserva la fecha original si ya estaba completa;
     - el avance del curso se cuenta sin esta lección (la foto del statement no
       ve su propio upsert) y se suma en JS con el estado final. */
  const [out] = await sql`
    WITH up AS (
      INSERT INTO academy_lesson_progress (member_id, lesson_id, position_sec, completed_at, updated_at)
      VALUES (${member.id}, ${lessonId}, ${pos}, CASE WHEN ${completedVal}::boolean THEN NOW() ELSE NULL END, NOW())
      ON CONFLICT (member_id, lesson_id) DO UPDATE SET
        position_sec = CASE WHEN ${hasPos}::boolean THEN EXCLUDED.position_sec ELSE academy_lesson_progress.position_sec END,
        completed_at = CASE
          WHEN NOT ${hasCompleted}::boolean THEN academy_lesson_progress.completed_at
          WHEN ${completedVal}::boolean THEN COALESCE(academy_lesson_progress.completed_at, NOW())
          ELSE NULL
        END,
        updated_at = NOW()
      WHERE ${hasCompleted}::boolean
         OR academy_lesson_progress.updated_at < NOW() - interval '20 seconds'
      RETURNING position_sec, completed_at
    ), prev AS (
      SELECT position_sec, completed_at FROM academy_lesson_progress
      WHERE member_id = ${member.id} AND lesson_id = ${lessonId}
    )
    SELECT
      CASE WHEN EXISTS (SELECT 1 FROM up) THEN (SELECT position_sec FROM up) ELSE (SELECT position_sec FROM prev) END AS position_sec,
      CASE WHEN EXISTS (SELECT 1 FROM up) THEN (SELECT completed_at IS NOT NULL FROM up) ELSE (SELECT completed_at IS NOT NULL FROM prev) END AS completed,
      (SELECT count(*) FROM academy_lessons l
        WHERE l.course_id = ${row.course_id} AND (${staff}::boolean OR l.published))::int AS total,
      (SELECT count(*) FROM academy_lessons l
        JOIN academy_lesson_progress p ON p.lesson_id = l.id AND p.member_id = ${member.id}
        WHERE l.course_id = ${row.course_id} AND l.id <> ${lessonId}
          AND (${staff}::boolean OR l.published) AND p.completed_at IS NOT NULL)::int AS done_others
  `
  const completed = Boolean(out?.completed)
  const done = (out?.done_others || 0) + (completed ? 1 : 0)
  return {
    completed,
    positionSec: Number(out?.position_sec) || 0,
    courseProgress: pct(done, out?.total || 0),
  }
}

/* ── Catálogo público ───────────────────────────────────────────────────── */

/* Público y cacheado en el borde 5 min: la vitrina /academy no debe despertar
   Neon por cada visita. Si la base falla (o las tablas todavía no existen,
   42P01), se responde el respaldo vacío y la página sigue con los datos
   estáticos de src/data/courses.js, con todos los precios en null = no se
   vende (SPEC §0.4). Ese respaldo se cachea menos, para que al volver la
   base el catálogo real aparezca rápido. */
async function getCatalog(ctx) {
  const { sql } = ctx
  try {
    const [courses, cohorts] = await Promise.all([
      // Un curso sin catalog_id y sin publicar es un borrador de verdad (uno
      // nuevo que se está armando) y no sale. Los que vienen del catálogo
      // estático ya son públicos por definición, así que salen con su precio
      // aunque el contenido siga en borrador.
      sql`
        SELECT c.catalog_id, c.slug, c.title, c.subtitle, c.cover_url, c.price_online, c.price_presencial,
               c.sales_open, c.published,
               (SELECT count(*) FROM academy_lessons l WHERE l.course_id = c.id AND l.published)::int AS lesson_count
        FROM academy_courses c
        WHERE c.published OR c.catalog_id IS NOT NULL
        ORDER BY c.position, c.id
      `,
      /* Cupos: miembros normales activos ya dentro del grupo + pedidos
         pendientes de menos de 30 min (alguien que está pagando en este
         momento). El staff no ocupa cupo, y un reembolsado queda 'cancelado'. */
      sql`
        SELECT h.id, c.slug AS course_slug, h.name, to_char(h.starts_on, 'YYYY-MM-DD') AS starts_on,
               h.seats, h.sales_open,
               CASE WHEN h.seats IS NULL THEN NULL ELSE GREATEST(0,
                 h.seats
                 - (SELECT count(*) FROM academy_cohort_members cm
                     JOIN academy_members m ON m.id = cm.member_id
                    WHERE cm.cohort_id = h.id AND m.role = 'miembro' AND m.status = 'activo')
                 - (SELECT count(*) FROM academy_orders o
                    WHERE o.cohort_id = h.id AND o.status = 'pendiente'
                      AND o.created_at > NOW() - interval '30 minutes')
               ) END::int AS seats_left
        FROM academy_cohorts h
        JOIN academy_courses c ON c.id = h.course_id
        WHERE h.archived_at IS NULL AND h.sales_open AND c.published
          AND (h.starts_on IS NULL OR h.starts_on >= (NOW() AT TIME ZONE 'America/Santiago')::date)
        ORDER BY h.starts_on NULLS LAST, h.id
      `,
    ])
    return {
      __cache: "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
      courses: courses.map((c) => ({
        catalogId: c.catalog_id || null,
        slug: c.slug,
        title: c.title,
        subtitle: c.subtitle || null,
        coverUrl: imageUrlOrNull(c.cover_url),
        // Precio de un curso no publicado = no se vende todavía. El checkout
        // lo rechazaría igual; mejor que la vitrina diga "Por definir".
        priceOnline: c.published ? c.price_online ?? null : null,
        pricePresencial: c.published ? c.price_presencial ?? null : null,
        salesOpen: Boolean(c.sales_open && c.published && (c.price_online != null || c.price_presencial != null)),
        published: Boolean(c.published),
        lessonCount: c.lesson_count || 0,
      })),
      cohorts: cohorts.map((h) => ({
        id: h.id,
        courseSlug: h.course_slug,
        name: h.name,
        startsOn: h.starts_on || null,
        seats: h.seats ?? null,
        seatsLeft: h.seats_left ?? null,
        salesOpen: Boolean(h.sales_open),
      })),
      checkoutEnabled: mpConfigured(),
    }
  } catch (err) {
    console.error("[academy:catalog] respaldo:", pgCode(err) || err?.message || err)
    return {
      __cache: "public, max-age=0, s-maxage=60, stale-while-revalidate=120",
      courses: [],
      cohorts: [],
      checkoutEnabled: false,
      fallback: true,
    }
  }
}

/* ── Handlers: admin ────────────────────────────────────────────────────── */

async function adminCourses(ctx) {
  const { sql } = ctx
  const [courses, sections, lessons] = await Promise.all([
    sql`
      SELECT c.id, c.slug, c.catalog_id, c.title, c.subtitle, c.description, c.cover_url, c.position, c.published,
             c.access, c.unlock_level, c.price_online, c.price_presencial, c.sales_open,
             to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
             to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at,
             (SELECT count(*) FROM academy_grants g WHERE g.course_id = c.id AND g.state = 'activa')::int AS owners,
             (SELECT count(*) FROM academy_orders o WHERE o.course_id = c.id)::int AS orders
      FROM academy_courses c
      ORDER BY c.position, c.id
    `,
    sql`SELECT id, course_id, title, position FROM academy_sections ORDER BY course_id, position, id`,
    sql`
      SELECT l.id, l.course_id, l.section_id, l.slug, l.title, l.position, l.video_provider, l.video_id,
             l.duration_sec, l.body, l.resources, l.published,
             to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
             to_char(l.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
      FROM academy_lessons l
      LEFT JOIN academy_sections s ON s.id = l.section_id
      ORDER BY l.course_id, (l.section_id IS NOT NULL), s.position, s.id, l.position, l.id
    `,
  ])
  const sectionsByCourse = new Map()
  for (const s of sections) {
    if (!sectionsByCourse.has(s.course_id)) sectionsByCourse.set(s.course_id, [])
    sectionsByCourse.get(s.course_id).push(s)
  }
  const lessonsByCourse = new Map()
  for (const l of lessons) {
    if (!lessonsByCourse.has(l.course_id)) lessonsByCourse.set(l.course_id, [])
    lessonsByCourse.get(l.course_id).push(l)
  }
  return {
    courses: courses.map((c) => {
      const secs = sectionsByCourse.get(c.id) || []
      const les = lessonsByCourse.get(c.id) || []
      const grouped = groupLessons(secs, les, { staff: true, mapLesson: lessonAdmin })
      return {
        ...courseAdmin(c),
        owners: c.owners || 0,
        orders: c.orders || 0,
        lessonCount: les.length,
        publishedLessonCount: les.filter((l) => l.published).length,
        sections: grouped.sections.map((s) => ({ ...s, courseId: c.id, position: secs.find((x) => x.id === s.id)?.position ?? 0 })),
        unsectioned: grouped.unsectioned,
      }
    }),
  }
}

async function adminCourseSave(ctx) {
  const { sql, body: b } = ctx
  const id = b.id != null && b.id !== "" ? toId(b.id) : null
  if (b.id != null && b.id !== "" && !id) throw new HttpError(400, "Curso inválido")

  let current = null
  if (id) {
    const found = await sql`
      SELECT id, slug, access, unlock_level, price_online, price_presencial, sales_open, published
      FROM academy_courses WHERE id = ${id}
    `
    current = found[0] || null
    if (!current) throw new HttpError(404, "Curso no encontrado", "not_found")
  }
  const creating = !current
  const touch = (k) => creating || has(b, k)

  const v = {}
  if (touch("title")) {
    v.title = line(b.title, 120)
    if (!v.title) throw new HttpError(400, "El curso necesita un título")
  }
  // El slug es la URL del curso: al editar el título NO se regenera solo, para
  // no romper los enlaces que ya circulan por WhatsApp.
  if (creating || has(b, "slug")) {
    v.slug = slugify(String(b.slug || (creating ? b.title : "") || ""))
    if (!v.slug || v.slug.length < 2 || !SLUG_RE.test(v.slug)) throw new HttpError(400, "El enlace del curso no es válido")
  }
  if (touch("subtitle")) v.subtitle = line(b.subtitle, 200) || null
  if (touch("description")) v.description = text(b.description, 5000) || null
  if (touch("coverUrl")) {
    v.coverUrl = imageUrlOrNull(b.coverUrl)
    if (b.coverUrl && !v.coverUrl) throw new HttpError(400, "La portada tiene que ser una imagen subida a la Academy")
  }
  if (touch("position")) v.position = intIn(b.position, 0, 100000, "La posición")
  if (touch("published")) v.published = b.published === true
  if (touch("catalogId")) {
    const cid = b.catalogId == null ? "" : String(b.catalogId).trim()
    if (cid && !CATALOG_ID_RE.test(cid)) throw new HttpError(400, "El id de catálogo no es válido")
    v.catalogId = cid || null
  }

  // access y unlock_level se validan juntos (uno sin el otro no significa
  // nada), así que si se toca cualquiera de los dos se escriben ambos.
  const tAccess = touch("access") || touch("unlockLevel")
  if (tAccess) {
    const access = has(b, "access") || creating ? String(b.access || "compra") : current.access
    if (!ACCESS_TYPES.includes(access)) throw new HttpError(400, "Tipo de acceso inválido")
    let unlock = has(b, "unlockLevel") ? b.unlockLevel : current?.unlock_level
    if (access === "nivel") {
      const n = Number(unlock)
      if (!Number.isInteger(n) || n < 2 || n > 9) throw new HttpError(400, "Elige un nivel entre 2 y 9 para desbloquear el curso")
      unlock = n
    } else {
      unlock = null
    }
    v.access = access
    v.unlockLevel = unlock
  }

  // Lo mismo con venta abierta y precios: abrir la venta sin ningún precio
  // dejaría un botón "Comprar" que el checkout rechaza siempre.
  const tSale = touch("salesOpen") || touch("priceOnline") || touch("pricePresencial")
  if (tSale) {
    const priceOnline = has(b, "priceOnline") || creating ? priceIn(b.priceOnline) : current.price_online
    const pricePresencial = has(b, "pricePresencial") || creating ? priceIn(b.pricePresencial) : current.price_presencial
    const salesOpen = has(b, "salesOpen") || creating ? b.salesOpen === true : Boolean(current.sales_open)
    if (salesOpen && priceOnline == null && pricePresencial == null) {
      throw new HttpError(400, "Para abrir la venta define al menos un precio")
    }
    v.priceOnline = priceOnline
    v.pricePresencial = pricePresencial
    v.salesOpen = salesOpen
  }

  let row
  try {
    if (creating) {
      const rows = await sql`
        INSERT INTO academy_courses
          (slug, catalog_id, title, subtitle, description, cover_url, position, published,
           access, unlock_level, price_online, price_presencial, sales_open)
        VALUES (
          ${v.slug}, ${v.catalogId}, ${v.title}, ${v.subtitle}, ${v.description}, ${v.coverUrl},
          COALESCE(${v.position}::int, (SELECT COALESCE(MAX(position), -1) + 1 FROM academy_courses)),
          ${v.published}, ${v.access}, ${v.unlockLevel}::int, ${v.priceOnline}::int, ${v.pricePresencial}::int, ${v.salesOpen}
        )
        RETURNING id, slug, catalog_id, title, subtitle, description, cover_url, position, published, access,
                  unlock_level, price_online, price_presencial, sales_open,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
      `
      row = rows[0]
    } else {
      const rows = await sql`
        UPDATE academy_courses SET
          slug = CASE WHEN ${has(v, "slug")}::boolean THEN ${v.slug ?? null}::text ELSE slug END,
          catalog_id = CASE WHEN ${has(v, "catalogId")}::boolean THEN ${v.catalogId ?? null}::text ELSE catalog_id END,
          title = CASE WHEN ${has(v, "title")}::boolean THEN ${v.title ?? null}::text ELSE title END,
          subtitle = CASE WHEN ${has(v, "subtitle")}::boolean THEN ${v.subtitle ?? null}::text ELSE subtitle END,
          description = CASE WHEN ${has(v, "description")}::boolean THEN ${v.description ?? null}::text ELSE description END,
          cover_url = CASE WHEN ${has(v, "coverUrl")}::boolean THEN ${v.coverUrl ?? null}::text ELSE cover_url END,
          position = CASE WHEN ${v.position != null}::boolean THEN ${v.position ?? null}::int ELSE position END,
          published = CASE WHEN ${has(v, "published")}::boolean THEN ${v.published ?? false}::boolean ELSE published END,
          access = CASE WHEN ${tAccess}::boolean THEN ${v.access ?? null}::text ELSE access END,
          unlock_level = CASE WHEN ${tAccess}::boolean THEN ${v.unlockLevel ?? null}::int ELSE unlock_level END,
          price_online = CASE WHEN ${tSale}::boolean THEN ${v.priceOnline ?? null}::int ELSE price_online END,
          price_presencial = CASE WHEN ${tSale}::boolean THEN ${v.pricePresencial ?? null}::int ELSE price_presencial END,
          sales_open = CASE WHEN ${tSale}::boolean THEN ${v.salesOpen ?? false}::boolean ELSE sales_open END,
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, slug, catalog_id, title, subtitle, description, cover_url, position, published, access,
                  unlock_level, price_online, price_presencial, sales_open,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
      `
      row = rows[0]
    }
  } catch (err) {
    if (pgCode(err) === "23505") throw new HttpError(409, "Ya existe un curso con ese enlace", "slug_taken")
    if (pgCode(err) === "23514") throw new HttpError(400, "Algún valor del curso está fuera de rango")
    throw err
  }
  if (!row) throw new HttpError(404, "Curso no encontrado", "not_found")
  return { course: courseAdmin(row) }
}

/* Borrar un curso con historia la destruiría: academy_grants cae en cascada
   (alumnos que pagaron pierden el acceso) y academy_orders no tiene ON DELETE
   (el DELETE fallaría igual). Con pedidos O grants se archiva: se despublica
   y se cierra la venta, y los que ya lo tienen lo siguen viendo desde el
   panel si el dueño lo vuelve a publicar. Todo en una sentencia para que no
   haya carrera entre la revisión y el borrado. */
async function adminCourseDelete(ctx) {
  const { sql, body } = ctx
  const id = toId(body.id)
  if (!id) throw new HttpError(400, "Curso inválido")
  let out
  try {
    const rows = await sql`
      WITH k AS (
        SELECT (EXISTS (SELECT 1 FROM academy_orders WHERE course_id = ${id})
             OR EXISTS (SELECT 1 FROM academy_grants WHERE course_id = ${id})) AS keep
      ), arch AS (
        UPDATE academy_courses SET published = false, sales_open = false, updated_at = NOW()
        WHERE id = ${id} AND (SELECT keep FROM k)
        RETURNING id
      ), del AS (
        DELETE FROM academy_courses
        WHERE id = ${id} AND NOT (SELECT keep FROM k)
        RETURNING id
      )
      SELECT (SELECT count(*) FROM arch)::int AS archived, (SELECT count(*) FROM del)::int AS deleted
    `
    out = rows[0]
  } catch (err) {
    // 23503: entró un pedido entre la revisión y el DELETE. Se archiva.
    if (pgCode(err) !== "23503") throw err
    const [a] = await sql`
      UPDATE academy_courses SET published = false, sales_open = false, updated_at = NOW()
      WHERE id = ${id} RETURNING id
    `
    out = { archived: a ? 1 : 0, deleted: 0 }
  }
  if (!out?.archived && !out?.deleted) throw new HttpError(404, "Curso no encontrado", "not_found")
  return { deleted: out.deleted > 0, archived: out.archived > 0 }
}

async function adminSectionSave(ctx) {
  const { sql, body: b } = ctx
  const id = b.id != null && b.id !== "" ? toId(b.id) : null
  if (b.id != null && b.id !== "" && !id) throw new HttpError(400, "Sección inválida")
  const tTitle = !id || has(b, "title")
  const title = tTitle ? line(b.title, 120) : null
  if (tTitle && !title) throw new HttpError(400, "La sección necesita un título")
  const pos = has(b, "position") ? intIn(b.position, 0, 100000, "La posición") : null

  if (!id) {
    const courseId = toId(b.courseId)
    if (!courseId) throw new HttpError(400, "Falta el curso")
    const [row] = await sql`
      INSERT INTO academy_sections (course_id, title, position)
      SELECT c.id, ${title},
             COALESCE(${pos}::int, (SELECT COALESCE(MAX(position), -1) + 1 FROM academy_sections WHERE course_id = c.id))
      FROM academy_courses c WHERE c.id = ${courseId}
      RETURNING id, course_id, title, position
    `
    if (!row) throw new HttpError(404, "Curso no encontrado", "not_found")
    return { section: sectionOut(row) }
  }

  const [row] = await sql`
    UPDATE academy_sections SET
      title = CASE WHEN ${tTitle}::boolean THEN ${title}::text ELSE title END,
      position = CASE WHEN ${pos != null}::boolean THEN ${pos}::int ELSE position END
    WHERE id = ${id}
    RETURNING id, course_id, title, position
  `
  if (!row) throw new HttpError(404, "Sección no encontrada", "not_found")
  return { section: sectionOut(row) }
}

/* Borrar una sección NO borra sus lecciones: el FK es ON DELETE SET NULL y
   quedan sueltas en el curso. Borrar videos grabados por error de un clic en
   el encabezado equivocado sería mucho peor que tener que moverlos. */
async function adminSectionDelete(ctx) {
  const { sql, body } = ctx
  const id = toId(body.id)
  if (!id) throw new HttpError(400, "Sección inválida")
  const [row] = await sql`DELETE FROM academy_sections WHERE id = ${id} RETURNING id`
  if (!row) throw new HttpError(404, "Sección no encontrada", "not_found")
  return {}
}

// Primer slug libre dentro del curso: base, base-2, base-3… El LIKE es seguro
// porque un slug solo tiene [a-z0-9-] (ni % ni _).
async function freeLessonSlug(sql, courseId, base) {
  const rows = await sql`
    SELECT slug FROM academy_lessons
    WHERE course_id = ${courseId} AND (slug = ${base} OR slug LIKE ${base + "-%"})
  `
  const taken = new Set(rows.map((r) => r.slug))
  if (!taken.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const cand = `${base.slice(0, 40 - String(n).length - 1)}-${n}`
    if (!taken.has(cand)) return cand
  }
  throw new HttpError(409, "No se pudo generar un enlace para la lección")
}

async function adminLessonSave(ctx) {
  const { sql, body: b } = ctx
  const id = b.id != null && b.id !== "" ? toId(b.id) : null
  if (b.id != null && b.id !== "" && !id) throw new HttpError(400, "Lección inválida")

  let current = null
  if (id) {
    const found = await sql`
      SELECT id, course_id, section_id, video_id, body, published FROM academy_lessons WHERE id = ${id}
    `
    current = found[0] || null
    if (!current) throw new HttpError(404, "Lección no encontrada", "not_found")
  }
  const creating = !current
  const touch = (k) => creating || has(b, k)
  // Una lección no se muda de curso: su progreso y comentarios son de ese curso.
  const courseId = current ? current.course_id : toId(b.courseId)
  if (!courseId) throw new HttpError(400, "Falta el curso")

  const tSection = touch("sectionId")
  const sectionId = tSection && b.sectionId != null && b.sectionId !== "" ? toId(b.sectionId) : null
  if (tSection && b.sectionId != null && b.sectionId !== "" && !sectionId) throw new HttpError(400, "Sección inválida")

  const [check] = await sql`
    SELECT c.id,
           (SELECT s.id FROM academy_sections s WHERE s.id = ${sectionId}::int AND s.course_id = c.id) AS section_ok
    FROM academy_courses c WHERE c.id = ${courseId}
  `
  if (!check) throw new HttpError(404, "Curso no encontrado", "not_found")
  if (sectionId && !check.section_ok) throw new HttpError(400, "La sección no pertenece a este curso")

  const tTitle = touch("title")
  const title = tTitle ? line(b.title, 160) : null
  if (tTitle && !title) throw new HttpError(400, "La lección necesita un título")

  // `video` acepta la URL pegada tal cual (youtu.be, watch?v=, shorts, embed)
  // o el id; `videoId` se acepta como alias por si el editor manda el id ya
  // parseado. Vacío = sin video (lección de solo texto).
  const tVideo = creating || has(b, "video") || has(b, "videoId")
  let videoId = current?.video_id ?? null
  if (tVideo) {
    const raw = has(b, "video") ? b.video : b.videoId
    if (raw == null || String(raw).trim() === "") videoId = null
    else {
      videoId = parseYouTubeId(String(raw).trim())
      if (!videoId || !YT_ID.test(videoId)) throw new HttpError(400, "El enlace de YouTube no es válido")
    }
  }

  const tBody = touch("body")
  const lessonBody = tBody ? text(b.body, 20000) : current?.body || ""
  const tResources = touch("resources")
  const resources = tResources ? resourcesIn(b.resources) : null
  const tDuration = touch("durationSec")
  const durationSec = tDuration ? intIn(b.durationSec, 0, 86400, "La duración") : null
  const tPublished = touch("published")
  const published = tPublished ? b.published === true : Boolean(current?.published)
  if (published && !videoId && !String(lessonBody || "").trim()) {
    throw new HttpError(400, "Para publicar la lección agrega un video o un texto")
  }
  const pos = has(b, "position") ? intIn(b.position, 0, 100000, "La posición") : null

  let slug = null
  const tSlug = creating || (has(b, "slug") && b.slug != null && String(b.slug).trim() !== "")
  if (tSlug) {
    if (has(b, "slug") && b.slug != null && String(b.slug).trim() !== "") {
      slug = slugify(String(b.slug))
      if (!slug || !SLUG_RE.test(slug)) throw new HttpError(400, "El enlace de la lección no es válido")
    } else {
      slug = await freeLessonSlug(sql, courseId, slugify(title || "") || "leccion")
    }
  }

  const lessonDbError = (err) => {
    if (pgCode(err) === "23505") return new HttpError(409, "Ya existe una lección con ese enlace en este curso", "slug_taken")
    if (pgCode(err) === "23514") return new HttpError(400, "Algún valor de la lección está fuera de rango")
    return err
  }

  let row
  try {
    if (creating) {
      const rows = await sql`
        INSERT INTO academy_lessons
          (course_id, section_id, slug, title, position, video_provider, video_id, duration_sec, body, resources, published)
        VALUES (
          ${courseId}, ${sectionId}::int, ${slug}, ${title},
          COALESCE(${pos}::int, (SELECT COALESCE(MAX(position), -1) + 1 FROM academy_lessons
                                  WHERE course_id = ${courseId} AND section_id IS NOT DISTINCT FROM ${sectionId}::int)),
          'youtube', ${videoId}, ${durationSec}::int, ${lessonBody}, ${JSON.stringify(resources || [])}::jsonb, ${published}
        )
        RETURNING id, course_id, section_id, slug, title, position, video_provider, video_id, duration_sec, body,
                  resources, published,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
      `
      row = rows[0]
    } else {
      const rows = await sql`
        UPDATE academy_lessons SET
          section_id = CASE WHEN ${tSection}::boolean THEN ${sectionId}::int ELSE section_id END,
          slug = CASE WHEN ${tSlug}::boolean THEN ${slug}::text ELSE slug END,
          title = CASE WHEN ${tTitle}::boolean THEN ${title}::text ELSE title END,
          position = CASE WHEN ${pos != null}::boolean THEN ${pos}::int ELSE position END,
          video_id = CASE WHEN ${tVideo}::boolean THEN ${videoId}::text ELSE video_id END,
          duration_sec = CASE WHEN ${tDuration}::boolean THEN ${durationSec}::int ELSE duration_sec END,
          body = CASE WHEN ${tBody}::boolean THEN ${lessonBody}::text ELSE body END,
          resources = CASE WHEN ${tResources}::boolean THEN ${JSON.stringify(resources || [])}::jsonb ELSE resources END,
          published = CASE WHEN ${tPublished}::boolean THEN ${published}::boolean ELSE published END,
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, course_id, section_id, slug, title, position, video_provider, video_id, duration_sec, body,
                  resources, published,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
                  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
      `
      row = rows[0]
    }
  } catch (err) {
    throw lessonDbError(err)
  }
  if (!row) throw new HttpError(404, "Lección no encontrada", "not_found")
  return { lesson: lessonAdmin(row) }
}

/* Borra la lección y, en cascada, su progreso y sus comentarios. Para
   esconderla sin perder nada está `published: false`. */
async function adminLessonDelete(ctx) {
  const { sql, body } = ctx
  const id = toId(body.id)
  if (!id) throw new HttpError(400, "Lección inválida")
  const [row] = await sql`DELETE FROM academy_lessons WHERE id = ${id} RETURNING id`
  if (!row) throw new HttpError(404, "Lección no encontrada", "not_found")
  return {}
}

/* position = índice en la lista, en una sola sentencia con unnest ... WITH
   ORDINALITY (ORDINALITY parte en 1). Tres ramas escritas a mano porque el
   nombre de tabla no puede ser parámetro. */
async function adminReorder(ctx) {
  const { sql, body } = ctx
  const type = String(body.type || "")
  if (!REORDER_TYPES.includes(type)) throw new HttpError(400, "Tipo de orden inválido")
  const raw = Array.isArray(body.ids) ? body.ids : []
  const ids = raw.map(toId)
  if (!ids.length || ids.length > 500 || ids.some((x) => !x) || new Set(ids).size !== ids.length) {
    throw new HttpError(400, "Lista de ids inválida")
  }
  if (type === "course") {
    await sql`
      UPDATE academy_courses c SET position = (x.ord - 1)::int, updated_at = NOW()
      FROM unnest(${ids}::int[]) WITH ORDINALITY AS x(id, ord)
      WHERE c.id = x.id
    `
  } else if (type === "section") {
    await sql`
      UPDATE academy_sections s SET position = (x.ord - 1)::int
      FROM unnest(${ids}::int[]) WITH ORDINALITY AS x(id, ord)
      WHERE s.id = x.id
    `
  } else {
    await sql`
      UPDATE academy_lessons l SET position = (x.ord - 1)::int, updated_at = NOW()
      FROM unnest(${ids}::int[]) WITH ORDINALITY AS x(id, ord)
      WHERE l.id = x.id
    `
  }
  return {}
}

/* Carga inicial de cursos (el panel arma el payload desde src/data/courses.js
   + Método Brunetti). Idempotente por slug: un curso que ya existe se salta
   ENTERO, sin tocar sus secciones ni lecciones, para que apretar el botón dos
   veces —o después de haber editado a mano— no duplique ni pise nada. También
   se salta si ya hay un curso con el mismo catalog_id (alguien le cambió el
   slug). Cada curso nuevo va en UNA sentencia CTE (curso → secciones →
   lecciones), porque las secciones dependen del id recién creado. */
async function adminSeed(ctx) {
  const { sql, body } = ctx
  const input = Array.isArray(body.courses) ? body.courses : []
  if (input.length > 30) throw new HttpError(400, "Máximo 30 cursos por carga")

  const prepared = []
  const seenSlugs = new Set()
  let lessonTotal = 0
  input.forEach((c, i) => {
    const title = line(c?.title, 120)
    const slug = slugify(String(c?.slug || c?.title || ""))
    if (!title || !slug || !SLUG_RE.test(slug)) throw new HttpError(400, `El curso ${i + 1} necesita título y enlace`)
    if (seenSlugs.has(slug)) return
    seenSlugs.add(slug)
    const catalogId = c?.catalogId ? String(c.catalogId).trim() : null
    if (catalogId && !CATALOG_ID_RE.test(catalogId)) throw new HttpError(400, `El id de catálogo del curso ${i + 1} no es válido`)
    const access = ACCESS_TYPES.includes(c?.access) ? c.access : "compra"
    let unlockLevel = null
    if (access === "nivel") {
      unlockLevel = Number(c?.unlockLevel)
      if (!Number.isInteger(unlockLevel) || unlockLevel < 2 || unlockLevel > 9) unlockLevel = 2
    }
    const sectionsIn = Array.isArray(c?.sections) ? c.sections : []
    if (sectionsIn.length > 40) throw new HttpError(400, `El curso ${i + 1} tiene demasiadas secciones`)
    const sections = []
    const lessons = []
    const usedLessonSlugs = new Set()
    sectionsIn.forEach((s, si) => {
      const stitle = line(s?.title, 120) || `Sección ${si + 1}`
      const pos = sections.length
      sections.push({ title: stitle, pos })
      const ls = Array.isArray(s?.lessons) ? s.lessons : []
      if (ls.length > 60) throw new HttpError(400, `La sección ${si + 1} del curso ${i + 1} tiene demasiadas lecciones`)
      let lpos = 0
      for (const l of ls) {
        const ltitle = line(l?.title, 160)
        if (!ltitle) continue
        let base = slugify(ltitle) || "leccion"
        let lslug = base
        for (let n = 2; usedLessonSlugs.has(lslug); n++) lslug = `${base.slice(0, 40 - String(n).length - 1)}-${n}`
        usedLessonSlugs.add(lslug)
        lessons.push({ spos: pos, slug: lslug, title: ltitle, pos: lpos++, body: text(l?.body, 20000) || null })
      }
    })
    lessonTotal += lessons.length
    prepared.push({
      slug,
      catalogId,
      title,
      subtitle: line(c?.subtitle, 200) || null,
      description: text(c?.description, 5000) || null,
      coverUrl: imageUrlOrNull(c?.coverUrl),
      access,
      unlockLevel,
      priceOnline: priceIn(c?.priceOnline),
      pricePresencial: priceIn(c?.pricePresencial),
      sections,
      lessons,
    })
  })
  if (lessonTotal > 2000) throw new HttpError(400, "Demasiadas lecciones en una sola carga")

  const created = { courses: 0, sections: 0, lessons: 0, categories: 0 }
  const skipped = []

  if (prepared.length) {
    const slugs = prepared.map((p) => p.slug)
    const catalogIds = prepared.map((p) => p.catalogId).filter(Boolean)
    const existing = await sql`
      SELECT slug, catalog_id FROM academy_courses
      WHERE slug = ANY(${slugs}::text[]) OR catalog_id = ANY(${catalogIds}::text[])
    `
    const takenSlugs = new Set(existing.map((r) => r.slug))
    const takenCatalog = new Set(existing.map((r) => r.catalog_id).filter(Boolean))

    // Secuencial a propósito: son ~10 cursos y cada uno calcula su posición
    // con MAX(position) + 1, que en paralelo daría posiciones repetidas.
    for (const p of prepared) {
      if (takenSlugs.has(p.slug) || (p.catalogId && takenCatalog.has(p.catalogId))) {
        skipped.push(p.slug)
        continue
      }
      const [r] = await sql`
        WITH c AS (
          INSERT INTO academy_courses
            (slug, catalog_id, title, subtitle, description, cover_url, position, published,
             access, unlock_level, price_online, price_presencial, sales_open)
          VALUES (
            ${p.slug}, ${p.catalogId}, ${p.title}, ${p.subtitle}, ${p.description}, ${p.coverUrl},
            (SELECT COALESCE(MAX(position), -1) + 1 FROM academy_courses), false,
            ${p.access}, ${p.unlockLevel}::int, ${p.priceOnline}::int, ${p.pricePresencial}::int, false
          )
          ON CONFLICT (slug) DO NOTHING
          RETURNING id
        ), s AS (
          INSERT INTO academy_sections (course_id, title, position)
          SELECT c.id, x.title, x.pos
          FROM c CROSS JOIN jsonb_to_recordset(${JSON.stringify(p.sections)}::jsonb) AS x(title text, pos int)
          ORDER BY x.pos -- ids en el orden del curso: más legible en el panel y en los logs
          RETURNING id, position
        ), l AS (
          INSERT INTO academy_lessons (course_id, section_id, slug, title, position, body, published)
          SELECT c.id, s.id, y.slug, y.title, y.pos, y.body, false
          FROM c
          CROSS JOIN jsonb_to_recordset(${JSON.stringify(p.lessons)}::jsonb) AS y(spos int, slug text, title text, pos int, body text)
          JOIN s ON s.position = y.spos
          ORDER BY y.spos, y.pos
          RETURNING id
        )
        SELECT (SELECT id FROM c) AS id,
               (SELECT count(*) FROM s)::int AS sections,
               (SELECT count(*) FROM l)::int AS lessons
      `
      if (!r?.id) {
        skipped.push(p.slug) // otro seed ganó la carrera por el slug
        continue
      }
      created.courses += 1
      created.sections += r.sections || 0
      created.lessons += r.lessons || 0
    }
  }

  // Categorías de la comunidad: solo si todavía no hay ninguna. Si el dueño
  // ya armó las suyas, la carga no le mete las por defecto encima.
  const catsIn = Array.isArray(body.categories) && body.categories.length ? body.categories : DEFAULT_CATEGORIES
  const cats = catsIn.slice(0, 10).map((c, i) => ({
    name: line(c?.name, 30),
    emoji: c?.emoji ? [...String(c.emoji)].slice(0, 8).join("") : null,
    pos: i,
    write_role: c?.writeRole === "admins" ? "admins" : "miembros",
  })).filter((c) => c.name)
  if (cats.length) {
    const rows = await sql`
      INSERT INTO academy_categories (name, emoji, position, write_role)
      SELECT x.name, x.emoji, x.pos, x.write_role
      FROM jsonb_to_recordset(${JSON.stringify(cats)}::jsonb) AS x(name text, emoji text, pos int, write_role text)
      WHERE NOT EXISTS (SELECT 1 FROM academy_categories)
      RETURNING id
    `
    created.categories = rows.length
  }

  return { created, skipped }
}

/* ── Subida de imágenes ─────────────────────────────────────────────────── */

/* El tipo sale de los bytes, nunca del `data:image/...` que declara el
   navegador: un .html renombrado a .png sigue siendo html, y Blob lo serviría
   con el Content-Type que le digamos. Solo webp, jpeg y png. */
function sniffImage(buf) {
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" }
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" }
  }
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return { ext: "png", mime: "image/png" }
  }
  return null
}

/* EXIF = GPS de la casa del alumno, modelo del teléfono, fecha. El front
   siempre re-codifica con canvas (que no copia EXIF), así que una imagen con
   EXIF es una subida que se saltó el front: se rechaza en vez de publicarla.
   Devuelve true (tiene EXIF), false (limpia) o null (estructura dañada, que
   también se rechaza: un decodificador tolerante podría leer lo que este
   recorrido no vio). */
function jpegHasExif(buf) {
  let i = 2
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null
    const marker = buf[i + 1]
    if (marker === 0xff) { i += 1; continue } // bytes de relleno
    if (marker === 0xda || marker === 0xd9) return false // SOS/EOI: ya no hay APPn
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue }
    const len = buf.readUInt16BE(i + 2)
    if (len < 2 || i + 2 + len > buf.length) return null
    if (marker === 0xe1 && len >= 8 && buf.toString("latin1", i + 4, i + 8) === "Exif") return true
    i += 2 + len
  }
  return null
}

function pngHasExif(buf) {
  let i = 8
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i)
    const type = buf.toString("latin1", i + 4, i + 8)
    if (type === "eXIf") return true
    if (type === "IEND") return false
    if (i + 12 + len > buf.length) return null
    i += 12 + len
  }
  return null
}

function webpHasExif(buf) {
  let i = 12
  while (i + 8 <= buf.length) {
    const type = buf.toString("latin1", i, i + 4)
    const len = buf.readUInt32LE(i + 4)
    if (type === "EXIF") return true
    if (i + 8 + len > buf.length) return null
    i += 8 + len + (len & 1) // los chunks RIFF se rellenan a par
  }
  return false
}

async function upload(ctx) {
  const { sql, body, member, admin } = ctx
  const kind = String(body.kind || "")
  if (!UPLOAD_KINDS.includes(kind)) throw new HttpError(400, "Tipo de imagen no válido")

  // El panel entra con token de barbero (ctx.admin sin ctx.member); un miembro
  // con su token. Los dos caminos se aceptan acá; qué auth deja pasar el router
  // lo decide MODE_OWNERS.
  const role = member?.role || admin?.role || null
  const isAdmin = role === "propietario" || role === "admin"
  const isStaff = isAdmin || role === "moderador"
  if (ADMIN_UPLOAD_KINDS.has(kind) && !isAdmin) throw new HttpError(403, "Solo un administrador puede subir este tipo de imagen", "forbidden")
  if (STAFF_UPLOAD_KINDS.has(kind) && !isStaff) throw new HttpError(403, "Solo el equipo puede subir portadas de eventos", "forbidden")
  const memberId = member?.id || admin?.memberId || null
  if (!memberId && !admin?.barberId) throw new HttpError(401, "Sesión de Academy requerida", "auth")

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new HttpError(503, "La subida de imágenes no está disponible por ahora", "unavailable")
  }

  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : ""
  // Corte barato antes de decodificar nada: 2 MB en base64 son ~2,8 MB de texto.
  const maxB64 = Math.ceil((UPLOAD_LIMITS.maxBytes * 4) / 3) + 4
  const comma = dataUrl.indexOf(",")
  if (comma < 0 || comma > 40) throw new HttpError(400, "Formato de imagen no soportado")
  if (dataUrl.length - comma - 1 > maxB64) throw new HttpError(413, "La imagen supera los 2 MB", "too_large")
  const header = dataUrl.slice(0, comma)
  const b64 = dataUrl.slice(comma + 1)
  if (!/^data:image\/(?:png|jpe?g|webp);base64$/i.test(header) || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    throw new HttpError(400, "Formato de imagen no soportado")
  }
  const buf = Buffer.from(b64, "base64")
  if (buf.length < 32) throw new HttpError(400, "La imagen está vacía o dañada")
  if (buf.length > UPLOAD_LIMITS.maxBytes) throw new HttpError(413, "La imagen supera los 2 MB", "too_large")

  const type = sniffImage(buf)
  if (!type) throw new HttpError(400, "Solo se aceptan imágenes JPG, PNG o WebP")
  const exif = type.ext === "jpg" ? jpegHasExif(buf) : type.ext === "png" ? pngHasExif(buf) : webpHasExif(buf)
  if (exif === null) throw new HttpError(400, "La imagen está dañada")
  if (exif) {
    throw new HttpError(400, "La foto trae datos de la cámara o de ubicación (EXIF). Súbela desde la Academy para limpiarlos.", "exif")
  }

  // Privada = solo las del chat, siempre, y nada más. Se sirven por el proxy
  // `file`, que revisa que quien la pide esté en esa conversación. Una privada
  // de otro tipo sería inútil (avatar, post o portada tienen que pasar
  // isImageUrl, que exige el Blob público), así que `body.private` no decide.
  const priv = kind === "chat"
  // El dueño/admin carga portadas de 10 cursos en una tarde; el tope
  // por-miembro es para miembros. El global corre para todos.
  const exempt = isAdmin

  /* Reserva + cuota en UNA sentencia: la fila se inserta solo si hay cupo, y
     recién después se sube a Blob. Así nunca hay un archivo en Blob que no
     esté contado (si Blob falla, la reserva se borra). Días y meses en hora
     de Santiago, igual que el resto del negocio. */
  const [q] = await sql`
    WITH lim AS (
      SELECT
        (SELECT count(*) FROM academy_uploads u
          WHERE ${memberId}::int IS NOT NULL AND u.member_id = ${memberId}::int
            AND u.created_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago')::int AS day_n,
        (SELECT count(*) FROM academy_uploads u
          WHERE ${memberId}::int IS NOT NULL AND u.member_id = ${memberId}::int
            AND u.created_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago')::int AS month_n,
        (SELECT count(*) FROM academy_uploads u
          WHERE u.created_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago')::int AS global_n
    ), ins AS (
      INSERT INTO academy_uploads (member_id, kind, url, bytes, private)
      SELECT ${memberId}::int, ${kind}, '', ${buf.length}, ${priv}
      FROM lim
      WHERE lim.global_n < ${UPLOAD_LIMITS.globalMonth}
        AND (${exempt}::boolean OR (lim.day_n < ${UPLOAD_LIMITS.memberDay} AND lim.month_n < ${UPLOAD_LIMITS.memberMonth}))
      RETURNING id
    )
    SELECT lim.day_n, lim.month_n, lim.global_n, (SELECT id FROM ins) AS id FROM lim
  `
  if (!q?.id) {
    if ((q?.global_n || 0) >= UPLOAD_LIMITS.globalMonth) {
      throw new HttpError(429, "La Academy llegó a su límite de imágenes de este mes. Intenta el próximo mes.", "quota_global")
    }
    if ((q?.day_n || 0) >= UPLOAD_LIMITS.memberDay) {
      throw new HttpError(429, `Llegaste al límite de ${UPLOAD_LIMITS.memberDay} imágenes por día. Intenta mañana.`, "quota_day")
    }
    throw new HttpError(429, `Llegaste al límite de ${UPLOAD_LIMITS.memberMonth} imágenes por mes.`, "quota_month")
  }
  const uploadId = q.id

  let blob
  try {
    const { put } = await import("@vercel/blob")
    const who = memberId ? String(memberId) : `b${admin.barberId}`
    blob = await put(`academy/${kind}/${who}-${Date.now()}.${type.ext}`, buf, {
      access: priv ? "private" : "public",
      contentType: type.mime,
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
  } catch (err) {
    console.error("[academy:upload] blob:", err?.message || err)
    // Se libera la reserva para que el intento fallido no gaste cuota.
    try {
      await sql`DELETE FROM academy_uploads WHERE id = ${uploadId}`
    } catch (delErr) {
      console.error("[academy:upload] no se pudo liberar la reserva:", delErr?.message || delErr)
    }
    throw new HttpError(502, "No se pudo subir la imagen. Intenta de nuevo.", "blob")
  }

  await sql`UPDATE academy_uploads SET url = ${blob.url} WHERE id = ${uploadId}`
  return {
    upload: {
      id: uploadId,
      // La URL real de un blob privado no le sirve al navegador (pide token);
      // se devuelve la del proxy, que es la que el chat va a mostrar.
      url: priv ? `/api/academy?mode=file&id=${uploadId}` : blob.url,
      kind,
      private: priv,
      bytes: buf.length,
      contentType: type.mime,
    },
  }
}

/* ── Tabla de modos (SPEC §16: exactamente estas claves) ────────────────── */

export const handlers = {
  courses: listCourses,
  course: getCourse,
  lesson: getLesson,
  "lesson-progress": saveProgress,
  catalog: getCatalog,
  "admin-courses": adminCourses,
  "admin-course-save": adminCourseSave,
  "admin-course-delete": adminCourseDelete,
  "admin-section-save": adminSectionSave,
  "admin-section-delete": adminSectionDelete,
  "admin-lesson-save": adminLessonSave,
  "admin-lesson-delete": adminLessonDelete,
  "admin-reorder": adminReorder,
  "admin-seed": adminSeed,
  upload,
}
