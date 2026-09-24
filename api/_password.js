import crypto from "crypto"

/* PIMP STUDIO — Hashing de contraseñas de barberos
   ------------------------------------------------------------------
   Formato: pbkdf2$<iteraciones>$<sal_hex>$<derivada_hex>

   Por qué PBKDF2 y no el SHA-256 pelado que había antes: un SHA-256 sin sal
   se calcula a miles de millones por segundo en una GPU y, sin sal, una sola
   tabla arcoíris sirve para todas las filas a la vez. Con contraseñas de 8
   caracteres alfanuméricos —lo que exigía el panel— eso es cuestión de horas.
   PBKDF2 con 600.000 iteraciones (recomendación OWASP para PBKDF2-HMAC-SHA256)
   mete un costo fijo por intento, y la sal por usuario obliga a atacar cada
   cuenta por separado. Medido acá: ~17 ms con 210.000 iteraciones en Apple
   Silicon, ~50 ms con 600.000 — imperceptible al entrar, pero multiplica por
   600.000 el costo de cualquier ataque por diccionario.

   Se queda en node:crypto en vez de bcrypt/argon2 a propósito: son módulos
   nativos, y en las funciones serverless de Vercel eso significa binarios que
   compilar y peso extra de bundle por algo que el runtime ya trae.

   MIGRACIÓN TRANSPARENTE: las filas viejas guardan un SHA-256 hex de 64
   caracteres. `verifyPassword` las sigue aceptando y avisa con `needsRehash`
   para que quien llame vuelva a guardar la contraseña en el formato nuevo.
   Nadie tiene que cambiar su clave por esto.

   BRUNETTI — portado tal cual de PimpStudio (el código de abajo no cambia).
   Dos diferencias de USO, las dos en api/auth-barber.js:
     - El re-hash al entrar (`needsRehash`) está APAGADO hasta que se pone
       PASSWORD_REHASH=1 en Vercel. Una fila ya pasada a PBKDF2 no la puede
       leer un build anterior (comparaba SHA-256 en el SQL), así que un
       rollback dejaría a Bruno sin poder entrar ni en la web ni en iOS. Se
       enciende después de ~1 semana estable.
     - `isValidPassword` / `PASSWORD_RULES` de acá son la regla FUERTE de
       PimpStudio (10+ caracteres, símbolos permitidos). BrunettiCutz sigue con
       la suya (8–64 letras y números) mientras PASSWORD_RULE no sea "strong";
       ver STRONG_PASSWORD_RULE en auth-barber.js.
   Prefijo `_`: no consume slot de función serverless (tope 12 del plan Hobby). */

const PBKDF2_ITERATIONS = 600000
const PBKDF2_KEYLEN = 32
const PBKDF2_DIGEST = "sha256"
const SALT_BYTES = 16

/* Requisitos de contraseña. Antes se exigía [A-Za-z0-9]{8,64}, o sea que los
   símbolos estaban PROHIBIDOS — al revés de lo que uno querría. Ahora se
   permite cualquier carácter y se sube el mínimo a 10. */
export const PASSWORD_RULES = "Mínimo 10 caracteres, con al menos una mayúscula, una minúscula y un número."

export function isValidPassword(pw) {
  if (typeof pw !== "string") return false
  if (pw.length < 10 || pw.length > 200) return false
  return /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw)
}

const sha256Hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex")

export function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES).toString("hex")
  const derived = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${derived.toString("hex")}`
}

/* Comparación en tiempo constante: comparar con === filtra información por el
   tiempo que tarda en salir la diferencia. Es un ataque de laboratorio contra
   HTTP, pero el costo de hacerlo bien es cero. */
function safeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), "hex")
  const bufB = Buffer.from(String(b), "hex")
  if (bufA.length === 0 || bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/* Devuelve { ok, needsRehash }. `needsRehash` es true cuando la contraseña era
   correcta pero venía guardada en el formato viejo (SHA-256): quien llama debe
   regrabarla con hashPassword() para que quede en PBKDF2. */
export function verifyPassword(password, stored) {
  if (!stored || typeof password !== "string" || !password) return { ok: false, needsRehash: false }
  const value = String(stored)

  if (value.startsWith("pbkdf2$")) {
    const [, iterations, salt, expected] = value.split("$")
    const rounds = Number(iterations)
    if (!rounds || !salt || !expected) return { ok: false, needsRehash: false }
    const derived = crypto.pbkdf2Sync(password, salt, rounds, expected.length / 2, PBKDF2_DIGEST)
    const ok = safeEqualHex(derived.toString("hex"), expected)
    // Si en el futuro se sube el número de iteraciones, las filas viejas se
    // reescriben solas en el siguiente login correcto.
    return { ok, needsRehash: ok && rounds < PBKDF2_ITERATIONS }
  }

  // Formato legado: SHA-256 hex sin sal.
  if (/^[a-f0-9]{64}$/i.test(value)) {
    const ok = safeEqualHex(sha256Hex(password), value.toLowerCase())
    return { ok, needsRehash: ok }
  }

  return { ok: false, needsRehash: false }
}

/* Trabajo en falso para el caso "el usuario no existe". Sin esto, un login con
   usuario inexistente responde al toque y uno con usuario real se demora lo
   que tarda PBKDF2 — esa diferencia de tiempo es un enumerador de usuarios. */
export function dummyVerify() {
  crypto.pbkdf2Sync("no-existe", "0".repeat(32), PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
}

/* Token de restablecimiento: 32 bytes de aleatoriedad criptográfica. Se envía
   por correo en claro y en la base SÓLO se guarda su SHA-256, igual que una
   contraseña — así, leer la tabla no permite usar ningún enlace.
   Acá SÍ va SHA-256 pelado y no PBKDF2: el token ya tiene 256 bits de entropía
   real, no hay nada que adivinar por fuerza bruta. */
export function generateResetToken() {
  const token = crypto.randomBytes(32).toString("base64url")
  return { token, tokenHash: sha256Hex(token) }
}

export function hashResetToken(token) {
  return sha256Hex(token)
}
