import React, { useEffect } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import { Button } from '../panel/index.js'
import '../../styles/academy/app.css'

/* ============================================================
   PageState — los tres estados de cualquier lectura de la Academy
   (SPEC §7.3): cargando (esqueleto), error ("No se pudo cargar ·
   Reintentar") y vacío. Si no aplica ninguno, pinta `children`.

     <PageState loading={q.loading && !q.data} error={!q.data ? q.error : null}
                onRetry={q.refetch} empty={…} emptyText="Aún no hay…">
       …contenido…
     </PageState>

   Prioridad: loading > error > empty > children. Detrás de una sesión de
   miembro NUNCA hay datos de demostración: si falla, se dice que falló.

   Props extra: emptyTitle, emptyIcon, emptyAction {label, onClick},
   errorTitle, skeleton ('card' | 'rows' | 'grid'), rows, compact, className.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

/* body.aca-mode mientras haya una pantalla de la Academy montada (la app o
   una página de acceso): fondo propio con !important (ThemeProvider pinta
   body.style.backgroundColor en línea), sin el toggle flotante de tema ni
   el degradé fijo del sitio público. Con contador: al pasar de /ingreso a
   la app, la limpieza de una no le saca la clase a la otra. Vive acá porque
   PageState lo importan todas las pantallas de la Academy. */
let acaModeHolders = 0
export function useAcaMode() {
  useEffect(() => {
    acaModeHolders += 1
    document.body.classList.add('aca-mode')
    return () => {
      acaModeHolders = Math.max(0, acaModeHolders - 1)
      // Con respiro: entre /ingreso y la app hay un chunk perezoso cargando
      // (sin nadie montado); sacar la clase ahí pintaría un destello del
      // fondo del sitio público.
      setTimeout(() => {
        if (!acaModeHolders) document.body.classList.remove('aca-mode')
      }, 1500)
    }
  }, [])
}

function errorMessage(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error.status === 0) return error.message || 'Sin conexión. Revisa tu internet e intenta de nuevo.'
  return error.message || 'Intenta de nuevo en un momento.'
}

function Bar({ w = '100%', h = 12 }) {
  return <span className="aca-skel" style={{ width: w, height: h }} aria-hidden="true" />
}

export function PageSkeleton({ variant = 'card', rows = 3, compact = false }) {
  if (variant === 'grid') {
    return (
      <div className="aca-state-grid" aria-busy="true" aria-label="Cargando">
        {Array.from({ length: Math.max(1, rows) }, (_, i) => (
          <div className="aca-state-card is-tile" key={i}>
            <span className="aca-skel aca-skel-cover" aria-hidden="true" />
            <div className="aca-state-lines">
              <Bar w="70%" h={14} />
              <Bar w="95%" />
              <Bar w="55%" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (variant === 'rows') {
    return (
      <div className={cx('aca-state-card', compact && 'is-compact')} aria-busy="true" aria-label="Cargando">
        {Array.from({ length: Math.max(1, rows) }, (_, i) => (
          <div className="aca-state-row" key={i}>
            <span className="aca-skel aca-skel-circle" aria-hidden="true" />
            <div className="aca-state-lines">
              <Bar w={`${60 - (i % 3) * 10}%`} h={13} />
              <Bar w={`${40 + (i % 2) * 15}%`} h={11} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="aca-state-stack" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: compact ? 1 : Math.max(1, Math.min(rows, 4)) }, (_, i) => (
        <div className={cx('aca-state-card', compact && 'is-compact')} key={i}>
          <div className="aca-state-row">
            <span className="aca-skel aca-skel-circle" aria-hidden="true" />
            <div className="aca-state-lines">
              <Bar w="38%" h={13} />
              <Bar w="22%" h={10} />
            </div>
          </div>
          {!compact && (
            <div className="aca-state-lines">
              <Bar w="85%" h={14} />
              <Bar w="100%" />
              <Bar w="72%" />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function PageState({
  loading,
  error,
  onRetry,
  empty,
  emptyText,
  emptyTitle,
  emptyIcon = 'spark',
  emptyAction,
  errorTitle = 'No se pudo cargar',
  skeleton = 'card',
  rows = 3,
  compact = false,
  className,
  children,
}) {
  if (loading) {
    return (
      <div className={cx('aca-state', className)}>
        <PageSkeleton variant={skeleton} rows={rows} compact={compact} />
      </div>
    )
  }

  if (error) {
    const offline = typeof error === 'object' && error && error.status === 0
    return (
      <div className={cx('aca-state', 'aca-state-box', 'is-error', compact && 'is-compact', className)} role="alert">
        <span className="aca-state-icon"><Icon name={offline ? 'globe' : 'alert'} size={compact ? 16 : 20} /></span>
        <div className="aca-state-copy">
          <p className="aca-state-title">{errorTitle}</p>
          <p className="aca-state-text">{errorMessage(error)}</p>
        </div>
        {onRetry && (
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => onRetry()}>
            Reintentar
          </Button>
        )}
      </div>
    )
  }

  if (empty) {
    return (
      <div className={cx('aca-state', 'aca-state-box', 'is-empty', compact && 'is-compact', className)}>
        <span className="aca-state-icon"><Icon name={emptyIcon} size={compact ? 16 : 20} /></span>
        <div className="aca-state-copy">
          {emptyTitle && <p className="aca-state-title">{emptyTitle}</p>}
          <p className="aca-state-text">{emptyText || 'Aún no hay nada por acá.'}</p>
        </div>
        {emptyAction && (
          <Button variant="secondary" size="sm" icon={emptyAction.icon} onClick={emptyAction.onClick}>
            {emptyAction.label}
          </Button>
        )}
      </div>
    )
  }

  return children ?? null
}

export { PageState }
