# Workshop ASCENSIÓN — Base de conocimiento

Todo el material del workshop de barberos de Brunetti, consolidado en un solo lugar:
frameworks, cifras, guiones, dinámicas y los generadores de las presentaciones.

La idea es que esta carpeta sea la **fuente de verdad**: cuando haya que armar una slide,
un carrusel, un reel promocional o un PDF de apoyo, se saca de acá y no se vuelve a inventar.

## Cómo está organizado

| Carpeta | Qué hay |
|---|---|
| `docs/` | El contenido: frameworks, cifras, guion, dinámicas, banco de frases |
| `decks/` | Las presentaciones `.pptx` listas para proyectar |
| `decks/outlines/` | El guion slide por slide de cada versión (qué se dice, cuánto dura) |
| `build/` | Los generadores en Node (`pptxgenjs`) que producen los `.pptx` |
| `assets/` | Fotos reales del workshop anterior, recortadas y listas para usar |

## Los documentos

| Archivo | Contenido |
|---|---|
| [00-brief-domingo.md](docs/00-brief-domingo.md) | El evento: 6 horas, roles, el corte en vivo, el cierre |
| [01-marca-y-valor.md](docs/01-marca-y-valor.md) | Percepción, nicho, historia, ecuación de valor, precios |
| [02-ideas-virales.md](docs/02-ideas-virales.md) | Los 4 hooks, framework EYE, las 4 preguntas |
| [03-estructura-del-video.md](docs/03-estructura-del-video.md) | 15 segundos, 5 formatos, algoritmo, 7 planos, edición |
| [04-calculadora-viralidad.md](docs/04-calculadora-viralidad.md) | Los 6 criterios y la escala de decisión |
| [05-embudo-y-clientes.md](docs/05-embudo-y-clientes.md) | Los 7 pasos, bio, WhatsApp, objeciones, referidos |
| [06-dinamicas-y-ejercicios.md](docs/06-dinamicas-y-ejercicios.md) | Cada ejercicio con tiempos y material |
| [07-banco-hooks-frases-ctas.md](docs/07-banco-hooks-frases-ctas.md) | Frases martillo, hooks de escenario, CTAs |
| [08-cifras.md](docs/08-cifras.md) | Todos los números, con su supuesto explícito |
| [09-identidad-visual.md](docs/09-identidad-visual.md) | Colores, tipografía, reglas de composición |

## La presentación

**[ASCENSIÓN — El barbero que cobra lo que vale](decks/ASCENSION-completo.pptx) · 39 slides.**
Es la versión que se usa: junta las tres exploraciones en un solo recorrido de 6 horas,
con la paleta ASCENSIÓN, el logo real, el wordmark de Brunetti en morado, fotos del
workshop anterior y un icono por fila.

| Bloque | Slides | Contenido |
|---|---|---|
| Apertura | 4 | Portada, la tesis, audiencia ≠ conversión, la agenda del día |
| **01 · Valer más** | 7 | Percepción, marca y nicho, tu historia, ecuación de valor, precio en niveles, ejercicio |
| **02 · Ideas virales** | 6 | Los 4 hooks, framework EYE, las 4 preguntas, retención y saves, ejercicio |
| **03 · La calculadora** | 4 | Los 6 criterios, la escala de decisión con ejemplos puntuados, ejercicio |
| **Corte en vivo** | 3 | Divisor del invitado, reparto de los 7 planos, ejercicio de rodaje |
| **04 · Estructura y edición** | 6 | 15 segundos, los 5 formatos, guionización, edición en 4 pasos, ejercicio |
| **05 · Del scroll a la silla** | 6 | Embudo de 7 pasos, la bio, WhatsApp, referidos, métricas |
| Cierre | 3 | Publicar y concurso, tres ideas, foto grupal |

Cinco ejercicios cronometrados, más el arreglo de la bio en sala. Casi la mitad de la
jornada es práctica.

## Las tres exploraciones previas

Los tres borradores de los que salió la completa. Se guardan porque sirven para ediciones
más cortas o para reutilizar un enfoque puntual.

| Versión | Nombre | Ángulo | Cuándo elegirla |
|---|---|---|---|
| **V1** | [ASCENSIÓN II — *El barbero invisible*](decks/V1-ascension-el-barbero-invisible.pptx) · 22 slides | Emocional y narrativa. Percepción → visibilidad → sistema. Violeta sobre negro | Si la sala es nueva y hay que convencer antes de enseñar |
| **V2** | [Del scroll a la silla](decks/V2-del-scroll-a-la-silla.pptx) · 22 slides | Económica. Abre con plata y cierra con la máquina de referidos. Oro sobre negro | Si la sala ya publica pero no factura |
| **V3** | [15 segundos — *el taller*](decks/V3-quince-segundos-el-taller.pptx) · 21 slides | Laboratorio. Cada bloque termina en un ejercicio con cronómetro. Rojo REC sobre papel | Si quieres que nadie se vaya sin haber publicado |

Las tres cubren los mismos frameworks y las tres tienen el bloque del invitado (corte en
vivo como set de grabación) y el mismo cierre (concurso del mejor reel). Lo que cambia es
el orden, el énfasis y el tono.

El guion del facilitador de cada deck está en `decks/outlines/`: qué hay en pantalla y qué
se dice, slide por slide. Son las mismas notas que están dentro del `.pptx`, así que también
se pueden leer desde la vista de presentador.

**Todo el material está en español de Chile** (tuteo). Si se reescribe algo, mantener eso.

## Regenerar los decks

Los generadores necesitan `pptxgenjs`, que no está en `package.json` a propósito: el
proyecto web no lo usa y no corresponde cargarlo con una dependencia de slides.

```bash
npm install --no-save pptxgenjs
```

```bash
node build/v0-ascension-completo.cjs && node build/v1-ascension.cjs && node build/v2-scroll-silla.cjs && node build/v3-quince-segundos.cjs && python3 build/outlines.py
```

`build/assets.cjs` es aparte: recolorea el wordmark de Brunetti y rasteriza los iconos.
Se corre solo si cambia el logo del repo o hace falta un icono nuevo, y necesita
`sharp` y `feather-icons`.

Son `.cjs` porque el `package.json` del repo declara `"type": "module"`.
`build/kit.cjs` tiene el layout compartido y las tres paletas: tocar ahí para cambiar
márgenes, tipografía o colores en los tres decks a la vez. `build/outlines.py` regenera
los guiones leyendo los `.pptx`, así que se corre **después** de los generadores.
