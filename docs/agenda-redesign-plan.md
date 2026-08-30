# Plan de implementación — Rediseño módulo Agenda (Panel interno Brunetti)

> **Ejecución programada:** 21 jul 2026, 01:10 (autónoma).
> **Objetivo:** recrear el módulo Agenda 1:1 con el mockup `Agenda.dc.html`
> reutilizando tokens/componentes existentes, con **cada botón funcional sobre
> datos reales**, **sin romper el diseño móvil**.
> **Rama:** trabajar sobre `desarrollo` (crear rama `feat/agenda-redesign` si se
> prefiere; NO commitear a `main`). Al terminar: `graphify update .`, `npm run
> build`, y verificación en preview (desktop + móvil 375px + tema claro/oscuro).

## Decisiones ya tomadas por el usuario (NO re-preguntar)

1. **Barra superior → Reconciliar.** Se MANTIENE la barra persistente del panel
   (`DashboardTopbar`: buscador global, `ThemeToggle`, campana, avatar, refresh).
   Dentro de Agenda se añade SOLO lo propio del módulo: kicker "PANEL INTERNO" +
   título, el toggle **Bloques/Línea**, y un **buscador local** de reservas.
   **NO** duplicar tema/campana/avatar dentro del contenido; **NO** tocar el
   chrome global salvo lo indicado.
2. **Modal Nueva reserva → Rediseñar el existente en 3 pasos.** Reconstruir
   `src/components/NewBookingModal.jsx` con el look de 3 pasos del mockup PERO
   conectado a datos reales (clientes por teléfono, servicios del menú, precio,
   `createBooking`). No usar servicios/precios demo.
3. **"Cancelar cita" (modal detalle) → marcar `cancelada`** vía
   `updateBookingStatus(bk, 'cancelada')` (reversible, conserva historial). NO
   usar `deleteBooking`/purge.

## Contexto verificado del código actual

- **Bloque Agenda:** `src/pages/Dashboard.jsx` líneas ~836–1008 (dentro de
  `{tab === "agenda" && agendaDayKey && (...)}`).
- **Estado ya existente en `Dashboard()`:** `agendaBarber`, `agendaDayKey`,
  `weekOffset`, `availability` (mapa `dayKey → [{slot, state:'free'|'blocked'|'booked', available}]`),
  `agendaBusy`, `agendaError`, `newBookingOpen`, `visibleBookings`, `weekDays =
  buildWeek(weekOffset)`, `weekStats {booked,free,blocked}`.
- **Handlers ya existentes (reutilizar, NO reescribir su lógica de red):**
  `toggleSlot(dayKey, slot, state)`, `bulkAgenda(scope, mode)` con
  scope ∈ {morning,afternoon,day,week} y mode ∈ {block,enable},
  `goToWeek(offset)`, `goToDayInReservas(dayKey)`, `createBooking(draft)`,
  `updateBookingStatus(booking, status)`, `deleteBooking(booking)`,
  `authHeaders()`, `loadAgenda()`, `isoDate(date)`, `buildWeek(offset)`,
  `AGENDA_SLOTS` = 09:00…19:00.
- **Componentes reutilizables:** `AnimatedRing`, `KpiTile` (`src/components/DashKit.jsx`),
  `Panel` (local en Dashboard.jsx:100), `Icon` (`src/components/ui.jsx` /
  `IconsExtra.jsx`), `NewBookingModal`.
- **CSS existente:** clases `.agenda-*` en `src/styles/pimp.css` (~3018–3277),
  `.dk-*` en `src/styles/modules.css` (~607–760). Tokens en `pimp.css` +
  `brunetti.css`.
- **Chrome persistente:** `DashboardTopbar` (Dashboard.jsx:2300+) ya provee
  título "Agenda", `GlobalSearch`, `ThemeToggle`, campana con popup, avatar.

## Tokens (verificar/añadir antes de todo)

Ya existen (dark + light): `--gold`, `--gold-lt`, `--gold-line`, `--gold-grad`,
`--gold-glow`, `--on-gold`, `--ink`, `--ink-soft`, `--muted`, `--muted-2`,
`--hair`, `--hair-2`, `--gold-soft`, `--gold-edge`, `--gold-bright`.

