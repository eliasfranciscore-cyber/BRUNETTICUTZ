import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/panel/index.js'
import PageState from '../../components/academy/PageState.jsx'
import RichText from '../../components/academy/RichText.jsx'
import GroupSettingsSheet from '../../components/academy/GroupSettingsSheet.jsx'
import { GROUP_CARD_KEY } from '../../components/academy/GroupCard.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { r } from '../../academy/routes.js'
import { ACADEMY_BRAND } from '../../academy/hostConfig.js'
import '../../styles/academy/miembros.css'

/* ============================================================
   Reglas del grupo (/academy/reglas). Salen de `group-card` (misma clave
   de caché que la GroupCard: una sola lectura si ya se vio la tarjeta).
   El staff las edita en Configuración → Reglas.
   ============================================================ */

export default function ReglasPage() {
  const { isAdmin, isOwner, refreshMe } = useAcademy()
  const admin = Boolean(isAdmin || isOwner)
  const { data, error, loading, refetch } = useAcademyQuery(GROUP_CARD_KEY, () => academyApi('group-card'))
  const [editOpen, setEditOpen] = useState(false)
  const rules = (Array.isArray(data?.rules) ? data.rules : [])
    .map((x) => ({ title: String(x?.title || '').trim(), body: String(x?.body || '').trim() }))
    .filter((x) => x.title)

  return (
    <div className="aca-rules-page">
      <section className="aca-mi-card aca-rules">
        <header className="aca-rules-head">
          <div>
            <h1>Reglas del grupo</h1>
            <p className="aca-mi-muted">{data?.name || ACADEMY_BRAND.name} · Para que la comunidad sea un buen lugar para aprender.</p>
          </div>
          {admin && <Button icon="pencil" onClick={() => setEditOpen(true)}>Editar reglas</Button>}
        </header>

        <PageState
          loading={loading && !data}
          error={!data ? error : null}
          onRetry={refetch}
          empty={Boolean(data) && rules.length === 0}
          emptyText={admin ? 'Todavía no hay reglas. Agrégalas con “Editar reglas”.' : 'Este grupo todavía no publica reglas.'}
        >
          <ol className="aca-rules-list">
            {rules.map((x, i) => (
              <li key={`${i}-${x.title}`}>
                <span className="aca-rules-num" aria-hidden="true">{i + 1}</span>
                <div>
                  <h2>{x.title}</h2>
                  {x.body && <RichText text={x.body} className="aca-rules-body" />}
                </div>
              </li>
            ))}
          </ol>
        </PageState>

        <p className="aca-rules-foot aca-mi-muted">
          Si ves algo que no respeta estas reglas, usa “Reportar” en la publicación, el comentario o el perfil. <Link className="aca-mi-link" to={r.path('/comunidad')}>Volver a la Comunidad</Link>
        </p>
      </section>

      {admin && (
        <GroupSettingsSheet
          open={editOpen}
          initialSection="reglas"
          onClose={() => setEditOpen(false)}
          onSaved={() => { refetch?.(); refreshMe?.() }}
        />
      )}
    </div>
  )
}
