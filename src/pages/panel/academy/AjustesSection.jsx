import React, { useEffect, useMemo, useRef, useState } from 'react'
import { safeUrl } from '../../../academy/url.js'
import { parseYouTubeId, thumbUrl } from '../../../academy/youtube.js'
import { DEFAULT_LEVEL_NAMES, LEVEL_THRESHOLDS } from '../../../academy/levels.js'
import { ACADEMY_BRAND, ACADEMY_LINKS } from '../../../academy/hostConfig.js'
import {
  Button, Card, Field, IconButton, InlineAlert, List, Note, SaveBar, SavedTick, ToggleRow,
} from '../../../components/panel/index.js'
import { errorText, useAdminLoad } from './adminApi.js'
import { CoverField, LoadBlock } from './ui.jsx'

/* ============================================================
   Ajustes de la Academy (admin-settings, JSON en academy_settings).
   · Campos de texto → borrador + SaveBar (un solo "Guardar").
   · Interruptores → se guardan al tocarlos, cada uno con su propio POST
     parcial (el backend hace deep-merge), igual que el resto del panel.
   Reglas y galería de "Acerca de" se editan dentro de la Academy (Miembros →
   Configuración / Acerca de), que es donde se ven.
   ============================================================ */

const MAX_LINKS = 5
const LEVEL_NAME_MAX = 20

function draftFrom(settings) {
  const g = settings?.group || {}
  const p = settings?.plugins || {}
  const names = Array.isArray(settings?.levels?.names) && settings.levels.names.length === 9 ? settings.levels.names : DEFAULT_LEVEL_NAMES
  return {
    group: {
      name: g.name || '',
      description: g.description || '',
      initials: g.initials || '',
      color: /^#[0-9a-f]{6}$/i.test(g.color || '') ? g.color : '#1c1c1c',
      coverUrl: g.coverUrl || '',
      links: (Array.isArray(g.links) ? g.links : []).map((l) => ({ title: l.title || '', url: l.url || '' })),
    },
    levels: { names: names.map((n) => String(n || '')) },
    plugins: {
      minPostLevel: p.minPostLevel ? String(p.minPostLevel) : '',
      minChatLevel: p.minChatLevel ? String(p.minChatLevel) : '',
      autoDmText: p.autoDm?.text || '',
      welcomeVideo: p.welcomeVideoId ? `https://youtu.be/${p.welcomeVideoId}` : '',
    },
  }
}

