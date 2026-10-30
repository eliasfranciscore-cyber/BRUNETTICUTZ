/* Ejemplo de entregable para /asesoria (Brunetti Image Studio).

     node scripts/brand/build-asesoria-ejemplo.mjs

   Arma un informe de MUESTRA con el generador real (api/_imagenPdf.js) —
   cliente ficticio, solo diagnóstico, cortes, rutina y consejos: ningún
   producto, para no mostrar marcas que no existen — y lo pasa a imágenes:

     public/assets/asesoria/informe-<n>.jpg   páginas para la sección
                                              "Así es tu informe"
     public/assets/asesoria/og-asesoria.jpg   1200×630 para compartir

   Requiere `pdftoppm` (poppler) y Google Chrome (macOS), como
   build-imagen-assets.mjs. Volver a correrlo si cambia el diseño del PDF. */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildImagenPdf } from '../../api/_imagenPdf.js'
import { suggest } from '../../api/_imagenRules.js'
import { FACE_SHAPES } from '../../src/data/estilo.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = path.join(ROOT, 'public/assets/asesoria')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'asesoria-ejemplo-'))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const f = FACE_SHAPES.find((s) => s.id === 'ovalado')
const face = { id: f.id, name: f.name, tagline: f.tagline, traits: f.traits, diagnosis: f.diagnosis, goal: f.goal, avoid: f.avoid, path: f.path, tips: f.tips, best: f.best.map(({ name, note, img }) => ({ name, note, img })) }
const diagnosis = {
  face,
  skull: { occipital: 'Normal', projection: 'Media', height: 'Media', sides: 'Equilibradas' },
  hair: { type: 'Ondulado', thickness: 'Medio', density: 'Alta', condition: 'Mixto', frizz: 'Leve', volume: 'Medio', sensitivity: 'No', loss: 'No' },
  observations: 'Remolino suave en la coronilla: dejamos algo más de largo para que caiga hacia adelante.',
}
// Solo lo que no es producto: el ejemplo no muestra marcas.
const recs = suggest({ diagnosis, intake: { finish: 'Natural' }, catalog: [] }).items
  .filter((i) => !i.productId)
  .filter((i, n, all) => i.kind !== 'consejo' || all.filter((x) => x.kind === 'consejo').indexOf(i) < 4)
const snap = {
  version: 1, generatedAt: new Date().toISOString(),
  client: { name: 'Cliente de ejemplo' },
  consultation: { modality: 'online', notes: 'Tu pelo ondulado tiene todo para un corte con movimiento: déjalo crecer arriba y repásalo a tiempo.' },
  diagnosis, recs,
}

fs.mkdirSync(OUT, { recursive: true })
const pdfPath = path.join(TMP, 'ejemplo.pdf')
fs.writeFileSync(pdfPath, await buildImagenPdf(snap))
execFileSync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=82', '-r', '96', '-f', '1', '-l', '3', pdfPath, path.join(TMP, 'p')])
const pages = fs.readdirSync(TMP).filter((n) => /^p-\d+\.jpg$/.test(n)).sort()
pages.forEach((n, i) => fs.copyFileSync(path.join(TMP, n), path.join(OUT, `informe-${i + 1}.jpg`)))

// Imagen para compartir: papel perla, wordmark cromado y dos páginas.
const wordmark = path.join(ROOT, 'api/_assets/imagen/wordmark.png')
const og = `<!doctype html><html><head><style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden;font-family:Georgia,serif}
  body{background:radial-gradient(90% 80% at 20% 0%,#fff,transparent 60%),linear-gradient(180deg,#f5f4f1,#e4e3df);position:relative}
  .wm{position:absolute;left:70px;top:150px;width:520px}
  .k{position:absolute;left:74px;top:330px;font:600 18px Arial,sans-serif;letter-spacing:.42em;color:#5f646c;text-transform:uppercase}
  .t{position:absolute;left:72px;top:372px;width:560px;font-size:40px;line-height:1.15;color:#1d1f23}
  .p{position:absolute;width:300px;box-shadow:0 30px 60px -20px rgba(0,0,0,.35);border:1px solid #c9ccd2}
  .p1{right:250px;top:70px;transform:rotate(-4deg)}
  .p2{right:60px;top:110px;transform:rotate(5deg)}
</style></head><body>
  <img class="wm" src="file://${wordmark}">
  <div class="k">Brunetti Image Studio</div>
  <div class="t">Tu diagnóstico, tus cortes y tu rutina, en un informe personalizado.</div>
  <img class="p p1" src="file://${path.join(OUT, 'informe-1.jpg')}">
  <img class="p p2" src="file://${path.join(OUT, 'informe-2.jpg')}">
</body></html>`
fs.writeFileSync(path.join(TMP, 'og.html'), og)
const png = path.join(TMP, 'og.png')
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1', '--window-size=1200,630', `--screenshot=${png}`, `file://${path.join(TMP, 'og.html')}`], { stdio: 'ignore' })
execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', png, '--out', path.join(OUT, 'og-asesoria.jpg')], { stdio: 'ignore' })
fs.rmSync(TMP, { recursive: true, force: true })
console.log('✓', pages.length, 'páginas + og-asesoria.jpg en', path.relative(ROOT, OUT))
