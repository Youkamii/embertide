/**
 * 전리품 꼬리 + 압사 회귀 테스트 — 블라인드 발상 이식분의 계약.
 *
 * 꼬리: 주운 XP 는 즉시 내 것이 아니다 → 소화돼야 레벨이 된다 → 피격하면 흘린다.
 * 압사: 몰아붙여진 밀집은 서로를 으깬다 (넉백 압력 없인 안 죽는다).
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { Game } from './game'
import { Drop, Foe } from './pools'

function mockInput(x: number, y: number): Input {
  return { move: { x, y } } as unknown as Input
}

function countXpDrops(g: Game): number {
  let n = 0
  for (let i = 0; i < g.drops.high; i++) {
    if (g.drops.alive[i] === 1 && g.drops.type[i] === Drop.Xp) n++
  }
  return n
}

describe('전리품 꼬리', () => {
  it('주운 XP 는 꼬리에 매달리고, 소화돼야 레벨이 된다', () => {
    const g = new Game()
    g.start(61)
    const p = g.player
    // 큰 XP 를 발밑에 놓고 줍는다
    g.drops.spawn(p.x, p.y, 0, 0, 40, Drop.Xp)
    g.update(mockInput(0, 0), 1 / 60)
    expect(p.tailXp, '꼬리에 매달렸다').toBeGreaterThan(30)
    expect(p.level, '즉시 레벨이 오르지 않는다').toBe(1)
    // 소화 — 몇 초 굴리면 레벨업이 온다 (L1 요구 2 XP, 소화율 ~9/s)
    let guard = 0
    while (p.level === 1 && guard++ < 60 * 10) {
      if (g.phase !== 0) break
      p.hp = p.stats.maxHp
      g.update(mockInput(0, 0), 1 / 60)
    }
    expect(p.level, '소화가 레벨이 됐다').toBeGreaterThan(1)
  })

  it('피격하면 미소화분 40% 를 흘리고, 흘린 것은 드랍으로 재산포된다', () => {
    const g = new Game()
    g.start(62)
    const p = g.player
    p.tailXp = 100
    const dropsBefore = countXpDrops(g)
    p.invuln = 0
    expect(p.hurt(10)).toBe(true)
    expect(p.tailXp, '60% 만 남았다').toBeCloseTo(60, 1)
    expect(p.tailSpill, '유실분이 기록됐다').toBeCloseTo(40, 1)
    // 다음 스텝에서 game 이 산포한다
    g.update(mockInput(0, 0), 1 / 60)
    expect(p.tailSpill, '산포 후 소진').toBe(0)
    expect(countXpDrops(g), '유실 XP 가 드랍으로 돌아왔다').toBeGreaterThan(dropsBefore)
  })
})

describe('압사', () => {
  it('몰아붙여진 밀집은 서로를 으깬다 (붕괴가 끌어모을 때처럼)', () => {
    const g = new Game()
    g.start(63)
    // 잔챙이 12마리를 뭉치고 **구심 압력**을 싣는다 — 신성 진화(붕괴)의
    // 끌어모으기나 벽 구석에 몰린 상황의 재현. 개활지의 단방향 넉백은 대열째
    // 이동할 뿐이라 분리력이 즉시 흩는다(그건 압사가 아닌 게 맞다).
    const idx: number[] = []
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      const i = g.foes.spawn(600 + Math.cos(a) * 10, Math.sin(a) * 10, Foe.Mote, 8, k / 12)
      if (i >= 0) idx.push(i)
    }
    const kills0 = g.player.kills
    for (let s = 0; s < 90; s++) {
      if (g.phase !== 0) break
      g.player.hp = g.player.stats.maxHp
      // 구심 압력 유지 (넉백 감쇠 보충)
      for (const i of idx) {
        if (g.foes.alive[i] !== 1) continue
        const dx = 600 - g.foes.x[i]!
        const dy = 0 - g.foes.y[i]!
        const d = Math.hypot(dx, dy) || 1
        g.foes.pushX[i] = (dx / d) * 220
        g.foes.pushY[i] = (dy / d) * 220
      }
      g.update(mockInput(0, 0), 1 / 60)
    }
    let aliveNow = 0
    for (const i of idx) if (g.foes.alive[i] === 1) aliveNow++
    expect(aliveNow, '밀집이 으깨졌다').toBeLessThan(12)
    expect(g.player.kills, '으깬 것도 정상 킬 보상이다').toBeGreaterThan(kills0)
  })

  it('압력 없는 자연 밀집은 죽지 않는다', () => {
    const g = new Game()
    g.start(64)
    const idx: number[] = []
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      const i = g.foes.spawn(2000 + Math.cos(a) * 8, Math.sin(a) * 8, Foe.Mote, 8, k / 12)
      if (i >= 0) idx.push(i)
    }
    for (let s = 0; s < 45; s++) {
      if (g.phase !== 0) break
      g.player.hp = g.player.stats.maxHp
      g.update(mockInput(0, 0), 1 / 60)
    }
    let aliveNow = 0
    for (const i of idx) if (g.foes.alive[i] === 1) aliveNow++
    // 분리력이 흩어 놓을 뿐 죽이지는 않는다 (0.75초 안에 무기가 닿지 않는 원거리)
    expect(aliveNow, '압력 없인 안 죽는다').toBe(idx.length)
  })
})
