/**
 * Bill import + background processing orchestration (runs in the Electron main
 * process). Copies imported PDFs into the app data directory so later retries
 * work even if the user moves the originals, then feeds the extraction worker
 * pool and pushes progress events to the renderer.
 */
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { BulkRemoveResult, ExtractOutcome, ImportResult } from '../../shared/types'
import { copyToDir, ensureDir, fileHasPdfHeader, isReadableExistingFile, safeUnlink } from '../util/fsx'
import { insertImportedBills, markBillsProcessing, applyOutcome, setBillStatus, getBill, recoverInterruptedProcessing, deleteBill, rematchUnmatchedBills } from '../repositories/bills'
import { getSettings } from '../repositories/settings'
import { runExtractBatch } from '../pdf/queue'
import { extractorWorkerScript, resolvePdfjsWorkerPath, resolveTessdataDir } from '../util/resources'

const MAX_FILE_BYTES = 80 * 1024 * 1024

let batchRunning = false

export function billsDir(periodId: number): string {
  return path.join(app.getPath('userData'), 'bills', String(periodId))
}

export function importPdfFiles(periodId: number, selectedPaths: string[]): ImportResult {
  const result: ImportResult = { imported: [], skipped: [], errors: [] }
  const dir = billsDir(periodId)
  ensureDir(dir)
  const files: { fileName: string; originalPath: string; storedPath: string }[] = []
  const seen = new Set<string>()
  for (const p of selectedPaths) {
    const fileName = path.basename(p)
    if (!isReadableExistingFile(p)) {
      result.errors.push({ fileName, reason: 'File cannot be read (moved or permissions).' })
      continue
    }
    if (!/\.pdf$/i.test(fileName)) {
      result.errors.push({ fileName, reason: 'Only PDF files are supported.' })
      continue
    }
    try {
      const st = fs.statSync(p)
      if (st.size > MAX_FILE_BYTES) {
        result.errors.push({ fileName, reason: 'File is larger than 80 MB.' })
        continue
      }
    } catch {
      result.errors.push({ fileName, reason: 'File cannot be opened.' })
      continue
    }
    if (!fileHasPdfHeader(p)) {
      result.errors.push({ fileName, reason: 'File is not a valid PDF (header check failed).' })
      continue
    }
    if (seen.has(fileName)) {
      result.skipped.push({ fileName, reason: 'selected twice in this batch' })
      continue
    }
    seen.add(fileName)
    try {
      const stored = copyToDir(p, dir, fileName)
      files.push({ fileName, originalPath: p, storedPath: stored })
    } catch (err) {
      result.errors.push({ fileName, reason: `Could not copy file into the application: ${(err as Error).message}` })
    }
  }
  if (files.length > 0) {
    const { inserted, skipped } = insertImportedBills(periodId, files)
    for (const s of skipped) {
      // remove the stored copies of rows that were not inserted
      const f = files.find((x) => x.fileName === s.fileName)
      if (f) safeUnlink(f.storedPath)
      result.skipped.push(s)
    }
    result.imported = inserted
  }
  return result
}

export function sendToRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/**
 * Start background extraction for the given bill rows. Progress events go to
 * every open window via `bills:progress`; each finished bill also emits
 * `bills:changed` so tables can refresh in real time.
 */
export function processBills(billIds: number[]): { queued: number; message?: string } {
  if (batchRunning) return { queued: 0, message: 'A processing batch is already running. Please wait for it to finish.' }
  const settings = getSettings()
  const jobs = []
  for (const id of billIds) {
    const bill = getBill(id)
    if (!bill) continue
    const fp = bill.storedPath && fs.existsSync(bill.storedPath) ? bill.storedPath : bill.originalPath && fs.existsSync(bill.originalPath) ? bill.originalPath : null
    if (!fp) {
      setBillStatus(id, 'failed', 'The original PDF file could not be found any more. Re-import it or enter values manually.')
      continue
    }
    jobs.push({ billId: id, filePath: fp })
  }
  if (jobs.length === 0) return { queued: 0 }
  batchRunning = true
  markBillsProcessing(jobs.map((j) => j.billId))
  const total = jobs.length
  let processed = 0
  const nameOf = (billId: number): string => getBill(billId)?.originalFilename ?? `Bill #${billId}`

  runExtractBatch(jobs, {
    workerScript: extractorWorkerScript(),
    pdfjsWorkerPath: resolvePdfjsWorkerPath(),
    tessdataDir: resolveTessdataDir(),
    concurrency: 2,
    onStarted: (billId) => {
      sendToRenderer('bills:progress', {
        billId,
        fileName: nameOf(billId),
        status: 'processing',
        processed,
        total
      })
    },
    onResult: (billId, outcome, error) => {
      processed++
      try {
        if (outcome) {
          applyOutcome(billId, outcome as ExtractOutcome, {
            autoCalcGst: settings.autoCalcGst,
            gstRatePercent: settings.gstRatePercent,
            force: true
          })
        } else {
          setBillStatus(billId, 'failed', error ?? 'Extraction failed.')
        }
      } catch (err) {
        setBillStatus(billId, 'failed', `Could not store results: ${(err as Error).message}`)
      }
      const bill = getBill(billId)
      sendToRenderer('bills:progress', {
        billId,
        fileName: nameOf(billId),
        status: bill?.extractionStatus ?? 'failed',
        message: outcome ? undefined : (error ?? undefined),
        processed,
        total
      })
      sendToRenderer('bills:changed', { periodId: bill?.periodId ?? null })
    },
    onBatchDone: () => {
      batchRunning = false
      // final directory pass: fills any row whose match appeared mid-batch and
      // clears review flags whose only cause was the (now irrelevant) PDF number
      try {
        rematchUnmatchedBills()
      } catch {
        /* never let a nicety break the pipeline */
      }
      sendToRenderer('bills:batch-done', { processed, total })
    }
  })
  return { queued: jobs.length }
}

export function removeBill(billId: number): void {
  const bill = getBill(billId)
  if (!bill) throw new Error('Bill not found')
  safeUnlink(bill.storedPath)
  deleteBill(billId)
}

/** Multi-select delete: removes each bill independently; bills still
 * processing are skipped (reported in `failed`) instead of half-deleted. */
export function removeBillsBulk(billIds: number[]): BulkRemoveResult {
  const failed: BulkRemoveResult['failed'] = []
  let removed = 0
  for (const id of billIds) {
    try {
      const bill = getBill(id)
      if (!bill) throw new Error('Bill not found (already removed?)')
      if (bill.extractionStatus === 'processing') throw new Error('This bill is currently processing — wait for the batch to finish')
      removeBill(id)
      removed++
    } catch (e) {
      failed.push({ id, reason: e instanceof Error ? e.message : String(e) })
    }
  }
  return { removed, failed }
}

export function startupRecovery(): number {
  return recoverInterruptedProcessing()
}
