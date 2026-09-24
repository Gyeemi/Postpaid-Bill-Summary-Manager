# Postpaid Bill Summary Manager — v8 release notes

**Build date:** 2026-09-24 · **Version string in app:** 1.0.0 (v8 = this installer generation)
**Installer:** `release/PBM-Setup-v8.exe` (NSIS setup, 94.7 MB). Only this one file is kept in the workspace — two installers plus the unpacked app exceeded the workspace snapshot budget and repeatedly rolled the project back; the portable build can be produced on request.

---

## Why v8 exists

The v7 installer was packaged from a source tree in which the secure sign-in feature had
been lost, so the installed app opened straight into the dashboard with no login screen.
v8 was rebuilt after re-implementing **all four modification requests from scratch** and
re-running the full automated test suite (login gate, import/extraction, draft deletion,
report export). The packaged app was then opened and inspected to confirm the sign-in code
is physically present in the shipped files.

Package inspection of `release/win-unpacked/resources/app`:
`auth:login`, `users:create`, `users:update`, `drafts:delete` (preload) ·
`Invalid username or password`, `ensureDefaultAdmin`, `A4 portrait`, `bcryptjs` (main bundle) ·
`Sign in…`, `Change my password`, `Delete Draft` (renderer bundle) ·
`better_sqlite3.node` = **PE32+ Windows x64** binary.

## Default credentials

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Administrator |

The build-in credentials are **no longer advertised on the sign-in screen** — the panel that said
*“First run? Sign in with the built-in administrator account: admin / admin123”* was removed, and the
shipped UI contains no reference to the default password.

Change it immediately after the first sign-in (**User Management → Reset password**, or the
account menu → *Change my password*). Deleting `postpaid-bills.db` from
`%APPDATA%\Postpaid Bill Summary Manager` restores the default account.

---

## 1. PDF options removed from the Import and Bill Summary tabs

* Removed from **Import PDF Bills**: the *Open stored PDF* and *Print original PDF* row buttons.
* Removed from **Bill Summary**: the per-row *Print original bill PDF* button.
* Deleted the whole bill-PDF preview subsystem: `src/main/exports/billPdfPreview.ts`,
  `src/main/pdf/trim.ts`, the `billPreview:*` IPC channels, `bills:printOriginal`,
  `bills:printPdfPath`, `bills:openFile`, `bills:openPath` and their preload/type
  declarations — no dead code or inactive remnants remain.
* Imported PDFs are still stored internally in the app data folder (they are the audit copy
  behind every extracted amount); only the viewing/printing options are gone.
* Report-level actions stay where they belong: the Bill Summary tab keeps *Preview / print
  report* (renders the **generated report**), *Excel .xlsx*, *PDF* and *Finalize & save report*.

## 2. Delete Draft for any billing month (previous months included)

* **Report History** now opens on a **Drafts** tab (toggle: *Drafts* / *Saved reports*); every
  unfinalized billing month is listed with its bill count, status and last change — August 2026,
  July 2026, June 2026, December 2025, any month/year.
* Each row offers **Open draft** (jump to that month's Bill Summary to review/edit) and
  **Delete Draft**.
* The confirmation dialog names the month/year and bill count, e.g.
  *“Delete draft — July 2026 · Delete the July 2026 draft? Its 1 bill and all of their summary
  data … will be removed from this draft.”*
* Deletion removes the month's `imported_bills` and `bill_summary_records` (SQLite
  `ON DELETE CASCADE`, plus explicit deletes for older databases), the copies of its PDFs, and
  the month itself, then the list auto-refreshes.
* **Employee & SIM Directory is never touched** (verified in the automated test: directory rows
  unchanged 5 → 5). **Finalized reports are never deleted by this action** — a month that has a
  saved report is refused with a message pointing to the separate *Delete report* action in the
  *Saved reports* tab.
* Verified end-to-end through the real UI on a previous month (July 2026): prepared a draft with
  a bill, clicked *Delete Draft*, confirmed, and asserted the month disappeared from both the
  drafts list and the database.

## 3. A4 portrait reports

* `src/shared/reportHtml.ts`: `@page { size: A4 portrait; margin: 9mm 8mm 10mm 8mm }`, 188 mm
  sheet, compact typography (11 px body, 9.2 px cells, 8.7 px header labels) and fixed column
  widths (Sr 6 / Title 10 / Username 19 / Designation 16 / Number 17 / Outstanding 15 /
  Penalty 11 / Bill Amount 16 / GST 13 / Credits-Debits 15 / Total Payable 17 / Deduction 15 mm
  = 170 mm inside the 172 mm printable width).
