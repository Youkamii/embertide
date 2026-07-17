/**
 * 이펙트 광량 예산 — "화면이 하얘져서 게임 불가"의 회귀 자물쇠.
 *
 * 세 번째 실플레이 보고까지 온 문제다: 범위 확장을 몇 번 찍으면 가법 블렌딩의
 * 누적 광량이 톤매퍼(ACES)를 포화시켜 화면이 백색이 된다. 눈으로 확인할 수 없는
 * 환경이므로 **렌더가 밀어넣는 쿼드를 가짜 렌더러로 받아 광량을 직접 적산**한다.
 *
 * 재는 것: 플레이어 중심 반경 240px 원 안의 "평균 가법 광량" —
 * Σ (쿼드 밝기 × 원과 겹치는 면적) / 원 면적. 이 값이 1.0을 넘으면 그 위에 얹히는
 * bloom·플레이어(2.0)와 함께 ACES가 어깨에 붙어 화면이 백지가 되기 시작한다.
 *
 * 시나리오는 **최악의 합법 빌드**다: 개화8(범위 ×2.2) + 폭심8(폭발 ×2.6) +
 * 진화 광역 무기 6종 + 5막급 밀도의 적. 이보다 심한 상태는 게임 안에 존재하지 않는다.
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { Rng } from '../engine/rng'
import { Shape } from '../engine/shapes'
import { FOE_STATS } from './foes'
import { Game, Phase } from './game'
import { xpForLevel } from './player'
import { Foe } from './pools'
import { P, W, WeaponSlot } from './weapons'

/** 윤곽 모양 — 쿼드 면적 대비 실제 채움이 낮아 광량 기여를 낮게 친다. */
const SPARSE = new Set<number>([
  Shape.Ring, Shape.Halo, Shape.Sigil, Shape.Vortex, Shape.Singularity,
  Shape.Rift, Shape.Rune, Shape.Crack, Shape.Nova,
])

interface Quad {
  x: number
  y: number
  size: number
  r: number
  g: number
  b: number
  a: number
  shape: number
}

/** game.render 가 미는 쿼드를 전부 받아 적는 가짜 배치. */
class MeasureBatch {
  readonly quads: Quad[] = []
  push(
    x: number, y: number, size: number, _rot: number,
    r: number, g: number, b: number, a: number, shape: number,
  ): void {
    this.quads.push({ x, y, size, r, g, b, a, shape })
  }
}

class FakeRenderer {
  width = 1280
  height = 720
  readonly batch = new MeasureBatch()
  readonly shadows = { push: (): void => undefined }
  readonly cosmos = {
    intensity: 0,
    lerpTint: (): void => undefined,
  }
  calm = 1
  begin(): void {
    this.batch.quads.length = 0
  }
  end(_t: number, _hurt: number, _danger: number, calm = 1): void {
    this.calm = calm
  }
}

/**
 * 중심 원(반경 R) 안의 평균 가법 광량.
 * 쿼드는 반지름 size×0.75 원으로 근사하고, 원-원 겹침은 선형 근사로 충분하다 —
 * 이건 회귀 자물쇠지 라디오메트리가 아니다.
 */
function centerLum(quads: readonly Quad[], px: number, py: number, R = 240): number {
  let lum = 0
  const circleArea = Math.PI * R * R
  for (const q of quads) {
    const qr = q.size * 0.75
    const d = Math.hypot(q.x - px, q.y - py)
    if (d >= qr + R) continue
    const rmin = Math.min(qr, R)
    const overlap = Math.min(1, (qr + R - d) / (2 * rmin))
    const area = Math.PI * rmin * rmin * overlap
    const bright = Math.max(q.r, q.g, q.b) * q.a
    const cover = SPARSE.has(q.shape) ? 0.3 : 1
    lum += (bright * cover * area) / circleArea
  }
  return lum
}

/** 최악의 합법 빌드를 조립한 게임. */
function worstCase(): Game {
  const g = new Game()
  g.start(7)
  const lo = g.loadout
  lo.weapons.length = 0
  for (const id of [W.Arc, W.Nova, W.Well, W.Beam, W.Orbit, W.Sigil]) {
    const s = new WeaponSlot(id)
    s.level = 8
    s.evolved = true
    lo.weapons.push(s)
  }
  lo.passives[P.Bloom] = 8 // 범위 +120%
  lo.passives[P.Blast] = 8 // 폭발 반경 +160%, 연쇄 +4
  lo.passives[P.Split] = 8 // 발사체 +4
  lo.passives[P.Might] = 8
  // 레벨을 높이 잡아 XP 유입으로 인한 레벨업 폭주를 막는다 (요구치가 지수라 거의 안 뜬다)
  g.player.level = 60
  g.player.xpNeeded = xpForLevel(60)
  lo.recomputeStats(g.player)
  g.player.hp = g.player.stats.maxHp
  return g
}

