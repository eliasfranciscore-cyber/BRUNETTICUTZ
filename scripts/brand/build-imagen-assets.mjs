/* Arte fijo del informe de Brunetti Image Studio (api/_imagenPdf.js),
   diseño Plata.

     node scripts/brand/build-imagen-assets.mjs

   pdf-lib no sabe dibujar degradados, brillos ni texturas: eso se dibuja acá
   una sola vez con Chrome headless (HTML + CSS + SVG) y se guarda en
   api/_assets/imagen/, que la función lee del disco (vercel.json lo incluye
   con includeFiles):

     bg.jpg        fondo A4 a 2x (1190×1684): papel perla, grano, marco doble
                   con estrellas en las esquinas y el monograma de marca de
                   agua.
     wordmark.png  el wordmark "Brunetticutz" del sitio pasado a cromo.
     monogram.png  el monograma "B cutz" (vectorial, del SVG de grabado) con
                   relleno cromado, fondo transparente.

   Además escribe public/assets/brunetti-asesoria-wordmark.webp, el wordmark
   plateado del menú de /asesoria (como el azul de Cursos y el morado del
   Workshop): el mismo de oro pasado a cromo, pero claro, para fondo oscuro.

   La tabla THEMES conserva las paletas de oro y morado que se probaron:
   solo se genera la de PLATA (la oficial).

   Requiere Google Chrome instalado (macOS), `sips` (viene con macOS) para
   pasar los fondos a JPEG y `cwebp` (brew install webp) para el del menú.
   Las fuentes no se generan acá: son los TTF de Google Fonts que están en
   api/_assets/imagen/fonts/. */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = path.join(ROOT, 'api/_assets/imagen')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-assets-'))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const W = 1190
const H = 1684

// El monograma vectorial: un solo <path> con fill-rule evenodd.
const MONO_SVG = fs.readFileSync(path.join(ROOT, 'scripts/brand/brunetti-monograma-negro.svg'), 'utf8')
const MONO_VIEWBOX = /viewBox="([^"]+)"/.exec(MONO_SVG)[1]
const MONO_D = /<path d="([^"]+)"/.exec(MONO_SVG)[1]

const THEMES = {
  oro: {
    page: `radial-gradient(120% 60% at 50% -8%, rgba(201,161,78,.20), transparent 60%),
           radial-gradient(90% 45% at 50% 108%, rgba(201,161,78,.10), transparent 70%),
           linear-gradient(180deg, #110f0c 0%, #0a0907 55%, #0d0b08 100%)`,
    line: '#c9a14e',
    lineSoft: 'rgba(201,161,78,.38)',
    star: ['#f1e2b0', '#c9a14e', '#7a5e26'],
    watermark: 'rgba(201,161,78,.055)',
    grain: 0.07,
    metal: ['#f6e7b6', '#e9d7a0', '#c9a14e', '#9c7a32', '#6e531f'],
    wordmark: { src: 'public/assets/brunetti-hero-wordmark.webp', filter: 'none' },
  },
  plata: {
    page: `radial-gradient(110% 55% at 50% -6%, rgba(255,255,255,.95), transparent 62%),
           radial-gradient(80% 40% at 50% 106%, rgba(170,174,182,.22), transparent 70%),
           linear-gradient(180deg, #f5f4f1 0%, #ecebe7 60%, #e4e3df 100%)`,
    line: '#8e939b',
    lineSoft: 'rgba(120,126,136,.35)',
    star: ['#ffffff', '#b9bec6', '#6d7279'],
    watermark: 'rgba(80,86,96,.05)',
    grain: 0.05,
    metal: ['#fdfdfd', '#d9dce1', '#a3a8b0', '#6f747c', '#4a4e55'],
    // El de oro pasado a cromo: sin saturación, más contraste para que se lea
    // sobre papel perla.
    wordmark: { src: 'public/assets/brunetti-hero-wordmark.webp', filter: 'grayscale(1) brightness(.78) contrast(1.55)' },
  },
  morado: {
    page: `radial-gradient(85% 50% at 12% -4%, rgba(136,56,216,.38), transparent 62%),
           radial-gradient(80% 45% at 96% 104%, rgba(107,47,179,.30), transparent 66%),
           linear-gradient(180deg, #120a1c 0%, #0b0612 60%, #0e0816 100%)`,
    line: '#b483f3',
    lineSoft: 'rgba(180,131,243,.36)',
    star: ['#ead9ff', '#b483f3', '#5b23a6'],
    watermark: 'rgba(180,131,243,.06)',
    grain: 0.07,
    metal: ['#efe0ff', '#cfa8fb', '#a46cf0', '#7232c9', '#4a1a8a'],
    wordmark: { src: 'public/assets/brunetti-workshop-wordmark.webp', filter: 'none' },
  },
}

// Estrella de cuatro puntas, como las del monograma (lados cóncavos).
const star = (cx, cy, r, k = 0.14) => {
  const c = r * k
  return `M${cx},${cy - r} C${cx + c},${cy - c} ${cx + c},${cy - c} ${cx + r},${cy} C${cx + c},${cy + c} ${cx + c},${cy + c} ${cx},${cy + r} C${cx - c},${cy + c} ${cx - c},${cy + c} ${cx - r},${cy} C${cx - c},${cy - c} ${cx - c},${cy - c} ${cx},${cy - r} Z`
}

