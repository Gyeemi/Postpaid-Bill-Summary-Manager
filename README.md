# Postpaid Bill Summary Manager

Native Windows desktop app (Electron) for telecom offices that manage postpaid mobile bills.
Import a folder of subscriber bill PDFs, have the app extract each **Account Summary** automatically,
match subscribers against your Employee & SIM directory, edit/verify, and export a consolidated
**Bill Summary** report to Excel, PDF, or the printer — all offline, on one computer.

**100 % local.** No cloud, no telemetry, no internet required for any core feature.
Nothing is ever uploaded; original PDFs are never modified or renamed.

---

## Feature overview

| Area | What it does |
|---|---|
| **Sign-in & roles** | The app starts **locked** on a sign-in screen (username + password). Credentials are verified in the Electron **main process** against bcrypt hashes in the local SQLite `users` table; the renderer never sees a hash. Every data channel rejects calls while no session exists, so the database is protected, not merely hidden. **Administrator** = full access incl. user management and settings; **Standard User** = import, review/edit drafts, view/export reports, delete drafts — no user management, no settings. Accounts live on the machine; the session ends when the app closes. |
| PDF import | Multi-file picker + drag & drop, per billing period. Duplicates (same file in same period) are rejected with a clear message. Only real PDFs (magic-bytes checked) are accepted. Rows can be ticked for **bulk delete** (select-all checkbox in the header; bills currently processing are skipped; original PDFs on disk are never touched). |
| Extraction | Searches **every page** of each bill for an "Account Summary" section and extracts *Outstanding, Penalty, Bill Amount, GST (5 %), Credits/Debits, Total Payable* — all six values are kept on the report row and shown in the Bill Summary, Excel and PDF outputs. Text layer via pdf.js; scanned/image-only PDFs fall back to fully local OCR (tesseract.js + bundled `eng.traineddata`). **Mobile number — the Employee & SIM Directory is the authoritative source.** The subscriber is identified from the PDF filename, looked up in the directory by name (initials, stray spaces, department suffixes, Mr./Mrs./Ms./Dr. titles and surname-first ordering are all tolerated), and the *directory's registered number* fills the Number column on the Import tab, the Bill Summary and every export. A Bill Summary row is **created and completed the moment the file is imported** — Title, Username, Designation and Number come straight from the matched directory entry, before extraction even starts; extraction then only fills in the amounts. The page-1 "Service Number" read from the PDF is recorded only as a cross-check hint: if it disagrees with the directory, the row is flagged **Needs Review** (directory value kept, nothing altered); if the name matches no directory entry the row appears with an empty Number and is flagged so you can add the SIM or pick the entry manually — it then completes automatically. Matching re-runs automatically whenever the directory changes or an extraction batch finishes, and the import screen has a **Re-match directory** button for bulk re-linking of rows imported with older builds. |
| Safety rules | `Total Payable` is taken **as printed** — never replaced by `Bill Amount + GST`. Each row is cross-checked as `Bill Amount + GST + Outstanding + Penalty + Credits/Debits` vs the printed total: a difference beyond Nu. 1.00 shows a Δ warning on the row (and in the review sheet) but values are never silently modified; ≤ Nu. 1.00 is treated as ordinary bill-side rounding and kept advisory only. Amounts stored as integer minor units (Nu. × 100) — no float drift. Outstanding/Penalty/Credits are editable in the review sheet and re-flow into the report, its totals and exports. |
| Subscriber name | Taken from the filename (only a trailing `.pdf` is stripped, e.g. `Mr. Karma T. 77106873 (Office SIM).pdf` → full name kept). Editable in-app; the original filename is preserved alongside the record. |
| Status flow | `Pending → Processing → Extracted / Needs Review / Failed`. Needs Review is raised for real problems only: unreadable amounts, component/total mismatches beyond Nu. 1.00, no (or ambiguous) directory match, PDF-vs-directory number conflicts, and duplicate numbers within the period. Failed bills can be retried or entered manually. If the app was closed mid-processing, those bills auto-reset to `Pending` on next start. |
| Directory | Employee & SIM directory (Title, Name, Designation, Mobile, SIM Category, Department, Active) with search, CSV/XLSX import, and add/edit/remove. Department SIMs without a personal name are supported. Bills auto-match to the directory by mobile number. |
| Billing months | Two independent fields, both always chosen by you: **Actual Billing Month** (the month the imported bills belong to) and **Payable Before (DD|MM|YYYY)** — the deadline date by which the combined bills must be paid, picked from a calendar. Nothing is derived from the current date, no default period is auto-created, and no automatic calculation is performed. Both are printed on the Excel/PDF reports (`Billing Month:` / `Payable Before: 30|09|2026`) and retained in Report History. |
| Bill Summary | Consolidated report: `Sr. | Title | Username | Designation | Number | Outstanding | Penalty | Bill Amount | GST @ 5 % | Credits / Debits | Total Payable | Deduction` — every bill's **Account Summary block reproduced line-for-line** next to the subscriber it matched. Sequential numbering, sorting, include/exclude, manual rows, editable deductions, dynamic grand totals for every column. Currency prefix `Nu.`, always two decimals. Payable Before date picker (DD|MM|YYYY) is on this tab; no instructional footer text is shown. Report-level actions are **Preview / print report**, **Excel .xlsx**, **PDF** and **Finalize & save report**. Per-bill PDF shortcuts (open / print / preview the original bill PDF) were **removed in v8** at the office's request — imported PDFs are still stored internally as the audit copy behind every extracted amount. |
| Report history | Two tabs. **Drafts** lists every unfinalized billing month — including previous months and years — with *Open draft* (review/edit that month's Bill Summary) and **Delete Draft**, which asks for confirmation naming the month/year and bill count, then removes the month's bills, their summary rows and the stored PDF copies (SQLite `ON DELETE CASCADE`); the Employee & SIM Directory is never touched and a month holding a finalized report is refused with a pointer to the separate report deletion. **Saved reports** holds finalized reports (search, preview, re-export, duplicate, delete). Historical reports never change unless you explicitly edit them. Payable Before date is shown as `payable 30|09|2026` when present. |
| Export | Excel (.xlsx, exceljs): merged title block, bold header row, `Nu. #,##0.00` currency cells, GRAND TOTAL row, optional footer + Prepared/Checked/Approved signature block. PDF/print: **A4 portrait**, column widths/fonts tuned for portrait, table header repeats on every page, org name/logo from Settings, Billing Month and Payable Before (DD|MM|YYYY) in the header, signature section, print preview before printing. |
| Bill printing | **Print Original Bill PDF** — from Import and Bill Summary, each bill can be printed directly. The app detects the page containing the Account Summary (stored as `summaryPage` during extraction) and prints only **Page 1 through that page** (e.g. Account Summary on Page 1 → Page 1 only; on Page 2 → Pages 1–2). Pages after the Account Summary are never printed. Uses the original uploaded PDF, preserving layout, fonts, logos and billing info (pdf-lib copies pages without re-rendering). |
| Settings | Organization name & logo, currency prefix, GST rate, default export folder, default billing period, report footer, light/dark theme — all persisted in the local SQLite database. |

Screenshots of every view (captured from the real running app) are in [`shots/`](shots/).

---

## Requirements

- **Windows 10 or 11 (64-bit)** to *use* the app (installer below).
- **Node.js 20+** only if you want to build from source. No other toolchain needed
  (better-sqlite3 and @napi-rs/canvas install from prebuilt binaries).

## Run from source

```bash
npm install          # also runs electron-builder install-app-deps (native ABI fixes itself)
npm run dev          # launches the app with hot reload
```

## Build the Windows installer

Run this on a Windows machine (the NSIS installer and code-sign/icon steps need Windows):

```bash
npm install
npm run package:win      # → release\Postpaid Bill Summary Manager-1.0.0-Setup.exe
npm run package:win:portable   # optional: single self-contained .exe (no install)
```

Double-click the `Setup` exe to install (per-user install, no admin rights required,
desktop + start-menu shortcuts). Uninstalling keeps your data (see *Storage* below);
`deleteAppDataOnUninstall` is deliberately `false`.

## Download the app

Prebuilt Windows binaries are in [`release/`](release/):

- **`Postpaid Bill Summary Manager-1.0.0-Setup.exe`** (~90 MB) — NSIS installer. Run it,
  pick a folder, done. Per-user install; no admin rights needed.
- A portable single-file build can be produced with `npm run package:win:portable`
  (the Windows `package:win` / `package:win:portable` scripts now run
  `scripts/prepare-win-natives.mjs` + `scripts/afterPack-win-canvas.cjs`, so cross-building
  the Windows package from Linux/macOS CI is fully supported and yields identical bits).

`SHA256SUMS.txt` next to the file lists its checksum (verify with
`certutil -hashfile <file> SHA256`).

> Built here on Linux with wine (`apt install wine wine32:i386` + `dpkg --add-architecture i386`),
> so custom icon and version resources are embedded; only Authenticode **signing** is skipped
> (SmartScreen will show "unknown publisher" — expected for a self-distributed app; sign with a
> code-signing cert in `package.json > build > win > certificateFile` if you have one).

## Verify a checkout

```bash
npm run typecheck    # strict TS, node + renderer projects
npm test             # 38 unit/integration tests (DB, parser, money, subscriber, exports, OCR)
npm run build        # full production build
npm run test:bundle  # spawns the BUILT extraction worker on a real PDF, asserts exact amounts
npm run samples      # (re)generates demo bill PDFs in samples/
```

Optional headless GUI smoke (Linux CI, needs Xvfb):
`DISPLAY=:1 PBM_SMOKE=full PBM_SMOKE_DIR=$PWD/shots electron . --no-sandbox`
loads every view, fails on any renderer error.

---

## Typical workflow

0. **Sign in** (first run: `admin` / `admin123` — change it immediately in **User Management**;
   if it is ever lost, delete `postpaid-bills.db` to restore the default account).
1. **Pick the billing period** (top-right; create e.g. `October 2026`).
2. **Import PDF Bills** → drag files in, or "Select PDFs…". Extraction runs in a
   worker-thread pool (UI never freezes). Watch each row move through the status badges.
3. Fix anything flagged **Needs Review** / **Failed** (open a row to edit; original extracted
   values are shown next to your edits).
4. **Bill Summary** → verify matches, set deductions, sort, add manual rows if a bill PDF
   doesn't exist yet.
5. **Finalize & save report** → the period becomes `Finalized` and lands in **Report History**.
6. **Excel .xlsx / PDF / Preview & print report** to hand it over; the export folder defaults to your
   `Documents` (changeable in Settings).
7. Need to redo a previous month? **Report History → Drafts → Delete Draft** clears that month's
   bills and re-imports cleanly, leaving the directory and any finalized reports alone.

### Directory import (CSV/XLSX)

One row per SIM with header row containing any of:
`Title, Name (or Username), Designation, Mobile (or Number), SIM Category, Department, Active`.
Matching to bills is by mobile number (non-digit tolerant, e.g. `+975-77-106873`).

## Secure sign-in & user accounts

| | |
|---|---|
| Start state | The app opens on **Sign in**; nothing else renders and no data loads until authenticated. |
| Password storage | **bcrypt** hashes (cost 10) in the `users` table — plain-text passwords are never stored, logged or sent to the renderer. |
| Where auth runs | Electron **main process**; `auth:login` / `auth:logout` / `auth:currentUser` are the only data channels reachable without a session. |
| Roles | **Administrator** (everything, incl. User Management and Settings) · **Standard User** (import, drafts, reports — no user/settings administration). |
| User Management | Admin-only: create accounts, change usernames, reset passwords, activate/deactivate, delete, assign roles. Guard rails: the last active administrator cannot be demoted, deactivated or deleted, and nobody can delete or deactivate their own account. |
| Own password | Every signed-in user can change their own password from the account menu in the header (current password required). |
| Default account | `admin` / `admin123`, created only when the database has no users. The sign-in screen does **not** display these credentials. |

## Storage & privacy

Everything lives in Electron's per-user data folder:

```
%APPDATA%\Postpaid Bill Summary Manager\
    postpaid-bills.db          ← SQLite: bills, directory, periods, reports, settings
    bills\<periodId>\...       ← private copies of imported PDFs (so work survives files being moved;
                                  deleting a period removes its copies)
    settings\, tmp\            ← copied logo, PDF-print scratch
```

No network code paths exist for bill data; pdf.js worker and tesseract traineddata are bundled
(`resources/pdfjs`, `resources/tessdata` → shipped in the installer's `resources` folder).
Deleting the `postpaid-bills.db` file resets the app.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `NODE_MODULE_VERSION` mismatch after switching Node/Electron versions | `npm rebuild better-sqlite3` (dev), or re-run `npm install` (`postinstall` auto-fixes) |
| "No Account Summary found" on a valid bill | The section header may differ; open the bill → "Manual entry" or edit values directly — nothing is lost |
| Scanned PDFs extract nothing | OCR runs automatically; if still empty, the scan is too low-contrast — re-scan ≥ 300 dpi |
| Excel opens with a repair warning | Make sure you open the newest file — the app writes to your export folder and keeps old copies |
| App killed while bills were processing | On restart those bills reset to `Pending`; press "Process pending / failed" |

## Project layout

```
src/shared/      types, money (integer minor units), filename→subscriber parser, Account-Summary parser, report HTML
src/main/        Electron main: db (better-sqlite3 repositories/schema), pdf (text+OCR extraction,
                 worker-thread pool), exports (exceljs xlsx, printToPDF), IPC handlers, recovery
src/preload/     typed contextBridge API (the renderer's only bridge)
src/renderer/    React 18 + TypeScript + Tailwind + lucide-react UI (6 views)
tests/           vitest suites (38 tests) incl. real-PDF OCR round-trip
scripts/         worker/tessdata fetch, sample-PDF generator, bundle verification
resources/       bundled pdf.js worker + eng.traineddata (offline)
electron-builder.yml  NSIS + portable targets, extraResources wiring
```

Security: `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer, IPC is the only
entry to disk; file inputs are validated by extension **and** magic bytes; navigation to remote
URLs is blocked.
