/* BRUNETTI IMAGE STUDIO — motor de sugerencias (por reglas)
   ------------------------------------------------------------------
   suggest({ diagnosis, intake, catalog }) → { items, warnings, version }

   Recibe el diagnóstico que registró Bruno, lo que declaró el cliente y el
   catálogo activo, y propone cortes, qué evitar, productos de peinado, champú,
   acondicionador, rutina, consejos y mantenimiento, cada uno con su "por qué".
   Es un asistente: nada de esto llega al informe hasta que Bruno lo aprueba
   (api/_imagen.js).

   Regla obligatoria del documento de Image Studio: no inventar marcas,
   productos, precios ni propiedades. Los productos salen SOLO del catálogo;
   si para una necesidad no hay ninguno, se devuelve un aviso en `warnings`
   en vez de un producto.

   Las tablas de abajo son un PUNTO DE PARTIDA para que Bruno las valide (el
   documento deja pendiente "documentar las reglas profesionales de
   Brunetti"). Cambiar una regla = editar su fila; la interfaz de suggest()
   no cambia, así un modelo de IA puede reemplazarlo después devolviendo los
   mismos items con source 'ia'.

   Puro: sin base, sin red, sin fechas. Lo usan la API y el dev mock.
   ------------------------------------------------------------------ */

export const RULES_VERSION = "2026-10-30"

const norm = (v) => String(v || "").trim().toLowerCase()
const has = (list, v) => Array.isArray(list) && list.some((x) => norm(x) === norm(v))
const join = (...parts) => parts.filter(Boolean).join(" ")
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "")

/* ---------- cortes: según la forma de rostro ---------- */
// Volumen arriba / lados / degradado de partida para cada forma (ids de
// src/data/estilo.js). El cabello y el cráneo lo ajustan después.
const FACE_CUT = {
  ovalado: { volume: "Medio, a gusto", sides: "A elección", fade: "Cualquiera: bajo, medio o alto" },
  // high: degradado alto, que pierde la forma rápido (repaso más seguido).
  redondo: { volume: "Alto arriba, para estilizar", sides: "Cerrados", fade: "Medio a alto, para afinar los lados", high: true },
  cuadrado: { volume: "Medio, con textura", sides: "Medios", fade: "Medio" },
  alargado: { volume: "Bajo arriba, sin altura", sides: "Con algo de cuerpo", fade: "Bajo o sin degradado" },
  triangular: { volume: "Alto arriba", sides: "Moderados", fade: "Bajo y suave" },
  diamante: { volume: "Medio, con flequillo o textura al frente", sides: "Con algo de largo", fade: "Bajo" },
  corazon: { volume: "Bajo a medio, hacia adelante", sides: "Con algo de largo", fade: "Bajo o medio, sin abrir arriba" },
}

function cutParams(faceId, hair, skull) {
  const base = FACE_CUT[faceId] || FACE_CUT.ovalado
  const notes = []
  let fade = base.fade
  let length = "Medio arriba, lados más cortos"
  let texture = "Texturizada con tijera"

  const type = norm(hair.type)
  const thick = norm(hair.thickness)
  const density = norm(hair.density)
  if (type === "rizado" || type === "crespo") {
    texture = "Natural: el rizo definido, sin desmecharlo"
    length = "Medio arriba (al menos 5 a 7 cm) para que el rizo se forme"
    notes.push("El rizo necesita largo arriba para formarse.")
  } else if (type === "ondulado") {
    texture = "Movimiento natural, con capas suaves"
  } else if (thick === "fino" || density === "baja") {
    texture = "Texturizada para dar cuerpo, sin quitar peso de más"
    length = "Corto a medio: el largo pesado aplasta y deja ver la baja densidad"
    notes.push("Cabello fino o de baja densidad: mejor corto y texturizado.")
  } else if (thick === "grueso" || density === "alta") {
    texture = "Texturizada para quitar volumen y peso"
    notes.push("Cabello grueso o denso: conviene descargar volumen.")
  }

  const occipital = norm(skull.occipital)
  const sides = norm(skull.sides)
  if (occipital === "plana") {
    fade = `${fade}; en la nuca, dejar más largo para dar forma a la zona occipital`
    notes.push("Zona occipital plana: el largo atrás le da forma.")
  }
  if (sides === "anchas") notes.push("Lados anchos: mejor cerrados para no ensanchar.")
  if (norm(skull.height) === "baja") notes.push("Cráneo bajo: algo de altura arriba equilibra.")

  const highFade = Boolean(base.high)
  return {
    params: { largo: length, volumen: base.volume, textura: texture, degradado: fade, lados: base.sides },
    notes,
    weeks: highFade ? 3 : 5,
  }
}

