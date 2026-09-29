import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import InstallPrompt from '../InstallPrompt.jsx'
import { installState, canOfferInstall, onInstallStateChange } from '../../installPrompt.js'
import { useAcademy } from '../../academy/context.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { academyApi } from '../../academy/api.js'
import { todayKey, addDays } from '../../academy/calendarMath.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/app.css'

/* ============================================================
   "Primeros pasos" arriba del feed (SPEC §7.3), con anillo de progreso.

   Miembro: Completa tu perfil · Mira tu primera lección · Instala la app ·
   Comenta una publicación.
   Dueño/admin: Sube la portada · Completa Acerca de · Carga los cursos ·
   Escribe tu primera publicación · Crea tu primer evento.

   Cada paso se da por hecho con datos reales cuando se puede (foto y bio,
   progreso de un curso, portada/descripción del grupo, contadores del
   perfil, eventos del calendario) y si no, con prefs.onboarding.done (lo
   marca markOnboarding del contexto al tocarlo). Las lecturas usan las
   MISMAS keys de caché que las pestañas (courses, mi:group-card,
   mi:member:<handle>): no suman consultas al volver a esas pantallas, y
   solo corren mientras el widget está visible. "Descartar" guarda
   prefs.onboarding.dismissed y no vuelve a aparecer.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

function Ring({ done, total }) {
  const R = 18
  const C = 2 * Math.PI * R
  const pct = total ? done / total : 0
  return (
    <span className="aca-onb-ring" role="img" aria-label={`${done} de ${total} pasos listos`}>
      <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
        <circle cx="23" cy="23" r={R} className="aca-onb-ring-track" />
        <circle
          cx="23"
          cy="23"
          r={R}
          className="aca-onb-ring-bar"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          transform="rotate(-90 23 23)"
        />
      </svg>
      <span className="aca-onb-ring-num">{done}/{total}</span>
    </span>
  )
}

export default function OnboardingWidget() {
  const { me, setMe, isAdmin, markOnboarding, toast, tz } = useAcademy()
  const navigate = useNavigate()
  const [installOpen, setInstallOpen] = useState(false)
  const [, rerender] = useState(0)
  useEffect(() => onInstallStateChange(() => rerender((n) => n + 1)), [])

  const ob = me?.prefs?.onboarding || {}
  const done = useMemo(() => new Set(Array.isArray(ob.done) ? ob.done : []), [ob.done])
  const visible = Boolean(me) && !ob.dismissed
  const owner = Boolean(isAdmin)
  const handle = me?.handle || ''

  // Lecturas compartidas con las pestañas (mismas keys y mismos fetchers).
  const needCourses = visible && (owner ? !done.has('cursos') : !done.has('leccion'))
  const coursesQ = useAcademyQuery('courses', () => academyApi('courses'), { enabled: needCourses, refetchOnFocus: false })
  const needGroup = visible && owner && !(done.has('portada') && done.has('acerca'))
  const groupQ = useAcademyQuery('mi:group-card', () => academyApi('group-card'), { enabled: needGroup, refetchOnFocus: false })
  const needStats = visible && Boolean(handle) && !done.has(owner ? 'publicar' : 'comentar')
  const memberQ = useAcademyQuery(`mi:member:${handle}`, () => academyApi('member', { query: { handle } }), {
    enabled: needStats,
    refetchOnFocus: false,
    deps: [handle],
  })
  const needEvents = visible && owner && !done.has('evento')
  const evFrom = todayKey(tz)
  const evTo = addDays(evFrom, 60)
  const eventsQ = useAcademyQuery(`mi:onb-events:${evFrom}`, () => academyApi('events', { query: { from: evFrom, to: evTo } }), {
    enabled: needEvents,
    refetchOnFocus: false,
  })

  const courses = Array.isArray(coursesQ.data?.courses) ? coursesQ.data.courses : []
  const stats = memberQ.data?.stats || {}
  const card = groupQ.data || {}
  const events = Array.isArray(eventsQ.data?.events) ? eventsQ.data.events : []
  const installed = installState() === 'installed'

  const steps = owner
    ? [
        { id: 'portada', label: 'Sube la portada del grupo', icon: 'image', ok: Boolean(card.coverUrl), go: () => navigate(r.miembros) },
        { id: 'acerca', label: 'Completa “Acerca de”', icon: 'info', ok: Boolean(String(card.description || '').trim()), go: () => navigate(r.acerca) },
        { id: 'cursos', label: 'Carga los cursos', icon: 'book', ok: courses.length > 0, go: () => navigate(r.cursos) },
        {
          id: 'publicar',
          label: 'Escribe tu primera publicación',
          icon: 'pencil',
          ok: Number(stats.posts) > 0,
          go: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
        },
        { id: 'evento', label: 'Crea tu primer evento', icon: 'calendar', ok: events.length > 0, go: () => navigate(r.calendario) },
      ]
    : [
        {
          id: 'perfil',
          label: 'Completa tu perfil',
          hint: 'Foto y una línea sobre ti',
          icon: 'user',
          ok: Boolean(me?.avatarUrl) && Boolean(String(me?.bio || '').trim()),
          go: () => navigate(r.ajustes),
        },
        {
          id: 'leccion',
          label: 'Mira tu primera lección',
          icon: 'play',
          ok: courses.some((c) => Number(c.completedCount) > 0 || Number(c.progress) > 0),
          go: () => navigate(r.cursos),
        },
        {
          id: 'app',
          label: 'Instala la app',
          hint: 'Te avisa de mensajes y eventos',
          icon: 'download',
          ok: installed,
          go: () => {
            if (canOfferInstall()) setInstallOpen(true)
            else {
              toast?.('Ábrela desde el navegador de tu celular y elige “Agregar a inicio”.', 'info')
              markOnboarding?.('app')
            }
          },
        },
        {
          id: 'comentar',
          label: 'Comenta una publicación',
          icon: 'message',
          ok: Number(stats.comments) > 0,
          go: () => {
            const el = document.querySelector('.aca-cm-com-main article, .aca-cm-com-main [data-post-id]')
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          },
        },
      ]

  const rows = steps.map((s) => ({ ...s, ok: s.ok || done.has(s.id) }))
  const count = rows.filter((s) => s.ok).length

  if (!visible || count === rows.length) return null

  const dismiss = async () => {
    const prev = me
    setMe?.((m) => (m ? { ...m, prefs: { ...(m.prefs || {}), onboarding: { ...(m.prefs?.onboarding || {}), dismissed: true } } } : m))
    try {
      const res = await academyApi('me-update', { method: 'POST', body: { prefs: { onboarding: { dismissed: true } } } })
      if (res?.member) setMe?.(res.member)
    } catch (err) {
      setMe?.(prev)
      toast?.(err?.message || 'No se pudo guardar. Intenta de nuevo.', 'error')
    }
  }

  const run = (s) => {
    if (!s.ok) s.go?.()
  }

  return (
    <section className="aca-onb" aria-label="Primeros pasos">
      <header className="aca-onb-head">
        <Ring done={count} total={rows.length} />
        <div className="aca-onb-title">
          <h2>{owner ? 'Prepara tu Academy' : 'Primeros pasos'}</h2>
          <p>{owner ? 'Deja el grupo listo antes de invitar a tus alumnos.' : 'Cuatro cosas para sacarle el jugo a la Academy.'}</p>
        </div>
        <button type="button" className="aca-link-btn aca-onb-dismiss" onClick={dismiss}>Descartar</button>
      </header>
      <ol className="aca-onb-list">
        {rows.map((s) => (
          <li key={s.id}>
            <button type="button" className={cx('aca-onb-step', s.ok && 'is-done')} onClick={() => run(s)} disabled={s.ok} aria-label={s.ok ? `${s.label} (listo)` : s.label}>
              <span className="aca-onb-check" aria-hidden="true">
                {s.ok ? <Icon name="check" size={14} stroke={2.4} /> : <Icon name={s.icon} size={15} />}
              </span>
              <span className="aca-onb-text">
                <span>{s.label}</span>
                {s.hint && !s.ok && <small>{s.hint}</small>}
              </span>
              {!s.ok && <Icon name="chevronRight" size={16} />}
            </button>
          </li>
        ))}
      </ol>
      <InstallPrompt
        audience="student"
        open={installOpen}
        onClose={() => {
          setInstallOpen(false)
          markOnboarding?.('app')
        }}
      />
    </section>
  )
}

export { OnboardingWidget }
