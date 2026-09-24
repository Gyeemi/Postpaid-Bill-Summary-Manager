# Restoring the v8 source if the workspace ever resets

The workspace has repeatedly reverted `src/` between sessions. `PBM-source-v8.tar.gz` in this
folder is a complete snapshot of the **verified v8 source** (auth, portrait, draft deletion,
PDF-option removal, smoke harness, build scripts, package.json).

To restore:

```bash
cd /home/user/postpaid-bill-manager
tar xzf PBM-source-v8.tar.gz          # restores src/, package.json, configs, scripts/, resources/
npm install                           # electron + native modules (fast, cached)
npx @electron/rebuild -f -w better-sqlite3   # SQLite driver for Electron's ABI
npm run build                         # typecheck + resources + electron-vite build
```

Quick health check (must all be true):

```bash
grep -c "CREATE TABLE IF NOT EXISTS users" src/main/db/schema.ts      # 1
grep -c "auth:login" src/main/ipc.ts                                  # 1
grep -c "Delete Draft" src/renderer/src/views/HistoryView.tsx         # >=1
grep -c "A4 portrait" src/shared/reportHtml.ts                        # 1
grep -c "billPreview" src/preload/index.ts                            # 0
```

Smoke tests (headless, need `xvfb` + Electron system libs):

```bash
xvfb-run -a env PBM_SMOKE=login  PBM_SMOKE_DIR=$PWD/shots_login  npx electron .
xvfb-run -a env PBM_SMOKE=full   PBM_SMOKE_DIR=$PWD/shots        npx electron .
xvfb-run -a env PBM_SMOKE=import PBM_SMOKE_DIR=$PWD/shots_import npx electron .
```

Windows packaging (needs `wine`, `wine64`, `wine32` installed):

```bash
npm run build
node scripts/prepare-win-natives.mjs
npx electron-builder --win --publish=never
npx @electron/rebuild -f -w better-sqlite3    # put the Linux driver back for local work
```

Confirm the packaged app really contains the sign-in code before shipping:

```bash
grep -l "auth:login"      release/win-unpacked/resources/app/out/preload/index.js
grep -l "ensureDefaultAdmin" release/win-unpacked/resources/app/out/main/index.js
file release/win-unpacked/resources/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node
# → must report: PE32+ executable ... MS Windows ... x86-64
```
