/* ACADEMY — "tiempo real" sin quemar Neon (SPEC §9)
   ------------------------------------------------------------------
   Neon cobra por tiempo de cómputo despierto, no por consulta: un ping cada
   pocos segundos de cada pestaña abierta mantendría la base despierta todo el
   día (el cron de BrunettiCutz ya costó 138 horas en un mes por eso). Por eso
   hay UN solo motor por pestaña, compartido por todos los que lo usan (badges
   de la barra, ventanas de chat), y solo consulta `sync` cuando:
     · la pestaña está visible Y tiene el foco,
     · hubo actividad del usuario (toque, tecla, scroll) en los últimos 90 s
       (3 min si hay un chat abierto),
     · y el grupo no apagó la sincronización (group.sync.enabled === false).
   Intervalos: con un chat abierto 5 s durante el minuto siguiente a enviar o
   recibir un mensaje, después 10 s y luego 20 s; sin chat, 60 s.
   Cuando las condiciones dejan de cumplirse se detiene y avisa `idle`
   (fetch keepalive con el header de sesión: sendBeacon no puede mandarlo),
   para que el servidor deje de mostrar al miembro "En línea".
   Al volver (visible, foco, un toque) sincroniza de inmediato.

   El servidor limita a 1 petición cada 4 s por miembro (429): el motor deja
   al menos 4,3 s entre dos consultas y, con varias ventanas de chat, las
   atiende por turno.

   Uso:
     const { syncNow, bump } = useSync({ chatId, since, onData, active })
     onData(data) recibe { unreadNotifications, unreadChats, messages, newPosts,
       onlineCount, serverTime, chatId } — `messages` solo trae los de SU chat.
     bump(): llamar al enviar un mensaje (vuelve al ritmo de 5 s). */

import { useContext, useEffect, useRef } from 'react'
import { AcademyContext } from './context.js'
import { academyApi, academyUrl, ApiError } from './api.js'
import { getToken } from './session.js'

const MIN_GAP_MS = 4300
const INPUT_WINDOW_MS = 90_000
const INPUT_WINDOW_CHAT_MS = 180_000
const IDLE_INTERVAL_MS = 60_000

const subs = new Map() // id → { chatId, getSince, getFeedSince, onData }
let seq = 0
let timer = null
let inflight = null // Promise en vuelo
let lastRequestAt = 0
let lastInputAt = Date.now()
let chatActivityAt = 0
let syncing = false // el motor está "en marcha" (hubo al menos una consulta desde la última pausa)
let enabled = true
let rr = 0
let backoffUntil = 0
let installed = false
const lastIds = new Map() // chatId → último id de mensaje entregado

const now = () => Date.now()
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

function chatIds() {
  const ids = []
  for (const s of subs.values()) if (s.chatId && !ids.includes(s.chatId)) ids.push(s.chatId)
  return ids
}

function conditionsOk() {
  if (!enabled || !subs.size || !getToken()) return false
  if (typeof document === 'undefined') return false
  if (document.visibilityState !== 'visible') return false
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false
  const windowMs = chatIds().length ? INPUT_WINDOW_CHAT_MS : INPUT_WINDOW_MS
  return now() - lastInputAt < windowMs
}

function intervalMs() {
  const t = now()
  if (backoffUntil > t) return backoffUntil - t
  if (!chatIds().length) return IDLE_INTERVAL_MS
  const since = t - chatActivityAt
  if (since < 60_000) return 5_000
  if (since < 180_000) return 10_000
  return 20_000
}

function sendIdle() {
  if (!syncing) return
  syncing = false
  const token = getToken()
  if (!token) return
  try {
    fetch(academyUrl('idle'), {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {})
  } catch { /* sin fetch */ }
}

function clearTimer() {
  if (timer) { clearTimeout(timer); timer = null }
}

function schedule() {
  clearTimer()
  if (!conditionsOk()) {
    sendIdle()
    return
  }
  const wait = Math.max(intervalMs(), MIN_GAP_MS - (now() - lastRequestAt))
  timer = setTimeout(tick, Math.max(0, wait))
}

async function tick() {
  timer = null
  if (!conditionsOk()) { schedule(); return }
  await doSync()
  schedule()
}

function deliver(data, chatId) {
  const msgs = Array.isArray(data?.messages) ? data.messages : []
  for (const s of [...subs.values()]) {
    try {
      s.onData?.({ ...data, chatId: chatId || null, messages: s.chatId && s.chatId === chatId ? msgs : [] })
    } catch (e) {
      console.error('[academy:sync] onData', e)
    }
  }
}

async function doSync() {
  if (inflight) return inflight
  const wait = MIN_GAP_MS - (now() - lastRequestAt)
  if (wait > 0) await sleep(wait)
  if (inflight) return inflight

  const ids = chatIds()
  const chatId = ids.length ? ids[rr++ % ids.length] : null
  const query = {}
  if (chatId) {
    query.chat = chatId
    let since = lastIds.get(chatId) || 0
    for (const s of subs.values()) {
      if (s.chatId === chatId) {
        const v = Number(s.getSince?.()) || 0
        if (v > since) since = v
      }
    }
    if (since > 0) query.since = since
  }
  for (const s of subs.values()) {
    const f = s.getFeedSince?.()
    if (f) { query.feedSince = f; break }
  }

  lastRequestAt = now()
  inflight = (async () => {
    try {
      const data = await academyApi('sync', { query, timeoutMs: 15000 })
      // Solo cuenta como "en marcha" (y por lo tanto merece un `idle` al
      // pausar) si corresponde sincronizar; una consulta puntual forzada con
      // el motor apagado no deja al miembro "En línea" colgado.
      if (conditionsOk()) syncing = true
      if (chatId) {
        const msgs = Array.isArray(data?.messages) ? data.messages : []
        if (msgs.length) {
          const maxId = msgs.reduce((m, x) => Math.max(m, Number(x?.id) || 0), lastIds.get(chatId) || 0)
          lastIds.set(chatId, maxId)
          chatActivityAt = now()
        }
      }
      deliver(data, chatId)
      return data
    } catch (e) {
      // 429 del limitador o red caída: esperar antes del siguiente intento.
      // El limitador es de 1 cada 4 s: con 5 s basta. Más largo dejaba los
      // contadores en 0 tras una recarga rápida (la sync de la página anterior
      // todavía contaba).
      if (e instanceof ApiError && e.status === 429) backoffUntil = now() + 5_000
      else if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) backoffUntil = now() + 20_000
      return null
    } finally {
      inflight = null
    }
  })()
  return inflight
}

