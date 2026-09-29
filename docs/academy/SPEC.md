# Pimp Studio Academy — Technical SPEC (contract for implementation)

Status: v1, 2026-09-28. Branch `academy-lms` (from `panel-rediseno`). This document is the **single source of truth** for every agent building the academy. If code and this SPEC disagree, the SPEC wins unless the deviation is recorded in §15 (Deviations log).

UI strings are **Spanish (Chile)**. The module name is **"Academy"** (never "Academia") — rule from `src/components/SiteNav.jsx:24-30`.

Owner answers (2026-09-28): lives at `pimpstudio.cl/academy`; "grupos" = cohort rooms/generations inside the academy with their own group chat; videos = YouTube **unlisted**; **pay once → lifetime access**; launch with **all 6 Skool tabs** (Comunidad, Cursos, Calendario, Miembros, Clasificación, Acerca de); account email + temporary password emailed automatically on payment.

Reference screenshots of the Skool group to match: `/private/tmp/claude-501/-Users-elija-Documents-GitHub-BRUNETTICUTZ/27f7c294-b42a-42ac-a051-7b99aa910100/images/1.webp` … `6.webp` (Cursos grid, Calendario month, Miembros, Clasificación, Acerca de + Chats popover, Notificaciones popover). Skool feature research: `/private/tmp/claude-501/-Users-elija-Documents-GitHub-BRUNETTICUTZ/27f7c294-b42a-42ac-a051-7b99aa910100/scratchpad/reports/research-*.md`. Skool UI strings: `.../scratchpad/skool/keys.txt`.

---

## 0. Non-negotiable rules (read twice)

1. **Member sessions are cryptographically separate from barber sessions** (§3). Never call `createSession`/`readSession` for members. Never store member tokens in `ps_barber*` or `ps_user`.
2. **XSS**: the academy shares the origin with the barber panel (`ps_barber_token` in localStorage). Never use `dangerouslySetInnerHTML`. Every `href`/`src` built from user data passes `safeUrl()` both when saving (server) and rendering (client). User text renders as React text nodes. Links: `target="_blank" rel="noopener noreferrer nofollow ugc"`. YouTube ids must match `^[A-Za-z0-9_-]{11}$`. Image URLs accepted from users only if their origin is the project's Vercel Blob store (`*.public.blob.vercel-storage.com`) or a same-origin `/assets/` path.
3. **No DDL on hot/public/money paths**: never call `ensureAcademyTables` from `login`, `password-reset-*`, `sync`, `idle`, `lesson-progress`, `chat-send`, the checkout, the MP webhook or any public mode. It runs from `me`, admin modes and the cron. A missing table (`42P01`) on those paths → generic error (login: "Correo o contraseña incorrectos"; checkout: 503 "Las inscripciones de Academy todavía no abren").
4. **Never demo data behind a member session.** A DB error on a member/admin mode → `500 {ok:false,error}` (or 503 for auth infra). Public catalog may fall back to `src/data/courses.js` with all prices `null` (= not for sale).
5. **Neon driver** `@neondatabase/serverless` 0.10.4: no nested ``sql`...` `` fragments (everything interpolated is a parameter). "Leave unchanged" fields → `CASE WHEN ${flag}::boolean THEN … ELSE col END`. Optional filters → `(${x}::int IS NULL OR col = ${x}::int)`. Arrays → `${ids}::int[]`; JSON → `${JSON.stringify(v)}::jsonb`. Writes that depend on a new id → **one CTE statement**. `sql.transaction([...])` only takes pre-built independent queries.
6. **`ON CONFLICT` targets are plain `UNIQUE` columns / PKs only** — never partial indexes (the 61-lost-stars bug, CLAUDE.md "Puente").
7. **Dates in JSON**: `to_char(col AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')` (no milliseconds; Safari/iOS). Business timezone `America/Santiago`. Use the helper `iso()` SQL snippet from `_academyHttp.js` doc (§4.2) — i.e. write the `to_char(...)` inline.
8. **Neon cost**: no background polling. Reads happen on load, on `visibilitychange`→visible, and when a popover opens. Only `sync` polls, only with a chat open or the app actively used (§9). Member responses are `Cache-Control: private, no-store`.
9. **Email budget**: Resend free = 100/day shared with bookings. All academy emails go through `sendAcademyEmail()` accounting in `academy_email_log` (§8). Credentials of a new paid purchase are never blocked by the budget.
10. **Panel regressions are unacceptable**: barber login, panel pushes (tap → `/panel`), booking flow, Essentials checkout and the webhook for `product_sales` must keep working exactly as today.
11. Match surrounding code style (2-space, no semicolons in most api files — follow the file you edit), Spanish comments explaining *why*, like the rest of the repo.

---

## 1. Architecture

```
Frontend  /academy                 public catalog (existing Academy.jsx, upgraded with real checkout)
          /academy/*               member app (lazy chunk)  — src/pages/academy/**
Panel     /panel?tab=academy       admin tab (lazy)          — src/pages/panel/AcademyTab.jsx
API       /api/academy?mode=…      vercel.json rewrite → /api/services?scope=academy
          services.js: if (scope==='academy') → dynamic import('./_academy.js').handleAcademy(req,res)
          → router dispatches to per-domain modules (lazy literal imports)
Payments  /api/checkout            existing; body.kind==='course' → _academyProvision.handleCourseCheckout
          /api/checkout?ref=aca-…  → course order status
          /api/mp-webhook          existing; external_reference starting 'aca-' → _academyProvision.handleAcademyPayment
Cron      /api/push?job=reminders  new tranche "academy" (outside `failed`), + alias ?job=academy
```

No new serverless function (stays 11/12).

### 1.1 Backend files (all `_`-prefixed → no function slot)

| File | Owner | Purpose |
|---|---|---|
| `api/_academy.js` | BE-CORE | `handleAcademy(req,res)`: router, auth gates, error mapping, `MODE_OWNERS` table |
| `api/_academyHttp.js` | BE-CORE | `HttpError`, `ok()`, JSON helpers, member projection helpers, levels math, pagination |
| `api/_academyText.js` | BE-CORE | `safeUrl`, `cleanText`, `slugify`, `parseYouTubeId`, `isBlobUrl`, `esc` (HTML escape), `csvCell` |
| `api/_academySchema.js` | BE-CORE | `ensureAcademyTables = once(...)`, `presentTables()` |
| `api/_academyAuth.js` | BE-CORE | `requireMember`, `requireAcademyAdmin`, `requireModerator`, `loadMe`, `touchSeen` |
| `api/_academyAccount.js` | BE-CORE | account/auth modes (§5.1) |
| `api/_academyEmail.js` | BE-CORE | `sendAcademyEmail()` budget wrapper + `__setTestDeps` (§8.2) |
| `api/_academyCourses.js` | BE-COURSES | courses, lessons, progress, catalog, seed, uploads (§5.2) |
| `api/_academyCommunity.js` | BE-COMMUNITY | feed, posts, comments, likes, polls, follows, reports, members, profile, leaderboard, search, group card (§5.3) |
| `api/_academyNotify.js` | BE-COMMUNITY | `notify()` / `notifyMany()` helpers + notification modes (§5.3, §8) |
| `api/_academyChat.js` | BE-CHAT | chats, messages, cohorts, blocks, sync, idle, push subscribe, private file proxy (§5.4) |
| `api/_academyPush.js` | BE-CHAT | `pushToMembers(sql, memberIds, payload)` |
| `api/_webpush.js` | BE-CHAT | `getWebPush()`, `sendToSubscriptions(rows, payload, onGone)` (extracted from push.js, no project imports) |
| `api/_academyEvents.js` | BE-EVENTS | events CRUD + occurrence expansion + ICS data (§5.5) |
| `api/_academyCron.js` | BE-EVENTS | `runAcademyJob(sql, opts)` (§10) |
| `api/_academyProvision.js` | BE-PAY | course checkout, webhook branch, refunds, reconcile, `claimAndSendCredentials`, `provisionGrant` (§6) |
| `api/_academyAdmin.js` | BE-PAY | admin modes for members/grants/orders/settings/stats (§5.6) |
| Modified: `api/_auth.js`, `api/_password.js`, `api/_rateLimit.js`, `api/_email.js`, `api/services.js`, `db/schema.sql` | BE-CORE | see §3, §8 |
| Modified: `api/_checkout.js`, `api/_mercadopago.js` | BE-PAY | two early branches + MP fixes (§6) |
| Modified: `api/push.js`, `public/sw.js`, `src/push.js` | BE-CHAT | use `_webpush.js`, academy cron tranche, SW click routing, shared subscription (§9, §10) |

### 1.2 Frontend files

| Path | Owner |
|---|---|
| `src/academy/*.js` (pure libs), `src/pages/academy/AcademyRoot.jsx`, `AcademyApp.jsx`, `Ingreso.jsx`, `CrearContrasena.jsx`, `Restablecer.jsx`, `ConfirmarCorreo.jsx`, `Gracias.jsx`, `src/components/academy/{AcademyShell,AcademyTopbar,GroupSwitcher,LeftRail,AcademyTabs,UserMenu,LevelBadge,MemberAvatar,RichText,ImagePicker,PageState,OnboardingWidget}.jsx`, `src/styles/academy/app.css`, `src/App.jsx`, `index.html`, `public/boot.js`, `public/pixel.js`, `vercel.json`, `src/components/ui.jsx` (icons), `src/components/panel/index.js` (re-export hooks) | FE-CORE |
| `src/pages/academy/tabs/CursosTab.jsx`, `CursoPage.jsx`, `LeccionPage.jsx`, `AcercaTab.jsx`, `src/components/academy/{CourseCard,LessonPlayer,LessonSidebar,LessonComments}.jsx`, `src/styles/academy/cursos.css` | FE-CURSOS |
| `src/pages/academy/tabs/ComunidadTab.jsx`, `src/components/academy/{PostCard,PostComposer,PostDetail,CommentThread,PollBlock,EventBanner,NotificationsPopover,SearchPanel,RightColumn}.jsx`, `src/styles/academy/comunidad.css` | FE-COMUNIDAD |
| `src/pages/academy/tabs/MiembrosTab.jsx`, `ClasificacionTab.jsx`, `src/pages/academy/PerfilPage.jsx`, `AjustesPage.jsx`, `ReglasPage.jsx`, `src/components/academy/{MemberCard,GroupCard,LeaderboardTable,ActivityHeatmap,MemberAdminSheet,GroupSettingsSheet}.jsx`, `src/styles/academy/miembros.css` | FE-MIEMBROS |
| `src/pages/academy/tabs/CalendarioTab.jsx`, `src/pages/academy/ChatPage.jsx`, `GrupoPage.jsx`, `src/components/academy/{MonthGrid,EventSheet,EventEditor,ChatPopover,ChatWindow,ChatThread}.jsx`, `src/academy/push.js`, `src/styles/academy/calendario.css`, `chat.css` | FE-CHAT |
| `src/pages/panel/AcademyTab.jsx` (+ `src/pages/panel/academy/*.jsx`), `src/styles/panel/academy.css`, `src/pages/Dashboard.jsx` (nav + lazy mount only), `src/pages/Academy.jsx` (checkout), `src/data/courses.js` (copy: lifetime), `src/components/SiteNav.jsx` (unhide), `src/pages/AcademyLogin.jsx` + `AcademyProfile.jsx` (become redirects), `src/academyStore.js` (drop `ps_user` student), `src/components/InstallPrompt.jsx` (student copy), `public/manifest.webmanifest` (shortcut) | FE-PANEL |
| `scripts/dev-mock/**`, `vite.config.js` (plugin registration), `package.json` (`dev:mock` script), `.claude/launch.json` (`dev-mock` config) | MOCK |
| `scripts/test-academy/**`, `package.json` devDependency `@electric-sql/pglite` + `test:academy` script | TEST |

**Never edit a file you don't own.** If you need a change in someone else's file, write it in your final report under "Requests for other owners".

---

## 2. Data model (Postgres DDL — authoritative)

`ensureAcademyTables(sql)` creates every table that is missing (one `presentTables` query), inside `sql.transaction([...CREATE TABLE...])` for the missing ones (ordered so FKs point to already-created tables), then creates secondary indexes each in its own `try/catch` guarded by `pg_indexes` lookup. **No FK cycles** (columns marked "no FK" are plain INTs). Mirror everything in `db/schema.sql` (append section "Academy").

