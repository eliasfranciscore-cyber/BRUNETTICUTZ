import { neon } from "@neondatabase/serverless"
import crypto from "crypto"
import { createSession, requireInternal } from "./_auth.js"

/* PIMP STUDIO — Autenticación de barberos (usuario + contraseña)
   ------------------------------------------------------------------
   POST  : login con { username, password }.
   PATCH : cambio de contraseña del barbero autenticado (sesión interna +
           { currentPassword, newPassword }; la actual es obligatoria).

   Contraseña: 8 caracteres alfanuméricos, al menos 1 mayúscula y 1 número.
   Hash: SHA-256 (consistente con el esquema existente del proyecto).

   Fuente de credenciales:
     1) Neon (columna barbers.password_hash) cuando DATABASE_URL está activo.
     2) Respaldo seguro: variable de entorno BARBER_PASSWORDS (JSON code->hash)
        cuando la base de datos no está disponible. Así el login funciona en
        producción aunque Neon no esté conectado, sin exponer hashes en el repo. */

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex")

const isAdmin = (b) => /brunetti|bruno|admin/i.test(`${b.name || ""} ${b.code || ""} ${b.role || ""}`)

export function isValidPassword(pw) {
  return typeof pw === "string" && /^[A-Za-z0-9]{8,64}$/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw)
}

// Perfiles base (públicos) usados con el respaldo por variable de entorno.
const BARBER_PROFILES = [
  { id: 4,  name: "Juan Carlos",         code: "juan-carlos",         role: "Barbero Senior",      tier: "general" },
  { id: 5,  name: "Andryz",              code: "andryz",              role: "Barbero",             tier: "general" },
  { id: 6,  name: "Brunetti",            code: "bruno-herrera",       role: "Visagista · Premium", tier: "premium" },
  { id: 7,  name: "Diego Moya",          code: "diego-moya",          role: "Barbero",             tier: "general" },
  { id: 8,  name: "Thinn Sayen Herrera", code: "thinn-sayen-herrera", role: "Barbero",             tier: "general" },
  { id: 9,  name: "Vicente Pietrapiana", code: "vicente-pietrapiana", role: "Barbero",             tier: "general" },
  { id: 10, name: "Rodrigo Godoy",       code: "rodrigo-godoy",       role: "Barbero",             tier: "general" },
  { id: 11, name: "Matías Inostroza",    code: "matias-inostroza",    role: "Barbero Junior",      tier: "general" },
]

function fallbackPasswords() {
  try { return JSON.parse(process.env.BARBER_PASSWORDS || "{}") } catch { return {} }
}

function fallbackLogin(username, password) {
  const map = fallbackPasswords()
  const u = String(username || "").toLowerCase().trim()
  const profile = BARBER_PROFILES.find((b) => b.code === u || b.name.toLowerCase() === u)
  if (!profile) return null
  const expected = map[profile.code]
  if (!expected || sha256(password) !== expected) return null
  return { ...profile, admin: isAdmin(profile) }
}

async function handleLogin(req, res) {
  const { username, password, pin } = req.body || {}
  const secret = password || pin // compat: clientes antiguos enviaban "pin"
  if (!username || !secret) return res.status(400).json({ error: "Usuario y contraseña requeridos" })

  try {
    const sql = neon(process.env.DATABASE_URL)
    const hash = sha256(secret)
    // Coincidencia EXACTA (sin mayúsculas ni espacios de los bordes). Antes el
    // nombre se comparaba con ILIKE, donde `%` y `_` son comodines: un usuario
    // "%" calzaba con cualquier barbero activo cuya contraseña fuera la que se
    // tecleó — y el seed deja a varios con la misma contraseña por defecto.
    const user = String(username).toLowerCase().trim()
    const [barber] = await sql`
      SELECT id, name, code, role, tier FROM barbers
      WHERE (code = ${user} OR lower(name) = ${user})
        AND password_hash = ${hash} AND active = true
    `
    if (!barber) {
      // DB disponible pero credenciales no coinciden: no caer al respaldo.
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" })
    }
    const withAdmin = { ...barber, admin: isAdmin(barber) }
    const token = createSession(withAdmin)
    if (!token) return res.status(503).json({ error: "Autenticación no configurada en el servidor (PS_SESSION_SECRET)." })
    return res.json({ ok: true, barber: withAdmin, token })
  } catch (err) {
    console.error("auth-barber DB error, usando respaldo:", err?.message || err)
    // Base de datos no disponible → respaldo por variable de entorno.
    const fb = fallbackLogin(username, secret)
    if (fb) {
      const token = createSession(fb)
      if (!token) return res.status(503).json({ error: "Autenticación no configurada en el servidor (PS_SESSION_SECRET)." })
      return res.json({ ok: true, barber: fb, token })
    }
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" })
  }
}

async function handleChangePassword(req, res) {
  const session = requireInternal(req, res)
  if (!session) return
  const { currentPassword, newPassword } = req.body || {}
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ ok: false, error: "La contraseña debe tener 8 caracteres alfanuméricos, con al menos 1 mayúscula y 1 número." })
  }
  // Antes la contraseña actual era opcional: si no venía, el cambio pasaba
  // igual, y cualquier token robado se convertía en una toma de cuenta
  // permanente. Ahora es obligatoria siempre.
  if (!currentPassword) return res.status(400).json({ ok: false, error: "Ingresa tu contraseña actual." })
  if (!session.id) return res.status(403).json({ ok: false, error: "Sesión sin barbero asociado" })
  try {
    const sql = neon(process.env.DATABASE_URL)
    const [current] = await sql`SELECT password_hash FROM barbers WHERE id = ${Number(session.id)} AND active = true`
    if (!current) return res.status(401).json({ ok: false, error: "Cuenta no disponible" })
    if (current.password_hash && sha256(currentPassword) !== current.password_hash) {
      return res.status(403).json({ ok: false, error: "La contraseña actual no es correcta." })
    }
    await sql`UPDATE barbers SET password_hash = ${sha256(newPassword)} WHERE id = ${Number(session.id)}`
    return res.json({ ok: true })
  } catch (err) {
    console.error("change password DB error:", err?.message || err)
    // Sin base de datos no es posible persistir el cambio en el servidor.
    return res.status(503).json({ ok: false, error: "El cambio de contraseña requiere la base de datos conectada. Inténtalo cuando el sistema esté en línea." })
  }
}

export default async function handler(req, res) {
  if (req.method === "POST") return handleLogin(req, res)
  if (req.method === "PATCH" || req.method === "PUT") return handleChangePassword(req, res)
  return res.status(405).json({ error: "Method not allowed" })
}
