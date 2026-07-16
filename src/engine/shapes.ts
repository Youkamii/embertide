/**
 * 절차적 스프라이트 아틀라스.
 *
 * 이 게임에는 이미지 파일이 하나도 없다. 모든 모양은 부팅 때 SDF 셰이더로 한 번 구워서
 * 512x512 아틀라스 텍스처에 넣고, 이후 렌더는 텍스처 샘플 1회로 끝난다.
 * (프래그먼트에서 모양별로 분기하면 워프가 갈라져 수만 인스턴스에서 비싸진다.)
 */
import { createFullscreenTriangle, createProgram, GLError, type GL } from './gl'

export const ATLAS_SIZE = 512
export const ATLAS_COLS = 4
export const CELL_PX = ATLAS_SIZE / ATLAS_COLS // 128

/** 아틀라스 셀 인덱스. 렌더러의 shape 값이 곧 이것이다. */
export const Shape = {
  Orb: 0, // 부드러운 발광 구 — 투사체, 픽업, 불씨
  Ring: 1, // 링 — 오라, 충격파, 폭발 테두리
  Mote: 2, // 다이아 — 잔챙이 군체
  Husk: 3, // 삼각 — 돌진체 (진행 방향으로 회전)
  Spark: 4, // 길쭉한 섬광 — 파티클, 잔상
  Hex: 5, // 육각 — 정예/탱커
  Star: 6, // 별 — 레벨업, 희귀 픽업
  Blade: 7, // 초승달 — 근접 휘두르기
  Bolt: 8, // 번개 조각 — 체인 라이트닝
  Smoke: 9, // 뭉게진 노이즈 구름 — 잔해, 연기
  Crack: 10, // 갈라진 균열 — 지형 파괴 파편
  Eye: 11, // 동공 — 보스/엘리트
} as const
export type ShapeId = (typeof Shape)[keyof typeof Shape]

const BAKE_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

// 각 셀 안에서 p 는 -1..1. 셀 경계에 번짐이 새지 않도록 안쪽 0.86 반경까지만 그린다.
const BAKE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform float u_cols;

const float PI = 3.14159265359;

float sdCircle(vec2 p, float r) { return length(p) - r; }

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdEquilateral(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

float sdRhombus(vec2 p, vec2 b) {
  p = abs(p);
  float h = clamp((-2.0 * (p.x * b.x - p.y * b.y) + b.x * b.x - b.y * b.y) / dot(b, b), -1.0, 1.0);
  float d = length(p - 0.5 * b * vec2(1.0 - h, 1.0 + h));
  return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);
}

float sdHexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

float sdStar(vec2 p, float r, float rf) {
  const int n = 5;
  float m = float(n) + rf;
  float an = PI / float(n);
  float en = PI / m;
  vec2 acs = vec2(cos(an), sin(an));
  vec2 ecs = vec2(cos(en), sin(en));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
  return length(p) * sign(p.x);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// 값 노이즈 — 연기/균열의 불규칙함용. 결정적이어야 하므로 시간 입력 없음.
float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
    mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x),
    u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * valueNoise(p); p *= 2.0; a *= 0.5; }
  return v;
}

// SDF -> 알파. w 는 안티에일리어싱 폭(셀 픽셀 기준).
float fill(float d, float w) { return 1.0 - smoothstep(-w, w, d); }

