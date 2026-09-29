/* ACADEMY — Tablas (creación al vuelo, aditiva)
   ------------------------------------------------------------------
   Mismo criterio que api/_schema.js: el deploy no depende de que alguien
   corra db/schema.sql a mano. La definición canónica está también en
   db/schema.sql (sección "Academy"); las dos tienen que decir lo mismo.

   Cómo corre:
     1. UNA consulta a information_schema para saber qué tablas faltan.
     2. Si falta alguna, se crean TODAS las que faltan en una sola
        sql.transaction([...]), en orden de dependencias (cada FK apunta a una
        tabla ya creada). O quedan todas o ninguna: una base con la mitad del
        esquema es peor que una sin nada.
     3. Los índices secundarios después, cada uno en su propio try/catch y
        solo si pg_indexes dice que falta: son optimizaciones, y un lock que
        no se consigue no debe tumbar el `me` ni un modo de admin.

   ⚠️ Solo se llama desde `me`, los modos de admin/moderación/owner (el router
   lo hace, no los handlers) y el cron. NUNCA desde login, reset, sync, idle,
   lesson-progress, chat-send, el checkout ni el webhook de Mercado Pago:
   esos caminos son públicos, calientes o mueven plata, y leen defensivamente
   (un 42P01 se traduce a un error genérico).

   Sin ciclos de FK: las columnas marcadas "sin FK" en la SPEC son INT planos
   (academy_cohorts.chat_id, academy_chats.cohort_id, etc.).
   `once()` recuerda la promesa por instancia tibia y la olvida si falla, para
   reintentar en el próximo request en vez de quedar roto hasta el redeploy. */

function once(fn) {
  let pending = null
  return (sql) => {
    if (!pending) pending = fn(sql).catch((err) => { pending = null; throw err })
    return pending
  }
}

/* Orden = orden de creación. Cada entrada devuelve la consulta SIN
   ejecutarla (el driver de Neon arma una promesa perezosa; la transacción la
   consume). Todo es texto literal: el driver manda lo interpolado como
   parámetro, así que no se puede armar DDL con ${...}. */
