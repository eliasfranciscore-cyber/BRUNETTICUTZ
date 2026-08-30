/**
 * kit.js — piezas compartidas por los tres decks del workshop.
 *
 * Todo el layout vive acá para que las tres versiones se vean como la misma familia
 * aunque cambien de paleta. Si hay que mover un margen o cambiar una tipografía,
 * se toca una sola vez.
 */

const path = require("path");

const W = 13.333;
const H = 7.5;
const M = 0.62;            // margen lateral
const CW = W - M * 2;      // ancho de contenido

// Iosevka Charon Mono no existe en PowerPoint. Courier New conserva el carácter
// monoespaciado de la marca y se renderiza igual en cualquier máquina.
const MONO = "Courier New";
const SANS = "Arial";

const ASSETS = path.join(__dirname, "..", "assets");
const photo = (name) => path.join(ASSETS, `${name}.jpg`);
const icon = (name, tone) => path.join(ASSETS, "icons", `${name}-${tone}.png`);
const brand = (name) => path.join(ASSETS, `${name}.png`);

/* ── Temas ──────────────────────────────────────────────────────────────── */

const ASCENSION = {
  dark: "161019",
  darkCard: "16111E",
  cardOnDark: "241C31",
  light: "F4F0E8",
  lightCard: "ECE6DA",
  accent: "8C3FDB",
  accentSoft: "A98FE0",
  onDark: "F4F0E8",
  onLight: "15120E",
  mutedDark: "9A8FB0",
  mutedLight: "8A8478",
  bodyLight: "4A463E",
  up: "1B7A4B",
  down: "B8302D",
};

const ORO = {
  dark: "0D0D0D",
  darkCard: "171717",
  cardOnDark: "232019",
  light: "F7F4EF",
  lightCard: "EAE5DC",
  accent: "C9A961",
  accentSoft: "E8D5A3",
  onDark: "F7F4EF",
  onLight: "121212",
  mutedDark: "8C8578",
  mutedLight: "7C766B",
  bodyLight: "45413A",
  up: "3E8E5A",
  down: "C0392B",
};

const REC = {
  dark: "141414",
  darkCard: "1F1F1F",
  cardOnDark: "2A2A2A",
  light: "FAFAF8",
  lightCard: "EDEBE7",
  accent: "E03127",
  accentSoft: "F08A83",
  onDark: "FAFAF8",
  onLight: "111111",
  mutedDark: "9A9A9A",
  mutedLight: "6B6B6B",
  bodyLight: "3C3C3C",
  up: "2E7D4F",
  down: "C0392B",
};

/* ── Primitivas ─────────────────────────────────────────────────────────── */

/** Etiqueta de módulo, arriba a la izquierda. Dice dónde estamos sin decirlo. */
function eyebrow(slide, text, t, { onDark = false, x = M, y = 0.44, w = CW * 0.62 } = {}) {
  slide.addText(String(text).toUpperCase(), {
    x, y, w, h: 0.3,
    fontFace: MONO, fontSize: 10.5, bold: true, charSpacing: 2.6,
    color: onDark ? t.accentSoft : t.accent,
    align: "left", valign: "middle", margin: 0, isTextBox: true,
  });
}

