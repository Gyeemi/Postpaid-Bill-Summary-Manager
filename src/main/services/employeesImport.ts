/**
 * Bulk employee/SIM import from CSV or XLSX files. Column headers are matched
 * case-insensitively with common aliases. Rows with a known mobile number
 * update the existing directory entry; otherwise a new one is created.
 */
import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'
import type * as ExcelJS from 'exceljs'
import type { DirectoryImportResult, DirectoryImportRow } from '../../shared/types'
import { listEmployees, createEmployee, updateEmployee } from '../repositories/employees'
import { mobileMatchKey } from '../../shared/subscriber'

const ALIASES: Record<keyof DirectoryImportRow, string[]> = {
  title: ['title', 'salutation'],
  name: ['name', 'employee name', 'employee', 'username', 'subscriber', 'subscriber name'],
  designation: ['designation', 'role', 'post', 'position'],
  mobile: ['mobile', 'mobile number', 'number', 'cell', 'phone', 'gsm', 'msisdn'],
  simCategory: ['sim category', 'category', 'type', 'sim type'],
  department: ['department', 'dept', 'section', 'division'],
  isActive: ['active', 'status', 'active/inactive', 'active status']
}

function normalizeHeader(h: string): string {
  return String(h ?? '').toLowerCase().replace(/[_\-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function matchColumns(header: string[]): Partial<Record<keyof DirectoryImportRow, number>> {
  const idx: Partial<Record<keyof DirectoryImportRow, number>> = {}
  header.forEach((h, i) => {
    const n = normalizeHeader(h)
    for (const key of Object.keys(ALIASES) as (keyof DirectoryImportRow)[]) {
      if (idx[key] === undefined && ALIASES[key].includes(n)) idx[key] = i
    }
  })
  return idx
}

function rowsFromCsv(content: string): DirectoryImportRow[] {
  const parsed = Papa.parse<string[]>(content.trim(), { skipEmptyLines: 'greedy' })
  const data = parsed.data.filter((r) => Array.isArray(r))
  if (data.length < 2) return []
  const cols = matchColumns(data[0].map(String))
  const out: DirectoryImportRow[] = []
  for (let i = 1; i < data.length; i++) {
    const r = data[i]
    const cell = (k: keyof DirectoryImportRow): string | undefined => {
      const j = cols[k]
      return j === undefined || r[j] === undefined ? undefined : String(r[j]).trim() || undefined
    }
    out.push({
      title: cell('title'),
      name: cell('name'),
      designation: cell('designation'),
      mobile: cell('mobile'),
      simCategory: cell('simCategory'),
      department: cell('department'),
      isActive: cell('isActive')
    })
  }
  return out
}

async function rowsFromXlsx(filePath: string): Promise<DirectoryImportRow[]> {
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'))
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = wb.worksheets[0]
  if (!ws || ws.rowCount < 2) return []
  const header: string[] = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => {
    header[i - 1] = String(c.value ?? '')
  })
  const cols = matchColumns(header)
  const val = (row: ExcelJS.Row, k: keyof DirectoryImportRow): string | undefined => {
    const j = cols[k]
    if (j === undefined) return undefined
    const cell = row.getCell(j + 1)
    let v: unknown = cell?.value
    if (v && typeof v === 'object' && 'result' in (v as Record<string, unknown>)) v = (v as { result?: unknown }).result
    if (v === null || v === undefined) return undefined
    if (v instanceof Date) return undefined
    const s = String(v).trim()
    return s || undefined
  }
  const out: DirectoryImportRow[] = []
  ws.eachRow((row, n) => {
    if (n === 1) return
    out.push({
      title: val(row, 'title'),
      name: val(row, 'name'),
      designation: val(row, 'designation'),
      mobile: val(row, 'mobile'),
      simCategory: val(row, 'simCategory'),
      department: val(row, 'department'),
      isActive: val(row, 'isActive')
    })
  })
  return out
}

export async function importEmployeesFile(filePath: string): Promise<DirectoryImportResult> {
  const ext = path.extname(filePath).toLowerCase()
  let rows: DirectoryImportRow[]
  if (ext === '.csv' || ext === '.txt') {
    rows = rowsFromCsv(fs.readFileSync(filePath, 'utf8'))
  } else if (ext === '.xlsx' || ext === '.xlsm') {
    rows = await rowsFromXlsx(filePath)
  } else {
    throw new Error('Only .csv or .xlsx files can be imported. Export the employee sheet as CSV or Excel (.xlsx).')
  }
  if (rows.length === 0) throw new Error('No data rows were found. The first row must contain headers like: Name, Designation, Mobile Number.')
  if (rows.length > 5000) throw new Error('Too many rows (' + rows.length + '). Please keep imports under 5000 records.')

  const result: DirectoryImportResult = { added: 0, updated: 0, failed: [] }
  const byKey = new Map<string, number>()
  for (const e of listEmployees()) {
    const k = mobileMatchKey(e.mobile)
    if (k) byKey.set(k, e.id)
  }
  rows.forEach((r, i) => {
    const rowNo = i + 2 // header is line 1 in the sheet
    try {
      if (!r.name && !r.mobile) throw new Error('row is empty')
      const key = mobileMatchKey(r.mobile ?? null)
      const isActiveRaw = String(r.isActive ?? '').toLowerCase()
      const isActive = !(isActiveRaw === 'inactive' || isActiveRaw === 'no' || isActiveRaw === '0' || isActiveRaw === 'n')
      const payload = {
        title: r.title ?? null,
        name: (r.name ?? r.mobile ?? 'Unnamed').trim(),
        designation: r.designation ?? null,
        mobile: r.mobile ?? null,
        simCategory: r.simCategory ?? (r.name ? 'Personal' : 'Data Card'),
        department: r.department ?? null,
        isActive
      }
      if (key && byKey.has(key)) {
        updateEmployee(byKey.get(key)!, payload)
        result.updated++
      } else {
        const created = createEmployee(payload)
        if (key) byKey.set(key, created.id)
        result.added++
      }
    } catch (err) {
      result.failed.push({ row: rowNo, reason: (err as Error).message })
    }
  })
  return result
}

export function employeeCsvTemplate(): string {
  return [
    'Title,Name,Designation,Mobile Number,SIM Category,Department,Active',
    'Mr.,A K Basu Mullick,Sr. General Manager,77100802,Corporate,Management,Yes',
    'Mrs.,Dechen Wangmo,Sale EXC,77109949,Personal,Sales,Yes',
    ',TBL,Data Card,77118695,Data Card,IT,Yes',
    ',Boiler SIM,Boiler Section,77110011,Departmental,Operations,Yes'
  ].join('\r\n')
}
