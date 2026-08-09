# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

```bash
npm install              # Install dependencies
npm run dev              # Start Vite dev server (http://localhost:5173)
npm run build            # Build for production (outputs to dist/)
npm run preview          # Serve the production build locally
```

> **Note:** `npm run dev` runs Vite only — serverless API functions are NOT available locally. The app falls back to `localStorage` + demo data. For testing backend endpoints, use `npx vercel dev` (requires `.env.local` with DATABASE_URL and PS_SESSION_SECRET).

## Project Overview

**Brunetti** is a barber shop web platform with public booking interface and internal barber dashboard.

- **Frontend:** React 18 + React Router v6 + Vite (ES modules)
- **Backend:** Vercel serverless functions (Node.js) in `/api` folder
- **Database:** Neon PostgreSQL (serverless)
- **Auth:** HMAC-signed session tokens (no session database)
- **PWA:** Web Push notifications, installable on mobile

### Architecture

#### Frontend (React)

**Entry point:** `src/main.jsx` → `src/App.jsx` sets up routing with code-split lazy routes.

**Pages (lazy-loaded):**
- `Home` — Landing page (loaded eagerly, no splitting)
- `Booking` — Public booking flow
- `Login` — Account/history view for clients
- `BarberLogin` — Barber authentication
- `Dashboard` — Barber panel (reservations, expenses, analytics)
- `Workshop`, `Cursos`, `EncuentraEstilo` — Marketing pages

**Components:** Organized by function (UI primitives in `ui.jsx`, page-specific in respective folders). Tailwind + custom CSS (`src/styles/`).

**State management:** Lightweight Zustand-like stores (`bookingsStore.js`, `enrollmentsStore.js`) for local client state. No global Redux.

**Styling:** Tailwind CSS with PostCSS. Base styles in `src/styles/pimp.css` (reusable), page-specific in `brunetti.css`, `workshop.css`, etc.

#### Backend (Vercel Functions)

Each file in `/api` exports a default handler: `async function handler(req, res)`.

**Authentication:** `_auth.js` exports:
- `createSession(barber)` — signs a JWT-like token (base64url payload + HMAC-SHA256)
- `readSession(req)` — validates token from `Authorization: Bearer <token>` header
- `requireInternal(req, res, {admin?})` — middleware; returns null + 401/403 if not authenticated

**Key endpoints:**
- `/api/auth-login.js` — Barber login (phone + password validation)
- `/api/auth-barber.js` — Barber authentication checks
- `/api/bookings.js` — CRUD for reservations (with graceful demo fallback)
- `/api/services.js` — Menu items
- `/api/clients.js` — Customer registry (barber view)
- `/api/expenses.js` — Finance tracking
- `/api/flow-payments.js` — Unified payment checkout + webhook handler
- `/api/push.js` — Web Push notifications
- `/api/_email.js` — Booking confirmation email to clients (Resend REST API, no SDK)
- `/api/_notion.js` — Syncs bookings to a Notion database (REST API, no SDK) so they show up in Notion Calendar
- `/api/availability.js` — Barber time slots

**Graceful degradation:** All endpoints return demo data on database errors so the app remains usable offline.

#### Database (PostgreSQL)

Schema in `db/schema.sql`:
- `users` — Clients (phone, name, email)
- `barbers` — Staff (id, code, password_hash, rating, tier)
- `services` — Menu (name, price, duration, category)
- `bookings` — Reservations (client_id, barber_id, service_id, date, time, status)
- `availability_blocks` — Barber unavailability (time off)
- `expenses` — Finance tracking
- `barber_permissions` — Role-based access (finance, team management, etc.)
- `push_subscriptions` — Web Push endpoints per barber

Seed data in `db/seed.sql` (optional; most tables auto-create on first use).

### Build & Deployment

**Vite config** (`vite.config.js`):
- Vendor splitting: React + React Router cached separately (`react-vendor` chunk)
- Custom Flow mock middleware for local dev (intercepts `/api/flow-payments` POST in dev mode)
- Chunk size warning raised to 700KB (minified CSS is large)

**Vercel config** (`vercel.json`):
- SPA routing: all non-asset requests → `/index.html`
- Strict security headers (X-Frame-Options, CSP via Permissions-Policy, etc.)
- Aggressive caching for assets (immutable, 1-year max-age)
- Images cached for 1 hour + must-revalidate

