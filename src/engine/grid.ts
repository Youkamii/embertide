/**
 * 균일 격자 공간 해시.
 *
 * 적이 2만 마리면 모든 쌍 비교는 2억 번이라 즉사한다. 매 프레임 카운팅 소트로
 * 격자를 다시 세우고(할당 0), 주변 셀만 본다.
 */
export class SpatialHash {
  readonly cellSize: number
  readonly cols: number
  readonly rows: number
  readonly minX: number
  readonly minY: number

  /** 셀별 시작 오프셋 (길이 cols*rows+1, prefix sum) */
  private readonly cellStart: Int32Array
  /** 카운팅 소트 작업용 커서 */
  private readonly cursor: Int32Array
  /** 셀 순으로 정렬된 엔티티 인덱스 */
  private items: Int32Array
  private capacity: number
  private built = 0

  constructor(worldMinX: number, worldMinY: number, worldW: number, worldH: number, cellSize: number, capacity: number) {
    this.cellSize = cellSize
    this.minX = worldMinX
    this.minY = worldMinY
    this.cols = Math.max(1, Math.ceil(worldW / cellSize))
    this.rows = Math.max(1, Math.ceil(worldH / cellSize))
    this.cellStart = new Int32Array(this.cols * this.rows + 1)
    this.cursor = new Int32Array(this.cols * this.rows)
    this.capacity = capacity
    this.items = new Int32Array(capacity)
  }

  private cellOf(x: number, y: number): number {
    let cx = ((x - this.minX) / this.cellSize) | 0
    let cy = ((y - this.minY) / this.cellSize) | 0
    if (cx < 0) cx = 0
    else if (cx >= this.cols) cx = this.cols - 1
    if (cy < 0) cy = 0
    else if (cy >= this.rows) cy = this.rows - 1
    return cy * this.cols + cx
  }

  /**
   * 살아있는 엔티티들로 격자를 다시 세운다.
   * alive[i] 가 0이면 건너뛴다. count 는 배열의 유효 길이.
   */
  build(xs: Float32Array, ys: Float32Array, alive: Uint8Array, count: number): void {
    if (count > this.capacity) {
      this.capacity = count
      this.items = new Int32Array(count)
    }
    const nCells = this.cols * this.rows
    const start = this.cellStart
    start.fill(0, 0, nCells + 1)

    // 1차: 셀별 개수 (start[c+1] 자리에 세어 두면 그대로 prefix sum 이 된다)
    for (let i = 0; i < count; i++) {
      if (alive[i] === 0) continue
      start[this.cellOf(xs[i]!, ys[i]!) + 1]!++
    }
    // 2차: 누적합
    for (let c = 0; c < nCells; c++) {
      start[c + 1]! += start[c]!
      this.cursor[c] = start[c]!
    }
    // 3차: 배치
    for (let i = 0; i < count; i++) {
      if (alive[i] === 0) continue
      const c = this.cellOf(xs[i]!, ys[i]!)
      this.items[this.cursor[c]!++] = i
    }
    this.built = start[nCells]!
  }

  /**
   * (x,y) 반경 r 안의 셀에 걸친 엔티티 인덱스를 out 에 채우고 개수를 반환한다.
   * 셀 단위 필터라 실제 거리는 호출자가 다시 확인해야 한다.
   */
  query(x: number, y: number, r: number, out: Int32Array): number {
    const cs = this.cellSize
    let cx0 = ((x - r - this.minX) / cs) | 0
    let cx1 = ((x + r - this.minX) / cs) | 0
    let cy0 = ((y - r - this.minY) / cs) | 0
    let cy1 = ((y + r - this.minY) / cs) | 0
    if (cx0 < 0) cx0 = 0
    if (cy0 < 0) cy0 = 0
    if (cx1 >= this.cols) cx1 = this.cols - 1
    if (cy1 >= this.rows) cy1 = this.rows - 1

    let n = 0
    const cap = out.length
    for (let cy = cy0; cy <= cy1; cy++) {
      const rowBase = cy * this.cols
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = rowBase + cx
        const s = this.cellStart[c]!
        const e = this.cellStart[c + 1]!
        for (let k = s; k < e; k++) {
          if (n >= cap) return n
          out[n++] = this.items[k]!
        }
      }
    }
    return n
  }

  // forEachNear(콜백 순회)가 있었지만 호출부 0 + query 와 9줄 복붙 + 클로저가
  // "할당 0" 원칙과 충돌해서 지웠다 (#9). 밀집 구간이 문제면 query 버퍼를 키운다.

  get size(): number {
    return this.built
  }
}
