import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { r } from '../../academy/routes.js'
import { ProgressPill, fmtDuration, clampPct } from './CourseCard.jsx'
import '../../styles/academy/cursos.css'

/* ============================================================
   Barra lateral de la lección: TODAS las secciones del curso (Skool solo
   muestra la carpeta actual; el research pidió el árbol completo), la lección
   actual resaltada y ✓ en las completadas.
   Escritorio: columna fija a la izquierda, pegada al hacer scroll.
   Celular: se pliega en un botón "Contenido del curso · 3/12" debajo del
   video, para que el reproductor quede arriba del todo.
   Props: { courseSlug, data (respuesta de mode=course), currentSlug, loading }
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

export default function LessonSidebar({ courseSlug, data, currentSlug, loading, showDrafts = false }) {
  const course = data?.course
  const sections = Array.isArray(data?.sections) ? data.sections : []
  const unsectioned = Array.isArray(data?.unsectioned) ? data.unsectioned : []
  const [mobileOpen, setMobileOpen] = useState(false)
  const currentRef = useRef(null)
  const panelRef = useRef(null)

  const currentSectionId = useMemo(() => {
    const s = sections.find((sec) => (sec.lessons || []).some((l) => l.slug === currentSlug))
    return s ? s.id : null
  }, [sections, currentSlug])

  // Secciones plegadas por el usuario; la de la lección actual siempre abre.
  const [closed, setClosed] = useState(() => new Set())
  useEffect(() => {
    if (currentSectionId == null) return
    setClosed((prev) => {
      if (!prev.has(currentSectionId)) return prev
      const next = new Set(prev)
      next.delete(currentSectionId)
      return next
    })
  }, [currentSectionId])
  const toggle = (id) => setClosed((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  // Al cambiar de lección, se cierra el desplegable del celular y la lección
  // actual queda a la vista dentro de la columna (cursos largos).
  useEffect(() => { setMobileOpen(false) }, [currentSlug])
  useEffect(() => {
    // Se mueve solo el scroll interno de la columna (nunca la ventana, que
    // scrollIntoView también arrastraría).
    const el = currentRef.current
    const box = panelRef.current
    if (!el || !box || box.scrollHeight <= box.clientHeight + 4) return
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 3)
    }
  }, [currentSlug, data])

  const all = [...unsectioned, ...sections.flatMap((s) => s.lessons || [])]
  const total = Number(course?.lessonCount) || all.length
  const done = Number(course?.completedCount ?? all.filter((l) => l.completed).length) || 0
  const pct = clampPct(course?.progress ?? (total ? (done / total) * 100 : 0))

  const renderLesson = (l) => {
    const current = l.slug === currentSlug
    const completed = Boolean(l.completed)
    const dur = fmtDuration(l.durationSec)
    return (
      <li key={l.id ?? l.slug}>
        <Link
          ref={current ? currentRef : undefined}
          to={r.lesson(courseSlug, l.slug)}
          className={cx('aca-slesson', current && 'is-current', completed && 'is-done')}
          aria-current={current ? 'page' : undefined}
        >
          <span className="aca-slesson-check" aria-hidden="true">
            {completed ? <Icon name="check" size={12} stroke={2.8} /> : null}
          </span>
          <span className="aca-slesson-title">{l.title}</span>
          {showDrafts && l.published === false && <span className="aca-chip-draft is-xs">Borrador</span>}
          {dur && <span className="aca-slesson-dur">{dur}</span>}
          {completed && <span className="aca-c-sr"> (completada)</span>}
        </Link>
      </li>
    )
  }

  return (
    <aside className={cx('aca-lside', mobileOpen && 'is-open')} aria-label="Contenido del curso">
      <button
        type="button"
        className="aca-lside-toggle"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((v) => !v)}
      >
        <Icon name="list" size={17} />
        <span className="aca-lside-toggle-txt">Contenido del curso</span>
        <span className="aca-lside-toggle-count">{done}/{total}</span>
        <Icon name={mobileOpen ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>

      <div className="aca-lside-panel" ref={panelRef}>
        <div className="aca-lside-head">
          <Link to={r.course(courseSlug)} className="aca-lside-course">
            {course?.title || (loading ? 'Cargando…' : 'Curso')}
          </Link>
          {total > 0 && <ProgressPill value={pct} className="is-sm" />}
        </div>

        {loading && !data ? (
          <div className="aca-lside-skel" aria-busy="true" aria-label="Cargando lecciones">
            {[70, 90, 60, 80, 55].map((w, i) => <span key={i} className="aca-c-skel aca-c-skel-line" style={{ width: `${w}%` }} />)}
          </div>
        ) : (
          <nav className="aca-lside-nav">
            {unsectioned.length > 0 && <ol className="aca-lside-list">{unsectioned.map(renderLesson)}</ol>}
            {sections.map((s) => {
              const lessons = s.lessons || []
              const sDone = lessons.filter((l) => l.completed).length
              const open = !closed.has(s.id)
              return (
                <div key={s.id} className={cx('aca-lside-sec', open && 'is-open', s.id === currentSectionId && 'has-current')}>
                  <button type="button" className="aca-lside-sec-head" aria-expanded={open} onClick={() => toggle(s.id)}>
                    <span className="aca-lside-sec-title">{s.title}</span>
                    <span className={cx('aca-lside-sec-count', lessons.length > 0 && sDone === lessons.length && 'is-done')}>{sDone}/{lessons.length}</span>
                    <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
                  </button>
                  {open && <ol className="aca-lside-list">{lessons.map(renderLesson)}</ol>}
                </div>
              )
            })}
          </nav>
        )}
      </div>
    </aside>
  )
}
