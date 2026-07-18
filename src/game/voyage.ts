/**
 * 검은 입 — 우주를 삼키는 탐험. 씨앗: "우주 탐험" + "스스로 블랙홀이 되어,
 * 커질수록 더 큰 우주를 집어삼킨다" (사용자, 2026-07-18).
 *
 * 지키는 문장은 하나다: **나는 블랙홀이다. 삼키면 커지고, 커지면 어제 못 삼키던
 * 것을 삼킨다.** 이 문장 밖의 시스템은 없다 — 적도, 점수도, 타이머도, 죽음도 없다.
 *
 * 순간 루프: 내 크기(0.8배 미만)의 천체 곁을 지나면 나선을 그리며 빨려 들어온다 →
 * 부피가 붙고, 화면이 아주 조금 물러난다 → 어제 나를 내던지던 태양이 어느 순간
 * 조용히 내 쪽으로 기울기 시작한다 — 그 순간이 이 게임의 전부다.
 * 멀리 갈수록 천체가 크다: 성장하려면 떠나야 한다. 삼킨 것은 이름과 함께
 * 명부(일지)에 영원히 남는다. localStorage — 항해는 세션을 넘어 이어진다.
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

export const BodyKind = {
  Dust: 0, // 티끌 — 첫 끼니
  Comet: 1, // 혜성
  Ringed: 2, // 고리 행성
  Sun: 3, // 항성 — 한때는 나를 내던지던 것
  Garden: 4, // 성운 정원
  Core: 5, // 은하심(銀河心) — 아주 멀리서만. 최후의 식사
} as const
export type BodyKindType = (typeof BodyKind)[keyof typeof BodyKind]

export interface Body {
  readonly id: number
  readonly kind: BodyKindType
  readonly x: number
  readonly y: number
  readonly r: number
  readonly seed: number
  readonly cr: number
  readonly cg: number
  readonly cb: number
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
  { r: 16, name: '검은 입' },
  { r: 44, name: '혜성을 삼키는 것' },
  { r: 110, name: '행성 사냥꾼' },
  { r: 260, name: '별을 삼키는 자' },
  { r: 620, name: '성단의 공포' },
  { r: 1500, name: '은하의 아귀' },
]

export function rankOf(radius: number): string {
  let name = RANKS[0]!.name
  for (const rk of RANKS) if (radius >= rk.r) name = rk.name
  return name
}

/**
 * 라이벌 — 움직이는 유일한 존재, 다른 검은 입.
 * 나보다 작으면 도망치는 최고의 먹이(추격전), 나보다 크면 나를 사냥한다.
 * 물리면 부피의 26%를 뜯기고 내던져진다 — 상실은 있어도 끝은 없다.
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

export class Voyage {
  // ── 나 — 검은 입
  x = 0
  y = 600
  vx = 0
  vy = 0
  heading = 0
  /** 부피 — 삼킨 모든 것의 합. 반지름은 세제곱근으로 자란다 (초반 급성장, 후반 묵직). */
  vol = 340
  thrusting = false

  // ── 세계
  private readonly sectors = new Map<string, Body[]>()
  readonly active: Body[] = []
  private activeKey = ''
  /** 삼켜진 천체 — 우주에 실제로 구멍이 남는다 (영속) */
  private readonly eaten = new Set<number>()

  // ── 포식 (짧은 나선 — 스파게티화 연출 시간)
  absorbing: Body | null = null
  absorbT = 0

  lastFound: JournalEntry | null = null
  readonly journal: JournalEntry[] = []
  farthest = 0
  /** 가장 큰 한 입 (반지름) — 명부의 자랑거리 */
  biggestMeal = 0
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
  /** 라이벌에게 물린 직후 무적 (연속 강탈 방지) */
  private bittenCd = 0

  get radius(): number {
    return Math.cbrt(this.vol)
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
    this.vol = 340 // 반지름 ~7 — 티끌보다 조금 큰 무엇
    this.journal.length = 0
    this.eaten.clear()
    this.farthest = 0
    this.lastFound = null
    this.absorbing = null
    this.absorbT = 0
    this.sectors.clear()
    this.activeKey = ''
    this.rivals.length = 0
    this.rankUp = null
    this.gulp = 0
    this.bittenCd = 0
    this.biggestMeal = 0
    if (store) {
      try {
        const raw = store.load()
        if (raw) {
          const d = JSON.parse(raw) as {
            vol?: number
            eaten?: number[]
            journal?: JournalEntry[]
            farthest?: number
            biggestMeal?: number
          }
          if (d.vol && d.vol > this.vol) this.vol = d.vol
          for (const id of d.eaten ?? []) this.eaten.add(id)
          for (const e of d.journal ?? []) this.journal.push(e)
          this.farthest = d.farthest ?? 0
          this.biggestMeal = d.biggestMeal ?? 0
        }
      } catch {
        // 깨진 저장은 조용히 새 항해로 — 우주는 그대로다
      }
    }
    this.lastRank = rankOf(this.radius)
    this.camera.x = this.x
    this.camera.y = this.y
    this.camera.viewHeight = Math.max(1100, this.radius * 30)
    this.refreshSectors(true)
  }

  private persist(): void {
    if (!this.store) return
    try {
      this.store.save(JSON.stringify({
        vol: this.vol,
        eaten: [...this.eaten].slice(-4000),
        journal: this.journal.slice(-300),
        farthest: this.farthest,
        biggestMeal: this.biggestMeal,
      }))
    } catch {
      // 저장 실패는 항해를 막지 않는다
    }
  }

  // ── 우주 생성 — 좌표 해시가 시드다. 멀수록 크다: 성장하려면 떠나야 한다.

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
    const n = 2 + rng.int(3)
    for (let k = 0; k < n; k++) {
      const bx = sx * SECTOR + (0.1 + rng.next() * 0.8) * SECTOR
      const by = sy * SECTOR + (0.1 + rng.next() * 0.8) * SECTOR
      const bSeed = hashSeed(`${seed}:${k}`)
      const roll = rng.next()
      let kind: BodyKindType
      let r: number
      if (roll < 0.34) {
        kind = BodyKind.Dust
        r = (5 + rng.next() * 7) * Math.sqrt(scale)
      } else if (roll < 0.55) {
        kind = BodyKind.Comet
        r = (14 + rng.next() * 12) * Math.sqrt(scale)
      } else if (roll < 0.76) {
        kind = BodyKind.Ringed
        r = (30 + rng.next() * 28) * scale * 0.7
      } else if (roll < 0.9) {
        kind = BodyKind.Sun
        r = (70 + rng.next() * 60) * scale * 0.8
      } else if (dist >= 5 && roll < 0.97) {
        kind = BodyKind.Garden
        r = (120 + rng.next() * 90) * scale * 0.7
      } else if (dist >= 9) {
        kind = BodyKind.Core
        r = (300 + rng.next() * 240) * scale * 0.8
      } else {
        kind = BodyKind.Ringed
        r = (34 + rng.next() * 20) * scale * 0.7
      }
      const hue = rng.next()
      list.push({
        id: bSeed,
        kind,
        x: bx,
        y: by,
        r,
        seed: bSeed,
        cr: 0.45 + hue * 0.6,
        cg: 0.35 + (1 - hue) * 0.5,
        cb: 0.5 + Math.abs(0.5 - hue),
      })
    }
    // 소행성 벨트 — 티끌이 호를 따라 줄지어 있다. 헤치고 지나가면 우수수
    // 삼켜지는 "훑어먹기"가 이 게임의 군것질이다.
    if (rng.next() < 0.4) {
      const ax = sx * SECTOR + rng.next() * SECTOR
      const ay = sy * SECTOR + rng.next() * SECTOR
      const arcR = 320 + rng.next() * 520
      const a0 = rng.next() * Math.PI * 2
      const span = 1.3 + rng.next() * 1.7
      const cnt = 10 + rng.int(7)
      for (let k = 0; k < cnt; k++) {
        const a = a0 + (k / cnt) * span
        const bSeed = hashSeed(`${seed}:belt:${k}`)
        list.push({
          id: bSeed,
          kind: BodyKind.Dust,
          x: ax + Math.cos(a) * arcR,
          y: ay + Math.sin(a) * arcR * 0.7,
          r: (4.5 + ((bSeed >>> 4) % 100) * 0.06) * Math.sqrt(scale),
          seed: bSeed,
          cr: 0.5, cg: 0.48, cb: 0.55,
        })
      }
    }
    // 성단 — 먼 우주의 장관: 태양 셋이 어깨를 맞댄다. 언젠가 셋 다 삼킨다.
    if (dist >= 6 && rng.next() < 0.18) {
      const cx0 = sx * SECTOR + rng.next() * SECTOR
      const cy0 = sy * SECTOR + rng.next() * SECTOR
      for (let k = 0; k < 3; k++) {
        const bSeed = hashSeed(`${seed}:cl:${k}`)
        const a = (k / 3) * Math.PI * 2
        const hue = ((bSeed >>> 3) % 100) / 100
        const r = (60 + ((bSeed >>> 6) % 60)) * scale * 0.7
        list.push({
          id: bSeed, kind: BodyKind.Sun,
          x: cx0 + Math.cos(a) * r * 2.6, y: cy0 + Math.sin(a) * r * 2.6,
          r, seed: bSeed,
          cr: 0.5 + hue * 0.5, cg: 0.4 + (1 - hue) * 0.4, cb: 0.35,
        })
      }
    }
    this.sectors.set(key, list)
    if (this.sectors.size > 64) {
      const cx = Math.floor(this.x / SECTOR)
      const cy = Math.floor(this.y / SECTOR)
      for (const [k] of this.sectors) {
        const [ax, ay] = k.split(',').map(Number)
        if (Math.abs(ax! - cx) > 3 || Math.abs(ay! - cy) > 3) this.sectors.delete(k)
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

    // 중력 — **나보다 큰 것만** 나를 끈다. 내가 크면 세계가 조용해진다:
    // 어제 나를 내던지던 태양이 오늘은 아무 힘도 못 쓴다. 성장이 곧 지형 변화다.
    for (const b of this.active) {
      if (b.r <= R) continue
      const dx = b.x - this.x
      const dy = b.y - this.y
      const d2 = dx * dx + dy * dy
      const d = Math.sqrt(d2) || 1
      if (d > b.r * 9) continue
      const g = Math.min(340, (b.r * b.r * 3.2) / d2 * 60)
      this.vx += (dx / d) * g * step
      this.vy += (dy / d) * g * step
    }

    this.x += this.vx * step
    this.y += this.vy * step
    this.refreshSectors()

    const dist = Math.hypot(this.x, this.y)
    if (dist > this.farthest) this.farthest = dist

    // 포식 — 내 입(반지름 1.6배) 안의 먹이는 나선을 그리며 들어온다.
    // 채널이 아니라 짧은 연출 시간(0.45s)이다: 스파게티화가 보여야 삼킨 맛이 난다.
    if (this.absorbing && (this.eaten.has(this.absorbing.id) || this.absorbT >= 1)) {
      this.absorbing = null
      this.absorbT = 0
    }
    if (!this.absorbing) {
      for (const b of this.active) {
        if (b.r >= R * EDIBLE) continue
        const d = Math.hypot(b.x - this.x, b.y - this.y)
        if (d < R * 1.6 + b.r) {
          this.absorbing = b
          this.absorbT = 0
          break
        }
      }
    }
    if (this.absorbing) {
      this.absorbT += step / 0.45
      if (this.absorbT >= 1) {
        const b = this.absorbing
        this.eaten.add(b.id)
        this.vol += b.r * b.r * b.r * 0.62
        this.gulp = Math.min(1, b.r / R + 0.25)
        if (b.r > this.biggestMeal) this.biggestMeal = Math.round(b.r)
        const entry: JournalEntry = {
          name: starName(b.seed),
          log: starLog(b.seed),
          kind: b.kind,
          r: Math.round(b.r),
          x: Math.round(b.x),
          y: Math.round(b.y),
        }
        this.journal.push(entry)
        this.lastFound = entry
        this.absorbing = null
        this.absorbT = 0
        this.refreshSectors(true)
        this.sfx(b.r > 60 ? 'evolve' : 'pickup')
        // 매 삼킴 저장 — 브라우저를 닫아도 마지막 한 입이 명부에 남아야 한다.
        // (몇 KB 문자열 저장은 프레임 예산에 안 잡힌다)
        this.persist()
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
          this.persist()
        } else if (!bigger && rr < R * EDIBLE) {
          // 동족을 삼킨다 — 가장 값진 식사
          this.vol += rv.vol * 0.85
          this.gulp = 1
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
          this.rivals.splice(i, 1)
          this.sfx('evolve')
          this.persist()
        }
      }
    }
    this.gulp = Math.max(0, this.gulp - step * 2.2)

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

  // ── 렌더 — 나는 빛이 아니라 빛의 부재다.

  render(renderer: Renderer): void {
    const cam = this.camera
    const view = cam.toView(renderer.width, renderer.height)
    const t = this.visualTime
    renderer.cosmos.holeR = 0
    renderer.cosmos.intensity = 0.35
    renderer.begin(view, t)
    const b = renderer.batch
    const cullR = cam.visibleRadius(renderer.width, renderer.height)
    const R = this.radius

    for (const body of this.active) {
      const dx = body.x - cam.x
      const dy = body.y - cam.y
      const margin = cullR + body.r * 4
      if (dx * dx + dy * dy > margin * margin) continue
      if (this.absorbing?.id === body.id) {
        this.renderAbsorbing(b, body, t)
      } else {
        this.renderBody(b, body, t, R)
      }
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

    // 나 — 검은 원반(그림자 패스: 가법 세계에서 유일하게 어두울 수 있는 존재) +
    // 광자 고리 + 도는 강착 소용돌이. 클수록 고리가 넓어지고, 삼키면 출렁인다(gulp).
    const gp = 1 + this.gulp * 0.22
    renderer.shadows.push(this.x, this.y, R * 1.06, 0, 0, 0, 0, 0.96, Shape.Orb)
    b.push(this.x, this.y, R * 1.16 * gp, t * 0.4, 1.6, 1.25, 0.8, 1, Shape.Ring)
    b.push(this.x, this.y, R * 1.7 * gp, -t * 0.22, 0.35, 0.14, 0.4, 0.8, Shape.Vortex)
    if (this.thrusting) {
      b.push(
        this.x - Math.cos(this.heading) * R * 1.5, this.y - Math.sin(this.heading) * R * 1.5,
        R * 0.5, this.heading, 0.9, 0.5, 0.25, 0.7, Shape.Spark,
      )
    }

    renderer.end(t, 0, 0, 1)
  }

  /** 삼켜지는 중 — 나선을 그리며 늘어나다 사라진다 (스파게티화). */
  private renderAbsorbing(b: Renderer['batch'], body: Body, _t: number): void {
    const k = this.absorbT
    const ang = Math.atan2(body.y - this.y, body.x - this.x) + k * 2.6
    const d = Math.hypot(body.x - this.x, body.y - this.y) * (1 - k)
    const bx = this.x + Math.cos(ang) * d
    const by = this.y + Math.sin(ang) * d
    // 늘어난다 — 원이 실이 되어 들어온다
    b.push(
      bx, by, body.r * (1 - k * 0.7), ang + Math.PI / 2,
      body.cr * (1 + k), body.cg * (1 + k * 0.6), body.cb, 1 - k * 0.4,
      k > 0.5 ? Shape.Spark : Shape.Orb,
    )
  }

  private renderBody(b: Renderer['batch'], body: Body, t: number, myR: number): void {
    const { x, y, r, cr, cg, cb } = body
    const s = body.seed % 6.283
    // 먹이는 아주 옅은 테가 두른다 — "이제 삼킬 수 있다"가 눈으로 읽힌다
    const edible = r < myR * EDIBLE
    if (edible) b.push(x, y, r * 1.5 + 12, t * 0.8, 0.4, 0.34, 0.16, 0.5, Shape.Ring)
    switch (body.kind) {
      case BodyKind.Dust:
        b.push(x, y, r, s + t * 0.3, cr * 0.5, cg * 0.5, cb * 0.55, 1, Shape.Mote)
        break
      case BodyKind.Comet: {
        b.push(x, y, r, s, 1.1, 1.0, 0.95, 1, Shape.Comet)
        for (let k = 1; k <= 10; k++) {
          b.push(
            x + k * r * 0.55, y + Math.sin(s + k) * 3, r * (1 - k / 12), 0,
            0.4 / k + 0.1, 0.4 / k + 0.12, 0.6 / k + 0.16, 0.8, Shape.Spark,
          )
        }
        break
      }
      case BodyKind.Ringed: {
        b.push(x, y, r, t * 0.04 + s, cr * 0.75, cg * 0.75, cb * 0.85, 1, Shape.Orb)
        for (let k = 0; k < 26; k++) {
          const a = (k / 26) * Math.PI * 2 + t * 0.1
          const rr = r * (1.6 + ((k * 0.618) % 1) * 0.5)
          b.push(
            x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.4, Math.max(2.5, r * 0.06), a,
            cr * 0.45, cg * 0.45, cb * 0.55, 1, Shape.Mote,
          )
        }
        break
      }
      case BodyKind.Sun: {
        const pulse = 1 + Math.sin(t * 0.7 + s) * 0.04
        b.push(x, y, r * 2.4 * pulse, 0, cr * 0.45, cg * 0.35, 0.08, 0.6, Shape.Orb)
        b.push(x, y, r * pulse, t * 0.08, 1.8, 1.35, 0.55, 1, Shape.Orb)
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
        // 은하심 — 나선팔이 도는 최후의 식사. 이걸 삼키는 날이 온다.
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
