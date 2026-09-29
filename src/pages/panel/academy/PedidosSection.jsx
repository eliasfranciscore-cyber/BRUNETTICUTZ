import React, { useState } from 'react'
import { CLP } from '../../../data.js'
import { r } from '../../../academy/routes.js'
import { Button, Card, Chip, DataTable, FilterChips, InlineAlert, Note, Toolbar } from '../../../components/panel/index.js'
import { errorText, useAdminLoad } from './adminApi.js'
import { LoadBlock, ORDER_STATUS, StatusChip, fmtWhenTime } from './ui.jsx'

/* Pedidos de cursos (academy_orders). "Verificar pago" le pregunta a
   Mercado Pago por la referencia (admin-verify-order → reconcileOrder): es lo
   que se aprieta cuando alguien dice "pagué y no me llegó nada". El webhook y
   el cron ya hacen lo mismo solos; esto es para no esperar. */

const FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'pagada', label: 'Pagados' },
  { value: 'revision', label: 'En revisión' },
  { value: 'reembolsada', label: 'Reembolsados' },
  { value: 'anulada', label: 'Anulados' },
]

const VERIFIABLE = new Set(['pendiente', 'revision', 'anulada'])
const MODALITY = { online: 'Online', presencial: 'Presencial' }
const titleOf = (v) => (v && typeof v === 'object' ? v.title || v.name || '' : v || '')

export default function PedidosSection({ api, ctx, reloadKey }) {
  const toast = ctx.pushToast
  const [status, setStatus] = useState('')
  const [verifying, setVerifying] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const orders = useAdminLoad(async () => {
    const data = await api.call('admin-orders', { query: { status, page: 1 } })
    const rows = data.orders || []
    return { rows, page: 1, pageSize: rows.length, hasMore: rows.length > 0 && rows.length >= 20 }
  }, [status, reloadKey])

  const rows = orders.data?.rows || []

  const loadMore = async () => {
    if (!orders.data || loadingMore) return
    setLoadingMore(true)
    try {
      const next = orders.data.page + 1
      const data = await api.call('admin-orders', { query: { status, page: next } })
      const incoming = data.orders || []
      orders.setData((d) => {
        const seen = new Set(d.rows.map((o) => o.ref))
        return { ...d, rows: [...d.rows, ...incoming.filter((o) => !seen.has(o.ref))], page: next, hasMore: incoming.length > 0 && incoming.length >= d.pageSize }
      })
    } catch (err) {
      toast('⚠', errorText(err), 5000)
    } finally {
      setLoadingMore(false)
    }
  }

  const verify = async (o) => {
    setVerifying(o.ref)
    try {
      const out = await api.call('admin-verify-order', { method: 'POST', body: { ref: o.ref } })
      const next = out.order || null
      if (next) orders.setData((d) => ({ ...d, rows: d.rows.map((r) => (r.ref === o.ref ? { ...r, ...next } : r)) }))
      const st = next?.status || o.status
      toast(st === 'pagada' ? '✓' : 'ℹ', st === 'pagada'
        ? 'Pago confirmado: el acceso quedó creado'
        : st === o.status ? `Sin cambios: Mercado Pago no tiene un pago aprobado para este pedido (${ORDER_STATUS[st]?.label || st})` : `Pedido ${ORDER_STATUS[st]?.label?.toLowerCase() || st}`, 6000)
    } catch (err) {
      toast('⚠', errorText(err), 6000)
    } finally {
      setVerifying(null)
    }
  }

  const verifyButton = (o) => (VERIFIABLE.has(o.status) ? (
    <Button size="sm" icon="refresh" loading={verifying === o.ref} disabled={Boolean(verifying) && verifying !== o.ref} onClick={(e) => { e?.stopPropagation?.(); verify(o) }}>
      Verificar pago
    </Button>
  ) : null)

  const buyer = (o) => (
    <span className="pn-aca-person is-text">
      <span>
        <b>{o.name}</b>
        <small>{o.email}</small>
        {o.emailMismatch && o.mpPayerEmail && <small className="pn-warn-text">Pagó con {o.mpPayerEmail}</small>}
      </span>
    </span>
  )

  const product = (o) => [titleOf(o.course), MODALITY[o.modality] || o.modality, titleOf(o.cohort)].filter(Boolean).join(' · ')

  return (
    <div className="pn-stack is-lg">
      <Toolbar>
        <FilterChips ariaLabel="Estado del pedido" value={status} onChange={setStatus} options={FILTERS} />
      </Toolbar>

      <LoadBlock
        loading={orders.loading}
        error={orders.error}
        onRetry={orders.reload}
        empty={rows.length === 0}
        emptyIcon="receipt"
        emptyTitle={status ? 'No hay pedidos con ese estado' : 'Todavía no hay pedidos'}
        emptyText={status ? 'Prueba con otro filtro.' : `Cuando alguien pague un curso en ${r.base()}, aparece acá.`}
      >
        {rows.some((o) => o.status === 'revision') && (
          <InlineAlert tone="warn" title="Hay pagos en revisión">
            Mercado Pago los aprobó pero algo no calzó (monto, moneda o modo de prueba). El acceso no se entregó: revisa el pago en
            Mercado Pago antes de dar el curso a mano o reembolsar.
          </InlineAlert>
        )}
        <Card flush>
          <DataTable
            ariaLabel="Pedidos de cursos"
            rows={rows}
            rowKey={(o) => o.ref}
            rowDim={(o) => o.status === 'anulada' || o.status === 'reembolsada'}
            columns={[
              { key: 'date', label: 'Fecha', nowrap: true, muted: true, render: (o) => fmtWhenTime(o.paidAt || o.createdAt) },
              { key: 'buyer', label: 'Comprador', render: buyer },
              { key: 'course', label: 'Curso', render: (o) => <span className="pn-aca-clamp">{product(o)}</span> },
              { key: 'amount', label: 'Monto', num: true, strong: true, render: (o) => CLP(o.amount) },
              { key: 'status', label: 'Estado', nowrap: true, render: (o) => <StatusChip map={ORDER_STATUS} value={o.status} /> },
              { key: 'ref', label: 'Referencia', muted: true, render: (o) => <span className="pn-aca-ref" title={o.ref}>{String(o.ref || '').slice(0, 12)}…{o.mpPaymentId ? <small>MP {o.mpPaymentId}</small> : null}</span> },
              { key: 'actions', label: '', render: verifyButton },
            ]}
            mobile={(o) => ({
              title: `${o.name} · ${CLP(o.amount)}`,
              subtitle: `${product(o)} · ${fmtWhenTime(o.paidAt || o.createdAt)}${o.emailMismatch && o.mpPayerEmail ? ` · pagó con ${o.mpPayerEmail}` : ''}`,
              trailing: <StatusChip map={ORDER_STATUS} value={o.status} />,
              actions: verifyButton(o),
              chevron: false,
            })}
          />
        </Card>
        {orders.data?.hasMore && (
          <div className="pn-between">
            <span className="pn-muted">{rows.length} pedidos</span>
            <Button variant="plain" onClick={loadMore} loading={loadingMore} iconRight="chevronDown">Cargar más</Button>
          </div>
        )}
        <Note>
          Los reembolsos se hacen en Mercado Pago; cuando MP avisa, el acceso se revoca solo.
          {rows.some((o) => o.emailMismatch) && <> <Chip tone="warn">Correo distinto</Chip> = el correo con que pagó en MP no es el que escribió en el formulario; la cuenta se creó con el del formulario.</>}
        </Note>
      </LoadBlock>
    </div>
  )
}
