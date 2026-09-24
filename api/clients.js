import { neon } from "@neondatabase/serverless"
import { put } from "@vercel/blob"
import { requireInternal, readSession } from "./_auth.js"
import { rateLimit, clientIp } from "./_rateLimit.js"
import { sendLoyaltyCardEmail } from "./_email.js"
import {
  isLoyaltyBridgeConfigured, shareToken, applePassBytes, googleSaveURL, tarjetaInfo,
  loyaltyFor, loyaltyForPhones, walletStats, walletCampaigns, sendWalletCampaign,
} from "./_loyaltyBridge.js"
import { isBridgeRequest, normalizePhone, EMAIL_RE } from "./_bridge.js"
import { purgeLoyaltyForClient } from "./_bookingLife.js"
import { ensureClientColumns } from "./_schema.js"

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
  // Profesión: texto libre y opcional, la completa el barbero desde la ficha
  // del cliente en el panel. `undefined` = el campo no vino en el body (la
  // app de iOS no lo manda) → no se toca lo ya guardado. String vacío =
  // borrarla (NULL). Cualquier otro valor se recorta a 80 caracteres.
  const hasProfession = body.profession !== undefined
  const profession = hasProfession ? (String(body.profession ?? "").trim().slice(0, 80) || null) : null
  return { name, phone, email, hasProfession, profession }
}

/* ---------------------------------------------------------------------------
   Modos del puente (?mode=bridge-*): PimpStudio, servidor-a-servidor, con el
   header X-Bridge-Secret (ver api/_bridge.js).

     GET  ?mode=bridge-clients  TODOS los clientes de esta base, con su
                                actividad, para la lista "todos" del admin de
                                PimpStudio (allá se cruzan por teléfono).
     POST ?mode=bridge-client   Registra (o actualiza) un cliente de Bruno
                                desde el panel de PimpStudio.

   Sin el secreto correcto responden 404: para cualquier otro, no existen.
   Tienen su propio try/catch y NUNCA caen a los datos de demo del final de
   handler(): una lista inventada o un `{ok:true}` falso le haría creer a
   PimpStudio que estos son los clientes reales o que el alta quedó guardada.

   El teléfono se limpia con normalizePhone() (últimos 9 dígitos, igual que
   PimpStudio), no con cleanPhone() de arriba (primeros 9): es la llave del
   cruce entre los dos negocios.
   ------------------------------------------------------------------------- */

/* Una fila por cliente (TODOS los users), con la actividad que PimpStudio
   muestra al lado de la suya:
     visits     = reservas completadas
     bookings   = reservas no canceladas
     lastVisit  = 'YYYY-MM-DD' de la última no cancelada (puede ser una hora
                  futura ya agendada), o null
     totalSpent = suma de COALESCE(custom_price, services.price) de las
                  completadas (custom_price es el precio congelado al reservar)
     createdAt  = ISO UTC. La columna es TIMESTAMP sin zona escrita con NOW()
                  en la zona de la sesión, así que ::timestamptz la interpreta
                  en esa misma zona.

   El teléfono sale normalizado a 9 dígitos; el que no queda en 9 se omite y
   se cuenta en `skipped` (clients.length + skipped = total de users). Dos
   filas que normalizan al mismo teléfono salen las DOS: juntarlas es trabajo
   de quien cruza, y PimpStudio ya las suma en sanitizeRemoteClients(). Una
   sola lectura, sin escrituras. */
async function bridgeClientList(sql) {
  const rows = await sql`
    SELECT u.phone, COALESCE(u.name, '') AS name,
           NULLIF(btrim(COALESCE(u.email, '')), '') AS email,
           COUNT(b.id) FILTER (WHERE b.status = 'completada')::int AS visits,
           COUNT(b.id) FILTER (WHERE b.status IS DISTINCT FROM 'cancelada')::int AS bookings,
           (MAX(b.booking_date) FILTER (WHERE b.status IS DISTINCT FROM 'cancelada'))::text AS "lastVisit",
           COALESCE(SUM(COALESCE(b.custom_price, s.price)) FILTER (WHERE b.status = 'completada'), 0)::int AS "totalSpent",
           to_char(u.created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
    FROM users u
    LEFT JOIN bookings b ON b.client_id = u.id
    LEFT JOIN services s ON s.id = b.service_id
    GROUP BY u.id
    ORDER BY u.id
  `
  const clients = []
  let skipped = 0
  for (const row of rows) {
    const phone = normalizePhone(row.phone)
    if (phone.length !== 9) { skipped++; continue }
    const { name, email, visits, bookings, lastVisit, totalSpent, createdAt } = row
    clients.push({ phone, name, email, visits, bookings, lastVisit, totalSpent, createdAt })
  }
  return { clients, skipped }
}

