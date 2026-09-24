/**
 * User Management — administrator only. Create users, change usernames,
 * reset passwords, activate/deactivate and delete accounts, and assign the
 * Administrator / Standard User role. The server side enforces the same rules
 * (last active administrator, no self-deletion), so the UI cannot be bypassed.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { KeyRound, Pencil, ShieldCheck, Trash2, UserCheck, UserPlus, UserX, Users as UsersIcon } from 'lucide-react'
import { useApp } from '../state/store'
import { call, errMsg } from '../lib/api'
import { Confirm, EmptyState, Field, Modal, Spinner } from '../components/ui'
import type { SafeUser, UserRole } from '../../../shared/types'

export default function UsersView(): React.JSX.Element {
  const { notify, user } = useApp()
  const [list, setList] = useState<SafeUser[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<SafeUser | null>(null)
  const [resetting, setResetting] = useState<SafeUser | null>(null)
  const [confirmDel, setConfirmDel] = useState<SafeUser | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    try {
      setList(await call(window.api.users.list()))
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }, [notify])

  useEffect(() => {
    void reload()
  }, [reload])

  const status = list?.filter((u) => u.isActive).length ?? 0

  return (
    <div className="flex flex-col gap-4 max-w-[1100px]">
      <div className="card p-4 flex items-start gap-3">
        <div className="rounded-lg flex items-center justify-center shrink-0" style={{ width: 38, height: 38, background: '#e7eff8' }}>
          <ShieldCheck size={19} color="#2f6db3" />
        </div>
        <div className="flex-1">
          <div className="font-bold text-[14px]">Secure user accounts</div>
          <div className="text-[12.5px] mt-1" style={{ color: 'var(--mut)' }}>
            Passwords are stored only as bcrypt hashes inside the local SQLite database. Administrators have full access;
            Standard Users can import bills, review/edit drafts and view reports, but cannot manage users or change
            organization settings.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <UserPlus size={15} /> New user
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ borderColor: 'var(--line)' }}>
          <UsersIcon size={16} color="#2f6db3" />
          <div className="font-bold text-[13.5px]">Accounts</div>
          <div className="ml-auto text-[12px]" style={{ color: 'var(--mut)' }}>
            {list ? `${list.length} account${list.length === 1 ? '' : 's'} · ${status} active` : ''}
          </div>
        </div>
        {!list ? (
          <div className="p-8 text-center"><Spinner label="Loading accounts…" /></div>
        ) : list.length === 0 ? (
          <EmptyState icon={<UsersIcon size={26} />} title="No accounts" body="Create the first administrator account." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Username</th>
                <th style={{ width: 160 }}>Role</th>
                <th style={{ width: 120 }}>Status</th>
                <th style={{ width: 150 }}>Created</th>
                <th style={{ width: 210 }}></th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="font-semibold">
                      {u.username}
                      {user?.id === u.id && (
                        <span className="badge badge-ok" style={{ marginLeft: 8 }}>you</span>
                      )}
                    </div>
                    {u.updatedAt && (
                      <div className="text-[11px]" style={{ color: 'var(--mut)' }}>updated {u.updatedAt.slice(0, 10)}</div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'badge-ok' : ''}`}>
                      {u.role === 'admin' ? 'Administrator' : 'Standard User'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${u.isActive ? 'badge-ok' : 'badge-warn'}`}>
                      {u.isActive ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td className="text-[12px]">{u.createdAt.slice(0, 10)}</td>
                  <td>
                    <div className="flex gap-1 justify-end">
                      <button className="btn btn-sm" title="Change username, role or status" onClick={() => setEditing(u)}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn-sm" title="Reset password" onClick={() => setResetting(u)}>
                        <KeyRound size={13} />
                      </button>
                      <button
                        className="btn btn-sm"
                        title={u.isActive ? 'Deactivate account' : 'Activate account'}
                        onClick={() => void toggleActive(u)}
                      >
                        {u.isActive ? <UserX size={13} /> : <UserCheck size={13} />}
                      </button>
                      <button className="btn btn-sm" title="Delete account" onClick={() => setConfirmDel(u)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <UserForm
          mode="create"
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            void reload()
          }}
        />
      )}
      {editing && (
        <UserForm
          mode="edit"
          target={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}
      {resetting && (
        <PasswordForm
          target={resetting}
          onClose={() => setResetting(null)}
          onDone={() => {
            setResetting(null)
            void reload()
          }}
        />
      )}
      {confirmDel && (
        <Confirm
          danger
          title="Delete user account"
          confirmLabel="Delete account"
          body={
            <>
              Delete the account <b>{confirmDel.username}</b>? That person will no longer be able to sign in. Bills,
              reports and the employee directory are not affected.
            </>
          }
          onConfirm={async () => {
            try {
              await call(window.api.users.remove(confirmDel.id))
              notify(`Account “${confirmDel.username}” deleted.`, 'ok')
              setConfirmDel(null)
              await reload()
            } catch (err) {
              notify(errMsg(err), 'err')
            }
          }}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  )

  async function toggleActive(u: SafeUser): Promise<void> {
    try {
      await call(window.api.users.update(u.id, { isActive: !u.isActive }))
      notify(`${u.username} ${u.isActive ? 'deactivated' : 'activated'}.`, 'ok')
      await reload()
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }
}

function UserForm({
  mode,
  target,
  onClose,
  onDone
}: {
  mode: 'create' | 'edit'
  target?: SafeUser
  onClose: () => void
  onDone: () => void
}): React.JSX.Element {
  const { notify } = useApp()
  const [username, setUsername] = useState(target?.username ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [role, setRole] = useState<UserRole>(target?.role ?? 'standard')
  const [isActive, setIsActive] = useState(target?.isActive ?? true)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (busy) return
    if (mode === 'create' && password !== confirm) {
      notify('The two passwords do not match.', 'err')
      return
    }
    if (mode === 'edit' && password && password !== confirm) {
      notify('The two passwords do not match.', 'err')
      return
    }
    setBusy(true)
    try {
      if (mode === 'create') {
        await call(window.api.users.create({ username: username.trim(), password, role, isActive }))
        notify(`Account “${username.trim()}” created.`, 'ok')
      } else if (target) {
        await call(
          window.api.users.update(target.id, {
            username: username.trim(),
            role,
            isActive,
            ...(password ? { password } : {})
          })
        )
        notify(`Account “${username.trim()}” updated.`, 'ok')
      }
      onDone()
      onClose()
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={mode === 'create' ? 'Create user account' : `Edit “${target?.username ?? ''}”`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !username.trim()}>
            {busy ? 'Saving…' : mode === 'create' ? 'Create account' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Username">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. tshewang" />
        </Field>
        <Field label="Role">
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="admin">Administrator — full access</option>
            <option value="standard">Standard User — no user/settings management</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label={mode === 'create' ? 'Password' : 'New password (leave blank to keep)'}>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm password">
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Account is active (can sign in)
      </label>
      <div className="mt-3 text-[12px]" style={{ color: 'var(--mut)' }}>
        Passwords must be at least 6 characters and are stored as bcrypt hashes only.
      </div>
    </Modal>
  )
}

function PasswordForm({ target, onClose, onDone }: { target: SafeUser; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const { notify } = useApp()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (password !== confirm) {
      notify('The two passwords do not match.', 'err')
      return
    }
    setBusy(true)
    try {
      await call(window.api.users.update(target.id, { password }))
      notify(`Password for “${target.username}” was reset.`, 'ok')
      onDone()
      onClose()
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Reset password — ${target.username}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || password.length < 6}>
            {busy ? 'Saving…' : 'Reset password'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="New password">
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password">
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="text-[12px]" style={{ color: 'var(--mut)' }}>
          The new password is hashed with bcrypt before it is written to the local database.
        </div>
      </div>
    </Modal>
  )
}
