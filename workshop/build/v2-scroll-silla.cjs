/**
 * V2 — Del scroll a la silla
 *
 * El deck del dinero. Abre con la economía cruda (10.000 seguidores = $0), recorre
 * precio → atención → conversión, y cierra con la máquina de referidos. Menos
 * inspiración, más caja. Para una sala que ya publica pero no factura.
 */

const pptxgen = require("pptxgenjs");
const path = require("path");
const K = require("./kit.cjs");

const t = K.ORO;
const { W, H, M, CW, MONO, SANS } = K;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Bruno Herrera · Brunetticutz";
pres.title = "Del scroll a la silla — Workshop de barberos";

const light = () => { const s = pres.addSlide(); s.background = { color: t.light }; return s; };
const dark = () => { const s = pres.addSlide(); s.background = { color: t.dark }; return s; };

/* 01 · PORTADA ─────────────────────────────────────────────────────────── */
{
  const s = dark();
  K.photoPanel(s, K.photo("bruno-presenta"), { side: "right", w: 4.7 });
  const w = CW - 4.7;
  s.addText("WORKSHOP DE BARBEROS · 6 HORAS", {
    x: M, y: 0.9, w, h: 0.32, fontFace: MONO, fontSize: 11.5, bold: true,
    charSpacing: 3, color: t.accent, valign: "middle", margin: 0, isTextBox: true,
  });
  K.headline(s, [
    "10.000 seguidores.",
    { text: "$0 en la caja.", accent: true },
  ], t, { y: 2.7, w, size: 50, base: t.onDark, lineSpacingMult: 1.08 });
  s.addText("Del scroll a la silla: cómo un video se convierte en un cliente sentado.", {
    x: M, y: 4.3, w, h: 0.6, fontFace: SANS, fontSize: 15, lineSpacing: 23,
    color: t.mutedDark, valign: "top", margin: 0, isTextBox: true,
  });
  s.addText("Bruno Herrera · Brunetticutz", {
    x: M, y: H - 1.35, w, h: 0.3, fontFace: SANS, fontSize: 13.5, bold: true,
    color: t.onDark, valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("Precio  ·  Atención  ·  Conversión", {
    x: M, y: H - 1.0, w, h: 0.3, fontFace: MONO, fontSize: 11, charSpacing: 1.6,
    color: t.mutedDark, valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes(
    "Empieza con el número, no con tu nombre. 'Levanten la mano los que tienen más de " +
    "mil seguidores. … Ahora los que consiguieron un cliente esta semana por un video.'\n\n" +
    "La distancia entre esas dos manos es el workshop entero."
  );
}

/* 02 · AUDIENCIA ≠ CONVERSIÓN ─────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "El problema real", t);
  K.tag(s, "Audiencia ≠ conversión", t);
  K.headline(s, [
    "Muchos barberos generan vistas.",
    { text: "Y cero clientes.", accent: true },
  ], t, { y: 1.25, size: 33 });
  K.deck(s, "No tienen sistema. Sin sistema, los seguidores son solo un número bonito en la pantalla.", t, { y: 2.5, w: CW * 0.5, size: 15 });
  const cw = (CW - 0.4) / 2;
  K.block(s, pres, { x: M + CW - cw * 2 - 0.4, y: 3.5, w: cw, h: 2.15, fill: t.darkCard });
  K.stat(s, t, {
    x: M + CW - cw * 2 - 0.4 + 0.34, y: 3.8, w: cw - 0.68,
    label: "✗ No es esto", value: "10.000 followers", foot: "Sin conversión = $0",
    labelColor: t.down, valueColor: t.onDark, footColor: t.down, valueSize: 30,
  });
  K.block(s, pres, { x: M + CW - cw, y: 3.5, w: cw, h: 2.15, fill: t.accent });
  K.stat(s, t, {
    x: M + CW - cw + 0.34, y: 3.8, w: cw - 0.68,
    label: "✓ Es esto", value: "100 clientes", foot: "= $2.100.000 / mes",
    labelColor: "3A2E12", valueColor: "121212", footColor: "3A2E12", valueSize: 30,
  });
  K.footer(s, t, { right: "DEL SCROLL A LA SILLA" });
  s.addNotes(
    "Los $2.100.000 salen de 100 clientes × $21.000, un corte al mes cada uno. Decilo — " +
    "si no explicas el supuesto, alguien lo va a cuestionar y pierdes el momento.\n\n" +
    "El punto: no es seguidores. Es conversión."
  );
}

/* 03 · LA MATEMÁTICA QUE NADIE HACE ──────────────────────────────────── */
{
  const s = dark();
  K.eyebrow(s, "La matemática que nadie hace", t, { onDark: true });
  K.headline(s, ["¿Cuánto vale un cliente tuyo", { text: "en dos años?", accent: true }], t, {
    y: 1.15, size: 33, base: t.onDark,
  });
  const cw = (CW - 0.66) / 4;
  const chain = [
    ["Precio del corte", "$21.000", "estándar"],
    ["Frecuencia", "17", "cortes al año"],
    ["Al año", "$357.000", "por cliente"],
    ["LTV a 2 años", "$714.000", "y ahí recién empieza"],
  ];
  chain.forEach(([label, value, foot], i) => {
    const x = M + i * (cw + 0.22);
    const hot = i === 3;
    K.block(s, pres, { x, y: 2.5, w: cw, h: 2.1, fill: hot ? t.accent : t.cardOnDark });
    K.stat(s, t, {
      x: x + 0.3, y: 2.78, w: cw - 0.6, label, value, foot,
      labelColor: hot ? "3A2E12" : t.mutedDark,
      valueColor: hot ? "121212" : t.onDark,
      footColor: hot ? "3A2E12" : t.mutedDark,
      valueSize: 30,
    });
  });
  K.kicker(s, "Un cliente cada 3 semanas son 17 cortes al año. Nadie hace esta cuenta — y es la que define cuánto puedes invertir en conseguirlo.", t, { onDark: true, y: 5.25, size: 14 });
  s.addNotes(
    "Anda número por número, despacio. Que la sala haga la cuenta mental contigo.\n\n" +
    "Después: 'el que cobra $30.000 tiene un LTV de $1.020.000'. Y ahí lanzas el ejercicio " +
    "de mapeo: que cada uno calcule el suyo."
  );
}

/* 04 · EL RECORRIDO DE HOY ────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "El recorrido de hoy", t);
  K.tag(s, "6 horas · 3 partes", t);
  const parts = [
    ["01", "El precio", "Por qué te pagan lo que te pagan", "50 min"],
    ["02", "La atención", "Dejar de ser invisible", "50 min"],
    ["—", "Corte en vivo", "Invitado especial. Y la sala graba", "60 min"],
    ["03", "La conversión", "Del scroll a la silla", "100 min"],
    ["—", "Plan de acción", "Métricas y concurso", "20 min"],
  ];
  parts.forEach(([n, title, note, dur], i) => {
    const y = 1.55 + i * 0.98;
    K.row(s, pres, t, {
      y, h: 0.8, num: n, title, note: `${note}   ·   ${dur}`,
      titleSize: 24, fill: i === 2 ? t.lightCard : undefined,
      numColor: n === "—" ? t.mutedLight : t.accent,
    });
  });
  K.footer(s, t, { right: "DEL SCROLL A LA SILLA" });
  s.addNotes(
    "Tres partes y un corte en vivo. Deja dicho desde ahora que en el corte en vivo se " +
    "GRABA — no se mira.\n\n" +
    "Así llegan al bloque con el teléfono cargado y sin sorpresa."
  );
}

/* 05 · DIVIDER 01 ─────────────────────────────────────────────────────── */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Parte 01",
    lines: ["El", { text: "precio.", accent: true }],
    sub: "Dos barberos con la misma técnica. Uno cobra el doble. La diferencia no está en la tijera.",
    image: K.photo("bruno-cortando"),
    size: 84,
  });
  s.addNotes("Pregunta: '¿cuánto cobras hoy?' No pidas que respondan en voz alta — que lo anoten.");
}

/* 06 · EL PRECIO MENTAL ───────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Parte 01 · Monetización", t);
  K.headline(s, ["El problema no es la tijera.", { text: "Es el precio mental.", accent: true }], t, {
    y: 1.3, size: 34,
  });
  K.deck(s, "Competir por precio solo atrae clientes que se van cuando encuentran algo más barato.", t, { y: 2.7, w: CW * 0.46, size: 15.5 });
  K.block(s, pres, { x: M + CW * 0.52, y: 2.35, w: CW * 0.48, h: 3.15, fill: t.darkCard });
  K.quote(s, t, {
    x: M + CW * 0.52 + 0.4, y: 2.75, w: CW * 0.48 - 0.8, onDark: true, size: 17,
    text: "Subir el precio no aleja a los buenos clientes. Los atrae. Son los malos clientes los que se van — y eso es una victoria.",
    author: "Alex Hormozi · $100M Pricing",
  });
  K.kicker(s, "El cliente que decide por precio no es tu cliente. No bajes el precio: sube el valor.", t, { y: 5.85, size: 15 });
  K.footer(s, t, { right: "DEL SCROLL A LA SILLA" });
  s.addNotes(
    "Esta es la slide que más resistencia genera. Deja que la sala discuta 30 segundos.\n\n" +
    "El argumento que cierra la discusión: 'el que se va por $3.000 se iba a ir igual'."
  );
}

/* 07 · ECUACIÓN DE VALOR ──────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Parte 01 · La ecuación de valor", t);
  K.tag(s, "Hormozi · $100M Offers", t);
  K.headline(s, ["¿Por qué alguien paga más?"], t, { y: 1.15, size: 33 });
  const cw = (CW - 0.66) / 4;
  const cols = [
    { dir: "▲ SUBE VALOR", label: "RESULTADO\nDESEADO", q: "¿Qué logra el cliente?", c: t.up, dark: true },
    { dir: "▲ SUBE VALOR", label: "PROBABILIDAD\nDE ÉXITO", q: "¿Qué tan seguro se siente?", c: t.up, dark: true },
    { dir: "▼ BAJA VALOR", label: "TIEMPO\nDE ESPERA", q: "¿Cuánto tarda?", c: t.down, dark: false },
    { dir: "▼ BAJA VALOR", label: "ESFUERZO\nDEL CLIENTE", q: "¿Cuánto le cuesta?", c: t.down, dark: false },
  ];
  cols.forEach((c, i) => {
    const x = M + i * (cw + 0.22);
    K.block(s, pres, { x, y: 2.15, w: cw, h: 2.85, fill: c.dark ? t.darkCard : t.lightCard });
    s.addText(c.dir, {
      x: x + 0.28, y: 2.42, w: cw - 0.56, h: 0.3,
      fontFace: MONO, fontSize: 10, bold: true, charSpacing: 1.4, color: c.c,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(c.label, {
      x: x + 0.28, y: 2.85, w: cw - 0.56, h: 1.0,
      fontFace: SANS, fontSize: 19, bold: true, lineSpacing: 24, charSpacing: -0.2,
      color: c.dark ? t.accentSoft : t.onLight, valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(c.q, {
      x: x + 0.28, y: 4.1, w: cw - 0.56, h: 0.7,
      fontFace: SANS, fontSize: 13, italic: true, lineSpacing: 18,
      color: c.dark ? t.mutedDark : t.mutedLight, valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.headline(s, [{ text: "Aumenta los dos primeros. Reduce los dos últimos. El precio se justifica solo.", accent: true }], t, {
    y: 5.35, size: 20,
  });
  K.footer(s, t, { right: "DEL SCROLL A LA SILLA" });
  s.addNotes(
    "Traducción concreta: mostrar resultados y explicar antes de cortar suben el numerador; " +
    "reserva online y puntualidad bajan el denominador.\n\n" +
    "Ninguna de las cuatro palancas es 'cortar mejor'."
  );
}

/* 08 · EMPAQUETÁ EN NIVELES ───────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Parte 01 · Paquetes y membresías", t);
  K.headline(s, ["Empaqueta el valor. Cobra en niveles."], t, { y: 1.15, size: 31 });
  const cw = (CW - 0.56) / 3;
  const tiers = [
    { name: "BÁSICO", price: "$21.000", margin: "margen ~60%", body: "Corte estándar\nSello de atención\nPrecio de entrada", dark: false },
    { name: "PREMIUM", price: "$42.000", margin: "margen ~70%", body: "Corte + barba + producto\nDiagnóstico personalizado\nReserva prioritaria", dark: false },
    { name: "MEMBRESÍA VIP", price: "$99.000 /mes", margin: "margen ~80%", body: "2 cortes/mes + todo incluido\nCita fija semanal, sin espera\nIngreso predecible para ti", dark: true },
  ];
  tiers.forEach((c, i) => {
    const x = M + i * (cw + 0.28);
    K.block(s, pres, { x, y: 2.05, w: cw, h: 3.35, fill: c.dark ? t.darkCard : t.lightCard });
    s.addText(c.name, {
      x: x + 0.34, y: 2.32, w: cw - 0.68, h: 0.3,
      fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 2.2,
      color: c.dark ? t.accent : t.mutedLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(c.price, {
      x: x + 0.34, y: 2.7, w: cw - 0.68, h: 0.66,
      fontFace: SANS, fontSize: 30, bold: true, charSpacing: -1,
      color: c.dark ? t.onDark : t.onLight, valign: "top", margin: 0, isTextBox: true,
    });
    s.addText(c.margin, {
      x: x + 0.34, y: 3.34, w: cw - 0.68, h: 0.28,
      fontFace: SANS, fontSize: 12.5, italic: true,
      color: c.dark ? t.accentSoft : t.mutedLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(c.body, {
      x: x + 0.34, y: 3.78, w: cw - 0.68, h: 1.45,
      fontFace: SANS, fontSize: 13.5, lineSpacing: 23,
      color: c.dark ? t.mutedDark : t.bodyLight, valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Presenta siempre el más alto primero: el primer número ancla toda la conversación.", t, { y: 5.72, size: 15 });
  K.footer(s, t, { right: "DEL SCROLL A LA SILLA" });
  s.addNotes(
    "Aclara que los márgenes son de referencia y no descuentan arriendo ni sueldos. Sirven " +
    "para comparar niveles entre sí.\n\n" +
    "La membresía es la joya: ingreso predecible todos los meses, sin depender del clima " +
    "ni del algoritmo."
  );
}

/* 09 · DIVIDER 02 ─────────────────────────────────────────────────────── */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Parte 02",
    lines: ["La", { text: "atención.", accent: true }],
    sub: "El barbero que no se ve, no se vende. Cómo dejar de ser invisible.",
    image: K.photo("barbero-tijera"),
    size: 84,
  });
  s.addNotes("'Saquen el teléfono. Abran su último video. Pónganlo en silencio. ¿Se entiende?'");
}

