/**
 * Secure preload: exposes ONE narrow, typed, promise-based API on
 * window.api via contextBridge. No Node.js primitives reach the renderer
 * (contextIsolation on, nodeIntegration off, sandbox on).
 */
import { contextBridge, ipcRenderer, webUtils, IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  BillProgressEvent,
  BillRecord,
  BillingPeriod,
  DashboardStats,
  DirectoryImportResult,
  Employee,
  EmployeeInput,
  ExportResult,
  ExtractOutcome,
  IpcResult,
  ManualBillInput,
  ImportedBill,
  RecordUpdate,
  ReportHistoryEntry,
  ReportSnapshot,
  ReportTotals,
  ImportResult,
  SettingKey,
  SafeUser,
  UserCreateInput,
  UserUpdatePatch,
  DraftDeleteResult
} from '../shared/types'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> =>
  ipcRenderer.invoke(channel, ...args).then((r) => r as IpcResult<T>)

const api = {
  app: {
    version: () => invoke<{ version: string; name: string; electron: string }>('app:version')
  },
  auth: {
    /** Verifies credentials in the MAIN process; returns the safe user record. */
    login: (username: string, password: string) => invoke<SafeUser>('auth:login', username, password),
    logout: () => invoke<boolean>('auth:logout'),
    currentUser: () => invoke<SafeUser | null>('auth:currentUser'),
    changeOwnPassword: (currentPassword: string, newPassword: string) =>
      invoke<boolean>('auth:changeOwnPassword', currentPassword, newPassword)
  },
  users: {
    list: () => invoke<SafeUser[]>('users:list'),
    create: (input: UserCreateInput) => invoke<SafeUser>('users:create', input),
    update: (id: number, patch: UserUpdatePatch) => invoke<SafeUser>('users:update', id, patch),
    remove: (id: number) => invoke<boolean>('users:delete', id)
  },
  drafts: {
    /** Billing months that are still drafts (any month/year, including previous months). */
    list: () => invoke<BillingPeriod[]>('drafts:list'),
    remove: (periodId: number) => invoke<DraftDeleteResult>('drafts:delete', periodId)
  },
  files: {
    /** Electron ≥ 32: renderer cannot read .path of dropped files; main-side bridge. */
    pathFor: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },
  settings: {
    get: () => invoke<AppSettings>('settings:get'),
    set: (patch: Partial<AppSettings>) => invoke<AppSettings>('settings:set', patch),
    pickExportFolder: () => invoke<AppSettings>('settings:pickExportFolder'),
    pickLogo: () => invoke<AppSettings>('settings:pickLogo'),
    removeLogo: () => invoke<AppSettings>('settings:removeLogo')
  },
  employees: {
    list: (search?: string) => invoke<Employee[]>('employees:list', search),
    create: (input: EmployeeInput) => invoke<Employee>('employees:create', input),
    update: (id: number, input: EmployeeInput) => invoke<Employee>('employees:update', id, input),
    remove: (id: number) => invoke<boolean>('employees:delete', id),
    setActive: (id: number, active: boolean) => invoke<Employee | null>('employees:setActive', id, active),
    pickAndImport: () => invoke<DirectoryImportResult>('employees:pickAndImport'),
    downloadTemplate: () => invoke<string>('employees:downloadTemplate')
  },
  periods: {
    list: () => invoke<BillingPeriod[]>('periods:list'),
    ensure: (month: number, year: number, title?: string | null) => invoke<BillingPeriod>('periods:ensure', month, year, title),
    update: (id: number, patch: { reportTitle?: string | null; reportDate?: string | null }) => invoke<BillingPeriod | null>('periods:update', id, patch),
    setBillingMonth: (id: number, month: number, year: number) => invoke<BillingPeriod>('periods:setBillingMonth', id, month, year),
    setPrepMonth: (id: number, month: number | null, year: number | null) => invoke<BillingPeriod>('periods:setPrepMonth', id, month, year),
    setPayableBefore: (id: number, isoDate: string | null) => invoke<BillingPeriod>('periods:setPayableBefore', id, isoDate),
    remove: (id: number) => invoke<boolean>('periods:delete', id),
    duplicate: (fromPeriodId: number, month: number, year: number, title?: string | null) =>
      invoke<{ period: BillingPeriod; copied: number }>('periods:duplicate', fromPeriodId, month, year, title)
  },
  bills: {
    pickFiles: () => invoke<string[]>('bills:pickFiles'),
    import: (periodId: number, paths: string[]) => invoke<ImportResult>('bills:import', periodId, paths),
    list: (periodId: number) => invoke<ImportedBill[]>('bills:list', periodId),
    rematch: (periodId?: number) => invoke<{ linked: number; promoted: number }>('bills:rematch', periodId),
    process: (billIds: number[]) => invoke<{ queued: number; message?: string }>('bills:process', billIds),
    retry: (billId: number) => invoke<{ queued: number; message?: string }>('bills:retry', billId),
    remove: (billId: number) => invoke<boolean>('bills:remove', billId),
    removeMany: (ids: number[]) => invoke<{ removed: number; failed: { id: number; reason: string }[] }>('bills:removeMany', ids),
    manual: (input: ManualBillInput) => invoke<ImportedBill>('bills:manual', input)
  },
  records: {
    list: (periodId: number) => invoke<BillRecord[]>('records:list', periodId),
    update: (id: number, patch: RecordUpdate) => invoke<BillRecord | null>('records:update', id, patch),
    remove: (id: number) => invoke<boolean>('records:remove', id),
    autoCalcGst: (id: number) => invoke<BillRecord | null>('records:autoCalcGst', id)
  },
  report: {
    snapshot: (periodId: number) => invoke<ReportSnapshot>('report:snapshot', periodId),
    totals: (periodId: number) => invoke<ReportTotals>('report:totals', periodId),
    issues: (periodId: number) => invoke<{ billId: number; fileName: string; reason: string }[]>('report:issues', periodId),
    finalize: (periodId: number, name: string, date: string) =>
      invoke<{ ok: true; entry: ReportHistoryEntry } | { ok: false; issues: { billId: number; fileName: string; reason: string }[] }>(
        'report:finalize',
        periodId,
        name,
        date
      ),
    preview: (args: { periodId?: number; snapshot?: ReportSnapshot }) => invoke<boolean>('report:preview', args),
    exportPdf: (args: { periodId?: number; snapshot?: ReportSnapshot; saveTo?: string | null }) => invoke<ExportResult>('report:exportPdf', args),
    exportXlsx: (args: { periodId?: number; snapshot?: ReportSnapshot; saveTo?: string | null }) => invoke<ExportResult>('report:exportXlsx', args),
    latestForPeriod: (periodId: number) => invoke<ReportSnapshot | null>('report:latestForPeriod', periodId)
  },
  history: {
    list: (search?: string) => invoke<ReportHistoryEntry[]>('history:list', search),
    get: (id: number) => invoke<{ entry: ReportHistoryEntry; snapshot: ReportSnapshot } | null>('history:get', id),
    snapshotForExport: (id: number) => invoke<ReportSnapshot>('history:snapshotForExport', id),
    remove: (id: number) => invoke<boolean>('history:delete', id)
  },
  dashboard: {
    stats: (periodId?: number | null) => invoke<DashboardStats>('dashboard:stats', periodId ?? null)
  },
  printWin: {
    print: () => invoke<boolean>('printwin:print'),
    close: () => invoke<boolean>('printwin:close')
  },
  events: {
    onBillsProgress: (cb: (e: BillProgressEvent) => void): (() => void) => {
      const h = (_ev: IpcRendererEvent, payload: BillProgressEvent): void => cb(payload)
      ipcRenderer.on('bills:progress', h)
      return () => ipcRenderer.removeListener('bills:progress', h)
    },
    onBillsChanged: (cb: (payload: { periodId?: number | null }) => void): (() => void) => {
      const h = (_ev: IpcRendererEvent, payload: { periodId?: number | null }): void => cb(payload ?? {})
      ipcRenderer.on('bills:changed', h)
      return () => ipcRenderer.removeListener('bills:changed', h)
    },
    onBatchDone: (cb: (payload: { processed: number; total: number }) => void): (() => void) => {
      const h = (_ev: IpcRendererEvent, payload: { processed: number; total: number }): void => cb(payload)
      ipcRenderer.on('bills:batch-done', h)
      return () => ipcRenderer.removeListener('bills:batch-done', h)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ExposedApi = typeof api
export type { ExtractOutcome, SettingKey }