```sql
CREATE TABLE academy_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_members (
  id SERIAL PRIMARY KEY,
  email_norm TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  handle TEXT UNIQUE,                         -- NULL at insert, then '<slug>-<id>'
  phone VARCHAR(9),
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  bio TEXT, location TEXT,
  links JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {instagram,tiktok,whatsapp,web}
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
  last_seen_at TIMESTAMPTZ,                   -- written by `me` (≤ every 5 min) and `sync`
  last_sync_at TIMESTAMPTZ,                   -- written by `sync`/`idle` only → "En línea"
  activity_email_at TIMESTAMPTZ,
  barber_id INT REFERENCES barbers(id) ON DELETE SET NULL,
  granted_by INT,                             -- no FK (barber id or member id, see grants)
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,   -- see §2.1
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  banned_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_auth_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  purpose VARCHAR(12) NOT NULL CHECK (purpose IN ('reset','email')),
  payload JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_courses (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  catalog_id TEXT,                            -- id in src/data/courses.js, if any
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
);

CREATE TABLE academy_sections (
  id SERIAL PRIMARY KEY,
  course_id INT NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_lessons (
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
  resources JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{title,url}] url passes safeUrl
  published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (course_id, slug)
);

CREATE TABLE academy_lesson_progress (
  member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  lesson_id INT NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  position_sec INT NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, lesson_id)
);

CREATE TABLE academy_cohorts (                      -- "Grupos" (salas / generaciones)
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cover_url TEXT,
  course_id INT REFERENCES academy_courses(id) ON DELETE SET NULL,
  starts_on DATE,
  seats INT CHECK (seats IS NULL OR seats > 0),
  sales_open BOOLEAN NOT NULL DEFAULT false,      -- sellable as presencial generation
  chat_id INT,                                    -- no FK (created right after)
  archived_at TIMESTAMPTZ,
  created_by INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_cohort_members (
  cohort_id INT NOT NULL REFERENCES academy_cohorts(id) ON DELETE CASCADE,
  member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cohort_id, member_id)
);

CREATE TABLE academy_orders (
  id SERIAL PRIMARY KEY,
  public_ref VARCHAR(40) NOT NULL UNIQUE,         -- 'aca-' + 32 hex
  course_id INT NOT NULL REFERENCES academy_courses(id),
  cohort_id INT REFERENCES academy_cohorts(id) ON DELETE SET NULL,
  modality VARCHAR(12) NOT NULL CHECK (modality IN ('online','presencial')),
  title_snapshot TEXT NOT NULL,
  amount INT NOT NULL,                            -- frozen price
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
);

CREATE TABLE academy_grants (
  id SERIAL PRIMARY KEY,
  member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  course_id INT NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  order_id INT UNIQUE REFERENCES academy_orders(id) ON DELETE SET NULL,
  external_ref TEXT UNIQUE,                       -- bridge / import: 'brunetti:mp:<id>'
  source VARCHAR(12) NOT NULL CHECK (source IN ('pago','puente','invitacion','manual')),
  state VARCHAR(10) NOT NULL DEFAULT 'activa' CHECK (state IN ('activa','revision','revocada')),
  notified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  granted_by INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(30) NOT NULL,
  emoji VARCHAR(8),
  position INT NOT NULL DEFAULT 0,
  write_role VARCHAR(10) NOT NULL DEFAULT 'miembros' CHECK (write_role IN ('miembros','admins')),
  default_sort VARCHAR(10) NOT NULL DEFAULT 'default' CHECK (default_sort IN ('default','nuevos','top')),
  cohort_id INT,                                  -- no FK; NULL = everyone; else private to that Grupo
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_posts (
  id SERIAL PRIMARY KEY,
  author_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  category_id INT REFERENCES academy_categories(id) ON DELETE SET NULL,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{kind:'image', url, w, h}]
  video_id VARCHAR(20),
  poll JSONB,                                      -- {options:[{text}]}
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
);

CREATE TABLE academy_comments (
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
);

CREATE TABLE academy_likes (
  member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  target_type VARCHAR(8) NOT NULL CHECK (target_type IN ('post','comment')),
  target_id INT NOT NULL,
  author_id INT NOT NULL,                          -- no FK; points go to the author
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, target_type, target_id)
);

CREATE TABLE academy_poll_votes (
  post_id INT NOT NULL REFERENCES academy_posts(id) ON DELETE CASCADE,
  member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  option_idx INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, member_id)
);

CREATE TABLE academy_follows (
  member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  target_type VARCHAR(8) NOT NULL CHECK (target_type IN ('post','miembro')),
  target_id INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, target_type, target_id)
);

CREATE TABLE academy_post_reads (
  member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  post_id INT NOT NULL REFERENCES academy_posts(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, post_id)
);

CREATE TABLE academy_reports (
  id SERIAL PRIMARY KEY,
  reporter_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  target_type VARCHAR(10) NOT NULL CHECK (target_type IN ('post','comment','message','miembro')),
  target_id INT NOT NULL,
  reason TEXT,
  status VARCHAR(10) NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','resuelto','descartado')),
  resolved_by INT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_notifications (
  id SERIAL PRIMARY KEY,
  member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  kind VARCHAR(24) NOT NULL,       -- §8.1
  actor_id INT,                    -- no FK
  target_type VARCHAR(10),         -- 'post'|'comment'|'lesson'|'event'|'miembro'|'chat'|'curso'|'grupo'
  target_id INT,
  parent_id INT,                   -- e.g. post id for a comment notification (routing)
  preview TEXT,
  group_key TEXT,                  -- aggregation key for likes, e.g. 'like:post:12'
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_chats (
  id SERIAL PRIMARY KEY,
  kind VARCHAR(8) NOT NULL CHECK (kind IN ('directo','grupo')),
  dm_key TEXT UNIQUE,              -- '<minId>:<maxId>' for directo
  cohort_id INT,                   -- no FK; for grupo
  name TEXT,
  last_message_id INT,             -- no FK
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_chat_members (
  chat_id INT NOT NULL REFERENCES academy_chats(id) ON DELETE CASCADE,
  member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  last_read_message_id INT NOT NULL DEFAULT 0,
  muted BOOLEAN NOT NULL DEFAULT false,
  marked_unread BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chat_id, member_id)
);

CREATE TABLE academy_messages (
  id SERIAL PRIMARY KEY,
  chat_id INT NOT NULL REFERENCES academy_chats(id) ON DELETE CASCADE,
  author_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{kind:'image', uploadId}] private blobs
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE academy_blocks (
  blocker_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  blocked_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE academy_events (
  id SERIAL PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  description TEXT,
  cover_url TEXT,
  starts_at TIMESTAMPTZ NOT NULL,                 -- first occurrence
  duration_min INT NOT NULL DEFAULT 60 CHECK (duration_min BETWEEN 30 AND 1440),
  tz TEXT NOT NULL DEFAULT 'America/Santiago',
  repeat_weekly BOOLEAN NOT NULL DEFAULT false,
  weekdays INT[],                                  -- 1=lunes … 7=domingo (ISO)
  until_date DATE,
  location_type VARCHAR(10) NOT NULL DEFAULT 'enlace' CHECK (location_type IN ('meet','zoom','youtube','direccion','enlace')),
  location_info TEXT,
  access JSONB NOT NULL DEFAULT '{"type":"todos"}'::jsonb,   -- {type:'todos'}|{type:'nivel',level}|{type:'grupo',cohortId}
  email_reminder BOOLEAN NOT NULL DEFAULT true,
  created_by INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_event_reminders (
  event_id INT NOT NULL REFERENCES academy_events(id) ON DELETE CASCADE,
  occurrence_start TIMESTAMPTZ NOT NULL,
  kind VARCHAR(4) NOT NULL CHECK (kind IN ('24h','1h')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, occurrence_start, kind)
);

CREATE TABLE academy_push_subscriptions (
  id SERIAL PRIMARY KEY,
  member_id INT NOT NULL REFERENCES academy_members(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_uploads (
  id SERIAL PRIMARY KEY,
  member_id INT REFERENCES academy_members(id) ON DELETE SET NULL,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('avatar','portada','post','chat','galeria','curso','evento')),
  url TEXT NOT NULL,
  bytes INT NOT NULL,
  private BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE academy_email_log (
  day DATE NOT NULL,
  kind VARCHAR(24) NOT NULL,
  n INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
```

Secondary indexes (each guarded): `academy_likes(author_id, created_at)`, `academy_likes(created_at)`, `academy_posts(last_activity_at DESC) WHERE deleted_at IS NULL`, `academy_comments(post_id, created_at)`, `academy_comments(lesson_id, created_at)`, `academy_notifications(member_id, id DESC)`, `academy_messages(chat_id, id)`, `academy_grants(member_id, course_id)`, `academy_orders(created_at) WHERE status='pendiente'`, `academy_chat_members(member_id)`, `academy_cohort_members(member_id)`, `academy_uploads(member_id, created_at)`.

### 2.1 `academy_members.prefs` JSON
`{ tz?: 'America/Santiago', notif: { push: true, email: true, likes: true, comments: true, mentions: true, follows: true, events: true }, chat: { enabled: true, previews: false }, privacy: { hideActivity: false, hideOnline: false }, onboarding: { dismissed: false, done: [] }, theme?: 'claro'|'oscuro'|'auto' }`

### 2.2 `academy_settings.settings` JSON (defaults applied in code when missing)
```js
{
  group: { name: 'Pimp Studio Academy', description: '', coverUrl: null, iconUrl: null, initials: 'PA', color: '#1c1c1c',
           links: [ { title: 'Reserva tu hora', url: 'https://pimpstudio.cl/reservar' } ],
           rules: [], media: [ /* {kind:'image', url} | {kind:'youtube', videoId} */ ] },
  levels: { names: ['Aprendiz','Ayudante','Barbero','Barbero Pro','Fader','Estilista','Maestro','Leyenda','Pimp'] },
  plugins: { minPostLevel: null, minChatLevel: null, autoDm: { enabled: true, text: '¡Hola #NOMBRE#! Bienvenido a #GRUPO#. Cualquier duda, escríbeme por acá.' }, welcomeVideoId: null },
  tabs: { comunidad: true, calendario: true, clasificacion: true },
  sync: { enabled: true },
  autoprovision: true
}
```

---

## 3. Sessions & auth (BE-CORE)

### 3.1 `api/_auth.js` changes
- Add (private key, exported functions):
```js
const MEMBER_KEY = HAS_SECRET ? Buffer.from(crypto.hkdfSync('sha256', SECRET, '', 'pimpstudio:academy:member:v1', 32)) : null
export function createMemberSession({ id, sessionVersion = 0, mustChangePassword = false })  // → 'm1.<b64url(json)>.<mac>' | null
export function readMemberToken(req)   // → payload | null ; checks 3 parts, parts[0]==='m1', constant-time MAC over 'm1.'+body, typ==='member', integer sub, exp REQUIRED and not past
export function hasMemberBearer(req)   // /^Bearer\s+m1\./i
```
  Payload `{typ:'member', sub, sv, pwc?:1, iat, exp}`; `exp` = 30 days, or 15 minutes when `mustChangePassword`.
- Harden `createSession`: add `typ:'barber'`. Harden `readSession`: require exactly 2 parts; constant-time compare via SHA-256 + `timingSafeEqual` (pattern `api/_bridge.js`); after parsing, `if (session.typ !== undefined && session.typ !== 'barber') return null`. Keep accepting tokens without `typ` (live barber/iOS tokens).

