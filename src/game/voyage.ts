/**
 * 검은 입 — 우주를 삼키는 탐험. 씨앗: "우주 탐험" + "스스로 블랙홀이 되어,
 * 커질수록 더 큰 우주를 집어삼킨다" (사용자, 2026-07-18).
 *
 * 지키는 문장은 하나다: **나는 블랙홀이다. 삼키면 커지고, 커지면 어제 못 삼키던
 * 것을 삼킨다.** 이 문장 밖의 시스템은 없다 — 적도, 점수도, 타이머도, 죽음도 없다.
 *
 * v2 — 실물리 우주 (실플레이 판정 #22: "점 찍어 키운 벽지는 우주가 아니다"):
 * · 케플러 궤도 — 달은 행성을, 행성은 태양을 돈다. 벨트도 쌍성도 돈다.
 * · 만유인력의 대칭 — 나보다 큰 것이 나를 끌고, 나보다 작은 것을 내가 끈다.
 * · 섭동과 방출(Hills) — 내가 지나가면 위성이 레일에서 뜯겨 슬링샷으로 흩어진다.
 * · 로슈 한계 — 아직 못 삼키는 것도 바짝 붙으면 조석으로 찢어 파편(먹이)을 얻는다.
 * · TDE — 큰 것을 삼키면 일부는 플레어로 튕겨 나간다. 식사는 깔끔하지 않다.
 * · 틀 끌림 — 내 곁의 낙하물은 곧장 떨어지지 않고 소용돌이치며 감긴다.
 * · 운동량 보존 — 먹은 것의 속도가 내 속도에 합산된다.
 *
 * 회차 v2: 항해는 판마다 새로 시작한다. 평생 남는 것은 명부(수집책)와 기록뿐이다.
 */
import type { SfxName } from '../engine/audio'
import { Camera } from '../engine/camera'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { Rng, hashSeed } from '../engine/rng'
import { Shape } from '../engine/shapes'
import { starLog, starName } from './starnames'

/** 우주 시드 — 상수다. 모두가 같은 우주를 삼켜야 좌표 공유가 성립한다. */
export const UNIVERSE_SEED = 20260718

const SECTOR = 2400
const ACTIVE = 1
/** 삼킬 수 있는 크기 비율 — 내 반지름의 이 배수 미만이면 먹이다 */
const EDIBLE = 0.8

// ── 물리 상수 (다이얼 — docs/우주-물리.md 가 이 표의 해설이다)
/** 표면중력 계수 — 천체가 나를 끄는 힘과 내가 천체를 끄는 힘이 같은 공식을 쓴다 */
const GRAV = 192 // = 3.2 * 60
/** 천체가 나를 끄는 가속 상한 (기동 불능 방지) */
const PULL_CAP_ON_ME = 340
/** 내가 천체를 끄는 가속 상한 */
const PULL_CAP_BY_ME = 640
/** 레일 이탈 문턱 — 내 중력이 궤도 구심 가속의 이 배수를 넘으면 위성이 뜯긴다 */
const DETACH = 1.15
/** 틀 끌림 세기 — 낙하물에 접선 성분을 준다 (0 = 슈바르츠실트, >0 = 커) */
const FRAME_DRAG = 0.45
/** 검은 입 흡인 배율 — 같은 반지름의 항성보다 세게 끈다 (밀집천체의 특권) */
const MAW_PULL = 3
/** 로슈 접근 배율 — (R + r) 의 이 배수 안이면 조석 파괴 */
const ROCHE = 1.3
/** 삼킨 부피 중 내 것이 되는 비율 — 나머지는 강착 과정에서 새는 셈 */
const ABSORB_GAIN = 0.85
/** 조석 파괴 파편의 부피 회수율 (통째 삼키기보다 손해 — 조급함의 세금) */
const SHRED_PIECE = 0.46

export const BodyKind = {
  Dust: 0, // 티끌 — 첫 끼니. 파편도 이것이 된다
  Comet: 1, // 혜성 — 타원 궤도, 근일점에서 빠르다 (케플러 2법칙)
  Ringed: 2, // 고리 행성 — 달을 거느린다
  Sun: 3, // 항성 — 행성계의 앵커. 한때는 나를 내던지던 것
  Garden: 4, // 성운 정원
  Core: 5, // 은하심(銀河心) — 아주 멀리서만. 최후의 식사
} as const
export type BodyKindType = (typeof BodyKind)[keyof typeof BodyKind]

export interface Body {
  readonly id: number
  readonly kind: BodyKindType
  readonly seed: number
  readonly r: number
  readonly cr: number
  readonly cg: number
  readonly cb: number
  x: number
  y: number
  /** 현재 속도 — 레일 위에서는 접선 속도가 매 틱 갱신된다 (이탈 관성·운동량용) */
  vx: number
  vy: number
  /** 궤도 앵커 — 천체(움직인다) 또는 고정점(ax,ay). 없으면 자유체 */
  host: Body | null
  ax: number
  ay: number
  orbR: number
  orbA: number
  orbW: number
  /** 이심률 — 혜성. r(θ)=a(1-e²)/(1+e·cosθ), 각속도는 면적 속도 일정으로 */
  ecc: number
  /** 레일에서 뜯겼다 — 이제 중력 적분만 따른다 */
  free: boolean
  /** 조석 파편 — 뜨겁게 그린다 */
  hot: boolean
}

export interface JournalEntry {
  readonly name: string
  readonly log: string
  readonly kind: BodyKindType
  readonly r: number
  readonly x: number
  readonly y: number
}

const STORE_KEY = 'embertide:maw:v1'

/**
 * 성장 등급 — 반지름이 문턱을 넘는 순간이 이 게임의 이정표다.
 * 숫자가 아니라 칭호가 자란다: "내가 무엇이 되어가는가"가 읽혀야 한다.
 */
export const RANKS: readonly { readonly r: number; readonly name: string }[] = [
  { r: 0, name: '티끌' },
  { r: 12, name: '검은 입' },
  { r: 30, name: '혜성을 삼키는 것' },
  { r: 75, name: '행성 사냥꾼' },
  { r: 200, name: '별을 삼키는 자' },
  { r: 500, name: '성단의 공포' },
  { r: 1300, name: '은하의 아귀' },
]

export function rankOf(radius: number): string {
  let name = RANKS[0]!.name
  for (const rk of RANKS) if (radius >= rk.r) name = rk.name
  return name
}

/**
 * 라이벌 — 다른 검은 입. 나보다 작으면 도망치는 최고의 먹이(추격전),
 * 나보다 크면 나를 사냥한다. 물리면 부피 26% 강탈 — 상실은 있어도 끝은 없다.
 */
export interface Rival {
  readonly id: number
  x: number
  y: number
  vx: number
  vy: number
  vol: number
  readonly seed: number
}

/** 영속 — 게임이 직접 localStorage 를 만지지 않는다 (테스트 가능성). */
export interface Store {
  load(): string | null
  save(s: string): void
}

