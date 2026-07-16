/**
 * 연출 파티클 헬퍼.
 *
 * 전부 순수 연출이다 — 시뮬레이션에 영향을 주면 협동 동기화가 깨진다.
 * 그래서 여기서만 Math.random 을 써도 안전하다.
 */
import { Shape } from '../engine/shapes'
import type { Motes } from './pools'

/** 사방으로 터지는 기본 폭발. 적이 죽을 때마다 불린다 — 싸야 한다. */
export function burst(
  motes: Motes,
  x: number, y: number,
  count: number,
  r: number, g: number, b: number,
  speed: number,
  life: number,
  size: number,
  shape: number = Shape.Spark,
): void {
  for (let k = 0; k < count; k++) {
    const a = Math.random() * Math.PI * 2
    const s = speed * (0.35 + Math.random() * 0.9)
    motes.spawn(
      x, y,
      Math.cos(a) * s, Math.sin(a) * s,
      life * (0.6 + Math.random() * 0.7),
      size * (0.7 + Math.random() * 0.7),
      r, g, b,
      shape,
      (Math.random() - 0.5) * 14,
      a,
      2.6,
    )
  }
}

/** 한 방향으로 부채꼴. 명중 지점에서 튀는 불똥. */
export function spray(
  motes: Motes,
  x: number, y: number,
  dirX: number, dirY: number,
  spread: number,
  count: number,
  r: number, g: number, b: number,
  speed: number,
  life: number,
  size: number,
): void {
  const base = Math.atan2(dirY, dirX)
  for (let k = 0; k < count; k++) {
    const a = base + (Math.random() - 0.5) * spread
    const s = speed * (0.4 + Math.random() * 0.9)
    motes.spawn(
      x, y,
      Math.cos(a) * s, Math.sin(a) * s,
      life * (0.5 + Math.random() * 0.8),
      size * (0.6 + Math.random() * 0.8),
      r, g, b,
      Shape.Spark,
      (Math.random() - 0.5) * 10,
      a,
      3.4,
    )
  }
}

/** 팽창하는 충격파 링 하나. 폭발·레벨업·진화에 쓴다. */
export function shockwave(
  motes: Motes,
  x: number, y: number,
  size: number,
  r: number, g: number, b: number,
  life = 0.42,
): void {
  motes.spawn(x, y, 0, 0, life, size, r, g, b, Shape.Ring, 0, 0, 1)
}

/** 위로 떠오르며 사라지는 연기. 지형이 부서질 때. */
export function smoke(
  motes: Motes,
  x: number, y: number,
  count: number,
  r: number, g: number, b: number,
  size: number,
): void {
  for (let k = 0; k < count; k++) {
    const a = Math.random() * Math.PI * 2
    const s = 18 + Math.random() * 40
    motes.spawn(
      x + Math.cos(a) * 6, y + Math.sin(a) * 6,
      Math.cos(a) * s, Math.sin(a) * s + 22,
      0.7 + Math.random() * 0.8,
      size * (0.8 + Math.random() * 1.1),
      r, g, b,
      Shape.Smoke,
      (Math.random() - 0.5) * 2,
      Math.random() * 6.283,
      1.4,
    )
  }
}

/** 파티클 한 틱. 여기도 hot path 라 분기를 줄인다. */
export function updateMotes(motes: Motes, dt: number): void {
  const high = motes.high
  for (let i = 0; i < high; i++) {
    if (motes.alive[i] === 0) continue
    const life = motes.life[i]! - dt
    if (life <= 0) {
      motes.kill(i)
      continue
    }
    motes.life[i] = life
    const drag = Math.exp(-motes.drag[i]! * dt)
    motes.vx[i]! *= drag
    motes.vy[i]! *= drag
    motes.x[i]! += motes.vx[i]! * dt
    motes.y[i]! += motes.vy[i]! * dt
    motes.rot[i]! += motes.spin[i]! * dt
  }
}
