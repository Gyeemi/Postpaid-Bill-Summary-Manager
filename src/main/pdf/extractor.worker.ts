/**
 * Worker-thread entry for PDF extraction. Keeps all parsing / OCR off the UI
 * thread and off the main process event loop. The parent sends `{type:'job'}`
 * messages; this thread answers with `{type:'result'}`.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { extractBillPdf } from './extract'
import { disposeOcrWorker } from './ocr'

interface Job {
  billId: number
  filePath: string
}

async function main(): Promise<void> {
  const port = parentPort
  if (!port) return
  const cfg = (workerData ?? {}) as { pdfjsWorkerPath?: string | null; tessdataDir?: string | null }
  port.on('message', async (msg: { type: string; job?: Job }) => {
    if (msg.type !== 'job' || !msg.job) return
    const job = msg.job
    try {
      const outcome = await extractBillPdf({
        billId: job.billId,
        filePath: job.filePath,
        pdfjsWorkerPath: cfg.pdfjsWorkerPath ?? null,
        tessdataDir: cfg.tessdataDir ?? null,
        allowOcr: true
      })
      port.postMessage({ type: 'result', billId: job.billId, ok: true, outcome })
    } catch (err) {
      port.postMessage({ type: 'result', billId: job.billId, ok: false, error: String((err as Error)?.message ?? err) })
    }
  })
  port.postMessage({ type: 'ready' })
  port.on('close', () => {
    void disposeOcrWorker()
  })
}

void main()
