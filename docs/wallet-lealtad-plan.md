# Plan: tarjeta de lealtad de Pimp Studio en brunetticutz.cl

> **Estado: implementado** (código escrito en los dos proyectos, build verde en
> ambos). Falta correr las migraciones SQL en Neon, configurar
> `PIMPSTUDIO_API_BASE` en Vercel y desplegar en el orden de la Fase 6.
>
> **Decisiones tomadas:** misma tarjeta "Pimp Studio" (sin certificados nuevos);
> suman estrella **todas** las reservas completadas de brunetticutz.cl, con
> cualquier barbero; mismos premios y **canje desde los dos paneles**; **sin
> backfill** del historial (empieza de cero). Además: la pestaña **Marketing**
> se replicó en el panel de Brunetti con las mismas métricas y campañas.

Objetivo: **no crear un sistema de puntos nuevo**. Reutilizar el que ya existe en
PimpStudio (`loyalty_events` + Apple/Google Wallet) y enlazarlo a BrunettiCutz, de
modo que:

1. Los clientes de brunetticutz.cl puedan instalar la tarjeta de lealtad (Apple
   Wallet / Google Wallet) desde el sitio y desde el panel.
2. Cada corte completado en BrunettiCutz sume automáticamente 1 estrella.
3. El saldo, los pases y la lista de clientes vivan **en la base de datos de
   PimpStudio** (Neon), como fuente única de verdad.

---

## 1. Qué ya existe (no se rehace nada de esto)

### En PimpStudio (fuente de verdad)

| Pieza | Archivo | Qué hace |
|---|---|---|
| Reglas de fidelidad | `api/_loyalty.js` | Saldo = `SUM(delta)` sobre `loyalty_events`. 5 estrellas → 30% en productos; 10 → corte gratis. Idempotencia por índice parcial único. |
| Apple Wallet | `api/_wallet.js` | Arma y firma el `.pkpass` a mano (storeCard, tira de sellos 0..10), web service de Apple, `share_token` para el link por WhatsApp. |
| Google Wallet | `api/_googleWallet.js` | Objeto en la API de Google + link firmado (JWT), `updateLoyaltyPoints()` para refrescar el saldo. |
| API pública | `api/clients.js` | Modos `wallet-pass`, `wallet-pass-google`, `wallet-status`, `wallet-tarjeta-info`, `wallet-share-link`, `wallet-stats`. |
| Push del pase | `api/push.js` → `notifyWalletUpdate()` | APNs que le dice a Wallet "vuelve a bajar el pase". |
| UI | `src/walletPrompt.js`, `src/components/WalletPrompt.jsx`, `src/pages/CardShare.jsx` (`/tarjeta`), `src/pages/Account.jsx` | Popup "Agregar a Wallet", página pública de la tarjeta, saldo en la cuenta del cliente. |
| Tablas | `db/schema.sql` | `loyalty_events` (con `bridge_ref`), `wallet_passes`, `wallet_registrations`. |

### El puente que ya está tendido (una sola dirección)

`PimpStudio → BrunettiCutz`: `api/bruno-agenda.js` (PimpStudio) llama a
`/api/bookings` y `/api/availability` de BrunettiCutz con el header
`X-Bridge-Secret` (variable `PIMPSTUDIO_BRIDGE_SECRET`, ya configurada en ambos
Vercel). BrunettiCutz lo acepta acotado al barbero 6.

**Y ya suma estrellas**: `creditBridgeLoyalty()` en `bruno-agenda.js` inserta un
`loyalty_events` con `bridge_ref = 'bruno:<bookingId>'` cuando una reserva de Bruno
se marca "completada" **desde el panel de PimpStudio**.

### Lo que falta (esto es todo el trabajo)

- **Dirección inversa** `BrunettiCutz → PimpStudio`: hoy, si Bruno (o cualquier
  barbero) marca "completada" en el panel de brunetticutz.cl, PimpStudio nunca se
  entera y la estrella no se suma.