**Environment variables** (`.env.local` or Vercel settings):
- `DATABASE_URL` — Neon connection string (required in prod)
- `PS_SESSION_SECRET` — ≥16 char key for HMAC signing (required in prod; if missing, system fails closed — no sessions accepted)
- `FLOW_API_KEY`, `FLOW_SECRET_KEY` — Flow API credentials for payment sessions
- `FLOW_ENV` — set to `production` to use Flow's live API; defaults to sandbox
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Web Push keys
- `VITE_VAPID_PUBLIC_KEY` — Public VAPID key exposed to frontend
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob (optional backup storage)
- `RESEND_API_KEY`, `RESEND_FROM` — Resend email API for booking confirmations (optional; skipped if missing)
- `NOTION_API_KEY`, `NOTION_DATABASE_ID` — Syncs bookings to Notion so they appear in Notion Calendar (optional; skipped if missing)
- `CRON_SECRET` — Bearer token required by `/api/cron-reminders` if set (optional but recommended when triggering the cron from outside Vercel)
- `BARBER_PASSWORDS` — JSON fallback: `{code: sha256_hex}` if DB is down

## Patterns & Conventions

### API Error Handling

Always respond with JSON:
```js
res.status(400).json({ error: "message" })
res.status(401).json({ ok: false, error: "..." })
res.json({ ok: true, data: ... })
```

Errors are caught with try/catch; if database is unavailable, return demo data instead of throwing. This keeps the app usable offline.

### Frontend Data Flow

- Fetch functions live near their usage (in component files or in `src/data.js` for shared constants)
- Error handling: show UI fallback or localStorage cache, do NOT block the page
- For internal dashboard (barber), require valid session token in `Authorization` header

### Session Management

Sessions are cryptographically signed, stateless tokens (no DB lookup):
1. Barber logs in → `auth-login` creates token via `createSession()`
2. Token stored in `localStorage` as `ps_barber`
3. Each protected request sends `Authorization: Bearer <token>`
4. Server validates via `readSession()` — no session table, just HMAC verification
5. If `PS_SESSION_SECRET` is missing/weak in production, all tokens are rejected (fail-closed)

### PWA & Standalone Mode

iOS "Add to Home Screen" often ignores manifest `start_url` and instead launches the last-viewed page. The app detects this with `isStandaloneLaunch()` in `App.jsx` and redirects:
- If barber session exists → `/panel` (dashboard)
- Otherwise → `/ingreso` (login)

This only happens once per app session (sessionStorage flag).

### Flow Integration

**Checkout flow:**
1. Frontend posts to `/api/flow-payments` with `{amount, email, name, phone}`
2. API signs the request (HMAC-SHA256 with `FLOW_SECRET_KEY`) and calls Flow's `/payment/create`, returns `{sessionUrl, token}`
3. Frontend does a full-page redirect to `sessionUrl` (Flow hosted checkout — supports Webpay, tarjetas, transferencia y billeteras como Mach/Chek según lo habilitado en la cuenta comercial)
4. Flow sends the user's browser back to `urlReturn` (`/api/flow-payments?return=1`), which 302-redirects to `/cursos?flow_token=...` so the SPA can show a status message
5. Independently, Flow POSTs server-to-server to `urlConfirmation` (`/api/flow-payments?webhook=1`); the handler calls `/payment/getStatus` to verify the real status before saving the enrollment (never trusts the return redirect alone)
6. `GET /api/flow-payments?status=1&token=...` is a read-only status check used by the frontend after the return redirect — it does not write to the DB

In dev mode (`npm run dev`), Flow requests are mocked by Vite middleware (see `vite.config.js`).

### Notion Calendar Sync & Reminders

