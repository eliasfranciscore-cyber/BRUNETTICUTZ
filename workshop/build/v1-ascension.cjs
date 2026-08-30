/**
 * V1 — ASCENSIÓN II · El barbero invisible
 *
 * El deck narrativo. Va de la percepción a la visibilidad al sistema, con pocas
 * palabras por slide y una frase martillo por bloque. Es la continuación natural
 * del deck anterior: misma paleta, mismo tono, un peldaño más arriba.
 */

const pptxgen = require("pptxgenjs");
const path = require("path");
const K = require("./kit.cjs");

const t = K.ASCENSION;
const { W, H, M, CW, MONO, SANS } = K;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Bruno Herrera · Brunetticutz";
pres.title = "ASCENSIÓN II — El barbero invisible";

const light = () => { const s = pres.addSlide(); s.background = { color: t.light }; return s; };
const dark = () => { const s = pres.addSlide(); s.background = { color: t.dark }; return s; };

/* 01 · PORTADA ─────────────────────────────────────────────────────────── */
{
  const s = dark();
  K.photoPanel(s, K.photo("bruno-presenta"), { side: "right", w: 4.7 });
  const w = CW - 4.7;
  s.addText("WORKSHOP DE BARBEROS · 6 HORAS", {
    x: M, y: 0.9, w, h: 0.32, fontFace: MONO, fontSize: 11.5, bold: true,
    charSpacing: 3, color: t.accentSoft, valign: "middle", margin: 0, isTextBox: true,
  });
  K.headline(s, [
    "Tu mejor corte",
    "no sirve de nada",
    { text: "si nadie lo ve.", accent: true },
  ], t, { y: 2.55, w, size: 50, base: t.onDark, lineSpacingMult: 1.02 });
  s.addText("Bruno Herrera · Brunetticutz", {
    x: M, y: H - 1.35, w, h: 0.3, fontFace: SANS, fontSize: 13.5, bold: true,
    color: t.onDark, valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("Valer más  ·  Viralidad  ·  Clientes", {
    x: M, y: H - 1.0, w, h: 0.3, fontFace: MONO, fontSize: 11, charSpacing: 1.6,
    color: t.mutedDark, valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes(
    "Antes de hablar: 3 segundos de silencio mirando la sala. No empieces con 'hola, soy'. " +
    "Empieza con la frase.\n\n" +
    "La foto es tu credibilidad visual: esto lo dice alguien que corta de verdad."
  );
}

/* 02 · FRASE MARTILLO ──────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "La tesis del día", t);
  K.headline(s, [
    "Hoy no vienes a aprender",
    "a cortar mejor.",
    { text: "Vienes a valer más.", accent: true },
  ], t, { y: 2.1, size: 48, lineSpacingMult: 1.08 });
  K.deck(s,
    "El mercado no paga por lo que sabes. Paga por lo que percibe. " +
    "Si nadie sabe que eres bueno, para ellos no lo eres.",
    t, { y: 5.05, w: CW * 0.66, size: 16 });
  K.footer(s, t);
  s.addNotes(
    "Decila lento y dejala caer 3 segundos. No la expliques de inmediato — deja el silencio.\n\n" +
    "Después de la pausa, la bajada. Ahí recién arranca el contenido."
  );
}

/* 03 · AGENDA ─────────────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "El día de hoy", t);
  K.tag(s, "6 horas · 5 bloques", t);
  const items = [
    ["01", "Valer más frente a tus clientes", "Marca · precio", "50 min"],
    ["02", "Cómo crear ideas virales", "Hooks · EYE", "50 min"],
    ["03", "Corte en vivo · invitado especial", "Y la sala graba", "60 min"],
    ["04", "La estructura y la calculadora", "15 segundos", "60 min"],
    ["05", "Del scroll a la silla", "Embudo · clientes", "40 min"],
  ];
  items.forEach(([n, title, note, dur], i) => {
    const y = 1.55 + i * 0.98;
    K.row(s, pres, t, {
      y, h: 0.8, num: n, title,
      note: `${note}   ·   ${dur}`, titleSize: 24,
      fill: i === 2 ? t.lightCard : undefined,
      numColor: i === 2 ? t.accent : t.accent,
    });
  });
  K.footer(s, t);
  s.addNotes(
    "Promete poco y concreto. No leas los 5 puntos con detalle: nómbralos.\n\n" +
    "Marca el bloque 03: es el único donde no hablas tú, y es donde ellos van a trabajar. " +
    "Deja dicho desde ya que en ese bloque se graba."
  );
}

/* 04 · DIVIDER M1 ─────────────────────────────────────────────────────── */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Módulo 01",
    lines: ["Valer", { text: "más.", accent: true }],
    sub: "Dos barberos con la misma técnica. Uno cobra el doble. La diferencia no está en la tijera — está en cómo lo perciben antes de sentarse.",
    image: K.photo("bruno-cortando"),
    size: 78,
  });
  s.addNotes(
    "Pregunta a la sala: '¿cuántos eligieron alguna vez un barbero específico porque ese es el que me entiende?'\n\n" +
    "Espera las manos. Eso es valer más: no es la tijera, es la percepción."
  );
}

/* 05 · PERCEPCIÓN SOBRE HABILIDAD ─────────────────────────────────────── */
{
  const s = light();
  K.photoPanel(s, K.photo("bruno-pantalla"), { side: "right", w: 4.9 });
  const w = CW - 5.1;
  K.eyebrow(s, "Módulo 01 · Marca", t, { w });
  K.headline(s, ["Percepción", { text: "sobre habilidad.", accent: true }], t, { y: 1.5, w, size: 38 });
  K.quote(s, t, {
    x: M, y: 3.1, w,
    text: "El mercado no paga por lo que sabes. Paga por lo que percibe.",
    author: "Alex Hormozi", size: 19,
  });
  s.addText("Tu Instagram es la percepción que el cliente tiene de ti antes del corte.", {
    x: M, y: 5.75, w, h: 0.7,
    fontFace: SANS, fontSize: 15, italic: true, lineSpacing: 22, color: t.mutedLight,
    valign: "top", margin: 0, isTextBox: true,
  });
  s.addNotes(
    "Cita a Hormozi por nombre: da autoridad.\n\n" +
    "El punto: la percepción se construye, no se nace con ella. Tu Instagram es la " +
    "percepción que el cliente tiene de ti ANTES del corte."
  );
}

/* 06 · MARCA PERSONAL + NICHO ─────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Módulo 01 · Marca personal", t);
  K.headline(s, [
    "Tu marca es lo que dicen de ti",
    { text: "cuando no estás en la sala.", accent: true },
  ], t, { y: 1.35, size: 32 });
  const cw = (CW - 0.56) / 3;
  const cards = [
    { label: "No es", body: "tu logo ni tus seguidores.", fill: t.lightCard, tc: t.onLight, bc: t.mutedLight },
    { label: "Es", body: "tu reputación, corte a corte.", fill: t.lightCard, tc: t.onLight, bc: t.mutedLight },
    { label: "El nicho", body: "Especialízate y te buscan a ti.", fill: t.darkCard, tc: t.onDark, bc: t.accentSoft },
  ];
  cards.forEach((c, i) => {
    const x = M + i * (cw + 0.28);
    K.block(s, pres, { x, y: 3.05, w: cw, h: 1.9, fill: c.fill });
    s.addText(c.label, {
      x: x + 0.32, y: 3.35, w: cw - 0.64, h: 0.3,
      fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 2.2, color: c.bc,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(c.body, {
      x: x + 0.32, y: 3.78, w: cw - 0.64, h: 0.95,
      fontFace: SANS, fontSize: 17, lineSpacing: 25, color: c.tc,
      valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Intentar servir a todos te hace invisible. Ejecutivos, fades urbanos, home studio premium, barba. Elige uno.", t, { y: 5.4 });
  K.footer(s, t);
  s.addNotes(
    "Define marca personal con la frase central. Después el nicho: cuando le hablas a " +
    "todos, no le hablas a nadie.\n\n" +
    "Pídeles que piensen su nicho ahora, en voz baja. Lo van a escribir en el ejercicio."
  );
}

/* 07 · ECUACIÓN DE VALOR ──────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Módulo 01 · Precio", t);
  K.tag(s, "La ecuación de valor · Hormozi", t);
  K.headline(s, ["¿Por qué alguien paga más?"], t, { y: 1.15, size: 32 });
  const cw = (CW - 0.66) / 4;
  const cols = [
    { dir: "▲ SUBE", label: "RESULTADO\nDESEADO", q: "¿Qué logra el cliente?", c: t.up },
    { dir: "▲ SUBE", label: "PROBABILIDAD\nDE ÉXITO", q: "¿Qué tan seguro se siente?", c: t.up },
    { dir: "▼ BAJA", label: "TIEMPO\nDE ESPERA", q: "¿Cuánto tarda?", c: t.down },
    { dir: "▼ BAJA", label: "ESFUERZO\nDEL CLIENTE", q: "¿Cuánto le cuesta?", c: t.down },
  ];
  cols.forEach((c, i) => {
    const x = M + i * (cw + 0.22);
    K.block(s, pres, { x, y: 2.15, w: cw, h: 2.85, fill: i < 2 ? t.darkCard : t.lightCard });
    const onDark = i < 2;
    s.addText(c.dir, {
      x: x + 0.28, y: 2.42, w: cw - 0.56, h: 0.3,
      fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 1.8, color: c.c,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(c.label, {
      x: x + 0.28, y: 2.85, w: cw - 0.56, h: 1.0,
      fontFace: SANS, fontSize: 19, bold: true, lineSpacing: 24, charSpacing: -0.2,
      color: onDark ? t.onDark : t.onLight, valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(c.q, {
      x: x + 0.28, y: 4.1, w: cw - 0.56, h: 0.7,
      fontFace: SANS, fontSize: 13, italic: true, lineSpacing: 18,
      color: onDark ? t.mutedDark : t.mutedLight, valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.headline(s, [
    { text: "Sube los dos primeros. Baja los dos últimos.", accent: true },
  ], t, { y: 5.4, size: 22 });
  K.deck(s, "Muestra resultados, dá certeza, atiende hoy y sin fricción — y el precio se sostiene solo.", t, { y: 5.92, w: CW * 0.78, size: 14 });
  K.footer(s, t);
  s.addNotes(
    "Lo de arriba sube el valor, lo de abajo lo baja.\n\n" +
    "Traducción a barbería: muestra resultados (arriba), explica antes de cortar (arriba), " +
    "reserva online (abajo), puntualidad (abajo)."
  );
}

/* 08 · PRECIO SIN MIEDO ───────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Módulo 01 · Precio sin miedo", t);
  K.headline(s, ["Empaqueta el valor en niveles."], t, { y: 1.15, size: 32 });
  const cw = (CW - 0.56) / 3;
  const tiers = [
    { name: "BÁSICO", price: "$21.000", body: "Corte estándar\nSello de atención", fill: t.lightCard, dark: false },
    { name: "PREMIUM", price: "$42.000", body: "Corte + barba + producto\nDiagnóstico personalizado\nReserva prioritaria", fill: t.lightCard, dark: false },
    { name: "VIP · MEMBRESÍA", price: "$99.000 /mes", body: "2 cortes/mes + barba + producto\nCita fija, sin espera\nPrecio fijo con descuento", fill: t.darkCard, dark: true },
  ];
  tiers.forEach((c, i) => {
    const x = M + i * (cw + 0.28);
    K.block(s, pres, { x, y: 2.05, w: cw, h: 3.35, fill: c.fill });
    s.addText(c.name, {
      x: x + 0.34, y: 2.34, w: cw - 0.68, h: 0.3,
      fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 2.2,
      color: c.dark ? t.accentSoft : t.mutedLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(c.price, {
      x: x + 0.34, y: 2.72, w: cw - 0.68, h: 0.66,
      fontFace: SANS, fontSize: 30, bold: true, charSpacing: -1,
      color: c.dark ? t.onDark : t.onLight, valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(c.body, {
      x: x + 0.34, y: 3.55, w: cw - 0.68, h: 1.6,
      fontFace: SANS, fontSize: 14, lineSpacing: 24,
      color: c.dark ? t.mutedDark : t.bodyLight, valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Presenta el precio más alto primero: el primer número ancla toda la conversación.", t, { y: 5.72, size: 15 });
  K.footer(s, t);
  s.addNotes(
    "El cliente que decide por precio no es tu cliente.\n\n" +
    "La membresía es la joya: ingresos predecibles todos los meses. Y la regla de oro — " +
    "no bajes el precio, sube el valor."
  );
}

/* 09 · EJERCICIO 01 ───────────────────────────────────────────────────── */
{
  const s = dark();
  K.eyebrow(s, "Ejercicio 01", t, { onDark: true });
  K.tag(s, "5 minutos · hoja y lápiz", t, { onDark: true });
  K.headline(s, ["Construye tu frase", { text: "de posicionamiento.", accent: true }], t, {
    y: 1.35, size: 42, base: t.onDark,
  });
  const cw = (CW - 0.56) / 3;
  [
    ["01", "¿Quién soy?", "Tu especialidad o enfoque"],
    ["02", "¿A quién sirvo?", "Tu cliente ideal"],
    ["03", "¿Por qué me eligen?", "Tu diferencial real"],
  ].forEach(([n, q, a], i) => {
    const x = M + i * (cw + 0.28);
    K.card(s, pres, t, {
      x, y: 3.05, w: cw, h: 2.05, fill: t.cardOnDark,
      num: n, numColor: t.accent, title: q, body: a,
      titleColor: t.onDark, bodyColor: t.mutedDark, titleSize: 20, bodySize: 13.5,
    });
  });
  s.addNotes(
    "Cinco minutos reales, con cronómetro. Después leen tres en voz alta, no más.\n\n" +
    "La frase les sirve para dos cosas: la bio de Instagram y presentarse. " +
    "Díselo — le da sentido al ejercicio."
  );
}

/* 10 · DIVIDER M2 ─────────────────────────────────────────────────────── */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Módulo 02",
    lines: ["El barbero que", "no se ve,", { text: "no se vende.", accent: true }],
    sub: "Cómo dejar de ser invisible y que el cliente decida pagarte antes de entrar a la silla.",
    image: K.photo("barbero-tijera"),
    size: 46,
  });
  s.addNotes(
    "Bisagra de todo el workshop: conecta valer más con visibilidad. De nada sirve valer " +
    "si nadie te ve.\n\n" +
    "Antes de la próxima slide: 'saquen el teléfono, abran su último video, pónganlo en " +
    "silencio. ¿Se entiende?'"
  );
}