/** Nota al margen, arriba a la derecha. Opcional. */
function tag(slide, text, t, { onDark = false, y = 0.44 } = {}) {
  slide.addText(String(text), {
    x: W - M - CW * 0.4, y, w: CW * 0.4, h: 0.3,
    fontFace: MONO, fontSize: 10, charSpacing: 1.4,
    color: onDark ? t.mutedDark : t.mutedLight,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
}

/** Pie: marca a la izquierda, nombre del workshop a la derecha. */
function footer(slide, t, { onDark = false, right = "ASCENSIÓN" } = {}) {
  const c = onDark ? t.mutedDark : t.mutedLight;
  slide.addText("BRUNETTICUTZ", {
    x: M, y: H - 0.68, w: CW * 0.5, h: 0.28,
    fontFace: MONO, fontSize: 9, charSpacing: 2.2, color: c,
    align: "left", valign: "middle", margin: 0, isTextBox: true,
  });
  slide.addText(right, {
    x: M + CW * 0.5, y: H - 0.68, w: CW * 0.5, h: 0.28,
    fontFace: MONO, fontSize: 9, charSpacing: 2.2, color: c,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
}

/**
 * Titular a dos colores. Se le pasa un array de líneas; las que llevan
 * `accent: true` salen en el color de acento — la regla de la marca es que el
 * acento va en la segunda mitad de la frase, no en toda.
 */
function headline(slide, lines, t, {
  x = M, y, w = CW, size = 40, base, accent, lineSpacingMult = 1.06, align = "left",
} = {}) {
  const baseColor = base || t.onLight;
  const accColor = accent || t.accent;
  const runs = lines.map((ln, i) => ({
    text: typeof ln === "string" ? ln : ln.text,
    options: {
      color: typeof ln === "object" && ln.accent ? accColor : baseColor,
      breakLine: i < lines.length - 1,
    },
  }));
  slide.addText(runs, {
    x, y, w, h: size * lines.length * lineSpacingMult / 72 + 0.12,
    fontFace: SANS, fontSize: size, bold: true, charSpacing: -0.9,
    lineSpacing: size * lineSpacingMult,
    align, valign: "top", margin: 0, isTextBox: true,
  });
}

/** Bajada bajo el titular. */
function deck(slide, text, t, { x = M, y, w = CW * 0.72, size = 15, onDark = false } = {}) {
  slide.addText(text, {
    x, y, w, h: 0.95,
    fontFace: SANS, fontSize: size, lineSpacing: size * 1.5,
    color: onDark ? t.mutedDark : t.mutedLight,
    align: "left", valign: "top", margin: 0, isTextBox: true,
  });
}

/** Rectángulo plano. Sin bordes de un solo lado: el contraste lo da el relleno. */
function block(slide, pres, { x, y, w, h, fill }) {
  slide.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { color: fill }, line: { color: fill, width: 0 } });
}

/**
 * Tarjeta: rectángulo + título + cuerpo, con un número o letra opcional arriba.
 */
function card(slide, pres, t, {
  x, y, w, h, fill, num, numColor, title, body,
  titleColor, bodyColor, titleSize = 19, bodySize = 12.5, numSize = 26, pad = 0.3,
}) {
  block(slide, pres, { x, y, w, h, fill });
  let cursor = y + pad;
  if (num !== undefined) {
    slide.addText(String(num), {
      x: x + pad, y: cursor, w: w - pad * 2, h: numSize / 60,
      fontFace: SANS, fontSize: numSize, bold: true, color: numColor || t.accent,
      align: "left", valign: "top", margin: 0, isTextBox: true,
    });
    cursor += numSize / 60 + 0.1;
  }
  slide.addText(title, {
    x: x + pad, y: cursor, w: w - pad * 2, h: 0.62,
    fontFace: SANS, fontSize: titleSize, bold: true, charSpacing: -0.3,
    lineSpacing: titleSize * 1.15,
    color: titleColor || t.onLight, align: "left", valign: "top", margin: 0, isTextBox: true,
  });
  if (body) {
    slide.addText(body, {
      x: x + pad, y: cursor + 0.62, w: w - pad * 2, h: h - (cursor - y) - 0.62 - pad,
      fontFace: SANS, fontSize: bodySize, lineSpacing: bodySize * 1.45,
      color: bodyColor || t.bodyLight, align: "left", valign: "top", margin: 0, isTextBox: true,
    });
  }
}

/**
 * Fila de lista: número grande, título, y una nota a la derecha.
 * Es el patrón de la agenda y de la escala de decisión.
 */
function row(slide, pres, t, {
  x = M, y, w = CW, h = 0.78, fill, num, numColor, title, note,
  titleColor, noteColor, titleSize = 21, numSize = 24, numW = 1.15, pad = 0.34,
}) {
  if (fill) block(slide, pres, { x, y, w, h, fill });
  const ix = fill ? x + pad : x;
  const iw = fill ? w - pad * 2 : w;
  if (num !== undefined) {
    slide.addText(String(num), {
      x: ix, y, w: numW, h,
      fontFace: SANS, fontSize: numSize, bold: true, color: numColor || t.accent,
      align: "left", valign: "middle", margin: 0, isTextBox: true,
    });
  }
  const tx = num !== undefined ? ix + numW : ix;
  const noteW = note ? Math.min(3.5, iw * 0.32) : 0;
  slide.addText(title, {
    x: tx, y, w: iw - (tx - ix) - noteW - 0.2, h,
    fontFace: SANS, fontSize: titleSize, bold: true, charSpacing: -0.3,
    color: titleColor || t.onLight, align: "left", valign: "middle", margin: 0, isTextBox: true,
  });
  if (note) {
    slide.addText(note, {
      x: ix + iw - noteW, y, w: noteW, h,
      fontFace: SANS, fontSize: 12.5, color: noteColor || t.mutedLight,
      align: "right", valign: "middle", margin: 0, isTextBox: true,
    });
  }
}

/** Panel de foto a sangre, pegado a un borde. */
function photoPanel(slide, file, { side = "right", w = 4.55 } = {}) {
  const x = side === "right" ? W - w : 0;
  slide.addImage({ path: file, x, y: 0, w, h: H, sizing: { type: "cover", w, h: H } });
}

/** Dato grande con etiqueta arriba. Para cifras que tienen que pegar. */
function stat(slide, t, { x, y, w, label, value, foot, valueColor, labelColor, footColor, valueSize = 42 }) {
  slide.addText(String(label).toUpperCase(), {
    x, y, w, h: 0.28,
    fontFace: MONO, fontSize: 9.5, bold: true, charSpacing: 2,
    color: labelColor || t.mutedLight, align: "left", valign: "middle", margin: 0, isTextBox: true,
  });
  slide.addText(value, {
    x, y: y + 0.32, w, h: valueSize / 52,
    fontFace: SANS, fontSize: valueSize, bold: true, charSpacing: -1.2,
    color: valueColor || t.onLight, align: "left", valign: "top", margin: 0, isTextBox: true,
  });
  if (foot) {
    slide.addText(foot, {
      x, y: y + 0.32 + valueSize / 52, w, h: 0.42,
      fontFace: SANS, fontSize: 12.5, italic: true,
      color: footColor || t.mutedLight, align: "left", valign: "top", margin: 0, isTextBox: true,
    });
  }
}

/**
 * Cita con comilla tipográfica grande en lugar de la típica barra lateral.
 * La altura del bloque de texto se estima a partir del largo de la cita, para que
 * la atribución quede pegada debajo y no flotando a dos centímetros.
 */
function quote(slide, t, { x, y, w, text, author, onDark = false, size = 20, lines }) {
  // ~1.85 caracteres por punto de ancho es lo que da esta fuente a este cuerpo.
  const nLines = lines || Math.max(1, Math.ceil(text.length / ((w * 72) / (size * 0.52))));
  const alto = (nLines * size * 1.4) / 72;
  slide.addText("“", {
    x, y: y - 0.34, w: 0.9, h: 0.9,
    fontFace: SANS, fontSize: 66, bold: true,
    color: onDark ? t.accentSoft : t.accent,
    align: "left", valign: "top", margin: 0, isTextBox: true,
  });
  slide.addText(text, {
    x, y: y + 0.55, w, h: alto,
    fontFace: SANS, fontSize: size, italic: true, lineSpacing: size * 1.4,
    color: onDark ? t.onDark : t.onLight, align: "left", valign: "top", margin: 0, isTextBox: true,
  });
  if (author) {
    slide.addText(`— ${author}`, {
      x, y: y + 0.62 + alto, w, h: 0.3,
      fontFace: MONO, fontSize: 11, charSpacing: 1,
      color: onDark ? t.mutedDark : t.mutedLight,
      align: "left", valign: "top", margin: 0, isTextBox: true,
    });
  }
}

/** Pie en cursiva, la línea que remata una slide. */
function kicker(slide, text, t, { onDark = false, y = H - 1.02, size = 14 } = {}) {
  slide.addText(text, {
    x: M, y, w: CW, h: 0.36,
    fontFace: SANS, fontSize: size, italic: true,
    color: onDark ? t.mutedDark : t.mutedLight,
    align: "left", valign: "middle", margin: 0, isTextBox: true,
  });
}

/**
 * Divider de módulo: fondo oscuro, número de módulo, titular enorme, bajada.
 * `withLogo` pone el logo de ASCENSIÓN arriba a la derecha, como en el deck original.
 */
function divider(slide, pres, t, { kind, lines, sub, image, imageSide = "right", size = 62, withLogo = false }) {
  slide.background = { color: t.dark };
  const hasImg = Boolean(image);
  const imgW = 4.4;
  if (hasImg) photoPanel(slide, image, { side: imageSide, w: imgW });
  // Con la foto a la izquierda el texto arranca después de ella, no en el margen.
  const x = hasImg && imageSide === "left" ? imgW + 0.55 : M;
  const w = hasImg ? CW - imgW - (imageSide === "left" ? 0.55 - M : 0) : CW;
  if (withLogo) logo(slide, { x: x + w, y: 0.62, h: 0.95, align: "right" });
  slide.addText(String(kind).toUpperCase(), {
    x, y: 0.72, w: w - 1.4, h: 0.32,
    fontFace: MONO, fontSize: 11.5, bold: true, charSpacing: 3, color: t.accentSoft,
    align: "left", valign: "middle", margin: 0, isTextBox: true,
  });
  headline(slide, lines, t, {
    x, y: 2.5, w, size, base: t.onDark, accent: t.accent, lineSpacingMult: 1.0,
  });
  if (sub) {
    slide.addText(sub, {
      x, y: H - 1.72, w, h: 1.0,
      fontFace: SANS, fontSize: 14.5, lineSpacing: 22, color: t.mutedDark,
      align: "left", valign: "bottom", margin: 0, isTextBox: true,
    });
  }
}

/* ── Marca ──────────────────────────────────────────────────────────────── */

// El logo de ASCENSIÓN es cuadrado (742 × 730), así que alto y ancho van casi 1:1.
const LOGO_RATIO = 742 / 730;

/** Logo de ASCENSIÓN. `claro` es la versión para fondo oscuro y viceversa. */
function logo(slide, { x, y, h = 0.85, onDark = true, align = "left" } = {}) {
  const w = h * LOGO_RATIO;
  const px = align === "right" ? x - w : x;
  slide.addImage({
    path: brand(onDark ? "logo-ascension-claro" : "logo-ascension-oscuro"),
    x: px, y, w, h,
  });
}

// El wordmark de Brunetti es 254.1 × 62.4 en el SVG original.
const WORDMARK_RATIO = 254.1 / 62.4;

/** Wordmark de Brunetti. `tone`: morado | crema | tinta. */
function wordmark(slide, { x, y, h = 0.3, tone = "morado", align = "left" } = {}) {
  const w = h * WORDMARK_RATIO;
  const px = align === "right" ? x - w : x;
  slide.addImage({ path: brand(`logo-brunetti-${tone}`), x: px, y, w, h });
}

/** Pie con el wordmark a la izquierda y el nombre del módulo a la derecha. */
function footerBrand(slide, t, { onDark = false, right = "ASCENSIÓN" } = {}) {
  wordmark(slide, { x: M, y: H - 0.72, h: 0.26, tone: onDark ? "crema" : "morado" });
  slide.addText(right, {
    x: M + CW * 0.5, y: H - 0.72, w: CW * 0.5, h: 0.26,
    fontFace: MONO, fontSize: 9, charSpacing: 2.2,
    color: onDark ? t.mutedDark : t.mutedLight,
    align: "right", valign: "middle", margin: 0, isTextBox: true,
  });
}

/**
 * Icono dentro de un círculo. Es el motivo que se repite en todo el deck: da un
 * ancla visual a cada fila sin recurrir a barras de color.
 */
function iconBadge(slide, pres, { x, y, d = 0.62, name, tone = "morado", fill }) {
  if (fill) {
    slide.addShape(pres.ShapeType.ellipse, {
      x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0 },
    });
  }
  const pad = d * 0.27;
  slide.addImage({ path: icon(name, tone), x: x + pad, y: y + pad, w: d - pad * 2, h: d - pad * 2 });
}

/** Barra de progreso horizontal, para puntajes y comparaciones. */
function meter(slide, pres, { x, y, w, h = 0.16, pct, fill, track }) {
  slide.addShape(pres.ShapeType.rect, {
    x, y, w, h, fill: { color: track }, line: { color: track, width: 0 },
  });
  slide.addShape(pres.ShapeType.rect, {
    x, y, w: w * pct, h, fill: { color: fill }, line: { color: fill, width: 0 },
  });
}

module.exports = {
  W, H, M, CW, MONO, SANS, photo, icon, brand, ASSETS,
  ASCENSION, ORO, REC,
  eyebrow, tag, footer, headline, deck, block, card, row,
  photoPanel, stat, quote, kicker, divider,
  logo, wordmark, footerBrand, iconBadge, meter,
};
