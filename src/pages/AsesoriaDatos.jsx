import React, { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import SiteNav from '../components/SiteNav.jsx'
import { Icon } from '../components/ui.jsx'
import { useBrunettiFx } from '../components/brunetti.jsx'
import { cleanPhone, waShopHref } from '../data.js'
import { INTAKE, ANGLES, PHOTO_TIPS } from '../imagen/vocab.js'
import { photoToJpeg } from '../imagen/photo.js'
import { track } from '../track.js'
import '../styles/asesoria.css'

/* /asesoria/datos?t=<token> — la ficha de ingreso de la asesoría (sección
   6 del documento de Image Studio): datos, objetivo, hábitos y, con
   consentimiento explícito, las fotos de diagnóstico. Guarda el avance en
   cada paso (PATCH), así el cliente puede volver con el mismo enlace.
   Backend: /api/clients?mode=imagen-form (api/_imagenForm.js).
   Lo que se declara acá es información para Bruno, no un diagnóstico. */

const API = (t) => `/api/clients?mode=imagen-form&t=${t}`
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STEPS = ['Tus datos', 'Tu objetivo', 'Tu pelo', 'Tus fotos', 'Enviar']

async function call(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.ok) throw Object.assign(new Error(json?.error || 'No se pudo guardar. Intenta de nuevo.'), { state: json?.consultation })
  return json
}

function Chips({ options, value, onChange, multi = false }) {
  return (
    <div className="as-chips">
      {options.map((o) => {
        const on = multi ? (value || []).includes(o) : value === o
        return (
          <button key={o} type="button" aria-pressed={on} className={`as-chip${on ? ' is-on' : ''}`}
            onClick={() => onChange(multi ? (on ? value.filter((x) => x !== o) : [...(value || []), o]) : (on ? null : o))}>
            {o}
          </button>
        )
      })}
    </div>
  )
}

