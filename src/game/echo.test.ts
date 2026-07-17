/**
 * 반향 연쇄 회귀 테스트.
 *
 * 적대 리뷰가 잡은 것: 상한이 **작동한 적이 없다**. echoDepth 는 explode() 안에서만
 * 오르내리는데, 반향의 폭발은 0.42초 뒤 updateFields 에서 **새 스택으로** 일어난다.
 * 그래서 depth 는 항상 0 또는 1이고, 진화형 상한(2+chain)에 절대 안 걸린다.
 *
 * 진짜 상한은 세대(generation)여야 한다 — 필드에 실려 다녀야 스택을 넘어 살아남는다.
 */
import { describe, expect, it } from 'vitest'
import type { Input } from '../engine/input'
import { Game, Phase } from './game'
import { Field } from './weapons'

function mockInput(x: number, y: number): Input {
  return { move: { x, y } } as unknown as Input
}

describe('반향 연쇄', () => {
  it('세대 상한이 실제로 필드에 실려 다닌다', () => {
    const g = new Game()
    g.start(1)
    // 필드를 직접 놓아 세대가 보존되는지 본다
    g.placeField(Field.Echo, 0, 0, 60, 10, 0.4, true, 0)
    const i = g.fields.high - 1
    expect(g.fields.alive[i]).toBe(1)
    // gen 필드가 존재하고 0에서 시작한다
    expect(g.fields.gen[i]!).toBe(0)
  })

  it('연쇄가 폭주하지 않는다 (필드 풀이 차면 프레임이 죽는다)', () => {
    const g = new Game()
    g.start(2026)
    const input = mockInput(0, 0)
    // 진화 반향을 강제로 쥐여 준다
    g.loadout.reset(10 /* W.Echo */)
    const echo = g.loadout.weapons[0]!
    echo.level = 8
    echo.evolved = true
    g.loadout.recomputeStats(g.player)

    let maxFields = 0
    for (let i = 0; i < 60 * 60 && g.phase === Phase.Playing; i++) {
      if ((g.phase as number) === Phase.LevelUp) { g.choose(g.pendingChoices[0]!); continue }
      g.update(input, 1 / 60)
      if (g.fields.count > maxFields) maxFields = g.fields.count
    }
    // 512(MAX_FIELDS) 에 닿으면 그건 상한이 아니라 포화다 — 세대 상한이 먼저 걸려야 한다
    expect(maxFields, `최대 동시 필드 ${maxFields}`).toBeLessThan(400)
  })
})