/* 11 · LOS 4 HOOKS ────────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Módulo 02 · Ideas virales", t);
  K.tag(s, "El primer segundo lo es todo", t);
  K.headline(s, ["Los 4 hooks que detienen el scroll"], t, { y: 1.15, size: 31 });
  const cw = (CW - 0.3) / 2;
  const hooks = [
    ["01", "Dolor", "Un antes / después que se entiende sin palabras."],
    ["02", "Curiosidad", "Una promesa abierta que obliga a seguir mirando."],
    ["03", "Personalidad", "Emoción real: la reacción del cliente en el espejo."],
    ["04", "Referencia viral", "Un sonido o trend que la gente ya reconoce."],
  ];
  hooks.forEach(([n, title, body], i) => {
    const x = M + (i % 2) * (cw + 0.3);
    const y = 2.15 + Math.floor(i / 2) * 1.72;
    K.card(s, pres, t, {
      x, y, w: cw, h: 1.5, fill: t.lightCard,
      num: n, title, body, titleSize: 21, bodySize: 13.5, numSize: 22, pad: 0.32,
    });
  });
  K.kicker(s, "Si no se entiende sin audio, el video ya murió.", t, { y: 5.75, size: 15 });
  K.footer(s, t);
  s.addNotes(
    "Un hook es el PRIMER SEGUNDO que detiene el scroll. Se entiende SIN AUDIO.\n\n" +
    "Recorre los 4 rápido y pide a la sala un ejemplo de cada uno con sus propios clientes. " +
    "Anota los de dolor en la pizarra: son el ejercicio."
  );
}

/* 12 · FRAMEWORK EYE ──────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Módulo 02 · Tipos de contenido", t);
  K.tag(s, "Framework EYE", t);
  K.headline(s, ["No todo video es igual."], t, { y: 1.15, size: 31 });
  const cw = (CW - 0.56) / 3;
  const eye = [
    ["E", "Entretenimiento", "Sketches, reacciones, retos.", "ENGANCHA"],
    ["Y", "Educación", "Tips, datos, tutoriales.", "AUTORIDAD"],
    ["I", "Inspiración", "Transformaciones, historias.", "DESEO"],
  ];
  eye.forEach(([letter, title, body, effect], i) => {
    const x = M + i * (cw + 0.28);
    K.block(s, pres, { x, y: 2.05, w: cw, h: 3.25, fill: t.darkCard });
    s.addText(letter, {
      x: x + 0.34, y: 2.2, w: cw - 0.68, h: 1.5,
      fontFace: SANS, fontSize: 82, bold: true, color: t.accent,
      valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(title, {
      x: x + 0.34, y: 3.95, w: cw - 0.68, h: 0.42,
      fontFace: SANS, fontSize: 21, bold: true, charSpacing: -0.3, color: t.onDark,
      valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(body, {
      x: x + 0.34, y: 4.42, w: cw - 0.68, h: 0.42,
      fontFace: SANS, fontSize: 13.5, color: t.mutedDark, valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(effect, {
      x: x + 0.34, y: 4.86, w: cw - 0.68, h: 0.3,
      fontFace: MONO, fontSize: 10, bold: true, charSpacing: 2.2, color: t.accentSoft,
      valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Los más virales son híbridos: entretener + inspirar. No te quedes solo en tutoriales.", t, { y: 5.6, size: 15 });
  K.footer(s, t);
  s.addNotes(
    "Pídeles que identifiquen de qué tipo fue el último video que subieron.\n\n" +
    "Casi todos van a decir educación. Ese es el diagnóstico: educan pero no se comparten."
  );
}

/* 13 · LAS 4 PREGUNTAS ────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Módulo 02 · Antes de grabar", t);
  K.headline(s, ["Un sistema, no videos sueltos."], t, { y: 1.15, size: 31 });
  const qs = [
    ["¿Quién comunica?", "Apareces 7 veces para ser familiar."],
    ["¿Qué comunicas?", "6 meses en un solo nicho."],
    ["¿Cómo lo comunicas?", "Tu personalidad es el diferencial."],
    ["¿Dónde lo comunicas?", "TikTok, Instagram, YouTube."],
  ];
  qs.forEach(([q, a], i) => {
    const y = 2.15 + i * 0.92;
    K.block(s, pres, { x: M, y, w: CW, h: 0.76, fill: i % 2 === 0 ? t.lightCard : t.light });
    s.addText(q, {
      x: M + 0.34, y, w: CW * 0.45, h: 0.76,
      fontFace: SANS, fontSize: 21, bold: true, charSpacing: -0.3, color: t.onLight,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(a, {
      x: M + CW * 0.47, y, w: CW * 0.53 - 0.34, h: 0.76,
      fontFace: SANS, fontSize: 17, bold: true, color: t.accent,
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "La mayoría abandona en el video 4 y cambia de nicho al mes y medio. Ahí está la diferencia.", t, { y: 6.0, size: 15 });
  K.footer(s, t);
  s.addNotes(
    "Los dos números que hay que dejar clavados son el 7 y el 6.\n\n" +
    "El 7: apareces 7 veces antes de resultar familiar. El 6: seis meses en un nicho antes " +
    "de juzgar si funciona."
  );
}

/* 14 · DIVIDER INVITADO ───────────────────────────────────────────────── */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Invitado especial",
    lines: ["Corte", { text: "en vivo.", accent: true }],
    sub: "Guarden las libretas. Saquen el teléfono. Esto no se mira: esto se graba.",
    size: 96,
  });
  s.addNotes(
    "Presentas al invitado EN VOZ (no está en la slide). Dices qué va a mostrar y te " +
    "corres del medio.\n\n" +
    "Antes de dejarle el espacio, deja la próxima slide proyectada: es el reparto de planos. " +
    "Que quede en pantalla todo el bloque."
  );
}