- **Toda la cara de la tarjeta en brunetticutz.cl**: descarga del pase, estado
  "¿ya lo tiene?", popup post-reserva, saldo en la cuenta, botón de WhatsApp en
  el panel.

---

## 2. Restricción dura: 12/12 funciones serverless en ambos proyectos

Plan Hobby de Vercel: máximo 12 Serverless Functions por deployment.

```
BrunettiCutz  api/*.js sin "_"  →  12   (auth-barber, auth-login, availability, barbers,
                                          bookings, clients, enrollments, expenses,
                                          flow-payments, push, register-client, services)
PimpStudio    api/*.js sin "_"  →  12
```

**Los dos están exactamente en el tope.** Por lo tanto: **cero archivos nuevos en
`api/`** en ambos lados. Todo endpoint nuevo va como `?mode=…` dentro de un archivo
existente (`api/clients.js` en los dos casos, que es donde ya vive todo lo de
clientes y wallet), y toda la lógica compartida va en archivos con prefijo `_`
(que Vercel no cuenta como función).

---

## 3. Riesgo principal a resolver: la estrella doble

Hoy `bruno-agenda.js` acredita con `bridge_ref = 'bruno:<bookingId>'`, donde
`bookingId` es el id **de la base de BrunettiCutz**. Si agregamos un hook en el
`PATCH` de `api/bookings.js` de BrunettiCutz que acredite con otro prefijo
(`brunetti:<id>`), una reserva completada desde el panel de PimpStudio pasaría por
los dos caminos (PimpStudio → puente → PATCH de Brunetti → vuelta a PimpStudio) y
sumaría **dos estrellas por un corte**.

**Solución: un solo escritor.** La estrella la acredita siempre BrunettiCutz, que
es donde vive la reserva, sin importar desde qué panel se marcó:

1. Se **elimina** `creditBridgeLoyalty()` de `api/bruno-agenda.js` (PimpStudio).
2. El hook nuevo vive en el `PATCH` de `api/bookings.js` (BrunettiCutz) — ese
   PATCH lo ejecutan tanto el panel de Brunetti como el puente de PimpStudio, así
   que cubre los dos flujos con un solo camino.
3. Migración de datos en PimpStudio para que los eventos ya emitidos no se
   dupliquen al reutilizar el mismo id con otro prefijo:
   ```sql
   UPDATE loyalty_events
   SET bridge_ref = 'brunetti:' || split_part(bridge_ref, ':', 2)
   WHERE kind = 'earn' AND bridge_ref LIKE 'bruno:%';
   ```
   (El índice único `loyalty_events_bridge_earn_unique` sigue garantizando la
   idempotencia después del cambio de prefijo.)

---

## Fase 1 — API de lealtad entrante en PimpStudio

Todo dentro de `api/clients.js` (PimpStudio), autenticado con `X-Bridge-Secret`.

### 1.1 Helper de puente entrante

En `api/clients.js`, copiar el patrón que ya usa BrunettiCutz en `api/bookings.js`:

```js
const BRIDGE_SECRET = process.env.PIMPSTUDIO_BRIDGE_SECRET || ""
function isBridgeRequest(req) {
  if (!BRIDGE_SECRET) return false
  const key = req.headers["x-bridge-secret"]
  return typeof key === "string" && key === BRIDGE_SECRET
}
```

Se resuelve **antes** del dispatch normal por método, igual que el bloque de
`walletPath` (estas requests no traen sesión de barbero).

### 1.2 Mover la lógica de acreditación a `api/_loyalty.js`

Sacar `creditBridgeLoyalty()` de `bruno-agenda.js` y dejarla en `_loyalty.js` como
dos funciones reutilizables:

