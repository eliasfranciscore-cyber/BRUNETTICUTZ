/* ACADEMY — contexto de la app del miembro
   ------------------------------------------------------------------
   Lo provee src/pages/academy/AcademyApp.jsx. Forma (SPEC §7.2 + contrato del
   front):
     me, group, setMe, refreshMe,
     unread: { notifications, chats }, setUnread, refreshUnread,
     openChat(chatId | { memberId }) → Promise<chatId|null>, closeChat(chatId), openChats: [chatId],
     openNotifications(), openChatsList(), closePopover(),
     isStaff, isAdmin, isOwner, isModerator,
     levelName(n), levelNames, tz,
     toast(message, kind?)  kind: 'info' | 'ok' | 'error',
     markOnboarding(id), logout()

   useAcademy() nunca devuelve null: fuera del proveedor (tests, una página
   montada suelta) entrega un valor inerte en vez de romper el render. */

import { createContext, useContext } from 'react'
import { levelName as baseLevelName, DEFAULT_LEVEL_NAMES } from './levels.js'
import { DEFAULT_TZ } from './time.js'

export const AcademyContext = createContext(null)

const noop = () => {}
const asyncNull = async () => null

const FALLBACK = Object.freeze({
  me: null,
  group: null,
  setMe: noop,
  refreshMe: asyncNull,
  unread: { notifications: 0, chats: 0 },
  setUnread: noop,
  refreshUnread: asyncNull,
  openChat: asyncNull,
  closeChat: noop,
  openChats: [],
  openNotifications: noop,
  openChatsList: noop,
  closePopover: noop,
  isStaff: false,
  isAdmin: false,
  isOwner: false,
  isModerator: false,
  levelName: (n) => baseLevelName(n),
  levelNames: DEFAULT_LEVEL_NAMES,
  tz: DEFAULT_TZ,
  toast: noop,
  markOnboarding: noop,
  logout: noop,
})

export function useAcademy() {
  return useContext(AcademyContext) || FALLBACK
}