float shapeAlpha(int id, vec2 p, float w) {
  // Orb: 코어 + 넓은 헤일로. 이 게임에서 제일 많이 쓰이므로 가장 공들인다.
  if (id == 0) {
    float core = fill(sdCircle(p, 0.34), w);
    float halo = pow(clamp(1.0 - length(p) / 0.86, 0.0, 1.0), 2.2);
    return clamp(core + halo * 0.85, 0.0, 1.0);
  }
  // Ring
  if (id == 1) {
    float d = abs(sdCircle(p, 0.66)) - 0.075;
    float edge = fill(d, w);
    float inner = pow(clamp(1.0 - abs(length(p) - 0.66) / 0.3, 0.0, 1.0), 3.0);
    return clamp(edge + inner * 0.4, 0.0, 1.0);
  }
  // Mote: 마름모 + 은은한 글로우
  if (id == 2) {
    float d = sdRhombus(p, vec2(0.42, 0.68));
    float body = fill(d, w);
    float glow = pow(clamp(1.0 - length(p) / 0.9, 0.0, 1.0), 3.0);
    return clamp(body + glow * 0.5, 0.0, 1.0);
  }
  // Husk: 진행 방향(+X)을 향한 삼각형. 회전은 인스턴스가 준다.
  if (id == 3) {
    vec2 q = vec2(-p.y, p.x); // +X 를 향하도록 회전
    float d = sdEquilateral(q, 0.5);
    float body = fill(d, w);
    float rim = fill(abs(d) - 0.05, w) * 0.7; // 밝은 테두리
    return clamp(body * 0.75 + rim, 0.0, 1.0);
  }
  // Spark: 가로로 길쭉한 섬광
  if (id == 4) {
    float d = sdSegment(p, vec2(-0.6, 0.0), vec2(0.6, 0.0)) - 0.06;
    float body = fill(d, w);
    float glow = pow(clamp(1.0 - length(p * vec2(0.7, 2.4)), 0.0, 1.0), 2.0);
    return clamp(body + glow * 0.6, 0.0, 1.0);
  }
  // Hex: 속이 빈 육각 + 코어
  if (id == 5) {
    float d = sdHexagon(p, 0.62);
    float shell = fill(abs(d) - 0.08, w);
    float core = fill(sdHexagon(p, 0.28), w) * 0.55;
    return clamp(shell + core, 0.0, 1.0);
  }
  // Star
  if (id == 6) {
    float d = sdStar(p, 0.68, 2.2);
    float body = fill(d, w);
    float glow = pow(clamp(1.0 - length(p) / 0.9, 0.0, 1.0), 2.5);
    return clamp(body + glow * 0.55, 0.0, 1.0);
  }
  // Blade: 큰 원에서 작은 원을 빼서 만든 초승달
  if (id == 7) {
    float a = sdCircle(p - vec2(-0.06, 0.0), 0.7);
    float b = sdCircle(p - vec2(0.24, 0.0), 0.62);
    float d = max(a, -b);
    float body = fill(d, w);
    float rim = fill(abs(d) - 0.03, w) * 0.8;
    return clamp(body * 0.7 + rim, 0.0, 1.0);
  }
  // Bolt: 지그재그 번개
  if (id == 8) {
    vec2 pts[5] = vec2[5](
      vec2(-0.62, 0.55), vec2(-0.12, 0.16), vec2(-0.3, 0.0),
      vec2(0.28, -0.2), vec2(0.6, -0.6));
    float d = 1e9;
    for (int i = 0; i < 4; i++) d = min(d, sdSegment(p, pts[i], pts[i + 1]));
    d -= 0.055;
    float body = fill(d, w);
    float glow = fill(d - 0.12, w) * 0.45;
    return clamp(body + glow, 0.0, 1.0);
  }
  // Smoke: fbm 로 뭉갠 구름
  if (id == 9) {
    float n = fbm(p * 2.6 + 11.3);
    float d = sdCircle(p, 0.52 + (n - 0.5) * 0.42);
    float body = fill(d, w * 2.5);
    float falloff = pow(clamp(1.0 - length(p) / 0.92, 0.0, 1.0), 1.6);
    return clamp(body * falloff, 0.0, 1.0);
  }
  // Crack: 불규칙한 파편 조각
  if (id == 10) {
    float n = fbm(p * 4.0 + 3.7);
    float d = sdBox(p, vec2(0.34, 0.26) + (n - 0.5) * 0.3);
    return fill(d, w * 1.5) * 0.95;
  }
  // Eye: 흰자 + 동공
  if (id == 11) {
    float outer = fill(sdCircle(p, 0.62), w);
    float rim = fill(abs(sdCircle(p, 0.62)) - 0.06, w);
    float pupil = fill(sdRhombus(p, vec2(0.16, 0.44)), w);
    return clamp(outer * 0.25 + rim * 0.9 + pupil, 0.0, 1.0);
  }
  return 0.0;
}

void main() {
  vec2 cell = floor(v_uv * u_cols);
  int id = int(cell.y * u_cols + cell.x);
  vec2 local = fract(v_uv * u_cols) * 2.0 - 1.0; // 셀 안 좌표 -1..1
  float w = 2.0 * u_cols / 512.0 * 1.6;          // 대략 픽셀 1.6개 폭
  float a = shapeAlpha(id, local, w);
  // 셀 경계에서 번짐이 이웃 셀로 새지 않도록 잘라낸다.
  a *= 1.0 - smoothstep(0.88, 1.0, max(abs(local.x), abs(local.y)));
  fragColor = vec4(1.0, 1.0, 1.0, a);
}`

export interface Atlas {
  readonly tex: WebGLTexture
  readonly cols: number
}

/** 아틀라스를 한 번 굽는다. 부팅 때 1회만 호출. */
export function bakeAtlas(gl: GL): Atlas {
  const tex = gl.createTexture()
  if (!tex) throw new GLError('아틀라스 텍스처 생성 실패')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA8, ATLAS_SIZE, ATLAS_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null,
  )
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const fbo = gl.createFramebuffer()
  if (!fbo) throw new GLError('아틀라스 FBO 생성 실패')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new GLError('아틀라스 FBO 불완전')
  }

  const prog = createProgram(gl, BAKE_VS, BAKE_FS, 'atlas-bake')
  const tri = createFullscreenTriangle(gl)

  gl.viewport(0, 0, ATLAS_SIZE, ATLAS_SIZE)
  gl.disable(gl.BLEND)
  gl.useProgram(prog.handle)
  gl.uniform1f(prog.uniforms['u_cols']!, ATLAS_COLS)
  gl.bindVertexArray(tri)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.bindVertexArray(null)

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.deleteFramebuffer(fbo)
  gl.deleteProgram(prog.handle)
  gl.deleteVertexArray(tri)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return { tex, cols: ATLAS_COLS }
}
