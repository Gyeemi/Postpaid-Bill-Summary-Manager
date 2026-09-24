import React, { useEffect, useState } from 'react'
import { IndianRupee, ReceiptText, Percent, PiggyBank, CalendarClock, FilePlus2, AlertTriangle, Archive, Inbox } from 'lucide-react'
import { useApp } from '../state/store'
import { call } from '../lib/api'
import { fmtMoney, periodLabel } from '../lib/format'
import { EmptyState } from '../components/ui'
import type { DashboardStats } from '../../../shared/types'

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }): React.JSX.Element {
  return (
    <div className="card p-4 flex items-start gap-3.5">
      <div className="rounded-lg p-2.5 shrink-0" style={{ background: 'var(--info-bg)', color: 'var(--acc-2)' }}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[11.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--mut)' }}>{label}</div>
        <div className="text-[19px] font-extrabold tabular-nums leading-7" style={{ overflowWrap: 'anywhere' }}>{value}</div>
        {sub && <div className="text-[11.5px]" style={{ color: 'var(--mut)' }}>{sub}</div>}
      </div>
    </div>
  )
}

export default function DashboardView(): React.JSX.Element {
  const { period, dataTick, go } = useApp()
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    void call(window.api.dashboard.stats(period?.id ?? null))
      .then(setStats)
      .catch(() => undefined)
  }, [period, dataTick])

  return (
    <div className="flex flex-col gap-5 max-w-[1280px]">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))' }}>
        <Stat icon={<CalendarClock size={19} />} label="Current Billing Period" value={stats?.periodLabel ?? '—'} sub={period ? `${period.status === 'finalized' ? 'Finalized' : 'Draft'} · updated ${period.updatedAt ? period.updatedAt.slice(0, 10) : period.createdAt.slice(0, 10)}` : 'No period selected'} />
        <Stat icon={<Inbox size={19} />} label="Total Bills Imported" value={String(stats?.totalBills ?? 0)} sub={stats?.extractionIssues ? `${stats.extractionIssues} need attention` : 'All extracted'} />
        <Stat icon={<IndianRupee size={19} />} label="Total Payable" value={fmtMoney(stats?.totalPayable ?? 0)} sub="Sum of Total Payable (included)" />
        <Stat icon={<Percent size={19} />} label="Total GST" value={fmtMoney(stats?.totalGst ?? 0)} sub="Extracted GST amounts" />
        <Stat icon={<PiggyBank size={19} />} label="Total Deductions" value={fmtMoney(stats?.totalDeductions ?? 0)} sub="Payroll deductions entered" />
      </div>

      {stats && stats.extractionIssues > 0 && (
        <div className="card p-3.5 flex items-center gap-3" style={{ borderColor: 'var(--warn)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--warn)' }} />
          <span className="text-[13px]">
            {stats.extractionIssues} bill{stats.extractionIssues === 1 ? '' : 's'} in {stats.periodLabel} still need review, retry or manual entry. Reports cannot be finalized with unreviewed failures.
          </span>
          <button className="btn btn-sm ml-auto" onClick={() => go('import')}>Review now</button>
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="panel-title flex items-center gap-2"><Archive size={16} /> Recent reports</div>
            <button className="btn btn-sm" onClick={() => go('history')}>Open history</button>
          </div>
          {stats && stats.recentReports.length > 0 ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Period</th>
                  <th className="num">Bills</th>
                  <th className="num">Total Payable</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentReports.map((r) => (
                  <tr key={r.id} className="cursor-pointer" onClick={() => go('history')}>
                    <td className="font-semibold">{r.reportName}</td>
                    <td style={{ color: 'var(--mut)' }}>{r.periodLabel}</td>
                    <td className="num">{r.rowCount}</td>
                    <td className="num">{fmtMoney(r.grandTotalPayable)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              icon={<ReceiptText size={26} />}
              title="No finalized reports yet"
              body="Import bill PDFs, review the extraction and finalize the consolidated Bill Summary Report — it will appear here."
            />
          )}
        </div>

        <div className="card p-4 flex flex-col gap-3">
          <div className="panel-title">Quick actions</div>
          <button className="btn btn-primary justify-center py-2.5" onClick={() => go('import')}>
            <FilePlus2 size={16} /> Import bill PDFs
          </button>
          <button className="btn justify-center py-2.5" onClick={() => go('summary')}>
            <ReceiptText size={16} /> Review & finalize {period ? periodLabel(period.month, period.year) : 'summary'}
          </button>
          <div className="text-[12px] leading-relaxed mt-1" style={{ color: 'var(--mut)' }}>
            Workflow: import PDFs → the app finds the <b>Account Summary</b> on any page → match subscribers against the
            directory → correct anything that needs review → finalize & export. All amounts use <b>Nu.</b> with two decimals.
          </div>
        </div>
      </div>
    </div>
  )
}
