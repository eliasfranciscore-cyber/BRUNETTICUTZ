import React from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { isImageUrl } from '../../academy/url.js'
import { r } from '../../academy/routes.js'
import { catalogHref } from '../../academy/host.jsx'
import { useAcademy } from '../../academy/context.js'
import '../../styles/academy/cursos.css'

/* ============================================================
   Tarjeta de curso de la pestaña Cursos (captura 1 de Skool): portada 1.9:1,
   título, descripción de 2 líneas y la píldora verde de progreso con el %.

   Estados que vienen del backend (`lockReason`):
   · 'compra'   → candado sobre la portada + "Comprar", que va al catálogo
                  público con navegación DURA: /academy tiene su propio CSP y
                  el catálogo vive fuera de la app de miembros (SPEC §7.1).
   · 'nivel'    → candado + "Se desbloquea en Nivel N".
   · 'borrador' → solo lo ve el equipo: atenuada y con la etiqueta "Borrador",
                  igual que Skool marca los cursos en borrador a los admins.

   Toda la tarjeta es un solo enlace (el título, estirado con ::after) para
   que el lector de pantalla lea una cosa por tarjeta; el botón "Comprar"
   queda por encima con z-index y sigue siendo su propio enlace.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

/* Precio en pesos chilenos: $49.990. */
export function fmtCLP(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return ''
  try {
    return `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(v)}`
  } catch {
    return `$${Math.round(v)}`
  }
}

/* "12:34" o "1:02:03"; vacío si no hay duración. */
export function fmtDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  if (!s) return ''
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/* Enlace al curso en el catálogo público: lo decide cada sitio (host.jsx),
   porque cada uno ancla su catálogo a su manera. Se reexporta para no romper
   a quien lo importaba de acá. */
export { catalogHref }

export function clampPct(v) {
  const n = Math.round(Number(v) || 0)
  return Math.max(0, Math.min(100, n))
}

/* Píldora de progreso de Skool: pista gris redondeada, relleno verde y el %
   escrito adentro (blanco sobre el verde; oscuro mientras el relleno es muy
   corto para contenerlo). */
export function ProgressPill({ value, className, label }) {
  const pct = clampPct(value)
  return (
    <div
      className={cx('aca-cpill', pct >= 14 && 'is-inside', className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || `Progreso ${pct}%`}
    >
      <i className="aca-cpill-fill" style={{ width: `${pct}%` }} />
      <span className="aca-cpill-label">{pct}%</span>
    </div>
  )
}

/* Portada con respaldo: si la URL no es del Blob del proyecto ni de
   /assets/ (isImageUrl), no se pinta — se muestra un bloque con el título.
   Nunca se renderiza una imagen externa arbitraria (CSP + privacidad). */
export function CourseCover({ course, className, overlay = true }) {
  const src = course?.coverUrl && isImageUrl(course.coverUrl) ? course.coverUrl : null
  const locked = Boolean(course?.locked) && course?.lockReason !== 'borrador'
  return (
    <div className={cx('aca-ccover', !src && 'is-empty', className)}>
      {src
        ? <img src={src} alt="" loading="lazy" decoding="async" />
        : <span className="aca-ccover-ph" aria-hidden="true">{String(course?.title || '').slice(0, 60)}</span>}
      {overlay && locked && (
        <span className="aca-ccover-lock" aria-hidden="true">
          <span className="aca-ccover-lock-ico"><Icon name="lock" size={22} stroke={1.8} /></span>
        </span>
      )}
    </div>
  )
}

/* Texto del candado por nivel. */
export function levelLockText(n, levelName) {
  const lvl = Number(n) || 0
  if (!lvl) return 'Se desbloquea al subir de nivel'
  const name = typeof levelName === 'function' ? levelName(lvl) : ''
  return name ? `Se desbloquea en Nivel ${lvl} · ${name}` : `Se desbloquea en Nivel ${lvl}`
}

/* Botón de compra (va al catálogo público, navegación dura). */
export function BuyButton({ course, block, className }) {
  const price = course?.salesOpen ? fmtCLP(course?.priceOnline) : ''
  return (
    <a
      className={cx('aca-cbuy', block && 'is-block', className)}
      href={catalogHref(course)}
      onClick={(e) => e.stopPropagation()}
    >
      <Icon name="cart" size={15} stroke={1.9} />
      <span>{course?.salesOpen === false ? 'Ver en el catálogo' : 'Comprar'}</span>
      {price && <span className="aca-cbuy-price">{price}</span>}
    </a>
  )
}

export default function CourseCard({ course }) {
  const { levelName } = useAcademy() || {}
  if (!course) return null
  const draft = course.lockReason === 'borrador' || course.published === false
  const reason = course.locked ? course.lockReason : null
  const lessonCount = Number(course.lessonCount) || 0
  const desc = course.description || course.subtitle || ''

  let foot
  if (reason === 'compra') {
    foot = <BuyButton course={course} block />
  } else if (reason === 'nivel') {
    foot = (
      <p className="aca-ccard-lock">
        <Icon name="lock" size={15} stroke={1.9} />
        <span>{levelLockText(course.unlockLevel, levelName)}</span>
      </p>
    )
  } else if (!lessonCount) {
    foot = <p className="aca-ccard-soon">Próximamente</p>
  } else {
    foot = <ProgressPill value={course.progress} label={`Progreso del curso ${clampPct(course.progress)}%`} />
  }

  return (
    <article className={cx('aca-ccard', draft && 'is-draft', reason && reason !== 'borrador' && 'is-locked')}>
      <div className="aca-ccard-media">
        <CourseCover course={course} />
        {draft && <span className="aca-ccard-tag">Borrador</span>}
      </div>
      <div className="aca-ccard-body">
        <h3 className="aca-ccard-title">
          <Link to={r.course(course.slug)} className="aca-ccard-link">{course.title}</Link>
        </h3>
        {desc && <p className="aca-ccard-desc">{desc}</p>}
        <div className="aca-ccard-foot">{foot}</div>
      </div>
    </article>
  )
}