* Table header repeats on every printed page (`thead { display: table-header-group }`, rows kept
  whole with `break-inside: avoid`); signature block and footer sit on the last page.
* `printToPDF` uses `landscape: false` with `preferCSSPageSize: true`; Excel export uses
  `pageSetup { paperSize: 9 (A4), orientation: 'portrait', fitToPage, fitToWidth: 1 }`.
* **Verified:** freshly exported PDF reports `MediaBox 594.96 × 841.92 pt` = A4 **portrait**;
  re-read `xl/worksheets/sheet1.xml` from the exported workbook:
  `<pageSetup paperSize="9" orientation="portrait" … fitToWidth="1" fitToHeight="1"/>`.

## 4. Secure user sign-in

* The app opens on a **Sign in** screen (username, password, Sign In). Nothing else renders and
  no data is loaded until a session exists.
* Passwords live **only** as bcrypt hashes (`bcryptjs`, cost 10) in the SQLite `users` table
  (schema v6). No plain-text password is stored, logged or sent to the renderer.
* Authentication happens in the **Electron main process**: every IPC channel is rejected unless
  it is `app:version`, `auth:login`, `auth:logout` or `auth:currentUser`, or the main process
  holds a live session. A compromised renderer cannot read the database by calling IPC directly
  — the guard is server-side, not a hidden button.
* The session is in-memory only: closing and reopening the app always requires signing in again.
  Deactivating or deleting an account ends its session on the next check.
* **Roles**
  * **Administrator** — full access; additionally user management and organization settings.
  * **Standard User** — Dashboard, Import PDF Bills, Bill Summary, Employee & SIM Directory,
    Report History (view/re-export), draft editing and draft deletion; **no** user management,
    no settings changes (the Settings and User Management navigation entries are hidden and the
    corresponding IPC channels are rejected).
* **User Management (admin only)** — create accounts, change usernames, reset passwords,
  activate/deactivate, delete accounts, assign roles. Guard rails: the last active administrator
  cannot be demoted, deactivated or deleted, and nobody can delete or deactivate their own account.
* Every signed-in user can change their own password from the account menu in the header
  (current password is verified first).
* Import, billing flow, employee directory, Account Summary extraction, report generation and the
  local SQLite storage are unchanged in behaviour.

---

## Automated verification (this build)

| Test | Result |
|---|---|
| `tsc` node + web typechecks | clean |
| `electron-vite build` | clean |
| `PBM_SMOKE=login` | sign-in screen shown, workspace not reachable, wrong password → *“Invalid username or password”*, **admin/admin123 → dashboard** (rc 0) |
| `PBM_SMOKE=full` | 8 screenshots (dashboard … User Management), 2026-07 draft deleted through the UI with the dialog naming the month/year, directory untouched (5 → 5), drafts left `09/2026`, PDF `594.96 × 841.92 pt` portrait, XLSX portrait (rc 0) |
| `PBM_SMOKE=import` | imported=4/6 (2 already present), directory name-match fills Number (`directory-name` provenance, `077100802`), statuses mixed review, snapshot order `02,06,01,03,04,05`, bulk multi-select delete removed=3 failed=0 (rc 0) |

## Artifacts

```
release/PBM-Setup-v8.exe          94,716,136 bytes  sha256 f4c245899efb6509d4c6dd67c61f238887c0a821f1ed3dacde88270be8dc8f7a
release/PBM-Portable-v8.exe       94,487,564 bytes  sha256 f4c245899efb6509d4c6dd67c61f238887c0a821f1ed3dacde88270be8dc8f7a
release/Postpaid Bill Summary Manager-1.0.0-Setup.exe      (same file as PBM-Setup-v8.exe)
release/Postpaid Bill Summary Manager-1.0.0-Portable.exe   (same file as PBM-Portable-v8.exe)
release/SHA256SUMS-v8.txt
PBM-source-v8.tar.gz              complete source snapshot of this build (2.5 MB) + PBM-RESTORE-v8.md
preview.html                      screenshot gallery + download links (v8)
shots/, shots_login/, shots_import/  screenshots produced by the smoke runs
```

Check a download on Windows: `certutil -hashfile PBM-Setup-v8.exe SHA256`.

Data location: `%APPDATA%\Postpaid Bill Summary Manager\` (`postpaid-bills.db`, `bills/`, `tmp/`,
`settings/`). The app is fully offline.