/** 흡수 슬롯 — 여러 개를 동시에 삼킨다 (벨트 훑어먹기가 이 게임의 군것질이다) */
interface Absorb {
  b: Body
  t: number
  dur: number
}

const START_VOL = 340

export class Voyage {
  // ── 나 — 검은 입
  x = 0
  y = 600
  vx = 0
  vy = 0
  heading = 0
  /** 부피 — 삼킨 모든 것의 합. 반지름은 세제곱근으로 자란다 (초반 급성장, 후반 묵직). */
  vol = START_VOL
  thrusting = false

  // ── 세계
  private readonly sectors = new Map<string, Body[]>()
  readonly active: Body[] = []
  private activeKey = ''
  /** 이번 항해에서 삼켜진 천체 — 판이 끝나면 우주는 아문다 */
  private readonly eaten = new Set<number>()

  // ── 포식 — 동시 흡수 슬롯 (스파게티화 연출 시간)
  readonly absorbs: Absorb[] = []

  lastFound: JournalEntry | null = null
  /** 명부 — 평생 목록. 항해가 끝나도 이름은 남는다. 티끌은 이름 없이 지나간다 */
  readonly journal: JournalEntry[] = []
  /** 이번 항해에서 삼킨 총수 (티끌 포함) */
  private eatCount = 0
  farthest = 0
  /** 가장 큰 한 입 (반지름) — 명부의 자랑거리 */
  biggestMeal = 0
  /** 역대 최고 반지름 — 타이틀의 평생 기록 */
  bestR = 0
  voyages = 0
  visualTime = 0
  readonly camera = new Camera()
  readonly sfxQueue: SfxName[] = []
  private store: Store | null = null

  // ── 라이벌 — 활성 섹터의 다른 검은 입들 (섹터 시드에서 결정론 스폰)
  readonly rivals: Rival[] = []
  /** 방금 등급이 올랐는가 — main 이 배너로 띄우고 지운다 */
  rankUp: string | null = null
  private lastRank = ''
  /** 꿀꺽 펄스 0..1 — 삼킨 직후 고리가 출렁인다 (렌더 전용) */
  private gulp = 0
  /** 식사 플레어 0..1 — cosmos 강착원반이 이걸 보고 타오른다 (TDE) */
  feed = 0
  /** 라이벌에게 물린 직후 무적 (연속 강탈 방지) */
  private bittenCd = 0
  /** 합병 중력파 — 라이벌을 삼킨 자리에서 고리가 퍼진다 */
  private waveX = 0
  private waveY = 0
  private waveT = 1e9
  /** 화면 밖 가장 가까운 먹이 (나침반) */
  private preyX = 0
  private preyY = 0
  private preyDist = Infinity

  get radius(): number {
    return Math.cbrt(this.vol)
  }

  get eatenThisRun(): number {
    return this.eatCount
  }

  sfx(name: SfxName): void {
    if (this.sfxQueue.length < 12) this.sfxQueue.push(name)
  }

  start(store: Store | null): void {
    this.store = store
    this.x = 0
    this.y = 600
    this.vx = 0
    this.vy = 0
    this.vol = START_VOL // 반지름 ~7 — 티끌보다 조금 큰 무엇. 항해는 언제나 여기서
    this.journal.length = 0
    this.eaten.clear()
    this.farthest = 0
    this.lastFound = null
    this.absorbs.length = 0
    this.sectors.clear()
    this.activeKey = ''
    this.rivals.length = 0
    this.rankUp = null
    this.gulp = 0
    this.feed = 0
    this.bittenCd = 0
    this.biggestMeal = 0
    this.bestR = 0
    this.voyages = 0
    this.waveT = 1e9
    if (store) {
      try {
        const raw = store.load()
        if (raw) {
          const d = JSON.parse(raw) as {
            journal?: JournalEntry[]
            farthest?: number
            biggestMeal?: number
            bestR?: number
            voyages?: number
          }
          // v1 저장에 있던 vol·eaten 은 읽지 않는다 — 회차 v2: 항해는 판마다 새로.
          for (const e of d.journal ?? []) this.journal.push(e)
          this.farthest = d.farthest ?? 0
          this.biggestMeal = d.biggestMeal ?? 0
          this.bestR = d.bestR ?? 0
          this.voyages = d.voyages ?? 0
        }
      } catch {
        // 깨진 저장은 조용히 새 명부로 — 우주는 그대로다
      }
    }
    this.eatCount = 0
    this.voyages += 1
    this.lastRank = rankOf(this.radius)
    this.camera.x = this.x
    this.camera.y = this.y
    this.camera.viewHeight = Math.max(1100, this.radius * 30)
    this.refreshSectors(true)
    this.persist()
  }

  private persist(): void {
    if (!this.store) return
    try {
      if (this.radius > this.bestR) this.bestR = Math.round(this.radius)
      this.store.save(JSON.stringify({
        journal: this.journal.slice(-400),
        farthest: Math.round(this.farthest),
        biggestMeal: this.biggestMeal,
        bestR: this.bestR,
        voyages: this.voyages,
      }))
    } catch {
      // 저장 실패는 항해를 막지 않는다
    }
  }

  // ── 우주 생성 — 좌표 해시가 시드다. 멀수록 크다: 성장하려면 떠나야 한다.
  //
  // v2: 천체는 점이 아니라 계(系)다. 태양은 행성을 거느리고 행성은 달을 거느린다.
  // 위성의 궤도 각속도는 실제 중력 공식과 정합시킨다(tv=√(g·d)) — 그래야 레일에서
  // 뜯긴 순간의 관성이 물리와 이어져 거짓말이 없다.

  private newBody(
    id: number, kind: BodyKindType, x: number, y: number, r: number, seed: number,
    cr: number, cg: number, cb: number,
  ): Body {
    return {
      id, kind, seed, r, cr, cg, cb, x, y,
      vx: 0, vy: 0, host: null, ax: 0, ay: 0, orbR: 0, orbA: 0, orbW: 0, ecc: 0,
      free: false, hot: false,
    }
  }

  /** 원궤도 레일을 건다 — 각속도는 호스트 표면중력에서 유도 (vis-viva 근사) */
  private setOrbit(b: Body, host: Body, orbR: number, orbA: number, dir: number, ecc = 0): void {
    b.host = host
    b.orbR = orbR
    b.orbA = orbA
    b.ecc = ecc
    const g = (host.r * host.r * GRAV) / (orbR * orbR)
    b.orbW = (dir * Math.sqrt(g * orbR)) / orbR
  }

