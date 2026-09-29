import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMediaQuery } from '../panel/index.js'
import ChatThread from './ChatThread.jsx'
import { useAcademy } from '../../academy/context.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/chat.css'

/* ============================================================
   Ventanas de chat acopladas abajo a la derecha (escritorio, como Skool).
   SPEC §7.4. El hilo (mensajes, compositor, menú ⋯, sync) es ChatThread en
   su variante 'window'; acá solo va la tarjeta de 340×460 y el minimizado.

   ChatDock lee useAcademy().openChats (lista de chatIds que mantiene
   AcademyApp con openChat/closeChat) y dibuja las 2 más recientes. En el
   celular y en tablet angosta (< 900 px) no dibuja nada: ahí el chat es la
   pantalla completa /academy/chat/:id.
   ============================================================ */

// Mismo corte que debe usar openChat() en AcademyApp para decidir entre
// ventana acoplada y pantalla completa.
export const DOCK_MIN_QUERY = '(min-width: 900px)'
const MAX_WINDOWS = 2

export default function ChatWindow({ chatId, onClose, minimized: minimizedProp, onMinimizedChange }) {
  const [minLocal, setMinLocal] = useState(false)
  const controlled = typeof minimizedProp === 'boolean'
  const minimized = controlled ? minimizedProp : minLocal
  const toggle = () => {
    const next = !minimized
    if (!controlled) setMinLocal(next)
    onMinimizedChange?.(next)
  }
  return (
    <section className={['aca-chat-window', minimized && 'is-min'].filter(Boolean).join(' ')} aria-label="Ventana de chat">
      <ChatThread
        chatId={chatId}
        variant="window"
        fullHeight
        minimized={minimized}
        onMinimize={toggle}
        onClose={onClose}
      />
    </section>
  )
}

// <base>/chat/:id abierto como página: esa conversación no se repite en el dock.
function pageChatId(pathname) {
  const prefix = `${r.path('/chat')}/`
  const p = String(pathname || '')
  const m = p.startsWith(prefix) ? /^(\d+)\/?$/.exec(p.slice(prefix.length)) : null
  return m ? Number(m[1]) : null
}

export function ChatDock() {
  const { openChats, closeChat } = useAcademy()
  const isDesktop = useMediaQuery(DOCK_MIN_QUERY)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [minimized, setMinimized] = useState(() => new Set())

  const ids = (Array.isArray(openChats) ? openChats : [])
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0)

  /* Red de seguridad: si algo agrega un chat a openChats estando en una
     pantalla angosta (donde el dock no se ve), se abre como página en vez de
     quedar "abierto" sin que nadie lo vea. Solo para los recién agregados:
     achicar la ventana del navegador no manda a nadie a otra pantalla. */
  const prevIds = useRef(ids)
  useEffect(() => {
    const before = new Set(prevIds.current)
    prevIds.current = ids
    if (isDesktop) return
    const added = ids.filter((id) => !before.has(id))
    if (!added.length) return
    const last = added[added.length - 1]
    added.forEach((id) => closeChat?.(id))
    navigate(r.chat(last))
  }, [ids.join(','), isDesktop]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Se olvida el minimizado de los chats cerrados, y un chat que vuelve a
     quedar al final de openChats (reabierto desde el popover o desde un
     perfil) se despliega: quien lo abrió quiere leerlo. */
  const lastId = ids.length ? ids[ids.length - 1] : null
  const prevLast = useRef(lastId)
  useEffect(() => {
    const reopened = prevLast.current !== lastId ? lastId : null
    prevLast.current = lastId
    setMinimized((prev) => {
      const next = new Set([...prev].filter((id) => ids.includes(id) && id !== reopened))
      return next.size === prev.size ? prev : next
    })
  }, [ids.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isDesktop) return null
  const onPage = pageChatId(pathname)
  // Los más recientes al final de openChats; el último queda pegado al borde.
  const visible = ids.filter((id) => id !== onPage).slice(-MAX_WINDOWS).reverse()
  if (!visible.length) return null

  const setMin = (id, on) => setMinimized((prev) => {
    const next = new Set(prev)
    if (on) next.add(id)
    else next.delete(id)
    return next
  })

  return (
    <div className="aca-chat-dock" role="region" aria-label="Chats abiertos">
      {visible.map((id) => (
        <ChatWindow
          key={id}
          chatId={id}
          minimized={minimized.has(id)}
          onMinimizedChange={(on) => setMin(id, on)}
          onClose={() => closeChat?.(id)}
        />
      ))}
    </div>
  )
}
