import React, { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useIsPhone } from '../../components/panel/index.js'
import { useVisualViewportVars } from '../../components/panel/hooks.js'
import ChatThread from '../../components/academy/ChatThread.jsx'
import { useAcademy } from '../../academy/context.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/chat.css'

/* ============================================================
   /academy/chat/:id — el chat a pantalla completa. SPEC §7.1, §7.4.
   Es la forma del celular (en escritorio el chat se abre acoplado abajo a la
   derecha), pero la ruta funciona en cualquier ancho: un push de mensaje
   directo trae acá, y en escritorio se ve como una tarjeta centrada.

   En el celular la página tapa la barra y las pestañas de la Academy (como
   cualquier app de mensajería) y sigue el alto del visualViewport: en iOS el
   teclado no achica el viewport de layout, y sin esto el compositor quedaría
   escondido detrás del teclado justo al escribir.
   ============================================================ */

export default function ChatPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isPhone = useIsPhone()
  const { closeChat } = useAcademy()
  const rootRef = useRef(null)
  const chatId = Number(id)
  useVisualViewportVars(rootRef, isPhone)

  // Si la misma conversación estaba acoplada (se abrió en escritorio y se
  // achicó la ventana, o llegó un push), no se deja duplicada.
  useEffect(() => {
    if (Number.isInteger(chatId) && chatId > 0) closeChat?.(chatId)
  }, [chatId]) // eslint-disable-line react-hooks/exhaustive-deps

  // En el celular la página tapa todo: sin scroll del fondo detrás.
  useEffect(() => {
    if (!isPhone) return undefined
    document.body.classList.add('aca-chat-fullscreen')
    return () => document.body.classList.remove('aca-chat-fullscreen')
  }, [isPhone])

  // "Volver" vuelve a donde estaba (el popover, un perfil, la lista de
  // miembros). Si se llegó directo (push, enlace), a la Comunidad.
  const back = () => {
    let idx = 0
    try { idx = Number(window.history.state?.idx) || 0 } catch { idx = 0 }
    if (idx > 0) navigate(-1)
    else navigate(r.path('/comunidad'), { replace: true })
  }

  return (
    <div ref={rootRef} className={['aca-chat-page', isPhone && 'is-phone'].filter(Boolean).join(' ')}>
      <div className="aca-chat-page-card">
        <ChatThread chatId={chatId} variant="page" fullHeight onBack={back} />
      </div>
    </div>
  )
}