  private sectorBodies(sx: number, sy: number): Body[] {
    const key = `${sx},${sy}`
    let list = this.sectors.get(key)
    if (list) return list
    list = []
    const seed = hashSeed(`${UNIVERSE_SEED}:${sx}:${sy}`)
    const rng = new Rng(seed)
    const dist = Math.hypot(sx, sy)
    /** 거리 눈금 — 천체 크기가 거리 따라 자란다. "더 큰 우주"는 항상 더 바깥에 있다. */
    const scale = 1 + dist * 0.55
    const suns: Body[] = []

    // ── 앵커 패스 — 계의 중심들
    const n = 3 + rng.int(3)
    for (let k = 0; k < n; k++) {
      const bx = sx * SECTOR + (0.08 + rng.next() * 0.84) * SECTOR
      const by = sy * SECTOR + (0.08 + rng.next() * 0.84) * SECTOR
      const bSeed = hashSeed(`${seed}:${k}`)
      const roll = rng.next()
      const hue = rng.next()
      const cr = 0.45 + hue * 0.6
      const cg = 0.35 + (1 - hue) * 0.5
      const cb = 0.5 + Math.abs(0.5 - hue)
      let b: Body
      if (roll < 0.3) {
        b = this.newBody(bSeed, BodyKind.Dust, bx, by,
          (5 + rng.next() * 8) * Math.sqrt(scale), bSeed, cr, cg, cb)
      } else if (roll < 0.48) {
        // 혜성 — 태양 패스 뒤에 궤도를 건다 (지금은 자유 드리프트로 두고 표시만)
        b = this.newBody(bSeed, BodyKind.Comet, bx, by,
          (10 + rng.next() * 9) * Math.sqrt(scale), bSeed, cr, cg, cb)
        b.vx = (rng.next() - 0.5) * 120
        b.vy = (rng.next() - 0.5) * 120
      } else if (roll < 0.72) {
        b = this.newBody(bSeed, BodyKind.Ringed, bx, by,
          (30 + rng.next() * 28) * scale * 0.7, bSeed, cr, cg, cb)
      } else if (roll < 0.9) {
        b = this.newBody(bSeed, BodyKind.Sun, bx, by,
          (70 + rng.next() * 60) * scale * 0.8, bSeed, cr, cg, cb)
        suns.push(b)
      } else if (dist >= 5 && roll < 0.97) {
        b = this.newBody(bSeed, BodyKind.Garden, bx, by,
          (120 + rng.next() * 90) * scale * 0.7, bSeed, cr, cg, cb)
      } else if (dist >= 9) {
        b = this.newBody(bSeed, BodyKind.Core, bx, by,
          (300 + rng.next() * 240) * scale * 0.8, bSeed, cr, cg, cb)
      } else {
        b = this.newBody(bSeed, BodyKind.Ringed, bx, by,
          (34 + rng.next() * 20) * scale * 0.7, bSeed, cr, cg, cb)
      }
      list.push(b)
    }

    // ── 위성 패스 — 태양엔 행성을, 행성엔 달을. 위성이 곧 먹이 사다리다:
    // 거물 곁엔 언제나 그 거물의 조각 크기 먹이가 있다.
    const anchors = list.slice()
    for (const host of anchors) {
      if (host.kind === BodyKind.Sun) {
        const np = 1 + rng.int(3)
        for (let i = 0; i < np; i++) {
          const pSeed = hashSeed(`${host.seed}:p:${i}`)
          const pr = host.r * (0.1 + rng.next() * 0.1)
          const orbR = host.r * (2.1 + i * 1.25 + rng.next() * 0.7)
          const p = this.newBody(pSeed, BodyKind.Ringed, host.x, host.y, pr, pSeed,
            0.5 + rng.next() * 0.4, 0.45 + rng.next() * 0.3, 0.55 + rng.next() * 0.35)
          this.setOrbit(p, host, orbR, rng.next() * Math.PI * 2, rng.next() < 0.5 ? 1 : -1)
          list.push(p)
          if (rng.next() < 0.55) {
            const mSeed = hashSeed(`${pSeed}:m`)
            const m = this.newBody(mSeed, BodyKind.Dust, p.x, p.y,
              pr * (0.2 + rng.next() * 0.16), mSeed, 0.55, 0.52, 0.6)
            this.setOrbit(m, p, pr * (2 + rng.next() * 1.2), rng.next() * Math.PI * 2, 1)
            list.push(m)
          }
        }
        // 혜성을 이 태양의 타원 궤도에 건다 (케플러 2법칙: 근일점에서 빠르다)
        if (rng.next() < 0.6) {
          const cSeed = hashSeed(`${host.seed}:c`)
          const c = this.newBody(cSeed, BodyKind.Comet, host.x, host.y,
            (9 + rng.next() * 8) * Math.sqrt(scale), cSeed, 0.8, 0.9, 1.0)
          this.setOrbit(c, host, host.r * (3 + rng.next() * 3.5),
            rng.next() * Math.PI * 2, 1, 0.45 + rng.next() * 0.32)
          list.push(c)
        }
        // 소행성 벨트 — 태양을 도는 티끌 고리. 헤치고 지나가면 우수수 삼켜진다.
        if (rng.next() < 0.5) {
          const beltR = host.r * (1.7 + rng.next() * 1.1)
          const cnt = 11 + rng.int(7)
          const a0 = rng.next() * Math.PI * 2
          for (let i = 0; i < cnt; i++) {
            const dSeed = hashSeed(`${host.seed}:belt:${i}`)
            const d = this.newBody(dSeed, BodyKind.Dust, host.x, host.y,
              (4.2 + ((dSeed >>> 4) % 100) * 0.05) * Math.sqrt(scale), dSeed, 0.5, 0.48, 0.55)
            this.setOrbit(d, host, beltR * (0.94 + ((dSeed >>> 6) % 100) * 0.0012),
              a0 + (i / cnt) * Math.PI * 2, 1)
            list.push(d)
          }
        }
      } else if (host.kind === BodyKind.Ringed && host.host === null) {
        const nm = 1 + rng.int(2)
        for (let i = 0; i < nm; i++) {
          const mSeed = hashSeed(`${host.seed}:m:${i}`)
          const m = this.newBody(mSeed, BodyKind.Dust, host.x, host.y,
            host.r * (0.16 + rng.next() * 0.14), mSeed, 0.55, 0.52, 0.62)
          this.setOrbit(m, host, host.r * (1.9 + i * 1.1 + rng.next() * 0.6),
            rng.next() * Math.PI * 2, rng.next() < 0.5 ? 1 : -1)
          list.push(m)
        }
      } else if (host.kind === BodyKind.Core) {
        // 은하심은 태양들을 거느린다 — 마지막 만찬의 곁들이
        for (let i = 0; i < 2; i++) {
          const sSeed = hashSeed(`${host.seed}:s:${i}`)
          const s = this.newBody(sSeed, BodyKind.Sun, host.x, host.y,
            host.r * (0.16 + rng.next() * 0.1), sSeed, 1.6, 1.2, 0.5)
          this.setOrbit(s, host, host.r * (1.9 + i * 0.9), rng.next() * Math.PI * 2, 1)
          list.push(s)
        }
      }
    }

    // ── 성단 — 먼 우주의 장관: 태양 둘셋이 공통 무게중심을 돈다 (쌍성계).
    if (dist >= 6 && rng.next() < 0.18) {
      const cx0 = sx * SECTOR + rng.next() * SECTOR
      const cy0 = sy * SECTOR + rng.next() * SECTOR
      const cnt = 2 + rng.int(2)
      for (let k = 0; k < cnt; k++) {
        const bSeed = hashSeed(`${seed}:cl:${k}`)
        const hue = ((bSeed >>> 3) % 100) / 100
        const r = (60 + ((bSeed >>> 6) % 60)) * scale * 0.7
        const s = this.newBody(bSeed, BodyKind.Sun, cx0, cy0, r, bSeed,
          0.5 + hue * 0.5, 0.4 + (1 - hue) * 0.4, 0.35)
        s.ax = cx0
        s.ay = cy0
        s.orbR = r * 2.4
        s.orbA = (k / cnt) * Math.PI * 2
        s.orbW = 0.05 + ((bSeed >>> 8) % 10) * 0.004
        list.push(s)
        suns.push(s)
      }
    }

    // ── 부스러기 필드 — 어디에나 있다. 크기는 거리 따라 자라므로 "내 다음 한 입"이
    // 항상 근처에 있다 (계측: 이게 없으면 60초짜리 기아 계곡이 생긴다). 요람은 더 후하게.
    const cradle = dist <= 1.5
    const cnt = cradle ? 8 + rng.int(4) : 5 + rng.int(3)
    for (let i = 0; i < cnt; i++) {
      const dSeed = hashSeed(`${seed}:cr:${i}`)
      const d = this.newBody(dSeed, BodyKind.Dust,
        sx * SECTOR + rng.next() * SECTOR, sy * SECTOR + rng.next() * SECTOR,
        cradle ? 3.2 + rng.next() * 2.2 : (3.5 + rng.next() * 3.5) * Math.sqrt(scale),
        dSeed, 0.55, 0.5, 0.6)
      list.push(d)
    }

    this.sectors.set(key, list)
    if (this.sectors.size > 64) {
      const cx = Math.floor(this.x / SECTOR)
      const cy = Math.floor(this.y / SECTOR)
      for (const [k] of this.sectors) {
        const [axx, ayy] = k.split(',').map(Number)
        if (Math.abs(axx! - cx) > 3 || Math.abs(ayy! - cy) > 3) this.sectors.delete(k)
        if (this.sectors.size <= 48) break
      }
    }
    return list
  }

