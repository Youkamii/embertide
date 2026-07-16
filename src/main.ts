/**
 * 부팅 + 스트레스 확인용 엔트리.
 * 게임 루프가 붙기 전 단계 — 렌더 파이프라인이 수만 인스턴스를 견디는지 눈으로 본다.
 */
import { Camera } from './engine/camera'
import { createContext, GLError } from './engine/gl'
import { Renderer } from './engine/renderer'
import { Rng } from './engine/rng'
import { Shape } from './engine/shapes'

const STRESS_COUNT = 50000

function fatal(msg: string): void {
  const el = document.getElementById('fatal')
  const m = document.getElementById('fatal-msg')
  if (m) m.textContent = msg
  if (el) el.classList.add('show')
  console.error(msg)
}

function boot(): void {
  const canvas = document.getElementById('gl') as HTMLCanvasElement | null
  if (!canvas) throw new Error('캔버스를 찾을 수 없습니다.')

  const gl = createContext(canvas)
  const renderer = new Renderer(canvas, gl)
  const camera = new Camera()
  camera.viewHeight = 1400

  const rng = new Rng(1234)
  // SoA — 인스턴스별 상태를 배열로 따로 잡는다. 객체 5만 개는 GC 가 못 버틴다.
  const angle = new Float32Array(STRESS_COUNT)
  const radius = new Float32Array(STRESS_COUNT)
  const speed = new Float32Array(STRESS_COUNT)
  const size = new Float32Array(STRESS_COUNT)
  const hue = new Float32Array(STRESS_COUNT)
  const shape = new Float32Array(STRESS_COUNT)

  const SHAPES = [Shape.Orb, Shape.Mote, Shape.Spark, Shape.Hex, Shape.Star, Shape.Husk]
  for (let i = 0; i < STRESS_COUNT; i++) {
    angle[i] = rng.angle()
    radius[i] = 40 + Math.pow(rng.next(), 0.5) * 900
    speed[i] = (0.25 + rng.next() * 0.9) * (rng.bool() ? 1 : -1)
    size[i] = 6 + rng.next() * 14
    hue[i] = rng.next()
    shape[i] = SHAPES[rng.int(SHAPES.length)]!
  }

  const hud = document.createElement('div')
  hud.style.cssText =
    'position:fixed;top:10px;left:12px;font:12px ui-monospace,monospace;color:#7de3ff;' +
    'text-shadow:0 0 8px rgba(0,180,255,.6);pointer-events:none;line-height:1.6;'
  document.getElementById('ui')?.appendChild(hud)

  let last = performance.now()
  let acc = 0
  let frames = 0
  let fps = 0

  function hsv(h: number, s: number, v: number): [number, number, number] {
    const i = Math.floor(h * 6)
    const f = h * 6 - i
    const p = v * (1 - s)
    const q = v * (1 - f * s)
    const t = v * (1 - (1 - f) * s)
    switch (i % 6) {
      case 0: return [v, t, p]
      case 1: return [q, v, p]
      case 2: return [p, v, t]
      case 3: return [p, q, v]
      case 4: return [t, p, v]
      default: return [v, p, q]
    }
  }

  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    acc += dt
    frames++
    if (acc >= 0.5) {
      fps = frames / acc
      acc = 0
      frames = 0
    }

    renderer.resize()
    camera.update(dt)
    const view = camera.toView(renderer.width, renderer.height)
    renderer.begin(view)

    const t = now / 1000
    const batch = renderer.batch
    for (let i = 0; i < STRESS_COUNT; i++) {
      const a = angle[i]! + t * speed[i]!
      const r = radius[i]! * (1 + Math.sin(t * 0.7 + radius[i]! * 0.01) * 0.1)
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      const [cr, cg, cb] = hsv((hue[i]! + t * 0.05) % 1, 0.85, 1.0)
      // HDR — 1.0 을 넘겨야 bloom 이 문다.
      const boost = 1.6 + Math.sin(t * 3 + i) * 0.5
      batch.push(x, y, size[i]!, a, cr * boost, cg * boost, cb * boost, 1, shape[i]!)
    }

    renderer.end(t, 0)

    hud.textContent =
      `EMBERTIDE  boot check\n` +
      `fps ${fps.toFixed(0)}\n` +
      `instances ${STRESS_COUNT.toLocaleString()}\n` +
      `hdr ${renderer.hdr ? 'RGBA16F' : 'RGBA8 (폴백)'}\n` +
      `buffer ${renderer.width}x${renderer.height}`

    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}

try {
  boot()
} catch (e) {
  fatal(e instanceof GLError ? e.message : `초기화 실패: ${(e as Error).message}`)
}
