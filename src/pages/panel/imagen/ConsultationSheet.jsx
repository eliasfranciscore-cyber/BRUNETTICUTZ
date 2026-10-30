import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sheet, Button, IconButton, Field, Chip, InlineAlert, ConfirmDialog, ActionMenu, SkeletonRows, ChoiceGrid, List, ToggleRow, Note,
} from '../../../components/panel/index.js'
import { Icon } from '../../../components/ui.jsx'
import {
  MODALITIES, ANGLES, INTAKE, SKULL, HAIR, HAIR_FROM_INTAKE, REC_KINDS, CATEGORIES, KIND_GROUP, labelOf,
} from '../../../imagen/vocab.js'
import { photoToJpeg } from '../../../imagen/photo.js'
import {
  API, EMAIL_RE, SHAPES, shapeById, faceSnapshot, FaceGlyph, fmtDay, fmtStamp, clp, addDaysKey, todayKey,
  StatusChip, PaymentChip, modalityLabel, useAuthedImage, openAuthedPdf,
} from './shared.jsx'

/* Ficha de una asesoría: datos, lo que contó el cliente, fotos, diagnóstico,
   recomendaciones (sugeridas → aprobadas), cierre e informes versionados. */

const EDITABLE = ['name', 'phone', 'email', 'age', 'modality', 'visitDate', 'intake', 'diagnosis', 'nextFollowup', 'notes']
const pickEditable = (c) => Object.fromEntries(EDITABLE.map((k) => [k, c?.[k] ?? (k === 'intake' || k === 'diagnosis' ? {} : '')]))

const CUT_FIELDS = [['largo', 'Largo'], ['volumen', 'Volumen'], ['textura', 'Textura'], ['degradado', 'Degradado'], ['lados', 'Lados'], ['mantenimiento', 'Mantenimiento']]
const PRODUCT_FIELDS = [['cantidad', 'Cantidad'], ['aplicacion', 'Cómo aplicarlo'], ['modoDeUso', 'Modo de uso'], ['frecuencia', 'Frecuencia']]
const PRODUCT_KINDS = REC_KINDS.filter((k) => k.product).map((k) => k.id)
const fieldsOf = (kind) => (kind === 'corte' ? CUT_FIELDS : PRODUCT_KINDS.includes(kind) ? PRODUCT_FIELDS : [])

const EVENT_TEXT = {
  creada: 'Creó la asesoría', checkout: 'Inició el pago en la web', pago: 'Pago confirmado', correo_formulario: 'Se le envió el enlace del formulario',
  consentimiento: 'Consentimiento para guardar fotos', foto: 'Subió una foto', foto_borrada: 'Borró una foto', datos_enviados: 'Envió sus datos',
  diagnostico: 'Registró el diagnóstico', sugerencias: 'Generó sugerencias', rec_aprobada: 'Aprobó', rec_descartada: 'Descartó',
  rec_sugerida: 'Volvió a sugerida', rec_editada: 'Editó y aprobó', rec_manual: 'Agregó a mano', rec_borrada: 'Borró',
  informe: 'Generó el informe', envio_correo: 'Envió el informe por correo', envio_whatsapp: 'Compartió el informe por WhatsApp', estado: 'Cambió el estado',
}
const ACTOR = { cliente: 'Cliente', sistema: 'Sistema' }
function eventLine(e) {
  const d = e.detail || {}
  const extra = d.title ? `: ${d.title}` : d.angle ? ` (${labelOf(ANGLES, d.angle).toLowerCase()})` : d.version ? ` v${d.version}` : d.face ? ` (${d.face})` : d.amount != null ? ` · ${clp(d.amount)}` : d.to ? ` → ${d.to}` : ''
  return `${EVENT_TEXT[e.action] || e.action}${extra}`
}

