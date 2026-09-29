/* ACADEMY — Contraseñas y tokens de miembro
   ------------------------------------------------------------------
   Copia propia de la Academy (antes importaba api/_password.js del panel)
   para que el módulo se pueda llevar tal cual a otro sitio. Mismo formato y
   mismas constantes que los barberos — pbkdf2$<iteraciones>$<sal_hex>$<hex>,
   600.000 iteraciones de PBKDF2-HMAC-SHA256 (recomendación OWASP) —, así
   que todo hash ya guardado se sigue verificando igual.

   ASÍNCRONO a propósito: pbkdf2Sync bloquea el event loop ~50 ms por
   intento, y el login de la Academy es público — varios intentos
   simultáneos en la misma instancia se atenderían en fila india. Con la
   versión async el trabajo va al threadpool de libuv.

   No acepta el SHA-256 legado del panel: ningún miembro se creó nunca con
   ese formato, y aceptarlo solo abriría una puerta más débil si alguien
   escribiera un hash a mano.
   Prefijo `_`: no cuenta como función serverless. */

import crypto from "node:crypto"
import { promisify } from "node:util"

const PBKDF2_ITERATIONS = 600000
const PBKDF2_KEYLEN = 32
const PBKDF2_DIGEST = "sha256"
const SALT_BYTES = 16

const pbkdf2Async = promisify(crypto.pbkdf2)
const sha256Hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex")

/* Comparación en tiempo constante de dos hex del mismo largo. */
function safeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), "hex")
  const bufB = Buffer.from(String(b), "hex")
  if (bufA.length === 0 || bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export async function hashPasswordAsync(password) {
  const salt = crypto.randomBytes(SALT_BYTES).toString("hex")
  const derived = await pbkdf2Async(String(password), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${derived.toString("hex")}`
}

/* Devuelve { ok, needsRehash }. needsRehash = la contraseña era correcta
   pero con menos iteraciones que las de hoy: quien llama la regraba. */
export async function verifyPasswordAsync(password, stored) {
  if (!stored || typeof password !== "string" || !password) return { ok: false, needsRehash: false }
  const value = String(stored)
  if (!value.startsWith("pbkdf2$")) return { ok: false, needsRehash: false }
  const [, iterations, salt, expected] = value.split("$")
  const rounds = Number(iterations)
  if (!Number.isInteger(rounds) || rounds <= 0 || !salt || !expected || expected.length % 2 !== 0) return { ok: false, needsRehash: false }
  const derived = await pbkdf2Async(password, salt, rounds, expected.length / 2, PBKDF2_DIGEST)
  const ok = safeEqualHex(derived.toString("hex"), expected)
  return { ok, needsRehash: ok && rounds < PBKDF2_ITERATIONS }
}

/* Trabajo en falso: un correo que no existe tarda lo mismo que uno que sí,
   para que el login no sirva de enumerador de compradores. */
export async function dummyVerifyAsync() {
  await pbkdf2Async("no-existe", "0".repeat(32), PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
}

/* Contraseña temporal que va en el correo de acceso tras la compra.
   12 caracteres de un alfabeto de 31 sin los que se confunden al leerlos en
   un celular (0/O, 1/I/L): ~59 bits, de sobra para algo que vence en 72 h y
   está detrás del bloqueo por intentos. Se muestra en grupos de 4
   (K7QM-4RTX-9PWD) y se guarda hasheada en su forma canónica (sin guiones,
   en mayúsculas), así que da lo mismo si la persona la escribe con guiones,
   con espacios o en minúsculas. crypto.randomInt evita el sesgo del módulo. */
const TEMP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export function generateTempPassword() {
  let canonical = ""
  for (let i = 0; i < 12; i += 1) canonical += TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)]
  const display = `${canonical.slice(0, 4)}-${canonical.slice(4, 8)}-${canonical.slice(8, 12)}`
  return { display, canonical }
}

export function canonicalTemp(input) {
  return String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")
}

/* Regla de contraseña del miembro: largo y nada más (NIST 800-63B). Sin
   exigir mayúsculas/números/símbolos, que solo empujan a "Barberia1!" y a
   anotarla. Se prohíbe lo obvio: la parte local del correo y una lista corta
   de las que se ven siempre. Espejo en src/academy/passwordRule.js. */
export const MEMBER_PASSWORD_RULES = "Usa al menos 10 caracteres. Puede ser una frase; evita tu correo y contraseñas obvias."
const COMMON_MEMBER_PASSWORDS = new Set([
  "1234567890", "password12", "contraseña", "qwertyuiop", "pimpstudio",
  "pimpstudio1", "brunetticutz", "brunetti123", "barberia123", "0987654321", "1111111111", "abcdefghij", "academy123",
])
export function isValidMemberPassword(pw, email) {
  if (typeof pw !== "string") return false
  if (pw.length < 10 || pw.length > 200) return false
  const lower = pw.toLowerCase()
  if (COMMON_MEMBER_PASSWORDS.has(lower)) return false
  const local = String(email ?? "").trim().toLowerCase().split("@")[0]
  if (local && lower === local) return false
  return true
}

/* Token de un enlace (restablecer contraseña, confirmar correo): 32 bytes
   aleatorios. Se manda por correo en claro y en la base SOLO se guarda su
   SHA-256 — leer la tabla no permite usar ningún enlace. SHA-256 pelado y
   no PBKDF2: el token ya tiene 256 bits de entropía, no hay nada que
   adivinar por fuerza bruta. */
export function generateResetToken() {
  const token = crypto.randomBytes(32).toString("base64url")
  return { token, tokenHash: sha256Hex(token) }
}

export function hashResetToken(token) {
  return sha256Hex(token)
}
