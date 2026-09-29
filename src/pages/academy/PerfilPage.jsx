import React, { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Button, ActionMenu, ConfirmDialog, Sheet, Field, EmptyState, ProgressBar, Chip } from '../../components/panel/index.js'
import PageState from '../../components/academy/PageState.jsx'
import MemberAvatar from '../../components/academy/MemberAvatar.jsx'
import RichText from '../../components/academy/RichText.jsx'
import ActivityHeatmap from '../../components/academy/ActivityHeatmap.jsx'
import {
  FollowButton, Presence, memberLinks, roleTag, fmtDay, sinceText, errorText, EXTERNAL_REL, cx,
} from '../../components/academy/MemberCard.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { levelFor } from '../../academy/levels.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/miembros.css'

/* ============================================================
   Perfil público de un miembro: /academy/perfil/:handle (modo `member`).
   Nunca muestra correo ni teléfono (MemberPublic). El mapa de actividad y
   el "Activo hace…" respetan la privacidad que el miembro eligió: si los
   ocultó, el servidor no los manda.
   ============================================================ */

function RecentPost({ post }) {
  const cat = post.category
  return (
    <li>
      <Link to={r.post(post.id)} className="aca-profile-post">
        <span className="aca-profile-post-meta">
          {cat ? <span>{cat.emoji ? `${cat.emoji} ` : ''}{cat.name}</span> : null}
          {post.createdAt ? <span>{sinceText(post.createdAt)}</span> : null}
        </span>
        <strong className="aca-profile-post-title">{post.title}</strong>
        {post.excerpt && <span className="aca-profile-post-excerpt">{post.excerpt}</span>}
        <span className="aca-profile-post-stats">
          <span><Icon name="heart" size={14} />{Number(post.likeCount) || 0}</span>
          <span><Icon name="message" size={14} />{Number(post.commentCount) || 0}</span>
        </span>
      </Link>
    </li>
  )
}

