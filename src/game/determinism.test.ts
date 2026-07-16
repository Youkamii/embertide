/**
 * 결정론 회귀 테스트.
 *
 * 이게 깨지면 데일리 시드(전 세계가 같은 맵)도 협동 동기화도 성립하지 않는다.
 * 시뮬레이션 어딘가에 Math.random 이 섞여 들어가면 여기서 잡힌다.
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { Rng, dailySeed, hashSeed } from '../engine/rng'
import { Game } from './game'

/** Game.update 는 input.move 만 읽는다. */
function mockInput(x: number, y: number): Input {
  return {
    move: { x, y },
    update() {},
    endFrame() {},
    consumePressed: () => false,
    isDown: () => false,
    moving: x !== 0 || y !== 0,
  } as unknown as Input
}

/** 시뮬레이션 상태를 한 줄로 요약. 부동소수점을 그대로 비교하면 무의미하게 깨진다. */
function fingerprint(game: Game): string {
  const f = game.foes
  let sx = 0
  let sy = 0
  let n = 0
  for (let i = 0; i < f.high; i++) {
    if (f.alive[i] === 0) continue
    sx += f.x[i]!
    sy += f.y[i]!
    n++
  }
  return [
    n,
    game.player.kills,
    Math.round(game.player.hp * 100),
    Math.round(sx),
    Math.round(sy),
  ].join('|')
}

function run(seed: number, steps: number, moveX: number, moveY: number): string {
  const game = new Game()
  game.start(seed)
  const input = mockInput(moveX, moveY)
  for (let i = 0; i < steps; i++) {
    // 고정 dt — 프레임률이 시뮬레이션에 새면 그것 자체가 버그다
    game.update(input, 1 / 60)
  }
  return fingerprint(game)
}

describe('결정론', () => {
  it('같은 시드 + 같은 입력 = 같은 결과', () => {
    const a = run(1337, 400, 0.6, -0.8)
    const b = run(1337, 400, 0.6, -0.8)
    expect(a).toBe(b)
  })

  it('다른 시드 = 다른 결과', () => {
    const a = run(1337, 300, 1, 0)
    const b = run(9001, 300, 1, 0)
    expect(a).not.toBe(b)
  })

  it('멈춰 있어도 결정적이다', () => {
    expect(run(77, 240, 0, 0)).toBe(run(77, 240, 0, 0))
  })

  it('시뮬레이션이 실제로 진행된다 (테스트가 빈 상태를 비교하는 게 아님)', () => {
    const game = new Game()
    game.start(5)
    const input = mockInput(0, 0)
    for (let i = 0; i < 300; i++) game.update(input, 1 / 60)
    expect(game.foes.count).toBeGreaterThan(10)
    expect(game.elapsed).toBeGreaterThan(4)
  })
})

describe('Rng', () => {
  it('같은 시드면 같은 수열', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    for (let i = 0; i < 200; i++) expect(a.next()).toBe(b.next())
  })

  it('[0,1) 범위를 벗어나지 않는다', () => {
    const r = new Rng(3)
    for (let i = 0; i < 5000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('시드 0도 죽지 않는다', () => {
    const r = new Rng(0)
    const vals = new Set<number>()
    for (let i = 0; i < 50; i++) vals.add(r.next())
    expect(vals.size).toBeGreaterThan(40)
  })

  it('weighted 가 가중치 0인 항목을 고르지 않는다', () => {
    const r = new Rng(9)
    for (let i = 0; i < 500; i++) {
      expect(r.weighted([0, 1, 0])).toBe(1)
    }
  })

  it('weighted 는 합이 0이면 -1', () => {
    expect(new Rng(1).weighted([0, 0])).toBe(-1)
  })

  it('데일리 시드는 UTC 날짜에만 의존한다', () => {
    const a = dailySeed(new Date('2026-07-16T00:00:01Z'))
    const b = dailySeed(new Date('2026-07-16T23:59:59Z'))
    const c = dailySeed(new Date('2026-07-17T00:00:01Z'))
    expect(a.seed).toBe(b.seed)
    expect(a.label).toBe('2026-07-16')
    expect(a.seed).not.toBe(c.seed)
  })

  it('hashSeed 는 충돌이 흔하지 않다', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) seen.add(hashSeed(`seed-${i}`))
    expect(seen.size).toBeGreaterThan(1990)
  })
})
