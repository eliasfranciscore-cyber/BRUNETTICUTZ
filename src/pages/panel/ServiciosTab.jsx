import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/ui.jsx'
import { CAT_LABEL, CLP, fmtDate } from '../../data.js'
import {
  ModuleHeader, Card, List, ListRow, Chip, Button, ActionMenu, Sheet, ConfirmDialog,
  Field, ToggleRow, FilterChips, EmptyState, SectionLabel, Note, useIsPhone,
} from '../../components/panel/index.js'
import { FEATURES } from '../../features.js'
import { MAX_LEAD_DAYS, blocksToMin, getSvcIcon, isoDate, minToBlocks } from './shared.jsx'
import '../../styles/panel/servicios.css'

/* Pestaña «servicios» del panel interno.
   Antes: botón dorado a ancho completo + una grilla de tarjetas igual en
   celular y escritorio + un cajón hecho a mano para editar (que escribía en
   `services[]` con cada tecla, así que cerrar sin guardar dejaba el cambio a
   medias en la lista) + un overlay `position:fixed` distinto para crear y otro
   para confirmar el borrado, montados desde Dashboard.
   Ahora: un encabezado con UNA acción primaria, filas agrupadas por categoría
   en el celular / tarjetas de alto parejo en escritorio, una sola
   ServiceSheet para crear y editar, y el borrado con ConfirmDialog. Todo vive
   acá, incluidos la hoja y el borrado que antes montaba Dashboard aparte. */

/* Las categorías son las de la web pública (CAT_LABEL de data.js), para que
   el panel diga lo mismo que ve el cliente: "Brunetti Experience", no
   "Premium". */
const CATEGORY_ORDER = ['general', 'premium', 'quimico']

function catLabel(cat) {
  if (CAT_LABEL[cat]) return CAT_LABEL[cat]
  if (!cat) return 'Otros'
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}

/* Un servicio de un solo día cuya fecha ya pasó: la web pública ya no lo
   muestra aunque siga "Publicado". Fechas 'YYYY-MM-DD' locales, comparables
   como texto. */
const isExpired = (svc, today) => Boolean(FEATURES.singleDay && svc.onlyOnDate && svc.onlyOnDate < today)

// La fecha de "Día único" se formatea acá con el mismo fmtDate/'dm' del
// resto del panel ("29 sep"), no con el `dayLabel` de Dashboard.jsx, que usa
// Intl con mes 'short' en es-CL y da "sept".
function svcMeta(svc, showCat) {
  const parts = [`${svc.min} min`]
  if (showCat) parts.push(catLabel(svc.cat))
  if (FEATURES.singleDay && svc.onlyOnDate) parts.push(`solo el ${fmtDate(svc.onlyOnDate, 'dm')}`)
  if (FEATURES.serviceLoyalty && svc.loyaltyEligible === false) parts.push('sin estrella')
  return parts.join(' · ')
}

function groupByCategory(services) {
  const groups = new Map()
  for (const svc of services) {
    const cat = svc.cat || 'general'
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat).push(svc)
  }
  const known = CATEGORY_ORDER.filter((c) => groups.has(c))
  const rest = [...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c))
  return [...known, ...rest].map((cat) => ({ cat, label: catLabel(cat), items: groups.get(cat) }))
}

function StatusChip({ svc, today }) {
  if (svc.active === false) return <Chip tone="muted">Oculto</Chip>
  if (isExpired(svc, today)) return <Chip tone="muted" icon="calendar">Ya pasó</Chip>
  const featured = FEATURES.featuredServices && svc.featured
  return <Chip tone="ok" icon={featured ? 'star' : undefined} title={featured ? 'Destacado' : undefined}>Publicado</Chip>
}

/* Celular: filas dentro de una Card por categoría. Escritorio: tarjetas de
   alto parejo (pn-svc-grid / pn-svc-card, ver servicios.css). */
