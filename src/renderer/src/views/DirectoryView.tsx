import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Upload, FileDown, Pencil, Trash2, Power, PowerOff, Search } from 'lucide-react'
import { useApp } from '../state/store'
import { call, errMsg } from '../lib/api'
import { Confirm, Field, Modal, Spinner } from '../components/ui'
import type { Employee, EmployeeInput } from '../../../shared/types'

const TITLES = ['', 'Mr.', 'Mrs.', 'Ms.', 'Dr.']
const CATEGORIES = ['Personal', 'Data Card', 'Corporate', 'Departmental', 'Other']

export default function DirectoryView(): React.JSX.Element {
  const { refreshEmployees, notify, bump } = useApp()
  const [search, setSearch] = useState('')
  const [list, setList] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [confirmDel, setConfirmDel] = useState<Employee | null>(null)
  const [importing, setImporting] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setList(await call(window.api.employees.list(search || undefined)))
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setLoading(false)
    }
  }, [search, notify])

  useEffect(() => {
    const t = window.setTimeout(() => void reload(), 180)
    return () => window.clearTimeout(t)
  }, [reload, bump])

  const doImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const r = await call(window.api.employees.pickAndImport())
      notify(`Directory import finished: ${r.added} added, ${r.updated} updated${r.failed.length ? `, ${r.failed.length} failed rows (check the file)` : ''}.`, r.failed.length ? 'err' : 'ok')
      await refreshEmployees()
      await reload()
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-[1400px]">
      <div className="card p-3.5 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-[420px]">
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--mut)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="Search by name, designation, department or number…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn" onClick={() => void call(window.api.employees.downloadTemplate()).catch((e) => notify(errMsg(e), 'err'))}>
          <FileDown size={14} /> CSV template
        </button>
        <button className="btn" onClick={() => void doImport()} disabled={importing}>
          {importing ? <Spinner label="Importing…" /> : <><Upload size={14} /> Import Excel / CSV</>}
        </button>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={15} /> Add record
        </button>
      </div>

      <div className="card overflow-hidden">
        {loading && list.length === 0 ? (
          <div className="p-8 text-center"><Spinner label="Loading directory…" /></div>
        ) : (
          <div className="overflow-auto max-h-[65vh]">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Title</th>
                  <th>Name / SIM description</th>
                  <th>Designation</th>
                  <th style={{ width: 110 }}>Number</th>
                  <th style={{ width: 120 }}>SIM Category</th>
                  <th style={{ width: 140 }}>Department</th>
                  <th style={{ width: 90 }}>Status</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} style={{ opacity: e.isActive ? 1 : 0.55 }}>
                    <td>{e.title || '—'}</td>
                    <td className="font-semibold">{e.name}</td>
                    <td>{e.designation || '—'}</td>
                    <td className="mono">{e.mobile || '—'}</td>
                    <td>{e.simCategory}</td>
                    <td>{e.department || '—'}</td>
                    <td>
                      <span className={`badge ${e.isActive ? 'badge-ok' : 'badge-mut'}`}>{e.isActive ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td>
                      <div className="flex gap-1 justify-end">
                        <button className="btn btn-sm" title="Edit" onClick={() => setEditing(e)}><Pencil size={13} /></button>
                        <button
                          className="btn btn-sm"
                          title={e.isActive ? 'Deactivate (keeps history)' : 'Activate'}
                          onClick={async () => {
                            try {
                              await call(window.api.employees.setActive(e.id, !e.isActive))
                              await refreshEmployees()
                              await reload()
                            } catch (err) {
                              notify(errMsg(err), 'err')
                            }
                          }}
                        >
                          {e.isActive ? <PowerOff size={13} /> : <Power size={13} />}
                        </button>
                        <button className="btn btn-sm" title="Delete" onClick={() => setConfirmDel(e)}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-10" style={{ color: 'var(--mut)' }}>
                      No directory entries{search ? ' match your search' : ' yet'}. Departmental SIMs such as “TBL Data Card” or “Boiler SIM” can be added
                      without a personal title or name.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EmployeeModal
          employee={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refreshEmployees()
            await reload()
            bump()
          }}
        />
      )}
      {confirmDel && (
        <Confirm
          danger
          title="Delete directory entry"
          confirmLabel="Delete"
          body={
            <>
              Delete <b>{confirmDel.name}</b> ({confirmDel.mobile ?? 'no number'}) from the directory? Existing reports keep their data; bills that were
              linked simply show the value saved at import time. Prefer <i>deactivate</i> for old SIMs.
            </>
          }
          onConfirm={async () => {
            try {
              await call(window.api.employees.remove(confirmDel.id))
              await refreshEmployees()
              await reload()
              bump()
            } catch (err) {
              notify(errMsg(err), 'err')
            }
          }}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

function EmployeeModal({
  employee,
  onClose,
  onSaved
}: {
  employee: Employee | null
  onClose: () => void
  onSaved: () => Promise<void> | void
}): React.JSX.Element {
  const { notify } = useApp()
  const [f, setF] = useState<EmployeeInput & { isActive: boolean }>({
    title: employee?.title ?? '',
    name: employee?.name ?? '',
    designation: employee?.designation ?? '',
    mobile: employee?.mobile ?? '',
    simCategory: employee?.simCategory ?? 'Personal',
    department: employee?.department ?? '',
    notes: employee?.notes ?? '',
    isActive: employee ? employee.isActive : true
  })
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (!f.name.trim()) {
      notify('Name / SIM description is required.', 'err')
      return
    }
    setBusy(true)
    try {
      const payload: EmployeeInput = {
        title: f.title || null,
        name: f.name.trim(),
        designation: f.designation || null,
        mobile: f.mobile ? String(f.mobile).replace(/\s/g, '') : null,
        simCategory: f.simCategory,
        department: f.department || null,
        isActive: f.isActive,
        notes: f.notes || null
      }
      if (employee) await call(window.api.employees.update(employee.id, payload))
      else await call(window.api.employees.create(payload))
      await onSaved()
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={employee ? `Edit ${employee.name}` : 'Add employee / SIM record'}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save record'}</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Title">
          <select className="select" value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })}>
            {TITLES.map((t) => (
              <option key={t} value={t}>{t || '(none)'}</option>
            ))}
          </select>
        </Field>
        <Field label="Employee name / SIM description *">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Dechen Wangmo or TBL Data Card" />
        </Field>
        <Field label="Designation / role">
          <input className="input" value={f.designation ?? ''} onChange={(e) => setF({ ...f, designation: e.target.value })} placeholder="e.g. Sale EXC, Data Card, Receptionist" />
        </Field>
        <Field label="Mobile number" hint="Used to auto-match imported bills">
          <input className="input mono" value={f.mobile ?? ''} onChange={(e) => setF({ ...f, mobile: e.target.value })} placeholder="77100802" />
        </Field>
        <Field label="SIM category">
          <select className="select" value={f.simCategory ?? 'Personal'} onChange={(e) => setF({ ...f, simCategory: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Department (optional)">
          <input className="input" value={f.department ?? ''} onChange={(e) => setF({ ...f, department: e.target.value })} />
        </Field>
      </div>
      <label className="flex items-center gap-2 mt-3 text-[13px] cursor-pointer">
        <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
        Active (inactive records are kept for history but are not auto-matched)
      </label>
    </Modal>
  )
}