export default function ConsultationSheet({ id, onClose, call, authHeaders, toast, onChanged, onDeleted }) {
  const open = Boolean(id)
  const [data, setData] = useState(null) // { consultation, photos, recs, reports, events }
  const [draft, setDraft] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState([])
  const [catalog, setCatalog] = useState(null)
  const [confirm, setConfirm] = useState(null) // { kind, report? }
  const loadedId = useRef(null)

  useEffect(() => {
    if (!open) return
    if (loadedId.current === id && data) return
    let live = true
    setData(null); setDraft(null); setDirty(false); setError(''); setWarnings([])
    loadedId.current = id
    call(`${API}&id=${id}`)
      .then((json) => { if (live) { setData(json); setDraft(pickEditable(json.consultation)) } })
      .catch((err) => { if (live) setError(err.message) })
    if (!catalog) call(`${API}&catalog=1`).then((json) => live && setCatalog(json.products || [])).catch(() => {})
    return () => { live = false }
  }, [open, id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!open) loadedId.current = null }, [open])

  const c = data?.consultation
  const set = (patch) => { setDraft((cur) => ({ ...cur, ...patch })); setDirty(true) }
  const setIn = (key, patch) => set({ [key]: { ...(draft?.[key] || {}), ...patch } })
  const setDx = (part, patch) => set({ diagnosis: { ...(draft?.diagnosis || {}), [part]: { ...(draft?.diagnosis?.[part] || {}), ...patch } } })

  const apply = (json) => {
    setData((cur) => ({ ...cur, ...json }))
    if (json.consultation) { setDraft(pickEditable(json.consultation)); setDirty(false); onChanged(json.consultation) }
  }
  const run = (kind, fn) => async (...args) => {
    setBusy(kind); setError('')
    try { await fn(...args) } catch (err) { setError(err.message || 'Algo falló.') } finally { setBusy('') }
  }
  const refresh = async () => apply(await call(`${API}&id=${id}`))

  async function save({ quiet = false } = {}) {
    if (!dirty) return
    const json = await call(`${API}&id=${id}`, { method: 'PATCH', body: draft })
    apply(json)
    if (!quiet) toast('✓', 'Asesoría guardada')
  }
  const onSave = run('save', () => save())

  const onSuggest = run('suggest', async () => {
    await save({ quiet: true })
    const json = await call(`${API}&id=${id}&suggest=1`, { method: 'POST' })
    setWarnings(json.warnings || [])
    await refresh()
    toast('✨', 'Sugerencias listas: revísalas una por una')
  })

  const onGenerate = run('generate', async () => {
    await save({ quiet: true })
    const json = await call(`${API}&id=${id}&generate=1`, { method: 'POST' })
    await refresh()
    toast('📄', `Informe v${json.report.version} generado`)
  })

  const onPreview = run('preview', async () => {
    await save({ quiet: true })
    await openAuthedPdf(`${API}&id=${id}&preview=1`, authHeaders)
  })

  const recAction = (rec, body) => run(`rec-${rec.id}`, async () => {
    const json = await call(`${API}&rec=${rec.id}`, { method: 'PATCH', body })
    setData((cur) => ({ ...cur, recs: cur.recs.map((r) => (r.id === rec.id ? json.rec : r)) }))
  })()
  const recDelete = (rec) => run(`rec-${rec.id}`, async () => {
    await call(`${API}&rec=${rec.id}`, { method: 'DELETE' })
    setData((cur) => ({ ...cur, recs: cur.recs.filter((r) => r.id !== rec.id) }))
  })()
  const recAdd = (body) => run('rec-add', async () => {
    const json = await call(`${API}&id=${id}&rec=1`, { method: 'POST', body })
    setData((cur) => ({ ...cur, recs: [...cur.recs, json.rec] }))
  })()

  const onPhoto = (angle, file) => run(`photo-${angle}`, async () => {
    if (!file) return
    const dataUrl = await photoToJpeg(file)
    await call(`${API}&upload=1`, { method: 'POST', body: { id, angle, dataUrl, consent: Boolean(c?.consentAt) || undefined } })
    await refresh()
  })()
  const onPhotoDelete = (photo) => run(`photo-${photo.angle}`, async () => {
    await call(`${API}&photo=${photo.id}`, { method: 'DELETE' })
    await refresh()
  })()

  const onPaid = (body) => run('paid', async () => {
    const json = await call(`${API}&id=${id}&paid=1`, { method: 'POST', body })
    setData((cur) => ({ ...cur, consultation: { ...cur.consultation, ...json.consultation } }))
    onChanged(json.consultation)
    toast('✓', 'Pago registrado')
  })()

  const onStatus = (status) => run('status', async () => {
    const json = await call(`${API}&id=${id}`, { method: 'PATCH', body: { ...draft, status } })
    apply(json)
    setConfirm(null)
  })()

  const onDelete = run('delete', async () => {
    await call(`${API}&id=${id}`, { method: 'DELETE' })
    setConfirm(null)
    toast('🗑️', 'Asesoría y fotos eliminadas')
    onDeleted(id)
  })

  const onSend = (report) => run('send', async () => {
    const json = await call(`${API}&report=${report.id}&send=1`, { method: 'POST', body: { email: draft.email } })
    setConfirm(null)
    await refresh()
    toast('✉️', `Informe v${json.report.version} enviado a ${json.report.sentTo}`, 4000)
  })()

  const onShare = (report) => run('share', async () => {
    const win = window.open('', '_blank')
    try {
      const json = await call(`${API}&report=${report.id}&share=1`, { method: 'POST' })
      if (win) win.location.href = json.waUrl
      await refresh()
    } catch (err) {
      win?.close()
      throw err
    }
  })()

  const copyForm = async () => {
    try { await navigator.clipboard.writeText(c.formUrl); toast('🔗', 'Enlace del formulario copiado') } catch { toast('⚠️', c.formUrl, 6000) }
  }

  const close = () => { if (!busy) onClose() }
  const approvedCut = data?.recs?.some((r) => r.kind === 'corte' && r.status === 'aprobada')
  const canGenerate = Boolean(draft?.diagnosis?.face?.id) && approvedCut
  const title = c ? (c.name || 'Asesoría sin nombre') : 'Asesoría'
  const subtitle = c ? [modalityLabel(c.modality), fmtDay(c.visitDate) || fmtStamp(c.createdAt)].filter(Boolean).join(' · ') : null

  return (
    <>
      <Sheet
        open={open}
        onClose={close}
        dismissible={!busy}
        size="lg"
        icon="sparkles"
        title={title}
        subtitle={subtitle}
        headActions={c ? (
          <ActionMenu label="Más opciones" title={title} items={[
            c.status === 'cancelada'
              ? { label: 'Reabrir asesoría', icon: 'refresh', onClick: () => onStatus('reabrir') }
              : { label: 'Cancelar asesoría', icon: 'close', onClick: () => setConfirm({ kind: 'cancel' }) },
            { label: 'Eliminar asesoría y fotos', icon: 'trash', danger: true, hint: 'Borra sus datos, fotos e informes', onClick: () => setConfirm({ kind: 'delete' }) },
          ]} />
        ) : null}
        footer={c ? (
          <>
            <Button variant="secondary" icon="eye" onClick={onPreview} loading={busy === 'preview'} disabled={Boolean(busy)}>Vista previa</Button>
            {dirty && <Button variant="secondary" onClick={onSave} loading={busy === 'save'} disabled={Boolean(busy)}>Guardar</Button>}
            <Button variant="primary" icon="receipt" onClick={onGenerate} loading={busy === 'generate'} disabled={Boolean(busy) || !canGenerate}
              title={canGenerate ? undefined : 'Falta el tipo de rostro o un corte aprobado'}>
              Generar asesoría personalizada
            </Button>
          </>
        ) : null}
      >
        {!data || !draft ? (error ? <InlineAlert tone="error">{error}</InlineAlert> : <SkeletonRows rows={6} />) : (
          <div className="pn-form pn-img-form">
            {error && <InlineAlert tone="error" onClose={() => setError('')}>{error}</InlineAlert>}

            <StatusStrip c={c} busy={busy} onPaid={onPaid} copyForm={copyForm} />

            <Section n={1} title="Cliente y asesoría">
              <div className="pn-form-row">
                <Field label="Nombre" htmlFor="img-name">
                  <input id="img-name" className="input" value={draft.name || ''} maxLength={200} onChange={(e) => set({ name: e.target.value })} />
                </Field>
                <Field label="WhatsApp" htmlFor="img-phone">
                  <input id="img-phone" className="input" inputMode="tel" value={draft.phone || ''} maxLength={15} onChange={(e) => set({ phone: e.target.value })} placeholder="9 1234 5678" />
                </Field>
              </div>
              <div className="pn-form-row">
                <Field label="Correo" htmlFor="img-email" error={draft.email && !EMAIL_RE.test(draft.email) ? 'Revisa el correo' : null} hint={!draft.email ? 'Se necesita para enviarle el informe' : null}>
                  <input id="img-email" className="input" type="email" inputMode="email" value={draft.email || ''} maxLength={300} onChange={(e) => set({ email: e.target.value })} />
                </Field>
                <Field label="Edad" htmlFor="img-age" optional>
                  <input id="img-age" className="input" inputMode="numeric" value={draft.age ?? ''} maxLength={3} onChange={(e) => set({ age: e.target.value.replace(/\D/g, '') })} />
                </Field>
              </div>
              <div className="pn-form-row">
                <Field label="Modalidad">
                  <ChoiceGrid ariaLabel="Modalidad" cols={2} value={draft.modality} onChange={(v) => set({ modality: v })}
                    options={MODALITIES.map((m) => ({ value: m.id, label: m.label }))} />
                </Field>
                <Field label="Fecha de la asesoría" htmlFor="img-visit" optional>
                  <input id="img-visit" className="input" type="date" value={draft.visitDate || ''} onChange={(e) => set({ visitDate: e.target.value })} />
                </Field>
              </div>
            </Section>

            <Section n={2} title="Lo que contó el cliente" note={c.intakeSubmittedAt ? `Enviado por el cliente el ${fmtStamp(c.intakeSubmittedAt, true)}` : 'Lo completa el cliente en su formulario, o tú en la asesoría presencial. Es lo que declara: no es diagnóstico.'}>
              <Field label="Objetivo de imagen" htmlFor="img-goal">
                <textarea id="img-goal" className="input" rows={2} maxLength={800} value={draft.intake.goal || ''} onChange={(e) => setIn('intake', { goal: e.target.value })} />
              </Field>
              <div className="pn-img-grid">
                {['style', 'styleTime', 'finish', 'length', 'washFreq', 'water', 'drying'].map((k) => (
                  <Field key={k} label={INTAKE[k].label} htmlFor={`img-in-${k}`}>
                    <select id={`img-in-${k}`} className="input" value={draft.intake[k] || ''} onChange={(e) => setIn('intake', { [k]: e.target.value || null })}>
                      <option value="">—</option>
                      {INTAKE[k].options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
              <Field label={INTAKE.needs.label}>
                <TagPicker options={INTAKE.needs.options} value={draft.intake.needs || []} onChange={(needs) => setIn('intake', { needs })} />
              </Field>
              <div className="pn-form-row">
                <Field label="Productos que usa hoy" htmlFor="img-current" optional>
                  <textarea id="img-current" className="input" rows={2} maxLength={600} value={draft.intake.currentProducts || ''} onChange={(e) => setIn('intake', { currentProducts: e.target.value })} />
                </Field>
                <Field label="Hábitos y preferencias" htmlFor="img-habits" optional>
                  <textarea id="img-habits" className="input" rows={2} maxLength={600} value={draft.intake.habits || ''} onChange={(e) => setIn('intake', { habits: e.target.value })} placeholder="Deporte, gorro o casco, trabajo…" />
                </Field>
              </div>
            </Section>

            <Section n={3} title="Fotografías" note="Frontal, ambos perfiles y posterior (más la superior si hace falta). Se guardan en privado.">
              {!c.consentAt ? (
                <List>
                  <ToggleRow title="El cliente autorizó guardar sus fotos" description="Para usarlas solo en esta asesoría. Queda registrado con la fecha." checked={false}
                    onChange={(v) => v && run('consent', async () => { apply(await call(`${API}&id=${id}`, { method: 'PATCH', body: { ...draft, consent: true } })) })()} />
                </List>
              ) : (
                <p className="pn-img-muted"><Icon name="shield" size={13} /> Consentimiento {c.consentBy === 'cliente' ? 'del cliente' : 'registrado en el local'} · {fmtStamp(c.consentAt, true)}</p>
              )}
              <div className="pn-img-photos">
                {ANGLES.map((a) => (
                  <PhotoSlot key={a.id} angle={a} photo={data.photos.find((p) => p.angle === a.id)} authHeaders={authHeaders}
                    disabled={!c.consentAt || Boolean(busy)} busy={busy === `photo-${a.id}`}
                    onPick={(f) => onPhoto(a.id, f)} onDelete={onPhotoDelete} />
                ))}
              </div>
            </Section>

            <Section n={4} title="Diagnóstico" note={c.diagnosedAt ? `Registrado por Bruno · ${fmtStamp(c.diagnosedAt, true)}` : 'Lo registra Bruno. Es la base de las sugerencias.'}>
              <h4 className="pn-img-sub">Tipo de rostro</h4>
              <div className="pn-img-shapes" role="radiogroup" aria-label="Tipo de rostro">
                {SHAPES.map((s) => {
                  const on = draft.diagnosis?.face?.id === s.id
                  return (
                    <button key={s.id} type="button" role="radio" aria-checked={on} className={`pn-img-shape${on ? ' is-on' : ''}`}
                      onClick={() => set({ diagnosis: { ...draft.diagnosis, face: faceSnapshot(shapeById(s.id)) } })}>
                      <FaceGlyph path={s.path} />
                      <span>{s.name}</span>
                    </button>
                  )
                })}
              </div>
              {draft.diagnosis?.face && (
                <div className="pn-img-diag">
                  <p className="pn-img-tag">{draft.diagnosis.face.tagline}</p>
                  <p>{draft.diagnosis.face.diagnosis}</p>
                </div>
              )}
              <h4 className="pn-img-sub">Cráneo y proporciones</h4>
              <div className="pn-img-grid">
                {Object.entries(SKULL).map(([k, def]) => (
                  <Field key={k} label={def.label} htmlFor={`img-sk-${k}`}>
                    <select id={`img-sk-${k}`} className="input" value={draft.diagnosis?.skull?.[k] || ''} onChange={(e) => setDx('skull', { [k]: e.target.value || null })}>
                      <option value="">—</option>
                      {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
              <Field label="Notas de estructura" htmlFor="img-sk-notes" optional>
                <input id="img-sk-notes" className="input" maxLength={800} value={draft.diagnosis?.skull?.notes || ''} onChange={(e) => setDx('skull', { notes: e.target.value })} />
              </Field>
              <h4 className="pn-img-sub">Cabello</h4>
              <div className="pn-img-grid">
                {Object.entries(HAIR).map(([k, def]) => {
                  const said = (HAIR_FROM_INTAKE[k] || []).filter((n) => (draft.intake.needs || []).includes(n))
                  return (
                    <Field key={k} label={def.label} htmlFor={`img-hr-${k}`} hint={said.length ? `El cliente: ${said.join(', ').toLowerCase()}` : null}>
                      <select id={`img-hr-${k}`} className="input" value={draft.diagnosis?.hair?.[k] || ''} onChange={(e) => setDx('hair', { [k]: e.target.value || null })}>
                        <option value="">—</option>
                        {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </Field>
                  )
                })}
              </div>
              <Field label="Observaciones profesionales" htmlFor="img-obs" optional hint="Salen en el informe">
                <textarea id="img-obs" className="input" rows={3} maxLength={1500} value={draft.diagnosis?.observations || ''}
                  onChange={(e) => set({ diagnosis: { ...draft.diagnosis, observations: e.target.value } })} />
              </Field>
            </Section>

            <Section n={5} title="Recomendaciones" note="La app sugiere a partir del diagnóstico y del catálogo; al informe solo entra lo que apruebas."
              action={<Button size="sm" variant="secondary" icon="sparkles" onClick={onSuggest} loading={busy === 'suggest'} disabled={Boolean(busy) || !draft.diagnosis?.face?.id}>
                {data.recs.some((r) => r.source === 'regla') ? 'Volver a sugerir' : 'Sugerir'}
              </Button>}>
              {!draft.diagnosis?.face?.id && <Note>Elige el tipo de rostro en el diagnóstico para poder sugerir.</Note>}
              {warnings.length > 0 && (
                <InlineAlert tone="warn" title="Revisa el catálogo" onClose={() => setWarnings([])}>
                  <ul className="pn-img-warn">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </InlineAlert>
              )}
              {REC_KINDS.map((k) => (
                <RecGroup key={k.id} kind={k} recs={data.recs.filter((r) => r.kind === k.id)} catalog={catalog || []}
                  busy={busy} onAction={recAction} onDelete={recDelete} onAdd={recAdd} />
              ))}
            </Section>

            <Section n={6} title="Cierre del informe">
              <Field label="Próximo seguimiento sugerido" htmlFor="img-follow" optional>
                <div className="pn-img-follow">
                  <input id="img-follow" className="input" type="date" value={draft.nextFollowup || ''} min={todayKey()} onChange={(e) => set({ nextFollowup: e.target.value })} />
                  {[3, 4, 6].map((w) => (
                    <Button key={w} size="sm" variant="plain" onClick={() => set({ nextFollowup: addDaysKey(draft.visitDate || todayKey(), w * 7) })}>+{w} sem</Button>
                  ))}
                </div>
              </Field>
              <Field label="Nota personal de Bruno" htmlFor="img-notes" optional hint="Va firmada al final del informe">
                <textarea id="img-notes" className="input" rows={3} maxLength={2000} value={draft.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            </Section>

            <Section n={7} title="Informes">
              {data.reports.length === 0 ? (
                <p className="pn-img-muted">Todavía no hay informes. Cuando tengas el diagnóstico y las recomendaciones aprobadas, toca <b>Generar asesoría personalizada</b>.</p>
              ) : (
                <ul className="pn-img-reports">
                  {data.reports.map((r) => (
                    <li key={r.id}>
                      <div className="pn-img-report-main">
                        <strong>Informe v{r.version}</strong>
                        <span>{fmtStamp(r.createdAt, true)}{r.sentAt ? ` · enviado a ${r.sentTo} el ${fmtStamp(r.sentAt)}` : ' · sin enviar'}</span>
                      </div>
                      <div className="pn-img-report-actions">
                        <IconButton icon="eye" label={`Ver informe v${r.version}`} onClick={() => run('open', () => openAuthedPdf(`${API}&report=${r.id}&pdf=1`, authHeaders))()} />
                        <IconButton icon="whatsapp" label="Compartir por WhatsApp" onClick={() => onShare(r)} disabled={Boolean(busy)} />
                        <Button size="sm" variant="secondary" icon="send" onClick={() => setConfirm({ kind: 'send', report: r })} disabled={Boolean(busy) || !EMAIL_RE.test(draft.email || '')}>
                          {r.sentAt ? 'Reenviar' : 'Enviar'}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section n={8} title="Historial">
              <ul className="pn-img-events">
                {data.events.map((e) => (
                  <li key={e.id}>
                    <span className="pn-img-ev-who">{e.actor === 'barbero' ? String(e.actorName || 'Bruno').split(' ')[0] : ACTOR[e.actor] || e.actor}</span>
                    <span className="pn-img-ev-what">{eventLine(e)}</span>
                    <span className="pn-img-ev-when">{fmtStamp(e.at, true)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirm?.kind === 'send'}
        icon="send"
        title={confirm?.report?.sentAt ? 'Reenviar el informe' : 'Enviar el informe'}
        message={`Le llega a ${String(draft?.email || '').trim()} un correo con el informe v${confirm?.report?.version || ''} en PDF.`}
        confirmLabel="Enviar"
        busy={busy === 'send'}
        onConfirm={() => onSend(confirm.report)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'cancel'}
        title="Cancelar asesoría"
        message="Queda en la lista como cancelada, con todos sus datos. La puedes reabrir después."
        confirmLabel="Cancelar asesoría"
        cancelLabel="Volver"
        busy={busy === 'status'}
        onConfirm={() => onStatus('cancelada')}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        tone="danger"
        title="Eliminar asesoría y fotos"
        message="Se borran para siempre sus datos, fotos e informes (por ejemplo, si el cliente pide eliminar su información). Un correo ya enviado no se puede recuperar."
        confirmLabel="Eliminar"
        busy={busy === 'delete'}
        onConfirm={onDelete}
        onCancel={() => setConfirm(null)}
      />
    </>
  )
}

function Section({ n, title, note, action, children }) {
  return (
    <section className="pn-img-sec">
      <div className="pn-img-sec-head">
        <h3 className="pn-img-h"><span className="pn-img-n">{n}</span>{title}</h3>
        {action}
      </div>
      {note && <p className="pn-img-muted">{note}</p>}
      {children}
    </section>
  )
}

function StatusStrip({ c, busy, onPaid, copyForm }) {
  const [paying, setPaying] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('transferencia')
  const waForm = c.phone && c.formUrl
    ? `https://wa.me/56${c.phone}?text=${encodeURIComponent(`Hola ${String(c.name || '').split(' ')[0]}, para preparar tu asesoría de imagen completa este formulario (tus datos, hábitos y fotos): ${c.formUrl}`)}`
    : null
  return (
    <div className="pn-img-strip">
      <div className="pn-img-strip-row">
        <StatusChip status={c.status} />
        <PaymentChip c={c} />
        {c.source === 'web' && <Chip tone="info" icon="globe">Comprada en la web</Chip>}
        {c.paymentMethod && c.paymentStatus === 'pagada' && <span className="pn-img-muted">{c.paymentMethod === 'mercadopago' ? 'Mercado Pago' : c.paymentMethod}{c.paidAt ? ` · ${fmtStamp(c.paidAt)}` : ''}</span>}
      </div>
      {c.paymentStatus !== 'pagada' && (paying ? (
        <div className="pn-img-pay">
          <input className="input" inputMode="numeric" placeholder="Monto" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} aria-label="Monto pagado" />
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Medio de pago">
            <option value="transferencia">Transferencia</option>
            <option value="efectivo">Efectivo</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="reserva">Cobrada con la reserva</option>
          </select>
          <Button size="sm" variant="primary" loading={busy === 'paid'} disabled={!amount} onClick={() => onPaid({ amount: Number(amount), method })}>Registrar</Button>
          <Button size="sm" variant="plain" onClick={() => setPaying(false)}>Cancelar</Button>
        </div>
      ) : (
        <Button size="sm" variant="plain" icon="cash" onClick={() => setPaying(true)}>Marcar pagada</Button>
      ))}
      {!c.intakeSubmittedAt && c.formUrl && c.status !== 'cancelada' && (
        <div className="pn-img-strip-row">
          <span className="pn-img-muted">Formulario del cliente:</span>
          <Button size="sm" variant="plain" icon="link" onClick={copyForm}>Copiar enlace</Button>
          {waForm && <a className="pn-btn pn-btn--plain pn-btn--sm" href={waForm} target="_blank" rel="noopener noreferrer"><Icon name="whatsapp" size={14} /><span className="pn-btn-label">Mandar por WhatsApp</span></a>}
        </div>
      )}
    </div>
  )
}

function TagPicker({ options, value, onChange }) {
  return (
    <div className="pn-img-tags">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button key={o} type="button" aria-pressed={on} className={`pn-img-tagbtn${on ? ' is-on' : ''}`}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>
            {on && <Icon name="check" size={12} />}{o}
          </button>
        )
      })}
    </div>
  )
}

function PhotoSlot({ angle, photo, authHeaders, disabled, busy, onPick, onDelete }) {
  const src = useAuthedImage(photo ? `${API}&photo=${photo.id}` : null, authHeaders)
  return (
    <div className={`pn-img-photo${photo ? ' has-img' : ''}${disabled ? ' is-off' : ''}`}>
      <label>
        {src ? <img src={src} alt={angle.label} /> : <Icon name="camera" size={22} />}
        <span className="pn-img-photo-tag">{busy ? 'Subiendo…' : angle.label}{!angle.required && !photo ? ' (opcional)' : ''}</span>
        <input type="file" accept="image/*" capture="environment" disabled={disabled}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPick(f) }} />
      </label>
      {photo && !disabled && (
        <button type="button" className="pn-img-photo-x" aria-label={`Borrar foto ${angle.label}`} onClick={() => onDelete(photo)}>
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  )
}

/* ---------- recomendaciones de un tipo ---------- */
function RecGroup({ kind, recs, catalog, busy, onAction, onDelete, onAdd }) {
  const [adding, setAdding] = useState(false)
  const visible = recs.filter((r) => r.status !== 'descartada')
  const discarded = recs.filter((r) => r.status === 'descartada')
  const [showDiscarded, setShowDiscarded] = useState(false)
  return (
    <div className="pn-img-recgroup">
      <div className="pn-img-recgroup-head">
        <h4>{kind.label}</h4>
        <Button size="sm" variant="plain" icon="plus" onClick={() => setAdding(true)} disabled={adding}>Agregar</Button>
      </div>
      {visible.length === 0 && !adding && <p className="pn-img-muted">Nada todavía.</p>}
      {visible.map((r) => <RecCard key={r.id} rec={r} kind={kind} catalog={catalog} busy={busy === `rec-${r.id}`} onAction={onAction} onDelete={onDelete} />)}
      {adding && (
        <RecEditor kind={kind} catalog={catalog} initial={{ title: '', reason: '', detail: {}, productId: null }} busy={busy === 'rec-add'}
          onCancel={() => setAdding(false)} onSave={async (body) => { await onAdd({ ...body, kind: kind.id }); setAdding(false) }} />
      )}
      {discarded.length > 0 && (
        <button type="button" className="pn-img-showdisc" onClick={() => setShowDiscarded((v) => !v)}>
          {showDiscarded ? 'Ocultar' : 'Ver'} {discarded.length} descartada{discarded.length === 1 ? '' : 's'}
        </button>
      )}
      {showDiscarded && discarded.map((r) => <RecCard key={r.id} rec={r} kind={kind} catalog={catalog} busy={busy === `rec-${r.id}`} onAction={onAction} onDelete={onDelete} />)}
    </div>
  )
}

function RecCard({ rec, kind, catalog, busy, onAction, onDelete }) {
  const [editing, setEditing] = useState(false)
  const product = rec.productId ? catalog.find((p) => p.id === rec.productId) : null
  const fields = fieldsOf(rec.kind).filter(([k]) => rec.detail?.[k])
  const steps = rec.kind === 'rutina' ? rec.detail?.steps || [] : []
  if (editing) {
    return (
      <RecEditor kind={kind} catalog={catalog} busy={busy} initial={rec}
        onCancel={() => setEditing(false)} onSave={async (body) => { await onAction(rec, body); setEditing(false) }} />
    )
  }
  return (
    <div className={`pn-img-rec is-${rec.status}`}>
      <div className="pn-img-rec-main">
        <div className="pn-img-rec-title">
          {rec.detail?.refImg && <img src={rec.detail.refImg} alt="" loading="lazy" />}
          <div>
            <strong>{rec.title}</strong>
            {product && (
              <span className="pn-img-rec-prod">
                {labelOf(CATEGORIES, product.category)} · {product.soldHere ? `En la barbería${product.price ? ` ${clp(product.price)}` : ''}${product.stock === 0 ? ' · sin stock' : ''}` : 'Solo recomendado'}
              </span>
            )}
          </div>
        </div>
        {fields.length > 0 && (
          <dl className="pn-img-rec-detail">
            {fields.map(([k, label]) => <React.Fragment key={k}><dt>{label}</dt><dd>{rec.detail[k]}</dd></React.Fragment>)}
          </dl>
        )}
        {steps.length > 0 && <ol className="pn-img-rec-steps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
        {rec.reason && <p className="pn-img-rec-why"><b>Por qué:</b> {rec.reason}</p>}
        <div className="pn-img-rec-meta">
          <Chip tone={rec.source === 'manual' ? 'muted' : 'info'}>{rec.source === 'manual' ? 'Manual' : rec.source === 'ia' ? 'IA' : 'Sugerida por regla'}</Chip>
          {rec.edited && <Chip tone="accent">Editada</Chip>}
          {rec.status === 'aprobada' && <Chip tone="ok" icon="check">Aprobada</Chip>}
          {rec.status === 'descartada' && <Chip tone="bad">Descartada</Chip>}
        </div>
      </div>
      <div className="pn-img-rec-actions">
        {rec.status !== 'aprobada' && <IconButton icon="check" label="Aprobar" onClick={() => onAction(rec, { status: 'aprobada' })} disabled={busy} />}
        <IconButton icon="pencil" label="Editar" onClick={() => setEditing(true)} disabled={busy} />
        {rec.status !== 'descartada' && rec.source !== 'manual' && <IconButton icon="close" label="Descartar" onClick={() => onAction(rec, { status: 'descartada' })} disabled={busy} />}
        {rec.status === 'descartada' && <IconButton icon="refresh" label="Volver a sugerida" onClick={() => onAction(rec, { status: 'sugerida' })} disabled={busy} />}
        {rec.source === 'manual' && <IconButton icon="trash" label="Borrar" onClick={() => onDelete(rec)} disabled={busy} />}
      </div>
    </div>
  )
}

function RecEditor({ kind, catalog, initial, busy, onCancel, onSave }) {
  const isProduct = PRODUCT_KINDS.includes(kind.id)
  const options = useMemo(() => {
    const cats = CATEGORIES.filter((c) => c.group === KIND_GROUP[kind.id]).map((c) => c.id)
    return catalog.filter((p) => p.active && cats.includes(p.category))
  }, [catalog, kind.id])
  const [title, setTitle] = useState(initial.title || '')
  const [reason, setReason] = useState(initial.reason || '')
  const [detail, setDetail] = useState(initial.detail || {})
  const [productId, setProductId] = useState(initial.productId || '')
  const [steps, setSteps] = useState((initial.detail?.steps || []).join('\n'))
  const pickProduct = (pid) => {
    setProductId(pid)
    const p = catalog.find((x) => x.id === Number(pid))
    if (!p) return
    setTitle([p.brand, p.name].filter(Boolean).join(' '))
    setDetail((d) => ({ ...d, cantidad: d.cantidad || p.amount || '', aplicacion: d.aplicacion || p.application || '', modoDeUso: d.modoDeUso || p.usage || '', frecuencia: d.frecuencia || p.frequency || '' }))
  }
  const ready = isProduct ? Boolean(productId) : Boolean(title.trim())
  const submit = () => {
    const body = { title: title.trim(), reason: reason.trim() || null, detail: kind.id === 'rutina' ? { steps: steps.split('\n').map((s) => s.trim()).filter(Boolean) } : { ...initial.detail, ...detail } }
    if (isProduct) body.productId = Number(productId)
    onSave(body)
  }
  return (
    <div className="pn-img-rec is-editing">
      <div className="pn-stack">
        {isProduct && (
          <Field label="Producto del catálogo" htmlFor={`img-rp-${kind.id}`} hint={options.length ? null : 'No hay productos de este tipo en el catálogo: agrégalos en Catálogo.'}>
            <select id={`img-rp-${kind.id}`} className="input" value={productId} onChange={(e) => pickProduct(e.target.value)}>
              <option value="">Elige un producto…</option>
              {options.map((p) => <option key={p.id} value={p.id}>{[p.brand, p.name].filter(Boolean).join(' ')}{p.soldHere ? ' · en la barbería' : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label={isProduct ? 'Cómo aparece en el informe' : kind.single} htmlFor={`img-rt-${kind.id}`}>
          <input id={`img-rt-${kind.id}`} className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {fieldsOf(kind.id).length > 0 && (
          <div className="pn-img-grid">
            {fieldsOf(kind.id).map(([k, label]) => (
              <Field key={k} label={label} htmlFor={`img-rd-${kind.id}-${k}`} optional>
                <input id={`img-rd-${kind.id}-${k}`} className="input" maxLength={300} value={detail[k] || ''} onChange={(e) => setDetail((d) => ({ ...d, [k]: e.target.value }))} />
              </Field>
            ))}
          </div>
        )}
        {kind.id === 'rutina' && (
          <Field label="Pasos (uno por línea)" htmlFor="img-rsteps">
            <textarea id="img-rsteps" className="input" rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} />
          </Field>
        )}
        <Field label="Por qué" htmlFor={`img-rw-${kind.id}`} optional>
          <textarea id={`img-rw-${kind.id}`} className="input" rows={2} maxLength={800} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="pn-img-rec-editbar">
          <Button size="sm" variant="plain" onClick={onCancel}>Cancelar</Button>
          <Button size="sm" variant="primary" icon="check" loading={busy} disabled={!ready} onClick={submit}>Guardar y aprobar</Button>
        </div>
      </div>
    </div>
  )
}
