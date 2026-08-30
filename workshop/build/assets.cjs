/**
 * assets.cjs — prepara los recursos gráficos que consumen los decks.
 *
 * Hace dos cosas:
 *   1. Recolorea el wordmark de Brunetti (que en el repo es dorado) a las variantes
 *      morada y crema que pide la paleta ASCENSIÓN, y lo rasteriza.
 *   2. Rasteriza el set de iconos de línea, uno por color de la paleta.
 *
 * Se corre una sola vez; los PNG quedan versionados en `assets/`. Volver a correrlo
 * solo si cambia el logo del repo o hace falta un icono nuevo.
 *
 *     node build/assets.cjs
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const feather = require("feather-icons");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "assets");
const REPO = path.join(ROOT, "..", "public", "assets");

const MORADO = "#8C3FDB";
const LILA = "#A98FE0";
const CREMA = "#F4F0E8";
const TINTA = "#15120E";

/* ── 1 · Wordmark de Brunetti recoloreado ──────────────────────────────── */

/**
 * El SVG del repo pinta las letras con un degradado dorado (`wmGold`) y el resto
 * con un gris cálido. Se reemplazan los stops del degradado y ese gris, en vez de
 * aplanar el `fill`, para no perder el volumen de las letras.
 */
function recolorearWordmark(svg, { arriba, medio, abajo, secundario }) {
  return svg
    .replace(/stop-color="#f1e2b0"/g, `stop-color="${arriba}"`)
    .replace(/stop-color="#e9d7a0"/g, `stop-color="${arriba}"`)
    .replace(/stop-color="#c9a14e"/g, `stop-color="${medio}"`)
    .replace(/stop-color="#9c7a32"/g, `stop-color="${abajo}"`)
    .replace(/stop-color="#7a5e26"/g, `stop-color="${abajo}"`)
    .replace(/fill="#9a8d77"/g, `fill="${secundario}"`);
}

async function wordmarks() {
  const svg = fs.readFileSync(path.join(REPO, "brunetti-wordmark.svg"), "utf8");
  const variantes = [
    ["logo-brunetti-morado.png", { arriba: "#C79BF5", medio: MORADO, abajo: "#5E22A0", secundario: "#7A6E8C" }],
    ["logo-brunetti-crema.png", { arriba: "#FFFFFF", medio: CREMA, abajo: "#CFC7B8", secundario: "#9A8FB0" }],
    ["logo-brunetti-tinta.png", { arriba: "#3A352D", medio: TINTA, abajo: "#000000", secundario: "#8A8478" }],
  ];
  for (const [nombre, colores] of variantes) {
    const buf = Buffer.from(recolorearWordmark(svg, colores));
    await sharp(buf, { density: 900 }).resize({ width: 1600 }).png().toFile(path.join(OUT, nombre));
    console.log("✔", nombre);
  }
}

/* ── 2 · Iconos ────────────────────────────────────────────────────────── */

/**
 * Nombre propio → nombre en Feather. Se usa Feather porque su trazo fino y uniforme
 * acompaña a la tipografía en vez de competir con ella.
 */
const ICONOS = {
  ojo: "eye",
  tijera: "scissors",
  precio: "tag",
  estrella: "star",
  rayo: "zap",
  diana: "target",
  camara: "video",
  reloj: "clock",
  ajustes: "sliders",
  chat: "message-circle",
  personas: "users",
  grafico: "trending-up",
  guardado: "bookmark",
  telefono: "smartphone",
  corazon: "heart",
  compartir: "share-2",
  play: "play",
  premio: "award",
  capas: "layers",
  enlace: "link",
  billete: "dollar-sign",
  chispa: "feather",
  calendario: "calendar",
  filtro: "filter",
  check: "check-circle",
  cruz: "x-circle",
  flecha: "arrow-right",
  micro: "mic",
  alerta: "alert-circle",
  sonrisa: "smile",
  usuario: "user",
  mudo: "volume-x",
  pregunta: "help-circle",
};

const COLORES = { morado: MORADO, crema: CREMA, lila: LILA, tinta: TINTA, blanco: "#FFFFFF" };

async function iconos() {
  let n = 0;
  for (const [nombre, feName] of Object.entries(ICONOS)) {
    for (const [tono, color] of Object.entries(COLORES)) {
      const svg = feather.icons[feName].toSvg({
        color, width: 256, height: 256, "stroke-width": 1.7,
      });
      await sharp(Buffer.from(svg), { density: 384 })
        .resize(256, 256)
        .png()
        .toFile(path.join(OUT, "icons", `${nombre}-${tono}.png`));
      n++;
    }
  }
  console.log("✔", n, "iconos en assets/icons/");
}

(async () => {
  fs.mkdirSync(path.join(OUT, "icons"), { recursive: true });
  await wordmarks();
  await iconos();
})();
