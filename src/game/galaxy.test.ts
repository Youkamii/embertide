/** 밀도장 단위 계약 (Phase 3) — 생성 미연결 상태의 순수 함수 검증 */
import { describe, expect, it } from 'vitest'
import { GALAXIES, armProximity, galaxyDensityAt, galaxyOf } from './galaxy'

const MW = GALAXIES[0]!

describe('은하 밀도장', () => {
  it('은하간 공허 = 0 — 헤일로 밖엔 아무것도 없다', () => {
    expect(galaxyDensityAt(MW, MW.cx + MW.rHalo * 1.05, MW.cy, MW.cz)).toBe(0)
    // 우리 은하와 마젤란 사이 심연 (MW 헤일로 1.7e10 밖, 마젤란 반대 방향)
    expect(galaxyOf(MW.cx + MW.rHalo * 3, MW.cy + MW.rHalo * 3, 0)).toBeNull()
  })

  it('팽대부가 원반 변두리보다 압도적으로 조밀하다', () => {
    const core = galaxyDensityAt(MW, MW.cx + MW.rBulge * 0.2, MW.cy, MW.cz)
    const rim = galaxyDensityAt(MW, MW.cx + MW.rDisk, MW.cy, MW.cz)
    expect(core).toBeGreaterThan(rim * 50)
  })

  it('원반 평면이 두께 방향보다 조밀하다 (얇은 원반)', () => {
    const mid = galaxyDensityAt(MW, MW.cx + MW.rScale * 2, MW.cy, MW.cz)
    const above = galaxyDensityAt(MW, MW.cx + MW.rScale * 2, MW.cy, MW.cz + MW.hThin * 4)
    expect(mid).toBeGreaterThan(above * 3)
  })

  it('나선팔 크레스트는 팔 사이보다 밝다 — 부스트 확인', () => {
    const r = MW.rScale * 2.5
    let onArm = 0
    let offArm = 1e9
    for (let i = 0; i < 64; i++) {
      const th = (i / 64) * Math.PI * 2
      const p = armProximity(MW, r, th)
      if (p > onArm) onArm = p
      if (p < offArm) offArm = p
    }
    expect(onArm).toBeGreaterThan(0.9)
    expect(offArm).toBeLessThan(0.1)
  })

  it('중심 r→0 에서 NaN·Infinity 없이 유한하다', () => {
    for (const G of GALAXIES) {
      const rho = galaxyDensityAt(G, G.cx, G.cy, G.cz)
      expect(Number.isFinite(rho)).toBe(true)
      expect(rho).toBeGreaterThan(0)
    }
  })

  it('태양은 우리 은하 소속이다 — 원점(0,0)이 MW 부피 안', () => {
    expect(galaxyOf(0, 0, 0)?.name).toBe('우리 은하')
  })

  it('M33·SMC 는 중심 블랙홀이 없다 (조사 고증)', () => {
    expect(GALAXIES.find((g) => g.name === '삼각형자리 은하')!.hasBH).toBe(false)
    expect(GALAXIES.find((g) => g.name === '작은 마젤란 은하')!.hasBH).toBe(false)
  })
})