### 3.2 `api/_password.js` additions
`hashPasswordAsync`, `verifyPasswordAsync`, `dummyVerifyAsync` (util.promisify(crypto.pbkdf2), same format), `generateTempPassword()` → `{ display: 'K7QM-4RTX-9PWD', canonical: 'K7QM4RTX9PWD' }` from alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` via `crypto.randomInt`; `canonicalTemp(input)` = uppercase, strip non-alphanumerics. Temp password is hashed in canonical form; at login, if `must_change_password` and the hash fails on the raw input, retry with `canonicalTemp(input)`. `isValidMemberPassword(pw, email)`: 10–200 chars, not equal to the email local part, not in a small common list (`['1234567890','password12','contraseña','qwertyuiop','pimpstudio','barberia123','0987654321','1111111111','abcdefghij','academy123']`), no composition rules. Mirror in `src/academy/passwordRule.js` (FE-CORE).

### 3.3 `api/_rateLimit.js`
`registerLoginFailure(sql, keys, { max = MAX, lockSeconds = LOCK } = {})` — defaults unchanged for barbers.

### 3.4 `api/_academyAuth.js`
```js
export async function requireMember(sql, req, res, { allowPwc = false } = {})
  // → ctx.member = { id, role, status, sessionVersion, mustChangePassword, name, handle, prefs, lastSeenAt } | null (response already sent)
  // 401 {ok:false,error:'Sesión de Academy requerida',code:'auth'} if no/invalid token, row missing, status≠'activo', sv mismatch
  // 403 {code:'password_change_required'} if (row.must_change_password || tok.pwc) && !allowPwc
  // 503 on DB error (fail closed). 42P01 → 401 (tables not created yet)
export async function requireAcademyAdmin(sql, req, res)
  // member bearer → requireMember + role in ('propietario','admin');
  // otherwise barber path: requireAdmin(sql, req, res) from _auth.js (DB-verified). Actor = the owner member row linked by barber_id if any, else {barberId}.
  // → ctx.admin = { memberId|null, barberId|null, role: 'propietario'|'admin' }
export async function requireModerator(...)   // role in propietario/admin/moderador (member) or barber admin
```
`touchSeen(sql, memberId)`: `UPDATE academy_members SET last_seen_at=NOW() WHERE id=$1 AND (last_seen_at IS NULL OR last_seen_at < NOW()-interval '5 minutes')` — called from `me` only.

### 3.5 Router `api/_academy.js`
```js
// MODE_OWNERS: literal map mode → { load: () => import('./_academyX.js'), auth: 'public'|'member'|'member-pwc'|'moderator'|'admin'|'owner', methods: ['GET'] | ['POST'] }
export async function handleAcademy(req, res)
```
- Unknown mode → 404 `{ok:false,error:'Modo no reconocido'}`. Wrong method → 405.
- Router builds `sql = neon(process.env.DATABASE_URL)`; if no DATABASE_URL → 503.
- Applies auth, then calls `module.handlers[mode](ctx)` where `ctx = { sql, req, res, query: req.query, body: req.body || {}, member, admin, ip }`.
- Handler returns an object → router responds `200 {ok:true, ...obj}` with `Cache-Control: private, no-store` (public modes may set their own header by returning `{ __cache: 'public, s-maxage=300, stale-while-revalidate=600', ...}` — router strips `__cache`). Handler may throw `new HttpError(status, message, code?)` → `{ok:false,error,code}`. Any other error → log `[academy:<mode>]` + 500 `{ok:false,error:'Error interno'}`. Handlers that already wrote the response return `undefined` and set `ctx.res.headersSent`.
- `'owner'` auth = barber admin token only (`requireAdmin`), used by `owner-session`.
- Each module file exports `export const handlers = { 'mode-name': async (ctx) => {...} }`.

### 3.6 Member lookup / identity rules
- `email_norm = email.trim().toLowerCase()`; emails ≤ 120 chars and match `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`.
- Handle: after insert, `UPDATE academy_members SET handle = <slugify(name)||'miembro'> || '-' || id WHERE id=$1 AND handle IS NULL`. Editing handle: `^[a-z0-9-]{3,40}$`, unique, reserved regex `/^(bruno|brunetti|admin|soporte|moderador|academy|pimp|pimpstudio)/` only for propietario/admin.
- Lockout keys: `aca-login-user:<email_norm>` (max 5), `aca-login-ip:<ip>` (max 20), global `rateLimit('aca-login-global', {max:30, windowSeconds:60})` **before** any PBKDF2. Reset: `aca-reset-ip:<ip>` 10/h, `aca-reset-mail:<email>` 3/day, `aca-reset-confirm:<ip>` 10/15min.

---

## 4. Shared helpers

### 4.1 `api/_academyText.js` (pure, no imports except node:crypto)
`safeUrl(u)` → normalized `https://…` string or `null` (accept http→https; reject everything else incl. `javascript:`, `data:`, relative except `/academy/`, `/assets/`, `/reservar`); `isBlobUrl(u)` (host ends with `.public.blob.vercel-storage.com`) ; `isImageUrl(u)` = isBlobUrl || same-origin `/assets/…`; `parseYouTubeId(input)` → 11-char id from id / youtu.be / watch?v= / embed / shorts URLs, else null; `cleanText(s, max)` trims, strips control chars except `\n`, collapses >2 blank lines, cuts to max; `slugify(s)` (lowercase, NFD strip accents, `[^a-z0-9]+`→`-`, trim, ≤40); `esc(s)` HTML-escape; `csvCell(v)` (prefix `'` if `/^[=+\-@\t\r]/`, quote, double quotes). **FE-CORE mirrors `safeUrl`, `parseYouTubeId`, `slugify` in `src/academy/url.js` & `youtube.js` with identical behavior; MOCK imports the `src/academy` versions.**

### 4.2 `api/_academyHttp.js`
```js
export class HttpError extends Error { constructor(status, message, code) }
export const LEVEL_THRESHOLDS = [0, 5, 20, 65, 155, 515, 2015, 8015, 33015]   // levels 1..9
export function levelFor(points) → { level, points, currentMin, nextMin|null, pointsToNext, progress 0..1 }
export function memberMini(row) → { id, handle, name, avatarUrl, level, role }   // row has points
export function isoSql(col) → string  // DOCUMENTATION ONLY: `to_char(${col} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')` — write it inline in SQL (driver can't nest)
export async function pointsFor(sql, ids) → Map(id → points)   // SELECT author_id, count(*) FROM academy_likes WHERE author_id = ANY($1::int[]) AND author_id <> member_id GROUP BY 1
export function getSettings(sql) → merged settings (defaults §2.2)   // cached 60s per instance
export function isStaffRole(role) // propietario|admin|moderador
```
Level of a member = `levelFor(points).level`. Owners/admins still have levels but are **excluded from leaderboards**; moderators included.

### 4.3 Projections
- `MemberMini`: `{id, handle, name, avatarUrl, level, role}`.
- `MemberPublic`: `MemberMini + {bio, location, links, joinedAt, lastSeenAt|null (null if prefs.privacy.hideActivity), online:boolean (false if hideOnline; online = last_sync_at > NOW()-90s), points}`. **Never** email/phone/source/prefs.
- `MemberAdmin` (admin modes only): `MemberPublic + {email, phone, status, source, lastLoginAt, credentialsSentAt, mustChangePassword, grants:[{id, courseId, courseTitle, state, source}], cohorts:[{id,name}]}`.
- `Me`: `MemberPublic + {email, prefs, mustChangePassword, cohorts:[{id,name,chatId}], courseIds:[…active grant course ids], isOwner, isAdmin, isModerator, points, levelInfo}`.

---

## 5. API modes

All at `/api/academy?mode=<mode>`. `GET` modes read `ctx.query`; `POST` modes read JSON `ctx.body`. "auth" column: `public`, `member`, `pwc` (member incl. must-change tokens), `mod`, `admin`, `owner` (barber admin only).

### 5.1 Account — `_academyAccount.js` (BE-CORE)
| mode | method | auth | request | response |
|---|---|---|---|---|
| `login` | POST | public | `{email, password}` | `{token, member: Me, mustChangePassword}` ; errors 401 generic, 429 `{retryAfter}`, 401 `code:'temp_expired'` (only after hash matched) |
| `password-change` | POST | pwc | `{currentPassword?, newPassword}` (current required unless must_change) | `{token, member}`; sets password_set_at, must_change=false, temp=NULL, sv+1 |
| `password-reset-request` | POST | public | `{email}` | `{}` always (send async after responding if possible; else same generic) |
| `password-reset-confirm` | POST | public | `{token, password}` | `{token, member}` (also activates never-set accounts; clears lockout; sv+1; deletes push subs) |
| `me` | GET | pwc | — | `{member: Me, group: {name, initials, iconUrl, color, tabs, levels.names}, token?}` (renew token if older than 1 day; **never** renew a pwc token into a full one); runs `ensureAcademyTables` + `touchSeen` |
| `me-update` | POST | member | `{name?, bio?, location?, links?, avatarUrl?, handle?, prefs?}` | `{member: Me}` |
| `email-change` | POST | member | `{password, newEmail}` | `{}` (sends confirm link, purpose 'email', 30 min) |
| `email-change-confirm` | POST | public | `{token}` | `{}` (notifies old email, sv+1) |
| `logout-all` | POST | pwc | — | `{}` (sv+1, delete push subs) |
| `me-export` | GET | member | — | `{data: {...all my rows}}` |
| `me-delete` | POST | member | `{password}` | `{}` (anonymize: name='Miembro eliminado', email_norm='deleted-<id>@invalid', clear profile, delete DMs/push/tokens/progress, status='cancelado', deleted_at) |
| `about` | GET | public | — | `{group:{name, description, coverUrl, media, initials, color}, meta:{memberCount, onlineCount?:no, owner:{name}, priceFrom}}` — no member avatars/names except owner; `__cache` public 300s |
| `owner-session` | POST | owner | — | `{token, member: Me}`; ensures tables; creates the propietario row if none exists (email = barber email or `owner-<barberId>@pimpstudio.cl`, name = barber name, `barber_id`, source 'propietario', password NULL); rejects legacy barber tokens without `exp` (403) |
| `idle` | POST | member | — | `{}`; `UPDATE last_sync_at=NULL` (keepalive fetch) |

### 5.2 Courses — `_academyCourses.js` (BE-COURSES)
Access rule `canAccessCourse(member, course)`: staff (propietario/admin) → yes; `course.published` required for others; `access='abierto'` → any active member; `'nivel'` → level ≥ unlock_level **or** active grant; `'compra'` → active grant (`academy_grants.state='activa'`). Lesson visible iff course accessible and `lesson.published` (staff see drafts).

| mode | method | auth | request | response |
|---|---|---|---|---|
| `courses` | GET | member | — | `{courses: [CourseCard]}` where `CourseCard = {id, slug, title, subtitle, description, coverUrl, access, unlockLevel, owned, locked, lockReason:null|'compra'|'nivel'|'borrador', lessonCount, completedCount, progress(0-100 int), nextLesson:{slug,title}|null, priceOnline, salesOpen, published}`; drafts only for staff |
| `course` | GET | member | `slug` | `{course: CourseCard, sections: [{id, title, lessons:[{id, slug, title, durationSec, completed, published}]}], unsectioned: [...] }` — lesson list visible even if locked (titles only), `locked` true then |
| `lesson` | GET | member | `course`, `lesson` (slugs) | `{course:{slug,title}, lesson:{id, slug, title, body, resources, videoProvider, videoId, durationSec, positionSec, completed, sectionTitle}, prev:{slug,title}|null, next:{slug,title}|null}`; 403 `code:'locked'` if not accessible (no videoId/body leak) |
| `lesson-progress` | POST | member | `{lessonId, positionSec?, completed?}` | `{completed, positionSec, courseProgress}`; ignore position-only writes <20s apart; completed true/false always applied; 403 if not accessible |
| `catalog` | GET | public | — | `{courses:[{catalogId, slug, title, subtitle, coverUrl, priceOnline, pricePresencial, salesOpen, published, lessonCount}], cohorts:[{id, courseSlug, name, startsOn, seats, seatsLeft, salesOpen}], checkoutEnabled}`; `__cache` public 300s; DB error → `{courses:[], cohorts:[], checkoutEnabled:false, fallback:true}` |
| `admin-courses` | GET | admin | — | `{courses:[CourseAdmin with sections & lessons incl. videoId, body, resources, published]}` |
| `admin-course-save` | POST | admin | `{id?, slug?, title, subtitle, description, coverUrl, position, published, access, unlockLevel, priceOnline, pricePresencial, salesOpen, catalogId}` | `{course}` |
| `admin-course-delete` | POST | admin | `{id}` | `{deleted:true}` (409 if it has orders → set published=false instead and return `{archived:true}`) |
| `admin-section-save` / `admin-section-delete` | POST | admin | `{id?, courseId, title, position}` / `{id}` | `{section}` / `{}` |
| `admin-lesson-save` | POST | admin | `{id?, courseId, sectionId?, title, slug?, video (URL or id), durationSec?, body, resources:[{title,url}], published, position}` | `{lesson}`; `video` → `parseYouTubeId`, invalid → 400; lesson can't be published without videoId **unless** body non-empty |
| `admin-lesson-delete` | POST | admin | `{id}` | `{}` |
| `admin-reorder` | POST | admin | `{type:'course'|'section'|'lesson', ids:[...]}` | `{}` (position = index) |
| `admin-seed` | POST | admin | `{courses:[{catalogId?, slug, title, subtitle, description, coverUrl, priceOnline?, pricePresencial?, access?, sections:[{title, lessons:[{title, body?}]}]}], categories?:[{name, emoji, writeRole}]}` | `{created:{courses, sections, lessons, categories}}` idempotent by course slug (skip existing courses entirely); lessons created `published:false`; default categories if none exist: 📣 Anuncios (admins), 👋 Preséntate, ❓ Preguntas, 🏆 Logros, ✂️ Mis cortes, 📚 Recursos |
| `upload` | POST | member | `{kind, dataUrl, private?:bool}` | `{upload:{id, url}}` — magic bytes (webp/jpeg/png only; reject JPEG containing Exif APP1), ≤ 2 MB decoded, `@vercel/blob put()` `access: private ? 'private' : 'public'`, `addRandomSuffix: true`, path `academy/<kind>/<memberId>-<ts>.<ext>`; per-member 20/day & 100/month and global 1200/month (count `academy_uploads`) → 429; 503 if no BLOB token. Only admins can use kinds `curso`, `evento`, `galeria`, `portada` |

### 5.3 Community — `_academyCommunity.js` + `_academyNotify.js` (BE-COMMUNITY)
Visibility: `canSeePost(member, post)` = not deleted AND (category.cohort_id IS NULL OR member in that cohort OR staff). Writing in a category with `write_role='admins'` requires admin/propietario. `plugins.minPostLevel` (if set) blocks non-staff below level from creating posts (403 `code:'level'`).

PostCard shape:
```
{ id, author: MemberMini, category:{id,name,emoji}|null, title, excerpt (≤ 220 chars of body), body, attachments:[{kind,url,w,h}],
  videoId, poll:{options:[{text,votes}], total, myVote|null}|null, pinned, commentsLocked, likeCount, liked, commentCount,
  lastCommentAt, commenters:[MemberMini ≤4], createdAt, editedAt, unread, following }