export default function AjustesSection({ api, ctx, reloadKey }) {
  const toast = ctx.pushToast
  const settings = useAdminLoad(async () => (await api.call('admin-settings')).settings || {}, [reloadKey])
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [tick, setTick] = useState('')   // clave del interruptor recién guardado
  const [switching, setSwitching] = useState('')

  const base = useMemo(() => (settings.data ? draftFrom(settings.data) : null), [settings.data])
  // Un interruptor guardado cambia `settings` (y con eso `base`): si el
  // barbero tenía texto sin guardar, no se le pisa; solo se sincroniza el
  // borrador cuando no había cambios pendientes.
  const prevBase = useRef(null)
  useEffect(() => {
    if (!base) return
    setDraft((d) => (!d || !prevBase.current || JSON.stringify(d) === JSON.stringify(prevBase.current) ? base : d))
    prevBase.current = base
  }, [base])
  useEffect(() => { if (!tick) return undefined; const t = setTimeout(() => setTick(''), 1800); return () => clearTimeout(t) }, [tick])

  const s = settings.data || {}
  const dirty = draft && base && JSON.stringify(draft) !== JSON.stringify(base)

  const patchGroup = (p) => { setDraft((d) => ({ ...d, group: { ...d.group, ...p } })); setErr('') }
  const patchPlugins = (p) => { setDraft((d) => ({ ...d, plugins: { ...d.plugins, ...p } })); setErr('') }
  const setLevelName = (i, v) => { setDraft((d) => ({ ...d, levels: { names: d.levels.names.map((n, k) => (k === i ? v.slice(0, LEVEL_NAME_MAX) : n)) } })); setErr('') }

  // Validación en el cliente con las mismas reglas que el backend (SPEC
  // §5.6): nombres ≤20 ×9, enlaces que pasen safeUrl, ≤5.
  const problems = useMemo(() => {
    if (!draft) return {}
    const out = {}
    if (!draft.group.name.trim()) out.name = 'Ponle un nombre a la comunidad'
    if (draft.group.initials && !/^[A-Za-zÁÉÍÓÚÑáéíóúñ0-9]{1,3}$/.test(draft.group.initials.trim())) out.initials = 'Hasta 3 letras o números'
    draft.group.links.forEach((l, i) => {
      if (!l.title.trim() && !l.url.trim()) return
      if (!l.title.trim()) out[`link${i}`] = 'Falta el nombre'
      else if (!safeUrl(l.url.trim())) out[`link${i}`] = 'Enlace inválido (https://…)'
    })
    draft.levels.names.forEach((n, i) => { if (!n.trim()) out[`level${i}`] = 'Obligatorio' })
    const vid = draft.plugins.welcomeVideo.trim()
    if (vid && !parseYouTubeId(vid)) out.welcome = 'No reconocemos ese enlace de YouTube'
    return out
  }, [draft])
  const valid = Object.keys(problems).length === 0

  const post = (body) => api.call('admin-settings', { method: 'POST', body })

  const save = async () => {
    if (!draft || !valid || saving) return
    setSaving(true)
    setErr('')
    try {
      const d = draft
      const vid = d.plugins.welcomeVideo.trim()
      const body = {
        group: {
          name: d.group.name.trim().slice(0, 60),
          description: d.group.description.trim().slice(0, 2000),
          initials: d.group.initials.trim().toUpperCase().slice(0, 3),
          color: d.group.color,
          coverUrl: d.group.coverUrl.trim() || null,
          links: d.group.links.filter((l) => l.title.trim() && l.url.trim()).slice(0, MAX_LINKS).map((l) => ({ title: l.title.trim().slice(0, 40), url: safeUrl(l.url.trim()) })),
        },
        levels: { names: d.levels.names.map((n) => n.trim().slice(0, LEVEL_NAME_MAX)) },
        plugins: {
          minPostLevel: d.plugins.minPostLevel ? Number(d.plugins.minPostLevel) : null,
          minChatLevel: d.plugins.minChatLevel ? Number(d.plugins.minChatLevel) : null,
          autoDm: { text: d.plugins.autoDmText.trim().slice(0, 1000) },
          welcomeVideoId: vid ? parseYouTubeId(vid) : null,
        },
      }
      const out = await post(body)
      prevBase.current = null
      setDraft(null)
      settings.setData(out.settings || deepMerge(s, body))
      toast('✓', 'Ajustes de la Academy guardados')
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (key, body) => {
    setSwitching(key)
    try {
      const out = await post(body)
      settings.setData((prev) => out.settings || deepMerge(prev || {}, body))
      setTick(key)
    } catch (e) {
      toast('⚠', errorText(e), 5000)
    } finally {
      setSwitching('')
    }
  }

  const tabs = s.tabs || {}
  const autoDmOn = s.plugins?.autoDm?.enabled !== false
  const syncOn = s.sync?.enabled !== false
  const autoprovision = s.autoprovision !== false
  const welcomeId = draft ? parseYouTubeId(draft.plugins.welcomeVideo.trim()) : null

  return (
    <LoadBlock loading={settings.loading || (settings.data && !draft)} error={settings.error} onRetry={settings.reload} rows={6}>
      {draft && (
        <div className="pn-stack is-lg pn-aca-settings">
          <Card title="Comunidad" subtitle="Lo que ven los miembros arriba a la izquierda y en «Acerca de».">
            <div className="pn-stack is-lg">
              <div className="pn-form-row">
                <Field label="Nombre" error={problems.name}>
                  <input className="input" value={draft.group.name} maxLength={60} onChange={(e) => patchGroup({ name: e.target.value })} />
                </Field>
                <div className="pn-form-row is-keep">
                  <Field label="Iniciales" error={problems.initials} hint="En el ícono">
                    <input className="input" value={draft.group.initials} maxLength={3} onChange={(e) => patchGroup({ initials: e.target.value.toUpperCase() })} />
                  </Field>
                  <Field label="Color">
                    <span className="pn-aca-color">
                      <input type="color" value={draft.group.color} onChange={(e) => patchGroup({ color: e.target.value })} aria-label="Color del ícono" />
                      <span className="pn-aca-color-tile" style={{ background: draft.group.color }}>{(draft.group.initials || ACADEMY_BRAND.initials).slice(0, 3)}</span>
                    </span>
                  </Field>
                </div>
              </div>
              <Field label="Descripción" optional hint="Aparece en «Acerca de» y en la tarjeta del grupo.">
                <textarea className="input" rows={4} maxLength={2000} value={draft.group.description} onChange={(e) => patchGroup({ description: e.target.value })} />
              </Field>
              <CoverField label="Portada" value={draft.group.coverUrl} onChange={(v) => patchGroup({ coverUrl: v })} kind="portada" api={api} />

              <div className="pn-stack">
                <div className="pn-between">
                  <span className="pn-field-label">Enlaces</span>
                  <Button size="sm" variant="plain" icon="plus" disabled={draft.group.links.length >= MAX_LINKS} onClick={() => patchGroup({ links: [...draft.group.links, { title: '', url: '' }] })}>Agregar</Button>
                </div>
                {draft.group.links.length === 0 ? <p className="pn-muted">Ej.: «Reserva tu hora» → {`${ACADEMY_BRAND.siteUrl}${ACADEMY_LINKS.booking}`}</p> : draft.group.links.map((l, i) => (
                  <div key={i} className="pn-aca-resource">
                    <input className="input" placeholder="Nombre" value={l.title} maxLength={40} onChange={(e) => patchGroup({ links: draft.group.links.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} />
                    <input className="input" placeholder="https://…" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={l.url} onChange={(e) => patchGroup({ links: draft.group.links.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)) })} />
                    <IconButton small plain icon="trash" label="Quitar enlace" onClick={() => patchGroup({ links: draft.group.links.filter((_, k) => k !== i) })} />
                    {problems[`link${i}`] && <span className="pn-field-error">{problems[`link${i}`]}</span>}
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Niveles" subtitle="Nombres de los 9 niveles. Los puntos salen de los «me gusta» que recibe cada miembro.">
            <div className="pn-aca-levels">
              {draft.levels.names.map((n, i) => (
                <Field key={i} label={`Nivel ${i + 1}`} hint={`${LEVEL_THRESHOLDS?.[i] ?? 0} pts`} error={problems[`level${i}`]}>
                  <input className="input" value={n} maxLength={LEVEL_NAME_MAX} onChange={(e) => setLevelName(i, e.target.value)} />
                </Field>
              ))}
            </div>
          </Card>

          <Card title="Complementos">
            <div className="pn-stack is-lg">
              <div className="pn-form-row">
                <Field label="Nivel mínimo para publicar" optional hint="Vacío = todos pueden publicar">
                  <select className="input" value={draft.plugins.minPostLevel} onChange={(e) => patchPlugins({ minPostLevel: e.target.value })}>
                    <option value="">Todos</option>
                    {[2, 3, 4, 5].map((n) => <option key={n} value={n}>Nivel {n}</option>)}
                  </select>
                </Field>
                <Field label="Nivel mínimo para chatear" optional hint="El staff siempre puede">
                  <select className="input" value={draft.plugins.minChatLevel} onChange={(e) => patchPlugins({ minChatLevel: e.target.value })}>
                    <option value="">Todos</option>
                    {[2, 3, 4, 5].map((n) => <option key={n} value={n}>Nivel {n}</option>)}
                  </select>
                </Field>
              </div>

              <Card flush>
                <List>
                  <ToggleRow
                    title={<>Mensaje de bienvenida automático <SavedTick show={tick === 'autoDm'} /></>}
                    description="Cada miembro nuevo recibe un mensaje directo del propietario."
                    checked={autoDmOn}
                    disabled={switching === 'autoDm'}
                    onChange={(v) => toggle('autoDm', { plugins: { autoDm: { enabled: v } } })}
                  />
                </List>
              </Card>
              {autoDmOn && (
                <Field label="Texto del mensaje" hint="#NOMBRE# = nombre del miembro · #GRUPO# = nombre de la comunidad">
                  <textarea className="input" rows={3} maxLength={1000} value={draft.plugins.autoDmText} onChange={(e) => patchPlugins({ autoDmText: e.target.value })} />
                </Field>
              )}

              <Field label="Video de bienvenida" optional error={problems.welcome} hint="Se muestra a los miembros nuevos. YouTube no listado.">
                <input className="input" value={draft.plugins.welcomeVideo} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://youtu.be/…" onChange={(e) => patchPlugins({ welcomeVideo: e.target.value })} />
              </Field>
              {welcomeId && <div className="pn-aca-video is-sm"><img src={thumbUrl(welcomeId)} alt="Miniatura del video de bienvenida" loading="lazy" /></div>}
            </div>
          </Card>

          <Card title="Pestañas" subtitle="Cursos, Miembros y Acerca de están siempre." flush>
            <List>
              {[
                ['comunidad', 'Comunidad', 'Publicaciones, comentarios y encuestas.'],
                ['calendario', 'Calendario', 'Eventos en vivo, con recordatorios.'],
                ['clasificacion', 'Clasificación', 'Niveles y tablas de puntos.'],
              ].map(([key, title, description]) => (
                <ToggleRow
                  key={key}
                  title={<>{title} <SavedTick show={tick === `tab-${key}`} /></>}
                  description={description}
                  checked={tabs[key] !== false}
                  disabled={switching === `tab-${key}`}
                  onChange={(v) => toggle(`tab-${key}`, { tabs: { [key]: v } })}
                />
              ))}
            </List>
          </Card>

          <Card title="Funcionamiento" flush>
            <List>
              <ToggleRow
                title={<>Chat y avisos en tiempo real <SavedTick show={tick === 'sync'} /></>}
                description="Revisa mensajes nuevos mientras alguien tiene la Academy abierta. Apagado, los contadores se actualizan solo al entrar (ahorra base de datos)."
                checked={syncOn}
                disabled={switching === 'sync'}
                onChange={(v) => toggle('sync', { sync: { enabled: v } })}
              />
              <ToggleRow
                title={<>Dar acceso automático al pagar <SavedTick show={tick === 'autoprovision'} /></>}
                description="Cuando Mercado Pago confirma un pago, se crea el acceso y se envía la contraseña temporal sin que hagas nada. Déjalo encendido salvo que quieras revisar cada pago a mano."
                checked={autoprovision}
                disabled={switching === 'autoprovision'}
                onChange={(v) => toggle('autoprovision', { autoprovision: v })}
              />
            </List>
          </Card>

          {err && <InlineAlert tone="error">{err}</InlineAlert>}
          {!valid && dirty && <Note icon="alert">Hay campos con errores: corrígelos para poder guardar.</Note>}

          <SaveBar
            visible={Boolean(dirty)}
            saving={saving}
            onSave={valid ? save : () => {}}
            onDiscard={() => { setDraft(base); setErr('') }}
            message={valid ? 'Tienes cambios sin guardar' : 'Revisa los campos marcados'}
          />
        </div>
      )}
    </LoadBlock>
  )
}

function deepMerge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b
  const out = { ...(a && typeof a === 'object' ? a : {}) }
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v
  return out
}
