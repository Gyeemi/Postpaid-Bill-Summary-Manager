import { getDb } from '../db'
import type { AppSettings } from '../../shared/types'

const DEFAULTS: AppSettings = {
  orgName: 'Organization',
  orgLogoPath: null,
  currency: 'Nu.',
  gstRatePercent: 5,
  exportFolder: null,
  theme: 'light',
  autoCalcGst: true,
  defaultMonth: null,
  defaultYear: null,
  footerText: ''
}

const KEYS: (keyof AppSettings)[] = [
  'orgName',
  'orgLogoPath',
  'currency',
  'gstRatePercent',
  'exportFolder',
  'theme',
  'autoCalcGst',
  'defaultMonth',
  'defaultYear',
  'footerText'
]

function read(key: keyof AppSettings): string | null {
  const row = getDb().prepare(`SELECT value FROM application_settings WHERE key = ?`).get(key) as { value: string | null } | undefined
  return row ? row.value : null
}

function parse<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function getSettings(): AppSettings {
  return {
    orgName: read('orgName') ?? DEFAULTS.orgName,
    orgLogoPath: read('orgLogoPath'),
    currency: read('currency') ?? DEFAULTS.currency,
    gstRatePercent: parse(read('gstRatePercent'), DEFAULTS.gstRatePercent),
    exportFolder: read('exportFolder'),
    theme: (read('theme') as 'light' | 'dark') ?? DEFAULTS.theme,
    autoCalcGst: parse(read('autoCalcGst'), DEFAULTS.autoCalcGst),
    defaultMonth: parse<number | null>(read('defaultMonth'), DEFAULTS.defaultMonth),
    defaultYear: parse<number | null>(read('defaultYear'), DEFAULTS.defaultYear),
    footerText: read('footerText') ?? DEFAULTS.footerText
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const db = getDb()
  db.transaction(() => {
    for (const k of KEYS) {
      if (!(k in patch)) continue
      const v = (patch as Record<string, unknown>)[k]
      const stored = typeof v === 'string' || v === null ? v : JSON.stringify(v)
      db.prepare(
        `INSERT INTO application_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(k, stored)
    }
  })()
  return getSettings()
}
