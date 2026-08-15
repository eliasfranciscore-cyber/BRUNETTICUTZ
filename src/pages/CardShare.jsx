import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Brandmark, Icon } from '../components/ui.jsx'
import { walletPlatform, walletPassURLByToken, fetchGoogleWalletSaveURLByToken, fetchTarjetaInfo } from '../walletPrompt.js'

/* Página pública a la que llega el CLIENTE desde el link que el barbero le
   manda por WhatsApp ("Enviar tarjeta de fidelización" en la lista de
   clientes del panel). El token de la URL es opaco: nunca lleva el teléfono
   del cliente escrito, así que este componente tampoco lo pide ni lo recibe
   — todo lo que hace falta para armar el pase lo resuelve el servidor a
   partir del token (ver api/_loyaltyBridge.js). Acá el cliente todavía no
   tiene sesión: solo vino a agregar el pase. */
export default function CardShare() {
  const [params] = useSearchParams()
  const token = params.get('t') || ''
  const [name, setName] = useState(null)
  const [error, setError] = useState(null)
  const [walletLoading, setWalletLoading] = useState(false)
  const [walletError, setWalletError] = useState(null)
  const platform = walletPlatform()

  useEffect(() => {
    if (!token) { setError('Link inválido.'); return }
    fetchTarjetaInfo(token).then((info) => setName(info.name)).catch(() => setError('Este link ya no es válido.'))
  }, [token])

  const addToGoogleWallet = async () => {
    setWalletLoading(true); setWalletError(null)
    try {
      window.location.href = await fetchGoogleWalletSaveURLByToken(token)
    } catch {
      setWalletError('No se pudo generar el pase. Intenta de nuevo más tarde.')
    } finally {
      setWalletLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem 1.2rem' }}>
      <div className="card animate-up" style={{ maxWidth: 380, width: '100%', padding: '2rem 1.6rem', textAlign: 'center', display: 'grid', gap: '1.1rem', justifyItems: 'center' }}>
        <Brandmark size={48} />

        {error && <p style={{ color: '#d99a8f', fontSize: '.9rem' }}>{error}</p>}

        {!error && !name && <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Cargando…</p>}

        {!error && name && (
          <>
            <div>
              <p style={{ fontSize: '.75rem', color: 'var(--muted)', margin: '0 0 .3rem' }}>Hola {name.split(' ')[0]},</p>
              <h1 className="font-display" style={{ fontSize: '1.3rem', margin: 0 }}>Tu tarjeta de fidelidad</h1>
              <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginTop: '.5rem', lineHeight: 1.5 }}>
                Agrégala a tu billetera para ver tus estrellas y tu progreso al corte gratis desde el celular.
              </p>
            </div>

            {platform === 'ios' && (
              <a
                href={walletPassURLByToken(token)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.45rem', padding: '.75rem 1.4rem', borderRadius: '12px', background: '#000', color: '#fff', border: '1px solid rgba(255,255,255,.14)', fontSize: '.85rem', fontWeight: 600, textDecoration: 'none', width: '100%' }}
              >
                <Icon name="wallet" size={16} /> Agregar a Apple Wallet
              </a>
            )}
            {platform === 'android' && (
              <button
                onClick={addToGoogleWallet}
                disabled={walletLoading}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.45rem', padding: '.75rem 1.4rem', borderRadius: '12px', background: '#000', color: '#fff', border: '1px solid rgba(255,255,255,.14)', fontSize: '.85rem', fontWeight: 600, width: '100%', cursor: 'pointer' }}
              >
                <Icon name="wallet" size={16} /> {walletLoading ? 'Generando…' : 'Agregar a Google Wallet'}
              </button>
            )}
            {!platform && (
              <p style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
                Abre este link desde tu celular para agregar la tarjeta a tu Wallet.
              </p>
            )}
            {walletError && <p style={{ color: '#d99a8f', fontSize: '.78rem' }}>{walletError}</p>}
          </>
        )}
      </div>
    </div>
  )
}
