import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const SOURCE_PATHS = { cursos: '/cursos', workshop: '/workshop', essentials: '/essentials' }

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
    server.middlewares.use('/api/mp-payments', (req, res, next) => {
      const url = new URL(req.url, 'http://localhost')

      // GET ?status=1&payment_id=... — usado por el frontend al volver del checkout mock
      if (req.method === 'GET' && url.searchParams.get('status') === '1') {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ status: 'approved', paid: true, amount: 9990 }))
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
          const port = parseInt(process.env.PORT) || 5173
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            checkoutUrl: `http://localhost:${port}${path}?status=approved&payment_id=${paymentId}`,
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
  plugins: [react(), mockMpPlugin],
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
