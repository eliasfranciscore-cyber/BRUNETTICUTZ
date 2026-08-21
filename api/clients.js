import { neon } from "@neondatabase/serverless"
import { requireInternal } from "./_auth.js"
import { rateLimit, clientIp } from "./_rateLimit.js"
import { sendLoyaltyCardEmail } from "./_email.js"
import {
  isLoyaltyBridgeConfigured, shareToken, applePassBytes, googleSaveURL, tarjetaInfo,
  loyaltyFor, loyaltyForPhones, walletStats, walletCampaigns, sendWalletCampaign,
} from "./_loyaltyBridge.js"

const DEMO_CLIENTS = [
  { id: 1, name: "Carlos Rodriguez", phone: "987654321", email: "carlos@ejemplo.com", visits: 4, totalSpent: 68960, lastVisit: "2026-05-22", status: "activo" },
  { id: 2, name: "Maria Gonzalez", phone: "912345678", email: "maria@ejemplo.com", visits: 2, totalSpent: 55980, lastVisit: "2026-06-04", status: "activo" },
  { id: 3, name: "Pedro Soto", phone: "956789012", email: "pedro@ejemplo.com", visits: 1, totalSpent: 9990, lastVisit: "2026-06-09", status: "nuevo" },
]

function cleanPhone(value) {
  let digits = String(value || "").replace(/\D/g, "")
  if (digits.length > 9 && digits.startsWith("56")) digits = digits.slice(2)
  return digits.slice(0, 9)
}

function validateClient(body = {}) {
  const name = String(body.name || "").trim()
  const phone = cleanPhone(body.phone)
  const email = String(body.email || "").trim().toLowerCase()
  if (!name) return { error: "Nombre requerido" }
  if (phone.length !== 9) return { error: "El telefono debe tener 9 digitos" }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Correo invalido" }
  return { name, phone, email }
}

