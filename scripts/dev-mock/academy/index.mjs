/* Mock de la API de Academy para desarrollo — código COMPARTIDO entre
   PimpStudio (/academy) y BrunettiCutz (/cursos), ver docs/academy/PORTABLE.md.
   SOLO `vite` en modo serve y SOLO con VITE_DEV_MOCKS=1 (SPEC §13).

   Por qué existe: la Academy entera (catálogo, app de miembros, pestaña del
   panel, checkout) se tiene que poder recorrer sin `vercel dev`, sin
   .env.local y sin tocar Neon, Mercado Pago ni Resend. `.env.local` tiene
   credenciales de PRODUCCIÓN: probar una compra o un correo contra eso es
   justo lo que no queremos hacer por accidente.

   Lo propio de cada sitio sale de ./host.mjs (MOCK_HOST, el único archivo
   de esta carpeta que no se copia): base de rutas, ruta del checkout,
   marca, barbero del panel y cursos de fixtures.

   Uso
     createAcademyMock({ base?, checkoutPath? }) → { middleware, state, reset }
       middleware(req, res, next) estilo connect; lo que no es de la Academy
       sigue con next(). Las opciones pisan las de MOCK_HOST.
     mountAcademyMock(server, { banner? }) → mock   (configureServer de Vite:
       crea el mock, avisa la deriva con api/_academy.js y lo monta)
     default: plugin de Vite listo (`apply: 'serve'`) para un repo que no
       necesita nada más. Tiene que ir ANTES que cualquier otro mock de /api.
     http: send, readRaw, parseJson, errorReply, clientIp, failSet, sleep
       (para el mock propio del host, p. ej. el /api/auth-barber de PimpStudio)

   Qué contesta
     /api/academy?mode=…        los 88 modos del router real (api/_academy.js
                                MODE_OWNERS), con la misma puerta de acceso
                                y los mismos métodos (tabla MODES de lib.mjs);
                                también /api/services?scope=academy&mode=…
                                (el rewrite de vercel.json no existe en Vite)
     <MOCK_HOST.checkoutPath>   solo POST {kind:'course'} y GET ?ref=aca-…
                                (PimpStudio /api/checkout?ref=…, BrunettiCutz
                                /api/mp-payments?status=1&ref=…); lo demás
                                sigue con next() y el body se puede volver a leer
     /assets/__mock-uploads/…   las imágenes públicas subidas con `upload`
                                (viven en memoria, no hay Vercel Blob)
     /api/__mock/…              ayudas que NO existen en producción (también
                                como /api/__mock/academy/…, que nunca choca
                                con el mock propio del host):
        POST reset              estado nuevo desde fixtures.mjs
        GET  state              vuelca el estado en memoria
        GET  outbox             correos "enviados" (ahí está la contraseña temporal)
        GET  members            lista de miembros (para el selector de desarrollo)
        GET  login-as?member=ID {token, member} para entrar como ese miembro
                                (sin ?member → lista de miembros para el selector)
        POST mp?ref=&status=    simula el webhook de Mercado Pago de una orden
                                (approved | refunded | rejected | pending | cancelled)
       Los nombres de MOCK_HOST.sharedMockTools (BrunettiCutz: reset, state)
       los contesta el mock propio del host: acá solo se hace la parte de la
       Academy (reset reinicia su estado) y se sigue con next().

   Sesiones: miembro `mockm.<id>.<ts>`; barbero admin `mockb.<id>.<ts>`, el
   `dev-token` del respaldo local de BarberLogin o el que reconozca
   MOCK_HOST.panelBarberId (owner-session funciona con cualquiera).
   Contraseña de todas las cuentas de fixtures: `academy123`.

   Perillas:
     DEV_MOCK_DELAY=400         latencia artificial en ms
     DEV_MOCK_FAIL=feed,chat    esos modos (o "checkout") responden 500
                                "Error interno", DESPUÉS de la puerta de
                                acceso, como un error real de base
     DEV_MOCK_BOTS=1            respuestas automáticas en el chat y una
                                publicación nueva cada 2 min (academy-chat.mjs)
     DEV_MOCK_CHECKOUT=pending|off   la compra queda pendiente / checkout cerrado (503)

   Nada de esto llega al bundle: vite.config.js lo importa dinámicamente en
   Node solo con la variable puesta, y el plugin es `apply: 'serve'`. */

