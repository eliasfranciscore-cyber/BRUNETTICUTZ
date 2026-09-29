import React, { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Skeleton, Button } from '../panel/index.js'
import MemberAvatar from './MemberAvatar.jsx'
import RichText from './RichText.jsx'
import GroupSettingsSheet from './GroupSettingsSheet.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { safeUrl, isImageUrl } from '../../academy/url.js'
import { uploadImage } from '../../academy/upload.js'
import { r } from '../../academy/routes.js'
import { ACADEMY_BRAND } from '../../academy/hostConfig.js'
import { EXTERNAL_REL, cx, errorText, plural } from './MemberCard.jsx'
import '../../styles/academy/miembros.css'

/* ============================================================
   Tarjeta del grupo (columna derecha de Miembros, Comunidad y Acerca de),
   igual a la de Skool: portada, nombre, URL, descripción, contadores
   Miembros / En línea / Administradores, fila de avatares, enlaces y
   CONFIGURACIÓN para el staff. Pide `group-card` ella misma; la clave de
   caché es propia para no pisar la de otra pestaña con otra forma.
   ============================================================ */

export const GROUP_CARD_KEY = 'mi:group-card'

export default function GroupCard({ compact = false }) {
  const { isAdmin, isOwner, toast, refreshMe } = useAcademy()
  const admin = Boolean(isAdmin || isOwner)
  const { data, error, loading, refetch, setData } = useAcademyQuery(GROUP_CARD_KEY, () => academyApi('group-card'))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const pickCover = () => { if (!uploading) fileRef.current?.click() }
  const onCoverFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const up = await uploadImage('portada', file)
      const url = up?.url
      if (!url || !isImageUrl(url)) throw new Error('La imagen no se pudo subir.')
      await academyApi('admin-settings', { method: 'POST', body: { group: { coverUrl: url } } })
      if (data) setData?.({ ...data, coverUrl: url })
      refetch?.()
      toast?.('Portada actualizada')
    } catch (err) {
      toast?.(errorText(err, 'No se pudo subir la portada'), 'error')
    } finally {
      setUploading(false)
    }
  }

  if (loading && !data) {
    return (
      <section className={cx('aca-gcard', compact && 'is-compact')} aria-busy="true" aria-label="Cargando grupo">
        <div className="aca-gcard-cover is-skel"><Skeleton height="100%" radius={0} /></div>
        <div className="aca-gcard-body">
          <Skeleton height={20} width="70%" />
          <Skeleton height={12} width="45%" />
          <Skeleton height={48} />
        </div>
      </section>
    )
  }

  if (!data) {
    return (
      <section className={cx('aca-gcard', compact && 'is-compact')}>
        <div className="aca-gcard-body aca-gcard-error">
          <p>No se pudo cargar el grupo.</p>
          <Button size="sm" icon="refresh" onClick={refetch}>Reintentar</Button>
          {error?.message && <small className="aca-mi-muted">{errorText(error)}</small>}
        </div>
      </section>
    )
  }

  const g = data
  const cover = g.coverUrl && isImageUrl(g.coverUrl) ? g.coverUrl : null
  const counts = g.counts || {}
  const avatars = Array.isArray(g.avatars) ? g.avatars.slice(0, 8) : []
  const links = (Array.isArray(g.links) ? g.links : [])
    .map((l) => ({ title: String(l?.title || '').trim(), href: safeUrl(l?.url) }))
    .filter((l) => l.href && l.title)
    .slice(0, 5)
  const color = /^#[0-9a-f]{6}$/i.test(g.color || '') ? g.color : null

  return (
    <section className={cx('aca-gcard', compact && 'is-compact')} aria-label={g.name || 'Grupo'}>
      <div className={cx('aca-gcard-cover', !cover && 'is-empty')} style={!cover && color ? { '--gc': color } : undefined}>
        {cover ? (
          <img src={cover} alt="" loading="lazy" decoding="async" />
        ) : admin ? null : (
          <span className="aca-gcard-initials" aria-hidden="true">{String(g.initials || ACADEMY_BRAND.initials).slice(0, 3)}</span>
        )}
        {admin && (
          <button
            type="button"
            className={cx('aca-gcard-upload', cover && 'is-over')}
            onClick={pickCover}
            disabled={uploading}
            aria-label={cover ? 'Cambiar foto de portada' : 'Subir foto de portada'}
          >
            {cover ? <Icon name="camera" size={16} /> : null}
            <span>{uploading ? 'Subiendo…' : cover ? 'Cambiar portada' : 'Subir foto de portada'}</span>
          </button>
        )}
        {admin && (
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onCoverFile} />
        )}
      </div>

      <div className="aca-gcard-body">
        <h2 className="aca-gcard-name">{g.name || ACADEMY_BRAND.name}</h2>
        <p className="aca-gcard-url">{g.url || ACADEMY_BRAND.groupUrlLabel}</p>

        {g.description ? (
          <RichText text={g.description} className={cx('aca-gcard-desc', compact && 'is-clamp')} />
        ) : admin ? (
          <p className="aca-gcard-desc is-placeholder">Agrega la descripción de tu grupo aquí haciendo clic en el botón “Configuración”.</p>
        ) : null}

        {links.length > 0 && !compact && (
          <ul className="aca-gcard-links">
            {links.map((l) => (
              <li key={l.href + l.title}>
                <a href={l.href} target="_blank" rel={EXTERNAL_REL}>
                  <Icon name="link" size={15} /><span>{l.title}</span>
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className="aca-gcard-stats">
          <div>
            <strong>{Number(counts.members) || 0}</strong>
            <span>{plural(counts.members, 'Miembro', 'Miembros')}</span>
          </div>
          <div>
            <strong>{Number(counts.online) || 0}</strong>
            <span>En línea</span>
          </div>
          <div>
            <strong>{Number(counts.admins) || 0}</strong>
            <span>{plural(counts.admins, 'Administrador', 'Administradores')}</span>
          </div>
        </div>

        {avatars.length > 0 && (
          <div className="aca-gcard-avatars">
            {avatars.map((m) => (m.handle ? (
              <Link key={m.id} to={r.profile(m.handle)} className="aca-gcard-avatar" title={m.name}>
                <MemberAvatar member={m} size={32} showLevel={false} />
              </Link>
            ) : (
              <span key={m.id} className="aca-gcard-avatar" title={m.name}>
                <MemberAvatar member={m} size={32} showLevel={false} />
              </span>
            )))}
          </div>
        )}

        {admin && (
          <button type="button" className="aca-gcard-config" onClick={() => setSettingsOpen(true)}>
            Configuración
          </button>
        )}
      </div>

      {admin && (
        <GroupSettingsSheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => { refetch?.(); refreshMe?.() }}
        />
      )}
    </section>
  )
}

export { GroupCard }