export default async function handler(req, res) {
  try {
    const sql = neon(process.env.DATABASE_URL)

    /* Tarjeta de fidelidad (Apple/Google Wallet) — el programa de puntos es el
       de PimpStudio y vive en su base de datos; acá solo se hace de puente
       para que el navegador del cliente nunca llame a otro dominio (CORS/CSP)
       ni su teléfono viaje en una URL ajena. Ver api/_loyaltyBridge.js.

       Va antes del dispatch normal porque son modos, no rutas: comparten
       archivo con el resto de clientes por el tope de 12 funciones
       serverless del plan Hobby (ver CLAUDE.md). */
    const mode = String(req.query.mode || "")
    if (mode.startsWith("wallet-")) {
      if (!isLoyaltyBridgeConfigured()) return res.status(501).json({ ok: false, error: "Tarjeta de fidelidad no configurada" })
      const ip = clientIp(req)

      // --- Modos públicos: el "login" del cliente es saber su propio teléfono,
      // mismo criterio que la búsqueda por teléfono de más abajo.
      if (mode === "wallet-pass" || mode === "wallet-pass-google") {
        const allowed = await rateLimit(sql, `wallet-pass:${ip}`, { max: 10, windowSeconds: 60 })
        if (!allowed) return res.status(429).json({ ok: false, error: "Demasiadas solicitudes. Intenta de nuevo en un momento." })

        // Dos identificadores posibles: ?t= (link personal de /tarjeta, ya es
        // un token) o ?phone= (cliente identificado en /cuenta o en el popup
        // tras reservar), que se convierte en token antes de salir de acá.
        let token = String(req.query.t || "")
        if (!token) {
          const phone = cleanPhone(req.query.phone)
          if (phone.length !== 9) return res.status(400).json({ ok: false, error: "Telefono invalido" })
          const [client] = await sql`SELECT name FROM users WHERE phone = ${phone}`
          if (!client) return res.status(404).json({ ok: false, error: "Cliente no registrado" })
          // El pase se pide SIEMPRE por token, nunca por teléfono: así el
          // número no queda escrito en ninguna request a otro dominio.
          const share = await shareToken({ phone, name: client.name, ip })
          if (!share.ok) return res.status(share.status >= 400 ? share.status : 502).json({ ok: false, error: share.error })
          token = share.token
        }

        if (mode === "wallet-pass-google") {
          const result = await googleSaveURL(token, ip)
          if (!result.ok) return res.status(result.status >= 400 ? result.status : 502).json({ ok: false, error: result.error })
          return res.json({ ok: true, saveUrl: result.saveUrl })
        }

        // iOS: se reenvían los bytes del .pkpass ya firmado por PimpStudio tal
        // cual. Firmarlo acá exigiría duplicar certificados de Apple en dos
        // proyectos para el MISMO pase, que es justo lo que no queremos.
        const pass = await applePassBytes(token, ip)
        if (pass.status >= 400 || !pass.buffer?.length) {
          return res.status(pass.status >= 400 ? pass.status : 502).json({ ok: false, error: "No se pudo generar el pase" })
        }
        res.setHeader("Content-Type", "application/vnd.apple.pkpass")
        res.setHeader("Content-Disposition", "attachment; filename=brunetti.pkpass")
        return res.status(200).send(pass.buffer)
      }

      // Saludo de /tarjeta: resuelve el token del link de WhatsApp a un
      // nombre. El teléfono no vuelve nunca por acá.
      if (mode === "wallet-tarjeta-info") {
        const info = await tarjetaInfo(String(req.query.t || ""), ip)
        if (!info.ok) return res.status(info.status >= 400 ? info.status : 502).json({ ok: false, error: info.error })
        return res.json({ ok: true, name: info.name })
      }

      // ¿Ya lo agregó? Verdad de servidor (registro real del dispositivo en
      // Wallet), no un flag local que se desincroniza si cambia de teléfono.
      if (mode === "wallet-status") {
        const phone = cleanPhone(req.query.phone)
        if (phone.length !== 9) return res.status(400).json({ ok: false, error: "Telefono invalido" })
        const result = await loyaltyFor(phone, ip)
        if (!result) return res.json({ ok: true, hasPass: false, loyalty: null })
        return res.json({ ok: true, hasPass: result.hasPass, loyalty: result.loyalty })
      }

      // --- Modos del panel (sesión de barbero) ------------------------------
      const session = requireInternal(req, res)
      if (!session) return

      // Link personal para mandarle la tarjeta al cliente por WhatsApp.
      if (mode === "wallet-share-link") {
        const phone = cleanPhone(req.query.phone)
        if (phone.length !== 9) return res.status(400).json({ ok: false, error: "Telefono invalido" })
        const [client] = await sql`SELECT name FROM users WHERE phone = ${phone}`
        if (!client) return res.status(404).json({ ok: false, error: "Cliente no registrado" })
        const share = await shareToken({ phone, name: client.name, ip })
        if (!share.ok) return res.status(share.status >= 400 ? share.status : 502).json({ ok: false, error: share.error })
        return res.json({ ok: true, url: `https://brunetticutz.cl/tarjeta?t=${share.token}`, name: client.name })
      }

      // Pestaña Marketing: las cifras son las MISMAS que ve el panel de
      // PimpStudio — el programa de puntos es uno solo para los dos negocios.
      if (mode === "wallet-stats") {
        const stats = await walletStats(ip)
        if (!stats) return res.status(502).json({ ok: false, error: "No se pudieron cargar las métricas" })
        return res.json({ ok: true, stats })
      }

      if (mode === "wallet-campaigns") {
        return res.json({ ok: true, campaigns: await walletCampaigns(ip) })
      }

      /* Envío por correo de la tarjeta: a cada cliente su link personal
         /tarjeta?t=… (abre el pase de Apple o de Google según su teléfono).

         Va POR TANDAS, no de una: 167 correos a ~600 ms cada uno (el límite
         de Resend son 2/s) son minutos, y una función de Vercel se corta
         mucho antes. El panel llama esto en bucle hasta que `remaining`
         llega a 0, así que además se puede detener a mitad sin dejar nada
         inconsistente — `loyalty_card_emailed_at` marca cliente por cliente
         quién ya recibió el suyo. */
      if (req.method === "POST" && mode === "wallet-send-cards") {
        const { limit = 5, onlyPhone = null, again = false, includeInstalled = false, testEmail = null } = req.body || {}
        const batch = Math.min(Math.max(Number(limit) || 5, 1), 8)

        // Correo de prueba: manda la tarjeta REAL de un cliente (su link, su
        // saldo) a otra dirección, para revisar cómo llega antes de tocar la
        // lista. Exige onlyPhone y no marca nada: no es un envío al cliente.
        const testTo = testEmail ? String(testEmail).trim().toLowerCase() : null
        if (testTo && (!onlyPhone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo))) {
          return res.status(400).json({ ok: false, error: "Para la prueba hace falta un teléfono y un correo válido" })
        }

        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_card_emailed_at TIMESTAMPTZ`

        // El filtro del correo es el mismo de validateClient: sin un correo
        // con forma de correo, Resend rebota y gasta cuota.
        const only = onlyPhone ? cleanPhone(onlyPhone) : null
        const pending = await sql`
          SELECT id, name, phone, email
          FROM users
          WHERE email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
            AND (${only}::text IS NULL OR phone = ${only}::text)
            AND (${again}::boolean OR loyalty_card_emailed_at IS NULL)
          ORDER BY updated_at DESC NULLS LAST, id DESC
          LIMIT 400
        `
        if (!pending.length) return res.json({ ok: true, sent: 0, failed: 0, remaining: 0, done: true })

        // Quién ya agregó el pase: molestarlo con el correo no aporta nada.
        // Una sola llamada al puente para toda la tanda pendiente.
        let candidates = pending
        if (!includeInstalled) {
          const byPhone = await loyaltyForPhones(pending.map((c) => c.phone), ip).catch(() => ({}))
          candidates = pending.filter((c) => !byPhone[c.phone]?.hasPass)
          // Los que ya lo tienen se marcan como "listos" para que no vuelvan
          // a contarse como pendientes en cada vuelta del bucle.
          const installed = pending.filter((c) => byPhone[c.phone]?.hasPass).map((c) => c.id)
          if (installed.length) await sql`UPDATE users SET loyalty_card_emailed_at = NOW() WHERE id = ANY(${installed})`
        }
        if (!candidates.length) return res.json({ ok: true, sent: 0, failed: 0, remaining: 0, done: true })

        const slice = candidates.slice(0, batch)
        let sent = 0, failed = 0
        const errors = []
        for (const client of slice) {
          try {
            const share = await shareToken({ phone: client.phone, name: client.name, ip })
            if (!share.ok) throw new Error(share.error || "no se pudo generar el link")
            const bonus = await loyaltyFor(client.phone, ip).catch(() => null)
            const result = await sendLoyaltyCardEmail({
              to: testTo || client.email,
              name: client.name,
              url: `https://brunetticutz.cl/tarjeta?t=${share.token}`,
              stars: bonus?.loyalty?.stars || 0,
            })
            if (!result.ok) throw new Error(result.reason || "resend")
            // La prueba no marca al cliente: no recibió nada.
            if (!testTo) await sql`UPDATE users SET loyalty_card_emailed_at = NOW() WHERE id = ${client.id}`
            sent++
          } catch (err) {
            failed++
            errors.push(`${client.name || client.phone}: ${err.message}`)
            console.error("wallet-send-cards error:", client.phone, err?.message || err)
          }
        }

        const remaining = Math.max(0, candidates.length - slice.length)
        return res.json({ ok: true, sent, failed, remaining, done: remaining === 0, errors: errors.slice(0, 3) })
      }

      if (req.method === "POST" && mode === "wallet-campaign") {
        const { status, data } = await sendWalletCampaign({ message: req.body?.message, audience: req.body?.audience, ip })
        return res.status(status).json(data)
      }

      return res.status(404).json({ ok: false, error: "Modo no reconocido" })
    }

    if (req.method === "GET") {
      const phone = cleanPhone(req.query.phone)
      if (phone) {
        const allowed = await rateLimit(sql, `clients-get:${clientIp(req)}`, { max: 30, windowSeconds: 60 })
        if (!allowed) return res.status(429).json({ ok: false, error: "Demasiadas solicitudes. Intenta de nuevo en un momento." })
        // Sin sesión: cualquiera que sepa este teléfono puede pedir esto
        // (es como funciona el "login" del cliente hoy, sin contraseña).
        // No devolver el email acá — el front público (Account.jsx) no lo
        // usa, y es PII que no hace falta exponer sin verificar identidad.
        const [client] = await sql`
          SELECT u.id, u.name, u.phone,
                 COUNT(b.id)::int as visits,
                 COALESCE(SUM(CASE WHEN b.status = 'completada' THEN COALESCE(b.custom_price, s.price) ELSE 0 END), 0)::int as "totalSpent",
                 MAX(b.booking_date)::text as "lastVisit",
                 CASE WHEN COUNT(b.id) > 0 THEN 'activo' ELSE 'nuevo' END as status
          FROM users u
          LEFT JOIN bookings b ON b.client_id = u.id
          LEFT JOIN services s ON s.id = b.service_id
          WHERE u.phone = ${phone}
          GROUP BY u.id
        `
        if (!client) return res.status(404).json({ ok: false, error: "Cliente no registrado" })
        // Estrellas del programa de PimpStudio para la cuenta del cliente. Si
        // el puente no responde va `null` y la página simplemente no muestra
        // la tarjeta — nunca se cae por esto.
        const bonus = await loyaltyFor(client.phone, clientIp(req)).catch(() => null)
        return res.json({ ok: true, client: { ...client, loyalty: bonus?.loyalty || null, walletHasPass: Boolean(bonus?.hasPass) } })
      }

      const session = requireInternal(req, res)
      if (!session) return
      const clients = await sql`
        SELECT u.id, u.name, u.phone, u.email,
               COUNT(b.id)::int as visits,
               COALESCE(SUM(CASE WHEN b.status = 'completada' THEN COALESCE(b.custom_price, s.price) ELSE 0 END), 0)::int as "totalSpent",
               MAX(b.booking_date)::text as "lastVisit",
               CASE WHEN COUNT(b.id) > 0 THEN 'activo' ELSE 'nuevo' END as status
        FROM users u
        LEFT JOIN bookings b ON b.client_id = u.id
        LEFT JOIN services s ON s.id = b.service_id
        GROUP BY u.id
        ORDER BY MAX(u.updated_at) DESC NULLS LAST, u.id DESC
        LIMIT 100
      `
      // Saldos de toda la lista en UNA llamada al puente (no una por cliente:
      // serían 100 round-trips entre dos deployments por cada carga del panel).
      const byPhone = await loyaltyForPhones(clients.map((c) => c.phone), clientIp(req)).catch(() => ({}))
      return res.json({
        ok: true,
        clients: clients.map((c) => ({
          ...c,
          loyalty: byPhone[c.phone]?.loyalty || null,
          walletHasPass: Boolean(byPhone[c.phone]?.hasPass),
        })),
      })
    }

    if (req.method === "POST") {
      const payload = validateClient(req.body)
      if (payload.error) return res.status(400).json({ ok: false, error: payload.error })
      const [client] = await sql`
        INSERT INTO users (name, phone, email, updated_at)
        VALUES (${payload.name}, ${payload.phone}, ${payload.email}, NOW())
        ON CONFLICT (phone) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          updated_at = NOW()
        RETURNING id, name, phone, email
      `
      return res.json({ ok: true, client: { ...client, visits: 0, totalSpent: 0, status: "nuevo" } })
    }

    if (req.method === "DELETE") {
      const session = requireInternal(req, res)
      if (!session) return
      const phone = cleanPhone(req.query.phone)
      if (phone.length !== 9) return res.status(400).json({ ok: false, error: "Telefono invalido" })
      const [user] = await sql`SELECT id FROM users WHERE phone = ${phone}`
      if (!user) return res.status(404).json({ ok: false, error: "Cliente no encontrado" })
      // bookings.client_id no tiene ON DELETE: borrar primero sus reservas.
      await sql`DELETE FROM bookings WHERE client_id = ${user.id}`
      await sql`DELETE FROM users WHERE id = ${user.id}`
      return res.json({ ok: true })
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" })
  } catch (err) {
    console.error("clients error:", err)
    // Los modos de Wallet no tienen equivalente en datos de demo: devolver la
    // lista falsa acá haría que el front creyera que generó un pase.
    if (String(req.query.mode || "").startsWith("wallet-")) {
      return res.status(502).json({ ok: false, error: "No se pudo procesar la tarjeta de fidelidad" })
    }
    if (req.method === "GET") {
      const phone = cleanPhone(req.query.phone)
      if (phone) {
        const client = DEMO_CLIENTS.find((item) => item.phone === phone)
        if (!client) return res.status(404).json({ ok: false, error: "Cliente no registrado" })
        return res.json({ ok: true, client })
      }
      const session = requireInternal(req, res)
      if (!session) return
      return res.json({ ok: true, clients: DEMO_CLIENTS })
    }
    if (req.method === "POST") {
      const payload = validateClient(req.body)
      if (payload.error) return res.status(400).json({ ok: false, error: payload.error })
      return res.json({ ok: true, client: { id: Date.now(), ...payload, visits: 0, totalSpent: 0, status: "nuevo" } })
    }
    if (req.method === "DELETE") {
      const session = requireInternal(req, res)
      if (!session) return
      return res.json({ ok: true })
    }
    return res.status(500).json({ ok: false, error: "No se pudo procesar clientes" })
  }
}