import fs from 'node:fs'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createState } from './fixtures.mjs'
import * as lib from './lib.mjs'
import * as core from './academy-core.mjs'
import * as community from './academy-community.mjs'
import * as chat from './academy-chat.mjs'
import * as events from './academy-events.mjs'

const { HttpError, MODES, HOST, configureHost, buildCtx, gate, setCurrentState, nowIso } = lib

// lib.MODES dice en qué archivo del mock vive cada modo (espejo de los
// import() por archivo del router real).
const HANDLERS = {
  core: core.handlers,
  community: community.handlers,
  chat: chat.handlers,
  events: events.handlers,
}

const JSON_TYPE = 'application/json; charset=utf-8'
const MAX_BODY = 4 * 1024 * 1024 // un upload de 2 MB en base64 pesa ~2,7 MB

/* ── Respuestas ─────────────────────────────────────────────────────────── */
function send(res, status, body, { cache = 'private, no-store', headers = {} } = {}) {
  if (res.headersSent || res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', JSON_TYPE)
  res.setHeader('Cache-Control', cache)
  res.setHeader('X-Dev-Mock', '1')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

// HttpError del lib, o el Error con `status` que arma el respaldo de
// academy-community.mjs (fail()) → {ok:false, error, code, ...extra}.
function errorReply(res, err, label) {
  const status = Number(err?.status)
  if (err instanceof HttpError || (Number.isInteger(status) && status >= 400 && status < 600)) {
    const body = { ok: false, error: err.message || 'Error', ...(err.code ? { code: err.code } : {}), ...(err.extra || {}) }
    const retry = Number(err.extra?.retryAfter)
    const headers = Number.isFinite(retry) && retry > 0 ? { 'Retry-After': String(Math.ceil(retry)) } : {}
    return send(res, status || 500, body, { headers })
  }
  // Igual que el real: el detalle queda en la consola, nunca en la respuesta.
  console.error(`  [dev-mock:${label}]`, err?.stack || err?.message || err)
  return send(res, 500, { ok: false, error: 'Error interno' })
}

/* ── Body ───────────────────────────────────────────────────────────────── */
function readRaw(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve(Buffer.alloc(0))
  // Si otro middleware ya lo leyó (o una prueba lo pasa armado), se usa ese.
  if (req.body !== undefined) {
    const b = req.body
    return Promise.resolve(Buffer.isBuffer(b) ? b : Buffer.from(typeof b === 'string' ? b : JSON.stringify(b)))
  }
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size <= MAX_BODY) chunks.push(c)
    })
    req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks)))
    req.on('error', () => resolve(Buffer.alloc(0)))
  })
}

// Igual que parseBody() del router real: solo un objeto plano; JSON roto,
// un arreglo o un número → {} (keepalive/sendBeacon a veces llegan como texto).
function parseJson(raw) {
  if (!raw || !raw.length) return {}
  try {
    const b = JSON.parse(raw.toString('utf8'))
    return b && typeof b === 'object' && !Array.isArray(b) ? b : {}
  } catch {
    return {}
  }
}

/* Un POST al checkout que no es de un curso (Essentials, Workshop…) sigue
   con next(). Como ya leímos el stream para ver `kind`, se lo devolvemos a
   los dos tipos de lector: http-proxy (VITE_API_PROXY) hace
   `req.pipe(proxyReq)`, y el mock propio del host (BrunettiCutz) escucha
   req.on('data') / req.on('end'). */
function replayBody(req, raw) {
  const again = Readable.from(raw && raw.length ? [raw] : [])
  const own = { on: req.on, once: req.once, addListener: req.addListener }
  const STREAM_EVENTS = new Set(['data', 'end', 'readable'])
  for (const name of Object.keys(own)) {
    req[name] = function (event, fn) {
      if (STREAM_EVENTS.has(event)) { again[name](event, fn); return this }
      return own[name].call(this, event, fn)
    }
  }
  req.pipe = (dest, opts) => again.pipe(dest, opts)
  req[Symbol.asyncIterator] = () => again[Symbol.asyncIterator]()
}