  /** 이 섹터의 결정론 라이벌 — 있으면 초기 상태를, 없으면 null. */
  private sectorRival(sx: number, sy: number): Rival | null {
    const dist = Math.hypot(sx, sy)
    if (dist < 2) return null // 요람 근처엔 동족이 없다 — 첫 조우는 사건이어야 한다
    const seed = hashSeed(`${UNIVERSE_SEED}:rv:${sx}:${sy}`)
    const rng = new Rng(seed)
    if (rng.next() >= 0.2) return null
    const scale = 1 + dist * 0.55
    const r = (10 + rng.next() * 26) * scale * 0.6
    return {
      id: seed,
      x: sx * SECTOR + rng.next() * SECTOR,
      y: sy * SECTOR + rng.next() * SECTOR,
      vx: 0,
      vy: 0,
      vol: r * r * r,
      seed,
    }
  }

  private refreshSectors(force = false): void {
    const sx = Math.floor(this.x / SECTOR)
    const sy = Math.floor(this.y / SECTOR)
    const key = `${sx},${sy}`
    if (!force && key === this.activeKey) return
    this.activeKey = key
    this.active.length = 0
    const rivalIds = new Set<number>()
    for (let dy = -ACTIVE; dy <= ACTIVE; dy++) {
      for (let dx = -ACTIVE; dx <= ACTIVE; dx++) {
        for (const b of this.sectorBodies(sx + dx, sy + dy)) {
          if (!this.eaten.has(b.id)) this.active.push(b)
        }
        const rv = this.sectorRival(sx + dx, sy + dy)
        if (rv && !this.eaten.has(rv.id)) {
          rivalIds.add(rv.id)
          if (!this.rivals.some((r) => r.id === rv.id)) this.rivals.push(rv)
        }
      }
    }
    // 활성 범위를 떠난 라이벌은 잊는다 — 다시 오면 같은 초기 상태로 돌아온다
    for (let i = this.rivals.length - 1; i >= 0; i--) {
      if (!rivalIds.has(this.rivals[i]!.id)) this.rivals.splice(i, 1)
    }
  }

  // ── 한 틱

