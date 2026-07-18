/**
 * 검은 입 코어 계약 — "삼키면 커지고, 커지면 어제 못 삼키던 것을 삼킨다".
 *
 * ① 우주는 결정론이다 — 같은 좌표 = 같은 천체 (좌표 공유의 전제)
 * ② 작은 것은 삼켜지고, 나는 커지고, 명부에 남는다
 * ③ 나보다 큰 것은 못 삼킨다 (성장의 문이 잠겨 있어야 열리는 맛이 난다)
 * ④ 항해는 판마다 새로 시작하고, 명부만 평생 남는다 (회차 v2)
 * ⑤ 문턱을 넘으면 칭호가 온다
 * ⑥ 요람은 굶기지 않는다 (실플레이 판정 #22-3)
 * ⑦ 위성은 궤도를 돈다 (케플러 레일)
 * ⑧ 내가 지나가면 위성이 레일에서 뜯긴다 (섭동·Hills)
 * ⑨ 못 삼키는 것은 조석으로 찢어 파편을 얻는다 (로슈 한계)
 * ⑩ 먹은 것의 운동량이 내 것이 된다 (보존)
 * ⑪ 탐욕스럽게 쫓기만 해도 굶지 않는다 (성장 페이스)
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { BodyKind, Voyage, rankOf, type Body, type Store } from './voyage'

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

/** 먹이를 위에 올라타서 삼킨다 — 레일 위 천체는 움직이므로 매 틱 붙는다 */
function chase(g: Voyage, prey: Body, frames: number): void {
  const input = mockInput(0, 0)
  for (let s = 0; s < frames; s++) {
    g.x = prey.x
    g.y = prey.y
    g.vx = 0
    g.vy = 0
    g.update(input, 1 / 60)
  }
}