const clientIp = (req) =>
  String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failSet = () => new Set(String(process.env.DEV_MOCK_FAIL || '').split(',').map((s) => s.trim()).filter(Boolean))

export const http = { send, readRaw, parseJson, errorReply, clientIp, failSet, sleep }

/* Mapas y buffers no se pueden volcar a JSON tal cual. */
function dumpState(state) {
  return JSON.parse(JSON.stringify(state, (key, value) => {
    if (value instanceof Map) {
      return Object.fromEntries([...value].map(([k, v]) => [k, v?.buffer ? { ...v, buffer: `<${v.buffer.length} bytes>` } : v]))
    }
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) return `<${value.data.length} bytes>`
    return value
  }))
}

/* Chequeo de deriva al arrancar: si alguien agrega o cambia un modo en el
   router real y no en lib.MODES, el mock lo avisa en vez de responder 404
   callado. Lee el archivo como texto (importarlo cargaría Neon y _auth.js). */
function checkModeDrift(logger = console) {
  try {
    const path = fileURLToPath(new URL('../../../api/_academy.js', import.meta.url))
    const src = fs.readFileSync(path, 'utf8')
    const AUTH = { 'member-pwc': 'pwc', moderator: 'mod' }
    const problems = []
    const seen = new Set()
    for (const m of src.matchAll(/"([a-z-]+)":\s*m\(\w+,\s*"([a-z-]+)",\s*(GET|POST|\[[^\]]*\])\)/g)) {
      const [, mode, auth, methodsRaw] = m
      seen.add(mode)
      const methods = methodsRaw === 'GET' ? ['GET'] : methodsRaw === 'POST' ? ['POST'] : JSON.parse(methodsRaw)
      const mock = MODES[mode]
      if (!mock) { problems.push(`${mode}: no está en el mock`); continue }
      if ((AUTH[auth] || auth) !== mock.auth) problems.push(`${mode}: auth real ${auth}, mock ${mock.auth}`)
      if (methods.join() !== mock.methods.join()) problems.push(`${mode}: métodos real ${methods}, mock ${mock.methods}`)
    }
    for (const mode of Object.keys(MODES)) if (seen.size && !seen.has(mode)) problems.push(`${mode}: sobra en el mock`)
    for (const [mode, def] of Object.entries(MODES)) {
      if (typeof HANDLERS[def.file]?.[mode] !== 'function') problems.push(`${mode}: sin handler en academy-${def.file}.mjs`)
    }
    if (problems.length) logger.warn?.(`\n  ⚠ Mock Academy desalineado con api/_academy.js:\n    ${problems.join('\n    ')}\n`)
    return problems
  } catch {
    return []
  }
}

