/**
 * P0 — 원거리 결정론 계약 (실척 우주 아키텍처 Phase 0).
 * determinism.test 는 뱀서류 Game 을 재고, voyage ① 은 시작 상태만 잰다 —
 * far-field 절차 생성의 결정론 방벽은 이 파일이 유일하다. Phase 4(밀도장
 * 시딩 교체)에서 부동소수·순서 의존이 섞이면 여기가 붉는다.
 */
import { describe, expect, it } from 'vitest'
import { Voyage } from './voyage'

function fingerprint(g: Voyage): string {
  return g.active
    .map((b) => `${b.id}:${Math.round(b.x)}:${Math.round(b.y)}:${b.r.toFixed(2)}`)
    .sort()
    .join('|')
}

describe('원거리 결정론', () => {
  it('P0 같은 자리 = 같은 우주 — far-field 생성 지문이 인스턴스 간 일치한다', () => {
    const mk = (): Voyage => {
      const g = new Voyage()
      g.start(null)
      g.x = 5_000_000
      g.y = -3_200_000
      g.camera.viewHeight = 40000 // 넓은 활성창 — 표본이 비지 않게
      ;(g as unknown as { refreshSectors(force: boolean): void }).refreshSectors(true)
      return g
    }
    const a = mk()
    const b = mk()
    expect(a.active.length, '심우주 표본이 비지 않는다').toBeGreaterThan(0)
    expect(fingerprint(a)).toBe(fingerprint(b))
  })
})
