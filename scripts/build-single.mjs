/**
 * dist/ 를 단일 HTML 하나로 인라인한다.
 *
 * 두 가지 이유로 있다:
 *  1) file:// 로 바로 열려서 검증에 dev 서버(=Windows 콘솔 창)가 필요 없다.
 *  2) 에셋이 0이라 게임 전체가 진짜로 파일 하나다. 그냥 보내면 그게 배포다.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dist = resolve(process.argv[2] ?? 'dist')
const htmlPath = join(dist, 'index.html')

if (!existsSync(htmlPath)) {
  console.error(`dist/index.html 이 없습니다: ${htmlPath}\n먼저 vite build 를 돌리세요.`)
  process.exit(1)
}

let html = readFileSync(htmlPath, 'utf8')

// <script type="module" crossorigin src="./assets/index-XXXX.js"></script>
const scriptRe = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g
let inlined = 0
html = html.replace(scriptRe, (whole, src) => {
  const file = join(dist, src.replace(/^\.?\//, ''))
  if (!existsSync(file)) {
    console.warn(`건너뜀 (파일 없음): ${src}`)
    return whole
  }
  const js = readFileSync(file, 'utf8')
  inlined++
  // </script> 가 문자열 리터럴 안에 있으면 파서가 여기서 태그를 닫아버린다.
  const safe = js.replace(/<\/script/gi, '<\\/script')
  return `<script type="module">\n${safe}\n</script>`
})

// <link rel="stylesheet" href="./assets/index-XXXX.css">
const cssRe = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g
html = html.replace(cssRe, (whole, href) => {
  const file = join(dist, href.replace(/^\.?\//, ''))
  if (!existsSync(file)) return whole
  inlined++
  return `<style>\n${readFileSync(file, 'utf8')}\n</style>`
})

const out = join(dist, 'single.html')
writeFileSync(out, html, 'utf8')
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)
console.log(`single.html 작성 (${inlined}개 인라인, ${kb} KB)`)
console.log(out)
