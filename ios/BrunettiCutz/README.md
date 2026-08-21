# Brunetti Cutz iOS

App iOS nativa en SwiftUI para gestion interna de Brunetti. No usa WebView: consume las APIs del proyecto (`/api/*`) por HTTP y mantiene datos demo como fallback para poder navegar la app cuando el backend local no tiene sesion firmada o variables de entorno.

## Abrir en Xcode

1. Abre `ios/BrunettiCutz/BrunettiCutz.xcodeproj`.
2. Selecciona el scheme `BrunettiCutz`.
3. Usa un Simulator iOS 27 o un iPhone fisico.
4. Para backend local, deja el servidor API en `http://127.0.0.1:3003` en Simulator.

En iPhone fisico, `127.0.0.1` apunta al telefono. Usa la IP local del Mac, por ejemplo:

```text
http://192.168.1.25:3003
```

## Servidor local

Desde la raiz del repo:

```bash
vercel dev --listen 3003
```

La app usa por defecto `http://127.0.0.1:3003`.

## APIs usadas

- `/api/auth-barber`: login interno del barbero.
- `/api/bookings`: listar, crear y cambiar estado de reservas.
- `/api/availability`: leer/bloquear/desbloquear slots de agenda.
- `/api/clients`: listar y guardar clientes.
- `/api/register-client`: respaldo de registro publico de cliente.
- `/api/services`: listar/crear/editar servicios.
- `/api/expenses`: listar/crear gastos.
- `/api/barbers`: listar equipo/permisos.
- `/api/enrollments`: listar/crear inscripciones de cursos/workshop.
- `/api/auth-login`: lookup de cuenta cliente.
- `/api/mp-payments`: crear checkout, confirmar y consultar estado de pago vía Mercado Pago Checkout Pro.
- `/api/push`: endpoint Web Push de la PWA. Push nativo real requiere APNs y soporte backend adicional.

## Sesion interna y fallback

Las APIs internas del backend validan tokens firmados con `PS_SESSION_SECRET` o `ADMIN_API_TOKEN`. Si esas variables no estan configuradas, el backend falla cerrado y la app conserva datos demo para que la interfaz siga siendo usable.

Para probar datos reales:

1. Configura `PS_SESSION_SECRET` en el entorno local/Vercel.
2. Configura credenciales de barbero (`DATABASE_URL` o `BARBER_PASSWORDS`).
3. Inicia sesion desde la app con el usuario real.

## Build nativo e IPA

Para Simulator basta con `Run` desde Xcode.

Para iPhone fisico / IPA:

1. En Xcode, abre el target `BrunettiCutz`.
2. Configura `Signing & Capabilities` con tu Team.
3. Mantén bundle id `cl.brunetticutz.internal` o ajustalo a tu cuenta.
4. Conecta el iPhone y ejecuta `Run`, o usa `Product > Archive`.
5. Desde Organizer exporta Ad Hoc, Development o TestFlight segun corresponda.

## Funciones nativas incluidas

- Modo claro/oscuro/sistema.
- Liquid Glass con fallback para sistemas anteriores.
- Dashboard interactivo con foco Dia/Semana/Workshop.
- Agenda con selector semanal, ocupacion, crear reserva desde slot, bloquear/desbloquear, abrir reservas ocupadas.
- Reservas con cambio de estado, WhatsApp y recordatorios locales.
- Clientes con historial, WhatsApp, agendar e inscribir a workshop.
- Workshop/cursos con inscripciones nativas.
- Servicios, finanzas, gastos y marketing.
- Configuracion con diagnostico de endpoints, equipo/permisos, Flow, auth cliente y export CSV.
