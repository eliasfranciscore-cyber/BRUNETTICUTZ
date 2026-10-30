import React, { useEffect, useState } from 'react'
import { Card, List, ToggleRow, Field, SaveBar, SavedTick, InlineAlert, SkeletonRows, Note } from '../../../components/panel/index.js'
import { MODALITIES } from '../../../imagen/vocab.js'

/* Ajustes de venta de la asesoría (los guarda /api/mp-payments?settings=1,
   la misma tabla que el precio del Workshop). Cada modalidad tiene su
   precio, lo que incluye (sale en /asesoria) y su interruptor de cobro en
   línea: apagado por defecto, y no se puede encender sin precio. Con el
   cobro apagado, /asesoria ofrece escribir por WhatsApp (venta manual). */

const toForm = (a = {}) => Object.fromEntries(MODALITIES.map((m) => [m.id, { price: a[m.id]?.price ? String(a[m.id].price) : '', info: a[m.id]?.info || '' }]))

export default function SettingsView({ authHeaders, toast }) {
  const [base, setBase] = useState(null)
  const [form, setForm] = useState(null)
  const [enabled, setEnabled] = useState({})
  const [saving, setSaving] = useState(false)
  const [busyToggle, setBusyToggle] = useState('')
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')

  useEffect(() => {
    fetch('/api/mp-payments?settings=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((s) => {
        const a = s.asesoria || {}
        setBase(toForm(a)); setForm(toForm(a))
        setEnabled(Object.fromEntries(MODALITIES.map((m) => [m.id, Boolean(a[m.id]?.enabled)])))
      })
      .catch(() => setError('No se pudieron cargar los ajustes.'))
  }, [])

  const patch = async (asesoria) => {
    const res = await fetch('/api/mp-payments?settings=1', {
      method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ asesoria }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error || 'No se pudo guardar.')
    return json.asesoria || {}
  }

  const dirty = base && form && JSON.stringify(base) !== JSON.stringify(form)
  const save = async () => {
    setSaving(true); setError('')
    try {
      const body = Object.fromEntries(MODALITIES.map((m) => [m.id, { price: form[m.id].price === '' ? 0 : Number(form[m.id].price), info: form[m.id].info }]))
      const a = await patch(body)
      setBase(toForm(a)); setForm(toForm(a))
      setEnabled(Object.fromEntries(MODALITIES.map((m) => [m.id, Boolean(a[m.id]?.enabled)])))
      toast('✓', 'Ajustes guardados')
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  // El interruptor guarda solo (PATCH inmediato), como el del Workshop.
  const toggle = async (m, v) => {
    const prev = enabled[m]
    setEnabled((e) => ({ ...e, [m]: v })); setBusyToggle(m); setError('')
    try {
      const a = await patch({ [m]: { enabled: v } })
      setEnabled((e) => ({ ...e, [m]: Boolean(a[m]?.enabled) }))
      setFlash(m); setTimeout(() => setFlash(''), 1800)
    } catch (err) {
      setEnabled((e) => ({ ...e, [m]: prev })); setError(err.message)
    } finally { setBusyToggle('') }
  }

  if (!form) return error ? <InlineAlert tone="warn">{error}</InlineAlert> : <SkeletonRows rows={4} />

  return (
    <div className="pn-stack is-lg">
      {error && <InlineAlert tone="error" onClose={() => setError('')}>{error}</InlineAlert>}
      <Note>Los precios y lo que incluye cada modalidad se muestran en <a href="/asesoria" target="_blank" rel="noopener noreferrer">/asesoria</a>. Mientras el cobro esté apagado, la página ofrece escribir por WhatsApp.</Note>
      {MODALITIES.map((m) => {
        const hasPrice = Number(base[m.id].price) > 0
        return (
          <Card key={m.id} title={`Asesoría ${m.label.toLowerCase()}`} subtitle={m.hint} action={<SavedTick show={flash === m.id} />}>
            <List>
              <ToggleRow title="Cobro en línea (Mercado Pago)" checked={Boolean(enabled[m.id])} disabled={!hasPrice || busyToggle === m.id}
                description={hasPrice ? (enabled[m.id] ? 'Se puede pagar en /asesoria.' : 'Apagado: la página ofrece WhatsApp.') : 'Guarda un precio para poder encenderlo.'}
                onChange={(v) => toggle(m.id, v)} />
            </List>
            <div className="pn-form">
              <Field label="Precio" htmlFor={`as-price-${m.id}`} hint="En pesos, IVA incluido">
                <input id={`as-price-${m.id}`} className="input" inputMode="numeric" value={form[m.id].price}
                  onChange={(e) => setForm((f) => ({ ...f, [m.id]: { ...f[m.id], price: e.target.value.replace(/\D/g, '') } }))} />
              </Field>
              <Field label="Qué incluye" htmlFor={`as-info-${m.id}`} optional hint="Una o dos líneas para la página">
                <textarea id={`as-info-${m.id}`} className="input" rows={2} maxLength={800} value={form[m.id].info}
                  onChange={(e) => setForm((f) => ({ ...f, [m.id]: { ...f[m.id], info: e.target.value } }))} />
              </Field>
            </div>
          </Card>
        )
      })}
      <div className="pn-ajustes-savebar-wrap">
        <SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setForm(base)} />
      </div>
    </div>
  )
}
