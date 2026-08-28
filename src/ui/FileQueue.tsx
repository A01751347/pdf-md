import type { DocEntry } from '../state'
import { statusLabel } from '../state'
import { formatBytes } from '../core/util'
import { Icon, type IconName } from './Icons'

const STATUS_ICON: Record<DocEntry['status'], IconName> = {
  loading: 'refresh',
  ready: 'file',
  working: 'refresh',
  done: 'check',
  error: 'alert',
  locked: 'lock',
}

interface Props {
  docs: DocEntry[]
  activeId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onConvertAll: () => void
}

export function FileQueue({ docs, activeId, onSelect, onRemove, onAdd, onConvertAll }: Props) {
  const pending = docs.filter((d) => d.status === 'ready' || d.stale).length

  return (
    <div className="queue">
      <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
        <button type="button" className="btn btn-sm" style={{ flex: 1 }} onClick={onAdd}>
          <Icon name="upload" size={14} /> Añadir PDF
        </button>
        <button type="button" className="btn btn-sm" onClick={onConvertAll} disabled={!pending} title="Convertir todos los pendientes">
          <Icon name="play" size={13} /> Todos
        </button>
      </div>

      {docs.length === 0 ? (
        <div className="empty-state">
          <Icon name="file" size={28} />
          <p>No hay documentos en la cola.</p>
        </div>
      ) : (
        docs.map((doc) => (
          <div
            key={doc.id}
            className="queue-item"
            data-active={doc.id === activeId}
            data-status={doc.status}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(doc.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(doc.id)}
          >
            <span className="queue-ico">
              {doc.status === 'working' || doc.status === 'loading' ? (
                <span className="spinner" />
              ) : (
                <Icon name={STATUS_ICON[doc.status]} size={15} />
              )}
            </span>
            <span className="queue-info">
              <span className="queue-name">{doc.file.name}</span>
              <span className="queue-meta">
                {formatBytes(doc.file.size)} · {statusLabel(doc)}
                {doc.stale && doc.status === 'done' ? ' · ajustes cambiados' : ''}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon queue-remove btn-danger"
              title="Quitar de la cola"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(doc.id)
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ))
      )}
    </div>
  )
}
