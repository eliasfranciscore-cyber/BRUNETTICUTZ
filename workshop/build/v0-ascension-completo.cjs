/**
 * ASCENSIÓN — El barbero que cobra lo que vale
 *
 * La versión completa: junta los tres borradores en un solo deck para la jornada de
 * 6 horas. Estructura: valer más → ideas virales → la calculadora → corte en vivo →
 * la estructura y la edición → del scroll a la silla → cierre.
 *
 * Paleta ASCENSIÓN (morados), logo real de ASCENSIÓN en portada, divisores y cierre,
 * wordmark de Brunetti en morado en los pies, y un icono por fila para dar ancla
 * visual sin recurrir a barras de color. Español de Chile.
 */

const pptxgen = require("pptxgenjs");
const path = require("path");
const K = require("./kit.cjs");

const t = K.ASCENSION;
const { W, H, M, CW, MONO, SANS } = K;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Bruno Herrera · Brunetticutz";
pres.title = "ASCENSIÓN — El barbero que cobra lo que vale";
pres.subject = "Workshop de barberos · 6 horas";

const light = () => { const s = pres.addSlide(); s.background = { color: t.light }; return s; };
const dark = () => { const s = pres.addSlide(); s.background = { color: t.dark }; return s; };

/* ── Piezas propias de este deck ───────────────────────────────────────── */

// Se actualiza al entrar a cada módulo y lo lee el pie de página.
let MODULO = "ASCENSIÓN";
const pie = (s) => K.footerBrand(s, t, { right: MODULO });

