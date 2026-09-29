import crypto from "crypto"

/* Secreto de firma de sesiones internas. SIN respaldo público: si no hay un
   secreto fuerte configurado (PS_SESSION_SECRET o ADMIN_API_TOKEN, ≥16 chars),
   el sistema falla CERRADO — no firma ni acepta ninguna sesión. Esto evita que
   un token pueda forjarse con un secreto conocido del repositorio.
   Configurar en producción: `vercel env add PS_SESSION_SECRET`. */
const SECRET = process.env.PS_SESSION_SECRET || process.env.ADMIN_API_TOKEN || ""
const HAS_SECRET = SECRET.length >= 16
// Los tokens firmados nunca caducaban (se guardaba iat pero nunca se
// validaba). Un token robado o compartido por error quedaba válido para
// siempre. 30 días alcanza para uso normal en el celular del barbero
// (PWA instalada) sin forzar logins frecuentes.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
if (!HAS_SECRET && process.env.NODE_ENV === "production") {
  console.error("[_auth] PS_SESSION_SECRET no configurado: las sesiones internas se rechazarán.")
}

function b64url(input) {
  return Buffer.from(input).toString("base64url")
}

function sign(payload) {
  if (!HAS_SECRET) return null
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url")
}

/* Comparación de MACs en tiempo constante. Con `!==` el tiempo de respuesta
   dice cuántos caracteres del principio coinciden y deja adivinar una firma
   de a uno. Se comparan los SHA-256 de los dos lados porque timingSafeEqual
   exige largos iguales (así tampoco se filtra el largo). Mismo patrón que
   isBridgeRequest() en api/_bridge.js. */
function macEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false
  const ha = crypto.createHash("sha256").update(a).digest()
  const hb = crypto.createHash("sha256").update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

export function createSession(barber) {
  const body = b64url(JSON.stringify({
    // Tipo de token. Los de miembro de Brunetti Academy van con otra llave y
    // otro formato (api/_academySession.js); marcar el del barbero permite que
    // readSession rechace cualquier otro `typ` aunque alguien llegara a
    // firmarlo con esta llave. Nada en el front ni en iOS decodifica el token
    // (la app lo guarda opaco en el Keychain), así que el campo nuevo no
    // cambia nada para ellos.
    typ: "barber",
    id: barber.id || null,
    name: barber.name,
    code: barber.code || "",
    role: barber.role || "Barbero",
    tier: barber.tier || "general",
    admin: Boolean(barber.admin) || /brunetti|bruno|admin/i.test(`${barber.name || ""} ${barber.code || ""} ${barber.role || ""}`),
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
  }))
  const mac = sign(body)
  if (!mac) return null
  return `${body}.${mac}`
}

export function readSession(req) {
  const header = req.headers.authorization || req.headers.Authorization || ""
  const token = String(header).replace(/^Bearer\s+/i, "")
  if (!token || !token.includes(".")) return null
  // Exactamente DOS partes. Antes se tomaban las dos primeras y se ignoraba
  // el resto, así que `<token de barbero>.basura` también pasaba. El token de
  // miembro de la Academy tiene tres (`m1.<payload>.<mac>`) y muere acá antes
  // de siquiera calcular una firma.
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [body, mac] = parts
  const expected = sign(body)
  // Falla cerrado: sin secreto (expected === null) no se acepta ninguna sesión.
  if (!expected || !macEq(expected, mac)) return null
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
    if (!session?.name) return null
    // Solo sesiones de barbero. Los tokens vivos emitidos antes de agregar
    // `typ` no lo traen y se siguen aceptando (panel e iOS con sesión
    // abierta); cualquier otro tipo explícito se rechaza.
    if (session.typ !== undefined && session.typ !== "barber") return null
    // Tokens emitidos antes de agregar `exp` no lo traen: se aceptan sin
    // caducidad (no queremos desloguear a todo el mundo de golpe al
    // desplegar esto). Todo login nuevo desde ahora sí expira.
    if (session.exp && Date.now() > session.exp) return null
    return session
  } catch {
    return null
  }
}

/* Las sesiones de miembro de Brunetti Academy (`m1.<payload>.<mac>`, con
   otra llave derivada por HKDF de este mismo secreto) viven en
   api/_academySession.js: la Academy es un módulo portable y no importa
   este archivo. readSession de acá las rechaza por tener tres partes. */

export function requireInternal(req, res, options = {}) {
  const session = readSession(req)
  if (!session) {
    res.status(401).json({ ok: false, error: "Sesion interna requerida" })
    return null
  }
  if (options.admin && !session.admin) {
    res.status(403).json({ ok: false, error: "Permiso de administrador requerido" })
    return null
  }
  return session
}
