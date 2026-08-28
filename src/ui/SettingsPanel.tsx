import { DEFAULT_OPTIONS, OCR_LANGUAGES, PRESETS, type ConvertOptions } from '../core/options'
import { Field, Group, Segmented, Select, Slider, Switch } from './controls'

interface Props {
  options: ConvertOptions
  presetId: string
  onChange: (patch: Partial<ConvertOptions>) => void
  onPreset: (id: string) => void
}

export function SettingsPanel({ options, presetId, onChange, onPreset }: Props) {
  const set = <K extends keyof ConvertOptions>(key: K) => (value: ConvertOptions[K]) => onChange({ [key]: value } as Partial<ConvertOptions>)

  return (
    <div className="rail-body">
      <Group title="Preajustes">
        <div className="preset-grid">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="preset"
              data-active={presetId === preset.id}
              onClick={() => onPreset(preset.id)}
              title={preset.description}
            >
              <div className="preset-name">{preset.name}</div>
              <div className="preset-desc">{preset.description}</div>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Páginas">
        <Field label="Rango" hint="Ejemplos: 1-10, 15, 20- · vacío = documento completo.">
          <input
            className="input"
            value={options.pageRange}
            placeholder="Todas las páginas"
            onChange={(e) => onChange({ pageRange: e.target.value })}
          />
        </Field>
      </Group>

      <Group title="Estructura">
        <Switch label="Detectar títulos" hint="Deduce la jerarquía por tamaño, peso y numeración." checked={options.detectHeadings} onChange={set('detectHeadings')} />
        <Switch label="Normalizar niveles" hint="Evita saltos de H1 a H4 en la salida." checked={options.normalizeHeadingLevels} onChange={set('normalizeHeadingLevels')} disabled={!options.detectHeadings} />
        <Switch label="Detectar listas" hint="Viñetas, numeración y anidamiento por sangría." checked={options.detectLists} onChange={set('detectLists')} />
        <Switch label="Detectar tablas" hint="Rejillas con y sin bordes mediante análisis de blancos." checked={options.detectTables} onChange={set('detectTables')} />
        <Switch label="Detectar código" hint="Bloques monoespaciados con sangría preservada." checked={options.detectCode} onChange={set('detectCode')} />
        <Switch label="Detectar citas" checked={options.detectQuotes} onChange={set('detectQuotes')} />
        <Switch label="Detectar pies de figura" checked={options.detectCaptions} onChange={set('detectCaptions')} />
        <Switch label="Detectar notas al pie" hint="Las convierte en referencias [^nota] de Markdown." checked={options.detectFootnotes} onChange={set('detectFootnotes')} />
        <Switch label="Detectar columnas" hint="Reconstruye el orden de lectura en maquetas a varias columnas." checked={options.detectColumns} onChange={set('detectColumns')} />
      </Group>

      <Group title="Texto">
        <Field label="Saltos de línea">
          <Segmented
            value={options.lineBreaks}
            onChange={set('lineBreaks')}
            options={[
              { value: 'join', label: 'Unir párrafos' },
              { value: 'preserve', label: 'Conservar' },
            ]}
          />
        </Field>
        <Switch label="Unir palabras cortadas" hint="Reconstruye las palabras partidas con guion al final de línea." checked={options.dehyphenate} onChange={set('dehyphenate')} />
        <Switch label="Conservar negritas y cursivas" checked={options.preserveEmphasis} onChange={set('preserveEmphasis')} />
        <Switch label="Conservar super/subíndices" checked={options.preserveSuperscripts} onChange={set('preserveSuperscripts')} />
        <Switch label="Mantener hipervínculos" checked={options.keepLinks} onChange={set('keepLinks')} />
        <Switch label="Enlazar URLs sueltas" checked={options.autolink} onChange={set('autolink')} />
        <Switch label="Normalizar espacios" checked={options.normalizeWhitespace} onChange={set('normalizeWhitespace')} />
        <Switch label="Comillas y guiones ASCII" hint="Convierte la tipografía inglesa a caracteres simples." checked={options.asciiPunctuation} onChange={set('asciiPunctuation')} />
      </Group>

      <Group title="Limpieza" defaultOpen={false}>
        <Switch label="Quitar encabezados repetidos" hint="Elimina cabeceras y pies que se repiten en todo el documento." checked={options.removeRepeatedHeaders} onChange={set('removeRepeatedHeaders')} />
        <Switch label="Quitar números de página" checked={options.removePageNumbers} onChange={set('removePageNumbers')} />
        <Switch label="Ignorar marcas de agua" hint="Descarta el texto rotado, típico de sellos y filigranas." checked={options.dropWatermarks} onChange={set('dropWatermarks')} />
      </Group>

      <Group title="Tablas" defaultOpen={false}>
        <Field label="Fila de cabecera">
          <Select
            value={options.tableHeaderMode}
            onChange={set('tableHeaderMode')}
            options={[
              { value: 'auto', label: 'Automática' },
              { value: 'first-row', label: 'Siempre la primera fila' },
              { value: 'none', label: 'Sin cabecera' },
            ]}
          />
        </Field>
        <Switch label="Deducir alineación" hint="Alinea a la derecha las columnas numéricas." checked={options.tableAlignment} onChange={set('tableAlignment')} />
      </Group>

      <Group title="Fórmulas" defaultOpen={false}>
        <Field label="Tratamiento" hint="LaTeX traduce los símbolos matemáticos y usa delimitadores $.">
          <Segmented
            value={options.math}
            onChange={set('math')}
            options={[
              { value: 'plain', label: 'Texto plano' },
              { value: 'latex', label: 'LaTeX' },
            ]}
          />
        </Field>
      </Group>

      <Group title="Imágenes" defaultOpen={false}>
        <Field label="Modo" hint="«Archivos» solo funciona descargando el ZIP: el .md suelto apuntaría a rutas inexistentes.">
          <Segmented
            value={options.images}
            onChange={set('images')}
            options={[
              { value: 'embed', label: 'Incrustar', title: 'Data URI dentro del propio Markdown' },
              { value: 'extract', label: 'Archivos', title: 'Se exportan en el ZIP dentro de /imagenes' },
              { value: 'skip', label: 'Omitir' },
            ]}
          />
        </Field>
        <Field label="Resolución">
          <Slider value={options.imageScale} min={1} max={4} step={0.5} onChange={set('imageScale')} format={(v) => `${v}x`} />
        </Field>
        <Field label="Tamaño mínimo" hint="Descarta iconos y viñetas decorativas.">
          <Slider value={options.minImageSize} min={8} max={120} step={4} onChange={set('minImageSize')} format={(v) => `${v} pt`} />
        </Field>
      </Group>

      <Group title="OCR" defaultOpen={false}>
        <Field label="Reconocimiento óptico" hint="«Automático» solo actúa en las páginas sin texto extraíble.">
          <Segmented
            value={options.ocr}
            onChange={set('ocr')}
            options={[
              { value: 'off', label: 'Desactivado' },
              { value: 'auto', label: 'Automático' },
              { value: 'force', label: 'Forzado' },
            ]}
          />
        </Field>
        <Field label="Idioma">
          <Select
            value={options.ocrLanguage}
            onChange={set('ocrLanguage')}
            options={OCR_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          />
        </Field>
      </Group>

      <Group title="Salida" defaultOpen={false}>
        <Switch label="Front matter YAML" hint="Incluye título, autor y metadatos al inicio." checked={options.frontMatter} onChange={set('frontMatter')} />
        <Switch label="Índice de contenidos" checked={options.includeToc} onChange={set('includeToc')} />
        <Field label="Separadores de página">
          <Select
            value={options.pageSeparators}
            onChange={set('pageSeparators')}
            options={[
              { value: 'none', label: 'Ninguno' },
              { value: 'comment', label: 'Comentario HTML' },
              { value: 'rule', label: 'Línea horizontal' },
            ]}
          />
        </Field>
        <Field label="Ancho de línea" hint="0 deja los párrafos en una sola línea.">
          <Slider
            value={options.wrapWidth}
            min={0}
            max={120}
            step={10}
            onChange={set('wrapWidth')}
            format={(v) => (v ? `${v} col.` : 'Sin cortar')}
          />
        </Field>
      </Group>

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ alignSelf: 'flex-start', marginTop: 6 }}
        onClick={() => onPreset('balanced')}
        disabled={JSON.stringify(options) === JSON.stringify(DEFAULT_OPTIONS)}
      >
        Restablecer ajustes
      </button>
    </div>
  )
}