async function handleBridgeClients(req, res, mode) {
  if (!isBridgeRequest(req)) return res.status(404).json({ ok: false, error: "No encontrado" })
  // Datos personales de toda la base: que ningún intermediario los guarde.
  res.setHeader("Cache-Control", "no-store")
  try {
    if (mode === "bridge-clients") {
      if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" })
      const sql = neon(process.env.DATABASE_URL)
      const { clients, skipped } = await bridgeClientList(sql)
      return res.json({ ok: true, clients, skipped })
    }

    if (mode === "bridge-client") {
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" })
      const body = req.body || {}
      const phone = normalizePhone(body.phone)
      const name = String(body.name || "").trim()
      const rawEmail = String(body.email || "").trim().toLowerCase()
      if (phone.length !== 9) return res.status(400).json({ ok: false, error: "El teléfono debe tener 9 dígitos" })
      if (name.length > 200) return res.status(400).json({ ok: false, error: "El nombre es demasiado largo" })
      // El correo es opcional y solo se escribe si viene y es válido. Uno mal
      // escrito no frena el alta (lo importante es el teléfono), pero se avisa.
      const email = rawEmail && rawEmail.length <= 300 && EMAIL_RE.test(rawEmail) ? rawEmail : null
      const notice = rawEmail && !email ? "El correo no es válido y no se guardó." : null

      const sql = neon(process.env.DATABASE_URL)
      // Upsert por teléfono en UN statement. El nombre vacío no pisa el que ya
      // estaba — y para un cliente nuevo, sin nombre no se crea (el WHERE deja
      // el INSERT sin filas y no hay conflicto que resolver). (xmax = 0) es
      // true solo en la fila recién insertada: distingue alta de actualización.
      const [client] = await sql`
        INSERT INTO users (name, phone, email, updated_at)
        SELECT ${name}::text, ${phone}::text, ${email}::text, NOW()
        WHERE ${name}::text <> '' OR EXISTS (SELECT 1 FROM users WHERE phone = ${phone}::text)
        ON CONFLICT (phone) DO UPDATE SET
          name = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
          email = COALESCE(EXCLUDED.email, users.email),
          updated_at = NOW()
        RETURNING id, phone, COALESCE(name, '') AS name,
                  NULLIF(btrim(COALESCE(email, '')), '') AS email, (xmax = 0) AS created
      `
      if (!client) return res.status(400).json({ ok: false, error: "Nombre requerido" })
      return res.json({ ok: true, client, ...(notice ? { notice } : {}) })
    }

    return res.status(404).json({ ok: false, error: "Modo no reconocido" })
  } catch (err) {
    console.error("clients bridge error:", mode, err)
    return res.status(500).json({ ok: false, error: "No se pudo procesar el pedido en BrunettiCutz" })
  }
}

/* ---------------------------------------------------------------------------
   POST ?mode=register — respaldo del registro de cliente en Vercel Blob.
   Antes era su propia función (api/register-client.js); se plegó acá para
   liberar uno de los 12 slots de función del plan Hobby. vercel.json reescribe
   /api/register-client → /api/clients?mode=register, así que la app de iOS
   (su único llamador: APIClient.registerClient) sigue llamando la ruta vieja
   y recibe la misma respuesta { ok, saved, pathname }. Es un respaldo, no la
   fuente de verdad: el cliente real lo guarda el POST normal de más abajo.

   Público (sin sesión), por eso endurecido — guarda nombre, correo y teléfono
   de gente real:
     1. Rate limit por IP (10 cada 5 min): antes cada POST creaba un blob
        nuevo sin límite, y un bucle bastaba para llenar el almacenamiento.
     2. Blob PRIVADO y sin respaldo público: la versión anterior, si el privado
        fallaba, reintentaba con access:"public" y publicaba los datos en una
        URL abierta. Un respaldo que falla tiene que fallar, no desnudarse.
     3. Errores genéricos: el detalle interno va al log, no a la respuesta. */