**Acción:**
1. Confirmar que `--gold-soft`, `--gold-edge`, `--gold-bright`, `--on-gold` están
   definidos en **ambos** temas (dark en `pimp.css` `:root`, light en
   `[data-theme="light"]`/`brunetti.css`). Si falta el valor dark, añadirlo con
   los valores del handoff (dark: `--gold-bright:#e7c87e`,
   `--gold-soft:rgba(214,178,102,.14)`, `--gold-edge:rgba(214,178,102,.5)`,
   `--on-gold:#1c1606`).
2. **Añadir tokens semánticos** `--green` y `--red` a `pimp.css`:
   - `:root` (dark): `--green:#6fbf86; --red:#d99a8f;`
   - `[data-theme="light"]`: `--green:#3f9d63; --red:#c26a5a;`
   (Hoy el código los usa inline como `var(--green,#6fbf86)`; centralizarlos.)
3. Confirmar que **Space Grotesk** ya carga (var `--font-display`). Si no, añadir
   el `<link>` de Google Fonts en `index.html`. No inventar tipografías nuevas.

---

## FASE 1 — Estado y utilidades nuevas en `Dashboard()`

Añadir estos `useState` junto a los de agenda (tras `agendaError`):

```js
const [agendaView, setAgendaView] = useState('grid')      // 'grid' | 'timeline'
const [agendaQuery, setAgendaQuery] = useState('')        // buscador local
const [calOpen, setCalOpen] = useState(false)
const [calMonth, setCalMonth] = useState(() => new Date().getMonth())
const [calYear, setCalYear] = useState(() => new Date().getFullYear())
const [detail, setDetail] = useState(null)                // reserva abierta en modal (o null)
const [toasts, setToasts] = useState([])                  // [{id, icon, msg}]
const dragRef = useRef({ active: false, mode: null })     // arrastre bloqueo
```

**Toasts (helper + auto-dismiss 3s):**
```js
const pushToast = useCallback((icon, msg) => {
  const id = Date.now() + Math.random()
  setToasts((t) => [...t, { id, icon, msg }])
  setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000)
}, [])
```
Importar `useCallback`, `useRef` (ya importado) desde React.

**Arrastre para bloquear rangos** (mouseup global termina el arrastre):
```js
useEffect(() => {
  const up = () => { dragRef.current = { active: false, mode: null } }
  window.addEventListener('mouseup', up)
  window.addEventListener('touchend', up)
  return () => { window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up) }
}, [])
```

**Filtro local de reservas del día** (usar en el panel "Reservas del día" y en la
lista): filtra por `agendaQuery` sobre `client`/`service` (case-insensitive).

**KPIs — datos reales:**
- `Reservados · sem` = `weekStats.booked`.
- `Disponibles · sem` = `weekStats.free` (sufijo `h`).
- `Bloqueados · sem` = `weekStats.blocked`.
- `Nuevos vs recurrentes` (del día): unir las reservas del día con `clients` por
  teléfono; recurrente si `client.visits > 1` (o `status === 'recurrente'`),
  nuevo si no. Valor `"{nuevos}/{recurrentes}"`, delta `"{recurrentes} recurrentes hoy"`.
- **Deltas "vs sem. ant.":** cargar de forma ligera la disponibilidad de la
  semana anterior (offset −1) una sola vez y guardarla en `prevWeekStats`
  (mismo patrón que `loadAgenda`, en su propio `useEffect`, con fallback a `null`).
  Si `prevWeekStats` existe: `Δreservados = booked - prev.booked`, etc., con
  flecha ▲/▼ y color `--green`/`--red`. Si no hay datos previos, **ocultar el
  delta** (no inventar números). Los KPI tiles admiten `sub`/`children`; usar
  `sub` para el delta o extender `KpiTile` con prop opcional `delta`.

**"Próximo" (chip del hero):** primera reserva no cancelada del día ordenada por
hora → `"{cliente} · {hora}"`; si no hay, `"sin reservas"`.

---

## FASE 2 — JSX del módulo Agenda (reemplazo del bloque 836–1008)

Estructura de arriba a abajo (contenedor `div.animate-in` con `display:grid; gap`):

### 2.1 Cabecera propia de Agenda (reconciliada)
- Fila con kicker "PANEL INTERNO" (`--gold-bright`, uppercase, `letter-spacing:.22em`)
  + no repetir un H1 "Agenda" gigante si el topbar ya lo muestra; en su lugar usar
  el kicker + un **buscador local** (`input` con icono `⌕`/`Icon search`) ligado a
  `agendaQuery`, y colocarlo discretamente. (El toggle de vista va en el panel del
  día, no aquí.) Mantener el bloque de error `agendaError` existente.