```
Comment shape: `{id, postId|null, lessonId|null, parentId|null, author: MemberMini, body, likeCount, liked, createdAt, editedAt, deleted}` (deleted → body '' and author null-ish placeholder).

| mode | method | auth | request | response |
|---|---|---|---|---|
| `feed` | GET | member | `category?, sort=default|nuevos|top-dia|top-semana|top-mes|top-ano|top-siempre|no-leidos, filter=siguiendo?, cursor?` (cursor = opaque string) | `{pinned:[PostCard ≤3] (only first page, no category filter or matching), posts:[PostCard ≤20], nextCursor, categories:[{id,name,emoji,writeRole,cohortId}]}` ; default sort = `last_activity_at DESC`; top-* = like_count within window desc |
| `post` | GET | member | `id` | `{post: PostCard, comments:[Comment]}` + marks read (upsert post_reads) |
| `post-save` | POST | member | `{id?, categoryId, title, body, attachments?:[{url,w,h}], video?, poll?:{options:[text 2..10]}}` | `{post: PostCard}`; edit only by author or staff; poll immutable after first vote; mentions `@handle` in body → notify `mencion`; new post by followed member → notify followers `post_seguido`; post in admins-only category → notify all members `anuncio` (in-app only); author auto-follows post |
| `post-delete` | POST | member | `{id}` | `{}` (author or mod) soft delete |
| `comment-save` | POST | member | `{id?, postId?|lessonId?, parentId?, body}` | `{comment}`; 409 if post comments locked; notify post author `comentario`, parent author `respuesta`, post followers `actividad` (except actor), mentions `mencion`; updates post counters/last_comment_at/last_activity_at in the same statement |
| `comment-delete` | POST | member | `{id}` | `{}` |
| `lesson-comments` | GET | member | `lessonId` | `{comments:[Comment]}` (only if lesson accessible) |
| `like` | POST | member | `{targetType:'post'|'comment', targetId, like:bool}` | `{likeCount, liked}`; can't like own (400); insert/delete + counter in one CTE; notify author `like` (grouped by `group_key`, one unread row per target updated with actor & count text) |
| `poll-vote` | POST | member | `{postId, optionIdx}` | `{poll}` (change allowed) |
| `follow` | POST | member | `{targetType:'post'|'miembro', targetId, follow:bool}` | `{following}`; following a member → notify them `seguidor` |
| `report` | POST | member | `{targetType, targetId, reason}` | `{}`; notify staff `reporte` |
| `members` | GET | member | `tab=miembros|admins|en-linea|activos|cancelando|cancelado|expulsado` (last four admin only), `q?, level?, cohortId?(admin), sort=nuevos|actividad|puntos, page=1` (30/page) | `{members:[MemberPublic or MemberAdmin for admins], total, page, pages, counts:{miembros, admins, enLinea, activos?, cancelando?:0, cancelado?, expulsado?}}` |
| `member` | GET | member | `handle` | `{member: MemberPublic, stats:{posts, comments, followers, following, likesReceived}, activity:{startDate, counts:[365 ints]}, recent:[PostCard ≤5], isFollowing, canChat, isMe}` (activity respects hideActivity unless isMe) |
| `leaderboard` | GET | member | — | `{me:{level, levelName, points, pointsToNext, progress, rank7, rank30, rankAll}, levels:[{level, name, minPoints, pct, unlocks:[{kind:'curso'|'chat'|'publicar', label}]}], boards:{d7:[{rank, member:MemberMini, points}] ≤10, d30:[…], all:[…]}, updatedAt}` — excludes propietario/admin; windows in America/Santiago; `pct` over active members incl. owner (Skool counts owner) rounded int; cached 5 min per instance |
| `notifications` | GET | member | `filter=todas|no-leidas, cursor?` | `{notifications:[{id, kind, actor: MemberMini|null, targetType, targetId, parentId, route, text, preview, createdAt, read}], unread, nextCursor}` — `route` computed server-side from target (relative `/academy/...`), text Spanish (§8.1) |
| `notifications-read` | POST | member | `{ids?:[int]}` or `{all:true}` | `{unread}` |
| `search` | GET | member | `q (≥2 chars), type=todo|publicaciones|miembros|lecciones` | `{posts:[PostCard ≤20], members:[MemberPublic ≤20], lessons:[{courseSlug, courseTitle, slug, title}] ≤20}` — `ILIKE` with `%`,`_`,`\` escaped (`ESCAPE '\'`); only visible lessons/posts |
| `group-card` | GET | member | — | `{name, description, coverUrl, url:'pimpstudio.cl/academy', initials, color, counts:{members, online, admins}, avatars:[MemberMini ≤8], links, rules:[{title}]}` |
| `admin-category-save` / `admin-category-delete` | POST | admin | `{id?, name, emoji, position, writeRole, defaultSort, cohortId?}` / `{id, moveTo}` | `{category}` / `{}` (max 10) |
| `admin-pin` | POST | admin | `{postId, pinned:bool}` | `{}` (max 3 pinned → 409) |
| `admin-post-moderate` | POST | mod | `{postId, action:'lock'|'unlock'|'move'|'delete', categoryId?}` | `{}` |
| `admin-reports` | GET | mod | `status=abierto` | `{reports:[{id, reporter:MemberMini, targetType, targetId, reason, status, createdAt, preview, route}]}` |
| `admin-report-resolve` | POST | mod | `{id, status:'resuelto'|'descartado', deleteContent?:bool}` | `{}` |

`_academyNotify.js` exports:
```js
export async function notify(sql, { memberId, kind, actorId, targetType, targetId, parentId, preview, groupKey, push = true, text })
export async function notifyMany(sql, memberIds, payload)   // skips actor, blocked, members whose prefs.notif[kind-family]===false
export function notificationText(kind, actorName, extra) → Spanish text
export function routeFor({targetType, targetId, parentId, extra}) → '/academy/...'
```
`notify` pushes via `import('./_academyPush.js').then(m => m.pushToMembers(...))` best-effort (never throws). Push payload: `{title, body, url: route, tag}` with DM previews off by default.

### 5.4 Chat, Grupos, sync, push — `_academyChat.js` + `_academyPush.js` (BE-CHAT)
Rules: DMs only between active members sharing the academy; blocked in either direction → 403 generic; recipient `prefs.chat.enabled===false` → 403 `code:'chat_off'` ("X tiene el chat apagado"); `plugins.minChatLevel` gates non-staff. Group chat = cohort chat; membership = `academy_chat_members` (kept in sync with `academy_cohort_members`).

| mode | method | auth | request | response |
|---|---|---|---|---|
| `chats` | GET | member | `filter=todos|no-leidos` | `{chats:[{id, kind, name, other: MemberMini|null, cohort:{id,name,coverUrl}|null, lastMessage:{body, authorId, createdAt}|null, unread:int, muted, markedUnread}], unreadTotal}` |
| `chat` | GET | member | `id, before?` (message id) | `{chat:{id, kind, name, other, cohort}, members:[MemberMini], messages:[Message ≤40 asc], lastReadByOthers:int (max last_read of others, for "Visto"), myLastRead}` ; 404 if not a member |
| `chat-start` | POST | member | `{memberId}` | `{chatId}` (dm_key upsert) |
| `chat-send` | POST | member | `{chatId, body, attachments?:[{uploadId}]}` | `{message}`; updates chat last_message_*; marks sender read; notifies other members via push only if not online (`last_sync_at` < 90s) and not muted — **no** in-app notification row for DMs (chat badge covers it); AutoDM excluded from rate limits |
| `chat-read` | POST | member | `{chatId, messageId}` | `{}` |
| `chats-read-all` | POST | member | — | `{}` |
| `chat-mute` | POST | member | `{chatId, muted}` | `{}` |
| `chat-mark-unread` | POST | member | `{chatId}` | `{}` |
| `block` | POST | member | `{memberId, block:bool}` | `{}` |
| `blocks` | GET | member | — | `{members:[MemberMini]}` |
| `sync` | GET | member | `chat?, since?` (message id), `feedSince?` (ISO) | `{unreadNotifications, unreadChats, messages:[Message] (only if chat member), newPosts:int, onlineCount, serverTime}`; one SQL round trip (CTEs) + throttled `last_sync_at` write (≤ once/60s); in-memory per-member limiter 1 req/4 s → 429; never calls ensure* |
| `push-subscribe` | POST | member | `{subscription:{endpoint, keys:{p256dh, auth}}}` | `{}` ON CONFLICT (endpoint) DO UPDATE SET member_id |
| `push-unsubscribe` | POST | pwc | `{endpoint}` | `{}` |
| `cohorts` | GET | member | — | `{cohorts:[{id, name, description, coverUrl, course:{slug,title}|null, startsOn, memberCount, chatId, isMember}]}` (members see their own; staff see all) |
| `cohort` | GET | member | `id` | `{cohort, members:[MemberMini], chatId, isMember}` (403 if not member and not staff) |
| `file` | GET | member | `id` (upload id) | streams the private blob if the member can see a message referencing it (or is the uploader/staff); `Cache-Control: private, max-age=300` |
| `admin-cohort-save` | POST | admin | `{id?, name, description, coverUrl, courseId?, startsOn?, seats?, salesOpen}` | `{cohort}` (creates chat kind 'grupo' + adds staff? no: adds creator owner member if exists) |
| `admin-cohort-members` | POST | admin | `{cohortId, add?:[memberId], remove?:[memberId]}` | `{memberCount}` (syncs chat_members; removed → removed from chat) |
| `admin-cohort-archive` | POST | admin | `{id}` | `{}` |

