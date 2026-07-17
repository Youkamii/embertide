/**
 * 점수·등급 회귀 테스트.
 *
 * 처치 배점이 킬 수에 선형(×12)이던 시절, 후반 킬 인플레이션이 등급을 단독
 * 결정했다 — 실측 178k 킬이면 처치 점수 하나(213만)로 S+ 문턱(160만)을 넘었고,
 * 완주·진화·막·레벨을 다 합쳐도 7만이 안 됐다. 여기 테스트들은 그 붕괴가
 * 다시 오지 못하게 공식의 **성질**을 잠근다.
 */
import { describe, expect, it } from 'vitest'
import { Game } from './game'
import { computeScore, gradeOf } from './score'
import { WeaponSlot } from './weapons'

/** 실측 런 모양을 Game 공개 필드로 재현한다 (kills·elapsed·level·evolved·act). */
function scoreOf(kills: number, elapsed: number, level: number, evolved: number, act: number): number {
  const g = new Game()
  g.start(1)
  g.player.kills = kills
  g.elapsed = elapsed
  g.player.level = level
  g.act = act
  for (let k = 0; k < evolved && g.loadout.weapons.length < 6; k++) {
    const s = new WeaponSlot(k + 1)
    s.evolved = true
    g.loadout.weapons.push(s)
  }
  return computeScore(g)
}

describe('점수·등급', () => {
  // 봇 실측(2026-07-17): 완주 900s·186k킬·Lv83·진화5·5막(g.act=4)
  const winner = scoreOf(186501, 900, 83, 5, 4)
  // 최고의 근접 실패: 851s·156k킬·Lv93·진화5·5막
  const nearMiss = scoreOf(155823, 851, 93, 5, 4)

  it('완주 없이는 S+ 가 없다 — 킬 파밍이 아무리 커도', () => {
    expect(gradeOf(nearMiss, false)).not.toBe('S+')
    // 점수 자체가 문턱을 넘는 극단값이라도 구조가 막는다
    expect(gradeOf(5_000_000, false)).toBe('S')
  })

  it('실측 완주 런은 S+ 에 닿는다 (S+ 가 닿을 수 없는 훈장이면 없는 등급이다)', () => {
    expect(gradeOf(winner, true)).toBe('S+')
  })

  it('킬이 점수를 단독 결정하지 못한다', () => {
    // 같은 킬로 완주만 못 한 런은 완주 런보다 확실히 아래여야 한다
    const killOnly = scoreOf(186501, 400, 40, 0, 2)
    expect(killOnly).toBeLessThan(winner * 0.62)
    // 처치 항목이 전체의 절반을 넘지 않는다 (완주 런 기준)
    expect((186501 * 2) / winner).toBeLessThan(0.5)
  })

  it('등급 사다리가 실측 분포를 갈라놓는다', () => {
    // 8분 3막 사망(실측 41880킬·Lv38·진화3)은 중간 등급
    const mid = scoreOf(41880, 489, 38, 3, 2)
    const gMid = gradeOf(mid, false)
    expect(['B', 'C']).toContain(gMid)
    // 근접 실패는 S — 아깝게 죽은 판이 낮게 찍히면 공식이 성취를 못 읽는 것이다
    expect(gradeOf(nearMiss, false)).toBe('S')
  })
})
