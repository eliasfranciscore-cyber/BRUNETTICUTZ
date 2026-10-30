import React, { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import SiteNav from '../components/SiteNav.jsx'
import { Icon } from '../components/ui.jsx'
import { useBrunettiFx } from '../components/brunetti.jsx'
import { waShopHref } from '../data.js'
import { track } from '../track.js'
import { CHECKOUT_KEY } from '../imagen/vocab.js'
import '../styles/asesoria.css'

/* /asesoria/gracias — vuelta de Mercado Pago. No escribe nada (eso lo hace
   el webhook, api/_imagenCore.js → handleAsesoriaPaid): consulta el estado
   de la asesoría por el token que guardó /asesoria antes de redirigir, cada
   3 s hasta 10 veces, y cuando el pago está confirmado ofrece el formulario.
   Si el webhook demora, el enlace igual le llega por correo. */

const POLL_MS = 3000
const MAX_CHECKS = 10
const FAILED = new Set(['rejected', 'cancelled', 'refunded', 'charged_back', 'failure'])

function readCheckout() {
  try { return JSON.parse(sessionStorage.getItem(CHECKOUT_KEY) || 'null') } catch { return null }
}

export default function AsesoriaGracias() {
  const rootRef = useRef(null)
  const location = useLocation()
  useBrunettiFx(rootRef, { parallax: false })
  const params = new URLSearchParams(location.search)
  const urlStatus = params.get('status') || params.get('collection_status') || ''
  const checkout = readCheckout()
  const token = checkout?.token && /^[a-f0-9]{32}$/.test(checkout.token) ? checkout.token : null
  const [phase, setPhase] = useState(FAILED.has(urlStatus) ? 'failed' : token ? 'checking' : 'missing')
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (phase !== 'checking' || !token) return undefined
    let alive = true
    let checks = 0
    let timer = null
    const tick = async () => {
      checks += 1
      try {
        const res = await fetch(`/api/clients?mode=imagen-form&t=${token}`, { cache: 'no-store' })
        const json = res.ok ? await res.json() : null
        if (!alive) return
        if (json?.consultation?.paid || json?.consultation?.paymentStatus === 'pagada') {
          setPhase('paid')
          try {
            const key = `bc_asesoria_purchase_${token}`
            if (!sessionStorage.getItem(key)) { track('Purchase', { content_name: `Asesoría ${checkout.modality}`, currency: 'CLP' }); sessionStorage.setItem(key, '1') }
          } catch { /* modo privado */ }
          return
        }
      } catch { /* se reintenta */ }
      if (checks >= MAX_CHECKS) { if (alive) setPhase('slow'); return }
      timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [phase, token, round]) // eslint-disable-line react-hooks/exhaustive-deps

  const first = String(checkout?.name || '').split(' ')[0]
  return (
    <div className="brunetti-site asesoria-page" ref={rootRef}>
      <SiteNav />
      <main className="as-flow">
        <div className="bwrap">
          <div className="as-flow-card as-done" data-reveal>
            {phase === 'checking' && (
              <>
                <span className="as-ico"><Icon name="clock" size={22} /></span>
                <h1>Confirmando tu pago…</h1>
                <p>Esto toma unos segundos. No cierres esta página.</p>
              </>
            )}
            {phase === 'paid' && (
              <>
                <span className="as-ico"><Icon name="checkCircle" size={22} /></span>
                <h1>¡Listo{first ? `, ${first}` : ''}! Tu asesoría está pagada</h1>
                <p>El siguiente paso es contarnos de ti: tu objetivo, tus hábitos{checkout?.modality === 'online' ? ' y 4 fotos de tu cabeza' : ''}. Con eso Bruno prepara tu diagnóstico.</p>
                <Link className="btn btn-gold" to={`/asesoria/datos?t=${token}`}>Completar mis datos <Icon name="arrowRight" size={15} /></Link>
                <p className="as-modal-note">También te mandamos el enlace por correo, por si quieres hacerlo después.</p>
              </>
            )}
            {phase === 'slow' && (
              <>
                <span className="as-ico"><Icon name="mail" size={22} /></span>
                <h1>Tu pago se está confirmando</h1>
                <p>Mercado Pago a veces demora unos minutos. Apenas se confirme te llega un correo con el enlace a tu formulario.</p>
                <button type="button" className="btn btn-ghost" onClick={() => { setPhase('checking'); setRound((n) => n + 1) }}>Revisar de nuevo</button>
              </>
            )}
            {phase === 'failed' && (
              <>
                <span className="as-ico"><Icon name="alert" size={22} /></span>
                <h1>El pago no se completó</h1>
                <p>No se hizo ningún cobro. Puedes intentarlo otra vez o escribirnos y lo coordinamos.</p>
                <Link className="btn btn-gold" to="/asesoria#modalidades">Volver a intentar</Link>
              </>
            )}
            {phase === 'missing' && (
              <>
                <span className="as-ico"><Icon name="mail" size={22} /></span>
                <h1>Revisa tu correo</h1>
                <p>Cuando tu pago se confirme te llega el enlace para completar tus datos. ¿Dudas? Escríbenos.</p>
                <a className="btn btn-ghost" href={waShopHref('Hola, pagué la asesoría de imagen y quiero completar mis datos.')} target="_blank" rel="noopener noreferrer">
                  <Icon name="whatsapp" size={16} /> Escribir por WhatsApp
                </a>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
