import React, { useRef, useState } from 'react'
import { Icon } from '../../../academy/Icon.jsx'
import { IconButton } from '../../../components/panel/index.js'
import PageState from '../../../components/academy/PageState.jsx'
import MemberAvatar from '../../../components/academy/MemberAvatar.jsx'
import LeaderboardTable from '../../../components/academy/LeaderboardTable.jsx'
import GroupSettingsSheet from '../../../components/academy/GroupSettingsSheet.jsx'
import { cx, fmtDayTime } from '../../../components/academy/MemberCard.jsx'
import { useAcademy } from '../../../academy/context.js'
import { academyApi } from '../../../academy/api.js'
import { useAcademyQuery } from '../../../academy/useQuery.js'
import { useOutsideClose } from '../../../components/panel/hooks.js'
import '../../../styles/academy/miembros.css'

/* ============================================================
   Pestaña Clasificación (captura 4 de Skool): mi nivel y puntos, los 9
   niveles con el % de miembros en cada uno y qué desbloquean, y las tres
   tablas (7 días / 30 días / de todos los tiempos). Propietario y admins
   no aparecen en las tablas (regla de Skool), pero sí ven su nivel.
   ============================================================ */

const BOARDS = [
  { key: 'd7', title: 'Tabla de clasificación (7 días)', rank: 'rank7', plus: true },
  { key: 'd30', title: 'Tabla de clasificación (30 días)', rank: 'rank30', plus: true },
  { key: 'all', title: 'Tabla de clasificación (de todos los tiempos)', rank: 'rankAll', plus: false },
]

function unlockText(u) {
  const label = String(u?.label || '').trim()
  if (/^desbloquea/i.test(label)) return label
  if (u?.kind === 'chat') return `Desbloquea ${label || 'el chat con los miembros'}`
  if (u?.kind === 'publicar') return `Desbloquea ${label || 'publicar en la Comunidad'}`
  return `Desbloquea ${label || 'un curso'}`
}

function PointsHelp() {
  // Se abre con hover/foco (CSS) en escritorio y con un toque en el celular.
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  useOutsideClose(wrap, open, () => setOpen(false))
  return (
    <span className={cx('aca-lb-help', open && 'is-open')} ref={wrap}>
      <button
        type="button"
        className="aca-lb-help-btn"
        aria-label="¿Cómo se ganan puntos?"
        aria-expanded={open}
        aria-describedby="aca-lb-tip"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="info" size={16} />
      </button>
      <span className="aca-lb-tip" role="tooltip" id="aca-lb-tip">
        Ganas puntos cuando otros miembros le dan me gusta a tus publicaciones o comentarios. 1 me gusta = 1 punto. Tus propios me gusta no suman.
      </span>
    </span>
  )
}

export default function ClasificacionTab() {
  const { me, isAdmin, isOwner, levelName, refreshMe } = useAcademy()
  const admin = Boolean(isAdmin || isOwner)
  const { data, error, loading, refetch } = useAcademyQuery('mi:leaderboard', () => academyApi('leaderboard'))
  const [settingsOpen, setSettingsOpen] = useState(false)

  const mine = data?.me || {}
  const level = Number(mine.level) || Number(me?.level) || 1
  const levels = (Array.isArray(data?.levels) ? data.levels : []).slice().sort((a, b) => a.level - b.level)
  const boards = data?.boards || {}
  const allEmpty = BOARDS.every((b) => !(Array.isArray(boards[b.key]) && boards[b.key].length))
  const safeName = (n) => { try { return levelName?.(n) || '' } catch { return '' } }
  const myLevelName = mine.levelName || safeName(level)
  const toNext = Number(mine.pointsToNext) || 0
  const maxed = level >= 9

  return (
    <div className="aca-lb-page">
      <PageState loading={loading && !data} error={!data ? error : null} onRetry={refetch}>
        {data && (
          <>
            <section className="aca-lb-hero">
              {admin && (
                <IconButton
                  icon="settings"
                  label="Editar nombres de niveles"
                  className="aca-lb-gear"
                  plain
                  onClick={() => setSettingsOpen(true)}
                />
              )}

              <div className="aca-lb-me">
                <MemberAvatar member={{ ...(me || {}), level }} size={176} />
                <h2 className="aca-lb-me-name">{me?.name || 'Tú'}</h2>
                <p className="aca-lb-me-level">Nivel {level}{myLevelName ? ` · ${myLevelName}` : ''}</p>
                {maxed ? (
                  <p className="aca-lb-me-next">Llegaste al nivel máximo</p>
                ) : (
                  <p className="aca-lb-me-next">
                    <strong>{toNext.toLocaleString('es-CL')}</strong> {toNext === 1 ? 'punto' : 'puntos'} para subir de nivel
                    <PointsHelp />
                  </p>
                )}
                {typeof mine.points === 'number' && (
                  <p className="aca-lb-me-points">{mine.points.toLocaleString('es-CL')} {mine.points === 1 ? 'punto' : 'puntos'} en total</p>
                )}
              </div>

              <ol className="aca-lb-levels" aria-label="Niveles">
                {levels.map((lv) => {
                  const n = Number(lv.level)
                  const state = n === level ? 'is-current' : n < level ? 'is-reached' : 'is-locked'
                  const name = lv.name || safeName(n)
                  const unlocks = Array.isArray(lv.unlocks) ? lv.unlocks : []
                  return (
                    <li key={n} className={cx('aca-lb-level', state)}>
                      <span className="aca-lb-level-icon" aria-hidden="true">
                        {n <= level ? n : <Icon name="lock" size={18} />}
                      </span>
                      <span className="aca-lb-level-text">
                        <strong>Nivel {n}{name ? <span className="aca-lb-level-name"> · {name}</span> : null}</strong>
                        <small>{Number(lv.pct) || 0}% de los miembros</small>
                        {unlocks.map((u, i) => (
                          <small key={i} className="aca-lb-unlock">
                            <Icon name={n <= level ? 'check' : 'lock'} size={12} />{unlockText(u)}
                          </small>
                        ))}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </section>

            {allEmpty && (
              <p className="aca-lb-notice">Las tablas de clasificación se actualizarán cuando haya más actividad</p>
            )}

            <div className="aca-lb-boards">
              {BOARDS.map((b) => (
                <LeaderboardTable
                  key={b.key}
                  title={b.title}
                  rows={boards[b.key] || []}
                  showPlus={b.plus}
                  myRank={mine[b.rank] || null}
                />
              ))}
            </div>

            {data.updatedAt && (
              <p className="aca-lb-updated">Última actualización: {fmtDayTime(data.updatedAt)}</p>
            )}
          </>
        )}
      </PageState>

      {admin && (
        <GroupSettingsSheet
          open={settingsOpen}
          initialSection="niveles"
          onClose={() => setSettingsOpen(false)}
          onSaved={() => { refetch?.(); refreshMe?.() }}
        />
      )}
    </div>
  )
}
