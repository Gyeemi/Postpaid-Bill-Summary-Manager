/**
 * All renderer <-> main communication. Every channel is registered here with
 * strict input validation; the renderer never touches Node APIs directly.
 * Handlers return { ok, data | error } so the UI can show precise messages.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  AppSettings,
  DirectoryImportResult,
  EmployeeInput,
  ManualBillInput,
  RecordUpdate,
  ReportSnapshot
} from '../shared/types'
import { getSettings, saveSettings } from './repositories/settings'
import { createEmployee, deleteEmployee, listEmployees, setEmployeeActive, updateEmployee } from './repositories/employees'
import {
  deletePeriod,
  findPeriod,
  getOrCreatePeriod,
  getPeriod,
  listPeriods,
  periodLabel,
  updatePeriod
} from './repositories/periods'
import { listBillsForPeriod, getBill, createManualBill, duplicateBillsIntoPeriod, setBillStatus, rematchUnmatchedBills } from './repositories/bills'
import { setActualBillingMonth, setPayableBefore, setPrepMonth } from './repositories/periods'
import { computeTotals, deleteRecord, getRecord, listRecords, updateRecord, unreviewedIssues } from './repositories/records'
import { deleteReport, finalizeReport, getReport, listReports, latestSnapshotForPeriod } from './repositories/reports'
import { importPdfFiles, processBills, removeBill, removeBillsBulk, sendToRenderer } from './services/bills'
import { employeeCsvTemplate, importEmployeesFile } from './services/employeesImport'
import {
  defaultPdfName,
  exportReportPdf,
  getPreviewHtmlPathForContents,
  openPrintPreview,
  printFromPreviewWindow
} from './exports/pdf'
import { defaultXlsxName, writeReportXlsx } from './exports/xlsx'
import { computeGstChh } from '../shared/money'
import { copyToDir, ensureDir, isReadableExistingFile } from './util/fsx'
import { buildSnapshotForPeriod } from './util/snapshot'
import { changeOwnPassword, createUser, deleteUser, listUsers, updateUser, verifyPassword } from './repositories/users'
import { currentUser, login, logout, requireAuth, requireRole } from './services/auth'
import { deleteDraft, listDrafts } from './repositories/periods'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const isInt = (v: unknown, min = -2147483648, max = 2147483647): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length <= max
const isNullableStr = (v: unknown, max = 500): boolean => v === null || v === undefined || isStr(v, max)
const isChh = (v: unknown): boolean => v === null || v === undefined || isInt(v, -1_000_000_00_00, 1_000_000_00_00)

function validateSender(event: Electron.IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  if (frame && frame !== event.sender.mainFrame) throw new Error('Blocked IPC from non-main frame')
  const url = event.sender.getURL()
  if (url.startsWith('file://')) return
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) return // vite dev server
  throw new Error(`Blocked IPC from ${url}`)
}

/**
 * Channels that must work BEFORE sign-in. Every other channel is rejected
 * unless the main process holds a live user session — the guard lives here,
 * so a compromised renderer cannot reach the database by calling IPC
 * directly. Administrator-only channels are listed in ADMIN_CHANNELS.
 */
const PUBLIC_CHANNELS = new Set(['app:version', 'auth:login', 'auth:logout', 'auth:currentUser'])

const ADMIN_CHANNELS = new Set([
  // user & security administration
  'users:list',
  'users:create',
  'users:update',
  'users:delete',
  // organization settings + folder/logo pickers
  'settings:set',
  'settings:pickExportFolder',
  'settings:pickLogo',
  'settings:removeLogo',
  // employee & SIM directory mutations
  'employees:create',
  'employees:update',
  'employees:delete',
  'employees:setActive',
  'employees:pickAndImport',
  // raw period delete + deleting a SAVED (finalized) report
  'periods:delete',
  'history:delete'
])

