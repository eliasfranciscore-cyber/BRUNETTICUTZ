/* ACADEMY — regla de contraseña del miembro
   ------------------------------------------------------------------
   Espejo de isValidMemberPassword() en api/_password.js (SPEC §3.2): 10 a 200
   caracteres, distinta de la parte del correo antes de la @ y fuera de una
   lista corta de contraseñas obvias. Sin reglas de composición (mayúscula,
   símbolo…): un alumno que entra desde el celular recuerda mejor una frase
   larga que "Abc123!$", y la longitud es lo que de verdad cuesta adivinar.
   El servidor vuelve a validar; esto solo evita un viaje y explica por qué. */

export const MEMBER_PASSWORD_MIN = 10
export const MEMBER_PASSWORD_MAX = 200

const COMMON = ['1234567890', 'password12', 'contraseña', 'qwertyuiop', 'pimpstudio', 'pimpstudio1', 'brunetticutz', 'brunetti123', 'barberia123', '0987654321', '1111111111', 'abcdefghij', 'academy123']

export const MEMBER_PASSWORD_HINT = 'Mínimo 10 caracteres. Una frase que recuerdes sirve (por ejemplo: "mi-primer-fade-2026").'

// Igual que el servidor: todo lo que va antes de la primera @.
function localPart(email) {
  return String(email ?? '').trim().toLowerCase().split('@')[0]
}

/* → null si sirve, o el motivo en español para mostrar bajo el campo. */
export function memberPasswordProblem(pw, email) {
  const s = String(pw ?? '')
  if (!s) return 'Escribe una contraseña.'
  if (s.length < MEMBER_PASSWORD_MIN) return `Tiene que tener al menos ${MEMBER_PASSWORD_MIN} caracteres (llevas ${s.length}).`
  if (s.length > MEMBER_PASSWORD_MAX) return `Puede tener hasta ${MEMBER_PASSWORD_MAX} caracteres.`
  const lower = s.toLowerCase()
  const local = localPart(email)
  if (local && lower === local) return 'No puede ser igual a tu correo.'
  if (COMMON.includes(lower)) return 'Es demasiado común. Elige otra.'
  return null
}

/* Lista de chequeos para el ayudante visual bajo el campo. */
export function memberPasswordChecks(pw, email) {
  const s = String(pw ?? '')
  const lower = s.toLowerCase()
  const local = localPart(email)
  return [
    { id: 'length', ok: s.length >= MEMBER_PASSWORD_MIN && s.length <= MEMBER_PASSWORD_MAX, label: `Al menos ${MEMBER_PASSWORD_MIN} caracteres` },
    { id: 'email', ok: Boolean(s) && !(local && lower === local), label: 'Distinta de tu correo' },
    { id: 'common', ok: Boolean(s) && !COMMON.includes(lower), label: 'No es una contraseña común' },
  ]
}
