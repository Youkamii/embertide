/**
 * WebGL2 저수준 유틸. 여기 밖에서는 raw gl 호출을 최소화한다.
 */

export type GL = WebGL2RenderingContext

export class GLError extends Error {}

export function createContext(canvas: HTMLCanvasElement): GL {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    desynchronized: true,
  })
  if (!gl) {
    throw new GLError('이 브라우저는 WebGL2를 지원하지 않습니다.')
  }
  return gl
}

/**
 * float 렌더 타깃(HDR)이 가능한지. bloom 품질이 여기 달렸다.
 * 없으면 LDR(RGBA8)로 폴백하되 그림은 확연히 죽는다.
 */
export function detectFloatTargets(gl: GL): { half: boolean } {
  const cbf = gl.getExtension('EXT_color_buffer_float')
  const half = !!cbf || !!gl.getExtension('EXT_color_buffer_half_float')
  // linear(OES_texture_float_linear) 도 재서 반환했지만 읽는 곳이 없었다 (#9).
  return { half }
}

function compile(gl: GL, type: number, src: string, label: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new GLError(`셰이더 생성 실패: ${label}`)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '(no log)'
    gl.deleteShader(sh)
    throw new GLError(`셰이더 컴파일 실패 [${label}]\n${log}\n${numberLines(src)}`)
  }
  return sh
}

function numberLines(src: string): string {
  return src
    .split('\n')
    .map((l, i) => `${String(i + 1).padStart(3, ' ')}| ${l}`)
    .join('\n')
}

export interface Program {
  readonly handle: WebGLProgram
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation>>
  readonly attribs: Readonly<Record<string, number>>
}

export function createProgram(gl: GL, vsSrc: string, fsSrc: string, label = 'program'): Program {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, `${label}.vert`)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, `${label}.frag`)
  const handle = gl.createProgram()
  if (!handle) throw new GLError(`프로그램 생성 실패: ${label}`)
  gl.attachShader(handle, vs)
  gl.attachShader(handle, fs)
  gl.linkProgram(handle)
  // 링크가 끝나면 셰이더 객체는 프로그램이 참조를 쥐므로 삭제해도 된다.
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(handle) ?? '(no log)'
    gl.deleteProgram(handle)
    throw new GLError(`프로그램 링크 실패 [${label}]\n${log}`)
  }

  const uniforms: Record<string, WebGLUniformLocation> = {}
  const uCount = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < uCount; i++) {
    const info = gl.getActiveUniform(handle, i)
    if (!info) continue
    // 배열 유니폼은 "name[0]" 으로 잡히므로 기본 이름으로도 등록해 둔다.
    const base = info.name.replace(/\[0\]$/, '')
    const loc = gl.getUniformLocation(handle, info.name)
    if (loc) uniforms[base] = loc
  }

  const attribs: Record<string, number> = {}
  const aCount = gl.getProgramParameter(handle, gl.ACTIVE_ATTRIBUTES) as number
  for (let i = 0; i < aCount; i++) {
    const info = gl.getActiveAttrib(handle, i)
    if (!info) continue
    attribs[info.name] = gl.getAttribLocation(handle, info.name)
  }

  return { handle, uniforms, attribs }
}

export interface RenderTarget {
  readonly fbo: WebGLFramebuffer
  readonly tex: WebGLTexture
  width: number
  height: number
}

export function createRenderTarget(
  gl: GL,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
  filter: number,
): RenderTarget {
  const tex = gl.createTexture()
  if (!tex) throw new GLError('렌더 타깃 텍스처 생성 실패')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const fbo = gl.createFramebuffer()
  if (!fbo) throw new GLError('렌더 타깃 FBO 생성 실패')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new GLError(`FBO 불완전: 0x${status.toString(16)}`)
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return { fbo, tex, width, height }
}

export function resizeRenderTarget(
  gl: GL,
  rt: RenderTarget,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
): void {
  if (rt.width === width && rt.height === height) return
  gl.bindTexture(gl.TEXTURE_2D, rt.tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null)
  gl.bindTexture(gl.TEXTURE_2D, null)
  rt.width = width
  rt.height = height
}

/** 화면 전체를 덮는 삼각형 하나. 풀스크린 quad보다 싸고 이음새가 없다. */
export function createFullscreenTriangle(gl: GL): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()
  if (!vao) throw new GLError('VAO 생성 실패')
  const buf = gl.createBuffer()
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  return vao
}
