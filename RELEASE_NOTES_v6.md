# Postpaid Bill Summary Manager - v6 (Modification Request)

**Date:** 2026-09-22
**Installer:** `release/PBM-Setup-v6.exe` (space-free alias for `Postpaid Bill Summary Manager-1.0.0-Setup.exe`) - 91 MB
**Portable:** `release/PBM-Portable-v6.exe`

## 1. Remove PDF Options (Completed)

- **Import PDF Bills Tab:** Removed all "Open PDF", "Print PDF", "Preview" buttons. Table now shows only Review/Edit, Re-extract, Delete.
- **Bill Summary Tab:** Removed per-record "Print Original Bill PDF" button. Only Edit and Remove remain.
- **Code cleanup:** Deleted `src/main/exports/billPdfPreview.ts` and `src/main/pdf/trim.ts`, removed IPC handlers `bills:openFile`, `bills:openPath`, `bills:printOriginal`, `billPreview:*`.
- **Verification:** Screenshots `smoke-import-list.png` show only 3 actions per row; `smoke-bill-summary-numbered.png` shows no per-record PDF print.
- PDFs are still stored internally in `userData/bills/<periodId>/` but never exposed via UI.

## 2. Allow Delete Drafts for Previous Billing Months (Completed)

- **HistoryView:** Added Drafts/Finalized tabs.
  - Drafts tab lists all draft billing periods sorted newest first, with month/year label, bill count, created date.
  - Each draft has **Edit** and **Delete Draft** buttons.
  - Delete Draft confirmation dialog shows:
    - Month/Year (e.g., August 2026)
    - Bill count
    - Created date
    - Warning: "Employee & SIM Directory will NOT be deleted. Finalized reports are not affected unless you delete them separately."
    - "This action cannot be undone."
- **Backend:** `periods.remove(id)` calls `deletePeriod(id)` which cascades via `ON DELETE CASCADE` to `imported_bills` and `bill_summary_records`. Also removes stored PDF folder `userData/bills/<id>`. Directory preserved.
- **Permissions:** Drafts can be deleted by any authenticated user; finalized periods require admin role (`requireRole(['admin'])`).
- **Test:** Custom test `test-draft-delete.mjs` created periods for Aug 2026, Jul 2026, Jun 2026, Dec 2025, deleted Aug and Dec, verified cascade and directory preservation. All passed.
- **Auto-refresh:** After deletion, `reload()`, `refreshPeriods()`, `bump()` called.

## 3. Change Report Export Orientation to Portrait (Completed)

- `src/shared/reportHtml.ts`: `@page { size: A4 portrait; margin: 9mm 8mm 10mm 8mm; }`, container width 190mm.
- `src/main/exports/pdf.ts`: Both export paths set `landscape: false` (portrait).
- `src/main/exports/xlsx.ts`: `pageSetup: { orientation: 'portrait', paperSize: 9 (A4), fitToPage: true }`.
- Report HTML repeats headers if multi-page via CSS.
- No landscape unless explicit Settings (not implemented, so always portrait).

## 4. Add Secure User Sign-In (Completed)

- **Sign-In Screen:** `LoginView.tsx` on launch, username/password, Sign In button, shows default `admin / admin123`.
- **Password hashing:** `bcryptjs` (pure JS, 10 rounds), stored as `password_hash` in SQLite `users` table, no plain text.
- **Auth in main/preload:** All auth logic in `src/main/repositories/users.ts` and `src/main/services/auth.ts`, IPC handlers in `src/main/ipc.ts` with `requireAuth()` / `requireRole()`. Renderer never sees hashes.
- **Lock data when not authenticated:** `store.tsx` `authReady` gate, `App.tsx` shows `LoginView` if not authenticated, all IPC handlers (except `auth:login`, `auth:currentUser`, `auth:logout`, `app:version`) require auth.
- **User Management (admin-only):** `UsersView.tsx`
  - Create user: username, password (min 6), role (admin/standard), active/inactive
  - Edit user: change username, reset password, activate/deactivate, assign roles
  - Delete user: cannot delete own account, cannot delete last active admin
  - List users with role badges, active status, "you" badge
  - Admin role check via `requireRole(['admin'])` in IPC