function handle(channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      validateSender(event)
      if (!PUBLIC_CHANNELS.has(channel)) {
        if (ADMIN_CHANNELS.has(channel)) requireRole(['admin'])
        else requireAuth()
      }
      const data = await fn(event, ...args)
      return { ok: true, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc:${channel}]`, message)
      return { ok: false, error: message }
    }
  })
}

function validateEmployeeInput(input: unknown): EmployeeInput {
  assert(!!input && typeof input === 'object', 'Invalid employee payload')
  const i = input as Record<string, unknown>
  assert(isStr(i.name, 160) && i.name.trim().length > 0, 'Employee/SIM name is required (max 160 chars)')
  assert(isNullableStr(i.title, 30), 'Invalid title')
  assert(isNullableStr(i.designation, 160), 'Invalid designation')
  assert(isNullableStr(i.mobile, 40), 'Invalid mobile number')
  assert(isNullableStr(i.simCategory, 60), 'Invalid SIM category')
  assert(isNullableStr(i.department, 120), 'Invalid department')
  assert(i.isActive === undefined || typeof i.isActive === 'boolean', 'Invalid active flag')
  assert(isNullableStr(i.notes, 500), 'Invalid notes')
  return {
    title: i.title as string | null,
    name: (i.name as string).trim(),
    designation: (i.designation as string | null) ?? null,
    mobile: (i.mobile as string | null) ?? null,
    simCategory: (i.simCategory as string) ?? 'Personal',
    department: (i.department as string | null) ?? null,
    isActive: i.isActive as boolean | undefined,
    notes: (i.notes as string | null) ?? null
  }
}

function validateRecordUpdate(patch: unknown): RecordUpdate {
  assert(!!patch && typeof patch === 'object', 'Invalid record patch')
  const p = patch as Record<string, unknown>
  if (p.employeeId !== undefined) assert(p.employeeId === null || isInt(p.employeeId, 1), 'Invalid employee id')
  if (p.basicAmount !== undefined) assert(isChh(p.basicAmount), 'Basic amount out of range')
  if (p.gst !== undefined) assert(isChh(p.gst), 'GST out of range')
  if (p.outstanding !== undefined) assert(isChh(p.outstanding), 'Outstanding out of range')
  if (p.penalty !== undefined) assert(isChh(p.penalty), 'Penalty out of range')
  if (p.creditsDebits !== undefined) assert(isChh(p.creditsDebits), 'Credits/Debits out of range')
  if (p.totalAmount !== undefined) assert(isChh(p.totalAmount), 'Total out of range')
  if (p.deduction !== undefined) assert(isChh(p.deduction), 'Deduction out of range')
  for (const k of ['title', 'username', 'designation', 'mobileNumber'] as const) {
    if (p[k] !== undefined) assert(isNullableStr(p[k], 200), `Invalid ${k}`)
  }
  if (p.includeInReport !== undefined) assert(typeof p.includeInReport === 'boolean', 'Invalid include flag')
  return p as RecordUpdate
}

async function pickFolder(): Promise<string | null> {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  return res.canceled ? null : res.filePaths[0] ?? null
}

function snapshotFromArgs(args: { periodId?: number; snapshot?: ReportSnapshot }, settings: AppSettings): ReportSnapshot {
  if (args.snapshot) {
    assert(typeof args.snapshot === 'object', 'Invalid snapshot')
    return args.snapshot
  }
  assert(isInt(args.periodId as number, 1), 'periodId required')
  return buildSnapshotForPeriod(args.periodId as number, settings)
}

async function resolveExportPath(saveTo: unknown, defaultName: string, kind: 'pdf' | 'xlsx'): Promise<string | null> {
  if (isStr(saveTo, 1024) && saveTo.trim()) {
    const extOk = kind === 'pdf' ? /\.pdf$/i.test(saveTo) : /\.xlsx$/i.test(saveTo)
    assert(extOk, `File name must end with .${kind}`)
    return saveTo
  }
  const settings = getSettings()
  const initial = settings.exportFolder && fs.existsSync(settings.exportFolder) ? settings.exportFolder : app.getPath('documents')
  const res = await dialog.showSaveDialog({
    title: `Save ${kind.toUpperCase()} report`,
    defaultPath: path.join(initial, defaultName),
    filters: kind === 'pdf' ? [{ name: 'PDF document', extensions: ['pdf'] }] : [{ name: 'Excel workbook', extensions: ['xlsx'] }]
  })
  return res.canceled ? null : res.filePath ?? null
}

export function registerIpc(): void {
  // ------------------------------------------------------------- app / misc
  handle('app:version', () => ({ version: app.getVersion(), name: app.name, electron: process.versions.electron }))

  // --------------------------------------------------------------- settings
  handle('settings:get', () => getSettings())
  handle('settings:set', (_e, patch: unknown) => {
    assert(!!patch && typeof patch === 'object', 'Invalid settings payload')
    const p = patch as Partial<AppSettings> & Record<string, unknown>
    const clean: Partial<AppSettings> = {}
    if (p.orgName !== undefined) {
      assert(isStr(p.orgName, 120) && p.orgName.trim().length > 0, 'Organization name is required')
      clean.orgName = p.orgName.trim()
    }
    if (p.orgLogoPath !== undefined) {
      assert(p.orgLogoPath === null || isStr(p.orgLogoPath, 1024), 'Invalid logo path')
      clean.orgLogoPath = p.orgLogoPath as string | null
    }
    if (p.currency !== undefined) {
      assert(isStr(p.currency, 10) && p.currency.trim().length > 0, 'Invalid currency label')
      clean.currency = p.currency.trim()
    }
    if (p.gstRatePercent !== undefined) {
      assert(isNum(p.gstRatePercent) && p.gstRatePercent >= 0 && p.gstRatePercent <= 30, 'GST rate must be between 0 and 30 %')
      clean.gstRatePercent = Math.round(p.gstRatePercent * 100) / 100
    }
    if (p.exportFolder !== undefined) {
      assert(p.exportFolder === null || isStr(p.exportFolder, 1024), 'Invalid export folder')
      clean.exportFolder = p.exportFolder as string | null
      if (clean.exportFolder) assert(fs.existsSync(clean.exportFolder), 'Export folder does not exist')
    }
    if (p.theme !== undefined) {
      assert(p.theme === 'light' || p.theme === 'dark', 'Invalid theme')
      clean.theme = p.theme
    }
    if (p.autoCalcGst !== undefined) {
      assert(typeof p.autoCalcGst === 'boolean', 'Invalid flag')
      clean.autoCalcGst = p.autoCalcGst
    }
    if (p.defaultMonth !== undefined) {
      assert(p.defaultMonth === null || isInt(p.defaultMonth, 1, 12), 'Invalid month')
      clean.defaultMonth = p.defaultMonth as number | null
    }
    if (p.defaultYear !== undefined) {
      assert(p.defaultYear === null || isInt(p.defaultYear, 2000, 2100), 'Invalid year')
      clean.defaultYear = p.defaultYear as number | null
    }
    if (p.footerText !== undefined) {
      assert(isStr(p.footerText, 600), 'Invalid footer text')
      clean.footerText = p.footerText
    }
    return saveSettings(clean)
  })
  handle('settings:pickExportFolder', async () => {
    const dir = await pickFolder()
    if (dir) saveSettings({ exportFolder: dir })
    return getSettings()
  })
  handle('settings:pickLogo', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose organization logo',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg'] }]
    })
    if (res.canceled || !res.filePaths[0]) return getSettings()
    const src = res.filePaths[0]
    assert(isReadableExistingFile(src), 'Cannot read the selected image')
    const dest = copyToDir(src, path.join(app.getPath('userData'), 'settings'), path.basename(src))
    return saveSettings({ orgLogoPath: dest })
  })
  handle('settings:removeLogo', () => saveSettings({ orgLogoPath: null }))

  // -------------------------------------------------------------- employees
  handle('employees:list', (_e, search?: unknown) => {
    assert(search === undefined || isStr(search, 200), 'Invalid search')
    return listEmployees(search as string | undefined)
  })
  // directory changes immediately re-flow numbers/designations into unmatched
  // bill rows so both the Import tab and the Bill Summary update at once
  const afterDirectoryChange = (): { linked: number; promoted: number } => {
    const res = rematchUnmatchedBills()
    if (res.linked > 0 || res.promoted > 0) sendToRenderer('bills:changed', {})
    return res
  }
  handle('employees:create', (_e, input: unknown) => {
    const emp = createEmployee(validateEmployeeInput(input))
    afterDirectoryChange()
    return emp
  })
  handle('employees:update', (_e, id: unknown, input: unknown) => {
    assert(isInt(id, 1), 'Invalid id')
    const r = updateEmployee(id as number, validateEmployeeInput(input))
    assert(!!r, 'Employee not found')
    afterDirectoryChange()
    return r
  })
  handle('employees:delete', (_e, id: unknown) => {
    assert(isInt(id, 1), 'Invalid id')
    deleteEmployee(id as number)
    sendToRenderer('bills:changed', {})
    return true
  })
  handle('employees:setActive', (_e, id: unknown, active: unknown) => {
    assert(isInt(id, 1), 'Invalid id')
    assert(typeof active === 'boolean', 'Invalid flag')
    const r = setEmployeeActive(id as number, active as boolean)
    afterDirectoryChange()
    return r
  })
  handle('employees:pickAndImport', async (): Promise<DirectoryImportResult> => {
    const res = await dialog.showOpenDialog({
      title: 'Import employee list',
      properties: ['openFile'],
      filters: [
        { name: 'Excel / CSV', extensions: ['xlsx', 'xlsm', 'csv'] }
      ]
    })
    if (res.canceled || !res.filePaths[0]) throw new Error('No file selected')
    const out = await importEmployeesFile(res.filePaths[0])
    const re = rematchUnmatchedBills()
    if (out.added + out.updated > 0 || re.linked > 0) sendToRenderer('bills:changed', {})
    return out
  })
  handle('employees:downloadTemplate', async () => {
    const target = path.join(app.getPath('userData'), 'templates')
    ensureDir(target)
    const file = path.join(target, 'employee-import-template.csv')
    fs.writeFileSync(file, '\uFEFF' + employeeCsvTemplate(), 'utf8')
    await shell.openPath(file)
    return file
  })

  // -------------------------------------------------------------- periods
  handle('periods:list', () => listPeriods())
  handle('periods:setBillingMonth', (_e, id: unknown, month: unknown, year: unknown) => {
    assert(isInt(id, 1), 'Invalid period id')
    assert(isInt(month, 1, 12), 'Invalid billing month')
    assert(isInt(year, 2000, 2100), 'Invalid billing year')
    const p = setActualBillingMonth(id as number, month as number, year as number)
    sendToRenderer('bills:changed', { periodId: id })
    return p
  })
  handle('periods:setPrepMonth', (_e, id: unknown, month: unknown, year: unknown) => {
    assert(isInt(id, 1), 'Invalid period id')
    if (month !== null) {
      assert(isInt(month, 1, 12), 'Invalid preparation month')
      assert(isInt(year, 2000, 2100), 'Invalid preparation year')
    } else {
      assert(year === null, 'Preparation month and year must be set together')
    }
    return setPrepMonth(id as number, (month as number | null) ?? null, (year as number | null) ?? null)
  })
  handle('periods:setPayableBefore', (_e, id: unknown, isoDate: unknown) => {
    assert(isInt(id, 1), 'Invalid period id')
    if (isoDate !== null) {
      assert(typeof isoDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(isoDate), 'Invalid Payable Before date (expected yyyy-mm-dd)')
    }
    return setPayableBefore(id as number, (isoDate as string | null) ?? null)
  })
  handle('bills:rematch', (_e, periodId?: unknown) => {
    assert(periodId === undefined || isInt(periodId, 1), 'Invalid period')
    const res = rematchUnmatchedBills(periodId as number | undefined)
    sendToRenderer('bills:changed', {})
    return res
  })
  handle('periods:ensure', (_e, month: unknown, year: unknown, title?: unknown) => {
    assert(isInt(month, 1, 12), 'Invalid month')
    assert(isInt(year, 2000, 2100), 'Invalid year')
    assert(isNullableStr(title, 200), 'Invalid title')
    const p = getOrCreatePeriod(month as number, year as number, (title as string | undefined) ?? null)
    return p
  })
  handle('periods:update', (_e, id: unknown, patch: unknown) => {
    assert(isInt(id, 1), 'Invalid id')
    assert(!!patch && typeof patch === 'object', 'Invalid patch')
    const p = patch as Record<string, unknown>
    if (p.reportTitle !== undefined) assert(isNullableStr(p.reportTitle, 200), 'Invalid title')
    if (p.reportDate !== undefined) assert(p.reportDate === null || /^\d{4}-\d{2}-\d{2}$/.test(String(p.reportDate)), 'Invalid date (yyyy-mm-dd)')
    return updatePeriod(id as number, {
      reportTitle: p.reportTitle as string | null | undefined,
      reportDate: p.reportDate as string | null | undefined,
      status: p.status as 'draft' | 'finalized' | undefined
    })
  })
  handle('periods:delete', (_e, id: unknown) => {
    assert(isInt(id, 1), 'Invalid id')
    // also remove copied pdf storage folder
    const dir = path.join(app.getPath('userData'), 'bills', String(id))
    deletePeriod(id as number)
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return true
  })
  handle('periods:duplicate', (_e, fromPeriodId: unknown, month: unknown, year: unknown, title?: unknown) => {
    assert(isInt(fromPeriodId, 1), 'Invalid source period')
    assert(isInt(month, 1, 12), 'Invalid month')
    assert(isInt(year, 2000, 2100), 'Invalid year')
    const existing = findPeriod(month as number, year as number)
    assert(!existing, `Billing period ${periodLabel(month as number, year as number)} already exists (${existing?.billCount ?? 0} bills). Use another month/year or import into it from the Import screen.`)
    const target = getOrCreatePeriod(month as number, year as number, (title as string | undefined) ?? null)
    const n = duplicateBillsIntoPeriod(fromPeriodId as number, target.id)
    return { period: target, copied: n }
  })

  // ----------------------------------------------------------------- bills
  handle('bills:pickFiles', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Select postpaid bill PDFs',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF bills', extensions: ['pdf'] }]
    })
    if (res.canceled) return []
    return res.filePaths.filter((p) => /\.pdf$/i.test(p) && isReadableExistingFile(p))
  })
  handle('bills:import', (_e, periodId: unknown, paths: unknown) => {
    assert(isInt(periodId, 1), 'Invalid period')
    assert(Array.isArray(paths) && paths.length > 0 && paths.length <= 200, 'File list must contain 1–200 paths')
    for (const p of paths as unknown[]) {
      assert(isStr(p, 1024), 'Invalid path')
    }
    const result = importPdfFiles(periodId as number, paths as string[])
    const ids = result.imported.map((i) => i.billId)
    const started = ids.length > 0 ? processBills(ids) : { queued: 0 }
    // first successful extraction may hint the billing period for the draft title
    if (started.queued > 0) {
      const p = getPeriod(periodId as number)
      if (p && !p.reportTitle) {
        updatePeriod(p.id, { reportTitle: `Postpaid Bill Summary – ${periodLabel(p.month, p.year)}` })
      }
    }
    sendToRenderer('bills:changed', { periodId })
    return result
  })
  handle('bills:list', (_e, periodId: unknown) => {
    assert(isInt(periodId, 1), 'Invalid period')
    return listBillsForPeriod(periodId as number)
  })
  handle('bills:process', (_e, billIds: unknown) => {
    assert(Array.isArray(billIds) && billIds.length > 0 && billIds.length <= 200, 'Invalid bill ids')
    for (const id of billIds as unknown[]) assert(isInt(id, 1), 'Invalid bill id')
    return processBills(billIds as number[])
  })
  handle('bills:retry', (_e, billId: unknown) => {
    assert(isInt(billId, 1), 'Invalid bill id')
    const bill = getBill(billId as number)
    assert(!!bill, 'Bill not found')
    if (bill!.isManual) throw new Error('Manually entered bills have no PDF to re-extract.')
    assert(bill!.extractionStatus !== 'processing', 'This bill is already being processed.')
    setBillStatus(billId as number, 'pending')
    return processBills([billId as number])
  })
  handle('bills:remove', (_e, billId: unknown) => {
    assert(isInt(billId, 1), 'Invalid bill id')
    removeBill(billId as number)
    sendToRenderer('bills:changed', {})
    return true
  })
  handle('bills:removeMany', (_e, idsRaw: unknown) => {
    assert(Array.isArray(idsRaw) && idsRaw.length > 0 && idsRaw.length <= 1000, 'Invalid id list')
    for (const id of idsRaw as unknown[]) assert(isInt(id, 1), 'Invalid bill id')
    const res = removeBillsBulk(idsRaw as number[])
    if (res.removed > 0) sendToRenderer('bills:changed', {})
    return res
  })
  handle('bills:manual', (_e, input: unknown) => {
    assert(!!input && typeof input === 'object', 'Invalid payload')
    const i = input as ManualBillInput & Record<string, unknown>
    assert(isInt(i.periodId, 1), 'Invalid period')
    assert(isStr(i.subscriberName, 160) && (i.subscriberName as string).trim().length > 0, 'Subscriber name is required')
    assert(isNullableStr(i.originalFilename, 200), 'Invalid filename')
    assert(isNullableStr(i.mobileNumber, 40), 'Invalid mobile')
    assert(isChh(i.basicAmount) && isChh(i.gst) && isChh(i.totalAmount), 'Invalid amounts')
    assert(i.basicAmount != null || i.totalAmount != null, 'At least Basic Amount or Total Amount is required')
    for (const k of ['outstanding', 'penalty', 'creditsDebits'] as const) assert(isChh(i[k]), `Invalid ${k}`)
    const r = createManualBill({
      periodId: i.periodId,
      subscriberName: (i.subscriberName as string).trim(),
      originalFilename: (i.originalFilename as string | null) ?? null,
      mobileNumber: (i.mobileNumber as string | null) ?? null,
      basicAmount: (i.basicAmount as number | null) ?? null,
      gst: (i.gst as number | null) ?? null,
      totalAmount: (i.totalAmount as number | null) ?? null,
      outstanding: (i.outstanding as number | null) ?? null,
      penalty: (i.penalty as number | null) ?? null,
      creditsDebits: (i.creditsDebits as number | null) ?? null
    })
    sendToRenderer('bills:changed', { periodId: i.periodId })
    return getBill(r.billId)
  })
  // --------------------------------------------------------------- records
  handle('records:list', (_e, periodId: unknown) => {
    assert(isInt(periodId, 1), 'Invalid period')
    return listRecords(periodId as number)
  })
  handle('records:update', (_e, id: unknown, patch: unknown) => {
    assert(isInt(id, 1), 'Invalid id')
    const r = updateRecord(id as number, validateRecordUpdate(patch))
    assert(!!r, 'Record not found')
    sendToRenderer('bills:changed', {})
    return r
  })
  handle('records:remove', (_e, id: unknown) => {
    assert(isInt(id, 1), 'Invalid id')
    const rec = getRecord(id as number)
    assert(!!rec, 'Record not found')
    if (rec!.bill?.storedPath && fs.existsSync(rec!.bill.storedPath)) {
      try {
        fs.unlinkSync(rec!.bill.storedPath)
      } catch {
        /* ignore */
      }
    }
    deleteRecord(id as number)
    sendToRenderer('bills:changed', {})
    return true
  })
  handle('records:autoCalcGst', (_e, id: unknown) => {
    assert(isInt(id, 1), 'Invalid id')
    const rec = getRecord(id as number)
    assert(!!rec, 'Record not found')
    assert(rec!.basicAmount !== null, 'Basic Amount is missing — auto-calculation needs it.')
    const rate = getSettings().gstRatePercent
    const gst = computeGstChh(rec!.basicAmount as number, rate)
    return updateRecord(id as number, { gst })
  })

  // ------------------------------------------------------------------ auth
  handle('auth:login', (_e, username: unknown, password: unknown) => {
    assert(isStr(username, 64) && (username as string).trim().length > 0, 'Enter your username')
    assert(isStr(password, 200), 'Enter your password')
    return login(username as string, password as string)
  })
  handle('auth:logout', () => {
    logout()
    return true
  })
  handle('auth:currentUser', () => currentUser())
  handle('auth:changeOwnPassword', (_e, currentPassword: unknown, newPassword: unknown) => {
    assert(isStr(currentPassword, 200) && isStr(newPassword, 200), 'Both password fields are required')
    const me = requireAuth()
    assert(verifyPassword(me.id, currentPassword as string), 'Your current password is not correct')
    changeOwnPassword(me.id, newPassword as string)
    return true
  })

  // ------------------------------------------------- local user management
  // (administrator only — enforced by ADMIN_CHANNELS above)
  handle('users:list', () => listUsers())
  handle('users:create', (_e, input: unknown) => {
    assert(!!input && typeof input === 'object', 'Invalid user payload')
    const i = input as Record<string, unknown>
    assert(isStr(i.username, 40), 'Invalid username')
    assert(isStr(i.password, 200), 'Invalid password')
    assert(i.role === 'admin' || i.role === 'standard', 'Invalid role')
    if (i.isActive !== undefined) assert(typeof i.isActive === 'boolean', 'Invalid status')
    return createUser({
      username: i.username as string,
      password: i.password as string,
      role: i.role as 'admin' | 'standard',
      isActive: i.isActive as boolean | undefined
    })
  })
  handle('users:update', (_e, id: unknown, patch: unknown) => {
    assert(isInt(id, 1), 'Invalid user id')
    assert(!!patch && typeof patch === 'object', 'Invalid patch')
    const me = requireRole(['admin'])
    const p = patch as Record<string, unknown>
    if (p.username !== undefined) assert(isStr(p.username, 40), 'Invalid username')
    if (p.password !== undefined) assert(isStr(p.password, 200), 'Invalid password')
    if (p.role !== undefined) assert(p.role === 'admin' || p.role === 'standard', 'Invalid role')
    if (p.isActive !== undefined) assert(typeof p.isActive === 'boolean', 'Invalid status')
    return updateUser(
      id as number,
      {
        username: p.username as string | undefined,
        password: p.password as string | undefined,
        role: p.role as 'admin' | 'standard' | undefined,
        isActive: p.isActive as boolean | undefined
      },
      me.id
    )
  })
  handle('users:delete', (_e, id: unknown) => {
    assert(isInt(id, 1), 'Invalid user id')
    const me = requireRole(['admin'])
    deleteUser(id as number, me.id)
    return true
  })

  // ---------------------------------------------------------- draft hygiene
  // Delete Draft works for ANY billing month/year (previous months included):
  // it removes the month's bills + draft summary records and keeps the
  // Employee & SIM Directory untouched.
  handle('drafts:list', () => listDrafts())
  handle('drafts:delete', (_e, periodId: unknown) => {
    assert(isInt(periodId, 1), 'Invalid billing month')
    const res = deleteDraft(periodId as number)
    const dir = path.join(app.getPath('userData'), 'bills', String(periodId))
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    sendToRenderer('bills:changed', {})
    return res
  })

  // ---------------------------------------------------------------- reports
  handle('report:snapshot', (_e, periodId: unknown) => {
    assert(isInt(periodId, 1), 'Invalid period')
    return buildSnapshotForPeriod(periodId as number, getSettings())
  })
  handle('report:issues', (_e, periodId: unknown) => {
    assert(isInt(periodId, 1), 'Invalid period')
    return unreviewedIssues(periodId as number)
  })
  handle('report:totals', (_e, periodId: unknown) => {
    assert(isInt(periodId, 1), 'Invalid period')
    return computeTotals(periodId as number, true)
  })
  handle('report:finalize', (_e, periodId: unknown, name: unknown, date: unknown) => {
    assert(isInt(periodId, 1), 'Invalid period')
    assert(isStr(name, 200) && (name as string).trim().length > 0, 'Report title is required')
    assert(/^\d{4}-\d{2}-\d{2}$/.test(String(date)), 'Report date must be yyyy-mm-dd')
    const p = getPeriod(periodId as number)
    assert(!!p, 'Billing period not found')
    const totals = computeTotals(periodId as number, true)
    if (totals.count === 0) throw new Error('The report has no included records — nothing to finalize.')
    return finalizeReport(periodId as number, (name as string).trim(), String(date))
  })
  handle('report:preview', async (_e, args: { periodId?: number; snapshot?: ReportSnapshot }) => {
    const settings = getSettings()
    const snap = snapshotFromArgs(args ?? {}, settings)
    openPrintPreview(snap)
    return true
  })
  handle('report:exportPdf', async (_e, args: { periodId?: number; snapshot?: ReportSnapshot; saveTo?: string | null }) => {
    const settings = getSettings()
    const snap = snapshotFromArgs(args ?? {}, settings)
    const target = await resolveExportPath(args?.saveTo, defaultPdfName(snap), 'pdf')
    if (!target) return { saved: false }
    await exportReportPdf(snap, target)
    return { saved: true, path: target }
  })
  handle('report:exportXlsx', async (_e, args: { periodId?: number; snapshot?: ReportSnapshot; saveTo?: string | null }) => {
    const settings = getSettings()
    const snap = snapshotFromArgs(args ?? {}, settings)
    const target = await resolveExportPath(args?.saveTo, defaultXlsxName(snap), 'xlsx')
    if (!target) return { saved: false }
    await writeReportXlsx(snap, target)
    return { saved: true, path: target }
  })

  // ----------------------------------------------------------- print window
  handle('printwin:print', (event) => {
    const wc = event.sender
    const win = BrowserWindow.fromWebContents(wc)
    assert(!!win, 'Unknown print window')
    assert(!!getPreviewHtmlPathForContents(win!.id), 'Not a print preview window')
    printFromPreviewWindow(win!)
    return true
  })
  handle('printwin:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && getPreviewHtmlPathForContents(win.id)) win.close()
    return true
  })

  // ---------------------------------------------------------------- history
  handle('history:list', (_e, search?: unknown) => {
    assert(search === undefined || isStr(search, 200), 'Invalid search')
    return listReports(search as string | undefined)
  })
  handle('history:get', (_e, id: unknown) => {
    assert(isInt(id, 1), 'Invalid id')
    return getReport(id as number)
  })
  handle('history:delete', (_e, id: unknown) => {
    assert(isInt(id, 1), 'Invalid id')
    deleteReport(id as number)
    return true
  })
  handle('history:snapshotForExport', (_e, id: unknown) => {
    assert(isInt(id, 1), 'Invalid id')
    const r = getReport(id as number)
    assert(!!r, 'Report not found')
    return r!.snapshot
  })
  handle('report:latestForPeriod', (_e, periodId: unknown) => {
    assert(isInt(periodId, 1), 'Invalid period')
    return latestSnapshotForPeriod(periodId as number)
  })

  // ------------------------------------------------------------- dashboard
  handle('dashboard:stats', (_e, periodId?: unknown) => {
    let pid: number | null = null
    if (periodId === undefined || periodId === null) {
      const periods = listPeriods()
      const settings = getSettings()
      const pref =
        settings.defaultMonth && settings.defaultYear ? findPeriod(settings.defaultMonth, settings.defaultYear) : null
      pid = (pref ?? periods[0] ?? null)?.id ?? null
    } else {
      assert(isInt(periodId, 1), 'Invalid period')
      pid = periodId as number
    }
    const period = pid ? getPeriod(pid) : null
    const totals = pid ? computeTotals(pid, true) : { basic: 0, gst: 0, total: 0, deduction: 0, count: 0 }
    const bills = pid ? listBillsForPeriod(pid) : []
    const issues = bills.filter((b) => b.extractionStatus === 'failed' || b.extractionStatus === 'needs_review' || b.extractionStatus === 'pending').length
    return {
      periodId: pid,
      periodLabel: period ? periodLabel(period.month, period.year) : null,
      totalBills: bills.length,
      totalPayable: totals.total,
      totalGst: totals.gst,
      totalDeductions: totals.deduction,
      extractionIssues: issues,
      recentReports: listReports().slice(0, 5),
      periodOptions: listPeriods().map((p) => ({ id: p.id, label: periodLabel(p.month, p.year) }))
    }
  })
}
