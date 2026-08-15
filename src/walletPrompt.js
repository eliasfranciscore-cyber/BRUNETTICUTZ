/* BRUNETTI — Tarjeta de fidelidad en Wallet
   ------------------------------------------------------------------
   El programa de puntos es el de Pimp Studio (una sola tarjeta, un solo
   saldo, sirve en los dos locales); acá solo se pide a través del backend
   propio, que hace de puente (ver api/_loyaltyBridge.js). Por eso todas las
   URLs de este archivo son de brunetticutz.cl: el navegador del cliente
   nunca llama a pimpstudio.cl.

   Dos plataformas, dos flujos distintos:
   - iOS: navegar el link de descarga (?mode=wallet-pass) alcanza — Safari
     reconoce application/vnd.apple.pkpass solo con la navegación.
   - Android: no hay archivo que descargar. Hay que pedirle al servidor el
     link firmado (?mode=wallet-pass-google, JSON con {saveUrl}) y RECIÉN
     ahí navegar — por eso el botón de Android no puede ser un <a href>
     simple como el de iOS, necesita un click handler async.

   Estado de "ya lo descartó" en localStorage por 30 días, y además se
   verifica contra el servidor si el cliente YA tiene el pase agregado — un
   localStorage por dispositivo no alcanza porque el mismo cliente puede
   entrar desde el navegador Y desde el pase ya instalado. */

import { isIOS } from "./push.js"

const DISMISS_KEY = "bc_wallet_dismissed"
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000

export function isAndroid() {
  return typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)
}

/* 'ios' | 'android' | null (desktop u otro, sin Wallet que ofrecer). */
export function walletPlatform() {
  if (typeof window === "undefined") return null
  if (isIOS()) return "ios"
  if (isAndroid()) return "android"
  return null
}

export function walletAvailable() {
  return walletPlatform() !== null
}

export function wasWalletDismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
    return at > 0 && Date.now() - at < DISMISS_MS
  } catch {
    return false
  }
}

export function rememberWalletDismissal() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
}

/* Verdad de servidor — nunca se cachea localmente porque el estado puede
   cambiar sin que este dispositivo se entere (el cliente agregó el pase desde
   otro teléfono, o lo borró). En Android no hay registro consultable de
   "dispositivo agregado", así que ahí el popup se rige solo por el descarte
   local de 30 días. */
export async function hasWalletPass(phone) {
  if (!phone) return false
  try {
    const res = await fetch(`/api/clients?mode=wallet-status&phone=${encodeURIComponent(phone)}`)
    const data = await res.json()
    return Boolean(data?.hasPass)
  } catch {
    return false
  }
}

/* Saldo de estrellas del cliente (misma fuente que el pase). Devuelve null si
   el puente no está disponible: quien llama simplemente no muestra nada. */
export async function fetchLoyalty(phone) {
  if (!phone) return null
  try {
    const res = await fetch(`/api/clients?mode=wallet-status&phone=${encodeURIComponent(phone)}`)
    const data = await res.json()
    return data?.loyalty || null
  } catch {
    return null
  }
}

export function walletPassURL(phone) {
  return `/api/clients?mode=wallet-pass&phone=${encodeURIComponent(phone)}`
}

/* Android: primero hay que pedirle el link firmado al servidor, recién ahí se
   puede navegar — a diferencia de iOS no hay una URL fija que descargue. */
export async function fetchGoogleWalletSaveURL(phone) {
  const res = await fetch(`/api/clients?mode=wallet-pass-google&phone=${encodeURIComponent(phone)}`)
  const data = await res.json()
  if (!data?.ok || !data?.saveUrl) throw new Error(data?.error || "No se pudo generar el pase")
  return data.saveUrl
}

/* Variantes por TOKEN — las usa /tarjeta, la página pública a la que llega el
   cliente desde el link que le manda el barbero por WhatsApp. El token es
   justo lo que evita que ese link lleve el teléfono escrito, así que estas
   variantes nunca lo reciben ni lo exponen. */
export function walletPassURLByToken(token) {
  return `/api/clients?mode=wallet-pass&t=${encodeURIComponent(token)}`
}

export async function fetchGoogleWalletSaveURLByToken(token) {
  const res = await fetch(`/api/clients?mode=wallet-pass-google&t=${encodeURIComponent(token)}`)
  const data = await res.json()
  if (!data?.ok || !data?.saveUrl) throw new Error(data?.error || "No se pudo generar el pase")
  return data.saveUrl
}

export async function fetchTarjetaInfo(token) {
  const res = await fetch(`/api/clients?mode=wallet-tarjeta-info&t=${encodeURIComponent(token)}`)
  const data = await res.json()
  if (!data?.ok) throw new Error(data?.error || "Link inválido")
  return { name: data.name }
}
