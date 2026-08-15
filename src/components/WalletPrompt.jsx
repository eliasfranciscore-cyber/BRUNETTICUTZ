import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './ui.jsx'
import { walletPlatform, wasWalletDismissedRecently, rememberWalletDismissal, hasWalletPass, walletPassURL, fetchGoogleWalletSaveURL } from '../walletPrompt.js'

/* Aviso "Agregar a Wallet" — la tarjeta de fidelidad de Pimp Studio, que
   también suma con cada corte acá (ver api/_loyaltyBridge.js). Se ofrece al
   confirmar una reserva y en la cuenta del cliente. */
export default function WalletPrompt({ open, onClose, phone }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  if (!open) return null

  const platform = walletPlatform()
  const dismiss = () => { rememberWalletDismissal(); onClose?.() }

  const addAndroid = async () => {
    setLoading(true); setError(null)
    try {
      const url = await fetchGoogleWalletSaveURL(phone)
      window.location.href = url
      dismiss()
    } catch (e) {
      setError('No se pudo generar el pase. Intenta de nuevo más tarde.')
    } finally {
      setLoading(false)
    }
  }

  return createPortal((
    <div className="psn-modal psn-modal-top" role="dialog" aria-modal="true" aria-label="Agregar a Wallet">
      <button className="psn-scrim" aria-label="Cerrar" onClick={dismiss} />
      <div className="psn-modal-card psn-confirm">
        <span className="psn-confirm-ic" style={{ background: 'rgba(163,163,163,.1)', color: 'var(--gold-lt)', borderColor: 'var(--gold-line)' }}>
          <Icon name="wallet" size={22} />
        </span>
        <h3 className="font-display">Lleva tus estrellas en Wallet</h3>
        <p>Agrega tu tarjeta de fidelidad a {platform === 'android' ? 'Google Wallet' : 'Apple Wallet'}: cada corte suma una estrella y a las 10 el tuyo va gratis. Se actualiza sola, sin abrir la web.</p>
        {error && <p style={{ color: '#d99a8f', fontSize: '.8rem' }}>{error}</p>}

        <div className="psn-confirm-actions">
          <button className="btn btn-ghost btn-block" onClick={dismiss}>Ahora no</button>
          {platform === 'android' ? (
            <button className="btn btn-gold btn-block" onClick={addAndroid} disabled={loading}>
              <Icon name="wallet" size={15} /> {loading ? 'Generando…' : 'Agregar a Wallet'}
            </button>
          ) : (
            <a
              href={walletPassURL(phone)}
              className="btn btn-gold btn-block"
              style={{ textDecoration: 'none' }}
              onClick={dismiss}
            >
              <Icon name="wallet" size={15} /> Agregar a Wallet
            </a>
          )}
        </div>
      </div>
    </div>
  ), document.body)
}

/* Un solo disparo por montaje, con respiro después de la acción que lo
   gatilla (la reserva recién confirmada, por ejemplo). El chequeo de "ya lo
   tiene" es asíncrono contra el servidor: en Android no hay verdad de
   servidor consultable, así que ahí manda solo el descarte local. */
export function useAutoWalletPrompt(active, phone, delayMs = 1200) {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!active || shown || !phone) return
    const platform = walletPlatform()
    if (!platform || wasWalletDismissedRecently()) return
    let cancelled = false
    const t = setTimeout(async () => {
      const already = platform === 'ios' ? await hasWalletPass(phone) : false
      if (!cancelled && !already) { setOpen(true); setShown(true) }
    }, delayMs)
    return () => { cancelled = true; clearTimeout(t) }
  }, [active, shown, phone, delayMs])

  return [open, () => setOpen(false)]
}
