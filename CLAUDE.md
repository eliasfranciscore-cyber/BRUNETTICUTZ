# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

```bash
npm install              # Install dependencies
npm run dev              # Start Vite dev server (http://localhost:5173)
npm run build            # Build for production (outputs to dist/)
npm run preview          # Serve the production build locally
```

> **Note:** `npm run dev` runs Vite only — serverless API functions are NOT available locally. The app falls back to `localStorage` + demo data. For a full backend without touching production data, run `VITE_DEV_MOCKS=1 npm run dev` (or the `dev-mock` launch config) — see [Dev mock](#dev-mock-vite_dev_mocks1) below. `.env.local` holds **production** secrets (Neon prod, Mercado Pago, Resend, Notion, the PimpStudio bridge secret) — never run `npx vercel dev` or the `vercel-dev` launch config against it casually; it hits the real backend.

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
- `BarberLogin` — Barber authentication (now with "¿Olvidaste tu contraseña?")
- `ResetPassword` — `/restablecer`, password reset by email (`FEATURES.passwordReset`)
- `Review` — `/resena`, public post-visit rating (`FEATURES.reviews`)
- `Dashboard` — Barber panel shell (`src/pages/Dashboard.jsx`); most tabs live in `src/pages/panel/*.jsx` — see [Panel architecture](#panel-architecture)
- `Essentials`, `EssentialsGracias` — Essentials store and its own Mercado Pago return page (`/essentials/gracias`)
- `Workshop`, `Cursos`, `EncuentraEstilo` — Marketing pages

**Components:** Organized by function (UI primitives in `ui.jsx`, page-specific in respective folders, panel kit in `src/components/panel/`). Tailwind + custom CSS (`src/styles/`).

**State management:** Lightweight Zustand-like stores (`bookingsStore.js`, `enrollmentsStore.js`) for local client state. No global Redux.

**Styling:** Tailwind CSS with PostCSS. Base design-system tokens and public-site styles in `src/styles/pimp.css`, panel-specific extras in `modules.css`, page-specific in `brunetti.css`, `workshop.css`, etc. The panel's own design system is `src/styles/panel.css` + `src/styles/panel/*.css` — see [Panel architecture](#panel-architecture).

#### Backend (Vercel Functions)

Each file in `/api` exports a default handler: `async function handler(req, res)`.

**Authentication:** `_auth.js` exports:
- `createSession(barber)` — signs a JWT-like token (base64url payload + HMAC-SHA256)
- `readSession(req)` — validates token from `Authorization: Bearer <token>` header
- `requireInternal(req, res, {admin?})` — middleware; returns null + 401/403 if not authenticated

**Key endpoints (11 of 12 Serverless Functions — Vercel Hobby plan caps a deployment at 12; see "Cupo de funciones" below):**
- `/api/auth-login.js` — Barber login (phone + password validation)
- `/api/auth-barber.js` — Barber login, `?me=1` profile refresh, account update (name/email/password), password reset request/confirm, DB-backed lockout — see [Auth](#auth)
- `/api/bookings.js` — CRUD for reservations plus panel-only modes (`unclosed`, `cash`, `sales`, `sale`) and the PimpStudio bridge modes (`bridge-completed`, `bridge-manual`) — see [Booking modes](#booking-modes-apibookingsjs)
- `/api/services.js` — Menu items (featured, single-day, loyalty-eligible flags)
- `/api/clients.js` — Customer registry (barber view), `?mode=register` (folded-in `register-client`, see `vercel.json` rewrite below), wallet/loyalty bridge modes, bridge modes for PimpStudio
- `/api/expenses.js` — Finance tracking, `?kind=all|gasto|ingreso` (default `gasto`, for iOS backward compat)
- `/api/barbers.js` — Barber CRUD plus `?mode=me|settings|shop-settings|reviews|review` — see [Barbers modes](#barbers-modes-apibarbersjs)
- `/api/mp-payments.js` — Mercado Pago Checkout Pro: checkout + webhook handler (Cursos, Workshop, Essentials) — see [Mercado Pago Integration](#mercado-pago-integration)
- `/api/push.js` — Web Push subscriptions, `?job=reminders` (1h reminders + auto-complete), `?job=csp-report` (in-memory rate-limited CSP report sink), `{action:'test'}` (real test push from the panel)
- `/api/availability.js` — Barber time slots
- `/api/enrollments.js` — Cursos/Workshop lead capture (free waitlist path; paid path goes through `mp-payments.js`)
- `/api/_auth.js` — Session creation/validation (HMAC, see [Session Management](#session-management))
- `/api/_password.js` — PBKDF2 hashing/verification (with legacy SHA-256 fallback) and reset-token generation
- `/api/_rateLimit.js` — In-memory + DB-backed rate limiting (`login_attempts` table for the login lockout)
- `/api/_bridge.js` — `isBridgeRequest()` (constant-time secret check) and `normalizePhone()`, shared by every PimpStudio bridge mode; deliberately import-free from the rest of the project to avoid cycles
- `/api/_schema.js` — Additive, `information_schema`-checked migrations (`ensure*` functions) — see [Migrations](#migrations)
- `/api/_money.js` — The no-commission money model (`readPayment`, `onlineSales`) — see [Money model](#money-model-no-commission)
- `/api/_products.js` — Essentials inventory ledger (stock, moves, drift/reconcile) — see [Inventory](#inventory)
- `/api/_bookingLife.js` — The single loyalty writer, plus review-row creation and the auto-completer — see [Loyalty: single writer](#loyalty-single-writer)
- `/api/_bookingAudit.js` — Logs rejected/errored booking attempts (surfaced via `?issues=1`)
- `/api/_email.js` — Transactional email to clients (Resend REST API, no SDK): booking confirmation, reschedule notice, review-thanks
- `/api/_notion.js` — Syncs bookings to a Notion database (REST API, no SDK) so they show up in Notion Calendar
- `/api/_loyaltyBridge.js` — Calls PimpStudio's `bridge-*` loyalty/Wallet modes, best-effort

**Graceful degradation, corrected:** this is narrower than it sounds. A **public, unauthenticated** GET (no session, e.g. the client booking flow with no phone yet) still falls back to demo data on a database error, so a dropped connection never blank-pages a visitor. But a **session-authenticated** GET (the panel) now returns a plain `500 {ok:false, error:"..."}` on a DB error instead — the barber sees an error banner, never demo rows they could accidentally act on (cancel, charge, etc.). The **PimpStudio bridge** modes never fall back to demo either way: a bad/missing `X-Bridge-Secret` is a `404 {ok:false, error:"No encontrado"}` (indistinguishable from the mode not existing), and a real error is a `500` — inventing a client list or a fake `{ok:true}` booking would make PimpStudio believe fabricated data was real.

#### Database (PostgreSQL)

Schema in `db/schema.sql`:
- `users` — Clients (phone, name, email, `profession`)
- `barbers` — Staff (id, code, `password_hash TEXT` — PBKDF2 now, legacy SHA-256 still verified —, `email`, rating, tier)
- `services` — Menu (name, price, duration, category, `featured`, `only_on_date`, `loyalty_eligible`)
- `bookings` — Reservations (client_id, barber_id, service_id, date, time, status) plus the money/lifecycle columns from the no-commission model: `no_show`, `started_at`, `auto_completed_at`, `completed_at`, `redeem_state`, `price_snapshot`, `paid_amount`, `payment_method`, `payment_ref`, `paid_at`, `charged_by` — see [Money model](#money-model-no-commission)
- `availability_blocks` — Barber unavailability (time off)
- `expenses` — Finance tracking (`kind`: `gasto` | `ingreso`)
- `push_subscriptions` — Web Push endpoints per barber
- `enrollments` — Cursos/Workshop signups (paid via Mercado Pago webhook, or manual lead capture)
- `shop_orders` — Essentials paid orders (Mercado Pago webhook), item snapshot in `items` JSONB, `paid_at`
- `products` — Essentials catalog (barber-managed via panel), plus `archived_at`, `sku`, `cost` — see [Inventory](#inventory)
- `product_sales` / `product_sale_items` / `product_stock_moves` — Mesón sale records and the stock ledger (history only; `products.stock` stays the source of truth)
- `barber_reviews` — Post-visit ratings (`/resena`), one row per booking (`UNIQUE(booking_id)`)
- `settings` — Generic `key TEXT PRIMARY KEY, value TEXT` store used by `panel:*` keys (auto-complete toggle, business info, budgets, per-barber prefs) and by `mp-payments.js`'s own keys (Cursos/Workshop price+date+pause)
- `password_resets` / `login_attempts` — Password-reset tokens (hashed, 30 min TTL) and the login lockout counter

`barber_permissions` (role-based access for a multi-barber team) was not ported — this project is one barber (Bruno) and doesn't need it; see "No se porta" in the port's own planning notes if you're wondering why it's gone.

Migrations are **not** a manual pre-deploy step — see [Migrations](#migrations). `db/schema.sql` stays the canonical reference, but `api/_schema.js`'s `ensure*` functions apply the same columns/tables automatically, additively, from the running code.

Seed data in `db/seed.sql` (optional; most tables auto-create on first use).

### Build & Deployment

**Vite config** (`vite.config.js`):
- Vendor splitting: React + React Router cached separately (`react-vendor` chunk)
- Custom Mercado Pago mock middleware for local dev (intercepts `/api/mp-payments` POST in dev mode)
- `VITE_DEV_MOCKS=1` registers a second plugin, `scripts/dev-mock/index.mjs` (`apply: 'serve'`, Node-only import — never reaches the production bundle) that answers all of `/api/*` from in-memory fixtures — see [Dev mock](#dev-mock-vite_dev_mocks1)
- Chunk size warning raised to 700KB (minified CSS is large)

**Vercel config** (`vercel.json`):
- Rewrites: SPA fallback (all non-asset requests → `/index.html`), `/api/register-client` → `/api/clients?mode=register` (keeps the function count at 11/12 while iOS keeps calling the old path), `/api/csp-report` → `/api/push?job=csp-report`
- Security headers: X-Frame-Options, `Strict-Transport-Security` (`max-age` only — **no** `preload`/`includeSubDomains`, both deliberate), `Content-Security-Policy-Report-Only` (not enforcing yet) with `report-uri /api/csp-report`
- `index.html` served with `Cache-Control: no-store` (the PWA never trusts a cached shell — see `buildWatch.js` under [PWA](#pwa--standalone-mode)); `/assets/*` stay aggressively cached (immutable, 1-year max-age for JS/CSS/fonts; 1 hour + must-revalidate for images)

**Environment variables** (`.env.local` or Vercel settings):
- `DATABASE_URL` — Neon connection string (required in prod)
- `PS_SESSION_SECRET` — ≥16 char key for HMAC signing (required in prod; if missing, system fails closed — no sessions accepted)
- `MP_ACCESS_TOKEN` — Mercado Pago Checkout Pro access token for payment sessions (Cursos, Workshop, Essentials). Sandbox vs production is decided by Mercado Pago from the token's own prefix (`TEST-...`) — no separate env var needed
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Web Push keys
- `VITE_VAPID_PUBLIC_KEY` — Public VAPID key exposed to frontend
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob (optional backup storage)
- `RESEND_API_KEY`, `RESEND_FROM` — Resend email API for booking confirmations, reschedule notices and review-thanks (optional; skipped if missing)
- `NOTION_API_KEY`, `NOTION_DATABASE_ID` — Syncs bookings to Notion so they appear in Notion Calendar (optional; skipped if missing)
- `CRON_SECRET` — Bearer token required by `GET /api/push?job=reminders` (and by extension the auto-completer it triggers) if set (optional but recommended when triggering the cron from outside Vercel)
- `BARBER_PASSWORDS` — JSON fallback `{code: hash}` used only when the login-attempt counter can't be read; accepts either a SHA-256 hex digest or a PBKDF2 `pbkdf2$<iter>$<salt>$<hash>` string
- `PASSWORD_REHASH` — `1` re-hashes a barber's password to PBKDF2 on a successful login that verified via the legacy SHA-256 path. **Off by default** until the PBKDF2 rollout has been stable for about a week (an instant rollback to an older build that only understands SHA-256 would otherwise lock everyone out)
- `PASSWORD_RULE` — `legacy` is an escape hatch back to the old, weaker password rule (8-64 letters/numbers, 1 upper, 1 number, no symbols required); anything else (including unset) uses the strong PimpStudio-style rule
- `SITE_URL` — Base URL for the password-reset link emailed to a barber (default `https://brunetticutz.cl`)
- `AUTO_COMPLETE_SANDBOX` — `1` lets the auto-completer run outside `VERCEL_ENV=production` (for local/staging testing only — see [Auto-complete](#auto-complete))
- `PIMPSTUDIO_BRIDGE_SECRET` — Shared secret with PimpStudio's Vercel project for the two-way bridge (agenda, loyalty, Wallet) — see the Puente section

## Patterns & Conventions

### API Error Handling

Always respond with JSON:
```js
res.status(400).json({ error: "message" })
res.status(401).json({ ok: false, error: "..." })
res.json({ ok: true, data: ... })
```

Errors are caught with try/catch. **Not every path falls back to demo data anymore** — see the corrected "Graceful degradation" note above: only public/unauthenticated reads do that; a session-authenticated panel GET returns a real `500` on a DB error, and every PimpStudio bridge mode does too (or `404` for a bad secret). Demo data exists to keep the public site usable offline, not to hide a broken panel from the barber.

### Frontend Data Flow

- Fetch functions live near their usage (in component files or in `src/data.js` for shared constants)
- Error handling: show UI fallback or localStorage cache, do NOT block the page
- For internal dashboard (barber), require valid session token in `Authorization` header

### Panel architecture

The panel was rebuilt with one file per tab instead of a single giant `Dashboard.jsx`:

- **`src/pages/panel/*.jsx`** — one file per tab (`AgendaTab`, `FinanzasTab`, `ClientesTab`, `ServiciosTab`, `EssentialsTab` + `EssentialsSell`, `ConfigTab`, `MarketingTab`, `CajaTab`, `InscripcionesTab`, `PedidosTab`, `SinCerrar`, `BookingDetailSheet`, `FinanceMovementSheet`, plus shared helpers in `shared.jsx`). Not every tab was split out this way — Resumen, Reservas and Gastos still render through the older standalone components (`DashboardResumen.jsx`, `BookingsInbox.jsx`, `ExpensesModule.jsx` in `src/components/`) that `Dashboard.jsx` mounts directly; those were rewritten in place to the new `pn-*` class system rather than moved.
- **`Dashboard.jsx`** is now the shell + orchestrator: it owns all panel state, builds a single `dash` context object (a plain object literal, no spreads — `scratchpad/sync/tools/ctx-contract.mjs` statically checks this contract, i.e. that every key a tab destructures from `ctx` actually exists on `dash`) and passes `ctx={dash}` into every tab/component.
- **`src/components/panel/*`** — the shared kit: `Shell.jsx` (`PanelShell`/`PanelTopbar`, the Emblem wordmark, notifications popover), `kit.jsx`, `Sheet.jsx` (bottom-sheet-on-mobile / drawer-on-desktop pattern for modals), `DataTable.jsx`, `ModuleHeader.jsx`, `ActionMenu.jsx`, `CalendarSheet.jsx`. `MobileDock.jsx` (the iOS-style bottom pill nav) stayed in `src/components/` rather than moving into the kit.
- **Layout**: each tab draws its own `ModuleHeader` (not a shared `HEADER_TABS` list); the topbar collapses the page title into itself once you scroll past it, via a `useScrolledPast` hook watching `.dashboard-main` (the panel's single scroll container — see the "anti-rebote" CSS note under PWA).
- **Nav**: grouped into "Día a día" (Resumen, Agenda, Reservas, Caja, Clientes) and "Negocio" (Finanzas, Gastos, Pedidos, Inscripciones, Servicios, Essentials, Marketing), with Ajustes on its own (`NAV_GROUPS` in `Shell.jsx`). There's no `panelModules.js`/per-module-permission model — `has(id)` is just derived from the same nav filter that builds the menu, so there's a single source of truth for "does this barber see this tab".
- **`src/styles/panel.css`** is the panel's own design system (imported **last** in `main.jsx`, after `pimp.css`/`modules.css`/`brunetti.css`/`tailwind.css`) — it must never define `--gold-*`/`--on-gold` itself; those tokens come from `brunetti.css` and `panel.css` only re-exposes them as `--pn-accent` etc. Per-tab CSS lives in `src/styles/panel/*.css` (`agenda.css`, `finanzas.css`, `clientes.css`, …), each imported directly by the component(s) that use it.
- **`src/features.js`** (`FEATURES`) — flags for UI built ahead of its backend during the port; all are `true` now that the backend caught up. They're dev/rollout switches, not business settings — a business toggle (like auto-complete) lives in the `settings` table instead, editable from Ajustes.

### Session Management

Sessions are cryptographically signed, stateless tokens (no DB lookup):
1. Barber logs in → `auth-login` creates token via `createSession()`
2. Token stored in `localStorage` as `ps_barber`
3. Each protected request sends `Authorization: Bearer <token>`
4. Server validates via `readSession()` — no session table, just HMAC verification
5. If `PS_SESSION_SECRET` is missing/weak in production, all tokens are rejected (fail-closed)

The token itself is unchanged by the auth hardening below — what changed is how the *password* is verified before a token is even issued. See [Auth](#auth).

### Auth

- **Password hashing** (`api/_password.js`): PBKDF2 (600,000 iterations, SHA-256, stored as `pbkdf2$<iter>$<salt>$<hash>`), not raw SHA-256. `verifyPassword()` still accepts a legacy 64-hex-char SHA-256 row so existing barbers aren't locked out; it returns `{ok, needsRehash}` either way. `PASSWORD_REHASH=1` opts into rehashing a barber to PBKDF2 the next time they log in successfully via the legacy path — **off by default** (see env var above).
- **Password rule**: strong by default (10+ chars, upper/lower/digit — PimpStudio's rule); `PASSWORD_RULE=legacy` reverts to the old BrunettiCutz rule. `api/auth-barber.js`'s `usesStrongPasswordRule()` is the single source of truth for which rule applies, both for the strength check and for the user-facing error copy.
- **Exact-match login**: `WHERE code = $1 OR lower(name) = $1` — no more `ILIKE`, which let `%` and `_` act as wildcards (a username of literally `%` used to match anyone).
- **DB-backed lockout**: 3 failed attempts within 5 minutes locks the login, tracked both per-username and per-IP (table `login_attempts`, via `api/_rateLimit.js`). If the attempts counter itself can't be read (DB hiccup), login falls back to **only** checking `BARBER_PASSWORDS` — it deliberately does not also try the DB passwords in that state, since that would remove the lockout's protection against guessing.
- **Password reset by email**: `POST /api/auth-barber?reset=request` (body `{email}`) generates a random token, stores only its SHA-256 hash in `password_resets` with a 30-minute expiry, and emails a link built from `SITE_URL` (`/restablecer?token=...`, `src/pages/ResetPassword.jsx`). `POST ?reset=confirm` (body `{token, password}`) redeems it. `BarberLogin.jsx` has a "¿Olvidaste tu contraseña?" link.
- **`GET /api/auth-barber?me=1`**: refreshes the barber's profile (including `barber.email`, read via `to_jsonb(b)->>'email'` so it degrades to `null` before the migration runs) and issues a fresh token. The session token is signed **without** the email, so an older token issued before this change still validates.
- **`PATCH`/`PUT /api/auth-barber`**: account self-update (`{currentPassword, newPassword?, email?}`) — always requires the current password, even just to change the email.

### iOS compat notes

The native app (`ios/BrunettiCutz/`) decodes API responses strictly, so a few endpoints keep it in mind even as the web panel grows new states:
- `api/availability.js`'s `'past'` slot state is translated to `'blocked'` for native clients — iOS doesn't understand `'past'` and would otherwise crash/misrender on it.
- The public phone-based booking history and booking creation no longer *require* the app to send the client's name — a session-scoped lookup and a name fallback cover the case where the native client omits it.
- `price`, `client` and `service` are never `null` in a booking response — the new money/lifecycle fields are additive, not replacements.

### Migrations

Migrations are automatic, not a manual pre-deploy step. `api/_schema.js` exports `ensure*` functions (`ensureBookingColumns`, `ensureClientColumns`, `ensureServiceColumns`, `ensureExpenseColumns`, `ensureSettingsTable`, `ensureReviewsTable`, `ensureProductsLedger`, `ensureShopOrderColumns`, `ensureAuthColumns`, …), each memoized per warm lambda instance (`once()`), each checking `information_schema` (or `presentTables`/`presentColumns`) before altering anything, and each additive-only — `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, one `ALTER TABLE` per table, indexes/constraints in their own try/catch so a pre-existing conflict doesn't block the rest. `db/schema.sql` is still the canonical reference for what the schema *should* look like, but the running code brings a fresh (or behind) database up to date on its own — there's no separate migration-runner script to remember to invoke.

The one hard rule: **no `ensure*` call runs during checkout or the Mercado Pago webhook.** Those hot/money-moving paths read optional columns defensively instead — `to_jsonb(row)->>'column'` or a `hasColumns()` check — so they work whether or not the migration has already run on that particular warm instance, and never risk a DDL statement racing a payment.

### Security odds and ends

A few hardening items outside the Auth section, worth knowing about if you're touching these paths:
- **Public cancellation requires the phone**, not just the booking id — the id is a plain `SERIAL`, so id-only cancellation used to let a 3-line loop wipe the whole calendar with zero credentials. The phone is read from the JSON body (falls back to `?phone=`) and rate-limited to 10 attempts / 5 minutes per IP.
- **New barbers require a real password from the caller** — `POST /api/barbers` takes `password` in the body and hashes it with PBKDF2; there's no default `"1234"` PIN anymore.
- **Availability writes are scoped to your own agenda**: `canTouchAgenda(session, barberId)` in `api/availability.js` only lets a session block/open its own `barberId` unless `session.admin`. The PimpStudio bridge is further pinned to `barberId === 6` (Bruno) regardless of what secret it presents.

### Money model (no commission)

BrunettiCutz has no commission/payout system (that's PimpStudio's multi-barber feature, not ported). `api/_money.js` defines three related numbers instead:
- **`listPrice`** — `COALESCE(price_snapshot, services.price, custom_price)`, the catalog price.
- **`price`** — `COALESCE(custom_price, price_snapshot, services.price)`, what's actually owed (this is where an admin price edit or a free-cut redeem, at `$0`, lands).
- **`collected`** — `paid_amount`; `null` until charged.

`readPayment(body)` parses `{paidAmount, paymentMethod, paymentRef}` from a request body — `null` if neither came in (iOS, the PimpStudio bridge, or an old client), an error object if something invalid came in, otherwise `{collected, method, ref}`. `payment_method: 'cortesia'` is a deliberate `$0` charge (a comped visit), distinct from `null`/"not yet charged". A **bridge** PATCH never carries payment fields at all — `handlePatch` strips them for bridge calls before `readPayment` ever sees the body, so PimpStudio can change a booking's status without being able to fabricate a payment.

`onlineSales(sql, {from, to})` combines paid `shop_orders` (Essentials) and paid `enrollments` (Cursos/Workshop, matched via the Mercado Pago webhook's own confirmation message) into one `{total, count, byType, byDay}` shape, bucketed by day in `America/Santiago`. This feeds the "Ventas online" KPI in Resumen/Finanzas and the "Online (web)" line in Caja.

Every state-changing booking write sets `updated_at = NOW()` — PimpStudio's `bridge-completed` star-repair cron depends on that column to find recently-touched completions.

### Booking modes (`api/bookings.js`)

Beyond plain CRUD, `api/bookings.js` dispatches on `mode=`:
- **GET** `?mode=unclosed[&summary=1]` — past-due open bookings + payment-pending completed ones (admin); `?mode=cash&date=` — the day's cash reconciliation (bookings + product sales + online MP sales); `?mode=sales&from=&to=` — paid product-sale line items for a range; `?issues=1` (not a mode) — recent rejected/errored booking attempts.
- **POST** `?mode=sale` — register a mesón product sale, optionally tied to a booking.
- **DELETE** `?mode=sale` — void a sale and restock; `?purge=1` — hard-delete a booking (session required, with a pre-delete loyalty snapshot/reversal).
- **PATCH** has no `mode=` — it branches on the request body shape:
  - **Reschedule** (date/time/service change): re-checks availability excluding the booking's own current slot, resets the 1-hour reminder flag, updates the Notion page's date, and emails the client only if the booking is still upcoming and not yet confirmed-past-the-point-of-no-return.
  - **Admin price edit**: blocked if the free-cut redeem is already active and the new price is non-zero; dropping a completed booking's price to `$0` marks it a `cortesia`.
  - **"No vino"**: `status → cancelada` + `no_show = true` (any other status forces `no_show = false`).
  - **Payment**: only applied when there's a session and the target status is `completada` — see [Money model](#money-model-no-commission).
  - **`completada → completada`** is a no-op for loyalty and the review email — it only lets a payment correction through. A star is credited exactly once, the moment a booking *first* transitions into `completada`.
- **`chargeOnCreate: true`** on a manual booking (panel only, not the bridge) inserts it as `en curso` instead of `completada` and opens the payment sheet immediately, rather than landing silently in "payment pending".
- `bridge-completed` (used by PimpStudio's star-repair cron) filters out services with `loyalty_eligible = false`, so a non-star-earning service never gets backfilled a star either.

### Auto-complete

Long-running "en curso" bookings nobody remembered to close out get auto-completed by `api/_bookingLife.js`'s `autoCompleteStarted()`:
- Gated by the `panel:auto_complete` key in `settings` — **default off** (missing key, missing table, or a DB error during the read all resolve to "off"). Toggle lives in Ajustes, admin-only.
- Gated by environment: only runs when `VERCEL_ENV === 'production'` (or `AUTO_COMPLETE_SANDBOX=1` for local testing).
- Only claims bookings whose date is within the last 30 days (a floor, not a ceiling — it will never reach further back than that) and whose scheduled end time has passed by at least 60 minutes (or the service's own duration if longer).
- Claims rows with `FOR UPDATE SKIP LOCKED` inside a materialized CTE, 4 at a time, up to a `limit` (default 10, capped 50), inside an 8-second time budget; throttled to once per 15 seconds per warm instance unless `force: true`.
- Runs from three places: every panel GET of the booking list, `?mode=unclosed`, `?mode=cash`, and `GET /api/push?job=reminders` (with `force: true`, limit 25) — **no new cron was added**; it rides the existing hourly cron-job.org ping.
- Goes through the same single loyalty writer as everything else — see "Un solo escritor" in the Puente section.

### Inventory

`products.stock` is the number that's true; `product_stock_moves` is history, never the other way around — nothing recomputes `stock` from the ledger. `api/_products.js` exposes a computed `drift` (`stock - sum(moves)`) per product, and a `?action=reconcile` ("cuadrar") that inserts a single `'ajuste'` move equal to the drift so the ledger catches up to `stock` — it never touches `stock` itself. Deleting a product **archives** it (`archived_at`, `active = false`) if it has any sale/move history, and only hard-deletes if it's never been touched; the response shape is `{ok, archived, deleted}`. The Mercado Pago webhook writes stock-move rows for a paid Essentials order best-effort, after the payment itself is already confirmed — a failure there never blocks the "payment confirmed" response.

### Reviews

`/resena` (`src/pages/Review.jsx`, `FEATURES.reviews`) is the public post-visit rating page, backed by `barbers.js?mode=review` (public GET by token / POST to rate) and `?mode=reviews` (admin summary + list). The `barber_reviews` table has one row per booking (`UNIQUE(booking_id)`) created by `api/_bookingLife.js`'s `afterCompletion()` the moment a booking first completes — `INSERT ... ON CONFLICT (booking_id) DO NOTHING RETURNING token` means only the *first* completion ever gets a token back, so re-completing a booking (a payment correction, an auto-complete racing a manual one) never creates a second review row or resends the email. The "thanks, please rate us" email only goes out if a token was actually returned **and** the visit is fresh (today or yesterday, `America/Santiago`) **and** there's an email on file — a stale or emailless booking still gets its (token-less on retry) review row, just no email.

### Barbers modes (`api/barbers.js`)

Dispatched on `?mode=`, before the general admin gate, each with its own try/catch (a mode-specific failure is a clean 500, never a crash that falls through to static/demo data); an unrecognized mode is `404` on every HTTP method.
- `me` (PATCH, any barber) — rename your own account.
- `settings` (GET/PATCH, any barber) — your own `notif`/`whatsapp`/`horario` prefs, stored under `settings` key `panel:barber:<id>`.
- `shop-settings` (GET/PATCH, admin) — business info (`panel:business`), expense budgets (`panel:budgets`), and the auto-complete toggle (`panel:auto_complete`).
- `reviews` (GET, any barber; admin can pass `?barberId=`) — rating summary + recent rated reviews.
- `review` (GET/POST, public, no session) — the `/resena` backend.

None of these `panel:*` settings keys collide with `mp-payments.js`'s own `SETTINGS_KEYS` (`cursos_price`, `workshop_price`, `workshop_date`, `workshop_payments`) — different table, different naming convention, kept deliberately distinct.

### PWA & Standalone Mode

iOS "Add to Home Screen" often ignores manifest `start_url` and instead launches the last-viewed page. The app detects this with `isStandaloneLaunch()` in `App.jsx` and redirects:
- If barber session exists → `/panel` (dashboard)
- Otherwise → `/ingreso` (login)

This only happens once per app session (sessionStorage flag).

**Build freshness (`buildWatch.js`).** The installed PWA is what Bruno actually uses, and iOS freezes it on exit and restores the same in-memory JS for days — a normal deploy alone doesn't reach it, since `index.html` (served `Cache-Control: no-store`) is only re-fetched on a hard navigation, which an already-open PWA never does. `buildWatch.js` compares the hashed entry-chunk filename this tab loaded against what the server is serving now, on return-from-background and on a background heartbeat. The heartbeat only reloads inside `/panel`, and only with no sheet/modal open and no focused field — on the public site it only checks on tab-focus, so a client mid-`/reservar` never loses their selection to an auto-reload.

**Service worker**: `sw.js` no longer has a `SW_VERSION` — that was leftover from an earlier version that actually cached responses; nothing reads it anymore.

**Install prompt** (`src/installPrompt.js` + `InstallPrompt.jsx`): barber-only now (the public site doesn't prompt clients to install anything). Dismissal is remembered in `localStorage` under `bc_install_dismissed`.

**Theme**: automatic by hour (light 7:00–18:59, dark otherwise, `America/Santiago`), with a manual override (`ps_theme_manual` in `localStorage`) that always wins once set — there's no periodic reset of that flag. The switch lives in Ajustes → Apariencia.

### Mercado Pago Integration

All three paid modules — Cursos, Workshop, Essentials — share one endpoint, `api/mp-payments.js`, distinguished by a `source` field (`'cursos' | 'workshop' | 'essentials'`). Cursos and Workshop charge a fixed server-side price (`FIXED_PRICES` in the handler — never trust a client-sent amount); Essentials re-validates price and stock against the `products` table for every item in the cart, since it's a real multi-item order.

**Checkout flow:**
1. Frontend posts to `/api/mp-payments` with `{source, name, email, phone, edition?, items?}` (`edition` for workshop only, `items: [{productId, qty}]` for essentials only)
2. For `essentials`, the API first creates a `shop_orders` row with `status: 'pending'` (snapshotting validated price/name per item) and uses `essentials-<orderId>` as the Mercado Pago `external_reference`; for `cursos`/`workshop` it instead base64url-encodes `{source, name, phone, email, edition?}` directly into `external_reference` (no DB row needed since there's nothing to look up — mirrors how the old Flow integration passed customer data through its `optional` field)
3. API calls Mercado Pago's `/checkout/preferences` with the item(s), `back_urls` pointing back to the originating page, and `notification_url` for the webhook; returns `{checkoutUrl}` — `sandbox_init_point` if `MP_ACCESS_TOKEN` starts with `TEST-`, otherwise `init_point` (Mercado Pago decides sandbox vs prod purely from the token prefix)
4. Frontend does a full-page redirect to `checkoutUrl` (Mercado Pago hosted Checkout Pro — cards, transferencia, billeteras)
5. Mercado Pago redirects the browser back to the module's own page with `status`/`payment_id` (or `collection_status`/`collection_id`) in the query string — the frontend uses these only to display a message, never to write anything. **Essentials is the exception**: its `back_urls` point to its own dedicated `/essentials/gracias` (`src/pages/EssentialsGracias.jsx`), not back to `/essentials`. That page polls `GET /api/mp-payments?status=1&payment_id=...` every 3 seconds, up to 10 times, while the payment is `pending`/`in_process`; on `approved` it clears the cart and shows a receipt built from the `bc_last_order` `sessionStorage` key that `Essentials.jsx` writes right before the redirect (still without writing anything to the DB itself — that's the webhook's job). `/essentials` itself still handles a `?status=` from an older preference for backward compat.
6. Independently, Mercado Pago POSTs server-to-server to `notification_url` (`/api/mp-payments?webhook=1`); the handler calls `GET /v1/payments/{id}` to verify the real status before saving anything (never trusts the return redirect alone). On `approved`: essentials marks the `shop_orders` row paid and best-effort decrements `products.stock` (plus writes `paid_at` and `product_stock_moves` rows, best-effort, after the payment is already confirmed — see [Inventory](#inventory)); cursos/workshop decode `external_reference` and insert into `enrollments` (workshop additionally triggers the confirmation email)
7. `GET /api/mp-payments?status=1&payment_id=...` is a read-only status check used by the frontend after the return redirect — it does not write to the DB

**Interruptor de pagos del Workshop (pausa).** El Workshop tiene un on/off propio en el panel interno (**Ajustes → Cursos y Workshop**, junto al precio y la fecha), guardado en la tabla `settings` bajo la clave `workshop_payments`. Con el interruptor apagado, `handleCheckout` devuelve **409** para `source: 'workshop'` antes de crear cualquier preferencia — Cursos y Essentials no se ven afectados — y la página `/workshop` pasa a modo pausa: muestra "Fecha por confirmar" en vez de la fecha y la cuenta regresiva, y el formulario solo ofrece la lista de espera (`/api/enrollments`, gratis, sin cobro). El default cuando la clave no existe —o cuando la DB no responde— es **apagado**, a propósito: nadie debe poder pagar un cupo sin fecha confirmada. El flujo esperado al abrir una edición nueva es guardar primero la fecha y recién ahí encender el interruptor. El toggle del panel guarda solo (PATCH inmediato), sin pasar por el botón "Guardar".

Workshop's reservation form used to save a lead immediately on submit, before any payment (`/api/enrollments`, no charge). It now only does that for the free waitlist option (`WAITLIST_OPTION` in `Register`); picking the dated edition instead goes through the Mercado Pago flow above, and the seat is only confirmed once the webhook fires.

In dev mode (`npm run dev`), Mercado Pago requests are mocked by Vite middleware (see `vite.config.js`) — the mock redirects straight back with `status=approved`, but since it doesn't hit the real webhook, nothing is actually written to the DB in dev (use `VITE_DEV_MOCKS=1 npm run dev` or `npx vercel dev` to test the full flow, see below).

### Dev mock (`VITE_DEV_MOCKS=1`)

`.env.local` holds **production** credentials, so `npx vercel dev` (and the `vercel-dev` launch config) should be used sparingly and deliberately, not as the everyday inner loop. `VITE_DEV_MOCKS=1 npm run dev` (or the `dev-mock` config in `.claude/launch.json`) is the everyday alternative: `scripts/dev-mock/index.mjs`, a Vite plugin (`apply: 'serve'`, Node-only — never bundled) that answers every `/api/*` request from in-memory fixtures (`scripts/dev-mock/fixtures.mjs`) shaped the same as the real backend. Any `Authorization: Bearer <anything>` is treated as Bruno (barber id 6, admin) — including the local `"dev-token"` fallback `BarberLogin.jsx` uses when it can't reach a server — so the whole panel is reachable without a database, Mercado Pago, Notion, Resend, or PimpStudio. Mock login accepts `bruno-herrera` (or `brunetti`) with any 8+ character password; three wrong attempts trigger a 429 for 2 minutes, mirroring the real lockout. Without the env var, `npm run dev` behaves exactly as it always did (no middleware registered at all).

### Notion Calendar Sync & Reminders

**Sync flow:**
1. Every booking created or updated in `/api/bookings.js` (client-facing and panel-manual) calls `syncBookingToNotion(...)` in `api/_notion.js`, which creates a page in the configured Notion database via the REST API (no SDK)
2. The target database ("Reservas Brunetti") was created by hand in the Notion UI and its properties don't match an ideal schema — `api/_notion.js` adapts to what actually exists rather than requiring more manual changes: `Nombre` (title — Spanish-locale default name, not "Name"), `Fecha` (date), `servicio`/`teléfono` (lowercase rich_text/phone_number), `Barbero` (rich_text), `Precio` (rich_text, not number — formatted as CLP text), `Estado` (Notion's **Status** type with 3 fixed stages — "Sin empezar"/"En curso"/"Listo" — not a free-form Select, mapped via `mapStatusToStage()`), and `Cliente` (type **People**, which can't hold arbitrary text — the client's name is NOT written there; it only appears in the page title alongside the service name)
3. The created page ID is stored in `bookings.notion_page_id`. Status changes (PATCH) map to one of the 3 Status stages via `updateNotionBookingStatus(...)`; cancellations (DELETE) **archive** the Notion page instead of setting a status, since "cancelada" doesn't fit any of the 3 fixed stages — this also makes cancelled bookings disappear from the calendar view, which is arguably the correct behavior anyway
4. To see these events in the Notion Calendar app, the Notion database must be added as a calendar source from within Notion Calendar itself (Settings → Notion databases) — this is a one-time manual step, not something the API can do

**Reminder limitation (important):** Notion's API has no reminder/notification field at all (the `date` property object is empty), and Notion's own UI-based reminders for database Date properties only offer day-level presets (same day, 1 day before, 1 week before) — there is no way, via API or UI, to get a Notion-database-backed calendar entry to notify at a specific number of minutes/hours before. A "1 hour before" alert is therefore handled entirely outside Notion: `GET /api/push?job=reminders` (in `api/push.js`, alongside the existing Web Push subscription handling) sends a Web Push notification via `notifyBarber` to the assigned barber when a booking is between 45 and 105 minutes away (as of 2026-09-12; was 45–90). **The window must be at least as wide as the cron interval, or it drops reminders.** A booking at time T is only caught if some tick lands in [T-toMin, T-fromMin]; with an hourly cron, any window narrower than 60 minutes can contain no tick at all and the booking is skipped with no trace. The old 45–90 window argued that an hourly cron leaves no gaps because every slot lands on the hour (`SLOT_GROUPS`, `src/data.js`), but that is wrong: bookings being aligned with each other does not align them with the *minute* the cron fires, and 15 minutes of trigger lateness is enough to miss the HH:00 booking entirely. pimpstudio had the same narrow window and measured it — of 37 eligible bookings the 1-hour notice reached 31 (84%) — and widened to 60 minutes wide on 2026-09-09; this project followed on 2026-09-12. Because a 60-minute-wide window means the push can go out anywhere from 45 to 105 minutes ahead, the copy states the **absolute** appointment time ("Próximo turno · hoy a las 16:00") instead of a duration ("Turno en 1 hora"), which would be off by up to 45 minutes. Fires once, tracked via the `reminder_60_sent` column. Do **not** narrow the window back below the cron interval. There used to also be a 15-minutes-before reminder (`reminder_15_sent`, still present as an unused column in `db/schema.sql`), but it was dropped: once the cron interval grew to 40 minutes, the window needed to reliably catch it (≥40 min wide) would have made "15 minutes" inaccurate by up to the same margin, defeating the point. This lives inside `push.js` instead of its own file because Vercel's Hobby plan caps a deployment at 12 Serverless Functions and this project is at 11/12 — anything cron-related folds into an existing endpoint rather than adding a new one. The same ping now also drives the [auto-completer](#auto-complete) (`force: true`, right after the reminders are sent) and, via `vercel.json`'s rewrite, doubles as the target for `/api/csp-report` (`?job=csp-report` — no DB, no session, just an in-memory per-IP rate limit, always `204`).

**Trigger (cron-job.org, not Vercel Cron):** this project is on Vercel's Hobby plan, which only runs `vercel.json`-declared cron jobs once a day (a `*/5 * * * *` schedule fails deployment outright on Hobby). So an external [cron-job.org](https://cron-job.org) job hits `GET https://brunetticutz.cl/api/push?job=reminders` **every hour, 8:00–21:00** with header `Authorization: Bearer $CRON_SECRET`. The 8am start (not 9am, business open) is deliberate: the 09:00 booking's "1 hour before" reminder has to fire at 08:00.

This schedule has been walked down twice for the same reason — the ping was defeating Neon's compute autosuspend and the endpoint stayed awake with near-zero real traffic. First every 5 minutes → every 40 minutes; then, on 2026-08-29, every 40 minutes around the clock → hourly and daytime-only. That last step cuts 36 wake-ups a day to 14, and drops the overnight ones entirely (there is nothing in the table to find at 3am). Measured context for why this matters: in August this project burned **137.95 Neon compute-hours** against a ~10 MB database, and the cron was the single largest source of wake-ups. Neon bills active compute time, not queries, so the number of pings is the cost — not their weight.

## Common Tasks

### Run dev server
```bash
npm run dev
```

### Run dev server with the full API mocked (no DB, no secrets)
```bash
VITE_DEV_MOCKS=1 npm run dev
# or the "dev-mock" launch config in .claude/launch.json
```

### Build for production
```bash
npm run build
# Output: dist/
```

### Test backend locally against real production data (requires Vercel CLI and .env.local)
```bash
npx vercel dev
# Starts Vite + serverless functions on localhost:3000 — talks to real Neon/MP/Notion/Resend
```

### Database schema setup (after cloning)
```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/seed.sql  # optional
```
This is the canonical reference, not a required manual step before every deploy — `api/_schema.js` applies the same columns/tables automatically at runtime. See [Migrations](#migrations).

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
| `src/main.jsx` | React DOM render, CSS import order (`panel.css` last) |
| `src/data.js` | Static data (services, constants) |
| `src/features.js` | `FEATURES` flags for panel UI |
| `src/pages/Dashboard.jsx` | Panel shell, `dash` context, tab routing |
| `src/pages/panel/*.jsx` | Panel tabs (see [Panel architecture](#panel-architecture)) |
| `src/components/panel/*` | Panel component kit (`Shell`, `Sheet`, `kit`, …) |
| `api/_auth.js` | Session creation/validation |
| `api/_schema.js` | Automatic, additive migrations (`ensure*`) |
| `api/_bookingLife.js` | Single loyalty writer, reviews, auto-complete |
| `api/_money.js` | No-commission money model |
| `db/schema.sql` | Database table definitions (canonical reference) |
| `vite.config.js` | Vite build config + Mercado Pago mock + dev-mock plugin |
| `vercel.json` | Deployment routing, rewrites (`register-client`, `csp-report`), headers, caching |
| `.env.example` | Required environment variables |

## Deployment Checklist

Before pushing to `main`:
1. Verify `PS_SESSION_SECRET` is set in Vercel (≥16 chars)
2. Verify `DATABASE_URL` is accessible — the schema itself doesn't need a manual step; `api/_schema.js` migrates it on first request (see [Migrations](#migrations))
3. Verify `MP_ACCESS_TOKEN` is set (test token for sandbox, production token to charge for real)
4. Run `npm run build` locally and test with `npm run preview`
5. `git push origin main` — Vercel auto-deploys straight to production (`brunetticutz.cl`). There is no staging branch, so anything pushed to `main` goes live immediately.
6. **If this deploy is the BrunettiCutz side of the PimpStudio sync**: PimpStudio's own `panel-rediseno` branch (the source this port was built from) must not deploy until *this* is live in production — its bridge calls (agenda, loyalty repair) assume the endpoints/response shapes documented here already exist.

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

## Puente con PimpStudio (agenda de Bruno + tarjeta de fidelidad)

BrunettiCutz y PimpStudio (`pimpstudio.cl`) son dos proyectos con bases de datos Neon separadas, unidos por un secreto compartido (`PIMPSTUDIO_BRIDGE_SECRET`, el mismo valor en los dos Vercel). El puente va en **las dos direcciones** y cada una tiene su dueño de datos:

| Qué | Dónde viven los datos | Quién llama a quién |
|---|---|---|
| Agenda de Bruno (barbero 6) y registro de clientes | **Acá** (`bookings`, `availability_blocks`, `users`) | PimpStudio → acá, vía su `api/bruno-agenda.js` (y `api/_brunettiClients.js` para la lista de clientes) con header `X-Bridge-Secret`, aceptado en `api/bookings.js`, `api/clients.js` (solo los modos `bridge-*`) y `api/availability.js` |
| Programa de fidelidad (estrellas + pases de Wallet) | **PimpStudio** (`loyalty_events`, `wallet_passes`, `wallet_registrations`) | Acá → PimpStudio, vía `api/_loyaltyBridge.js` a los modos `bridge-*` de su `api/clients.js` y `api/push.js` |

**Fidelidad — no hay sistema propio, se reusa el de PimpStudio.** Una sola tarjeta ("Pimp Studio", `pass.cl.pimpstudio.loyalty`) sirve en los dos locales y suma con los cortes de ambos; los clientes se cruzan por teléfono (9 dígitos). Reglas: 1 estrella por servicio completado, 5 → 30% en productos, 10 → corte gratis.

**Un solo escritor (regla crítica).** La estrella la acredita SIEMPRE el backend de este proyecto, y siempre por `loyaltyForTransition()` de **`api/_bookingLife.js`** — no `api/bookings.js` (ese solo lo llama). Es el **único** archivo del proyecto que importa `creditStar`, `revertStar`, `redeemFreeCut` y `cancelRedeem` de `api/_loyaltyBridge.js`; ninguna otra función los toca. Sus llamadores, todos pasando por la misma `loyaltyForTransition()`:
- El `PATCH` de `api/bookings.js`, que ejecutan los dos paneles (el de acá directamente, y el de PimpStudio a través del puente de agenda) y la app iOS.
- El alta manual (`createManualBooking`) cuando la reserva ya nace `completada` — **tanto** desde el panel con sesión **como** desde el puente `?mode=bridge-manual`: desde el 2026-09-24 los dos acreditan (antes el alta con sesión no lo hacía, y esas atenciones quedaban sin estrella).
- El canje (`redeemForBooking`, vía el `PATCH` con `{redeem: "free_cut"}`) y su reverso: cancelar una reserva con el corte gratis ya canjeado le devuelve las 10 estrellas al cliente (`voidRedeem`); des-cancelarla vuelve a canjear (`restoreRedeem`), o cae al precio de lista con un `notice` si el canje ya no es posible.
- La cancelación pública y el `purge` (DELETE con `?purge=1`) — ambos toman una foto (`loyaltySnapshot`) antes de revertir, para no perder el estado si algo falla a mitad de camino.
- El `DELETE` de un cliente en `api/clients.js`, vía `purgeLoyaltyForClient`.

`_bookingLife.js` también concentra `afterCompletion()` (la fila de reseña + el correo de gracias, ver [Reviews](#reviews)) y `autoCompleteStarted()` (ver [Auto-complete](#auto-complete)) — todo lo que un cambio de estado de una reserva dispara vive en un solo archivo. `services.loyalty_eligible` ("Suma estrella") se respeta en dos lugares: al acreditar acá, y al filtrar qué completadas ofrece `bridge-completed` para reponer.

La única excepción al escritor único es de reposición y vive allá: el cron de PimpStudio acredita, con la misma llave, las completadas que se quedaron sin estrella (`bridge-completed`), y solo suma. Antes `bruno-agenda.js` también acreditaba y una reserva completada desde allá sumaba dos estrellas. El identificador de idempotencia es `bridge_ref = "brunetti:<id de la reserva acá>"`, con índices únicos parciales en el `db/schema.sql` de PimpStudio (earn y redeem por separado).

**Superficie en el front:**
- `src/walletPrompt.js` + `src/components/WalletPrompt.jsx` — popup "Agregar a Wallet" (iOS descarga el `.pkpass`; Android pide un link firmado). Montado en `Booking.jsx` (paso 3, con 4,5 s de respiro) y en `Account.jsx`.
- `Account.jsx` — tarjeta de estrellas con los 10 sellos y botón de instalación.
- `/tarjeta` (`src/pages/CardShare.jsx`) — página pública del link que el barbero manda por WhatsApp; el token es opaco, nunca lleva el teléfono.
- `Dashboard.jsx` — badge de estrellas y botón "Tarjeta" (WhatsApp) en la lista de clientes; canje del corte gratis en el detalle de reserva; pestaña **Marketing** con métricas de adopción y envío de campañas (las mismas cifras y la misma audiencia que ve el panel de PimpStudio — el programa es uno solo).

⚠️ **Hasta el 2026-09-24 ninguna estrella de acá llegó a PimpStudio.** El `INSERT … ON CONFLICT` de `bridge-loyalty-earn` allá no calzaba con su índice parcial y respondía 502 en cada llamada; como la estrella es best-effort, acá nunca se vio (61 atenciones completadas, cero estrellas). Se corrigió allá, y el repaso de `bridge-completed` quedó de red de seguridad.

**Todo el puente es best-effort.** `api/_loyaltyBridge.js` usa timeout de 6 s y devuelve error suave: si pimpstudio.cl no responde, se registra en consola y la operación local (reserva, cambio de estado, carga del panel) sigue igual. Los modos de Wallet nunca caen al fallback de datos de demo — devuelven 502, para que el front no crea que generó un pase.

**Modos `bridge-*` de entrada (PimpStudio → acá).** Además del `GET`/`PATCH` de la agenda de Bruno, PimpStudio llama cuatro modos propios. Todos exigen `X-Bridge-Secret`; sin el secreto correcto (o sin secreto configurado acá) responden **404 `{ ok:false, error:"No encontrado" }`** — para cualquier otro, no existen — y **nunca** caen a los datos de demo: una lista inventada o un `{ok:true}` falso le haría creer a PimpStudio que esos son los clientes reales o que la reserva quedó guardada. Van despachados al principio de `handler()`, antes de todo lo demás, con su propio `try/catch` (un error es 500, no demo).

| Ruta | Qué hace |
|---|---|
| `GET /api/clients?mode=bridge-clients` | `{ ok, clients, skipped }`: **todos** los `users`, uno por fila, cada uno `{ phone, name, email, visits, bookings, lastVisit, totalSpent, createdAt }`. `visits` = completadas, `bookings` = no canceladas, `lastVisit` = `YYYY-MM-DD` de la última no cancelada (o `null`), `totalSpent` = `COALESCE(custom_price, services.price)` de las completadas. El que no normaliza a 9 dígitos se omite y se cuenta en `skipped`. Dos filas con el mismo teléfono normalizado salen las dos: las junta PimpStudio (`sanitizeRemoteClients()` en su `api/_brunettiClients.js`), que es quien cruza. `Cache-Control: no-store` |
| `POST /api/clients?mode=bridge-client` | `{ name, phone, email? }` → `{ ok, client:{ id, phone, name, email, created } }`. Upsert por teléfono normalizado en un solo statement: un nombre vacío no pisa el guardado (y sin nombre no se crea un cliente nuevo), el correo solo se escribe si viene y es válido (uno mal escrito no se guarda y vuelve un `notice`). 400 si el teléfono no queda en 9 dígitos o falta el nombre de un cliente nuevo |
| `GET /api/bookings?mode=bridge-completed&days=N` | `{ ok, bookings:[{ id, phone, name }], skipped }`: las reservas **completadas** cuya última escritura (`updated_at`) cae en los últimos N días (1–14, por defecto 3) y que llevan al menos 10 min quietas. Solo lectura, tope 500, `Cache-Control: no-store`. La usa el cron de PimpStudio (`healBrunettiStars`) para reponer las estrellas que no llegaron: acá nadie reintenta la de `creditStar()` si falla |
| `POST /api/bookings?mode=bridge-manual` | `{ client, phone, email?, barberId, serviceId?, service?, price?, date, time, status? }` → `{ ok, booking:{ id, date, time, status }, notice? }`. La **misma** reserva manual del panel de acá — comparten `createManualBooking()`: upsert del cliente, servicio del catálogo o personalizado, precio editable (se congela en `custom_price`), sin límite de fecha, chequeo de horarios (409 tomado / 422 no cabe) y sincronización a Notion |

Lo que `bridge-manual` agrega sobre la del panel, todo bajo `bridge: true` (el alta del panel con sesión quedó idéntica —mismas validaciones, mismas respuestas y mismo orden de escrituras— salvo la estrella cuando nace `completada`, que ahora acreditan los dos, y su `notice` si falla, que el panel muestra):
- **`barberId` tiene que ser un barbero activo, y además Bruno (6)**: el secreto nunca agenda a otra persona, igual que el `GET` y el `PATCH` del puente. Responde **422**, no 403: `api/bruno-agenda.js` de PimpStudio lee un 401/403/404 como "el puente no aceptó el secreto".
- **No escribe nada si la reserva no entra**: cliente y reserva van en un solo statement (CTE), después del chequeo de horario. Si otra reserva gana la carrera por el índice `bookings_slot_unique`, es 409, no 500.
- Valida fecha real, hora, largos, precio (0–10.000.000) y que el servicio exista; un servicio personalizado exige precio (el modal del panel también lo exige).
- **`status: 'completada'` queda igual que crearla y completarla desde el panel**: la estrella se acredita **una vez**, por `loyaltyForTransition()` — la misma función que usa el `PATCH` —, con `bridge_ref = "brunetti:<id>"`. PimpStudio solo repone por su lado, con la misma llave, las que no llegaron (ver `bridge-completed`). Un reintento del mismo alta choca con su propio horario (409) y no suma otra. Si PimpStudio no responde, la reserva queda completada igual y vuelve un `notice`.
- Desde 2026-09-24 el alta manual del panel **con sesión** también acredita la estrella cuando nace `completada` (antes no, y esas atenciones quedaban sin estrella). Mismo `loyaltyForTransition()`.

**Teléfono: dos limpiezas distintas.** Los modos del puente usan `normalizePhone()` de `api/_bridge.js`, espejo exacto del de PimpStudio: quita `56`, `0056` o un `0` inicial **solo** cuando sobran para llegar a 9 (los últimos 9 dígitos). El resto del proyecto sigue con `cleanPhone()` (primeros 9), que da otro número para `"0912345678"`. Unificarlos es un arreglo aparte.

**Comparación del secreto en tiempo constante.** `isBridgeRequest()` vive en `api/_bridge.js` (sin imports del proyecto, para no cerrar ciclos) y compara los SHA-256 de los dos lados con `crypto.timingSafeEqual`: con `===` el tiempo de respuesta filtra cuántos caracteres del principio coinciden. La usan `api/bookings.js`, `api/clients.js` y `api/availability.js` (esta última tenía su propia copia con `===` hasta 2026-09-24).

**Cupo de funciones:** este proyecto está en **11/12** Serverless Functions (tope del plan Hobby) — `register-client` se plegó en `clients.js?mode=register` (con un rewrite en `vercel.json` para que la app iOS, que sigue llamando a `/api/register-client`, no se entere), dejando un cupo libre. Aun así **no conviene agregar un archivo nuevo a `api/`** salvo que sea imprescindible: todo lo nuevo va como `?mode=` dentro de un endpoint existente (fidelidad como `?mode=wallet-*` en `api/clients.js`, reseñas/ajustes como `?mode=me|settings|shop-settings|reviews|review` en `api/barbers.js`, etc.), y la lógica compartida en archivos con prefijo `_` (que Vercel no cuenta).

## Brunetti Academy (`/cursos`, desde 2026-09-29)

Academia de miembros tipo Skool, **idéntica** a la de PimpStudio (`pimpstudio.cl/academy`, allá
oculta): la página pública de `/cursos` (`Cursos.jsx`) sigue siendo la portada y la app de alumnos
vive en `/cursos/*` con Comunidad, Cursos, Calendario, Miembros, Clasificación, Acerca de, chat
directo, Grupos (generaciones con chat grupal), notificaciones, niveles 1–9 y eventos. Pago único
por curso con Mercado Pago → acceso de por vida. Contrato completo en
[`docs/academy/SPEC.md`](docs/academy/SPEC.md).

- **Módulo portable, no se edita acá**: el código compartido (`api/_academy*.js`, `api/_webpush.js`,
  `src/academy/**`, `src/pages/academy/**`, `src/components/academy/**`, `src/styles/academy/**`,
  la pestaña `AcademyTab` del panel, `scripts/dev-mock/academy/**`, `docs/academy/**`) se copia
  desde PimpStudio con `node scripts/academy-sync.mjs ../BRUNETTICUTZ` (ejecutado desde el repo de
  PimpStudio). Un cambio se hace allá y se sincroniza; si se edita acá, el próximo sync lo pisa.
  Lo propio de este sitio son **4 archivos del host**: `api/_academyHost.js` (marca, `/cursos`,
  `sessionInfo`, webhook, `requireBarberAdmin`, `notifyStaff`), `src/academy/hostConfig.js`,
  `src/academy/host.jsx` y `scripts/dev-mock/academy/host.mjs`, más los puntos de enganche
  listados en [`docs/academy/PORTABLE.md`](docs/academy/PORTABLE.md).
- **Sin función nueva** (seguimos en 11/12): `/api/academy` es un rewrite a
  `/api/services?scope=academy`, que carga `api/_academy.js` con `import()` dinámico — si la
  Academy no carga, el catálogo de `/reservar` sigue andando.
- **Sesiones de alumno SEPARADAS de las del barbero** (regla crítica): token `m1.<payload>.<mac>`
  firmado en `api/_academySession.js` con una llave derivada por HKDF de `PS_SESSION_SECRET` y el
  `sessionInfo` de este sitio (`brunetticutz:academy:member:v1`, no se cambia nunca en
  producción: desloguea a todos los alumnos). `readSession` de `api/_auth.js` exige exactamente
  2 partes, compara en tiempo constante y rechaza cualquier `typ` que no sea `barber` (los tokens
  viejos sin `typ` siguen valiendo). Nunca firmar un alumno con `createSession`.
- **Admin de la Academy** = `requireBarberAdmin` del host: token de barbero con `exp` y
  `admin: true`, **y** la fila de `barbers` existe, está activa y cumple la regla de admin de
  siempre (nombre/usuario/rol). "Abrir Academy" desde la pestaña del panel entra como propietario.
- **Mismo origen que el panel** (el token de Bruno vive en este localStorage): `/cursos/(.*)` tiene
  su propio `Content-Security-Policy` **enforced** y sin `'unsafe-inline'` en `script-src`
  (`vercel.json`), el mismo de PimpStudio; el resto del sitio sigue con el `Report-Only` global.
- **Pago**: todo por `api/mp-payments.js`, que desvía a `api/_academyProvision.js` en tres puntos:
  `POST {kind:'course'}` (con Mercado Pago configurado y 10 intentos por IP cada 5 min),
  `GET ?status=1&ref=aca-<32hex>` y el webhook cuando `external_reference` empieza con `aca-`
  (**antes** del filtro de "aprobado": un reembolso revoca el acceso). El webhook crea la cuenta y
  el acceso en un solo statement y manda usuario + contraseña temporal una sola vez aunque Mercado
  Pago repita el aviso. Las inscripciones viejas de `source: 'cursos'` (base64) siguen entrando
  como siempre. Tablas `academy_*` (sección al final de `db/schema.sql`), migradas solas por
  `ensureAcademyTables` (nunca desde el checkout, el webhook ni el login público).
- **Cron**: tercera tanda de `GET /api/push?job=reminders` (después del autocompletar, fuera del
  500 de los recordatorios, solo con `CRON_SECRET`): conciliación de pedidos, credenciales
  pendientes, recordatorios de eventos, resumen de actividad y limpieza. `?job=academy`
  (`CRON_SECRET` obligatorio, `&force=1`) la corre sola. Los avisos al panel van a los barberos
  admin (fila propia en `notifications` + `notifyBarber` sin log), nunca por `notifyAll`.
- **Push**: `public/sw.js` abre cada aviso en su sección — los del panel exactamente como antes
  (`/panel`), los de la Academy en `/cursos/...`.
- **Probar sin base**: `VITE_DEV_MOCKS=1 npm run dev` también monta el mock de la Academy
  (`scripts/dev-mock/academy/`, alumnos de prueba con contraseña `academy123`).

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