**Sync flow:**
1. Every booking created or updated in `/api/bookings.js` (client-facing and panel-manual) calls `syncBookingToNotion(...)` in `api/_notion.js`, which creates a page in the configured Notion database via the REST API (no SDK)
2. The target database ("Reservas Brunetti") was created by hand in the Notion UI and its properties don't match an ideal schema — `api/_notion.js` adapts to what actually exists rather than requiring more manual changes: `Nombre` (title — Spanish-locale default name, not "Name"), `Fecha` (date), `servicio`/`teléfono` (lowercase rich_text/phone_number), `Barbero` (rich_text), `Precio` (rich_text, not number — formatted as CLP text), `Estado` (Notion's **Status** type with 3 fixed stages — "Sin empezar"/"En curso"/"Listo" — not a free-form Select, mapped via `mapStatusToStage()`), and `Cliente` (type **People**, which can't hold arbitrary text — the client's name is NOT written there; it only appears in the page title alongside the service name)
3. The created page ID is stored in `bookings.notion_page_id`. Status changes (PATCH) map to one of the 3 Status stages via `updateNotionBookingStatus(...)`; cancellations (DELETE) **archive** the Notion page instead of setting a status, since "cancelada" doesn't fit any of the 3 fixed stages — this also makes cancelled bookings disappear from the calendar view, which is arguably the correct behavior anyway
4. To see these events in the Notion Calendar app, the Notion database must be added as a calendar source from within Notion Calendar itself (Settings → Notion databases) — this is a one-time manual step, not something the API can do

**Reminder limitation (important):** Notion's API has no reminder/notification field at all (the `date` property object is empty), and Notion's own UI-based reminders for database Date properties only offer day-level presets (same day, 1 day before, 1 week before) — there is no way, via API or UI, to get a Notion-database-backed calendar entry to notify at a specific number of minutes/hours before. A "1 hour before" alert is therefore handled entirely outside Notion: `GET /api/push?job=reminders` (in `api/push.js`, alongside the existing Web Push subscription handling) sends a Web Push notification via `notifyBarber` to the assigned barber when a booking is between 60 and 105 minutes away (window widened to survive the 40-minute gap between cron ticks — see below — while still guaranteeing at least 1 hour of notice), tracked via the `reminder_60_sent` column so it fires once. There used to also be a 15-minutes-before reminder (`reminder_15_sent`, still present as an unused column in `db/schema.sql`), but it was dropped: once the cron interval grew to 40 minutes, the window needed to reliably catch it (≥40 min wide) would have made "15 minutes" inaccurate by up to the same margin, defeating the point. This lives inside `push.js` instead of its own file because Vercel's Hobby plan caps a deployment at 12 Serverless Functions — the project is already at that cap, so anything cron-related has to fold into an existing endpoint rather than add a new one.

**Trigger (cron-job.org, not Vercel Cron):** this project is on Vercel's Hobby plan, which only runs `vercel.json`-declared cron jobs once a day (a `*/5 * * * *` schedule fails deployment outright on Hobby). So an external [cron-job.org](https://cron-job.org) job hits `GET https://brunetticutz.cl/api/push?job=reminders` every 40 minutes with header `Authorization: Bearer $CRON_SECRET` — lowered from every 5 minutes because the frequent ping was defeating Neon's compute autosuspend and driving up CU-hour billing (the endpoint was essentially kept awake around the clock even with near-zero real traffic).

## Common Tasks

### Run dev server
```bash
npm run dev
```

### Build for production
```bash
npm run build
# Output: dist/
```

### Test backend locally (requires Vercel CLI)
```bash
npx vercel dev
# Starts Vite + serverless functions on localhost:3000
```

### Database schema setup (after cloning)
```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/seed.sql  # optional
```

### Generate secure session secret
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Generate Web Push keys
```bash
npx web-push generate-vapid-keys
```

### Deploy to production
```bash
git push origin main  # Vercel is connected to this repo (main branch): pushing auto-deploys to brunetticutz.cl
```
No `desarrollo`/staging branch — `main` is the only branch. A manual `npx vercel --prod --yes` still works as a fallback if a deploy needs to be redone without a new commit.

## Key Files to Know

| Path | Purpose |
|------|---------|
| `src/App.jsx` | Route definitions, PWA launch detection |
| `src/main.jsx` | React DOM render |
| `src/data.js` | Static data (services, constants) |
| `api/_auth.js` | Session creation/validation |
| `db/schema.sql` | Database table definitions |
| `vite.config.js` | Vite build config + Flow mock |
| `vercel.json` | Deployment routing, headers, caching |
| `.env.example` | Required environment variables |

## Deployment Checklist

