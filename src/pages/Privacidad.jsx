import React, { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import SiteNav from '../components/SiteNav.jsx'
import ModuleFooter from '../components/ModuleFooter.jsx'
import { scrollToId } from '../components/brunetti.jsx'
import { waShopHref } from '../data.js'
import '../styles/privacidad.css'

/* ================================================================
   /privacidad — Política de privacidad y protección de datos.
   ----------------------------------------------------------------
   Cumple el deber de información y transparencia de la Ley 19.628
   modificada por la Ley 21.719 (art. 14 ter, letras a–l): quién es el
   responsable y cómo contactarlo, qué datos se tratan y de quién, para
   qué y con qué base, a quién se comunican, transferencias al
   extranjero, plazos, fuente, seguridad, derechos (ARSOPOB), el reclamo
   ante la Agencia, el retiro del consentimiento y las decisiones
   automatizadas. Enlazada desde el pie de todas las páginas públicas
   (ModuleFooter y el pie propio del Workshop).

   Describe lo que el sitio hace de verdad: si se suma un proveedor, un
   formulario o un dato nuevo, se actualiza acá y se sube la versión.
   pimpstudio.cl tiene su propia política (misma estructura); lo que se
   comparte entre los dos sitios —agenda de Bruno, fidelidad y Academy—
   tiene que decir lo mismo en las dos.
   Los datos del responsable van en RESPONSABLE (son los mismos que en
   pimpstudio.cl); un campo vacío no se muestra.
   ================================================================ */

const POLICY = { version: '1.0', date: '4 de noviembre de 2026' }

const RESPONSABLE = {
  nombre: 'Bruno Benjamín Herrera Aranda',
  marca: 'Brunetti (brunetticutz.cl)',
  rut: '21.317.534-3',
  domicilio: 'Monumento 1750, local C, Maipú, Región Metropolitana, Chile',
  correo: 'pimpstudiochile@gmail.com',
}

const WA_TEXT = 'Hola, quiero hacer una solicitud sobre mis datos personales (Ley 21.719).'

const SECTIONS = [
  ['responsable', 'Quién es el responsable'],
  ['datos', 'Qué datos tratamos y de quién'],
  ['finalidades', 'Para qué los usamos y con qué base'],
  ['destinatarios', 'Con quién los compartimos'],
  ['extranjero', 'Transferencias fuera de Chile'],
  ['plazos', 'Cuánto tiempo los guardamos'],
  ['fuente', 'De dónde vienen'],
  ['medicion', 'Cookies, píxel y medición'],
  ['automatizadas', 'Decisiones automatizadas'],
  ['seguridad', 'Cómo los protegemos'],
  ['derechos', 'Tus derechos y cómo ejercerlos'],
  ['menores', 'Niños, niñas y adolescentes'],
  ['cambios', 'Cambios a esta política'],
]

const SECTION_N = Object.fromEntries(SECTIONS.map(([id], i) => [id, i + 1]))
const SECTION_TITLE = Object.fromEntries(SECTIONS)

function Section({ id, children }) {
  return (
    <section className="priv-section" id={id}>
      <h2><span className="priv-n">{String(SECTION_N[id]).padStart(2, '0')}</span>{SECTION_TITLE[id]}</h2>
      {children}
    </section>
  )
}

export default function Privacidad() {
  const navigate = useNavigate()
  useEffect(() => { window.scrollTo(0, 0) }, [])
  const wa = waShopHref(WA_TEXT)

  return (
    <div className="brunetti-site priv-page">
      <SiteNav />

      <main>
        <header className="priv-hero">
          <div className="bwrap priv-wrap">
            <span className="bhero-kicker"><span className="dot" /> Ley 21.719 · Protección de datos</span>
            <h1>Privacidad y protección de datos personales</h1>
            <p className="priv-lede">
              Cómo Brunetti recoge, usa, guarda y protege tus datos cuando reservas, compras, te inscribes en un curso
              o haces una asesoría de imagen, y cómo puedes ejercer tus derechos.
            </p>
            <p className="priv-meta">Versión {POLICY.version} · vigente desde el {POLICY.date}</p>
          </div>
        </header>

        <div className="bwrap priv-wrap">
          <aside className="priv-summary" aria-label="Resumen">
            <h2>En corto</h2>
            <ul>
              <li>Pedimos solo lo necesario: tu nombre, tu teléfono y, si quieres, tu correo.</li>
              <li>No vendemos tus datos ni los usamos para otra cosa que lo que aquí se explica.</li>
              <li>Los pagos los procesa Mercado Pago: nunca vemos ni guardamos los datos de tu tarjeta.</li>
              <li>Tus fotos de la asesoría de imagen son privadas y solo se suben con tu consentimiento expreso.</li>
              <li>
                Puedes pedir ver, corregir, borrar o llevarte tus datos cuando quieras, gratis, por{' '}
                <a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                {RESPONSABLE.correo && <> o a <a href={`mailto:${RESPONSABLE.correo}`}>{RESPONSABLE.correo}</a></>}.
              </li>
            </ul>
          </aside>

          <nav className="priv-toc" aria-label="Contenido">
            <span className="priv-toc-h">Contenido</span>
            <ol>
              {SECTIONS.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} onClick={(e) => { e.preventDefault(); scrollToId(id) }}>{label}</a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="priv-body">
            <Section id="responsable">
              <p>
                El responsable de los datos personales que se tratan en este sitio es <strong>{RESPONSABLE.nombre}</strong>
                {RESPONSABLE.rut && <>, RUT {RESPONSABLE.rut}</>}, titular de la marca {RESPONSABLE.marca}.
              </p>
              <dl className="priv-dl">
                <dt>Domicilio</dt>
                <dd>{RESPONSABLE.domicilio}</dd>
                <dt>Solicitudes sobre tus datos</dt>
                <dd>
                  <a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp +56 9 8748 3279</a>
                  {RESPONSABLE.correo && <> · <a href={`mailto:${RESPONSABLE.correo}`}>{RESPONSABLE.correo}</a></>}
                  {' '}· o en persona en el local
                </dd>
                <dt>Encargado de prevención</dt>
                <dd>No hemos designado uno: las solicitudes las atiende directamente el responsable.</dd>
              </dl>
            </Section>

            <Section id="datos">
              <p>Tratamos datos de estas personas, y solo los que cada caso necesita:</p>
              <ul className="priv-list">
                <li>
                  <strong>Clientes de la barbería.</strong> Nombre, teléfono y correo (opcional); las reservas (fecha, hora,
                  servicio, precio, estado y si asististe); lo que pagaste y el medio de pago (no los datos de la tarjeta);
                  tus estrellas del programa de fidelidad; y, si la dejas, tu calificación y comentario de la visita.
                </li>
                <li>
                  <strong>Compradores de la tienda Essentials.</strong> Nombre, correo, teléfono, los productos, el monto y
                  el estado del pago.
                </li>
                <li>
                  <strong>Interesados e inscritos en el Workshop, el Método Brunetti y los cursos.</strong> Nombre, teléfono,
                  correo, la edición o curso que te interesa, el estado del pago y desde dónde llegaste (por ejemplo, un
                  anuncio o una campaña).
                </li>
                <li>
                  <strong>Alumnos de la Brunetti Academy.</strong> Nombre, correo, contraseña (guardada cifrada, nunca en
                  texto), foto y datos de perfil que decidas publicar, tus publicaciones, comentarios y mensajes, tu
                  avance en las lecciones, tu nivel y tus preferencias de notificación.
                </li>
                <li>
                  <strong>Clientes de la asesoría de imagen (Brunetti Image Studio).</strong> Datos de contacto, lo que
                  respondes en el formulario (estilo, rutina, lo que notas en tu pelo), fotos de tu rostro y cabello, fotos
                  y videos cortos del antes y después tomados en el local, el diagnóstico de Bruno y tu informe. Algunas
                  respuestas —como caspa, caída o cuero cabelludo sensible— pueden referirse a tu salud: por eso las
                  tratamos solo con tu consentimiento expreso.
                </li>
                <li>
                  <strong>Visitantes del sitio.</strong> Datos técnicos de navegación (páginas vistas, dispositivo,
                  identificadores de cookies) para medir el sitio y los anuncios; ver <a href="#medicion" onClick={(e) => { e.preventDefault(); scrollToId('medicion') }}>Cookies, píxel y medición</a>.
                </li>
                <li>
                  <strong>El equipo.</strong> Los datos de acceso al panel interno de quienes trabajan en la barbería.
                </li>
              </ul>
              <p>No pedimos tu RUT, tu dirección ni datos bancarios.</p>
            </Section>

            <Section id="finalidades">
              <div className="priv-table" role="table">
                <div className="priv-tr priv-th" role="row">
                  <span role="columnheader">Para qué</span>
                  <span role="columnheader">Base de legitimidad</span>
                </div>
                {[
                  ['Agendar, confirmar, reprogramar y recordarte tus horas; registrar la atención y su pago.', 'Ejecución del servicio que pediste.'],
                  ['Procesar tus compras, inscripciones y cursos, y darte acceso a lo que pagaste.', 'Ejecución del contrato.'],
                  ['Hacer tu asesoría de imagen con tus fotos y respuestas, y entregarte el informe.', 'Tu consentimiento expreso, que das en el formulario.'],
                  ['Sumar estrellas en la tarjeta de fidelidad compartida con Pimp Studio y canjear beneficios.', 'Interés legítimo en darte el beneficio por tus visitas; puedes oponerte y dejar de participar.'],
                  ['Enviarte la lección de muestra o información del curso que pediste.', 'Tu consentimiento, al dejar tus datos.'],
                  ['Pedirte una reseña después de tu visita.', 'Interés legítimo en mejorar la atención; puedes oponerte.'],
                  ['Medir las visitas al sitio y el resultado de nuestros anuncios.', 'Interés legítimo en saber qué funciona; puedes oponerte (ver Cookies).'],
                  ['Proteger el sitio: bloquear intentos de acceso repetidos y prevenir abusos.', 'Interés legítimo en la seguridad del servicio.'],
                  ['Llevar la contabilidad y cumplir obligaciones tributarias.', 'Cumplimiento de una obligación legal.'],
                ].map(([fin, base]) => (
                  <div className="priv-tr" role="row" key={fin}>
                    <span role="cell">{fin}</span>
                    <span role="cell">{base}</span>
                  </div>
                ))}
              </div>
              <p>
                Cuando usamos el interés legítimo, es solo para lo que esperarías razonablemente de una barbería con la que
                ya tienes relación, y nunca por sobre tus derechos. No usamos tus datos para fines distintos a estos ni te
                enviamos publicidad que no hayas pedido.
              </p>
            </Section>

            <Section id="destinatarios">
              <p>No vendemos ni arrendamos tus datos. Solo los comunicamos a:</p>
              <ul className="priv-list">
                <li>
                  <strong>Pimp Studio</strong> (pimpstudio.cl), la barbería donde atiende Bruno, en el mismo local. Su panel
                  gestiona la agenda de Bruno y ve la ficha de sus clientes (nombre, teléfono, correo, visitas y gasto);
                  administra el programa de fidelidad compartido (tu teléfono y nombre, para que tus estrellas sumen en los
                  dos locales); y la Brunetti Academy es la misma de Pimp Studio, con una sola base de datos de alumnos.
                </li>
                <li>
                  <strong>Proveedores que trabajan por encargo nuestro</strong> y solo pueden usar los datos para prestarnos
                  su servicio:
                  <ul>
                    <li>Vercel (alojamiento del sitio, funciones y almacenamiento privado de fotos y archivos).</li>
                    <li>Neon (base de datos).</li>
                    <li>Mercado Pago (pagos en línea; trata los datos de tu tarjeta como responsable propio).</li>
                    <li>Resend (envío de correos de confirmación, avisos e informes).</li>
                    <li>Notion (calendario interno de reservas).</li>
                    <li>Meta Platforms (píxel de medición de anuncios; y WhatsApp, cuando nos escribes por ahí).</li>
                    <li>Apple y Google (si agregas la tarjeta de fidelidad a tu Wallet).</li>
                    <li>YouTube (videos incrustados en algunas páginas).</li>
                  </ul>
                </li>
                <li>
                  <strong>Autoridades</strong>, solo cuando una ley o una resolución judicial lo exija.
                </li>
              </ul>
            </Section>

            <Section id="extranjero">
              <p>
                Varios de los proveedores anteriores guardan o procesan datos fuera de Chile, principalmente en
                <strong> Estados Unidos</strong> (Vercel, Neon, Resend, Notion, Meta, Apple, Google). A la fecha, la Agencia
                de Protección de Datos Personales no ha declarado que Estados Unidos ofrezca un nivel adecuado de
                protección. Estas transferencias se amparan en que son necesarias para prestarte el servicio que pediste y
                en los términos de tratamiento de datos de cada proveedor, que los obligan a usar los datos solo por
                encargo nuestro, a mantenerlos confidenciales y a protegerlos con medidas de seguridad.
              </p>
            </Section>

            <Section id="plazos">
              <ul className="priv-list">
                <li><strong>Ficha de cliente y reservas:</strong> mientras seas cliente. Si pasan 3 años sin que vuelvas, la eliminamos o anonimizamos.</li>
                <li><strong>Pagos, ventas y compras:</strong> 6 años, por obligaciones tributarias.</li>
                <li><strong>Interesados en cursos o el Workshop que no compraron:</strong> hasta 2 años desde el último contacto, o antes si pides la baja.</li>
                <li><strong>Cuenta de la Academy:</strong> mientras la tengas activa; al cerrarla eliminamos tu perfil y tus mensajes.</li>
                <li><strong>Fotos, videos e informes de la asesoría de imagen:</strong> hasta 2 años desde tu última asesoría, o antes si pides que los borremos.</li>
                <li><strong>Datos de medición:</strong> la cookie del píxel de Meta dura hasta 90 días; el origen de tu visita (campaña) se borra al cerrar el navegador.</li>
              </ul>
              <p>Al vencer un plazo, los datos se eliminan o se anonimizan de forma que ya no te identifiquen.</p>
            </Section>

            <Section id="fuente">
              <p>
                Casi todos los datos nos los das tú: al reservar, comprar, inscribirte, completar el formulario de la
                asesoría o escribirnos. Otros los genera el servicio (tus reservas, pagos y estrellas), los registra Bruno
                en el panel cuando te atiende en el local, o nos llegan de Pimp Studio (las estrellas que sumaste allá) y
                de Mercado Pago (la confirmación de tu pago). No obtenemos datos de fuentes de acceso público.
              </p>
            </Section>

            <Section id="medicion">
              <ul className="priv-list">
                <li>
                  <strong>Píxel de Meta.</strong> Registra las páginas que visitas y acciones como iniciar una compra o
                  dejar tus datos, para medir y mostrar nuestros anuncios en Facebook e Instagram. Usa cookies de Meta. No
                  corre dentro de la app de alumnos de la Academy. Puedes bloquearlo desde la configuración de cookies de
                  tu navegador o desde la configuración de anuncios de tu cuenta de Meta.
                </li>
                <li>
                  <strong>Vercel Web Analytics.</strong> Cuenta visitas de forma agregada, sin cookies y sin identificarte.
                </li>
                <li>
                  <strong>Almacenamiento de tu navegador.</strong> Guardamos en tu propio dispositivo lo necesario para que
                  el sitio funcione: tu sesión, el carrito, el tema de colores y el origen de tu visita. No sale de tu
                  navegador salvo cuando envías un formulario.
                </li>
                <li>
                  <strong>Videos de YouTube.</strong> Se cargan en su modo de privacidad mejorada siempre que es posible.
                </li>
              </ul>
            </Section>

            <Section id="automatizadas">
              <p>
                No tomamos decisiones sobre ti basadas solo en un tratamiento automatizado. En la asesoría de imagen, el
                sistema sugiere cortes, productos y rutinas a partir de tu tipo de rostro, cráneo y cabello, con reglas
                fijas; esas sugerencias son un borrador que Bruno revisa, corrige y aprueba, y nada llega a tu informe sin
                su aprobación. Lo que tú declaras en el formulario nunca se presenta como diagnóstico.
              </p>
            </Section>

            <Section id="seguridad">
              <ul className="priv-list">
                <li>Todo el sitio funciona con conexión cifrada (HTTPS).</li>
                <li>Las contraseñas se guardan cifradas con un algoritmo de derivación lento (PBKDF2); nadie puede leerlas.</li>
                <li>El panel interno exige sesión firmada y bloquea el acceso tras varios intentos fallidos.</li>
                <li>Las fotos y videos de la asesoría se guardan en almacenamiento privado: solo se ven con sesión del panel o con tu enlace personal, y los enlaces para compartir el informe vencen.</li>
                <li>Los datos de tu tarjeta nunca pasan por nuestros servidores: los recibe directamente Mercado Pago.</li>
                <li>Acceden a los datos solo las personas que los necesitan para atenderte.</li>
              </ul>
              <p>
                Si ocurriera una vulneración de seguridad que afecte tus datos, la informaremos a la Agencia de Protección
                de Datos Personales y, cuando corresponda, a ti, como lo exige la ley.
              </p>
            </Section>

            <Section id="derechos">
              <p>Puedes pedirnos, en cualquier momento y sin costo:</p>
              <ul className="priv-rights">
                <li><strong>Acceso:</strong> saber qué datos tuyos tenemos, para qué y de dónde salieron.</li>
                <li><strong>Rectificación:</strong> corregir datos inexactos o incompletos.</li>
                <li><strong>Supresión:</strong> que borremos tus datos.</li>
                <li><strong>Oposición:</strong> que dejemos de usarlos para un fin, por ejemplo la medición o las reseñas.</li>
                <li><strong>Portabilidad:</strong> recibir tus datos en un formato estructurado y de uso común.</li>
                <li><strong>Bloqueo:</strong> que suspendamos el uso de tus datos mientras resolvemos otra solicitud tuya.</li>
              </ul>
              <p>
                Si nos diste tu consentimiento (por ejemplo, para las fotos de la asesoría), puedes <strong>retirarlo</strong> cuando
                quieras; eso no afecta lo que hicimos antes con él.
              </p>
              <h3>Cómo hacer una solicitud</h3>
              <ol className="priv-steps">
                <li>
                  Escríbenos por <a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                  {RESPONSABLE.correo && <> o a <a href={`mailto:${RESPONSABLE.correo}`}>{RESPONSABLE.correo}</a></>}
                  {' '}indicando tu nombre, el teléfono o correo con que te registraste, qué derecho quieres ejercer y sobre
                  qué datos. Si pides rectificar, dinos el dato correcto; si pides suprimir u oponerte, cuéntanos brevemente
                  el motivo.
                </li>
                <li>Podemos pedirte que confirmes tu identidad, para no entregar ni borrar datos de otra persona.</li>
                <li>
                  Acusamos recibo y te respondemos por escrito a más tardar en <strong>30 días corridos</strong>, plazo que
                  solo puede extenderse una vez por otros 30 días.
                </li>
              </ol>
              <p>
                Si rechazamos tu solicitud o no te respondemos a tiempo, puedes reclamar ante la{' '}
                <strong>Agencia de Protección de Datos Personales</strong>.
              </p>
            </Section>

            <Section id="menores">
              <p>
                Este sitio no está dirigido a niños. Si reservas una hora para un niño o niña menor de 14 años, los datos
                los entrega su madre, padre o quien tenga su cuidado personal, y los usamos solo para esa atención. Si
                crees que un menor nos dio datos sin esa autorización, avísanos y los eliminamos.
              </p>
            </Section>

            <Section id="cambios">
              <p>
                Si cambiamos la forma en que tratamos tus datos, actualizaremos esta página con una nueva versión y su
                fecha. Si el cambio es importante, te lo avisaremos por los medios de contacto que tenemos.
              </p>
              <p className="priv-meta">
                Versión {POLICY.version} · vigente desde el {POLICY.date}. Política conforme a la Ley N° 19.628 sobre
                protección de la vida privada, con las modificaciones de la Ley N° 21.719.
              </p>
              <p>
                <Link to="/">Volver al inicio</Link>
              </p>
            </Section>
          </article>
        </div>
      </main>

      <ModuleFooter
        logoSrc="/assets/brunetti-hero-wordmark.webp"
        links={[
          [() => navigate('/reservar'), 'Reservar'],
          [() => navigate('/'), 'Barbería'],
        ]}
        onPrimary={() => navigate('/reservar')}
      />
    </div>
  )
}