const TABLES = [
  ["academy_settings", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_settings (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_members", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_members (
      id SERIAL PRIMARY KEY,
      email_norm TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      handle TEXT UNIQUE,
      phone VARCHAR(9),
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      bio TEXT,
      location TEXT,
      links JSONB NOT NULL DEFAULT '{}'::jsonb,
      avatar_url TEXT,
      role VARCHAR(12) NOT NULL DEFAULT 'miembro' CHECK (role IN ('propietario','admin','moderador','miembro')),
      status VARCHAR(12) NOT NULL DEFAULT 'activo' CHECK (status IN ('activo','cancelado','expulsado')),
      source VARCHAR(12) NOT NULL DEFAULT 'pago' CHECK (source IN ('pago','invitacion','propietario','puente')),
      password_hash TEXT,
      password_set_at TIMESTAMPTZ,
      must_change_password BOOLEAN NOT NULL DEFAULT false,
      temp_password_expires_at TIMESTAMPTZ,
      session_version INT NOT NULL DEFAULT 0,
      credentials_claimed_at TIMESTAMPTZ,
      credentials_sent_at TIMESTAMPTZ,
      credentials_attempts INT NOT NULL DEFAULT 0,
      credentials_retry_at TIMESTAMPTZ,
      last_login_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ,
      last_sync_at TIMESTAMPTZ,
      activity_email_at TIMESTAMPTZ,
      barber_id INT REFERENCES barbers(id) ON DELETE SET NULL,
      granted_by INT,
      prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      banned_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_auth_tokens", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_auth_tokens (
      token_hash CHAR(64) PRIMARY KEY,
      member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      purpose VARCHAR(12) NOT NULL CHECK (purpose IN ('reset','email')),
      payload JSONB,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      requested_ip TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_courses", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_courses (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      catalog_id TEXT,
      title TEXT NOT NULL,
      subtitle TEXT,
      description TEXT,
      cover_url TEXT,
      position INT NOT NULL DEFAULT 0,
      published BOOLEAN NOT NULL DEFAULT false,
      access VARCHAR(10) NOT NULL DEFAULT 'compra' CHECK (access IN ('compra','abierto','nivel')),
      unlock_level INT CHECK (unlock_level IS NULL OR unlock_level BETWEEN 2 AND 9),
      price_online INT CHECK (price_online IS NULL OR price_online BETWEEN 1000 AND 10000000),
      price_presencial INT CHECK (price_presencial IS NULL OR price_presencial BETWEEN 1000 AND 10000000),
      sales_open BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_sections", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_sections (
      id SERIAL PRIMARY KEY,
      course_id INT NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_lessons", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_lessons (
      id SERIAL PRIMARY KEY,
      course_id INT NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
      section_id INT REFERENCES academy_sections(id) ON DELETE SET NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0,
      video_provider VARCHAR(10) NOT NULL DEFAULT 'youtube' CHECK (video_provider IN ('youtube')),
      video_id VARCHAR(20),
      duration_sec INT,
      body TEXT,
      resources JSONB NOT NULL DEFAULT '[]'::jsonb,
      published BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (course_id, slug)
    )`],
  ["academy_lesson_progress", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_lesson_progress (
      member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      lesson_id INT NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
      position_sec INT NOT NULL DEFAULT 0,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (member_id, lesson_id)
    )`],
  ["academy_cohorts", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_cohorts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cover_url TEXT,
      course_id INT REFERENCES academy_courses(id) ON DELETE SET NULL,
      starts_on DATE,
      seats INT CHECK (seats IS NULL OR seats > 0),
      sales_open BOOLEAN NOT NULL DEFAULT false,
      chat_id INT,
      archived_at TIMESTAMPTZ,
      created_by INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_cohort_members", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_cohort_members (
      cohort_id INT NOT NULL REFERENCES academy_cohorts(id) ON DELETE CASCADE,
      member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (cohort_id, member_id)
    )`],
  ["academy_orders", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_orders (
      id SERIAL PRIMARY KEY,
      public_ref VARCHAR(40) NOT NULL UNIQUE,
      course_id INT NOT NULL REFERENCES academy_courses(id),
      cohort_id INT REFERENCES academy_cohorts(id) ON DELETE SET NULL,
      modality VARCHAR(12) NOT NULL CHECK (modality IN ('online','presencial')),
      title_snapshot TEXT NOT NULL,
      amount INT NOT NULL,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(120) NOT NULL,
      email_norm VARCHAR(120) NOT NULL,
      phone VARCHAR(9),
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(12) NOT NULL DEFAULT 'pendiente'
        CHECK (status IN ('pendiente','pagada','revision','reembolsada','anulada')),
      mp_preference_id VARCHAR(80),
      mp_payment_id VARCHAR(40) UNIQUE,
      mp_last_status VARCHAR(24),
      mp_payer_email VARCHAR(200),
      live_mode BOOLEAN,
      paid_at TIMESTAMPTZ,
      paid_amount INT,
      refunded_at TIMESTAMPTZ,
      refund_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_grants", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_grants (
      id SERIAL PRIMARY KEY,
      member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      course_id INT NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
      order_id INT UNIQUE REFERENCES academy_orders(id) ON DELETE SET NULL,
      external_ref TEXT UNIQUE,
      source VARCHAR(12) NOT NULL CHECK (source IN ('pago','puente','invitacion','manual')),
      state VARCHAR(10) NOT NULL DEFAULT 'activa' CHECK (state IN ('activa','revision','revocada')),
      notified_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      revoke_reason TEXT,
      granted_by INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_categories", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(30) NOT NULL,
      emoji VARCHAR(8),
      position INT NOT NULL DEFAULT 0,
      write_role VARCHAR(10) NOT NULL DEFAULT 'miembros' CHECK (write_role IN ('miembros','admins')),
      default_sort VARCHAR(10) NOT NULL DEFAULT 'default' CHECK (default_sort IN ('default','nuevos','top')),
      cohort_id INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_posts", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_posts (
      id SERIAL PRIMARY KEY,
      author_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      category_id INT REFERENCES academy_categories(id) ON DELETE SET NULL,
      title VARCHAR(160) NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      video_id VARCHAR(20),
      poll JSONB,
      pinned_at TIMESTAMPTZ,
      comments_locked BOOLEAN NOT NULL DEFAULT false,
      like_count INT NOT NULL DEFAULT 0,
      comment_count INT NOT NULL DEFAULT 0,
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_comment_at TIMESTAMPTZ,
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_comments", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_comments (
      id SERIAL PRIMARY KEY,
      post_id INT REFERENCES academy_posts(id) ON DELETE CASCADE,
      lesson_id INT REFERENCES academy_lessons(id) ON DELETE CASCADE,
      parent_id INT REFERENCES academy_comments(id) ON DELETE CASCADE,
      author_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      like_count INT NOT NULL DEFAULT 0,
      edited_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK ((post_id IS NULL) <> (lesson_id IS NULL))
    )`],
  ["academy_likes", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_likes (
      member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      target_type VARCHAR(8) NOT NULL CHECK (target_type IN ('post','comment')),
      target_id INT NOT NULL,
      author_id INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (member_id, target_type, target_id)
    )`],
  ["academy_poll_votes", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_poll_votes (
      post_id INT NOT NULL REFERENCES academy_posts(id) ON DELETE CASCADE,
      member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      option_idx INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (post_id, member_id)
    )`],
  ["academy_follows", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_follows (
      member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      target_type VARCHAR(8) NOT NULL CHECK (target_type IN ('post','miembro')),
      target_id INT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (member_id, target_type, target_id)
    )`],
  ["academy_post_reads", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_post_reads (
      member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      post_id INT NOT NULL REFERENCES academy_posts(id) ON DELETE CASCADE,
      read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (member_id, post_id)
    )`],
  ["academy_reports", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_reports (
      id SERIAL PRIMARY KEY,
      reporter_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      target_type VARCHAR(10) NOT NULL CHECK (target_type IN ('post','comment','message','miembro')),
      target_id INT NOT NULL,
      reason TEXT,
      status VARCHAR(10) NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','resuelto','descartado')),
      resolved_by INT,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_notifications", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_notifications (
      id SERIAL PRIMARY KEY,
      member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      kind VARCHAR(24) NOT NULL,
      actor_id INT,
      target_type VARCHAR(10),
      target_id INT,
      parent_id INT,
      preview TEXT,
      group_key TEXT,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_chats", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_chats (
      id SERIAL PRIMARY KEY,
      kind VARCHAR(8) NOT NULL CHECK (kind IN ('directo','grupo')),
      dm_key TEXT UNIQUE,
      cohort_id INT,
      name TEXT,
      last_message_id INT,
      last_message_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_chat_members", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_chat_members (
      chat_id INT NOT NULL REFERENCES academy_chats(id) ON DELETE CASCADE,
      member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      last_read_message_id INT NOT NULL DEFAULT 0,
      muted BOOLEAN NOT NULL DEFAULT false,
      marked_unread BOOLEAN NOT NULL DEFAULT false,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, member_id)
    )`],
  ["academy_messages", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_messages (
      id SERIAL PRIMARY KEY,
      chat_id INT NOT NULL REFERENCES academy_chats(id) ON DELETE CASCADE,
      author_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )`],
  ["academy_blocks", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_blocks (
      blocker_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      blocked_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (blocker_id, blocked_id)
    )`],
  ["academy_events", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_events (
      id SERIAL PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      description TEXT,
      cover_url TEXT,
      starts_at TIMESTAMPTZ NOT NULL,
      duration_min INT NOT NULL DEFAULT 60 CHECK (duration_min BETWEEN 30 AND 1440),
      tz TEXT NOT NULL DEFAULT 'America/Santiago',
      repeat_weekly BOOLEAN NOT NULL DEFAULT false,
      weekdays INT[],
      until_date DATE,
      location_type VARCHAR(10) NOT NULL DEFAULT 'enlace' CHECK (location_type IN ('meet','zoom','youtube','direccion','enlace')),
      location_info TEXT,
      access JSONB NOT NULL DEFAULT '{"type":"todos"}'::jsonb,
      email_reminder BOOLEAN NOT NULL DEFAULT true,
      created_by INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_event_reminders", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_event_reminders (
      event_id INT NOT NULL REFERENCES academy_events(id) ON DELETE CASCADE,
      occurrence_start TIMESTAMPTZ NOT NULL,
      kind VARCHAR(4) NOT NULL CHECK (kind IN ('24h','1h')),
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (event_id, occurrence_start, kind)
    )`],
  ["academy_push_subscriptions", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_push_subscriptions (
      id SERIAL PRIMARY KEY,
      member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_uploads", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_uploads (
      id SERIAL PRIMARY KEY,
      member_id INT REFERENCES academy_members(id) ON DELETE SET NULL,
      kind VARCHAR(10) NOT NULL CHECK (kind IN ('avatar','portada','post','chat','galeria','curso','evento')),
      url TEXT NOT NULL,
      bytes INT NOT NULL,
      private BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
  ["academy_email_log", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_email_log (
      day DATE NOT NULL,
      kind VARCHAR(24) NOT NULL,
      n INT NOT NULL DEFAULT 0,
      PRIMARY KEY (day, kind)
    )`],
  // Límites por ventana (rl:<llave>) y bloqueo de login (lk:<llave>) de
  // api/_academyLimits.js. Propia de la Academy: no comparte contador con el
  // panel y viaja con el módulo a otro sitio.
  ["academy_rate_limits", (sql) => sql`
    CREATE TABLE IF NOT EXISTS academy_rate_limits (
      key TEXT PRIMARY KEY,
      count INT NOT NULL DEFAULT 0,
      window_start TIMESTAMPTZ,
      failures INT NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
]

export const ACADEMY_TABLES = TABLES.map(([name]) => name)

/* Índices secundarios (SPEC §2). Los nombres son fijos para poder
   preguntarle a pg_indexes si ya están. */
const INDEXES = [
  ["idx_aca_likes_author_created", (sql) => sql`CREATE INDEX IF NOT EXISTS idx_aca_likes_author_created ON academy_likes (author_id, created_at)`],
  ["idx_aca_likes_created", (sql) => sql`CREATE INDEX IF NOT EXISTS idx_aca_likes_created ON academy_likes (created_at)`],
  ["idx_aca_posts_activity", (sql) => sql`CREATE INDEX IF NOT EXISTS idx_aca_posts_activity ON academy_posts (last_activity_at DESC) WHERE deleted_at IS NULL`],
  ["idx_aca_comments_post", (sql) => sql`CREATE INDEX IF NOT EXISTS idx_aca_comments_post ON academy_comments (post_id, created_at)`],
  ["idx_aca_comments_lesson", (sql) => sql`CREATE INDEX IF NOT EXISTS idx_aca_comments_lesson ON academy_comments (lesson_id, created_at)`],
  ["idx_aca_notifications_member", (sql) => sql`CREATE INDEX IF NOT EXISTS idx_aca_notifications_member ON academy_notifications (member_id, id DESC)`],
  ["idx_aca_messages_chat", (sql) => sql`CREATE INDEX IF NOT EXISTS idx_aca_messages_chat ON academy_messages (chat_id, id)`],
  ["idx_aca_grants_member_course", (sql) => sql`CREATE INDEX IF NOT EXISTS idx_aca_grants_member_course ON academy_grants (member_id, course_id)`],
  ["idx_aca_orders_pending", (sql) => sql`CREATE INDEX IF NOT EXISTS idx_aca_orders_pending ON academy_orders (created_at) WHERE status = 'pendiente'`],
  ["idx_aca_chat_members_member", (sql) => sql`CREATE INDEX IF NOT EXISTS idx_aca_chat_members_member ON academy_chat_members (member_id)`],
  ["idx_aca_cohort_members_member", (sql) => sql`CREATE INDEX IF NOT EXISTS idx_aca_cohort_members_member ON academy_cohort_members (member_id)`],
  ["idx_aca_uploads_member", (sql) => sql`CREATE INDEX IF NOT EXISTS idx_aca_uploads_member ON academy_uploads (member_id, created_at)`],
]

export const ACADEMY_INDEXES = INDEXES.map(([name]) => name)

/* Qué tablas de `names` existen ya → Set. Una sola consulta. */
export async function presentTables(sql, names) {
  const list = Array.isArray(names) ? names.map(String) : []
  if (!list.length) return new Set()
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = ANY(${list}::text[])
  `
  return new Set(rows.map((r) => r.table_name))
}

/* Devuelve { created: [tablas], indexes: [índices] } — lo usa el cron para
   informar; los demás solo lo esperan. */
export const ensureAcademyTables = once(async (sql) => {
  const present = await presentTables(sql, ACADEMY_TABLES)
  const missing = TABLES.filter(([name]) => !present.has(name))
  if (missing.length) {
    await sql.transaction(missing.map(([, build]) => build(sql)))
  }

  const createdIndexes = []
  let existing = new Set()
  try {
    const rows = await sql`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ANY(${ACADEMY_INDEXES}::text[])`
    existing = new Set(rows.map((r) => r.indexname))
  } catch (err) {
    console.error("[academy:schema] no se pudo leer pg_indexes:", err?.message || err)
    return { created: missing.map(([n]) => n), indexes: createdIndexes }
  }
  for (const [name, build] of INDEXES) {
    if (existing.has(name)) continue
    try {
      await build(sql)
      createdIndexes.push(name)
    } catch (err) {
      console.error(`[academy:schema] índice ${name}:`, err?.message || err)
    }
  }
  return { created: missing.map(([n]) => n), indexes: createdIndexes }
})
