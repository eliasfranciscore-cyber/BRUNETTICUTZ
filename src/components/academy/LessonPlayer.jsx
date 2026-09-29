import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { academyApi } from '../../academy/api.js'
import { parseYouTubeId, embedUrl, thumbUrl, createPlayerBridge, PLAYER_STATE } from '../../academy/youtube.js'
import '../../styles/academy/cursos.css'

/* ============================================================
   Reproductor de la lección (YouTube no listado, youtube-nocookie, 16:9).

   Progreso (SPEC §7.4):
   · Retoma donde quedó: `&start=<positionSec>` en la URL del embed (sin
     cargar el iframe_api de YouTube: el CSP de /academy no lo permite y el
     puente postMessage de youtube.js basta).
   · Guarda la posición cada 60 s DE REPRODUCCIÓN (no de reloj), al pausar,
     al terminar, al ocultar la pestaña (fetch keepalive, que sobrevive al
     cierre) y al desmontar (cambio de lección).
   · Marca completada al terminar (ENDED) o al pasar el 90 %: se le avisa al
     padre con onComplete(positionSec), que es quien escribe `completed`.
   · Mientras suena, el contenedor lleva `data-hold-reload`: buildWatch.js no
     recarga la app por un deploy nuevo en medio de una clase.

   Props: { lessonId, videoId, title, startSec, durationSec, completed, onComplete, onPosition }
   ============================================================ */

const { ENDED: YT_ENDED, PLAYING: YT_PLAYING, PAUSED: YT_PAUSED, BUFFERING: YT_BUFFERING } = PLAYER_STATE

const SAVE_EVERY_SEC = 60
const COMPLETE_AT = 0.9

export default function LessonPlayer({ lessonId, videoId, title, startSec = 0, durationSec, completed, onComplete, onPosition }) {
  const id = parseYouTubeId(videoId || '')
  const frameRef = useRef(null)
  const [playing, setPlaying] = useState(false)

  // La posición de arranque se fija una sola vez por montaje: cambiar la URL
  // del iframe reinicia el video.
  const startAt = useMemo(() => {
    const s = Math.floor(Number(startSec) || 0)
    const d = Math.floor(Number(durationSec) || 0)
    if (s < 5) return 0
    if (d && s >= d - 15) return 0 // ya lo había terminado: empieza de nuevo
    return s
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const src = useMemo(() => (id ? embedUrl(id, { start: startAt }) : ''), [id, startAt])

  // Estado mutable del seguimiento (no dispara renders).
  const st = useRef({
    pos: startAt, dur: Number(durationSec) || 0, lastT: null, acc: 0,
    lastSaved: startAt, playingNow: false,
    completed: Boolean(completed), completing: false, armed: true,
  })
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const onPositionRef = useRef(onPosition)
  onPositionRef.current = onPosition

  // El padre manda `completed`: si el alumno la desmarca a mano estando sobre
  // el 90 %, no se vuelve a marcar sola hasta que retroceda o llegue al final.
  useEffect(() => {
    const s = st.current
    const was = s.completed
    s.completed = Boolean(completed)
    s.completing = false
    if (was && !completed) s.armed = s.dur > 0 ? s.pos / s.dur < COMPLETE_AT : false
  }, [completed])

  const save = useCallback((keepalive = false, positionOverride) => {
    const s = st.current
    if (!lessonId) return
    const pos = Math.max(0, Math.floor(positionOverride ?? s.pos))
    s.acc = 0
    if (positionOverride == null && Math.abs(pos - s.lastSaved) < 2) return
    s.lastSaved = pos
    academyApi('lesson-progress', { method: 'POST', body: { lessonId, positionSec: pos }, keepalive })
      .catch(() => { /* best-effort: la próxima guardada lo corrige */ })
    // Copia local: volver a esta lección en la misma sesión retoma desde acá
    // aunque la caché de `lesson` sea de antes.
    try { onPositionRef.current?.(pos) } catch { /* callback del padre */ }
  }, [lessonId])

  const complete = useCallback((positionSec) => {
    const s = st.current
    if (s.completed || s.completing) return
    s.completing = true
    s.acc = 0
    s.lastSaved = Math.floor(positionSec)
    onCompleteRef.current?.(Math.floor(positionSec))
  }, [])

  useEffect(() => {
    const iframe = frameRef.current
    if (!iframe || !id) return undefined
    const s = st.current
    // ¿Hay avance sin guardar? (≥ 2 s respecto de lo último que se mandó)
    const moved = () => Math.abs(Math.floor(s.pos) - s.lastSaved) >= 2

    const onTime = (currentTime, duration) => {
      const t = Number(currentTime)
      const d = Number(duration)
      if (Number.isFinite(d) && d > 0) s.dur = d
      if (!Number.isFinite(t) || t < 0) return
      if (s.playingNow && s.lastT != null) {
        const delta = t - s.lastT
        if (delta > 0 && delta < 5) s.acc += delta // saltos (seek) no cuentan como reproducción
      }
      s.lastT = t
      s.pos = t
      if (s.dur > 0 && t / s.dur < COMPLETE_AT) s.armed = true
      if (s.dur > 0 && s.armed && t / s.dur >= COMPLETE_AT && !s.completed) complete(t)
      else if (s.acc >= SAVE_EVERY_SEC) save(false)
    }

    const onState = (raw) => {
      const state = Number(raw)
      if (state === YT_PLAYING || state === YT_BUFFERING) {
        if (!s.playingNow) {
          s.playingNow = true
          s.lastT = s.pos
          setPlaying(true)
        }
        return
      }
      const wasPlaying = s.playingNow
      s.playingNow = false
      setPlaying(false)
      if (state === YT_ENDED) {
        if (!s.completed) complete(0)
        else save(false, 0) // la próxima vez arranca desde el principio
        s.pos = 0
        s.lastT = null
      } else if (state === YT_PAUSED && wasPlaying && moved()) {
        save(false)
      }
    }

    let bridge = null
    try {
      bridge = createPlayerBridge(iframe, { onState, onTime })
    } catch {
      bridge = null // sin puente el video igual se ve; solo no se guarda el avance
    }

    const flush = () => { if (moved()) save(true) }
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', flush)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', flush)
      try { bridge?.destroy?.() } catch { /* ya destruido */ }
      flush()
    }
  }, [id, save, complete])

  if (!id) {
    return (
      <div className="aca-lplayer is-missing" role="img" aria-label="Video no disponible">
        <span>Video no disponible</span>
      </div>
    )
  }

  return (
    <div
      className="aca-lplayer"
      data-hold-reload={playing ? '1' : undefined}
      style={{ backgroundImage: `url("${thumbUrl(id)}")` }}
    >
      <iframe
        ref={frameRef}
        src={src}
        title={title ? `Video: ${title}` : 'Video de la lección'}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}