// Arranca de inmediato si estaba detenido y ahora corresponde.
function kick() {
  if (!conditionsOk()) return
  if (timer && syncing) return // ya está en marcha a su ritmo
  clearTimer()
  timer = setTimeout(tick, Math.max(0, MIN_GAP_MS - (now() - lastRequestAt)))
}

function installListeners() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const onInput = () => {
    const wasOk = conditionsOk()
    lastInputAt = now()
    if (!wasOk) kick()
  }
  const opts = { passive: true, capture: true }
  window.addEventListener('pointerdown', onInput, opts)
  window.addEventListener('keydown', onInput, opts)
  window.addEventListener('touchstart', onInput, opts)
  window.addEventListener('scroll', onInput, opts)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { lastInputAt = now(); kick() }
    else { clearTimer(); sendIdle() }
  })
  window.addEventListener('focus', () => { lastInputAt = now(); kick() })
  window.addEventListener('blur', () => { setTimeout(() => { if (!conditionsOk()) { clearTimer(); sendIdle() } }, 0) })
  window.addEventListener('pagehide', () => { clearTimer(); sendIdle() })
}

/* Consulta puntual (al montar la app, al volver a la pestaña, al abrir un
   popover): ignora la ventana de actividad y el interruptor del grupo, pero
   respeta la separación mínima entre consultas. Devuelve los datos o null. */
export async function requestSync() {
  if (!getToken()) return null
  const data = await doSync()
  if (conditionsOk()) schedule()
  return data
}

// Activa/desactiva el motor (settings.sync.enabled del grupo).
export function setSyncEnabled(on) {
  enabled = on !== false
  if (!enabled) { clearTimer(); sendIdle() } else kick()
}

// Hubo actividad en un chat (se envió un mensaje): volver al ritmo rápido.
export function bumpSync() {
  chatActivityAt = now()
  lastInputAt = now()
  if (conditionsOk()) {
    clearTimer()
    timer = setTimeout(tick, Math.max(0, Math.min(5_000, MIN_GAP_MS - (now() - lastRequestAt))))
  }
}

export function useSync({ chatId, since, feedSince, onData, active = true } = {}) {
  const ctx = useContext(AcademyContext)
  const onDataRef = useRef(onData)
  onDataRef.current = onData
  const sinceRef = useRef(since)
  sinceRef.current = since
  const feedRef = useRef(feedSince)
  feedRef.current = feedSince
  const syncEnabled = ctx?.group?.sync?.enabled !== false

  useEffect(() => { setSyncEnabled(syncEnabled) }, [syncEnabled])

  useEffect(() => {
    if (!active) return undefined
    installListeners()
    const id = ++seq
    const cid = chatId ? Number(chatId) || chatId : null
    subs.set(id, {
      chatId: cid,
      getSince: () => sinceRef.current,
      getFeedSince: () => feedRef.current,
      onData: (d) => onDataRef.current?.(d),
    })
    if (cid) {
      // Chat recién abierto: traer lo nuevo ya, sin esperar el próximo turno.
      chatActivityAt = now()
      lastInputAt = now()
      clearTimer()
      timer = setTimeout(tick, Math.max(0, MIN_GAP_MS - (now() - lastRequestAt)))
    } else if (conditionsOk()) {
      kick()
    } else {
      // Pestaña abierta en segundo plano o sin foco: los contadores igual se
      // cargan una vez al montar (SPEC §9: "on app mount").
      requestSync()
    }
    return () => {
      subs.delete(id)
      if (cid && !chatIds().includes(cid)) lastIds.delete(cid)
      if (!subs.size) { clearTimer(); sendIdle() }
    }
  }, [chatId, active])

  return { syncNow: requestSync, bump: bumpSync }
}
