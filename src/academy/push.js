/* ACADEMY — notificaciones push del miembro (SPEC §11)
   ------------------------------------------------------------------
   El navegador tiene UNA sola suscripción de Web Push por dispositivo (un solo
   service worker con scope "/"): el panel del barbero y la Academy comparten
   el mismo endpoint y cada uno lo guarda en SU tabla del servidor
   (push_subscriptions vs academy_push_subscriptions). De ahí las dos reglas:

   - Activar/sincronizar usa getOrCreateSubscription() (abajo, copia propia
     de la de src/push.js para no depender del repo), que reutiliza la
     suscripción existente en vez de crear otra (crear una nueva invalidaría
     la del panel).
   - Desactivar borra SOLO la fila de la Academy en el servidor. La
     suscripción del navegador se da de baja únicamente si ningún barbero
     tiene sus avisos activos en este dispositivo (`ps_push_enabled_*`):
     un alumno que apaga sus avisos no puede dejar a Bruno sin las alertas de
     reservas en el mismo teléfono.

   La marca local `ps_academy_push_enabled='1'` la lee src/push.js (el
   disablePush del panel tampoco da de baja si la Academy la usa). */

import { academyApi, ApiError } from './api.js'

const VAPID_PUBLIC_KEY = import.meta.env?.VITE_VAPID_PUBLIC_KEY || ''

/* --- navegador (autocontenido: el mismo criterio que src/push.js) --- */

function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS se reporta como Mac con touch
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
}

function browserPushSupported() {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
}

function permissionState() {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission // 'default' | 'granted' | 'denied'
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/* El registro del service worker del sitio (/sw.js, scope "/"). Normalmente
   ya lo registró main.jsx al cargar; si no, se registra acá (el mismo
   archivo y el mismo scope, así que nunca hay dos). */
let swRegistration = null
async function serviceWorkerRegistration() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  if (swRegistration) return swRegistration
  try {
    const existing = await navigator.serviceWorker.getRegistration('/')
    if (!existing) await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    swRegistration = await navigator.serviceWorker.ready
    return swRegistration
  } catch (err) {
    console.warn('[academy:push] SW register failed:', err)
    return null
  }
}

/* La PushSubscription de este navegador, creándola si no existe. NO pide
   permiso — quien llama lo pide antes con un gesto del usuario —, así que con
   el permiso sin conceder devuelve null en vez de disparar un diálogo desde
   un efecto al abrir la app. También null si no hay soporte, service worker
   o clave VAPID. Lanza si subscribe() falla (quien llama decide cómo
   mostrarlo). Hay UNA suscripción por dispositivo: se reutiliza la que ya
   exista (la del panel, si el barbero la activó en este teléfono). */
async function getOrCreateSubscription() {
  if (!browserPushSupported() || !VAPID_PUBLIC_KEY) return null
  if (permissionState() !== 'granted') return null
  const reg = await serviceWorkerRegistration()
  if (!reg?.pushManager) return null
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }
  return sub
}
const FLAG_KEY = 'ps_academy_push_enabled'
// Último endpoint re-registrado y cuándo: syncAcademyPush corre en cada
// apertura de la app y no hace falta escribir en Neon cada vez (cobra por
// tiempo de cómputo despierto). Una vez al día basta para reparar una fila
// que el servidor borró por 404/410.
const SYNC_KEY = 'ps_academy_push_synced'
const SYNC_EVERY_MS = 24 * 60 * 60 * 1000

function readFlag() {
  try { return localStorage.getItem(FLAG_KEY) === '1' } catch { return false }
}
function writeFlag(on) {
  try {
    if (on) localStorage.setItem(FLAG_KEY, '1')
    else localStorage.removeItem(FLAG_KEY)
  } catch { /* sin storage: el interruptor dura lo que la pestaña */ }
}
function readSynced() {
  try {
    const v = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null')
    return v && typeof v === 'object' ? v : null
  } catch { return null }
}
function writeSynced(endpoint) {
  try {
    if (endpoint) localStorage.setItem(SYNC_KEY, JSON.stringify({ endpoint, at: Date.now() }))
    else localStorage.removeItem(SYNC_KEY)
  } catch { /* sin storage */ }
}

// ¿Algún barbero tiene los avisos del panel activos en este navegador?
function barberPushEnabled() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('ps_push_enabled_') && localStorage.getItem(k) === '1') return true
    }
  } catch { /* sin storage: se asume que no */ }
  return false
}

/* ¿Se pueden activar avisos acá? Navegador con SW + PushManager +
   Notification, clave VAPID configurada y, en iPhone/iPad, la app instalada
   en la pantalla de inicio (iOS no da Web Push a una pestaña de Safari). */
export function pushSupported() {
  if (!browserPushSupported() || !VAPID_PUBLIC_KEY) return false
  if (isIOS() && !isStandalone()) return false
  return true
}

/* Motivo legible para la interfaz cuando no se puede (o null si se puede). */
export function pushUnavailableReason() {
  if (typeof window === 'undefined') return 'unsupported'
  if (isIOS() && !isStandalone()) return 'ios-needs-install'
  if (!browserPushSupported()) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'unavailable'
  if (permissionState() === 'denied') return 'denied'
  return null
}

// Activado en ESTE dispositivo: la marca local y el permiso vigente (el
// permiso se revoca desde los ajustes del sistema sin avisarle a la app).
export function isAcademyPushEnabled() {
  return readFlag() && permissionState() === 'granted'
}

