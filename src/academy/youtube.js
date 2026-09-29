/* ACADEMY — YouTube (videos no listados de las lecciones)
   ------------------------------------------------------------------
   ESM puro, sin JSX ni import.meta.env (lo importa el mock desde Node).

   - parseYouTubeId: espejo exacto de api/_academyText.js. El id termina en el
     src de un iframe: se exige exactamente ^[A-Za-z0-9_-]{11}$.
   - embedUrl: siempre youtube-nocookie.com (el único host de video que el CSP
     de la Academy permite en frame-src). `enablejsapi=1` + `origin` hacen que el
     reproductor acepte los mensajes del puente de abajo.
   - createPlayerBridge: el protocolo postMessage del reproductor, sin cargar
     https://www.youtube.com/iframe_api (sería un script de terceros y el CSP
     estricto no lo deja). */

import { ACADEMY_BRAND } from './hostConfig.js'

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])
export const YT_EMBED_ORIGIN = 'https://www.youtube-nocookie.com'

export function isYouTubeId(id) {
  return typeof id === 'string' && YT_ID.test(id)
}

export function parseYouTubeId(input) {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!s || s.length > 300) return null
  if (YT_ID.test(s)) return s
  let url
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  let id = null
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = url.pathname.split('/')[1] || null
  } else if (YT_HOSTS.has(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else {
      const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)
      id = m ? m[1] : null
    }
  }
  return id && YT_ID.test(id) ? id : null
}

/* embedUrl(id, { start, autoplay }) → URL del iframe, o '' si el id no sirve. */
export function embedUrl(id, { start, autoplay = false } = {}) {
  if (!isYouTubeId(id)) return ''
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : ACADEMY_BRAND.siteUrl
  const qs = new URLSearchParams({
    enablejsapi: '1',
    origin,
    rel: '0',
    playsinline: '1',
    modestbranding: '1',
  })
  const s = Math.floor(Number(start) || 0)
  if (s > 0) qs.set('start', String(s))
  if (autoplay) qs.set('autoplay', '1')
  return `${YT_EMBED_ORIGIN}/embed/${id}?${qs.toString()}`
}

/* Miniatura (i.ytimg.com está en img-src del CSP). */
export function thumbUrl(id, quality = 'hqdefault') {
  if (!isYouTubeId(id)) return ''
  const q = ['default', 'mqdefault', 'hqdefault', 'sddefault', 'maxresdefault'].includes(quality) ? quality : 'hqdefault'
  return `https://i.ytimg.com/vi/${id}/${q}.jpg`
}

// Estados del reproductor (los mismos números que YT.PlayerState).
export const PLAYER_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }

let bridgeSeq = 0

/* createPlayerBridge(iframe, { onState, onTime, onReady })
   → { play(), pause(), seekTo(sec), getTime(), getDuration(), getState(), destroy() }

   Protocolo (el mismo que usa iframe_api por dentro):
   1. Al cargar el iframe se le manda {"event":"listening","id":…,"channel":"widget"}
      hasta que conteste (reintenta cada 250 ms, máx. ~10 s).
   2. El reproductor responde con "initialDelivery"/"onReady" y luego manda
      "infoDelivery" {currentTime, duration, playerState} mientras corre, y
      "onStateChange" con el número de estado.
   3. Solo se aceptan mensajes cuyo origin es youtube-nocookie.com Y cuyo
      source es ESTE iframe (otro iframe de la página no puede fingir progreso). */
export function createPlayerBridge(iframe, { onState, onTime, onReady } = {}) {
  const id = ++bridgeSeq
  let state = PLAYER_STATE.UNSTARTED
  let time = 0
  let duration = 0
  let ready = false
  let tries = 0
  let pollTimer = null
  let destroyed = false

  const post = (payload) => {
    try { iframe?.contentWindow?.postMessage(JSON.stringify(payload), YT_EMBED_ORIGIN) } catch { /* iframe sin cargar */ }
  }
  const command = (func, args = []) => post({ event: 'command', func, args, id, channel: 'widget' })

  const listen = () => {
    if (destroyed || ready) return
    post({ event: 'listening', id, channel: 'widget' })
    if (++tries < 40) pollTimer = setTimeout(listen, 250)
  }

  const setState = (s) => {
    const n = Number(s)
    if (!Number.isFinite(n) || n === state) return
    state = n
    try { onState?.(n) } catch { /* callback del consumidor */ }
  }

  const onMessage = (event) => {
    if (destroyed || event.origin !== YT_EMBED_ORIGIN) return
    if (!iframe || event.source !== iframe.contentWindow) return
    let data = event.data
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch { return }
    }
    if (!data || typeof data !== 'object') return
    if (data.event === 'onReady' || data.event === 'initialDelivery') {
      if (!ready) {
        ready = true
        if (pollTimer) clearTimeout(pollTimer)
        // Pedir los eventos de estado explícitamente (algunas versiones no
        // mandan infoDelivery sin esto).
        command('addEventListener', ['onStateChange'])
        try { onReady?.() } catch { /* callback */ }
      }
    }
    if (data.event === 'onStateChange') setState(data.info)
    const info = data.info && typeof data.info === 'object' ? data.info : null
    if (info) {
      if (Number.isFinite(Number(info.duration)) && Number(info.duration) > 0) duration = Number(info.duration)
      if (Number.isFinite(Number(info.currentTime))) {
        const t = Number(info.currentTime)
        if (t !== time) {
          time = t
          try { onTime?.(t, duration) } catch { /* callback */ }
        }
      }
      if (info.playerState !== undefined) setState(info.playerState)
    }
  }

  const onLoad = () => { tries = 0; ready = false; listen() }

  if (typeof window !== 'undefined') window.addEventListener('message', onMessage)
  iframe?.addEventListener?.('load', onLoad)
  // Si el iframe ya cargó antes de crear el puente, empezar igual.
  listen()

  return {
    play: () => command('playVideo'),
    pause: () => command('pauseVideo'),
    seekTo: (sec) => command('seekTo', [Math.max(0, Number(sec) || 0), true]),
    getTime: () => time,
    getDuration: () => duration,
    getState: () => state,
    isReady: () => ready,
    destroy: () => {
      destroyed = true
      if (pollTimer) clearTimeout(pollTimer)
      if (typeof window !== 'undefined') window.removeEventListener('message', onMessage)
      iframe?.removeEventListener?.('load', onLoad)
    },
  }
}
