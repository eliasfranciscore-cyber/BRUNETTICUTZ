-- PIMP STUDIO — Schema PostgreSQL (NEON)
-- Ejecutar en la consola SQL de NEON antes de usar la app

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  phone      VARCHAR(20)  UNIQUE NOT NULL,
  name       VARCHAR(200),
  email      VARCHAR(300),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Marca a quién ya se le mandó por correo el link de su tarjeta de fidelidad
-- (panel → Marketing → "Mandar la tarjeta por correo", api/clients.js
-- ?mode=wallet-send-cards). Es lo que hace que el envío se pueda cortar y
-- retomar sin escribirle dos veces al mismo cliente. La crea el propio
-- endpoint con ADD COLUMN IF NOT EXISTS, igual que push_subscriptions: acá
-- queda documentada.
ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_card_emailed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS barbers (
  id         INTEGER PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  short_name VARCHAR(100),
  code       VARCHAR(100) UNIQUE NOT NULL,
  role       VARCHAR(200),
  tier       VARCHAR(50)  DEFAULT 'general',
  exp_years  INTEGER      DEFAULT 0,
  rating     DECIMAL(3,1) DEFAULT 5.0,
  active     BOOLEAN      DEFAULT true,
  pin_hash   VARCHAR(64),
  password_hash VARCHAR(64),
  created_at TIMESTAMP    DEFAULT NOW()
);

-- Para bases existentes (idempotente):
ALTER TABLE barbers ADD COLUMN IF NOT EXISTS password_hash VARCHAR(64);

-- Migración: actualiza password_hash solo en filas que aún no lo tienen.
-- Contraseña de desarrollo por defecto: "Pimp2024" (cambiar en producción).
UPDATE barbers
  SET password_hash = 'bc5e2f061fb85a8f0ea2fedd30df0142dc8b061b155e3b350ba01b68607464df'
  WHERE password_hash IS NULL;

CREATE TABLE IF NOT EXISTS services (
  id            INTEGER PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  price         INTEGER      NOT NULL,
  duration_min  INTEGER      NOT NULL,
  category      VARCHAR(50)  NOT NULL,
  tne_eligible  BOOLEAN      DEFAULT false,
  description   TEXT,
  active        BOOLEAN      DEFAULT true
);

CREATE TABLE IF NOT EXISTS bookings (
  id            SERIAL PRIMARY KEY,
  client_id     INTEGER REFERENCES users(id),
  barber_id     INTEGER REFERENCES barbers(id),
  service_id    INTEGER REFERENCES services(id),
  booking_date  DATE        NOT NULL,
  booking_time  TIME        NOT NULL,
  status        VARCHAR(50) DEFAULT 'confirmada',
  notes         TEXT,
  created_at    TIMESTAMP   DEFAULT NOW(),
  updated_at    TIMESTAMP   DEFAULT NOW()
);

-- Para bases existentes (idempotente): reservas manuales del panel pueden
-- llevar servicio/precio personalizado (service_id queda NULL en ese caso).
-- ⚠️ Ejecutar en la consola de Neon ANTES de desplegar la API que los usa.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS custom_service VARCHAR(200);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS custom_price  INTEGER;

-- Para bases existentes (idempotente): el UNIQUE(barber_id, booking_date,
-- booking_time) original bloqueaba PARA SIEMPRE cualquier horario que
-- alguna vez hubiera tenido una reserva cancelada (el INSERT chocaba con el
-- constraint aunque la reserva vieja estuviera en status 'cancelada', y esa
-- excepción se colaba silenciosamente por el manejo de errores del endpoint).
-- Un índice único parcial deja libres los horarios cancelados para
-- reagendar, y sigue evitando doble reserva en horarios activos.
-- ⚠️ Ejecutar en la consola de Neon ANTES de desplegar la API que los usa.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_barber_id_booking_date_booking_time_key;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_slot_unique
  ON bookings (barber_id, booking_date, booking_time)
  WHERE status <> 'cancelada';

-- Para bases existentes (idempotente): sincronización con Notion Calendar +
-- recordatorios push 60min/15min antes de la hora. ⚠️ Ejecutar en la consola
-- de Neon ANTES de desplegar la API que los usa.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notion_page_id   VARCHAR(64);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_60_sent BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_15_sent BOOLEAN DEFAULT false;

