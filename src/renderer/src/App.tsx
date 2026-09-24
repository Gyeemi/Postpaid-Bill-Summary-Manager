import React from 'react'
import {
  LayoutDashboard,
  FilePlus2,
  Table2,
  Users,
  Archive,
  Settings as SettingsIcon,
  CalendarDays,
  ChevronDown,
  ShieldCheck,
  LogOut,
  KeyRound,
  UserCog
} from 'lucide-react'
import { useApp, type ViewId } from './state/store'
import { Toasts, Field, Modal } from './components/ui'
import { call, errMsg } from './lib/api'
import { periodLabel, MONTHS } from './lib/format'
import DashboardView from './views/DashboardView'
import ImportView from './views/ImportView'
import SummaryView from './views/SummaryView'
import DirectoryView from './views/DirectoryView'
import HistoryView from './views/HistoryView'
import SettingsView from './views/SettingsView'
import UsersView from './views/UsersView'
import LoginView from './views/LoginView'

const NAV: { id: ViewId; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
  { id: 'import', label: 'Import PDF Bills', icon: <FilePlus2 size={17} /> },
  { id: 'summary', label: 'Bill Summary', icon: <Table2 size={17} /> },
  { id: 'directory', label: 'Employee & SIM Directory', icon: <Users size={17} /> },
  { id: 'history', label: 'Report History', icon: <Archive size={17} /> },
  // Administrator-only areas: organization settings and account/security management
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={17} />, adminOnly: true },
  { id: 'users', label: 'User Management', icon: <UserCog size={17} />, adminOnly: true }
]

