# Identidad visual

La identidad de ASCENSIÓN, extraída del deck original, más las dos paletas alternativas
que usan las versiones 2 y 3.

## Paleta ASCENSIÓN (la oficial)

| Rol | Hex | Uso |
|---|---|---|
| Fondo oscuro | `161019` | Portadas, dividers, slides de impacto |
| Fondo oscuro alt. | `16111E` | Tarjetas sobre fondo claro |
| Fondo claro | `F4F0E8` | Slides de contenido |
| Tarjeta clara | `ECE6DA` | Bloques dentro de slides claras |
| **Violeta (acento)** | **`8C3FDB`** | Números, palabras clave, la segunda mitad del titular |
| Lila | `A98FE0` | Eyebrows sobre fondo oscuro |
| Texto sobre oscuro | `F4F0E8` | — |
| Texto sobre claro | `15120E` | — |
| Muted sobre oscuro | `9A8FB0` | Bajadas, pies |
| Muted sobre claro | `8A8478` / `6E685C` | Bajadas, pies |
| Verde (sube) | `1B7A4B` | Solo en la ecuación de valor |
| Rojo (baja) | `B8302D` | Solo en la ecuación de valor |

**Regla del violeta:** el acento va en **la segunda mitad del titular**, no en el titular
completo. "El barbero que no se ve, **no se vende**." Eso es lo que le da el ritmo.

**Regla del contraste:** las slides alternan oscuro / claro. Los dividers de módulo son
siempre oscuros; el contenido, claro. Los dos extremos (portada y cierre) oscuros.

## Paleta 2 — Oro y negro *(usada en V2)*

Para el deck del dinero. Más sobrio, más "negocio".

| Rol | Hex |
|---|---|
| Negro | `0D0D0D` |
| Negro tarjeta | `171717` |
| **Oro (acento)** | **`C9A961`** |
| Oro claro | `E8D5A3` |
| Off-white | `F7F4EF` |
| Rojo (pérdida) | `C0392B` |
| Verde (ganancia) | `3E8E5A` |

El oro se usa para plata y para lo que se gana; el rojo, solo para lo que se pierde.

## Paleta 3 — REC *(usada en V3)*

Para el deck del taller. Claro dominante, con el rojo del botón de grabar como acento.
Es el único de los tres que es claro-dominante — se lee bien con luz de sala encendida,
que es lo que hace falta en un taller práctico.

| Rol | Hex |
|---|---|
| Papel | `FAFAF8` |
| Tinta | `111111` |
| Gris bloque | `EDEBE7` |
| **Rojo REC (acento)** | **`E03127`** |
| Gris texto | `6B6B6B` |

## Tipografía

El deck original usa **Iosevka Charon Mono**, que no está en PowerPoint. En los `.pptx` se
sustituye así:

| Elemento | Fuente en el .pptx | Por qué |
|---|---|---|
| Titulares | **Arial** Bold, `charSpacing` negativo | Se renderiza igual en cualquier máquina |
| Eyebrows y etiquetas | **Courier New** Bold, MAYÚSCULAS, `charSpacing` alto | Conserva el carácter monoespaciado del original |
| Números grandes | **Arial** Bold | — |
| Cuerpo | **Arial** | — |
| Citas | **Arial** *italic* | — |

Si el deck se va a proyectar desde una máquina propia y controlada, se puede instalar
Iosevka Charon Mono y cambiar la constante `FONT_MONO` en `build/kit.js`.

### Escala tipográfica

| Elemento | Tamaño |
|---|---|
| Titular de portada / divider | 54 – 66 pt |
| Titular de contenido | 32 – 40 pt |
| Número grande / dato | 44 – 72 pt |
| Encabezado de tarjeta | 18 – 22 pt |
| Cuerpo | 13 – 16 pt |
| Eyebrow / pie | 9 – 11 pt |

## Reglas de composición

1. **Márgenes:** 0.55" mínimo. En slides de titular grande, 0.7".
2. **Una idea por slide.** Si hay dos ideas, hay dos slides.
3. **El eyebrow siempre arriba a la izquierda**, en mayúsculas y espaciado. Marca en qué
   módulo estamos sin tener que decirlo.