-- ---------------------------------------------------------------------------
-- Ciclo de vida y cobro de una atención. Desde acá en adelante las columnas y
-- tablas nuevas las crea el propio código al vuelo (ensure* en
-- api/_schema.js, mirando information_schema antes de cada ALTER): este
-- archivo es la definición canónica, no un paso manual previo al deploy.
-- Todo es aditivo, así que la versión anterior del código sigue funcionando
-- sobre la base ya migrada.
--
-- Ninguna es un estado nuevo: la app de iOS decodifica `status` con un enum
-- estricto de 5 valores y un valor desconocido le rompería la lista.
--   no_show            "No vino" = cancelada + no_show.
--   started_at         cuándo pasó a "en curso".
--   auto_completed_at  la completó el sistema, no una persona.
--   completed_at       cuándo entró a "completada": marca desde cuándo se
--                      cobra de verdad. Las completadas viejas (NULL) siguen
--                      contando al precio.
--   redeem_state       canje del corte gratis: NULL | 'redeemed' | 'voided'
--                      (cancelada con las 10 estrellas devueltas). Un canje
--                      anterior a esta columna es custom_price = 0 con NULL.
--                      Lo escribe solo api/_bookingLife.js.
--   price_snapshot     precio de catálogo congelado al completar.
--   paid_amount        lo que REALMENTE entró en caja (NULL = sin cobrar).
--   payment_method     ver PAYMENT_METHODS en api/_money.js. 'cortesia' = monto
--                      0 a propósito (canje, corte de la casa).
--   payment_ref        n.º de boleta / operación según el medio.
--   paid_at            cuándo se registró el cobro.
--   charged_by         quién lo registró.
-- "Pago por confirmar" = completada + completed_at puesto + paid_at NULL.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS no_show           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS started_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redeem_state      VARCHAR(10),
  ADD COLUMN IF NOT EXISTS price_snapshot    INTEGER,
  ADD COLUMN IF NOT EXISTS paid_amount       INTEGER,
  ADD COLUMN IF NOT EXISTS payment_method    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_ref       VARCHAR(60),
  ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS charged_by        INTEGER REFERENCES barbers(id) ON DELETE SET NULL;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_method_check
  CHECK (payment_method IN ('efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'cortesia'));
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_redeem_state_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_redeem_state_check
  CHECK (redeem_state IN ('redeemed', 'voided'));
CREATE INDEX IF NOT EXISTS idx_bookings_en_curso ON bookings (id) WHERE status = 'en curso';
CREATE INDEX IF NOT EXISTS idx_bookings_open ON bookings (booking_date)
  WHERE status IN ('pendiente', 'confirmada', 'en curso');
CREATE INDEX IF NOT EXISTS idx_bookings_paid ON bookings (booking_date) WHERE paid_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS availability_blocks (
  id         SERIAL PRIMARY KEY,
  barber_id  INTEGER REFERENCES barbers(id),
  block_date DATE        NOT NULL,
  slot_time  TIME        NOT NULL,
  reason     VARCHAR(200),
  created_at TIMESTAMP   DEFAULT NOW(),
  UNIQUE (barber_id, block_date, slot_time)
);

CREATE TABLE IF NOT EXISTS expenses (
  id           SERIAL PRIMARY KEY,
  expense_date DATE        NOT NULL,
  category     VARCHAR(120) NOT NULL,
  detail       TEXT        NOT NULL,
  amount       INTEGER     NOT NULL CHECK (amount > 0),
  owner        VARCHAR(160) DEFAULT 'Brunetti',
  created_at   TIMESTAMP   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS barber_permissions (
  barber_id       INTEGER PRIMARY KEY REFERENCES barbers(id),
  can_view_finance BOOLEAN DEFAULT false,
  can_manage_team  BOOLEAN DEFAULT false,
  can_edit_services BOOLEAN DEFAULT false,
  can_manage_blocks BOOLEAN DEFAULT true,
  updated_at       TIMESTAMP DEFAULT NOW()
);

-- Suscripciones Web Push por barbero (notificaciones iOS / PWA)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  barber_id  INTEGER REFERENCES barbers(id),
  endpoint   TEXT UNIQUE NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Inscripciones a Cursos / Workshop. api/enrollments.js (inscripción manual
-- desde el panel) y api/mp-payments.js (webhook de Mercado Pago, tras pago
-- aprobado) crean esta tabla en caliente si no existe.
CREATE TABLE IF NOT EXISTS enrollments (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'cursos',   -- 'cursos' | 'workshop'
  level      TEXT,
  message    TEXT,
  edition    TEXT,
  amount     INTEGER,                          -- NULL para leads de lista de espera; monto pagado si vino del webhook
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pedidos pagados del módulo "Essentials" (tienda de clientes) vía Mercado
-- Pago Checkout Pro. api/mp-payments.js crea la orden en 'pending' al armar
-- la preferencia de pago y la pasa a 'paid' desde el webhook, tras validar
-- el pago real contra la API de Mercado Pago (nunca confía en el retorno del
-- navegador). `items` guarda un snapshot de {productId,name,price,qty} por
-- ítem — el precio se congela al momento de pagar, no sigue al catálogo.
CREATE TABLE IF NOT EXISTS shop_orders (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT NOT NULL,
  items         JSONB NOT NULL,
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'paid'
  mp_payment_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ajustes clave/valor editables desde el panel interno (Config → Precios y
-- fechas): precio de Cursos, precio de Workshop, fecha del Workshop. Leído
-- por api/mp-payments.js (?settings=1) — si la tabla o una fila no existe,
-- el cobro sigue funcionando con los defaults en FIXED_PRICES.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Catálogo de productos del módulo "Essentials" (tienda de clientes).
-- Gestionado desde el panel interno (pestaña Essentials); api/_products.js
-- también crea esta tabla en caliente si no existe (igual que enrollments).
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  brand       VARCHAR(120) DEFAULT '',
  description TEXT         DEFAULT '',
  price       INTEGER      NOT NULL,
  old_price   INTEGER,
  stock       INTEGER      NOT NULL DEFAULT 0,
  active      BOOLEAN      NOT NULL DEFAULT true,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  img_front   TEXT,
  img_back    TEXT,
  img_detail  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Historial de notificaciones push enviadas (para el popup de la campana en
-- el panel). barber_id nullable para permitir a futuro avisos de notifyAll()
-- que no son de un barbero concreto. api/push.js también la crea en caliente
-- si no existe (igual que push_subscriptions/products).
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  barber_id  INTEGER REFERENCES barbers(id),
  title      TEXT NOT NULL,
  body       TEXT,
  url        TEXT,
  tag        TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_barber       ON push_subscriptions(barber_id);
CREATE INDEX IF NOT EXISTS idx_notifications_barber   ON notifications(barber_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_barber_date  ON bookings(barber_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_client       ON bookings(client_id);
CREATE INDEX IF NOT EXISTS idx_users_phone           ON users(phone);
CREATE INDEX IF NOT EXISTS idx_products_sort         ON products(sort_order, id);
CREATE INDEX IF NOT EXISTS idx_shop_orders_status     ON shop_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_date         ON expenses(expense_date);

-- ============================================================================
-- Columnas y tablas que crea el código al vuelo (api/_schema.js). Definición
-- canónica; ver el comentario de "Ciclo de vida y cobro" más arriba.
-- ============================================================================

-- Profesión del cliente: texto libre y opcional (ensureClientColumns).
ALTER TABLE users ADD COLUMN IF NOT EXISTS profession TEXT;

-- Servicios (ensureServiceColumns):
--   featured          aparece en "Los más pedidos" de /reservar
--   only_on_date      servicio de un solo día: solo se ofrece y se agenda esa
--                     fecha (NULL = todos los días)
--   loyalty_eligible  "Suma estrella". En false, completar ese servicio no
--                     acredita estrella (loyaltyForTransition) y la reserva no
--                     sale en GET /api/bookings?mode=bridge-completed, para
--                     que el repaso de PimpStudio tampoco la acredite.
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS featured         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS only_on_date     DATE,
  ADD COLUMN IF NOT EXISTS loyalty_eligible BOOLEAN NOT NULL DEFAULT true;

-- Movimientos manuales de Finanzas (ensureExpenseColumns): la misma tabla
-- guarda gastos e ingresos. Default 'gasto' porque las filas existentes son
-- gastos y la app de iOS suma todo lo que devuelve GET /api/expenses.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'gasto'
  CHECK (kind IN ('gasto', 'ingreso'));

-- Reseñas de barbero (ensureReviewsTable). Una fila por reserva completada,
-- creada al completarla con el token de 32 hex que va en el correo de
-- "Gracias por tu visita" (/resena?t=<token>). `rating` queda NULL hasta que
-- el cliente califica. UNIQUE(booking_id) es la marca de "ya se pidió": evita
-- el doble correo si la reserva se completa dos veces.
CREATE TABLE IF NOT EXISTS barber_reviews (
  id         SERIAL PRIMARY KEY,
  booking_id INTEGER UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  barber_id  INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  token      VARCHAR(40) NOT NULL UNIQUE,
  rating     SMALLINT CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rated_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_barber_reviews_rated ON barber_reviews (barber_id, rated_at DESC) WHERE rating IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Inventario y venta en el mesón (ensureProductsLedger). Sin comisión.
-- products.stock SIGUE SIENDO LA VERDAD: lo leen y descuentan el checkout y
-- el webhook de Mercado Pago. product_stock_moves es la historia de por qué
-- cambió; la vista de inventario muestra el desfase y "cuadrar" inserta un
-- 'ajuste'. Nunca se reescribe el stock desde el libro, y ninguna migración
-- escribe un saldo de apertura.
--   archived_at  borrado suave: DELETE archiva (los movimientos y las líneas
--                de venta referencian el producto)
--   sku, cost    opcionales (cost valoriza el inventario)
-- ---------------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sku         VARCHAR(60),
  ADD COLUMN IF NOT EXISTS cost        INTEGER;

-- Una fila por evento de pago en el mesón. booking_id NULL = venta de
-- mostrador sin reserva. discount_pct = el 30% de fidelidad, si se aplicó.
CREATE TABLE IF NOT EXISTS product_sales (
  id             SERIAL PRIMARY KEY,
  booking_id     INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  client_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sale_date      DATE NOT NULL,
  source         VARCHAR(12) NOT NULL DEFAULT 'mostrador' CHECK (source IN ('atencion', 'mostrador')),
  status         VARCHAR(12) NOT NULL DEFAULT 'pagada' CHECK (status IN ('pagada', 'anulada')),
  payment_method VARCHAR(20) CHECK (payment_method IN ('efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'cortesia')),
  payment_ref    VARCHAR(60),
  discount_pct   SMALLINT NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  total          INTEGER NOT NULL DEFAULT 0,
  paid_at        TIMESTAMPTZ,
  charged_by     INTEGER REFERENCES barbers(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON product_sales (sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_booking ON product_sales (booking_id);

-- Líneas de la venta, con nombre y precios congelados. unit_price = catálogo;
-- unit_collected = lo cobrado por unidad (difiere con el descuento).
CREATE TABLE IF NOT EXISTS product_sale_items (
  id             SERIAL PRIMARY KEY,
  sale_id        INTEGER NOT NULL REFERENCES product_sales(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  qty            INTEGER NOT NULL CHECK (qty > 0),
  name_snapshot  VARCHAR(200) NOT NULL,
  unit_price     INTEGER NOT NULL,
  unit_collected INTEGER NOT NULL,
  unit_cost      INTEGER,
  line_total     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON product_sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON product_sale_items (product_id);

-- El libro del inventario: un delta firmado por movimiento.
--   inicial | compra | venta | devolucion | merma | ajuste
-- shop_order_id (pedido web de Essentials) va sin FK: shop_orders la crea
-- api/mp-payments.js cuando le toca.
CREATE TABLE IF NOT EXISTS product_stock_moves (
  id            SERIAL PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  delta         INTEGER NOT NULL CHECK (delta <> 0),
  kind          VARCHAR(20) NOT NULL CHECK (kind IN ('inicial', 'compra', 'venta', 'devolucion', 'merma', 'ajuste')),
  reason        TEXT,
  unit_cost     INTEGER,
  sale_item_id  INTEGER REFERENCES product_sale_items(id) ON DELETE SET NULL,
  shop_order_id INTEGER,
  created_by    INTEGER REFERENCES barbers(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_moves_product ON product_stock_moves (product_id, created_at);

-- Cuándo se confirmó el pago de un pedido web (ensureShopOrderColumns). Las
-- ventas online (onlineSales en api/_money.js) cuentan desde acá y, si falta,
-- desde created_at.
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Autenticación del panel (ensureAuthColumns)
-- ---------------------------------------------------------------------------
-- password_hash pasa de VARCHAR(64) (justo un SHA-256 en hex) a TEXT, para el
-- formato PBKDF2 ("pbkdf2", iteraciones, sal y hash separados por "$").
-- VARCHAR a TEXT no reescribe la tabla.
ALTER TABLE barbers ALTER COLUMN password_hash TYPE TEXT;
-- pin_hash quedó obsoleto: el alta de barberos ya no lo escribe (ni un PIN
-- "1234" por defecto) y nadie lo lee. La columna se conserva.

-- Correo del barbero para restablecer la contraseña. Único sin importar
-- mayúsculas.
ALTER TABLE barbers ADD COLUMN IF NOT EXISTS email VARCHAR(300);
CREATE UNIQUE INDEX IF NOT EXISTS barbers_email_unique ON barbers (lower(email)) WHERE email IS NOT NULL;

-- Enlaces de restablecimiento. Se guarda el SHA-256 del token, nunca el token:
-- quien lea esta tabla no puede usar ningún enlace.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash   CHAR(64) PRIMARY KEY,
  barber_id    INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requested_ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_password_resets_barber ON password_resets (barber_id, created_at DESC);

-- Intentos fallidos de login (3 fallos → 5 minutos de bloqueo). Vive en la
-- base y no en el navegador, porque el bloqueo de localStorage se saltaba
-- borrando el storage. La crea api/_rateLimit.js (checkLoginLock) si no existe.
CREATE TABLE IF NOT EXISTS login_attempts (
  key          TEXT PRIMARY KEY,
  failures     INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_failure TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
