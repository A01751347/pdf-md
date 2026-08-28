import { RenderQueue } from '../src/lib/renderQueue'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) {
    failures++
    console.log(`FALLA  ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    console.log(`ok     ${label}`)
  }
}

// 1. La carrera del informe: se pide la página 1 y, mientras está en vuelo,
//    llega el resto del viewport. Ninguna debe perderse.
{
  const renders: number[] = []
  const done = new Map<number, string>()
  const q = new RenderQueue<string>(
    async (page) => {
      renders.push(page)
      await sleep(20)
      return `img-${page}`
    },
    (page, url) => done.set(page, url),
  )
  q.enqueue([1])
  await sleep(5) // la página 1 está a medio renderizar
  q.enqueue([1, 2, 3])
  await sleep(150)
  check('la primera página sobrevive a un reencolado durante el render', done.has(1), `resueltas: ${[...done.keys()]}`)
  check('se renderizan las tres páginas', done.size === 3, `resueltas: ${[...done.keys()]}`)
  check('ninguna página se renderiza dos veces', renders.length === 3, `renders: ${renders}`)
}

// 2. Cambiar de documento descarta lo que estaba en vuelo.
{
  const done: number[] = []
  const q = new RenderQueue<string>(
    async (page) => {
      await sleep(20)
      return `viejo-${page}`
    },
    (page) => done.push(page),
  )
  q.enqueue([1, 2, 3])
  await sleep(5)
  q.reset()
  await sleep(120)
  check('reset descarta los resultados en vuelo', done.length === 0, `entregadas: ${done}`)
}

// 3. Tras un reset la cola vuelve a funcionar aunque hubiera trabajo corriendo.
{
  const done: number[] = []
  const q = new RenderQueue<string>(
    async (page) => {
      await sleep(20)
      return `x${page}`
    },
    (page) => done.push(page),
  )
  q.enqueue([1, 2, 3])
  await sleep(5)
  q.reset()
  q.enqueue([7, 8])
  await sleep(200)
  check('la cola se reanuda tras un reset', done.includes(7) && done.includes(8), `entregadas: ${done}`)
}

// 4. Un fallo no bloquea la página: se reintenta al volver a encolarla.
{
  let attempts = 0
  const done: number[] = []
  const q = new RenderQueue<string>(
    async (page) => {
      attempts++
      if (attempts === 1) throw new Error('fallo transitorio')
      await sleep(5)
      return `img-${page}`
    },
    (page) => done.push(page),
  )
  q.enqueue([4])
  await sleep(40)
  q.enqueue([4])
  await sleep(60)
  check('una página que falla se puede reintentar', done.includes(4), `intentos: ${attempts}`)
}

// 5. Encolar en ráfaga no dispara renders solapados ni deja cola pendiente.
{
  let concurrent = 0
  let peak = 0
  const q = new RenderQueue<string>(
    async (page) => {
      concurrent++
      peak = Math.max(peak, concurrent)
      await sleep(4)
      concurrent--
      return `img-${page}`
    },
    () => undefined,
  )
  for (let i = 1; i <= 30; i++) q.enqueue([i])
  await sleep(400)
  check('los renders son estrictamente secuenciales', peak === 1, `pico: ${peak}`)
  check('la cola queda vacía', q.pending === 0, `pendientes: ${q.pending}`)
}

console.log(failures ? `\n${failures} comprobación(es) fallida(s)` : '\nTodas las comprobaciones de la cola superadas')
if (failures) process.exitCode = 1