export default function PerfilPage() {
  const { handle = '' } = useParams()
  const { openChat, toast, levelName } = useAcademy()
  const key = `mi:member:${handle}`
  const { data, error, loading, refetch, setData } = useAcademyQuery(
    key,
    () => academyApi('member', { query: { handle } }),
    { deps: [handle], enabled: Boolean(handle) },
  )
  const [blockOpen, setBlockOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportText, setReportText] = useState('')
  const [busy, setBusy] = useState('')

  if (error && error.status === 404 && !data) {
    return (
      <div className="aca-profile-missing">
        <EmptyState icon="user" title="No encontramos este perfil" text="Puede que el usuario haya cambiado o que la cuenta ya no exista." />
        <Link className="aca-mi-link" to={r.path('/miembros')}>Ver miembros</Link>
      </div>
    )
  }

  const m = data?.member
  const stats = data?.stats || {}
  const isMe = Boolean(data?.isMe)
  const safeName = (n) => { try { return levelName?.(n) || '' } catch { return '' } }

  const onFollowChange = (following) => {
    if (!data) return
    setData?.({
      ...data,
      isFollowing: following,
      stats: { ...stats, followers: Math.max(0, (Number(stats.followers) || 0) + (following ? 1 : -1)) },
    })
  }

  const copyLink = async () => {
    const url = `${window.location.origin}${r.profile(m.handle)}`
    try {
      await navigator.clipboard.writeText(url)
      toast?.('Enlace copiado')
    } catch {
      toast?.('No se pudo copiar el enlace', 'error')
    }
  }

  const block = async () => {
    setBusy('block')
    try {
      await academyApi('block', { method: 'POST', body: { memberId: m.id, block: true } })
      toast?.(`Bloqueaste a ${m.name}. Ya no puede escribirte.`)
      setBlockOpen(false)
    } catch (e) {
      toast?.(errorText(e, 'No se pudo bloquear'), 'error')
    } finally {
      setBusy('')
    }
  }

  const report = async () => {
    setBusy('report')
    try {
      await academyApi('report', { method: 'POST', body: { targetType: 'miembro', targetId: m.id, reason: reportText.trim().slice(0, 500) } })
      toast?.('Gracias. El equipo revisará el reporte.')
      setReportOpen(false)
      setReportText('')
    } catch (e) {
      toast?.(errorText(e, 'No se pudo enviar el reporte'), 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="aca-profile-page">
      <PageState loading={loading && !data} error={!data ? error : null} onRetry={refetch}>
        {m && (() => {
          const info = levelFor(Number(m.points) || 0) || {}
          const level = Number(m.level) || info.level || 1
          const lvName = safeName(level)
          const toNext = Number(info.pointsToNext) || 0
          const progress = Math.max(0, Math.min(1, Number(info.progress) || 0))
          const links = memberLinks(m.links)
          const tag = roleTag(m.role)
          const recent = Array.isArray(data.recent) ? data.recent : []
          const activity = data.activity && Array.isArray(data.activity.counts) && data.activity.counts.length ? data.activity : null
          const posts = Number(stats.posts) || 0
          const comments = Number(stats.comments) || 0

          return (
            <div className="aca-profile">
              <aside className="aca-profile-card">
                <div className="aca-profile-avatar">
                  <MemberAvatar member={m} size={152} />
                </div>
                <h1 className="aca-profile-name">{m.name}</h1>
                {tag && <p className="aca-mi-role is-block">{tag}</p>}
                <p className="aca-profile-handle">@{m.handle}</p>
                <Presence member={m} className="aca-profile-presence" />
                {m.bio && <RichText text={m.bio} className="aca-profile-bio" />}

                <div className="aca-profile-level">
                  <div className="aca-profile-level-top">
                    <span>Nivel {level}{lvName ? ` · ${lvName}` : ''}</span>
                    <span>{(Number(m.points) || 0).toLocaleString('es-CL')} pts</span>
                  </div>
                  <ProgressBar value={level >= 9 ? 100 : progress * 100} label="Progreso al siguiente nivel" />
                  <small>
                    {level >= 9 ? 'Nivel máximo' : `${toNext.toLocaleString('es-CL')} ${toNext === 1 ? 'punto' : 'puntos'} para subir de nivel`}
                  </small>
                </div>

                <div className="aca-profile-actions">
                  {isMe ? (
                    <Link to={r.path('/ajustes')} className="aca-mi-btnlink">
                      <Icon name="pencil" size={16} />Editar perfil
                    </Link>
                  ) : (
                    <>
                      <Button
                        icon="message"
                        variant="secondary"
                        disabled={data.canChat === false}
                        title={data.canChat === false ? 'El chat con este miembro no está disponible' : undefined}
                        onClick={() => openChat?.({ memberId: m.id })}
                      >
                        Chat
                      </Button>
                      <FollowButton memberId={m.id} initial={Boolean(data.isFollowing)} size="md" onChange={onFollowChange} />
                      <ActionMenu
                        label="Más opciones"
                        items={[
                          { label: 'Copiar enlace del perfil', icon: 'link', onClick: copyLink },
                          { label: 'Reportar', icon: 'flag', onClick: () => setReportOpen(true) },
                          { label: 'Bloquear', icon: 'shield', danger: true, onClick: () => setBlockOpen(true) },
                        ]}
                      />
                    </>
                  )}
                </div>
                {!isMe && data.canChat === false && (
                  <p className="aca-mi-hint">El chat con este miembro no está disponible por ahora.</p>
                )}

                <dl className="aca-profile-stats">
                  <div><dt>Publicaciones</dt><dd>{posts.toLocaleString('es-CL')}</dd></div>
                  <div><dt>Comentarios</dt><dd>{comments.toLocaleString('es-CL')}</dd></div>
                  <div><dt>Seguidores</dt><dd>{(Number(stats.followers) || 0).toLocaleString('es-CL')}</dd></div>
                  <div><dt>Siguiendo</dt><dd>{(Number(stats.following) || 0).toLocaleString('es-CL')}</dd></div>
                </dl>

                <ul className="aca-profile-facts">
                  <li><Icon name="heart" size={16} />{(Number(stats.likesReceived) || 0).toLocaleString('es-CL')} me gusta recibidos</li>
                  {m.location && <li><Icon name="pin" size={16} />{m.location}</li>}
                  {m.joinedAt && <li><Icon name="calendar" size={16} />Se unió el {fmtDay(m.joinedAt)}</li>}
                  <li><Icon name="refresh" size={16} />Acceso de por vida</li>
                </ul>

                {links.length > 0 && (
                  <ul className="aca-profile-links">
                    {links.map((l) => (
                      <li key={l.key}>
                        <a href={l.href} target="_blank" rel={EXTERNAL_REL}>
                          <Icon name={l.icon} size={16} /><span>{l.label}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>

              <div className="aca-profile-main">
                <section className="aca-mi-card">
                  <header className="aca-mi-card-head">
                    <h2>Actividad</h2>
                    {isMe && <Chip tone="muted">Solo cuenta lo que haces en la Academy</Chip>}
                  </header>
                  {activity ? (
                    <ActivityHeatmap startDate={activity.startDate} counts={activity.counts} />
                  ) : (
                    <p className="aca-mi-muted">{isMe ? 'Aún no hay actividad.' : `${m.name.split(' ')[0]} ocultó su actividad.`}</p>
                  )}
                </section>

                <section className="aca-mi-card">
                  <header className="aca-mi-card-head">
                    <h2>Publicaciones recientes</h2>
                  </header>
                  {recent.length ? (
                    <ul className="aca-profile-posts">
                      {recent.map((p) => <RecentPost key={p.id} post={p} />)}
                    </ul>
                  ) : (
                    <p className="aca-mi-muted">{isMe ? 'Todavía no publicas nada. ¡Preséntate en la Comunidad!' : 'Todavía no hay publicaciones.'}</p>
                  )}
                </section>
              </div>
            </div>
          )
        })()}
      </PageState>

      {m && (
        <>
          <ConfirmDialog
            open={blockOpen}
            tone="danger"
            title={`¿Bloquear a ${m.name}?`}
            message="No podrá enviarte mensajes ni tú a esa persona. Puedes desbloquearla en Ajustes → Chat."
            confirmLabel="Bloquear"
            busy={busy === 'block'}
            onCancel={() => setBlockOpen(false)}
            onConfirm={block}
          />
          <Sheet
            open={reportOpen}
            onClose={() => setReportOpen(false)}
            title={`Reportar a ${m.name}`}
            icon="flag"
            size="sm"
            footer={(
              <>
                <Button variant="plain" onClick={() => setReportOpen(false)} disabled={busy === 'report'}>Cancelar</Button>
                <Button variant="primary" loading={busy === 'report'} onClick={report}>Enviar reporte</Button>
              </>
            )}
          >
            <Field label="¿Qué pasó?" optional hint="Solo el equipo de la Academy ve los reportes." htmlFor="aca-report-text">
              <textarea id="aca-report-text" className="aca-mi-input" rows={4} maxLength={500} value={reportText} onChange={(e) => setReportText(e.target.value)} placeholder="Ej.: me escribe spam por chat" />
            </Field>
          </Sheet>
        </>
      )}
      <span className={cx('aca-sr-only')} aria-live="polite">{loading && data ? 'Actualizando perfil' : ''}</span>
    </div>
  )
}