  update(input: Input, dt: number): void {
    const step = Math.min(dt, 0.05)
    this.visualTime += dt
    const R = this.radius

    // 추진 — 클수록 무겁다. 은하를 삼킨 것이 티끌처럼 촐싹거리면 거짓말이다.
    const mx = input.move.x
    const my = input.move.y
    this.thrusting = mx !== 0 || my !== 0
    if (this.thrusting) {
      const ml = Math.hypot(mx, my) || 1
      const acc = 460 / (1 + R / 220)
      this.vx += (mx / ml) * acc * step
      this.vy += (my / ml) * acc * step
      this.heading = Math.atan2(my, mx)
    }
    const drag = Math.exp(-0.1 * step)
    this.vx *= drag
    this.vy *= drag

    // ── 천체 물리 한 패스: 레일 전진 → 내 중력(섭동·이탈·틀 끌림) → 자유체 적분.
    // 리스트는 호스트가 위성보다 먼저 생성돼 있어(생성 순서) 한 패스로 안전하다.
    for (const b of this.active) {
      if (this.eaten.has(b.id)) continue
      // 호스트를 잃은 위성은 구심력을 잃는다 — 마지막 접선 속도로 흩어진다 (산개)
      if (b.host && this.eaten.has(b.host.id)) {
        b.free = true
        b.host = null
      }
      if (!b.free && b.orbR > 0) {
        // 케플러 레일 — 2법칙: 가까울수록 빠르다 (혜성의 근일점 질주)
        let rr = b.orbR
        let w = b.orbW
        if (b.ecc > 0) {
          rr = (b.orbR * (1 - b.ecc * b.ecc)) / (1 + b.ecc * Math.cos(b.orbA))
          w = b.orbW * (b.orbR / rr) * (b.orbR / rr)
        }
        b.orbA += w * step
        const cx = b.host ? b.host.x : b.ax
        const cy = b.host ? b.host.y : b.ay
        b.x = cx + Math.cos(b.orbA) * rr
        b.y = cy + Math.sin(b.orbA) * rr
        const tv = w * rr
        b.vx = -Math.sin(b.orbA) * tv + (b.host ? b.host.vx : 0)
        b.vy = Math.cos(b.orbA) * tv + (b.host ? b.host.vy : 0)
      }
      // 내 중력 — 나보다 작은 것만 내가 끈다 (질량 우위). 대칭의 반쪽.
      if (b.r < R) {
        const dx = this.x - b.x
        const dy = this.y - b.y
        const d2 = dx * dx + dy * dy
        const d = Math.sqrt(d2) || 1
        if (d < R * 14) {
          const g = Math.min(PULL_CAP_BY_ME, (R * R * GRAV * MAW_PULL) / d2)
          if (!b.free && b.orbR > 0) {
            // 섭동 — 내 중력이 궤도 결속을 넘으면 레일에서 뜯긴다 (Hills 방출)
            const bind = Math.abs(b.orbW * b.orbW * b.orbR)
            if (g > bind * DETACH) b.free = true
          } else {
            b.vx += (dx / d) * g * step
            b.vy += (dy / d) * g * step
            // 틀 끌림 — 낙하물은 곧장 떨어지지 않고 내 스핀 방향으로 감긴다
            const fd = g * FRAME_DRAG * (R / (d + R))
            b.vx += (-dy / d) * fd * step
            b.vy += (dx / d) * fd * step
            // 강착 점성 — 내 우물 깊이 들어온 것은 마찰로 감속해 나선으로 떨어진다.
            // 이게 없으면 중력 산란이 먹이를 극초속으로 쏴 버린다 (계측: 5분에 1끼).
            // 우주가 강착원반을 만드는 이유와 같다: 각운동량은 점성으로만 버려진다.
            const prox = R / (d + R)
            const visc = Math.exp(-step * 4 * prox * prox)
            b.vx = this.vx + (b.vx - this.vx) * visc
            b.vy = this.vy + (b.vy - this.vy) * visc
          }
        }
      }
      // 자유체 — 내 중력 + (있다면) 옛 호스트의 중력으로 적분
      if (b.free || (b.orbR === 0 && (b.vx !== 0 || b.vy !== 0))) {
        if (b.host) {
          const hx = b.host.x - b.x
          const hy = b.host.y - b.y
          const hd2 = hx * hx + hy * hy
          const hd = Math.sqrt(hd2) || 1
          const hg = Math.min(PULL_CAP_ON_ME, (b.host.r * b.host.r * GRAV) / hd2)
          b.vx += (hx / hd) * hg * step
          b.vy += (hy / hd) * hg * step
        }
        b.x += b.vx * step
        b.y += b.vy * step
      }
    }

    // 중력 — **나보다 큰 것만** 나를 끈다. 내가 크면 세계가 조용해진다:
    // 어제 나를 내던지던 태양이 오늘은 아무 힘도 못 쓴다. 성장이 곧 지형 변화다.
    for (const b of this.active) {
      if (b.r <= R || this.eaten.has(b.id)) continue
      const dx = b.x - this.x
      const dy = b.y - this.y
      const d2 = dx * dx + dy * dy
      const d = Math.sqrt(d2) || 1
      if (d > b.r * 9) continue
      const g = Math.min(PULL_CAP_ON_ME, ((b.r * b.r * GRAV) / d2))
      this.vx += (dx / d) * g * step
      this.vy += (dy / d) * g * step
    }

    const prevX = this.x
    const prevY = this.y
    this.x += this.vx * step
    this.y += this.vy * step
    this.refreshSectors()

    const dist = Math.hypot(this.x, this.y)
    if (dist > this.farthest) this.farthest = dist

    // ── 로슈 한계 — 삼키기엔 크고(EDIBLE↑) 나보다는 작은 것: 바짝 붙으면 조석으로
    // 찢어진다. 파편은 먹이다 — 통째보다 손해지만, 오늘 당장 먹는 맛이 있다.
    for (const b of this.active) {
      if (this.eaten.has(b.id)) continue
      if (b.r < R * EDIBLE || b.r >= R) continue
      const d = Math.hypot(b.x - this.x, b.y - this.y)
      if (d < (R + b.r) * ROCHE) this.shred(b)
    }

    // ── 포식 — 내 입가의 먹이는 나선을 그리며 들어온다. 동시 슬롯 5개:
    // 벨트를 가로지르면 티끌이 줄줄이 감긴다 (훑어먹기).
    for (let i = this.absorbs.length - 1; i >= 0; i--) {
      const a = this.absorbs[i]!
      if (this.eaten.has(a.b.id)) {
        this.absorbs.splice(i, 1)
        continue
      }
      a.t += step / a.dur
      if (a.t >= 1) {
        this.swallow(a.b)
        this.absorbs.splice(i, 1)
      }
    }
    if (this.absorbs.length < 8) {
      // 이동 선분 스윕 — 빠르게 지나가도 프레임 사이로 먹이가 새지 않는다 (터널링 방지).
      // 작을 때 전속으로 티끌 위를 스치면 점 판정은 60fps 에서도 구멍이 난다 (계측 ⑪).
      const sx = this.x - prevX
      const sy = this.y - prevY
      const segL2 = sx * sx + sy * sy
      for (const b of this.active) {
        if (this.absorbs.length >= 8) break
        if (b.r >= R * EDIBLE || this.eaten.has(b.id)) continue
        if (this.absorbs.some((a) => a.b.id === b.id)) continue
        const wx = b.x - prevX
        const wy = b.y - prevY
        const tt = segL2 > 0 ? Math.max(0, Math.min(1, (wx * sx + wy * sy) / segL2)) : 0
        const d = Math.hypot(prevX + sx * tt - b.x, prevY + sy * tt - b.y)
        // 상대속도 팽창 — 먹이 쪽이 빠르게 스칠 때의 터널링도 막는다
        const relV = Math.hypot(b.vx - this.vx, b.vy - this.vy)
        if (d < R * 1.7 + b.r + relV * step) {
          // 지평선 근처의 시간 지연 — 큰 먹이일수록 오래 늘어지며 들어온다
          this.absorbs.push({ b, t: 0, dur: 0.42 + Math.min(0.5, (b.r / R) * 0.55) })
        }
      }
    }

    // ── 다른 검은 입들 — 작으면 도망치는 최고의 먹이, 크면 나를 사냥하는 이유.
    this.bittenCd = Math.max(0, this.bittenCd - step)
    for (let i = this.rivals.length - 1; i >= 0; i--) {
      const rv = this.rivals[i]!
      const rr = Math.cbrt(rv.vol)
      const dx = this.x - rv.x
      const dy = this.y - rv.y
      const d = Math.hypot(dx, dy) || 1
      const bigger = rr > R
      if (d < 2400) {
        const dir = bigger ? 1 : -1
        const acc = (bigger ? 200 : 250) / (1 + rr / 240)
        rv.vx += (dx / d) * dir * acc * step
        rv.vy += (dy / d) * dir * acc * step
      }
      rv.vx *= drag
      rv.vy *= drag
      rv.x += rv.vx * step
      rv.y += rv.vy * step
      if (d < (rr + R) * 0.9) {
        if (bigger && this.bittenCd <= 0) {
          // 물렸다 — 부피 26% 강탈 + 내던져짐. 상실은 있어도 끝은 없다.
          const stolen = this.vol * 0.26
          this.vol -= stolen
          rv.vol += stolen
          this.bittenCd = 2.5
          this.vx += (dx / d) * 640
          this.vy += (dy / d) * 640
          this.camera.shake(6, 8)
          this.sfx('hurt')
        } else if (!bigger && rr < R * EDIBLE) {
          // 동족을 삼킨다 — 블랙홀 합병. 중력파가 퍼진다.
          this.vol += rv.vol * ABSORB_GAIN
          this.gulp = 1
          this.feed = 1
          if (rr > this.biggestMeal) this.biggestMeal = Math.round(rr)
          this.eaten.add(rv.id)
          const entry: JournalEntry = {
            name: `${starName(rv.seed)} — 다른 검은 입`,
            log: '나와 같은 것이었다. 이제 나다.',
            kind: BodyKind.Core,
            r: Math.round(rr),
            x: Math.round(rv.x),
            y: Math.round(rv.y),
          }
          this.journal.push(entry)
          this.lastFound = entry
          this.waveX = rv.x
          this.waveY = rv.y
          this.waveT = 0
          this.rivals.splice(i, 1)
          this.sfx('bigKill')
          this.persist()
        }
      }
    }
    this.gulp = Math.max(0, this.gulp - step * 2.2)
    this.feed = Math.max(0, this.feed - step * 0.8)
    this.waveT += step

    // ── 나침반 — 화면 밖 가장 가까운 먹이. "주변에 먹을 게 없다"는 순간을 없앤다.
    this.preyDist = Infinity
    for (const b of this.active) {
      if (b.r >= R * EDIBLE || this.eaten.has(b.id)) continue
      const d = Math.hypot(b.x - this.x, b.y - this.y)
      if (d < this.preyDist) {
        this.preyDist = d
        this.preyX = b.x
        this.preyY = b.y
      }
    }

    // ── 등급 — 문턱을 넘는 순간이 이정표다. "내가 무엇이 되어가는가."
    const rank = rankOf(this.radius)
    if (rank !== this.lastRank) {
      this.lastRank = rank
      this.rankUp = rank
      this.gulp = 1
      this.sfx('evolve')
      this.persist()
    }

    // 카메라 — 내가 자란 만큼 물러난다. 줌아웃이 곧 성장의 감각이다.
    const speed = Math.hypot(this.vx, this.vy)
    const targetView = Math.max(950, R * 26) + Math.min(1, speed / 700) * 900
    this.camera.viewHeight += (targetView - this.camera.viewHeight) * (1 - Math.exp(-1.3 * dt))
    this.camera.follow(this.x + this.vx * 0.3, this.y + this.vy * 0.3, dt, 3.4)
    this.camera.update(dt)
  }