/* ---------- productos ---------- */
// Categorías de peinado según el cabello (la primera que calce manda).
const STYLING_RULES = [
  { id: "peinado.rizo", when: (h) => ["rizado", "crespo"].includes(norm(h.type)) || ["moderado", "alto"].includes(norm(h.frizz)),
    cats: ["crema", "gel"], why: "Define el rizo y controla el frizz sin endurecer." },
  { id: "peinado.fino", when: (h) => norm(h.thickness) === "fino" || norm(h.density) === "baja",
    cats: ["polvo", "arcilla", "sea_salt"], why: "Da cuerpo y textura con acabado mate, sin peso que aplaste." },
  { id: "peinado.ondulado", when: (h) => norm(h.type) === "ondulado",
    cats: ["sea_salt", "crema", "arcilla"], why: "Marca la onda natural con movimiento." },
  { id: "peinado.grueso", when: (h) => norm(h.thickness) === "grueso",
    cats: ["pomada", "cera", "arcilla"], why: "Fijación suficiente para controlar un cabello grueso." },
  { id: "peinado.base", when: () => true,
    cats: ["arcilla", "pomada", "cera"], why: "Fijación media y acabado natural para el día a día." },
]

// Necesidad principal para champú y acondicionador, en orden de prioridad.
function shampooNeed(hair, intake) {
  const needs = intake.needs || []
  if (has(needs, "Caspa")) return { need: "Anticaspa", id: "champu.caspa", why: "Declaraste caspa. Si persiste o pica, consulta a un dermatólogo." }
  if (norm(hair.sensitivity) === "sí" || norm(hair.sensitivity) === "si" || has(needs, "Cuero cabelludo sensible")) {
    return { need: "Cuero cabelludo sensible", id: "champu.sensible", why: "Cuero cabelludo sensible: limpieza suave." }
  }
  const cond = norm(hair.condition)
  if (cond === "graso" || cond === "mixto") return { need: "Cabello graso", id: "champu.graso", why: "Raíz grasa: controla el exceso de grasa." }
  if (cond === "seco") return { need: "Hidratante", id: "champu.seco", why: "Cabello seco: limpia sin resecar." }
  return { need: "Uso diario", id: "champu.normal", why: "Cabello normal: uno de uso diario basta." }
}

function conditionerNeed(hair, intake) {
  const needs = intake.needs || []
  const type = norm(hair.type)
  if (has(needs, "Canas o pelo teñido")) return { need: "Cabello teñido", id: "acond.tenido", why: "Pelo teñido o con canas: cuida el color y la fibra." }
  if (type === "rizado" || type === "crespo") return { need: "Rizos", id: "acond.rizo", why: "El rizo necesita hidratación para definirse." }
  if (norm(hair.condition) === "seco" || norm(hair.porosity) === "alta") return { need: "Hidratante", id: "acond.seco", why: "Cabello seco o poroso: hidratación de medios a puntas." }
  if (norm(hair.thickness) === "fino") return { need: "Cabello fino", id: "acond.fino", why: "Cabello fino: uno liviano que no le quite volumen." }
  if (norm(hair.thickness) === "grueso") return { need: "Cabello grueso", id: "acond.grueso", why: "Cabello grueso: suaviza y facilita el peinado." }
  return null
}

/* Puntaje de un producto del catálogo para este cabello. Un producto que
   declara tipos de cabello y no incluye el del cliente queda fuera; uno que
   no declara nada es neutro. */
function score(p, hair, { finish } = {}) {
  let s = 0
  if (p.hairTypes?.length) {
    if (!has(p.hairTypes, hair.type)) return -1
    s += 2
  }
  if (p.thickness?.length) {
    if (!has(p.thickness, hair.thickness)) return -1
    s += 2
  }
  if (p.conditions?.length && has(p.conditions, hair.condition)) s += 1
  if (finish === "mate" && norm(p.shine) === "mate") s += 1
  if (finish === "con brillo" && norm(p.shine) === "alto") s += 1
  if (p.soldHere) s += 0.5
  return s
}

