/**
 * 보스 패턴 회귀 테스트.
 *
 * 예전 보스는 체력만 큰 잔챙이였다. "패턴이 있다"는 주장은 코드가 있다는 뜻이 아니라
 * **읽고 피할 수 있다**는 뜻이라, 그 계약을 여기서 강제한다:
 *  1) 실행 전에 예고가 있다 (읽을 시간)
 *  2) 예고 중엔 멈춘다 (안 그러면 못 읽는다)
 *  3) 피하면 보상이 있다 (빈틈 = 딜 기회)
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '../engine/rng'
import { Boss, BossState } from './boss'

function run(seed: number, steps: number, hpFrac = 1): { boss: Boss; seen: number[] } {
  const boss = new Boss()
  boss.spawn(0, 1000)
  const rng = new Rng(seed)
  const seen: number[] = []
  for (let i = 0; i < steps; i++) {
    const entered = boss.tick(1 / 60, rng, hpFrac)
    if (entered !== null) seen.push(entered)
  }
  return { boss, seen }
}

describe('보스 패턴', () => {
  it('돌진 앞에는 반드시 예고가 온다 (안 그러면 무작위 사고다)', () => {
    const { seen } = run(1, 60 * 120)
    expect(seen.length).toBeGreaterThan(8)
    for (let i = 0; i < seen.length; i++) {
      if (seen[i] === BossState.Charge) {
        expect(seen[i - 1], `${i}번째 돌진 앞`).toBe(BossState.Aim)
      }
    }
  })

  it('돌진 뒤에는 반드시 빈틈이 온다 (피한 보상이 없으면 패턴을 읽을 이유가 없다)', () => {
    const { seen } = run(7, 60 * 120)
    for (let i = 0; i < seen.length - 1; i++) {
      if (seen[i] === BossState.Charge) {
        expect(seen[i + 1], `${i}번째 돌진 뒤`).toBe(BossState.Stagger)
      }
    }
  })

  it('예고 중엔 멈춘다 (움직이면서 예고하면 못 읽는다)', () => {
    const boss = new Boss()
    boss.spawn(0, 100)
    boss.state = BossState.Aim
    expect(boss.speedScale()).toBe(0)
    boss.state = BossState.Stagger
    expect(boss.speedScale()).toBe(0)
  })

  it('돌진은 평소보다 확실히 빠르다 (안 그러면 돌진이 아니다)', () => {
    const boss = new Boss()
    boss.spawn(0, 100)
    boss.state = BossState.Stalk
    const walk = boss.speedScale()
    boss.state = BossState.Charge
    expect(boss.speedScale()).toBeGreaterThan(walk * 3)
  })

  it('빈틈에서만 피해가 증폭된다', () => {
    const boss = new Boss()
    boss.spawn(0, 100)
    for (const st of [BossState.Stalk, BossState.Aim, BossState.Charge, BossState.Summon, BossState.Collapse]) {
      boss.state = st as never
      expect(boss.damageScale(), `state ${st}`).toBe(1)
    }
    boss.state = BossState.Stagger
    expect(boss.damageScale()).toBeGreaterThan(1.5)
  })

  it('패턴 3종이 모두 나온다 (하나만 반복되면 그건 패턴이 아니다)', () => {
    const { seen } = run(42, 60 * 180)
    expect(seen).toContain(BossState.Aim)
    expect(seen).toContain(BossState.Summon)
    expect(seen).toContain(BossState.Collapse)
  })

  it('체력이 낮으면 더 공격적이다 (궁지에 몰린 짐승)', () => {
    const healthy = run(3, 60 * 240, 1).seen.filter((s) => s === BossState.Charge).length
    const wounded = run(3, 60 * 240, 0.2).seen.filter((s) => s === BossState.Charge).length
    expect(wounded).toBeGreaterThan(healthy)
  })

  it('예고 진행도가 0에서 1로 찬다 (연출이 이걸로 차오른다)', () => {
    const boss = new Boss()
    boss.spawn(0, 100)
    boss.state = BossState.Aim
    boss.timer = 1.1
    expect(boss.telegraph()).toBeCloseTo(0, 1)
    boss.timer = 0.55
    expect(boss.telegraph()).toBeCloseTo(0.5, 1)
    boss.timer = 0
    expect(boss.telegraph()).toBeCloseTo(1, 1)
  })

  it('예고 시간이 읽을 만하다 (0.8초 아래면 반응이 불가능하다)', () => {
    const boss = new Boss()
    boss.spawn(0, 100)
    boss.state = BossState.Stalk
    // 상태 전이를 돌려 Aim 에 들어간 순간의 timer 를 본다
    const rng = new Rng(1)
    let aimTimer = 0
    for (let i = 0; i < 60 * 60; i++) {
      const e = boss.tick(1 / 60, rng, 1)
      if (e === BossState.Aim) { aimTimer = boss.timer; break }
    }
    expect(aimTimer).toBeGreaterThanOrEqual(0.8)
  })

  it('보스가 없으면 아무 일도 안 한다', () => {
    const boss = new Boss()
    expect(boss.alive).toBe(false)
    expect(boss.tick(1 / 60, new Rng(1), 1)).toBeNull()
    boss.spawn(5, 100)
    expect(boss.alive).toBe(true)
    boss.reset()
    expect(boss.alive).toBe(false)
    expect(boss.idx).toBe(-1)
  })

  it('결정적이다 (같은 시드 = 같은 패턴 순서)', () => {
    expect(run(9, 60 * 100).seen).toEqual(run(9, 60 * 100).seen)
  })
})
