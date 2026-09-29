import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import {
  Sheet, ConfirmDialog, Button, IconButton, Field, ToggleRow, List, ListRow, Segmented, InlineAlert, Note, SkeletonRows,
} from '../panel/index.js'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { safeUrl, isImageUrl } from '../../academy/url.js'
import { parseYouTubeId, thumbUrl } from '../../academy/youtube.js'
import { LEVEL_THRESHOLDS, DEFAULT_LEVEL_NAMES } from '../../academy/levels.js'
import { uploadImage } from '../../academy/upload.js'
import { ACADEMY_BRAND } from '../../academy/hostConfig.js'
import { cx, errorText } from './MemberCard.jsx'
import '../../styles/academy/miembros.css'

/* ============================================================
   CONFIGURACIÓN del grupo (botón de la GroupCard y engranaje de
   Clasificación). Todo se guarda con `admin-settings` (merge profundo en
   el servidor; los arreglos —enlaces, reglas, nombres de niveles— se
   mandan completos). Las categorías tienen sus propios modos
   admin-category-*. Cada sección guarda por separado: un error en
   "Enlaces" no se lleva los cambios de "General".
   ============================================================ */

export const GS_SECTIONS = [
  ['general', 'General', 'settings'],
  ['categorias', 'Categorías', 'hash'],
  ['niveles', 'Niveles', 'trophy'],
  ['complementos', 'Complementos', 'sparkles'],
  ['pestanas', 'Pestañas', 'layout'],
  ['reglas', 'Reglas', 'shield'],
  ['enlaces', 'Enlaces', 'link'],
]

const DEFAULT_NAMES = Array.isArray(DEFAULT_LEVEL_NAMES) && DEFAULT_LEVEL_NAMES.length === 9
  ? DEFAULT_LEVEL_NAMES
  : ['Aprendiz', 'Ayudante', 'Barbero', 'Barbero Pro', 'Fader', 'Estilista', 'Maestro', 'Leyenda', 'Élite']
const THRESHOLDS = Array.isArray(LEVEL_THRESHOLDS) && LEVEL_THRESHOLDS.length === 9
  ? LEVEL_THRESHOLDS
  : [0, 5, 20, 65, 155, 515, 2015, 8015, 33015]
const SWATCHES = ['#1c1c1c', '#3b5bdb', '#2b8750', '#bf463a', '#a8710f', '#7048e8', '#0c8599', '#d6336c']
const MAX_LINKS = 5
const MAX_RULES = 20
const MAX_CATEGORIES = 10

function withScheme(u) {
  const v = String(u || '').trim()
  if (!v) return ''
  if (v.startsWith('/')) return v
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
}

function SectionHead({ title, children }) {
  return (
    <header className="aca-gs-head">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </header>
  )
}

function SaveRow({ saving, onSave, disabled, label = 'Guardar' }) {
  return (
    <div className="aca-gs-save">
      <Button variant="primary" loading={saving} disabled={disabled} onClick={onSave}>{label}</Button>
    </div>
  )
}

