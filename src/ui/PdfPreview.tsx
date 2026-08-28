import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PdfSession } from '../core/convert'
import { RenderQueue } from '../lib/renderQueue'
import { Icon } from './Icons'

interface Props {
  session: PdfSession | null
  pages: number
}

const THUMBNAIL_WIDTH = 1000

/** Visor perezoso: las páginas se rasterizan al entrar en el viewport. */
export function PdfPreview({ session, pages }: Props) {
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map())
  const scrollRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session

  const queue = useMemo(
    () =>
      new RenderQueue<string>(
        (page) => {
          const active = sessionRef.current
          if (!active) return Promise.reject(new Error('sin documento'))
          return active.thumbnail(page, THUMBNAIL_WIDTH)
        },
        (page, url) => setThumbs((prev) => new Map(prev).set(page, url)),
      ),
    [],
  )

  useEffect(() => {
    queue.reset()
    setThumbs(new Map())
  }, [session, queue])

  const enqueue = useCallback((items: number[]) => queue.enqueue(items), [queue])

  // La primera página se pide siempre, aunque el observador aún no haya medido.
  useEffect(() => {
    if (session && pages > 0) enqueue([1])
  }, [session, pages, enqueue])

  useEffect(() => {
    const root = scrollRef.current
    if (!root || !session) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number((entry.target as HTMLElement).dataset.page))
          .filter((page) => Number.isFinite(page) && page > 0)
        if (visible.length) enqueue(visible)
      },
      { root, rootMargin: '600px 0px' },
    )
    root.querySelectorAll<HTMLElement>('[data-page]').forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [session, pages, enqueue])

  if (!session) {
    return (
      <div className="empty-state">
        <Icon name="file" size={30} />
        <p>Carga un PDF para ver sus páginas aquí.</p>
      </div>
    )
  }

  return (
    <div className="pane-body" ref={scrollRef}>
      <div className="pdf-scroll">
        {Array.from({ length: pages }, (_, i) => i + 1).map((page) => {
          const src = thumbs.get(page)
          return (
            <div key={page} data-page={page} style={{ width: '100%', maxWidth: 760 }}>
              {src ? (
                <figure className="pdf-page">
                  <img src={src} alt={`Página ${page}`} />
                  <figcaption className="pdf-page-num">{page}</figcaption>
                </figure>
              ) : (
                <div className="pdf-page-skeleton" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
