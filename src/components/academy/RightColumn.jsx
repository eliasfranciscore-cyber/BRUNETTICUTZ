import React from 'react'
import { Link } from 'react-router-dom'
import MemberAvatar from './MemberAvatar.jsx'
import GroupCard from './GroupCard.jsx'
import PageState from './PageState.jsx'
import { useAcademy } from '../../academy/context.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { academyApi } from '../../academy/api.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/comunidad.css'

/* ============================================================
   Columna derecha de Comunidad (solo escritorio, como Skool): la tarjeta
   del grupo (GroupCard compacta, de FE-MIEMBROS, que se carga sola) y
   "Clasificación (30 días)" con los 5 primeros de `leaderboard` +
   "Ver todas las clasificaciones". La tabla sale de la misma clave de
   caché que usa la pestaña Clasificación, así que abrirla después no
   vuelve a pedirla. ComunidadTab solo monta esto en pantallas anchas:
   en el celular no se hace ninguna de estas lecturas.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

function LeaderboardMini() {
  const q = useAcademyQuery('leaderboard', () => academyApi('leaderboard'), { refetchOnFocus: false })
  const rows = (Array.isArray(q.data?.boards?.d30) ? q.data.boards.d30 : []).filter((x) => x && x.member).slice(0, 5)
  return (
    <section className="aca-cm-card aca-cm-side-board" aria-labelledby="aca-cm-side-board-title">
      <h2 className="aca-cm-side-title" id="aca-cm-side-board-title">Clasificación (30 días)</h2>
      <PageState
        loading={q.loading && !q.data}
        error={!q.data ? q.error : null}
        onRetry={q.refetch}
        empty={Boolean(q.data) && rows.length === 0}
        emptyText="Aún no hay actividad"
      >
        <ol className="aca-cm-board">
          {rows.map((row, i) => {
            const rank = Number(row.rank) || i + 1
            const m = row.member
            const who = (
              <>
                <MemberAvatar member={m} size={32} />
                <span className="aca-cm-board-name">{m.name || 'Miembro'}</span>
              </>
            )
            return (
              <li key={m.id ?? rank} className="aca-cm-board-row">
                <span className={cx('aca-cm-board-rank', rank <= 3 && `is-${rank}`)} aria-label={`Puesto ${rank}`}>{rank}</span>
                {m.handle
                  ? <Link to={r.profile(m.handle)} className="aca-cm-board-who">{who}</Link>
                  : <span className="aca-cm-board-who">{who}</span>}
                <span className="aca-cm-board-pts">+{Number(row.points) || 0}</span>
              </li>
            )
          })}
        </ol>
      </PageState>
      <Link to={r.path('/clasificacion')} className="aca-cm-side-link">Ver todas las clasificaciones</Link>
    </section>
  )
}

export default function RightColumn() {
  const { group } = useAcademy()
  const showBoard = !(group?.tabs && group.tabs.clasificacion === false)
  return (
    <aside className="aca-cm-side" aria-label="Sobre la Academy">
      <GroupCard compact />
      {showBoard && <LeaderboardMini />}
    </aside>
  )
}