/* ---------------- General ---------------- */
function GeneralSection({ settings, save, saving }) {
  const { toast } = useAcademy()
  const g = settings.group || {}
  const [d, setD] = useState(() => ({
    name: g.name || '',
    description: g.description || '',
    initials: g.initials || '',
    color: /^#[0-9a-f]{6}$/i.test(g.color || '') ? g.color : '#1c1c1c',
    iconUrl: g.iconUrl || null,
    coverUrl: g.coverUrl || null,
  }))
  const [errors, setErrors] = useState({})
  const [uploading, setUploading] = useState('')
  const iconRef = useRef(null)
  const coverRef = useRef(null)
  const set = (patch) => setD((x) => ({ ...x, ...patch }))

  const onFile = (field) => async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(field)
    try {
      const up = await uploadImage('portada', file)
      if (!up?.url || !isImageUrl(up.url)) throw new Error('La imagen no se pudo subir.')
      set({ [field]: up.url })
    } catch (err) {
      toast?.(errorText(err, 'No se pudo subir la imagen'), 'error')
    } finally {
      setUploading('')
    }
  }

  const submit = () => {
    const e = {}
    const name = d.name.trim()
    const initials = d.initials.trim().toUpperCase()
    if (!name) e.name = 'El grupo necesita un nombre.'
    else if (name.length > 60) e.name = 'Máximo 60 caracteres.'
    if (!initials) e.initials = 'Escribe 1 a 3 letras.'
    else if (!/^[\p{L}\p{N}]{1,3}$/u.test(initials)) e.initials = 'Solo letras o números, hasta 3.'
    if (!/^#[0-9a-f]{6}$/i.test(d.color)) e.color = 'Color no válido.'
    if (d.description.length > 1000) e.description = 'Máximo 1000 caracteres.'
    setErrors(e)
    if (Object.keys(e).length) return
    save({
      group: {
        name,
        description: d.description.trim(),
        initials,
        color: d.color,
        iconUrl: d.iconUrl && isImageUrl(d.iconUrl) ? d.iconUrl : null,
        coverUrl: d.coverUrl && isImageUrl(d.coverUrl) ? d.coverUrl : null,
      },
    })
  }

  const icon = d.iconUrl && isImageUrl(d.iconUrl) ? d.iconUrl : null
  const cover = d.coverUrl && isImageUrl(d.coverUrl) ? d.coverUrl : null

  return (
    <div className="aca-gs-section">
      <SectionHead title="General">Nombre, descripción y cómo se ve el grupo en la barra superior.</SectionHead>

      <Field label="Nombre del grupo" error={errors.name} htmlFor="aca-gs-name">
        <input id="aca-gs-name" className="aca-mi-input" value={d.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Descripción" hint={`${d.description.length}/1000 · Se muestra en la tarjeta del grupo y en Acerca de.`} error={errors.description} htmlFor="aca-gs-desc">
        <textarea id="aca-gs-desc" className="aca-mi-input" rows={5} maxLength={1000} value={d.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>

      <div className="aca-gs-row">
        <Field label="Iniciales" hint="Hasta 3 letras" error={errors.initials} htmlFor="aca-gs-ini">
          <input id="aca-gs-ini" className="aca-mi-input" value={d.initials} maxLength={3} autoCapitalize="characters" onChange={(e) => set({ initials: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Color" error={errors.color}>
          <div className="aca-gs-colors">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                className={cx('aca-gs-swatch', d.color.toLowerCase() === c && 'is-on')}
                style={{ '--sw': c }}
                aria-label={`Color ${c}`}
                aria-pressed={d.color.toLowerCase() === c}
                onClick={() => set({ color: c })}
              />
            ))}
            <input type="color" className="aca-gs-colorpick" value={d.color} onChange={(e) => set({ color: e.target.value })} aria-label="Otro color" />
          </div>
        </Field>
      </div>

      <Field label="Ícono" hint="Cuadrado, se muestra al lado del nombre. Sin ícono se usan las iniciales.">
        <div className="aca-gs-media">
          <span className="aca-gs-icon" style={{ '--gc': d.color }}>
            {icon ? <img src={icon} alt="" /> : <span>{(d.initials || ACADEMY_BRAND.initials).slice(0, 3)}</span>}
          </span>
          <Button size="sm" icon="upload" loading={uploading === 'iconUrl'} onClick={() => iconRef.current?.click()}>Subir ícono</Button>
          {icon && <Button size="sm" variant="plain" onClick={() => set({ iconUrl: null })}>Quitar</Button>}
          <input ref={iconRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile('iconUrl')} />
        </div>
      </Field>

      <Field label="Portada" hint="Horizontal (1.9:1), se ve arriba de la tarjeta del grupo.">
        <div className="aca-gs-media is-cover">
          <span className="aca-gs-cover">{cover ? <img src={cover} alt="" /> : <Icon name="image" size={22} />}</span>
          <Button size="sm" icon="upload" loading={uploading === 'coverUrl'} onClick={() => coverRef.current?.click()}>{cover ? 'Cambiar' : 'Subir portada'}</Button>
          {cover && <Button size="sm" variant="plain" onClick={() => set({ coverUrl: null })}>Quitar</Button>}
          <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile('coverUrl')} />
        </div>
      </Field>

      <SaveRow saving={saving} onSave={submit} disabled={Boolean(uploading)} />
    </div>
  )
}

/* ---------------- Categorías ---------------- */
const EMPTY_CAT = { id: null, name: '', emoji: '', writeRole: 'miembros', defaultSort: 'default', cohortId: '' }

function CategoriasSection() {
  const { toast } = useAcademy()
  // No hay un modo "admin-categories": el feed trae la lista (id, nombre,
  // emoji, quién escribe, grupo). Clave propia, forma propia.
  const cats = useAcademyQuery('mi:gs-categories', async () => {
    const res = await academyApi('feed', { query: { sort: 'nuevos' } })
    return { categories: Array.isArray(res?.categories) ? res.categories : [] }
  }, { refetchOnFocus: false })
  const cohorts = useAcademyQuery('mi:cohorts', () => academyApi('cohorts'), { refetchOnFocus: false })
  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState('')
  const [removing, setRemoving] = useState(null)
  const [moveTo, setMoveTo] = useState('')

  const list = (cats.data?.categories || []).slice().sort((a, b) => (Number(a.position ?? 0) - Number(b.position ?? 0)))
  const cohortList = cohorts.data?.cohorts || []
  const cohortName = (id) => cohortList.find((c) => Number(c.id) === Number(id))?.name

  const payload = (c, position) => ({
    id: c.id || undefined,
    name: String(c.name || '').trim(),
    emoji: String(c.emoji || '').trim() || null,
    position,
    writeRole: c.writeRole === 'admins' ? 'admins' : 'miembros',
    defaultSort: ['default', 'nuevos', 'top'].includes(c.defaultSort) ? c.defaultSort : 'default',
    cohortId: c.cohortId ? Number(c.cohortId) : null,
  })

  const submit = async () => {
    const e = {}
    const name = draft.name.trim()
    if (!name) e.name = 'Escribe un nombre.'
    else if (name.length > 30) e.name = 'Máximo 30 caracteres.'
    if ([...String(draft.emoji || '')].length > 4) e.emoji = 'Un emoji.'
    setErrors(e)
    if (Object.keys(e).length) return
    const index = draft.id ? list.findIndex((c) => c.id === draft.id) : list.length
    setBusy('save')
    try {
      await academyApi('admin-category-save', { method: 'POST', body: payload(draft, Math.max(0, index)) })
      toast?.(draft.id ? 'Categoría actualizada' : 'Categoría creada')
      setDraft(null)
      cats.refetch?.()
    } catch (err) {
      toast?.(errorText(err, 'No se pudo guardar la categoría'), 'error')
    } finally {
      setBusy('')
    }
  }

  const move = async (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    setBusy(`move-${list[i].id}`)
    try {
      await academyApi('admin-category-save', { method: 'POST', body: payload(list[i], j) })
      await academyApi('admin-category-save', { method: 'POST', body: payload(list[j], i) })
      cats.refetch?.()
    } catch (err) {
      toast?.(errorText(err, 'No se pudo reordenar'), 'error')
      cats.refetch?.()
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    if (!removing) return
    setBusy('delete')
    try {
      await academyApi('admin-category-delete', { method: 'POST', body: { id: removing.id, moveTo: moveTo ? Number(moveTo) : null } })
      toast?.('Categoría eliminada')
      setRemoving(null)
      cats.refetch?.()
    } catch (err) {
      toast?.(errorText(err, 'No se pudo eliminar la categoría'), 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="aca-gs-section">
      <SectionHead title="Categorías">Ordenan la Comunidad. Hasta {MAX_CATEGORIES}. Una categoría “solo admins” sirve para anuncios.</SectionHead>

      {cats.loading && !cats.data ? (
        <SkeletonRows rows={3} />
      ) : cats.error && !cats.data ? (
        <InlineAlert tone="error" action={{ label: 'Reintentar', onClick: cats.refetch }}>No se pudieron cargar las categorías.</InlineAlert>
      ) : list.length === 0 ? (
        <p className="aca-mi-muted">Todavía no hay categorías.</p>
      ) : (
        <List>
          {list.map((c, i) => (
            <ListRow
              key={c.id}
              lead={<span className="aca-gs-emoji" aria-hidden="true">{c.emoji || '#'}</span>}
              title={c.name}
              subtitle={[
                c.writeRole === 'admins' ? 'Solo admins publican' : 'Todos publican',
                c.cohortId ? `Solo el grupo ${cohortName(c.cohortId) || c.cohortId}` : null,
              ].filter(Boolean).join(' · ')}
              actions={(
                <span className="aca-gs-rowacts">
                  <IconButton icon="chevronUp" label="Subir" small plain disabled={i === 0 || Boolean(busy)} onClick={() => move(i, -1)} />
                  <IconButton icon="chevronDown" label="Bajar" small plain disabled={i === list.length - 1 || Boolean(busy)} onClick={() => move(i, 1)} />
                  <IconButton icon="pencil" label={`Editar ${c.name}`} small plain onClick={() => { setErrors({}); setDraft({ ...EMPTY_CAT, ...c, cohortId: c.cohortId || '' }) }} />
                  <IconButton icon="trash" label={`Eliminar ${c.name}`} small plain onClick={() => { setMoveTo(''); setRemoving(c) }} />
                </span>
              )}
            />
          ))}
        </List>
      )}

      {draft ? (
        <div className="aca-gs-editor">
          <div className="aca-gs-row">
            <Field label="Emoji" error={errors.emoji} className="aca-gs-emoji-field" htmlFor="aca-cat-emoji">
              <input id="aca-cat-emoji" className="aca-mi-input" value={draft.emoji || ''} maxLength={8} placeholder="📣" onChange={(e) => setDraft({ ...draft, emoji: e.target.value })} />
            </Field>
            <Field label="Nombre" error={errors.name} htmlFor="aca-cat-name">
              <input id="aca-cat-name" className="aca-mi-input" value={draft.name} maxLength={30} placeholder="Anuncios" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
          </div>
          <Field label="¿Quién puede publicar?">
            <Segmented
              full
              value={draft.writeRole === 'admins' ? 'admins' : 'miembros'}
              onChange={(v) => setDraft({ ...draft, writeRole: v })}
              options={[{ value: 'miembros', label: 'Todos los miembros' }, { value: 'admins', label: 'Solo admins' }]}
              ariaLabel="Quién puede publicar"
            />
          </Field>
          <div className="aca-gs-row">
            <Field label="Orden por defecto" htmlFor="aca-cat-sort">
              <select id="aca-cat-sort" className="aca-mi-input" value={draft.defaultSort || 'default'} onChange={(e) => setDraft({ ...draft, defaultSort: e.target.value })}>
                <option value="default">Predeterminado</option>
                <option value="nuevos">Nuevos</option>
                <option value="top">Top</option>
              </select>
            </Field>
            <Field label="Visible para" htmlFor="aca-cat-cohort">
              <select id="aca-cat-cohort" className="aca-mi-input" value={draft.cohortId || ''} onChange={(e) => setDraft({ ...draft, cohortId: e.target.value })}>
                <option value="">Toda la Academy</option>
                {cohortList.map((c) => <option key={c.id} value={c.id}>Solo {c.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="aca-gs-save">
            <Button variant="plain" onClick={() => setDraft(null)} disabled={busy === 'save'}>Cancelar</Button>
            <Button variant="primary" loading={busy === 'save'} onClick={submit}>{draft.id ? 'Guardar categoría' : 'Crear categoría'}</Button>
          </div>
        </div>
      ) : (
        <Button icon="plus" disabled={list.length >= MAX_CATEGORIES || (cats.loading && !cats.data)} onClick={() => { setErrors({}); setDraft({ ...EMPTY_CAT }) }}>
          {list.length >= MAX_CATEGORIES ? `Máximo ${MAX_CATEGORIES} categorías` : 'Nueva categoría'}
        </Button>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        tone="danger"
        title={`¿Eliminar “${removing?.name || ''}”?`}
        message="Sus publicaciones no se borran: pasan a la categoría que elijas."
        confirmLabel="Eliminar"
        busy={busy === 'delete'}
        onCancel={() => setRemoving(null)}
        onConfirm={remove}
      >
        <Field label="Mover publicaciones a" htmlFor="aca-cat-move">
          <select id="aca-cat-move" className="aca-mi-input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">Sin categoría</option>
            {list.filter((c) => c.id !== removing?.id).map((c) => (
              <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.name}</option>
            ))}
          </select>
        </Field>
      </ConfirmDialog>
    </div>
  )
}

/* ---------------- Niveles ---------------- */
function NivelesSection({ settings, save, saving }) {
  const current = Array.isArray(settings.levels?.names) ? settings.levels.names : DEFAULT_NAMES
  const [names, setNames] = useState(() => Array.from({ length: 9 }, (_, i) => String(current[i] ?? DEFAULT_NAMES[i] ?? '')))
  const tooLong = names.some((n) => n.trim().length > 20)
  const submit = () => {
    if (tooLong) return
    save({ levels: { names: names.map((n, i) => n.trim() || DEFAULT_NAMES[i]) } }, 'Nombres de niveles guardados')
  }
  return (
    <div className="aca-gs-section">
      <SectionHead title="Niveles">Ponle nombre a cada nivel (hasta 20 caracteres, se pueden usar emojis). Los puntos para subir son fijos: 1 me gusta recibido = 1 punto.</SectionHead>
      <ol className="aca-gs-levels">
        {names.map((n, i) => (
          <li key={i}>
            <span className="aca-gs-levelnum" aria-hidden="true">{i + 1}</span>
            <Field
              label={`Nivel ${i + 1}`}
              hint={i === 0 ? 'Al entrar' : `Desde ${Number(THRESHOLDS[i]).toLocaleString('es-CL')} puntos`}
              error={n.trim().length > 20 ? 'Máximo 20 caracteres.' : null}
              htmlFor={`aca-gs-lvl-${i}`}
            >
              <input
                id={`aca-gs-lvl-${i}`}
                className="aca-mi-input"
                value={n}
                maxLength={24}
                placeholder={DEFAULT_NAMES[i]}
                onChange={(e) => setNames((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
              />
            </Field>
          </li>
        ))}
      </ol>
      <div className="aca-gs-save">
        <Button variant="plain" onClick={() => setNames(DEFAULT_NAMES.slice())}>Restablecer nombres</Button>
        <Button variant="primary" loading={saving} disabled={tooLong} onClick={submit}>Guardar</Button>
      </div>
    </div>
  )
}

/* ---------------- Complementos ---------------- */
function levelSelect(id, value, onChange, offLabel) {
  return (
    <select id={id} className="aca-mi-input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{offLabel}</option>
      {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>Desde el nivel {n}</option>)}
    </select>
  )
}

function ComplementosSection({ settings, save, saving }) {
  const p = settings.plugins || {}
  const groupName = settings.group?.name || 'la Academy'
  const [d, setD] = useState(() => ({
    minPostLevel: p.minPostLevel ? String(p.minPostLevel) : '',
    minChatLevel: p.minChatLevel ? String(p.minChatLevel) : '',
    autoDmEnabled: p.autoDm ? p.autoDm.enabled !== false : true,
    autoDmText: p.autoDm?.text || '',
    welcome: p.welcomeVideoId ? `https://youtu.be/${p.welcomeVideoId}` : '',
  }))
  const set = (patch) => setD((x) => ({ ...x, ...patch }))
  const welcomeId = d.welcome.trim() ? parseYouTubeId(d.welcome.trim()) : null
  const welcomeBad = Boolean(d.welcome.trim()) && !welcomeId
  const dmTooLong = d.autoDmText.length > 1000
  const preview = d.autoDmText.replaceAll('#NOMBRE#', 'Camila').replaceAll('#GRUPO#', groupName)

  const submit = () => {
    if (welcomeBad || dmTooLong) return
    save({
      plugins: {
        minPostLevel: d.minPostLevel ? Number(d.minPostLevel) : null,
        minChatLevel: d.minChatLevel ? Number(d.minChatLevel) : null,
        autoDm: { enabled: Boolean(d.autoDmEnabled), text: d.autoDmText.trim() },
        welcomeVideoId: welcomeId,
      },
    }, 'Complementos guardados')
  }

  return (
    <div className="aca-gs-section">
      <SectionHead title="Complementos">Herramientas contra el spam y para dar la bienvenida.</SectionHead>

      <Field label="Publicar en la Comunidad" hint="En grupos chicos conviene dejarlo abierto: el curso es pagado y el spam es raro." htmlFor="aca-gs-minpost">
        {levelSelect('aca-gs-minpost', d.minPostLevel, (v) => set({ minPostLevel: v }), 'Todos pueden publicar')}
      </Field>
      <Field label="Usar el chat" hint="Los admins y moderadores siempre pueden." htmlFor="aca-gs-minchat">
        {levelSelect('aca-gs-minchat', d.minChatLevel, (v) => set({ minChatLevel: v }), 'Todos pueden chatear')}
      </Field>

      <List>
        <ToggleRow
          title="Mensaje de bienvenida automático"
          description="Cuando alguien entra por primera vez le llega este mensaje directo tuyo."
          checked={d.autoDmEnabled}
          onChange={(v) => set({ autoDmEnabled: v })}
        />
      </List>
      {d.autoDmEnabled && (
        <Field
          label="Texto del mensaje"
          hint={`#NOMBRE# se reemplaza por el nombre del miembro y #GRUPO# por el del grupo · ${d.autoDmText.length}/1000`}
          error={dmTooLong ? 'Máximo 1000 caracteres.' : null}
          htmlFor="aca-gs-autodm"
        >
          <textarea id="aca-gs-autodm" className="aca-mi-input" rows={4} value={d.autoDmText} maxLength={1100} onChange={(e) => set({ autoDmText: e.target.value })} />
        </Field>
      )}
      {d.autoDmEnabled && preview.trim() && (
        <div className="aca-gs-preview" aria-label="Vista previa">
          <small>Vista previa</small>
          <p>{preview}</p>
        </div>
      )}

      <Field label="Video de bienvenida" optional hint="Enlace de YouTube (puede ser no listado)." error={welcomeBad ? 'No es un enlace de YouTube válido.' : null} htmlFor="aca-gs-welcome">
        <input id="aca-gs-welcome" className="aca-mi-input" value={d.welcome} inputMode="url" placeholder="https://youtu.be/…" onChange={(e) => set({ welcome: e.target.value })} />
      </Field>
      {welcomeId && (
        <div className="aca-gs-thumb">
          <img src={thumbUrl(welcomeId)} alt="" loading="lazy" />
          <span><Icon name="play" size={18} /></span>
        </div>
      )}

      <SaveRow saving={saving} onSave={submit} disabled={welcomeBad || dmTooLong} />
    </div>
  )
}

/* ---------------- Pestañas ---------------- */
function PestanasSection({ settings, save, saving }) {
  const t = settings.tabs || {}
  const [tabs, setTabs] = useState(() => ({
    comunidad: t.comunidad !== false,
    calendario: t.calendario !== false,
    clasificacion: t.clasificacion !== false,
  }))
  return (
    <div className="aca-gs-section">
      <SectionHead title="Pestañas">Elige qué pestañas ven los miembros. Cursos, Miembros y Acerca de siempre están visibles.</SectionHead>
      <List>
        <ToggleRow title="Comunidad" description="Publicaciones, comentarios y encuestas." checked={tabs.comunidad} onChange={(v) => setTabs((x) => ({ ...x, comunidad: v }))} />
        <ToggleRow title="Calendario" description="Clases en vivo y eventos del grupo." checked={tabs.calendario} onChange={(v) => setTabs((x) => ({ ...x, calendario: v }))} />
        <ToggleRow title="Clasificación" description="Niveles, puntos y tablas de los más activos." checked={tabs.clasificacion} onChange={(v) => setTabs((x) => ({ ...x, clasificacion: v }))} />
      </List>
      <SaveRow saving={saving} onSave={() => save({ tabs }, 'Pestañas guardadas')} />
    </div>
  )
}

/* ---------------- Reglas ---------------- */
function ReglasSection({ settings, save, saving }) {
  const initial = Array.isArray(settings.group?.rules) ? settings.group.rules : []
  const [rules, setRules] = useState(() => initial.map((x) => ({ title: String(x?.title || ''), body: String(x?.body || '') })))
  const setRule = (i, patch) => setRules((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const moveRule = (i, dir) => setRules((arr) => {
    const j = i + dir
    if (j < 0 || j >= arr.length) return arr
    const next = arr.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
  const invalid = rules.some((x) => x.title.trim().length > 80 || x.body.length > 600)
  const submit = () => {
    if (invalid) return
    const clean = rules
      .map((x) => ({ title: x.title.trim(), body: x.body.trim() }))
      .filter((x) => x.title)
    save({ group: { rules: clean } }, 'Reglas guardadas')
  }
  return (
    <div className="aca-gs-section">
      <SectionHead title="Reglas">Aparecen en la página de Reglas del grupo. Cortas y claras funcionan mejor.</SectionHead>
      {rules.length === 0 && <p className="aca-mi-muted">Todavía no hay reglas.</p>}
      <ol className="aca-gs-rules">
        {rules.map((x, i) => (
          <li key={i} className="aca-gs-rule">
            <span className="aca-gs-levelnum" aria-hidden="true">{i + 1}</span>
            <div className="aca-gs-rule-fields">
              <input
                className="aca-mi-input"
                value={x.title}
                maxLength={80}
                placeholder="Ej.: Respeto ante todo"
                aria-label={`Título de la regla ${i + 1}`}
                onChange={(e) => setRule(i, { title: e.target.value })}
              />
              <textarea
                className="aca-mi-input"
                rows={2}
                value={x.body}
                maxLength={600}
                placeholder="Detalle (opcional)"
                aria-label={`Detalle de la regla ${i + 1}`}
                onChange={(e) => setRule(i, { body: e.target.value })}
              />
            </div>
            <span className="aca-gs-rowacts is-col">
              <IconButton icon="chevronUp" label="Subir" small plain disabled={i === 0} onClick={() => moveRule(i, -1)} />
              <IconButton icon="chevronDown" label="Bajar" small plain disabled={i === rules.length - 1} onClick={() => moveRule(i, 1)} />
              <IconButton icon="trash" label="Quitar regla" small plain onClick={() => setRules((arr) => arr.filter((_, j) => j !== i))} />
            </span>
          </li>
        ))}
      </ol>
      <div className="aca-gs-save">
        <Button icon="plus" disabled={rules.length >= MAX_RULES} onClick={() => setRules((arr) => [...arr, { title: '', body: '' }])}>Agregar regla</Button>
        <Button variant="primary" loading={saving} disabled={invalid} onClick={submit}>Guardar</Button>
      </div>
    </div>
  )
}

/* ---------------- Enlaces ---------------- */
function EnlacesSection({ settings, save, saving }) {
  const initial = Array.isArray(settings.group?.links) ? settings.group.links : []
  const [links, setLinks] = useState(() => initial.slice(0, MAX_LINKS).map((l) => ({ title: String(l?.title || ''), url: String(l?.url || '') })))
  const [errors, setErrors] = useState({})
  const setLink = (i, patch) => setLinks((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const submit = () => {
    const e = {}
    const clean = []
    links.forEach((l, i) => {
      const title = l.title.trim()
      const raw = l.url.trim()
      if (!title && !raw) return
      if (!title) e[i] = 'Falta el texto del enlace.'
      else if (title.length > 40) e[i] = 'El texto: máximo 40 caracteres.'
      const url = safeUrl(withScheme(raw))
      if (!url) e[i] = 'La dirección no es válida (usa https://…).'
      if (!e[i]) clean.push({ title, url })
    })
    setErrors(e)
    if (Object.keys(e).length) return
    save({ group: { links: clean } }, 'Enlaces guardados')
  }
  return (
    <div className="aca-gs-section">
      <SectionHead title="Enlaces">Hasta {MAX_LINKS} enlaces en la tarjeta del grupo (reservar hora, Instagram, WhatsApp…).</SectionHead>
      {links.length === 0 && <p className="aca-mi-muted">Sin enlaces.</p>}
      <ul className="aca-gs-links">
        {links.map((l, i) => (
          <li key={i}>
            <div className="aca-gs-row">
              <input className="aca-mi-input" value={l.title} maxLength={40} placeholder="Texto (ej.: Reserva tu hora)" aria-label={`Texto del enlace ${i + 1}`} onChange={(e) => setLink(i, { title: e.target.value })} />
              <input className="aca-mi-input" value={l.url} inputMode="url" placeholder="https://…" aria-label={`Dirección del enlace ${i + 1}`} onChange={(e) => setLink(i, { url: e.target.value })} />
              <IconButton icon="trash" label="Quitar enlace" small plain onClick={() => setLinks((arr) => arr.filter((_, j) => j !== i))} />
            </div>
            {errors[i] && <span className="pn-field-error">{errors[i]}</span>}
          </li>
        ))}
      </ul>
      <div className="aca-gs-save">
        <Button icon="plus" disabled={links.length >= MAX_LINKS} onClick={() => setLinks((arr) => [...arr, { title: '', url: '' }])}>Agregar enlace</Button>
        <Button variant="primary" loading={saving} onClick={submit}>Guardar</Button>
      </div>
    </div>
  )
}

/* ---------------- Hoja ---------------- */
export default function GroupSettingsSheet({ open, onClose, initialSection = 'general', onSaved }) {
  const { toast } = useAcademy()
  const [section, setSection] = useState(initialSection)
  const [visited, setVisited] = useState(() => new Set([initialSection]))
  const [saving, setSaving] = useState(false)
  const q = useAcademyQuery('mi:admin-settings', () => academyApi('admin-settings'), { enabled: Boolean(open), refetchOnFocus: false, deps: [open] })
  const settings = q.data?.settings

  useEffect(() => {
    if (!open) return
    setSection(initialSection)
    setVisited(new Set([initialSection]))
  }, [open, initialSection])

  const go = (id) => {
    setSection(id)
    setVisited((s) => (s.has(id) ? s : new Set([...s, id])))
  }

  const save = async (patch, msg = 'Cambios guardados') => {
    setSaving(true)
    try {
      const res = await academyApi('admin-settings', { method: 'POST', body: patch })
      if (res?.settings) q.setData?.({ ...(q.data || {}), settings: res.settings })
      toast?.(msg)
      onSaved?.(res?.settings || null)
      return true
    } catch (e) {
      toast?.(errorText(e, 'No se pudo guardar'), 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  const renderSection = (id) => {
    const props = { settings, save, saving }
    switch (id) {
      case 'general': return <GeneralSection {...props} />
      case 'categorias': return <CategoriasSection />
      case 'niveles': return <NivelesSection {...props} />
      case 'complementos': return <ComplementosSection {...props} />
      case 'pestanas': return <PestanasSection {...props} />
      case 'reglas': return <ReglasSection {...props} />
      case 'enlaces': return <EnlacesSection {...props} />
      default: return null
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Configuración"
      subtitle={settings?.group?.name || ACADEMY_BRAND.name}
      icon="settings"
      size="lg"
      bodyClassName="aca-gs-body"
    >
      {q.loading && !settings ? (
        <SkeletonRows rows={5} />
      ) : !settings ? (
        <InlineAlert tone="error" action={{ label: 'Reintentar', onClick: q.refetch }}>
          No se pudo cargar la configuración. {q.error ? errorText(q.error, '') : ''}
        </InlineAlert>
      ) : (
        <div className="aca-gs">
          <nav className="aca-gs-nav" aria-label="Secciones de configuración">
            {GS_SECTIONS.map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                className={cx('aca-gs-navbtn', section === id && 'is-on')}
                aria-current={section === id ? 'page' : undefined}
                onClick={() => go(id)}
              >
                <Icon name={icon} size={16} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="aca-gs-content">
            {GS_SECTIONS.map(([id]) => (visited.has(id) ? (
              <div key={id} hidden={section !== id}>{renderSection(id)}</div>
            ) : null))}
            <Note icon="info" className="aca-gs-foot">Los cambios se ven de inmediato para todos los miembros.</Note>
          </div>
        </div>
      )}
    </Sheet>
  )
}

export { GroupSettingsSheet }