### 2.2 Hero + KPIs (reestilizar el `dk-hero` existente)
- `AnimatedRing pct={dayOcc} size={84} label="del día"`.
- Kicker "AGENDA DE BRUNETTI" + fecha larga (usar `DOW_LONG` en español:
  `['Domingo','Lunes',...]` a partir de `new Date(agendaDayKey)`), + "{booked}/{total}
  horas reservadas hoy" + **chip "⏱ Próximo: {cliente · hora}"** (`--gold-soft`,
  texto `--gold-bright`, `border-radius:99px`).
- **4 KPI tiles** con `KpiTile` (añadir el 4º "Nuevos vs recurrentes"). Grid
  `repeat(auto-fit,minmax(150px,1fr))`. Deltas coloreados por signo.
- CTA **"＋ Nueva reserva"** → `setNewBookingOpen(true)` (`btn btn-gold`, look del CTA).
- Ajustar `dk-hero-grid` a las columnas necesarias (hoy `cols-5`).

### 2.3 Navegación semana/día
- Segmented "Esta semana"/"Semana siguiente" → `goToWeek(0)` / `goToWeek(1)`
  (ya existe; conservar).
- Franja `agenda-day-scroll` con `agenda-day-pill` (ya existe). **Añadir el punto
  indicador**: si el día tiene alguna reserva (`availability[d.key]` con algún
  `state==='booked'`), mostrar `<span class="agenda-day-pill-dot" />`. El día de
  hoy muestra "HOY".
- **Botón 📅** (icono `calendar`) que hace `setCalOpen(v => !v)`.

### 2.4 Date-picker popover (NUEVO — componente `AgendaDatePicker`)
- Card 320px, `--card`, borde `--hair-2`, sombra, animación `ag-pop`.
- Header con ‹ / › (cambian `calMonth/calYear`) + "{Mes} {Año}" en español.
- Grid 7col encabezados `L M M J V S D` + celdas de día (`aspect-ratio:1`).
  Semana **Lun-primera** (`(firstDay.getDay()+6)%7`).
- Día seleccionado (= `agendaDayKey`) → `--gold-grad`+`--on-gold`; hoy → `--gold-soft`.
- **Al elegir día:** si cae dentro de las 2 semanas reservables (offset 0 ó 1),
  `goToWeek(offset)` + `setAgendaDayKey(key)` + cerrar. Si no →
  `pushToast('📅','Fecha fuera del rango reservable (7 días)')` y cerrar.
- Posicionar como popover (absolute) anclado al botón; en móvil, centrar/ancho
  `min(320px, calc(100vw - 2rem))`.

### 2.5 Acciones masivas
- "✕ Bloquear día completo" / "✓ Habilitar día completo" (etiqueta alterna según
  `dayFree===0`) → `bulkAgenda('day', ...)` (ya existe).
- "✕ Bloquear semana completa" / "✓ Habilitar semana completa" →
  `bulkAgenda('week', ...)`.
- **Hint** a la derecha: "Arrastra sobre las horas para bloquear un rango ⇄"
  (`--muted`, 12px). Ocultar hint en móvil (`@media max-width:560px`).
- Cada acción masiva dispara un `pushToast`.

### 2.6 Layout principal (`agenda-layout`, grid `1.55fr .9fr`)

**Panel del día "Brunetti"** (`Panel` existente):
- Header: "Brunetti" + chip "{n} libres" + **toggle segmentado Bloques/Línea**
  (`▦ Bloques` / `☰ Línea`) que setea `agendaView`. Estilos: fondo `--hair`,
  tab activa `--card` + texto `--gold-bright`.
- Leyenda (existe): Atiende / Bloqueado / Reservado.

