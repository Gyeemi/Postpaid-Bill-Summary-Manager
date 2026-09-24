/**
 * Electron main-process bootstrap: window creation, hardened security
 * settings, database initialisation, IPC registration and crash recovery.
 */
import { app, BrowserWindow, session, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { initDatabase } from './db'
import { registerIpc } from './ipc'
import { ensureDefaultAdmin } from './repositories/users'
import { login as authLogin } from './services/auth'
import { startupRecovery } from './services/bills'
import { ensureDir } from './util/fsx'

app.setName('Postpaid Bill Summary Manager')

process.on('uncaughtException', (err) => {
  console.error('[main] uncaught exception', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[main] unhandled rejection', err)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null

function isDevServer(): boolean {
  return !!process.env['ELECTRON_RENDERER_URL']
}

function applyCsp(): void {
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: file:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'"
          ]
        }
      })
    })
  }
}

function hardenWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    const allowed = isDevServer() && url.startsWith(process.env['ELECTRON_RENDERER_URL'] as string)
    if (!allowed && !url.startsWith('file://')) event.preventDefault()
  })
  // prevent <webview>/<iframe> surprises
  contents.on('did-attach-webview', (event) => event.preventDefault())
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: 'Postpaid Bill Summary Manager',
    backgroundColor: '#f2f5f9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  hardenWebContents(mainWindow.webContents)
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isDevServer()) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] as string)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Dev/CI smoke hook. PBM_SMOKE=1: boot screenshot. PBM_SMOKE=full: walk every view.
  // PBM_SMOKE=import: additionally run a real import -> extraction -> multi-select
  // bulk-delete round trip against samples/ and verify DB state.
  // PBM_SMOKE=preview: open trimmed bill PDF preview and screenshot it.
  const smoke = process.env['PBM_SMOKE']
  if (smoke) {
    const shotsDir = process.env['PBM_SMOKE_DIR'] || app.getPath('userData')
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        void (async () => {
          try {
            const grab = async (name: string) => {
              const img = await mainWindow?.webContents.capturePage()
              if (img) {
                fs.writeFileSync(path.join(shotsDir, `smoke-${name}.png`), img.toPNG())
                console.log('[smoke] screenshot smoke-' + name + '.png')
              }
            }
            const goto = async (label: string) => {
              await mainWindow?.webContents.executeJavaScript(
                `void (Array.from(document.querySelectorAll('.nav-item')).find(b=>b.textContent.includes('${label}'))||{}).click?.(); true`
              )
              await new Promise((r) => setTimeout(r, 700))
            }
            if (smoke === 'login') {
              // ---- sign-in gate: nothing but the login card may be on screen ----
              const navVisible = await mainWindow?.webContents.executeJavaScript(`!!document.querySelector('.nav-item')`)
              console.log('[smoke-login] workspace nav visible before sign-in: ' + navVisible)
              if (navVisible) throw new Error('the workspace was reachable without signing in')
              const hasForm = await mainWindow?.webContents.executeJavaScript(`!!document.querySelector('#login-form')`)
              console.log('[smoke-login] sign-in screen rendered: ' + hasForm)
              if (!hasForm) throw new Error('sign-in screen did not render on launch')
              await grab('login-screen')
              const fill = async (sel: string, value: string): Promise<void> => {
                await mainWindow?.webContents.executeJavaScript(
                  `void (() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return; const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })(); true`
                )
              }
              const submit = async (): Promise<void> => {
                await mainWindow?.webContents.executeJavaScript(`void document.querySelector('#login-form').requestSubmit(); true`)
              }
              await fill('input[name="username"]', 'admin')
              await fill('input[name="password"]', 'definitely-the-wrong-password')
              await submit()
              await new Promise((r) => setTimeout(r, 1500))
              const errText: unknown = await mainWindow?.webContents.executeJavaScript(
                `(document.querySelector('.login-error') || {}).textContent || ''`
              )
              console.log('[smoke-login] wrong password message: ' + JSON.stringify(errText))
              if (typeof errText !== 'string' || !/invalid username or password/i.test(errText)) {
                throw new Error('a wrong password was not rejected')
              }
              const stillLocked = await mainWindow?.webContents.executeJavaScript(`!!document.querySelector('.nav-item')`)
              if (stillLocked) throw new Error('workspace opened despite the failed sign-in')
              await grab('login-error')
              await fill('input[name="password"]', 'admin123')
              await submit()
              await new Promise((r) => setTimeout(r, 2000))
              const signedIn = await mainWindow?.webContents.executeJavaScript(`!!document.querySelector('.nav-item')`)
              console.log('[smoke-login] signed in with admin/admin123: ' + signedIn)
              if (!signedIn) throw new Error('valid credentials did not open the workspace')
              await grab('login-success')
              console.log('[smoke] renderer loaded without fatal errors')
              app.exit(0)
              return
            }
            await grab('dashboard')
            if (smoke === 'full') {
              for (const label of ['Import PDF Bills', 'Bill Summary', 'Employee & SIM Directory', 'Report History', 'Settings', 'User Management']) {
                await goto(label)
                await grab(label.toLowerCase().replace(/[^a-z]+/g, '-'))
              }

              // ---- previous-month draft deletion, driven through the real UI ----
              const { getOrCreatePeriod, listDrafts, findPeriod } = await import('./repositories/periods')
              const { createManualBill } = await import('./repositories/bills')
              const { getDb } = await import('./db')
              const stale = findPeriod(7, 2026) ?? getOrCreatePeriod(7, 2026)
              getDb().prepare(`DELETE FROM bill_summary_records WHERE period_id = ?`).run(stale.id)
              getDb().prepare(`DELETE FROM imported_bills WHERE period_id = ?`).run(stale.id)
              getDb().prepare(`DELETE FROM report_history WHERE period_id = ?`).run(stale.id)
              createManualBill({
                periodId: stale.id,
                subscriberName: 'Smoke Previous Month',
                mobileNumber: '17123456',
                basicAmount: 10000,
                gst: 500,
                totalAmount: 10500
              })
              console.log(`[smoke-draft] prepared July 2026 draft (id=${stale.id}, bills=${listDrafts().find((d) => d.id === stale.id)?.billCount})`)
              await goto('Report History')
              await mainWindow?.webContents.executeJavaScript(
                `void (Array.from(document.querySelectorAll('button')).find(b=>/draft/i.test(b.textContent||''))||{}).click?.(); true`
              )
              await new Promise((r) => setTimeout(r, 800))
              const draftRows: unknown = await mainWindow?.webContents.executeJavaScript(
                `Array.from(document.querySelectorAll('.draft-row')).map(r=>r.textContent.replace(/\\s+/g,' ').trim())`
              )
              console.log('[smoke-draft] draft rows: ' + JSON.stringify(draftRows))
              await grab('history-drafts')
              const clicked: unknown = await mainWindow?.webContents.executeJavaScript(
                `(() => { const row = Array.from(document.querySelectorAll('.draft-row')).find(r=>/July 2026/.test(r.textContent||'')); if (!row) return false; const b = row.querySelector('.draft-delete'); if (!b) return false; b.click(); return true })()`
              )
              await new Promise((r) => setTimeout(r, 700))
              console.log('[smoke-draft] Delete Draft button clicked: ' + clicked)
              if (clicked !== true) throw new Error('Delete Draft button not found for July 2026')
              const modalText: unknown = await mainWindow?.webContents.executeJavaScript(
                `(document.querySelector(".modal-backdrop") || {}).textContent || ''`
              )
              console.log('[smoke-draft] confirmation dialog: ' + JSON.stringify(String(modalText).replace(/\\s+/g, ' ').slice(0, 200)))
              if (typeof modalText !== 'string' || !/July 2026/.test(modalText)) {
                throw new Error('confirmation dialog did not show the month/year')
              }
              await grab('draft-delete-confirm')
              const employeesBefore = (await import('./repositories/employees')).listEmployees().length
              const confirmed: unknown = await mainWindow?.webContents.executeJavaScript(
                `(() => { const b = Array.from(document.querySelectorAll('.modal-backdrop button')).find(x=>/delete draft/i.test(x.textContent||'')); if (!b) return false; b.click(); return true })()`
              )
              console.log('[smoke-draft] confirmed in dialog: ' + confirmed)
              if (confirmed !== true) throw new Error('Delete Draft confirm button missing from the dialog')
              await new Promise((r) => setTimeout(r, 1800))
              const gone = !findPeriod(7, 2026)
              const employeesAfter = (await import('./repositories/employees')).listEmployees().length
              console.log(`[smoke-draft] July 2026 removed from drafts: ${gone}; directory rows ${employeesBefore} → ${employeesAfter}`)
              if (!gone) throw new Error('Delete Draft did not remove the previous-month draft')
              if (employeesBefore !== employeesAfter) throw new Error('Delete Draft touched the Employee & SIM Directory')
              const remaining = listDrafts()
              console.log('[smoke-draft] drafts left: ' + remaining.map((d) => `${d.month}/${d.year}`).join(', '))
              await grab('history-after-draft-delete')

              // ---- report exports: A4 PORTRAIT on paper for PDF and Excel ----
              const { buildSnapshotForPeriod } = await import('./util/snapshot')
              const { exportReportPdf } = await import('./exports/pdf')
              const { writeReportXlsx } = await import('./exports/xlsx')
              const { getSettings } = await import('./repositories/settings')
              const { getOrCreatePeriod: openPeriod } = await import('./repositories/periods')
              const exportPeriod = openPeriod(9, 2026)
              const exportSnap = buildSnapshotForPeriod(exportPeriod.id, getSettings())
              const pdfOut = path.join(shotsDir, 'smoke-portrait-report.pdf')
              const xlsxOut = path.join(shotsDir, 'smoke-portrait-report.xlsx')
              await exportReportPdf(exportSnap, pdfOut)
              await writeReportXlsx(exportSnap, xlsxOut)
              const pdfText = fs.readFileSync(pdfOut, 'latin1')
              const box = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdfText)
              const w = box ? Number(box[1]) : 0
              const h = box ? Number(box[2]) : 0
              const portraitPdf = w > 0 && h > w
              console.log(`[smoke-export] report PDF page box: ${w} x ${h} pt → ${portraitPdf ? 'PORTRAIT' : 'LANDSCAPE/UNKNOWN'}`)
              if (!portraitPdf) throw new Error('exported report PDF is not A4 portrait')
              if (!(w > 580 && w < 610)) throw new Error(`unexpected page width ${w}pt (A4 portrait is ~595pt)`)
              console.log(`[smoke-export] report XLSX written: ${xlsxOut}`)
            }
            if (smoke === 'import') {
              const { importPdfFiles, processBills, removeBillsBulk } = await import('./services/bills')
              const { getOrCreatePeriod } = await import('./repositories/periods')
              const { getBill, listBillsForPeriod } = await import('./repositories/bills')
              const { createEmployee } = await import('./repositories/employees')
              for (const e of [
                { title: 'Mr.', name: 'A K Basu Mullick', designation: 'Sr. General Manager', mobile: '077100802', simCategory: 'Corporate' },
                { title: 'Mr.', name: 'Akash Prajapati', designation: 'Assistant Manager', mobile: '77106873', simCategory: 'Corporate' },
                { title: 'Mrs.', name: 'Dechen Wangmo', designation: 'Accounts Officer', mobile: '77109949', simCategory: 'Corporate' },
                { name: 'TBL Data Card', designation: 'Departmental SIM', mobile: '77118695', simCategory: 'Departmental' },
                { title: 'Ms.', name: 'Sonam Lhamo', designation: 'Section Officer', mobile: '77102255', simCategory: 'Corporate' }
              ]) {
                try {
                  createEmployee(e)
                } catch {
                  /* already present from a previous run */
                }
              }
              const dir = path.join(app.getAppPath(), 'samples')
              const files = fs.readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).map((f) => path.join(dir, f))
              const period = getOrCreatePeriod(9, 2026, null)
              const res = importPdfFiles(period.id, files)
              console.log(`[smoke-import] imported=${res.imported.length} skipped=${res.skipped.length} errors=${res.errors.length}`)
              // directory-first: the number must already be known from the filename match, BEFORE extraction
              const immediate = listBillsForPeriod(period.id)
              console.log('[smoke-import] numbers right after import: ' + immediate.map((b) => `${b.srFromFilename ?? '-'}:${b.mobileNumber ?? 'none'}`).join(' '))
              if (!immediate.every((b) => b.mobileNumber !== null)) throw new Error('name-based directory match did not populate the Number at import time')
              const ids = listBillsForPeriod(period.id).map((b) => b.id)
              if (ids.length === 0) throw new Error('nothing imported')
              if (res.imported.length > 0) processBills(res.imported.map((i) => i.billId))
              let st: string[] = []
              for (let t = 0; t < 140; t++) {
                await new Promise((r) => setTimeout(r, 500))
                st = ids.map((id) => getBill(id)?.extractionStatus ?? 'gone')
                if (!st.some((x) => x === 'processing' || x === 'pending')) break
              }
              console.log('[smoke-import] statuses: ' + st.join(','))
              const nums = listBillsForPeriod(period.id)
              console.log(
                '[smoke-import] numbers: ' +
                  nums.map((b) => `${b.srFromFilename ?? '-'}:${b.mobileNumber ?? 'none'}:${(b.fieldEvidence?.['mobileSource'] as string | undefined) ?? '?'}`).join(' ')
              )
              const snBill = nums.find((b) => b.srFromFilename === 2)
              if (!snBill || snBill.mobileNumber !== '077100802') throw new Error(`directory number not resolved for the numbered bill (got ${snBill?.mobileNumber})`)
              if (snBill.fieldEvidence?.['mobileSource'] !== 'directory-name') throw new Error(`mobileSource provenance should be directory-name (got ${snBill.fieldEvidence?.['mobileSource']})`)
              if (snBill.fieldEvidence?.['serviceNumberHint'] !== '077100802') throw new Error('PDF Service Number hint not recorded for the reviewer')
              // a bill whose PDF has NO number at all still gets its directory number and is NOT review-gated for that
              const dechen = nums.find((b) => /Dechen/.test(b.originalFilename))
              if (!dechen || dechen.mobileNumber !== '77109949') throw new Error(`name-matched bill lost its directory number (got ${dechen?.mobileNumber})`)
              // her sample bill carries a genuine Nu. 10.00 reconciliation gap, so review is
              // correct — but its REASON must be the amounts, never the missing PDF number
              if (dechen.extractionStatus === 'needs_review') {
                const { listRecords: lr } = await import('./repositories/records')
                const dRec = lr(period.id).find((r) => /Dechen/.test(r.bill?.originalFilename ?? ''))
                const w = (dRec?.warnings ?? []).join(' ')
                if (/no Service Number|enter or confirm the mobile/i.test(w)) throw new Error(`review still gated on the PDF number: ${w}`)
                if (!/differs|could not be matched/i.test(w)) throw new Error(`needs_review without an amount reason: ${w}`)
                console.log('[smoke-import] dechen review reason (expected, amount mismatch): ' + w.slice(0, 120))
              }
              const sonam0 = nums.find((b) => /Sonam/.test(b.originalFilename))
              if (!sonam0 || sonam0.mobileNumber !== '77102255' || sonam0.extractionStatus !== 'extracted') throw new Error('Sonam bill: directory match/number failed')
              if (st.some((x) => x === 'processing' || x === 'pending')) throw new Error('extraction did not settle in 70s')
              // the paper's Account Summary block must survive intact per bill:
              // Outstanding / Penalty / Bill Amount / GST / Credits-Debits / Total Payable
              console.log(
                '[smoke-import] breakdowns: ' +
                  nums
                    .map((b) => `${b.srFromFilename ?? '-'}:${b.outstanding}/${b.penalty}/${b.billAmount}/${b.gst}/${b.creditsDebits}/${b.totalPayable}`)
                    .join(' ')
              )
              const sonam = nums.find((b) => b.srFromFilename === 6)
              if (
                !sonam ||
                sonam.outstanding !== 162506 ||
                sonam.penalty !== 0 ||
                sonam.billAmount !== 26129 ||
                sonam.gst !== 1306 ||
                sonam.creditsDebits !== 0 ||
                sonam.totalPayable !== 190000
              ) {
                throw new Error(`Account Summary breakdown not captured for the outstanding bill (got ${sonam ? sonam.outstanding + '/' + sonam.billAmount + '/' + sonam.totalPayable : 'missing'})`)
              }
              // numbered-filename parsing must be visible in the parsed bill + snapshot rows
              const { includedRowsForSnapshot } = await import('./repositories/records')
              const numbered = listBillsForPeriod(period.id).find((b) => b.srFromFilename !== null)
              const snap = includedRowsForSnapshot(period.id)
              if (snap.length > 0 && snap[0].sr !== '02') {
                throw new Error(`snapshot row order wrong: first sr=${snap[0].sr}, expected '02' (numbered file sorts first)`)
              }
              console.log(`[smoke-import] snapshot rows in order: ${snap.map((r) => r.sr).join(',')}`)
              if (numbered) {
                console.log(
                  `[smoke-import] parsed numbered file: subscriber="${numbered.subscriberName}" title="${numbered.detectedTitle}" name="${numbered.detectedName}" sr=${numbered.srFromFilename}`
                )
              } else {
                throw new Error('expected a bill with srFromFilename from samples/')
              }
              await goto('Import PDF Bills')
              await new Promise((r) => setTimeout(r, 700))
              await grab('import-list')
              await goto('Bill Summary')
              await new Promise((r) => setTimeout(r, 700))
              await grab('bill-summary-numbered')
              await goto('Import PDF Bills')
              await new Promise((r) => setTimeout(r, 500))
              // --- UI check: tick two checkboxes, expect the bulk toolbar + confirm modal ---
              void (await mainWindow?.webContents.executeJavaScript(
                `void (() => { const c = document.querySelectorAll('.tbl tbody .chk input'); c[0]?.click(); c[1]?.click(); return true })(); true`
              ))
              await new Promise((r) => setTimeout(r, 450))
              const btnTxt: unknown = await mainWindow?.webContents.executeJavaScript(
                `(Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Delete selected'))||{}).textContent || ''`
              )
              console.log('[smoke-import] bulk toolbar button: ' + JSON.stringify(btnTxt))
              if (typeof btnTxt !== 'string' || !btnTxt.includes('(2)')) throw new Error('bulk toolbar button did not appear')
              await grab('import-selected')
              void (await mainWindow?.webContents.executeJavaScript(
                `void Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Delete selected'))?.click(); true`
              ))
              await new Promise((r) => setTimeout(r, 450))
              const modalShown: unknown = await mainWindow?.webContents.executeJavaScript(
                `!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Remove 2 bills')`
              )
              console.log('[smoke-import] confirm modal shown with 2 named bills: ' + modalShown)
              if (!modalShown) throw new Error('confirm modal did not open')
              await grab('import-confirm-modal')
              void (await mainWindow?.webContents.executeJavaScript(
                `void Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Cancel')?.click(); true`
              ))
              await new Promise((r) => setTimeout(r, 300))
              if (listBillsForPeriod(period.id).length !== ids.length) throw new Error('Cancel must not delete anything')
              // --- end UI check; main-side verification of the same service follows ---
              const del = ids.slice(0, 3)
              const out = removeBillsBulk(del)
              const remaining = listBillsForPeriod(period.id).length
              console.log(`[smoke-import] bulk delete: removed=${out.removed} failed=${out.failed.length}; list=${remaining} expected=${ids.length - 3}`)
              await new Promise((r) => setTimeout(r, 900))
              await grab('import-after-delete')
              if (out.removed !== 3 || out.failed.length !== 0 || remaining !== ids.length - 3) throw new Error('bulk delete verification failed')
              // deleted bills' stored copies must be gone; remaining ones intact
              for (const id of del) if (getBill(id)) throw new Error('deleted bill still in db: ' + id)
            }
            console.log('[smoke] renderer loaded without fatal errors')
            app.exit(0)
          } catch (err) {
            console.error('[smoke] failed', err)
            app.exit(1)
          }
        })()
      }, smoke === 'import' || smoke === 'full' ? 2200 : 1200)
    })
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

void app.whenReady().then(() => {
  const userData = app.getPath('userData')
  ensureDir(path.join(userData, 'bills'))
  ensureDir(path.join(userData, 'tmp'))
  ensureDir(path.join(userData, 'settings'))
  initDatabase(userData)
  ensureDefaultAdmin()
  const smokeRun = process.env['PBM_SMOKE']
  if (smokeRun && smokeRun !== 'login') {
    // automated runs sign in programmatically (the app itself still starts locked)
    try {
      authLogin('admin', 'admin123')
    } catch (err) {
      console.error('[smoke] pre-login failed', err)
    }
  }
  const recovered = startupRecovery()
  if (recovered > 0) console.log(`[main] reset ${recovered} bill(s) interrupted by a previous shutdown`)
  applyCsp()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    // not used by this application at all
    contents.close()
  }
})