- **Roles:**
  - **Administrator:** Full access, manage users, manage Employee & SIM Directory, create/edit/delete drafts, manage reports, modify settings
  - **Standard User:** Import bills, view/edit bill summaries, create drafts, view reports. Cannot manage users/directory/settings or delete finalized reports.
- **Default admin:** Created on first DB init via `initDatabase`, username `admin`, password `admin123`, role `admin`, is_active=1. Logs `[db] created default admin user`.
- **Smoke test fix:** Renderer auto-login fills form via JS if login screen present, plus main-process login for import smoke. Full smoke now passes with 6 screenshots.

## 5. Flow Verified

Launch → Sign In → Dashboard → Import Bills → Process Account Summary → Match Employee & SIM → Bill Summary → Save Draft → Review/Edit → Export Report; plus Report History → Select Previous Draft → Edit/Delete — all working via smoke tests.

## 6. Technical Details

- **Build:** `npm run build` (typecheck node+web, build resources, electron-vite build)
- **Win installer:** `node scripts/prepare-win-natives.mjs` downloads win32 prebuilt for `better-sqlite3` Electron ABI 130 and `@napi-rs/canvas-win32-x64-msvc`, then `electron-builder --win`
- **Space-free alias:** `PBM-Setup-v6.exe` avoids 404 on download with spaces
- **Native module:** After win build, restored linux binary via `npm rebuild` + `@electron/rebuild`
- **Smoke tests:**
  - `PBM_SMOKE=import`: imported=6, numbers directory-name, breakdowns correct, snapshot order 02,06,01,03,04,05, bulk delete toolbar, confirm modal, all pass
  - `PBM_SMOKE=full`: 6 screenshots dashboard/import/bill-summary/directory/history/settings

## 7. Files Changed

- Deleted: `src/main/exports/billPdfPreview.ts`, `src/main/pdf/trim.ts`
- Modified: `src/main/index.ts` (auth auto-login for smoke, removed preview smoke), `src/main/exports/pdf.ts`, `xlsx.ts`, `src/shared/reportHtml.ts`, `src/main/ipc.ts` (auth, periods delete role check, removed PDF handlers), `src/preload/index.ts` + `api.d.ts` (auth, removed PDF), `src/renderer/src/state/store.tsx` (SafeUser, authReady, login/logout, guarded loads), `src/renderer/src/views/LoginView.tsx`, `UsersView.tsx`, `HistoryView.tsx` (Drafts/Finalized + delete draft), `SummaryView.tsx` (remove printBill), `ImportView.tsx` (remove open/print), `App.tsx` (auth gate, nav filter adminOnly, logout)

## 8. Known Issues Fixed

- Blank PDF preview bug fixed by removing preview entirely (as requested)
- Download 404 due to spaces fixed via `%20` encoding or space-free alias
- better-sqlite3 NODE_MODULE_VERSION mismatch fixed via `electron-builder install-app-deps` / `@electron/rebuild`

## 9. Default Credentials

- Username: `admin`
- Password: `admin123`
- Role: Administrator
- Reset: Delete `postpaid-bills.db` from app data folder (`%APPDATA%/Postpaid Bill Summary Manager` on Windows, `~/.config/Postpaid Bill Summary Manager` on Linux) — all data lost, recreates default admin.

## 10. Installer Location

- `release/Postpaid Bill Summary Manager-1.0.0-Setup.exe` (91 MB)
- `release/PBM-Setup-v6.exe` (same, space-free)
- `release/Postpaid Bill Summary Manager-1.0.0-Portable.exe`
- `release/PBM-Portable-v6.exe`
