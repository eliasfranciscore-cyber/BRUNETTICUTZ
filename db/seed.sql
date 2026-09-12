-- PIMP STUDIO — Seed data (base de prueba)
-- PIN hasheado con SHA-256 de "1234" = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
-- Contraseña de desarrollo: "Pimp2024" → SHA-256 = bc5e2f061fb85a8f0ea2fedd30df0142dc8b061b155e3b350ba01b68607464df
-- CAMBIAR password_hash en producción usando el endpoint PATCH /api/auth-barber

INSERT INTO barbers (id, name, short_name, code, role, tier, exp_years, rating, pin_hash, password_hash) VALUES
  (4,  'Juan Carlos',         'Juan Carlos', 'juan-carlos',         'Barbero Senior',      'general', 8,  4.9, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'bc5e2f061fb85a8f0ea2fedd30df0142dc8b061b155e3b350ba01b68607464df'),
  (5,  'Andryz',              'Andryz',      'andryz',              'Barbero',             'general', 5,  4.8, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'bc5e2f061fb85a8f0ea2fedd30df0142dc8b061b155e3b350ba01b68607464df'),
  (6,  'Brunetti',            'Brunetti',    'bruno-herrera',       'Visagista · Premium', 'premium', 12, 5.0, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'bc5e2f061fb85a8f0ea2fedd30df0142dc8b061b155e3b350ba01b68607464df'),
  (7,  'Diego Moya',          'Diego',       'diego-moya',          'Barbero',             'general', 6,  4.7, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'bc5e2f061fb85a8f0ea2fedd30df0142dc8b061b155e3b350ba01b68607464df'),
  (8,  'Thinn Sayen Herrera', 'Thinn S.',    'thinn-sayen-herrera', 'Barbero',             'general', 4,  4.8, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'bc5e2f061fb85a8f0ea2fedd30df0142dc8b061b155e3b350ba01b68607464df'),
  (9,  'Vicente Pietrapiana', 'Vicente',     'vicente-pietrapiana', 'Barbero',             'general', 5,  4.9, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'bc5e2f061fb85a8f0ea2fedd30df0142dc8b061b155e3b350ba01b68607464df'),
  (10, 'Rodrigo Godoy',       'Rodrigo',     'rodrigo-godoy',       'Barbero',             'general', 7,  4.8, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'bc5e2f061fb85a8f0ea2fedd30df0142dc8b061b155e3b350ba01b68607464df'),
  (11, 'Matías Inostroza',    'Matías',      'matias-inostroza',    'Barbero Junior',      'general', 3,  4.6, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'bc5e2f061fb85a8f0ea2fedd30df0142dc8b061b155e3b350ba01b68607464df')
ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash WHERE barbers.password_hash IS NULL;

INSERT INTO services (id, name, price, duration_min, category, tne_eligible, description) VALUES
  (5,  'Asesoría de corte',              24990, 90,  'general', true,  'Consulta profesional para encontrar tu estilo ideal.'),
  (6,  'Corte de cabello',               15990, 60,  'general', true,  'Corte profesional con técnicas modernas y clásicas.'),
  (7,  'Corte + perfilado de barba',     22990, 75,  'general', true,  'Servicio completo de corte y arreglo de barba.'),
  (8,  'Perfilado de barba',             11990, 45,  'general', true,  'Perfilado y arreglo profesional de barba.'),
  (9,  'Solo fade',                      9990,  40,  'general', true,  'Solo mantención de un fade ya hecho. No es un corte completo: si es tu primera vez acá, elige Corte de cabello.'),
  (10, 'Asesoría de Imagen · Visagista', 39990, 120, 'premium', false, 'Consulta personalizada según tu fisonomía.'),
  (11, 'Corte de cabello',               19990, 60,  'premium', false, 'Corte de precisión con técnicas avanzadas.'),
  (12, 'Corte de cabello y barba',       29990, 90,  'premium', false, 'Servicio premium completo de corte y barba.'),
  (13, 'Ondulación permanente',          65990, 180, 'quimico', false, 'Forma y textura duradera al cabello.'),
  (14, 'Platinado Global',               89990, 240, 'quimico', false, 'Decoloración completa para un rubio platino.'),
  (15, 'Visos Platinados',               74990, 210, 'quimico', false, 'Mechas platinadas para un look sofisticado.')
ON CONFLICT (id) DO NOTHING;

-- Usuarios de prueba
INSERT INTO users (phone, name, email) VALUES
  ('987654321', 'Carlos Rodríguez',  'carlos@ejemplo.com'),
  ('912345678', 'María González',    'maria@ejemplo.com'),
  ('956789012', 'Pedro Soto',        'pedro@ejemplo.com')
ON CONFLICT (phone) DO NOTHING;

-- Reservas de prueba (ajustar fechas al momento de ejecutar)
INSERT INTO bookings (client_id, barber_id, service_id, booking_date, booking_time, status) VALUES
  (1, 4, 7, CURRENT_DATE + 2, '11:00', 'confirmada'),
  (1, 9, 6, CURRENT_DATE - 9, '16:00', 'completada'),
  (2, 6, 10, CURRENT_DATE + 4, '10:00', 'confirmada'),
  (3, 5, 9, CURRENT_DATE - 3, '14:00', 'completada')
ON CONFLICT DO NOTHING;

INSERT INTO expenses (expense_date, category, detail, amount, owner) VALUES
  (CURRENT_DATE - 9, 'Insumos', 'Cera, navajas y peines', 145000, 'Brunetti'),
  (CURRENT_DATE - 7, 'Marketing', 'Campana Instagram', 85000, 'Brunetti'),
  (CURRENT_DATE - 4, 'Arriendo', 'Local Monumento 1750', 620000, 'Administracion')
ON CONFLICT DO NOTHING;

INSERT INTO barber_permissions (barber_id, can_view_finance, can_manage_team, can_edit_services, can_manage_blocks) VALUES
  (6, true, true, true, true)
ON CONFLICT (barber_id) DO UPDATE SET
  can_view_finance = EXCLUDED.can_view_finance,
  can_manage_team = EXCLUDED.can_manage_team,
  can_edit_services = EXCLUDED.can_edit_services,
  can_manage_blocks = EXCLUDED.can_manage_blocks;
