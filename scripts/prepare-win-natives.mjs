// Downloads the correct Windows (win32-x64) prebuilt binaries for native modules
// so a Windows installer can be packaged from any OS. Idempotent: skips work
// when files are already present with the right type.
//
//   better-sqlite3  -> official GitHub release tarball for the Electron ABI
//   @napi-rs/canvas -> npm package @napi-rs/canvas-win32-x64-msvc
//
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const root = process.cwd()
const nm = path.join(root, 'node_modules')

function pkgJson(p) {
  return JSON.parse(readFileSync(path.join(nm, p, 'package.json'), 'utf8'))
}

function isPE(file) {
  if (!existsSync(file)) return false
  const b = readFileSync(file).subarray(0, 2)
  return b[0] === 0x4d && b[1] === 0x5a // MZ
}

async function fetchBuf(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
  return Buffer.from(await r.arrayBuffer())
}

async function main() {
  // Electron 33.x ships Node ABI 130; bump the map when upgrading Electron.
  const electronAbiByMajor = { 33: 130, 32: 128, 31: 125, 30: 123 }
  const eVer = pkgJson('electron').version || '33.4.11'
  const major = parseInt(String(eVer).split('.')[0], 10)
  const abi = process.env.PBM_WIN_ELECTRON_ABI ?? electronAbiByMajor[major]
  if (!abi) throw new Error(`No Electron ABI mapping for major ${major}; set PBM_WIN_ELECTRON_ABI`)

  // 1) better-sqlite3 win32 prebuilt
  const bsqDir = path.join(nm, 'better-sqlite3')
  const bsqNode = path.join(bsqDir, 'build', 'Release', 'better_sqlite3.node')
  if (isPE(bsqNode)) {
    console.log('[win-natives] better_sqlite3.node already win32 PE — skipped')
  } else {
    const ver = pkgJson('better-sqlite3').version
    const asset = `better-sqlite3-v${ver}-electron-v${abi}-win32-x64.tar.gz`
    const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${ver}/${asset}`
    console.log('[win-natives] downloading', url)
    const tmp = path.join(os.tmpdir(), asset)
    writeFileSync(tmp, await fetchBuf(url))
    execFileSync('tar', ['-xzf', tmp, '-C', bsqDir])
    rmSync(tmp, { force: true })
    if (!isPE(bsqNode)) throw new Error('swap failed: better_sqlite3.node is not a PE binary')
    console.log('[win-natives] better_sqlite3.node is now the win32 Electron build ✓')
  }

  // 2) @napi-rs/canvas win32 (OCR rasterizer)
  const canvasVer = pkgJson('@napi-rs/canvas').version
  const winPkgDir = path.join(nm, '@napi-rs', 'canvas-win32-x64-msvc')
  const skia = path.join(winPkgDir, 'skia.win32-x64-msvc.node')
  if (isPE(skia)) {
    console.log('[win-natives] canvas win32 binary present — skipped')
  } else {
    const url = `https://registry.npmjs.org/@napi-rs/canvas-win32-x64-msvc/-/canvas-win32-x64-msvc-${canvasVer}.tgz`
    console.log('[win-natives] downloading', url)
    const tmp = path.join(os.tmpdir(), 'canvas-win32.tgz')
    writeFileSync(tmp, await fetchBuf(url))
    mkdirSync(winPkgDir, { recursive: true })
    execFileSync('tar', ['-xzf', tmp, '-C', winPkgDir, '--strip-components=1'])
    rmSync(tmp, { force: true })
    if (!isPE(skia)) throw new Error('swap failed: skia.win32-x64-msvc.node is not a PE binary')
    console.log('[win-natives] @napi-rs/canvas-win32-x64-msvc installed ✓')
  }
}

main().catch((e) => {
  console.error('[win-natives] FAIL:', e.message)
  process.exit(1)
})