describe('검은 입', () => {
  it('① 우주는 결정론이다 — 같은 자리엔 같은 천체', () => {
    const a = new Voyage()
    const b = new Voyage()
    a.start(null)
    b.start(null)
    const sig = (v: Voyage): string =>
      v.active.map((x) => `${x.id}:${x.kind}:${Math.round(x.x)}:${Math.round(x.r)}`).join('|')
    expect(sig(a)).toBe(sig(b))
    expect(a.active.length).toBeGreaterThan(10)
  })

  it('② 작은 것은 삼켜지고, 나는 커지고, 명부에 남는다', () => {
    const g = new Voyage()
    g.start(null)
    g.vol = 9000 // R ≈ 20.8 — 티끌·달이 먹이가 되는 크기
    const R = g.radius
    // 명부 검증까지 하려면 이름 있는 먹이(티끌이 아닌 것)를 노린다
    const prey = g.active.find(
      (b) => b.r < R * 0.7 && b.r > 2 && (b.kind !== BodyKind.Dust || b.r >= 10),
    )
    expect(prey, '시작 성역 부근에 이름 있는 먹이가 있다').toBeTruthy()
    const vol0 = g.vol
    chase(g, prey!, 90)
    expect(g.vol, '부피가 붙었다').toBeGreaterThan(vol0)
    expect(g.eatenThisRun, '삼킨 수가 센다').toBeGreaterThan(0)
    expect(g.journal.length, '명부에 남았다').toBeGreaterThan(0)
    expect(g.journal[0]!.name.length).toBeGreaterThan(0)
  })

  it('③ 나보다 큰 것은 못 삼킨다', () => {
    const g = new Voyage()
    g.start(null)
    const big = g.active.find((b) => b.r > g.radius * 2)
    expect(big, '큰 천체가 있다').toBeTruthy()
    g.x = big!.x + big!.r * 1.05
    g.y = big!.y
    const input = mockInput(0, 0)
    for (let s = 0; s < 60; s++) {
      g.x = big!.x + big!.r * 1.05
      g.y = big!.y
      g.update(input, 1 / 60)
    }
    expect(g.active.some((b) => b.id === big!.id), '큰 천체는 그대로 있다').toBe(true)
  })

  it('④ 항해는 판마다 새로 시작하고, 명부만 평생 남는다', () => {
    const store = memStore()
    const g = new Voyage()
    g.start(store)
    g.vol = 9000
    const prey = g.active.find(
      (b) => b.r < g.radius * 0.7 && b.r > 2 && (b.kind !== BodyKind.Dust || b.r >= 10),
    )!
    chase(g, prey, 120)
    expect(g.journal.length).toBeGreaterThan(0)
    const eatenName = g.journal[0]!.name

    const g2 = new Voyage()
    g2.start(store)
    expect(g2.vol, '크기는 리셋된다 — 항해는 언제나 티끌에서').toBe(340)
    expect(g2.journal.some((e) => e.name === eatenName), '명부는 이어진다').toBe(true)
    expect(g2.voyages, '항해 횟수가 센다').toBe(2)
    // 우주는 아문다 — 지난 판에 삼킨 천체도 새 판에는 제자리에 있다
    expect(g2.active.some((b) => b.id === prey.id)).toBe(true)
  })

  it('⑤ 문턱을 넘으면 칭호가 온다', () => {
    const g = new Voyage()
    g.start(null)
    expect(rankOf(g.radius)).toBe('티끌')
    g.vol = 13 * 13 * 13 // R = 13 — '검은 입' 문턱(12) 위
    g.update(mockInput(0, 0), 1 / 60)
    expect(g.rankUp, '등급 이벤트가 발행됐다').toBe('검은 입')
  })

  it('⑥ 요람은 굶기지 않는다 — 시작 반경 안에 첫 끼니가 있다', () => {
    const g = new Voyage()
    g.start(null)
    const R = g.radius
    const near = g.active.filter(
      (b) => b.r < R * 0.8 && Math.hypot(b.x - g.x, b.y - g.y) < 1600,
    )
    expect(near.length, '1600px 안 먹이 수').toBeGreaterThanOrEqual(4)
  })

  it('⑦ 위성은 궤도를 돈다 — 케플러 레일', () => {
    const g = new Voyage()
    g.start(null)
    g.vol = 1 // R=1 — 나는 아무것도 못 끌고, 흡수도 못 한다 (관찰자)
    const moon = g.active.find((b) => b.host !== null && b.orbR > 0 && b.ecc === 0)
    expect(moon, '궤도 위성이 있다').toBeTruthy()
    const host = moon!.host!
    const a0 = moon!.orbA
    const input = mockInput(0, 0)
    for (let s = 0; s < 180; s++) g.update(input, 1 / 60)
    const d = Math.hypot(moon!.x - host.x, moon!.y - host.y)
    expect(Math.abs(d - moon!.orbR), '궤도 반지름이 유지된다').toBeLessThan(moon!.orbR * 0.03)
    expect(Math.abs(moon!.orbA - a0), '공전했다').toBeGreaterThan(0.15)
  })

  it('⑧ 내가 지나가면 위성이 레일에서 뜯긴다 — 섭동과 방출', () => {
    const g = new Voyage()
    g.start(null)
    const moon = g.active.find(
      (b) => b.host !== null && b.orbR > 0 && b.ecc === 0 && b.kind === BodyKind.Dust,
    )
    expect(moon, '달이 있다').toBeTruthy()
    const host = moon!.host!
    // 호스트보다 확실히 큰 몸으로 달 옆을 지나간다
    g.vol = Math.pow(host.r * 2, 3)
    const input = mockInput(0, 0)
    for (let s = 0; s < 30; s++) {
      g.x = moon!.x + g.radius * 1.9 // 로슈(1.3배) 밖, 중력권 안 — 찢지 않고 끌기만 한다
      g.y = moon!.y
      g.vx = 0
      g.vy = 0
      g.update(input, 1 / 60)
      if (moon!.free) break
    }
    expect(moon!.free, '레일에서 뜯겼다').toBe(true)
  })

  it('⑨ 못 삼키는 것은 조석으로 찢는다 — 로슈 한계', () => {
    const g = new Voyage()
    g.start(null)
    // r ≥ 10 천체를 골라 내 몸을 "그것의 1.1배 반지름"으로 — 삼키기엔 크고 찢기엔 작다
    const target = g.active.find((b) => b.r > 10 && b.r < 60 && b.host === null)
    expect(target, '대상 천체가 있다').toBeTruthy()
    const R = target!.r / 0.9
    g.vol = R * R * R
    g.x = target!.x + (R + target!.r) * 1.1
    g.y = target!.y
    g.vx = 0
    g.vy = 0
    const id = target!.id
    g.update(mockInput(0, 0), 1 / 60)
    expect(g.active.some((b) => b.id === id), '원본은 사라졌다').toBe(false)
    const debris = g.active.filter((b) => b.hot)
    expect(debris.length, '파편이 생겼다').toBeGreaterThanOrEqual(4)
    for (const d of debris) {
      expect(d.r, '파편은 전부 먹이 크기다').toBeLessThan(g.radius * 0.8)
    }
    // 파편을 실제로 주워 먹으면 부피가 붙는다 — 찢고 먹는 한 사이클
    const vol0 = g.vol
    const input = mockInput(0, 0)
    for (let s = 0; s < 240; s++) {
      const d = g.active.find((b) => b.hot)
      if (!d) break
      g.x = d.x
      g.y = d.y
      g.vx = 0
      g.vy = 0
      g.update(input, 1 / 60)
    }
    expect(g.vol, '파편을 먹고 자랐다').toBeGreaterThan(vol0)
  })

  it('⑩ 먹은 것의 운동량이 내 것이 된다', () => {
    // 같은 우주에서 먹이 속도만 반대로 — 중력 잡음이 상쇄되고 운동량 항만 남는다
    const run = (pvx: number): number => {
      const g = new Voyage()
      g.start(null)
      g.vol = 9000
      const prey = g.active.find((b) => b.r < g.radius * 0.7 && b.r > 3)!
      prey.free = true
      prey.host = null
      prey.orbR = 0
      prey.vx = pvx
      prey.vy = 0
      g.x = prey.x
      g.y = prey.y
      g.vx = 0
      g.vy = 0
      const input = mockInput(0, 0)
      for (let s = 0; s < 70; s++) {
        g.x = prey.x
        g.y = prey.y
        g.update(input, 1 / 60)
      }
      return g.vx
    }
    const fwd = run(900)
    const back = run(-900)
    expect(fwd - back, '먹이 속도 방향으로 밀렸다').toBeGreaterThan(1)
  })

  it('⑪ 탐욕스럽게 쫓기만 해도 굶지 않는다 — 성장 페이스', () => {
    const g = new Voyage()
    g.start(null)
    const input = { move: { x: 0, y: 0 } } as unknown as Input
    let lastEat = 0
    let starve = 0
    let worstStarve = 0
    for (let s = 0; s < 7200; s++) {
      // 매 반 초마다 가장 가까운 먹이를 다시 고른다 (탐욕 봇)
      if (s % 30 === 0) {
        const R = g.radius
        let best: Body | null = null
        let bd = Infinity
        for (const b of g.active) {
          if (b.r >= R * 0.8) continue
          const d = Math.hypot(b.x - g.x, b.y - g.y)
          if (d < bd) {
            bd = d
            best = b
          }
        }
        if (best) {
          const d = Math.hypot(best.x - g.x, best.y - g.y) || 1
          input.move.x = (best.x - g.x) / d
          input.move.y = (best.y - g.y) / d
        }
      }
      g.update(input, 1 / 60)
      if (g.eatenThisRun > lastEat) {
        lastEat = g.eatenThisRun
        starve = 0
      } else {
        starve += 1 / 60
        if (starve > worstStarve) worstStarve = starve
      }
    }
    // 2분 동안 시작 부피의 3배 — 이보다 느리면 "성장이 안 된다" 판정이 재발한다
    expect(g.vol, `2분 뒤 부피 (r=${Math.round(g.radius)})`).toBeGreaterThan(340 * 3)
    // 기아 계곡 금지 — 30초 넘게 아무것도 못 먹는 구간이 있으면 안 된다 (실측 62초 → 수리)
    expect(worstStarve, '최장 기아 구간(초)').toBeLessThan(30)
  })
})
