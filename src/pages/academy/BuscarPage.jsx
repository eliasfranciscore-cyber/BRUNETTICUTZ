import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { SearchField, FilterChips, EmptyState } from '../../components/panel/index.js'
import PageState from '../../components/academy/PageState.jsx'
import MemberAvatar from '../../components/academy/MemberAvatar.jsx'
import PostCard, { cx } from '../../components/academy/PostCard.jsx'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { academyApi } from '../../academy/api.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/comunidad.css'

/* ============================================================
   /academy/buscar?q=…&type=… (r.buscar) — resultados del buscador de la barra
   superior, en pestañas como Skool: Todo · Publicaciones · Miembros ·
   Lecciones. Una sola lectura de `search` (type=todo) por término: las
   pestañas filtran en el navegador, así cambiar de pestaña no le pide nada
   a la base. Mínimo 2 letras (el backend exige lo mismo).
   Las coincidencias se resaltan con <mark> armado como nodos de React.
   ============================================================ */

const TABS = [
  { value: 'todo', label: 'Todo' },
  { value: 'publicaciones', label: 'Publicaciones' },
  { value: 'miembros', label: 'Miembros' },
  { value: 'lecciones', label: 'Lecciones' },
]
const TAB_SET = new Set(TABS.map((t) => t.value))
const PREVIEW = 5
const ROLE = { propietario: 'Propietario', admin: 'Admin', moderador: 'Moderador' }

function Highlight({ text, q }) {
  const t = String(text || '')
  const needle = String(q || '').trim()
  if (needle.length < 2) return t
  const lower = t.toLocaleLowerCase('es')
  const n = needle.toLocaleLowerCase('es')
  const out = []
  let i = 0
  let k = 0
  while (i < t.length) {
    const j = lower.indexOf(n, i)
    if (j < 0) { out.push(t.slice(i)); break }
    if (j > i) out.push(t.slice(i, j))
    out.push(<mark key={k++}>{t.slice(j, j + n.length)}</mark>)
    i = j + n.length
  }
  return <>{out}</>
}

function MemberRow({ m, q }) {
  const role = ROLE[m.role]
  const body = (
    <>
      <MemberAvatar member={m} size={44} />
      <span className="aca-cm-sres-main">
        <span className="aca-cm-sres-title">
          <Highlight text={m.name} q={q} />
          {role && <span className="aca-cm-sres-role">({role})</span>}
        </span>
        {m.handle && <span className="aca-cm-sres-sub">@<Highlight text={m.handle} q={q} /></span>}
        {m.bio && <span className="aca-cm-sres-bio">{m.bio}</span>}
      </span>
      {m.online && <span className="aca-cm-sres-online"><span className="aca-cm-online-dot" aria-hidden="true" /> En línea</span>}
    </>
  )
  return m.handle
    ? <Link to={r.profile(m.handle)} className="aca-cm-sres-row">{body}</Link>
    : <div className="aca-cm-sres-row">{body}</div>
}

function LessonRow({ l, q }) {
  return (
    <Link to={r.lesson(l.courseSlug, l.slug)} className="aca-cm-sres-row">
      <span className="aca-cm-sres-icon" aria-hidden="true"><Icon name="book" size={18} /></span>
      <span className="aca-cm-sres-main">
        <span className="aca-cm-sres-title"><Highlight text={l.title} q={q} /></span>
        <span className="aca-cm-sres-sub">{l.courseTitle}</span>
      </span>
      <Icon name="chevronRight" size={16} />
    </Link>
  )
}

function Section({ title, count, onAll, children, showAll }) {
  return (
    <section className="aca-cm-sres-section">
      <div className="aca-cm-sres-head">
        <h2>{title} <span>{count}</span></h2>
        {showAll && <button type="button" className="aca-cm-linkbtn is-blue" onClick={onAll}>Ver todo</button>}
      </div>
      {children}
    </section>
  )
}

