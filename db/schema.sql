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
CREATE INDEX IF NOT EXISTS idx_expenses_date         ON expenses(expense_date);