/* 15 · REGLAS DEL SET ─────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Corte en vivo · el set", t);
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
  K.block(s, pres, { x: M + 3 * (cw + 0.147), y: 3.5, w: cw, h: 1.28, fill: t.darkCard });
  s.addText("SILENCIO DE CÁMARA", {
    x: M + 3 * (cw + 0.147) + 0.24, y: 3.72, w: cw - 0.48, h: 0.28,
    fontFace: MONO, fontSize: 9.5, bold: true, charSpacing: 1.6, color: t.accentSoft,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("El primer pase de máquina y el reveal en el espejo. Esos dos viralizan.", {
    x: M + 3 * (cw + 0.147) + 0.24, y: 4.05, w: cw - 0.48, h: 0.68,
    fontFace: SANS, fontSize: 11.5, lineSpacing: 15, color: t.onDark,
    valign: "top", margin: 0, isTextBox: true,
  });
  K.kicker(s, "Muchas tomas cortas, no una larga. Al terminar: 3 minutos para revisar el material antes de que se enfríe.", t, { y: 5.35, size: 14 });
  K.footer(s, t);
  s.addNotes(
    "Reparte los 7 planos ANTES de que el invitado empiece. Cada uno tiene el suyo " +
    "obligatorio y además graba libre.\n\n" +
    "Insiste en vertical 9:16 aunque el plano parezca pedir horizontal. Es el error más común."
  );
}

/* 16 · LA ESTRUCTURA DE 15 SEGUNDOS ───────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Módulo 03 · Anatomía", t);
  K.tag(s, "15 segundos", t);
  K.headline(s, ["Cuatro partes, quince segundos"], t, { y: 1.15, size: 31 });
  const parts = [
    { t: "0 – 3 s", n: "Hook", d: "Detiene el scroll.\nSin audio.", flex: 0.9, fill: t.darkCard, dark: true },
    { t: "3 – 5 s", n: "Foreshadow", d: "Genera intriga.\nMiedo a perdérselo.", flex: 1.0, fill: t.lightCard, dark: false },
    { t: "5 – 12 s", n: "Valor", d: "Entretienes, educas\no inspiras.", flex: 1.7, fill: t.accent, dark: true },
    { t: "12 – 15 s", n: "CTA", d: "Claridad, urgencia,\nescasez.", flex: 0.9, fill: t.darkCard, dark: true },
  ];
  const totalFlex = parts.reduce((a, p) => a + p.flex, 0);
  let x = M;
  parts.forEach((p) => {
    const w = (CW / totalFlex) * p.flex;
    K.block(s, pres, { x, y: 2.05, w, h: 3.2, fill: p.fill });
    s.addText(p.t, {
      x: x + 0.26, y: 2.32, w: w - 0.52, h: 0.28,
      fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 1.6,
      color: p.dark ? (p.fill === t.accent ? "E6D6FF" : t.accentSoft) : t.accent,
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
      color: p.dark ? (p.fill === t.accent ? "F0E6FF" : t.mutedDark) : t.bodyLight,
      valign: "top", margin: 0, isTextBox: true,
    });
    x += w;
  });
  K.kicker(s, "Quita una parte y el video se cae. El que más se saltan es el foreshadow.", t, { y: 5.6, size: 15 });
  K.footer(s, t);
  s.addNotes(
    "Ésta es la slide que más van a querer fotografiar. Anunciálo y dales 5 segundos.\n\n" +
    "Recorre la línea de tiempo y remarca el foreshadow: sin él, el video pasa del hook al " +
    "contenido y el espectador no tiene razón para quedarse."
  );
}

/* 17 · DIVIDER CALCULADORA ────────────────────────────────────────────── */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Módulo 04",
    lines: ["Calculadora", { text: "de viralidad.", accent: true }],
    sub: "Evalúa tu idea ANTES de grabar. Seis preguntas, una nota del 0 al 10.",
    image: K.photo("trio-diploma"),
    size: 60,
  });
  s.addNotes(
    "La herramienta con la que se van a ir. Antes de gastar tiempo grabando, puntúa la idea.\n\n" +
    "Si no llega, no la grabes: rediseñala."
  );
}

