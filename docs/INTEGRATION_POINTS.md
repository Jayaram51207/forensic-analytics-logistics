# Integration Points

Where the forensic layer touches existing code. Exact diffs: [docs/patches/](patches/).

## 1. Workflow Synchroniser

`server.js` creates one capture object at start-up (`createCapture` from `forensics/src/capture.js`) and calls it from each route. `db.js` logic is untouched apart from a path override and an exported start-up flag. Hooks live in `server.js` rather than `db.js` because the route has what the data layer lacks: the request (claimed actor, IP), the compiler result, and the upload.

| Route | Hook order |
|---|---|
| `POST /api/jobs` | `begin` → `generate(…runExcelCompiler)` → `createJob` → `jobCreated` (on failure: `deleteJob` and 503) |
| `PUT /api/jobs/:id` | deep copy of current job → `updateRequested` → `generate` → `updateJob` → `jobUpdated` |
| `DELETE /api/jobs/:id` | `deleteRequested` (snapshot) → `deleteJob` → `jobDeleted` |
| `PUT …/workflow/:stepId` | deep copy → `statusChangeRequested` → `toggleWorkflowStep` → `statusChanged` (also emits `job.closed` / `job.reopened`) |
| `PUT …/documents/:docId` | same pattern with `'document'` |
| `POST /api/parse-checklist` | `sourceUploaded` → parser → `sourceParsed` (success or failure) |
| `POST /api/login` | `login` |
| `POST`/`DELETE /api/users` | `userChanged` |
| start-up | `startup(startupInfo)`: `system.started`, then a baseline for every job without evidence |

### Write-ahead pattern

For anything that overwrites or deletes: the `…_requested` event holding the old state is written **before** the operational write. If that event cannot be written, the route answers 503 and nothing is changed. The completion event is best-effort; if it is lost, the old state is still preserved and the operation shows up as incomplete in reconciliation.

### Failure behaviour

| Mode | Set by | Required event fails | Other event fails |
|---|---|---|---|
| fail-closed (default) | — | Operation refused with 503 | Logged; operation proceeds |
| fail-open | `FORENSIC_FAIL_MODE=open` | Logged; operation proceeds | Logged; operation proceeds |

Every failure is printed to stderr, appended to `capture_failures.log`, and summarised in a `forensic.capture_gap` event once the store is writable again. Tested in `sync.integration.test.js` ("fail-closed", "fail-open").

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FORENSIC_DIR` | `forensics/data` | Evidence store location |
| `FORENSIC_DISABLED` | unset | `1` turns capture off entirely (original behaviour) |
| `FORENSIC_FAIL_MODE` | `closed` | `open` to never refuse an operation |
| `FORENSIC_ARCHIVE` | on | `0` records output hashes without keeping copies |
| `FORENSIC_ALLOW_SIM_TIME` | unset | `1` accepts `X-Forensic-Sim-Time` (synthetic data only; never in real use) |
| `SYNC_DB_PATH`, `SYNC_UPLOADS_DIR`, `SYNC_DOWNLOADS_DIR`, `SYNC_PYTHON` | original locations, `python` | Let tests run against a disposable copy |

### Behaviour changes to the synchroniser

1. `uploads/` is created at start (it previously had to exist or uploads failed).
2. Destructive routes return 503 when evidence cannot be written (default mode).
3. Subprocesses run with `cwd` set to the synchroniser folder, so the server can be started from any directory.
4. Delete requests from the bundled UI carry `X-Claimed-User`.

Nothing else in request or response shape changed; the regression test with `FORENSIC_DISABLED=1` and the 31 scenario runs exercise the original routes.

## 2. Desktop tools (outbox pattern)

These tools have no server, so they append JSON lines to `%LOCALAPPDATA%\LeadkingForensics\outbox\<application>.jsonl` (override: `FORENSIC_OUTBOX_DIR`). `node forensics/cli.js ingest` copies new lines into the chain; it is idempotent. Capture in these tools is always fail-open.

| Tool | Hook | Event | Verified how |
|---|---|---|---|
| 3D visualizer | `calculateStuffing()` in `main.js` → `Api.forensic_event` in `app.py` | `packing.run_completed` | Python bridge method and ingestion tested; payload function unit-tested; the GUI itself was not driven |
| 3D visualizer | `Api.save_pdf` | `packing.report_saved` | Not executed (needs a save dialog) |
| B.I.I.L. | `generate_all()` → `_forensic_snapshot` | `document.batch_generated` | Real run through `test/biil_headless.py` |
| EasyQuote ×3 | `RecordExport()` after each export/copy | `quotation.exported`, `stuffing_report.exported` | Compiles in all three projects; not executed |

Limits: the visualizer captures only in desktop mode (no bridge in a plain browser); the PyInstaller build of B.I.I.L. does not bundle the adapter, so the packaged executable captures nothing until `build_unified.py` is extended; an outbox line can be edited or deleted before ingestion without detection.

## 3. Linking across applications

There is still no shared key. Links are made at analysis time (`linkExternal` in `model.js`):

| Method | Confidence | Basis |
|---|---|---|
| `job_no_exact_after_normalisation` | 0.9 | Reference typed in the tool equals a job number after upper-casing and removing punctuation |
| `container_number_match` | 0.6 | A container number in the external record appears on the job |
| ambiguous | base ÷ candidates | The same reference matches several job lifecycles; the record is shown on each, flagged ambiguous, and scored at half weight |
| `unlinked` | 0 | No reference, or no match. The record stays in the store, attached to nothing |