async function handleRegisterBackup(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end()
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" })

  // Declarado afuera del try: lo necesita también el upsert con sesión, más
  // abajo. Si neon() o el rate limit fallan (p. ej. DATABASE_URL ausente),
  // `sql` queda en null y ese upsert simplemente se salta — el respaldo en
  // Blob (lo de siempre) no debe caerse por esto.
  let sql = null
  try {
    sql = neon(process.env.DATABASE_URL)
    const allowed = await rateLimit(sql, `register-client:${clientIp(req)}`, { max: 10, windowSeconds: 300 })
    if (!allowed) return res.status(429).json({ ok: false, error: "Demasiadas solicitudes. Intenta más tarde." })
  } catch (err) {
    // Sin base (DATABASE_URL ausente) el limitador no corre: un respaldo real
    // no debe caerse por el mecanismo de protección.
    console.error("register-client rate limit no disponible:", err?.message || err)
  }

  try {
    let body = req.body || {}
    if (typeof body === "string") {
      try { body = JSON.parse(body) } catch { body = {} }
    }
    const name = String(body.name || "").trim().slice(0, 200)
    const email = String(body.email || "").trim().slice(0, 300)
    const phone = normalizePhone(body.phone)
    if (!name || phone.length !== 9 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ ok: false, error: "Datos incompletos o inválidos" })
    }

    // Con sesión de barbero (la app de iOS manda el mismo Bearer que usa para
    // el resto del panel), este registro deja de ser solo un respaldo en Blob:
    // también deja el nombre guardado en `users`, con las mismas reglas que el
    // upsert de POST /api/clients (no pisa un nombre guardado con uno vacío;
    // el correo, ya validado arriba, siempre se escribe). Así createManualBooking()
    // encuentra el nombre cuando la reserva llega sin `client`. Sin sesión, el
    // comportamiento público de siempre no cambia en nada.
    const session = readSession(req)
    if (session && sql) {
      try {
        await sql`
          INSERT INTO users (name, phone, email, updated_at)
          VALUES (${name}, ${phone}, ${email}, NOW())
          ON CONFLICT (phone) DO UPDATE SET
            name = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
            email = COALESCE(EXCLUDED.email, users.email),
            updated_at = NOW()
        `
      } catch (err) {
        console.error("register-client upsert (con sesión) error:", err?.message || err)
      }
    }

    const record = { name, email, phone, source: "brunetticutz-web", updatedAt: new Date().toISOString() }
    const blob = await put(`clientes/${phone}-${Date.now()}.json`, JSON.stringify(record, null, 2), {
      addRandomSuffix: true,
      contentType: "application/json; charset=utf-8",
      access: "private",
    })
    return res.json({ ok: true, saved: true, pathname: blob.pathname })
  } catch (err) {
    console.error("register-client error:", err?.message || err)
    return res.status(500).json({ ok: false, error: "No se pudo guardar el registro" })
  }
}

