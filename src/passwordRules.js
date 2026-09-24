/* Reglas de contraseña del panel — espejo de isValidPassword() en
   api/auth-barber.js (la regla de hoy: 8 a 64 caracteres, solo letras y
   números, con al menos una mayúscula y un número).

   Está duplicado a propósito: el servidor no se puede importar desde el
   navegador sin arrastrar node:crypto al bundle. Esta copia es SOLO para
   avisarle a la persona mientras escribe; quien manda es siempre el
   servidor, que revalida al guardar. Si cambia una, cambia la otra. */

const MIN = 8
const MAX = 64

export const PASSWORD_RULES = "8 a 64 letras y números, con al menos una mayúscula y un número."

export function isValidPassword(pw) {
  return typeof pw === "string" && /^[A-Za-z0-9]{8,64}$/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw)
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
  if (!/^[A-Za-z0-9]+$/.test(pw)) return "Usa solo letras y números: sin espacios, tildes, ñ ni símbolos."
  const falta = []
  if (!/[A-Z]/.test(pw)) falta.push("una mayúscula")
  if (!/[0-9]/.test(pw)) falta.push("un número")
  if (falta.length) return `Falta ${falta.join(" y ")}.`
  return ""
}
