import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import { Sheet, Button, Field, ToggleRow, List, InlineAlert, Segmented } from '../panel/index.js'
import { academyApi } from '../../academy/api.js'
import { useAcademy } from '../../academy/context.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { safeUrl, isImageUrl } from '../../academy/url.js'
import { uploadImage } from '../../academy/upload.js'
import {
  TZ_OPTIONS, WEEKDAYS_ES, safeTz, wallClock, keyOfParts, dowOfKey, zonedToUtc, isoNoMs, eventStart,
  parseKey, tzCity,
} from './MonthGrid.jsx'
import '../../styles/academy/calendario.css'

/* ============================================================
   EventEditor — crear / editar un evento (propietario, admin, moderador).
   Guarda con `admin-event-save` (SPEC §5.5). Un evento semanal se edita
   entero: la API no tiene "solo esta ocurrencia", y se dice en la hoja para
   que nadie crea que movió una sola fecha.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')
const pad = (n) => String(n).padStart(2, '0')

/* Los 4 formatos que sugiere Skool en el calendario vacío. Cada uno llena el
   título y la descripción; el resto lo decide quien crea el evento. */
export const EVENT_TEMPLATES = [
  {
    id: 'cafe',
    emoji: '☕',
    title: 'Hora del café',
    description: 'Un rato relajado para conversar, conocernos y contar en qué está cada uno. Trae tu café y tus ganas de compartir.',
  },
  {
    id: 'qa',
    emoji: '💬',
    title: 'Preguntas y respuestas',
    description: 'Trae tus dudas sobre cortes, técnicas, herramientas o el negocio y las respondemos en vivo. Si quieres, déjalas antes en los comentarios de la comunidad.',
  },
  {
    id: 'coworking',
    emoji: '💻',
    title: 'Sesión de coworking',
    description: 'Nos conectamos a trabajar cada uno en lo suyo —practicar, editar fotos de tus cortes, avanzar en las lecciones— con la cámara prendida para mantener el foco juntos.',
  },
  {
    id: 'hora-feliz',
    emoji: '🍺',
    title: 'Hora feliz',
    description: 'Cerramos la semana con una conversación distendida: logros, anécdotas de la barbería y lo que salga.',
  },
]

export const LOCATION_TYPES = [
  { value: 'meet', label: 'Google Meet', icon: 'video', url: true, placeholder: 'https://meet.google.com/…' },
  { value: 'zoom', label: 'Zoom', icon: 'video', url: true, placeholder: 'https://zoom.us/j/…' },
  { value: 'youtube', label: 'YouTube en vivo', icon: 'play', url: true, placeholder: 'https://youtube.com/live/…' },
  { value: 'direccion', label: 'Dirección', icon: 'mapPin', url: false, placeholder: 'Av. Ejemplo 123, Santiago' },
  { value: 'enlace', label: 'Otro enlace', icon: 'link', url: true, placeholder: 'https://…' },
]
export const locationMeta = (type) => LOCATION_TYPES.find((l) => l.value === type) || LOCATION_TYPES[4]

const DURATIONS = [
  [30, '30 minutos'], [60, '1 hora'], [90, '1 h 30 min'], [120, '2 horas'], [180, '3 horas'],
  [240, '4 horas'], [360, '6 horas'], [480, '8 horas'], [720, '12 horas'], [1440, '24 horas'],
]

