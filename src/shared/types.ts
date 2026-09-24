/**
 * Shared domain types used by the Electron main process, the preload bridge and
 * the React renderer. All monetary values are transported as **integer minor
 * units (chhatrum, 1/100 Nu.)** to avoid floating point drift.
 */

export type ExtractionStatus = 'pending' | 'processing' | 'extracted' | 'needs_review' | 'failed'

export type SimCategory = 'Personal' | 'Data Card' | 'Corporate' | 'Departmental' | 'Other'

export interface Employee {
  id: number
  title: string | null // Mr. | Mrs. | Ms. | '' (null)
  name: string
  designation: string | null
  mobile: string | null // as displayed, e.g. 77100802
  simCategory: SimCategory | string
  department: string | null
  isActive: boolean
  notes: string | null
  createdAt: string
  updatedAt: string | null
}

export interface EmployeeInput {
  title?: string | null
  name: string
  designation?: string | null
  mobile?: string | null
  simCategory?: string | null
  department?: string | null
  isActive?: boolean
  notes?: string | null
}

export interface BillingPeriod {
  id: number
  /** ACTUAL billing month — the month the imported postpaid bills belong to.
   *  Never auto-derived from today's date; chosen by the user. */
  month: number // 1-12
  year: number
  /** Legacy BILL PREPARATION month — kept for old DBs, no longer used in UI. */
  prepMonth: number | null
  prepYear: number | null
  /** Payable Before date — manually chosen via calendar, stored ISO yyyy-mm-dd, displayed DD|MM|YYYY */
  payableBefore: string | null
  reportTitle: string | null
  reportDate: string | null // ISO yyyy-mm-dd
  status: 'draft' | 'finalized'
  createdAt: string
  updatedAt: string | null
  billCount: number
}

export interface ImportFileEntry {
  path: string
  fileName: string
}

/** Immutable record of what was extracted from the PDF itself. */
export interface ImportedBill {
  id: number
  periodId: number
  originalFilename: string
  storedPath: string | null
  originalPath: string | null
  subscriberName: string | null // initial value = filename without .pdf (report number removed)
  detectedTitle: string | null
  detectedName: string | null
  srFromFilename: number | null // leading "01." in the filename -> Sr. No on report rows
  mobileNumber: string | null
  // extracted values (minor units; null = not found)
  outstanding: number | null
  penalty: number | null
  billAmount: number | null
  gst: number | null
  creditsDebits: number | null
  totalPayable: number | null
  extractionStatus: ExtractionStatus
  errorMessage: string | null
  fieldEvidence: Record<string, string> | null
  mobileCandidates: string[]
  ocrUsed: boolean
  summaryPage: number | null
  suggestedMonth: number | null
  suggestedYear: number | null
  isManual: boolean
  duplicateOf: number | null
  processedAt: string | null
  createdAt: string
}

/** Editable working copy that feeds the Bill Summary Report. */
export interface BillRecord {
  id: number
  billId: number
  employeeId: number | null
  periodId: number
  title: string | null
  username: string | null
  designation: string | null
  mobileNumber: string | null
  srFromFilename: number | null // from the linked bill's filename
  basicAmount: number | null // chh
  gst: number | null
  outstanding: number | null // chh — Account Summary lines carried onto the report row
  penalty: number | null
  creditsDebits: number | null
  totalAmount: number | null
  deduction: number // chh
  includeInReport: boolean
  // reference data joined from imported_bills
  bill: ImportedBill | null
  extractionStatus: ExtractionStatus
  isManual: boolean
  reviewed: boolean
  warnings: string[]
  // derived
  mismatchChh: number | null // (bill + gst + outstanding + penalty + credits) - total ; null if cannot evaluate
}

export interface RecordUpdate {
  employeeId?: number | null
  title?: string | null
  username?: string | null
  designation?: string | null
  mobileNumber?: string | null
  basicAmount?: number | null
  gst?: number | null
  outstanding?: number | null
  penalty?: number | null
  creditsDebits?: number | null
  totalAmount?: number | null
  deduction?: number | null
  includeInReport?: boolean
  markReviewed?: boolean // clears 'needs_review' after user confirmation
}

export interface ReportTotals {
  basic: number
  gst: number
  total: number
  deduction: number
  count: number
  /** optional so pre-v3 snapshots stored in history still type-load */
  outstanding?: number
  penalty?: number
  credits?: number
}

export interface ReportSnapshotRow {
  sr?: string | null // pre-computed display Sr ("01"); exports fall back to position when null
  title: string | null
  username: string | null
  designation: string | null
  mobile: string | null
  basic: number | null
  gst: number | null
  total: number | null
  deduction: number
  /** Account Summary breakdown (optional: older finalized snapshots lack it) */
  outstanding?: number | null
  penalty?: number | null
  credits?: number | null
}

