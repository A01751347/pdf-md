import { useRef, useState, type DragEvent } from 'react'
import { Icon, type IconName } from './Icons'

const FEATURES: { icon: IconName; title: string; desc: string }[] = [
  { icon: 'type', title: 'Tipografía real', desc: 'Deduce títulos, negritas, cursivas y super/subíndices a partir de las fuentes incrustadas.' },
  { icon: 'table', title: 'Tablas fieles', desc: 'Reconstruye rejillas con y sin bordes, con cabecera y alineación numérica.' },
  { icon: 'columns', title: 'Multicolumna', desc: 'Detecta las calles de blanco y respeta el orden de lectura de los artículos.' },
  { icon: 'scan', title: 'OCR integrado', desc: 'Reconoce el texto de páginas escaneadas en doce idiomas sin salir del navegador.' },
  { icon: 'image', title: 'Imágenes y figuras', desc: 'Extrae ilustraciones con su pie como texto alternativo, incrustadas o en ZIP.' },
  { icon: 'shield', title: '100% local', desc: 'Ningún archivo sale de tu equipo: todo el procesado ocurre en esta pestaña.' },
]

interface Props {
  onFiles: (files: File[]) => void
}

export function Hero({ onFiles }: Props) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    const files = [...event.dataTransfer.files].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
    if (files.length) onFiles(files)
  }

  return (
    <div className="hero">
      <div className="hero-inner">
        <header className="hero-head">
          <span className="hero-badge">
            <Icon name="shield" size={13} />
            Procesado local · <b>sin subir nada</b>
          </span>
          <h1>
            Convierte cualquier PDF
            <br />a <em>Markdown impecable</em>
          </h1>
          <p className="hero-sub">
            Un conversor que entiende la maquetación: jerarquía de títulos, tablas, listas anidadas, código, fórmulas,
            notas al pie e imágenes. Con OCR para documentos escaneados.
          </p>
        </header>

        <div
          className="dropzone"
          data-over={over}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={handleDrop}
        >
          <div className="dropzone-icon">
            <Icon name="upload" size={22} strokeWidth={1.6} />
          </div>
          <div>
            <div className="dropzone-title">Arrastra tus PDF aquí</div>
            <div className="dropzone-sub">
              o pulsa para elegirlos · también puedes usar <kbd>⌘</kbd> <kbd>O</kbd>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              if (files.length) onFiles(files)
              e.target.value = ''
            }}
          />
        </div>

        <div className="feature-grid">
          {FEATURES.map((feature) => (
            <article className="feature" key={feature.title}>
              <span className="feature-ico">
                <Icon name={feature.icon} size={17} />
              </span>
              <h3 className="feature-title">{feature.title}</h3>
              <p className="feature-desc">{feature.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
