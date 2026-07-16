/**
 * 결정론적 난수.
 *
 * Math.random 을 쓰면 데일리 시드(같은 날 모두 같은 맵)도, 협동 동기화도 불가능하다.
 * 시뮬레이션에 영향을 주는 모든 난수는 반드시 이 클래스를 통한다.
 * (순수 연출용 난수는 Math.random 을 써도 되지만, 헷갈리느니 그냥 여기 쓴다.)
 */
export class Rng {
  private s: number

  constructor(seed: number) {
    // 0 시드는 mulberry32 를 죽이므로 밀어낸다.
    this.s = (seed >>> 0) || 0x9e3779b9
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [0, n) 정수 */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** [0, 2π) */
  angle(): number {
    return this.next() * Math.PI * 2
  }

  bool(p = 0.5): boolean {
    return this.next() < p
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!
  }

  /** 제자리 셔플 (Fisher–Yates) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1)
      const t = arr[i]!
      arr[i] = arr[j]!
      arr[j] = t
    }
    return arr
  }

  /** 가중치 추첨. weights 합이 0이면 -1. */
  weighted(weights: readonly number[]): number {
    let total = 0
    for (const w of weights) total += w
    if (total <= 0) return -1
    let r = this.next() * total
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!
      if (r < 0) return i
    }
    return weights.length - 1
  }

  /** 현재 상태 (협동 재현/디버그용) */
  get state(): number {
    return this.s
  }

  set state(v: number) {
    this.s = v >>> 0
  }
}

/** 문자열 → 32bit 시드 (FNV-1a). 데일리 시드를 날짜 문자열에서 뽑을 때 쓴다. */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** UTC 기준 오늘의 데일리 시드. 전 세계가 같은 맵을 받는다. */
export function dailySeed(now: Date): { seed: number; label: string } {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const label = `${y}-${m}-${d}`
  return { seed: hashSeed(`embertide:${label}`), label }
}
