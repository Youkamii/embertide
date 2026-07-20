/**
 * P0·P4 — 원거리 생성 계약 (실척 우주 아키텍처).
 * ① 결정론: 같은 자리 = 같은 우주 (SCELL 시딩의 유일한 회귀망 — determinism.test
 *   는 뱀서류 Game 을 재고, voyage ① 은 시작 상태만 잰다)
 * ② 무소속 0: 심우주 절차 천체는 전부 은하 소속(gal)을 각인받는다
 * ③ 진짜 공허: 은하 부피 밖(은하간 공간)엔 아무것도 태어나지 않는다
 */
import { describe, expect, it } from 'vitest'
import { STAR_MAP } from './starmap'
import { Voyage } from './voyage'

const sgr = STAR_MAP.find((s) => s.name === '궁수자리 A*')!

function at(x: number, y: number): Voyage {
  const g = new Voyage()
  g.start(null)
  g.x = x
  g.y = y
  g.camera.viewHeight = 40000 // 넓은 활성창 — 표본이 비지 않게
  ;(g as unknown as { refreshSectors(force: boolean): void }).refreshSectors(true)
  return g
}

function fingerprint(g: Voyage): string {
  return g.active
    .map((b) => `${b.id}:${Math.round(b.x)}:${Math.round(b.y)}:${b.r.toFixed(2)}`)
    .sort()
    .join('|')
}

describe('원거리 생성 계약', () => {
  it('P0 같은 자리 = 같은 우주 — 팽대부 생성 지문이 인스턴스 간 일치한다', () => {
    const a = at(sgr.x + 2e7, sgr.y + 3.3e7) // 은하중심 ~780광년 — 팽대부 심부
    const b = at(sgr.x + 2e7, sgr.y + 3.3e7)
    expect(a.active.length, '팽대부 표본이 비지 않는다').toBeGreaterThan(0)
    expect(fingerprint(a)).toBe(fingerprint(b))
  })

  it('P4 무소속 0 — 심우주 절차 천체는 전부 은하 소속을 각인받는다', () => {
    const g = at(sgr.x + 2e7, sgr.y + 3.3e7)
    for (const b of g.active) {
      expect(b.gal, `무소속 천체 발견: id=${b.id} r=${b.r}`).toBeDefined()
    }
  })

  it('P4 진짜 공허 — 은하간 공간엔 아무것도 태어나지 않는다', () => {
    const g = at(5e10, 5e10) // 우리 은하 헤일로(1.7e10) 밖, 어느 은하 부피에도 없음
    expect(g.active.length).toBe(0)
  })
})