export default function BuscarPage() {
  const [params, setParams] = useSearchParams()
  const urlQ = (params.get('q') || '').slice(0, 80)
  const rawTab = params.get('type') || params.get('tipo')
  const tab = TAB_SET.has(rawTab) ? rawTab : 'todo'
  const [input, setInput] = useState(urlQ)

  // La barra superior puede cambiar ?q= con la página ya abierta. Si el
  // cambio vino de lo que se escribe acá (mismo término), no se toca el
  // campo: se perdería un espacio final a mitad de escribir.
  useEffect(() => {
    setInput((cur) => (cur.trim() === urlQ.trim() ? cur : urlQ))
  }, [urlQ])

  // Lo que se escribe acá se lleva a la URL con 400 ms de respiro.
  useEffect(() => {
    const v = input.trim()
    if (v === urlQ.trim()) return undefined
    const t = setTimeout(() => {
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        if (v) next.set('q', v)
        else next.delete('q')
        return next
      }, { replace: true })
    }, 400)
    return () => clearTimeout(t)
  }, [input]) // eslint-disable-line react-hooks/exhaustive-deps

  const term = urlQ.trim()
  const ready = term.length >= 2
  const q = useAcademyQuery(
    `search:${term.toLowerCase()}`,
    () => academyApi('search', { query: { q: term, type: 'todo' } }),
    { deps: [term], enabled: ready, refetchOnFocus: false },
  )

  const posts = useMemo(() => (Array.isArray(q.data?.posts) ? q.data.posts : []), [q.data])
  const members = Array.isArray(q.data?.members) ? q.data.members : []
  const lessons = Array.isArray(q.data?.lessons) ? q.data.lessons : []
  const total = posts.length + members.length + lessons.length

  const setTab = (v) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    next.delete('tipo')
    if (v === 'todo') next.delete('type')
    else next.set('type', v)
    return next
  }, { replace: true })

  const patchPost = (np) => {
    if (!q.data || !np) return
    q.setData?.({ ...q.data, posts: posts.map((p) => (p.id === np.id ? { ...p, ...np } : p)) })
  }

  const counts = { todo: total, publicaciones: posts.length, miembros: members.length, lecciones: lessons.length }
  const tabOptions = TABS.map((t) => ({ ...t, count: q.data ? counts[t.value] : undefined }))
  const emptyFor = {
    todo: `No encontramos nada para “${term}”.`,
    publicaciones: `No hay publicaciones con “${term}”.`,
    miembros: `No hay miembros con “${term}”.`,
    lecciones: `No hay lecciones con “${term}”.`,
  }
  const isEmpty = Boolean(q.data) && counts[tab] === 0

  const postList = (list) => (
    <div className="aca-cm-feed">
      {list.map((p) => <PostCard key={p.id} post={p} onChange={patchPost} />)}
    </div>
  )
  const memberList = (list) => (
    <div className="aca-cm-card aca-cm-sres-list">{list.map((m) => <MemberRow key={m.id} m={m} q={term} />)}</div>
  )
  const lessonList = (list) => (
    <div className="aca-cm-card aca-cm-sres-list">{list.map((l) => <LessonRow key={`${l.courseSlug}/${l.slug}`} l={l} q={term} />)}</div>
  )

  return (
    <div className="aca-cm-search">
      <div className="aca-cm-search-top">
        <h1 className="aca-cm-search-title">{ready ? <>Resultados para “{term}”</> : 'Buscar'}</h1>
        <SearchField
          value={input}
          onChange={setInput}
          placeholder="Buscar publicaciones, miembros y lecciones"
          ariaLabel="Buscar en la Academy"
          autoFocus={!urlQ}
          className="aca-cm-search-field"
        />
        <FilterChips options={tabOptions} value={tab} onChange={setTab} ariaLabel="Tipo de resultado" className="aca-cm-search-tabs" />
      </div>

      {!ready ? (
        <EmptyState
          icon="search"
          title={term.length === 1 ? 'Escribe al menos 2 letras' : 'Busca en toda la Academy'}
          text="Publicaciones de la comunidad, miembros y lecciones de los cursos a los que tienes acceso."
        />
      ) : (
        <PageState
          loading={q.loading && !q.data}
          error={!q.data ? q.error : null}
          onRetry={q.refetch}
          empty={isEmpty}
          emptyText={emptyFor[tab]}
        >
          {tab === 'todo' && (
            <div className={cx('aca-cm-sres', q.loading && 'is-refreshing')}>
              {posts.length > 0 && (
                <Section title="Publicaciones" count={posts.length} showAll={posts.length > PREVIEW} onAll={() => setTab('publicaciones')}>
                  {postList(posts.slice(0, PREVIEW))}
                </Section>
              )}
              {members.length > 0 && (
                <Section title="Miembros" count={members.length} showAll={members.length > PREVIEW} onAll={() => setTab('miembros')}>
                  {memberList(members.slice(0, PREVIEW))}
                </Section>
              )}
              {lessons.length > 0 && (
                <Section title="Lecciones" count={lessons.length} showAll={lessons.length > PREVIEW} onAll={() => setTab('lecciones')}>
                  {lessonList(lessons.slice(0, PREVIEW))}
                </Section>
              )}
            </div>
          )}
          {tab === 'publicaciones' && postList(posts)}
          {tab === 'miembros' && memberList(members)}
          {tab === 'lecciones' && lessonList(lessons)}
          {q.data && counts[tab] >= 20 && (
            <p className="aca-cm-feed-end">Se muestran los primeros 20. Afina la búsqueda para ver otros.</p>
          )}
        </PageState>
      )}
    </div>
  )
}
