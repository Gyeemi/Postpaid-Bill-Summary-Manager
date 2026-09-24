import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

export function isSafeFileName(name: string): boolean {
  return /^[\p{L}\p{N} .,\-_()'&\u00a0]+$/u.test(name) && name.length <= 180 && !/^\./.test(name)
}

/** Basic path-traversal / sanity guard for dialog-provided paths. */
export function isReadableExistingFile(p: string): boolean {
  try {
    if (!p || typeof p !== 'string' || p.includes('\0')) return false
    const st = fs.statSync(p)
    return st.isFile()
  } catch {
    return false
  }
}

export function fileHasPdfHeader(p: string): boolean {
  try {
    const fd = fs.openSync(p, 'r')
    try {
      const buf = Buffer.alloc(1024)
      const n = fs.readSync(fd, buf, 0, 1024, 0)
      return buf.subarray(0, n).includes('%PDF-')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

export function copyToDir(src: string, destDir: string, baseName: string): string {
  ensureDir(destDir)
  const safe = (baseName || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 140) || 'file'
  let target = path.join(destDir, safe)
  if (fs.existsSync(target)) {
    const ext = path.extname(safe)
    target = path.join(destDir, `${path.basename(safe, ext)}-${crypto.randomBytes(3).toString('hex')}${ext}`)
  }
  fs.copyFileSync(src, target)
  return target
}

export function safeUnlink(p: string | null | undefined): void {
  if (!p) return
  try {
    fs.unlinkSync(p)
  } catch {
    /* ignore */
  }
}

export function readDataUri(p: string | null | undefined): string | null {
  if (!p) return null
  try {
    const buf = fs.readFileSync(p)
    if (buf.length > 1.5 * 1024 * 1024) return null
    const ext = path.extname(p).toLowerCase()
    const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.svg' ? 'image/svg+xml' : 'image/png'
    const b64 = buf.toString('base64')
    return `data:${mime};base64,${b64}`
  } catch {
    return null
  }
}

export function uniqueStamp(): string {
  return `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`
}
