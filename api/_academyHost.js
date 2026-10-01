/* BRUNETTI ACADEMY — Archivo del HOST (propio de este repo)
   ------------------------------------------------------------------
   La Academy es un módulo portable (docs/academy/PORTABLE.md): el mismo
   código de api/_academy*.js corre en pimpstudio.cl/academy y en
   brunetticutz.cl/cursos. Todo lo que cambia entre un sitio y otro vive
   ACÁ, y este archivo es lo único del backend compartido que puede tocar
   al resto del repo. scripts/academy-sync.mjs NO lo copia: cada repo
   tiene el suyo, con la misma forma (el de PimpStudio es la referencia).

   Reglas:
     - Sin imports estáticos del proyecto: HOST se lee desde casi todos los
       archivos de la Academy (y desde api/_webpush.js), y cargarlo no debe
       arrastrar _auth.js ni push.js. Los dos se cargan con import()
       dinámico solo cuando se usan.
     - sessionInfo NO se cambia nunca con el sitio en producción: es el
       `info` de HKDF de los tokens de miembro (api/_academySession.js), y
       cambiarlo cierra la sesión de todos los alumnos a la vez. Es distinto
       del de PimpStudio a propósito: un token de alumno de allá no sirve
       acá aunque los dos proyectos compartieran PS_SESSION_SECRET.
   Prefijo `_`: no cuenta como función serverless (tope 12 del plan Hobby). */

export const HOST = {
  key: "brunetticutz",
  basePath: "/cursos",
  defaultSiteUrl: "https://brunetticutz.cl",
  sessionInfo: "brunetticutz:academy:member:v1",
  // Texto de la cartola: Mercado Pago documenta hasta 13 caracteres
  // (Checkout Pro → "Descripción en la factura"). "BRUNETTI ACADEMY" (16) se
  // salía del contrato; "BRUNETTI" es el mismo que ya manda en producción el
  // checkout de siempre (api/mp-payments.js) con este MP_ACCESS_TOKEN.
  statementDescriptor: "BRUNETTI",
  // El webhook de Mercado Pago de este sitio es el de siempre
  // (api/mp-payments.js), que reparte por external_reference: "aca-…" va a
  // la Academy, lo demás sigue por Cursos/Workshop/Essentials.
  mpNotificationPath: "/api/mp-payments?webhook=1",
  brand: {
    name: "Brunetti Academy",
    short: "Academy",
    initials: "BA",
    siteName: "Brunetti",
    emailFromName: "Brunetti Academy",
    // PNG y no el wordmark .webp de los correos de reservas: varios clientes
    // de correo (Outlook) no muestran webp. Sin emailLogoPath, los correos de
    // la Academy usan este mismo.
    logoPath: "/assets/brunetti-logo-icon-192.png",
    color: "#1c1c1c",
    groupUrlLabel: "brunetticutz.cl/cursos",
    supportWhatsapp: null,
  },
  defaultLinks: [{ title: "Reserva tu hora", url: "https://brunetticutz.cl/reservar" }],
  // El otro sitio de la MISMA Academy (pimpstudio.cl/academy). La base de la
  // Academy es la de allá: este proyecto se conecta con ACADEMY_DATABASE_URL
  // (api/_academyDb.js). El puente (api/_academyPeer.js) es solo para lo que
  // no se comparte: los push a teléfonos suscritos allá y verificar pagos
  // cobrados con su Mercado Pago. Misma variable que ya usa el puente de
  // fidelidad (api/_loyaltyBridge.js).
  peer: {
    key: "pimpstudio",
    apiBase: () => process.env.PIMPSTUDIO_API_BASE || "https://pimpstudio.cl",
  },
}

/* SITE_URL sin barra final, o el dominio de este sitio. Es la misma
   variable que ya usa el enlace de "restablecer contraseña" del panel. */
export function siteUrl() {
  const raw = String(process.env.SITE_URL || "").trim().replace(/\/+$/, "")
  return raw || HOST.defaultSiteUrl
}

/* El secreto de las sesiones internas, con la misma regla del panel
   (api/_auth.js): PS_SESSION_SECRET o ADMIN_API_TOKEN de 16 caracteres o
   más. Si no hay uno fuerte devuelve "" y la Academy falla CERRADO (no
   firma ni acepta tokens de miembro). */
export function sessionSecret() {
  const s = process.env.PS_SESSION_SECRET || process.env.ADMIN_API_TOKEN || ""
  return s.length >= 16 ? s : ""
}

/* Misma regla de administrador que el resto de BrunettiCutz (isAdmin de
   api/auth-barber.js, isAdminProfile de api/barbers.js y createSession de
   api/_auth.js): se decide por nombre, usuario y rol. Acá no hay columna
   is_admin ni barber_permissions (eso es de PimpStudio, no se portó). */
const ADMIN_RE = /brunetti|bruno|admin/i
const isAdminProfile = (b) => ADMIN_RE.test(`${b?.name || ""} ${b?.code || ""} ${b?.role || ""}`)

/* Barbero administrador del panel, verificado contra la BASE.
   → { barberId, name, email } o null con la respuesta ya enviada.

   Más estricto que requireInternal(req, res, { admin: true }) del resto del
   panel, que se cree el `admin` firmado en el token (vive 30 días). Acá se
   exige, en este orden:
     1. un token de barbero válido (readSession: dos partes, firma en tiempo
        constante, typ barber o ausente);
     2. que el token tenga `exp`: los emitidos antes de que existiera no
        vencen nunca, y uno de esos, filtrado, no debe poder abrir la
        Academy como propietario (un login nuevo en el panel lo resuelve);
     3. `admin: true` en el token;
     4. que el barbero EXISTA en la base, siga activo y que su fila de HOY
        siga cumpliendo la regla de admin: renombrar o desactivar a alguien
        le quita la Academy al instante, sin esperar a que venza su token.
   Si la base no responde es 503: no se concede lo que no se pudo verificar. */
