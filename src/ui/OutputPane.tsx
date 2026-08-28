import { useMemo, useRef, useState } from 'react'
import type { ConversionResult } from '../core/types'
import { renderMarkdown, slugId } from '../lib/markdown'
import { highlightMarkdown } from '../lib/highlight'
import { formatBytes } from '../core/util'
import { Icon } from './Icons'

type Tab = 'preview' | 'source' | 'outline' | 'report'

const TABS: { id: Tab; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'preview', label: 'Vista', icon: 'eye' },
  { id: 'source', label: 'Markdown', icon: 'code' },
  { id: 'outline', label: 'Esquema', icon: 'list' },
  { id: 'report', label: 'Informe', icon: 'chart' },
]

interface Props {
  result: ConversionResult | null
  fileName: string
  busy: boolean
  error: string | null
  onCopy: () => void
  onDownloadMarkdown: () => void
  onDownloadZip: () => void
  onDownloadReport: () => void
}

export function OutputPane({ result, fileName, busy, error, onCopy, onDownloadMarkdown, onDownloadZip, onDownloadReport }: Props) {
  const [tab, setTab] = useState<Tab>('preview')
  const proseRef = useRef<HTMLDivElement>(null)

  const rendered = useMemo(() => (result ? renderMarkdown(result.markdown) : null), [result])
  const highlighted = useMemo(() => (result ? highlightMarkdown(result.markdown) : ''), [result])

  const goToHeading = (text: string) => {
    setTab('preview')
    requestAnimationFrame(() => {
      const target = proseRef.current?.querySelector(`#${CSS.escape(slugId(text))}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  return (
    <section className="pane pane-output">
      <header className="pane-head">
        <div className="segmented" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              data-active={tab === item.id}
              onClick={() => setTab(item.id)}
              disabled={!result}
            >
              <Icon name={item.icon} size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
              {item.label}
            </button>
          ))}
        </div>
        <div className="output-toolbar">
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCopy} disabled={!result} title="Copiar Markdown (⌘/Ctrl + C)">
            <Icon name="copy" size={14} /> Copiar
          </button>
          <button type="button" className="btn btn-sm" onClick={onDownloadMarkdown} disabled={!result} title="Descargar .md (⌘/Ctrl + S)">
            <Icon name="download" size={14} /> .md
          </button>
          <button
            type="button"
            className="btn btn-sm btn-icon"
            onClick={onDownloadZip}
            disabled={!result}
            title="Descargar ZIP con imágenes"
          >
            <Icon name="package" size={14} />
          </button>
        </div>
      </header>

      <div className="pane-body">
        {error ? (
          <div style={{ padding: 16 }}>
            <div className="notice notice-error">
              <Icon name="alert" size={15} />
              <div>
                <strong>No se pudo convertir el documento.</strong>
                <div style={{ marginTop: 3 }}>{error}</div>
              </div>
            </div>
          </div>
        ) : !result ? (
          <div className="empty-state">
            <Icon name="markdown" size={30} />
            <p>{busy ? 'Analizando el documento…' : 'El Markdown aparecerá aquí en cuanto conviertas el PDF.'}</p>
          </div>
        ) : tab === 'preview' ? (
          <article className="prose" ref={proseRef} dangerouslySetInnerHTML={{ __html: rendered?.html ?? '' }} />
        ) : tab === 'source' ? (
          <pre className="md-source" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : tab === 'outline' ? (
          result.outline.length ? (
            <nav className="outline">
              {result.outline.map((item, i) => (
                <button key={`${item.text}-${i}`} type="button" className="outline-item" data-level={item.level} onClick={() => goToHeading(item.text)}>
                  {item.text}
                </button>
              ))}
            </nav>
          ) : (
            <div className="empty-state">
              <Icon name="list" size={28} />
              <p>No se detectaron títulos. Revisa los ajustes de estructura.</p>
            </div>
          )
        ) : (
          <Report result={result} fileName={fileName} onDownloadReport={onDownloadReport} />
        )}
      </div>
    </section>
  )
}

function Report({ result, fileName, onDownloadReport }: { result: ConversionResult; fileName: string; onDownloadReport: () => void }) {
  const s = result.stats
  const stats: { label: string; value: string; accent?: boolean }[] = [
    { label: 'Páginas', value: String(s.pages), accent: true },
    { label: 'Palabras', value: s.words.toLocaleString('es') },
    { label: 'Títulos', value: String(s.headings) },
    { label: 'Tablas', value: String(s.tables) },
    { label: 'Listas', value: String(s.lists) },
    { label: 'Código', value: String(s.codeBlocks) },
    { label: 'Imágenes', value: String(s.images) },
    { label: 'Notas al pie', value: String(s.footnotes) },
    { label: 'Columnas', value: String(s.columnsDetected) },
    { label: 'Páginas OCR', value: `${s.ocrPages}/${s.scannedPages}` },
    { label: 'Cuerpo', value: `${s.bodyFontSize} pt` },
    { label: 'Duración', value: `${(s.durationMs / 1000).toFixed(1)} s` },
  ]

  const meta = result.meta

  return (
    <div className="report">
      <div className="stat-grid">
        {stats.map((stat) => (
          <div className="stat" key={stat.label} data-accent={stat.accent ? 'true' : 'false'}>
            <div className="stat-value">{stat.value}</div>
            <div className="stat-label">{stat.label}</div>
          </div>
        ))}
      </div>

      {result.warnings.map((warning, i) => (
        <div className="notice notice-warn" key={i}>
          <Icon name="info" size={15} />
          <span>{warning}</span>
        </div>
      ))}

      <dl className="meta-list">
        <div className="meta-row">
          <dt>Archivo</dt>
          <dd>
            {fileName} · {formatBytes(meta.fileSize)}
          </dd>
        </div>
        {meta.title ? (
          <div className="meta-row">
            <dt>Título</dt>
            <dd>{meta.title}</dd>
          </div>
        ) : null}
        {meta.author ? (
          <div className="meta-row">
            <dt>Autor</dt>
            <dd>{meta.author}</dd>
          </div>
        ) : null}
        {meta.subject ? (
          <div className="meta-row">
            <dt>Asunto</dt>
            <dd>{meta.subject}</dd>
          </div>
        ) : null}
        {meta.creator ? (
          <div className="meta-row">
            <dt>Creado con</dt>
            <dd>{meta.creator}</dd>
          </div>
        ) : null}
        {meta.producer ? (
          <div className="meta-row">
            <dt>Productor</dt>
            <dd>{meta.producer}</dd>
          </div>
        ) : null}
        {meta.creationDate ? (
          <div className="meta-row">
            <dt>Fecha</dt>
            <dd>{meta.creationDate}</dd>
          </div>
        ) : null}
        <div className="meta-row">
          <dt>Salida</dt>
          <dd>
            {s.characters.toLocaleString('es')} caracteres · {formatBytes(new Blob([result.markdown]).size)}
          </dd>
        </div>
      </dl>

      <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onDownloadReport}>
        <Icon name="download" size={14} /> Descargar informe
      </button>
    </div>
  )
}
