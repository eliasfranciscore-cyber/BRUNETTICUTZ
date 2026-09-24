/* Detecta que hay un deploy nuevo y recarga la app.

   POR QUÉ EXISTE: la PWA instalada —que es como Bruno usa el panel— no
   recarga sola. iOS la congela al salir y la restaura tal cual, con el JS que
   tenía en memoria, durante días. `index.html` se sirve con `Cache-Control:
   no-store` (ver vercel.json) y los chunks de /assets llevan hash, así que una
   navegación dura siempre trae lo último; el problema es que en la PWA esa
   navegación dura no ocurre nunca. En PimpStudio pasó de verdad: se arregló
   un bug del panel, se desplegó, y los barberos siguieron viéndolo —y
   reportándolo— porque su app seguía corriendo el bundle anterior.

   CÓMO: se compara el chunk de entrada que ESTA pestaña cargó con el que el
   servidor está sirviendo ahora. El nombre lleva hash de contenido, así que
   cambia en cualquier deploy que toque el código y en ninguno que no. No hace
   falta un endpoint ni un archivo de versión: `index.html` ya es la fuente de
   la verdad y pesa ~2 KB.

   CUÁNDO: al volver a la app después de un rato fuera (el momento exacto en que
   iOS restaura la PWA), en cualquier ruta, y con un latido de fondo que SOLO
   recarga dentro del panel (/panel). En el sitio público el latido no hace
   nada: un cliente que dejó /reservar abierto con un horario elegido perdería
   la selección si la página se recargara mientras la mira. Nunca se recarga
   con un campo con el foco ni con una hoja, diálogo o modal abierto (una hoja
   de cobro a medio llenar, una confirmación): se reintenta después. */

const ENTRY_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/

// Mínimo entre dos consultas al servidor, para que el latido y el cambio de
// visibilidad no se pisen.
const CHECK_EVERY_MS = 60_000
// Latido de fondo, para el panel que queda abierto todo el día.
const HEARTBEAT_MS = 15 * 60_000
// Tiempo fuera de la app a partir del cual vale la pena preguntar al volver.
const AWAY_MS = 60_000
// Cortafuegos contra un bucle de recargas (CDN sirviendo dos versiones, por
// ejemplo): como mucho una recarga automática cada 5 minutos.
const RELOAD_GUARD_KEY = "ps_build_reload"
const RELOAD_GUARD_MS = 5 * 60_000

let lastCheck = 0
let hiddenAt = 0

// El chunk que ESTA pestaña está corriendo, leído del <script type="module">
// que el servidor mandó en el HTML con el que arrancó.
function loadedEntry() {
  const src = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute("src") || ""
  return src.match(ENTRY_RE)?.[0] || ""
}

// No se recarga con un campo enfocado: sería borrarle al barbero la reserva
// que está escribiendo.
function isTyping() {
  const el = document.activeElement
  if (!el) return false
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
}

// Hojas y diálogos abiertos: las del panel nuevo (.pn-sheet-root, siempre con
// role="dialog"/"alertdialog"), los modales de antes (.psn-modal) y cualquier
// otro con aria-modal. Recargar con uno abierto tira lo que estaba a medias.
// Algunos viven montados todo el tiempo y cerrados con display:none (el menú
// del dock, el modal del carrusel del Home): esos no tienen cajas en pantalla
// (getClientRects vacío) y no cuentan, o el panel no se recargaría nunca.
const OPEN_LAYER = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], .pn-sheet-root, .psn-modal'
function hasOpenLayer() {
  return Array.from(document.querySelectorAll(OPEN_LAYER)).some((el) => el.getClientRects().length > 0)
}

const onPanel = () => window.location.pathname.startsWith("/panel")

// Rutas públicas donde el visitante puede tener algo a medio llenar (Q21): el
// pickup de fecha/hora en /reservar, el carro en Essentials, un token de
// reseña o de reset ya cargado, la tarjeta de fidelidad en /cuenta. La
// recarga se reintenta en la próxima visita a esa ruta o el próximo latido,
// nunca se pierde para siempre.
const HOLD_PATH_PREFIXES = ["/reservar", "/essentials/gracias", "/resena", "/restablecer", "/cuenta"]

// El drawer de Essentials abierto ya cae en hasOpenLayer() (role="dialog"
// aria-modal="true"); esto cubre el carro con el drawer CERRADO, que de otra
// forma se ve vacío como si nada lo protegiera.
function isCartHeld() {
  try {
    const items = JSON.parse(localStorage.getItem("ps_cart") || "[]")
    return Array.isArray(items) && items.length > 0
  } catch {
    return false
  }
}

function isHeldPublicRoute() {
  const path = window.location.pathname
  if (HOLD_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true
  if (path.startsWith("/essentials") && isCartHeld()) return true
  return false
}

// Además del foco (isTyping) y las hojas abiertas, en el sitio público no se
// recarga si algún campo ya tiene algo escrito: un input/textarea/select con
// valor es una señal de que hay algo que perder aunque el foco ya no esté ahí
// (por ejemplo, tras tocar otro control de la misma pantalla).
function hasFilledField() {
  return Array.from(document.querySelectorAll("input, textarea, select")).some((el) => {
    if (el.type === "hidden" || el.type === "submit" || el.type === "button" || el.type === "checkbox" || el.type === "radio") return false
    return String(el.value ?? "").trim() !== ""
  })
}

/* `fromHeartbeat`: el latido solo vale en el panel. Se revisa antes de ir al
   servidor (fuera del panel ni siquiera se pregunta) y otra vez antes de
   recargar, por si en medio de la consulta la persona salió del panel. */
async function check(fromHeartbeat = false) {
  if (fromHeartbeat && !onPanel()) return
  const now = Date.now()
  if (now - lastCheck < CHECK_EVERY_MS) return
  lastCheck = now

  const mine = loadedEntry()
  if (!mine) return // build sin el chunk esperado: mejor no adivinar

  let live = ""
  try {
    // `?v=` además del no-store: vale por si algún proxy intermedio ignora el
    // header. Sin credenciales, es HTML público.
    const res = await fetch(`/?v=${now}`, { cache: "no-store", credentials: "omit" })
    if (!res.ok) return
    live = (await res.text()).match(ENTRY_RE)?.[0] || ""
  } catch {
    return // sin red: no es asunto de este módulo
  }

  if (!live || live === mine) return
  if (fromHeartbeat && !onPanel()) return
  // Se reintenta en el próximo latido o la próxima vuelta a la app.
  if (isTyping() || hasOpenLayer()) return
  // Sitio público a medio flujo (Q21): el panel sigue con el criterio de
  // siempre (hoja/diálogo abierto o foco), sin este filtro extra.
  if (!onPanel() && (isHeldPublicRoute() || hasFilledField())) return

  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0)
    if (last && Date.now() - last < RELOAD_GUARD_MS) return
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
  } catch {
    // sessionStorage bloqueado: se recarga igual, pero sin red de seguridad.
  }
  window.location.reload()
}

export function watchForNewBuild() {
  // En dev el chunk no lleva hash y el servidor es Vite: no hay nada que vigilar.
  if (!import.meta.env.PROD) return

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return }
    if (!hiddenAt || Date.now() - hiddenAt < AWAY_MS) return
    hiddenAt = 0
    check()
  })
  // Volver desde el bfcache (Safari) no dispara visibilitychange.
  window.addEventListener("pageshow", (event) => { if (event.persisted) check() })
  setInterval(() => check(true), HEARTBEAT_MS)
}
