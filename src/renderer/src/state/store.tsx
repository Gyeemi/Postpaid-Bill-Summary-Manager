/**
 * Global application state: settings, billing period selection, employee
 * cache, toasts and a data "tick" that all tables use to re-fetch after
 * background processing events.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, BillingPeriod, Employee, ExtractionStatus, BillProgressEvent, SafeUser } from '../../../shared/types'
import { call } from '../lib/api'
import { periodLabel } from '../lib/format'

export type ViewId = 'dashboard' | 'import' | 'summary' | 'directory' | 'history' | 'settings' | 'users'

interface Toast {
  id: number
  kind: 'info' | 'ok' | 'err'
  text: string
}

interface AppCtx {
  ready: boolean
  /** signed-in user (null while the sign-in screen is showing) */
  user: SafeUser | null
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  settings: AppSettings | null
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>
  periods: BillingPeriod[]
  period: BillingPeriod | null
  setPeriod: (p: BillingPeriod | null) => void
  ensurePeriod: (month: number, year: number) => Promise<BillingPeriod>
  refreshPeriods: (selectId?: number) => Promise<void>
  employees: Employee[]
  refreshEmployees: () => Promise<void>
  view: ViewId
  go: (v: ViewId) => void
  notify: (text: string, kind?: Toast['kind']) => void
  toasts: Toast[]
  dismissToast: (id: number) => void
  dataTick: number
  bump: () => void
  progress: Record<number, BillProgressEvent>
  setProgress: (billId: number, ev: BillProgressEvent | null) => void
  statuses: Record<number, ExtractionStatus>
}

const Ctx = createContext<AppCtx>(null as unknown as AppCtx)
export const useApp = (): AppCtx => useContext(Ctx)

export function AppProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<SafeUser | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [periods, setPeriods] = useState<BillingPeriod[]>([])
  const [period, setPeriodState] = useState<BillingPeriod | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [view, setView] = useState<ViewId>('dashboard')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dataTick, setDataTick] = useState(0)
  const [progress, setProgressMap] = useState<Record<number, BillProgressEvent>>({})
  const [statuses, setStatuses] = useState<Record<number, ExtractionStatus>>({})
  const toastId = useRef(1)

  const notify = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = toastId.current++
    setToasts((t) => [...t.slice(-3), { id, kind, text }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 4200)
  }, [])

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const bump = useCallback(() => setDataTick((t) => t + 1), [])

  const loadPeriods = useCallback(async (selectId?: number): Promise<void> => {
    const list = await call(window.api.periods.list())
    setPeriods(list)
    setPeriodState((cur) => {
      if (selectId) return list.find((p) => p.id === selectId) ?? cur
      if (cur) return list.find((p) => p.id === cur.id) ?? list[0] ?? null
      return list[0] ?? null
    })
  }, [])

  const refreshPeriods = loadPeriods

  /** Loads everything that is only readable once a session exists. */
  const loadWorkspace = useCallback(async (): Promise<void> => {
    const s = await call(window.api.settings.get())
    setSettings(s)
    await loadPeriods()
    setEmployees(await call(window.api.employees.list()))
  }, [loadPeriods])

  // On launch we ask the MAIN process who is signed in. Right after a restart
  // that is nobody, so the sign-in screen is shown and no data is loaded.
  useEffect(() => {
    void (async () => {
      try {
        const me = await call(window.api.auth.currentUser())
        setUser(me)
        if (me) await loadWorkspace()
      } catch (err) {
        notify(`Could not initialise the local database: ${(err as Error).message}`, 'err')
      } finally {
        setReady(true)
      }
    })()
  }, [loadWorkspace, notify])

  const signIn = useCallback(
    async (username: string, password: string): Promise<void> => {
      const me = await call(window.api.auth.login(username, password))
      setUser(me)
      setView('dashboard')
      await loadWorkspace()
      notify(`Signed in as ${me.username}.`, 'ok')
    },
    [loadWorkspace, notify]
  )

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await call(window.api.auth.logout())
    } catch {
      /* session is dropped in the main process either way */
    }
    setUser(null)
    setPeriods([])
    setPeriodState(null)
    setEmployees([])
    setSettings(null)
    setStatuses({})
    setProgressMap({})
    setView('dashboard')
  }, [])

  // theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings?.theme === 'dark')
  }, [settings])

  // background processing events
  useEffect(() => {
    const offP = window.api.events.onBillsProgress((ev) => {
      setProgressMap((m) => {
        const next = { ...m }
        if (ev.status === 'processing') next[ev.billId] = ev
        else delete next[ev.billId]
        return next
      })
      setStatuses((s) => ({ ...s, [ev.billId]: ev.status }))
    })
    const offC = window.api.events.onBillsChanged(() => {
      bump()
      if (user) void loadPeriods()
    })
    const offD = window.api.events.onBatchDone(({ processed, total }) => {
      bump()
      notify(`Processing finished — ${processed} of ${total} file${total === 1 ? '' : 's'} handled.`)
    })
    return () => {
      offP()
      offC()
      offD()
    }
  }, [bump, loadPeriods, notify, user])

  const setProgress = useCallback((billId: number, ev: BillProgressEvent | null) => {
    setProgressMap((m) => {
      const next = { ...m }
      if (ev) next[billId] = ev
      else delete next[billId]
      return next
    })
  }, [])

  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const s = await call(window.api.settings.set(patch))
      setSettings(s)
      bump()
    },
    [bump]
  )

  const refreshEmployees = useCallback(async () => {
    setEmployees(await call(window.api.employees.list()))
  }, [])

  const ensurePeriod = useCallback(
    async (month: number, year: number) => {
      const p = await call(window.api.periods.ensure(month, year))
      await loadPeriods(p.id)
      return p
    },
    [loadPeriods]
  )

  const setPeriod = useCallback(
    (p: BillingPeriod | null) => {
      setPeriodState(p)
      if (p && settings) {
        void window.api.settings.set({ defaultMonth: p.month, defaultYear: p.year }).catch(() => undefined)
      }
    },
    [settings]
  )

  // No period is ever created automatically — NOT from the current month and
  // NOT from anything the bills suggest. The user opens/creates the
  // "Actual Billing Month" deliberately via the header picker, and sets the
  // "Bill Preparation Month" independently on the report screen.

  const value = useMemo<AppCtx>(
    () => ({
      ready,
      user,
      signIn,
      signOut,
      settings,
      saveSettings,
      periods,
      period,
      setPeriod,
      ensurePeriod,
      refreshPeriods,
      employees,
      refreshEmployees,
      view,
      go: setView,
      notify,
      toasts,
      dismissToast,
      dataTick,
      bump,
      progress,
      setProgress,
      statuses
    }),
    [
      ready, user, signIn, signOut, settings, saveSettings, periods, period, setPeriod, ensurePeriod, refreshPeriods,
      employees, refreshEmployees, view, notify, toasts, dismissToast, dataTick, bump, progress,
      setProgress, statuses
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export { periodLabel }