- **Vista Bloques** (`agendaView==='grid'`): periodos MAÑANA(<12) / TARDE(≥12).
  Cada periodo: header (título + botón Habilitar/Bloquear del periodo →
  `bulkAgenda('morning'|'afternoon', ...)`). Grid `repeat(auto-fill,minmax(84px,1fr))`.
  **Rediseñar cada slot** para mostrar **hora (14px/700) + tag** (`Libre`/`Bloqueado`/
  `Reservado`) apilados, alineados a la izquierda, `padding:10px 12px`,
  `border-radius:13px`. Estados (ver CSS FASE 3):
  - free → `--gold-soft` + borde `--gold-edge`, tag `--gold-bright`
  - blocked → `--hair-2`, tag `--muted`
  - booked → `--gold-grad` + borde `--gold-edge`, tag `--on-gold`
  - **Interacción:**
    - `onMouseDown`/`onTouchStart` en slot free/blocked: fija
      `dragRef.current={active:true, mode: state==='free'?'block':'enable'}` y
      aplica al slot (`toggleSlot`).
    - `onMouseEnter` mientras `dragRef.current.active` y el slot no es booked:
      aplica `toggleSlot` sólo si el estado difiere del modo (evitar toggles
      dobles: bloquear sólo libres, habilitar sólo bloqueados).
    - Slots `booked`: no togglean; `onClick` abre `setDetail(bookingDeEseSlot)`.
    - Slot free/blocked con click simple (sin arrastre) sigue haciendo toggle +
      toast (comportamiento actual).
  - **NB anti-doble-guardado:** en arrastre usar una guardia para no volver a
    llamar `toggleSlot` sobre un slot ya en el estado objetivo (revisar
    `availability` antes de aplicar). No romper el optimismo/rollback existente.

- **Vista Línea** (`agendaView==='timeline'`, NUEVO): filas por hora 09:00–19:00:
  etiqueta hora (46px, `--muted`) + riel vertical 3px (color por estado) + card
  con título + badge. Si hay reserva: cliente + servicio + badge "confirmada"
  (dorado) / "pendiente" (`--hair-2`). Libre → "Disponible" + badge "Libre".
  Bloqueado → "Bloqueado". Click en fila con reserva → `setDetail(bk)`.

**Panel "Reservas del día"** (`Panel` existente):
- Header "Reservas del día" + chip fecha corta.
- Lista de filas-botón (usar `.agenda-day-booking` existente, reestilizado):
  hora (`--gold-bright`) + cliente/servicio + badge estado. **Click → `setDetail(bk)`**
  (antes iba a `goToDayInReservas`; ahora abre el modal detalle). Aplicar filtro
  `agendaQuery`.
- Vacío: caja dashed "Sin reservas este día." (existe).

### 2.7 Modal detalle (NUEVO — componente `BookingDetailModal`)
- Render con `createPortal` a `document.body` (mismo patrón que NewBookingModal).
- Overlay `rgba(0,0,0,.55)` + `backdrop-filter:blur(4px)`, card
  `width:min(460px,100%)`, `--card`, borde `--hair-2`, animación `ag-pop`.
- Badge de estado arriba + botón ✕. Avatar 52px (`--gold-grad`, inicial) +
  nombre + tag cliente ("Cliente nuevo" / "Cliente recurrente · N visitas" según
  `clients`). Grid 2×2: HORA / SERVICIO / FECHA / PRECIO (precio con `CLP()`).
- Acciones:
  - **"✓ Confirmar"** → `updateBookingStatus(bk,'confirmada')` + `pushToast('✓','Cita confirmada')` + cerrar.
  - **"Cancelar cita"** (borde/texto `--red`) → `updateBookingStatus(bk,'cancelada')`
    + `pushToast('✕','Cita de {cliente} cancelada')` + cerrar. Tras cancelar,
    `loadAgenda()` para liberar el slot en la grilla.
- Cerrar con ✕, click en overlay, y tecla Escape.

### 2.8 Toasts (NUEVO — contenedor fijo)
- `position:fixed; bottom:22px; right:22px; z-index:60; display:flex; column; gap:10px`.
- Cada toast: `--card`, borde `--gold-edge`, sombra, icono + mensaje, animación
  `ag-toast`. Renderizar desde `toasts`. En móvil: `left:16px; right:16px` para
  no desbordar.

---

## FASE 3 — CSS (`src/styles/pimp.css` sección agenda + `modules.css`)

1. **Keyframes** (añadir si no existen): `ag-pop`, `ag-toast`, `ag-in`. (Reusar
   `fadeUp` existente donde aplique.)
