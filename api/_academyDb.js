/* ACADEMY — Base de datos compartida entre los dos sitios
   ------------------------------------------------------------------
   La Academy es UNA sola en pimpstudio.cl/academy y brunetticutz.cl/cursos:
   los mismos cursos, alumnos, pagos, comunidad, chat y calendario. Sus
   tablas (academy_*) viven en UNA base Neon —la de PimpStudio— y el otro
   sitio se conecta a ella con ACADEMY_DATABASE_URL. Todo lo demás de cada
   sitio (barberos, reservas, la campana del panel) sigue en su DATABASE_URL.

     academySql(fallback)  cliente para las tablas academy_* (y para `users`,
                           que solo se LEE al crear una orden, para ligar la
                           compra con la ficha de cliente por teléfono: en la
                           base de PimpStudio esa tabla es la de los clientes
                           de los dos negocios, cruzados por teléfono).
     hostSql(fallback)     cliente para las tablas propias del sitio: lo usan
                           requireBarberAdmin y notifyStaff del host.
     sharedDb()            true si este sitio usa una base ajena
                           (ACADEMY_DATABASE_URL distinta de su DATABASE_URL).
     ownsDb()              lo contrario: este sitio es el dueño de la base.
     SITE                  clave de este sitio (HOST.key: 'pimpstudio' |
                           'brunetticutz').

   Cada fila que solo puede atender el sitio que la originó lleva la clave
   del sitio: academy_orders.site (se cobra con SU Mercado Pago),
   academy_push_subscriptions.site (atada a SUS VAPID y SU service worker),
   academy_members.home_site (sus correos automáticos salen con SU marca y
   SUS enlaces), academy_email_log.site (cada sitio tiene SU cupo de Resend),
   academy_event_reminders.site y academy_staff_links.site (el barbero #6 de
   un sitio no es el #6 del otro). Una fila con sitio NULL es anterior a la
   base compartida y es del dueño de la base: siteIs() la cuenta como suya
   solo ahí.

   Sin ACADEMY_DATABASE_URL todo queda como siempre: una base, la del sitio.
   Prefijo `_`: no cuenta como función serverless. */

import crypto from "node:crypto"
import { neon } from "@neondatabase/serverless"
import { HOST } from "./_academyHost.js"

export const SITE = HOST.key

const ownUrl = () => String(process.env.DATABASE_URL || "").trim()
const academyUrl = () => String(process.env.ACADEMY_DATABASE_URL || "").trim()

export function sharedDb() {
  const a = academyUrl()
  return Boolean(a) && a !== ownUrl()
}

export const ownsDb = () => !sharedDb()

/* Solo tests: `academy` y `host` reemplazan a los clientes de Neon (un
   Postgres local con dos bases). Sin argumentos vuelve a los reales. */
let testClients = null
export function __setTestDeps({ academy = null, host = null } = {}) {
  testClients = academy || host ? { academy, host } : null
}

// neon() solo arma una función (no abre nada), pero se reusa por instancia.
const clients = new Map()
function client(url) {
  let c = clients.get(url)
  if (!c) {
    c = neon(url)
    clients.set(url, c)
  }
  return c
}

/* Cliente de la base de la Academy. `fallback` es el `sql` que ya tiene quien
   llama (el checkout, el webhook y el cron del host le pasan el suyo): se
   usa tal cual si la Academy vive en la base del sitio. null = no hay base. */
export function academySql(fallback = null) {
  if (testClients?.academy && sharedDb()) return testClients.academy
  if (sharedDb()) return client(academyUrl())
  if (fallback) return fallback
  const u = ownUrl()
  return u ? client(u) : null
}

/* Cliente de la base propia del sitio (barberos, avisos del panel). Con la
   base compartida NUNCA devuelve la de la Academy: un barbero de este sitio
   no existe en la base del otro. */
export function hostSql(fallback = null) {
  if (testClients?.host && sharedDb()) return testClients.host
  if (!sharedDb()) return fallback || (ownUrl() ? client(ownUrl()) : null)
  return ownUrl() ? client(ownUrl()) : null
}

/* Huella de la base ajena (host + nombre de la base, sin usuario ni
   contraseña), o null si la base es la propia. La usa _academySession.js:
   al pasar a una base compartida los ids de los miembros cambian (la fila #1
   de allá no es la #1 de acá), y un token viejo con sub=1 abriría la cuenta
   de otra persona. Con la huella en el `info` de HKDF, cambiar de base
   invalida solo los tokens de este sitio, sin tocar los del dueño. */
export function academyDbTag() {
  if (!sharedDb()) return null
  let id = academyUrl()
  try {
    const u = new URL(id)
    id = `${u.hostname.replace(/-pooler(?=\.)/, "")}${u.pathname}`
  } catch {
    // URL rara: se usa entera (igual es estable mientras no cambie).
  }
  return crypto.createHash("sha256").update(id).digest("hex").slice(0, 16)
}

/* Llave de Vercel Blob para las imágenes y archivos de la Academy. Con una
   sola Academy las subidas tienen que ir a UN solo store: los archivos
   privados (adjuntos del chat) solo se leen con la llave de su store, y un
   alumno sube en un sitio y su compañero lo abre en el otro. Por eso
   ACADEMY_BLOB_READ_WRITE_TOKEN (la llave del store de la Academy, la misma
   en los dos proyectos) manda sobre la BLOB_READ_WRITE_TOKEN del sitio. */
export function blobToken() {
  return String(process.env.ACADEMY_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "").trim()
}

/* ¿La fila con esta clave de sitio es de este sitio? Las NULL (anteriores a
   la base compartida) son del dueño de la base. Para JS; en SQL se escribe
   `(x.site = ${SITE} OR (x.site IS NULL AND ${ownsDb()}::boolean))`. */
export function siteIs(value) {
  if (value == null || value === "") return ownsDb()
  return String(value) === SITE
}
