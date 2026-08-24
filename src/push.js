/* PIMP STUDIO — Módulo de notificaciones push (cliente)
   ------------------------------------------------------------------
   Diseñado para iOS instalado como app (Agregar a inicio desde Safari).
   En iOS 16.4+ el Web Push SOLO funciona si la web está instalada en la
   pantalla de inicio (standalone). Este módulo:
     - Registra el service worker.
     - Detecta iOS y modo standalone (app instalada).
     - Pide permiso de notificaciones (gesto del usuario).
     - Se suscribe a Web Push (VAPID) y envía la suscripción al backend,
       asociada SOLO al barbero autenticado (su usuario).
     - Permite disparar notificaciones locales en el propio dispositivo
       (respaldo y demo) vía el service worker.
   La clave pública VAPID se inyecta con VITE_VAPID_PUBLIC_KEY. Sin clave,
   el permiso igual se concede y se usan notificaciones locales. */

const VAPID_PUBLIC_KEY = import.meta.env?.VITE_VAPID_PUBLIC_KEY || ""

export function isIOS() {
  if (typeof navigator === "undefined") return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS se reporta como Mac con touch
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

export function isStandalone() {
  if (typeof window === "undefined") return false
  return window.navigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
}

export function pushSupported() {
  return typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
}

/* En iOS las notificaciones solo están disponibles con la app instalada. */
export function pushAvailableHere() {
  if (!pushSupported()) return false
  if (isIOS() && !isStandalone()) return false
  return true
}

export function permissionState() {
  if (typeof Notification === "undefined") return "unsupported"
  return Notification.permission // 'default' | 'granted' | 'denied'
}

let swRegistration = null
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null
  if (swRegistration) return swRegistration
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" })
    await navigator.serviceWorker.ready
    return swRegistration
  } catch (err) {
    console.warn("SW register failed:", err)
    return null
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function authHeaders(extra = {}) {
  const token = localStorage.getItem("ps_barber_token") || ""
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra
}

/* Activa las notificaciones para el barbero autenticado. Devuelve un objeto
   de estado para reflejar en la UI. Solo notifica al usuario del barbero. */
export async function enablePush(barber) {
  const result = { ok: false, permission: permissionState(), subscribed: false, reason: "" }

  if (isIOS() && !isStandalone()) {
    result.reason = "ios-needs-install"
    return result
  }
  if (!pushSupported() || typeof Notification === "undefined") {
    result.reason = "unsupported"
    return result
  }

  const permission = await Notification.requestPermission()
  result.permission = permission
  if (permission !== "granted") {
    result.reason = "denied"
    return result
  }

  const reg = await registerServiceWorker()
  if (!reg) { result.reason = "sw-failed"; result.ok = true; return result } // permiso ok, sin SW

  // Intentar suscripción Web Push (solo si hay clave VAPID configurada).
  if (VAPID_PUBLIC_KEY && reg.pushManager) {
    try {
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })
      }
      const saveRes = await fetch("/api/push", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ subscription: sub, barberId: barber?.id }),
      }).catch(() => null)
      // Si el servidor no confirmó, la suscripción del navegador quedó
      // activa pero sin guardar: el barbero nunca recibiría avisos y no
      // habría forma de saberlo. No marcar como suscrito en ese caso.
      if (saveRes?.ok) result.subscribed = true
      else result.reason = "save-failed"
    } catch (err) {
      console.warn("push subscribe failed:", err)
      result.reason = "subscribe-failed"
    }
  }

  // Marca local: este dispositivo/usuario tiene push activo (solo si el
  // servidor de verdad guardó la suscripción).
  if (result.subscribed) {
    try { localStorage.setItem(`ps_push_enabled_${barber?.id ?? "me"}`, "1") } catch {}
  }
  result.ok = result.subscribed
  return result
}

export async function disablePush(barber) {
  try { localStorage.removeItem(`ps_push_enabled_${barber?.id ?? "me"}`) } catch {}
  const reg = await registerServiceWorker()
  if (reg?.pushManager) {
    const sub = await reg.pushManager.getSubscription().catch(() => null)
    if (sub) {
      await fetch("/api/push", {
        method: "DELETE",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ endpoint: sub.endpoint, barberId: barber?.id }),
      }).catch(() => {})
      await sub.unsubscribe().catch(() => {})
    }
  }
  return { ok: true }
}

export function pushEnabledFor(barber) {
  try { return localStorage.getItem(`ps_push_enabled_${barber?.id ?? "me"}`) === "1" } catch { return false }
}

/* Notificación local en este dispositivo (respaldo / demo / mismo dispositivo).
   Se usa cuando el barbero está usando la app y entra una reserva suya. */
export async function notifyLocal({ title, body, url = "/panel", tag = "ps-reserva" }) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false
  const reg = await registerServiceWorker()
  if (reg) {
    // showNotification vía SW (requerido en iOS).
    try {
      await reg.showNotification(title, {
        body,
        icon: "/assets/brunetti-logo-icon-192.png",
        badge: "/assets/brunetti-badge.png",
        tag,
        data: { url },
        vibrate: [60, 40, 60],
      })
      return true
    } catch {/* fallback abajo */}
  }
  try { new Notification(title, { body, icon: "/assets/brunetti-logo-icon-192.png" }); return true } catch { return false }
}

/* Aviso de nueva reserva al barbero — SOLO si el barbero autenticado en este
   dispositivo es el de la reserva y tiene las notificaciones activadas.
   El aviso cruzado entre dispositivos lo hace el backend (Web Push). */
export async function notifyBarberOfBooking(currentBarber, booking) {
  if (!currentBarber || !booking) return false
  if (Number(currentBarber.id) !== Number(booking.barberId)) return false
  if (!pushEnabledFor(currentBarber)) return false
  return notifyLocal({
    title: "Nueva reserva",
    body: `${booking.client || "Cliente"} · ${booking.service || "Servicio"} · ${booking.date} ${booking.time}`,
    url: "/panel",
  })
}
