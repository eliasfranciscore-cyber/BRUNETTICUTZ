/* MÉTODO BRUNETTI — datos de /metodo que no son texto
   ------------------------------------------------------------------
   El texto de la página va en src/data/content/metodo.json (editable con
   `npm run edit`). Acá va lo que decide cómo se comporta. */

/* El curso en la Academy (slug y catalogId en la base compartida): de ahí
   salen el precio y si está a la venta (GET /api/academy?mode=catalog). */
export const METODO_COURSE = 'brunetti-metodo'

/* El precio "nuevo" del caso: la tarjeta de precio dice cuántos cortes a
   este valor pagan el Método. */
export const TARGET_CUT_PRICE = 20000

/* Lección de muestra que se entrega a cambio de nombre, WhatsApp y correo.
   `videoId` = el ID de YouTube de la lección 19 en la Academy (Panel →
   Academy → Cursos → Método Brunetti → lección 19: la parte final del
   enlace). Mientras esté vacío, el formulario igual guarda al interesado y
   le dice que la lección le llega por WhatsApp. */
export const FREE_LESSON = {
  n: 19,
  title: 'El caso Brunetti: de $12.000 a $20.000',
  videoId: '',
}

/* Marca de "ya pidió la lección" en este dispositivo: al volver no se le
   piden los datos otra vez. */
export const LEAD_KEY = 'bc_metodo_lead'
