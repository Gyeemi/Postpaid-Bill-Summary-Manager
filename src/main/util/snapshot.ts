import type { AppSettings, ReportSnapshot } from '../../shared/types'
import { computeTotals, includedRowsForSnapshot } from '../repositories/records'
import { getPeriod, periodLabel } from '../repositories/periods'
import { formatPayableBefore } from '../../shared/payable'

export function buildSnapshotBase(settings: AppSettings): Pick<
  ReportSnapshot,
  'orgName' | 'orgSub' | 'orgLogoPath' | 'footerText' | 'currency' | 'gstRate' | 'generatedAt'
> {
  return {
    orgName: settings.orgName,
    orgSub: 'Postpaid Telephone Bill Management',
    orgLogoPath: settings.orgLogoPath,
    footerText: settings.footerText,
    currency: settings.currency || 'Nu.',
    gstRate: settings.gstRatePercent,
    generatedAt: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
}

export function buildSnapshotForPeriod(periodId: number, settings: AppSettings): ReportSnapshot {
  const period = getPeriod(periodId)
  if (!period) throw new Error('Billing period not found')
  const label = periodLabel(period.month, period.year)
  return {
    ...buildSnapshotBase(settings),
    reportTitle: period.reportTitle || `Postpaid Bill Summary – ${label}`,
    periodLabel: label,
    billingLabel: label,
    prepLabel: period.prepMonth && period.prepYear ? periodLabel(period.prepMonth, period.prepYear) : null,
    payableBefore: period.payableBefore ?? null,
    payableBeforeFormatted: formatPayableBefore(period.payableBefore ?? null),
    reportDate: period.reportDate || new Date().toISOString().slice(0, 10),
    rows: includedRowsForSnapshot(periodId),
    totals: computeTotals(periodId, true)
  }
}
