#!/usr/bin/env node
/* Copia la Academy compartida de ESTE repo a otro (ver docs/academy/PORTABLE.md).

     node scripts/academy-sync.mjs ../BRUNETTICUTZ           # copia
     node scripts/academy-sync.mjs ../BRUNETTICUTZ --dry     # solo muestra qué cambiaría

   Copia el set compartido tal cual y NUNCA toca los 4 archivos del host de destino
   (api/_academyHost.js, src/academy/hostConfig.js, src/academy/host.jsx,
   scripts/dev-mock/academy/host.mjs). Borra en el destino los archivos compartidos que ya
   no existen acá (para que un archivo renombrado no quede huérfano). Al final revisa que el
   código compartido no importe nada del repo fuera de la lista permitida: si algo se coló,
   lo avisa y termina con código 1 (se copió igual, pero hay que arreglarlo antes del build). */
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const target = args.find((a) => !a.startsWith('--'))
if (!target) { console.error('Uso: node scripts/academy-sync.mjs <repo destino> [--dry]'); process.exit(2) }
const DST = path.resolve(target)
if (!fs.existsSync(path.join(DST, 'package.json'))) { console.error(`✗ ${DST} no parece un repo (no hay package.json)`); process.exit(2) }
if (DST === SRC) { console.error('✗ El destino es este mismo repo'); process.exit(2) }

// Set compartido: raíces (carpetas o archivos) relativas al repo.
const SHARED = [
  'api/_webpush.js',
  'src/academy',
  'src/pages/academy',
  'src/components/academy',
  'src/styles/academy',
  'src/pages/panel/AcademyTab.jsx',
  'src/pages/panel/academy',
  'src/styles/panel/academy.css',
  'scripts/dev-mock/academy',
  'scripts/academy-sync.mjs',
  'docs/academy/SPEC.md',
  'docs/academy/PORTABLE.md',
]
const SHARED_GLOBS = [{ dir: 'api', test: (f) => /^_academy.*\.js$/.test(f) }]
const HOST_FILES = new Set([
  'api/_academyHost.js',
  'src/academy/hostConfig.js',
  'src/academy/host.jsx',
  'scripts/dev-mock/academy/host.mjs',
])
const IGNORE = (rel) => / 2\.[a-z]+$/.test(rel) || rel.includes('.DS_Store') // copias de conflicto de iCloud

function walk(root, rel) {
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) return []
  const st = fs.statSync(abs)
  if (st.isFile()) return [rel]
  return fs.readdirSync(abs).flatMap((n) => walk(root, path.join(rel, n)))
}
function sharedFiles(root) {
  const out = new Set()
  for (const r of SHARED) for (const f of walk(root, r)) out.add(f)
  for (const g of SHARED_GLOBS) {
    const d = path.join(root, g.dir)
    if (fs.existsSync(d)) for (const n of fs.readdirSync(d)) if (g.test(n)) out.add(path.join(g.dir, n))
  }
  return [...out].filter((f) => !HOST_FILES.has(f) && !IGNORE(f)).sort()
}

const srcFiles = sharedFiles(SRC)
const dstFiles = new Set(sharedFiles(DST))
let copied = 0, same = 0, removed = 0
for (const rel of srcFiles) {
  const a = fs.readFileSync(path.join(SRC, rel))
  const bPath = path.join(DST, rel)
  const b = fs.existsSync(bPath) ? fs.readFileSync(bPath) : null
  dstFiles.delete(rel)
  if (b && a.equals(b)) { same++; continue }
  console.log(`${b ? '~' : '+'} ${rel}`)
  if (!DRY) { fs.mkdirSync(path.dirname(bPath), { recursive: true }); fs.writeFileSync(bPath, a) }
  copied++
}
for (const rel of dstFiles) {
  console.log(`- ${rel}`)
  if (!DRY) fs.rmSync(path.join(DST, rel))
  removed++
}
for (const h of HOST_FILES) if (!fs.existsSync(path.join(DST, h))) console.log(`! falta el archivo del host en el destino: ${h}`)

// Chequeo de la regla de imports (PORTABLE.md §1).
const ALLOWED = [
  /^react(-dom|-router-dom)?(\/|$)/, /^@neondatabase\/serverless$/, /^@vercel\/blob/, /^web-push$/, /^node:/,
]
const ALLOWED_LOCAL = [
  'api/_academyHost.js', 'src/academy/hostConfig.js', 'src/academy/host.jsx', 'scripts/dev-mock/academy/host.mjs',
  'src/components/panel/index.js', 'src/components/panel/hooks.js', 'src/components/theme.jsx', 'src/data.js',
  'src/installPrompt.js', 'src/components/InstallPrompt.jsx',
]
const sharedSet = new Set(srcFiles)
const problems = []
for (const rel of srcFiles.filter((f) => /\.(m?js|jsx)$/.test(f))) {
  const code = fs.readFileSync(path.join(SRC, rel), 'utf8')
  const re = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|export\s[^'"]*?from\s*)['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(code))) {
    const spec = m[1]
    if (!spec.startsWith('.')) { if (!ALLOWED.some((r) => r.test(spec))) problems.push(`${rel}: paquete ${spec}`); continue }
    const resolved = path.normalize(path.join(path.dirname(rel), spec))
    if (/\.css$/.test(resolved)) { if (!sharedSet.has(resolved)) problems.push(`${rel}: css fuera del set ${resolved}`); continue }
    if (sharedSet.has(resolved) || ALLOWED_LOCAL.includes(resolved)) continue
    problems.push(`${rel}: importa ${resolved}`)
  }
}

console.log(`\n${DRY ? '[simulación] ' : ''}${copied} copiados/actualizados, ${same} iguales, ${removed} borrados en ${DST}`)
if (problems.length) {
  console.log(`\n✗ ${problems.length} import(s) fuera de la regla de PORTABLE.md §1:`)
  for (const p of problems) console.log('  ' + p)
  process.exit(1)
}
console.log('✓ El set compartido solo importa lo permitido.')
