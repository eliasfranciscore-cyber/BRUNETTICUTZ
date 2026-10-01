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
import { Sparkles } from '../components/ui/sparkles.jsx'
// Botón del carrito, modal y cajón lateral: el mismo gesto de compra que
// Essentials (la vitrina usa sus clases essentials-*).
import '../styles/essentials.css'

export { SiteNav, ModuleFooter, Icon, Sparkles, scrollToId }
export const useSiteFx = useBrunettiFx

export const LANDING = {
  // Logo del pie de la vitrina (el mismo que usaba la página de /cursos).
  footerLogo: '/assets/brunetti-cursos-wordmark.webp',
  // Este sitio no carga Meta Pixel.
  metaPixel: false,
}