Message shape: `{id, chatId, author: MemberMini, body, attachments:[{kind:'image', url:'/api/academy?mode=file&id=<uploadId>'}], createdAt, mine}`.

`_academyPush.js`: `pushToMembers(sql, memberIds, {title, body, url, tag})` — selects `academy_push_subscriptions JOIN academy_members status='activo'`, sends via `_webpush.sendToSubscriptions`, deletes 404/410 rows. Never throws.

`_webpush.js`: extracted from `api/push.js` `getWebPush()` (memoized dynamic import of `web-push` + VAPID env) and `sendToSubscriptions(rows, payload, onGone)`; `push.js` must use it too with identical behavior.

### 5.5 Events — `_academyEvents.js` (BE-EVENTS)
Occurrence expansion: non-repeating → one occurrence at `starts_at`. `repeat_weekly` → for each week from `starts_at`'s week, each ISO weekday in `weekdays` (default = weekday of starts_at), local wall time = `starts_at` local time in `tz` (DST-safe: compute in `tz` via `AT TIME ZONE`), until `until_date` inclusive (or open-ended), within the requested range (max 62 days range). `canSeeEvent`: `access.type='todos'` → all; `'nivel'` → level ≥ level or staff; `'grupo'` → cohort member or staff. Locked events are listed with `locked:true, locationInfo:null`.

| mode | method | auth | request | response |
|---|---|---|---|---|
| `events` | GET | member | `from` (YYYY-MM-DD), `to` (YYYY-MM-DD), `tz?` | `{events:[{id, occurrenceStart(ISO), title, description, coverUrl, durationMin, tz, locationType, locationInfo|null, locked, lockReason:null|'nivel'|'grupo', access, repeatWeekly, weekdays, untilDate, emailReminder, calendarLinks:{google}}], serverTime}` |
| `event` | GET | member | `id, occurrence?` | `{event}` |
| `admin-event-save` | POST | mod | `{id?, title, description, coverUrl, startsAt(ISO), durationMin, tz, repeatWeekly, weekdays, untilDate, locationType, locationInfo, access, emailReminder}` | `{event}`; location for meet/zoom/youtube/enlace must pass safeUrl |
| `admin-event-delete` | POST | mod | `{id}` | `{}` |

Google link = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=YYYYMMDDTHHMMSSZ/…&details=…&location=…` (only include location if not locked). ICS is built **client-side** (`src/academy/ics.js`).

### 5.6 Admin & payments — `_academyAdmin.js` + `_academyProvision.js` (BE-PAY)
| mode | method | auth | request | response |
|---|---|---|---|---|
| `admin-members` | GET | admin | `status?, q?, courseId?, cohortId?, all?=1, page?` | `{members:[MemberAdmin], total, counts}` (all=1 → no pagination, for CSV) |
| `admin-invite` | POST | admin | `{name, email, courseIds:[int], cohortId?}` | `{member: MemberAdmin, created:bool, credentials:'enviadas'|'pendientes'|'cuenta_existente'}`; rate limit 10/day per actor; creates member (source 'invitacion') + grants (source 'invitacion', granted_by) + cohort membership; `claimAndSendCredentials`; if the member already has a password → sends "Ya tienes acceso" |
| `admin-member-update` | POST | admin | `{id, role?, status?, purgeRecent?:bool, email?}` | `{member}`; **role changes and email changes: propietario only**; nobody sets `propietario`; admins can't modify propietario/admin rows; `expulsado` → banned_at, sv+1, delete push subs, optional purge (soft-delete posts/comments of last 7 days); email change = account transfer (§6.6) |
| `admin-resend-access` | POST | admin | `{id}` | `{credentials}` — never-set password → re-arm + claim; else send reset link |
| `admin-password-link` | POST | admin | `{id}` | `{}` (reset link to member email) |
| `admin-grant` | POST | admin | `{memberId, courseId}` | `{grant}` (source 'manual') |
| `admin-revoke` | POST | admin | `{grantId, reason}` | `{}` (§6.5 logic, reason 'manual: …') |
| `admin-orders` | GET | admin | `status?, page?` | `{orders:[{ref, course, modality, cohort, amount, name, email, phone, status, mpPaymentId, mpPayerEmail, paidAt, createdAt, memberId, emailMismatch}]}` |
| `admin-verify-order` | POST | admin | `{ref}` | `{order}` (runs `reconcileOrder`) |
| `admin-import-grant` | POST | admin | `{name, email, courseId, externalRef?}` | same as invite but source 'puente'/'manual' with `external_ref` (idempotent) — for BrunettiCutz buyers |
| `admin-settings` | GET/POST | admin | POST `{group?, levels?, plugins?, tabs?, sync?, autoprovision?}` (deep-merge; validate: names ≤20 chars ×9, links safeUrl ≤5, media ≤12) | `{settings}` |
| `admin-stats` | GET | admin | — | `{members:{active, new7, new30, active7}, courses:[{id, title, owners, completedPct}], orders:{paid30, revenue30, pending}, community:{posts7, comments7}, uploads:{month, limit}, email:{today, budget}}` |

Checkout and webhook are **not** router modes — see §6.

---

## 6. Payments & provisioning (BE-PAY) — `api/_academyProvision.js`

### 6.1 Checkout: `handleCourseCheckout(sql, req, res)` — called from `_checkout.js handleCheckout` when `req.body?.kind === 'course'` (after its method/mpConfigured/rateLimit guards)
Body `{kind:'course', courseSlug, modality:'online'|'presencial', cohortId?, name, email, emailConfirm, phone?, acceptTerms:true}`. Validate (name 1–80, email ≤120 valid, email===emailConfirm, acceptTerms true, modality, cohortId required for presencial). Pre-checks (read-only, 42P01 → 503): email belongs to `expulsado` member → 409 "No podemos procesar esta compra, escríbenos"; email already has active grant for this course → 409 `code:'ya_tienes'` "Ya tienes este curso". Insert order in one statement (price from DB, `sales_open AND published AND price NOT NULL`, seats check for presencial with pending orders younger than 30 min counted) → 409 "Ese curso no está disponible". `ref = 'aca-' + randomBytes(16).hex`. `createPreference({ref, items:[{productId:'course:'+slug+':'+modality, name:title, qty:1, unitPrice:amount}], payer:{name,email}, backUrl: SITE_URL+'/academy/gracias?ref='+ref, notificationUrl: SITE_URL+'/api/mp-webhook', metadata:{kind:'course', ref}, statementDescriptor:'PIMP ACADEMY'})`. MP failure → order `anulada` + 502. Success → store `mp_preference_id`, return `{ok, ref, total, initPoint}`.

`handleCourseStatus(sql, req, res)` for `GET /api/checkout?ref=aca-…`: `{ok, kind:'course', status, course:{slug,title}, modality, total, emailMasked}`; if `pendiente` and created > 20 s ago, at most once per 15 s per ref (in-memory), call `searchPayments(ref)` and apply §6.2.

### 6.2 Webhook: `handleAcademyPayment(sql, payment, paymentId, res)` — called from `_checkout.js handleMpWebhook` right after `fetchPayment` when `payment.external_reference` starts with `'aca-'` (signature already verified by the shared code)
`verifyCoursePayment(order, payment)` → `{ok, reason}`: `external_reference===order.public_ref`, `currency_id==='CLP'`, `transaction_amount >= order.amount`, and in production (`VERCEL_ENV==='production'`) `live_mode===true` (else → `revision`).
Status table:
- `approved` + verify ok → **grant** (§6.3). `approved` + verify fails → order `revision` + admin alert.
- `approved` with `transaction_amount_refunded > 0` (partial) → alert only.
- `pending|in_process|authorized` → `UPDATE … SET mp_last_status WHERE status='pendiente'` (keep pending). `rejected` → same. `cancelled` → may set `anulada` (a later approved still applies).
- `refunded`, or `charged_back` with `status_detail` in (`settled`,`in_process`) → revoke (§6.5) only if `mp_payment_id` equals this payment.
- `charged_back/reimbursed`, `in_mediation` → alert only.
- approved while order already `pagada` with a different `mp_payment_id` → alert "pago duplicado, reembolsar".
Response: DB error → 500 (MP retries; reconcile also covers). Email/push failures → 200.

### 6.3 Grant statement (single CTE)
```sql
WITH o AS (
  UPDATE academy_orders
     SET status='pagada', mp_payment_id=$pid, mp_last_status='approved', paid_at=NOW(), paid_amount=$amt,
         mp_payer_email=$payerEmail, live_mode=$live, updated_at=NOW()
   WHERE public_ref=$ref AND status IN ('pendiente','anulada') AND paid_at IS NULL
  RETURNING id, course_id, cohort_id, name, email, email_norm, phone
), m AS (
  INSERT INTO academy_members (email_norm, email, name, phone, status, role, source, must_change_password)
  SELECT email_norm, email, name, phone, 'activo', 'miembro', 'pago', true FROM o
  ON CONFLICT (email_norm) DO UPDATE
    SET status = CASE WHEN academy_members.status='cancelado' THEN 'activo' ELSE academy_members.status END,
        updated_at = NOW()
  RETURNING id, status, password_set_at, (xmax = 0) AS nuevo
), g AS (
  INSERT INTO academy_grants (member_id, course_id, order_id, source, state)
  SELECT m.id, o.course_id, o.id, 'pago', CASE WHEN m.status='expulsado' THEN 'revision' ELSE 'activa' END
  FROM o, m
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id, state
), cm AS (
  INSERT INTO academy_cohort_members (cohort_id, member_id)
  SELECT o.cohort_id, m.id FROM o, m WHERE o.cohort_id IS NOT NULL
  ON CONFLICT DO NOTHING RETURNING cohort_id
)
SELECT o.id AS order_id, m.id AS member_id, m.nuevo, m.status, m.password_set_at, g.id AS grant_id, g.state
FROM o, m LEFT JOIN g ON true
```
Then (separate statements, idempotent): set handle if NULL; add to cohort chat (`academy_chat_members` via cohort.chat_id, ON CONFLICT DO NOTHING); if 0 rows (already processed) → find member via the order's grant and continue. Then:
- member has `password_set_at` → "Ya tienes acceso a <curso>" email, claimed once via `UPDATE academy_grants SET notified_at=NOW() WHERE id=$g AND notified_at IS NULL RETURNING id`.
- else `claimAndSendCredentials(sql, memberId, {course})`.
- AutoDM (if enabled and owner exists and member new): create DM from owner with the template (best-effort).
- Admin alert: insert into `notifications` (barber table) for each active admin barber + `notifyBarber(adminId, payload, {log:false})` via dynamic import of `./push.js` (NOT `notifyAll`). Payload: "Nueva inscripción Academy · <curso> · $<monto>" (no phone), url `/panel?tab=academy`.

### 6.4 `claimAndSendCredentials(sql, memberId, {course?} = {})`
```sql
UPDATE academy_members SET credentials_claimed_at=NOW(), credentials_attempts=credentials_attempts+1, updated_at=NOW()
 WHERE id=$id AND status='activo' AND role<>'propietario' AND password_set_at IS NULL
   AND credentials_sent_at IS NULL AND credentials_attempts < 5
   AND (credentials_retry_at IS NULL OR credentials_retry_at <= NOW())
   AND (credentials_claimed_at IS NULL OR credentials_claimed_at < NOW() - interval '10 minutes')
   AND EXISTS (SELECT 1 FROM academy_grants g WHERE g.member_id=$id AND g.state='activa')