/** 플레이어 주변을 5막급 밀도로 채운다. 시뮬 rng 를 건드리지 않는 자체 난수. */
function refill(g: Game, rng: Rng, want: number): void {
  while (g.foes.count < want) {
    const a = rng.next() * Math.PI * 2
    const d = 60 + rng.next() * 560
    const type = rng.next() < 0.7 ? Foe.Mote : Foe.Hex
    const hp = FOE_STATS[type]!.hp * 30
    if (
      g.foes.spawn(
        g.player.x + Math.cos(a) * d, g.player.y + Math.sin(a) * d,
        type, hp, rng.next(),
      ) < 0
    ) break
  }
}

/** 시나리오 하나를 측정한다. 위치가 곧 시나리오다 — 외곽 vs 강착원반 대역. */
function measure(px: number, py: number): { p50: number; p95: number; calmMin: number } {
  const g = worstCase()
  g.player.x = px
  g.player.y = py
  const renderer = new FakeRenderer()
  const spawnRng = new Rng(99)
  const input = { move: { x: 0, y: 0 } } as unknown as Input

  const lums: number[] = []
  const calms: number[] = []
  refill(g, spawnRng, 2600)

  const steps = 12 * 60
  for (let s = 0; s < steps; s++) {
    if (g.phase === Phase.LevelUp) {
      g.choose(g.pendingChoices[0]!)
      continue
    }
    if (g.phase !== Phase.Playing) break
    g.player.hp = g.player.stats.maxHp // 관찰자 불사 — 재는 건 생존이 아니라 광량이다
    g.update(input, 1 / 60)
    if (s % 60 === 0) refill(g, spawnRng, 2600)
    if (s % 2 === 0) {
      g.render(renderer as unknown as Renderer)
      lums.push(centerLum(renderer.batch.quads, g.player.x, g.player.y))
      calms.push(renderer.calm)
    }
  }

  lums.sort((a, b) => a - b)
  return {
    p50: lums[Math.floor(lums.length * 0.5)]!,
    p95: lums[Math.floor(lums.length * 0.95)]!,
    calmMin: Math.min(...calms),
  }
}

describe('이펙트 광량 예산', () => {
  it('최악의 합법 빌드에서도 화면 중심이 타지 않는다 (외곽)', () => {
    const m = measure(0, 1050)
    console.log(`[fxbudget/외곽] p50=${m.p50.toFixed(2)} p95=${m.p95.toFixed(2)} calm=${m.calmMin.toFixed(2)}`)
    // 상한: 이 위로는 플레이어(2.0)·적(0.78)이 이펙트에 묻히기 시작한다.
    // fx 파티클은 Math.random 이라 판마다 조금 다르다 — p95 로 재고 여유를 둔다.
    expect(m.p95, '중심 광량 p95 — 화이트아웃 상한').toBeLessThanOrEqual(1.0)
    // 하한: 감광이 이펙트를 아예 지워버려도 실패다 — "화려하되 타지 않는다"가 목표다.
    expect(m.p50, '중심 광량 p50 — 이펙트 실종 하한').toBeGreaterThanOrEqual(0.08)
  })

  it('강착원반 대역 안에서도 타지 않는다 — 스트림라인·조류·밀집 스폰 포함', () => {
    // 개편 후 주 전장은 대역이다 — 외곽만 재면 자물쇠에 사각이 생긴다 (적대 리뷰).
    const g0 = worstCase()
    const m = measure(0, g0.holeR() * 2.2)
    console.log(`[fxbudget/대역] p50=${m.p50.toFixed(2)} p95=${m.p95.toFixed(2)} calm=${m.calmMin.toFixed(2)}`)
    expect(m.p95, '대역 중심 광량 p95').toBeLessThanOrEqual(1.0)
    expect(m.p50, '대역 중심 광량 p50').toBeGreaterThanOrEqual(0.08)
  })
})
