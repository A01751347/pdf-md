# PDF → Markdown

Conversor de PDF a Markdown de alta precisión que se ejecuta **por completo en el
navegador**. Ningún archivo se sube a ningún servidor: el análisis, el OCR y la
generación del Markdown ocurren en la propia pestaña.

![Sin dependencias de servidor](https://img.shields.io/badge/procesado-100%25%20local-34d8a8) ![Sin telemetría](https://img.shields.io/badge/telemetr%C3%ADa-ninguna-7b8cff)

## Qué hace distinto

La mayoría de conversores vuelcan el texto en el orden en que aparece dentro del
PDF. Aquí se reconstruye primero la **maquetación** y solo después se emite el
Markdown:

| Etapa | Qué resuelve |
| --- | --- |
| Extracción | Fragmentos con su matriz de transformación, tipografía real (negrita, cursiva, monoespaciada, matemática), filetes vectoriales, imágenes y anotaciones de enlace. |
| Líneas | Agrupado por línea base con tolerancia adaptativa; los superíndices y las llamadas de nota se reincorporan a su línea. |
| Corte XY | La página se parte en bandas horizontales y en cada banda se buscan calles de blanco. Un título o una figura a todo el ancho ya no invalida el resto de la página. |
| Tablas | Perfil de ocupación por columnas: detecta rejillas **con y sin bordes**. Tiene prioridad sobre el análisis de columnas, porque es una estructura más específica. |
| Bloques | Clasificación por tipografía y geometría: títulos, listas anidadas, código, citas, pies de figura, notas al pie y fórmulas. |
| Emisión | GFM limpio, con escapado correcto y sin marcas redundantes. |

### Detalles que suelen fallar en otros conversores

- **Orden de lectura a varias columnas.** Las bandas de texto se leen columna a
  columna; los elementos a todo el ancho actúan como separadores.
- **Palabras cortadas.** `transfor-` + `man` se une en `transforman`, incluso
  cuando el corte cruza de una columna a la siguiente.
- **Jerarquía de títulos.** El nivel se deduce del tamaño real del cuerpo del
  documento, con la numeración (`1.`, `1.1`) como mínimo, no como sustituto.
- **Encabezados y pies repetidos.** Se detectan por repetición a lo largo del
  documento y se eliminan junto a los números de página.
- **Notas al pie.** Se separan del cuerpo por el filete y la llamada volada se
  convierte en una referencia `[^nota]` de Markdown.
- **Enlaces.** Se toman de las anotaciones del PDF, no de una expresión regular
  sobre el texto.

## Puesta en marcha

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # genera dist/ (estático, desplegable en cualquier sitio)
npm run preview
```

El `dist/` resultante es autónomo: incluye el worker de pdf.js, las tablas CMap
(PDF con escritura CJK) y las fuentes base-14 para documentos sin fuentes
incrustadas. Se puede servir desde cualquier hosting estático o abrir desde una
subcarpeta, porque el `base` es relativo.

> El OCR descarga los modelos de idioma de Tesseract desde su CDN la primera vez
> que se usa. Todo lo demás funciona sin conexión.

## Uso

1. Arrastra uno o varios PDF (o `⌘/Ctrl + O`).
2. Ajusta el preajuste o los controles del panel izquierdo.
3. Copia el Markdown, descarga el `.md` o exporta un ZIP con las imágenes.

| Atajo | Acción |
| --- | --- |
| `⌘/Ctrl + O` | Abrir archivos |
| `⌘/Ctrl + Enter` | Convertir el documento activo |
| `⌘/Ctrl + S` | Descargar `.md` |
| `⌘/Ctrl + ⇧ + C` | Copiar al portapapeles |
| `⌘/Ctrl + B` | Mostrar u ocultar los ajustes |

### Preajustes

- **Equilibrado** — valores recomendados para la mayoría de documentos.
- **Artículo académico** — dos columnas, notas al pie y fórmulas en LaTeX.
- **Informe / libro** — jerarquía normalizada, índice y separadores de página.
- **Escaneo (OCR)** — reconocimiento óptico forzado en todas las páginas.
- **Tablas y datos** — máxima fidelidad tabular, sin imágenes.
- **Texto plano** — sin análisis estructural.

Los ajustes se guardan en `localStorage`, igual que el tema.

## Arquitectura

```
src/
├── core/            Motor de conversión (sin dependencias de React)
│   ├── extract.ts     pdf.js → spans, filetes, imágenes y enlaces
│   ├── layout.ts      líneas, bandas, columnas y encabezados recurrentes
│   ├── tables.ts      detección y construcción de tablas
│   ├── blocks.ts      clasificación de bloques → nodos Markdown
│   ├── inline.ts      énfasis, enlaces, super/subíndices
│   ├── math.ts        Unicode → LaTeX
│   ├── ocr.ts         Tesseract → spans (mismo análisis que el texto nativo)
│   ├── emit.ts        nodos → Markdown
│   └── convert.ts     orquestación, métricas y avisos
├── ui/              Componentes de interfaz
└── lib/             Render de Markdown, resaltado y exportación
```

El motor es independiente de la interfaz: `PdfSession.open(file)` seguido de
`session.convert(opciones)` devuelve el Markdown, el árbol de nodos, las
imágenes y un informe de conversión.

## Banco de pruebas

El repositorio incluye un generador de PDF de referencia (títulos, listas
anidadas, tabla sin bordes, código, enlaces, notas al pie y una página a dos
columnas) y un arnés que ejecuta el motor en Node:

```bash
npm run fixture                  # crea muestra.pdf
npm run selftest -- muestra.pdf  # convierte e imprime Markdown, métricas y esquema
npm run debug:layout -- muestra.pdf 2   # vuelca bandas y columnas de una página
```

También hay una batería de comprobaciones del renderizador de la vista previa
(saneado de HTML hostil y cobertura de sintaxis):

```bash
npm run check:markdown   # saneado de HTML hostil y cobertura de sintaxis
npm run check:queue      # cola de renderizado perezoso del visor de páginas
```

`selftest` acepta un segundo argumento con opciones en JSON:

```bash
npm run selftest -- muestra.pdf '{"math":"latex","pageSeparators":"comment"}'
```

## Limitaciones conocidas

- Las fórmulas se traducen símbolo a símbolo: se recuperan letras griegas,
  operadores y super/subíndices, pero no la estructura (fracciones, matrices).
- Las tablas con celdas combinadas se aplanan a una rejilla rectangular.
- El texto rotado se descarta por defecto (marcas de agua); puede conservarse
  desactivando *Ignorar marcas de agua*.
- La precisión del OCR depende de la resolución del escaneo; el motor rasteriza
  a ~180 ppp.

## Licencia

MIT.
