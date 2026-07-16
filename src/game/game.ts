/**
 * 게임 루프 통합.
 *
 * 고정 타임스텝으로 시뮬레이션을 돌린다. 가변 dt 를 쓰면 프레임률에 따라
 * 밸런스가 달라지고, 협동에서 두 대의 결과가 갈린다.
 */
import { Camera } from '../engine/camera'
import { SpatialHash } from '../engine/grid'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { Rng } from '../engine/rng'
import { Shape } from '../engine/shapes'
import { burst, shockwave, spray, updateMotes } from './fx'
import { FOE_STATS, foeRotation, spawnRing, updateFoes } from './foes'
import { Player } from './player'
import { Drop, Drops, Foe, Foes, Motes, Shots, type FoeType } from './pools'

export const WORLD_R = 2600
export const RUN_SECONDS = 300

const MAX_FOES = 20000
const MAX_SHOTS = 4000
const MAX_MOTES = 24000
const MAX_DROPS = 3000

/** 시뮬레이션 고정 스텝 (초). 1/60. */
const STEP = 1 / 60
/** 한 프레임에 따라잡을 수 있는 최대 스텝 수. 탭 복귀 시 죽음의 나선을 막는다. */
const MAX_STEPS = 5

export const Phase = {
  Playing: 0,
  LevelUp: 1,
  Dead: 2,
  Won: 3,
} as const
export type PhaseType = (typeof Phase)[keyof typeof Phase]

export class Game {
  readonly player = new Player()
  readonly foes = new Foes(MAX_FOES)
  readonly shots = new Shots(MAX_SHOTS)
  readonly motes = new Motes(MAX_MOTES)
  readonly drops = new Drops(MAX_DROPS)
  readonly camera = new Camera()

  private readonly foeHash = new SpatialHash(-WORLD_R, -WORLD_R, WORLD_R * 2, WORLD_R * 2, 52, MAX_FOES)
  private rng = new Rng(1)
  private acc = 0
  private spawnTimer = 0
  private fireTimer = 0
  /** 관통탄이 같은 적을 반복 타격하는 걸 막는 단조 증가 스탬프 */
  private hitStamp = 1
  private readonly foeStamp = new Int32Array(MAX_FOES)
  private readonly queryBuf = new Int32Array(512)
  /** 한 스텝에 화상으로 죽는 적을 담는 버퍼 */
  private readonly deadBuf = new Int32Array(2048)

  phase: PhaseType = Phase.Playing
  elapsed = 0
  seed = 1
  /** 순수 연출용 시간 — 일시정지 중에도 흐른다 */
  visualTime = 0

  start(seed: number): void {
    this.seed = seed
    this.rng = new Rng(seed)
    this.player.reset()
    this.foes.clear()
    this.shots.clear()
    this.motes.clear()
    this.drops.clear()
    this.foeStamp.fill(0)
    this.hitStamp = 1
    this.acc = 0
    this.spawnTimer = 0
    this.fireTimer = 0
    this.elapsed = 0
    this.phase = Phase.Playing
    this.camera.x = 0
    this.camera.y = 0
    this.camera.viewHeight = 940
  }

  /** 프레임당 1회. 내부에서 고정 스텝으로 나눠 돈다. */
  update(input: Input, frameDt: number): void {
    this.visualTime += frameDt
    if (this.phase !== Phase.Playing) {
      // 죽거나 레벨업 창이 떠도 파티클은 계속 흐른다 (화면이 얼어붙으면 죽은 것처럼 보인다)
      updateMotes(this.motes, Math.min(frameDt, 0.05))
      this.camera.update(frameDt)
      // 피격 플래시 감쇠는 player.update() 안에 있는데 여기선 그걸 안 부른다.
      // 빼먹으면 죽는 순간의 1.0 이 박제돼 화면이 영원히 빨갛다.
      if (this.player.hurtFlash > 0) {
        this.player.hurtFlash = Math.max(0, this.player.hurtFlash - frameDt * 2.2)
      }
      return
    }

    this.acc += Math.min(frameDt, 0.25)
    let steps = 0
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.step(input, STEP)
      this.acc -= STEP
      steps++
    }
    if (steps === MAX_STEPS) this.acc = 0 // 밀린 건 버린다

