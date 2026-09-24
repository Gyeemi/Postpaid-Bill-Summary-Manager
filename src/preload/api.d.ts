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
  IpcResult,
  ManualBillInput,
  ImportedBill,
  RecordUpdate,
  ReportHistoryEntry,
  ReportSnapshot,
  ReportTotals,
  ImportResult,
  BulkRemoveResult,
  SafeUser,
  UserCreateInput,
  UserUpdatePatch,
  DraftDeleteResult
} from '../shared/types'

/** Type augmentation for the API exposed by the preload script. */
declare global {
  interface Window {
    api: {
      app: { version(): Promise<IpcResult<{ version: string; name: string; electron: string }>> }
      files: { pathFor(file: File): string }
      settings: {
        get(): Promise<IpcResult<AppSettings>>
        set(patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
        pickExportFolder(): Promise<IpcResult<AppSettings>>
        pickLogo(): Promise<IpcResult<AppSettings>>
        removeLogo(): Promise<IpcResult<AppSettings>>
      }
      employees: {
        list(search?: string): Promise<IpcResult<Employee[]>>
        create(input: EmployeeInput): Promise<IpcResult<Employee>>
        update(id: number, input: EmployeeInput): Promise<IpcResult<Employee>>
        remove(id: number): Promise<IpcResult<boolean>>
        setActive(id: number, active: boolean): Promise<IpcResult<Employee | null>>
        pickAndImport(): Promise<IpcResult<DirectoryImportResult>>
        downloadTemplate(): Promise<IpcResult<string>>
      }
      periods: {
        list(): Promise<IpcResult<BillingPeriod[]>>
        ensure(month: number, year: number, title?: string | null): Promise<IpcResult<BillingPeriod>>
        update(id: number, patch: { reportTitle?: string | null; reportDate?: string | null }): Promise<IpcResult<BillingPeriod | null>>
        setBillingMonth(id: number, month: number, year: number): Promise<IpcResult<BillingPeriod>>
        setPrepMonth(id: number, month: number | null, year: number | null): Promise<IpcResult<BillingPeriod>>
        setPayableBefore(id: number, isoDate: string | null): Promise<IpcResult<BillingPeriod>>
        remove(id: number): Promise<IpcResult<boolean>>
        duplicate(
          fromPeriodId: number,
          month: number,
          year: number,
          title?: string | null
        ): Promise<IpcResult<{ period: BillingPeriod; copied: number }>>
      }
      bills: {
        pickFiles(): Promise<IpcResult<string[]>>
        import(periodId: number, paths: string[]): Promise<IpcResult<ImportResult>>
        list(periodId: number): Promise<IpcResult<ImportedBill[]>>
        rematch(periodId?: number): Promise<IpcResult<{ linked: number; promoted: number }>>
        process(billIds: number[]): Promise<IpcResult<{ queued: number; message?: string }>>
        retry(billId: number): Promise<IpcResult<{ queued: number; message?: string }>>
        remove(billId: number): Promise<IpcResult<boolean>>
        removeMany(ids: number[]): Promise<IpcResult<BulkRemoveResult>>
        manual(input: ManualBillInput): Promise<IpcResult<ImportedBill>>
      }
      auth: {
        login(username: string, password: string): Promise<IpcResult<SafeUser>>
        logout(): Promise<IpcResult<boolean>>
        currentUser(): Promise<IpcResult<SafeUser | null>>
        changeOwnPassword(currentPassword: string, newPassword: string): Promise<IpcResult<boolean>>
      }
      users: {
        list(): Promise<IpcResult<SafeUser[]>>
        create(input: UserCreateInput): Promise<IpcResult<SafeUser>>
        update(id: number, patch: UserUpdatePatch): Promise<IpcResult<SafeUser>>
        remove(id: number): Promise<IpcResult<boolean>>
      }
      drafts: {
        list(): Promise<IpcResult<BillingPeriod[]>>
        remove(periodId: number): Promise<IpcResult<DraftDeleteResult>>
      }
      records: {
        list(periodId: number): Promise<IpcResult<BillRecord[]>>
        update(id: number, patch: RecordUpdate): Promise<IpcResult<BillRecord | null>>
        remove(id: number): Promise<IpcResult<boolean>>
        autoCalcGst(id: number): Promise<IpcResult<BillRecord | null>>
      }
      report: {
        snapshot(periodId: number): Promise<IpcResult<ReportSnapshot>>
        totals(periodId: number): Promise<IpcResult<ReportTotals>>
        issues(periodId: number): Promise<IpcResult<{ billId: number; fileName: string; reason: string }[]>>
        finalize(
          periodId: number,
          name: string,
          date: string
        ): Promise<IpcResult<{ ok: true; entry: ReportHistoryEntry } | { ok: false; issues: { billId: number; fileName: string; reason: string }[] }>>
        preview(args: { periodId?: number; snapshot?: ReportSnapshot }): Promise<IpcResult<boolean>>
        exportPdf(args: { periodId?: number; snapshot?: ReportSnapshot; saveTo?: string | null }): Promise<IpcResult<ExportResult>>
        exportXlsx(args: { periodId?: number; snapshot?: ReportSnapshot; saveTo?: string | null }): Promise<IpcResult<ExportResult>>
        latestForPeriod(periodId: number): Promise<IpcResult<ReportSnapshot | null>>
      }
      history: {
        list(search?: string): Promise<IpcResult<ReportHistoryEntry[]>>
        get(id: number): Promise<IpcResult<{ entry: ReportHistoryEntry; snapshot: ReportSnapshot } | null>>
        snapshotForExport(id: number): Promise<IpcResult<ReportSnapshot>>
        remove(id: number): Promise<IpcResult<boolean>>
      }
      dashboard: {
        stats(periodId?: number | null): Promise<IpcResult<DashboardStats>>
      }
      printWin: {
        print(): Promise<IpcResult<boolean>>
        close(): Promise<IpcResult<boolean>>
      }
      events: {
        onBillsProgress(cb: (e: BillProgressEvent) => void): () => void
        onBillsChanged(cb: (payload: { periodId?: number | null }) => void): () => void
        onBatchDone(cb: (payload: { processed: number; total: number }) => void): () => void
      }
    }
  }
}

export {}