export default async function handler(req, res) {
  const bridgeMode = String(req.query?.mode || "")
  if (bridgeMode.startsWith("bridge-")) return handleBridgeClients(req, res, bridgeMode)
  if (bridgeMode === "register") return handleRegisterBackup(req, res)

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
      /* Lista del panel (y de la app de iOS). Mismos criterios que el panel de
         PimpStudio, para que "Inactivos 30+", "Más activos" y las fichas
         digan lo mismo en los dos lados:
           visits     = reservas NO canceladas ya ocurridas (hoy o antes, en
                        hora de Santiago). Antes contaban todas: una hora
                        cancelada sumaba una visita y una futura aparecía
                        como "última visita".
           totalSpent = lo cobrado de las completadas: lo que entró en caja
                        (paid_amount) y, si no se registró el cobro, el precio
                        congelado (custom_price, price_snapshot) o el de
                        catálogo. Un canje o una cortesía suman 0.
           lastVisit  = 'YYYY-MM-DD' de la última no cancelada hasta hoy.
           nextVisit  = 'YYYY-MM-DD' de la próxima hora abierta (pendiente,
                        confirmada o en curso) desde hoy, o null.
           createdAt  = 'YYYY-MM-DD' del registro, en hora de Santiago.
         Las columnas nuevas (profession, paid_amount, price_snapshot) se leen
         con to_jsonb(fila)->>'col': dan NULL si la migración todavía no
         corrió, así la lista nunca depende de ella (ver api/_schema.js).
         COALESCE(name, ''): la app de iOS decodifica `name` como String
         obligatorio y un solo NULL le rompería la lista entera.
         Sin el tope de 100 (dejaba afuera a los clientes viejos): 1500,
         ordenados por la última actividad, así que si algún día el tope
         corta, corta a los más antiguos. */
      const clients = await sql`
        WITH bk AS (
          SELECT b.client_id,
                 COUNT(b.id) FILTER (WHERE b.status <> 'cancelada' AND b.booking_date <= (NOW() AT TIME ZONE 'America/Santiago')::date)::int AS visits,
                 COALESCE(SUM(COALESCE((to_jsonb(b)->>'paid_amount')::int, b.custom_price, (to_jsonb(b)->>'price_snapshot')::int, s.price)) FILTER (WHERE b.status = 'completada'), 0)::int AS total_spent,
                 MAX(b.booking_date) FILTER (WHERE b.status <> 'cancelada' AND b.booking_date <= (NOW() AT TIME ZONE 'America/Santiago')::date) AS last_visit,
                 MIN(b.booking_date) FILTER (WHERE b.status IN ('pendiente', 'confirmada', 'en curso') AND b.booking_date >= (NOW() AT TIME ZONE 'America/Santiago')::date) AS next_visit
          FROM bookings b
          LEFT JOIN services s ON s.id = b.service_id
          WHERE b.client_id IS NOT NULL
          GROUP BY b.client_id
        )
        SELECT u.id, COALESCE(u.name, '') AS name, u.phone, u.email,
               NULLIF(btrim(COALESCE(to_jsonb(u)->>'profession', '')), '') AS profession,
               to_char(u.created_at::timestamptz AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD') AS "createdAt",
               COALESCE(bk.visits, 0)::int AS visits,
               COALESCE(bk.total_spent, 0)::int AS "totalSpent",
               bk.last_visit::text AS "lastVisit",
               bk.next_visit::text AS "nextVisit",
               CASE WHEN COALESCE(bk.visits, 0) > 0 THEN 'activo' ELSE 'nuevo' END AS status
        FROM users u
        LEFT JOIN bk ON bk.client_id = u.id
        ORDER BY GREATEST(bk.last_visit, u.updated_at::date) DESC NULLS LAST, u.id DESC
        LIMIT 1500
      `
      // Saldos de toda la lista en pocas llamadas al puente (tandas de 200,
      // el tope de PimpStudio por llamada; ver loyaltyForPhones), no una por
      // cliente: serían cientos de round-trips entre dos deployments por cada
      // carga del panel.
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
      // Alta/edición de cliente: solo el panel (web o iOS, los dos mandan el
      // token). Antes era público y cualquiera podía reescribir el nombre y el
      // correo de un cliente sabiendo su teléfono (es un upsert).
      const session = requireInternal(req, res)
      if (!session) return
      const payload = validateClient(req.body)
      if (payload.error) return res.status(400).json({ ok: false, error: payload.error })
      // Sin `profession` en el body (la app de iOS, clientes viejos) la
      // escritura es exactamente la de siempre: ni la migración corre ni la
      // columna se toca. Con el campo, se asegura la columna ANTES de escribir.
      if (!payload.hasProfession) {
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
      await ensureClientColumns(sql)
      const [client] = await sql`
        INSERT INTO users (name, phone, email, profession, updated_at)
        VALUES (${payload.name}, ${payload.phone}, ${payload.email}, ${payload.profession}, NOW())
        ON CONFLICT (phone) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          profession = EXCLUDED.profession,
          updated_at = NOW()
        RETURNING id, name, phone, email, profession
      `
      return res.json({ ok: true, client: { ...client, visits: 0, totalSpent: 0, status: "nuevo" } })
    }

    if (req.method === "DELETE") {
      // Borra al cliente y TODAS sus reservas: solo el admin.
      const session = requireInternal(req, res, { admin: true })
      if (!session) return
      const phone = cleanPhone(req.query.phone)
      if (phone.length !== 9) return res.status(400).json({ ok: false, error: "Telefono invalido" })
      const [user] = await sql`SELECT id FROM users WHERE phone = ${phone}`
      if (!user) return res.status(404).json({ ok: false, error: "Cliente no encontrado" })
      // Sus reservas se van con él, y con ellas lo que proyectaban en
      // PimpStudio: la estrella de cada completada y las 10 de un corte gratis
      // canjeado que ya no se va a dar. Pasa por el escritor único ANTES de
      // borrar (después no queda qué leer). Best-effort: si PimpStudio no
      // responde, el borrado sigue igual.
      await purgeLoyaltyForClient(sql, user.id, { ip: clientIp(req) }).catch((err) => {
        console.error("client purge loyalty error:", err?.message || err)
      })
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
      const session = requireInternal(req, res)
      if (!session) return
      const payload = validateClient(req.body)
      if (payload.error) return res.status(400).json({ ok: false, error: payload.error })
      // hasProfession es un detalle interno de validateClient (decide qué
      // escritura corre): no es parte de la forma del cliente que ve el front.
      // Sin el campo en el body, la respuesta tampoco lo trae (como la real).
      const { hasProfession, profession, ...client } = payload
      return res.json({ ok: true, client: { id: Date.now(), ...client, ...(hasProfession ? { profession } : {}), visits: 0, totalSpent: 0, status: "nuevo" } })
    }
    if (req.method === "DELETE") {
      const session = requireInternal(req, res, { admin: true })
      if (!session) return
      return res.json({ ok: true })
    }
    return res.status(500).json({ ok: false, error: "No se pudo procesar clientes" })
  }
}
