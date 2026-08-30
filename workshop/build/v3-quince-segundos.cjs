/**
 * V3 — 15 segundos · el taller
 *
 * El deck laboratorio. Cada bloque termina en un ejercicio con cronómetro y la sala
 * construye UN video a lo largo del día: una idea, un puntaje, un rodaje, una edición,
 * una publicación. Claro dominante a propósito: se lee con la luz de la sala encendida,
 * que es lo que hace falta cuando la gente está trabajando.
 */

const pptxgen = require("pptxgenjs");
const path = require("path");
const K = require("./kit.cjs");

const t = K.REC;
const { W, H, M, CW, MONO, SANS } = K;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Bruno Herrera · Brunetticutz";
pres.title = "15 segundos — el taller";

const light = () => { const s = pres.addSlide(); s.background = { color: t.light }; return s; };
const dark = () => { const s = pres.addSlide(); s.background = { color: t.dark }; return s; };

/** Punto rojo de grabación. El motivo visual que se repite en todo el deck. */
function rec(slide, { x, y, size = 0.2, color = t.accent } = {}) {
  slide.addShape(pres.ShapeType.ellipse, {
    x, y, w: size, h: size, fill: { color }, line: { color, width: 0 },
  });
}

/** Slide de ejercicio: fondo oscuro, punto REC, duración enorme. */
function ejercicio(n, titulo, minutos, pasos, entregable, notas) {
  const s = dark();
  rec(s, { x: M, y: 0.47, size: 0.19 });
  s.addText(`EJERCICIO ${n}`, {
    x: M + 0.32, y: 0.42, w: 4, h: 0.3,
    fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 2.6, color: t.accent,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText(minutos, {
    x: W - M - 3.5, y: 0.36, w: 3.5, h: 0.44,
    fontFace: SANS, fontSize: 22, bold: true, color: t.onDark,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  K.headline(s, titulo, t, { y: 1.25, size: 40, base: t.onDark, accent: t.accentSoft });
  const cw = (CW - 0.28 * (pasos.length - 1)) / pasos.length;
  pasos.forEach((p, i) => {
    const x = M + i * (cw + 0.28);
    K.block(s, pres, { x, y: 3.25, w: cw, h: 2.0, fill: t.cardOnDark });
    s.addText(String(i + 1), {
      x: x + 0.3, y: 3.5, w: cw - 0.6, h: 0.4,
      fontFace: SANS, fontSize: 20, bold: true, color: t.accent,
      valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(p, {
      x: x + 0.3, y: 3.98, w: cw - 0.6, h: 1.1,
      fontFace: SANS, fontSize: 14.5, lineSpacing: 22, color: t.onDark,
      valign: "top", margin: 0, isTextBox: true,
    });
  });
  s.addText("QUEDA", {
    x: M, y: 5.65, w: 1.2, h: 0.3,
    fontFace: MONO, fontSize: 10, bold: true, charSpacing: 2.2, color: t.mutedDark,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText(entregable, {
    x: M + 1.3, y: 5.65, w: CW - 1.3, h: 0.4,
    fontFace: SANS, fontSize: 16, bold: true, color: t.accentSoft,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes(notas);
  return s;
}

/** Divider de bloque, con el punto REC y el número grande. */
function bloque(n, lines, sub, notas) {
  const s = dark();
  rec(s, { x: M, y: 0.75, size: 0.22 });
  s.addText(`BLOQUE ${n}`, {
    x: M + 0.36, y: 0.7, w: 5, h: 0.32,
    fontFace: MONO, fontSize: 11.5, bold: true, charSpacing: 3, color: t.accent,
    valign: "middle", margin: 0, isTextBox: true,
  });
  K.headline(s, lines, t, { y: 2.6, size: 66, base: t.onDark, accent: t.accent, lineSpacingMult: 1.0 });
  s.addText(sub, {
    x: M, y: H - 1.6, w: CW * 0.72, h: 0.9,
    fontFace: SANS, fontSize: 15, lineSpacing: 23, color: t.mutedDark,
    valign: "bottom", margin: 0, isTextBox: true,
  });
  s.addNotes(notas);
  return s;
}

/* 01 · PORTADA ─────────────────────────────────────────────────────────── */
{
  const s = dark();
  K.photoPanel(s, K.photo("bruno-presenta"), { side: "right", w: 4.7 });
  const w = CW - 4.7;
  rec(s, { x: M, y: 0.95, size: 0.2 });
  s.addText("TALLER DE BARBEROS · 6 HORAS", {
    x: M + 0.34, y: 0.9, w: w - 0.34, h: 0.32,
    fontFace: MONO, fontSize: 11.5, bold: true, charSpacing: 3, color: t.accent,
    valign: "middle", margin: 0, isTextBox: true,
  });
  K.headline(s, ["Hoy no te vas", { text: "sin publicar.", accent: true }], t, {
    y: 2.7, w, size: 52, base: t.onDark, lineSpacingMult: 1.06,
  });
  s.addText("15 segundos: el taller donde grabas, editas y publicas el mismo día.", {
    x: M, y: 4.35, w, h: 0.6, fontFace: SANS, fontSize: 15, lineSpacing: 23,
    color: t.mutedDark, valign: "top", margin: 0, isTextBox: true,
  });
  s.addText("Bruno Herrera · Brunetticutz", {
    x: M, y: H - 1.35, w, h: 0.3, fontFace: SANS, fontSize: 13.5, bold: true,
    color: t.onDark, valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("Idea  ·  Set  ·  Estructura  ·  Edición  ·  Destino", {
    x: M, y: H - 1.0, w, h: 0.3, fontFace: MONO, fontSize: 11, charSpacing: 1.4,
    color: t.mutedDark, valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes(
    "La promesa es concreta y verificable: hoy publican. Decila en los primeros 10 segundos.\n\n" +
    "Es un contrato, no un eslogan: si al final del día alguien no publicó, fallaste tú."
  );
}

/* 02 · LA REGLA DEL DÍA ───────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "La regla del día", t);
  K.headline(s, ["Esto no es una charla.", { text: "Es un set de grabación.", accent: true }], t, {
    y: 1.3, size: 36,
  });
  const cw = (CW - 0.75) / 4;
  const flow = [
    ["1 idea", "puntuada con la calculadora"],
    ["1 rodaje", "en el corte en vivo"],
    ["1 edición", "de 15 segundos en CapCut"],
    ["1 publicación", "hoy, en las tres plataformas"],
  ];
  flow.forEach(([a, b], i) => {
    const x = M + i * (cw + 0.25);
    const hot = i === 3;
    K.block(s, pres, { x, y: 3.0, w: cw, h: 1.95, fill: hot ? t.accent : t.lightCard });
    s.addText(a, {
      x: x + 0.3, y: 3.3, w: cw - 0.6, h: 0.5,
      fontFace: SANS, fontSize: 24, bold: true, charSpacing: -0.5,
      color: hot ? "FFFFFF" : t.onLight, valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(b, {
      x: x + 0.3, y: 3.92, w: cw - 0.6, h: 0.85,
      fontFace: SANS, fontSize: 13.5, lineSpacing: 20,
      color: hot ? "FFE9E7" : t.bodyLight, valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Kit de batalla: celular cargado, memoria libre, CapCut instalado. Si te falta algo, resuélvelo ahora.", t, { y: 5.5, size: 15 });
  K.footer(s, t, { right: "15 SEGUNDOS" });
  s.addNotes(
    "Cuatro entregables, no cuatro temas. Que quede claro que el día se mide por lo que " +
    "sale, no por lo que se escuchó.\n\n" +
    "Chequea el kit ahora: los que no tengan CapCut lo bajan en este minuto."
  );
}

/* 03 · LA AGENDA ──────────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "El día, hora por hora", t);
  K.tag(s, "6 horas · casi la mitad es práctica", t);
  const rows = [
    ["0:00", "Café y alianzas", "Diagnóstico de la sala", false],
    ["0:30", "Bloque 01 · La idea", "Hooks + calculadora + 2 ejercicios", false],
    ["1:50", "Pausa", "", false],
    ["2:05", "Bloque 02 · El set", "Corte en vivo. Y la sala graba", true],
    ["3:05", "Almuerzo", "", false],
    ["3:45", "Bloque 03 y 04 · Estructura y edición", "Guion + sprint en CapCut", false],
    ["5:15", "Bloque 05 · El destino", "Bio, WhatsApp y publicación", false],
    ["5:45", "Concurso y cierre", "El compromiso del lunes", false],
  ];
  rows.forEach(([hora, titulo, nota, hot], i) => {
    const y = 1.42 + i * 0.63;
    K.block(s, pres, { x: M, y, w: CW, h: 0.55, fill: hot ? t.accent : (i % 2 === 0 ? t.lightCard : t.light) });
    s.addText(hora, {
      x: M + 0.3, y, w: 1.0, h: 0.55,
      fontFace: MONO, fontSize: 14, bold: true,
      color: hot ? "FFFFFF" : t.accent, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(titulo, {
      x: M + 1.5, y, w: CW * 0.45, h: 0.55,
      fontFace: SANS, fontSize: 16.5, bold: true, charSpacing: -0.2,
      color: hot ? "FFFFFF" : t.onLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(nota, {
      x: M + CW * 0.52, y, w: CW * 0.48 - 0.3, h: 0.55,
      fontFace: SANS, fontSize: 13, color: hot ? "FFE9E7" : t.mutedLight,
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.footer(s, t, { right: "15 SEGUNDOS" });
  s.addNotes(
    "Marca el bloque 02: es el único donde no hablas tú y es el que hace posible todo lo " +
    "demás.\n\n" +
    "Si el día se atrasa, lo que se recorta es teoría — nunca el rodaje ni la publicación."
  );
}

/* 04 · BLOQUE 01 ──────────────────────────────────────────────────────── */
bloque("01", ["La", { text: "idea.", accent: true }],
  "De dónde sale un video que funciona. Y cómo saber si vale la pena grabarlo antes de gastar media hora.",
  "Arranca con la pregunta: '¿cuánto tardas en grabar un video?' Después: '¿y si supieras en dos minutos si vale la pena?'");

/* 05 · LOS 4 HOOKS ────────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Bloque 01 · El hook", t);
  K.tag(s, "El primer segundo lo es todo", t);
  K.headline(s, ["Si no se entiende sin audio,", { text: "el video ya murió.", accent: true }], t, {
    y: 1.15, size: 30,
  });
  const cw = (CW - 0.3) / 2;
  const hooks = [
    ["01", "Dolor", "Un antes / después que se entiende sin palabras."],
    ["02", "Curiosidad", "Una promesa abierta que obliga a seguir mirando."],
    ["03", "Personalidad", "Emoción real: la reacción del cliente en el espejo."],
    ["04", "Referencia viral", "Un sonido o trend que la gente ya reconoce."],
  ];
  hooks.forEach(([n, title, body], i) => {
    const x = M + (i % 2) * (cw + 0.3);
    const y = 2.35 + Math.floor(i / 2) * 1.68;
    K.card(s, pres, t, {
      x, y, w: cw, h: 1.46, fill: t.lightCard,
      num: n, title, body, titleSize: 21, bodySize: 13.5, numSize: 22, pad: 0.32,
    });
  });
  K.kicker(s, "El 80% ve el primer segundo en silencio. Ese es todo el examen.", t, { y: 5.85, size: 15 });
  K.footer(s, t, { right: "15 SEGUNDOS" });
  s.addNotes(
    "Antes de la slide: 'saquen el teléfono, abran su último video, pónganlo en silencio'.\n\n" +
    "Recorre los 4 rápido: el ejercicio viene enseguida y ahí se profundiza."
  );
}

/* 06 · EJERCICIO 01 ───────────────────────────────────────────────────── */
ejercicio("01", ["Tus 3 hooks", { text: "de dolor.", accent: true }], "7 minutos",
  [
    "¿Cuál es el problema visual más común que ves en tus clientes? Cada uno dice UNO en voz alta.",
    "Categorizamos la lista en la pizarra: ¿dolor, curiosidad o personalidad?",
    "Cada uno se queda con SUS tres. Ese es tu banco de hooks del mes.",
  ],
  "Tres hooks escritos, propios, listos para grabar.",
  "Escribe todo en la pizarra y déjalo visible el resto del día. Es el banco de ideas del grupo.\n\n" +
  "Si la sala está fría, empieza tú con un ejemplo tuyo — pero uno solo, después cállate.");

/* 07 · LA CALCULADORA ─────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Bloque 01 · La calculadora", t);
  K.tag(s, "Puntúa cada uno 0 – 10", t);
  K.headline(s, ["¿Vale la pena grabar este video?"], t, { y: 1.15, size: 31 });
  const crit = [
    ["01", "¿Niño de 5 años?", "Se entiende sin audio."],
    ["02", "¿50 de 100?", "Le interesa a la mitad."],
    ["03", "¿Referencia viral?", "Usa algo que ya funcionó."],
    ["04", "¿Mercado viral?", "Existe la demanda."],
    ["05", "¿Es tendencia?", "Es del momento."],
    ["06", "¿Controversia?", "Genera debate."],
  ];
  const cw = (CW - 0.5) / 3;
  crit.forEach(([n, q, a], i) => {
    const x = M + (i % 3) * (cw + 0.25);
    const y = 2.05 + Math.floor(i / 3) * 1.72;
    K.card(s, pres, t, {
      x, y, w: cw, h: 1.55, fill: i === 0 ? t.accent : t.lightCard,
      num: n, numColor: i === 0 ? "FFFFFF" : t.accent,
      title: q, body: a,
      titleColor: i === 0 ? "FFFFFF" : t.onLight,
      bodyColor: i === 0 ? "FFE9E7" : t.bodyLight,
      titleSize: 19, bodySize: 13,
    });
  });
  K.kicker(s, "El promedio es la nota. El 01 es el más importante y el que más falla: si no se entiende mudo, el resto no importa.", t, { y: 5.65, size: 14.5 });
  K.footer(s, t, { right: "15 SEGUNDOS" });
  s.addNotes(
    "Lee cada criterio como una pregunta de sí/no que puntúan del 0 al 10.\n\n" +
    "No expliques demasiado: el ejercicio siguiente lo enseña mejor que tú."
  );
}

/* 08 · LA ESCALA ──────────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Bloque 01 · La decisión", t);
  K.headline(s, ["Cómo se lee el puntaje"], t, { y: 1.15, size: 31 });
  const scale = [
    ["8.0 – 10", "Graba ahora.", "Probablemente viral", true],
    ["6.0 – 7.9", "Buen contenido.", "Engagement seguro", false],
    ["4.0 – 5.9", "Rediseña la idea.", "Necesita mejora", false],
    ["< 4.0", "Vuelve a empezar.", "No está listo", false],
  ];
  scale.forEach(([range, verdict, note, hot], i) => {
    const y = 2.15 + i * 0.98;
    K.block(s, pres, { x: M, y, w: CW, h: 0.82, fill: hot ? t.accent : t.lightCard });
    s.addText(range, {
      x: M + 0.36, y, w: 2.5, h: 0.82,
      fontFace: SANS, fontSize: 29, bold: true, charSpacing: -0.8,
      color: hot ? "FFFFFF" : (i === 1 ? t.onLight : t.mutedLight),
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(verdict, {
      x: M + 3.0, y, w: CW * 0.45, h: 0.82,
      fontFace: SANS, fontSize: 22, bold: true, charSpacing: -0.3,
      color: hot ? "FFFFFF" : t.onLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(note, {
      x: M + CW - 3.4, y, w: 3.06, h: 0.82,
      fontFace: SANS, fontSize: 13, color: hot ? "FFE9E7" : t.mutedLight,
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Una idea de 5.0 llega a 8.0 en dos minutos de conversación. Por eso se puntúa ANTES, no después.", t, { y: 6.15, size: 14 });
  K.footer(s, t, { right: "15 SEGUNDOS" });
  s.addNotes("La regla de decisión. Es la tabla que se van a llevar en la cabeza.");
}

/* 09 · EJERCICIO 02 ───────────────────────────────────────────────────── */
ejercicio("02", ["Puntúa tu idea", { text: "en vivo.", accent: true }], "15 minutos",
  [
    "Tomamos 3 ideas del grupo. Las evaluamos juntos, criterio por criterio, a mano alzada.",
    "Sacamos el promedio en la pizarra y decidimos: ¿se graba, se rediseña o se descarta?",
    "Cada uno puntúa la suya en silencio. Solo se graba lo que llega a 8.",
  ],
  "Una idea propia con nota ≥ 8, lista para el rodaje.",
  "Elige una idea mala a propósito para la tercera. Ver una idea subir de 4.5 a 8.0 con dos " +
  "cambios enseña más que ver tres ideas buenas.\n\n" +
  "Cierra con la predicción: '¿cuál de las 3 creen que va a funcionar mejor?' Votan. Se revisa " +
  "en el grupo de WhatsApp.");

/* 10 · BLOQUE 02 · EL SET ─────────────────────────────────────────────── */
bloque("02", ["El", { text: "set.", accent: true }],
  "Invitado especial. Corte en vivo. Guarden las libretas: esto no se mira, esto se graba.",
  "Presentas al invitado EN VOZ. Dices qué va a mostrar y te corres del medio.\n\n" +
  "Deja la próxima slide proyectada durante todo su bloque: es el reparto de planos.");

/* 11 · EL REPARTO DE PLANOS ───────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Bloque 02 · El reparto", t);
  K.tag(s, "Vertical 9:16 · tomas cortas", t);
  K.headline(s, ["Cada uno tiene un plano asignado."], t, { y: 1.15, size: 30 });
  const planos = [
    ["1", "Cenital", "Desde arriba · contexto"],
    ["2", "Detalle", "Close-up · transformación"],
    ["3", "General", "Plano abierto · profesionalismo"],
    ["4", "Punto de vista", "Lo que ve el cliente"],
    ["5", "Eye level", "A los ojos · conexión"],
    ["6", "Contrapicado", "Desde abajo · engrandecer"],
    ["7", "Picado", "Desde arriba · dramatismo"],
  ];
  const cw = (CW - 0.44) / 4;
  planos.forEach(([n, name, use], i) => {
    const x = M + (i % 4) * (cw + 0.147);
    const y = 2.05 + Math.floor(i / 4) * 1.45;
    K.card(s, pres, t, {
      x, y, w: cw, h: 1.28, fill: t.lightCard,
      num: n, title: name, body: use, titleSize: 16, bodySize: 11.5, numSize: 18, pad: 0.24,
    });
  });
  K.block(s, pres, { x: M + 3 * (cw + 0.147), y: 3.5, w: cw, h: 1.28, fill: t.accent });
  s.addText("SILENCIO DE CÁMARA", {
    x: M + 3 * (cw + 0.147) + 0.24, y: 3.72, w: cw - 0.48, h: 0.28,
    fontFace: MONO, fontSize: 9.5, bold: true, charSpacing: 1.6, color: "FFFFFF",
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("El primer pase de máquina y el reveal en el espejo. Esos dos viralizan.", {
    x: M + 3 * (cw + 0.147) + 0.24, y: 4.05, w: cw - 0.48, h: 0.68,
    fontFace: SANS, fontSize: 11.5, lineSpacing: 15, color: "FFE9E7",
    valign: "top", margin: 0, isTextBox: true,
  });
  K.kicker(s, "Tu plano es obligatorio; el resto es libre. Muchas tomas cortas, nunca una sola larga.", t, { y: 5.35, size: 15 });
  K.footer(s, t, { right: "15 SEGUNDOS" });
  s.addNotes(
    "Reparte los planos antes de que empiece. Nombralos uno por uno señalando a quién le toca.\n\n" +
    "Insiste en vertical 9:16 aunque el plano parezca pedir horizontal: es el error más común."
  );
}

/* 12 · EJERCICIO 03 ───────────────────────────────────────────────────── */
ejercicio("03", ["Graba el", { text: "corte en vivo.", accent: true }], "60 minutos",
  [
    "Tu plano asignado, primero. Después grabas libre todo lo que quieras.",
    "Silencio de cámara en el primer pase de máquina y en el reveal del espejo.",
    "Al terminar: 3 minutos de revisión. Marca tus 3 mejores clips antes de que se enfríe.",
  ],
  "Material real, tuyo, grabado hoy. Con esto se edita.",
  "Tú también grabas: eres el ejemplo. Y circula por la sala para corregir encuadres.\n\n" +
  "El error que más vas a ver: horizontal, y grabar una sola toma larga en vez de muchas cortas.");

/* 13 · BLOQUE 03 ──────────────────────────────────────────────────────── */
bloque("03", ["La", { text: "estructura.", accent: true }],
  "Quince segundos, cuatro partes. Ya tienes el material: ahora hay que darle forma.",
  "'Esta es la slide que van a querer fotografiar. Les doy cinco segundos.'");

/* 14 · 15 SEGUNDOS ────────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Bloque 03 · Anatomía", t);
  K.tag(s, "15 segundos", t);
  K.headline(s, ["Cuatro partes, quince segundos"], t, { y: 1.15, size: 31 });
  const parts = [
    { t: "0 – 3 s", n: "Hook", d: "Detiene el scroll. Sin audio.", flex: 0.9, fill: t.darkCard, dark: true },
    { t: "3 – 5 s", n: "Foreshadow", d: "Genera intriga. FOMO.", flex: 1.0, fill: t.lightCard, dark: false },
    { t: "5 – 12 s", n: "Valor", d: "Entretienes, educas o inspiras.", flex: 1.7, fill: t.accent, dark: true },
    { t: "12 – 15 s", n: "CTA", d: "Claridad, urgencia, escasez.", flex: 0.9, fill: t.darkCard, dark: true },
  ];
  const totalFlex = parts.reduce((a, p) => a + p.flex, 0);
  let x = M;
  parts.forEach((p) => {
    const w = (CW / totalFlex) * p.flex;
    K.block(s, pres, { x, y: 2.05, w, h: 3.2, fill: p.fill });
    s.addText(p.t, {
      x: x + 0.26, y: 2.32, w: w - 0.52, h: 0.28,
      fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 1.6,
      color: p.fill === t.accent ? "FFE9E7" : (p.dark ? t.accentSoft : t.accent),
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(p.n, {
      x: x + 0.26, y: 2.78, w: w - 0.52, h: 0.55,
      fontFace: SANS, fontSize: 25, bold: true, charSpacing: -0.5,
      color: p.dark ? "FFFFFF" : t.onLight, valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(p.d, {
      x: x + 0.26, y: 3.45, w: w - 0.52, h: 1.0,
      fontFace: SANS, fontSize: 13, lineSpacing: 19,
      color: p.fill === t.accent ? "FFE9E7" : (p.dark ? t.mutedDark : t.bodyLight),
      valign: "top", margin: 0, isTextBox: true,
    });
    x += w;
  });
  K.kicker(s, "Quita una parte y el video se cae. El que más se saltan es el foreshadow.", t, { y: 5.6, size: 15 });
  K.footer(s, t, { right: "15 SEGUNDOS" });
  s.addNotes(
    "Anuncia que es la slide para fotografiar y dales 5 segundos reales.\n\n" +
    "Después mapea los clips que acaban de grabar contra las 4 partes: ¿cuál es tu hook? " +
    "¿tienes reveal para el valor?"
  );
}

/* 15 · LAS 5 PREGUNTAS ────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Bloque 03 · Guionización", t);
  K.headline(s, ["Si saltas una pregunta,", { text: "el video muere.", accent: true }], t, {
    y: 1.25, size: 34,
  });
  K.deck(s, "Escribe las 5 preguntas que se va a hacer tu audiencia y respondelas EN ORDEN, antes de que las piensen.", t, { y: 2.5, w: CW * 0.42, size: 15 });
  const bx = M + CW * 0.47;
  const bw = CW * 0.53;
  const steps = [
    ["01", "PLANTEA", "“¿Vale la pena gastar 10x más?”", "Crea intriga"],
    ["02", "PRIMICIA", "“Sorpresa: no.”", "Invierte la expectativa"],
    ["03", "DEMUESTRA", "Muestras lado a lado", "Prueba visual"],
    ["04", "CIERRA", "“Nuestro recomendado: $50k”", "Respuesta clara"],
  ];
  steps.forEach(([n, label, ex, fn], i) => {
    const y = 1.35 + i * 1.15;
    const hot = i === 1;
    K.block(s, pres, { x: bx, y, w: bw, h: 1.0, fill: hot ? t.accent : t.lightCard });
    s.addText(n, {
      x: bx + 0.28, y: y + 0.12, w: 0.7, h: 0.34,
      fontFace: SANS, fontSize: 17, bold: true, color: hot ? "FFFFFF" : t.accent,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(label, {
      x: bx + 1.0, y: y + 0.12, w: bw - 1.3, h: 0.34,
      fontFace: MONO, fontSize: 11, bold: true, charSpacing: 2,
      color: hot ? "FFFFFF" : t.onLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(ex, {
      x: bx + 1.0, y: y + 0.46, w: bw - 1.3, h: 0.3,
      fontFace: SANS, fontSize: 14, italic: true,
      color: hot ? "FFFFFF" : t.onLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(fn, {
      x: bx + 1.0, y: y + 0.72, w: bw - 1.3, h: 0.26,
      fontFace: SANS, fontSize: 11.5,
      color: hot ? "FFE9E7" : t.mutedLight, valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Invierte la expectativa: la primicia del paso 02 es lo que hace que se queden.", t, { y: 6.05, size: 14.5 });
  K.footer(s, t, { right: "15 SEGUNDOS" });
  s.addNotes(
    "Cinco preguntas respondidas en orden = un video viral. Es el framework más accionable " +
    "del día después de la calculadora.\n\n" +
    "Que escriban las 5 de su idea ahora mismo, en el margen de la hoja."
  );
}

/* 16 · BLOQUE 04 ──────────────────────────────────────────────────────── */
bloque("04", ["La", { text: "edición.", accent: true }],
  "Basura adentro = basura afuera. La edición no salva un mal video, pero potencia uno bueno al 10x.",
  "Antes de abrir CapCut: la regla del paso 1. Solo lo mejor entra al timeline. La mayoría importa todo y después no puede decidir.");

/* 17 · EDICIÓN EN 4 PASOS ─────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Bloque 04 · Framework de edición", t);
  K.tag(s, "CapCut · 4 pasos", t);
  K.headline(s, ["Basura adentro = basura afuera."], t, { y: 1.15, size: 31 });
  const pasos = [
    ["1", "Importa y selecciona", "Solo lo mejor entra al timeline."],
    ["2", "Estructura y corta silencios", "Elimina los muertos. Ritmo constante."],
    ["3", "Agrega", "Subtítulos, efectos, sonido de tendencia."],
    ["4", "Exporta", "MP4 vertical 9:16 — formato nativo."],
  ];
  pasos.forEach(([n, title, body], i) => {
    const y = 2.05 + i * 0.9;
    K.block(s, pres, { x: M, y, w: CW, h: 0.76, fill: i === 0 ? t.accent : t.lightCard });
    s.addText(n, {
      x: M + 0.34, y, w: 0.7, h: 0.76,
      fontFace: SANS, fontSize: 24, bold: true,
      color: i === 0 ? "FFFFFF" : t.accent, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(title, {
      x: M + 1.15, y, w: CW * 0.42, h: 0.76,
      fontFace: SANS, fontSize: 18, bold: true, charSpacing: -0.2,
      color: i === 0 ? "FFFFFF" : t.onLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(body, {
      x: M + CW * 0.5, y, w: CW * 0.5 - 0.34, h: 0.76,
      fontFace: SANS, fontSize: 13.5, italic: true,
      color: i === 0 ? "FFE9E7" : t.mutedLight,
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Con $100 de equipo le ganas a quien gasta $10.000. La herramienta no hace el video: la idea lo hace.", t, { y: 5.85, size: 15 });
  K.footer(s, t, { right: "15 SEGUNDOS" });
  s.addNotes(
    "El paso 1 es el que todos se saltan y el que más importa.\n\n" +
    "Si alguien pregunta por equipo: teléfono (ya lo tiene), micrófono ~$50 USD, trípode " +
    "~$20–50 USD. Nada más."
  );
}

/* 18 · EJERCICIO 04 ───────────────────────────────────────────────────── */
ejercicio("04", ["Sprint", { text: "de edición.", accent: true }], "45 minutos",
  [
    "Abre CapCut con el material del corte en vivo. Solo tus 3 mejores clips entran.",
    "Arma los 15 segundos: hook, foreshadow, valor, CTA. Cronometralo de verdad.",
    "Subtítulos, sonido de tendencia, y exportas en MP4 vertical 9:16.",
  ],
  "Un video de 15 segundos exportado y listo para publicar.",
  "Circula por la sala. La corrección más frecuente: el hook es demasiado largo. " +
  "Si a los 3 segundos no pasó nada, se corta.\n\n" +
  "Los que terminan antes ayudan a los que van atrasados: eso arma la comunidad.");

/* 19 · BLOQUE 05 · EL DESTINO ─────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Bloque 05 · El destino", t);
  K.tag(s, "Donde el video se convierte en cliente", t);
  K.headline(s, ["Video viral sin sistema", { text: "= nada.", accent: true }], t, {
    y: 1.15, size: 34,
  });
  K.deck(s, "El paso donde falla todo el mundo es el link de la bio. Va DIRECTO a WhatsApp: no a una web, no al direct.", t, { y: 2.4, w: CW * 0.42, size: 15 });
  const bx = M + CW * 0.47;
  const bw = CW * 0.53;
  K.block(s, pres, { x: bx, y: 2.1, w: bw, h: 1.35, fill: t.lightCard });
  s.addText("✗  TU BIO AHORA", {
    x: bx + 0.32, y: 2.32, w: bw - 0.64, h: 0.28,
    fontFace: MONO, fontSize: 10, bold: true, charSpacing: 1.6, color: t.mutedLight,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("“Barbero profesional | Diseños custom | Sígueme”", {
    x: bx + 0.32, y: 2.68, w: bw - 0.64, h: 0.6,
    fontFace: SANS, fontSize: 15, italic: true, lineSpacing: 21, color: t.mutedLight,
    valign: "top", margin: 0, isTextBox: true,
  });
  K.block(s, pres, { x: bx, y: 3.65, w: bw, h: 1.35, fill: t.accent });
  s.addText("✓  TU BIO EN DOS MINUTOS", {
    x: bx + 0.32, y: 3.87, w: bw - 0.64, h: 0.28,
    fontFace: MONO, fontSize: 10, bold: true, charSpacing: 1.6, color: "FFE9E7",
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("“Cortes desde $21k | Disponibilidad: WhatsApp 👇”", {
    x: bx + 0.32, y: 4.23, w: bw - 0.64, h: 0.6,
    fontFace: SANS, fontSize: 15, bold: true, lineSpacing: 21, color: "FFFFFF",
    valign: "top", margin: 0, isTextBox: true,
  });
  K.block(s, pres, { x: M, y: 4.2, w: CW * 0.42, h: 1.45, fill: t.darkCard });
  s.addText("Y el mensaje que cierra:  “¡Hola! Qué bueno que viste el video. ¿Te gustaría una cita? Tengo hoy 5pm o mañana 3pm.”", {
    x: M + 0.3, y: 4.42, w: CW * 0.42 - 0.6, h: 1.05,
    fontFace: SANS, fontSize: 13, italic: true, lineSpacing: 19, color: t.onDark,
    valign: "top", margin: 0, isTextBox: true,
  });
  K.kicker(s, "Dos horarios cerrados, nunca una pregunta abierta. “¿Cuándo te queda bien?” termina en nada.", t, { y: 5.95, size: 14.5 });
  K.footer(s, t, { right: "15 SEGUNDOS" });
  s.addNotes(
    "Acá se para el taller 2 minutos y TODOS arreglan la bio, con el teléfono en la mano.\n\n" +
    "Es la acción de mayor impacto por minuto de todo el día. No la dejes como tarea."
  );
}

/* 20 · PUBLICÁ HOY + CONCURSO ─────────────────────────────────────────── */
{
  const s = dark();
  rec(s, { x: M, y: 0.47, size: 0.19 });
  s.addText("EJERCICIO 05 · EL ÚLTIMO", {
    x: M + 0.32, y: 0.42, w: 5, h: 0.3,
    fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 2.6, color: t.accent,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("Ahora", {
    x: W - M - 3.5, y: 0.36, w: 3.5, h: 0.44,
    fontFace: SANS, fontSize: 22, bold: true, color: t.onDark,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  K.headline(s, ["Publica.", { text: "Y entras al concurso.", accent: true }], t, {
    y: 1.2, size: 40, base: t.onDark,
  });
  const cw = (CW - 0.56) / 3;
  [
    ["TikTok", "El mismo video, sin marca de agua"],
    ["Instagram Reels", "Etiqueta a @brunetticutz"],
    ["YouTube Shorts", "El mismo archivo, sin editar de nuevo"],
  ].forEach(([p, d], i) => {
    const x = M + i * (cw + 0.28);
    K.block(s, pres, { x, y: 2.55, w: cw, h: 1.2, fill: t.cardOnDark });
    s.addText(p, {
      x: x + 0.3, y: 2.72, w: cw - 0.6, h: 0.38,
      fontFace: SANS, fontSize: 18, bold: true, color: t.onDark,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(d, {
      x: x + 0.3, y: 3.12, w: cw - 0.6, h: 0.5,
      fontFace: SANS, fontSize: 12.5, lineSpacing: 17, color: t.mutedDark,
      valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.block(s, pres, { x: M, y: 4.0, w: CW, h: 2.15, fill: t.accent });
  s.addText("EL CONCURSO DEL WORKSHOP", {
    x: M + 0.42, y: 4.28, w: CW - 0.84, h: 0.3,
    fontFace: MONO, fontSize: 11, bold: true, charSpacing: 2.6, color: "FFE9E7",
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("El mejor reel se lleva el Kit Tadeus.", {
    x: M + 0.42, y: 4.66, w: CW - 0.84, h: 0.6,
    fontFace: SANS, fontSize: 32, bold: true, charSpacing: -0.8, color: "FFFFFF",
    valign: "top", margin: 0, isTextBox: true,
  });
  s.addText("Kit completo + capa Tadeus bordada con tu nombre + gorro Brunetti.   Un kit, un ganador.\nSe revisan en Instagram. La fecha de cierre se avisa por el grupo.", {
    x: M + 0.42, y: 5.34, w: CW - 0.84, h: 0.7,
    fontFace: SANS, fontSize: 14, lineSpacing: 22, color: "FFE9E7",
    valign: "top", margin: 0, isTextBox: true,
  });
  s.addNotes(
    "Que publiquen EN LA SALA, no después. El que sale por la puerta sin publicar, no publica.\n\n" +
    "Mientras suben, anda anotando quién publicó — sirve para el seguimiento en el grupo."
  );
}

/* 21 · EL COMPROMISO DEL LUNES ────────────────────────────────────────── */
{
  const s = pres.addSlide();
  s.background = { color: t.dark };
  const band = 4.35;
  s.addImage({ path: K.photo("grupo-final"), x: 0, y: 0, w: W, h: band, sizing: { type: "cover", w: W, h: band } });
  K.headline(s, ["El lunes publico un video de ___", { text: "con hook de ___.", accent: true }], t, {
    y: band + 0.45, size: 26, base: t.onDark, lineSpacingMult: 1.2,
  });
  s.addText("Lo dices en voz alta. Eso es lo que hace que se publique.", {
    x: M, y: band + 1.75, w: CW * 0.6, h: 0.4,
    fontFace: SANS, fontSize: 14.5, italic: true, color: t.mutedDark,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("@brunetticutz", {
    x: M + CW * 0.55, y: band + 0.95, w: CW * 0.45, h: 0.5,
    fontFace: SANS, fontSize: 26, bold: true, color: t.onDark,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("brunetticutz.cl", {
    x: M + CW * 0.55, y: band + 1.52, w: CW * 0.45, h: 0.4,
    fontFace: SANS, fontSize: 17, bold: true, color: t.accent,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes(
    "Cada uno completa la frase en voz alta. Uno por uno, rápido, sin comentarios.\n\n" +
    "Después la foto grupal — que la saquen ellos también."
  );
}

const out = path.join(__dirname, "..", "decks", "V3-quince-segundos-el-taller.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("✔", out));
