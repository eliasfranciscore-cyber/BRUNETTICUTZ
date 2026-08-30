import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './IconsExtra.jsx'
import { BARBERS } from '../data.js'

/**
 * BarberShowcase — reemplaza la sección "Nuestros barberos" de Home.jsx.
 *
 * - Carrusel horizontal de tarjetas con foto (mismo patrón visual que el
 *   carrusel de "Servicios y experiencias").
 * - Acceso directo al Instagram del barbero desde la tarjeta y el modal.
 * - Al tocar una tarjeta abre un modal con la foto en círculo, su Instagram
 *   y un botón "Reservar con X".
 * - "Reservar" guarda el barbero elegido y lleva al login → reserva. El cliente
 *   entra directo al paso de fecha/hora (ver patch en README para Booking.jsx).
 *
 * Requiere que cada barbero en src/data.js tenga `instagram` y `photo`
 * (ver README → data.js). Si falta `photo`, usa el logo como respaldo.
 */

const LOGO = '/assets/brunetti-logo-icon.svg'

function BarberCard({ b, featured, onOpen }) {
  return (
    <button className={`psn-barber-card ${featured ? 'is-featured' : ''}`} onClick={() => onOpen(b)} aria-label={`Ver ${b.name}`}>
      <img src={b.photo || LOGO} alt={b.name} onError={(e) => { if (e.currentTarget.src !== window.location.origin + LOGO) e.currentTarget.src = LOGO }} />
      <div className="psn-card-top">
        <span className="psn-card-rank"><Icon name="star" size={11} color="var(--gold)" /> {Number(b.rating).toFixed(1)}</span>
      </div>
      <div className="psn-card-body">
        <span className="nm">{b.name} {featured && <Icon name="star" size={14} color="var(--gold)" />}</span>
        <span className="role">{b.role}{b.exp ? ` · ${b.exp}` : ''}</span>
        {b.instagram && (
          <a className="psn-card-ig" href={`https://instagram.com/${b.instagram}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            <Icon name="instagram" size={12} /> @{b.instagram}
          </a>
        )}
        <span className="psn-card-cta">Ver perfil y reservar <Icon name="arrowRight" size={13} /></span>
      </div>
    </button>
  )
}

function BarberModal({ b, onClose, onReserve }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="psn-modal" role="dialog" aria-modal="true">
      <button className="psn-scrim" aria-label="Cerrar" onClick={onClose} />
      <div className="psn-modal-card">
        <button className="psn-back" onClick={onClose}><Icon name="arrowLeft" size={14} /> Ver todos</button>
        <button className="psn-close" onClick={onClose} aria-label="Cerrar"><Icon name="close" size={17} /></button>
        <div className="psn-avatar"><img src={b.photo || LOGO} alt={b.name} onError={(e) => { if (e.currentTarget.src !== window.location.origin + LOGO) e.currentTarget.src = LOGO }} /></div>
        <h3 className="font-display">{b.name} {b.tier === 'premium' && <Icon name="star" size={16} color="var(--gold)" />}</h3>
        <p className="psn-role">{b.role}</p>
        <div className="psn-stats">
          <span className="chip"><Icon name="star" size={12} color="var(--gold)" /> {Number(b.rating).toFixed(1)}</span>
          {b.exp && <span className="chip"><Icon name="clock" size={12} /> {b.exp}</span>}
          <span className="chip chip-gold">Agenda en tiempo real</span>
        </div>
        {b.instagram && (
          <a className="psn-ig" href={`https://instagram.com/${b.instagram}`} target="_blank" rel="noopener noreferrer">
            <Icon name="instagram" size={16} /> @{b.instagram}
          </a>
        )}
        <div className="psn-actions">
          <button className="btn btn-gold btn-block" onClick={() => onReserve(b)}>
            <Icon name="calendar" size={16} /> Reservar con {b.short || b.name}
          </button>
          <p className="psn-actions-note">Inicia sesión con tu número y elige día y hora según su disponibilidad.</p>
        </div>
      </div>
    </div>
  )
}

export default function BarberShowcase() {
  const navigate = useNavigate()
  const [modalBarber, setModalBarber] = useState(null)

  const ordered = [...BARBERS].sort((a, b) => (b.tier === 'premium' ? 1 : 0) - (a.tier === 'premium' ? 1 : 0))

  // Reserva directa: guarda el barbero y entra al flujo. La página Booking lee
  // ps_pending_barber y arranca en el paso de fecha/hora (ver README).
  const reserve = (b) => {
    try { localStorage.setItem('ps_pending_barber', String(b.id)) } catch {}
    const logged = (() => { try { return !!localStorage.getItem('ps_user') } catch { return false } })()
    navigate(logged ? '/reservar' : '/login')
  }

  return (
    <section id="sec-barberos" className="home-section home-section-soft">
      <div className="feature-head" style={{ textAlign: 'center', justifyItems: 'center', display: 'grid' }}>
        <p className="eyebrow">El equipo</p>
        <h2 className="font-display">Nuestros barberos</h2>
        <p style={{ color: 'var(--ink-soft)', maxWidth: '58ch' }}>Conoce al equipo completo. Toca cualquier tarjeta para ver su perfil, su Instagram y reservar directamente con él.</p>
      </div>

      <div className="psn-grid">
        {ordered.map((b) => (
          <BarberCard key={b.id} b={b} featured={b.tier === 'premium'} onOpen={setModalBarber} />
        ))}
      </div>

      {modalBarber && (
        <BarberModal b={modalBarber} onClose={() => setModalBarber(null)} onReserve={reserve} />
      )}
    </section>
  )
}