- `creditExternalStar(sql, { ref, phone, name })`
  - upsert del cliente en `users` por teléfono (9 dígitos),
  - `INSERT INTO loyalty_events (user_id, booking_id, kind, delta, bridge_ref) VALUES (…, NULL, 'earn', 1, ${ref}) ON CONFLICT (bridge_ref) WHERE kind='earn' DO NOTHING`,
  - si la fila es nueva: `UPDATE wallet_passes SET updated_at = NOW()` + `notifyWalletUpdate()` (Apple) + `updateLoyaltyPoints()` (Google), ambos best-effort,
  - devuelve `{ earned, ...loyaltySummary() }` o `null` si fue replay.
- `revertExternalStar(sql, { ref })`
  - `DELETE FROM loyalty_events WHERE bridge_ref = ${ref} AND kind = 'earn'` + mismo refresco de Wallet.
  - Espejo de lo que ya hace `applyLoyaltyForStatus()` cuando una reserva sale de
    "completada".

### 1.3 Modos nuevos en `api/clients.js` (PimpStudio)

| Modo | Método | Entrada | Salida |
|---|---|---|---|
| `bridge-loyalty-earn` | POST | `{ ref, phone, name }` | `{ ok, earned, loyalty }` |
| `bridge-loyalty-revert` | POST | `{ ref }` | `{ ok, reverted, loyalty }` |
| `bridge-loyalty` | GET | `?phone=` | `{ ok, loyalty, hasPass }` |
| `bridge-share-token` | GET | `?phone=&name=` | `{ ok, token }` (upsert del cliente + `ensureShareToken`) |
| `bridge-redeem` *(fase 5)* | POST | `{ phone, ref }` | canje de corte gratis (`delta = -10`) |

Reglas:
- Sin `X-Bridge-Secret` válido → **404** (no 403: no revelar que el modo existe).
- Rate limit propio (`rateLimit(sql, 'bridge:'+ip)`), holgado — son llamadas
  servidor-a-servidor, no del navegador.
- Nunca devolver email ni historial: solo saldo y token.

### 1.4 Quitar la acreditación de `bruno-agenda.js`

Borrar `creditBridgeLoyalty()` y su llamada en el `PATCH`, dejando el comentario
que explique que ahora acredita BrunettiCutz (evita la estrella doble).

### 1.5 Migración SQL

Correr el `UPDATE` de normalización de `bridge_ref` de la sección 3 **después** de
desplegar 1.4 y **antes** de desplegar la fase 2.

---

## Fase 2 — BrunettiCutz acredita las estrellas

### 2.1 Cliente del puente: `api/_loyaltyBridge.js` (archivo nuevo con `_`, no cuenta como función)

```js
const BASE   = (process.env.PIMPSTUDIO_API_BASE || "https://pimpstudio.cl").replace(/\/$/, "")
const SECRET = process.env.PIMPSTUDIO_BRIDGE_SECRET || ""

export function isLoyaltyBridgeConfigured() { return Boolean(SECRET) }
async function bridge(path, opts) { /* fetch con X-Bridge-Secret + X-Forwarded-For, timeout ~4s */ }

export async function creditStar({ ref, phone, name })   // POST bridge-loyalty-earn
export async function revertStar({ ref })                 // POST bridge-loyalty-revert
export async function loyaltyFor(phone)                   // GET  bridge-loyalty
export async function shareToken({ phone, name })         // GET  bridge-share-token
```

Reglas: **todo best-effort**. Si PimpStudio no responde, se registra en consola y
la operación local sigue como si nada — jamás se revierte un cambio de estado ni
se rompe el panel por un problema de fidelidad. Timeout con `AbortController`
para no colgar la lambda.

### 2.2 Hook en el `PATCH` de `api/bookings.js` (BrunettiCutz, ~línea 350)

1. Antes del `UPDATE`, leer el estado anterior y los datos del cliente:
   ```sql
   SELECT b.status, b.barber_id, u.name, u.phone
   FROM bookings b JOIN users u ON u.id = b.client_id
   WHERE b.id = $1
   ```
   (El `SELECT` del guard del puente ya existe: se amplía ese mismo, no se agrega
   otro round-trip.)