    this.camera.follow(this.player.x, this.player.y, frameDt, 7.5)
    this.camera.update(frameDt)
  }

  private step(input: Input, dt: number): void {
    this.elapsed += dt

    this.player.update(input.move, dt, WORLD_R)

    const res = updateFoes(
      {
        foes: this.foes,
        hash: this.foeHash,
        playerX: this.player.x,
        playerY: this.player.y,
        dt,
        time: this.elapsed,
        worldR: WORLD_R,
        deadOut: this.deadBuf,
      },
      this.player.radius,
    )

    // 화상으로 쓰러진 적만 거둔다. 전체를 훑으면 후반에 매 스텝 2만 번이 그냥 낭비된다.
    for (let k = 0; k < res.deadCount; k++) this.killFoe(this.deadBuf[k]!)

    if (res.contactDamage > 0 && this.player.hurt(res.contactDamage * 2.2)) {
      this.camera.shake(9, 12)
    }
    if (!this.player.alive) {
      this.onDeath()
      return
    }

    this.fire(dt)
    this.updateShots(dt)
    this.updateDrops(dt)
    updateMotes(this.motes, dt)
    this.spawn(dt)

    if (this.elapsed >= RUN_SECONDS) {
      this.phase = Phase.Won
    }
  }

  // ── 스폰 ─────────────────────────────────────────────────────────────

  /**
   * 5분 곡선. 처음엔 숨을 주고, 갈수록 화면을 메운다.
   * 여기 숫자가 게임의 난이도 전부다 — #6에서 웨이브 스케줄로 뺀다.
   */
  private spawn(dt: number): void {
    const t = this.elapsed
    const progress = t / RUN_SECONDS

    // 초당 스폰 수 — 후반에 화면이 터지도록 지수적으로.
    // 상수항이 곧 "첫 30초의 밀도"다. 여기가 낮으면 시작이 허전해서 첫인상을 잃는다.
    const rate = 13 + progress * progress * 300 + progress * 70
    this.spawnTimer += dt * rate

    const hpScale = 1 + progress * 3.4

    while (this.spawnTimer >= 1) {
      this.spawnTimer -= 1
      if (this.foes.count >= MAX_FOES - 8) break

      const roll = this.rng.next()
      let type: FoeType = Foe.Mote
      if (progress > 0.62 && roll > 0.985) type = Foe.Eye
      else if (progress > 0.2 && roll > 0.9) type = Foe.Hex
      else if (progress > 0.1 && roll > 0.72) type = Foe.Wisp
      else if (progress > 0.05 && roll > 0.52) type = Foe.Husk

      // 카메라 밖에서 걸어 들어오게. 눈앞에 튀어나오면 피할 수 없어 불공정하다.
      spawnRing(
        this.foes, type,
        this.player.x, this.player.y,
        720, 1150,
        hpScale,
        () => this.rng.next(),
        WORLD_R,
      )
    }
  }

  /**
   * 성능 측정용 강제 스폰. headless(SwiftShader)로는 실성능을 잴 수 없어
   * 실기기에서 ?bench=10000 으로 열어 확인한다.
   */
  benchSpawn(n: number): void {
    for (let k = 0; k < n; k++) {
      if (this.foes.count >= MAX_FOES) break
      const type = (k % 5) as FoeType
      spawnRing(
        this.foes, type, this.player.x, this.player.y,
        120, WORLD_R * 0.92, 8,
        () => this.rng.next(), WORLD_R,
      )
    }
  }

  // ── 공격 ─────────────────────────────────────────────────────────────

  /** 기본 무기 하나. 무기 6종·시너지는 #5에서. */
  private fire(dt: number): void {
    this.fireTimer -= dt
    if (this.fireTimer > 0) return
    const s = this.player.stats
    this.fireTimer = 0.34 * s.cooldown

    const target = this.nearestFoe(this.player.x, this.player.y, 640)
    let dx: number
    let dy: number
    if (target >= 0) {
      dx = this.foes.x[target]! - this.player.x
      dy = this.foes.y[target]! - this.player.y
      const d = Math.hypot(dx, dy) || 1
      dx /= d
      dy /= d
    } else {
      dx = this.player.faceX
      dy = this.player.faceY
    }

    const count = 1 + Math.floor(s.multi)
    const speed = 620 * s.projSpeed
    const spread = count > 1 ? 0.22 : 0
    for (let k = 0; k < count; k++) {
      const off = count > 1 ? (k - (count - 1) * 0.5) * spread : 0
      const c = Math.cos(off)
      const sn = Math.sin(off)
      const vx = (dx * c - dy * sn) * speed
      const vy = (dx * sn + dy * c) * speed
      this.shots.spawn(
        this.player.x, this.player.y, vx, vy,
        1.1, 9 * s.damage, s.pierce, 7 * s.area,
        0, 0, this.rng.next(),
      )
    }
  }

  private nearestFoe(x: number, y: number, maxDist: number): number {
    const n = this.foeHash.query(x, y, maxDist, this.queryBuf)
    let best = -1
    let bestD = maxDist * maxDist
    for (let k = 0; k < n; k++) {
      const j = this.queryBuf[k]!
      const dx = this.foes.x[j]! - x
      const dy = this.foes.y[j]! - y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD) {
        bestD = d2
        best = j
      }
    }
    return best
  }

  private updateShots(dt: number): void {
    const shots = this.shots
    const foes = this.foes
    const high = shots.high

    for (let i = 0; i < high; i++) {
      if (shots.alive[i] === 0) continue
      const life = shots.life[i]! - dt
      if (life <= 0) {
        shots.kill(i)
        continue
      }
      shots.life[i] = life

      const x = shots.x[i]! + shots.vx[i]! * dt
      const y = shots.y[i]! + shots.vy[i]! * dt
      shots.x[i] = x
      shots.y[i] = y

      // 명중 판정 — 이 탄이 이번에 때린 적을 표시하는 스탬프
      const stamp = ++this.hitStamp
      const r = shots.radius[i]!
      const n = this.foeHash.query(x, y, r + 30, this.queryBuf)
      for (let k = 0; k < n; k++) {
        const j = this.queryBuf[k]!
        if (foes.alive[j] === 0) continue
        if (this.foeStamp[j] === stamp) continue
        const stat = FOE_STATS[foes.type[j]!]!
        const dx = foes.x[j]! - x
        const dy = foes.y[j]! - y
        const rr = r + stat.radius
        if (dx * dx + dy * dy > rr * rr) continue

        this.foeStamp[j] = stamp
        this.damageFoe(j, shots.damage[i]!, shots.vx[i]!, shots.vy[i]!)

        if (shots.pierce[i]! <= 0) {
          spray(this.motes, x, y, -shots.vx[i]!, -shots.vy[i]!, 1.6, 4, 2.4, 1.7, 0.6, 190, 0.22, 3)
          shots.kill(i)
          break
        }
        shots.pierce[i]!--
      }
    }
  }

  /** 피해 적용 + 죽으면 보상·연출. 무기 코드가 공유하는 유일한 입구. */
  damageFoe(j: number, damage: number, fromVx: number, fromVy: number): void {
    const foes = this.foes
    const s = this.player.stats
    let dmg = damage
    if (this.rng.next() < s.critChance) dmg *= s.critMult

    foes.hp[j]! -= dmg
    foes.flash[j] = 0.09
    this.player.damageDealt += dmg

    // 넉백 — 무게가 무거울수록 덜 밀린다
    const stat = FOE_STATS[foes.type[j]!]!
    const kb = 240 * s.knockback * stat.weight
    const len = Math.hypot(fromVx, fromVy) || 1
    foes.pushX[j]! += (fromVx / len) * kb
    foes.pushY[j]! += (fromVy / len) * kb

    if (foes.hp[j]! <= 0) this.killFoe(j)
  }

  private killFoe(j: number): void {
    const foes = this.foes
    const stat = FOE_STATS[foes.type[j]!]!
    const x = foes.x[j]!
    const y = foes.y[j]!

    // 화면에 2만 마리가 죽는 후반에 파티클을 그대로 뿌리면 풀이 순식간에 마른다.
    // 큰 적일수록 많이, 잔챙이는 적게.
    const n = stat.radius > 16 ? 14 : 5
    burst(this.motes, x, y, n, stat.r, stat.g, stat.b, 210, 0.34, 4)
    if (stat.radius > 16) shockwave(this.motes, x, y, stat.radius * 2.2, stat.r, stat.g, stat.b, 0.3)

    this.drops.spawn(
      x, y,
      (this.rng.next() - 0.5) * 60, (this.rng.next() - 0.5) * 60,
      stat.xp, Drop.Xp,
    )
    // 회복은 드물어야 긴장이 산다
    if (this.rng.next() < 0.006) this.drops.spawn(x, y, 0, 0, 22, Drop.Heal)

    foes.kill(j)
    this.player.kills++
  }

  // ── 드랍 ─────────────────────────────────────────────────────────────

  private updateDrops(dt: number): void {
    const drops = this.drops
    const p = this.player
    const magnet = p.stats.magnet
    const magnet2 = magnet * magnet
    const pickup2 = (p.radius + 12) * (p.radius + 12)
    let leveled = false

    for (let i = 0; i < drops.high; i++) {
      if (drops.alive[i] === 0) continue
      drops.age[i]! += dt

      const dx = p.x - drops.x[i]!
      const dy = p.y - drops.y[i]!
      const d2 = dx * dx + dy * dy

      if (drops.pulled[i] === 0 && d2 < magnet2) drops.pulled[i] = 1

      if (drops.pulled[i] === 1) {
        // 가까울수록 빨라진다 — 빨려 들어가는 손맛
        const d = Math.sqrt(d2) || 1
        const pull = 340 + (1 - Math.min(1, d / magnet)) * 900
        drops.vx[i]! += (dx / d) * pull * dt
        drops.vy[i]! += (dy / d) * pull * dt
      }

      const drag = Math.exp(-3.4 * dt)
      drops.vx[i]! *= drag
      drops.vy[i]! *= drag
      drops.x[i]! += drops.vx[i]! * dt
      drops.y[i]! += drops.vy[i]! * dt

      if (d2 < pickup2) {
        const type = drops.type[i]!
        if (type === Drop.Xp) {
          if (p.gainXp(drops.value[i]!)) leveled = true
        } else if (type === Drop.Heal) {
          p.heal(drops.value[i]!)
          shockwave(this.motes, p.x, p.y, 40, 0.4, 2.4, 1.0, 0.35)
        }
        drops.kill(i)
      }
    }

    if (leveled) {
      this.phase = Phase.LevelUp
      shockwave(this.motes, p.x, p.y, 70, 2.6, 2.2, 0.8, 0.5)
      burst(this.motes, p.x, p.y, 26, 2.6, 2.1, 0.7, 300, 0.7, 6, Shape.Star)
      this.camera.shake(5, 14)
    }
  }

  private onDeath(): void {
    this.phase = Phase.Dead
    burst(this.motes, this.player.x, this.player.y, 90, 2.6, 0.5, 0.3, 420, 1.2, 9)
    shockwave(this.motes, this.player.x, this.player.y, 180, 2.6, 0.4, 0.3, 0.9)
    this.camera.shake(26, 5)
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────

  render(renderer: Renderer): void {
    const cam = this.camera
    const view = cam.toView(renderer.width, renderer.height)
    renderer.begin(view)

    const b = renderer.batch
    const t = this.visualTime
    const cullR = cam.visibleRadius(renderer.width, renderer.height)
    const cullR2 = cullR * cullR
    const cx = cam.x
    const cy = cam.y

    // 월드 경계 — 벽처럼 보여야 한다.
    // 원 전체를 균등 분할하면 반경 2600에서 조각 간격이 170px 라 점선이 된다.
    // 카메라 쪽 호(arc)만 촘촘히 그린다.
    const camDist = Math.hypot(cx, cy)
    if (camDist + cullR > WORLD_R * 0.94) {
      const camAngle = Math.atan2(cy, cx)
      const span = Math.asin(Math.min(1, cullR / WORLD_R)) * 1.5 + 0.06
      const steps = 72
      for (let k = 0; k <= steps; k++) {
        const a = camAngle - span + (k / steps) * span * 2
        const x = Math.cos(a) * WORLD_R
        const y = Math.sin(a) * WORLD_R
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy > cullR2 * 1.5) continue
        const pulse = 0.75 + Math.sin(t * 2.4 + a * 9) * 0.3
        b.push(x, y, 34, a, 1.5 * pulse, 0.3 * pulse, 0.5 * pulse, 1, Shape.Orb)
      }
    }

    // 드랍
    const drops = this.drops
    for (let i = 0; i < drops.high; i++) {
      if (drops.alive[i] === 0) continue
      const x = drops.x[i]!
      const y = drops.y[i]!
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > cullR2) continue
      const type = drops.type[i]!
      const bob = 1 + Math.sin(t * 7 + drops.age[i]! * 4) * 0.16
      if (type === Drop.Xp) {
        b.push(x, y, 7.5 * bob, t * 2, 0.5, 2.3, 2.8, 1, Shape.Orb)
      } else if (type === Drop.Heal) {
        b.push(x, y, 12 * bob, t * 1.4, 0.5, 2.8, 1.2, 1, Shape.Star)
      }
    }

    // 적
    const foes = this.foes
    for (let i = 0; i < foes.high; i++) {
      if (foes.alive[i] === 0) continue
      const x = foes.x[i]!
      const y = foes.y[i]!
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > cullR2) continue

      const stat = FOE_STATS[foes.type[i]!]!
      const flash = foes.flash[i]!
      // 맞은 순간 하얗게 뜬다. 이거 하나로 타격감이 산다.
      const hit = flash > 0 ? 1 + flash * 26 : 1
      const hpFrac = foes.hp[i]! / foes.maxHp[i]!
      // 피가 닳으면 어두워진다 — 체력바 없이 상태를 읽게
      const dim = 0.45 + hpFrac * 0.55
      b.push(
        x, y, stat.radius, foeRotation(foes, i, t),
        stat.r * hit * dim, stat.g * hit * dim, stat.b * hit * dim, 1,
        stat.shape,
      )
    }

    // 탄
    const shots = this.shots
    for (let i = 0; i < shots.high; i++) {
      if (shots.alive[i] === 0) continue
      const x = shots.x[i]!
      const y = shots.y[i]!
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > cullR2) continue
      const rot = Math.atan2(shots.vy[i]!, shots.vx[i]!)
      b.push(x, y, shots.radius[i]! * 2.4, rot, 3.0, 2.2, 0.9, 1, Shape.Spark)
      b.push(x, y, shots.radius[i]!, rot, 3.4, 2.9, 1.8, 1, Shape.Orb)
    }

    // 파티클
    const motes = this.motes
    for (let i = 0; i < motes.high; i++) {
      if (motes.alive[i] === 0) continue
      const x = motes.x[i]!
      const y = motes.y[i]!
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > cullR2) continue
      const frac = motes.life[i]! / motes.maxLife[i]!
      const shape = motes.shape[i]!
      // 링은 커지며 사라지고, 나머지는 작아지며 사라진다
      const size = shape === Shape.Ring ? motes.size[i]! * (2 - frac) : motes.size[i]! * frac
      b.push(
        x, y, size, motes.rot[i]!,
        motes.r[i]! * frac, motes.g[i]! * frac, motes.b[i]! * frac, frac,
        shape,
      )
    }

    // 플레이어 — 마지막에 그려서 무슨 일이 있어도 자기 캐릭터는 보이게
    const p = this.player
    if (p.alive) {
      const inv = p.invuln > 0 ? 0.45 + Math.sin(t * 40) * 0.3 : 1
      b.push(p.x, p.y, 30, -t * 0.9, 0.9 * inv, 1.5 * inv, 2.8 * inv, 1, Shape.Ring)
      b.push(p.x, p.y, 15, t * 2.2, 2.6 * inv, 2.2 * inv, 3.4 * inv, 1, Shape.Orb)
    }

    renderer.end(t, p.hurtFlash)
  }
}