/** Fila con icono en círculo, título y nota a la derecha. */
function filaIcono(s, { y, h = 0.86, name, title, note, fill, hot = false, titleSize = 20, numero }) {
  if (fill) K.block(s, pres, { x: M, y, w: CW, h, fill });
  const d = 0.56;
  K.iconBadge(s, pres, {
    x: M + 0.32, y: y + (h - d) / 2, d, name,
    tone: hot ? "blanco" : "morado",
    fill: hot ? t.accent : t.light,
  });
  if (numero !== undefined) {
    s.addText(numero, {
      x: M + 1.1, y, w: 0.6, h,
      fontFace: MONO, fontSize: 13, bold: true,
      color: hot ? t.accentSoft : t.mutedLight, valign: "middle", margin: 0, isTextBox: true,
    });
  }
  s.addText(title, {
    x: M + (numero !== undefined ? 1.82 : 1.12), y, w: CW * 0.44, h,
    fontFace: SANS, fontSize: titleSize, bold: true, charSpacing: -0.3,
    color: hot ? t.onDark : t.onLight, valign: "middle", margin: 0, isTextBox: true,
  });
  if (note) {
    s.addText(note, {
      x: M + CW * 0.5, y, w: CW * 0.5 - 0.34, h,
      fontFace: SANS, fontSize: 13.5,
      color: hot ? t.accentSoft : t.mutedLight,
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
  }
}

/** Tarjeta con icono arriba, título y cuerpo. El bloque base del deck. */
function tarjetaIcono(s, { x, y, w, h, name, num, title, body, onDark = false, hot = false, titleSize = 19 }) {
  const fill = hot ? t.accent : (onDark ? t.cardOnDark : t.lightCard);
  K.block(s, pres, { x, y, w, h, fill });
  const pad = 0.3;
  K.iconBadge(s, pres, {
    x: x + pad, y: y + pad, d: 0.5, name,
    tone: hot ? "blanco" : (onDark ? "lila" : "morado"),
  });
  if (num !== undefined) {
    s.addText(String(num), {
      x: x + w - pad - 0.9, y: y + pad, w: 0.9, h: 0.4,
      fontFace: SANS, fontSize: 19, bold: true,
      color: hot ? "E6D6FF" : (onDark ? t.accentSoft : t.accent),
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
  }
  s.addText(title, {
    x: x + pad, y: y + pad + 0.68, w: w - pad * 2, h: 0.56,
    fontFace: SANS, fontSize: titleSize, bold: true, charSpacing: -0.3, lineSpacing: titleSize * 1.15,
    color: hot ? "FFFFFF" : (onDark ? t.onDark : t.onLight),
    valign: "top", margin: 0, isTextBox: true,
  });
  if (body) {
    s.addText(body, {
      x: x + pad, y: y + pad + 1.28, w: w - pad * 2, h: h - pad * 2 - 1.28,
      fontFace: SANS, fontSize: 13, lineSpacing: 19,
      color: hot ? "F0E6FF" : (onDark ? t.mutedDark : t.bodyLight),
      valign: "top", margin: 0, isTextBox: true,
    });
  }
}

/** Slide de ejercicio. Fondo oscuro, reloj, duración y entregable. */
function ejercicio({ n, titulo, minutos, pasos, entregable, notas }) {
  const s = dark();
  K.iconBadge(s, pres, { x: M, y: 0.4, d: 0.42, name: "reloj", tone: "morado" });
  s.addText(`EJERCICIO ${n}`, {
    x: M + 0.56, y: 0.4, w: 4, h: 0.42,
    fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 2.6, color: t.accent,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText(minutos, {
    x: W - M - 3.5, y: 0.36, w: 3.5, h: 0.5,
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
      fontFace: SANS, fontSize: 14, lineSpacing: 21, color: t.onDark,
      valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.iconBadge(s, pres, { x: M, y: 5.62, d: 0.4, name: "check", tone: "lila" });
  s.addText("QUEDA", {
    x: M + 0.54, y: 5.62, w: 1.0, h: 0.4,
    fontFace: MONO, fontSize: 9.5, bold: true, charSpacing: 2.2, color: t.mutedDark,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText(entregable, {
    x: M + 1.6, y: 5.62, w: CW - 1.6, h: 0.4,
    fontFace: SANS, fontSize: 15.5, bold: true, color: t.accentSoft,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes(notas);
  return s;
}

/* ═══ APERTURA ═══════════════════════════════════════════════════════════ */

/* 01 · PORTADA */
{
  const s = dark();
  K.photoPanel(s, K.photo("bruno-presenta-limpia"), { side: "right", w: 5.0 });
  const w = CW - 5.2;
  K.logo(s, { x: M, y: 0.72, h: 1.15 });
  s.addText("WORKSHOP DE BARBEROS · 6 HORAS", {
    x: M, y: 2.3, w, h: 0.32, fontFace: MONO, fontSize: 11, bold: true,
    charSpacing: 2.8, color: t.accentSoft, valign: "middle", margin: 0, isTextBox: true,
  });
  K.headline(s, [
    "El barbero",
    "que cobra",
    { text: "lo que vale.", accent: true },
  ], t, { y: 2.95, w, size: 52, base: t.onDark, lineSpacingMult: 1.0 });
  s.addText("Bruno Herrera · Brunetticutz", {
    x: M, y: H - 1.38, w, h: 0.3, fontFace: SANS, fontSize: 13.5, bold: true,
    color: t.onDark, valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("Valer más  ·  Viralidad  ·  Clientes", {
    x: M, y: H - 1.02, w, h: 0.3, fontFace: MONO, fontSize: 11, charSpacing: 1.6,
    color: t.mutedDark, valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes(
    "Antes de hablar: 3 segundos de silencio mirando la sala. No empieces con 'hola, soy'. " +
    "Empieza con la frase.\n\n" +
    "La foto es tu credibilidad visual: esto lo dice alguien que corta de verdad."
  );
}

/* 02 · LA TESIS */
{
  const s = light();
  K.eyebrow(s, "La tesis del día", t);
  K.headline(s, [
    "Hoy no vienes a aprender",
    "a cortar mejor.",
    { text: "Vienes a valer más.", accent: true },
  ], t, { y: 2.0, size: 46, lineSpacingMult: 1.08 });
  K.deck(s,
    "El mercado no paga por lo que sabes. Paga por lo que percibe. " +
    "Si nadie sabe que eres bueno, para ellos no lo eres.",
    t, { y: 4.95, w: CW * 0.62, size: 16 });
  pie(s);
  s.addNotes(
    "Dila lento y déjala caer 3 segundos. No la expliques de inmediato — deja el silencio.\n\n" +
    "Después de la pausa, la bajada. Ahí recién arranca el contenido."
  );
}

/* 03 · AUDIENCIA ≠ CONVERSIÓN */
{
  const s = light();
  K.eyebrow(s, "El problema real", t);
  K.tag(s, "Audiencia ≠ conversión", t);
  K.headline(s, [
    "Muchos barberos generan vistas.",
    { text: "Y cero clientes.", accent: true },
  ], t, { y: 1.25, size: 33 });
  K.deck(s, "No tienen sistema. Sin sistema, los seguidores son solo un número bonito en la pantalla.", t, { y: 2.5, w: CW * 0.34, size: 15 });
  const cw = (CW * 0.62 - 0.3) / 2;
  const bx = M + CW * 0.38;
  K.block(s, pres, { x: bx, y: 2.25, w: cw, h: 3.0, fill: t.darkCard });
  K.iconBadge(s, pres, { x: bx + 0.34, y: 2.55, d: 0.5, name: "cruz", tone: "crema" });
  s.addText("NO ES ESTO", {
    x: bx + 0.96, y: 2.55, w: cw - 1.3, h: 0.5,
    fontFace: MONO, fontSize: 9.5, bold: true, charSpacing: 2, color: t.mutedDark,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("10.000", {
    x: bx + 0.34, y: 3.3, w: cw - 0.68, h: 1.0,
    fontFace: SANS, fontSize: 54, bold: true, charSpacing: -1.8, color: t.onDark,
    valign: "top", margin: 0, isTextBox: true,
  });
  s.addText("seguidores sin conversión", {
    x: bx + 0.34, y: 4.28, w: cw - 0.68, h: 0.32,
    fontFace: SANS, fontSize: 14, color: t.mutedDark, valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("= $0", {
    x: bx + 0.34, y: 4.6, w: cw - 0.68, h: 0.4,
    fontFace: SANS, fontSize: 20, bold: true, color: t.mutedDark, valign: "middle", margin: 0, isTextBox: true,
  });
  K.block(s, pres, { x: bx + cw + 0.3, y: 2.25, w: cw, h: 3.0, fill: t.accent });
  K.iconBadge(s, pres, { x: bx + cw + 0.64, y: 2.55, d: 0.5, name: "check", tone: "blanco" });
  s.addText("ES ESTO", {
    x: bx + cw + 1.26, y: 2.55, w: cw - 1.3, h: 0.5,
    fontFace: MONO, fontSize: 9.5, bold: true, charSpacing: 2, color: "E6D6FF",
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("100", {
    x: bx + cw + 0.64, y: 3.3, w: cw - 0.68, h: 1.0,
    fontFace: SANS, fontSize: 54, bold: true, charSpacing: -1.8, color: "FFFFFF",
    valign: "top", margin: 0, isTextBox: true,
  });
  s.addText("clientes reales", {
    x: bx + cw + 0.64, y: 4.28, w: cw - 0.68, h: 0.32,
    fontFace: SANS, fontSize: 14, color: "F0E6FF", valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("= $2.100.000 al mes", {
    x: bx + cw + 0.64, y: 4.6, w: cw - 0.68, h: 0.4,
    fontFace: SANS, fontSize: 20, bold: true, color: "FFFFFF", valign: "middle", margin: 0, isTextBox: true,
  });
  pie(s);
  s.addNotes(
    "Los $2.100.000 salen de 100 clientes × $21.000, un corte al mes cada uno. Dilo — " +
    "si no explicas el supuesto, alguien lo va a cuestionar y pierdes el momento.\n\n" +
    "El punto: no es seguidores. Es conversión."
  );
}

/* 04 · EL DÍA DE HOY */
{
  const s = light();
  K.eyebrow(s, "El día de hoy", t);
  K.tag(s, "285 min de contenido + 75 de pausas = 6 horas", t);
  const items = [
    ["estrella", "01", "Valer más frente a tus clientes", "Marca · precio · 45 min", false],
    ["rayo", "02", "Cómo crear ideas virales", "Hooks · EYE · 45 min", false],
    ["ajustes", "03", "La calculadora de viralidad", "Evalúa antes de grabar · 30 min", false],
    ["tijera", "—", "Corte en vivo · invitado especial", "Y la sala graba · 60 min", true],
    ["capas", "04", "La estructura y la edición", "15 s · sprint en CapCut · 75 min", false],
    ["chat", "05", "Del scroll a la silla", "Embudo · WhatsApp · clientes · 30 min", false],
  ];
  items.forEach(([name, num, title, note, hot], i) => {
    const y = 1.42 + i * 0.83;
    filaIcono(s, {
      y, h: 0.7, name, title, note,
      fill: hot ? t.darkCard : (i % 2 === 0 ? t.lightCard : t.light),
      hot, titleSize: 19, numero: num,
    });
  });
  pie(s);
  s.addNotes(
    "Promete poco y concreto. No leas los 6 puntos con detalle: nómbralos.\n\n" +
    "Marca el bloque del corte en vivo: es el único donde no hablas tú, y es donde ellos " +
    "van a trabajar. Deja dicho desde ya que en ese bloque se graba."
  );
}

/* ═══ MÓDULO 01 · VALER MÁS ══════════════════════════════════════════════ */
MODULO = "MÓDULO 1 / 5";

/* 05 · DIVIDER M1 */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Módulo 01",
    lines: ["Valer", { text: "más.", accent: true }],
    sub: "Dos barberos con la misma técnica. Uno cobra el doble. La diferencia no está en la tijera — está en cómo lo perciben antes de sentarse.",
    image: K.photo("bruno-cortando"),
    size: 76, withLogo: true,
  });
  s.addNotes(
    "Pregunta a la sala: '¿cuántos eligieron alguna vez un barbero específico porque ese " +
    "es el que me entiende?'\n\n" +
    "Espera las manos. Eso es valer más: no es la tijera, es la percepción."
  );
}

/* 06 · PERCEPCIÓN SOBRE HABILIDAD */
{
  const s = light();
  K.photoPanel(s, K.photo("bruno-pantalla-limpia"), { side: "right", w: 5.4 });
  const w = CW - 5.6;
  K.eyebrow(s, "Módulo 01 · Marca", t, { w });
  K.headline(s, ["Percepción", { text: "sobre habilidad.", accent: true }], t, { y: 1.4, w, size: 36 });
  K.quote(s, t, {
    x: M, y: 3.0, w,
    text: "El mercado no paga por lo que sabes. Paga por lo que percibe.",
    author: "Alex Hormozi", size: 18,
  });
  K.iconBadge(s, pres, { x: M, y: 5.42, d: 0.46, name: "ojo", tone: "morado", fill: t.lightCard });
  s.addText("Tu Instagram es la percepción que el cliente tiene de ti antes del corte.", {
    x: M + 0.7, y: 5.34, w: w - 0.7, h: 0.62,
    fontFace: SANS, fontSize: 14.5, italic: true, lineSpacing: 21, color: t.mutedLight,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes(
    "Cita a Hormozi por nombre: da autoridad.\n\n" +
    "El punto: la percepción se construye, no se nace con ella. Tu Instagram es la " +
    "percepción que el cliente tiene de ti ANTES del corte."
  );
}

/* 07 · MARCA PERSONAL + NICHO */
{
  const s = light();
  K.eyebrow(s, "Módulo 01 · Marca personal", t);
  K.headline(s, [
    "Tu marca es lo que dicen de ti",
    { text: "cuando no estás en la sala.", accent: true },
  ], t, { y: 1.3, size: 31 });
  const cw = (CW - 0.56) / 3;
  const cards = [
    { name: "cruz", label: "No es", body: "tu logo ni tus seguidores.", onDark: false },
    { name: "estrella", label: "Es", body: "tu reputación, corte a corte.", onDark: false },
    { name: "diana", label: "El nicho", body: "Especialízate y te buscan a ti.", onDark: true },
  ];
  cards.forEach((c, i) => {
    const x = M + i * (cw + 0.28);
    K.block(s, pres, { x, y: 2.95, w: cw, h: 2.05, fill: c.onDark ? t.darkCard : t.lightCard });
    K.iconBadge(s, pres, { x: x + 0.32, y: 3.22, d: 0.5, name: c.name, tone: c.onDark ? "lila" : "morado" });
    s.addText(c.label, {
      x: x + 0.94, y: 3.22, w: cw - 1.26, h: 0.5,
      fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 2.2,
      color: c.onDark ? t.accentSoft : t.mutedLight,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(c.body, {
      x: x + 0.32, y: 3.92, w: cw - 0.64, h: 0.95,
      fontFace: SANS, fontSize: 17, lineSpacing: 25,
      color: c.onDark ? t.onDark : t.onLight,
      valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Intentar servir a todos te hace invisible. Ejecutivos, fades urbanos, home studio premium, barba. Elige uno.", t, { y: 5.35 });
  pie(s);
  s.addNotes(
    "Define marca personal con la frase central. Después el nicho: cuando le hablas a " +
    "todos, no le hablas a nadie.\n\n" +
    "Pídeles que piensen su nicho ahora, en voz baja. Lo van a escribir en el ejercicio."
  );
}

/* 08 · LA GENTE COMPRA PERSONAS */
{
  const s = light();
  K.photoPanel(s, K.photo("barbero-tijera"), { side: "left", w: 4.6 });
  const bx = 4.6 + 0.55;
  const w = W - bx - M;
  K.eyebrow(s, "Módulo 01 · Tu historia", t, { x: bx, w });
  K.headline(s, ["La gente no compra servicios.", { text: "Compra personas.", accent: true }], t, {
    x: bx, y: 1.4, w, size: 30,
  });
  s.addText("Cuando cuento mi historia, bajo la guardia del cliente. Dejo de ser el que corta el pelo y me convierto en alguien con propósito. Ese cliente me recomienda con orgullo.", {
    x: bx, y: 2.75, w, h: 1.1,
    fontFace: SANS, fontSize: 15, italic: true, lineSpacing: 24, color: t.bodyLight,
    valign: "top", margin: 0, isTextBox: true,
  });
  const preguntas = [
    "¿Por qué elegiste este oficio?",
    "¿Cuál fue tu punto de inflexión?",
    "¿Qué dolor personal resolviste?",
    "¿A quién querías parecerte?",
  ];
  preguntas.forEach((q, i) => {
    const y = 4.1 + i * 0.58;
    K.iconBadge(s, pres, { x: bx, y: y + 0.04, d: 0.4, name: "flecha", tone: "morado" });
    s.addText(q, {
      x: bx + 0.58, y, w: w - 0.58, h: 0.48,
      fontFace: SANS, fontSize: 15.5, bold: true, color: t.onLight,
      valign: "middle", margin: 0, isTextBox: true,
    });
  });
  s.addNotes(
    "Cuenta tu propia historia acá, corta: dos minutos, no más. Es el momento del día en " +
    "que la sala se conecta contigo.\n\n" +
    "Después pásales las cuatro preguntas para que armen la suya."
  );
}

/* 09 · LA ECUACIÓN DE VALOR */
{
  const s = light();
  K.eyebrow(s, "Módulo 01 · Precio", t);
  K.tag(s, "La ecuación de valor · Hormozi", t);
  K.headline(s, ["¿Por qué alguien paga más?"], t, { y: 1.15, size: 32 });
  const cw = (CW - 0.66) / 4;
  const cols = [
    { icon: "estrella", dir: "▲ SUBE", label: "RESULTADO\nDESEADO", q: "¿Qué logra el cliente?", c: t.up, dark: true },
    { icon: "check", dir: "▲ SUBE", label: "PROBABILIDAD\nDE ÉXITO", q: "¿Qué tan seguro se siente?", c: t.up, dark: true },
    { icon: "reloj", dir: "▼ BAJA", label: "TIEMPO\nDE ESPERA", q: "¿Cuánto tarda?", c: t.down, dark: false },
    { icon: "filtro", dir: "▼ BAJA", label: "ESFUERZO\nDEL CLIENTE", q: "¿Cuánto le cuesta?", c: t.down, dark: false },
  ];
  cols.forEach((c, i) => {
    const x = M + i * (cw + 0.22);
    K.block(s, pres, { x, y: 2.05, w: cw, h: 3.0, fill: c.dark ? t.darkCard : t.lightCard });
    K.iconBadge(s, pres, { x: x + 0.28, y: 2.3, d: 0.5, name: c.icon, tone: c.dark ? "lila" : "morado" });
    s.addText(c.dir, {
      x: x + 0.9, y: 2.3, w: cw - 1.18, h: 0.5,
      fontFace: MONO, fontSize: 10, bold: true, charSpacing: 1.4, color: c.c,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(c.label, {
      x: x + 0.28, y: 2.98, w: cw - 0.56, h: 1.0,
      fontFace: SANS, fontSize: 18, bold: true, lineSpacing: 23, charSpacing: -0.2,
      color: c.dark ? t.onDark : t.onLight, valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(c.q, {
      x: x + 0.28, y: 4.2, w: cw - 0.56, h: 0.7,
      fontFace: SANS, fontSize: 12.5, italic: true, lineSpacing: 17,
      color: c.dark ? t.mutedDark : t.mutedLight, valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.headline(s, [{ text: "Sube los dos primeros. Baja los dos últimos. El precio se justifica solo.", accent: true }], t, {
    y: 5.35, size: 20,
  });
  pie(s);
  s.addNotes(
    "Traducción concreta: mostrar resultados y explicar antes de cortar suben el numerador; " +
    "reserva online y puntualidad bajan el denominador.\n\n" +
    "Ninguna de las cuatro palancas es 'cortar mejor'."
  );
}

/* 10 · PRECIO EN NIVELES */
{
  const s = light();
  K.eyebrow(s, "Módulo 01 · Precio sin miedo", t);
  K.headline(s, ["Empaqueta el valor. Cobra en niveles."], t, { y: 1.15, size: 31 });
  const cw = (CW - 0.56) / 3;
  const tiers = [
    { icon: "tijera", name: "BÁSICO", price: "$21.000", margin: "margen ~60%", body: "Corte estándar\nSello de atención\nPrecio de entrada", dark: false },
    { icon: "estrella", name: "PREMIUM", price: "$42.000", margin: "margen ~70%", body: "Corte + barba + producto\nDiagnóstico personalizado\nReserva prioritaria", dark: false },
    { icon: "premio", name: "VIP · MEMBRESÍA", price: "$99.000 /mes", margin: "margen ~80%", body: "2 cortes/mes + todo incluido\nCita fija, sin espera\nIngreso predecible para ti", dark: true },
  ];
  tiers.forEach((c, i) => {
    const x = M + i * (cw + 0.28);
    K.block(s, pres, { x, y: 2.0, w: cw, h: 3.35, fill: c.dark ? t.darkCard : t.lightCard });
    K.iconBadge(s, pres, { x: x + 0.34, y: 2.28, d: 0.5, name: c.icon, tone: c.dark ? "lila" : "morado" });
    s.addText(c.name, {
      x: x + 0.96, y: 2.28, w: cw - 1.3, h: 0.5,
      fontFace: MONO, fontSize: 10, bold: true, charSpacing: 2,
      color: c.dark ? t.accentSoft : t.mutedLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(c.price, {
      x: x + 0.34, y: 2.95, w: cw - 0.68, h: 0.66,
      fontFace: SANS, fontSize: 30, bold: true, charSpacing: -1,
      color: c.dark ? t.onDark : t.onLight, valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(c.margin, {
      x: x + 0.34, y: 3.58, w: cw - 0.68, h: 0.28,
      fontFace: SANS, fontSize: 12.5, italic: true,
      color: c.dark ? t.accentSoft : t.mutedLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(c.body, {
      x: x + 0.34, y: 4.0, w: cw - 0.68, h: 1.2,
      fontFace: SANS, fontSize: 13, lineSpacing: 21,
      color: c.dark ? t.mutedDark : t.bodyLight, valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Presenta siempre el más alto primero: el primer número ancla toda la conversación. Y nunca bajes el precio — sube el valor.", t, { y: 5.65, size: 14.5 });
  pie(s);
  s.addNotes(
    "Aclara que los márgenes son de referencia y no descuentan arriendo ni sueldos.\n\n" +
    "La membresía es la joya: ingreso predecible todos los meses, sin depender del clima " +
    "ni del algoritmo."
  );
}

/* 11 · EJERCICIO 01 */
ejercicio({
  n: "01",
  titulo: ["Construye tu frase", { text: "de posicionamiento.", accent: true }],
  minutos: "5 minutos",
  pasos: [
    "¿Quién soy? Tu especialidad o tu enfoque, en una línea.",
    "¿A quién sirvo? Tu cliente ideal, con nombre y apellido si hace falta.",
    "¿Por qué me eligen? Tu diferencial real, no el que te gustaría tener.",
  ],
  entregable: "Una frase que sirve para tu bio de Instagram y para presentarte.",
  notas:
    "Cinco minutos reales, con cronómetro. Después leen tres en voz alta, no más.\n\n" +
    "La frase les sirve para dos cosas: la bio de Instagram y presentarse. Díselo — le da " +
    "sentido al ejercicio.",
});

/* ═══ MÓDULO 02 · IDEAS VIRALES ══════════════════════════════════════════ */
MODULO = "MÓDULO 2 / 5";

/* 12 · DIVIDER M2 */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Módulo 02",
    lines: ["El barbero que", "no se ve,", { text: "no se vende.", accent: true }],
    sub: "Ideas virales: cómo dejar de ser invisible y que el cliente decida pagarte antes de entrar a la silla.",
    size: 62, withLogo: true,
  });
  s.addNotes(
    "Bisagra de todo el workshop: conecta valer más con visibilidad. De nada sirve valer " +
    "si nadie te ve.\n\n" +
    "Antes de la próxima slide: 'saquen el teléfono, abran su último video, pónganlo en " +
    "silencio. ¿Se entiende?'"
  );
}

/* 13 · LOS 4 HOOKS */
{
  const s = light();
  K.eyebrow(s, "Módulo 02 · El hook", t);
  K.tag(s, "El primer segundo lo es todo", t);
  K.headline(s, ["Si no se entiende sin audio,", { text: "el video ya murió.", accent: true }], t, {
    y: 1.15, size: 30,
  });
  const cw = (CW - 0.42) / 4;
  const hooks = [
    { icon: "alerta", n: "01", t: "Dolor", b: "Un problema visual que se entiende al instante." },
    { icon: "ojo", n: "02", t: "Curiosidad", b: "Una promesa abierta que obliga a seguir mirando." },
    { icon: "sonrisa", n: "03", t: "Personalidad", b: "Emoción real: la reacción del cliente en el espejo." },
    { icon: "compartir", n: "04", t: "Referencia viral", b: "Un sonido o tendencia que la gente ya reconoce." },
  ];
  hooks.forEach((h, i) => {
    tarjetaIcono(s, {
      x: M + i * (cw + 0.14), y: 2.3, w: cw, h: 2.25,
      name: h.icon, num: h.n, title: h.t, body: h.b, hot: i === 0, titleSize: 18,
    });
  });
  K.iconBadge(s, pres, { x: M, y: 4.98, d: 0.46, name: "mudo", tone: "morado", fill: t.lightCard });
  s.addText("El 80% ve el primer segundo en silencio. Ese es todo el examen.", {
    x: M + 0.7, y: 4.9, w: CW - 0.7, h: 0.62,
    fontFace: SANS, fontSize: 15, italic: true, color: t.mutedLight,
    valign: "middle", margin: 0, isTextBox: true,
  });
  pie(s);
  s.addNotes(
    "Un hook es el PRIMER SEGUNDO que detiene el scroll. Se entiende SIN AUDIO.\n\n" +
    "Recorre los 4 rápido y pide a la sala un ejemplo de cada uno con sus propios clientes. " +
    "Anota los de dolor en la pizarra: son el ejercicio."
  );
}

/* 14 · FRAMEWORK EYE */
{
  const s = light();
  K.eyebrow(s, "Módulo 02 · Tipos de contenido", t);
  K.tag(s, "Framework EYE", t);
  K.headline(s, ["No todo video es igual."], t, { y: 1.15, size: 31 });
  const cw = (CW - 0.56) / 3;
  const eye = [
    ["E", "play", "Entretenimiento", "Sketches, reacciones, retos.", "ENGANCHA"],
    ["Y", "capas", "Educación", "Tips, datos, tutoriales.", "AUTORIDAD"],
    ["I", "estrella", "Inspiración", "Transformaciones, historias.", "DESEO"],
  ];
  eye.forEach(([letter, ic, title, body, effect], i) => {
    const x = M + i * (cw + 0.28);
    K.block(s, pres, { x, y: 2.0, w: cw, h: 3.3, fill: t.darkCard });
    s.addText(letter, {
      x: x + 0.34, y: 2.15, w: cw - 0.68, h: 1.4,
      fontFace: SANS, fontSize: 78, bold: true, color: t.accent,
      valign: "top", margin: 0, isTextBox: true,
    });
    K.iconBadge(s, pres, { x: x + cw - 0.92, y: 2.32, d: 0.56, name: ic, tone: "lila" });
    s.addText(title, {
      x: x + 0.34, y: 3.85, w: cw - 0.68, h: 0.42,
      fontFace: SANS, fontSize: 21, bold: true, charSpacing: -0.3, color: t.onDark,
      valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(body, {
      x: x + 0.34, y: 4.32, w: cw - 0.68, h: 0.42,
      fontFace: SANS, fontSize: 13.5, color: t.mutedDark, valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(effect, {
      x: x + 0.34, y: 4.78, w: cw - 0.68, h: 0.3,
      fontFace: MONO, fontSize: 10, bold: true, charSpacing: 2.2, color: t.accentSoft,
      valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Los más virales son híbridos: entretener + inspirar. No te quedes solo en tutoriales.", t, { y: 5.6, size: 15 });
  pie(s);
  s.addNotes(
    "Pídeles que identifiquen de qué tipo fue el último video que subieron.\n\n" +
    "Casi todos van a decir educación. Ese es el diagnóstico: educan pero no se comparten."
  );
}

/* 15 · LAS 4 PREGUNTAS */
{
  const s = light();
  K.eyebrow(s, "Módulo 02 · Antes de grabar", t);
  K.headline(s, ["Un sistema, no videos sueltos."], t, { y: 1.15, size: 31 });
  const qs = [
    ["personas", "¿Quién comunica?", "Apareces 7 veces para ser familiar."],
    ["diana", "¿Qué comunicas?", "6 meses en un solo nicho."],
    ["chispa", "¿Cómo lo comunicas?", "Tu personalidad es el diferencial."],
    ["telefono", "¿Dónde lo comunicas?", "TikTok, Instagram, YouTube."],
  ];
  qs.forEach(([ic, q, a], i) => {
    const y = 2.15 + i * 0.9;
    K.block(s, pres, { x: M, y, w: CW, h: 0.76, fill: i % 2 === 0 ? t.lightCard : t.light });
    K.iconBadge(s, pres, { x: M + 0.32, y: y + 0.13, d: 0.5, name: ic, tone: "morado" });
    s.addText(q, {
      x: M + 1.06, y, w: CW * 0.42, h: 0.76,
      fontFace: SANS, fontSize: 20, bold: true, charSpacing: -0.3, color: t.onLight,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(a, {
      x: M + CW * 0.48, y, w: CW * 0.52 - 0.34, h: 0.76,
      fontFace: SANS, fontSize: 16.5, bold: true, color: t.accent,
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "La mayoría abandona en el video 4 y cambia de nicho al mes y medio. Ahí está la diferencia.", t, { y: 5.95, size: 15 });
  pie(s);
  s.addNotes(
    "Los dos números que hay que dejar clavados son el 7 y el 6.\n\n" +
    "El 7: apareces 7 veces antes de resultar familiar. El 6: seis meses en un nicho antes " +
    "de juzgar si funciona."
  );
}

/* 16 · NO SON VIEWS, ES RETENCIÓN */
{
  const s = dark();
  K.eyebrow(s, "Módulo 02 · El algoritmo", t, { onDark: true });
  K.tag(s, "No le importan tus seguidores", t, { onDark: true });
  K.headline(s, ["No son views.", { text: "Es retención.", accent: true }], t, {
    y: 1.2, size: 38, base: t.onDark,
  });
  const izq = [
    ["reloj", "Los primeros 3 segundos", "Es la decisión de distribución"],
    ["grafico", "Watch time", "Cuánto lo ven, del 0% al 100%"],
    ["guardado", "Guardados y compartidos", "El save es el rey"],
  ];
  izq.forEach(([ic, tt, sub], i) => {
    const y = 2.7 + i * 0.86;
    K.iconBadge(s, pres, { x: M, y: y + 0.06, d: 0.5, name: ic, tone: "lila" });
    s.addText(tt, {
      x: M + 0.74, y, w: CW * 0.4, h: 0.36,
      fontFace: SANS, fontSize: 17, bold: true, color: t.onDark,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(sub, {
      x: M + 0.74, y: y + 0.34, w: CW * 0.4, h: 0.3,
      fontFace: SANS, fontSize: 12.5, color: t.mutedDark,
      valign: "middle", margin: 0, isTextBox: true,
    });
  });
  const bx = M + CW * 0.48;
  const bw = CW * 0.52;
  K.block(s, pres, { x: bx, y: 2.55, w: bw, h: 2.9, fill: t.cardOnDark });
  s.addText("EL DATO QUE LO CAMBIA TODO", {
    x: bx + 0.36, y: 2.82, w: bw - 0.72, h: 0.3,
    fontFace: MONO, fontSize: 9.5, bold: true, charSpacing: 2, color: t.accentSoft,
    valign: "middle", margin: 0, isTextBox: true,
  });
  const filas = [
    ["1.000 views + 200 saves", 0.92, t.accent, t.onDark],
    ["10.000 views + 10 saves", 0.18, "4A4258", "7A7488"],
  ];
  filas.forEach(([txt, pct, col, tcol], i) => {
    const y = 3.32 + i * 0.82;
    s.addText(txt, {
      x: bx + 0.36, y, w: bw - 0.72, h: 0.34,
      fontFace: SANS, fontSize: 18, bold: true, color: tcol,
      valign: "middle", margin: 0, isTextBox: true,
    });
    K.meter(s, pres, { x: bx + 0.36, y: y + 0.4, w: bw - 0.72, h: 0.14, pct, fill: col, track: "2E2740" });
  });
  s.addText("Calidad sobre cantidad. Y lo mismo con la retención: 100K views al 80% le gana a 1M al 10%.", {
    x: bx + 0.36, y: 4.95, w: bw - 0.72, h: 0.4,
    fontFace: SANS, fontSize: 12.5, italic: true, color: t.mutedDark,
    valign: "middle", margin: 0, isTextBox: true,
  });
  K.kicker(s, "La pregunta después de cada video es una sola: ¿dónde scrollean? Ahí está la mejora del próximo.", t, { onDark: true, y: 5.85, size: 14 });
  s.addNotes(
    "Los saves mandan. Es la métrica que más subestiman.\n\n" +
    "Cierre del bloque: 'no publiquen más. Publiquen mejor.'"
  );
}

/* 17 · EJERCICIO 02 */
ejercicio({
  n: "02",
  titulo: ["Tus 3 hooks", { text: "de dolor.", accent: true }],
  minutos: "7 minutos",
  pasos: [
    "¿Cuál es el problema visual más común que ves en tus clientes? Cada uno dice UNO en voz alta.",
    "Categorizamos la lista en la pizarra: ¿dolor, curiosidad o personalidad?",
    "Cada uno se queda con SUS tres. Ese es tu banco de hooks del mes.",
  ],
  entregable: "Tres hooks escritos, propios, listos para grabar.",
  notas:
    "Escribe todo en la pizarra y déjalo visible el resto del día. Es el banco de ideas del grupo.\n\n" +
    "Si la sala está fría, empieza tú con un ejemplo tuyo — pero uno solo, después cállate.",
});

/* ═══ MÓDULO 03 · LA CALCULADORA ═════════════════════════════════════════ */
MODULO = "MÓDULO 3 / 5";

/* 18 · DIVIDER M3 */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Módulo 03",
    lines: ["Calculadora", { text: "de viralidad.", accent: true }],
    sub: "Evalúa tu idea ANTES de grabar. Seis preguntas, una nota del 0 al 10.",
    size: 66, withLogo: true,
  });
  // En vez de una foto suelta, los seis criterios como motivo: anticipan el módulo.
  ["ojo", "personas", "compartir", "billete", "grafico", "rayo"].forEach((ic, i) => {
    K.iconBadge(s, pres, {
      x: M + i * 0.86, y: 5.55, d: 0.6, name: ic, tone: "lila", fill: t.cardOnDark,
    });
  });
  s.addNotes(
    "La herramienta con la que se van a ir. Antes de gastar tiempo grabando, puntúa la idea.\n\n" +
    "Si no llega, no la grabes: rediséñala."
  );
}

/* 19 · LOS 6 CRITERIOS */
{
  const s = light();
  K.eyebrow(s, "Módulo 03 · Los 6 criterios", t);
  K.tag(s, "Puntúa cada uno 0 – 10", t);
  K.headline(s, ["¿Vale la pena grabar este video?"], t, { y: 1.15, size: 31 });
  const crit = [
    ["ojo", "01", "¿Niño de 5 años?", "Se entiende sin audio."],
    ["personas", "02", "¿50 de 100?", "Le interesa a la mitad."],
    ["compartir", "03", "¿Referencia viral?", "Usa algo que ya funcionó."],
    ["billete", "04", "¿Mercado viral?", "Existe la demanda."],
    ["grafico", "05", "¿Es tendencia?", "Es del momento."],
    ["rayo", "06", "¿Controversia?", "Genera debate."],
  ];
  const cw = (CW - 0.5) / 3;
  crit.forEach(([ic, n, q, a], i) => {
    tarjetaIcono(s, {
      x: M + (i % 3) * (cw + 0.25), y: 2.0 + Math.floor(i / 3) * 1.85,
      w: cw, h: 1.68, name: ic, num: n, title: q, body: a,
      hot: i === 0, titleSize: 18,
    });
  });
  K.kicker(s, "El promedio es la nota. El 01 es el más importante y el que más falla: si no se entiende mudo, el resto no importa.", t, { y: 5.85, size: 14.5 });
  pie(s);
  s.addNotes(
    "Lee cada criterio como una pregunta de sí/no que puntúan del 0 al 10.\n\n" +
    "No expliques demasiado: el ejercicio siguiente lo enseña mejor que tú."
  );
}

/* 20 · LA ESCALA + EJEMPLOS */
{
  const s = light();
  K.eyebrow(s, "Módulo 03 · La decisión", t);
  K.headline(s, ["Cómo se lee el puntaje"], t, { y: 1.15, size: 31 });
  const scale = [
    ["8.0 – 10", "Graba ahora.", "Probablemente viral", true],
    ["6.0 – 7.9", "Buen contenido.", "Engagement seguro", false],
    ["4.0 – 5.9", "Rediseña la idea.", "Necesita mejora", false],
    ["< 4.0", "Vuelve a empezar.", "No está listo", false],
  ];
  scale.forEach(([range, verdict, note, hot], i) => {
    const y = 2.0 + i * 0.82;
    K.block(s, pres, { x: M, y, w: CW * 0.55, h: 0.68, fill: hot ? t.darkCard : t.lightCard });
    s.addText(range, {
      x: M + 0.32, y, w: 2.1, h: 0.68,
      fontFace: SANS, fontSize: 23, bold: true, charSpacing: -0.6,
      color: hot ? t.accent : (i === 1 ? t.accent : t.mutedLight),
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(verdict, {
      x: M + 2.55, y, w: CW * 0.3, h: 0.68,
      fontFace: SANS, fontSize: 18, bold: true, charSpacing: -0.3,
      color: hot ? t.onDark : t.onLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(note, {
      x: M + CW * 0.55 - 2.4, y, w: 2.1, h: 0.68,
      fontFace: SANS, fontSize: 11.5, color: hot ? t.mutedDark : t.mutedLight,
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
  });
  const bx = M + CW * 0.6;
  const bw = CW * 0.4;
  s.addText("CUATRO IDEAS PUNTUADAS", {
    x: bx, y: 1.98, w: bw, h: 0.3,
    fontFace: MONO, fontSize: 9.5, bold: true, charSpacing: 2, color: t.mutedLight,
    valign: "middle", margin: 0, isTextBox: true,
  });
  const ejemplos = [
    ["Antes/después: pelo quemado → reparado", 0.85, "8.5", true],
    ["Reacción genuina en el espejo", 0.82, "8.2", true],
    ["Corte con sonido del momento", 0.82, "8.2", true],
    ["Tutorial de fade en 30 segundos", 0.75, "7.5", false],
  ];
  ejemplos.forEach(([txt, pct, nota, hot], i) => {
    const y = 2.45 + i * 0.76;
    s.addText(txt, {
      x: bx, y, w: bw - 0.85, h: 0.3,
      fontFace: SANS, fontSize: 12.5, bold: true, color: t.onLight,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(nota, {
      x: bx + bw - 0.8, y, w: 0.8, h: 0.3,
      fontFace: SANS, fontSize: 19, bold: true,
      color: hot ? t.accent : t.mutedLight,
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
    K.meter(s, pres, {
      x: bx, y: y + 0.34, w: bw, h: 0.13, pct,
      fill: hot ? t.accent : "C3B6DC", track: "E0D8C8",
    });
  });
  K.kicker(s, "Una idea de 5.0 llega a 8.0 en dos minutos de conversación. Por eso se puntúa ANTES, no después.", t, { y: 5.85, size: 14.5 });
  pie(s);
  s.addNotes(
    "La regla de decisión. Lo importante no es el número: es que la calculadora te ahorra " +
    "grabar lo que no iba a funcionar.\n\n" +
    "Por qué el tutorial baja: no tiene controversia y no le interesa a 50 de 100."
  );
}

/* 21 · EJERCICIO 03 */
ejercicio({
  n: "03",
  titulo: ["Puntúa tu idea", { text: "en vivo.", accent: true }],
  minutos: "15 minutos",
  pasos: [
    "Tomamos 3 ideas del grupo. Las evaluamos juntos, criterio por criterio, a mano alzada.",
    "Sacamos el promedio en la pizarra y decidimos: ¿se graba, se rediseña o se descarta?",
    "Cada uno puntúa la suya en silencio. Solo se graba lo que llega a 8.",
  ],
  entregable: "Una idea propia con nota ≥ 8, lista para el rodaje.",
  notas:
    "Elige una idea mala a propósito para la tercera. Ver una idea subir de 4.5 a 8.0 con " +
    "dos cambios enseña más que ver tres ideas buenas.\n\n" +
    "Cierra con la predicción: '¿cuál de las 3 creen que va a funcionar mejor?' Votan. " +
    "Se revisa en el grupo de WhatsApp.",
});

/* ═══ CORTE EN VIVO ══════════════════════════════════════════════════════ */
MODULO = "CORTE EN VIVO";

/* 22 · DIVIDER INVITADO */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Invitado especial",
    lines: ["Corte", { text: "en vivo.", accent: true }],
    sub: "Guarden las libretas. Saquen el teléfono. Esto no se mira: esto se graba.",
    size: 96, withLogo: true,
  });
  s.addNotes(
    "Presentas al invitado EN VOZ (no está en la slide). Dices qué va a mostrar y te " +
    "corres del medio.\n\n" +
    "Antes de dejarle el espacio, deja la próxima slide proyectada: es el reparto de planos. " +
    "Que quede en pantalla todo el bloque."
  );
}

/* 23 · EL REPARTO DE PLANOS */
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
  const bx = M + 3 * (cw + 0.147);
  K.block(s, pres, { x: bx, y: 3.5, w: cw, h: 1.28, fill: t.accent });
  K.iconBadge(s, pres, { x: bx + 0.24, y: 3.66, d: 0.42, name: "camara", tone: "blanco" });
  s.addText("SILENCIO DE CÁMARA", {
    x: bx + 0.74, y: 3.66, w: cw - 0.98, h: 0.42,
    fontFace: MONO, fontSize: 9, bold: true, charSpacing: 1.4, color: "FFFFFF",
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("El primer pase de máquina y el reveal en el espejo. Esos dos viralizan.", {
    x: bx + 0.24, y: 4.15, w: cw - 0.48, h: 0.55,
    fontFace: SANS, fontSize: 11, lineSpacing: 14, color: "F0E6FF",
    valign: "top", margin: 0, isTextBox: true,
  });
  K.kicker(s, "Tu plano es obligatorio; el resto es libre. Muchas tomas cortas, nunca una sola larga.", t, { y: 5.35, size: 15 });
  pie(s);
  s.addNotes(
    "Reparte los 7 planos ANTES de que el invitado empiece. Nómbralos uno por uno señalando " +
    "a quién le toca.\n\n" +
    "Insiste en vertical 9:16 aunque el plano parezca pedir horizontal: es el error más común."
  );
}

/* 24 · EJERCICIO 04 */
ejercicio({
  n: "04",
  titulo: ["Graba el", { text: "corte en vivo.", accent: true }],
  minutos: "60 minutos",
  pasos: [
    "Tu plano asignado, primero. Después grabas libre todo lo que quieras.",
    "Silencio de cámara en el primer pase de máquina y en el reveal del espejo.",
    "Al terminar: 3 minutos de revisión. Marca tus 3 mejores clips antes de que se enfríe.",
  ],
  entregable: "Material real, tuyo, grabado hoy. Con esto se edita.",
  notas:
    "Tú también grabas: eres el ejemplo. Y circula por la sala para corregir encuadres.\n\n" +
    "El error que más vas a ver: horizontal, y grabar una sola toma larga en vez de muchas cortas.",
});

/* ═══ MÓDULO 04 · ESTRUCTURA Y EDICIÓN ═══════════════════════════════════ */
MODULO = "MÓDULO 4 / 5";

/* 25 · DIVIDER M4 */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Módulo 04",
    lines: ["La estructura", "de un", { text: "video viral.", accent: true }],
    sub: "No es suerte. Son 15 segundos con 4 partes que siempre se repiten.",
    size: 52, withLogo: true,
  });
  s.addNotes(
    "Ahora lo técnico y lo más accionable. Ya tienen el material del corte en vivo: acá " +
    "aprenden a darle forma."
  );
}

/* 26 · CUATRO PARTES, QUINCE SEGUNDOS */
{
  const s = light();
  K.eyebrow(s, "Módulo 04 · Anatomía", t);
  K.tag(s, "15 segundos", t);
  K.headline(s, ["Cuatro partes, quince segundos"], t, { y: 1.15, size: 31 });
  const parts = [
    { t: "0 – 3 s", n: "Hook", ic: "rayo", d: "Detiene el scroll.\nSin audio.", flex: 0.9, fill: t.darkCard, dark: true },
    { t: "3 – 5 s", n: "Foreshadow", ic: "ojo", d: "Genera intriga.\nMiedo a perdérselo.", flex: 1.0, fill: t.lightCard, dark: false },
    { t: "5 – 12 s", n: "Valor", ic: "estrella", d: "Entretienes, educas\no inspiras.", flex: 1.7, fill: t.accent, dark: true, hot: true },
    { t: "12 – 15 s", n: "CTA", ic: "enlace", d: "Claridad, urgencia,\nescasez.", flex: 0.9, fill: t.darkCard, dark: true },
  ];
  const totalFlex = parts.reduce((a, p) => a + p.flex, 0);
  let x = M;
  parts.forEach((p) => {
    const w = (CW / totalFlex) * p.flex;
    K.block(s, pres, { x, y: 2.05, w, h: 3.2, fill: p.fill });
    K.iconBadge(s, pres, { x: x + 0.26, y: 2.3, d: 0.5, name: p.ic, tone: p.hot ? "blanco" : "lila" });
    s.addText(p.t, {
      x: x + 0.26, y: 2.95, w: w - 0.52, h: 0.28,
      fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 1.6,
      color: p.hot ? "E6D6FF" : (p.dark ? t.accentSoft : t.accent),
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(p.n, {
      x: x + 0.26, y: 3.35, w: w - 0.52, h: 0.55,
      fontFace: SANS, fontSize: 24, bold: true, charSpacing: -0.5,
      color: p.dark ? "FFFFFF" : t.onLight, valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(p.d, {
      x: x + 0.26, y: 3.98, w: w - 0.52, h: 1.0,
      fontFace: SANS, fontSize: 12.5, lineSpacing: 18,
      color: p.hot ? "F0E6FF" : (p.dark ? t.mutedDark : t.bodyLight),
      valign: "top", margin: 0, isTextBox: true,
    });
    x += w;
  });
  K.kicker(s, "Quita una parte y el video se cae. El que más se saltan es el foreshadow.", t, { y: 5.6, size: 15 });
  pie(s);
  s.addNotes(
    "Esta es la slide que más van a querer fotografiar. Anúncialo y dales 5 segundos.\n\n" +
    "Después mapea los clips que acaban de grabar contra las 4 partes: ¿cuál es tu hook? " +
    "¿tienes reveal para el valor?"
  );
}

/* 27 · LOS 5 FORMATOS */
{
  const s = light();
  K.eyebrow(s, "Módulo 04 · Formatos", t);
  K.tag(s, "Rota entre los 5", t);
  K.headline(s, ["Qué grabas el lunes."], t, { y: 1.15, size: 31 });
  const formatos = [
    ["capas", "Antes / Después", "La transformación visual."],
    ["play", "Tutorial rápido", "Cómo se hace, paso a paso."],
    ["tijera", "Satisfacción visual", "El corte limpio y preciso. ASMR."],
    ["corazon", "Reacción genuina", "El cliente viéndose en el espejo."],
    ["compartir", "Hack / Trend", "Técnica nueva + sonido del momento."],
  ];
  formatos.forEach(([ic, title, note], i) => {
    filaIcono(s, {
      y: 2.05 + i * 0.76, h: 0.64, name: ic, title, note,
      fill: i % 2 === 0 ? t.lightCard : t.light, titleSize: 18,
    });
  });
  K.kicker(s, "El antes/después es hook Y formato a la vez: por eso funciona tanto. Pero si subes solo eso, cansas a tu audiencia.", t, { y: 5.95, size: 14.5 });
  pie(s);
  s.addNotes(
    "Rota entre los 5. El error típico es hacer solo antes/después hasta quemarlo.\n\n" +
    "Los dos últimos casi no requieren guion: son los que pueden grabar mañana."
  );
}

/* 28 · GUIONIZACIÓN */
{
  const s = light();
  K.eyebrow(s, "Módulo 04 · Guionización", t);
  K.headline(s, ["Si saltas una pregunta,", { text: "el video muere.", accent: true }], t, {
    y: 1.25, size: 33,
  });
  K.deck(s, "Escribe las 5 preguntas que se va a hacer tu audiencia y respóndelas EN ORDEN, antes de que las piensen.", t, { y: 2.5, w: CW * 0.4, size: 15 });
  K.iconBadge(s, pres, { x: M, y: 4.35, d: 0.44, name: "chispa", tone: "morado" });
  s.addText("Invierte la expectativa: la primicia del paso 02 es lo que hace que se queden.", {
    x: M + 0.62, y: 4.28, w: CW * 0.38, h: 0.6,
    fontFace: SANS, fontSize: 13.5, italic: true, lineSpacing: 19, color: t.mutedLight,
    valign: "middle", margin: 0, isTextBox: true,
  });
  const bx = M + CW * 0.46;
  const bw = CW * 0.54;
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
      fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 2,
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
      color: hot ? "F0E6FF" : t.mutedLight, valign: "middle", margin: 0, isTextBox: true,
    });
  });
  pie(s);
  s.addNotes(
    "Cinco preguntas respondidas en orden = un video viral. Es el framework más accionable " +
    "del día después de la calculadora.\n\n" +
    "Que escriban las 5 de su idea ahora mismo, en el margen de la hoja."
  );
}

/* 29 · EDICIÓN EN 4 PASOS */
{
  const s = light();
  K.eyebrow(s, "Módulo 04 · Framework de edición", t);
  K.tag(s, "CapCut · 4 pasos", t);
  K.headline(s, ["Basura adentro = basura afuera."], t, { y: 1.15, size: 31 });
  const pasos = [
    ["filtro", "Importa y selecciona", "Solo lo mejor entra al timeline."],
    ["capas", "Estructura y corta silencios", "Elimina los muertos. Ritmo constante."],
    ["chispa", "Agrega", "Subtítulos, efectos, sonido de tendencia."],
    ["telefono", "Exporta", "MP4 vertical 9:16 — formato nativo."],
  ];
  pasos.forEach(([ic, title, note], i) => {
    filaIcono(s, {
      y: 2.05 + i * 0.84, h: 0.7, name: ic, title, note,
      fill: i === 0 ? t.darkCard : t.lightCard, hot: i === 0, titleSize: 18,
    });
  });
  K.iconBadge(s, pres, { x: M, y: 5.65, d: 0.44, name: "billete", tone: "morado" });
  s.addText("Con $100 de equipo le ganas a quien gasta $10.000. Teléfono (ya lo tienes) + micrófono ~$50 USD + trípode ~$20–50 USD.", {
    x: M + 0.62, y: 5.58, w: CW - 0.62, h: 0.6,
    fontFace: SANS, fontSize: 13.5, italic: true, color: t.mutedLight,
    valign: "middle", margin: 0, isTextBox: true,
  });
  pie(s);
  s.addNotes(
    "El paso 1 es el que todos se saltan y el que más importa: la mayoría importa todo y " +
    "después no puede decidir.\n\n" +
    "La herramienta no hace el video. La idea lo hace."
  );
}

/* 30 · EJERCICIO 05 */
ejercicio({
  n: "05",
  titulo: ["Sprint", { text: "de edición.", accent: true }],
  minutos: "45 minutos",
  pasos: [
    "Abre CapCut con el material del corte en vivo. Solo tus 3 mejores clips entran.",
    "Arma los 15 segundos: hook, foreshadow, valor, CTA. Cronométralo de verdad.",
    "Subtítulos, sonido de tendencia, y exportas en MP4 vertical 9:16.",
  ],
  entregable: "Un video de 15 segundos exportado y listo para publicar.",
  notas:
    "Circula por la sala. La corrección más frecuente: el hook es demasiado largo. Si a " +
    "los 3 segundos no pasó nada, se corta.\n\n" +
    "Los que terminan antes ayudan a los que van atrasados: eso arma la comunidad.",
});

/* ═══ MÓDULO 05 · DEL SCROLL A LA SILLA ══════════════════════════════════ */
MODULO = "MÓDULO 5 / 5";

/* 31 · DIVIDER M5 */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Módulo 05",
    lines: ["Del scroll", { text: "a la silla.", accent: true }],
    sub: "Tienen el video. Lo que falta es el camino que convierte al que mira en un cliente sentado.",
    image: K.photo("bruno-cortando"), imageSide: "left",
    size: 58, withLogo: true,
  });
  s.addNotes("'10.000 seguidores. Cero clientes. ¿A cuántos les suena?'");
}

/* 32 · EL EMBUDO DE 7 PASOS */
{
  const s = dark();
  K.eyebrow(s, "Módulo 05 · El sistema", t, { onDark: true });
  K.tag(s, "El paso 4 es donde falla la mayoría", t, { onDark: true });
  K.headline(s, ["No es UN paso.", { text: "Es un SISTEMA.", accent: true }], t, {
    y: 1.15, size: 36, base: t.onDark,
  });
  const steps = [
    ["play", "1", "Video viral", "Un hook detiene el scroll"],
    ["ojo", "2", "Alguien ve", "El algoritmo distribuye"],
    ["personas", "3", "Te sigue", "Empieza a confiar"],
    ["enlace", "4", "Click en bio", "Link directo a WhatsApp"],
    ["chat", "5", "WhatsApp", "Llega el mensaje"],
    ["check", "6", "Cierras la venta", "Dos horarios, no preguntas"],
    ["premio", "7", "Leal + referidos", "Recomienda 2–3 amigos"],
  ];
  const cw = (CW - 0.72) / 4;
  steps.forEach(([ic, n, label, sub], i) => {
    const x = M + (i % 4) * (cw + 0.24);
    const y = 2.5 + Math.floor(i / 4) * 1.5;
    const hot = i === 3;
    K.block(s, pres, { x, y, w: cw, h: 1.28, fill: hot ? t.accent : t.cardOnDark });
    K.iconBadge(s, pres, { x: x + 0.26, y: y + 0.2, d: 0.44, name: ic, tone: hot ? "blanco" : "lila" });
    s.addText(n, {
      x: x + cw - 0.74, y: y + 0.16, w: 0.5, h: 0.4,
      fontFace: SANS, fontSize: 18, bold: true, color: hot ? "E6D6FF" : t.accent,
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(label, {
      x: x + 0.26, y: y + 0.7, w: cw - 0.52, h: 0.3,
      fontFace: SANS, fontSize: 15, bold: true, charSpacing: -0.2,
      color: hot ? "FFFFFF" : t.onDark, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(sub, {
      x: x + 0.26, y: y + 0.98, w: cw - 0.52, h: 0.26,
      fontFace: SANS, fontSize: 10.5, color: hot ? "F0E6FF" : t.mutedDark,
      valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Video viral sin sistema = nada. Y el link de la bio va DIRECTO a WhatsApp: no a una web, no a un linktree, no al direct.", t, { onDark: true, y: 5.72, size: 14 });
  s.addNotes(
    "El punto débil de TODO barbero es el paso 4.\n\n" +
    "Acá se para la clase: teléfono en mano, dos minutos, todos arreglan la bio. No es tarea."
  );
}

/* 33 · TU BIO */
{
  const s = light();
  K.eyebrow(s, "Módulo 05 · Perfil", t);
  K.tag(s, "Tu bio es tu vendedor 24/7", t);
  K.headline(s, ["Claridad mata la confusión."], t, { y: 1.3, size: 33 });
  K.deck(s, "Y la confusión mata la conversión. Un perfil que no dice qué haces y para quién es plata tirada al piso.", t, { y: 2.5, w: CW * 0.42, size: 15 });
  K.iconBadge(s, pres, { x: M, y: 4.35, d: 0.5, name: "reloj", tone: "morado", fill: t.lightCard });
  s.addText("Arréglala AHORA, con el teléfono en la mano. Toma 2 minutos y es el paso del embudo que más falla.", {
    x: M + 0.72, y: 4.28, w: CW * 0.4, h: 0.7,
    fontFace: SANS, fontSize: 14, bold: true, lineSpacing: 20, color: t.onLight,
    valign: "middle", margin: 0, isTextBox: true,
  });
  const bx = M + CW * 0.47;
  const bw = CW * 0.53;
  K.block(s, pres, { x: bx, y: 2.2, w: bw, h: 1.5, fill: t.darkCard });
  K.iconBadge(s, pres, { x: bx + 0.32, y: 2.42, d: 0.42, name: "cruz", tone: "crema" });
  s.addText("ANTES — INFO INÚTIL", {
    x: bx + 0.84, y: 2.42, w: bw - 1.1, h: 0.42,
    fontFace: MONO, fontSize: 9.5, bold: true, charSpacing: 1.6, color: t.mutedDark,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("“Barbero profesional | Diseños custom | Sígueme”", {
    x: bx + 0.32, y: 2.95, w: bw - 0.64, h: 0.6,
    fontFace: SANS, fontSize: 15, italic: true, lineSpacing: 21, color: t.mutedDark,
    valign: "top", margin: 0, isTextBox: true,
  });
  K.block(s, pres, { x: bx, y: 3.9, w: bw, h: 1.5, fill: t.accent });
  K.iconBadge(s, pres, { x: bx + 0.32, y: 4.12, d: 0.42, name: "check", tone: "blanco" });
  s.addText("AHORA — CONVIERTE", {
    x: bx + 0.84, y: 4.12, w: bw - 1.1, h: 0.42,
    fontFace: MONO, fontSize: 9.5, bold: true, charSpacing: 1.6, color: "E6D6FF",
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("“Cortes desde $21k | Disponibilidad: WhatsApp 👇”", {
    x: bx + 0.32, y: 4.65, w: bw - 0.64, h: 0.6,
    fontFace: SANS, fontSize: 15, bold: true, lineSpacing: 21, color: "FFFFFF",
    valign: "top", margin: 0, isTextBox: true,
  });
  K.kicker(s, "Tres cosas y nada más: qué haces, cuánto cuesta, dónde se agenda.", t, { y: 5.85, size: 15 });
  pie(s);
  s.addNotes(
    "Este es el ejercicio de mayor impacto por minuto de todo el día.\n\n" +
    "Que levanten el teléfono y lo hagan ahora. Anda revisando que lo hagan de verdad."
  );
}

/* 34 · EL MENSAJE QUE CIERRA */
{
  const s = light();
  K.eyebrow(s, "Módulo 05 · El script de WhatsApp", t);
  K.headline(s, ["El mensaje que convierte."], t, { y: 1.15, size: 32 });
  K.block(s, pres, { x: M, y: 2.05, w: CW * 0.48, h: 3.1, fill: t.darkCard });
  K.iconBadge(s, pres, { x: M + 0.36, y: 2.3, d: 0.44, name: "chat", tone: "lila" });
  s.addText("SCRIPT", {
    x: M + 0.9, y: 2.3, w: CW * 0.48 - 1.26, h: 0.44,
    fontFace: MONO, fontSize: 10, bold: true, charSpacing: 2.2, color: t.accentSoft,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("“¡Hola! 👋 Qué bueno que viste el video.\nSomos especializados en [tipo de corte].\n¿Te gustaría una cita?\nTengo hoy 5pm o mañana 3pm.”", {
    x: M + 0.36, y: 2.95, w: CW * 0.48 - 0.72, h: 1.9,
    fontFace: SANS, fontSize: 15.5, italic: true, lineSpacing: 29, color: t.onDark,
    valign: "top", margin: 0, isTextBox: true,
  });
  const rx = M + CW * 0.52;
  const rw = CW * 0.48;
  const reasons = [
    ["personas", "Saludas — humano", "Conexión antes que venta"],
    ["play", "Confirmas el video", "Das contexto inmediato"],
    ["reloj", "Dos opciones de horario", "Facilitas la decisión"],
    ["check", "Sin preguntas abiertas", "Sin confusión = más cierres"],
  ];
  reasons.forEach(([ic, h, sub], i) => {
    const y = 2.05 + i * 0.8;
    const hot = i === 2;
    K.block(s, pres, { x: rx, y, w: rw, h: 0.68, fill: hot ? t.accent : t.lightCard });
    K.iconBadge(s, pres, { x: rx + 0.26, y: y + 0.13, d: 0.42, name: ic, tone: hot ? "blanco" : "morado" });
    s.addText(h, {
      x: rx + 0.82, y: y + 0.05, w: rw - 1.1, h: 0.3,
      fontFace: SANS, fontSize: 14.5, bold: true, color: hot ? "FFFFFF" : t.onLight,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(sub, {
      x: rx + 0.82, y: y + 0.33, w: rw - 1.1, h: 0.28,
      fontFace: SANS, fontSize: 11.5, italic: true, color: hot ? "F0E6FF" : t.mutedLight,
      valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Y si pregunta el precio: “Depende del tipo de corte, el estándar desde $21k. ¿Cuál de los dos horarios te va mejor?” No es negociar: es redirigir.", t, { y: 5.55, size: 14 });
  pie(s);
  s.addNotes(
    "Lee el script en voz alta, tal cual. Que lo copien palabra por palabra — después lo " +
    "adaptan.\n\n" +
    "El detalle que hace la diferencia son los dos horarios cerrados. '¿Cuándo te queda " +
    "bien?' abre una conversación de diez mensajes que termina en nada."
  );
}

/* 35 · TESTIMONIOS + RECOMENDADO */
{
  const s = dark();
  K.eyebrow(s, "Módulo 05 · Prueba social y referidos", t, { onDark: true });
  K.headline(s, ["Si cada cliente trae 1 más,", { text: "duplicas ingresos.", accent: true }], t, {
    y: 1.15, size: 34, base: t.onDark,
  });
  const cw = (CW - 0.56) / 3;
  const cards = [
    { ic: "billete", label: "CAC del recomendado", value: "$0", foot: "Costo de adquisición", hot: false },
    { ic: "grafico", label: "LTV del recomendado", value: "$1.428.000", foot: "2× el cliente regular, a 2 años", hot: true },
    { ic: "personas", label: "1 recomendado cada 3 meses", value: "$2.856.000", foot: "extra al año, sin invertir", hot: false },
  ];
  cards.forEach((c, i) => {
    const x = M + i * (cw + 0.28);
    K.block(s, pres, { x, y: 2.4, w: cw, h: 2.25, fill: c.hot ? t.accent : t.cardOnDark });
    K.iconBadge(s, pres, { x: x + 0.3, y: 2.65, d: 0.46, name: c.ic, tone: c.hot ? "blanco" : "lila" });
    K.stat(s, t, {
      x: x + 0.3, y: 3.3, w: cw - 0.6, label: c.label, value: c.value, foot: c.foot,
      labelColor: c.hot ? "E6D6FF" : t.mutedDark,
      valueColor: c.hot ? "FFFFFF" : t.onDark,
      footColor: c.hot ? "F0E6FF" : t.mutedDark,
      valueSize: 28,
    });
  });
  s.addText("Cómo se pide:  “Oye, ¿te quedó bien?”  →  [dice que sí]  →  “Perfecto. Si conoces a alguien que quiera verse así, pásame su WhatsApp.”", {
    x: M, y: 4.95, w: CW, h: 0.45,
    fontFace: SANS, fontSize: 13.5, color: t.accentSoft,
    valign: "middle", margin: 0, isTextBox: true,
  });
  K.kicker(s, "Y antes de eso: 1 testimonio = 5 reels tuyos en impacto. Filmas 10 segundos después del corte. 3–4 por mes alcanzan.", t, { onDark: true, y: 5.6, size: 14 });
  s.addNotes(
    "Este es el slide que cambia mentalidades. Demuéstralo con números, no con entusiasmo.\n\n" +
    "El recomendado ya llegó con la confianza construida: ya pagó, ya fue, ya confía.\n\n" +
    "OJO: antes de prometer 'X referencias = corte gratis', chequea que calce con la tarjeta " +
    "de fidelidad de Brunetti (10 estrellas = corte gratis)."
  );
}

/* 36 · LAS 4 MÉTRICAS */
{
  const s = light();
  K.eyebrow(s, "Módulo 05 · Crecimiento", t);
  K.tag(s, "Las 4 métricas que debes trackear", t);
  K.headline(s, ["Sin números no puedes mejorar."], t, { y: 1.15, size: 32 });
  const metrics = [
    ["personas", "Clientes nuevos / mes", "¿De dónde vienen? Pregunta siempre."],
    ["chat", "Tasa de conversión", "De 10 leads en WhatsApp, ¿cuántos cierran?"],
    ["compartir", "Recomendados", "De 10 clientes, ¿cuántos traen amigos?"],
    ["calendario", "Retención", "De 10 nuevos, ¿cuántos vuelven en 3 meses?"],
  ];
  metrics.forEach(([ic, title, q], i) => {
    filaIcono(s, {
      y: 2.05 + i * 0.9, h: 0.76, name: ic, title, note: q,
      fill: i === 0 ? t.darkCard : t.lightCard, hot: i === 0, titleSize: 18,
    });
  });
  K.kicker(s, "Lo que no se mide no se puede escalar. Cuatro números, una vez al mes, en el teléfono.", t, { y: 5.9, size: 15 });
  pie(s);
  s.addNotes(
    "La primera es la más fácil y la que nadie hace: preguntarle a cada cliente nuevo de " +
    "dónde salió.\n\n" +
    "Sin ese dato no sabes qué video funcionó de verdad."
  );
}

/* ═══ CIERRE ═════════════════════════════════════════════════════════════ */
MODULO = "ASCENSIÓN";

/* 37 · PUBLICA HOY + CONCURSO */
{
  const s = dark();
  K.iconBadge(s, pres, { x: M, y: 0.4, d: 0.42, name: "premio", tone: "morado" });
  s.addText("EL ÚLTIMO EJERCICIO", {
    x: M + 0.56, y: 0.4, w: 5, h: 0.42,
    fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 2.6, color: t.accent,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("Ahora", {
    x: M + CW - 4.15 - 3.5, y: 0.36, w: 3.5, h: 0.5,
    fontFace: SANS, fontSize: 22, bold: true, color: t.onDark,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  K.headline(s, ["Publica.", { text: "Y entras al concurso.", accent: true }], t, {
    y: 1.35, w: CW - 4.15, size: 31, base: t.onDark,
  });
  K.photoPanel(s, K.photo("trio-diploma"), { side: "right", w: 3.9 });
  const anchoTexto = CW - 4.15;
  const cw = (anchoTexto - 0.4) / 3;
  [
    ["telefono", "TikTok", "Sin marca de agua"],
    ["compartir", "Instagram", "Etiqueta a @brunetticutz"],
    ["play", "Shorts", "El mismo archivo"],
  ].forEach(([ic, p, d], i) => {
    const x = M + i * (cw + 0.2);
    K.block(s, pres, { x, y: 3.35, w: cw, h: 1.2, fill: t.cardOnDark });
    K.iconBadge(s, pres, { x: x + 0.26, y: 3.52, d: 0.4, name: ic, tone: "lila" });
    s.addText(p, {
      x: x + 0.26, y: 3.98, w: cw - 0.52, h: 0.3,
      fontFace: SANS, fontSize: 15, bold: true, color: t.onDark,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(d, {
      x: x + 0.26, y: 4.26, w: cw - 0.52, h: 0.24,
      fontFace: SANS, fontSize: 10, color: t.mutedDark,
      valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.block(s, pres, { x: M, y: 4.75, w: anchoTexto, h: 1.9, fill: t.accent });
  s.addText("EL CONCURSO DEL WORKSHOP", {
    x: M + 0.42, y: 4.98, w: anchoTexto - 0.84, h: 0.3,
    fontFace: MONO, fontSize: 11, bold: true, charSpacing: 2.6, color: "E6D6FF",
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("El mejor reel se lleva el Kit Tadeus.", {
    x: M + 0.42, y: 5.32, w: anchoTexto - 0.84, h: 0.55,
    fontFace: SANS, fontSize: 27, bold: true, charSpacing: -0.8, color: "FFFFFF",
    valign: "top", margin: 0, isTextBox: true,
  });
  s.addText("Kit completo + capa bordada con tu nombre + gorro Brunetti. Un kit, un ganador.", {
    x: M + 0.42, y: 5.94, w: anchoTexto - 0.84, h: 0.5,
    fontFace: SANS, fontSize: 13, lineSpacing: 19, color: "F0E6FF",
    valign: "top", margin: 0, isTextBox: true,
  });
  s.addNotes(
    "Que publiquen EN LA SALA, no después. El que sale por la puerta sin publicar, no publica.\n\n" +
    "Mientras suben, anota quién publicó — sirve para el seguimiento en el grupo."
  );
}

/* 38 · PARA LLEVARTE */
{
  const s = light();
  K.eyebrow(s, "Para llevarte", t);
  K.headline(s, ["Tres ideas y una acción."], t, { y: 1.15, size: 32 });
  const cw = (CW - 0.56) / 3;
  [
    ["estrella", "01", "No es cortar mejor.", "Es valer más. El mercado paga por lo que percibe."],
    ["ojo", "02", "El que no se ve, no se vende.", "Si no se entiende sin audio, el video ya murió."],
    ["ajustes", "03", "Evalúa antes de grabar.", "Seis criterios, dos minutos, una decisión."],
  ].forEach(([ic, n, title, body], i) => {
    tarjetaIcono(s, {
      x: M + i * (cw + 0.28), y: 2.05, w: cw, h: 2.5,
      name: ic, num: n, title, body, titleSize: 18,
    });
  });
  K.block(s, pres, { x: M, y: 4.85, w: CW, h: 1.1, fill: t.darkCard });
  K.iconBadge(s, pres, { x: M + 0.36, y: 5.12, d: 0.5, name: "calendario", tone: "lila" });
  s.addText("El lunes publico un video de ______ con hook de ______.", {
    x: M + 1.0, y: 4.98, w: CW - 1.4, h: 0.5,
    fontFace: SANS, fontSize: 22, bold: true, charSpacing: -0.3, color: t.onDark,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("Lo dices en voz alta. Eso es lo que hace que se publique.", {
    x: M + 1.0, y: 5.46, w: CW - 1.4, h: 0.32,
    fontFace: SANS, fontSize: 13, italic: true, color: t.mutedDark,
    valign: "middle", margin: 0, isTextBox: true,
  });
  pie(s);
  s.addNotes(
    "Cada uno completa la frase en voz alta. Uno por uno, rápido, sin comentarios.\n\n" +
    "El compromiso público es lo que hace que el video efectivamente se publique."
  );
}

/* 39 · NOS VEMOS EN EL FEED */
{
  const s = pres.addSlide();
  s.background = { color: t.dark };
  const band = 4.8;
  s.addImage({ path: K.photo("grupo-final-limpia"), x: 0, y: 0, w: W, h: band, sizing: { type: "cover", w: W, h: band } });
  K.headline(s, ["Nos vemos", { text: "en el feed.", accent: true }], t, {
    y: band + 0.42, size: 34, base: t.onDark, lineSpacingMult: 1.05,
  });
  K.logo(s, { x: W - M, y: band + 0.38, h: 0.9, align: "right" });
  K.wordmark(s, { x: M, y: H - 0.95, h: 0.32, tone: "crema" });
  s.addText("@brunetticutz   ·   brunetticutz.cl", {
    x: M + CW * 0.4, y: H - 0.95, w: CW * 0.6, h: 0.32,
    fontFace: MONO, fontSize: 12, bold: true, charSpacing: 1.4, color: t.accentSoft,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes("Foto grupal para cerrar con energía. Que saquen la foto ellos también — es contenido, y arranca el concurso.");
}

const out = path.join(__dirname, "..", "decks", "ASCENSION-completo.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("✔", out));
