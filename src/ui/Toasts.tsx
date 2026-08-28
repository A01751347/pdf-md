import { useCallback, useRef, useState } from 'react'
import { Icon } from './Icons'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const push = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++seq.current
    setToasts((prev) => [...prev, { id, kind, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200)
  }, [])

  return { toasts, push }
}

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id} data-kind={toast.kind}>
          <Icon name={toast.kind === 'success' ? 'check' : toast.kind === 'error' ? 'alert' : 'info'} size={15} />
          {toast.message}
        </div>
      ))}
    </div>
  )
}
