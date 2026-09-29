/* ACADEMY — lecturas con caché chica (sin dependencias nuevas)
   ------------------------------------------------------------------
   useAcademyQuery(key, fetcher, { deps, refetchOnFocus, enabled })
     → { data, error, loading, refetch, setData }

   - Caché en memoria por `key`: volver a una pestaña ya vista pinta al tiro lo
     último que se tuvo y revalida por detrás (sin pantallazo en blanco).
   - Dos componentes que piden la misma key al mismo tiempo comparten UNA
     petición (p. ej. 'group-card' en Miembros y en la columna derecha), y un
     setData() en uno se ve en el otro.
   - Se vuelve a pedir al volver a la pestaña (visibilitychange → visible),
     como mucho una vez cada 30 s. NUNCA hay polling acá: Neon cobra por tiempo
     de cómputo despierto, no por consulta (SPEC §0.8, §9). Lo único que
     consulta periódicamente es useSync.
   - `loading` es true mientras hay una petición en vuelo, AUNQUE ya haya
     datos en caché: para el esqueleto, usar `loading && !data`. */

import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_ENTRIES = 150
const FOCUS_MIN_MS = 30_000

const cache = new Map() // key → { data, at }
const inflight = new Map() // key → Promise
const listeners = new Map() // key → Set<(data) => void>
const refetchers = new Map() // key → Set<() => void>

function keyString(key) {
  if (key === null || key === undefined || key === false) return null
  return typeof key === 'string' ? key : JSON.stringify(key)
}

function remember(k, data) {
  cache.delete(k)
  cache.set(k, { data, at: Date.now() })
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
}

function broadcast(k, data, except) {
  const set = listeners.get(k)
  if (!set) return
  for (const fn of [...set]) if (fn !== except) fn(data)
}

function addTo(map, k, fn) {
  let set = map.get(k)
  if (!set) { set = new Set(); map.set(k, set) }
  set.add(fn)
  return () => { set.delete(fn); if (!set.size) map.delete(k) }
}

// Lo que haya en caché para una key, sin pedir nada (o undefined).
export function peekQuery(key) {
  const k = keyString(key)
  return k ? cache.get(k)?.data : undefined
}

// Escribe la caché y avisa a los componentes montados con esa key.
export function setQueryData(key, updater) {
  const k = keyString(key)
  if (!k) return
  const prev = cache.get(k)?.data
  const next = typeof updater === 'function' ? updater(prev) : updater
  remember(k, next)
  broadcast(k, next)
}

/* Borra de la caché las keys que empiezan con `prefix` (o que cumplen el
   predicado) y hace que los componentes montados con esas keys vuelvan a
   pedir. Útil después de una escritura que cambia otra pantalla. */
export function invalidateQuery(prefixOrFn) {
  const match = typeof prefixOrFn === 'function' ? prefixOrFn : (k) => k.startsWith(String(prefixOrFn))
  for (const k of [...cache.keys()]) if (match(k)) cache.delete(k)
  for (const [k, set] of [...refetchers]) if (match(k)) for (const fn of [...set]) fn()
}

// Al cerrar sesión: nada de lo de un miembro puede verlo el siguiente.
export function clearQueryCache() {
  cache.clear()
  inflight.clear()
}

export function useAcademyQuery(key, fetcher, { deps = [], refetchOnFocus = true, enabled = true } = {}) {
  const k = keyString(key)
  const active = Boolean(enabled && k)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const keyRef = useRef(k)
  keyRef.current = k
  const lastFetchAt = useRef(0)
  const reqSeq = useRef(0)
  const alive = useRef(true)

  const [state, setState] = useState(() => {
    const hit = k ? cache.get(k) : null
    return { key: k, data: hit ? hit.data : undefined, error: null, loading: active && !hit }
  })

  // Receptor estable de lo que escribe otro componente con la misma key.
  const receiver = useRef(null)
  if (!receiver.current) {
    receiver.current = (data) => {
      if (!alive.current) return
      setState((s) => (s.key === keyRef.current ? { ...s, data, error: null } : s))
    }
  }

  const run = useCallback(async () => {
    const myKey = keyRef.current
    if (!myKey) return undefined
    const seq = ++reqSeq.current
    lastFetchAt.current = Date.now()
    setState((s) => (s.key === myKey
      ? { ...s, loading: true }
      : { key: myKey, data: cache.get(myKey)?.data, error: null, loading: true }))
    let p = inflight.get(myKey)
    if (!p) {
      p = Promise.resolve().then(() => fetcherRef.current())
      inflight.set(myKey, p)
      const own = p
      own.then(
        (data) => {
          if (inflight.get(myKey) === own) inflight.delete(myKey)
          remember(myKey, data)
          broadcast(myKey, data, receiver.current)
        },
        () => { if (inflight.get(myKey) === own) inflight.delete(myKey) },
      )
    }
    try {
      const data = await p
      if (alive.current && seq === reqSeq.current && keyRef.current === myKey) {
        setState({ key: myKey, data, error: null, loading: false })
      }
      return data
    } catch (error) {
      if (alive.current && seq === reqSeq.current && keyRef.current === myKey) {
        if (error && error.code === 'aborted') setState((s) => ({ ...s, loading: false }))
        else setState((s) => ({ key: myKey, data: s.key === myKey ? s.data : undefined, error, loading: false }))
      }
      return undefined
    }
  }, [])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (!k) return undefined
    const offData = addTo(listeners, k, receiver.current)
    const offRefetch = addTo(refetchers, k, () => { if (active) run() })
    return () => { offData(); offRefetch() }
  }, [k, active, run])

  useEffect(() => {
    if (!active) {
      setState((s) => (s.loading ? { ...s, loading: false } : s))
      return
    }
    run()
  }, [k, active, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active || !refetchOnFocus) return undefined
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastFetchAt.current < FOCUS_MIN_MS) return
      run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [active, refetchOnFocus, run])

  const setData = useCallback((updater) => {
    const myKey = keyRef.current
    setState((s) => {
      const prev = s.key === myKey ? s.data : undefined
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (myKey) {
        remember(myKey, next)
        // Los demás se enteran fuera de este setState: no se puede actualizar
        // otro componente en medio del render de este.
        queueMicrotask(() => broadcast(myKey, next, receiver.current))
      }
      return { ...s, key: myKey, data: next }
    })
  }, [])

  // Cambió la key y todavía no corrió el efecto: mostrar lo de la key nueva.
  let view = state
  if (state.key !== k) {
    const hit = k ? cache.get(k) : null
    view = { key: k, data: hit ? hit.data : undefined, error: null, loading: active }
  }

  return { data: view.data, error: view.error, loading: view.loading, refetch: run, setData }
}
