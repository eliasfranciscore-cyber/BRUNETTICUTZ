/* Reglas de contraseña del panel — espejo de api/_password.js (la regla que
   aplica api/auth-barber.js salvo PASSWORD_RULE=legacy): mínimo 10
   caracteres, con al menos una mayúscula, una minúscula y un número; los
   símbolos se permiten. Es la misma regla de PimpStudio.

   Está duplicado a propósito: el servidor no se puede importar desde el
   navegador sin arrastrar node:crypto al bundle. Esta copia es SOLO para
   avisarle a la persona mientras escribe; quien manda es siempre el
   servidor, que revalida al guardar. Si cambia una, cambia la otra. */

const MIN = 10
const MAX = 200

export const PASSWORD_RULES = "Mínimo 10 caracteres, con al menos una mayúscula, una minúscula y un número."

export function isValidPassword(pw) {
  if (typeof pw !== "string") return false
  if (pw.length < MIN || pw.length > MAX) return false
  return /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw)
}

// Mismo chequeo con el nombre que usaba el panel (ConfigPanel de Dashboard.jsx).
export const isStrongPassword = isValidPassword

/* Qué le falta a la contraseña, para decirlo en concreto en vez de repetir la
   regla completa cuando ya cumple la mitad. "" = cumple. */
export function passwordProblem(pw) {
  if (typeof pw !== "string" || !pw) return "Escribe una contraseña."
  if (pw.length < MIN) {
    const faltan = MIN - pw.length
    return `${faltan === 1 ? "Falta 1 carácter" : `Faltan ${faltan} caracteres`} (mínimo ${MIN}).`
  }
  if (pw.length > MAX) return `Demasiado larga (máximo ${MAX} caracteres).`
  const falta = []
  if (!/[A-Z]/.test(pw)) falta.push("una mayúscula")
  if (!/[a-z]/.test(pw)) falta.push("una minúscula")
  if (!/[0-9]/.test(pw)) falta.push("un número")
  if (falta.length) return `Falta ${falta.join(", ")}.`
  return ""
}
