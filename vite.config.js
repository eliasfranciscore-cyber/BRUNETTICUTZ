import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Mock de toda la API para desarrollo: solo con VITE_DEV_MOCKS=1 y solo en
// `vite` (serve). Sin la variable no registra nada. Ver scripts/dev-mock.
import devMockPlugin from './scripts/dev-mock/index.mjs'

/* Mock de la API de la Brunetti Academy (docs/academy/SPEC.md §13,
   docs/academy/PORTABLE.md): SOLO con VITE_DEV_MOCKS=1 (`npm run dev:mock`
   o la config "dev-mock" de .claude/launch.json). Sin la variable ni
   siquiera se importa, así `npm run dev` y `vite build` quedan exactamente
   como antes.
   scripts/dev-mock/academy/ es código COMPARTIDO con PimpStudio (lo copia
   scripts/academy-sync.mjs); lo propio de acá está en
   scripts/dev-mock/academy/host.mjs (base /cursos, checkout en
   /api/mp-payments, marca, barbero 6).
   El import es con una URL armada en tiempo de ejecución a propósito: así
   esbuild no lo empaqueta dentro del config y Node carga los archivos del
   mock tal cual (sus import.meta.url, rutas relativas y el top-level await
   de host.mjs siguen valiendo). */
const academyDevMock = process.env.VITE_DEV_MOCKS === '1'
  ? (await import(new URL('./scripts/dev-mock/academy/index.mjs', import.meta.url).href)).default()
  : null

// A dónde vuelve el navegador después de pagar. Essentials tiene su propia
// página de gracias (igual que los back_urls de api/mp-payments.js).
const SOURCE_PATHS = { cursos: '/cursos', workshop: '/workshop', essentials: '/essentials/gracias' }

const mockMpPlugin = {
  name: 'mock-mercadopago',
  // Sin `return` (pre-hook): se registra ANTES que los middlewares internos
  // de Vite. Con un post-hook (return () => {...}), el servido estático
  // interno de Vite le gana a las peticiones GET a /api/mp-payments — como
  // ese path coincide con un archivo real del proyecto (api/mp-payments.js),
  // Vite devuelve el código fuente crudo en vez de dejar pasar la petición
  // a este middleware. Los POST no se veían afectados (el servido estático
  // solo aplica a GET/HEAD), pero el status check si.
  configureServer(server) {
    // Montos "cobrados" por este mock, por payment_id (Q26): así el GET de
    // estado devuelve lo mismo que se registró al pagar, en vez de un 9990
    // fijo sin relación con el checkout que lo generó. Solo vive en memoria
    // de este proceso de `vite`, como el resto del mock.
    const payments = new Map()

    server.middlewares.use('/api/mp-payments', (req, res, next) => {
      const url = new URL(req.url, 'http://localhost')

      // GET ?status=1&payment_id=... — usado por el frontend al volver del checkout mock
      if (req.method === 'GET' && url.searchParams.get('status') === '1') {
        const amount = payments.get(url.searchParams.get('payment_id')) ?? 9990
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ status: 'approved', paid: true, amount }))
        return
      }

      if (req.method !== 'POST') return next()
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          console.log('✓ Mock Mercado Pago:', data.source, data.email)
          const paymentId = `mock_${Date.now()}`
          const path = SOURCE_PATHS[data.source] || '/'
          const amount = 9990
          payments.set(paymentId, amount)
          // El Host de la propia petición, no un puerto fijo: `npm run dev`
          // (sin VITE_DEV_MOCKS) puede levantar en otro puerto
          // (strictPort:false) o abrirse por 127.0.0.1, y un checkoutUrl a un
          // origen distinto deja atrás el sessionStorage/localStorage de esta
          // pestaña — el carrito real nunca se vacía y el comprobante sale
          // sin detalle.
          const host = req.headers.host || `localhost:${parseInt(process.env.PORT) || 5173}`
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            checkoutUrl: `http://${host}${path}?status=approved&payment_id=${paymentId}`,
            preferenceId: paymentId,
          }))
        } catch (e) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Invalid request' }))
        }
      })
    })
  },
}

export default defineConfig({
  // Orden de los middlewares = orden de los plugins (todos se montan en el
  // pre-hook de configureServer):
  //   1. academyDevMock (solo VITE_DEV_MOCKS=1): /api/academy, el checkout de
  //      cursos en /api/mp-payments (POST kind:'course' y GET ?status=1&ref=aca-…)
  //      y /api/__mock/academy/*. Lo demás sigue con next() — un POST que no es
  //      de un curso se re-emite con el mismo body para el mock de abajo — y
  //      /api/__mock/reset y /state los contestan los dos (cada uno lo suyo).
  //   2. devMockPlugin (solo VITE_DEV_MOCKS=1): el resto de /api/* de acá,
  //      incluido el checkout de Workshop/Essentials.
  //   3. mockMpPlugin: sin la variable, el Mercado Pago de siempre.
  plugins: [react(), academyDevMock, devMockPlugin({ returnPaths: SOURCE_PATHS }), mockMpPlugin].filter(Boolean),
  server: {
    port: parseInt(process.env.PORT) || 5173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    // Vendor split: React y el router cambian poco, así el navegador los cachea
    // entre deploys y solo re-descarga el código de la app cuando cambia.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
    // Sube el umbral de inline para evitar warnings con CSS grande ya minificado.
    chunkSizeWarningLimit: 700,
  },
})