function backgroundHtml(t) {
  const o = 30 // marco exterior (px a 2x = 15 pt)
  const i = 40 // marco interior
  const corner = (x, y) => `
    <path d="${star(x, y, 22)}" fill="url(#st)"/>
    <path d="${star(x, y, 7, 0.3)}" fill="${t.page.includes('#f5f4f1') ? '#f5f4f1' : '#0b0a08'}" opacity=".0"/>`
  return `<!doctype html><html><head><style>
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
    body{background:${t.page}}
    svg{position:absolute;inset:0}
  </style></head><body>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="st" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${t.star[0]}"/><stop offset=".5" stop-color="${t.star[1]}"/><stop offset="1" stop-color="${t.star[2]}"/>
      </linearGradient>
      <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
    </defs>
    <rect width="${W}" height="${H}" filter="url(#grain)" opacity="${t.grain}"/>
    <!-- marca de agua: el monograma, grande y casi invisible -->
    <svg x="${W * 0.18}" y="${H * 0.3}" width="${W * 0.64}" height="${H * 0.62}" viewBox="${MONO_VIEWBOX}" preserveAspectRatio="xMidYMid meet">
      <path d="${MONO_D}" fill="${t.watermark}" fill-rule="evenodd"/>
    </svg>
    <!-- marco doble -->
    <rect x="${o}" y="${o}" width="${W - 2 * o}" height="${H - 2 * o}" fill="none" stroke="${t.line}" stroke-width="1.6"/>
    <rect x="${i}" y="${i}" width="${W - 2 * i}" height="${H - 2 * i}" fill="none" stroke="${t.lineSoft}" stroke-width="1"/>
    <!-- esquinas: una escuadra corta por dentro y la estrella encima -->
    ${[[i, i, 1, 1], [W - i, i, -1, 1], [i, H - i, 1, -1], [W - i, H - i, -1, -1]].map(([x, y, sx, sy]) => `
      <path d="M${x + sx * 10},${y + sy * 60} L${x + sx * 10},${y + sy * 10} L${x + sx * 60},${y + sy * 10}" fill="none" stroke="${t.line}" stroke-width="1.2"/>
      <circle cx="${x + sx * 10}" cy="${y + sy * 10}" r="2.6" fill="${t.line}"/>`).join('')}
    ${[[o, o], [W - o, o], [o, H - o], [W - o, H - o]].map(([x, y]) => corner(x, y)).join('')}
    <!-- estrellas al medio de los lados largos -->
    <path d="${star(o, H / 2, 14)}" fill="url(#st)"/>
    <path d="${star(W - o, H / 2, 14)}" fill="url(#st)"/>
  </svg>
  </body></html>`
}

function wordmarkHtml({ src, filter }, width = 1200) {
  return `<!doctype html><html><head><style>
    html,body{margin:0;background:transparent}
    img{display:block;width:${width}px;height:auto;filter:${filter}}
  </style></head><body><img src="file://${path.join(ROOT, src)}"></body></html>`
}

// Wordmark del menú de /asesoria: mismo tamaño que los de oro, azul y morado
// (1508×539), cromo claro para que se lea sobre la barra oscura.
const NAV_WORDMARK = { src: 'public/assets/brunetti-hero-wordmark.webp', filter: 'grayscale(1) contrast(1.2)' }

function monogramHtml(t) {
  const [, , vw, vh] = MONO_VIEWBOX.split(/\s+/).map(Number)
  const w = 520
  const h = Math.round((w * vh) / vw)
  return {
    size: [w, h],
    html: `<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style></head><body>
    <svg width="${w}" height="${h}" viewBox="${MONO_VIEWBOX}">
      <defs><linearGradient id="m" x1="0" y1="0" x2=".35" y2="1">
        ${t.metal.map((c, k) => `<stop offset="${k / (t.metal.length - 1)}" stop-color="${c}"/>`).join('')}
      </linearGradient></defs>
      <path d="${MONO_D}" fill="url(#m)" fill-rule="evenodd"/>
    </svg></body></html>`,
  }
}

function shoot(html, [w, h], out, { transparent = false } = {}) {
  const file = path.join(TMP, `${path.basename(out)}.html`)
  fs.writeFileSync(file, html)
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    '--force-device-scale-factor=1', `--window-size=${w},${h}`,
    ...(transparent ? ['--default-background-color=00000000'] : []),
    `--screenshot=${out}`, `file://${file}`,
  ], { stdio: 'ignore' })
}

fs.mkdirSync(OUT, { recursive: true })
{
  const t = THEMES.plata
  const png = path.join(TMP, 'bg.png')
  shoot(backgroundHtml(t), [W, H], png)
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '84', png, '--out', path.join(OUT, 'bg.jpg')], { stdio: 'ignore' })

  // 1200 px de ancho; el alto sale del archivo de origen (~430 px).
  shoot(wordmarkHtml(t.wordmark), [1200, 440], path.join(OUT, 'wordmark.png'), { transparent: true })

  const mono = monogramHtml(t)
  shoot(mono.html, mono.size, path.join(OUT, 'monogram.png'), { transparent: true })
  console.log('✓ plata')
}
{
  const png = path.join(TMP, 'nav-wordmark.png')
  shoot(wordmarkHtml(NAV_WORDMARK, 1508), [1508, 539], png, { transparent: true })
  execFileSync('cwebp', ['-quiet', '-q', '86', '-alpha_q', '100', png, '-o', path.join(ROOT, 'public/assets/brunetti-asesoria-wordmark.webp')])
  console.log('✓ menú de /asesoria')
}
fs.rmSync(TMP, { recursive: true, force: true })