const REASON_TEXT = {
  'ios-needs-install': 'En iPhone, primero instala la Academy: en Safari toca Compartir → “Agregar a inicio” y ábrela desde el ícono.',
  unsupported: 'Este navegador no permite notificaciones push.',
  unavailable: 'Las notificaciones no están disponibles en este momento.',
  denied: 'Bloqueaste las notificaciones para este sitio. Actívalas en los ajustes del navegador.',
  'sw-failed': 'No se pudo preparar este dispositivo para recibir avisos. Intenta de nuevo.',
  'subscribe-failed': 'No se pudo activar la suscripción de este dispositivo. Intenta de nuevo.',
  'save-failed': 'No se pudo guardar la suscripción. Intenta de nuevo en un rato.',
}
const fail = (reason, error) => ({ ok: false, reason, error: error || REASON_TEXT[reason] || REASON_TEXT.unavailable })

/* Activa los avisos de la Academy en este dispositivo. Tiene que llamarse
   desde un gesto del usuario (toque en el interruptor): Safari solo muestra
   el diálogo de permiso así. Por eso requestPermission() es lo PRIMERO que se
   espera — cualquier await antes consume la "activación" del toque.
   → { ok:true } | { ok:false, reason, error } */
export async function enableAcademyPush() {
  const why = pushUnavailableReason()
  if (why) return fail(why)

  let permission = permissionState()
  if (permission !== 'granted') {
    try {
      permission = await Notification.requestPermission()
    } catch {
      permission = permissionState()
    }
  }
  if (permission !== 'granted') return fail('denied', permission === 'default' ? 'Necesitamos tu permiso para mandarte avisos.' : undefined)

  let sub
  try {
    sub = await getOrCreateSubscription()
  } catch (err) {
    console.warn('[academy:push] subscribe failed:', err)
    return fail('subscribe-failed')
  }
  if (!sub) return fail('sw-failed')

  try {
    const json = typeof sub.toJSON === 'function' ? sub.toJSON() : sub
    await academyApi('push-subscribe', { method: 'POST', body: { subscription: { endpoint: json.endpoint, keys: json.keys || {} } } })
  } catch (err) {
    // Sin fila en el servidor el miembro nunca recibiría nada: el interruptor
    // no puede quedar "activado" mintiendo.
    writeFlag(false)
    return fail('save-failed', err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429 ? err.message : undefined)
  }
  writeFlag(true)
  writeSynced(sub.endpoint)
  return { ok: true }
}

// La suscripción que ya existe (sin crear una nueva ni pedir permiso).
async function existingSubscription() {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
    const reg = await navigator.serviceWorker.getRegistration('/')
    if (!reg?.pushManager) return null
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

/* Apaga los avisos de la Academy en este dispositivo: borra la fila del
   servidor y, solo si el panel no la usa, da de baja la suscripción del
   navegador. También sirve al cerrar sesión (el modo acepta tokens `pwc`):
   así el siguiente que entre en este teléfono no recibe los avisos del
   anterior. Nunca lanza. → { ok:true } */
export async function disableAcademyPush() {
  writeFlag(false)
  writeSynced(null)
  const sub = await existingSubscription()
  if (!sub) return { ok: true }
  try {
    await academyApi('push-unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } })
  } catch (err) {
    // Si el servidor no respondió, la fila queda hasta que el servicio de
    // push conteste 410 (el servidor la borra solo) o el miembro vuelva a
    // activar/desactivar. No es motivo para dejar el interruptor encendido.
    console.warn('[academy:push] unsubscribe failed:', err?.message || err)
  }
  if (!barberPushEnabled()) {
    try { await sub.unsubscribe() } catch { /* ya no estaba */ }
  }
  return { ok: true }
}

/* Al abrir la app: re-registra en el servidor la suscripción de este
   dispositivo si el miembro tenía los avisos activos. No pide permiso ni
   muestra nada. La suscripción del navegador y su fila del servidor se caen
   por separado (reinstalar la PWA, limpiar datos, el navegador rotando el
   endpoint, el servidor borrando la fila por 404/410): sin esto el
   interruptor diría "activado" para siempre sin que llegue nada.
   Si ya no hay permiso se apaga la marca: mejor un interruptor apagado que
   uno que miente. Un error de red o del servidor NO la apaga (se reintenta
   en la próxima apertura). → { ok, reason? } */
export async function syncAcademyPush({ force = false } = {}) {
  if (!readFlag()) return { ok: false, reason: 'not-enabled' }
  if (!pushSupported() || permissionState() !== 'granted') {
    writeFlag(false)
    writeSynced(null)
    return { ok: false, reason: 'no-permission' }
  }
  let sub
  try {
    sub = await getOrCreateSubscription()
  } catch (err) {
    console.warn('[academy:push] sync subscribe failed:', err)
    return { ok: false, reason: 'subscribe-failed' }
  }
  if (!sub) return { ok: false, reason: 'unavailable' }

  const last = readSynced()
  if (!force && last && last.endpoint === sub.endpoint && Date.now() - Number(last.at || 0) < SYNC_EVERY_MS) {
    return { ok: true, skipped: true }
  }
  try {
    const json = typeof sub.toJSON === 'function' ? sub.toJSON() : sub
    await academyApi('push-subscribe', { method: 'POST', body: { subscription: { endpoint: json.endpoint, keys: json.keys || {} } } })
    writeSynced(sub.endpoint)
    return { ok: true }
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      // El servidor rechazó la suscripción (endpoint de un servicio no
      // soportado): no tiene arreglo reintentando.
      writeFlag(false)
      writeSynced(null)
    }
    return { ok: false, reason: 'sync-failed' }
  }
}