RETURNING to_char(credentials_claimed_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS') AS claim_key, email, name
```
Winner: `generateTempPassword()` → `hashPasswordAsync(canonical)` → `UPDATE … SET password_hash, must_change_password=true, temp_password_expires_at=NOW()+'72 hours' WHERE id AND claim_key matches` → `sendAcademyAccessEmail({to, name, tempPassword: display, loginUrl: SITE_URL+'/academy/ingreso', course, idempotencyKey: 'aca-cred-'+id+'-'+claim_key})` → if ok `SET credentials_sent_at=NOW()`; if status 429/quota → `credentials_attempts=credentials_attempts-1, credentials_retry_at = NOW()+ (1h|3h|next 08:00 Santiago by attempts)`. Returns `'enviadas'|'pendientes'|'cuenta_existente'|'no_aplica'`. Re-arm = `SET credentials_sent_at=NULL, credentials_claimed_at=NULL, credentials_attempts=0, credentials_retry_at=NULL` then call again.

### 6.5 Refund / revoke (single statement; exclude the revoked order in EXISTS)
As in the research report: update order `reembolsada` (only if `mp_payment_id=$pid AND refunded_at IS NULL`), grants of that order → `revocada`, member → `cancelado` + `session_version+1` unless role propietario/admin or other active grants remain (exclude this order_id explicitly). Then delete push subs of cancelled member; one admin alert. `revokeGrant(sql, grantId, reason, actor)` for manual revokes (same member logic).

### 6.6 Email change by owner = account transfer
`UPDATE academy_members SET email=$e, email_norm=$en, session_version=session_version+1, password_hash=NULL, password_set_at=NULL, must_change_password=true, credentials_sent_at=NULL, credentials_claimed_at=NULL, credentials_attempts=0, credentials_retry_at=NULL WHERE id=$id` + delete tokens + push subs + `claimAndSendCredentials`.

### 6.7 Reconcile: `reconcileAcademyOrders(sql, {limit=10, budgetMs=8000})` and `reconcileOrder(sql, ref)`
Orders `pendiente` older than 5 min and younger than 3 days → `searchPayments(ref)` (new in `_mercadopago.js`: `GET /v1/payments/search?external_reference=<ref>&sort=date_created&criteria=desc`) → apply §6.2 to the most relevant payment (approved first). Orders pending > 3 days → `anulada`. Also retry `claimAndSendCredentials` for members with active grants and pending credentials (≤5 per run).

### 6.8 `_mercadopago.js` fixes (BE-PAY)
`mpFetch` gets `signal: AbortSignal.timeout(8000)`; `createPreference` **sends** `payer` (`{name, email}`), optional `metadata`, optional `statementDescriptor` (default 'PIMP STUDIO'); new `searchPayments(externalReference)`. Essentials behavior otherwise unchanged. **Also fix B1 for Essentials is OUT OF SCOPE** (note it in the report only).

### 6.9 `_checkout.js` branches (BE-PAY) — minimal, early returns
- `handleCheckout`: after guards, `if (req.body?.kind === 'course') { const m = await import('./_academyProvision.js'); return m.handleCourseCheckout(sql, req, res) }`.
- GET `?ref=` handler: `if (/^aca-[a-f0-9]{32}$/.test(ref)) → handleCourseStatus`.
- `handleMpWebhook`: after `payment = fetchPayment(...)` and `ref = payment.external_reference`: `if (String(ref||'').startsWith('aca-')) → handleAcademyPayment(sql, payment, String(paymentId), res)`.

---

## 7. Frontend

### 7.1 Routes (`src/App.jsx`: replace the 3 academy routes by `<Route path="/academy/*" element={<AcademyRoot/>}/>`)
`AcademyRoot` (descendant Routes):
```
/academy                  → public catalog (existing Academy.jsx). If a member token exists, show a sticky "Entrar a la Academy" CTA (no auto-redirect).
/academy/gracias?ref=     → Gracias (polls GET /api/checkout?ref= every 2.5s up to 10 tries)
/academy/ingreso          → Ingreso (email + password; links: ¿Olvidaste tu contraseña? / Volver al catálogo)
/academy/crear-contrasena → CrearContrasena (forced change, pwc token)
/academy/restablecer      → Restablecer (?token= stripped from URL on load)
/academy/confirmar-correo → ConfirmarCorreo (?token=)
/academy/perfil (legacy)  → Navigate to /academy/comunidad or /academy/ingreso
/academy/*  (member)      → AcademyApp (guard: no token → /academy/ingreso; pwc → /academy/crear-contrasena)
   comunidad, comunidad/:postId, cursos, cursos/:curso, cursos/:curso/:leccion, calendario, miembros,
   clasificacion, acerca, perfil/:handle, ajustes, reglas, chat/:id (phone), grupos/:id, buscar?q=
```
Entry into member routes from outside is a **hard navigation** (`window.location.assign`) because `/academy/(.+)` has its own strict CSP. `PWALaunchRouter.launchTarget`: after `ps_barber` → `/panel`, `ps_academy_token` → `/academy/comunidad`, then `ps_user` → `/cuenta`, else as today.

### 7.2 Client libs (FE-CORE) `src/academy/`
- `session.js`: keys `ps_academy_token`, `ps_academy_member` (JSON), `ps_academy_seen='1'` (persistent marker); `getToken() setSession(token, member) clearSession() getMember()` all try/catch.
- `api.js`: `academyApi(mode, {method='GET', query, body, keepalive}) → data` : adds `Authorization: Bearer <token>`; URL `/api/academy?mode=…&…`; throws `ApiError{status, code, message}`; **non-JSON response → ApiError(503,'unavailable')**; 401 `code:'auth'` → `clearSession()` + `window.location.assign('/academy/ingreso')` (except on auth pages); 403 `password_change_required` → assign `/academy/crear-contrasena`. Also `checkoutApi(body)` / `checkoutStatus(ref)` for `/api/checkout`.
- `useQuery.js`: `useAcademyQuery(key, fetcher, {deps, refetchOnFocus=true})` → `{data, error, loading, refetch, setData}`; in-memory cache map by key; refetch on `visibilitychange`→visible; no polling. `useMutation` helper optional.
- `AcademyContext` (in `AcademyApp.jsx`, exported from `src/academy/context.js`): `{ me, group, refreshMe, setMe, unread:{notifications, chats}, refreshUnread, openChat(chatId|{memberId}), openNotifications(), isStaff, isAdmin, isOwner, levelName(n) }`.
- `useSync.js`: implements §9 gating; consumers: chat window and unread badges.
- `url.js` (`safeUrl`, `isImageUrl`), `youtube.js` (`parseYouTubeId`, `embedUrl(id)` → `https://www.youtube-nocookie.com/embed/<id>?enablejsapi=1&origin=<location.origin>&rel=0&playsinline=1&modestbranding=1`, `thumbUrl(id)` → `https://i.ytimg.com/vi/<id>/hqdefault.jpg`, `createPlayerBridge(iframe, {onState, onTime})` postMessage protocol: send `{"event":"listening","id":…}` then parse `infoDelivery` `{currentTime, duration, playerState}`; validate `event.origin === 'https://www.youtube-nocookie.com'`), `levels.js` (thresholds + `levelFor`, default names), `time.js` (`timeAgo` es-CL: 'ahora', '5 min', '3 h', '13 d', then 'ago. 25'; `fmtDate`, `fmtTime`, Santiago/tz helpers), `calendarMath.js` (Monday-first month grid, `keyOf`, `MONTHS`, `DOW`, `todayKey(tz)`), `drafts.js` (localStorage drafts), `ics.js` (RFC 5545 builder with escaping; `downloadIcs(event)` Blob), `passwordRule.js`, `upload.js` (`compressImage(file, {max:1280, quality:0.82}) → dataUrl webp` via canvas, always re-encode; `uploadImage(kind, file, {private})`), `csv.js` (`csvCell`, `downloadCsv(rows, name)`), `routes.js` (route builders).

### 7.3 Shell & layout (FE-CORE) — match Skool screenshots
- `body.aca-mode` while `AcademyApp` is mounted (add/remove class): background `var(--pn-bg) !important`, hide `.float-theme-toggle`, hide `.stage::before`.
- **Top bar** (sticky, 64px, white/`--pn-surface`, bottom hairline): left group switcher `[initials tile 40px rounded 10] Pimp Studio Academy ⌃⌄` (menu: Ir a pimpstudio.cl, Reservar hora, Catálogo de cursos, (staff) Abrir panel, divider, my Grupos list); center search field (placeholder "Buscar", "Buscar miembros" on Miembros) → `/academy/buscar?q=`; right: chat icon button with badge (opens `ChatPopover` — provided by FE-CHAT, imported lazily), bell with red count badge (opens `NotificationsPopover` from FE-COMUNIDAD), avatar (UserMenu: Perfil, Ajustes, Tema Claro/Oscuro/Automático, Cerrar sesión).
- **Tabs row** under the bar: Comunidad · Cursos · Calendario · Miembros · Clasificación · Acerca de (active = bold with 3px underline), horizontally scrollable on phone. Respect `group.tabs` toggles.
- **Left rail** (desktop ≥1100px, fixed 72px): compass (→ `/academy` catalog), active group tile with black left bar, then Grupos tiles (cohort initials/cover) → `/academy/grupos/:id`.
- Content max-width 1100px centered; 2-column layouts where Skool has them (feed + right column 320px; members + group card).
- Light theme default look: page bg `#f5f5f3`-ish via tokens, white cards, 1px `--pn-hairline`, radius 12, subtle shadow; primary buttons use the **yellow** accent `#f8d34b`-ish text black like Skool's INVITAR (define `--aca-accent`/`--aca-on-accent` in app.css for light & dark). Dark theme supported via `--pn-*` tokens.
- `PageState` component: loading skeleton, error ("No se pudo cargar · Reintentar"), empty.
- `LevelBadge`/`MemberAvatar`: avatar (image or initials) with a small circular level number bottom-right (blue `#3b5bdb` like Skool, white text).
- `RichText`: renders plain text with line breaks, auto-links (`safeUrl`), `@handle` mentions → `/academy/perfil/<handle>`; never HTML.
- `OnboardingWidget` (members: Completa tu perfil, Mira tu primera lección, Instala la app, Comenta una publicación; owner: Sube la portada, Completa Acerca de, Carga los cursos, Escribe tu primera publicación, Crea tu primer evento) with progress ring and "Descartar" (prefs.onboarding).
- Dev-only user switcher (only if `import.meta.env.DEV && import.meta.env.VITE_DEV_MOCKS === '1'`): calls `/api/__mock/login-as?member=ID`.

### 7.4 Tabs (owners in §1.2) — visual behavior summary
- **Comunidad**: composer card "Escribe algo…" → expands (title, body textarea, category select, image picker ≤4, YouTube link, poll builder, @mention autocomplete via `members?q=`); category pills; sort menu (Predeterminado, Nuevos, Top: Día/Semana/Mes/Año/Siempre, No leídos) + filter "Siguiendo"; pinned first; PostCard (author+level badge, "· hace 2 h · 📣 Anuncios", title bold, excerpt 3 lines, first image, ♥ count, 💬 count, commenter avatars, "Último comentario hace X"); infinite "Cargar más"; post detail as Sheet (lg) / route `/academy/comunidad/:postId` with comments 2 levels, reply, like, ⋯ menu (Editar, Eliminar, Copiar enlace, Fijar, Mover, Apagar comentarios, Reportar); right column: GroupCard + "Clasificación (30 días)" top 5 + "Ver todas". Event banner above feed when next event < 7 days ("📅 Q&A con Bruno es en 2 días") .
- **Cursos**: 3-col grid of CourseCard (cover 1.9:1 with lock overlay if locked, title, 2-line description, progress pill bar green with "%"; locked `compra` → button "Comprar" → catalog `/academy#curso-<catalogId>` (hard nav); locked `nivel` → "Se desbloquea en Nivel N"); course page: header + sections list; lesson page: left sidebar (course sections with ✓), center player 16:9 (LessonPlayer with progress bridge: save every 60s of playback, on pause/end, on hidden via keepalive; mark complete at ENDED or ≥90%; resume from positionSec), "Marcar como completada" toggle, body RichText, resources links, prev/next, comments (LessonComments via `lesson-comments`/`comment-save`). `data-hold-reload` attribute on the player root while PLAYING.
- **Calendario**: header [Hoy] ‹ septiembre 2026 › + clock "9:40 pm hora de Santiago" + [+] (staff) + list/month toggle; month grid Mon–Sun with event chips (+N más); list view paginated; empty-state overlay for staff with 4 templates (☕ Hora del café, 💬 Preguntas y respuestas, 💻 Sesión de coworking, 🍺 Hora feliz) + "O, crea mi propio evento"; members: "No hay eventos próximos"; EventSheet (details, locked link message, "Agregar al calendario": Google / Apple (.ics) / Outlook (.ics)); EventEditor (staff).
- **Miembros**: pills (members: Miembros · Admins · En línea; staff: Activos · Cancelando · Cancelado · Expulsado with counts), "Filtro" (nivel, grupo, orden), "Exportar" (staff; `admin-members?all=1` → CSV with csvCell), "INVITAR" (staff; sheet: nombre, correo, cursos, grupo); MemberCard rows like screenshot 3 (avatar+badge, name + "(Propietario)", @handle, bio, "● En línea ahora"/"Activo hace X", "Se unió el …", "Acceso de por vida", Chat + Seguir buttons; staff ⋯ → MemberAdminSheet); right: GroupCard (cover "Subir foto de portada" for staff, name, url, description, counts Miembros/En línea/Administradores, avatars, CONFIGURACIÓN → GroupSettingsSheet: General, Categorías, Niveles, Complementos, Pestañas, Reglas, Enlaces).
- **Clasificación**: like screenshot 4 — left big avatar + badge, name, "Nivel N · nombre", "X puntos para subir de nivel" + ⓘ; right 2 columns of 9 levels (lock icon for unreached, gold circle current, "% de los miembros", unlocks); notice "Las tablas de clasificación se actualizarán cuando haya más actividad" when all empty; 3 cards "Tabla de clasificación (7 días)" / "(30 días)" / "(de todos los tiempos)" with rank, avatar, name, +N / total, "Aún no hay actividad"; gear (staff) → level names editor.
- **Acerca de**: title, media gallery (carousel of images/YouTube thumbs; staff "Subir imágenes / videos"), description, meta row "🔒 Privado · N miembros · Pago único · Por <owner>", GroupCard at right.
- **Chats popover** (FE-CHAT): title "Chats", "Todos ⌄" (Todos/No leídos), "Marcar todo como leído" (confirm), search "Buscar usuarios" (members?q=) → chat-start; empty "Aún no hay chats"; rows; clicking opens ChatWindow docked bottom-right (desktop, up to 2 windows) or `/academy/chat/:id` (phone). ChatWindow: header (avatar/name/⋯: Marcar como no leído, Silenciar, Bloquear, Reportar), messages with day separators + "Nuevos mensajes" separator + "Visto", composer (textarea, Enter sends, image attach private), uses `useSync` with `chat` param.
- **Notificaciones popover** (FE-COMUNIDAD): title "Notificaciones", "Marcar todo como leído" (confirm), "Todos ⌄" (Todas/No leídas); rows avatar+badge, "**Juan** comentó en tu publicación", preview line, time, blue dot; click → route; empty "Aún no hay notificaciones".
- **Grupos** (`/academy/grupos/:id`, FE-CHAT): header (cover, name, N miembros, course link), members strip, embedded group ChatThread (full height), staff "Gestionar miembros".
- **Perfil** (FE-MIEMBROS): avatar, name, @handle, bio, location, links, level + points to next, "Se unió el…", Seguir/Chat buttons, stats, ActivityHeatmap (365 days, Monday rows), recent posts.
- **Ajustes** (FE-MIEMBROS): Perfil (name, bio, location, links, avatar upload, handle), Cuenta (cambiar contraseña, cambiar correo, cerrar sesión en todos los dispositivos, descargar mis datos, eliminar cuenta), Notificaciones (push toggle via `src/academy/push.js`, email, tipos), Chat (activado, vista previa, bloqueados), Privacidad (ocultar actividad, ocultar En línea), Zona horaria, Tema.

### 7.5 Panel tab (FE-PANEL) `src/pages/panel/AcademyTab.jsx`
Nav entry `["academy", "graduation", "Academy", "negocio"]` in `Dashboard.jsx` nav array (admin-only by existing filter); lazy mount with `<Suspense fallback={<SkeletonRows rows={4}/>}>`. Segmented sections:
- **Resumen**: KPIs from `admin-stats`; button **Abrir Academy** (`owner-session` with `ctx.authHeaders` → `setSession` → `window.location.assign('/academy/comunidad')`).
- **Miembros**: DataTable (`admin-members`), search, status filter, actions (Invitar, Reenviar acceso, Enlace de contraseña, Dar curso, Revocar, Expulsar/Reactivar, Cambiar rol (owner)), CSV export.
- **Cursos**: list courses (`admin-courses`) with edit sheets: course fields (price online/presencial, sales open, published, access, level), sections & lessons editor (paste YouTube URL → preview thumbnail via `thumbUrl`, publish toggle, ↑↓ reorder), "Cargar cursos iniciales" (builds `admin-seed` payload from `src/data/courses.js`: each course → sections = `malla` days (`Clase N · title`), lessons = each `items[]` topic (draft); plus extra course `brunetti-metodo` "Método Brunetti · Visagismo & Barbería" with the 6 Skool modules → sections and their lessons (titles from BrunettiCutz `cursos.json`, embed the list in the payload builder).
- **Grupos**: cohorts list, create/edit (name, description, course, starts_on, seats, sales open), members add/remove (search), link to open chat in academy.
- **Pedidos**: `admin-orders` table with status chips, "Verificar pago".
- **Ajustes**: `admin-settings` (group info, level names, plugins: minPostLevel/minChatLevel/autoDm, tabs, sync, autoprovision).
Uses only `ctx.authHeaders`, `ctx.pushToast`, `ctx.admin`, `ctx.barber`, `ctx.refreshing`. Calls `/api/academy?mode=…` with barber headers.

### 7.6 Catalog `src/pages/Academy.jsx` (FE-PANEL)
- Loads `catalog` mode (fallback to static). `PriceTag` shows DB price; `null` or `!salesOpen` → "Por definir · Valor se publica pronto".
- Cart kept (course+modality). Drawer: total computed from DB prices; checkout supports **one course per payment** (if the cart has several, checkout the first and keep the rest; show a note). Checkout form in drawer: nombre, correo, confirmar correo (with domain typo suggestion gmial→gmail etc.), teléfono (optional), presencial → select generation (cohorts with salesOpen for that course, seats left), checkbox "Acepto los términos y el aviso de privacidad" (link `/academy/reglas`? no: link to `/academy#terminos` section with terms text on the catalog page). POST `/api/checkout` `{kind:'course', …}` → save `bc`→ `sessionStorage.ps_academy_checkout = {email, ref}` → `window.location.href = initPoint`. Errors: 409 `ya_tienes` → "Ya tienes este curso. Entra a la Academy"; 503 → "Las inscripciones abren pronto".
- Copy: "12 meses" → "Acceso de por vida" (data in `courses.js` `access: 'de por vida'` + labels). Remove "Todavía no hay pago en línea" note when checkout enabled. "Zona de alumnos" CTA → "Entrar a la Academy" (hard nav to `/academy/ingreso` or `/academy/comunidad` if token).
- `SiteNav.jsx`: unhide the Academy link.

### 7.7 Styles
Prefix `aca-` for all academy member-app classes (the catalog keeps `academy-*`). Files under `src/styles/academy/`, imported by the components that use them. Use `--pn-*` tokens; define `--aca-*` extras in `app.css` for light and `[data-theme="dark"]`/dark. Mobile first; breakpoints 640 / 900 / 1100. Inputs ≥16px on phones. Minimum tap target 44px.

---

## 8. Notifications & email

### 8.1 Notification kinds (text in Spanish, built by `notificationText`)
`like` ("A **Juan** le gustó tu publicación" / "A **Juan** y 3 más les gustó tu comentario"), `comentario` ("**Juan** comentó en tu publicación"), `respuesta` ("**Juan** respondió tu comentario"), `mencion` ("**Juan** te mencionó"), `post_seguido` ("**Juan** (siguiendo) publicó"), `actividad` ("Hay actividad nueva en una publicación que sigues"), `anuncio` ("**Bruno** publicó un anuncio"), `seguidor` ("**Juan** empezó a seguirte"), `evento` ("Mañana 19:00: Q&A con Bruno"), `nivel` ("¡Subiste al Nivel 3 · Barbero!"), `bienvenida` ("¡Bienvenido a Pimp Studio Academy!"), `curso` ("Tienes acceso a <curso>"), `grupo` ("Te agregaron al grupo <nombre>"), `reporte` (staff: "Nuevo reporte de contenido"), `miembro_nuevo` (staff: "**Juan** se unió a la Academy"). Level-up notification is created when a like pushes the author over a threshold.

### 8.2 `api/_email.js` (BE-CORE)
- `sendViaResend({to, subject, html, text, headers = {}, timeoutMs = 8000})` → `{ok, status, reason}`; `AbortSignal.timeout`; `Idempotency-Key` via headers; existing three exports keep working.
- `esc()` applied to every interpolation in **all** templates (fix existing ones too).
- New exports: `sendAcademyAccessEmail({to, name, tempPassword, loginUrl, course, idempotencyKey})` (subject "Tu acceso a Pimp Studio Academy"; box Usuario/Contraseña temporal monospace; "Válida por 72 h; al entrar te pediremos crear la tuya"; button "Entrar a la Academy"; "Si recibiste más de un correo, usa el más reciente"; text part), `sendAcademyAlreadyEmail({to, name, course, loginUrl})`, `sendAcademyResetEmail({to, name, resetUrl, minutes})`, `sendAcademyEmailChangeEmail({to, name, confirmUrl})`, `sendAcademyEmailChangedNotice({to, name, newEmailMasked})`, `sendAcademyActivityEmail({to, name, items:[{text, url}], loginUrl})`, `sendAcademyEventReminderEmail({to, name, event:{title, whenText, url}})`.
- `sendAcademyEmail(sql, kind, fn, args, {critical=false})`: checks/increments `academy_email_log(day Santiago, kind)`; non-critical kinds stop when the day's academy total ≥ 60; public-triggered (`reset`,`email`) stop at 20/day; `critical` (credentials of paid purchase) always sends. Lives in `_academyHttp.js`? → **lives in `_academyAccount.js`? No: in `api/_academyEmail.js` owned by BE-CORE** (add to §1.1 list). Never logs bodies/passwords.

---

## 9. Realtime without burning Neon (`useSync`, BE `sync`)
- F: chat badge/notifications counts load on app mount, on `visibilitychange`→visible, on popover open.
- `useSync({chatId})` polls `sync` only if: `document.visibilityState==='visible'` && `document.hasFocus()` && last user input (pointerdown, keydown, scroll, touchstart) within 90 s (3 min when a chat window is open) && `group.sync.enabled !== false`. Intervals: chat open → 5 s for 60 s after any send/receive, then 10 s, then 20 s; otherwise 60 s. Stops when conditions fail and sends `idle` via `fetch(…, {method:'POST', keepalive:true, headers})`. Immediately syncs on regaining visibility/focus/input.
- Presence: `online = last_sync_at > NOW()-90s` (hidden if prefs.privacy.hideOnline). "Activo hace X" from `last_seen_at`.
- Server `sync` limiter in memory: 1 req / 4 s / member → 429 (client backs off).

## 10. Cron (BE-EVENTS writes `_academyCron.js`; BE-CHAT wires it into `api/push.js`)
`runAcademyJob(sql, { budgetMs = 7000, hourSantiago, force = false })` → `{ ensured, credentials, reconciled, reminders24, reminders1, activityEmails, cleaned, stoppedEarly }`; never throws. Steps (check deadline before each): `ensureAcademyTables`; `reconcileAcademyOrders` (≤5); pending credentials (≤5); event reminders 24h (window 18–30 h → in-app `evento` + email if `email_reminder` and budget) and 1h (45–105 min; the 21h run uses 45–179 min; the 8h run 0–105) → in-app + push; mark `academy_event_reminders`; activity email digest (only at hour 19: members with unread mentions/replies/DM older than 2 h, not seen 2 h, no push subs, `activity_email_at` < 24 h ago, prefs.notif.email); cleanup (only at hour 8): tokens used/expired > 30 d, notifications > 180 d, `rate_limits` rows of `aca-*` older than 2 d, `academy_email_log` > 90 d.
`api/push.js` (BE-CHAT): inside `?job=reminders`, after autocomplete and before Brunetti stars, a separate `try/catch` block, outside `failed`: `if (process.env.CRON_SECRET) { const { runAcademyJob } = await import('./_academyCron.js'); out.academy = await runAcademyJob(sql, {budgetMs: 7000, hourSantiago}) }`. Alias `?job=academy` (same secret check, constant-time compare) runs only the academy step (`force` via `&force=1`).

## 11. PWA, SW, push (BE-CHAT for sw.js/src/push.js; FE-CORE for manifest via FE-PANEL)
- `public/sw.js` `notificationclick`: target url from payload (default `/panel` as today); validate `^/[A-Za-z0-9/_\-?=&%.]*$` (no `//`); prefer a window whose pathname starts with the target's first segment (`/panel` vs `/academy`), else any same-origin window; `postMessage({type:'ps-navigate', url})` + focus; else `openWindow(url)`. Panel pushes must behave exactly as today.
- `src/push.js`: export `getOrCreateSubscription()`; `disablePush()` deletes the barber server row and only calls `sub.unsubscribe()` if `localStorage.ps_academy_push_enabled !== '1'`. Academy client `src/academy/push.js` (FE-CHAT): `enableAcademyPush()`, `disableAcademyPush()` (server delete only; unsubscribe only if no barber push enabled key `ps_push_enabled_*`), `syncAcademyPush()` on app open; key `ps_academy_push_enabled='1'`.
- `ps-navigate` listener: FE-CORE adds an app-level listener in `AcademyApp` (navigates within the academy).
- `buildWatch.js` (FE-CORE): do not reload when `document.querySelector('[data-hold-reload]')` exists, when `document.activeElement?.tagName === 'IFRAME'`, or when a `.pn-sheet-root` is open.

## 12. CSP & headers (FE-CORE, `vercel.json`)
- Add rewrite `{ "source": "/api/academy", "destination": "/api/services?scope=academy" }` **before** `/api/(.*)`.
- Split headers: (1) global non-CSP security headers `/(.*)`; (2) current CSP for `/((?!academy/).*)` with `frame-src` + `https://www.youtube-nocookie.com`, `img-src` + `https://i.ytimg.com`; (3) strict CSP for `/academy/(.*)`: `default-src 'self'; script-src 'self' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://i.ytimg.com https://lh3.googleusercontent.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://va.vercel-scripts.com; frame-src https://www.youtube-nocookie.com; worker-src 'self'; manifest-src 'self'; media-src 'self' blob:; frame-ancestors 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests`.
- Move `index.html` inline scripts to `public/boot.js` (theme, synchronous in head) and `public/pixel.js` (Meta Pixel; returns early when `location.pathname` starts with `/academy/`). Keep behavior identical otherwise. Align background colors with ThemeProvider.

## 13. Dev mock (MOCK) — `VITE_DEV_MOCKS=1 npm run dev` / launch config `dev-mock`
- Vite plugin (`apply:'serve'`, only when env set) middleware for `/api/academy`, `/api/checkout` (only `kind:'course'` POST and `?ref=aca-` GET; else `next()`), `/api/mp-webhook` (next), minimal `/api/auth-barber` (POST login any user + 8+ char password → barber admin token `mockb.<id>.<ts>`; GET `?me=1`), `/api/__mock/*` (reset, state, outbox, login-as?member=ID → `{token, member}`, mp?ref&status=approved|refunded).
- Member tokens `mockm.<memberId>.<ts>`; barber tokens `mockb.*` or `dev-token` are barber admin; `owner-session` works with barber token.
- Implements **every mode in §5 with identical shapes and status codes**, enforcing the same visibility/role rules (IDOR-testable), in-memory state from fixtures: owner "Bruno Herrera" (propietario, handle bruno-herrera-1), 1 admin, 1 moderator, ~25 members across levels (seed likes so leaderboards have data), 3 cohorts with chats and messages, DMs, 9 courses from `src/data/courses.js` + Método Brunetti (lessons with public embeddable YouTube ids e.g. `dQw4w9WgXcQ`, `M7lc1UVf-VE`, `aqz-KE-bpKQ`, `ScMzIvxBSi4`; one course level-locked, one owned-by-purchase, drafts), categories, ~30 posts (poll, images from `/assets/estilo/*.jpg`, pinned), comments 2 levels, notifications, weekly "Q&A con Bruno" + one-off events, about media, orders.
- Checkout mock: POST returns `{ok, ref, initPoint:'/academy/gracias?ref=<ref>&mock=1'}` and immediately provisions (member, grant, cohort, outbox entry with temp password logged to console). GET `?ref=` → `{status:'pagada', emailMasked}`.
- Knobs: `DEV_MOCK_DELAY` ms, `DEV_MOCK_FAIL=mode1,mode2` (500), `DEV_MOCK_BOTS=1` (a fixture member replies 8 s after you send in an open chat; new post every 2 min).
- Pure logic shared from `src/academy/{levels,url,youtube}.js`.

## 14. Tests (TEST) — `npm run test:academy`
`scripts/test-academy/run.mjs` with `@electric-sql/pglite` (in-memory Postgres). Adapter `makeSql(pglite)` implementing the neon tagged-template interface (`sql\`…\`` → thenable with `.text/.params`; `sql.transaction([...])`; `sql(text, params)`). Stub `barbers`/`users`/`notifications`/`rate_limits`/`login_attempts` tables. Env `PS_SESSION_SECRET` test value. Inject fakes for MP (`fetchPayment`, `searchPayments`, `createPreference`) and Resend (`fetch` mock) — BE modules must allow injection via a module-level `__setTestDeps({...})` hook exported from `_academyProvision.js` and `_academyEmail.js` (no-op in prod). Cases: schema creates cleanly twice; login/lockout/pwc flow; token separation (member token → `readSession` null; barber token → `readMemberToken` null; legacy barber token still valid); checkout → webhook approved → member+grant+credentials once; duplicate concurrent webhook; retry after crash between steps; refund before/after approval; re-buy after refund; expelled email; invited member later pays; claimAndSendCredentials with 429; lesson visibility (locked course hides videoId); IDOR (member A reading B's DM chat → 404; cohort-private category post invisible); poll vote; like counter & points; leaderboard exclusions; events weekly expansion across DST (2026-09-06 Chile DST change); XSS: `javascript:` link saved as text/null.

## 15. Deviations log
(Agents append here via their final report; the orchestrator merges.)

## 16. Cross-module exports (exact names — implement/consume exactly these)

| Export | File (owner) | Signature / contract |
|---|---|---|
| `handleAcademy(req,res)` | `_academy.js` (BE-CORE) | router; **calls `ensureAcademyTables(sql)` itself** before any `admin`/`mod`/`owner` mode and before `me` — handlers never call it |
| `HttpError`, `LEVEL_THRESHOLDS`, `levelFor`, `memberMini`, `pointsFor`, `getSettings`, `invalidateSettings`, `isStaffRole`, `memberCohortIds(sql, memberId) → int[]`, `publicMemberRows(sql, ids, viewer) → Map(id→MemberPublic)` | `_academyHttp.js` (BE-CORE) | see §4.2–4.3 |
| `safeUrl`, `isBlobUrl`, `isImageUrl`, `parseYouTubeId`, `cleanText`, `slugify`, `esc`, `csvCell`, `extractMentions(text) → handle[]` | `_academyText.js` (BE-CORE) | pure |
| `ensureAcademyTables`, `presentTables` | `_academySchema.js` (BE-CORE) | §2 |
| `requireMember`, `requireAcademyAdmin`, `requireModerator`, `touchSeen`, `loadMe(sql, memberId) → Me` | `_academyAuth.js` (BE-CORE) | §3.4, §4.3 |
| `sendAcademyEmail(sql, kind, sendFn, args, {critical=false}) → {ok, status, reason, skipped?}` , `__setTestDeps({fetch})` | `_academyEmail.js` (BE-CORE) | §8.2 |
| `createMemberSession`, `readMemberToken`, `hasMemberBearer` | `_auth.js` (BE-CORE) | §3.1 |
| `hashPasswordAsync`, `verifyPasswordAsync`, `dummyVerifyAsync`, `generateTempPassword`, `canonicalTemp`, `isValidMemberPassword` | `_password.js` (BE-CORE) | §3.2 |
| `sendAcademyAccessEmail`, `sendAcademyAlreadyEmail`, `sendAcademyResetEmail`, `sendAcademyEmailChangeEmail`, `sendAcademyEmailChangedNotice`, `sendAcademyActivityEmail`, `sendAcademyEventReminderEmail` | `_email.js` (BE-CORE) | §8.2; each returns `{ok,status,reason}` |
| `canAccessCourse(sql, member, courseRow) → {ok, reason}`, `canAccessLesson(sql, member, lessonId) → boolean`, `accessibleCourseIds(sql, member) → int[]` | `_academyCourses.js` (BE-COURSES) | §5.2 |
| `notify`, `notifyMany`, `notificationText`, `routeFor` | `_academyNotify.js` (BE-COMMUNITY) | §5.3 |
| `pushToMembers(sql, memberIds, {title, body, url, tag})` | `_academyPush.js` (BE-CHAT) | never throws |
| `getWebPush`, `sendToSubscriptions(rows, payload, onGone)` | `_webpush.js` (BE-CHAT) | no project imports |
| `ensureCohortChat(sql, cohortId) → chatId`, `addToCohort(sql, cohortId, memberIds)`, `startDm(sql, fromId, toId) → chatId`, `postSystemDm(sql, fromMemberId, toMemberId, body)` | `_academyChat.js` (BE-CHAT) | used by BE-PAY (cohort on purchase, AutoDM) |
| `expandOccurrences(eventRow, fromDate, toDate) → [{occurrenceStart: Date}]`, `canSeeEvent(member, eventRow, {level, cohortIds})` | `_academyEvents.js` (BE-EVENTS) | pure-ish |
| `runAcademyJob(sql, {budgetMs, hourSantiago, force})` | `_academyCron.js` (BE-EVENTS) | §10 |
| `handleCourseCheckout(sql, req, res)`, `handleCourseStatus(sql, req, res)`, `handleAcademyPayment(sql, payment, paymentId, res)`, `claimAndSendCredentials(sql, memberId, {course})`, `reconcileAcademyOrders(sql, {limit, budgetMs})`, `reconcileOrder(sql, ref)`, `revokeGrant(sql, grantId, reason, actor)`, `provisionManualGrant(sql, {name, email, courseIds, cohortId, source, externalRef, actor}) → {member, created, credentials}`, `__setTestDeps({mp, email})` | `_academyProvision.js` (BE-PAY) | §6 |
| `searchPayments(externalReference)` + `createPreference({…, payer, metadata, statementDescriptor})` | `_mercadopago.js` (BE-PAY) | §6.8 |

**Router MODE_OWNERS (BE-CORE builds this from §5; module files must export `handlers` with exactly these keys):**
- `_academyAccount.js`: login, password-change, password-reset-request, password-reset-confirm, me, me-update, email-change, email-change-confirm, logout-all, me-export, me-delete, about, owner-session, idle
- `_academyCourses.js`: courses, course, lesson, lesson-progress, catalog, admin-courses, admin-course-save, admin-course-delete, admin-section-save, admin-section-delete, admin-lesson-save, admin-lesson-delete, admin-reorder, admin-seed, upload
- `_academyCommunity.js`: feed, post, post-save, post-delete, comment-save, comment-delete, lesson-comments, like, poll-vote, follow, report, members, member, leaderboard, search, group-card, admin-category-save, admin-category-delete, admin-pin, admin-post-moderate, admin-reports, admin-report-resolve
- `_academyNotify.js`: notifications, notifications-read
- `_academyChat.js`: chats, chat, chat-start, chat-send, chat-read, chats-read-all, chat-mute, chat-mark-unread, block, blocks, sync, push-subscribe, push-unsubscribe, cohorts, cohort, file, admin-cohort-save, admin-cohort-members, admin-cohort-archive
- `_academyEvents.js`: events, event, admin-event-save, admin-event-delete
- `_academyAdmin.js`: admin-members, admin-invite, admin-member-update, admin-resend-access, admin-password-link, admin-grant, admin-revoke, admin-orders, admin-verify-order, admin-import-grant, admin-settings (GET+POST), admin-stats

Auth per mode = the "auth" column in §5 tables (`pwc` = member with `allowPwc`). `admin-settings` accepts GET and POST.

**Mock state shape**: `state.<table_name>` = array of rows whose keys are exactly the DDL column names (snake_case), plus `state.seq.<table_name>` counters, `state.outbox = []`. Handlers return the same camelCase API shapes as the real backend.
