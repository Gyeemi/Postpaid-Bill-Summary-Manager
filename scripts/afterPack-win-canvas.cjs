// afterPack hook (runs after the app dir is assembled, before NSIS packs it):
//  1) prune duplicated/nested + foreign-platform binaries and dev-only junk
//  2) ensure the win32 @napi-rs/canvas binary is present exactly once
// This keeps the installer lean and correct when cross-packaging from Linux.
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const appNm = path.join(context.appOutDir, 'resources', 'app', 'node_modules')

  const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* ignore */ } }

  // 1a) nested node_modules of @napi-rs/canvas (platform-duplicated skia binaries)
  rmrf(path.join(appNm, '@napi-rs', 'canvas', 'node_modules'))
  // 1b) any stray foreign-platform canvas packages at the top level
  const nr = path.join(appNm, '@napi-rs')
  if (fs.existsSync(nr)) {
    for (const d of fs.readdirSync(nr)) {
      if (/^canvas-(linux|darwin|android|freebsd|netbsd|openbsd|win32-arm|win32-ia32)/.test(d)) {
        rmrf(path.join(nr, d))
      }
    }
  }
  // 1c) better-sqlite3 C sources (runtime needs only the prebuilt .node + JS)
  rmrf(path.join(appNm, 'better-sqlite3', 'deps'))
  // 1d) tesseract cores without SIMD (x64 CPUs since 2017 all have SIMD) and
  //     non-LSTM variants: the node worker only loads *-lstm builds.
  const core = path.join(appNm, 'tesseract.js', 'node_modules', 'tesseract.js-core')
  const coreAlt = path.join(appNm, 'tesseract.js-core')
  for (const dir of [core, coreAlt]) {
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      if (/^tesseract-core(?!-simd)/.test(f)) rmrf(path.join(dir, f))
    }
  }

  // 2) canonical win32 canvas binary
  const srcRoot = path.join(context.packager.projectDir, 'node_modules', '@napi-rs', 'canvas-win32-x64-msvc')
  const candidates = [
    srcRoot,
    path.join(context.packager.projectDir, 'node_modules', '@napi-rs', 'canvas', 'node_modules', 'canvas-win32-x64-msvc')
  ].filter((p) => fs.existsSync(path.join(p, 'skia.win32-x64-msvc.node')))
  if (candidates.length === 0) {
    console.warn('[afterPack] WARNING: no win32 skia binary found — run node scripts/prepare-win-natives.mjs first (OCR would fail)')
    return
  }
  const dst = path.join(nr || appNm, 'canvas-win32-x64-msvc')
  fs.cpSync(candidates[0], dst, { recursive: true })
  console.log('[afterPack] pruned foreign blobs; @napi-rs/canvas-win32-x64-msvc packaged ✓')
}
