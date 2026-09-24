# Postpaid Bill Summary Manager — v7

**Date:** 2026-09-24
**Installer:** `release/PBM-Setup-v7.exe` (91 MB, space-free alias of `Postpaid Bill Summary Manager-1.0.0-Setup.exe`)
**Portable:** `release/PBM-Portable-v7.exe`

## Why v7

The v6 installer was built from a workspace state in which the Secure Sign-In
feature had been lost, so the installed app opened straight into the dashboard
with **no login screen**. v7 re-implements the full modification request and is
verified end-to-end (automated smoke runs + screenshots, see `shots/`,
`shots_login/`, `shots_import/`).

## 1. Secure User Sign-In (fixed & verified)

- Launch shows a **Sign-In screen** (username / password / Sign In). Verified
  screenshots: `shots_login/smoke-login-screen.png` (blank form) and
  `shots_login/smoke-login-error.png` (wrong password rejected).
- Passwords are stored **only as bcrypt hashes** (`users` table, `password_hash`);
  plain text never touches the database and never reaches the renderer.
- Authentication runs in the **main process** (`src/main/services/auth.ts` +
  `src/main/repositories/users.ts`); the in-memory session dies with the app, so
  every launch requires sign-in.
- **Data is locked at the IPC boundary**: every channel except `app:version`,
  `auth:login`, `auth:logout`, `auth:currentUser` calls `requireAuth()`; without a
  session the main process refuses to read or write the SQLite database.
- Default account: **admin / admin123** (created on first launch; shown on the
  sign-in screen; change it in User Management).
- **User Management** (admin-only view + admin-only IPC): create users, change
  usernames, reset passwords, activate/deactivate, delete users, assign roles.
  Guards: cannot delete/deactivate yourself, cannot remove/demote/deactivate the
  last active administrator.
- **Roles**: Administrator = full access. Standard User = import bills, view/edit
  drafts, create & export reports; *no* user management, directory edits, settings
  changes or finalized-report deletion (enforced in main, nav items hidden too).

## 2. Remove PDF Options (re-applied)

- Import PDF Bills table: only **Review/Edit, Re-extract, Delete** per row.
- Bill Summary table: per-record **Print Original PDF removed**; Edit / Remove only.
- Removed from code entirely: `src/main/pdf/trim.ts`, `src/main/exports/billPdfPreview.ts`,
  IPC channels `bills:openFile|openPath|printOriginal|printPdfPath`, `billPreview:*`,
  preload methods. Stored PDFs remain on disk for record-keeping but are never exposed.

## 3. Delete Drafts for Previous Billing Months (re-applied)

- Report History → **Drafts tab** lists every draft month (any month/year, e.g.
  August 2026, July 2026, June 2026, December 2025) newest first.
- **Delete Draft** button opens a confirmation showing billing month/year, bill
  count, created date, "Employee & SIM Directory will NOT be deleted", "cannot be
  undone". Deletion cascades via `ON DELETE CASCADE` to `imported_bills` and
  `bill_summary_records` and removes the stored PDF folder; the directory is
  untouched. Finalized months need admin (separate action). List auto-refreshes.

## 4. Portrait A4 (re-applied)

- `@page { size: A4 portrait; margin: 9mm 8mm 10mm 8mm }`, 190 mm sheet, compact
  column widths/fonts, `thead { display: table-header-group }` repeats the header on
  every page. `printToPDF` uses `landscape: false` + `preferCSSPageSize`; Excel export
  `orientation: 'portrait'`, A4, fit-to-width. No landscape anywhere.

## 5. Flow verified by smoke tests (all rc=0)

Launch → Sign In → Dashboard → Import PDF Bills → Account Summary extraction →
Employee & SIM match → Bill Summary → Review/Edit → Export; Report History → draft
Edit/Delete. Checks include: imported=6, directory-name number resolution, snapshot
order 02,06,01,03,04,05, bulk toolbar "Delete selected (2)", confirm modal with 2
named bills, removed=3.

## Install

1. Run `PBM-Setup-v7.exe` (or the portable).
2. Sign in with **admin / admin123**.
3. Create your real accounts in **User Management** and change the admin password.

Data folder: `%APPDATA%\Postpaid Bill Summary Manager` (SQLite DB, stored PDFs,
exports settings). Deleting `postpaid-bills.db` resets everything to the default
admin (all data lost).
