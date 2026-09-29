/* BRUNETTI — arranque síncrono en <head> (antes del primer paint)
   ------------------------------------------------------------------
   Antes era un <script> inline en index.html. Se movió a un archivo propio
   porque /cursos/(.+) (la app de la Brunetti Academy) lleva un CSP sin
   'unsafe-inline' en script-src: es lo que impide que un `javascript:` o un
   handler inline escrito por un miembro se ejecute en el mismo origen que el
   panel. index.html es el mismo documento para todas las rutas (rewrite del
   SPA), así que no puede tener NINGÚN script inline.

   Se sirve con no-store (regla /((?!assets/|api/).*) de vercel.json): NO
   moverlo a /assets/, que se cachea un año como inmutable y congelaría un
   archivo sin hash.

   1. Tema inicial sin flash: respeta la elección manual; si no, la hora de
      Santiago (claro de 07:00 a 18:59, oscuro el resto). Mismos colores que
      ThemeProvider (src/components/theme.jsx) y que el script inline de
      antes: el comportamiento no cambia, solo de dónde se carga.
   2. Recuerda con qué ruta arrancó ESTE documento (window.__psBootPath). El
      CSP de un documento queda fijo al cargarlo: sirve para saber si se cargó
      con el CSP estricto de /cursos/(.+) o si se llegó navegando desde otra
      página (igual que en PimpStudio). */
(function () {
  try { window.__psBootPath = location.pathname } catch (e) {}
  try {
    var t;
    if (localStorage.getItem('ps_theme_manual') === '1') { t = localStorage.getItem('ps_theme') || 'dark'; }
    else {
      var h = parseInt(new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: 'numeric', hour12: false }).format(new Date()), 10) % 24;
      t = (h >= 7 && h < 19) ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', t);
    var bg = t === 'light' ? '#f7f3ea' : '#080807';
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', bg);
    // Fija el color de raíz desde el primer paint (iOS lo muestrea para la
    // barra de estado → evita una banda oscura sobre una página clara).
    document.documentElement.style.backgroundColor = bg;
    if (document.body) document.body.style.backgroundColor = bg;
  } catch (e) { document.documentElement.setAttribute('data-theme', 'dark'); }
})();
