# Graph Report - BRUNETTICUTZ  (2026-09-24)

## Corpus Check
- 189 files · ~2,311,904 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1968 nodes · 4574 edges · 160 communities (87 shown, 73 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 68 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a5b289e6`
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
- build-engraving-svg.py
- EncuentraEstilo (Style Finder) Page
- Auth & Booking Concepts
- ui.jsx
- iOS App Intents & Shortcuts
- iOS Design System
- data.js
- iOS Booking Sheet & Reminders
- BookingsInbox.jsx
- index.html PWA Setup
- enrollmentsStore.js
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
- CLP
- push.js
- Gallery Image 1
- Gallery Image 2
- Gallery Image 3
- PIMP Studio Logo Assets
- Cursos.jsx
- Vite Config & Fintoc Mock
- Legacy Contact & Cursos Pages
- interactive-selector.jsx
- AppTab
- estilo.js
- clients.js
- Bruno Feature Image
- Bruno Portrait Image
- Workshop 2026 Image
- Legacy Clientes Page
- Legacy Index Page
- Pagina HTML Booking Reserva
- Pagina HTML Cliente Reserva y Perfil
- _products.js
- DashboardResumen.jsx
- _email.js
- PedidosTab.jsx
- services.js
- _bookingLife.js
- workshop.js
- EssentialsGracias.jsx
- Plan de implementación — Rediseño Brunetti (marca personal Bruno Herrera)
- DetailSheets.swift
- _auth.js
- buildWatch.js
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
- _money.js
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
- push.js
- cleanPhone
- AppTab
- M3 · La estructura del video viral
- M5 · Del scroll a la silla
- Dinámicas y ejercicios
- M2 · Ideas virales
- M1 · Valer más
- Cifras del workshop
- README.md
- Identidad visual
- Brief del día — Workshop de 6 horas
- M4 · La calculadora de viralidad
- ChargeSheet.jsx
- OpenBrunettiModuleIntent
- cleanPhone
- DashboardFocus
- _notion.js
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `CLP()` - 69 edges
2. `fmtDate()` - 47 edges
3. `ASCENSIÓN — El barbero que cobra lo que vale` - 40 edges
4. `requireInternal()` - 38 edges
5. `useIsPhone()` - 36 edges
6. `Icon()` - 35 edges
7. `Dashboard()` - 34 edges
8. `handler()` - 31 edges
9. `Button` - 29 edges
10. `santiagoDateKey()` - 27 edges

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

## Communities (160 total, 73 thin omitted)

### Community 0 - "iOS Data Models"
Cohesion: 0.06
Nodes (30): dependencies, framer-motion, lenis, @neondatabase/serverless, react, react-dom, react-router-dom, @vercel/analytics (+22 more)

### Community 1 - "iOS API Client"
Cohesion: 0.16
Nodes (33): Codable, Hashable, Identifiable, String, APIEndpointStatus, APIHealth, AvailabilitySlot, Barber (+25 more)

### Community 2 - "Backend Auth & Project Docs"
Cohesion: 0.08
Nodes (25): Account, BarberLogin, Booking, CardShare, Cursos, Dashboard, EncuentraEstilo, Essentials (+17 more)

### Community 3 - "Workshop Page & Content"
Cohesion: 0.09
Nodes (22): WORKSHOP_GALLERY, calc(), Footer(), formatCLP(), Hero(), ParallaxGallery(), Pricing(), PX_LAYOUTS (+14 more)

### Community 4 - "Vercel API Handlers"
Cohesion: 0.18
Nodes (28): purgeLoyaltyForClient(), isBridgeRequest(), normalizePhone(), bridgeClientList(), cleanPhone(), DEMO_CLIENTS, handleBridgeClients(), handler() (+20 more)

### Community 5 - "Cursos.jsx"
Cohesion: 0.27
Nodes (9): AnimatedRing(), CountUp(), Donut(), prefersReduced(), ProgressBar(), Sparkline(), useCountUp(), Icon() (+1 more)

### Community 6 - "Legacy Static Site (web/app.js)"
Cohesion: 0.05
Nodes (41): API Error Handling, Architecture, Auth, Auto-complete, Backend (Vercel Functions), Barbers modes (`api/barbers.js`), Booking modes (`api/bookings.js`), Build & Deployment (+33 more)

### Community 7 - "UI Components & Login"
Cohesion: 0.11
Nodes (33): BookingCard(), BookingRow(), BookingsInbox(), cx(), FILTER_MAP, FILTERS, initialCardsView, mondayOf() (+25 more)

### Community 8 - "package.json Config"
Cohesion: 0.07
Nodes (74): accountKeys(), BARBER_PROFILES, envFallback(), failedLogin(), fallbackLogin(), fallbackPasswords(), handleAccountUpdate(), handleLogin() (+66 more)

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
Cohesion: 0.09
Nodes (30): Charts, ServiceRevenue, UNAuthorizationStatus, BarberDashboardCharts, BookingRow, ClientsView, DayRevenue, EnrollmentsView (+22 more)

### Community 13 - "ExpensesModule.jsx"
Cohesion: 0.07
Nodes (27): 1.1 Helper de puente entrante, 1.2 Mover la lógica de acreditación a `api/_loyalty.js`, 1.3 Modos nuevos en `api/clients.js` (PimpStudio), 1.4 Quitar la acreditación de `bruno-agenda.js`, 1.5 Migración SQL, 1. Qué ya existe (no se rehace nada de esto), 2.1 Cliente del puente: `api/_loyaltyBridge.js` (archivo nuevo con `_`, no cuenta como función), 2.2 Hook en el `PATCH` de `api/bookings.js` (BrunettiCutz, ~línea 350) (+19 more)

### Community 14 - "build-engraving-svg.py"
Cohesion: 0.23
Nodes (13): bezier(), clean_alpha(), components(), fmt(), main(), rasterize(), Aplana una cúbica en segmentos de no más de FLAT unidades., Silueta en blanco y negro con aire alrededor, lista para guardar. (+5 more)

### Community 15 - "EncuentraEstilo (Style Finder) Page"
Cohesion: 0.15
Nodes (7): Data, KeychainStore, ThemeMode, dark, light, system, SessionStore

### Community 16 - "Auth & Booking Concepts"
Cohesion: 0.24
Nodes (16): Admin Key Authentication (shared internal password pattern), Barber Availability Management (barber sets available slots per day), Barber Authentication Flow (username/password, sets active barber session), Dual Authentication System (client auth via phone vs barber/admin auth via username+password), Phone Number as Client Identity (celular = ID de cliente), Manual Slot Blocking (admin blocks time slots per barber per day), TNE Discount (20% for Tarjeta Nacional Estudiantil, non-Bruno services), PIMP STUDIO Logo (JPG, used as brand header/footer image) (+8 more)

### Community 17 - "ui.jsx"
Cohesion: 0.10
Nodes (34): MobileDock(), ActionMenu(), cx(), CalendarSheet(), DOW, keyOf(), MONTHS, pad() (+26 more)

### Community 18 - "iOS App Intents & Shortcuts"
Cohesion: 0.08
Nodes (23): 01 · Workshop de barberos · 6 horas, 02 · La tesis del día, 03 · El día de hoy, 04 · Valer / más., 05 · “, 06 · Tu marca es lo que dicen de ti / cuando no estás en la sala., 07 · ¿Por qué alguien paga más?, 08 · Empaqueta el valor en niveles. (+15 more)

### Community 19 - "iOS Design System"
Cohesion: 0.11
Nodes (21): Axis, ButtonRole, CGFloat, LinearGradient, TextInputAutocapitalization, UIColor, UIImpactFeedbackGenerator, UIKeyboardType (+13 more)

### Community 20 - "data.js"
Cohesion: 0.08
Nodes (72): STATUS_META, DriftChip(), InventoryModule(), InventoryStatusChip(), KardexSheet(), KIND_LABELS, MOVE_KINDS, MoveSheet() (+64 more)

### Community 21 - "iOS Booking Sheet & Reminders"
Cohesion: 0.17
Nodes (19): ASSETS_DIR, CONTENT_DIR, CORS, fileFromEditId(), fileQueues, handleListAssets(), handleSave(), handleSaveOverride() (+11 more)

### Community 22 - "BookingsInbox.jsx"
Cohesion: 0.10
Nodes (36): BookingSyncIssues(), isAdminUser(), buildNav(), Dashboard(), DEMO_TODAY(), EMPTY_SALES, isJson(), EssentialsTab() (+28 more)

### Community 23 - "index.html PWA Setup"
Cohesion: 0.22
Nodes (9): apple-touch-icon PNG 180 rationale, Blackletter fonts (Pirata One, Manufacturing Consent), format-detection=telephone=no meta rationale, ps_theme_manual / ps_theme localStorage keys, theme-color meta dynamic sync rationale, index.html (entry, meta/PWA/no-flash theme), Hero image LCP preload (bruno-hero.jpg), No-flash theme init script (Santiago timezone based) (+1 more)

### Community 24 - "enrollmentsStore.js"
Cohesion: 0.26
Nodes (11): addLocalEnrollment(), mergeEnrollments(), readLocalEnrollments(), removeLocalEnrollment(), writeLocalEnrollments(), detailOf(), editionLabel(), InscripcionesTab() (+3 more)

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
Nodes (43): ClientModal(), formOf(), nextVisitLabel(), moveDay(), CLP(), fmtDate(), santiagoDateKey(), BookingDetailModal() (+35 more)

### Community 32 - "DashboardModel"
Cohesion: 0.32
Nodes (6): EditingContext, OverridesContext, Editable(), styleFromOverride(), DevEditProvider(), beginDrag()

### Community 33 - "ELIJA Agent Knowledge Base"
Cohesion: 0.10
Nodes (19): 2.1 Cabecera propia de Agenda (reconciliada), 2.2 Hero + KPIs (reestilizar el `dk-hero` existente), 2.3 Navegación semana/día, 2.4 Date-picker popover (NUEVO — componente `AgendaDatePicker`), 2.5 Acciones masivas, 2.6 Layout principal (`agenda-layout`, grid `1.55fr .9fr`), 2.7 Modal detalle (NUEVO — componente `BookingDetailModal`), 2.8 Toasts (NUEVO — contenedor fijo) (+11 more)

### Community 34 - "vercel.json Config"
Cohesion: 0.12
Nodes (11): App, ColorScheme, SafariServices, Scene, SwiftUI, BrunettiCutzApp, RootView, DashboardView (+3 more)

### Community 35 - "Register Client API"
Cohesion: 0.19
Nodes (31): requireInternal(), logBookingAttempt(), redeemForBooking(), autoCompleteSafely(), BOOKING_STATUSES, bookingForResponse(), businessDateKey(), businessNowMinutes() (+23 more)

### Community 36 - "Fintoc Payments API"
Cohesion: 0.17
Nodes (11): Diagnóstico (estado actual), Etapa 0 — Fundaciones adaptativas (sistema, no parches), Etapa 1 — Agenda (el módulo con más aire muerto), Etapa 2 — Clientes (cards → tabla densa), Etapa 3 — Reservas (inbox operativo), Etapa 4 — Resumen (dashboard ejecutivo), Etapa 5 — Finanzas + Gastos, Etapa 6 — Servicios, Inscripciones, Marketing, Config (+3 more)

### Community 37 - "Proposal Generator Script"
Cohesion: 0.13
Nodes (16): EditContext, ContainerScroll(), InteractiveSelector(), CARD_IMAGES, CARDS, CAT_TAG, curateHomeServices(), FALLBACK_SERVICES (+8 more)

### Community 38 - "CSS Stylesheets"
Cohesion: 0.15
Nodes (11): EditableText(), CHECKOUT_ITEMS, MercadoPagoCheckout(), ICONS, ModuleFooter(), Lamp(), Sparkles(), INCLUDE_ICONS (+3 more)

### Community 39 - "Claude Dev Wrapper Script"
Cohesion: 0.08
Nodes (23): 01 · 10.000 seguidores. / $0 en la caja., 02 · Muchos barberos generan vistas. / Y cero clientes., 03 · ¿Cuánto vale un cliente tuyo / en dos años?, 04 · El recorrido de hoy, 05 · El / precio., 06 · “, 07 · ¿Por qué alguien paga más?, 08 · Empaqueta el valor. Cobra en niveles. (+15 more)

### Community 41 - "DetailSheets.swift"
Cohesion: 0.47
Nodes (4): Context, SFSafariViewController, UIViewControllerRepresentable, SafariView

### Community 42 - "CLP"
Cohesion: 0.22
Nodes (14): cap(), daysInMonth(), ExpensesModule(), exportExpensesCSV(), isGasto(), metaOf(), monthKey(), CATEGORY_META (+6 more)

### Community 43 - "push.js"
Cohesion: 0.15
Nodes (29): COPY, InstallPrompt(), useAutoInstallPrompt(), canOfferInstall(), emit(), installState(), isInAppBrowser(), listeners (+21 more)

### Community 48 - "Cursos.jsx"
Cohesion: 0.22
Nodes (8): Base de datos (Neon), Brunetti · Barber Studio — Web + Panel, Deploy, Estructura, Puesta en marcha (PC nuevo), Requisitos, Scripts, Variables de entorno

### Community 49 - "Vite Config & Fintoc Mock"
Cohesion: 0.13
Nodes (52): addDays(), ALL_SLOTS, blocksFor(), createState(), dateKey(), iso(), isoAt(), minutesAgo() (+44 more)

### Community 51 - "interactive-selector.jsx"
Cohesion: 0.25
Nodes (7): Abrir en Xcode, APIs usadas, Brunetti Cutz iOS, Build nativo e IPA, Funciones nativas incluidas, Servidor local, Sesion interna y fallback

### Community 52 - "AppTab"
Cohesion: 0.18
Nodes (11): CaseIterable, Sendable, AppTab, clientes, finanzas, hoy, mas, reservas (+3 more)

### Community 53 - "estilo.js"
Cohesion: 0.05
Nodes (40): 01 · Workshop de barberos · 6 horas, 02 · La tesis del día, 03 · 10.000 / 100, 04 · El día de hoy, 05 · Valer / más., 06 · “, 07 · Tu marca es lo que dicen de ti / cuando no estás en la sala., 08 · La gente no compra servicios. / Compra personas. (+32 more)

### Community 54 - "clients.js"
Cohesion: 0.39
Nodes (7): background(), gold_mark(), icon(), main(), Monograma recortado y recoloreado a dorado, con fondo transparente., Fondo radial oscuro. Sin radius_ratio queda a sangre (para iconos enmascarados)., save()

### Community 65 - "_products.js"
Cohesion: 0.15
Nodes (32): blank(), createProduct(), DEMO_PRODUCTS, ensureProductsTable(), handleInventory(), handleProducts(), has(), inventoryItem() (+24 more)

### Community 66 - "DashboardResumen.jsx"
Cohesion: 0.12
Nodes (23): addDays(), BarChart(), BUSINESS_HOURS, CAT_COLORS, cx(), DashboardResumen(), DOW_ORDER, DOW_SHORT (+15 more)

### Community 67 - "_email.js"
Cohesion: 0.26
Nodes (21): esc(), firstName(), formatCLP(), formatDate(), sendBookingConfirmationEmail(), sendLoyaltyCardEmail(), sendPasswordResetEmail(), sendViaResend() (+13 more)

### Community 68 - "PedidosTab.jsx"
Cohesion: 0.17
Nodes (20): detailOf(), editionLabel(), EnrollmentModal(), formOf(), isPaid(), parsePayment(), amountOf(), fmtStamp() (+12 more)

### Community 69 - "services.js"
Cohesion: 0.16
Nodes (19): Decodable, Error, LocalizedError, APIError, badStatus, invalidURL, missingData, AvailabilityResponse (+11 more)

### Community 70 - "_bookingLife.js"
Cohesion: 0.25
Nodes (16): afterAutoComplete(), afterCompletion(), autoCompleteEnabled(), autoCompleteStarted(), claimDue(), isFreshBookingDate(), lifecycleEffectsEnabled(), loyaltyForTransition() (+8 more)

### Community 71 - "workshop.js"
Cohesion: 0.13
Nodes (16): FEATURE_CARDS, formatWorkshopDate(), TESTIMONIALS, WK_BASE, WK_DIAS, WK_ED, WK_MESES, wkEditionDate() (+8 more)

### Community 72 - "EssentialsGracias.jsx"
Cohesion: 0.25
Nodes (12): NAV, SiteNav(), claimSnapshot(), COPY, EssentialsGracias(), FAILED, helpHref(), MP_KEYS (+4 more)

### Community 73 - "Plan de implementación — Rediseño Brunetti (marca personal Bruno Herrera)"
Cohesion: 0.40
Nodes (4): Decisiones clave (confirmadas con el usuario), Estado / Checklist por fases, Notas de retoma (si se corta), Plan de implementación — Rediseño Brunetti (marca personal Bruno Herrera)

### Community 74 - "DetailSheets.swift"
Cohesion: 0.10
Nodes (13): UserNotifications, BookingDraftSheet, BookingSheet, ClientSheet, encoded(), EnrollmentSheet, ExpenseSheet, PaymentSheet (+5 more)

### Community 75 - "_auth.js"
Cohesion: 0.26
Nodes (11): b64url(), createSession(), readSession(), sign(), businessDateKey(), businessNowMinutes(), canTouchAgenda(), handler() (+3 more)

### Community 76 - "buildWatch.js"
Cohesion: 0.28
Nodes (11): App(), check(), hasFilledField(), hasOpenLayer(), HOLD_PATH_PREFIXES, isCartHeld(), isHeldPublicRoute(), isTyping() (+3 more)

### Community 85 - "BarberLogin.jsx"
Cohesion: 0.15
Nodes (15): BARBERS, attemptsLeftText(), BarberLogin(), clockWait(), SHELL_INPUT, wordsWait(), BarberAvatar(), BRUNO (+7 more)

### Community 86 - "ADMIN_API_TOKEN env var"
Cohesion: 0.26
Nodes (16): addToCart(), cartCount(), clearCart(), readCart(), removeFromCart(), setQty(), writeCart(), scrollToId() (+8 more)

### Community 90 - "Booking.jsx"
Cohesion: 0.09
Nodes (22): 01 · Hoy no te vas / sin publicar., 02 · Esto no es una charla. / Es un set de grabación., 03 · El día, hora por hora, 04 · La / idea., 05 · Si no se entiende sin audio, / el video ya murió., 06 · Tus 3 hooks / de dolor., 07 · ¿Vale la pena grabar este video?, 08 · Cómo se lee el puntaje (+14 more)

### Community 92 - "_money.js"
Cohesion: 0.24
Nodes (9): blank(), CASH_METHODS, isMissingTable(), onlineSales(), parseAmountFromMessage(), PAYMENT_LABELS, PAYMENT_METHODS, PAYMENT_REF_LABELS (+1 more)

### Community 139 - "walletPrompt.js"
Cohesion: 0.07
Nodes (59): addLocalBooking(), cancelKeyOf(), cancelLocalBooking(), isCancelled(), isOrphanLocalBooking(), markLocalBookingSynced(), matchKeyOf(), mergeBookings() (+51 more)

### Community 140 - "auth-barber.js"
Cohesion: 0.07
Nodes (45): DEMO_EXPENSES, handler(), KINDS, readKind(), readKindFilter(), validateExpense(), buildEssentialsOrder(), cleanPhone() (+37 more)

### Community 141 - "push.js"
Cohesion: 0.38
Nodes (10): cspReportAllowed(), cspReportBuckets, getWebPush(), handler(), logNotification(), normalizeCspReports(), notifyAll(), notifyBarber() (+2 more)

### Community 142 - "cleanPhone"
Cohesion: 0.15
Nodes (12): Banco de frases, hooks de escenario y CTAs, CTA de escenario (el del workshop), CTAs, CTAs para los videos de ellos, Frases martillo, Hooks de escenario, Preguntas para la sala, Sobre clientes y dinero (+4 more)

### Community 143 - "AppTab"
Cohesion: 0.27
Nodes (9): ConfigPanel(), fold(), isoToLocalInput(), readJson(), useFlash(), ResetPassword(), SHELL_INPUT, isValidPassword() (+1 more)

### Community 144 - "M3 · La estructura del video viral"
Cohesion: 0.17
Nodes (11): Cómo responder cada pregunta: invierte la expectativa, Edición — los 4 pasos, El ciclo de 4 semanas, Grabación — los 7 planos, Guionización — el framework de las 5 preguntas, Herramientas, Lo que premia el algoritmo, Los 15 segundos, parte por parte (+3 more)

### Community 145 - "M5 · Del scroll a la silla"
Cohesion: 0.17
Nodes (12): El embudo completo — 7 pasos, El poder del recomendado, El problema en una línea, La fórmula para pedir la referencia, La objeción de precio, Las 4 métricas que se trackean, M5 · Del scroll a la silla, Mentalidad — de empleado a empresario (+4 more)

### Community 146 - "Dinámicas y ejercicios"
Cohesion: 0.17
Nodes (12): Dinámicas y ejercicios, E0 · Diagnóstico de la sala — 5 min, E1 · Construye tu frase de posicionamiento — 5 min, E2 · Los 3 hooks de dolor — 7 min, E3 · Calculadora en vivo — 15 min, E4 · El set de grabación — 60 min ★, E5 · Sprint de edición — 45 min, E6 · Arregla tu bio — 2 min ★ (+4 more)

### Community 147 - "M2 · Ideas virales"
Cohesion: 0.18
Nodes (10): 01 · Dolor (confrontación), 02 · Curiosidad (open loop), 03 · Personalidad (autenticidad), 04 · Referencia viral (memética), Framework EYE — las 3 tipologías de contenido, Las 4 preguntas antes de grabar, Los 3 tipos de hook, por formato, Los 4 hooks visuales (+2 more)

### Community 148 - "M1 · Valer más"
Cohesion: 0.18
Nodes (10): 1. Percepción sobre habilidad, 2. Marca personal, 3. El nicho, 4. Tu historia es tu activo, 5. La ecuación de valor (Hormozi), 6. Precio sin miedo, 7. El protocolo (bonus), 8. Escalar más allá de la silla (+2 more)

### Community 149 - "Cifras del workshop"
Cohesion: 0.22
Nodes (9): Advertencias de uso, Calculadora de viralidad, Ciclo de vida del cliente, Cifras del workshop, Contenido y algoritmo, El recomendado, Equipo, Precio y servicio (+1 more)

### Community 150 - "README.md"
Cohesion: 0.20
Nodes (6): Cómo está organizado, La presentación, Las tres exploraciones previas, Los documentos, Regenerar los decks, Workshop ASCENSIÓN — Base de conocimiento

### Community 151 - "Identidad visual"
Cohesion: 0.17
Nodes (11): Assets disponibles, Escala tipográfica, Fotos, Iconos, Identidad visual, Logos, Paleta 2 — Oro y negro *(usada en V2)*, Paleta 3 — REC *(usada en V3)* (+3 more)

### Community 152 - "Brief del día — Workshop de 6 horas"
Cohesion: 0.25
Nodes (7): Brief del día — Workshop de 6 horas, El cierre, El corte en vivo es un set de grabación, no una pausa, Estructura de la jornada, Los dos roles, Qué es, Qué tiene que pasar para que el día sea un éxito

### Community 153 - "M4 · La calculadora de viralidad"
Cohesion: 0.29
Nodes (6): Cuatro ideas puntuadas, para mostrar cómo se aplica, Ejemplo de puntuación en vivo, La escala de decisión, Los 6 criterios, M4 · La calculadora de viralidad, Versión imprimible (checklist de bolsillo)

### Community 154 - "ChargeSheet.jsx"
Cohesion: 0.31
Nodes (8): ChargeSheet(), cx(), discountPctOf(), METHODS, MODES, PAYMENT_LABELS, REF_LABELS, loyaltyFromStars()

### Community 155 - "OpenBrunettiModuleIntent"
Cohesion: 0.15
Nodes (12): AppEnum, AppIntent, AppIntents, AppShortcut, AppShortcutsProvider, DisplayRepresentation, IntentResult, LocalizedStringResource (+4 more)

### Community 156 - "cleanPhone"
Cohesion: 0.08
Nodes (34): cx(), DEFAULT_SLOTS, isTaken(), jsonOrReject(), NewBookingModal(), spanTakenAt(), STATUS_OPTIONS, STEP_LABELS (+26 more)

### Community 157 - "DashboardFocus"
Cohesion: 0.10
Nodes (10): Foundation, LocalAuthentication, Observation, Security, DashboardFocus, dia, semana, workshop (+2 more)

### Community 158 - "_notion.js"
Cohesion: 0.57
Nodes (7): buildDateRange(), formatCLP(), mapStatusToStage(), notionHeaders(), syncBookingToNotion(), updateNotionBookingSchedule(), updateNotionBookingStatus()

### Community 159 - "vercel.json"
Cohesion: 0.33
Nodes (5): buildCommand, framework, headers, outputDirectory, rewrites

## Knowledge Gaps
- **564 isolated node(s):** `dev-wrapper.sh script`, `NVM_DIR`, `WK`, `BASE`, `PAYMENT_LABELS` (+559 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **73 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Dashboard()` connect `BookingsInbox.jsx` to `_email.js`, `UI Components & Login`, `walletPrompt.js`, `push.js`, `Vite Config & Fintoc Mock`, `ui.jsx`, `BarberLogin.jsx`, `cleanPhone`, `BookingsInbox.jsx`?**
  _High betweenness centrality (0.168) - this node is a cross-community bridge._
- **Why does `esc()` connect `_email.js` to `BookingsInbox.jsx`?**
  _High betweenness centrality (0.136) - this node is a cross-community bridge._
- **Why does `CLP()` connect `BookingsInbox.jsx` to `DashboardResumen.jsx`, `PedidosTab.jsx`, `Proposal Generator Script`, `CSS Stylesheets`, `UI Components & Login`, `EssentialsGracias.jsx`, `CLP`, `walletPrompt.js`, `data.js`, `BookingsInbox.jsx`, `ADMIN_API_TOKEN env var`, `ChargeSheet.jsx`, `cleanPhone`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `CLP()` (e.g. with `ClientModal()` and `DashboardResumen()`) actually correct?**
  _`CLP()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `dev-wrapper.sh script`, `NVM_DIR`, `WK` to the rest of the system?**
  _578 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `iOS Data Models` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `Backend Auth & Project Docs` be split into smaller, more focused modules?**
  _Cohesion score 0.07956989247311828 - nodes in this community are weakly interconnected._