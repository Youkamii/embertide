/**
 * 검은 입 코어 계약 — "삼키면 커지고, 커지면 어제 못 삼키던 것을 삼킨다".
 *
 * ① 우주는 결정론이다 — 같은 좌표 = 같은 천체 (좌표 공유의 전제)
 * ② 작은 것은 삼켜지고, 나는 커지고, 명부에 남는다
 * ③ 나보다 큰 것은 못 삼킨다 (성장의 문이 잠겨 있어야 열리는 맛이 난다)
 * ④ 명부와 크기는 세션을 넘어 남는다 (영속)
 * ⑤ 문턱을 넘으면 칭호가 온다
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { Voyage, rankOf, type Store } from './voyage'

function mockInput(x: number, y: number): Input {
  return { move: { x, y } } as unknown as Input
}

function memStore(): Store & { raw: string | null } {
  const s = { raw: null as string | null }
  return {
    get raw() {
      return s.raw
    },
    load: () => s.raw,
    save: (v: string) => {
      s.raw = v
    },
  }
}

describe('검은 입', () => {
  it('우주는 결정론이다 — 같은 자리엔 같은 천체', () => {
    const a = new Voyage()
    const b = new Voyage()
    a.start(null)
    b.start(null)
    const sig = (v: Voyage): string =>
      v.active.map((x) => `${x.id}:${x.kind}:${Math.round(x.x)}:${Math.round(x.r)}`).join('|')
    expect(sig(a)).toBe(sig(b))
    expect(a.active.length).toBeGreaterThan(3)
  })

  it('작은 것은 삼켜지고, 나는 커지고, 명부에 남는다', () => {
    const g = new Voyage()
    g.start(null)
    g.vol = 9000 // R ≈ 20.8 — 티끌·벨트가 먹이가 되는 크기
    const R = g.radius
    const prey = g.active.find((b) => b.r < R * 0.7)
    expect(prey, '시작 성역 부근에 먹이가 있다').toBeTruthy()
    g.x = prey!.x + R
    g.y = prey!.y
    g.vx = 0
    g.vy = 0
    const vol0 = g.vol
    const input = mockInput(0, 0)
    for (let s = 0; s < 90; s++) g.update(input, 1 / 60)
    expect(g.vol, '부피가 붙었다').toBeGreaterThan(vol0)
    expect(g.journal.length, '명부에 남았다').toBeGreaterThan(0)
    expect(g.journal[0]!.name.length).toBeGreaterThan(0)
  })

  it('나보다 큰 것은 못 삼킨다', () => {
    const g = new Voyage()
    g.start(null)
    const big = g.active.find((b) => b.r > g.radius * 2)
    expect(big, '큰 천체가 있다').toBeTruthy()
    g.x = big!.x + big!.r * 1.1
    g.y = big!.y
    const journal0 = g.journal.length
    const input = mockInput(0, 0)
    for (let s = 0; s < 60; s++) g.update(input, 1 / 60)
    expect(g.journal.length, '명부가 늘지 않았다').toBe(journal0)
  })

  it('명부와 크기는 세션을 넘어 남는다', () => {
    const store = memStore()
    const g = new Voyage()
    g.start(store)
    g.vol = 9000
    const prey = g.active.find((b) => b.r < g.radius * 0.7)!
    g.x = prey.x + g.radius
    g.y = prey.y
    const input = mockInput(0, 0)
    for (let s = 0; s < 120; s++) g.update(input, 1 / 60)
    expect(g.journal.length).toBeGreaterThan(0)
    const eatenName = g.journal[0]!.name
    const volAfter = g.vol

    const g2 = new Voyage()
    g2.start(store)
    expect(g2.vol, '크기가 이어진다').toBeCloseTo(volAfter, 0)
    expect(g2.journal[0]?.name, '명부가 이어진다').toBe(eatenName)
    // 삼킨 천체는 다음 항해에서도 그 자리에 없다 — 우주에 구멍이 남는다
    expect(g2.active.some((b) => b.id === prey.id)).toBe(false)
  })

  it('문턱을 넘으면 칭호가 온다', () => {
    const g = new Voyage()
    g.start(null)
    expect(rankOf(g.radius)).toBe('티끌')
    g.vol = 17 * 17 * 17 // R = 17 — '검은 입' 문턱(16) 위
    g.update(mockInput(0, 0), 1 / 60)
    expect(g.rankUp, '등급 이벤트가 발행됐다').toBe('검은 입')
  })
})