export default function AsesoriaDatos() {
  const rootRef = useRef(null)
  const location = useLocation()
  useBrunettiFx(rootRef, { parallax: false })
  const token = new URLSearchParams(location.search).get('t') || ''
  const [state, setState] = useState(null)
  const [form, setForm] = useState(null)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [fatal, setFatal] = useState('')

  useEffect(() => {
    if (!/^[a-f0-9]{32}$/.test(token)) { setFatal('Este enlace no es válido. Revisa el correo que te mandamos o escríbenos.'); return }
    call(API(token))
      .then((json) => {
        const c = json.consultation
        setState(c)
        setForm({ name: c.name || '', email: c.email || '', phone: c.phone || '', age: c.age ?? '', intake: c.intake || {} })
      })
      .catch((err) => setFatal(err.message))
  }, [token])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setIn = (patch) => setForm((f) => ({ ...f, intake: { ...f.intake, ...patch } }))

  const saveStep = async () => {
    const json = await call(API(token), { method: 'PATCH', body: { ...form, phone: cleanPhone(form.phone) } })
    setState(json.consultation)
  }

  const validStep = () => {
    if (step === 0) {
      if (form.name.trim().length < 3) return 'Escribe tu nombre.'
      if (!EMAIL_RE.test(form.email.trim())) return 'Revisa tu correo: ahí te llega el informe.'
      if (cleanPhone(form.phone).length !== 9) return 'Tu WhatsApp tiene que tener 9 dígitos.'
    }
    if (step === 1 && !String(form.intake.goal || '').trim()) return 'Cuéntanos qué buscas con la asesoría.'
    if (step === 3 && state.modality === 'online') {
      const have = new Set(state.photos.map((p) => p.angle))
      const missing = ANGLES.filter((a) => a.required && !have.has(a.id))
      if (missing.length) return `Faltan fotos: ${missing.map((a) => a.label.toLowerCase()).join(', ')}.`
    }
    return ''
  }

  const next = async () => {
    const v = validStep()
    if (v) { setError(v); return }
    setBusy('next'); setError('')
    try {
      if (step < 3) await saveStep()
      setStep((s) => Math.min(s + 1, STEPS.length - 1))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) { setError(err.message) } finally { setBusy('') }
  }

  const consent = async (checked) => {
    if (!checked || state.consentAt) return
    setBusy('consent'); setError('')
    try {
      const json = await call(`${API(token)}&consent=1`, { method: 'POST', body: {} })
      setState(json.consultation)
    } catch (err) { setError(err.message) } finally { setBusy('') }
  }

  const upload = async (angle, file) => {
    if (!file) return
    setBusy(`photo-${angle}`); setError('')
    try {
      const dataUrl = await photoToJpeg(file)
      await call(`${API(token)}&upload=1`, { method: 'POST', body: { angle, dataUrl } })
      const json = await call(API(token))
      setState(json.consultation)
    } catch (err) { setError(err.message) } finally { setBusy('') }
  }

  const submit = async () => {
    setBusy('submit'); setError('')
    try {
      await saveStep()
      const json = await call(`${API(token)}&submit=1`, { method: 'POST', body: {} })
      setState(json.consultation)
      track('Lead', { content_name: 'Asesoría de imagen · datos enviados' })
    } catch (err) {
      if (err.state) setState(err.state)
      setError(err.message)
    } finally { setBusy('') }
  }

  const shell = (children) => (
    <div className="brunetti-site asesoria-page" ref={rootRef}>
      <SiteNav />
      <main className="as-flow"><div className="bwrap"><div className="as-flow-card">{children}</div></div></main>
    </div>
  )

  if (fatal) return shell(<div className="as-done"><span className="as-ico"><Icon name="alert" size={22} /></span><h1>No pudimos abrir tu formulario</h1><p>{fatal}</p>
    <a className="btn btn-ghost" href={waShopHref('Hola, no puedo abrir el formulario de mi asesoría de imagen.')} target="_blank" rel="noopener noreferrer"><Icon name="whatsapp" size={16} /> Escribir por WhatsApp</a></div>)
  if (!state || !form) return shell(<p>Cargando…</p>)
  if (state.submitted) {
    return shell(
      <div className="as-done">
        <span className="as-ico"><Icon name="checkCircle" size={22} /></span>
        <h1>¡Recibimos tus datos!</h1>
        <p>Bruno va a revisar tu información{state.photos.length ? ' y tus fotos' : ''} para preparar tu diagnóstico. Tu informe te llega a <b>{state.email}</b>.</p>
        <p className="as-modal-note">¿Te faltó algo? Escríbenos por <a href={waShopHref('Hola, quiero agregar algo a mi asesoría de imagen.')} target="_blank" rel="noopener noreferrer">WhatsApp</a>.</p>
      </div>,
    )
  }
  if (!state.canEdit) {
    return shell(
      <div className="as-done">
        <span className="as-ico"><Icon name="clock" size={22} /></span>
        <h1>{state.status === 'cancelada' ? 'Esta asesoría fue cancelada' : 'Tu pago todavía no está confirmado'}</h1>
        <p>{state.status === 'cancelada' ? 'Si crees que es un error, escríbenos.' : 'Apenas se confirme vas a poder completar tus datos con este mismo enlace.'}</p>
      </div>,
    )
  }

  const online = state.modality === 'online'
  return shell(
    <>
      <div className="as-progress" aria-hidden="true">{STEPS.map((s, i) => <span key={s} className={i <= step ? 'is-on' : ''} />)}</div>
      <p className="as-step-k">Paso {step + 1} de {STEPS.length} · {STEPS[step]}</p>

      {step === 0 && (
        <>
          <h1>Hola{form.name ? `, ${form.name.split(' ')[0]}` : ''}</h1>
          <p>Para tu asesoría {online ? 'online' : 'presencial'} con Bruno. Tus respuestas nos ayudan a preparar tu diagnóstico; el diagnóstico lo hace Bruno.</p>
          <label className="as-field"><span>Nombre y apellido</span><input autoComplete="name" value={form.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="as-field"><span>Correo (ahí te llega el informe)</span><input type="email" inputMode="email" autoComplete="email" value={form.email} maxLength={300} onChange={(e) => set({ email: e.target.value })} /></label>
          <label className="as-field"><span>WhatsApp</span><input type="tel" inputMode="tel" autoComplete="tel" value={form.phone} maxLength={15} onChange={(e) => set({ phone: e.target.value })} /></label>
          <label className="as-field"><span>Edad (opcional)</span><input inputMode="numeric" value={form.age} maxLength={3} onChange={(e) => set({ age: e.target.value.replace(/\D/g, '') })} /></label>
        </>
      )}

      {step === 1 && (
        <>
          <h1>¿Qué buscas?</h1>
          <label className="as-field"><span>Tu objetivo de imagen</span>
            <textarea rows={3} maxLength={800} value={form.intake.goal || ''} onChange={(e) => setIn({ goal: e.target.value })} placeholder="Ej: verme más ordenado para el trabajo sin peinarme tanto." />
          </label>
          {['style', 'finish', 'length', 'styleTime'].map((k) => (
            <div className="as-group" key={k}><span>{INTAKE[k].label}</span><Chips options={INTAKE[k].options} value={form.intake[k]} onChange={(v) => setIn({ [k]: v })} /></div>
          ))}
          <label className="as-field"><span>Algo más que quieras contarnos (opcional)</span>
            <textarea rows={2} maxLength={600} value={form.intake.preferences || ''} onChange={(e) => setIn({ preferences: e.target.value })} placeholder="Referentes, cortes que te gustaron o que no quieres repetir…" />
          </label>
        </>
      )}

      {step === 2 && (
        <>
          <h1>Tu pelo y tus hábitos</h1>
          {['washFreq', 'water', 'drying'].map((k) => (
            <div className="as-group" key={k}><span>{INTAKE[k].label}</span><Chips options={INTAKE[k].options} value={form.intake[k]} onChange={(v) => setIn({ [k]: v })} /></div>
          ))}
          <div className="as-group"><span>{INTAKE.needs.label} (puedes marcar varias)</span><Chips multi options={INTAKE.needs.options} value={form.intake.needs || []} onChange={(v) => setIn({ needs: v })} /></div>
          <label className="as-field"><span>Productos que usas hoy (opcional)</span>
            <textarea rows={2} maxLength={600} value={form.intake.currentProducts || ''} onChange={(e) => setIn({ currentProducts: e.target.value })} placeholder="Champú, cera, gel…" />
          </label>
          <label className="as-field"><span>Hábitos (opcional)</span>
            <textarea rows={2} maxLength={600} value={form.intake.habits || ''} onChange={(e) => setIn({ habits: e.target.value })} placeholder="Deporte, gorro o casco, piscina, trabajo…" />
          </label>
        </>
      )}

      {step === 3 && (
        <>
          <h1>Tus fotos</h1>
          <p>{online ? 'Con ellas Bruno hace tu diagnóstico: necesitamos las 4 primeras.' : 'Opcionales: si no las subes, Bruno las toma en la barbería.'}</p>
          <ul className="as-tips">{PHOTO_TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
          <label className="as-check">
            <input type="checkbox" checked={Boolean(state.consentAt)} disabled={Boolean(state.consentAt) || busy === 'consent'} onChange={(e) => consent(e.target.checked)} />
            <span>Autorizo a Brunetti a guardar mis fotos de forma privada y usarlas solo para mi asesoría. Puedo pedir que se eliminen cuando quiera (<a href="/asesoria#privacidad" target="_blank" rel="noopener noreferrer">aviso de privacidad</a>).</span>
          </label>
          <div className="as-photos">
            {ANGLES.map((a) => {
              const photo = state.photos.find((p) => p.angle === a.id)
              return (
                <label key={a.id} className={`as-photo${photo ? ' has-img' : ''}`} style={{ opacity: state.consentAt ? 1 : 0.5 }}>
                  {photo ? <img src={`${API(token)}&photo=${photo.id}`} alt={a.label} /> : <span className="as-photo-hint"><Icon name="camera" size={22} /><br />{a.hint}</span>}
                  <span className="as-photo-label">{busy === `photo-${a.id}` ? 'Subiendo…' : `${a.label}${a.required ? '' : ' (opcional)'}${photo ? ' · cambiar' : ''}`}</span>
                  <input type="file" accept="image/*" capture="environment" disabled={!state.consentAt || Boolean(busy)}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; upload(a.id, f) }} />
                </label>
              )
            })}
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <h1>Revisa y envía</h1>
          <div className="as-review">
            <span><b>{form.name}</b> · {form.email} · +56 {cleanPhone(form.phone)}</span>
            <span><b>Objetivo:</b> {form.intake.goal || '—'}</span>
            {(form.intake.needs || []).length > 0 && <span><b>Notas en tu pelo:</b> {form.intake.needs.join(', ')}</span>}
            <span><b>Fotos:</b> {state.photos.length || 'ninguna'}</span>
          </div>
          <p>Al enviar, Bruno recibe tu información para preparar tu diagnóstico. Después ya no se puede editar (si te falta algo, nos escribes).</p>
        </>
      )}

      {error && <p className="as-error" role="alert">{error}</p>}
      <div className="as-nav">
        {step > 0 ? <button type="button" className="btn btn-ghost" onClick={() => { setError(''); setStep((s) => s - 1) }} disabled={Boolean(busy)}>Atrás</button> : <span />}
        {step < STEPS.length - 1
          ? <button type="button" className="btn btn-gold" onClick={next} disabled={Boolean(busy)}>{busy === 'next' ? 'Guardando…' : 'Siguiente'} <Icon name="arrowRight" size={15} /></button>
          : <button type="button" className="btn btn-gold" onClick={submit} disabled={Boolean(busy)}>{busy === 'submit' ? 'Enviando…' : 'Enviar mis datos'} <Icon name="send" size={15} /></button>}
      </div>
    </>,
  )
}