/* ── El mock ────────────────────────────────────────────────────────────── */
export function createAcademyMock({ base, checkoutPath } = {}) {
  configureHost({ base, checkoutPath })
  let state = createState()
  setCurrentState(state)
  chat.setup?.({ getState: () => state, log: (...a) => console.log(...a) })

  function reset() {
    state = createState()
    setCurrentState(state)
    chat.resetChatMemory?.()
  }

  // Los miembros "siempre en línea" de fixtures (para que En línea tenga gente).
  function touchOnline() {
    const now = nowIso()
    for (const id of state.mock?.alwaysOnline || []) {
      const m = state.academy_members.find((x) => x.id === id)
      if (m && m.status === 'activo') m.last_sync_at = now
    }
  }

  async function academy(req, res, url) {
    const query = Object.fromEntries(url.searchParams)
    const mode = String(query.mode || '')
    const method = String(req.method || 'GET').toUpperCase()
    const entry = Object.prototype.hasOwnProperty.call(MODES, mode) ? MODES[mode] : null
    if (!entry) return send(res, 404, { ok: false, error: 'Modo no reconocido' })
    if (!entry.methods.includes(method)) {
      return send(res, 405, { ok: false, error: 'Método no permitido' }, { headers: { Allow: entry.methods.join(', ') } })
    }
    const raw = await readRaw(req)
    if (raw === null) return send(res, 413, { ok: false, error: 'La solicitud es demasiado grande.' })
    const body = method === 'GET' ? {} : parseJson(raw)

    const ctx = buildCtx({ state, req, res, mode, query, body, ip: clientIp(req) })
    ctx.lib = lib
    ctx.HttpError = HttpError
    try {
      gate(ctx, entry.auth)
      if (failSet().has(mode)) {
        console.warn(`  [dev-mock:${mode}] falla simulada (DEV_MOCK_FAIL)`)
        return send(res, 500, { ok: false, error: 'Error interno' })
      }
      const fn = HANDLERS[entry.file]?.[mode]
      if (typeof fn !== 'function') return send(res, 501, { ok: false, error: 'Esta sección de la Academy todavía no está lista.', code: 'not_implemented' })
      const result = await fn(ctx)
      if (res.headersSent || res.writableEnded) return
      const out = result && typeof result === 'object' && !Array.isArray(result) ? { ...result } : {}
      // El `file` de chat, llamado sin `res`, devuelve los bytes así.
      if (out.__file) {
        const buf = Buffer.from(out.__file.base64, 'base64')
        res.statusCode = 200
        res.setHeader('Content-Type', out.__file.contentType)
        res.setHeader('Cache-Control', out.__file.cache || 'private, max-age=300')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        return res.end(buf)
      }
      if (out.__redirect) {
        res.statusCode = 302
        res.setHeader('Location', out.__redirect)
        return res.end()
      }
      // Solo un modo público puede pedir caché de CDN, como en el real.
      let cache = 'private, no-store'
      if (typeof out.__cache === 'string' && entry.auth === 'public') cache = out.__cache
      delete out.__cache
      delete out.ok
      return send(res, 200, { ok: true, ...out }, { cache })
    } catch (err) {
      if (res.headersSent || res.writableEnded) {
        console.error(`  [dev-mock:${mode}] error después de responder:`, err?.message || err)
        return
      }
      return errorReply(res, err, mode)
    }
  }

  // MOCK_HOST.checkoutPath: solo lo de cursos; Essentials/Workshop siguen su camino.
  async function checkout(req, res, url, next) {
    const method = String(req.method || 'GET').toUpperCase()
    const query = Object.fromEntries(url.searchParams)
    if (method === 'GET') {
      if (!/^aca-/.test(String(query.ref || ''))) return next()
      const ctx = buildCtx({ state, req, res, mode: 'checkout-status', query, body: {}, ip: clientIp(req) })
      try {
        return send(res, 200, { ok: true, ...(await core.checkout.status(ctx)) })
      } catch (err) {
        return errorReply(res, err, 'checkout')
      }
    }
    if (method !== 'POST') return next()
    const raw = await readRaw(req)
    if (raw === null) return send(res, 413, { ok: false, error: 'La solicitud es demasiado grande.' })
    const body = parseJson(raw)
    if (body.kind !== 'course') {
      replayBody(req, raw)
      return next()
    }
    const ctx = buildCtx({ state, req, res, mode: 'checkout', query, body, ip: clientIp(req) })
    try {
      if (failSet().has('checkout')) return send(res, 500, { ok: false, error: 'Error interno' })
      return send(res, 200, { ok: true, ...(await core.checkout.post(ctx)) })
    } catch (err) {
      return errorReply(res, err, 'checkout')
    }
  }

  async function mockTools(req, res, url, next) {
    let name = url.pathname.replace(/^\/api\/__mock\/?/, '').replace(/\/$/, '')
    // /api/__mock/academy/<x> siempre es de la Academy; /api/__mock/<x> se
    // comparte con el mock propio del host si está en sharedMockTools.
    const namespaced = name === 'academy' || name.startsWith('academy/')
    if (namespaced) name = name.replace(/^academy\/?/, '')
    const shared = !namespaced && (HOST.sharedMockTools || []).includes(name)
    const method = String(req.method || 'GET').toUpperCase()
    const query = Object.fromEntries(url.searchParams)
    try {
      switch (name) {
        case 'reset': {
          if (method !== 'POST') return shared ? next() : send(res, 405, { ok: false, error: 'Usa POST' }, { headers: { Allow: 'POST' } })
          reset()
          console.log('  ↺ Mock Academy · estado reiniciado desde fixtures')
          return shared ? next() : send(res, 200, { ok: true, reset: true })
        }
        case 'state':
          return shared ? next() : send(res, 200, { ok: true, state: dumpState(state) })
        case 'outbox':
          return send(res, 200, { ok: true, outbox: state.outbox })
        case 'members':
          return send(res, 200, { ok: true, members: core.mockMemberList(state) })
        case 'login-as': {
          if (!query.member && !query.email) return send(res, 200, { ok: true, members: core.mockMemberList(state) })
          return send(res, 200, { ok: true, ...core.mockLoginAs(state, { member: query.member, email: query.email }) })
        }
        case 'mp': {
          if (method !== 'POST' && method !== 'GET') return send(res, 405, { ok: false, error: 'Usa POST' })
          const body = parseJson(await readRaw(req))
          const ref = String(query.ref || body.ref || '')
          const status = String(query.status || body.status || 'approved')
          return send(res, 200, { ok: true, order: core.applyMockPayment(state, ref, status) })
        }
        default:
          return shared ? next() : send(res, 404, { ok: false, error: `El mock no conoce /api/__mock/${namespaced ? 'academy/' : ''}${name}` })
      }
    } catch (err) {
      return errorReply(res, err, `__mock/${name}`)
    }
  }

  // Imágenes públicas subidas con `upload` (las privadas van por mode=file).
  function uploadedAsset(req, res, url) {
    const path = decodeURIComponent(url.pathname)
    const blob = [...state.mock.blobs.values()].find((b) => !b.private && b.url === path)
    if (!blob) {
      res.statusCode = 404
      return res.end()
    }
    res.statusCode = 200
    res.setHeader('Content-Type', blob.contentType)
    res.setHeader('Content-Length', String(blob.buffer.length))
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    return res.end(blob.buffer)
  }

  async function middleware(req, res, next = () => {}) {
    const rawUrl = req.url || ''
    const isApi = rawUrl.startsWith('/api/')
    if (!isApi && !rawUrl.startsWith('/assets/__mock-uploads/')) return next()
    const url = new URL(rawUrl, 'http://mock.local')
    const path = url.pathname.replace(/\.js$/, '').replace(/\/$/, '')
    // El rewrite de vercel.json (/api/academy → /api/services?scope=academy)
    // no existe en Vite: se aceptan las dos formas.
    const isAcademy = path === '/api/academy' || (path === '/api/services' && url.searchParams.get('scope') === 'academy')
    const isCheckout = path === HOST.checkoutPath
    const handled = isAcademy || isCheckout ||
      path === '/api/__mock' || path.startsWith('/api/__mock/') || path.startsWith('/assets/__mock-uploads/')
    if (!handled) return next()

    setCurrentState(state)
    touchOnline()
    const delay = Math.max(0, Number(process.env.DEV_MOCK_DELAY) || 0)
    if (delay && isApi) await sleep(delay)
    try {
      if (isAcademy) return await academy(req, res, url)
      if (isCheckout) return await checkout(req, res, url, next)
      if (path.startsWith('/assets/__mock-uploads/')) return uploadedAsset(req, res, url)
      return await mockTools(req, res, url, next)
    } catch (err) {
      return errorReply(res, err, path)
    }
  }

  return {
    middleware,
    get state() { return state },
    reset,
  }
}

export { checkModeDrift }

/* Para el configureServer de Vite de cada repo (pre-hook, sin devolver
   función: el middleware queda ANTES de los de Vite, que si no servirían el
   código fuente de /api/*.js o el proxy). */
export function mountAcademyMock(server, { banner, ...options } = {}) {
  const mock = createAcademyMock(options)
  checkModeDrift(server.config.logger)
  server.middlewares.use(mock.middleware)
  server.config.logger.info(banner ?? (
    `\n  ✓ Mock de Academy activo (VITE_DEV_MOCKS=1): /api/academy y ${HOST.checkoutPath} (cursos) salen de scripts/dev-mock/academy, en memoria. Front en ${HOST.base}.` +
    `\n    Cuentas: ${HOST.barber?.email || 'el propietario'} (propietario), diego@demo.cl (miembro) · clave academy123.\n`
  ))
  return mock
}

export default function academyDevMock(options = {}) {
  return {
    name: `academy-dev-mock:${HOST.key || 'host'}`,
    apply: 'serve',
    configureServer(server) {
      if (process.env.VITE_DEV_MOCKS !== '1') return
      mountAcademyMock(server, options)
    },
  }
}