export async function requireBarberAdmin(sql, req, res) {
  let readSession
  try {
    ;({ readSession } = await import("./_auth.js"))
  } catch (err) {
    console.error("[academy:host] no cargó _auth.js:", err?.message || err)
    res.status(503).json({ ok: false, error: "No se pudieron verificar tus permisos. Intenta de nuevo." })
    return null
  }
  const session = readSession(req)
  if (!session) {
    res.status(401).json({ ok: false, error: "Sesion interna requerida" })
    return null
  }
  res.setHeader("Cache-Control", "private, no-store")
  if (!session.exp) {
    res.status(403).json({ ok: false, error: "Tu sesión del panel es antigua. Cierra sesión y vuelve a entrar para abrir la Academy.", code: "legacy_token" })
    return null
  }
  const barberId = Number(session.id)
  if (!Number.isInteger(barberId) || barberId <= 0) {
    res.status(403).json({ ok: false, error: "Sesión sin barbero asociado", code: "forbidden" })
    return null
  }
  if (session.admin !== true) {
    res.status(403).json({ ok: false, error: "Permiso de administrador requerido", code: "forbidden" })
    return null
  }
  let row
  try {
    // to_jsonb(b)->>'email': no falla si una base vieja no tiene la columna
    // (la agrega ensureAuthColumns de api/_schema.js).
    ;[row] = await sql`
      SELECT b.id, b.name, b.code, b.role, to_jsonb(b)->>'email' AS email, COALESCE(b.active, true) AS active
      FROM barbers b
      WHERE b.id = ${barberId}
    `
  } catch (err) {
    console.error("[academy:host] requireBarberAdmin:", err?.code || err?.message || err)
    res.status(503).json({ ok: false, error: "No se pudieron verificar tus permisos. Intenta de nuevo." })
    return null
  }
  if (!row) {
    res.status(403).json({ ok: false, error: "No encontramos tu ficha de barbero.", code: "forbidden" })
    return null
  }
  // Mismo 401 que ?me=1 de api/auth-barber.js: el panel cierra la sesión.
  if (row.active === false) {
    res.status(401).json({ ok: false, error: "Cuenta desactivada" })
    return null
  }
  if (!isAdminProfile(row)) {
    res.status(403).json({ ok: false, error: "Permiso de administrador requerido", code: "forbidden" })
    return null
  }
  return { barberId, name: row.name || session.name || "", email: row.email || null }
}

/* Aviso al panel (SPEC §6.3): una fila en `notifications` por cada barbero
   admin activo + notifyBarber(id, …, {log:false}) de api/push.js para el
   push. NUNCA notifyAll: deja la fila con barber_id NULL, que la campana del
   panel muestra a TODOS los barberos (GET /api/push lee `barber_id = yo OR
   barber_id IS NULL`), y manda el push a todas las suscripciones; una venta
   de la Academy es cosa del administrador. Tampoco notifyBarber con
   log:true: corre CREATE TABLE en cada llamada, y esto va en el camino del
   webhook (sin DDL). La fila se escribe acá, directo; si la tabla todavía no
   existe (42P01) igual se intenta el push. Solo lo que manda la Academy
   (título, texto, url, tag): sin teléfono ni correo del cliente.
   Hoy el único admin es Bruno (barbero 6), pero se busca por la regla de
   siempre para no cablear un id. Devuelve a cuántos admins se avisó. NUNCA
   lanza. */
export async function notifyStaff(sql, { title, body, url, tag } = {}) {
  const logErr = (where, err) => console.error(`[academy:host] ${where}:`, err?.message || err)
  try {
    const payload = { title: title || HOST.brand.name, body: body || null, url: url || null, tag: tag || null }
    let ids = []
    try {
      const rows = await sql`SELECT id, name, code, role FROM barbers WHERE COALESCE(active, true)`
      ids = rows.filter(isAdminProfile).map((r) => Number(r.id)).filter((id) => Number.isInteger(id) && id > 0)
    } catch (err) {
      logErr("admins", err)
      return 0
    }
    if (!ids.length) return 0
    try {
      await sql`
        INSERT INTO notifications (barber_id, title, body, url, tag)
        SELECT x.id, ${payload.title}, ${payload.body}, ${payload.url}, ${payload.tag}
        FROM unnest(${ids}::int[]) AS x(id)
      `
    } catch (err) {
      if (err?.code !== "42P01") logErr("campana del panel", err)
    }
    let notifyBarber
    try {
      // Dinámico: push.js carga el cron de la Academy (y _auth.js); estático
      // cerraría un ciclo y arrastraría medio panel a cada archivo que lee HOST.
      notifyBarber = (await import("./push.js")).notifyBarber
    } catch (err) {
      logErr("push.js", err)
      return ids.length
    }
    if (typeof notifyBarber !== "function") return ids.length
    await Promise.allSettled(ids.map((id) => {
      let timer
      // Tope de 5 s por admin: Mercado Pago espera 22 s la respuesta del
      // webhook y un servicio de push colgado no puede comérselos.
      const limit = new Promise((resolve) => { timer = setTimeout(resolve, 5000) })
      const send = Promise.resolve().then(() => notifyBarber(id, payload, { log: false })).catch((err) => logErr("push admin", err))
      return Promise.race([send, limit]).finally(() => clearTimeout(timer))
    }))
    return ids.length
  } catch (err) {
    logErr("notifyStaff", err)
    return 0
  }
}
