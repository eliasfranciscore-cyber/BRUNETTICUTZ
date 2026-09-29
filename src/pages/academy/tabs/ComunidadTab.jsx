import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, InlineAlert, useMediaQuery } from '../../../components/panel/index.js'
import PageState from '../../../components/academy/PageState.jsx'
import OnboardingWidget from '../../../components/academy/OnboardingWidget.jsx'
import PostCard, { cx, MenuButton, errMsg, categoryLabel } from '../../../components/academy/PostCard.jsx'
import PostComposer from '../../../components/academy/PostComposer.jsx'
import PostDetail from '../../../components/academy/PostDetail.jsx'
import EventBanner from '../../../components/academy/EventBanner.jsx'
import RightColumn from '../../../components/academy/RightColumn.jsx'
import { useAcademy } from '../../../academy/context.js'
import { useAcademyQuery } from '../../../academy/useQuery.js'
import { academyApi } from '../../../academy/api.js'
import { r } from '../../../academy/routes.js'
import '../../../styles/academy/comunidad.css'

/* ============================================================
   Pestaña Comunidad (SPEC §5.3 / §7.4): el foro de la Academy.

   Orden de arriba abajo, como Skool: widget de bienvenida (se oculta solo
   cuando el miembro lo descarta), aviso del próximo evento, "Escribe algo…",
   las píldoras de categoría con el menú de orden (Predeterminado, Nuevos,
   Top por período, No leídos) y el filtro "Siguiendo", los fijados y el
   feed con "Cargar más" (cursor). A la derecha, en escritorio, la tarjeta
   del grupo y la clasificación de 30 días.

   Categoría, orden y filtro van en la URL (?categoria=&orden=&filtro=) para
   que un enlace o el botón atrás devuelvan el mismo feed. La publicación
   abierta es /academy/comunidad/:postId (hoja encima del feed, que no se
   desmonta); abrirla desde el feed y cerrarla vuelve atrás en el historial.
   ============================================================ */

const SORTS = [
  { value: 'default', label: 'Predeterminado' },
  { value: 'nuevos', label: 'Nuevos' },
  { value: 'top-dia', label: 'Día', group: 'Top' },
  { value: 'top-semana', label: 'Semana', group: 'Top' },
  { value: 'top-mes', label: 'Mes', group: 'Top' },
  { value: 'top-ano', label: 'Año', group: 'Top' },
  { value: 'top-siempre', label: 'Siempre', group: 'Top' },
  { value: 'no-leidos', label: 'No leídos' },
]
const SORT_SET = new Set(SORTS.map((s) => s.value))

function sortLabel(v) {
  const s = SORTS.find((x) => x.value === v)
  if (!s) return 'Predeterminado'
  return s.group ? `Top · ${s.label}` : s.label
}

