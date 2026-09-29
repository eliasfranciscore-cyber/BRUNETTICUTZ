/* BRUNETTI — Service Worker
   - Habilita Web Push para iOS (iOS 16.4+ requiere la app instalada en inicio).
   - Muestra notificaciones push (servidor) y notificaciones locales (en dispositivo).
   - Al tocar la notificación abre/enfoca la ruta que trae el aviso: el panel
     interno (avisos de reservas, como siempre) o Brunetti Academy (avisos de
     miembros, que siempre traen su url /cursos/...).

   NO cachea nada, a propósito: no hay handler de `fetch` ni uso de Cache
   Storage. Si alguna vez estás depurando contenido viejo servido por el
   sitio, este archivo no es el culpable — mira los headers HTTP (la regla
   `Cache-Control: no-store` del HTML en vercel.json). Había una constante
   SW_VERSION acá, resto de una versión que sí cacheaba; no la usaba nadie. */

self.addEventListener("install", (event) => {
  // Activar de inmediato sin esperar pestañas previas.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Push del servidor (Web Push API). Payload JSON: { title, body, url, tag }
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Brunetti", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Brunetti";
  const options = {
    body: data.body || "Tienes una nueva reserva.",
    icon: "/assets/brunetti-logo-icon-192.png",
    badge: "/assets/brunetti-badge.png",
    tag: data.tag || "ps-reserva",
    data: { url: data.url || "/panel" },
    vibrate: [60, 40, 60],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notificación local disparada desde la app (postMessage) — útil cuando el
// barbero está usando la app en el mismo dispositivo en que ocurre la reserva.
self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "ps-notify") {
    const title = msg.title || "Brunetti";
    self.registration.showNotification(title, {
      body: msg.body || "",
      icon: "/assets/brunetti-logo-icon-192.png",
      badge: "/assets/brunetti-badge.png",
      tag: msg.tag || "ps-reserva",
      data: { url: msg.url || "/panel" },
      vibrate: [60, 40, 60],
    });
  }
});

// La url viene del payload del push, que arma nuestro backend — pero se
// valida igual antes de abrirla: solo rutas relativas del propio sitio, con
// caracteres seguros y sin `//` (que el navegador leería como otro host).
// Cualquier otra cosa cae en /panel, que es lo que pasaba antes con un push
// sin url. Las urls del panel (/panel?tab=reservas&date=…&bookingId=…) pasan
// tal cual.
const SAFE_PATH = /^\/[A-Za-z0-9/_\-?=&%.]*$/;
function safeTarget(raw) {
  const url = typeof raw === "string" ? raw : "";
  if (!url || url.length > 512 || !SAFE_PATH.test(url) || url.includes("//")) return "/panel";
  return url;
}

// Primer segmento de la ruta: "/panel?tab=reservas" → "/panel",
// "/cursos/chat/5" → "/cursos".
function sectionOf(url) {
  const path = url.split("?")[0];
  return "/" + (path.split("/")[1] || "");
}

function pathOf(clientUrl) {
  try { return new URL(clientUrl).pathname; } catch { return ""; }
}

function inSection(path, section) {
  if (section === "/") return path === "/";
  return path === section || path.startsWith(section + "/");
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = safeTarget(event.notification.data && event.notification.data.url);
  const section = sectionOf(targetUrl);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientsArr) => {
      const sameOrigin = clientsArr.filter((c) => {
        try { return new URL(c.url).origin === self.location.origin; } catch { return false; }
      });
      // Una ventana de la MISMA sección que el destino (panel con panel,
      // Academy con Academy). Si ya hay una abierta (el caso típico: la PWA
      // queda abierta en segundo plano), enfocarla no alcanza — hay que
      // decirle a dónde navegar. postMessage lo hace; la app escucha
      // "ps-navigate" (el panel en App.jsx, la Academy en la suya) y usa el
      // router para no perder el estado ya cargado.
      const existing = sameOrigin.find((c) => inSection(pathOf(c.url), section));
      if (existing) {
        existing.postMessage({ type: "ps-navigate", url: targetUrl });
        return existing.focus();
      }
      // Pushes del panel: EXACTAMENTE como siempre — sin una ventana /panel
      // abierta se abre una nueva; nunca se reutiliza otra pestaña del sitio.
      //
      // Pushes de otra sección (la Academy): si hay alguna otra ventana del
      // sitio (p. ej. la PWA abierta en el panel, el caso de Bruno) se la
      // lleva al destino con una navegación de verdad y no con postMessage:
      // una página que no escucha "ps-navigate" (el inicio, /reservar) lo
      // ignoraría, y la Academy necesita cargar con su propio CSP (el de
      // /cursos/ en vercel.json). Si eso no se puede (ventana no controlada,
      // navegador sin navigate()), se abre una ventana nueva.
      if (section !== "/panel") {
        const other = sameOrigin.find((c) => typeof c.navigate === "function");
        if (other) {
          try {
            const focused = await other.focus().catch(() => other);
            const navigated = await (focused || other).navigate(targetUrl);
            if (navigated) return navigated;
          } catch {
            /* sigue abajo con openWindow */
          }
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
