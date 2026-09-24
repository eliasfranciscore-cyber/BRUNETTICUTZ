/* BRUNETTI — Puerta del puente con PimpStudio (entrada)
   ------------------------------------------------------------------
   PimpStudio (pimpstudio.cl) llama a este proyecto servidor-a-servidor con el
   header `X-Bridge-Secret`, que lleva el secreto compartido
   PIMPSTUDIO_BRIDGE_SECRET (mismo valor en los dos Vercel). Este archivo es la
   única definición de "esta request viene del puente" para api/bookings.js,
   api/clients.js y api/availability.js.

   La dirección contraria —acá → PimpStudio— vive en api/_loyaltyBridge.js.

   Sin imports del proyecto a propósito: lo usan bookings.js y clients.js, y
   así no puede cerrar ningún ciclo. Prefijo `_`: no consume ninguno de los
   12 slots de función serverless del plan Hobby (el proyecto está en el tope). */

import crypto from "node:crypto"

/* El único barbero de esta base que el puente puede tocar: Bruno. El secreto
   compartido nunca debe poder escribir en la agenda de otra persona, aunque
   hoy Bruno sea el único barbero de la base. */
export const BRIDGE_BARBER_ID = 6

/* Comparación en tiempo constante. Con `===` el tiempo de respuesta depende
   de cuántos caracteres del principio coinciden, y eso deja adivinar el
   secreto carácter a carácter. Se comparan los SHA-256 de los dos lados
   porque timingSafeEqual exige largos iguales (y lanza si no lo son): así el
   largo del secreto tampoco se filtra. */
export function isBridgeRequest(req) {
  const secret = process.env.PIMPSTUDIO_BRIDGE_SECRET || ""
  if (!secret) return false
  const key = req?.headers?.["x-bridge-secret"]
  if (typeof key !== "string" || !key) return false
  const given = crypto.createHash("sha256").update(key).digest()
  const expected = crypto.createHash("sha256").update(secret).digest()
  return crypto.timingSafeEqual(given, expected)
}

/* Teléfono chileno de 9 dígitos: los ÚLTIMOS 9, una vez descontado el código
   de país (56 / 0056) o el 0 de larga distancia — y solo cuando esos dígitos
   sobran para llegar a 9. Cualquier otro largo se devuelve tal cual y cae en
   la validación de 9 dígitos de quien llama: adivinar qué sobra en un número
   mal escrito es peor que pedir que se corrija.

   Es un espejo exacto de normalizePhone() en api/_phone.js de PimpStudio: el
   teléfono es la llave con la que se cruzan los clientes de los dos negocios,
   así que las dos puntas tienen que limpiarlo igual.

   ⚠️ El resto de este proyecto todavía usa cleanPhone() (api/clients.js,
   src/data.js), que se queda con los PRIMEROS 9 dígitos: "0912345678" da
   "091234567", otro número. Por ahora esto se usa solo en las rutas del
   puente; cambiar cleanPhone() es un arreglo aparte. */
export function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("56")) return digits.slice(2)
  if (digits.length === 13 && digits.startsWith("0056")) return digits.slice(4)
  if (digits.length === 10 && digits.startsWith("0")) return digits.slice(1)
  return digits
}

/* Mismo patrón que validateClient() en api/clients.js. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
