/* BRUNETTI — Instalación del panel (Agregar a inicio / PWA)
   ------------------------------------------------------------------
   La app instalada de brunetticutz.cl es solo el panel interno (start_url
   /panel en el manifest), así que el aviso se ofrece únicamente dentro del
   panel, al barbero. Qué se puede hacer en cada plataforma:

   - Chrome/Edge (Android y escritorio) disparan `beforeinstallprompt` y
     permiten instalar de verdad desde un botón nuestro. El evento se emite
     MUY temprano (a veces antes de que React monte), así que este módulo se
     importa desde main.jsx sólo para registrar el listener a tiempo.
   - Safari en iOS/iPadOS no expone ninguna API de instalación: la única vía
     es Compartir → Agregar a inicio, a mano. Lo máximo que podemos hacer es
     mostrar la instrucción en el momento oportuno.
   - Dentro del navegador embebido de Instagram/WhatsApp (pasa si el link
     del panel se abre desde un chat) ni siquiera existe esa opción en el
     menú, así que hay que mandar a abrirlo en Safari/Chrome.

   El estado de "ya lo descartó" vive en localStorage y caduca a los 30 días:
   insistir en cada apertura del panel es la forma más rápida de que alguien
   lo ignore para siempre. */

import { isIOS, isStandalone } from "./push.js"

const DISMISS_KEY = "bc_install_dismissed"
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000

let deferredPrompt = null
const listeners = new Set()

function emit() {
  for (const fn of listeners) fn(installState())
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Sin preventDefault, Chrome muestra su propio mini-infobar y el evento
    // deja de estar disponible para nuestro botón.
    e.preventDefault()
    deferredPrompt = e
    emit()
  })
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null
    try { localStorage.removeItem(DISMISS_KEY) } catch (e) {}
    emit()
  })
}

/* Navegador embebido de una app (Instagram, Facebook, WhatsApp, TikTok…).
   Se detecta por user-agent porque no hay API que lo declare. */
export function isInAppBrowser() {
  if (typeof navigator === "undefined") return false
  return /FBAN|FBAV|Instagram|Line\/|WhatsApp|TikTok|MicroMessenger/i.test(navigator.userAgent)
}

/* Cómo se puede instalar acá y ahora:
     'installed'        → ya corre como app, no hay nada que ofrecer
     'native'           → tenemos el evento de Chrome: botón "Instalar"
     'ios-safari'       → hay que enseñar Compartir → Agregar a inicio
     'in-app-browser'   → hay que mandar a abrirlo en el navegador real
     'unavailable'      → nada que hacer (ej. Firefox de escritorio) */
export function installState() {
  if (typeof window === "undefined") return "unavailable"
  if (isStandalone()) return "installed"
  if (deferredPrompt) return "native"
  if (isInAppBrowser()) return "in-app-browser"
  if (isIOS()) return "ios-safari"
  return "unavailable"
}

export function canOfferInstall() {
  const state = installState()
  return state === "native" || state === "ios-safari" || state === "in-app-browser"
}

/* Lanza el diálogo nativo de Chrome. Devuelve true si aceptó instalar.
   El evento es de un solo uso: Chrome lo vuelve a emitir si hace falta. */
export async function promptInstall() {
  if (!deferredPrompt) return false
  const prompt = deferredPrompt
  deferredPrompt = null
  emit()
  prompt.prompt()
  const { outcome } = await prompt.userChoice.catch(() => ({ outcome: "dismissed" }))
  return outcome === "accepted"
}

export function wasDismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return at > 0 && Date.now() - at < DISMISS_MS
  } catch (e) {
    return false
  }
}

export function rememberDismissal() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch (e) {}
}

/* Regla completa para mostrar el aviso automático. El punto de entrada
   manual (fila "Instalar el panel" en Ajustes) NO usa esto: ahí la persona
   lo pidió, así que se muestra aunque lo haya descartado antes. */
export function shouldAutoPromptInstall() {
  return canOfferInstall() && !wasDismissedRecently()
}

/* Suscripción a cambios de estado, para que un componente montado antes de
   que llegue `beforeinstallprompt` se entere igual. */
export function onInstallStateChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