2. Después del `UPDATE` exitoso, en su propio `try/catch`:
   - `antes ≠ 'completada'` y `ahora = 'completada'` → `creditStar({ ref: 'brunetti:'+id, phone, name })`
   - `antes = 'completada'` y `ahora ≠ 'completada'` → `revertStar({ ref: 'brunetti:'+id })`
3. Mismo tratamiento en el `DELETE` (cancelación del cliente): si la reserva estaba
   "completada", revertir.
4. Filtro de alcance según lo que se decida (todos los barberos vs. solo Bruno) y,
   opcionalmente, respetando un `loyalty_eligible` por servicio (BrunettiCutz hoy
   no tiene esa columna; se puede agregar con `ALTER TABLE … DEFAULT true`).

### 2.3 Reservas antiguas (backfill opcional)

Un script `scripts/backfill-loyalty.mjs` que recorra las reservas `completada` de
BrunettiCutz y llame a `creditStar` con `ref = 'brunetti:<id>'` — la idempotencia
lo hace re-ejecutable sin riesgo. Decidir si se cuenta el historial completo o
solo desde una fecha (ver preguntas).

---

## Fase 3 — La tarjeta servida desde brunetticutz.cl

Todo dentro de `api/clients.js` (BrunettiCutz). El navegador del cliente **nunca**
llama a pimpstudio.cl: todo pasa por el backend de Brunetti (evita CORS/CSP y no
expone el teléfono en una URL de otro dominio).

| Modo nuevo | Quién | Qué hace |
|---|---|---|
| `wallet-pass` | público (`?phone=`) | pide `bridge-share-token`, baja el `.pkpass` desde `https://pimpstudio.cl/api/clients?mode=wallet-pass&t=<token>` y lo reenvía tal cual con `Content-Type: application/vnd.apple.pkpass` (`arrayBuffer()` → `Buffer.from()`). Mismo origen para Safari. |
| `wallet-pass-google` | público (`?phone=`) | igual, pero devuelve `{ saveUrl }` en JSON. |
| `wallet-status` | público (`?phone=`) | proxy de `bridge-loyalty` → `{ hasPass }`. |
| `wallet-share-link` | barbero (sesión) | `bridge-share-token` → `{ url: 'https://pimpstudio.cl/tarjeta?t=…' }` para mandarlo por WhatsApp. |

Además: agregar `loyalty` al `GET ?phone=` que ya existe (la cuenta del cliente),
resolviéndolo con `loyaltyFor(phone)` — con `try/catch` y `loyalty: null` si el
puente falla, para no romper `/cuenta`.

Rate limit igual que el resto de los modos públicos (`max: 10/min` para
`wallet-pass`, como en PimpStudio).

---

## Fase 4 — UI en brunetticutz.cl

Buena noticia: BrunettiCutz ya comparte las clases (`psn-modal`, `psn-modal-card`,
`psn-confirm`) y los íconos (`wallet`, `star`) con PimpStudio, así que el port es
casi copia directa.

1. **`src/walletPrompt.js`** — portar de PimpStudio (detección iOS/Android,
   descarte 30 días en localStorage, `hasWalletPass()` contra el servidor). Cambian
   solo las URLs: apuntan a `/api/clients?mode=wallet-*` de Brunetti.
2. **`src/components/WalletPrompt.jsx`** — portar el modal + `useAutoWalletPrompt`.
   Ajustar el texto a la marca que se decida.
3. **`src/pages/Booking.jsx`** — montar en el paso 3 (confirmación):
   `const [walletOpen, closeWallet] = useAutoWalletPrompt(step === 3, user?.phone, 4500)`
   y `<WalletPrompt … />` al final del render. Es el "sugerir instalar la tarjeta
   al reservar".
