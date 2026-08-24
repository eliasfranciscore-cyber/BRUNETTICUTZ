# Graph Report - BRUNETTICUTZ  (2026-08-14)

## Corpus Check
- 141 files · ~2,001,775 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1258 nodes · 2128 edges · 146 communities (69 shown, 77 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `60fe67af`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- iOS Data Models
- iOS API Client
- Backend Auth & Project Docs
- Workshop Page & Content
- Vercel API Handlers
- Cursos.jsx
- Legacy Static Site (web/app.js)
- UI Components & Login
- package.json Config
- iOS Detail Sheets & Module Views
- Fintoc Checkout & Site Nav
- Booking Page & Static Data
- iOS Agenda & Reservations Views
- ExpensesModule.jsx
- workshop.js
- EncuentraEstilo (Style Finder) Page
- Auth & Booking Concepts
- ui.jsx
- iOS App Intents & Shortcuts
- iOS Design System
- data.js
- iOS Booking Sheet & Reminders
- BookingsInbox.jsx
- index.html PWA Setup
- ModuleFooter.jsx
- iOS Codable Keys
- Bruno Hero Image Assets
- iOS Dashboard & Login Views
- Estilo Teaser Image Assets
- Legacy ELIJA Agent Docs
- BookingsInbox.jsx
- enrollmentsStore.js
- DashboardModel
- ELIJA Agent Knowledge Base
- vercel.json Config
- Register Client API
- Fintoc Payments API
- Proposal Generator Script
- CSS Stylesheets
- Claude Dev Wrapper Script
- Proposal Templates & Inbox Demo
- DetailSheets.swift
- Auth Login API
- Implementation Plan & CSS Scope
- Gallery Image 1
- Gallery Image 2
- Gallery Image 3
- PIMP Studio Logo Assets
- Cursos.jsx
- Vite Config & Fintoc Mock
- Legacy Contact & Cursos Pages
- interactive-selector.jsx
- Component Building Principles
- estilo.js
- clients.js
- Bruno Feature Image
- Bruno Portrait Image
- Workshop 2026 Image
- Legacy Clientes Page
- Legacy Index Page
- Pagina HTML Booking Reserva
- Pagina HTML Cliente Reserva y Perfil
- The Animation Decision Framework
- bookings.js
- expenses.js
- Plan de mejora del Panel Interno (por etapas)
- services.js
- CSS Transform Mastery
- FintocCheckout.jsx
- lamp.jsx
- Plan de implementación — Rediseño Brunetti (marca personal Bruno Herrera)
- DetailSheets.swift
- String
- SwiftUI
- dev-wrapper.sh
- Booking
- theme.jsx
- Brunetti single-barber rebrand
- Hero gooey-effect removal
- Light-mode polish pass
- Spring Animations
- Core Philosophy
- BarberLogin.jsx
- ADMIN_API_TOKEN env var
- MobileDock.jsx
- brunetticutz.cl (production domain)
- AppTab
- Booking.jsx
- Date
- bookings.js
- Booking
- Date
- pimpstudio.cl (308 redirect to apex)
- Double
- Int
- String
- URL
- CSS Scoped Under brunetti-site Class
- AppTab
- Int
- URL
- Booking
- Bool
- Color
- String
- Void
- Booking
- Bool
- Date
- Int
- String
- ELIJA agent layer (docs/knowledge/skills/scripts)
- server.js (legacy local SQLite backend)
- Archivos en desuso/ (legacy, gitignored)
- Brunetti · Barber Studio — Web + Panel (README)
- URL
- Void
- String
- Bool
- src/styles/estilo.css
- Bool
- Color
- Date
- Int
- Booking
- Bool
- Color
- Date
- Double
- Int
- String
- Void
- Bool
- Date
- Int
- String
- walletPrompt.js
- auth-barber.js
- APIError
- BookingStatus
- View
- SettingsView
- HoyView

## God Nodes (most connected - your core abstractions)
1. `CLP()` - 27 edges
2. `APIClient` - 25 edges
3. `requireInternal()` - 22 edges
4. `handler()` - 21 edges
5. `Dashboard()` - 21 edges
6. `Apple Design` - 20 edges
7. `handler()` - 18 edges
8. `Icon()` - 18 edges
9. `SessionStore` - 16 edges
10. `Design Engineering` - 16 edges

## Surprising Connections (you probably didn't know these)
- `PIMP STUDIO Logo (JPG, used as brand header/footer image)` --semantically_similar_to--> `PIMP STUDIO Logo JPG (web/assets copy)`  [INFERRED] [semantically similar]
  public/assets/pimp-studio-logo.jpg → web/assets/pimp-studio-logo.jpg
- `Dashboard Page (Client Panel)` --references--> `PIMP STUDIO Logo (JPG, used as brand header/footer image)`  [EXTRACTED]
  web/dashboard.html → public/assets/pimp-studio-logo.jpg
- `Gallery Image 1 (barbershop work/style photo)` --semantically_similar_to--> `Gallery Image 1 (web/assets copy)`  [INFERRED] [semantically similar]
  public/assets/gallery-1.jpg → web/assets/gallery-1.jpg
- `Gallery Image 2 (barbershop work/style photo)` --semantically_similar_to--> `Gallery Image 2 (web/assets copy)`  [INFERRED] [semantically similar]
  public/assets/gallery-2.png → web/assets/gallery-2.png
- `Gallery Image 3 (barbershop work/style photo)` --semantically_similar_to--> `Gallery Image 3 (web/assets copy)`  [INFERRED] [semantically similar]
  public/assets/gallery-3.jpg → web/assets/gallery-3.jpg

## Import Cycles
- None detected.

## Communities (146 total, 77 thin omitted)

### Community 0 - "iOS Data Models"
Cohesion: 0.14
Nodes (5): DashboardFocus, dia, semana, workshop, DashboardModel

### Community 1 - "iOS API Client"
Cohesion: 0.23
Nodes (26): Codable, Hashable, Identifiable, String, APIEndpointStatus, APIHealth, AvailabilitySlot, Barber (+18 more)

### Community 2 - "Backend Auth & Project Docs"
Cohesion: 0.12
Nodes (16): Account, App(), BarberLogin, Booking, CardShare, Cursos, Dashboard, EncuentraEstilo (+8 more)

### Community 3 - "Workshop Page & Content"
Cohesion: 0.06
Nodes (35): FEATURE_CARDS, TESTIMONIALS, WK_BASE, WK_DIAS, WK_ED, WK_MESES, WORKSHOP, WORKSHOP_DATES (+27 more)

### Community 4 - "Vercel API Handlers"
Cohesion: 0.06
Nodes (78): b64url(), createSession(), handler(), readSession(), requireInternal(), sign(), businessDateKey(), businessNowMinutes() (+70 more)

### Community 5 - "Cursos.jsx"
Cohesion: 0.08
Nodes (35): addDays(), Bars(), BUSINESS_HOURS, CAT_COLORS, DashboardResumen(), DOW_ORDER, DOW_SHORT, getSvcIconByName() (+27 more)

### Community 6 - "Legacy Static Site (web/app.js)"
Cohesion: 0.07
Nodes (28): API Error Handling, Architecture, Backend (Vercel Functions), Build & Deployment, Build for production, Common Tasks, Database (PostgreSQL), Database schema setup (after cloning) (+20 more)

### Community 7 - "UI Components & Login"
Cohesion: 0.07
Nodes (25): Aggressive Escalation Triggers, Guidelines, Operating Posture, Part 1 — Findings table (REQUIRED), Part 2 — Verdict (REQUIRED), Remedial Preference Hierarchy, Required Output Format, Reviewing Animations (+17 more)

### Community 8 - "package.json Config"
Cohesion: 0.07
Nodes (26): dependencies, framer-motion, @neondatabase/serverless, react-dom, react-router-dom, @vercel/analytics, @vercel/blob, web-push (+18 more)

### Community 9 - "iOS Detail Sheets & Module Views"
Cohesion: 0.17
Nodes (4): Any, T, APIClient, cleanPhone()

### Community 10 - "Fintoc Checkout & Site Nav"
Cohesion: 0.19
Nodes (12): FACE_SHAPES, GALLERY, GALLERY_CATS, HERO_PHOTOS, u(), CtaBand(), EncuentraEstilo(), Hero() (+4 more)

### Community 11 - "Booking Page & Static Data"
Cohesion: 0.08
Nodes (25): 2026-06-12 - Base operativa clientes, agenda y panel interno, 2026-06-13 - Rediseño UI para web y componentes responsivos, 2026-06-22 - Marca personal Brunetti (un solo barbero) + módulo Cursos + panel interno solo-Brunetti, 2026-06-24 - Hero Brunetti sin efecto gooey + modo claro pulido en todos los módulos, Archivos modificados, Archivos modificados, Archivos modificados, Archivos principales tocados (+17 more)

### Community 12 - "iOS Agenda & Reservations Views"
Cohesion: 0.14
Nodes (22): Charts, ServiceRevenue, BarberDashboardCharts, BookingRow, ClientsView, DayRevenue, EnrollmentsView, exportBookingsCSV() (+14 more)

### Community 13 - "ExpensesModule.jsx"
Cohesion: 0.07
Nodes (27): 1.1 Helper de puente entrante, 1.2 Mover la lógica de acreditación a `api/_loyalty.js`, 1.3 Modos nuevos en `api/clients.js` (PimpStudio), 1.4 Quitar la acreditación de `bruno-agenda.js`, 1.5 Migración SQL, 1. Qué ya existe (no se rehace nada de esto), 2.1 Cliente del puente: `api/_loyaltyBridge.js` (archivo nuevo con `_`, no cuenta como función), 2.2 Hook en el `PATCH` de `api/bookings.js` (BrunettiCutz, ~línea 350) (+19 more)

### Community 14 - "workshop.js"
Cohesion: 0.09
Nodes (21): 1. Purpose & frequency, 2. Easing & duration, 3. Physicality & origin, 4. Interruptibility, 5. Performance, 6. Accessibility, 7. Cohesion & tokens, 8. Missed opportunities (+13 more)

### Community 15 - "EncuentraEstilo (Style Finder) Page"
Cohesion: 0.06
Nodes (24): App, AppEnum, AppIntent, AppIntents, AppShortcut, AppShortcutsProvider, Data, DisplayRepresentation (+16 more)

### Community 16 - "Auth & Booking Concepts"
Cohesion: 0.24
Nodes (16): Admin Key Authentication (shared internal password pattern), Barber Availability Management (barber sets available slots per day), Barber Authentication Flow (username/password, sets active barber session), Dual Authentication System (client auth via phone vs barber/admin auth via username+password), Phone Number as Client Identity (celular = ID de cliente), Manual Slot Blocking (admin blocks time slots per barber per day), TNE Discount (20% for Tarjeta Nacional Estudiantil, non-Bruno services), PIMP STUDIO Logo (JPG, used as brand header/footer image) (+8 more)

### Community 17 - "ui.jsx"
Cohesion: 0.10
Nodes (17): ALL_MODULE_IDS, BarberModal(), emptyBarber, MODULES, PERMS, BookingSyncIssues(), MobileDock(), Emblem() (+9 more)

### Community 18 - "iOS App Intents & Shortcuts"
Cohesion: 0.24
Nodes (14): Decodable, AvailabilityResponse, BarbersResponse, BookingResponse, BookingsResponse, ClientResponse, ClientsResponse, EmptyResponse (+6 more)

### Community 19 - "iOS Design System"
Cohesion: 0.11
Nodes (21): Axis, ButtonRole, CGFloat, LinearGradient, TextInputAutocapitalization, UIColor, UIImpactFeedbackGenerator, UIKeyboardType (+13 more)

### Community 20 - "data.js"
Cohesion: 0.13
Nodes (23): GlareCard(), ALL_SLOTS, CAT_LABEL, CLIENT_APPTS, CLIENTS, DAYS_ES, EXPENSES, MONTHS_ES (+15 more)

### Community 21 - "iOS Booking Sheet & Reminders"
Cohesion: 0.17
Nodes (19): ASSETS_DIR, CONTENT_DIR, CORS, fileFromEditId(), fileQueues, handleListAssets(), handleSave(), handleSaveOverride() (+11 more)

### Community 22 - "BookingsInbox.jsx"
Cohesion: 0.12
Nodes (34): isAdminUser(), AGENDA_SLOTS, AgendaDatePicker(), blocksToMin(), buildWeek(), CFG_SECTIONS, ConfigPanel(), Dashboard() (+26 more)

### Community 23 - "index.html PWA Setup"
Cohesion: 0.22
Nodes (9): apple-touch-icon PNG 180 rationale, Blackletter fonts (Pirata One, Manufacturing Consent), format-detection=telephone=no meta rationale, ps_theme_manual / ps_theme localStorage keys, theme-color meta dynamic sync rationale, index.html (entry, meta/PWA/no-flash theme), Hero image LCP preload (bruno-hero.jpg), No-flash theme init script (Santiago timezone based) (+1 more)

### Community 24 - "ModuleFooter.jsx"
Cohesion: 0.19
Nodes (14): ClientModal(), badgeClass(), GlobalSearch(), DEFAULT_SLOTS, NewBookingModal(), STATUS_OPTIONS, STEP_LABELS, svcIcon() (+6 more)

### Community 25 - "iOS Codable Keys"
Cohesion: 0.18
Nodes (11): CodingKey, CodingKeys, createdAt, edition, email, id, level, message (+3 more)

### Community 26 - "Bruno Hero Image Assets"
Cohesion: 0.29
Nodes (11): Background text: 'El cliente...' (partially visible), Barber (Bruno Brunetti), Dark patterned barber cape, Client in barber cape receiving haircut, Green barber comb (tool), Context: live demo or barbering course/event, Lapel/headset microphone worn by barber, Hero Photo: Brunetti Barber in Action (+3 more)

### Community 27 - "iOS Dashboard & Login Views"
Cohesion: 0.33
Nodes (3): editor, ROOT, vite

### Community 28 - "Estilo Teaser Image Assets"
Cohesion: 0.29
Nodes (10): Barber / Instructor (PIMP & STUDIOS branded, tattooed, glasses, mic), Barbershop / studio interior with white brick wall, Client seated in barber chair wearing cape, Haircut / styling service in progress, estilo-teaser.jpg (style module teaser image), PIMP & STUDIOS brand logo (on barber shirt), Mood: professional, focused, editorial photography, Ring light (professional studio lighting behind barber) (+2 more)

### Community 30 - "BookingsInbox.jsx"
Cohesion: 0.10
Nodes (20): 10. Gesture design details (the "feel" checklist), 11. Frame-level smoothness, 12. Materials & depth — translucency conveys hierarchy, 13. Multimodal feedback — motion + sound + haptics, 14. Reduced motion & accessibility, 15. Typography — optical sizing, tracking, leading, 16. Design foundations — the eight principles, 17. Process (+12 more)

### Community 32 - "DashboardModel"
Cohesion: 0.28
Nodes (7): EditingContext, OverridesContext, Editable(), styleFromOverride(), DevEditProvider(), EditProvider(), beginDrag()

### Community 33 - "ELIJA Agent Knowledge Base"
Cohesion: 0.10
Nodes (19): 2.1 Cabecera propia de Agenda (reconciliada), 2.2 Hero + KPIs (reestilizar el `dk-hero` existente), 2.3 Navegación semana/día, 2.4 Date-picker popover (NUEVO — componente `AgendaDatePicker`), 2.5 Acciones masivas, 2.6 Layout principal (`agenda-layout`, grid `1.55fr .9fr`), 2.7 Modal detalle (NUEVO — componente `BookingDetailModal`), 2.8 Toasts (NUEVO — contenedor fijo) (+11 more)

### Community 34 - "vercel.json Config"
Cohesion: 0.11
Nodes (17): Animation Vocabulary, Easing — how speed changes over an animation, Entrances & Exits — how elements appear and disappear, Examples, Feedback & Interaction — responding to the user's actions, Glossary, Instructions, Looping & Ambient Motion — animations that run on their own (+9 more)

### Community 36 - "Fintoc Payments API"
Cohesion: 0.17
Nodes (11): Diagnóstico (estado actual), Etapa 0 — Fundaciones adaptativas (sistema, no parches), Etapa 1 — Agenda (el módulo con más aire muerto), Etapa 2 — Clientes (cards → tabla densa), Etapa 3 — Reservas (inbox operativo), Etapa 4 — Resumen (dashboard ejecutivo), Etapa 5 — Finanzas + Gastos, Etapa 6 — Servicios, Inscripciones, Marketing, Config (+3 more)

### Community 37 - "Proposal Generator Script"
Cohesion: 0.11
Nodes (17): EditContext, NAV, SiteNav(), ContainerScroll(), InteractiveSelector(), CARD_IMAGES, CARDS, CAT_TAG (+9 more)

### Community 38 - "CSS Stylesheets"
Cohesion: 0.15
Nodes (11): EditableText(), CHECKOUT_ITEMS, FlowCheckout(), ICONS, ModuleFooter(), Lamp(), Sparkles(), INCLUDE_ICONS (+3 more)

### Community 39 - "Claude Dev Wrapper Script"
Cohesion: 0.44
Nodes (9): cleanPhone(), flowRequest(), handleCheckout(), handler(), handleReturn(), handleStatus(), handleWebhook(), signParams() (+1 more)

### Community 41 - "DetailSheets.swift"
Cohesion: 0.47
Nodes (4): Context, SFSafariViewController, UIViewControllerRepresentable, SafariView

### Community 42 - "Auth Login API"
Cohesion: 0.15
Nodes (16): BookingsInbox(), CalendarModal(), FILTER_MAP, FILTERS, initialsOf(), NEXT_STATUS, ResCard(), ResModal() (+8 more)

### Community 43 - "Implementation Plan & CSS Scope"
Cohesion: 0.22
Nodes (8): Accessibility, Design Engineering, Initial Response, prefers-reduced-motion, Review Checklist, Review Format (Required), Stagger Animations, Touch device hover states

### Community 48 - "Cursos.jsx"
Cohesion: 0.22
Nodes (8): Base de datos (Neon), Brunetti · Barber Studio — Web + Panel, Deploy, Estructura, Puesta en marcha (PC nuevo), Requisitos, Scripts, Variables de entorno

### Community 51 - "interactive-selector.jsx"
Cohesion: 0.35
Nodes (14): addLocalBooking(), cancelKeyOf(), cancelLocalBooking(), isCancelled(), isOrphanLocalBooking(), markLocalBookingSynced(), matchKeyOf(), mergeBookings() (+6 more)

### Community 52 - "Component Building Principles"
Cohesion: 0.25
Nodes (8): Animate enter states with @starting-style, Buttons must feel responsive, Component Building Principles, Make popovers origin-aware, Never animate from scale(0), Tooltips: skip delay on subsequent hovers, Use blur to mask imperfect transitions, Use CSS transitions over keyframes for interruptible UI

### Community 53 - "estilo.js"
Cohesion: 0.29
Nodes (7): autoTheme(), FloatingThemeToggle(), santiagoHour(), ThemeCtx, ThemeProvider(), ThemeToggle(), useTheme()

### Community 54 - "clients.js"
Cohesion: 0.25
Nodes (7): Abrir en Xcode, APIs usadas, Brunetti Cutz iOS, Build nativo e IPA, Funciones nativas incluidas, Servidor local, Sesion interna y fallback

### Community 65 - "The Animation Decision Framework"
Cohesion: 0.33
Nodes (6): 1. Should this animate at all?, 2. What is the purpose?, 3. What easing should it use?, 4. How fast should it be?, Perceived performance, The Animation Decision Framework

### Community 66 - "bookings.js"
Cohesion: 0.33
Nodes (6): clip-path for Animation, Comparison sliders, Hold-to-delete pattern, Image reveals on scroll, Tabs with perfect color transitions, The inset shape

### Community 67 - "expenses.js"
Cohesion: 0.33
Nodes (6): CSS animations beat JS under load, CSS variables are inheritable, Framer Motion hardware acceleration caveat, Only animate transform and opacity, Performance Rules, Use WAAPI for programmatic CSS animations

### Community 68 - "Plan de mejora del Panel Interno (por etapas)"
Cohesion: 0.33
Nodes (6): Damping at boundaries, Friction instead of hard stops, Gesture and Drag Interactions, Momentum-based dismissal, Multi-touch protection, Pointer capture for drag

### Community 69 - "services.js"
Cohesion: 0.33
Nodes (5): buildCommand, framework, headers, outputDirectory, rewrites

### Community 70 - "CSS Transform Mastery"
Cohesion: 0.40
Nodes (5): 3D transforms for depth, CSS Transform Mastery, scale() scales children too, transform-origin, translateY with percentages

### Community 71 - "FintocCheckout.jsx"
Cohesion: 0.40
Nodes (5): Asymmetric enter/exit timing, Cohesion matters, Review your work the next day, The opacity + height combination, The Sonner Principles (Building Loved Components)

### Community 72 - "lamp.jsx"
Cohesion: 0.40
Nodes (5): Interruptibility advantage, Spring Animations, Spring-based mouse interactions, Spring configuration, When to use springs

### Community 73 - "Plan de implementación — Rediseño Brunetti (marca personal Bruno Herrera)"
Cohesion: 0.40
Nodes (4): Decisiones clave (confirmadas con el usuario), Estado / Checklist por fases, Notas de retoma (si se corta), Plan de implementación — Rediseño Brunetti (marca personal Bruno Herrera)

### Community 74 - "DetailSheets.swift"
Cohesion: 0.10
Nodes (13): UserNotifications, BookingDraftSheet, BookingSheet, ClientSheet, encoded(), EnrollmentSheet, ExpenseSheet, PaymentSheet (+5 more)

### Community 75 - "String"
Cohesion: 0.50
Nodes (4): Beauty is leverage, Core Philosophy, Taste is trained, not innate, Unseen details compound

### Community 76 - "SwiftUI"
Cohesion: 0.50
Nodes (4): Debugging Animations, Frame-by-frame inspection, Slow motion testing, Test on real devices

### Community 85 - "BarberLogin.jsx"
Cohesion: 0.60
Nodes (5): BARBERS, BarberLogin(), clearLockout(), getLockout(), setLockout()

### Community 86 - "ADMIN_API_TOKEN env var"
Cohesion: 0.34
Nodes (11): addToCart(), cartCount(), clearCart(), readCart(), removeFromCart(), setQty(), writeCart(), scrollToId() (+3 more)

### Community 90 - "Booking.jsx"
Cohesion: 0.20
Nodes (7): ColorScheme, SafariServices, SwiftUI, RootView, DashboardView, ModuleHost, LoginView

### Community 92 - "bookings.js"
Cohesion: 0.13
Nodes (15): CaseIterable, Sendable, AppTab, clientes, finanzas, hoy, mas, reservas (+7 more)

### Community 139 - "walletPrompt.js"
Cohesion: 0.24
Nodes (16): Brandmark(), useAutoWalletPrompt(), WalletPrompt(), Account(), CardShare(), fetchGoogleWalletSaveURL(), fetchGoogleWalletSaveURLByToken(), fetchTarjetaInfo() (+8 more)

### Community 140 - "auth-barber.js"
Cohesion: 0.44
Nodes (9): BARBER_PROFILES, fallbackLogin(), fallbackPasswords(), handleChangePassword(), handleLogin(), handler(), isAdmin(), isValidPassword() (+1 more)

### Community 141 - "APIError"
Cohesion: 0.33
Nodes (6): Error, LocalizedError, APIError, badStatus, invalidURL, missingData

### Community 142 - "BookingStatus"
Cohesion: 0.33
Nodes (6): BookingStatus, cancelada, completada, confirmada, enCurso, pendiente

### Community 143 - "View"
Cohesion: 0.33
Nodes (5): FilterChip, ProgressRow, SearchField, View, WeekStrip

## Knowledge Gaps
- **426 isolated node(s):** `dev-wrapper.sh script`, `NVM_DIR`, `BASE`, `DEMO_PRODUCTS`, `STATIC_BARBERS` (+421 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **77 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Cursos.jsx` to `package.json Config`, `BarberLogin.jsx`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `dependencies` connect `package.json Config` to `Cursos.jsx`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `EnrollmentsPanel()` connect `Cursos.jsx` to `Workshop Page & Content`, `BookingsInbox.jsx`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `dev-wrapper.sh script`, `NVM_DIR`, `BASE` to the rest of the system?**
  _433 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `iOS Data Models` be split into smaller, more focused modules?**
  _Cohesion score 0.14166666666666666 - nodes in this community are weakly interconnected._
- **Should `Backend Auth & Project Docs` be split into smaller, more focused modules?**
  _Cohesion score 0.12105263157894737 - nodes in this community are weakly interconnected._
- **Should `Workshop Page & Content` be split into smaller, more focused modules?**
  _Cohesion score 0.05952380952380952 - nodes in this community are weakly interconnected._