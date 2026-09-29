import React, { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { academyApi } from '../../academy/api.js'
import { useAcademyQuery, setQueryData } from '../../academy/useQuery.js'
import { useAcademy } from '../../academy/context.js'
import { safeUrl, UGC_REL } from '../../academy/url.js'
import { r } from '../../academy/routes.js'
import PageState from '../../components/academy/PageState.jsx'
import RichText from '../../components/academy/RichText.jsx'
import LessonPlayer from '../../components/academy/LessonPlayer.jsx'
import LessonSidebar from '../../components/academy/LessonSidebar.jsx'
import LessonComments from '../../components/academy/LessonComments.jsx'
import { BuyButton, levelLockText, CourseCover } from '../../components/academy/CourseCard.jsx'
import '../../styles/academy/cursos.css'

/* ============================================================
   /academy/cursos/:curso/:leccion — barra lateral con el curso completo,
   video 16:9, "Marcar como completada", texto, recursos, anterior/siguiente
   y comentarios.

   Dos lecturas al entrar: `lesson` (lo privado: videoId, cuerpo, posición) y
   `course` (la lista para la barra; misma clave de caché que CursoPage, así
   volver al curso no pide nada nuevo). Ninguna se relee al volver a la
   pestaña: cambiaría el avance local por el del servidor en medio de la clase.
   Un 403 `locked` no trae ni el video ni el cuerpo — se muestra cómo
   desbloquearla.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function Resources({ items }) {
  const list = (Array.isArray(items) ? items : [])
    .map((it) => ({ title: String(it?.title || '').trim(), url: safeUrl(it?.url) }))
    .filter((it) => it.url)
  if (!list.length) return null
  return (
    <section className="aca-lres" aria-label="Recursos">
      <h2 className="aca-lres-title">Recursos</h2>
      <ul className="aca-lres-list">
        {list.map((it, i) => (
          <li key={`${it.url}-${i}`}>
            <a className="aca-lres-item" href={it.url} target="_blank" rel={UGC_REL}>
              <span className="aca-lres-ico" aria-hidden="true"><Icon name="link" size={16} /></span>
              <span className="aca-lres-main">
                <span className="aca-lres-name">{it.title || hostOf(it.url) || 'Enlace'}</span>
                <span className="aca-lres-host">{hostOf(it.url)}</span>
              </span>
              <Icon name="arrowRight" size={15} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function LockedLesson({ courseSlug, course, levelName, error }) {
  // El 403 `locked` trae el motivo (lockReason/unlockLevel) mezclado en la
  // respuesta: sirve aunque la lista del curso todavía no haya llegado.
  const reason = course?.lockReason || error?.data?.lockReason || null
  const unlockLevel = course?.unlockLevel ?? error?.data?.unlockLevel ?? null
  return (
    <div className="aca-llocked">
      {course && <CourseCover course={course} className="aca-llocked-cover" />}
      <div className="aca-llocked-body">
        <span className="aca-llocked-ico" aria-hidden="true"><Icon name="lock" size={22} stroke={1.8} /></span>
        <h1 className="aca-llocked-title">Esta lección está bloqueada</h1>
        <p className="aca-c-muted">
          {reason === 'nivel'
            ? levelLockText(unlockLevel, levelName)
            : course?.title
              ? `Es parte de «${course.title}». Cuando lo tengas, la ves acá mismo.`
              : 'Todavía no tienes acceso a este curso.'}
        </p>
        <div className="aca-llocked-actions">
          {reason === 'compra' && <BuyButton course={course || { slug: courseSlug }} />}
          <Link className="aca-cbtn" to={r.course(courseSlug)}>Ver el curso</Link>
        </div>
      </div>
    </div>
  )
}

export default function LeccionPage() {
  const { curso, leccion } = useParams()
  const { isAdmin, isOwner, levelName, toast } = useAcademy() || {}
  const canEdit = Boolean(isAdmin || isOwner)
  const notify = (msg, kind) => { try { toast?.(msg, kind) } catch {} }

  const lessonKey = `lesson:${curso}:${leccion}`
  const lq = useAcademyQuery(
    lessonKey,
    () => academyApi('lesson', { query: { course: curso, lesson: leccion } }),
    { deps: [curso, leccion], enabled: Boolean(curso && leccion), refetchOnFocus: false },
  )
  const cq = useAcademyQuery(
    `course:${curso}`,
    () => academyApi('course', { query: { slug: curso } }),
    { deps: [curso], enabled: Boolean(curso), refetchOnFocus: false },
  )

  // Últimas versiones, para actualizar sin carreras (ver LessonComments).
  const lLatest = useRef(lq.data); lLatest.current = lq.data
  const cLatest = useRef(cq.data); cLatest.current = cq.data
  const setLesson = (patch) => {
    const cur = lLatest.current
    if (!cur?.lesson) return
    const next = { ...cur, lesson: { ...cur.lesson, ...patch } }
    lLatest.current = next
    lq.setData(next)
  }
  const setCourseLesson = (lessonId, patch, courseProgress) => {
    const cur = cLatest.current
    if (!cur) return
    const mapL = (l) => (Number(l.id) === Number(lessonId) ? { ...l, ...patch } : l)
    const sections = (cur.sections || []).map((s) => ({ ...s, lessons: (s.lessons || []).map(mapL) }))
    const unsectioned = (cur.unsectioned || []).map(mapL)
    const all = [...unsectioned, ...sections.flatMap((s) => s.lessons)]
    const completedCount = all.filter((l) => l.completed).length
    const total = all.length
    const progress = typeof courseProgress === 'number'
      ? courseProgress
      : total ? Math.round((completedCount / total) * 100) : 0
    const nextUp = all.find((l) => !l.completed)
    const course = cur.course
      ? { ...cur.course, completedCount, progress, nextLesson: nextUp ? { slug: nextUp.slug, title: nextUp.title } : null }
      : cur.course
    const next = { ...cur, sections, unsectioned, course }
    cLatest.current = next
    cq.setData(next)
    // La grilla de Cursos (otra key) queda al día sin volver a pedirla.
    if (course) {
      setQueryData('courses', (d) => (Array.isArray(d?.courses)
        ? { ...d, courses: d.courses.map((c) => (c.slug === curso ? { ...c, progress: course.progress, completedCount, nextLesson: course.nextLesson } : c)) }
        : d))
    }
  }

  const data = lq.data
  // Mientras llega la lección nueva, no se muestra la anterior con la barra
  // lateral ya marcando la siguiente.
  const lesson = data?.lesson && (!data.lesson.slug || data.lesson.slug === leccion) ? data.lesson : null
  const [saving, setSaving] = useState(false)

  // Al cambiar de lección, arriba del todo (el reproductor primero).
  useEffect(() => {
    try { window.scrollTo({ top: 0, behavior: 'auto' }) } catch {}
  }, [curso, leccion])

  useEffect(() => {
    if (lesson?.title) document.title = `${lesson.title} · Academy`
  }, [lesson?.title])

  const setCompleted = async (value, positionSec, { auto = false } = {}) => {
    const cur = lLatest.current?.lesson
    if (!cur?.id) return
    const prevCompleted = Boolean(cur.completed)
    const prevCourse = cLatest.current
    setLesson({ completed: value })
    setCourseLesson(cur.id, { completed: value })
    if (!auto) setSaving(true)
    try {
      const body = { lessonId: cur.id, completed: value }
      if (positionSec != null) body.positionSec = Math.max(0, Math.floor(positionSec))
      const res = await academyApi('lesson-progress', { method: 'POST', body })
      const done = typeof res?.completed === 'boolean' ? res.completed : value
      setLesson({ completed: done, ...(typeof res?.positionSec === 'number' ? { positionSec: res.positionSec } : {}) })
      setCourseLesson(cur.id, { completed: done }, typeof res?.courseProgress === 'number' ? res.courseProgress : undefined)
      if (done && res?.courseProgress === 100 && !prevCompleted) notify('¡Terminaste el curso!', 'ok')
      else if (done && auto) notify('Lección completada', 'ok')
    } catch (err) {
      setLesson({ completed: prevCompleted })
      if (prevCourse) { cLatest.current = prevCourse; cq.setData(prevCourse) }
      notify((err && err.message) || 'No se pudo guardar tu avance', 'error')
    } finally {
      if (!auto) setSaving(false)
    }
  }

  const lockedErr = Boolean(lq.error) && !lesson && (lq.error.code === 'locked' || (lq.error.status === 403 && lq.error.code !== 'password_change_required'))
  const notFound = lq.error && lq.error.status === 404
  const course = cq.data?.course
  const sectionLesson = (() => {
    const all = [...(cq.data?.unsectioned || []), ...(cq.data?.sections || []).flatMap((s) => s.lessons || [])]
    return all.find((l) => l.slug === leccion) || null
  })()
  const draft = lesson?.published === false || sectionLesson?.published === false

  let main
  if (lockedErr) {
    main = <LockedLesson courseSlug={curso} course={course} levelName={levelName} error={lq.error} />
  } else {
    main = (
      <PageState
        loading={lq.loading && !lesson}
        error={lesson || notFound ? null : lq.error}
        onRetry={lq.refetch}
        empty={notFound || (!lq.loading && !lq.error && !lesson)}
        emptyText="No encontramos esta lección. Puede que la hayan movido."
      >
        {lesson && (
          <article className="aca-lmain">
            {lesson.videoId ? (
              <LessonPlayer
                key={lesson.id}
                lessonId={lesson.id}
                videoId={lesson.videoId}
                title={lesson.title}
                startSec={lesson.positionSec}
                durationSec={lesson.durationSec}
                completed={Boolean(lesson.completed)}
                onComplete={(pos) => setCompleted(true, pos, { auto: true })}
                onPosition={(pos) => {
                  // Se escribe en la key de ESTA lección (no en la actual: al
                  // cambiar de lección el reproductor viejo guarda al desmontarse).
                  const id = lesson.id
                  setQueryData(lessonKey, (d) => (d?.lesson?.id === id ? { ...d, lesson: { ...d.lesson, positionSec: pos } } : d))
                }}
              />
            ) : (
              // Lección publicada antes de tener su video (el curso se abre a la
              // venta con el temario completo y los videos se van subiendo):
              // un aviso en el lugar del video, no un hueco.
              <div className="aca-lsoon" role="note">
                <span className="aca-lsoon-ico" aria-hidden="true"><Icon name="video" size={22} /></span>
                <p className="aca-lsoon-title">El video de esta lección se publica pronto</p>
                <p className="aca-lsoon-text">Mientras, deja tus preguntas en los comentarios: las respondemos acá mismo.</p>
              </div>
            )}

            <header className="aca-lhead">
              <div className="aca-lhead-text">
                {lesson.sectionTitle && <p className="aca-lhead-kicker">{lesson.sectionTitle}</p>}
                <div className="aca-lhead-titlerow">
                  <h1 className="aca-lhead-title">{lesson.title}</h1>
                  {canEdit && draft && <span className="aca-chip-draft">Borrador</span>}
                </div>
              </div>
              <div className="aca-lhead-actions">
                <button
                  type="button"
                  className={cx('aca-ldone', lesson.completed && 'is-on')}
                  aria-pressed={Boolean(lesson.completed)}
                  onClick={() => setCompleted(!lesson.completed)}
                  disabled={saving}
                >
                  <span className="aca-ldone-ico" aria-hidden="true">
                    {lesson.completed ? <Icon name="check" size={13} stroke={2.8} /> : null}
                  </span>
                  <span>{lesson.completed ? 'Completada' : 'Marcar como completada'}</span>
                </button>
                {canEdit && (
                  <a className="aca-clink" href="/panel?tab=academy">
                    <Icon name="pencil" size={14} />
                    <span>Editar</span>
                  </a>
                )}
              </div>
            </header>

            {lesson.body ? <RichText text={lesson.body} className="aca-lbody" /> : null}

            <Resources items={lesson.resources} />

            {(data.prev || data.next) && (
              <nav className="aca-lnav" aria-label="Lecciones">
                {data.prev ? (
                  <Link className="aca-lnav-btn is-prev" to={r.lesson(curso, data.prev.slug)}>
                    <Icon name="chevronLeft" size={18} />
                    <span className="aca-lnav-txt"><small>Anterior</small><span>{data.prev.title}</span></span>
                  </Link>
                ) : <span />}
                {data.next ? (
                  <Link className={cx('aca-lnav-btn is-next', lesson.completed && 'is-hot')} to={r.lesson(curso, data.next.slug)}>
                    <span className="aca-lnav-txt"><small>Siguiente</small><span>{data.next.title}</span></span>
                    <Icon name="chevronRight" size={18} />
                  </Link>
                ) : <span />}
              </nav>
            )}

            <LessonComments key={`c-${lesson.id}`} lessonId={lesson.id} />
          </article>
        )}
      </PageState>
    )
  }

  return (
    <div className="aca-lesson">
      {/* Primero en el DOM: a la izquierda en escritorio y, en el celular, una
          barra plegada sobre el video (a un toque, sin bajar hasta el final). */}
      <LessonSidebar
        courseSlug={curso}
        data={cq.data}
        currentSlug={leccion}
        loading={cq.loading}
        showDrafts={canEdit}
      />
      <div className="aca-lesson-main">{main}</div>
    </div>
  )
}
