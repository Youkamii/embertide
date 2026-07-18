/**
 * 카메라. 부드러운 추적 + 화면 흔들림 + 줌.
 *
 * 흔들림 원칙 (실플레이 "화면 움직이고 게임 불가" 이후 전면 개정):
 * **루틴 전투는 화면을 흔들지 않는다.** 무기 발사·명중·잡졸 폭발은 흔들림 0 이다 —
 * 초당 수십 번 일어나는 일이 화면을 밀면 그건 손맛이 아니라 멀미다.
 * 흔들림은 세리머니(보스 등장·진화·죽음)와 피격(정보)의 것이고, 그마저 상한이 있다.
 */
import type { View } from './batch'
import { Rng } from './rng'

/**
 * 디오라마 스쿼시 — 세로축을 12% 눌러 살짝 기울여 내려다보는 느낌을 만든다.
 * 순수 렌더 변환이라 판정·시뮬레이션과 무관하고, 원(그림자 포함)이 자연스럽게
 * 타원이 된다. 1.0 이면 완전 탑다운.
 */
const SQUASH = 0.88

export class Camera {
  x = 0
  y = 0
  /** 화면 짧은 축에 담을 월드 단위. 작을수록 확대. */
  viewHeight = 720

  private shakeAmp = 0
  private shakeDecay = 0
  private shakeX = 0
  private shakeY = 0
  private readonly rng = new Rng(0xc0ffee)
  private readonly view: View = { x: 0, y: 0, sx: 1, sy: 1 }

  /** 흔들림을 건다. 이미 흔들리는 중이면 더 센 쪽이 이긴다 (누적하면 화면이 미쳐 날뛴다). */
  shake(amplitude: number, decay = 9): void {
    // 절대 상한 9px — 어떤 세리머니도 화면을 이 이상 밀지 못한다.
    // 상한이 없던 시절 죽음(26)·보스(18)가 화면을 통째로 내던졌다.
    const amp = Math.min(9, amplitude)
    if (amp > this.shakeAmp) {
      this.shakeAmp = amp
      this.shakeDecay = decay
    }
  }

  /** 목표 지점으로 부드럽게 따라간다. dt 에 무관한 감쇠를 쓴다. */
  follow(targetX: number, targetY: number, dt: number, stiffness = 9): void {
    const t = 1 - Math.exp(-stiffness * dt)
    this.x += (targetX - this.x) * t
    this.y += (targetY - this.y) * t
  }

  update(dt: number): void {
    if (this.shakeAmp > 0.01) {
      this.shakeX = (this.rng.next() * 2 - 1) * this.shakeAmp
      this.shakeY = (this.rng.next() * 2 - 1) * this.shakeAmp
      this.shakeAmp *= Math.exp(-this.shakeDecay * dt)
    } else {
      this.shakeAmp = 0
      this.shakeX = 0
      this.shakeY = 0
    }
  }

  /**
   * 렌더용 View. 짧은 축을 viewHeight 에 맞추므로 세로 모니터든 울트라와이드든
   * 보이는 양이 공평하다(가로가 넓으면 좌우로 더 보일 뿐).
   */
  toView(screenW: number, screenH: number): View {
    const aspect = screenW / screenH
    const halfH = this.viewHeight * 0.5
    const halfW = halfH * aspect
    this.view.x = this.x + this.shakeX
    this.view.y = this.y + this.shakeY
    this.view.sx = 1 / halfW
    // 스쿼시만큼 세로 월드가 더 보인다 (halfH / SQUASH) — 컬링도 같이 커져야 한다
    this.view.sy = SQUASH / halfH
    return this.view
  }

  /** 화면 밖 컬링용 — 여유를 둔 가시 반경 */
  visibleRadius(screenW: number, screenH: number): number {
    const aspect = screenW / screenH
    const halfH = this.viewHeight * 0.5 / SQUASH
    const halfW = this.viewHeight * 0.5 * aspect
    return Math.hypot(halfW, halfH) * 1.12
  }

  // worldToScreen 이 있었지만 호출부 0 + 호출마다 객체 할당이라 지웠다 (#9).
}