  /** 삼킴 확정 — 부피·운동량·명부·TDE. */
  private swallow(b: Body): void {
    const R = this.radius
    this.eaten.add(b.id)
    const bMass = b.r * b.r * b.r
    this.vol += bMass * ABSORB_GAIN
    // 운동량 보존 — 먹은 것의 속도가 내 것이 된다 (질량 가중)
    const f = bMass / (this.vol + bMass)
    this.vx += (b.vx - this.vx) * f
    this.vy += (b.vy - this.vy) * f
    this.gulp = Math.min(1, b.r / R + 0.25)
    this.eatCount += 1
    if (b.r > this.biggestMeal) this.biggestMeal = Math.round(b.r)
    // 명부에는 이름 있는 것만 남는다 — 티끌·파편 스팸이 큰 수확의 기록을 밀어내면 안 된다
    if (b.kind !== BodyKind.Dust || b.r >= 10) {
      const entry: JournalEntry = {
        name: b.hot ? `${starName(b.seed)}의 파편` : starName(b.seed),
        log: b.hot ? '내 조석이 그것을 먼저 찢었다.' : starLog(b.seed),
        kind: b.kind,
        r: Math.round(b.r),
        x: Math.round(b.x),
        y: Math.round(b.y),
      }
      this.journal.push(entry)
      this.lastFound = entry
    }
    const idx = this.active.indexOf(b)
    if (idx >= 0) this.active.splice(idx, 1)
    // TDE — 큰 식사는 깔끔하지 않다: 일부가 플레어로 튕겨 나간다. 다시 주우면 된다.
    if (b.r > R * 0.5) {
      this.feed = 1
      this.spawnDebris(b, 2 + (b.seed % 2), 0.16, 380 + R * 2, true)
      this.sfx('boom')
    }
    this.sfx(b.r > R * 0.45 ? 'evolve' : 'pickup')
    // 매 삼킴 저장 — 브라우저를 닫아도 마지막 한 입이 명부에 남아야 한다.
    this.persist()
  }

  /** 로슈 조석 파괴 — 통째로는 못 삼키는 것을 찢어 파편으로. */
  private shred(b: Body): void {
    this.eaten.add(b.id)
    const idx = this.active.indexOf(b)
    if (idx >= 0) this.active.splice(idx, 1)
    const n = 4 + (b.seed % 3)
    this.spawnDebris(b, n, SHRED_PIECE, 150 + this.radius * 1.2, false)
    this.gulp = Math.max(this.gulp, 0.6)
    this.feed = Math.max(this.feed, 0.55)
    this.camera.shake(3, 7)
    const entry: JournalEntry = {
      name: `${starName(b.seed)} — 조석 파괴`,
      log: '삼키기엔 컸다. 그래서 찢었다.',
      kind: b.kind,
      r: Math.round(b.r),
      x: Math.round(b.x),
      y: Math.round(b.y),
    }
    this.journal.push(entry)
    this.lastFound = entry
    this.sfx('kill')
    this.persist()
  }

  /** 파편 생성 — 모체 주위 링에서 바깥+접선으로 흩어진다. 전부 먹이다. */
  private spawnDebris(b: Body, n: number, sizeK: number, speed: number, out: boolean): void {
    const sx = Math.floor(b.x / SECTOR)
    const sy = Math.floor(b.y / SECTOR)
    const list = this.sectors.get(`${sx},${sy}`)
    for (let i = 0; i < n; i++) {
      const dSeed = hashSeed(`${b.seed}:sh:${i}`)
      if (this.eaten.has(dSeed)) continue
      const a = (i / n) * Math.PI * 2 + (dSeed % 100) * 0.01
      const pr = Math.max(2.2, b.r * (sizeK + ((dSeed >>> 5) % 40) * 0.002))
      const d = this.newBody(dSeed, BodyKind.Dust,
        b.x + Math.cos(a) * b.r * 0.7, b.y + Math.sin(a) * b.r * 0.7, pr, dSeed,
        Math.min(1.4, b.cr * 1.5), Math.min(1.2, b.cg * 1.2), b.cb * 0.8)
      d.free = true
      d.hot = true
      const tang = out ? 0.35 : 0.85 // 조석 파편은 접선으로 감기고, TDE 는 방사로 튄다
      d.vx = Math.cos(a) * speed * (1 - tang) + -Math.sin(a) * speed * tang + b.vx
      d.vy = Math.sin(a) * speed * (1 - tang) + Math.cos(a) * speed * tang + b.vy
      list?.push(d)
      this.active.push(d)
    }
  }

