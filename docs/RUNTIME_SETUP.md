# Runtime Setup, Recovery and Operations

## 1. Git recovery points

The repository was put under git on 2026-10-13. Before that, originals of modified files existed only as diffs.

| Tag | Commit content |
|---|---|
| `original-suite` | The four applications exactly as received, before any forensic change |
| `forensic-v1` | First forensic layer (86 tests) |
| later commits on `main` | Sessions, external anchor, provenance and contradiction analysis |

How `original-suite` was built: each of the 14 modified files was restored from the preserved original, after checking that the reverse-applied patch in `docs/patches/` reproduces that original byte for byte (14 of 14).

```
git diff original-suite -- "Workflow syncroniser/server.js"     # everything changed in one application file
git checkout original-suite -- "Workflow syncroniser"            # put one application back as received
git stash; git checkout original-suite                           # look at the untouched suite
```

`docs/patches/*.diff` is regenerated from `git diff original-suite` and kept for readers without git.

Not tracked (`.gitignore`): `node_modules`, build output, `db.json`, `uploads/`, `downloads/`, `forensics/data/` (live evidence), `forensics/datasets/` (regenerable), `forensics/.venv/`.

**The repository contains template and sample files that may be real client documents.** They were already part of the received suite and are in local history only. Do not push this repository anywhere until their owner has cleared them.

## 2. Dependencies

| Need | For | Install |
|---|---|---|
| Node.js 20+ | Synchroniser, forensic layer | — |
| `npm install` in `Workflow syncroniser/` | express, multer, cors, bcryptjs | already present |
| Python 3.11+ with `openpyxl`, `pdfplumber` | Document generation and PDF parsing in the synchroniser | `forensics\setup_env.cmd` |
| `scikit-learn`, `numpy` | ML baseline only | same script |
| `pywebview` | 3D visualizer desktop window | same script |
| .NET SDK 10 | Rebuilding EasyQuote programs | — |

`forensics\setup_env.cmd` creates `forensics\.venv` from `forensics\requirements.txt`. The system Python on the development machine has neither `openpyxl` nor `pdfplumber`; without them the synchroniser saves jobs but generates no documents.

### Which Python the synchroniser uses

1. `SYNC_PYTHON`, if set.
2. Else `forensics\.venv\Scripts\python.exe`, if it exists.
3. Else `python` from `PATH`.

The same order applies to the tests.

## 3. Starting

```
cd "Workflow syncroniser"
node server.js                         # http://localhost:3000, capture on, sessions required
```

| Variable | Default | Effect |
|---|---|---|
| `PORT` | 3000 | |
| `SYNC_ADMIN_PASSWORD` | unset | One-time bootstrap: creates `admin` when `db.json` has no accounts (§4) |
| `SYNC_ADMIN_USERNAME` | `admin` | Name of the bootstrapped administrator |
| `SYNC_SESSION_IDLE_MINUTES` | 720 | Idle expiry |
| `SYNC_SESSION_MAX_HOURS` | 24 | Absolute session lifetime, regardless of activity |
| `SYNC_LOGIN_MAX_FAILURES` | 5 | Failed logins per IP address and per username within 15 minutes before 429 |
| `SYNC_BCRYPT_COST` | 12 | bcrypt cost (minimum 10) |
| `SYNC_DELETE_REQUIRES_ADMIN` | on | `0` lets any signed-in user delete jobs (original behaviour); recorded in `system.started` |
| `SYNC_TLS_CERT`, `SYNC_TLS_KEY` | unset | PEM certificate and key: serve HTTPS and mark the session cookie `Secure`. Unset: plain HTTP with a start-up warning |
| `SYNC_PYTHON` | see above | Interpreter for `compiler.py` |
| `SYNC_AUTH` | required | `off` restores unauthenticated access (actors become unverified claims; a warning is printed) |
| `SYNC_DB_PATH`, `SYNC_UPLOADS_DIR`, `SYNC_DOWNLOADS_DIR` | application folders | Point a test instance at disposable folders |
| `FORENSIC_DIR` | `forensics/data` | Evidence store |
| `FORENSIC_ANCHOR_FILE` | unset | External witness log. Put it where the application host's users cannot write |
| `FORENSIC_ANCHOR_URL`, `FORENSIC_ANCHOR_TOKEN`, `FORENSIC_ANCHOR_STORE_ID` | unset | Remote witness on another machine (docs/EXTERNAL_ANCHOR.md) |
| `FORENSIC_BUSINESS_RULES` | `forensics/config/business_rules.json` | Business rules for the analysis (docs/DECISIONS_AND_OPEN_REQUIREMENTS.md) |
| `FORENSIC_FAIL_MODE` | `closed` | `open` never refuses an operation for lack of evidence |
| `FORENSIC_ARCHIVE` | on | `0` keeps output hashes without copies |
| `FORENSIC_DISABLED` | unset | `1` turns capture off |
| `FORENSIC_ALLOW_SIM_TIME` | unset | Synthetic data only |
| `FORENSIC_OUTBOX_DIR` | `%LOCALAPPDATA%\LeadkingForensics\outbox` | Where desktop tools write evidence |
| `FORENSIC_REVIEW_TOKEN` | unset | Enables recording assessments in the dashboard |

Investigation:

```
cd forensics
node cli.js ingest                     # bring in desktop-tool evidence
node cli.js verify                     # integrity (reports whether an external anchor is configured)
node cli.js artifacts                  # do recorded files still match their hashes?
node cli.js reconcile
node cli.js cases
node src/dashboard.js                  # http://127.0.0.1:3100
```

## 4. Signing in

No account is created automatically. On a new installation (no `db.json`, or one with no users):

```
set SYNC_ADMIN_PASSWORD=<a strong password of your choice>
node server.js          # prints "Administrator account 'admin' created from SYNC_ADMIN_PASSWORD"
set SYNC_ADMIN_PASSWORD=
```

Without the variable the server starts with no accounts and prints how to create one; nobody can sign in.
The variable is only read when there are no accounts; remove it after the first start. The administrator
must change the password at first sign-in, then creates desk accounts in the Admin tab. Each new account
must also change its password at first sign-in.

Password rules (checked on the server): 12–200 characters, must not contain the username, not a common
password, at least 5 different characters. Stored as bcrypt (cost 12) of a SHA-256 pre-hash; never logged.

- **Change password:** "Change password" button beside "Logout". Needs the current password. All of that
  user's sessions end; the browser that changed it receives a new one.
- **Forgotten password:** an administrator calls `POST /api/users/<username>/password` with `{"new_password": "..."}` (API only; there is no button for it yet);
  the user's sessions end and they must choose a new password at next sign-in.
- **Existing installations** that still have the old seeded accounts (password = username): those accounts
  can sign in only as far as the forced password-change screen. Reset or delete them.
- Login attempts are limited (`SYNC_LOGIN_MAX_FAILURES`, default 5 per 15 minutes per IP and per username).
  Error messages do not say whether the username exists.

- Login sets an `HttpOnly; SameSite=Strict` cookie. Scripts may send `Authorization: Bearer <token>` using the `token` returned by `/api/login`.
- Sessions are held in memory: a server restart signs everyone out. Idle sessions expire after 12 hours, and every session after 24 hours.
- Every `/api` route except `/api/login` needs a session. Admin routes need the `Admin` role of the signed-in account.
- The cookie is not marked `Secure` because the application is served over plain HTTP on a LAN. On an untrusted network, put it behind HTTPS.

## 5. When the evidence store cannot be written (HTTP 503)

Default mode is fail-closed. If a required evidence event cannot be written, the request is refused:

| Route | What the user sees | Data |
|---|---|---|
| Create job | Error; job not created | Insert rolled back |
| Edit job | Error; edit not saved | Unchanged |
| Step / document change | Error; tick box reverts | Unchanged |
| Delete job | Error; job remains | Unchanged |
| Create / delete user | Error | Unchanged for delete; a created user may exist without evidence (see below) |
| Login, reads, uploads | Work | Evidence for them is best-effort |

Operationally this means **a full or unavailable evidence disk stops work in the synchroniser.** That is the intended trade: no destructive change without a preserved record.

What to do:

1. Look at the server console and `forensics/data/capture_failures.log`: each failure is listed with the action and the error.
2. Fix the cause (disk space, permissions, a locked file, a missing folder).
3. Retry the operation. Nothing needs restarting.
4. The first successful write adds a `forensic.capture_gap` event stating how many events were lost.
5. Run `node cli.js reconcile` to see whether any state changed without evidence.

If the business cannot accept stopped work, set `FORENSIC_FAIL_MODE=open` deliberately; the gap is then recorded instead of the operation being refused. The default was not changed.

Known rough edge: `POST /api/users` writes the user first and the evidence second, so a failed evidence write returns 503 after the account already exists.

## 6. Protecting the evidence

- Back up `forensics/data/` (`events.jsonl`, `events.head.json`, `artifacts/`) on a schedule.
- Run a remote witness on another machine (`FORENSIC_ANCHOR_URL`; procedure in docs/EXTERNAL_ANCHOR.md), or set `FORENSIC_ANCHOR_FILE` to a location with different write permissions, or run `node cli.js head` regularly and keep its one-line output elsewhere (paper is fine); check later with `node cli.js verify --expect <seq>:<hash>`.
- Without either, someone who can write to the evidence folder can rewrite the whole chain undetected. `cli.js verify` prints a warning in that case.

Recovering from a damaged store: do not edit `events.jsonl`. Keep the damaged file, restore the last good backup beside it, run `verify` on both, and record which events exist only in the damaged copy.

## 7. End-to-end check

```
cd forensics
node e2e/run_e2e.js
```

Starts a disposable synchroniser with sessions, an anchor file and a remote witness (in another process on the same machine), then: refused anonymous request, login, checklist upload and parse, job creation with document generation, download, edits, repeated identical saves, step change and reversal, restart, closure, reconciliation, refused desk deletion, administrator deletion, chain and anchor verification, archived-file hash check, dashboard case and timeline, reviewer assessment, remote witness check. 28 steps; exits non-zero on any failure. Last run (2026-10-26): 28 of 28.

Real application windows (opens them on screen; briefly replaces the clipboard):

```
set FORENSIC_GUI_TESTS=1
node --test test/pipeline.test.js
```

Requires the WPF programs to be built (`dotnet build` in each project folder) and the visualizer bundle built (`npm run build`).