4. **Pie de slide:** `BRUNETTICUTZ` a la izquierda, `ASCENSIÓN` a la derecha. Solo en
   slides de contenido; nunca en portadas ni dividers.
5. **Nada de barras de acento ni líneas bajo los títulos.** El contraste lo dan el color
   de fondo y el espacio, no una raya.
6. **Las fotos van a sangre**, ocupando media slide vertical completa. Nunca fotos
   pequeñas ni con marco.

## Assets disponibles

Todo vive en `workshop/assets/`.

### Logos

| Archivo | Qué es | Dónde va |
|---|---|---|
| `logo-ascension-claro.png` | Logo ASCENSIÓN (blanco + morado) | Fondos oscuros: portada, divisores, cierre |
| `logo-ascension-oscuro.png` | Logo ASCENSIÓN en versión clara | Fondos claros |
| `logo-brunetti-morado.png` | Wordmark Brunetti Cutz recoloreado a morado | Pie de las slides claras |
| `logo-brunetti-crema.png` | Wordmark Brunetti Cutz en crema | Pie de las slides oscuras |
| `logo-brunetti-tinta.png` | Wordmark Brunetti Cutz en negro | Impresos y material a una tinta |

Los de ASCENSIÓN son los archivos originales del deck anterior (`ascension-*.webp`),
convertidos a PNG porque PowerPoint no lee webp. Los de Brunetti salen del
`brunetti-wordmark.svg` del repo, que es dorado: `build/assets.cjs` reemplaza los stops
del degradado en vez de aplanar el relleno, así las letras no pierden volumen.

**Regla:** el logo de ASCENSIÓN identifica al workshop y va arriba (portada, divisores,
cierre). El wordmark de Brunetti identifica a la marca y va abajo, en el pie. Nunca los
dos en la misma esquina.

### Iconos

`assets/icons/` — 28 iconos de la familia Feather, rasterizados a 256 px en cinco tonos
(`morado`, `lila`, `crema`, `tinta`, `blanco`). El nombre del archivo es
`<nombre>-<tono>.png`.

`ojo` · `tijera` · `precio` · `estrella` · `rayo` · `diana` · `camara` · `reloj` ·
`ajustes` · `chat` · `personas` · `grafico` · `guardado` · `telefono` · `corazon` ·
`compartir` · `play` · `premio` · `capas` · `enlace` · `billete` · `chispa` ·
`calendario` · `filtro` · `check` · `cruz` · `flecha` · `micro`

Se eligió Feather porque su trazo fino y uniforme acompaña a la tipografía en vez de
competir con ella. **Regla:** un icono por fila o por tarjeta, nunca dos juntos, y siempre
el mismo icono para el mismo concepto a lo largo del deck (el reloj es siempre tiempo, el
ojo es siempre percepción o visibilidad).

Para agregar uno nuevo: se añade a `ICONOS` en `build/assets.cjs` con su nombre de Feather
y se vuelve a correr el script.

### Fotos

Son los originales del workshop anterior, no recortes de un PDF.

| Archivo | Qué es | Orientación |
|---|---|---|
| `bruno-presenta.jpg` | Bruno presentando con headset | Vertical 2:3 |
| `bruno-cortando.jpg` | Bruno peinando a un cliente | Vertical 2:3 |
| `bruno-pantalla.jpg` | Corte frente a la pantalla del workshop | Horizontal 3:2 |
| `barbero-tijera.jpg` | Barbero con tijera, luz de aro al fondo | Vertical 2:3 |
| `trio-diploma.jpg` | Tres barberos con el diploma Tadeus | Vertical 2:3 |
| `grupo-final.jpg` | Foto grupal del workshop completo | Horizontal 3:2 |

**Regla:** las fotos van a sangre, ocupando media slide completa o una banda de ancho
total. Nunca fotos pequeñas ni con marco. Como son seis y los espacios son siete, se
permite una repetición siempre que las dos apariciones estén lejos en el recorrido.