function ServiceGroup({ items, showCat, today, onOpen }) {
  const isPhone = useIsPhone()
  if (isPhone) {
    return (
      <Card flush>
        <List>
          {items.map((svc) => (
            <ListRow
              key={svc.id}
              lead={<span className="pn-svc-ic"><Icon name={getSvcIcon(svc)} size={18} /></span>}
              title={svc.name}
              titleWrap
              subtitle={svcMeta(svc, showCat)}
              subtitleWrap
              value={CLP(svc.price)}
              trailing={<StatusChip svc={svc} today={today} />}
              dim={svc.active === false}
              chevron
              onClick={() => onOpen(svc.id)}
            />
          ))}
        </List>
      </Card>
    )
  }
  return (
    <div className="pn-svc-grid">
      {items.map((svc) => (
        <button
          key={svc.id}
          type="button"
          className={['pn-svc-card', svc.active === false && 'is-off'].filter(Boolean).join(' ')}
          onClick={() => onOpen(svc.id)}
        >
          <span className="pn-svc-card-top">
            <span className="pn-svc-ic"><Icon name={getSvcIcon(svc)} size={18} /></span>
            <StatusChip svc={svc} today={today} />
          </span>
          <span className="pn-svc-card-name">{svc.name}</span>
          <span className="pn-svc-card-meta">{svcMeta(svc, showCat)}</span>
          <span className="pn-svc-card-price">{CLP(svc.price)}</span>
        </button>
      ))}
    </div>
  )
}

/* Crear y editar comparten esta hoja.
   - Crear lee/escribe ctx.serviceDraft (Dashboard.saveService, sin id, usa
     ese borrador y lo limpia al terminar), así que un servicio a medio
     escribir sobrevive a cerrar y volver a abrir la hoja.
   - Editar usa un borrador LOCAL que recién arma el objeto completo al
     guardar: cerrar sin guardar no toca la lista compartida. El borrador se
     reinicia al abrir (o al cambiar de servicio) durante el render — el
     patrón de React para "estado que depende de una prop" —, no en un
     efecto: con un efecto, la hoja mostraría un cuadro con lo que se dejó
     sin guardar la vez anterior antes de volver al valor real. */
