/**
 * Local user accounts. Passwords are stored ONLY as bcrypt hashes in the
 * users table — plain-text passwords never touch the database and never
 * leave the main process.
 */
import bcrypt from 'bcryptjs'
import { getDb } from '../db'
import type { SafeUser, UserCreateInput, UserUpdatePatch, UserRole } from '../../shared/types'

const BCRYPT_ROUNDS = 10
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/

interface UserRow {
  id: number
  username: string
  password_hash: string
  role: UserRole
  is_active: number
  created_at: string
  updated_at: string | null
}

export function toSafeUser(row: UserRow): SafeUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function getUserRow(id: number): UserRow | undefined {
  return getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined
}

export function findUserByUsername(username: string): UserRow | undefined {
  return getDb().prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`).get(username) as UserRow | undefined
}

export function listUsers(): SafeUser[] {
  const rows = getDb().prepare(`SELECT * FROM users ORDER BY id`).all() as UserRow[]
  return rows.map(toSafeUser)
}

/**
 * Creates the default administrator on a brand-new database. Called once at
 * startup; does nothing once any user exists.
 */
export function ensureDefaultAdmin(): void {
  const db = getDb()
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n
  if (n > 0) return
  db.prepare(`INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, 'admin', 1)`).run(
    'admin',
    bcrypt.hashSync('admin123', BCRYPT_ROUNDS)
  )
  console.log('[db] created default administrator account: admin / admin123')
}

function validateUsername(username: string): string {
  const u = username.trim()
  if (!USERNAME_RE.test(u)) throw new Error('Username must be 3–32 characters (letters, numbers, dot, underscore, hyphen)')
  return u
}

function validatePassword(password: string): void {
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    throw new Error('Password must be at least 6 characters')
  }
}

export function createUser(input: UserCreateInput): SafeUser {
  const username = validateUsername(input.username)
  validatePassword(input.password)
  const role: UserRole = input.role === 'admin' ? 'admin' : 'standard'
  if (findUserByUsername(username)) throw new Error(`Username "${username}" already exists`)
  const db = getDb()
  const info = db
    .prepare(`INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, ?)`)
    .run(username, bcrypt.hashSync(input.password, BCRYPT_ROUNDS), role, input.isActive === false ? 0 : 1)
  return toSafeUser(getUserRow(Number(info.lastInsertRowid)) as UserRow)
}

export function updateUser(id: number, patch: UserUpdatePatch, actorId: number): SafeUser {
  const db = getDb()
  const row = getUserRow(id)
  if (!row) throw new Error('User not found')

  if (patch.username !== undefined) {
    const username = validateUsername(patch.username)
    const clash = findUserByUsername(username)
    if (clash && clash.id !== id) throw new Error(`Username "${username}" already exists`)
    db.prepare(`UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?`).run(username, id)
  }
  if (patch.password !== undefined) {
    validatePassword(patch.password)
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
      bcrypt.hashSync(patch.password, BCRYPT_ROUNDS),
      id
    )
  }
  if (patch.role !== undefined) {
    const role: UserRole = patch.role === 'admin' ? 'admin' : 'standard'
    if (row.role === 'admin' && role === 'standard') {
      const admins = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1`).get() as { n: number }).n
      if (admins <= 1 && row.is_active) throw new Error('Cannot demote the last active administrator')
    }
    db.prepare(`UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?`).run(role, id)
  }
  if (patch.isActive !== undefined) {
    if (!patch.isActive) {
      if (id === actorId) throw new Error('You cannot deactivate your own account')
      if (row.role === 'admin') {
        const admins = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1`).get() as { n: number }).n
        if (admins <= 1) throw new Error('Cannot deactivate the last active administrator')
      }
    }
    db.prepare(`UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?`).run(patch.isActive ? 1 : 0, id)
  }
  return toSafeUser(getUserRow(id) as UserRow)
}

export function deleteUser(id: number, actorId: number): void {
  const db = getDb()
  const row = getUserRow(id)
  if (!row) throw new Error('User not found')
  if (id === actorId) throw new Error('You cannot delete your own account')
  if (row.role === 'admin') {
    const admins = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1`).get() as { n: number }).n
    if (admins <= 1 && row.is_active) throw new Error('Cannot delete the last active administrator')
  }
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id)
}

export function changeOwnPassword(actorId: number, newPassword: string): void {
  validatePassword(newPassword)
  getDb()
    .prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(bcrypt.hashSync(newPassword, BCRYPT_ROUNDS), actorId)
}

/** Verifies a password against the stored bcrypt hash (never compares plain text). */
export function verifyPassword(id: number, password: string): boolean {
  const row = getUserRow(id)
  if (!row) return false
  try {
    return bcrypt.compareSync(password, row.password_hash)
  } catch {
    return false
  }
}