export default function ComunidadTab() {
  const { postId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const { group, toast } = useAcademy()
  const wide = useMediaQuery('(min-width: 900px)')

  const category = /^\d+$/.test(params.get('categoria') || '') ? params.get('categoria') : ''
  const sort = SORT_SET.has(params.get('orden')) ? params.get('orden') : 'default'
  const following = params.get('filtro') === 'siguiendo'
  const baseQuery = useMemo(() => {
    // "Predeterminado" no se manda: así el backend usa el orden por defecto
    // de la categoría (default_sort) en vez de forzar "última actividad".
    const q = {}
    if (sort !== 'default') q.sort = sort
    if (category) q.category = category
    if (following) q.filter = 'siguiendo'
    return q
  }, [category, sort, following])
  const key = `feed:${category || 'todas'}:${sort}:${following ? 'siguiendo' : 'todos'}`

  const q = useAcademyQuery(key, () => academyApi('feed', { query: baseQuery }), { deps: [category, sort, following] })
  const dataRef = useRef(q.data)
  dataRef.current = q.data
  const setDataRef = useRef(q.setData)
  setDataRef.current = q.setData

  // Páginas extra ("Cargar más"), atadas a la clave del feed que las pidió.
  const [more, setMore] = useState({ key: null, posts: [], nextCursor: null, loaded: false, loading: false, error: '' })
  const moreHere = more.key === key ? more : { key, posts: [], nextCursor: null, loaded: false, loading: false, error: '' }

  const categories = Array.isArray(q.data?.categories) ? q.data.categories : []
  const pinned = Array.isArray(q.data?.pinned) ? q.data.pinned : []
  const posts = useMemo(() => {
    const seen = new Set(pinned.map((p) => p.id))
    const out = []
    for (const p of [...(Array.isArray(q.data?.posts) ? q.data.posts : []), ...moreHere.posts]) {
      if (!p || seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
    }
    return out
  }, [q.data, moreHere.posts]) // eslint-disable-line react-hooks/exhaustive-deps
  const nextCursor = moreHere.loaded ? moreHere.nextCursor : q.data?.nextCursor || null

  /* ---------- filtros en la URL ---------- */
  const setParam = (patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '' || v === false) next.delete(k)
        else next.set(k, String(v))
      }
      return next
    }, { replace: true })
  }
  const pickCategory = (id) => setParam({ categoria: id || null })
  const pickSort = (v) => setParam({ orden: v === 'default' ? null : v })
  const toggleFollowing = () => setParam({ filtro: following ? null : 'siguiendo' })

  /* ---------- paginación ---------- */
  const loadMore = async () => {
    if (!nextCursor || moreHere.loading) return
    const k = key
    const cursor = nextCursor
    setMore({ ...moreHere, key: k, loading: true, error: '' })
    try {
      const d = await academyApi('feed', { query: { ...baseQuery, cursor } })
      setMore((m) => (m.key !== k ? m : {
        ...m,
        posts: [...m.posts, ...(Array.isArray(d?.posts) ? d.posts : [])],
        nextCursor: d?.nextCursor || null,
        loaded: true,
        loading: false,
      }))
    } catch (e) {
      setMore((m) => (m.key !== k ? m : { ...m, loading: false, error: errMsg(e, 'No se pudieron cargar más publicaciones') }))
    }
  }

  /* ---------- cambios que vienen de tarjetas / hoja ---------- */
  const patchPost = useCallback((np) => {
    if (!np || np.id == null) return
    const rep = (arr) => (Array.isArray(arr) ? arr.map((p) => (p && p.id === np.id ? { ...p, ...np } : p)) : arr)
    const d = dataRef.current
    if (d) setDataRef.current?.({ ...d, pinned: rep(d.pinned), posts: rep(d.posts) })
    setMore((m) => ({ ...m, posts: rep(m.posts) }))
  }, [])

  const removePost = useCallback((id) => {
    const drop = (arr) => (Array.isArray(arr) ? arr.filter((p) => p && p.id !== id) : arr)
    const d = dataRef.current
    if (d) setDataRef.current?.({ ...d, pinned: drop(d.pinned), posts: drop(d.posts) })
    setMore((m) => ({ ...m, posts: drop(m.posts) }))
  }, [])

  const addPost = useCallback((np) => {
    if (!np) return
    const d = dataRef.current
    const inFilter = !category || Number(np.category?.id) === Number(category)
    if (!d) { q.refetch?.(); return }
    if (inFilter && !following) {
      setDataRef.current?.({ ...d, posts: [np, ...(Array.isArray(d.posts) ? d.posts : []).filter((p) => p.id !== np.id)] })
      return
    }
    // Con otro filtro activo la publicación nueva no calza en esta vista:
    // se avisa dónde quedó en vez de meterla en una lista que no le toca.
    const where = categoryLabel(np.category)
    toast?.(where ? `Tu publicación quedó en ${where}` : 'Tu publicación quedó en el feed', 'info')
  }, [category, following, toast]) // eslint-disable-line react-hooks/exhaustive-deps

  const onPinnedChange = useCallback(() => {
    // Fijar/desfijar cambia qué va en `pinned`: se relee la primera página.
    setMore((m) => ({ ...m, key: null }))
    q.refetch?.()
  }, [q.refetch]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- publicación abierta ----------
     ?comentario= (lo trae una notificación) es de la publicación abierta, no
     del feed: no se arrastra al abrir otra ni al volver a la lista. */
  const feedSearch = useMemo(() => {
    const p = new URLSearchParams(location.search)
    p.delete('comentario')
    const s = p.toString()
    return s ? `?${s}` : ''
  }, [location.search])
  const openPost = (p) => navigate(`${r.post(p.id)}${feedSearch}`, { state: { fromFeed: true } })
  const closePost = () => {
    if (location.state && location.state.fromFeed) navigate(-1)
    else navigate(`${r.path('/comunidad')}${feedSearch}`, { replace: true })
  }
  const openId = postId && /^\d+$/.test(postId) ? Number(postId) : postId ? -1 : null
  const initialPost = openId > 0 ? [...pinned, ...posts].find((p) => p.id === openId) || null : null

  /* ---------- barra de filtros ---------- */
  const sortItems = [
    { section: 'Ordenar' },
    ...SORTS.filter((s) => !s.group).slice(0, 2).map((s) => ({ key: s.value, label: s.label, checked: sort === s.value, onClick: () => pickSort(s.value) })),
    { section: 'Top' },
    ...SORTS.filter((s) => s.group).map((s) => ({ key: s.value, label: s.label, checked: sort === s.value, onClick: () => pickSort(s.value) })),
    { section: 'Mostrar' },
    { key: 'no-leidos', label: 'No leídos', checked: sort === 'no-leidos', onClick: () => pickSort(sort === 'no-leidos' ? 'default' : 'no-leidos') },
    { key: 'siguiendo', label: 'Solo de quienes sigo', checked: following, onClick: toggleFollowing },
  ]
  const filterActive = sort !== 'default' || following
  const trigger = `${sortLabel(sort)}${following ? ' · Siguiendo' : ''}`

  const emptyText = following
    ? 'Nadie de quienes sigues ha publicado todavía.'
    : sort === 'no-leidos'
      ? 'Estás al día: no hay publicaciones sin leer.'
      : category
        ? 'Aún no hay publicaciones en esta categoría.'
        : 'Aún no hay publicaciones. ¡Escribe la primera!'

  const activeCat = categories.find((c) => String(c.id) === String(category))

  return (
    <div className={cx('aca-cm-com', wide && 'has-side')}>
      <div className="aca-cm-com-main">
        <OnboardingWidget />
        {!(group?.tabs && group.tabs.calendario === false) && <EventBanner />}

        <PostComposer
          categories={categories}
          categoriesLoaded={Boolean(q.data)}
          defaultCategoryId={category || undefined}
          onCreated={addPost}
        />

        <div className="aca-cm-com-bar">
          <div className="aca-cm-pills" role="tablist" aria-label="Categorías">
            <button type="button" role="tab" aria-selected={!category} className={cx('aca-cm-pill', !category && 'is-on')} onClick={() => pickCategory('')}>
              Todas
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={String(c.id) === String(category)}
                className={cx('aca-cm-pill', String(c.id) === String(category) && 'is-on')}
                onClick={() => pickCategory(String(c.id))}
              >
                {categoryLabel(c)}
              </button>
            ))}
          </div>
          <MenuButton
            icon="filter"
            label={trigger}
            items={sortItems}
            title="Ordenar y filtrar"
            ariaLabel={`Ordenar y filtrar: ${trigger}`}
            buttonClassName={cx('aca-cm-sort-btn', filterActive && 'is-active')}
          />
        </div>

        <PageState
          loading={q.loading && !q.data}
          error={!q.data ? q.error : null}
          onRetry={q.refetch}
          empty={Boolean(q.data) && pinned.length === 0 && posts.length === 0}
          emptyText={emptyText}
        >
          {q.error && q.data && (
            <InlineAlert tone="warn" action={{ label: 'Reintentar', onClick: q.refetch }}>
              No se pudo actualizar el feed. Mostrando lo último que cargó.
            </InlineAlert>
          )}
          {activeCat && activeCat.writeRole === 'admins' && (
            <p className="aca-cm-com-note">En {categoryLabel(activeCat)} solo publican los administradores.</p>
          )}
          <div className="aca-cm-feed">
            {pinned.map((p) => (
              <PostCard key={`pin-${p.id}`} post={p} onChange={patchPost} onOpen={openPost} />
            ))}
            {posts.map((p) => (
              <PostCard key={p.id} post={p} onChange={patchPost} onOpen={openPost} />
            ))}
          </div>
          {moreHere.error && (
            <InlineAlert tone="error" action={{ label: 'Reintentar', onClick: loadMore }}>{moreHere.error}</InlineAlert>
          )}
          {nextCursor && (
            <div className="aca-cm-feed-more">
              <Button variant="secondary" onClick={loadMore} loading={moreHere.loading}>Cargar más</Button>
            </div>
          )}
          {!nextCursor && posts.length > 8 && <p className="aca-cm-feed-end">Llegaste al final</p>}
        </PageState>
      </div>

      {wide && <RightColumn />}

      <PostDetail
        postId={openId}
        open={openId != null}
        onClose={closePost}
        initialPost={initialPost}
        categories={categories}
        onPostChange={patchPost}
        onPostDeleted={removePost}
        onPinnedChange={onPinnedChange}
      />
    </div>
  )
}
