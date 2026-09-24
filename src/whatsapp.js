/* Enlaces de WhatsApp con mensaje precargado.

   Esta lógica estaba copiada en BookingsInbox, ClientModal, EnrollmentModal
   y el botón "Tarjeta" de Dashboard, cada uno con su propio `56` a mano y su
   propia versión de los textos. Acá queda una sola definición del código de
   país y del formato de los mensajes (siempre a nombre de Brunetti). */

import { cleanPhone } from './data.js'

const COUNTRY_CODE = '56'

/* Los 9 dígitos del número chileno, con la misma limpieza que usa el resto
   del sitio al guardar un teléfono (cleanPhone de data.js): tolera que venga
   con +56, espacios o guiones. Antes se quitaban solo los no-dígitos y un
   número guardado con código de país armaba un wa.me/5656… que no abría
   ningún chat. */
export function waPhone(phone) {
  return cleanPhone(phone)
}

export function waHref(phone, message) {
  const p = waPhone(phone)
  if (!p) return null
  return `https://wa.me/${COUNTRY_CODE}${p}?text=${encodeURIComponent(message || '')}`
}

const firstNameOf = (name) => (String(name || '').trim().split(' ')[0] || 'Hola')

/* Fecha larga en español para los mensajes ("lunes 4 de agosto"). Los mensajes
   los lee una persona, no un sistema: "2026-08-04" se entiende mucho peor. */
function prettyDate(dateKey) {
  if (!dateKey) return ''
  try {
    const [y, m, d] = String(dateKey).split('-').map(Number)
    return new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
      .format(new Date(y, m - 1, d))
  } catch {
    return dateKey
  }
}

/* Mensajes por situación. `booking` = { client, date, time }. */
export const waMessages = {
  confirmada: (bk, barber) =>
    `Hola ${firstNameOf(bk.client)}, te confirmamos tu hora en Brunetti el ${prettyDate(bk.date)} a las ${bk.time} con ${barber}. ¡Te esperamos! 💈`,
  'en curso': (bk, barber) =>
    `Hola ${firstNameOf(bk.client)}, te esperamos en Brunetti, tu hora de las ${bk.time} con ${barber} está por comenzar.`,
  completada: (bk) =>
    `Hola ${firstNameOf(bk.client)}, ¡gracias por tu visita a Brunetti! Esperamos que te haya gustado el resultado. Te esperamos pronto. 💈`,
  cancelada: (bk) =>
    `Hola ${firstNameOf(bk.client)}, lamentamos avisarte que tu hora del ${prettyDate(bk.date)} a las ${bk.time} en Brunetti fue cancelada. Escríbenos y te buscamos otro horario. 🙏`,
  reagendar: (bk) =>
    `Hola ${firstNameOf(bk.client)}, necesitamos reagendar tu hora del ${prettyDate(bk.date)} (${bk.time}) en Brunetti. ¿Qué día te acomoda?`,
  default: (bk) =>
    `Hola ${firstNameOf(bk.client)}, te escribimos de Brunetti por tu reserva del ${prettyDate(bk.date)} a las ${bk.time}.`,
  saludo: (bk) => `Hola ${firstNameOf(bk.client)}, te escribimos de Brunetti 💈`,
}

/* Aviso de reagendamiento: lleva el horario NUEVO y pide confirmación, que es
   justo lo que el barbero necesita mandar apenas mueve la hora. */
export function waRescheduledMessage({ client, date, time, barber }) {
  return `Hola ${firstNameOf(client)}, movimos tu hora en Brunetti al ${prettyDate(date)} a las ${time}${barber ? ` con ${barber}` : ''}. ¿Te acomoda ese horario? Respóndenos para dejarla confirmada. 💈`
}

/* Mensaje del botón "Tarjeta" de la lista de clientes del panel — `url` es
   el link personal "/tarjeta?t=..." que arma ?mode=wallet-share-link
   (api/clients.js), nunca el teléfono del cliente. Mismo texto que ya
   mandaba el panel. */
export function waWalletShareMessage(clientName, url) {
  return `Hola ${firstNameOf(clientName)} 👋 Te dejamos tu tarjeta de fidelidad de Brunetti: cada corte suma una estrella y a las 10 el tuyo va gratis. Agrégala a tu celular acá: ${url}`
}

/* Link listo para una reserva, según su estado. */
export function waLinkForBooking(booking, barberShort, situation) {
  const build = waMessages[situation] || waMessages.default
  return waHref(booking.phone, build(booking, barberShort || 'tu barbero'))
}
