import { getDb } from '../db'
import type { Employee, EmployeeInput } from '../../shared/types'
import { mobileMatchKey, personNameKey, personNamesMatch } from '../../shared/subscriber'

interface EmpRow {
  id: number
  title: string | null
  name: string
  designation: string | null
  mobile: string | null
  sim_category: string
  department: string | null
  is_active: number
  notes: string | null
  created_at: string
  updated_at: string | null
}

function map(r: EmpRow): Employee {
  return {
    id: r.id,
    title: r.title,
    name: r.name,
    designation: r.designation,
    mobile: r.mobile,
    simCategory: r.sim_category,
    department: r.department,
    isActive: !!r.is_active,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listEmployees(search?: string): Employee[] {
  const db = getDb()
  if (search && search.trim()) {
    const like = `%${search.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`
    return (
      db
        .prepare(
          `SELECT * FROM employees
           WHERE name LIKE ? ESCAPE '\\' OR IFNULL(designation,'') LIKE ? ESCAPE '\\'
              OR IFNULL(mobile,'') LIKE ? ESCAPE '\\' OR IFNULL(department,'') LIKE ? ESCAPE '\\'
           ORDER BY name COLLATE NOCASE`
        )
        .all(like, like, like, like) as EmpRow[]
    ).map(map)
  }
  return (db.prepare(`SELECT * FROM employees ORDER BY name COLLATE NOCASE`).all() as EmpRow[]).map(map)
}

export function getEmployee(id: number): Employee | null {
  const r = getDb().prepare(`SELECT * FROM employees WHERE id = ?`).get(id) as EmpRow | undefined
  return r ? map(r) : null
}

export function findEmployeeByMobile(mobile: string | null | undefined): Employee | null {
  const key = mobileMatchKey(mobile)
  if (!key) return null
  const r = getDb().prepare(`SELECT * FROM employees WHERE mobile_key = ? AND is_active = 1`).get(key) as EmpRow | undefined
  return r ? map(r) : null
}

/**
 * Directory lookup by subscriber NAME (the authoritative way to find whose bill
 * this is: the PDF filename identifies the subscriber, the directory owns the
 * number). Returns the unique match, or the candidate list when ambiguous.
 */
export function findEmployeeByNameMatch(
  name: string | null | undefined
): { employee: Employee | null; candidates: Employee[] } {
  const key = personNameKey(name)
  if (!key) return { employee: null, candidates: [] }
  const rows = (getDb().prepare(`SELECT * FROM employees WHERE is_active = 1 ORDER BY name COLLATE NOCASE`).all() as EmpRow[]).map(map)
  const exact = rows.filter((e) => personNameKey(e.name) === key)
  if (exact.length === 1) return { employee: exact[0], candidates: exact }
  if (exact.length > 1) return { employee: null, candidates: exact }
  const loose = rows.filter((e) => personNamesMatch(name, e.name))
  if (loose.length === 1) return { employee: loose[0], candidates: loose }
  return { employee: null, candidates: loose }
}

class DuplicateMobileError extends Error {}

export function createEmployee(input: EmployeeInput): Employee {
  const db = getDb()
  const key = mobileMatchKey(input.mobile)
  try {
    return db.transaction(() => {
      if (key) {
        const clash = db.prepare(`SELECT id FROM employees WHERE mobile_key = ?`).get(key) as { id: number } | undefined
        if (clash) throw new DuplicateMobileError(`Mobile number ${key} is already used by another directory entry`)
      }
      const info = db
        .prepare(
          `INSERT INTO employees (title, name, designation, mobile, mobile_key, sim_category, department, is_active, notes)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
        .run(
          input.title || null,
          input.name.trim(),
          input.designation || null,
          input.mobile?.trim() || null,
          key,
          input.simCategory || 'Personal',
          input.department || null,
          input.isActive === false ? 0 : 1,
          input.notes || null
        )
      return getEmployee(Number(info.lastInsertRowid))!
    })()
  } catch (err) {
    if (err instanceof DuplicateMobileError) throw new Error(err.message)
    throw new Error(`Could not save employee: ${(err as Error).message}`)
  }
}

export function updateEmployee(id: number, input: EmployeeInput): Employee {
  const db = getDb()
  const key = mobileMatchKey(input.mobile)
  try {
    return db.transaction(() => {
      if (key) {
        const clash = db.prepare(`SELECT id FROM employees WHERE mobile_key = ? AND id != ?`).get(key, id) as { id: number } | undefined
        if (clash) throw new DuplicateMobileError(`Mobile number ${key} is already used by another directory entry`)
      }
      db.prepare(
        `UPDATE employees SET title=?, name=?, designation=?, mobile=?, mobile_key=?, sim_category=?, department=?, is_active=?, notes=?, updated_at=datetime('now')
         WHERE id=?`
      ).run(
        input.title || null,
        input.name.trim(),
        input.designation || null,
        input.mobile?.trim() || null,
        key,
        input.simCategory || 'Personal',
        input.department || null,
        input.isActive === false ? 0 : 1,
        input.notes || null,
        id
      )
      return getEmployee(id)!
    })()
  } catch (err) {
    if (err instanceof DuplicateMobileError) throw new Error(err.message)
    throw new Error(`Could not update employee: ${(err as Error).message}`)
  }
}

export function deleteEmployee(id: number): void {
  getDb().prepare(`DELETE FROM employees WHERE id = ?`).run(id)
}

export function setEmployeeActive(id: number, active: boolean): Employee | null {
  getDb()
    .prepare(`UPDATE employees SET is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(active ? 1 : 0, id)
  return getEmployee(id)
}