4. **`src/pages/Account.jsx`** — mostrar estrellas + progreso al corte gratis, y
   el mismo popup automático con delay corto (patrón de `Account.jsx` de
   PimpStudio).
5. **Panel (`src/pages/Dashboard.jsx`)** — en la lista de clientes: badge de
   estrellas (viene del `GET /api/clients`) y botón "Enviar tarjeta de
   fidelización" que abre WhatsApp con el link de `wallet-share-link`.
6. **`/tarjeta` en Brunetti** *(opcional)* — portar `CardShare.jsx`. Si se decide
   reusar `pimpstudio.cl/tarjeta`, este punto no existe y el paso 5 no cambia.

---

## Fase 5 — Canje y métricas (opcional, después de que funcione lo anterior)

- Botón de canje "corte gratis" en el panel de Brunetti → `bridge-redeem`
  (inserta `delta = -10`, `kind = 'redeem_free_cut'`, deja la reserva en $0).
- Vista de métricas de fidelidad en el panel de Brunetti, o simplemente seguir
  usando la pestaña Marketing de PimpStudio (`wallet-stats`), que ya las tiene y
  ahora incluiría a los clientes de Brunetti automáticamente.
- Campañas ("NOVEDADES" en el pase) también quedan disponibles para clientes de
  Brunetti sin trabajo extra, porque el pase es el mismo objeto.

---

## Fase 6 — Configuración, pruebas y despliegue

### Variables de entorno

**BrunettiCutz** (Vercel + `.env.example`):
```
PIMPSTUDIO_API_BASE=https://pimpstudio.cl
PIMPSTUDIO_BRIDGE_SECRET=<el mismo que ya existe para el puente de agenda>
```
**PimpStudio**: nada nuevo (ya tiene `PIMPSTUDIO_BRIDGE_SECRET`, los certificados
de Apple Wallet y la cuenta de servicio de Google).

> Nota de seguridad: reutilizar el mismo secreto mantiene la operación simple (una
> variable), pero significa que una filtración compromete agenda **y** fidelidad.
> La alternativa es una segunda variable `LOYALTY_BRIDGE_SECRET`; el código queda
> igual, solo cambia el nombre que lee cada lado.

### Orden de despliegue (importa)

1. PimpStudio: fases 1.1–1.3 (endpoints entrantes, sin tocar `bruno-agenda`) →
   deploy. Los endpoints quedan vivos pero nadie los llama todavía.
2. PimpStudio: fase 1.4 (quitar `creditBridgeLoyalty`) + migración SQL 1.5 → deploy.
3. BrunettiCutz: fases 2 y 3 → deploy. Desde acá las estrellas se acreditan.
4. BrunettiCutz: fase 4 (UI) → deploy.
5. Backfill opcional (2.3).

Entre los pasos 2 y 3 hay una ventana en la que **no** se acreditan estrellas
(minutos). El backfill del paso 5 la cubre.

### Pruebas locales

```bash
# terminal 1 — PimpStudio con funciones serverless
cd ~/Documents/GitHub/PIMPSTUDIO && npx vercel dev --listen 3001
```
```bash
# terminal 2 — BrunettiCutz apuntando al PimpStudio local
cd ~/Documents/GitHub/BRUNETTICUTZ && PIMPSTUDIO_API_BASE=http://localhost:3001 npx vercel dev
```

Checklist manual:
- [ ] Marcar una reserva "completada" en el panel de Brunetti → `+1` estrella en PimpStudio.
- [ ] Volver a marcarla "completada" (doble tap) → sigue en 1 estrella.
- [ ] Pasarla a "confirmada" → la estrella se revierte.
- [ ] Completar la misma reserva desde el panel de PimpStudio → sigue siendo 1 estrella (sin duplicado).
- [ ] `GET /api/clients?mode=wallet-pass&phone=…` en Brunetti devuelve un `.pkpass` válido (se abre en iPhone).
- [ ] Android: `wallet-pass-google` devuelve `saveUrl` y agrega el pase.
- [ ] Con `PIMPSTUDIO_API_BASE` apagado: el panel de Brunetti sigue funcionando y el PATCH no falla.
- [ ] Reservar desde brunetticutz.cl en iPhone → aparece el popup "Agregar a Wallet".

### Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| PimpStudio caído | Todo el puente es best-effort con timeout; el panel y las reservas de Brunetti nunca dependen de él. |
| Estrella doble | Un solo escritor + `bridge_ref` único (sección 3). |
| Estrella perdida (PimpStudio caído justo al completar) | El backfill (2.3) es idempotente: se puede correr cuando sea. |
| Peso del `.pkpass` por el proxy | ~50–150 KB, sin problema para una lambda; se transmite como buffer, no se guarda. |
| PII entre negocios | Los clientes de Brunetti quedan escritos en la tabla `users` de PimpStudio (nombre + teléfono). Es la consecuencia directa de compartir el programa de puntos; conviene reflejarlo en el aviso de privacidad. |

---

## Migraciones SQL (correr en la consola de Neon **de PimpStudio**)

Las tres son obligatorias antes de desplegar BrunettiCutz:

```sql
-- 1. Renombre del identificador puente: sin esto, las reservas de Bruno que ya
--    tenían estrella la vuelven a sumar la próxima vez que se marquen completadas.
UPDATE loyalty_events
SET bridge_ref = 'brunetti:' || split_part(bridge_ref, ':', 2)
WHERE kind = 'earn' AND bridge_ref LIKE 'bruno:%';

-- 2. Idempotencia del canje puente (el índice viejo mira booking_id, que acá va NULL).
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_events_bridge_redeem_unique
  ON loyalty_events (bridge_ref) WHERE kind = 'redeem_free_cut' AND bridge_ref IS NOT NULL;

-- 3. Origen de la campaña (el panel de Brunetti manda con sent_by NULL).
ALTER TABLE wallet_campaigns ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'pimpstudio';
```

En la base de **BrunettiCutz** no hay nada que migrar: la fidelidad no guarda
nada acá.

## Archivos tocados

**PimpStudio**
- `api/_bridge.js` *(nuevo)* — `isBridgeRequest`, sin imports (evita el ciclo `push.js` ↔ `_loyaltyBridge.js`).
- `api/_loyaltyBridge.js` *(nuevo)* — acreditar/revertir/canjear, saldos por teléfono, `walletStats()`.
- `api/clients.js` — modos `bridge-*`; `wallet-stats` ahora reusa `walletStats()`.
- `api/push.js` — campaña extraída a `sendWalletCampaign()`, reusada por el panel y por `bridge-campaign`.
- `api/bruno-agenda.js` — se le quitó `creditBridgeLoyalty()` (la estrella la acredita BrunettiCutz).
- `db/schema.sql` — las tres migraciones de arriba.
- `CLAUDE.md` — sección del puente.

**BrunettiCutz**
- `api/_loyaltyBridge.js` *(nuevo)* — cliente HTTP del puente, best-effort con timeout.
- `api/bookings.js` — `PATCH` acredita/revierte la estrella y soporta `{ redeem: "free_cut" }`; `DELETE` revierte.
- `api/clients.js` — modos `wallet-*` (pase Apple/Google, estado, link de WhatsApp, métricas, campañas) y estrellas en la ficha y en la lista de clientes.
- `src/walletPrompt.js`, `src/components/WalletPrompt.jsx`, `src/pages/CardShare.jsx` *(nuevos)*.
- `src/App.jsx` — ruta `/tarjeta`.
- `src/pages/Booking.jsx` — popup tras confirmar la reserva.
- `src/pages/Account.jsx` — tarjeta de estrellas + instalación.
- `src/pages/Dashboard.jsx` — badge, botón de WhatsApp, canje del corte gratis, pestaña Marketing.
- `.env.example`, `CLAUDE.md`.
