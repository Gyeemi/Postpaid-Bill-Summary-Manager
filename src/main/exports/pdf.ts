/**
 * PDF export + print preview. The report HTML (shared with the preview screen)
 * is rendered by an off-screen Electron window and converted with printToPDF,
 * so the exported file matches what the user sees and prints.
 */
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { buildReportHtml } from '../../shared/reportHtml'
import type { ReportSnapshot } from '../../shared/types'
import { ensureDir, readDataUri, safeUnlink, uniqueStamp } from '../util/fsx'

const tmpDir = (): string => path.join(app.getPath('userData'), 'tmp')

function writeTempHtml(snapshot: ReportSnapshot, interactive: boolean): string {
  ensureDir(tmpDir())
  const logo = snapshot.orgLogoPath ? readDataUri(snapshot.orgLogoPath) : null
  const html = buildReportHtml(snapshot, { interactive, logoDataUri: logo })
  const file = path.join(tmpDir(), `report-${uniqueStamp()}.html`)
  fs.writeFileSync(file, html, 'utf8')
  return file
}

const printWindows = new Map<number, string>()

export function openPrintPreview(snapshot: ReportSnapshot): void {
  const file = writeTempHtml(snapshot, true)
  const win = new BrowserWindow({
    width: 1240,
    height: 860,
    parent: undefined,
    title: 'Print Preview',
    backgroundColor: '#eef1f5',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  win.webContents.on('destroyed', () => {
    printWindows.delete(win.id)
    safeUnlink(file)
  })
  printWindows.set(win.id, file)
  void win.loadFile(file)
}

export function getPreviewHtmlPathForContents(contentsId: number): string | null {
  return printWindows.get(contentsId) ?? null
}

/** print from an open preview window (system dialog for printer choice) */
export function printFromPreviewWindow(win: BrowserWindow): void {
  win.webContents.print(
    {
      silent: false,
      printBackground: true,
      landscape: false,
      margins: { marginType: 'none' }
    },
    (success, reason) => {
      if (!success && reason && reason !== ' aborted') {
        win.webContents.executeJavaScript(
          `document.title = 'Print cancelled (${reason.replace(/'/g, '')})'`
        ).catch(() => undefined)
      }
    }
  )
}

export async function exportReportPdf(snapshot: ReportSnapshot, savePath: string): Promise<string> {
  const file = writeTempHtml(snapshot, false)
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 1000,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  try {
    await win.loadFile(file)
    await win.webContents.executeJavaScript(`document.fonts ? document.fonts.ready.then(() => true) : true`)
    const data = await win.webContents.printToPDF({
      landscape: false,
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0.35, bottom: 0.45, left: 0.35, right: 0.35, marginType: 'custom' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="font-size:8px;color:#66728a;width:100%;text-align:center;">' +
        (snapshot.reportTitle || '') +
        ' — Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>'
    })
    ensureDir(path.dirname(savePath))
    fs.writeFileSync(savePath, data)
    return savePath
  } finally {
    if (!win.isDestroyed()) win.destroy()
    safeUnlink(file)
  }
}

export function defaultPdfName(snapshot: ReportSnapshot): string {
  const base = (snapshot.reportTitle || 'Bill Summary').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
  return `${base || 'Bill Summary'}.pdf`
}
