# Graph Report - PIMPSTUDIO-desarrollo  (2026-07-21)

## Corpus Check
- 136 files · ~1,989,926 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1189 nodes · 2205 edges · 92 communities (63 shown, 29 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 54 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b4c2246b`
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
- estilo.js
- clients.js
- Bruno Feature Image
- Bruno Portrait Image
- Workshop 2026 Image
- Legacy Clientes Page
- Legacy Index Page
- Pagina HTML Booking Reserva
- Pagina HTML Cliente Reserva y Perfil
- bookings.js
- expenses.js
- Plan de mejora del Panel Interno (por etapas)
- services.js
- FintocCheckout.jsx
- lamp.jsx
- DetailSheets.swift
- String
- SwiftUI
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
- Booking.jsx
- bookings.js
- pimpstudio.cl (308 redirect to apex)
- CSS Scoped Under brunetti-site Class
- ELIJA agent layer (docs/knowledge/skills/scripts)
- server.js (legacy local SQLite backend)
- Archivos en desuso/ (legacy, gitignored)
- Brunetti · Barber Studio — Web + Panel (README)
- src/styles/estilo.css

## God Nodes (most connected - your core abstractions)
1. `DashboardModel` - 56 edges
2. `APIClient` - 34 edges
3. `CLP()` - 27 edges
4. `requireInternal()` - 22 edges
5. `Client` - 22 edges
6. `SessionStore` - 21 edges
7. `Dashboard()` - 20 edges
8. `Apple Design` - 20 edges
9. `BookingStatus` - 19 edges
10. `handler()` - 16 edges

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

## Communities (92 total, 29 thin omitted)

### Community 0 - "iOS Data Models"
Cohesion: 0.08
Nodes (20): App, ColorScheme, Data, Foundation, BrunettiCutzApp, RootView, AppTab, Date (+12 more)

### Community 1 - "iOS API Client"
Cohesion: 0.21
Nodes (29): Codable, Hashable, Identifiable, DemoData, Booking, APIEndpointStatus, APIHealth, AvailabilitySlot (+21 more)

### Community 2 - "Backend Auth & Project Docs"
Cohesion: 0.13
Nodes (15): Account, App(), BarberLogin, Booking, Cursos, Dashboard, EncuentraEstilo, Essentials (+7 more)

### Community 3 - "Workshop Page & Content"
Cohesion: 0.06
Nodes (35): FEATURE_CARDS, TESTIMONIALS, WK_BASE, WK_DIAS, WK_ED, WK_MESES, WORKSHOP, WORKSHOP_DATES (+27 more)

### Community 4 - "Vercel API Handlers"
Cohesion: 0.05
Nodes (76): b64url(), BARBER_PROFILES, fallbackLogin(), fallbackPasswords(), handleChangePassword(), handleLogin(), handler(), isAdmin() (+68 more)

### Community 5 - "Cursos.jsx"
Cohesion: 0.10
Nodes (27): react, addDays(), Bars(), BUSINESS_HOURS, CAT_COLORS, DashboardResumen(), DOW_ORDER, DOW_SHORT (+19 more)

### Community 6 - "Legacy Static Site (web/app.js)"
Cohesion: 0.07
Nodes (27): API Error Handling, Architecture, Backend (Vercel Functions), Build & Deployment, Build for production, Common Tasks, Database (PostgreSQL), Database schema setup (after cloning) (+19 more)

### Community 7 - "UI Components & Login"
Cohesion: 0.07
Nodes (25): Aggressive Escalation Triggers, Guidelines, Operating Posture, Part 1 — Findings table (REQUIRED), Part 2 — Verdict (REQUIRED), Remedial Preference Hierarchy, Required Output Format, Reviewing Animations (+17 more)

### Community 8 - "package.json Config"
Cohesion: 0.07
Nodes (26): dependencies, framer-motion, @neondatabase/serverless, react-dom, react-router-dom, @vercel/analytics, @vercel/blob, web-push (+18 more)

### Community 9 - "iOS Detail Sheets & Module Views"
Cohesion: 0.09
Nodes (30): Any, Decodable, Error, APIClient, APIError, badStatus, invalidURL, missingData (+22 more)

### Community 10 - "Fintoc Checkout & Site Nav"
Cohesion: 0.19
Nodes (12): FACE_SHAPES, GALLERY, GALLERY_CATS, HERO_PHOTOS, u(), CtaBand(), EncuentraEstilo(), Hero() (+4 more)

### Community 11 - "Booking Page & Static Data"
Cohesion: 0.08
Nodes (25): 2026-06-12 - Base operativa clientes, agenda y panel interno, 2026-06-13 - Rediseño UI para web y componentes responsivos, 2026-06-22 - Marca personal Brunetti (un solo barbero) + módulo Cursos + panel interno solo-Brunetti, 2026-06-24 - Hero Brunetti sin efecto gooey + modo claro pulido en todos los módulos, Archivos modificados, Archivos modificados, Archivos modificados, Archivos principales tocados (+17 more)

### Community 12 - "iOS Agenda & Reservations Views"
Cohesion: 0.09
Nodes (44): Charts, isoDate(), Date, BarberChartMode, ingresos, servicios, BarberDashboardCharts, BookingRow (+36 more)

### Community 13 - "ExpensesModule.jsx"
Cohesion: 0.39
Nodes (8): CATEGORY_META, daysInMonth(), EXPENSE_CATEGORIES, ExpenseModal(), ExpensesModule(), exportExpensesCSV(), metaOf(), monthKey()

### Community 14 - "workshop.js"
Cohesion: 0.09
Nodes (21): 1. Purpose & frequency, 2. Easing & duration, 3. Physicality & origin, 4. Interruptibility, 5. Performance, 6. Accessibility, 7. Cohesion & tokens, 8. Missed opportunities (+13 more)

### Community 15 - "EncuentraEstilo (Style Finder) Page"
Cohesion: 0.10
Nodes (20): 10. Gesture design details (the "feel" checklist), 11. Frame-level smoothness, 12. Materials & depth — translucency conveys hierarchy, 13. Multimodal feedback — motion + sound + haptics, 14. Reduced motion & accessibility, 15. Typography — optical sizing, tracking, leading, 16. Design foundations — the eight principles, 17. Process (+12 more)

### Community 16 - "Auth & Booking Concepts"
Cohesion: 0.24
Nodes (16): Admin Key Authentication (shared internal password pattern), Barber Availability Management (barber sets available slots per day), Barber Authentication Flow (username/password, sets active barber session), Dual Authentication System (client auth via phone vs barber/admin auth via username+password), Phone Number as Client Identity (celular = ID de cliente), Manual Slot Blocking (admin blocks time slots per barber per day), TNE Discount (20% for Tarjeta Nacional Estudiantil, non-Bruno services), PIMP STUDIO Logo (JPG, used as brand header/footer image) (+8 more)

### Community 17 - "ui.jsx"
Cohesion: 0.09
Nodes (18): ALL_MODULE_IDS, BarberModal(), emptyBarber, MODULES, PERMS, BookingSyncIssues(), MobileDock(), Brandmark() (+10 more)

### Community 18 - "iOS App Intents & Shortcuts"
Cohesion: 0.15
Nodes (12): AppEnum, AppIntent, AppIntents, AppShortcut, AppShortcutsProvider, DisplayRepresentation, IntentResult, AppTab (+4 more)

### Community 19 - "iOS Design System"
Cohesion: 0.11
Nodes (25): Axis, ButtonRole, CGFloat, BrunettiTheme, EmptyPanel, GlassActionButton, GlassField, GlassFormField (+17 more)

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
Cohesion: 0.11
Nodes (17): Animation Vocabulary, Easing — how speed changes over an animation, Entrances & Exits — how elements appear and disappear, Examples, Feedback & Interaction — responding to the user's actions, Glossary, Instructions, Looping & Ambient Motion — animations that run on their own (+9 more)

### Community 32 - "DashboardModel"
Cohesion: 0.28
Nodes (7): EditingContext, OverridesContext, Editable(), styleFromOverride(), DevEditProvider(), EditProvider(), beginDrag()

### Community 33 - "ELIJA Agent Knowledge Base"
Cohesion: 0.22
Nodes (8): Base de datos (Neon), Brunetti · Barber Studio — Web + Panel, Deploy, Estructura, Puesta en marcha (PC nuevo), Requisitos, Scripts, Variables de entorno

### Community 34 - "vercel.json Config"
Cohesion: 0.33
Nodes (5): buildCommand, framework, headers, outputDirectory, rewrites

### Community 36 - "Fintoc Payments API"
Cohesion: 0.25
Nodes (7): Abrir en Xcode, APIs usadas, Brunetti Cutz iOS, Build nativo e IPA, Funciones nativas incluidas, Servidor local, Sesion interna y fallback

### Community 37 - "Proposal Generator Script"
Cohesion: 0.12
Nodes (16): EditContext, ContainerScroll(), InteractiveSelector(), Sparkles(), CARD_IMAGES, CARDS, CAT_TAG, FALLBACK_SERVICES (+8 more)

### Community 38 - "CSS Stylesheets"
Cohesion: 0.14
Nodes (12): EditableText(), CHECKOUT_ITEMS, FlowCheckout(), ICONS, ModuleFooter(), NAV, SiteNav(), Lamp() (+4 more)

### Community 41 - "DetailSheets.swift"
Cohesion: 0.38
Nodes (5): Context, SafariView, URL, SFSafariViewController, UIViewControllerRepresentable

### Community 42 - "Auth Login API"
Cohesion: 0.15
Nodes (16): BookingsInbox(), CalendarModal(), FILTER_MAP, FILTERS, initialsOf(), NEXT_STATUS, ResCard(), ResModal() (+8 more)

### Community 43 - "Implementation Plan & CSS Scope"
Cohesion: 0.40
Nodes (4): Decisiones clave (confirmadas con el usuario), Estado / Checklist por fases, Notas de retoma (si se corta), Plan de implementación — Rediseño Brunetti (marca personal Bruno Herrera)

### Community 48 - "Cursos.jsx"
Cohesion: 0.10
Nodes (19): 2.1 Cabecera propia de Agenda (reconciliada), 2.2 Hero + KPIs (reestilizar el `dk-hero` existente), 2.3 Navegación semana/día, 2.4 Date-picker popover (NUEVO — componente `AgendaDatePicker`), 2.5 Acciones masivas, 2.6 Layout principal (`agenda-layout`, grid `1.55fr .9fr`), 2.7 Modal detalle (NUEVO — componente `BookingDetailModal`), 2.8 Toasts (NUEVO — contenedor fijo) (+11 more)

### Community 51 - "interactive-selector.jsx"
Cohesion: 0.34
Nodes (15): addLocalBooking(), cancelKeyOf(), cancelLocalBooking(), isCancelled(), isOrphanLocalBooking(), markLocalBookingSynced(), matchKeyOf(), mergeBookings() (+7 more)

### Community 53 - "estilo.js"
Cohesion: 0.29
Nodes (7): autoTheme(), FloatingThemeToggle(), santiagoHour(), ThemeCtx, ThemeProvider(), ThemeToggle(), useTheme()

### Community 54 - "clients.js"
Cohesion: 0.22
Nodes (8): Accessibility, Design Engineering, Initial Response, prefers-reduced-motion, Review Checklist, Review Format (Required), Stagger Animations, Touch device hover states

### Community 66 - "bookings.js"
Cohesion: 0.25
Nodes (8): Animate enter states with @starting-style, Buttons must feel responsive, Component Building Principles, Make popovers origin-aware, Never animate from scale(0), Tooltips: skip delay on subsequent hovers, Use blur to mask imperfect transitions, Use CSS transitions over keyframes for interruptible UI

### Community 67 - "expenses.js"
Cohesion: 0.33
Nodes (6): 1. Should this animate at all?, 2. What is the purpose?, 3. What easing should it use?, 4. How fast should it be?, Perceived performance, The Animation Decision Framework

### Community 68 - "Plan de mejora del Panel Interno (por etapas)"
Cohesion: 0.17
Nodes (11): Diagnóstico (estado actual), Etapa 0 — Fundaciones adaptativas (sistema, no parches), Etapa 1 — Agenda (el módulo con más aire muerto), Etapa 2 — Clientes (cards → tabla densa), Etapa 3 — Reservas (inbox operativo), Etapa 4 — Resumen (dashboard ejecutivo), Etapa 5 — Finanzas + Gastos, Etapa 6 — Servicios, Inscripciones, Marketing, Config (+3 more)

### Community 69 - "services.js"
Cohesion: 0.33
Nodes (6): clip-path for Animation, Comparison sliders, Hold-to-delete pattern, Image reveals on scroll, Tabs with perfect color transitions, The inset shape

### Community 71 - "FintocCheckout.jsx"
Cohesion: 0.16
Nodes (11): DashboardModel, Date, Double, String, URL, ClientSheet, EnrollmentSheet, ExpenseSheet (+3 more)

### Community 72 - "lamp.jsx"
Cohesion: 0.33
Nodes (6): CSS animations beat JS under load, CSS variables are inheritable, Framer Motion hardware acceleration caveat, Only animate transform and opacity, Performance Rules, Use WAAPI for programmatic CSS animations

### Community 74 - "DetailSheets.swift"
Cohesion: 0.13
Nodes (21): BookingDraftSheet, BookingSheet, encoded(), reminderDate(), scheduleReminder(), StatusChoiceButton, Booking, Bool (+13 more)

### Community 75 - "String"
Cohesion: 0.33
Nodes (6): Damping at boundaries, Friction instead of hard stops, Gesture and Drag Interactions, Momentum-based dismissal, Multi-touch protection, Pointer capture for drag

### Community 76 - "SwiftUI"
Cohesion: 0.40
Nodes (5): 3D transforms for depth, CSS Transform Mastery, scale() scales children too, transform-origin, translateY with percentages

### Community 79 - "theme.jsx"
Cohesion: 0.40
Nodes (5): Asymmetric enter/exit timing, Cohesion matters, Review your work the next day, The opacity + height combination, The Sonner Principles (Building Loved Components)

### Community 83 - "Spring Animations"
Cohesion: 0.40
Nodes (5): Interruptibility advantage, Spring Animations, Spring-based mouse interactions, Spring configuration, When to use springs

### Community 84 - "Core Philosophy"
Cohesion: 0.50
Nodes (4): Beauty is leverage, Core Philosophy, Taste is trained, not innate, Unseen details compound

### Community 85 - "BarberLogin.jsx"
Cohesion: 0.60
Nodes (5): BARBERS, BarberLogin(), clearLockout(), getLockout(), setLockout()

### Community 86 - "ADMIN_API_TOKEN env var"
Cohesion: 0.34
Nodes (11): addToCart(), cartCount(), clearCart(), readCart(), removeFromCart(), setQty(), writeCart(), scrollToId() (+3 more)

### Community 87 - "MobileDock.jsx"
Cohesion: 0.50
Nodes (4): Debugging Animations, Frame-by-frame inspection, Slow motion testing, Test on real devices

### Community 90 - "Booking.jsx"
Cohesion: 0.22
Nodes (8): DashboardView, ModuleHost, AppTab, Int, LoginView, Bool, SafariServices, SwiftUI

### Community 92 - "bookings.js"
Cohesion: 0.12
Nodes (16): CaseIterable, DashboardFocus, dia, semana, workshop, AppTab, clientes, finanzas (+8 more)

## Knowledge Gaps
- **402 isolated node(s):** `dev-wrapper.sh script`, `NVM_DIR`, `DEMO_PRODUCTS`, `STATIC_BARBERS`, `DEMO_BOOKINGS` (+397 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **29 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DashboardModel` connect `FintocCheckout.jsx` to `iOS Data Models`, `iOS API Client`, `iOS Detail Sheets & Module Views`, `DetailSheets.swift`, `iOS Agenda & Reservations Views`, `Booking.jsx`, `bookings.js`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `dependencies` connect `package.json Config` to `Cursos.jsx`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `react` connect `Cursos.jsx` to `package.json Config`, `BarberLogin.jsx`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `dev-wrapper.sh script`, `NVM_DIR`, `DEMO_PRODUCTS` to the rest of the system?**
  _409 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `iOS Data Models` be split into smaller, more focused modules?**
  _Cohesion score 0.08013937282229965 - nodes in this community are weakly interconnected._
- **Should `Backend Auth & Project Docs` be split into smaller, more focused modules?**
  _Cohesion score 0.1286549707602339 - nodes in this community are weakly interconnected._
- **Should `Workshop Page & Content` be split into smaller, more focused modules?**
  _Cohesion score 0.05952380952380952 - nodes in this community are weakly interconnected._