import React from 'react'
import { CLP } from '../../../data.js'
import { Card, KpiGrid, List, ListRow, ProgressBar, EmptyState, Note } from '../../../components/panel/index.js'
import { useAdminLoad } from './adminApi.js'
import { LoadBlock } from './ui.jsx'

/* Resumen: las cifras de admin-stats. Se lee al entrar y con "Actualizar"
   del panel; nada de sondeo (cada lectura despierta Neon). */
export default function ResumenSection({ api, reloadKey, onGo }) {
  const stats = useAdminLoad(() => api.call('admin-stats'), [reloadKey])
  const s = stats.data || {}
  const m = s.members || {}
  const o = s.orders || {}
  const c = s.community || {}
  const up = s.uploads || {}
  const mail = s.email || {}
  const courses = Array.isArray(s.courses) ? s.courses : []

  return (
    <LoadBlock loading={stats.loading} error={stats.error} onRetry={stats.reload} rows={5}>
      <div className="pn-stack is-lg">
        <KpiGrid
          visible={4}
          storageKey="academy"
          items={[
            { id: 'active', icon: 'users', label: 'Miembros activos', value: num(m.active), hint: `+${num(m.new7)} esta semana · +${num(m.new30)} en 30 días`, onClick: onGo ? () => onGo('miembros') : undefined },
            { id: 'active7', icon: 'eye', label: 'Activos (7 días)', value: num(m.active7), hint: m.active ? `${pct(m.active7, m.active)}% de los miembros` : null },
            { id: 'revenue', icon: 'cash', label: 'Ventas 30 días', value: num(o.revenue30), format: CLP, hint: `${num(o.paid30)} ${o.paid30 === 1 ? 'pago' : 'pagos'}`, onClick: onGo ? () => onGo('pedidos') : undefined },
            { id: 'pending', icon: 'clock', label: 'Pagos pendientes', value: num(o.pending), hint: o.pending ? 'Revisa en Pedidos' : 'Nada pendiente', hintTone: o.pending ? 'down' : undefined },
            { id: 'posts', icon: 'megaphone', label: 'Publicaciones (7 días)', value: num(c.posts7), hint: `${num(c.comments7)} comentarios` },
            { id: 'uploads', icon: 'image', label: 'Imágenes del mes', value: num(up.month), hint: up.limit ? `de ${up.limit} disponibles` : null },
            { id: 'email', icon: 'mail', label: 'Correos hoy', value: num(mail.today), hint: mail.budget ? `tope diario ${mail.budget} (compartido con reservas)` : null },
          ]}
        />

        <Card title="Avance por curso" subtitle="Cuántos lo tienen y qué parte de las lecciones completaron en promedio" flush>
          {courses.length === 0 ? (
            <EmptyState
              compact
              icon="book"
              title="Todavía no hay cursos"
              text="Crea uno o carga los cursos iniciales desde la sección Cursos."
              action={onGo ? { label: 'Ir a Cursos', onClick: () => onGo('cursos') } : undefined}
            />
          ) : (
            <List>
              {courses.map((course) => (
                <ListRow
                  key={course.id}
                  title={course.title}
                  subtitle={`${num(course.owners)} ${course.owners === 1 ? 'alumno' : 'alumnos'} con acceso`}
                  trailing={(
                    <span className="pn-aca-progress">
                      <ProgressBar value={clampPct(course.completedPct)} label={`Avance de ${course.title}`} />
                      <b className="pn-num">{clampPct(course.completedPct)}%</b>
                    </span>
                  )}
                />
              ))}
            </List>
          )}
        </Card>

        <Note icon="info">
          "Abrir Academy" te deja entrar como propietario, sin contraseña: usa tu sesión del panel. Desde ahí se publica,
          se crean eventos y se modera la comunidad.
        </Note>
      </div>
    </LoadBlock>
  )
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const pct = (a, b) => (b > 0 ? Math.round((num(a) / num(b)) * 100) : 0)
const clampPct = (v) => Math.max(0, Math.min(100, Math.round(num(v))))
