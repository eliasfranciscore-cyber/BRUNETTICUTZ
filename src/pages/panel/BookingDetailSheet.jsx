import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../components/ui.jsx'
import { CLP, cleanPhone } from '../../data.js'

// Modal de detalle de una reserva (click en un slot "booked" o en la lista de
// Reservas del día). Portal a document.body, mismo patrón que NewBookingModal.
export function BookingDetailModal({ booking, clients, onClose, onConfirm, onCancel, onRedeemFreeCut }) {
  useEffect(() => {
    if (!booking) return
    const onKey = (e) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [booking, onClose])

  if (!booking) return null
  const client = clients.find((c) => cleanPhone(c.phone) === cleanPhone(booking.phone))
  const isRecurring = client && Number(client.visits || 0) > 1
  const initial = (booking.client || "?").trim().charAt(0).toUpperCase() || "?"

  return createPortal((
    <div className="psn-modal" role="dialog" aria-modal="true" aria-label="Detalle de la reserva">
      <button className="psn-scrim" aria-label="Cerrar" onClick={onClose} />
      <div className="psn-modal-card agenda-detail">
        <button className="psn-close" onClick={onClose} aria-label="Cerrar"><Icon name="close" size={17} /></button>
        <span className={`chip ${booking.status === "confirmada" ? "chip-gold" : ""} agenda-detail-status`}>{booking.status}</span>
        <div className="agenda-detail-client">
          <span className="agenda-detail-avatar">{initial}</span>
          <div>
            <strong>{booking.client}</strong>
            <span className="agenda-detail-tag">{isRecurring ? `Cliente recurrente · ${client.visits} visitas` : "Cliente nuevo"}</span>
          </div>
        </div>
        <div className="agenda-detail-grid">
          <div className="agenda-detail-cell"><span>Hora</span><b>{booking.time}</b></div>
          <div className="agenda-detail-cell"><span>Servicio</span><b>{booking.service}</b></div>
          <div className="agenda-detail-cell"><span>Fecha</span><b>{booking.date}</b></div>
          <div className="agenda-detail-cell"><span>Precio</span><b>{CLP(Number(booking.price || 0))}</b></div>
        </div>
        {/* Fidelidad: el saldo viene de la lista de clientes (una sola llamada
            al puente por carga del panel, no una por reserva). El canje solo
            se ofrece si le alcanza y si esta reserva no está ya en $0. */}
        {client?.loyalty && (
          <div style={{ display: "grid", gap: ".4rem", margin: ".2rem 0 .4rem" }}>
            <span className="chip chip-gold" style={{ justifySelf: "start", fontSize: ".68rem" }}>
              <Icon name="star" size={11} /> {client.loyalty.stars}/{client.loyalty.goal} estrellas
            </span>
            {client.loyalty.freeCutReady && Number(booking.price || 0) > 0 && onRedeemFreeCut && (
              <button type="button" className="btn btn-gold btn-block" onClick={() => onRedeemFreeCut(booking)}>
                <Icon name="gift" size={15} /> Canjear corte gratis
              </button>
            )}
          </div>
        )}
        <div className="agenda-detail-actions">
          <button type="button" className="btn btn-gold btn-block" onClick={() => onConfirm(booking)}>
            <Icon name="check" size={15} /> Confirmar
          </button>
          <button type="button" className="btn btn-ghost btn-block agenda-detail-cancel" onClick={() => onCancel(booking)}>
            Cancelar cita
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}
