/* Host del mock de Academy — BrunettiCutz (docs/academy/PORTABLE.md §2).
   Único archivo de scripts/dev-mock/academy/ propio de este repo (academy-sync
   no lo pisa). Ver el de PimpStudio para qué es cada clave. */

// hostConfig.js (datos puros del front) manda en base y checkout si existe.
const cfg = await import(new URL('../../../src/academy/hostConfig.js', import.meta.url).href).catch(() => null)

const SITE = 'https://brunetticutz.cl'

export const MOCK_HOST = {
  key: 'brunetticutz',
  base: typeof cfg?.ACADEMY_BASE === 'string' && cfg.ACADEMY_BASE.startsWith('/') ? cfg.ACADEMY_BASE : '/cursos',
  checkoutPath: typeof cfg?.CHECKOUT?.path === 'string' ? cfg.CHECKOUT.path : '/api/mp-payments',
  statusUrl: typeof cfg?.CHECKOUT?.statusUrl === 'function' ? cfg.CHECKOUT.statusUrl : (ref) => `/api/mp-payments?status=1&ref=${encodeURIComponent(ref)}`,
  brand: {
    name: 'Brunetti Academy', initials: 'BA', color: '#1c1c1c',
    siteName: 'Brunetti', siteUrl: SITE, emailDomain: 'brunetticutz.cl',
    logo: '/assets/brunetti-logo-icon-192.png', cover: '/assets/bruno-hero-bg.webp', groupUrlLabel: 'brunetticutz.cl/cursos',
    bookingUrl: `${SITE}/reservar`,
    instagram: 'https://instagram.com/brunetticutz',
    siteInstagram: 'https://instagram.com/brunetticutz',
  },
  defaultLinks: [{ title: 'Reserva tu hora', url: `${SITE}/reservar` }],
  // Bruno es el barbero 6 en BrunettiCutz (su mock de /api trata cualquier Bearer como él).
  barber: { id: 6, name: 'Bruno Herrera', code: 'bruno-herrera', email: 'bruno@brunetticutz.cl', role: 'Barbero', tier: null },
  // Token del panel que emite scripts/dev-mock/index.mjs de BrunettiCutz: `mock.<id>.<ts>`.
  panelBarberId: (token) => (/^mock\.\d+\.[a-z0-9]+$/i.test(token) ? 6 : null),
  // Su mock propio también tiene /api/__mock/reset y /api/__mock/state.
  sharedMockTools: ['reset', 'state'],
  // Sin src/data/courses.js: solo el Método Brunetti (los demás slugs de demo se rellenan).
  seedCourses({ metodoBrunetti }) {
    return [metodoBrunetti]
  },
  // Mismo precio que el curso real de /cursos (src/academy/host.jsx).
  courseCfg: { 'brunetti-metodo': { price_online: 16990 } },
}