function ServiceSheet({ open, isEdit, service, admin, draft, onDraftChange, onClose, onSave, onRequestDelete, today }) {
  const [local, setLocal] = useState(null)
  const [openedFor, setOpenedFor] = useState(null)
  const sessionKey = open ? (isEdit ? `edit:${service?.id}` : 'new') : null
  if (sessionKey !== openedFor) {
    setOpenedFor(sessionKey)
    // Al cerrar no se limpia: la hoja sigue mostrando lo mismo mientras se va.
    if (sessionKey) setLocal(isEdit && service ? { ...service } : null)
  }

  const value = (isEdit ? (local || service) : draft) || {}
  const patch = (fields) => {
    if (isEdit) setLocal((d) => ({ ...(d || service || {}), ...fields }))
    else onDraftChange((d) => ({ ...d, ...fields }))
  }

  const blocks = minToBlocks(value.min ?? 60)
  const changeBlocks = (delta) => {
    const next = Math.max(1, blocks + delta)
    patch({ min: String(blocksToMin(next)) })
  }

  const canSubmit = Boolean(String(value.name || '').trim()) && Number(value.price) > 0 && Number(value.min) > 0
  const published = value.active !== false
  const loyaltyOn = value.loyaltyEligible !== false
  // El input muestra "" cuando no hay fecha, pero lo que se guarda (borrador
  // y PATCH) es null, nunca "": es el valor que devuelve la API y el único que
  // cualquier cliente lee como "todos los días" (el mock de desarrollo, por
  // ejemplo, rechaza "" con un 400).
  const onlyOnDate = value.onlyOnDate || ''
  const datePassed = Boolean(onlyOnDate && today && onlyOnDate < today)
  const cat = value.cat || 'general'
  const catOptions = CAT_LABEL[cat] ? Object.keys(CAT_LABEL) : [...Object.keys(CAT_LABEL), cat]

  const submit = () => {
    if (!canSubmit) return
    if (isEdit) onSave({ ...service, ...local, id: service.id, ...('onlyOnDate' in (local || {}) ? { onlyOnDate: local.onlyOnDate || null } : {}) })
    else onSave()
    onClose()
  }

  const showToggles = isEdit || FEATURES.featuredServices || FEATURES.serviceLoyalty

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar servicio' : 'Nuevo servicio'}
      subtitle={isEdit ? undefined : 'Se publica al instante en brunetticutz.cl'}
      icon={isEdit && service ? getSvcIcon(service) : 'scissors'}
      size="md"
      headActions={isEdit && admin && service ? (
        <ActionMenu
          title="Servicio"
          items={[{ label: 'Eliminar', icon: 'trash', danger: true, onClick: () => onRequestDelete(service) }]}
        />
      ) : undefined}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {isEdit ? 'Guardar' : 'Crear servicio'}
          </Button>
        </>
      )}
    >
      <div className="pn-stack is-lg">
        <Field label="Nombre">
          <input className="input" placeholder="Ej: Corte + perfilado de barba" value={value.name || ''} onChange={(e) => patch({ name: e.target.value })} />
        </Field>

        <div className="pn-form-row">
          <Field label="Precio">
            <input className="input" inputMode="numeric" placeholder="CLP" value={value.price ?? ''} onChange={(e) => patch({ price: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="Categoría">
            <select className="input" value={cat} onChange={(e) => patch({ cat: e.target.value })}>
              {catOptions.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Bloquea en agenda" hint={`1 bloque = 1 hora de agenda. Duración real guardada: ${value.min || 0} min.`}>
          <div className="pn-svc-blocks">
            <Button variant="secondary" icon="minus" aria-label="Menos bloques" onClick={() => changeBlocks(-1)} disabled={blocks <= 1} />
            <b>{blocks} {blocks === 1 ? 'bloque' : 'bloques'}</b>
            <Button variant="secondary" icon="plus" aria-label="Más bloques" onClick={() => changeBlocks(1)} />
          </div>
        </Field>

        <Field label="Descripción" hint="Se muestra al elegir este servicio al reservar y en los servicios del home.">
          <input className="input" placeholder="Qué incluye, en una línea" value={value.desc || ''} onChange={(e) => patch({ desc: e.target.value })} />
        </Field>

        {FEATURES.singleDay && (
          <Field
            label="Día único"
            optional
            hint={`Vacío = se puede reservar cualquier día. Con una fecha, el servicio se ofrece solo ese día y solo en brunetticutz.cl (sin el límite de ${MAX_LEAD_DAYS} días), y deja de mostrarse cuando pasa.`}
          >
            <div className="pn-svc-date">
              <input className="input" type="date" value={onlyOnDate} min={isEdit ? undefined : today} onChange={(e) => patch({ onlyOnDate: e.target.value || null })} />
              {onlyOnDate && (
                <Button variant="plain" size="sm" icon="close" onClick={() => patch({ onlyOnDate: null })}>Quitar</Button>
              )}
            </div>
          </Field>
        )}
        {FEATURES.singleDay && datePassed && (
          <Note icon="alert">Esa fecha ya pasó: el servicio no se muestra al reservar hasta que le pongas otra o la quites.</Note>
        )}

        {showToggles && (
          <div className="pn-card is-flush pn-svc-toggles">
            <List>
              {isEdit && (
                <ToggleRow
                  title="Publicado"
                  description={published ? 'Visible al reservar' : 'Oculto: no aparece al reservar'}
                  checked={published}
                  onChange={(v) => patch({ active: v })}
                />
              )}
              {FEATURES.featuredServices && (
                <ToggleRow
                  title="Destacado"
                  description="Sale en «Los más pedidos», arriba de las categorías al reservar, y primero en los servicios del home."
                  checked={Boolean(value.featured)}
                  onChange={(v) => patch({ featured: v })}
                />
              )}
              {FEATURES.serviceLoyalty && (
                <ToggleRow
                  title="Suma estrella"
                  description="Si está apagado, esta atención no suma estrella en la tarjeta de fidelidad."
                  checked={loyaltyOn}
                  onChange={(v) => patch({ loyaltyEligible: v })}
                />
              )}
            </List>
          </div>
        )}
      </div>
    </Sheet>
  )
}

export default function ServiciosTab({ ctx }) {
  const {
    admin, deleteService, deleteSvc, editSvcId, saveService,
    serviceDraft, serviceOpen, services, setDeleteSvc, setEditSvcId,
    setServiceDraft, setServiceOpen,
  } = ctx

  const [catFilter, setCatFilter] = useState('all')
  const today = isoDate(new Date())
  const list = useMemo(() => services || [], [services])

  const groups = useMemo(() => groupByCategory(list), [list])
  const activeCount = list.filter((s) => s.active !== false).length
  const liveEditing = editSvcId != null ? list.find((s) => s.id === editSvcId) || null : null
  const sheetOpen = Boolean(serviceOpen) || Boolean(liveEditing)

  // El objetivo de la hoja (crear vs. editar-tal-servicio) se congela mientras
  // está abierta: si se derivara en vivo de editSvcId, cerrar (que limpia
  // editSvcId a null) haría que el contenido cambiara a "Nuevo servicio" a
  // mitad de la animación de salida, en vez de la hoja que se estaba cerrando.
  const targetRef = useRef({ isEdit: false, service: null })
  if (sheetOpen) targetRef.current = serviceOpen ? { isEdit: false, service: null } : { isEdit: true, service: liveEditing }
  const target = targetRef.current

  // Las hojas viven en la pestaña: si se sale de ella con una abierta (dock,
  // buscador), al volver no tiene que reaparecer sola.
  useEffect(() => () => {
    setServiceOpen?.(false)
    setEditSvcId?.(null)
    setDeleteSvc?.(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Si la categoría filtrada se quedó sin servicios (se borró el último o se
  // le cambió la categoría), se vuelve a "Todas" en vez de dejar la página
  // en blanco. Se corrige el estado mismo (no solo lo que se muestra), para
  // que el filtro viejo no reaparezca solo cuando esa categoría vuelva a
  // tener un servicio.
  const filterGone = catFilter !== 'all' && !groups.some((g) => g.cat === catFilter)
  if (filterGone) setCatFilter('all')
  const filter = filterGone ? 'all' : catFilter

  const catOptions = useMemo(() => ([
    { value: 'all', label: 'Todas', count: list.length },
    ...groups.map((g) => ({ value: g.cat, label: g.label, count: g.items.length })),
  ]), [groups, list.length])

  const visibleGroups = filter === 'all' ? groups : groups.filter((g) => g.cat === filter)
  const grouped = groups.length > 1

  const closeSheet = () => { setServiceOpen(false); setEditSvcId(null) }

  return (
    <div className="pn-page pn-svc-page">
      <ModuleHeader
        title="Servicios"
        subtitle={activeCount === list.length ? `${activeCount} ${activeCount === 1 ? 'activo' : 'activos'}` : `${activeCount} de ${list.length} activos`}
        primary={{ label: 'Servicio', icon: 'plus', onClick: () => { setEditSvcId(null); setServiceOpen(true) } }}
      />

      {grouped && (
        <FilterChips ariaLabel="Categoría" options={catOptions} value={filter} onChange={setCatFilter} />
      )}

      {list.length === 0 ? (
        <EmptyState icon="scissors" title="Todavía no hay servicios" text="Crea el primero con el botón de arriba." />
      ) : (
        <div className="pn-svc-cats">
          {visibleGroups.map((g) => (
            <section key={g.cat} className="pn-svc-cat">
              {grouped && <SectionLabel>{g.label}</SectionLabel>}
              <ServiceGroup items={g.items} showCat={!grouped} today={today} onOpen={setEditSvcId} />
            </section>
          ))}
        </div>
      )}

      <ServiceSheet
        open={sheetOpen}
        isEdit={target.isEdit}
        service={target.service}
        admin={admin}
        draft={serviceDraft}
        onDraftChange={setServiceDraft}
        onClose={closeSheet}
        onSave={saveService}
        onRequestDelete={setDeleteSvc}
        today={today}
      />

      <ConfirmDialog
        open={Boolean(deleteSvc)}
        tone="danger"
        icon="trash"
        title={`¿Eliminar “${deleteSvc?.name || ''}”?`}
        message="Las reservas existentes conservarán su nombre y precio. Esta acción no se puede deshacer."
        confirmLabel="Sí, eliminar"
        cancelLabel="Volver"
        onCancel={() => setDeleteSvc(null)}
        onConfirm={() => { deleteService(deleteSvc); setDeleteSvc(null) }}
      />
    </div>
  )
}