export interface ReportSnapshot {
  orgName: string
  orgSub: string
  orgLogoPath: string | null
  gstRate: number
  footerText: string | null
  currency: string
  reportTitle: string
  periodLabel: string
  /** explicit labels so a report can show "Billing Month" and "Payable Before"
   *  independently; fall back to periodLabel when absent */
  billingLabel?: string | null
  prepLabel?: string | null // legacy, kept for old history entries
  payableBefore?: string | null // ISO yyyy-mm-dd
  payableBeforeFormatted?: string | null // DD|MM|YYYY e.g. 30|09|2026
  reportDate: string
  generatedAt: string
  rows: ReportSnapshotRow[]
  totals: ReportTotals
}

export interface ReportHistoryEntry {
  id: number
  periodId: number
  periodLabel: string
  prepLabel: string // legacy bill preparation month; '' when not set
  payableBefore?: string | null // ISO
  payableBeforeFormatted?: string | null // DD|MM|YYYY
  reportName: string
  reportDate: string | null
  rowCount: number
  grandTotalPayable: number | null
  createdAt: string
  modifiedAt: string | null
}

export interface DashboardStats {
  periodId: number | null
  periodLabel: string | null
  totalBills: number
  totalPayable: number
  totalGst: number
  totalDeductions: number
  extractionIssues: number
  recentReports: ReportHistoryEntry[]
  periodOptions: { id: number; label: string }[]
}

export type AppSettings = {
  orgName: string
  orgLogoPath: string | null
  currency: string
  gstRatePercent: number
  exportFolder: string | null
  theme: 'light' | 'dark'
  autoCalcGst: boolean
  defaultMonth: number | null
  defaultYear: number | null
  footerText: string
}

export type SettingKey = keyof AppSettings

export interface BillProgressEvent {
  billId: number
  fileName: string
  status: ExtractionStatus
  message?: string
  processed: number
  total: number
}

export interface ImportResult {
  imported: { billId: number; fileName: string }[]
  skipped: { fileName: string; reason: string }[]
  errors: { fileName: string; reason: string }[]
}

/** Result of a multi-select bulk removal (imported bills). */
export interface BulkRemoveResult {
  removed: number
  failed: { id: number; reason: string }[]
}

export interface IpcResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

/** Fields a manual-entry bill needs (all optional except the core three). */
export interface ManualBillInput {
  periodId: number
  subscriberName: string
  originalFilename?: string | null
  mobileNumber?: string | null
  basicAmount: number | null
  gst: number | null
  totalAmount: number | null
  outstanding?: number | null
  penalty?: number | null
  creditsDebits?: number | null
}

export interface DirectoryImportRow {
  title?: string
  name?: string
  designation?: string
  mobile?: string
  simCategory?: string
  department?: string
  isActive?: string | boolean
}

export interface DirectoryImportResult {
  added: number
  updated: number
  failed: { row: number; reason: string }[]
}

export interface ExportResult {
  saved: boolean
  path?: string | null
  message?: string
}

export interface PrintPayload {
  /** report snapshot data; main builds the HTML identically to PDF export */
  snapshot: ReportSnapshot
  mode: 'preview' | 'export-pdf'
  savePath?: string // for export-pdf when user chose a path already
}

/** One text layer page: 1-based page number + newline-separated lines. */
export interface PageText {
  page: number
  text: string
}

/** Result returned by the PDF extractor worker for a single file. */
export interface ExtractOutcome {
  status: ExtractionStatus
  outstanding: number | null
  penalty: number | null
  billAmount: number | null
  gst: number | null
  creditsDebits: number | null
  totalPayable: number | null
  mobileNumber: string | null
  mobileCandidates: string[]
  /** number read positionally under "Service Number" in the page-1 Bill Summary */
  serviceNumber?: string | null
  /** provenance of mobileNumber for the reviewer */
  mobileSource?: 'service-number' | 'label-fallback' | 'none'
  evidence: Record<string, string>
  warnings: string[]
  error: string | null
  ocrUsed: boolean
  summaryPage: number | null
  suggestedMonth: number | null
  suggestedYear: number | null
  textLength: number
}

/* ------------------------------------------------------------------ users */
export type UserRole = 'admin' | 'standard'

/** User record safe to expose to the renderer (never includes the hash). */
export interface SafeUser {
  id: number
  username: string
  role: UserRole
  isActive: boolean
  createdAt: string
  updatedAt: string | null
}

export interface UserCreateInput {
  username: string
  password: string
  role: UserRole
  isActive?: boolean
}

export interface UserUpdatePatch {
  username?: string
  password?: string
  role?: UserRole
  isActive?: boolean
}

/** Result of deleting a draft billing month (previous months included). */
export interface DraftDeleteResult {
  periodId: number
  label: string
  billsDeleted: number
}
