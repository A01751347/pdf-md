/**
 * Cola secuencial de renderizados perezosos.
 *
 * Está fuera del ciclo de vida de React a propósito: si el trabajo en vuelo
 * dependiera de un efecto, cualquier cambio del conjunto visible lo cancelaría
 * y ese elemento quedaría marcado como pedido sin haberse completado nunca.
 * Aquí el trabajo solo se descarta al cambiar de documento, y un fallo libera
 * el elemento para poder reintentarlo.
 */
export class RenderQueue<T> {
  private queue: number[] = []
  private readonly requested = new Set<number>()
  private running = false
  private generation = 0

  constructor(
    private readonly render: (item: number) => Promise<T>,
    private readonly onResult: (item: number, value: T) => void,
  ) {}

  /** Descarta el trabajo pendiente y anula los resultados aún en vuelo. */
  reset() {
    this.generation++
    this.queue = []
    this.requested.clear()
  }

  enqueue(items: Iterable<number>) {
    let added = false
    for (const item of items) {
      if (this.requested.has(item) || this.queue.includes(item)) continue
      this.queue.push(item)
      added = true
    }
    if (added) void this.pump()
  }

  get pending(): number {
    return this.queue.length
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    const mine = this.generation
    try {
      while (this.queue.length && this.generation === mine) {
        const item = this.queue.shift()
        if (item === undefined || this.requested.has(item)) continue
        this.requested.add(item)
        try {
          const value = await this.render(item)
          if (this.generation === mine) this.onResult(item, value)
        } catch {
          this.requested.delete(item)
        }
      }
    } finally {
      this.running = false
      // Retomamos sin mirar la generación: si hubo un reset mientras
      // esperábamos, lo encolado después pertenece al documento nuevo y se
      // quedaría huérfano. La siguiente pasada captura la generación vigente.
      if (this.queue.length) void this.pump()
    }
  }
}