  // ── 렌더 — 나는 빛이 아니라 빛의 부재다.

  render(renderer: Renderer): void {
    const cam = this.camera
    const view = cam.toView(renderer.width, renderer.height)
    const t = this.visualTime
    const R = this.radius
    // cosmos 셰이더가 진짜 블랙홀을 그린다: 중력 렌즈·지평선·광자 고리·강착원반이
    // 전부 내 위치·크기에 정렬된다. 클수록 배경이 세게 휜다 — 성장이 화면 문법이 된다.
    renderer.cosmos.holeX = this.x
    renderer.cosmos.holeY = this.y
    renderer.cosmos.holeR = R
    renderer.cosmos.intensity = 0.42 + this.feed * 0.3
    renderer.cosmos.beat = this.gulp
    renderer.cosmos.feed = this.feed
    renderer.cosmos.diskIn = R * 1.35
    renderer.cosmos.diskOut = R * 3.1
    this.tintByRegion(renderer)
    renderer.begin(view, t)
    const b = renderer.batch
    const cullR = cam.visibleRadius(renderer.width, renderer.height)

    let preyOnScreen = false
    for (const body of this.active) {
      const dx = body.x - cam.x
      const dy = body.y - cam.y
      const margin = cullR + body.r * 4
      if (dx * dx + dy * dy > margin * margin) continue
      const ab = this.absorbs.find((a) => a.b.id === body.id)
      if (ab) {
        this.renderAbsorbing(b, body, ab.t)
      } else {
        if (body.r < R * EDIBLE && dx * dx + dy * dy < cullR * cullR * 0.6) preyOnScreen = true
        this.renderBody(b, body, t, R)
      }
    }

    // 나침반 — 화면에 먹이가 없으면, 가장 가까운 먹이 쪽 가장자리에 금색 표식.
    if (!preyOnScreen && this.preyDist < Infinity) {
      const a = Math.atan2(this.preyY - this.y, this.preyX - this.x)
      const rr = cam.viewHeight * 0.4
      b.push(
        cam.x + Math.cos(a) * rr, cam.y + Math.sin(a) * rr, 14 + Math.sin(t * 4) * 3,
        a, 0.9, 0.75, 0.3, 0.8, Shape.Husk,
      )
    }

    // 합병 중력파 — 라이벌을 삼킨 자리에서 시공의 고리가 퍼진다
    if (this.waveT < 1.6) {
      const k = this.waveT / 1.6
      b.push(this.waveX, this.waveY, 60 + k * 900, 0, 0.5 * (1 - k), 0.45 * (1 - k), 0.6 * (1 - k), (1 - k) * 0.8, Shape.Ring)
      b.push(this.waveX, this.waveY, 30 + k * 620, 0, 0.4 * (1 - k), 0.3 * (1 - k), 0.5 * (1 - k), (1 - k) * 0.7, Shape.Ring)
    }

    // 다른 검은 입들 — 나와 같은 문법으로 그린다. 크기 비교가 곧 정보다:
    // 붉은 고리(나보다 큼 = 위협) / 옅은 고리(먹이).
    for (const rv of this.rivals) {
      const rr = Math.cbrt(rv.vol)
      const dx = rv.x - cam.x
      const dy = rv.y - cam.y
      const margin = cullR + rr * 3
      if (dx * dx + dy * dy > margin * margin) continue
      const threat = rr > R
      renderer.shadows.push(rv.x, rv.y, rr * 1.06, 0, 0, 0, 0, 0.96, Shape.Orb)
      b.push(
        rv.x, rv.y, rr * 1.16, t * 0.5,
        threat ? 1.7 : 0.8, threat ? 0.3 : 0.7, threat ? 0.25 : 0.6, 1, Shape.Ring,
      )
      b.push(rv.x, rv.y, rr * 1.6, -t * 0.3, 0.3, 0.1, 0.3, 0.7, Shape.Vortex)
    }

    // 나 — 지평선·광자 고리는 cosmos 셰이더가 그린다. 배치는 그 위의 살아있는 것만:
    // 가림용 검은 원반(위 레이어 정합), 꿀꺽 출렁 고리, 강착 소용돌이, 추진 불꽃.
    const gp = 1 + this.gulp * 0.22
    renderer.shadows.push(this.x, this.y, R * 1.04, 0, 0, 0, 0, 0.96, Shape.Orb)
    b.push(this.x, this.y, R * 1.15 * gp, t * 0.4, 1.5, 1.18, 0.75, 0.9, Shape.Ring)
    b.push(this.x, this.y, R * 1.75 * gp, -t * 0.22, 0.35, 0.14, 0.4, 0.8, Shape.Vortex)
    if (this.thrusting) {
      b.push(
        this.x - Math.cos(this.heading) * R * 1.5, this.y - Math.sin(this.heading) * R * 1.5,
        R * 0.5, this.heading, 0.9, 0.5, 0.25, 0.7, Shape.Spark,
      )
    }

    renderer.end(t, 0, 0, 1)
  }

  /** 지역 색조 — 우주는 구역마다 성운의 색이 다르다. 여행이 팔레트를 바꾼다. */
  private static readonly PALETTES: readonly (readonly [number, number, number])[] = [
    [0.32, 0.14, 0.62], [0.06, 0.34, 0.5],
    [0.5, 0.16, 0.3], [0.12, 0.2, 0.55],
    [0.1, 0.4, 0.34], [0.3, 0.3, 0.14],
    [0.45, 0.28, 0.1], [0.1, 0.16, 0.5],
    [0.2, 0.1, 0.5], [0.4, 0.12, 0.42],
    [0.08, 0.3, 0.55], [0.35, 0.35, 0.5],
  ]

  private tintByRegion(renderer: Renderer): void {
    const rx = Math.floor(this.x / (SECTOR * 3))
    const ry = Math.floor(this.y / (SECTOR * 3))
    const h = hashSeed(`${UNIVERSE_SEED}:rg:${rx}:${ry}`)
    const P = Voyage.PALETTES
    const a = P[h % P.length]!
    const bb = P[(h >>> 4) % P.length]!
    renderer.cosmos.lerpTint(a, bb, 0.015)
  }