2. **`.agenda-tile` rediseñado** (¡ojo, invierte el look actual!):
   - Cambiar a `flex-direction:column; align-items:flex-start; gap:3px;
     padding:10px 12px; border-radius:13px; min-height:52px; text-align:left`.
   - `.agenda-tile .agenda-tile-h` (hora) 14px/700; `.agenda-tile .agenda-tile-tag`
     10px/600.
   - `.free`: `background:var(--gold-soft); border-color:var(--gold-edge)`;
     tag `color:var(--gold-bright)`.
   - `.blocked`: `background:var(--hair-2); border-color:transparent`; tag `--muted`.
   - `.booked`: `background:var(--gold-grad); border-color:var(--gold-edge)`;
     hora/tag `color:var(--on-gold)`.
   - Actualizar overrides `[data-theme="light"]` acordes.
   - **Compat:** el `.agenda-tile` de `NewBookingModal` (`.psn-newbk-slots .agenda-tile`)
     hoy sólo muestra la hora centrada. Si se rediseña el modal (FASE 5) se ajusta;
     si se mantuviera el markup viejo, garantizar que sigue centrando (regla
     específica `.psn-newbk-slots .agenda-tile { justify-content:center; align-items:center }`).
3. **`.agenda-tile-grid`**: pasar a `grid-template-columns:repeat(auto-fill,minmax(84px,1fr))`
   (hoy es `repeat(auto-fill,74px)` con filas fijas de 44px, que no cabe el tag).
4. **`.agenda-day-pill-dot`**: 5px, `border-radius:50%`, `--gold-bright`
   (en activa `--on-gold`); reservar el hueco aunque no haya punto.
5. **Toggle de vista** `.agenda-view-toggle` (contenedor `--hair`, radios) +
   `.agenda-view-tab` / `.is-on`.
6. **Timeline**: `.agenda-timeline`, `.agenda-tl-row`, `.agenda-tl-time`,
   `.agenda-tl-rail`, `.agenda-tl-card`, `.agenda-tl-badge` (variantes por estado).
7. **Date picker**: `.agenda-cal`, `.agenda-cal-head`, `.agenda-cal-grid`,
   `.agenda-cal-dow`, `.agenda-cal-day`, `.is-sel`, `.is-today`.
8. **Modal detalle**: `.agenda-detail-*` (o reutilizar clases `psn-modal`/
   `psn-modal-card` existentes + celdas `.agenda-detail-cell`).
9. **Toasts**: `.agenda-toasts`, `.agenda-toast`.
10. **Chip próximo**: `.agenda-next-chip`.

**Reutilizar tokens** en todas las reglas (`var(--gold-*)`, `var(--hair*)`,
`var(--ink*)`, `var(--muted*)`, `var(--green)`, `var(--red)`). No hardcodear
colores salvo los ya presentes en el repo.

---

## FASE 4 — Responsive / móvil (NO ROMPER)

Guardas existentes que se conservan: `dk-hero-grid` → 1 col a ≤560px;
`agenda-layout` 1 col <1024px; `agenda-day-scroll` horizontal; `agenda-controls`
1 col ≤480px. **Añadir/verificar:**

- **Hero:** en ≤560px el ring, textos, chip próximo y CTA se apilan; los 4 KPI a
  1–2 columnas (`auto-fit minmax(150px,1fr)` ya lo hace). CTA a ancho completo.
- **`.agenda-tile-grid`:** `minmax(84px,1fr)` reflowa; en ≤360px permitir
  `minmax(72px,1fr)` para que quepan ≥3 por fila.
- **Toggle Bloques/Línea:** no desbordar el header del panel; permitir wrap.
- **Timeline:** filas full-width, hora 46px fija, card flexible. Verificar a 375px.
- **Date picker:** ancho `min(320px, calc(100vw - 2rem))`, y no salirse del
  viewport (revisar posición absolute; si estorba, en móvil centrar como sheet).
- **Hint "Arrastra…":** ocultar en ≤560px (el arrastre igual funciona por touch,
  pero el texto sobra).
- **Toasts:** `left:16px; right:16px; bottom:16px` en ≤560px.
- **Modales (nueva reserva 3 pasos + detalle):** `width:min(460px,100%)`,
  `max-height:88vh; overflow:auto`, padding reducido en móvil.
- **Arrastre táctil:** asegurar que en móvil el tap simple sigue togglando (no
  exigir drag). El drag por touch es un plus; el click/tap individual es el
  camino principal en móvil.

**Prueba obligatoria:** preview a 1280px y a **375px**, en tema **oscuro y claro**.

---

## FASE 5 — Rediseño de `NewBookingModal` a 3 pasos (datos reales)

Mantener toda la lógica real actual (autocompletar clientes, teléfono 9 dígitos,
servicios del menú + personalizado, precio, fecha/hora con disponibilidad,
`onCreate`/`createBooking`, validaciones, Escape, portal). **Solo** reorganizar
la UI en 3 pasos con barra de progreso:

