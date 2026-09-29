import React from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../../academy/Icon.jsx'
import { academyApi } from '../../../academy/api.js'
import { useAcademyQuery } from '../../../academy/useQuery.js'
import { useAcademy } from '../../../academy/context.js'
import { r } from '../../../academy/routes.js'
import PageState from '../../../components/academy/PageState.jsx'
import CourseCard, { CourseCover, ProgressPill, clampPct } from '../../../components/academy/CourseCard.jsx'
import '../../../styles/academy/cursos.css'

/* ============================================================
   Pestaña Cursos — la grilla de la captura 1 (3 / 2 / 1 columnas).
   Arriba, si hay algo empezado, la franja "Continuar donde quedaste" que
   lleva directo a la próxima lección (Skool no la tiene; es el atajo que más
   pide un alumno que vuelve después de días).
   Una sola lectura (`courses`) al entrar; se relee al volver a la pestaña.
   ============================================================ */

function GridSkeleton() {
  return (
    <div className="aca-cgrid" aria-busy="true" aria-label="Cargando cursos">
      {[0, 1, 2].map((i) => (
        <div className="aca-ccard is-skel" key={i}>
          <div className="aca-ccover aca-c-skel" />
          <div className="aca-ccard-body">
            <span className="aca-c-skel aca-c-skel-line" style={{ width: '60%', height: 18 }} />
            <span className="aca-c-skel aca-c-skel-line" style={{ width: '95%' }} />
            <span className="aca-c-skel aca-c-skel-line" style={{ width: '80%' }} />
            <span className="aca-c-skel aca-c-skel-line" style={{ width: '100%', height: 20, borderRadius: 99, marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function ResumeStrip({ items }) {
  return (
    <section className="aca-resume" aria-label="Continuar donde quedaste">
      <h2 className="aca-resume-title">Continuar donde quedaste</h2>
      <div className="aca-resume-row">
        {items.map((c) => (
          <Link key={c.id} className="aca-resume-item" to={r.lesson(c.slug, c.nextLesson.slug)}>
            <CourseCover course={c} className="aca-resume-cover" overlay={false} />
            <span className="aca-resume-main">
              <span className="aca-resume-course">{c.title}</span>
              <span className="aca-resume-next">
                <Icon name="play" size={12} stroke={2} />
                <span>{c.nextLesson.title}</span>
              </span>
              <ProgressPill value={c.progress} className="is-sm" />
            </span>
            <span className="aca-resume-go" aria-hidden="true"><Icon name="chevronRight" size={18} /></span>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default function CursosTab() {
  const { isAdmin, isOwner } = useAcademy() || {}
  const q = useAcademyQuery('courses', () => academyApi('courses'))
  const courses = Array.isArray(q.data?.courses) ? q.data.courses : []
  const canEdit = Boolean(isAdmin || isOwner)

  // Empezados y sin terminar, con una próxima lección a la que ir.
  const resume = courses
    .filter((c) => !c.locked && c.nextLesson?.slug && clampPct(c.progress) > 0 && clampPct(c.progress) < 100)
    .sort((a, b) => clampPct(b.progress) - clampPct(a.progress))
    .slice(0, 3)

  const loadingFirst = q.loading && !q.data

  return (
    <div className="aca-cursos">
      {canEdit && (
        <div className="aca-cursos-staff">
          <span className="aca-cursos-staff-note">
            <Icon name="eye" size={15} />
            <span>Los borradores solo los ve el equipo.</span>
          </span>
          {/* Navegación dura: el panel es otra app (otro CSP, sesión de barbero). */}
          <a className="aca-clink" href="/panel?tab=academy">
            <Icon name="pencil" size={14} />
            <span>Editar cursos</span>
          </a>
        </div>
      )}

      {loadingFirst ? (
        <GridSkeleton />
      ) : (
        <PageState
          loading={false}
          error={q.data ? null : q.error}
          onRetry={q.refetch}
          empty={!courses.length}
          emptyText={canEdit ? 'Aún no hay cursos. Cárgalos desde el panel → Academy → Cursos.' : 'Aún no hay cursos publicados.'}
        >
          {resume.length > 0 && <ResumeStrip items={resume} />}
          <div className="aca-cgrid">
            {courses.map((c) => <CourseCard key={c.id ?? c.slug} course={c} />)}
          </div>
        </PageState>
      )}
    </div>
  )
}