function PeriodSelector(): React.JSX.Element {
  const { period, periods, ensurePeriod, notify, refreshPeriods, setPeriod, settings } = useApp()
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState(settings?.defaultMonth ?? new Date().getMonth() + 1)
  const [year, setYear] = React.useState(settings?.defaultYear ?? new Date().getFullYear())
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)}>
        <CalendarDays size={15} />
        Actual billing month: <b>{period ? periodLabel(period.month, period.year) : 'not selected'}</b>
        {period && (
          <span className={`badge ${period.status === 'finalized' ? 'badge-ok' : 'badge-warn'}`} style={{ marginLeft: 4 }}>
            {period.status === 'finalized' ? 'Finalized' : 'Draft'}
          </span>
        )}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="card absolute right-0 mt-2 p-3 z-40" style={{ width: 340 }}>
          <div className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--mut)' }}>
            Jump to billing month
          </div>
          <div className="max-h-48 overflow-auto mb-3 -mx-1 px-1">
            {periods.map((p) => (
              <button
                key={p.id}
                className="w-full text-left flex items-center justify-between rounded-lg px-2.5 py-2 hover:bg-[var(--panel-2)]"
                onClick={() => {
                  setPeriod(p)
                  setOpen(false)
                }}
              >
                <span className="font-semibold text-[13px]">{periodLabel(p.month, p.year)}</span>
                <span className="text-[11.5px]" style={{ color: 'var(--mut)' }}>
                  {p.billCount} bill{p.billCount === 1 ? '' : 's'} · {p.status}
                </span>
              </button>
            ))}
            {periods.length === 0 && <div className="text-[13px]" style={{ color: 'var(--mut)' }}>No billing months yet — pick one below and press Open.</div>}
          </div>
          <div className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--mut)' }}>
            Create / open a month (nothing is created until you press Open)
          </div>
          <div className="flex gap-2">
            <select className="select" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - 4 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  await ensurePeriod(month, year)
                  setOpen(false)
                } catch (err) {
                  notify((err as Error).message, 'err')
                }
              }}
            >
              Open
            </button>
          </div>
          <div className="mt-3 flex justify-end">
            <button className="text-[12px] linkish" onClick={() => void refreshPeriods().catch(() => undefined)}>
              Refresh list
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Signed-in user chip: change own password / sign out. */
function UserMenu(): React.JSX.Element {
  const { user, signOut, notify } = useApp()
  const [open, setOpen] = React.useState(false)
  const [pwOpen, setPwOpen] = React.useState(false)
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [])

  const savePassword = async (): Promise<void> => {
    if (next !== confirm) {
      notify('The two new passwords do not match.', 'err')
      return
    }
    setBusy(true)
    try {
      await call(window.api.auth.changeOwnPassword(current, next))
      notify('Your password was changed.', 'ok')
      setPwOpen(false)
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)} title="Account">
        <ShieldCheck size={15} />
        <b>{user?.username}</b>
        <span className={`badge ${user?.role === 'admin' ? 'badge-ok' : ''}`}>
          {user?.role === 'admin' ? 'Administrator' : 'Standard User'}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="card absolute right-0 mt-2 p-2 z-40" style={{ width: 260 }}>
          <button
            className="w-full text-left rounded-lg px-2.5 py-2 text-[13px] hover:bg-[var(--panel-2)] flex items-center gap-2"
            onClick={() => {
              setOpen(false)
              setPwOpen(true)
            }}
          >
            <KeyRound size={14} /> Change my password
          </button>
          <button
            className="w-full text-left rounded-lg px-2.5 py-2 text-[13px] hover:bg-[var(--panel-2)] flex items-center gap-2"
            onClick={() => void signOut()}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}

      {pwOpen && (
        <Modal
          title={`Change password — ${user?.username ?? ''}`}
          onClose={() => setPwOpen(false)}
          width={460}
          footer={
            <>
              <button className="btn" onClick={() => setPwOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void savePassword()} disabled={busy || next.length < 6}>
                {busy ? 'Saving…' : 'Change password'}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label="Current password">
              <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label="New password">
              <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password">
              <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default function App(): React.JSX.Element {
  const { view, go, settings, ready, user } = useApp()
  const navItems = NAV.filter((n) => !n.adminOnly || user?.role === 'admin')
  const title = NAV.find((n) => n.id === view)?.label ?? ''

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center text-[13px]" style={{ color: 'var(--mut)' }}>
        Starting Postpaid Bill Summary Manager…
      </div>
    )
  }

  // nothing but the sign-in card is rendered until a session exists
  if (!user) return <LoginView />

  return (
    <div className="flex h-full">
      <aside className="flex flex-col shrink-0 text-[#dbe7f5]" style={{ width: 248, background: 'linear-gradient(180deg, #16324f 0%, #10263e 100%)' }}>
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg flex items-center justify-center shrink-0" style={{ width: 34, height: 34, background: '#2f6db3' }}>
              <FilePlus2 size={18} color="#fff" />
            </div>
            <div>
              <div className="font-bold text-[14.5px] leading-tight text-white">Postpaid Bill</div>
              <div className="font-bold text-[14.5px] leading-tight text-white">Summary Manager</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px]" style={{ color: '#8fb0d4' }}>
            <ShieldCheck size={13} /> 100% local &amp; offline · v1.0.0
          </div>
        </div>
        <nav className="flex-1 px-3 flex flex-col gap-1">
          {navItems.map((n) => (
            <button
              key={n.id}
              className={`nav-item w-full text-left ${view === n.id ? 'active' : ''}`}
              onClick={() => go(n.id)}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
        <div className="px-5 py-4 text-[11px] leading-relaxed" style={{ color: '#7e9cc0' }}>
          {settings?.orgName ?? 'Organization'}
          <br /> Bills never leave this computer.
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-3 px-6 h-[58px] border-b shrink-0" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
          <h1 className="text-[17px] font-bold m-0">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            <PeriodSelector />
            <UserMenu />
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6" onContextMenu={(e) => e.preventDefault()}>
          {view === 'dashboard' && <DashboardView />}
          {view === 'import' && <ImportView />}
          {view === 'summary' && <SummaryView />}
          {view === 'directory' && <DirectoryView />}
          {view === 'history' && <HistoryView />}
          {view === 'settings' && user.role === 'admin' && <SettingsView />}
          {view === 'users' && user.role === 'admin' && <UsersView />}
        </div>
      </main>
      <Toasts />
    </div>
  )
}