- **Barra de progreso:** 3 segmentos `height:4px`; ≤ paso actual `--gold-grad`,
  resto `--hair-2`.
- **Paso 1 · Cliente & servicio:** input nombre (+ autocompletar existente) +
  teléfono + grid de servicios reales (nombre + `CLP(precio)`; seleccionado borde
  `--gold-edge` fondo `--gold-soft`) + opción "Personalizado" + input precio.
- **Paso 2 · Fecha & hora:** input date + grid de horas libres reales
  (`repeat(auto-fill,minmax(72px,1fr))`), seleccionada `--gold-edge`/`--gold-soft`.
  Conservar "Otra hora" (input libre) y el aviso de duración multi-bloque.
- **Paso 3 · Confirmar:** resumen (cliente/servicio/fecha/hora/precio) en caja
  `--gold-soft`/`--gold-edge`.
- **Footer:** secundario ("Cancelar" en paso 1, "Atrás" luego) + primario
  ("Continuar" / "Confirmar reserva" en paso 3). Validar por paso antes de
  avanzar (nombre+teléfono+servicio+precio en 1; fecha+hora en 2). Al confirmar:
  `onCreate(draft)`; si ok, cerrar y `pushToast('✓','Reserva de {cliente} confirmada')`
  (el toast lo dispara el padre vía callback `onCreated`, o el modal expone
  `onCreate` que ya vuelve `{ok}`; en Dashboard, tras ok, hacer el toast).
- Mantener estado inicial (`status`) — puede quedar en el paso 3 o como default
  `confirmada`.

Si el tiempo apremia y el rediseño del modal amenaza estabilidad, **degradar con
gracia:** dejar el modal actual funcionando (decisión del usuario prioriza que
funcione) y marcar el rediseño del modal como pendiente — PERO intentar los 3
pasos primero.

---

## FASE 6 — Integración, verificación y cierre

1. Cablear el modal detalle y toasts en el árbol de `Dashboard` (junto a
   `NewBookingModal`, al final del `main`).
2. `graphify update .` (mantener el grafo).
3. `npm run build` — debe pasar sin errores.
4. **Preview + verificación** (browser tools):
   - Desktop 1280px, tema oscuro y claro.
   - Móvil 375px, tema oscuro y claro.
   - Consola sin errores; sin scroll horizontal del body.
5. Checklist funcional (cada botón):
   - [ ] Cambiar semana (Esta/Siguiente) reubica día si hace falta.
   - [ ] Pills de día seleccionan; punto indicador aparece en días con reservas; "HOY" en hoy.
   - [ ] 📅 abre date-picker; navegar meses; elegir día dentro de rango salta; fuera de rango → toast.
   - [ ] Bloquear/Habilitar día y semana (labels alternan) + toast; persiste (optimista+rollback).
   - [ ] Toggle periodo (mañana/tarde) bloquea/habilita + toast.
   - [ ] Click en slot libre/bloqueado togglea + toast; arrastre bloquea/habilita rango.
   - [ ] Click en slot reservado abre modal detalle.
   - [ ] Toggle Bloques/Línea cambia vista; timeline muestra reservas y libres.
   - [ ] Buscador local filtra reservas del día.
   - [ ] "＋ Nueva reserva" abre modal 3 pasos; crear reserva real persiste, cierra y toast; el slot pasa a reservado.
   - [ ] Modal detalle: Confirmar → estado confirmada + toast; Cancelar → cancelada + libera slot + toast.
   - [ ] Ring de ocupación y KPIs muestran datos reales; deltas coherentes o ocultos.
   - [ ] Tema claro/oscuro correctos en todo el módulo.
6. NO commitear a `main`. Dejar cambios en `desarrollo`/rama; NO `vercel --prod`
   salvo que el usuario lo pida.

## Riesgos / notas

- La **inversión de color** de `.agenda-tile` (free pasa de dorado brillante a
  `--gold-soft`; booked pasa a `--gold-grad`) afecta también al picker del modal
  de reserva → por eso FASE 3 punto 2 incluye el override de compatibilidad.
- Deltas de KPI requieren datos de la semana anterior; si la API no los da,
  ocultar el delta (nunca inventar cifras).
- Mantener el `agendaBarber` fijo a Brunetti (single-barber) como hoy.
- Respetar `prefers-reduced-motion` (los componentes DashKit ya lo hacen).