  /** 삼켜지는 중 — 나선을 그리며 늘어나다 사라진다 (스파게티화 + 적색편이). */
  private renderAbsorbing(b: Renderer['batch'], body: Body, k: number): void {
    // 지평선 근처의 시간 지연: 진행은 빠르게 시작해 끝에서 늘어진다
    const ease = 1 - Math.pow(1 - k, 1.7)
    const ang = Math.atan2(body.y - this.y, body.x - this.x) + ease * 3.1
    const d = Math.hypot(body.x - this.x, body.y - this.y) * (1 - ease)
    const bx = this.x + Math.cos(ang) * d
    const by = this.y + Math.sin(ang) * d
    // 적색편이 — 떨어지는 빛은 붉게 저문다
    const red = 1 + k * 0.9
    const dim = 1 - k * 0.55
    b.push(
      bx, by, body.r * (1 - k * 0.65), ang + Math.PI / 2,
      body.cr * red, body.cg * dim, body.cb * dim * 0.7, 1 - k * 0.3,
      k > 0.45 ? Shape.Spark : Shape.Orb,
    )
    // 늘어난 조석 꼬리
    b.push(
      bx + Math.cos(ang + 1.8) * body.r, by + Math.sin(ang + 1.8) * body.r,
      body.r * 0.7 * (1 - k * 0.5), ang + Math.PI / 2,
      body.cr * red * 0.6, body.cg * 0.3, body.cb * 0.25, (1 - k) * 0.7, Shape.Spark,
    )
  }

  private renderBody(b: Renderer['batch'], body: Body, t: number, myR: number): void {
    let { x, y } = body
    const { r, cr, cg, cb } = body
    const s = body.seed % 6.283
    const edible = r < myR * EDIBLE
    // 조석 융기 — 나보다 작은 것이 내 곁을 지나면 내 쪽으로 늘어나 보인다 (렌더만)
    const ddx = this.x - x
    const ddy = this.y - y
    const dd = Math.hypot(ddx, ddy) || 1
    if (r < myR && dd < myR * 7 && !edible) {
      const pull = Math.min(10, (myR * 26) / dd)
      x += (ddx / dd) * pull
      y += (ddy / dd) * pull
      b.push(x + (ddx / dd) * r * 0.8, y + (ddy / dd) * r * 0.8, r * 0.5,
        Math.atan2(ddy, ddx), cr * 0.5, cg * 0.4, cb * 0.4, 0.5, Shape.Spark)
    }
    // 먹이는 옅은 금테가 두른다 — "이제 삼킬 수 있다"가 눈으로 읽힌다
    if (edible) b.push(x, y, r * 1.5 + 12, t * 0.8, 0.4, 0.34, 0.16, 0.5, Shape.Ring)
    switch (body.kind) {
      case BodyKind.Dust:
        if (body.hot) {
          // 파편 — 아직 식지 않았다
          b.push(x, y, r * 1.1, s + t * 2, 1.3, 0.7, 0.3, 1, Shape.Mote)
          b.push(x - body.vx * 0.04, y - body.vy * 0.04, r * 0.8, Math.atan2(body.vy, body.vx), 0.8, 0.4, 0.15, 0.6, Shape.Spark)
        } else {
          b.push(x, y, r, s + t * 0.3, cr * 0.5, cg * 0.5, cb * 0.55, 1, Shape.Mote)
        }
        break
      case BodyKind.Comet: {
        // 꼬리는 반태양 방향 — 태양풍이 분다 (호스트가 태양이면 정확히, 아니면 속도 반대)
        let ta = Math.atan2(-body.vy, -body.vx)
        if (body.host && body.host.kind === BodyKind.Sun) {
          ta = Math.atan2(body.y - body.host.y, body.x - body.host.x)
        }
        b.push(x, y, r, ta + Math.PI, 1.1, 1.0, 0.95, 1, Shape.Comet)
        for (let k = 1; k <= 9; k++) {
          b.push(
            x + Math.cos(ta) * k * r * 0.55, y + Math.sin(ta) * k * r * 0.55,
            r * (1 - k / 11), ta,
            0.4 / k + 0.1, 0.4 / k + 0.12, 0.6 / k + 0.16, 0.8, Shape.Spark,
          )
        }
        break
      }
      case BodyKind.Ringed: {
        b.push(x, y, r, t * 0.04 + s, cr * 0.75, cg * 0.75, cb * 0.85, 1, Shape.Orb)
        // 명암 — 구는 한쪽이 어둡다 (입체)
        b.push(x + r * 0.28, y + r * 0.22, r * 0.72, 0, cr * 0.2, cg * 0.2, cb * 0.28, 0.5, Shape.Orb)
        for (let k = 0; k < 22; k++) {
          const a = (k / 22) * Math.PI * 2 + t * 0.1
          const rr = r * (1.6 + ((k * 0.618) % 1) * 0.5)
          // 고리 모트도 조석을 느낀다 — 내가 가까우면 내 쪽으로 쓸린다
          let mxx = x + Math.cos(a) * rr
          let myy = y + Math.sin(a) * rr * 0.4
          if (dd < myR * 6 && r < myR) {
            const mk = Math.min(14, (myR * 30) / dd)
            mxx += (ddx / dd) * mk
            myy += (ddy / dd) * mk
          }
          b.push(mxx, myy, Math.max(2.5, r * 0.06), a, cr * 0.45, cg * 0.45, cb * 0.55, 1, Shape.Mote)
        }
        break
      }
      case BodyKind.Sun: {
        const pulse = 1 + Math.sin(t * 0.7 + s) * 0.04
        const flick = 1 + Math.sin(t * 5.3 + s * 3) * 0.05
        b.push(x, y, r * 2.4 * pulse, 0, cr * 0.45, cg * 0.35, 0.08, 0.6, Shape.Orb)
        b.push(x, y, r * pulse, t * 0.08, 1.8 * flick, 1.35 * flick, 0.55, 1, Shape.Orb)
        // 코로나 스포크 — 자전하는 광선 (은은하게)
        b.push(x, y, r * 1.9, t * 0.11 + s, cr * 0.3, cg * 0.22, 0.05, 0.35, Shape.Nova)
        break
      }
      case BodyKind.Garden: {
        for (let k = 0; k < 44; k++) {
          const a = k * 2.39996 + t * 0.03
          const rr = r * Math.sqrt(((k * 0.618) % 1))
          b.push(
            x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8, Math.max(3, r * 0.05),
            a, cr * 0.4, cg * 0.55, cb * 0.5, 0.9, Shape.Mote,
          )
        }
        break
      }
      case BodyKind.Core: {
        // 은하심 — 나선팔이 도는 최후의 식사. 중심은 그 자신도 검다.
        b.push(x, y, r * 1.5, t * 0.06 + s, cr * 0.5, cg * 0.4, cb * 0.7, 1, Shape.Vortex)
        b.push(x, y, r * 0.5, -t * 0.15, 1.7, 1.5, 1.2, 1, Shape.Orb)
        for (let k = 0; k < 50; k++) {
          const arm = k % 2
          const tt = k / 50
          const a = tt * 9 + arm * Math.PI + t * 0.06
          const rr = r * (0.3 + tt * 1.1)
          b.push(
            x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6, Math.max(3, r * 0.045),
            a, cr * 0.6 * (1 - tt * 0.5), cg * 0.5, cb * 0.7, 0.9, Shape.Mote,
          )
        }
        break
      }
    }
  }
}

export { STORE_KEY }