const productDetail = (p) => ({
  cantidad: p.amount || null,
  aplicacion: p.application || null,
  modoDeUso: p.usage || null,
  frecuencia: p.frequency || null,
  fijacion: p.hold || null,
  brillo: p.shine || null,
})
const productTitle = (p) => join(p.brand, p.name)

/* ---------- sugerencias ---------- */
export function suggest({ diagnosis = {}, intake = {}, catalog = [] } = {}) {
  const items = []
  const warnings = []
  const face = diagnosis.face || null
  const hair = diagnosis.hair || {}
  const skull = diagnosis.skull || {}
  const active = (catalog || []).filter((p) => p && p.active !== false)

  if (!face?.id) warnings.push("Falta el tipo de rostro: sin él no se pueden sugerir cortes.")
  if (!hair.type) warnings.push("Falta el tipo de cabello: los productos y la rutina salen genéricos.")

  // Cortes y "evitar".
  let maintenanceWeeks = 5
  if (face?.id) {
    const { params, notes, weeks } = cutParams(face.id, hair, skull)
    maintenanceWeeks = weeks
    ;(face.best || []).slice(0, 3).forEach((b, i) => {
      items.push({
        kind: "corte",
        title: b.name,
        detail: { ...params, refImg: b.img || null, mantenimiento: `Repaso cada ${weeks} semanas` },
        // Lo del cabello y el cráneo ya va en los parámetros (largo, textura,
        // degradado): el "por qué" queda en el corte y el objetivo del rostro.
        reason: join(
          b.note, face.goal,
          norm(skull.occipital) === "plana" && /alto|skin/i.test(b.name) ? "Ojo: con la zona occipital plana, sube el degradado solo a los lados." : "",
        ),
        ruleId: `corte.${face.id}.${i + 1}`,
      })
    })
    // Los ajustes por cabello y cráneo van una sola vez, como consejos del corte.
    notes.forEach((n, i) => items.push({ kind: "consejo", title: n, detail: {}, reason: "Ajuste del corte a tu cabello y tu cráneo.", ruleId: `consejo.corte.${i + 1}` }))
    if (face.avoid) {
      items.push({ kind: "evitar", title: face.avoid, detail: {}, reason: `Rostro ${norm(face.name)}: ${lowerFirst(face.goal) || "rompe la proporción"}`, ruleId: `evitar.${face.id}` })
    }
    if (norm(skull.occipital) === "plana") {
      items.push({ kind: "evitar", title: "Degradado alto en la nuca", detail: {}, reason: "Deja a la vista la zona occipital plana.", ruleId: "evitar.occipital" })
    }
    if (norm(hair.thickness) === "fino" || norm(hair.density) === "baja") {
      items.push({ kind: "evitar", title: "Largos pesados y sin capas", detail: {}, reason: "Aplastan el cabello fino y dejan ver la baja densidad.", ruleId: "evitar.fino" })
    }
  }

  // Peinado: la primera regla que calce elige las categorías.
  const finish = norm(intake.finish)
  const rule = STYLING_RULES.find((r) => r.when(hair))
  const styling = active
    .filter((p) => rule.cats.includes(p.category))
    .map((p) => ({ p, s: score(p, hair, { finish }) + (rule.cats.length - rule.cats.indexOf(p.category)) * 0.1 }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
  if (styling.length) {
    styling.forEach(({ p }) => items.push({
      kind: "peinado", productId: p.id, title: productTitle(p), detail: productDetail(p), reason: rule.why, ruleId: rule.id,
    }))
  } else {
    warnings.push(`No hay producto de peinado en el catálogo para este cabello (se busca: ${rule.cats.join(", ")}).`)
  }

  // Champú.
  const sh = shampooNeed(hair, intake)
  const shampoo = active
    .filter((p) => p.category === "champu" && has(p.needs, sh.need))
    .map((p) => ({ p, s: score(p, hair) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)[0]
  if (shampoo) {
    items.push({ kind: "champu", productId: shampoo.p.id, title: productTitle(shampoo.p), detail: productDetail(shampoo.p), reason: sh.why, ruleId: sh.id })
  } else {
    warnings.push(`No hay champú "${sh.need}" en el catálogo.`)
  }

  // Acondicionador (no siempre hace falta).
  const co = conditionerNeed(hair, intake)
  if (co) {
    const cond = active
      .filter((p) => p.category === "acondicionador" && has(p.needs, co.need))
      .map((p) => ({ p, s: score(p, hair) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)[0]
    if (cond) {
      items.push({ kind: "acondicionador", productId: cond.p.id, title: productTitle(cond.p), detail: productDetail(cond.p), reason: co.why, ruleId: co.id })
    } else {
      warnings.push(`No hay acondicionador "${co.need}" en el catálogo.`)
    }
  }

  // Rutina de lavado paso a paso.
  const cond = norm(hair.condition)
  const curly = ["rizado", "crespo"].includes(norm(hair.type))
  const freq = cond === "graso" || cond === "mixto"
    ? "Lava día por medio, o a diario si entrenas o transpiras mucho."
    : cond === "seco" || curly
      ? "Lava 2 a 3 veces por semana; los otros días, solo agua o acondicionador."
      : "Lava día por medio."
  const steps = [
    freq,
    "Agua tibia: la muy caliente reseca el cuero cabelludo.",
    "Champú solo en el cuero cabelludo, masajeando con las yemas (sin uñas). El largo se limpia con la espuma al enjuagar.",
    co
      ? (norm(hair.thickness) === "fino" ? "Acondicionador en poca cantidad, de medios a puntas, nunca en la raíz. Enjuaga bien." : "Acondicionador de medios a puntas, nunca en la raíz; déjalo 1 a 2 minutos y enjuaga.")
      : "Si usas acondicionador, de medios a puntas y nunca en la raíz.",
    curly
      ? "Seca apretando con una toalla de microfibra o una polera, sin frotar; aplica la crema con el pelo húmedo."
      : "Seca con la toalla sin frotar; si buscas volumen, termina con secador a temperatura media, de la raíz hacia arriba.",
  ]
  items.push({ kind: "rutina", title: "Rutina de lavado", detail: { steps }, reason: "Ajustada a la condición de tu cuero cabelludo y a tu tipo de cabello.", ruleId: "rutina.base" })

  // Consejos: los de la forma de rostro + los del cabello.
  ;(face?.tips || []).slice(0, 3).forEach((t, i) => items.push({ kind: "consejo", title: t, detail: {}, reason: `Para un rostro ${norm(face.name)}.`, ruleId: `consejo.${face.id}.${i + 1}` }))
  if (["moderado", "alto"].includes(norm(hair.frizz)) || has(intake.needs, "Frizz")) {
    items.push({ kind: "consejo", title: "No frotes el pelo con la toalla y aplica el producto con el pelo húmedo para controlar el frizz.", detail: {}, reason: "Frizz.", ruleId: "consejo.frizz" })
  }
  if (cond === "graso" || cond === "mixto") {
    items.push({ kind: "consejo", title: "Evita tocarte el pelo durante el día y no uses productos pesados en la raíz.", detail: {}, reason: "Raíz grasa.", ruleId: "consejo.grasa" })
  }
  if (norm(hair.volume) === "bajo" || has(intake.needs, "Poco volumen")) {
    items.push({ kind: "consejo", title: "Para más volumen, seca con la cabeza hacia abajo y peina con los dedos.", detail: {}, reason: "Poco volumen.", ruleId: "consejo.volumen" })
  }
  if (["moderada", "alta"].includes(norm(hair.loss))) {
    items.push({ kind: "consejo", title: "Si la caída se mantiene o aumenta, consulta a un dermatólogo.", detail: {}, reason: "La caída puede tener causas médicas que esta asesoría no evalúa.", ruleId: "consejo.caida" })
  }
  items.push({
    kind: "consejo",
    title: "Entre visitas: no te cortes el pelo en casa, usa el producto en poca cantidad y vuelve a tiempo al repaso.",
    detail: {}, reason: "Errores que conviene evitar.", ruleId: "consejo.entre-visitas",
  })

  // Mantenimiento.
  items.push({
    kind: "mantenimiento",
    title: `Repaso del corte cada ${maintenanceWeeks} semanas`,
    detail: { weeks: maintenanceWeeks },
    reason: maintenanceWeeks <= 3 ? "Un degradado alto pierde la forma rápido." : "Mantiene la forma sin que crezca de más.",
    ruleId: "mantenimiento.base",
  })

  return { items, warnings, version: RULES_VERSION }
}
