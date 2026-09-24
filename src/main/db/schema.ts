export const SCHEMA_VERSION = 6

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'standard' CHECK (role IN ('admin','standard')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT,
  name          TEXT NOT NULL,
  designation   TEXT,
  mobile        TEXT,
  mobile_key    TEXT UNIQUE,
  sim_category  TEXT NOT NULL DEFAULT 'Personal',
  department    TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_emp_name ON employees (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS billing_periods (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  month          INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12), -- ACTUAL billing month (bills belong to it)
  year           INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  prep_month     INTEGER CHECK (prep_month IS NULL OR prep_month BETWEEN 1 AND 12), -- legacy BILL PREPARATION month (kept for old DBs)
  prep_year      INTEGER CHECK (prep_year IS NULL OR (prep_year BETWEEN 2000 AND 2100)),
  payable_before TEXT, -- ISO yyyy-mm-dd, manually chosen \"Payable Before\" date (DD|MM|YYYY display)
  report_title   TEXT,
  report_date    TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT,
  UNIQUE (month, year)
);

CREATE TABLE IF NOT EXISTS imported_bills (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id         INTEGER NOT NULL REFERENCES billing_periods(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  stored_path       TEXT,
  original_path     TEXT,
  subscriber_name   TEXT,
  detected_title    TEXT,
  detected_name     TEXT,
  sr_from_filename  INTEGER,
  mobile_number     TEXT,
  outstanding       INTEGER,
  penalty           INTEGER,
  bill_amount       INTEGER,
  gst               INTEGER,
  credits_debits    INTEGER,
  total_payable     INTEGER,
  extraction_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (extraction_status IN ('pending','processing','extracted','needs_review','failed')),
  error_message     TEXT,
  warnings          TEXT,
  field_evidence    TEXT,
  mobile_candidates TEXT,
  ocr_used          INTEGER NOT NULL DEFAULT 0,
  summary_page      INTEGER,
  suggested_month   INTEGER,
  suggested_year    INTEGER,
  is_manual         INTEGER NOT NULL DEFAULT 0,
  duplicate_of      INTEGER REFERENCES imported_bills(id) ON DELETE SET NULL,
  processed_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (period_id, original_filename)
);
CREATE INDEX IF NOT EXISTS idx_bill_period ON imported_bills (period_id);

CREATE TABLE IF NOT EXISTS bill_summary_records (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id           INTEGER NOT NULL UNIQUE REFERENCES imported_bills(id) ON DELETE CASCADE,
  employee_id       INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  period_id         INTEGER NOT NULL REFERENCES billing_periods(id) ON DELETE CASCADE,
  title             TEXT,
  username          TEXT,
  designation       TEXT,
  mobile_number     TEXT,
  basic_amount      INTEGER,
  gst               INTEGER,
  outstanding       INTEGER,
  penalty           INTEGER,
  credits_debits    INTEGER,
  total_amount      INTEGER,
  deduction         INTEGER NOT NULL DEFAULT 0,
  include_in_report INTEGER NOT NULL DEFAULT 1,
  reviewed          INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_rec_period ON bill_summary_records (period_id);

CREATE TABLE IF NOT EXISTS application_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS report_history (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id            INTEGER NOT NULL UNIQUE REFERENCES billing_periods(id) ON DELETE CASCADE,
  report_name          TEXT NOT NULL,
  report_date          TEXT,
  snapshot_json        TEXT NOT NULL,
  grand_total_basic    INTEGER,
  grand_total_gst      INTEGER,
  grand_total_payable  INTEGER,
  grand_total_deduction INTEGER,
  row_count            INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  modified_at          TEXT
);
`
