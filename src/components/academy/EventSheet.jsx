import React, { useState } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import { Sheet, Button, ConfirmDialog, Chip } from '../panel/index.js'
import RichText from './RichText.jsx'
import { academyApi } from '../../academy/api.js'
import { useAcademy } from '../../academy/context.js'
import { safeUrl, isImageUrl, UGC_REL } from '../../academy/url.js'
import { downloadIcs } from '../../academy/ics.js'
import { r } from '../../academy/routes.js'
import {
  eventStart, eventEnd, fmtTime24, longDate, capitalize, tzPhrase, tzCity, safeTz, dayKeyIn, WEEKDAYS_ES,
  longDateOfKey,
} from './MonthGrid.jsx'
import { locationMeta } from './EventEditor.jsx'
import '../../styles/academy/calendario.css'

/* ============================================================
   EventSheet — detalle de una ocurrencia (hoja en el celular, diálogo en
   escritorio). La hora se muestra en la zona de quien mira; si el evento
   se creó en otra zona, se agrega la hora "del evento" para no confundir.
   El enlace/dirección solo aparece si el backend lo mandó: un evento
   bloqueado llega con locationInfo null y acá se dice por qué.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

function joinEs(list) {
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`
}

export function repeatText(ev) {
  if (!ev?.repeatWeekly) return ''
  const days = (Array.isArray(ev.weekdays) && ev.weekdays.length ? ev.weekdays : [])
    .map(Number).filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b)
  const names = days.map((d) => WEEKDAYS_ES[d - 1])
  const base = names.length ? `Todas las semanas, los ${joinEs(names)}` : 'Todas las semanas'
  return ev.untilDate ? `${base}, hasta el ${longDateOfKey(ev.untilDate)}` : base
}

/* Texto de "por qué no ves el enlace" (SPEC §5.5: lockReason nivel|grupo). */
export function lockText(ev, { cohortName } = {}) {
  if (!ev?.locked) return ''
  if (ev.lockReason === 'nivel') {
    const lv = Number(ev.access?.level)
    return lv ? `Se desbloquea en Nivel ${lv}` : 'Se desbloquea al subir de nivel'
  }
  if (ev.lockReason === 'grupo') {
    const name = cohortName || ev.access?.cohortName
    return name ? `Solo para el grupo ${name}` : 'Solo para los miembros de un grupo'
  }
  return 'No tienes acceso a este evento'
}

// Enlace al evento dentro de la Academy (va en el .ics para volver acá).
function eventUrl(ev) {
  try { return `${window.location.origin}${r.path('/calendario')}?evento=${encodeURIComponent(ev.id)}` } catch { return '' }
}

/**
 * props: open, onClose, event (ocurrencia de `events`/`event`), tz (de quien
 * mira), canManage (staff), onEdit(event), onDeleted(event).
 */
