/**
 * Small worker-thread pool that drives PDF extraction with real-time progress.
 * One batch = N pending jobs; each job belongs to an imported bill row.
 */
import { Worker } from 'node:worker_threads'
import type { ExtractOutcome } from '../../shared/types'

export interface ExtractJob {
  billId: number
  filePath: string
}

export interface QueueDeps {
  workerScript: string
  pdfjsWorkerPath: string | null
  tessdataDir: string | null
  concurrency?: number
  onStarted: (billId: number) => void
  onResult: (billId: number, outcome: ExtractOutcome | null, error: string | null) => void
  onBatchDone: () => void
}

const READY_TIMEOUT_MS = 30_000
const JOB_TIMEOUT_MS = 5 * 60_000

export function runExtractBatch(jobs: ExtractJob[], deps: QueueDeps): void {
  const pending = [...jobs]
  const size = Math.max(1, Math.min(deps.concurrency ?? 2, pending.length))

  const failRemaining = (msg: string): void => {
    while (pending.length > 0) {
      const j = pending.shift()!
      try {
        deps.onResult(j.billId, null, msg)
      } catch {
        /* ignore */
      }
    }
  }

  const workerLoop = async (): Promise<void> => {
    let worker: Worker
    try {
      worker = new Worker(deps.workerScript, {
        workerData: { pdfjsWorkerPath: deps.pdfjsWorkerPath, tessdataDir: deps.tessdataDir }
      })
    } catch (err) {
      failRemaining(`Could not start the PDF worker: ${(err as Error).message}`)
      return
    }

    let crashed = false
    let rejectCurrent: ((e: Error) => void) | null = null
    worker.on('error', () => {
      crashed = true
      rejectCurrent?.(new Error('Extraction worker crashed.'))
    })
    worker.on('exit', (code) => {
      if (code !== 0) crashed = true
      rejectCurrent?.(new Error('Extraction worker exited unexpectedly.'))
    })

    const messageHandler = (msg: { type: string; billId?: number; outcome?: ExtractOutcome; error?: string | null }): void => {
      if (msg.type === 'ready') {
        resolveReady()
        return
      }
      if (msg.type === 'result' && typeof msg.billId === 'number') {
        settleJob(msg.billId, msg.outcome ?? null, msg.error ?? null)
      }
    }
    let resolveReady: () => void = () => undefined
    let readySettled = false
    const ready = new Promise<void>((resolve) => {
      resolveReady = () => {
        if (!readySettled) {
          readySettled = true
          resolve()
        }
      }
    })
    let jobResolve: ((v: { billId: number; outcome: ExtractOutcome | null; error: string | null }) => void) | null = null
    const settleJob = (billId: number, outcome: ExtractOutcome | null, error: string | null): void => {
      if (jobResolve) {
        const r = jobResolve
        jobResolve = null
        r({ billId, outcome, error })
      }
    }

    worker.on('message', messageHandler)

    try {
      const timedReady = await Promise.race([
        ready.then(() => true as const),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), READY_TIMEOUT_MS))
      ])
      if (!timedReady) {
        crashed = true
        failRemaining('PDF worker did not start in time.')
        return
      }

      while (pending.length > 0 && !crashed) {
        const job = pending.shift()!
        deps.onStarted(job.billId)
        const resultP = new Promise<{ billId: number; outcome: ExtractOutcome | null; error: string | null }>((resolve) => {
          jobResolve = resolve
        })
        const timeout = new Promise<{ billId: number; outcome: null; error: string }>((resolve) => {
          setTimeout(() => resolve({ billId: job.billId, outcome: null, error: 'Extraction timed out (over 5 minutes).' }), JOB_TIMEOUT_MS)
        })
        rejectCurrent = (e: Error) => settleJob(job.billId, null, e.message)
        try {
          worker.postMessage({ type: 'job', job })
        } catch (err) {
          rejectCurrent(new Error(`Could not dispatch file to worker: ${(err as Error).message}`))
        }
        const res = await Promise.race([resultP, timeout])
        rejectCurrent = null
        try {
          deps.onResult(job.billId, res.outcome, res.error)
        } catch {
          /* never let a DB/UI callback kill the pool */
        }
      }
    } catch {
      crashed = true
    } finally {
      worker.off('message', messageHandler)
      try {
        worker.terminate()
      } catch {
        /* ignore */
      }
    }
    if (pending.length > 0 && crashed) {
      failRemaining('Extraction workers stopped early. Use Re-extract to retry the remaining files.')
    }
  }

  void Promise.all(Array.from({ length: size }, () => workerLoop())).finally(() => deps.onBatchDone())
}

export default runExtractBatch
