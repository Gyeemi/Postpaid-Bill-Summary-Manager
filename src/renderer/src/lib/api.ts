/** Unwraps {ok,data|error} IPC results; throws with a readable message on failure. */
import type { IpcResult } from '../../../shared/types'

export async function call<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const res = await p
  if (!res || res.ok !== true) {
    throw new Error(res?.error ?? 'Unexpected application error')
  }
  return res.data as T
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