/* 18 · LOS 6 CRITERIOS ────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Módulo 04 · Los 6 criterios", t);
  K.tag(s, "Puntúa cada uno 0 – 10", t);
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
    const y = 1.4 + Math.floor(i / 3) * 2.05;
    K.card(s, pres, t, {
      x, y, w: cw, h: 1.85, fill: i === 0 ? t.darkCard : t.lightCard,
      num: n, numColor: i === 0 ? t.accentSoft : t.accent,
      title: q, body: a,
      titleColor: i === 0 ? t.onDark : t.onLight,
      bodyColor: i === 0 ? t.mutedDark : t.bodyLight,
      titleSize: 19, bodySize: 13,
    });
  });
  K.kicker(s, "El 01 es el más importante y el que más falla. Si no se entiende mudo, el resto no importa.", t, { y: 5.75, size: 15 });
  K.footer(s, t);
  s.addNotes(
    "Lee cada criterio como una pregunta de sí/no que puntúan del 0 al 10. El promedio es " +
    "la nota.\n\n" +
    "Después: toma 3 ideas de la sala y puntuálas en vivo. Elige una mala a propósito — ver " +
    "una idea subir de 4.5 a 8.0 enseña más que ver tres buenas."
  );
}

/* 19 · LA ESCALA ──────────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Módulo 04 · La decisión", t);
  K.headline(s, ["Cómo se lee el puntaje"], t, { y: 1.15, size: 31 });
  const scale = [
    ["8.0 – 10", "Graba ahora.", "Probablemente viral", true],
    ["6.0 – 7.9", "Buen contenido.", "Engagement seguro", false],
    ["4.0 – 5.9", "Rediseña la idea.", "Necesita mejora", false],
    ["< 4.0", "Vuelve a empezar.", "No está listo", false],
  ];
  scale.forEach(([range, verdict, note, hot], i) => {
    const y = 2.15 + i * 0.98;
    K.block(s, pres, { x: M, y, w: CW, h: 0.82, fill: hot ? t.darkCard : t.lightCard });
    s.addText(range, {
      x: M + 0.36, y, w: 2.5, h: 0.82,
      fontFace: SANS, fontSize: 29, bold: true, charSpacing: -0.8,
      color: hot ? t.accent : (i === 1 ? t.accent : t.mutedLight),
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(verdict, {
      x: M + 3.0, y, w: CW * 0.45, h: 0.82,
      fontFace: SANS, fontSize: 22, bold: true, charSpacing: -0.3,
      color: hot ? t.onDark : t.onLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(note, {
      x: M + CW - 3.4, y, w: 3.06, h: 0.82,
      fontFace: SANS, fontSize: 13, color: hot ? t.mutedDark : t.mutedLight,
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "La calculadora te ahorra grabar lo que no iba a funcionar. Una idea de 5.0 llega a 8.0 en dos minutos.", t, { y: 6.15, size: 14 });
  K.footer(s, t);
  s.addNotes(
    "La regla de decisión. Lo importante no es el número: es que la calculadora te ahorra " +
    "grabar lo que no iba a funcionar."
  );
}

/* 20 · DEL SCROLL A LA SILLA ──────────────────────────────────────────── */
{
  const s = dark();
  K.eyebrow(s, "Módulo 05 · El sistema", t, { onDark: true });
  K.tag(s, "El paso 4 es donde falla todo el mundo", t, { onDark: true });
  K.headline(s, ["Video viral sin sistema", { text: "= nada.", accent: true }], t, {
    y: 1.15, size: 34, base: t.onDark,
  });
  const steps = [
    ["1", "Video viral"], ["2", "Alguien ve"], ["3", "Te sigue"], ["4", "Click en bio"],
    ["5", "WhatsApp"], ["6", "Cierras la venta"], ["7", "Leal + referidos"],
  ];
  const cw = (CW - 0.72) / 4;
  steps.forEach(([n, label], i) => {
    const x = M + (i % 4) * (cw + 0.24);
    const y = 2.5 + Math.floor(i / 4) * 1.28;
    const hot = i === 3;
    K.block(s, pres, { x, y, w: cw, h: 1.06, fill: hot ? t.accent : t.cardOnDark });
    s.addText(n, {
      x: x + 0.26, y: y + 0.16, w: 0.6, h: 0.4,
      fontFace: SANS, fontSize: 20, bold: true, color: hot ? "FFFFFF" : t.accent,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(label, {
      x: x + 0.26, y: y + 0.55, w: cw - 0.52, h: 0.38,
      fontFace: SANS, fontSize: 15.5, bold: true, charSpacing: -0.2,
      color: hot ? "FFFFFF" : t.onDark, valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.block(s, pres, { x: M + 3 * (cw + 0.24), y: 3.78, w: cw, h: 1.06, fill: t.cardOnDark });
  s.addText("Tu bio: qué haces · desde cuánto · link a WhatsApp. Arreglala ahora.", {
    x: M + 3 * (cw + 0.24) + 0.26, y: 3.9, w: cw - 0.52, h: 0.85,
    fontFace: SANS, fontSize: 11.5, lineSpacing: 15, color: t.accentSoft,
    valign: "middle", margin: 0, isTextBox: true,
  });
  K.kicker(s, "10.000 seguidores sin conversión = $0. Y el link de la bio va directo a WhatsApp: no a una web, no al direct.", t, { onDark: true, y: 5.5, size: 14 });
  s.addNotes(
    "Acá se hace el ejercicio de la bio: teléfono en mano, 2 minutos, ahora. No es tarea.\n\n" +
    "Es la acción de mayor impacto por minuto de todo el día."
  );
}

/* 21 · CIERRE + CONCURSO ──────────────────────────────────────────────── */
{
  const s = dark();
  K.eyebrow(s, "Para llevarte", t, { onDark: true });
  const cw = (CW - 0.56) / 3;
  [
    ["01", "No es cortar mejor.\nEs valer más."],
    ["02", "El que no se ve,\nno se vende."],
    ["03", "Evalúa la idea\nantes de grabar."],
  ].forEach(([n, body], i) => {
    const x = M + i * (cw + 0.28);
    K.block(s, pres, { x, y: 1.15, w: cw, h: 1.75, fill: t.cardOnDark });
    s.addText(n, {
      x: x + 0.32, y: 1.42, w: cw - 0.64, h: 0.42,
      fontFace: SANS, fontSize: 22, bold: true, color: t.accent,
      valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(body, {
      x: x + 0.32, y: 1.92, w: cw - 0.64, h: 0.85,
      fontFace: SANS, fontSize: 17, lineSpacing: 25, color: t.onDark,
      valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.block(s, pres, { x: M, y: 3.28, w: CW, h: 2.35, fill: t.accent });
  s.addText("EL CONCURSO DEL WORKSHOP", {
    x: M + 0.42, y: 3.6, w: CW - 0.84, h: 0.3,
    fontFace: MONO, fontSize: 11, bold: true, charSpacing: 2.6, color: "E6D6FF",
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("El mejor reel se lleva el Kit Tadeus.", {
    x: M + 0.42, y: 4.0, w: CW - 0.84, h: 0.6,
    fontFace: SANS, fontSize: 32, bold: true, charSpacing: -0.8, color: "FFFFFF",
    valign: "top", margin: 0, isTextBox: true,
  });
  s.addText("Kit completo + capa Tadeus bordada con tu nombre + gorro Brunetti.   Un kit, un ganador.\nGrabas · editas · publicas · etiquetas a @brunetticutz", {
    x: M + 0.42, y: 4.7, w: CW - 0.84, h: 0.8,
    fontFace: SANS, fontSize: 14, lineSpacing: 22, color: "F0E6FF",
    valign: "top", margin: 0, isTextBox: true,
  });
  s.addText("@brunetticutz", {
    x: M, y: 6.05, w: CW * 0.5, h: 0.5,
    fontFace: SANS, fontSize: 26, bold: true, color: t.onDark,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("brunetticutz.cl", {
    x: M + CW * 0.5, y: 6.05, w: CW * 0.5, h: 0.5,
    fontFace: SANS, fontSize: 20, bold: true, color: t.accentSoft,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes(
    "Cierra con las 3 ideas y el concurso. No pidas que te crean: invitálos a actuar el lunes.\n\n" +
    "Antes de esta slide: el compromiso en voz alta. Cada uno dice 'el lunes publico un " +
    "video de [formato] con hook de [tipo]'."
  );
}

/* 22 · NOS VEMOS EN EL FEED ───────────────────────────────────────────── */
{
  const s = pres.addSlide();
  s.background = { color: t.dark };
  const band = 4.35;
  s.addImage({ path: K.photo("grupo-final"), x: 0, y: 0, w: W, h: band, sizing: { type: "cover", w: W, h: band } });
  K.headline(s, ["Nos vemos", { text: "en el feed.", accent: true }], t, {
    y: band + 0.55, size: 44, base: t.onDark, lineSpacingMult: 1.0,
  });
  s.addText("WORKSHOP ASCENSIÓN · BRUNETTICUTZ", {
    x: M + CW * 0.5, y: band + 0.72, w: CW * 0.5, h: 0.3,
    fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 2.4, color: t.mutedDark,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("@brunetticutz", {
    x: M + CW * 0.5, y: band + 1.12, w: CW * 0.5, h: 0.5,
    fontFace: SANS, fontSize: 26, bold: true, color: t.onDark,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("brunetticutz.cl", {
    x: M + CW * 0.5, y: band + 1.68, w: CW * 0.5, h: 0.4,
    fontFace: SANS, fontSize: 17, bold: true, color: t.accentSoft,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes("Foto grupal para cerrar con energía. Que saquen la foto ellos también — es contenido.");
}

const out = path.join(__dirname, "..", "decks", "V1-ascension-el-barbero-invisible.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("✔", out));
