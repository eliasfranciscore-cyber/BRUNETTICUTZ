import React from 'react'
import { Link } from 'react-router-dom'
import MemberAvatar from './MemberAvatar.jsx'
import { useAcademy } from '../../academy/context.js'
import { r } from '../../academy/routes.js'
import { cx } from './MemberCard.jsx'
import '../../styles/academy/miembros.css'

/* ============================================================
   Tabla de clasificación (7 días / 30 días / de todos los tiempos).
   rows = [{ rank, member: MemberMini, points }] tal como viene de
   `leaderboard.boards.*`. `showPlus` antepone "+" (puntos ganados en la
   ventana, como Skool); la de siempre muestra el total.
   Reutilizable desde la columna derecha de Comunidad (`limit`, `compact`).
   ============================================================ */

export default function LeaderboardTable({
  title,
  rows = [],
  showPlus = true,
  myRank = null,
  limit = 10,
  emptyText = 'Aún no hay actividad',
  compact = false,
  footer = null,
  className,
}) {
  const { me } = useAcademy()
  const list = (Array.isArray(rows) ? rows : []).slice(0, limit)
  const meId = me ? Number(me.id) : null
  const inList = list.some((row) => Number(row?.member?.id) === meId)

  return (
    <section className={cx('aca-lb-card', compact && 'is-compact', className)} aria-label={typeof title === 'string' ? title : undefined}>
      {title && <h3 className="aca-lb-title">{title}</h3>}
      {list.length === 0 ? (
        <p className="aca-lb-empty">{emptyText}</p>
      ) : (
        <ol className="aca-lb-rows">
          {list.map((row, i) => {
            const m = row?.member || {}
            const rank = Number(row?.rank) || i + 1
            const mine = Number(m.id) === meId
            const to = m.handle ? r.profile(m.handle) : null
            return (
              <li key={`${m.id || i}-${rank}`} className={cx('aca-lb-row', mine && 'is-me')}>
                <span className={cx('aca-lb-rank', rank <= 3 && `is-top is-${rank}`)} aria-label={`Puesto ${rank}`}>{rank}</span>
                {to ? (
                  <Link to={to} className="aca-lb-who">
                    <MemberAvatar member={m} size={compact ? 28 : 32} />
                    <span className="aca-lb-name">{m.name || 'Miembro'}</span>
                  </Link>
                ) : (
                  <span className="aca-lb-who">
                    <MemberAvatar member={m} size={compact ? 28 : 32} />
                    <span className="aca-lb-name">{m.name || 'Miembro'}</span>
                  </span>
                )}
                <span className="aca-lb-points">{showPlus ? `+${Number(row?.points) || 0}` : Number(row?.points || 0).toLocaleString('es-CL')}</span>
              </li>
            )
          })}
        </ol>
      )}
      {myRank && !inList ? <p className="aca-lb-mine">Tu posición: #{myRank}</p> : null}
      {footer}
    </section>
  )
}

export { LeaderboardTable }