// Horas en pasos de 30 minutos, como el selector de Skool.
const TIMES = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`)

const WEEKDAY_LETTER = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

function roundTo30(hh, mm) {
  const total = hh * 60 + mm
  const r = Math.round(total / 30) * 30
  const h = Math.floor((r % 1440) / 60)
  return `${pad(h)}:${r % 60 ? '30' : '00'}`
}

/* Estado inicial del formulario. Editando: la fecha/hora base del evento
   (`startsAt`, primera ocurrencia) en SU zona; si el backend solo manda la
   ocurrencia, se usa esa (ver "Requests" del reporte). */
function initialForm({ event, template, date }) {
  if (event) {
    const tz = safeTz(event.tz)
    const base = event.startsAt ? new Date(event.startsAt) : eventStart(event)
    const w = base ? wallClock(base, tz) : null
    const access = event.access || { type: 'todos' }
    return {
      title: event.title || '',
      description: event.description || '',
      date: w ? keyOfParts(w.y, w.m, w.d) : date,
      time: w ? roundTo30(w.hh, w.mm) : '19:00',
      durationMin: Number(event.durationMin) || 60,
      tz,
      repeatWeekly: Boolean(event.repeatWeekly),
      weekdays: Array.isArray(event.weekdays) && event.weekdays.length ? event.weekdays.map(Number) : (w ? [w.dow] : [dowOfKey(date)]),
      untilDate: event.untilDate || '',
      locationType: event.locationType || 'meet',
      locationInfo: event.locationInfo || '',
      accessType: access.type || 'todos',
      accessLevel: Number(access.level) || 2,
      accessCohortId: access.cohortId ? String(access.cohortId) : '',
      emailReminder: event.emailReminder !== false,
      coverUrl: event.coverUrl || null,
    }
  }
  return {
    title: template?.title || '',
    description: template?.description || '',
    date,
    time: '19:00',
    durationMin: 60,
    tz: 'America/Santiago',
    repeatWeekly: false,
    weekdays: [dowOfKey(date)],
    untilDate: '',
    locationType: 'meet',
    locationInfo: '',
    accessType: 'todos',
    accessLevel: 2,
    accessCohortId: '',
    emailReminder: true,
    coverUrl: null,
  }
}

function validate(f) {
  const e = {}
  if (!f.title.trim()) e.title = 'Ponle un nombre al evento.'
  else if (f.title.trim().length > 120) e.title = 'Máximo 120 caracteres.'
  if (!parseKey(f.date)) e.date = 'Elige una fecha.'
  if (!TIMES.includes(f.time)) e.time = 'Elige una hora.'
  const loc = locationMeta(f.locationType)
  const info = f.locationInfo.trim()
  if (info && loc.url && !safeUrl(info)) e.locationInfo = 'Pega un enlace válido que empiece con https://'
  if (info.length > 500) e.locationInfo = 'Máximo 500 caracteres.'
  if (f.repeatWeekly && !f.weekdays.length) e.weekdays = 'Elige al menos un día para repetir.'
  if (f.repeatWeekly && f.untilDate && parseKey(f.untilDate) && f.untilDate < f.date) e.untilDate = 'La fecha de término tiene que ser después del inicio.'
  if (f.accessType === 'grupo' && !f.accessCohortId) e.access = 'Elige el grupo que puede ver este evento.'
  if (f.description.length > 5000) e.description = 'Máximo 5.000 caracteres.'
  return e
}

function buildBody(f, event) {
  const start = zonedToUtc(f.date, f.time, f.tz)
  const loc = locationMeta(f.locationType)
  const info = f.locationInfo.trim()
  const access = f.accessType === 'nivel'
    ? { type: 'nivel', level: Number(f.accessLevel) }
    : f.accessType === 'grupo'
      ? { type: 'grupo', cohortId: Number(f.accessCohortId) }
      : { type: 'todos' }
  const body = {
    title: f.title.trim(),
    description: f.description.trim(),
    coverUrl: f.coverUrl && isImageUrl(f.coverUrl) ? f.coverUrl : null,
    startsAt: start ? isoNoMs(start) : null,
    durationMin: Number(f.durationMin),
    tz: f.tz,
    repeatWeekly: Boolean(f.repeatWeekly),
    weekdays: f.repeatWeekly ? [...new Set(f.weekdays)].sort((a, b) => a - b) : null,
    untilDate: f.repeatWeekly && f.untilDate ? f.untilDate : null,
    locationType: f.locationType,
    locationInfo: info ? (loc.url ? safeUrl(info) : info) : null,
    access,
    emailReminder: Boolean(f.emailReminder),
  }
  if (event?.id) body.id = event.id
  return body
}

/**
 * props: open, onClose, event (null = nuevo), template (de EVENT_TEMPLATES),
 * date ("YYYY-MM-DD" por defecto para uno nuevo), onSaved(event).
 */
export default function EventEditor({ open, onClose, event = null, template = null, date, onSaved }) {
  const { isAdmin, isOwner, levelName, toast, me } = useAcademy()
  const defaultDate = useMemo(() => {
    if (parseKey(date)) return date
    const w = wallClock(new Date(), 'America/Santiago')
    return keyOfParts(w.y, w.m, w.d)
  }, [date])
  const [f, setF] = useState(() => initialForm({ event, template, date: defaultDate }))
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const titleRef = useRef(null)

  // Al abrir, el formulario parte de cero (o del evento a editar).
  useEffect(() => {
    if (!open) return
    setF(initialForm({ event, template, date: defaultDate }))
    setErrors({})
    setServerError('')
  }, [open, event?.id, template?.id, defaultDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Los grupos se piden solo si hace falta elegir uno (acceso "grupo").
  const cohortsQ = useAcademyQuery('cohorts', () => academyApi('cohorts'), {
    enabled: open && f.accessType === 'grupo',
    refetchOnFocus: false,
  })
  const cohorts = cohortsQ.data?.cohorts || me?.cohorts || []

  const set = (key, value) => {
    setF((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  // Al cambiar la fecha de un evento semanal sin días elegidos a mano, el día
  // de repetición sigue a la fecha (lo esperable al crear uno nuevo).
  const onDate = (value) => {
    setF((prev) => {
      const next = { ...prev, date: value }
      if (parseKey(value) && prev.weekdays.length <= 1) next.weekdays = [dowOfKey(value)]
      return next
    })
    if (errors.date) setErrors((prev) => ({ ...prev, date: undefined }))
  }

  const toggleDay = (d) => {
    setF((prev) => {
      const has = prev.weekdays.includes(d)
      return { ...prev, weekdays: has ? prev.weekdays.filter((x) => x !== d) : [...prev.weekdays, d] }
    })
    if (errors.weekdays) setErrors((prev) => ({ ...prev, weekdays: undefined }))
  }

  // La portada usa el tipo de subida `evento`, que el backend reserva a
  // propietario/admin: un moderador crea eventos, pero sin portada.
  const canUploadCover = Boolean(isAdmin || isOwner)
  const onPickCover = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const up = await uploadImage('evento', file)
      if (up?.url && isImageUrl(up.url)) set('coverUrl', up.url)
      else toast?.('No se pudo usar esa imagen.', 'error')
    } catch (err) {
      toast?.(err?.message || 'No se pudo subir la imagen.', 'error')
    } finally {
      setUploading(false)
    }
  }

  const submit = async () => {
    const e = validate(f)
    setErrors(e)
    if (Object.keys(e).length) return
    const body = buildBody(f, event)
    if (!body.startsAt) { setErrors({ date: 'Revisa la fecha y la hora.' }); return }
    setSaving(true)
    setServerError('')
    try {
      const res = await academyApi('admin-event-save', { method: 'POST', body })
      toast?.(event?.id ? 'Evento actualizado' : 'Evento creado', 'success')
      onSaved?.(res?.event || null)
      onClose?.()
    } catch (err) {
      setServerError(err?.message || 'No se pudo guardar el evento.')
    } finally {
      setSaving(false)
    }
  }

  const loc = locationMeta(f.locationType)
  const tzList = TZ_OPTIONS.some(([z]) => z === f.tz) ? TZ_OPTIONS : [[f.tz, tzCity(f.tz)], ...TZ_OPTIONS]
  const levels = [2, 3, 4, 5, 6, 7, 8, 9]

  return (
    <Sheet
      open={open}
      onClose={saving ? undefined : onClose}
      dismissible={!saving}
      title={event?.id ? 'Editar evento' : 'Nuevo evento'}
      size="md"
      initialFocusRef={event?.id ? undefined : titleRef}
      className="aca-eved-sheet"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" className="aca-btn-accent" onClick={submit} loading={saving} disabled={uploading}>
            {event?.id ? 'Guardar cambios' : 'Crear evento'}
          </Button>
        </>
      )}
    >
      <div className="aca-eved pn-form">
        {serverError && <InlineAlert tone="error">{serverError}</InlineAlert>}
        {event?.repeatWeekly && (
          <InlineAlert tone="info">Es un evento semanal: los cambios se aplican a todas sus fechas.</InlineAlert>
        )}

        <Field label="Título" error={errors.title} htmlFor="aca-eved-title">
          <input
            id="aca-eved-title"
            ref={titleRef}
            className="input"
            value={f.title}
            maxLength={120}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Ej: Preguntas y respuestas con Bruno"
          />
        </Field>

        <div className="pn-form-row">
          <Field label="Fecha" error={errors.date} htmlFor="aca-eved-date">
            <input id="aca-eved-date" className="input" type="date" value={f.date} onChange={(e) => onDate(e.target.value)} />
          </Field>
          <Field label="Hora" error={errors.time} htmlFor="aca-eved-time">
            <select id="aca-eved-time" className="input" value={f.time} onChange={(e) => set('time', e.target.value)}>
              {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>

        <div className="pn-form-row">
          <Field label="Duración" htmlFor="aca-eved-dur">
            <select id="aca-eved-dur" className="input" value={f.durationMin} onChange={(e) => set('durationMin', Number(e.target.value))}>
              {DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Zona horaria" htmlFor="aca-eved-tz">
            <select id="aca-eved-tz" className="input" value={f.tz} onChange={(e) => set('tz', e.target.value)}>
              {tzList.map(([z, l]) => <option key={z} value={z}>{l}</option>)}
            </select>
          </Field>
        </div>

        <List className="aca-eved-list">
          <ToggleRow
            title="Repetir cada semana"
            description={f.repeatWeekly ? 'Elige los días y hasta cuándo.' : 'Para un Q&A semanal o una sesión fija.'}
            checked={f.repeatWeekly}
            onChange={(v) => set('repeatWeekly', v)}
          />
        </List>

        {f.repeatWeekly && (
          <div className="aca-eved-repeat">
            <Field label="Se repite los" error={errors.weekdays}>
              <div className="aca-eved-days" role="group" aria-label="Días de la semana">
                {WEEKDAY_LETTER.map((l, i) => {
                  const d = i + 1
                  const on = f.weekdays.includes(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      className={cx('aca-eved-day', on && 'is-on')}
                      aria-pressed={on}
                      aria-label={WEEKDAYS_ES[i]}
                      title={WEEKDAYS_ES[i]}
                      onClick={() => toggleDay(d)}
                    >
                      {l}
                    </button>
                  )
                })}
              </div>
            </Field>
            <Field label="Termina" optional error={errors.untilDate} hint={f.untilDate ? undefined : 'Sin fecha de término, se repite hasta que lo borres.'} htmlFor="aca-eved-until">
              <div className="aca-eved-until">
                <input id="aca-eved-until" className="input" type="date" value={f.untilDate} min={f.date} onChange={(e) => set('untilDate', e.target.value)} />
                {f.untilDate && <Button variant="plain" size="sm" onClick={() => set('untilDate', '')}>Nunca</Button>}
              </div>
            </Field>
          </div>
        )}

        <Field label="Ubicación" htmlFor="aca-eved-loctype">
          <select id="aca-eved-loctype" className="input" value={f.locationType} onChange={(e) => set('locationType', e.target.value)}>
            {LOCATION_TYPES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </Field>
        <Field
          label={loc.url ? 'Enlace' : 'Dirección'}
          optional
          error={errors.locationInfo}
          hint="Los miembros sin acceso ven el evento, pero no este dato."
          htmlFor="aca-eved-locinfo"
        >
          <input
            id="aca-eved-locinfo"
            className="input"
            value={f.locationInfo}
            maxLength={500}
            inputMode={loc.url ? 'url' : 'text'}
            autoCapitalize={loc.url ? 'off' : undefined}
            autoCorrect={loc.url ? 'off' : undefined}
            spellCheck={loc.url ? false : undefined}
            onChange={(e) => set('locationInfo', e.target.value)}
            placeholder={loc.placeholder}
          />
        </Field>

        <Field label="¿Quién puede ver el enlace?" error={errors.access}>
          <Segmented
            full
            ariaLabel="Acceso"
            value={f.accessType}
            onChange={(v) => set('accessType', v)}
            options={[
              { value: 'todos', label: 'Todos' },
              { value: 'nivel', label: 'Por nivel' },
              { value: 'grupo', label: 'Un grupo' },
            ]}
          />
        </Field>
        {f.accessType === 'nivel' && (
          <Field label="Nivel mínimo" htmlFor="aca-eved-level" hint="Los de nivel menor ven el evento con el enlace bloqueado.">
            <select id="aca-eved-level" className="input" value={f.accessLevel} onChange={(e) => set('accessLevel', Number(e.target.value))}>
              {levels.map((n) => {
                const name = levelName?.(n)
                return <option key={n} value={n}>{`Nivel ${n}${name ? ` · ${name}` : ''}`}</option>
              })}
            </select>
          </Field>
        )}
        {f.accessType === 'grupo' && (
          <Field
            label="Grupo"
            htmlFor="aca-eved-cohort"
            hint={cohortsQ.error ? 'No se pudieron cargar los grupos.' : (!cohortsQ.loading && !cohorts.length ? 'Todavía no hay grupos. Créalos en el panel → Academy → Grupos.' : undefined)}
          >
            <select
              id="aca-eved-cohort"
              className="input"
              value={f.accessCohortId}
              onChange={(e) => set('accessCohortId', e.target.value)}
              disabled={cohortsQ.loading && !cohorts.length}
            >
              <option value="">{cohortsQ.loading && !cohorts.length ? 'Cargando grupos…' : 'Elige un grupo'}</option>
              {cohorts.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </Field>
        )}

        <Field label="Descripción" optional error={errors.description} htmlFor="aca-eved-desc">
          <textarea
            id="aca-eved-desc"
            className="input"
            rows={5}
            value={f.description}
            maxLength={5000}
            onChange={(e) => set('description', e.target.value)}
            placeholder="¿De qué se trata? ¿Qué tienen que traer o preparar?"
          />
        </Field>

        <Field label="Portada" optional hint={canUploadCover ? 'JPG, PNG o WebP. Se ve arriba del evento.' : 'Solo los administradores pueden subir portadas.'}>
          {f.coverUrl && isImageUrl(f.coverUrl) ? (
            <div className="aca-eved-cover">
              <img src={f.coverUrl} alt="" />
              {canUploadCover && (
                <div className="aca-eved-cover-actions">
                  <Button size="sm" variant="secondary" icon="image" onClick={() => fileRef.current?.click()} loading={uploading}>Cambiar</Button>
                  <Button size="sm" variant="plain" icon="trash" onClick={() => set('coverUrl', null)} disabled={uploading}>Quitar</Button>
                </div>
              )}
            </div>
          ) : canUploadCover ? (
            <button type="button" className="aca-eved-cover-drop" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Icon name={uploading ? 'refresh' : 'image'} size={18} />
              <span>{uploading ? 'Subiendo…' : 'Subir imagen de portada'}</span>
            </button>
          ) : null}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onPickCover} />
        </Field>

        <List className="aca-eved-list">
          <ToggleRow
            title="Recordar a los miembros por correo 1 día antes"
            description="También les llega un aviso en la app 1 hora antes."
            checked={f.emailReminder}
            onChange={(v) => set('emailReminder', v)}
          />
        </List>
      </div>
    </Sheet>
  )
}