/* 10 · LOS 4 HOOKS ────────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Parte 02 · El hook", t);
  K.tag(s, "Los primeros 3 segundos lo deciden todo", t);
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
  K.kicker(s, "El mejor hook no es el más creativo. Es el que usas con consistencia.", t, { y: 5.75, size: 15 });
  K.footer(s, t, { right: "DEL SCROLL A LA SILLA" });
  s.addNotes(
    "Recorre los 4 rápido y pide un ejemplo de cada uno con sus propios clientes.\n\n" +
    "Anota los de dolor en la pizarra: quedan como banco de ideas del grupo."
  );
}

/* 11 · CADA SEGUNDO TIENE PROPÓSITO ───────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Parte 02 · Estructura", t);
  K.tag(s, "15 segundos", t);
  K.headline(s, ["Cada segundo tiene propósito."], t, { y: 1.15, size: 31 });
  const parts = [
    { t: "0 – 3 s", n: "Hook", d: "Detiene el scroll. Conciso, rápido, visual, sin audio.", fill: t.darkCard, dark: true },
    { t: "3 – 5 s", n: "Foreshadow", d: "Genera intriga. FOMO — miedo a perdérselo.", fill: t.lightCard, dark: false },
    { t: "5 – 12 s", n: "Valor", d: "Entretienes, educas o inspiras. Es el cuerpo.", fill: t.accent, dark: false, gold: true },
    { t: "12 – 15 s", n: "CTA", d: "Claridad + urgencia + escasez.", fill: t.darkCard, dark: true },
  ];
  parts.forEach((p, i) => {
    const y = 2.05 + i * 0.86;
    K.block(s, pres, { x: M, y, w: CW, h: 0.74, fill: p.fill });
    s.addText(p.n, {
      x: M + 0.34, y, w: 2.6, h: 0.74,
      fontFace: SANS, fontSize: 20, bold: true, charSpacing: -0.3,
      color: p.gold ? "121212" : (p.dark ? t.onDark : t.onLight),
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(p.d, {
      x: M + 3.1, y, w: CW - 3.1 - 1.7, h: 0.74,
      fontFace: SANS, fontSize: 14,
      color: p.gold ? "3A2E12" : (p.dark ? t.mutedDark : t.bodyLight),
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(p.t, {
      x: M + CW - 1.9, y, w: 1.56, h: 0.74,
      fontFace: MONO, fontSize: 11.5, bold: true, charSpacing: 1.2,
      color: p.gold ? "3A2E12" : (p.dark ? t.accent : t.mutedLight),
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Nada es accidental. El video viral es arquitectura, no improvisación. Quita una parte y se cae.", t, { y: 5.75, size: 15 });
  K.footer(s, t, { right: "DEL SCROLL A LA SILLA" });
  s.addNotes(
    "La slide que van a querer fotografiar. Anunciálo y dales 5 segundos.\n\n" +
    "El que más se saltan es el foreshadow. Sin él el video pasa del hook al contenido y " +
    "no hay razón para quedarse."
  );
}

/* 12 · NO SON VIEWS ───────────────────────────────────────────────────── */
{
  const s = dark();
  K.eyebrow(s, "Parte 02 · La métrica que importa", t, { onDark: true });
  K.tag(s, "Al algoritmo no le importan tus seguidores", t, { onDark: true });
  K.headline(s, ["No son views.", { text: "Es retención.", accent: true }], t, {
    y: 1.2, size: 40, base: t.onDark,
  });
  s.addText("El algoritmo premia cuánto ven tu video, no cuántos clicks genera.\n¿Dónde scrollean? Ahí está la mejora del próximo.", {
    x: M, y: 2.75, w: CW * 0.42, h: 1.2,
    fontFace: SANS, fontSize: 15, lineSpacing: 24, color: t.mutedDark,
    valign: "top", margin: 0, isTextBox: true,
  });
  const cw = (CW * 0.54 - 0.3) / 2;
  const bx = M + CW * 0.46;
  K.block(s, pres, { x: bx, y: 2.6, w: cw, h: 2.4, fill: t.cardOnDark });
  K.stat(s, t, {
    x: bx + 0.32, y: 2.92, w: cw - 0.64, label: "✓ Gana", value: "100K views",
    foot: "80% de retención", labelColor: t.up, valueColor: t.onDark, footColor: t.accentSoft, valueSize: 28,
  });
  K.block(s, pres, { x: bx + cw + 0.3, y: 2.6, w: cw, h: 2.4, fill: t.cardOnDark });
  K.stat(s, t, {
    x: bx + cw + 0.62, y: 2.92, w: cw - 0.64, label: "✗ Pierde", value: "1M views",
    foot: "10% de retención", labelColor: t.down, valueColor: t.mutedDark, footColor: t.mutedDark, valueSize: 28,
  });
  s.addText("Y lo mismo con los guardados: 1.000 views + 200 saves le gana a 10.000 views + 10 saves. Calidad sobre cantidad.", {
    x: M, y: 5.5, w: CW, h: 0.5,
    fontFace: SANS, fontSize: 14.5, italic: true, color: t.accentSoft,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes(
    "Los saves mandan. Es la métrica que más subestiman.\n\n" +
    "Cierre del bloque: 'no publiquen más. Publiquen mejor.'"
  );
}

/* 13 · CORTE EN VIVO ──────────────────────────────────────────────────── */
{
  const s = pres.addSlide();
  K.divider(s, pres, t, {
    kind: "Invitado especial",
    lines: ["Corte", { text: "en vivo.", accent: true }],
    sub: "Guarden las libretas. Saquen el teléfono. Esto no se mira: esto se graba.",
    size: 96,
  });
  s.addNotes(
    "Presentas al invitado EN VOZ. Dices qué va a mostrar y te corres del medio.\n\n" +
    "Deja proyectada la próxima slide durante todo su bloque: es el reparto de planos."
  );
}

/* 14 · EL REPARTO DE PLANOS ───────────────────────────────────────────── */
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
    fontFace: MONO, fontSize: 9.5, bold: true, charSpacing: 1.6, color: t.accent,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("El primer pase de máquina y el reveal en el espejo. Esos dos viralizan.", {
    x: M + 3 * (cw + 0.147) + 0.24, y: 4.05, w: cw - 0.48, h: 0.68,
    fontFace: SANS, fontSize: 11.5, lineSpacing: 15, color: t.onDark,
    valign: "top", margin: 0, isTextBox: true,
  });
  K.kicker(s, "Con este material se hace el sprint de edición. Al terminar: 3 minutos para revisar lo que tienen.", t, { y: 5.35, size: 14 });
  K.footer(s, t, { right: "DEL SCROLL A LA SILLA" });
  s.addNotes(
    "Reparte los planos ANTES de que empiece. Cada uno tiene el suyo obligatorio y además " +
    "graba libre.\n\n" +
    "Insiste en vertical 9:16 aunque el plano parezca pedir horizontal."
  );
}

/* 15 · DIVIDER 03 + EL EMBUDO ─────────────────────────────────────────── */
{
  const s = dark();
  K.eyebrow(s, "Parte 03 · La conversión", t, { onDark: true });
  K.tag(s, "El paso 4 es donde falla la mayoría", t, { onDark: true });
  K.headline(s, ["No es UN paso.", { text: "Es un SISTEMA.", accent: true }], t, {
    y: 1.15, size: 38, base: t.onDark,
  });
  const steps = [
    ["1", "Video viral", "Un hook detiene el scroll"],
    ["2", "Alguien ve", "El algoritmo distribuye"],
    ["3", "Te sigue", "Empieza a confiar"],
    ["4", "Click en bio", "Link directo a WhatsApp"],
    ["5", "WhatsApp", "Llega el mensaje"],
    ["6", "Cierras la venta", "Dos horarios, no preguntas"],
    ["7", "Leal + referidos", "Recomienda 2–3 amigos"],
  ];
  const cw = (CW - 0.72) / 4;
  steps.forEach(([n, label, sub], i) => {
    const x = M + (i % 4) * (cw + 0.24);
    const y = 2.6 + Math.floor(i / 4) * 1.42;
    const hot = i === 3;
    K.block(s, pres, { x, y, w: cw, h: 1.2, fill: hot ? t.accent : t.cardOnDark });
    s.addText(n, {
      x: x + 0.26, y: y + 0.14, w: 0.6, h: 0.36,
      fontFace: SANS, fontSize: 19, bold: true, color: hot ? "3A2E12" : t.accent,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(label, {
      x: x + 0.26, y: y + 0.5, w: cw - 0.52, h: 0.32,
      fontFace: SANS, fontSize: 15, bold: true, charSpacing: -0.2,
      color: hot ? "121212" : t.onDark, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(sub, {
      x: x + 0.26, y: y + 0.82, w: cw - 0.52, h: 0.28,
      fontFace: SANS, fontSize: 11, color: hot ? "3A2E12" : t.mutedDark,
      valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Tienen el video. No tienen el camino que convierte al viewer en cliente. Video viral sin sistema = nada.", t, { onDark: true, y: 5.72, size: 14 });
  s.addNotes(
    "El punto débil de TODO barbero es el paso 4. El link de la bio va DIRECTO a WhatsApp: " +
    "no a una web, no a un linktree con ocho opciones, no al direct."
  );
}

/* 16 · TU BIO ─────────────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Parte 03 · Perfil", t);
  K.tag(s, "Tu bio es tu vendedor 24/7", t);
  K.headline(s, ["Claridad mata la confusión."], t, { y: 1.3, size: 34 });
  K.deck(s, "Y la confusión mata la conversión. Un perfil que no dice qué haces y para quién es plata tirada al piso.", t, { y: 2.5, w: CW * 0.42, size: 15 });
  const bx = M + CW * 0.47;
  const bw = CW * 0.53;
  K.block(s, pres, { x: bx, y: 2.2, w: bw, h: 1.5, fill: t.darkCard });
  s.addText("✗  ANTES — INFO INÚTIL", {
    x: bx + 0.34, y: 2.45, w: bw - 0.68, h: 0.3,
    fontFace: MONO, fontSize: 10, bold: true, charSpacing: 1.6, color: t.down,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("“Barbero profesional | Diseños custom | Sígueme”", {
    x: bx + 0.34, y: 2.85, w: bw - 0.68, h: 0.7,
    fontFace: SANS, fontSize: 15, italic: true, lineSpacing: 22, color: t.mutedDark,
    valign: "top", margin: 0, isTextBox: true,
  });
  K.block(s, pres, { x: bx, y: 3.9, w: bw, h: 1.5, fill: t.accent });
  s.addText("✓  AHORA — CONVIERTE", {
    x: bx + 0.34, y: 4.15, w: bw - 0.68, h: 0.3,
    fontFace: MONO, fontSize: 10, bold: true, charSpacing: 1.6, color: "3A2E12",
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("“Cortes desde $21k | Disponibilidad: WhatsApp 👇”", {
    x: bx + 0.34, y: 4.55, w: bw - 0.68, h: 0.7,
    fontFace: SANS, fontSize: 15, bold: true, lineSpacing: 22, color: "121212",
    valign: "top", margin: 0, isTextBox: true,
  });
  K.kicker(s, "Tres cosas y nada más: qué haces, cuánto cuesta, dónde se agenda. Arreglala AHORA, con el teléfono en la mano.", t, { y: 5.85, size: 15 });
  K.footer(s, t, { right: "DEL SCROLL A LA SILLA" });
  s.addNotes(
    "Acá se para la clase 2 minutos y todos arreglan la bio. No es tarea: se hace en la sala.\n\n" +
    "Es la acción de mayor impacto por minuto de todo el día."
  );
}

/* 17 · EL MENSAJE QUE CIERRA ──────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Parte 03 · El script de WhatsApp", t);
  K.headline(s, ["El mensaje que convierte."], t, { y: 1.15, size: 32 });
  K.block(s, pres, { x: M, y: 2.05, w: CW * 0.48, h: 3.1, fill: t.darkCard });
  s.addText("SCRIPT", {
    x: M + 0.36, y: 2.32, w: CW * 0.48 - 0.72, h: 0.3,
    fontFace: MONO, fontSize: 10, bold: true, charSpacing: 2.2, color: t.accent,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("“¡Hola! 👋 Qué bueno que viste el video.\nSomos especializados en [tipo de corte].\n¿Te gustaría una cita?\nTengo hoy 5pm o mañana 3pm.”", {
    x: M + 0.36, y: 2.8, w: CW * 0.48 - 0.72, h: 2.0,
    fontFace: SANS, fontSize: 16, italic: true, lineSpacing: 30, color: t.onDark,
    valign: "top", margin: 0, isTextBox: true,
  });
  const rx = M + CW * 0.52;
  const rw = CW * 0.48;
  const reasons = [
    ["Saludas — humano", "Conexión antes que venta"],
    ["Confirmas el video", "Das contexto inmediato"],
    ["Dos opciones de horario", "Facilitas la decisión"],
    ["Sin preguntas abiertas", "Sin confusión = más cierres"],
  ];
  reasons.forEach(([h, sub], i) => {
    const y = 2.05 + i * 0.8;
    K.block(s, pres, { x: rx, y, w: rw, h: 0.68, fill: i === 2 ? t.accent : t.lightCard });
    s.addText(h, {
      x: rx + 0.3, y: y + 0.06, w: rw - 0.6, h: 0.3,
      fontFace: SANS, fontSize: 15, bold: true, color: i === 2 ? "121212" : t.onLight,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(sub, {
      x: rx + 0.3, y: y + 0.34, w: rw - 0.6, h: 0.28,
      fontFace: SANS, fontSize: 12, italic: true, color: i === 2 ? "3A2E12" : t.mutedLight,
      valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "“¿Cuándo te queda bien?” abre una conversación de diez mensajes que termina en nada.", t, { y: 5.6, size: 15 });
  K.footer(s, t, { right: "DEL SCROLL A LA SILLA" });
  s.addNotes(
    "Lee el script en voz alta, tal cual. Que lo copien palabra por palabra — después lo " +
    "adaptan.\n\n" +
    "El detalle que hace la diferencia son los dos horarios cerrados."
  );
}

/* 18 · LA OBJECIÓN DE PRECIO ──────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Parte 03 · Objeción", t);
  K.tag(s, "Si pregunta por precio en WhatsApp", t);
  K.headline(s, ["Cambia el foco", "de PRECIO", { text: "a HORARIO.", accent: true }], t, {
    y: 1.35, size: 36, w: CW * 0.42,
  });
  K.deck(s, "La acción que buscas es una DECISIÓN. No es negociar: es redirigir.", t, { y: 4.5, w: CW * 0.4, size: 15 });
  const bx = M + CW * 0.46;
  const bw = CW * 0.54;
  const chat = [
    { who: "CLIENTE", msg: "“¿Cuánto cuesta?”", mine: false },
    { who: "TÚ", msg: "“Depende del tipo de corte. El estándar desde $21k.”", mine: true },
    { who: "TÚ", msg: "“¿Cuál de los dos horarios te va mejor?”", mine: true, hot: true },
  ];
  chat.forEach((c, i) => {
    const y = 1.5 + i * 1.42;
    K.block(s, pres, { x: bx, y, w: bw, h: 1.22, fill: c.hot ? t.accent : (c.mine ? t.darkCard : t.lightCard) });
    s.addText(c.who, {
      x: bx + 0.32, y: y + 0.16, w: bw - 0.64, h: 0.28,
      fontFace: MONO, fontSize: 9.5, bold: true, charSpacing: 1.8,
      color: c.hot ? "3A2E12" : (c.mine ? t.accent : t.mutedLight),
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(c.msg, {
      x: bx + 0.32, y: y + 0.5, w: bw - 0.64, h: 0.6,
      fontFace: SANS, fontSize: 15, italic: true, lineSpacing: 21,
      color: c.hot ? "121212" : (c.mine ? t.onDark : t.onLight),
      valign: "top", margin: 0, isTextBox: true,
    });
  });
  K.footer(s, t, { right: "DEL SCROLL A LA SILLA" });
  s.addNotes(
    "El cliente no quiere un corte: quiere resultados. Confianza, transformación, esperanza.\n\n" +
    "Por eso 'somos barberos profesionales' no vende, y 'transformamos tu look en 30 min, " +
    "verás resultados hoy' sí."
  );
}

/* 19 · TESTIMONIOS + EL RECOMENDADO ───────────────────────────────────── */
{
  const s = dark();
  K.eyebrow(s, "Parte 03 · Prueba social y referidos", t, { onDark: true });
  K.headline(s, ["Si cada cliente trae 1 más,", { text: "duplicas ingresos.", accent: true }], t, {
    y: 1.15, size: 34, base: t.onDark,
  });
  const cw = (CW - 0.56) / 3;
  const cards = [
    { label: "CAC recomendado", value: "$0", foot: "Costo de adquisición", hot: false },
    { label: "LTV recomendado", value: "$1.428.000", foot: "2× el cliente regular, a 2 años", hot: true },
    { label: "1 recomendado cada 3 meses", value: "$2.856.000", foot: "extra al año, sin invertir", hot: false },
  ];
  cards.forEach((c, i) => {
    const x = M + i * (cw + 0.28);
    K.block(s, pres, { x, y: 2.5, w: cw, h: 2.1, fill: c.hot ? t.accent : t.cardOnDark });
    K.stat(s, t, {
      x: x + 0.3, y: 2.78, w: cw - 0.6, label: c.label, value: c.value, foot: c.foot,
      labelColor: c.hot ? "3A2E12" : t.mutedDark,
      valueColor: c.hot ? "121212" : t.onDark,
      footColor: c.hot ? "3A2E12" : t.mutedDark,
      valueSize: 30,
    });
  });
  s.addText("Cómo se pide:  “Oye, ¿te quedó bien?”  →  [dice que sí]  →  “Perfecto. Si conoces a alguien que quiera verse así, pasame su WhatsApp.”", {
    x: M, y: 5.0, w: CW, h: 0.5,
    fontFace: SANS, fontSize: 14, color: t.accentSoft,
    valign: "middle", margin: 0, isTextBox: true,
  });
  K.kicker(s, "Y antes de eso: 1 testimonio = 5 reels tuyos en impacto. Filmas 10 segundos después del corte. 3–4 por mes alcanzan.", t, { onDark: true, y: 5.65, size: 14 });
  s.addNotes(
    "Este es el slide que cambia mentalidades. Demostralo con números, no con entusiasmo.\n\n" +
    "El recomendado ya llegó con la confianza construida: ya pagó, ya fue, ya confía. " +
    "Solo tienes que cobrar.\n\n" +
    "OJO: antes de prometer 'X referencias = corte gratis', chequea que calce con la tarjeta " +
    "de fidelidad de Brunetti (10 estrellas = corte gratis)."
  );
}

/* 20 · LAS 4 MÉTRICAS ─────────────────────────────────────────────────── */
{
  const s = light();
  K.eyebrow(s, "Parte 03 · Crecimiento", t);
  K.tag(s, "Las 4 métricas que debes trackear", t);
  K.headline(s, ["Sin números no puedes mejorar."], t, { y: 1.15, size: 32 });
  const metrics = [
    ["01", "Clientes nuevos / mes", "¿De dónde vienen? Pregunta siempre."],
    ["02", "Tasa de conversión", "De 10 leads en WhatsApp, ¿cuántos cierran?"],
    ["03", "Recomendados", "De 10 clientes, ¿cuántos traen amigos?"],
    ["04", "Retención", "De 10 nuevos, ¿cuántos vuelven en 3 meses?"],
  ];
  metrics.forEach(([n, title, q], i) => {
    const y = 2.05 + i * 0.92;
    K.block(s, pres, { x: M, y, w: CW, h: 0.78, fill: i === 0 ? t.darkCard : t.lightCard });
    s.addText(n, {
      x: M + 0.34, y, w: 0.9, h: 0.78,
      fontFace: SANS, fontSize: 24, bold: true, color: t.accent,
      valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(title, {
      x: M + 1.35, y, w: CW * 0.38, h: 0.78,
      fontFace: SANS, fontSize: 18, bold: true, charSpacing: -0.2,
      color: i === 0 ? t.onDark : t.onLight, valign: "middle", margin: 0, isTextBox: true,
    });
    s.addText(q, {
      x: M + CW * 0.45, y, w: CW * 0.55 - 0.34, h: 0.78,
      fontFace: SANS, fontSize: 13.5, italic: true,
      color: i === 0 ? t.mutedDark : t.mutedLight,
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
  });
  K.kicker(s, "Lo que no se mide no se puede escalar. Cuatro números, una vez al mes, en el teléfono.", t, { y: 5.95, size: 15 });
  K.footer(s, t, { right: "DEL SCROLL A LA SILLA" });
  s.addNotes(
    "La primera es la más fácil y la que nadie hace: preguntarle a cada cliente nuevo de " +
    "dónde salió.\n\n" +
    "Sin ese dato no sabes qué video funcionó de verdad."
  );
}

/* 21 · CIERRE + CONCURSO ──────────────────────────────────────────────── */
{
  const s = dark();
  K.eyebrow(s, "Para llevarte", t, { onDark: true });
  const cw = (CW - 0.56) / 3;
  [
    ["01", "No bajes el precio.\nSube el valor."],
    ["02", "El paso que falla\nes el link de la bio."],
    ["03", "El recomendado\ncuesta $0."],
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
    fontFace: MONO, fontSize: 11, bold: true, charSpacing: 2.6, color: "3A2E12",
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("El mejor reel se lleva el Kit Tadeus.", {
    x: M + 0.42, y: 4.0, w: CW - 0.84, h: 0.6,
    fontFace: SANS, fontSize: 32, bold: true, charSpacing: -0.8, color: "121212",
    valign: "top", margin: 0, isTextBox: true,
  });
  s.addText("Kit completo + capa Tadeus bordada con tu nombre + gorro Brunetti.   Un kit, un ganador.\nGrabas · editas · publicas · etiquetas a @brunetticutz", {
    x: M + 0.42, y: 4.7, w: CW - 0.84, h: 0.8,
    fontFace: SANS, fontSize: 14, lineSpacing: 22, color: "3A2E12",
    valign: "top", margin: 0, isTextBox: true,
  });
  s.addText("@brunetticutz", {
    x: M, y: 6.05, w: CW * 0.5, h: 0.5,
    fontFace: SANS, fontSize: 26, bold: true, color: t.onDark,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("brunetticutz.cl", {
    x: M + CW * 0.5, y: 6.05, w: CW * 0.5, h: 0.5,
    fontFace: SANS, fontSize: 20, bold: true, color: t.accent,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes(
    "Antes de esta slide: el compromiso en voz alta. Cada uno dice qué publica el lunes.\n\n" +
    "Después: el concurso. Premio, cómo se participa, cuándo cierra."
  );
}

/* 22 · CIERRE FOTO ────────────────────────────────────────────────────── */
{
  const s = pres.addSlide();
  s.background = { color: t.dark };
  const band = 4.35;
  s.addImage({ path: K.photo("grupo-final"), x: 0, y: 0, w: W, h: band, sizing: { type: "cover", w: W, h: band } });
  K.headline(s, ["La diferencia no es técnica.", { text: "Es decisión.", accent: true }], t, {
    y: band + 0.5, size: 34, base: t.onDark, lineSpacingMult: 1.1,
  });
  s.addText("Y las decisiones se toman hoy.", {
    x: M, y: band + 1.85, w: CW * 0.6, h: 0.4,
    fontFace: SANS, fontSize: 15, italic: true, color: t.mutedDark,
    valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("@brunetticutz", {
    x: M + CW * 0.5, y: band + 1.0, w: CW * 0.5, h: 0.5,
    fontFace: SANS, fontSize: 26, bold: true, color: t.onDark,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  s.addText("brunetticutz.cl", {
    x: M + CW * 0.5, y: band + 1.56, w: CW * 0.5, h: 0.4,
    fontFace: SANS, fontSize: 17, bold: true, color: t.accent,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
  s.addNotes("Foto grupal. Que la saquen ellos también — es contenido, y arranca el concurso.");
}

const out = path.join(__dirname, "..", "decks", "V2-del-scroll-a-la-silla.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("✔", out));