export default function EventSheet({ open, onClose, event, tz, canManage = false, onEdit, onDeleted }) {
  const { me, toast, levelName } = useAcademy()
  const [addOpen, setAddOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const ev = event
  const viewTz = safeTz(tz)
  const start = ev ? eventStart(ev) : null
  const end = ev ? eventEnd(ev) : null
  const evTz = safeTz(ev?.tz)
  const otherZone = ev && evTz !== viewTz
  const loc = locationMeta(ev?.locationType)
  const info = ev?.locationInfo ? String(ev.locationInfo) : ''
  const link = info && loc.url ? safeUrl(info) : null
  const mapsLink = info && !loc.url ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info)}` : null
  const cohortName = ev?.access?.type === 'grupo'
    ? (me?.cohorts || []).find((c) => Number(c.id) === Number(ev.access.cohortId))?.name
    : null
  const google = ev?.calendarLinks?.google ? safeUrl(ev.calendarLinks.google) : null
  const cover = ev?.coverUrl && isImageUrl(ev.coverUrl) ? ev.coverUrl : null
  const past = end && end.getTime() < Date.now()
  const live = start && end && start.getTime() <= Date.now() && end.getTime() >= Date.now()

  const accessText = ev?.access?.type === 'nivel'
    ? `Enlace para Nivel ${ev.access.level}${levelName?.(ev.access.level) ? ` (${levelName(ev.access.level)})` : ''} o más`
    : ev?.access?.type === 'grupo'
      ? `Enlace solo para el grupo ${cohortName || ev.access?.cohortName || ''}`.trim()
      : ''

  const addIcs = () => {
    setAddOpen(false)
    try {
      // ics.js ya omite la ubicación de un evento bloqueado (llega en null).
      downloadIcs(ev, { url: eventUrl(ev) })
    } catch {
      toast?.('No se pudo crear el archivo del calendario.', 'error')
    }
  }

  const doDelete = async () => {
    setDeleting(true)
    try {
      await academyApi('admin-event-delete', { method: 'POST', body: { id: ev.id } })
      toast?.('Evento eliminado', 'success')
      setConfirmDelete(false)
      onDeleted?.(ev)
      onClose?.()
    } catch (err) {
      toast?.(err?.message || 'No se pudo eliminar el evento.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const footer = canManage && ev ? (
    <>
      <Button variant="secondary" icon="trash" onClick={() => setConfirmDelete(true)}>Eliminar</Button>
      <Button variant="primary" className="aca-btn-accent" icon="pencil" onClick={() => onEdit?.(ev)}>Editar</Button>
    </>
  ) : null

  return (
    <>
      <Sheet
        open={open && Boolean(ev)}
        onClose={onClose}
        title={ev?.title || 'Evento'}
        size="md"
        footer={footer}
        className="aca-evs-sheet"
      >
        {ev && (
          <div className="aca-evs">
            {cover && <img className="aca-evs-cover" src={cover} alt="" />}

            <div className="aca-evs-chips">
              {live && <Chip tone="bad" dot>En vivo ahora</Chip>}
              {past && !live && <Chip tone="muted">Ya pasó</Chip>}
              {ev.repeatWeekly && <Chip tone="info" icon="reschedule">Semanal</Chip>}
            </div>

            <div className="aca-evs-row">
              <Icon name="calendar" size={18} />
              <div>
                <p className="aca-evs-strong">{start ? capitalize(longDate(start, viewTz)) : 'Fecha por confirmar'}</p>
                {start && (
                  <p>
                    {fmtTime24(start, viewTz)} – {fmtTime24(end, viewTz)}
                    {end && dayKeyIn(end, viewTz) !== dayKeyIn(start, viewTz) ? ` (${longDate(end, viewTz)})` : ''}
                    <span className="aca-evs-muted"> · {tzPhrase(viewTz)}</span>
                  </p>
                )}
                {start && otherZone && (
                  <p className="aca-evs-muted">
                    {fmtTime24(start, evTz)} en {tzCity(evTz)}, la zona del evento
                  </p>
                )}
                {ev.repeatWeekly && <p className="aca-evs-muted">{repeatText(ev)}</p>}
              </div>
            </div>

            <div className={cx('aca-evs-row', ev.locked && 'is-locked')}>
              <Icon name={ev.locked ? 'lock' : loc.icon} size={18} />
              <div>
                <p className="aca-evs-strong">{loc.label}</p>
                {ev.locked ? (
                  <p className="aca-evs-lock">{lockText(ev, { cohortName })}</p>
                ) : link ? (
                  <a className="aca-evs-link" href={link} target="_blank" rel={UGC_REL}>{link.replace(/^https:\/\//, '')}</a>
                ) : mapsLink ? (
                  <a className="aca-evs-link" href={mapsLink} target="_blank" rel={UGC_REL}>{info}</a>
                ) : (
                  <p className="aca-evs-muted">El enlace se publica pronto.</p>
                )}
              </div>
            </div>

            {canManage && accessText && (
              <div className="aca-evs-row">
                <Icon name="shield" size={18} />
                <p className="aca-evs-muted">{accessText}</p>
              </div>
            )}

            {!ev.locked && link && !past && (
              <a className="pn-btn pn-btn--primary aca-btn-accent pn-btn--block aca-evs-join" href={link} target="_blank" rel={UGC_REL}>
                <Icon name={loc.icon} size={16} />
                <span className="pn-btn-label">{live ? 'Unirme ahora' : `Abrir ${loc.label}`}</span>
              </a>
            )}

            {ev.description ? (
              <div className="aca-evs-desc"><RichText text={ev.description} /></div>
            ) : null}

            {!past && (
              <div className="aca-evs-add">
                <Button
                  variant="secondary"
                  block
                  icon="calendar"
                  iconRight={addOpen ? 'chevronUp' : 'chevronDown'}
                  aria-expanded={addOpen}
                  onClick={() => setAddOpen((v) => !v)}
                >
                  Agregar al calendario
                </Button>
                {addOpen && (
                  <div className="aca-evs-addlist" role="menu">
                    {google && (
                      <a role="menuitem" className="pn-menu-item" href={google} target="_blank" rel={UGC_REL} onClick={() => setAddOpen(false)}>
                        <Icon name="calendar" size={17} /><span>Google Calendar</span>
                      </a>
                    )}
                    <button type="button" role="menuitem" className="pn-menu-item" onClick={addIcs}>
                      <Icon name="download" size={17} /><span>Apple Calendar<small>Descarga un archivo .ics</small></span>
                    </button>
                    <button type="button" role="menuitem" className="pn-menu-item" onClick={addIcs}>
                      <Icon name="download" size={17} /><span>Outlook<small>Descarga un archivo .ics</small></span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Sheet>
      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        title="¿Eliminar evento?"
        message={ev?.repeatWeekly
          ? 'Es un evento semanal: se borran todas sus fechas. No se puede deshacer.'
          : 'Se borra del calendario de todos. No se puede deshacer.'}
        confirmLabel="Eliminar"
        busy={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}
