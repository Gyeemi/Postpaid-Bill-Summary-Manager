import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialised yet')
  return db
}

export function initDatabase(userDir: string): Database.Database {
  if (db) return db
  fs.mkdirSync(userDir, { recursive: true })
  const file = path.join(userDir, 'postpaid-bills.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 4000')
  migrate(db)
  return db
}

/** Used by tests / dev tooling to close + reopen with another directory. */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

function migrate(d: Database.Database): void {
  d.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)`)
  const row = d.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get() as { value: string } | undefined
  const current = row ? parseInt(row.value, 10) : 0
  if (current < SCHEMA_VERSION) {
    const tx = d.transaction(() => {
      d.exec(SCHEMA_SQL)
      if (current >= 1 && current < 2) {
        const cols = d.prepare(`PRAGMA table_info(imported_bills)`).all() as { name: string }[]
        if (!cols.some((c) => c.name === 'sr_from_filename')) {
          d.exec(`ALTER TABLE imported_bills ADD COLUMN sr_from_filename INTEGER`)
        }
      }
      if (current >= 1 && current < 4) {
        const pcols = d.prepare(`PRAGMA table_info(billing_periods)`).all() as { name: string }[]
        for (const col of ['prep_month', 'prep_year']) {
          if (!pcols.some((c) => c.name === col)) d.exec(`ALTER TABLE billing_periods ADD COLUMN ${col} INTEGER`)
        }
      }
      if (current >= 1 && current < 5) {
        const pcols2 = d.prepare(`PRAGMA table_info(billing_periods)`).all() as { name: string }[]
        if (!pcols2.some((c) => c.name === 'payable_before')) d.exec(`ALTER TABLE billing_periods ADD COLUMN payable_before TEXT`)
      }
      if (current >= 1 && current < 3) {
        const rcols = d.prepare(`PRAGMA table_info(bill_summary_records)`).all() as { name: string }[]
        for (const col of ['outstanding', 'penalty', 'credits_debits']) {
          if (!rcols.some((c) => c.name === col)) d.exec(`ALTER TABLE bill_summary_records ADD COLUMN ${col} INTEGER`)
        }
      }
      if (current >= 1 && current < 3) {
        // give pre-v3 report rows the breakdown that was always kept on the bill
        d.exec(`UPDATE bill_summary_records SET
                  outstanding    = (SELECT b.outstanding     FROM imported_bills b WHERE b.id = bill_summary_records.bill_id),
                  penalty        = (SELECT b.penalty         FROM imported_bills b WHERE b.id = bill_summary_records.bill_id),
                  credits_debits = (SELECT b.credits_debits  FROM imported_bills b WHERE b.id = bill_summary_records.bill_id)
                WHERE outstanding IS NULL AND penalty IS NULL AND credits_debits IS NULL`)
      }
      d.prepare(`INSERT INTO schema_meta(key, value) VALUES ('version', ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(SCHEMA_VERSION))
    })
    tx()
  }
}
