/* ============================================================
   ACADEMY — lo que rodea a la vitrina pública (HOST, BrunettiCutz)

   Quinto archivo propio de cada repo (docs/academy/PORTABLE.md §2):
   `scripts/academy-sync.mjs` NUNCA lo copia. La vitrina
   (src/pages/academy/Vitrina.jsx) es código compartido y se ve IGUAL en
   pimpstudio.cl/academy y en brunetticutz.cl/cursos; el menú, el pie, los
   íconos, los efectos y la hoja de estilos de compra son de cada sitio y
   llegan de acá.

   Solo lo importa la vitrina, que es un chunk diferido: la app del alumno
   (con su CSP estricto) no carga nada de esto.
   ============================================================ */

import SiteNav from '../components/SiteNav.jsx'
import ModuleFooter from '../components/ModuleFooter.jsx'
import { Icon } from '../components/ui.jsx'
import { useBrunettiFx, scrollToId } from '../components/brunetti.jsx'
import { Sparkles as SiteSparkles } from '../components/ui/sparkles.jsx'
// Botón del carrito, modal y cajón lateral: el mismo gesto de compra que
// Essentials (la vitrina usa sus clases essentials-*).
import '../styles/essentials.css'
// La marca de /cursos sobre la vitrina compartida: paleta azul y el diseño
// "Curso primero". Va después de essentials.css porque también lo retoca.
import '../styles/cursos-vitrina.css'

// Partículas del fondo en el azul de Cursos (#6b74f0), no en el dorado por defecto.
function Sparkles(props) {
  return <SiteSparkles color="107, 116, 240" {...props} />
}

export { SiteNav, ModuleFooter, Icon, Sparkles, scrollToId }
export const useSiteFx = useBrunettiFx

export const LANDING = {
  // Logo del pie de la vitrina (el mismo que usaba la página de /cursos).
  footerLogo: '/assets/brunetti-cursos-wordmark.webp',
  // Este sitio carga Meta Pixel (public/pixel.js, el mismo de pimpstudio.cl):
  // el aviso de privacidad de la vitrina lo declara.
  metaPixel: true,
}