Before pushing to `main`:
1. Verify `PS_SESSION_SECRET` is set in Vercel (≥16 chars)
2. Verify `DATABASE_URL` is accessible and schema is initialized
3. If using Flow, verify `FLOW_API_KEY` and `FLOW_SECRET_KEY` are set
4. Run `npm run build` locally and test with `npm run preview`
5. `git push origin main` — Vercel auto-deploys straight to production (`brunetticutz.cl`). There is no staging branch, so anything pushed to `main` goes live immediately.

## Visual Editor (dev-only)

`npm run edit` launches Vite + a zero-dep save server (`scripts/content-server.mjs`, port 4101)
and enables an in-browser visual editor. The floating **✎ Editar** button (bottom-right, with a
server-status dot) toggles edit mode. Two independent layers:

- **Content (text):** `EditableText` / `Editable` wrap a string bound to `file`+`path` in
  `src/data/content/*.json`. Editing inline saves via `POST /save` → writes the JSON. Text is edited
  in place (contentEditable).
- **Overrides (layout/style/image):** every editable element carries a stable `editId`
  (`"<file>:<path>"`). Clicking it selects it and opens the **Inspector** popup with tools:
  **Mover** (offset drag/nudge 6px/X-Y, plus *Desanclar* → free absolute position; moved elements
  get `z-index:50` so they overlap on top without reflowing neighbors), **Fuente** (font-size,
  alignment, and **color** — picker + quick swatches — text only), **Imagen** (width/height, replace
  via upload or pick an existing asset). Each change is stored per-`editId` in
  `src/data/overrides/<file>.json` via
  `POST /save-override`, and image uploads go to `public/assets/uploads/` via `POST /upload-image`.

Key files: `src/components/edit/` → `context.js` (shared contexts), `OverridesProvider.jsx`
(always-on layer that loads `src/data/overrides/*.json` via `import.meta.glob` and applies them),
`Editable.jsx` (the primitive), `EditProvider.jsx` (dev-only UI: bar, selection overlay, Inspector),
`useDragResize.js`. Mounted in `App.jsx` as `<OverridesProvider><EditProvider>…`.

**Production:** overrides ship (the JSON is inlined into the build and applied by
`OverridesProvider` in prod, same as text content). The editor UI lives behind
`import.meta.env.DEV` and is tree-shaken out of the production bundle.

**Coverage:** all `EditableText` usages are editable everywhere (text move/font/color/position come
for free). Fixed editorial images are tagged with `<Editable as="img" editId="<page>:<name>" …/>`:
Home (`home-hero:cutout`, `home-hero:bg`, `home-sobre:figure`, `home-estilo:teaserBg`,
`home-cursos:teaserBg`, `home:compareBefore/After`), Cursos (`cursos:heroCutout`, `cursos:heroBg`),
Encuentra tu estilo (`estilo-hero:<i>`, `estilo:ctaBg`), Workshop (`workshop:hero`, `workshop:logo`,
`workshop:pricingBg`). Data-driven galleries/thumbnails (mapped `SmartImg` grids, recommendation
cards, testimonial photos) are intentionally NOT tagged — their images come from data files
(`src/data/*.js`), so edit those, not per-item overrides. To tag a new fixed image, wrap its `<img>`
in `<Editable as="img" editId="…" …/>`. The native iOS app cannot be edited by this web tool.

## Native iOS App

`ios/BrunettiCutz/` is a native SwiftUI companion app (barber dashboard client), separate from the web PWA above. It talks to the same `/api` backend.

- `BrunettiCutzApp.swift` — app entry point
- `APIClient.swift` — HTTP client hitting the Vercel `/api` endpoints (uses the same `Authorization: Bearer <token>` session scheme as the web app)
- `SessionStore.swift` / `KeychainStore.swift` — session token persisted in the iOS Keychain (vs. `localStorage` on web)
- `DashboardModel.swift` / `DashboardView.swift` / `ModuleViews.swift` / `DetailSheets.swift` — dashboard state and views, mirroring `src/pages/Dashboard.jsx`
- `DesignSystem.swift` — shared colors/typography for the native UI
- `BrunettiAppIntents.swift` — App Intents (Siri/Shortcuts) integration
- `DemoData.swift` — offline/demo fallback data, mirroring the web app's graceful-degradation pattern

Note: graphify cannot parse Swift (no tree-sitter grammar available), so this directory is invisible to `graphify query`/`explain`/`path` — use `Read`/`grep` directly for iOS code.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
