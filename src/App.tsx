import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PdfSession } from './core/convert'
import { DEFAULT_OPTIONS, PRESETS, type ConvertOptions } from './core/options'
import { nextId, type DocEntry } from './state'
import { buildReport, buildZip, copyToClipboard, downloadBlob, downloadText, markdownFileName } from './lib/export'
import { formatBytes } from './core/util'
import { Hero } from './ui/Hero'
import { FileQueue } from './ui/FileQueue'
import { SettingsPanel } from './ui/SettingsPanel'
import { PdfPreview } from './ui/PdfPreview'
import { OutputPane } from './ui/OutputPane'
import { ToastStack, useToasts } from './ui/Toasts'
import { Icon } from './ui/Icons'

const THEME_KEY = 'pdfmd.theme'
const OPTIONS_KEY = 'pdfmd.options'

function loadStoredOptions(): ConvertOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY)
    if (!raw) return DEFAULT_OPTIONS
    return { ...DEFAULT_OPTIONS, ...(JSON.parse(raw) as Partial<ConvertOptions>) }
  } catch {
    return DEFAULT_OPTIONS
  }
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'))
  const [options, setOptions] = useState<ConvertOptions>(loadStoredOptions)
  const [presetId, setPresetId] = useState('balanced')
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [railTab, setRailTab] = useState<'settings' | 'files'>('settings')
  const [showRail, setShowRail] = useState(true)
  // En pantallas estrechas el visor y la salida comparten columna: empieza oculto.
  const [showPreview, setShowPreview] = useState(() => window.innerWidth >= 1280)
  const [dragging, setDragging] = useState(false)
  const [lockedDoc, setLockedDoc] = useState<string | null>(null)
  const [passwordDraft, setPasswordDraft] = useState('')
  const { toasts, push } = useToasts()

  const docsRef = useRef<DocEntry[]>([])
  const optionsRef = useRef(options)
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    docsRef.current = docs
  }, [docs])
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options))
  }, [options])

  const active = useMemo(() => docs.find((d) => d.id === activeId) ?? null, [docs, activeId])

  const updateDoc = useCallback((id: string, patch: Partial<DocEntry>) => {
    setDocs((prev) => prev.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc)))
  }, [])

  // ---------------------------------------------------------------- conversión

  const runConvert = useCallback(
    async (id: string, session: PdfSession, fileName: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      updateDoc(id, { status: 'working', error: null, progress: null })
      try {
        const result = await session.convert(optionsRef.current, {
          onProgress: (progress) => updateDoc(id, { progress }),
          signal: controller.signal,
        })
        updateDoc(id, { status: 'done', result, stale: false, progress: null })
        return result
      } catch (error) {
        const err = error as Error
        if (err.name === 'AbortError') {
          updateDoc(id, { status: 'ready', progress: null })
          return null
        }
        updateDoc(id, { status: 'error', error: err.message || 'Error desconocido', progress: null })
        push('error', `No se pudo convertir ${fileName}`)
        return null
      } finally {
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [push, updateDoc],
  )

  const openDocument = useCallback(
    async (entry: DocEntry, password?: string) => {
      try {
        const session = await PdfSession.open(entry.file, password)
        updateDoc(entry.id, { session, pages: session.doc.numPages, status: 'ready', error: null })
        await runConvert(entry.id, session, entry.file.name)
      } catch (error) {
        const err = error as Error & { name?: string }
        if (err.name === 'PasswordException') {
          updateDoc(entry.id, { status: 'locked', error: 'Este documento está protegido con contraseña.' })
          setLockedDoc(entry.id)
        } else {
          updateDoc(entry.id, { status: 'error', error: err.message || 'No se pudo abrir el PDF.' })
          push('error', `${entry.file.name}: ${err.message}`)
        }
      }
    },
    [push, runConvert, updateDoc],
  )

  const addFiles = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
      if (!pdfs.length) {
        push('error', 'Solo se admiten archivos PDF.')
        return
      }
      const entries: DocEntry[] = pdfs.map((file) => ({
        id: nextId(),
        file,
        session: null,
        pages: 0,
        status: 'loading',
        result: null,
        error: null,
        progress: null,
        stale: false,
      }))
      setDocs((prev) => [...prev, ...entries])
      setActiveId(entries[0].id)
      if (entries.length > 1) setRailTab('files')
      for (const entry of entries) await openDocument(entry)
    },
    [openDocument, push],
  )

  const convertActive = useCallback(() => {
    if (!active?.session) return
    void runConvert(active.id, active.session, active.file.name)
  }, [active, runConvert])

  const convertAll = useCallback(async () => {
    for (const doc of docsRef.current) {
      if (!doc.session) continue
      if (doc.status === 'working') continue
      if (doc.status === 'done' && !doc.stale) continue
      await runConvert(doc.id, doc.session, doc.file.name)
    }
    push('success', 'Cola procesada.')
  }, [push, runConvert])

  const removeDoc = useCallback(
    (id: string) => {
      const doc = docsRef.current.find((d) => d.id === id)
      doc?.session?.destroy()
      setDocs((prev) => prev.filter((d) => d.id !== id))
      setActiveId((prev) => (prev === id ? (docsRef.current.find((d) => d.id !== id)?.id ?? null) : prev))
    },
    [],
  )

  const patchOptions = useCallback((patch: Partial<ConvertOptions>) => {
    setOptions((prev) => ({ ...prev, ...patch }))
    setPresetId('')
    setDocs((prev) => prev.map((doc) => (doc.status === 'done' ? { ...doc, stale: true } : doc)))
  }, [])

  const applyPreset = useCallback((id: string) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    setOptions({ ...DEFAULT_OPTIONS, ...preset.patch })
    setPresetId(id)
    setDocs((prev) => prev.map((doc) => (doc.status === 'done' ? { ...doc, stale: true } : doc)))
  }, [])

  // ---------------------------------------------------------------- exportación

  const handleCopy = useCallback(async () => {
    if (!active?.result) return
    const ok = await copyToClipboard(active.result.markdown)
    push(ok ? 'success' : 'error', ok ? 'Markdown copiado al portapapeles.' : 'No se pudo copiar.')
  }, [active, push])

  const handleDownloadMarkdown = useCallback(() => {
    if (!active?.result) return
    downloadText(markdownFileName(active.file.name), active.result.markdown)
    push('success', 'Descarga iniciada.')
  }, [active, push])

  const handleDownloadZip = useCallback(async () => {
    if (!active?.result) return
    const blob = await buildZip([{ name: active.file.name, result: active.result }])
    downloadBlob(`${active.file.name.replace(/\.pdf$/i, '')}.zip`, blob)
    push('success', `ZIP generado (${formatBytes(blob.size)}).`)
  }, [active, push])

  const handleDownloadAll = useCallback(async () => {
    const ready = docsRef.current.filter((d) => d.result)
    if (!ready.length) return
    const blob = await buildZip(ready.map((d) => ({ name: d.file.name, result: d.result! })))
    downloadBlob('markdown.zip', blob)
    push('success', `${ready.length} documento(s) empaquetados.`)
  }, [push])

  const handleDownloadReport = useCallback(() => {
    if (!active?.result) return
    downloadText(`informe-${active.file.name.replace(/\.pdf$/i, '')}.txt`, buildReport(active.file.name, active.result), 'text/plain')
  }, [active])

  // ---------------------------------------------------------------- eventos globales

  useEffect(() => {
    let depth = 0
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      depth++
      setDragging(true)
    }
    const onDragOver = (e: DragEvent) => e.preventDefault()
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length) void addFiles(files)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [addFiles])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'o') {
        e.preventDefault()
        fileInputRef.current?.click()
      } else if (key === 'enter') {
        e.preventDefault()
        convertActive()
      } else if (key === 's') {
        e.preventDefault()
        handleDownloadMarkdown()
      } else if (key === 'c' && e.shiftKey) {
        e.preventDefault()
        void handleCopy()
      } else if (key === 'b') {
        e.preventDefault()
        setShowRail((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [convertActive, handleCopy, handleDownloadMarkdown])

  const busy = active?.status === 'working' || active?.status === 'loading'
  const progress = active?.progress
  const doneCount = docs.filter((d) => d.status === 'done').length

  return (
    <div className="app">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          if (files.length) void addFiles(files)
          e.target.value = ''
        }}
      />

      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="markdown" size={16} strokeWidth={1.9} />
          </span>
          <span className="brand-name">
            PDF <span>→</span> Markdown
          </span>
        </div>

        {active ? (
          <div className="header-file" title={active.file.name}>
            <Icon name="file" size={13} style={{ color: 'var(--muted)', flex: '0 0 auto' }} />
            <span className="header-file-name">{active.file.name}</span>
            <span className="header-file-meta">
              {active.pages ? `${active.pages} pág.` : ''} · {formatBytes(active.file.size)}
            </span>
          </div>
        ) : null}

        <div className="header-spacer" />

        <div className="header-actions">
          {docs.length ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                title="Mostrar u ocultar ajustes (⌘B)"
                aria-pressed={showRail}
                onClick={() => setShowRail((v) => !v)}
              >
                <Icon name="panel" size={15} />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                title="Mostrar u ocultar el PDF original"
                aria-pressed={showPreview}
                onClick={() => setShowPreview((v) => !v)}
              >
                <Icon name="eye" size={15} />
              </button>
              {doneCount > 1 ? (
                <button type="button" className="btn" onClick={() => void handleDownloadAll()}>
                  <Icon name="package" size={14} /> Descargar todo
                </button>
              ) : null}
              {active?.status === 'working' ? (
                <button type="button" className="btn btn-danger" onClick={() => abortRef.current?.abort()}>
                  <Icon name="x" size={14} /> Cancelar
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={convertActive} disabled={!active?.session}>
                  <Icon name={active?.result ? 'refresh' : 'play'} size={14} />
                  {active?.result ? (active.stale ? 'Reconvertir' : 'Convertir de nuevo') : 'Convertir'}
                </button>
              )}
            </>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>
        </div>
      </header>

      {docs.length === 0 ? (
        <Hero onFiles={(files) => void addFiles(files)} />
      ) : (
        <>
          <div className="workspace" data-rail={showRail ? 'visible' : 'hidden'} data-preview={showPreview ? 'visible' : 'hidden'}>
            <aside className={showRail ? 'pane pane-rail rail' : 'pane pane-rail rail pane-hidden'}>
              <div className="rail-tabs" role="tablist">
                <button type="button" className="rail-tab" role="tab" data-active={railTab === 'settings'} onClick={() => setRailTab('settings')}>
                  <Icon name="settings" size={14} /> Ajustes
                </button>
                <button type="button" className="rail-tab" role="tab" data-active={railTab === 'files'} onClick={() => setRailTab('files')}>
                  <Icon name="layers" size={14} /> Archivos <span className="count">{docs.length}</span>
                </button>
              </div>
              <div className="pane-body">
                {railTab === 'settings' ? (
                  <SettingsPanel options={options} presetId={presetId} onChange={patchOptions} onPreset={applyPreset} />
                ) : (
                  <FileQueue
                    docs={docs}
                    activeId={activeId}
                    onSelect={setActiveId}
                    onRemove={removeDoc}
                    onAdd={() => fileInputRef.current?.click()}
                    onConvertAll={() => void convertAll()}
                  />
                )}
              </div>
            </aside>

            <section className={showPreview ? 'pane pane-preview' : 'pane pane-preview pane-hidden'}>
              <header className="pane-head">
                <span className="pane-title">
                  <Icon name="file" size={13} /> Documento original
                </span>
              </header>
              <PdfPreview session={active?.session ?? null} pages={active?.pages ?? 0} />
            </section>

            <OutputPane
              result={active?.result ?? null}
              fileName={active?.file.name ?? ''}
              busy={!!busy}
              error={active?.status === 'error' || active?.status === 'locked' ? active.error : null}
              onCopy={() => void handleCopy()}
              onDownloadMarkdown={handleDownloadMarkdown}
              onDownloadZip={() => void handleDownloadZip()}
              onDownloadReport={handleDownloadReport}
            />
          </div>

          <div className="status-strip" data-state={active?.status === 'working' ? 'working' : active?.status === 'error' ? 'error' : active?.result ? 'done' : 'idle'}>
            <span className="dot" />
            <span>{progress ? progress.detail : active?.result ? 'Conversión completada' : 'Listo'}</span>
            {progress ? (
              <span className="mono">
                {Math.round(progress.ratio * 100)}%
              </span>
            ) : null}
            <span className="grow" />
            {active?.result ? (
              <span className="mono">
                {active.result.stats.words.toLocaleString('es')} palabras · {active.result.stats.tables} tablas ·{' '}
                {active.result.stats.images} imágenes · {(active.result.stats.durationMs / 1000).toFixed(1)} s
              </span>
            ) : null}
          </div>

          {progress && active?.status === 'working' ? (
            <div className="progress-bar">
              <span style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            </div>
          ) : null}
        </>
      )}

      {lockedDoc ? (
        <div className="overlay" style={{ position: 'fixed', zIndex: 400 }} onClick={() => setLockedDoc(null)}>
          <form
            className="overlay-card"
            style={{ minWidth: 320 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              const doc = docsRef.current.find((d) => d.id === lockedDoc)
              if (!doc) return
              setLockedDoc(null)
              void openDocument(doc, passwordDraft)
              setPasswordDraft('')
            }}
          >
            <Icon name="lock" size={22} style={{ color: 'var(--amber)' }} />
            <p>Este PDF está protegido. Introduce la contraseña para continuar.</p>
            <input
              className="input"
              type="password"
              autoFocus
              value={passwordDraft}
              placeholder="Contraseña"
              onChange={(e) => setPasswordDraft(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setLockedDoc(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-sm btn-primary">
                Abrir
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {dragging ? (
        <div className="drop-veil">
          <div className="drop-veil-inner">
            <Icon name="upload" size={28} />
            Suelta los PDF para convertirlos
          </div>
        </div>
      ) : null}

      <ToastStack toasts={toasts} />
    </div>
  )
}
