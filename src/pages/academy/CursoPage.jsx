import React, { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { academyApi } from '../../academy/api.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { useAcademy } from '../../academy/context.js'
import { r } from '../../academy/routes.js'
import PageState from '../../components/academy/PageState.jsx'
import RichText from '../../components/academy/RichText.jsx'
import {
  CourseCover, ProgressPill, BuyButton, levelLockText, fmtDuration, clampPct,
} from '../../components/academy/CourseCard.jsx'
import '../../styles/academy/cursos.css'

/* ============================================================
   /academy/cursos/:curso — portada del curso: encabezado con progreso y el
   botón para seguir, y la lista de secciones (acordeón) con ✓ por lección.
   Si el curso está bloqueado, el backend igual manda los títulos (nunca el
   video ni el cuerpo), así el alumno ve qué trae antes de comprar.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

/* Todas las lecciones en orden de lectura: primero las sueltas, después las
   de cada sección — el mismo orden en que las numera el backend (prev/next). */
export function flattenLessons(data) {
  const out = []
  for (const l of data?.unsectioned || []) out.push(l)
  for (const s of data?.sections || []) for (const l of s.lessons || []) out.push(l)
  return out
}

/* Lección a la que manda "Empezar/Continuar": la que dice el backend; si no,
   la primera sin completar; si todo está listo, la primera. */
export function resumeTarget(data) {
  const next = data?.course?.nextLesson
  if (next?.slug) return next
  const all = flattenLessons(data)
  return all.find((l) => !l.completed) || all[0] || null
}

function LessonRow({ lesson, courseSlug, locked, showDraft, index }) {
  const done = Boolean(lesson.completed)
  const dur = fmtDuration(lesson.durationSec)
  const inner = (
    <>
      <span className={cx('aca-lrow-status', done && 'is-done')} aria-hidden="true">
        {locked ? <Icon name="lock" size={14} stroke={1.9} /> : done ? <Icon name="check" size={13} stroke={2.6} /> : <span className="aca-lrow-num">{index}</span>}
      </span>
      <span className="aca-lrow-title">{lesson.title}</span>
      {showDraft && lesson.published === false && <span className="aca-chip-draft">Borrador</span>}
      {dur && <span className="aca-lrow-dur">{dur}</span>}
      <span className="aca-c-sr">{done ? ' (completada)' : ''}</span>
    </>
  )
  if (locked) return <li className="aca-lrow is-locked">{inner}</li>
  return (
    <li>
      <Link className="aca-lrow" to={r.lesson(courseSlug, lesson.slug)}>{inner}</Link>
    </li>
  )
}

function SectionBlock({ section, courseSlug, locked, showDraft, open, onToggle, startIndex }) {
  const lessons = section.lessons || []
  const done = lessons.filter((l) => l.completed).length
  const allDone = lessons.length > 0 && done === lessons.length
  const bodyId = `aca-sec-${section.id}`
  return (
    <section className={cx('aca-csec', open && 'is-open')}>
      <button type="button" className="aca-csec-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="aca-csec-title">{section.title}</span>
        <span className={cx('aca-csec-count', allDone && 'is-done')}>
          {allDone && <Icon name="check" size={12} stroke={2.6} />}
          {done}/{lessons.length}
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} />
      </button>
      {open && (
        <ol className="aca-lrows" id={bodyId}>
          {lessons.length === 0 && <li className="aca-lrows-empty">Sin lecciones todavía</li>}
          {lessons.map((l, i) => (
            <LessonRow key={l.id ?? l.slug} lesson={l} courseSlug={courseSlug} locked={locked} showDraft={showDraft} index={startIndex + i + 1} />
          ))}
        </ol>
      )}
    </section>
  )
}

