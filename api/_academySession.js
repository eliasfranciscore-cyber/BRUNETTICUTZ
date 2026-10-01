/* ACADEMY — Sesiones de miembro
   ------------------------------------------------------------------
   Criptográficamente SEPARADAS de las del barbero, y no por prolijidad: los
   ids de barbero son enteros chicos y consecutivos, igual que los SERIAL de
   academy_members. Un miembro #5 firmado con createSession() del panel
   sería, para cualquier endpoint que solo mira la firma (requireInternal),
   el barbero #5.

   Por eso el token de miembro:
     - se firma con OTRA llave, derivada del secreto del panel
       (HOST.sessionSecret()) con HKDF y un `info` propio de cada sitio
       (HOST.sessionInfo): rotar el secreto desloguea a los dos a la vez, no
       hace falta un secreto nuevo en Vercel, y un token de PimpStudio no
       sirve en BrunettiCutz aunque compartieran secreto;
     - tiene OTRO formato, `m1.<payload>.<mac>` con el MAC sobre
       "m1."+payload, que readSession del panel rechaza por tener tres
       partes;
     - no lleva `name`, `id`, `admin` ni `role`: el rol y el estado se leen
       de la base en cada request (api/_academyAuth.js), y sin `name`
       tampoco pasaría el chequeo de readSession aunque todo lo demás
       fallara.
   La llave NO se deriva nunca de PIMPSTUDIO_BRIDGE_SECRET: ese lo comparten
   dos proyectos.

   Payload: { typ:'member', sub, sv, pwc?:1, iat, exp }
     sv  = session_version de la fila: subirlo en la base (cambio de clave,
           "cerrar sesión en todos lados", expulsión) invalida todos los
           tokens anteriores sin tabla de sesiones.
     pwc = token de "tienes que crear tu contraseña": vive 15 minutos y solo
           sirve para los modos que lo aceptan explícitamente.
     exp = OBLIGATORIO.

   Antes vivía en api/_auth.js; el formato y la llave son exactamente los
   mismos, así que los tokens ya emitidos siguen valiendo.
   Prefijo `_`: no cuenta como función serverless. */

import crypto from "node:crypto"
import { HOST, sessionSecret } from "./_academyHost.js"
import { academyDbTag } from "./_academyDb.js"

const MEMBER_PREFIX = "m1"
const MEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MEMBER_PWC_TTL_MS = 15 * 60 * 1000

/* Llave HKDF memoizada por secreto (un deploy nuevo con otro secreto la
   recalcula). Sin un secreto fuerte (≥16) no hay llave y todo falla
   CERRADO: no se firma ni se acepta ningún token.

   Con la base compartida (api/_academyDb.js) el `info` lleva además la
   huella de esa base: el sitio que se muda a la base del otro cambia de ids
   de miembro, y sus tokens viejos (sub = id de la base anterior) tienen que
   dejar de valer en el mismo deploy. El dueño de la base no cambia nada. */
let cached = { id: null, key: null }
function memberKey() {
  const secret = sessionSecret()
  if (!secret || secret.length < 16) return null
  const tag = academyDbTag()
  const info = tag ? `${HOST.sessionInfo}|db:${tag}` : HOST.sessionInfo
  const id = `${secret}\u0000${info}`
  if (cached.id !== id) {
    cached = { id, key: Buffer.from(crypto.hkdfSync("sha256", secret, "", info, 32)) }
  }
  return cached.key
}

function memberMac(key, body) {
  return crypto.createHmac("sha256", key).update(`${MEMBER_PREFIX}.${body}`).digest("base64url")
}

/* Comparación de MACs en tiempo constante (mismo patrón que api/_auth.js):
   se comparan los SHA-256 de los dos lados porque timingSafeEqual exige
   largos iguales, así tampoco se filtra el largo. */
function macEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false
  const ha = crypto.createHash("sha256").update(a).digest()
  const hb = crypto.createHash("sha256").update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

export function createMemberSession({ id, sessionVersion = 0, mustChangePassword = false } = {}) {
  const key = memberKey()
  if (!key) return null
  const sub = Number(id)
  if (!Number.isInteger(sub) || sub <= 0) return null
  const sv = Number.isInteger(Number(sessionVersion)) ? Number(sessionVersion) : 0
  const now = Date.now()
  const payload = { typ: "member", sub, sv }
  if (mustChangePassword) payload.pwc = 1
  payload.iat = now
  payload.exp = now + (mustChangePassword ? MEMBER_PWC_TTL_MS : MEMBER_TTL_MS)
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${MEMBER_PREFIX}.${body}.${memberMac(key, body)}`
}

/* Firma + claims, sin base de datos. Quien llama (requireMember) confirma
   contra academy_members que la fila existe, está activa y tiene el mismo
   session_version. */
export function readMemberToken(req) {
  const key = memberKey()
  if (!key) return null
  const header = req?.headers?.authorization || req?.headers?.Authorization || ""
  const token = String(header).replace(/^Bearer\s+/i, "")
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== MEMBER_PREFIX || !parts[1] || !parts[2]) return null
  if (!macEq(memberMac(key, parts[1]), parts[2])) return null
  try {
    const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
    if (!p || p.typ !== "member") return null
    if (!Number.isInteger(p.sub) || p.sub <= 0) return null
    if (!Number.isInteger(p.sv) || p.sv < 0) return null
    if (!Number.isFinite(p.exp) || Date.now() > p.exp) return null
    return p
  } catch {
    return null
  }
}

/* ¿Viene un token con forma de miembro? Solo para ELEGIR qué verificación
   correr (miembro o barbero) — nunca para conceder nada. */
export function hasMemberBearer(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || ""
  return /^Bearer\s+m1\./i.test(String(header))
}
