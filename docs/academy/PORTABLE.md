# Academy portable — un módulo, dos sitios

La Academy vive idéntica en **pimpstudio.cl/academy** y **brunetticutz.cl/cursos**. El código
compartido se copia tal cual entre repos con `node scripts/academy-sync.mjs <repo destino>`;
cada repo tiene solo **4 archivos propios** (el "host") más unos pocos puntos de enganche.

## 1. Archivos compartidos (se copian, nunca se editan en el destino)
- `api/_academy*.js` (menos `api/_academyHost.js`), `api/_webpush.js`
- `src/academy/**` (menos `src/academy/hostConfig.js` y `src/academy/host.jsx`)
- `src/pages/academy/**`, `src/components/academy/**`, `src/styles/academy/**`
- `src/pages/panel/AcademyTab.jsx`, `src/pages/panel/academy/**`, `src/styles/panel/academy.css`
- `scripts/dev-mock/academy/**` (menos `scripts/dev-mock/academy/host.mjs`)
- `docs/academy/SPEC.md`, `docs/academy/PORTABLE.md`

Regla: el código compartido **no importa nada del repo** salvo: `api/_academyHost.js`,
`src/academy/hostConfig.js`, `src/academy/host.jsx`, `scripts/dev-mock/academy/host.mjs`, y los
módulos que existen igual en los dos repos: `src/components/panel/index.js`,
`src/components/panel/hooks.js`, `src/components/theme.jsx` (`useTheme`), `src/data.js` (`CLP`,
`fmtDate`), `src/installPrompt.js`, `src/components/InstallPrompt.jsx` (audiencia `student`), y
paquetes npm (`@neondatabase/serverless`, `@vercel/blob`, `web-push`, `react`, `react-router-dom`).
Los íconos son propios (`src/academy/Icon.jsx`), no los de `src/components/ui.jsx`.

## 2. Archivos del host (uno por repo)

### `api/_academyHost.js`
```js
export const HOST = {
  key: 'pimpstudio',                       // 'brunetticutz'
  basePath: '/academy',                    // '/cursos'
  defaultSiteUrl: 'https://pimpstudio.cl', // 'https://brunetticutz.cl'
  sessionInfo: 'pimpstudio:academy:member:v1', // 'brunetticutz:academy:member:v1'  (HKDF info: llaves distintas por sitio)
  statementDescriptor: 'PIMP ACADEMY',     // 'BRUNETTI ACADEMY'
  mpNotificationPath: '/api/mp-webhook',   // '/api/mp-payments?webhook=1'
  brand: { name: 'Pimp Studio Academy', short: 'Academy', initials: 'PA', siteName: 'Pimp Studio',
           emailFromName: 'Pimp Studio Academy', logoPath: '/assets/pimpstudio-icon-192.png', color: '#1c1c1c',
           groupUrlLabel: 'pimpstudio.cl/academy', supportWhatsapp: null,
           emailLogoPath: '/assets/pimp-studio-logo.png' /* opcional; si falta, logoPath */ },
  defaultLinks: [{ title: 'Reserva tu hora', url: 'https://pimpstudio.cl/reservar' }],
}
export function siteUrl()                              // SITE_URL normalizado (sin barra final) o HOST.defaultSiteUrl
export function sessionSecret()                        // PS_SESSION_SECRET || ADMIN_API_TOKEN || '' (misma regla ≥16 del panel)
export async function requireBarberAdmin(sql, req, res) // → { barberId, name, email } o null (ya respondió 401/403)
export async function notifyStaff(sql, { title, body, url, tag }) // aviso a los admins del panel; nunca lanza
```

### `src/academy/hostConfig.js` (datos puros; lo importa también el mock en Node)
```js
export const ACADEMY_BASE = '/academy'          // '/cursos'
export const ACADEMY_VISIBLE = false            // PimpStudio: oculta por ahora · BrunettiCutz: true
export const ACADEMY_BRAND = { name, short, initials, color, logo, siteName, siteUrl, instagram, groupUrlLabel }
export const ACADEMY_LINKS = { home: '/', booking: '/reservar', panel: '/panel?tab=academy' }
export const CHECKOUT = { path: '/api/checkout', statusUrl: (ref) => `/api/checkout?ref=${encodeURIComponent(ref)}` }
   // BrunettiCutz: { path: '/api/mp-payments', statusUrl: (ref) => `/api/mp-payments?status=1&ref=${…}` }
```

### `src/academy/host.jsx`
```js
export const PublicLanding = lazy(() => import('../pages/Academy.jsx'))   // BrunettiCutz: ../pages/Cursos.jsx
export async function buildSeedPayload()   // payload de admin-seed ("Cargar cursos iniciales")
export function catalogHref(course)        // a dónde manda "Comprar" un curso bloqueado
```

### `scripts/dev-mock/academy/host.mjs`
```js
export const MOCK_HOST = { base: '/academy', checkoutPath: '/api/checkout', brand: {...}, async seedCourses() {...} }
```

## 3. Puntos de enganche en cada repo (una sola vez)
| Dónde | Qué |
|---|---|
| `api/services.js` | `if (req.query.scope === 'academy')` → `import('./_academy.js')` dinámico |
| `vercel.json` | rewrite `/api/academy` → `/api/services?scope=academy` (antes de `/api/(.*)`); CSP estricto para `<base>/(.*)` |
| checkout + webhook de Mercado Pago | POST `kind:'course'` → `handleCourseCheckout`; GET `ref=aca-…` → `handleCourseStatus`; webhook con `external_reference` `aca-…` → `handleAcademyPayment(sql, payment, paymentId, res)` (`api/_academyProvision.js`) |
| `api/push.js` | tanda `runAcademyJob` en `?job=reminders` (fuera de `failed`, solo con `CRON_SECRET`) + `?job=academy` |
| `public/sw.js` | `notificationclick` por sección (`/panel` como siempre; la Academy a su ruta) |
| `src/push.js` | `disablePush` no desuscribe el navegador si `ps_academy_push_enabled === '1'` |
| `src/App.jsx` | `<Route path="<base>/*" element={<AcademyRoot/>}/>` y el destino de la PWA con `ps_academy_token` |
| `src/pages/Dashboard.jsx` | pestaña `academy` (admin, lazy) si `ACADEMY_VISIBLE` |
| `src/components/InstallPrompt.jsx` | copia `student` |
| `src/components/ui.jsx` | los íconos que la Academy le pasa al kit del panel (`Button icon=`, `IconButton`): si falta uno, el kit dibuja el ícono por defecto |
| `index.html` | sin scripts inline (van a `/boot.js`), por el CSP estricto de la Academy |
| `vite.config.js` | con `VITE_DEV_MOCKS=1`, montar el mock de `scripts/dev-mock/academy/` antes que cualquier otro |

## 4. Replicar un cambio
1. Cambiar en PimpStudio (o en BrunettiCutz) y probar (`npm run dev:mock`, `npm run build`).
2. `node scripts/academy-sync.mjs ../BRUNETTICUTZ` (o al revés) — copia el set compartido y avisa si algún archivo compartido importa algo fuera de la regla §1.
3. Build + prueba en el otro repo y deploy de cada uno por su lado.