export default function CursoPage() {
  const { curso } = useParams()
  const { isAdmin, isOwner, levelName } = useAcademy() || {}
  const canEdit = Boolean(isAdmin || isOwner)
  const q = useAcademyQuery(
    `course:${curso}`,
    () => academyApi('course', { query: { slug: curso } }),
    { deps: [curso], enabled: Boolean(curso) },
  )
  const data = q.data
  const course = data?.course
  const sections = Array.isArray(data?.sections) ? data.sections : []
  const unsectioned = Array.isArray(data?.unsectioned) ? data.unsectioned : []

  // Secciones abiertas: todas si son pocas; si no, la de la próxima lección.
  const [openIds, setOpenIds] = useState(null)
  const defaultOpen = useMemo(() => {
    if (!sections.length) return new Set()
    if (sections.length <= 3) return new Set(sections.map((s) => s.id))
    const nextSlug = course?.nextLesson?.slug
    const hit = sections.find((s) => (s.lessons || []).some((l) => l.slug === nextSlug)) || sections[0]
    return new Set([hit.id])
  }, [sections, course?.nextLesson?.slug])
  useEffect(() => { setOpenIds(null) }, [curso])
  const isOpen = (id) => (openIds || defaultOpen).has(id)
  const toggle = (id) => setOpenIds((prev) => {
    const next = new Set(prev || defaultOpen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  useEffect(() => {
    if (course?.title) document.title = `${course.title} · Academy`
  }, [course?.title])

  const notFound = q.error?.status === 404
  const locked = Boolean(course?.locked) && course?.lockReason !== 'borrador'
  const target = resumeTarget(data)
  const pct = clampPct(course?.progress)
  const total = Number(course?.lessonCount) || flattenLessons(data).length
  const doneCount = Number(course?.completedCount) || flattenLessons(data).filter((l) => l.completed).length
  const draft = course?.lockReason === 'borrador' || course?.published === false

  let cta = null
  if (course) {
    if (locked && course.lockReason === 'compra') {
      cta = <BuyButton course={course} />
    } else if (locked && course.lockReason === 'nivel') {
      cta = (
        <p className="aca-course-lock">
          <Icon name="lock" size={16} stroke={1.9} />
          <span>{levelLockText(course.unlockLevel, levelName)}</span>
        </p>
      )
    } else if (target?.slug) {
      const label = pct >= 100 ? 'Repasar' : pct > 0 ? 'Continuar' : 'Empezar'
      cta = (
        <Link className="aca-cbtn is-primary" to={r.lesson(curso, target.slug)}>
          <Icon name="play" size={15} stroke={2} />
          <span>{label}</span>
        </Link>
      )
    }
  }

  let counter = 0
  return (
    <div className="aca-course">
      <nav className="aca-crumbs" aria-label="Ruta">
        <Link to={r.path('/cursos')} className="aca-crumb-back">
          <Icon name="chevronLeft" size={16} />
          <span>Cursos</span>
        </Link>
      </nav>

      <PageState
        loading={q.loading && !data}
        error={data || notFound ? null : q.error}
        onRetry={q.refetch}
        empty={notFound || (!q.loading && !course && !q.error)}
        emptyText="No encontramos este curso. Puede que ya no esté disponible."
      >
        {course && (
          <>
            <header className={cx('aca-course-head', draft && 'is-draft')}>
              <CourseCover course={course} className="aca-course-cover" />
              <div className="aca-course-info">
                <div className="aca-course-titlerow">
                  <h1 className="aca-course-title">{course.title}</h1>
                  {draft && <span className="aca-chip-draft">Borrador</span>}
                </div>
                {course.subtitle && <p className="aca-course-sub">{course.subtitle}</p>}
                {course.description && <RichText text={course.description} className="aca-course-desc" />}
                {!locked && total > 0 && (
                  <div className="aca-course-progress">
                    <ProgressPill value={pct} />
                    <span className="aca-course-progress-txt">{doneCount} de {total} {total === 1 ? 'lección completada' : 'lecciones completadas'}</span>
                  </div>
                )}
                <div className="aca-course-actions">
                  {cta}
                  {canEdit && (
                    <a className="aca-clink" href="/panel?tab=academy">
                      <Icon name="pencil" size={14} />
                      <span>Editar</span>
                    </a>
                  )}
                </div>
              </div>
            </header>

            <div className="aca-course-body">
              <h2 className="aca-course-h2">Contenido del curso</h2>
              {!sections.length && !unsectioned.length ? (
                <p className="aca-c-muted">Este curso todavía no tiene lecciones publicadas.</p>
              ) : (
                <div className="aca-csecs">
                  {unsectioned.length > 0 && (
                    <section className="aca-csec is-open is-flat">
                      <ol className="aca-lrows">
                        {unsectioned.map((l) => {
                          counter += 1
                          return <LessonRow key={l.id ?? l.slug} lesson={l} courseSlug={curso} locked={locked} showDraft={canEdit} index={counter} />
                        })}
                      </ol>
                    </section>
                  )}
                  {sections.map((s) => {
                    const start = counter
                    counter += (s.lessons || []).length
                    return (
                      <SectionBlock
                        key={s.id}
                        section={s}
                        courseSlug={curso}
                        locked={locked}
                        showDraft={canEdit}
                        open={isOpen(s.id)}
                        onToggle={() => toggle(s.id)}
                        startIndex={start}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </PageState>
    </div>
  )
}
