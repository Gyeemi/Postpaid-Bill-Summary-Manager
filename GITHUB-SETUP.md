# Putting this project on GitHub

> **Status: connected.** The v8 source is live at
> <https://github.com/Gyeemi/Postpaid-Bill-Summary-Manager> (branch `main`).
> It was pushed from the build machine using a **write-enabled deploy key**
> (GitHub → repo → Settings → Deploy keys). Keep that key while further pushes are
> wanted, or delete it once you push from your own computer — history is unaffected.
> Everyday pushes from your machine use a Personal Access Token instead; see Route A below.


This folder is already a **git repository with one commit** (`v1.0.0 — v8 build`), and
`pbm-git-repo.bundle` is a portable copy of that repository you can clone from anywhere.
Pick one of the two routes below.

---

## Route A — push from your own computer (recommended)

Works with any Git setup, keeps your GitHub token on your machine.

### 1. Get the repository onto your computer

Either download **`pbm-git-repo.bundle`** (≈3 MB, in this folder) and clone it:

```bash
git clone pbm-git-repo.bundle postpaid-bill-manager
cd postpaid-bill-manager
```

…or download **`PBM-source-v8.tar.gz`** and use it as a normal source folder:

```bash
tar xzf PBM-source-v8.tar.gz -C postpaid-bill-manager
cd postpaid-bill-manager
git init
git add .
git commit -m "Initial commit: Postpaid Bill Summary Manager v8"
```

### 2. Create the empty repository on GitHub

Web UI: <https://github.com/new> → Repository name `postpaid-bill-summary-manager` →
**Private** (recommended — this is your office's billing tool) → **do not** add a README,
.gitignore or licence (you already have them) → **Create repository**.

Or with the GitHub CLI:

```bash
gh auth login
gh repo create postpaid-bill-summary-manager --private --source=. --remote=origin
```

### 3. Point your local repo at it and push

```bash
git branch -M main
git remote add origin https://github.com/<YOUR-USERNAME>/postpaid-bill-summary-manager.git
git push -u origin main
```

When Git asks for credentials, use your GitHub username and a **Personal Access Token**
(GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens,
scope *Contents: Read and write*) as the password. A password alone no longer works.

---

## Route B — let me push from this sandbox

Technically possible, but you would have to paste a Personal Access Token into the chat,
and the sandbox's network/filesystem is wiped between messages. Not recommended — use Route A.

---

## ⚠️ What must NOT go into the repository

| Item | Why | How to handle it |
|---|---|---|
| `release/*.exe` (95 MB installer) | GitHub warns above 50 MB and **rejects files over 100 MB**; binaries bloat every clone | Already in `.gitignore`. Publish installers as **GitHub Releases** instead (below). |
| `node_modules/`, `out/`, `dist/` | Rebuilt from `package-lock.json` | Already in `.gitignore`. |
| `postpaid-bills.db`, real bill PDFs, employee lists | **Real personal/billing data** — must never leave the office | Keep them out of the repo folder entirely; the app stores them in `%APPDATA%`, not in the project. |

## Publishing the installer as a GitHub Release (keeps the repo small)

```bash
# after Route A, from your clone
gh release create v8 release/PBM-Setup-v8.exe \
  --title "v8 — secure sign-in, Delete Draft, A4 portrait, PDF options removed" \
  --notes-file RELEASE_NOTES_v8.md
```

Or in the web UI: your repo → **Releases** → *Draft a new release* → tag `v8` → attach
`PBM-Setup-v8.exe` → publish. Colleagues then download from the Releases page instead of
from a chat or a shared drive.

## Everyday git commands for this project

```bash
git status                 # what changed
git add -A                 # stage everything (respects .gitignore)
git commit -m "Fix …"      # save a snapshot
git push                   # upload to GitHub
git log --oneline --graph  # history
```

## Cloning and running on another machine

```bash
git clone https://github.com/<YOUR-USERNAME>/postpaid-bill-summary-manager.git
cd postpaid-bill-summary-manager
npm install                # installs deps + fixes native module ABI
npm run dev                # run the app from source
npm run package:win        # build the Windows installer (see README)
```

First launch shows the sign-in screen — `admin` / `admin123` (change it in **User Management**).

## If git commands suddenly say "not a repository"

This sandbox does not persist a repository's `.git/config` between sessions, so a clone made
*here* can occasionally lose its plumbing. Your own clone is unaffected. To rebuild the local
repo metadata from the bundle (objects and history are inside it):

```bash
git init                 # recreates .git/config without touching history
git fetch pbm-git-repo.bundle main:main
git reset --hard main
```

## Notes specific to this project

- The repository content is the **v8 build**: secure sign-in with roles, PDF shortcuts removed,
  Delete Draft for any month, A4 portrait reports. `RELEASE_NOTES_v8.md` documents the changes,
  `PBM-RESTORE-v8.md` explains how to rebuild the app if a source copy is ever lost.
- `samples/*.pdf` is gitignored; regenerate the test bills with `npm run samples` when needed.
- The `shots/`, `shots_login/` and `shots_import/` folders are screenshots produced by the
  automated smoke tests (`PBM_SMOKE=login|full|import`) — handy as documentation.
- If you would rather keep the source private, make the repo **Private**; `gh repo create
  postpaid-bill-summary-manager --private` does that in one step.
