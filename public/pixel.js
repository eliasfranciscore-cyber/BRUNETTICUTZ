/* BRUNETTI — Meta Pixel
   ------------------------------------------------------------------
   Mismo píxel y mismo archivo que pimpstudio.cl (public/pixel.js allá): el
   Método Brunetti se vende por las dos puertas (brunetticutz.cl/metodo y
   pimpstudio.cl/academy) y se mide con UN píxel. Archivo propio y no
   <script> inline por la misma razón que /boot.js (CSP sin 'unsafe-inline'
   en /cursos/…). Registra un PageView por cada carga dura de página; las
   navegaciones internas las marca src/track.js (ViewContent, Lead…).

   NO corre en /cursos/… (la app de alumnos y sus páginas de acceso): esas
   URLs dicen qué lección mira un alumno o de quién es un perfil, y no tienen
   por qué terminar en Facebook (Ley 21.719). La vitrina /cursos (sin barra
   final) sí mide, como el resto del sitio.

   Única excepción: /cursos/gracias, la vuelta de Mercado Pago. Ahí no se
   mira nada del alumno: se consulta el estado del pedido (el mismo GET
   público que usa la página) y, si quedó pagado, se marca UNA compra
   (Purchase) por referencia. Su regla de CSP en vercel.json deja pasar a
   Facebook solo en esa ruta. */
(function () {
  var PIXEL_ID = '837101656042970';
  var path;
  try { path = location.pathname; } catch (e) { return; }
  // En desarrollo no mide: las pruebas en localhost caerían en el píxel real
  // de los anuncios. Para probarlo igual: localStorage.bc_pixel_dev = '1'.
  try {
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && localStorage.getItem('bc_pixel_dev') !== '1') return;
  } catch (e) { return; }
  var gracias = path === '/cursos/gracias' || path === '/cursos/gracias/';
  if (path.indexOf('/cursos/') === 0 && !gracias) return;

  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');

  if (!gracias) return;

  /* Compra: el pedido se confirma por el webhook, a veces unos segundos
     después de volver. Se pregunta cada 4 s, hasta 8 veces; un estado que no
     sea "pendiente" corta. La marca en localStorage evita contarla dos veces
     si la persona recarga la página. */
  var ref;
  try { ref = new URLSearchParams(location.search).get('ref') || ''; } catch (e) { return; }
  if (!/^aca-[0-9a-f]{32}$/.test(ref)) return;
  var mark = 'bc_px_purchase:' + ref;
  try { if (localStorage.getItem(mark)) return; } catch (e) { /* sin storage: se marca igual */ }

  var tries = 0;
  function check() {
    tries += 1;
    fetch('/api/mp-payments?status=1&ref=' + encodeURIComponent(ref), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.status === 'pagada') {
          try { localStorage.setItem(mark, '1'); } catch (e) {}
          fbq('track', 'Purchase', {
            value: Number(d.total) || 0,
            currency: 'CLP',
            content_type: 'product',
            content_ids: [d.course && d.course.slug ? d.course.slug : 'curso'],
            content_name: d.course && d.course.title ? d.course.title : undefined,
          });
          return;
        }
        if ((!d || d.status === 'pendiente') && tries < 8) setTimeout(check, 4000);
      })
      .catch(function () { if (tries < 8) setTimeout(check, 4000); });
  }
  setTimeout(check, 1500);
})();
