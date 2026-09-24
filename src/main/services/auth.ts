/**
 * Authentication session — lives entirely in the Electron main process.
 * The renderer only ever sees SafeUser objects; hashes and credentials are
 * verified here and nowhere else. The session is in-memory, so restarting
 * the app always requires a fresh sign-in.
 */
import bcrypt from 'bcryptjs'
import type { SafeUser, UserRole } from '../../shared/types'
import { findUserByUsername, getUserRow, toSafeUser } from '../repositories/users'

let sessionUserId: number | null = null

export function login(username: string, password: string): SafeUser {
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new Error('Invalid username or password')
  }
  const row = findUserByUsername(username.trim())
  // Uniform error for unknown user vs wrong password (no user enumeration).
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    throw new Error('Invalid username or password')
  }
  if (!row.is_active) throw new Error('This account has been deactivated. Contact an administrator.')
  sessionUserId = row.id
  console.log(`[auth] user "${row.username}" signed in`)
  return toSafeUser(row)
}

export function logout(): void {
  if (sessionUserId !== null) {
    const row = getUserRow(sessionUserId)
    console.log(`[auth] user "${row?.username ?? sessionUserId}" signed out`)
  }
  sessionUserId = null
}

export function currentUser(): SafeUser | null {
  if (sessionUserId === null) return null
  const row = getUserRow(sessionUserId)
  if (!row || !row.is_active) {
    // account was deleted or deactivated mid-session → force sign-out
    sessionUserId = null
    return null
  }
  return toSafeUser(row)
}

/** Throws unless a user is signed in. Used to guard every data IPC channel. */
export function requireAuth(): SafeUser {
  const u = currentUser()
  if (!u) throw new Error('Not signed in — please sign in first')
  return u
}

/** Throws unless the signed-in user has one of the given roles. */
export function requireRole(roles: UserRole[]): SafeUser {
  const u = requireAuth()
  if (!roles.includes(u.role)) throw new Error('Administrator access required')
  return u
}
