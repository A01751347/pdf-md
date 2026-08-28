import type { PDFPageProxy } from 'pdfjs-dist'
import type { Rect } from './util'

export interface RenderedPage {
  canvas: HTMLCanvasElement
  scale: number
}

/** Rasteriza una página a un canvas con fondo blanco. */
export async function renderPage(page: PDFPageProxy, scale: number): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) throw new Error('El navegador no permitió crear el lienzo de render.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, viewport, background: '#ffffff' }).promise
  return { canvas, scale }
}

/** Recorta una región (en puntos PDF) del render y la exporta como PNG. */
export async function cropToPng(rendered: RenderedPage, rect: Rect, padding = 2): Promise<{ blob: Blob; width: number; height: number } | null> {
  const s = rendered.scale
  const x = Math.max(0, Math.floor((rect.x0 - padding) * s))
  const y = Math.max(0, Math.floor((rect.y0 - padding) * s))
  const w = Math.min(rendered.canvas.width - x, Math.ceil((rect.x1 - rect.x0 + padding * 2) * s))
  const h = Math.min(rendered.canvas.height - y, Math.ceil((rect.y1 - rect.y0 + padding * 2) * s))
  if (w <= 2 || h <= 2) return null

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(rendered.canvas, x, y, w, h, 0, 0, w, h)

  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
  return blob ? { blob, width: w, height: h } : null
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer la imagen.'))
    reader.readAsDataURL(blob)
  })
}

/** Miniatura para el visor de páginas. */
export async function renderThumbnail(page: PDFPageProxy, maxWidth: number): Promise<string> {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2, maxWidth / base.width)
  const { canvas } = await renderPage(page, scale)
  return canvas.toDataURL('image/jpeg', 0.82)
}
