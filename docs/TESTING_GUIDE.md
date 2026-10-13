# Testing Guide

## Requirements

See RUNTIME_SETUP.md §2. In short: Node.js 20+, `npm install` in `Workflow syncroniser/`, and `forensics\setup_env.cmd` once to create the Python environment. The tests find `forensics\.venv` by themselves; `SYNC_PYTHON` overrides it.

Tests that need a missing component are **skipped with a stated reason**, never counted as passed.

## Run everything

```
cd forensics
node --test                    # 131 tests; 4 GUI tests skipped unless opted in
node e2e/run_e2e.js            # 26-step end-to-end run on a disposable synchroniser
```

Every integration test starts its own synchroniser on a random port, with database, uploads, downloads and evidence in a temp folder, and signs in through the real login route. The live `db.json` and `forensics/data` are never opened.

Last full run (2026-10-14): **131 tests, 127 passed, 0 failed, 4 skipped** (the opt-in GUI tests). With `FORENSIC_GUI_TESTS=1` those 4 also ran and passed. End-to-end run: 26 of 26.

## Test files

| File | Tests | Scope |
|---|---|---|
| `test/store.test.js` | 26 | Canonical JSON, append, hash links, every tampering case, truncation, torn writes at end and mid-file, write failure, head-anchor failure, altered head anchor, query filters, four concurrent writer processes, **full-rewrite limitation**, external anchor, expected-head check, unwitnessed records |
| `test/units.test.js` | 17 | Normalisation, ISO 6346, diff and state hash, packing reason codes, ingest basics, views and gaps, rules on hand-built streams, configuration, scoring, ambiguous links, dispositions, dashboard API and rendering safety |
| `test/sync.integration.test.js` | 9 | Real HTTP: lifecycle, id reuse, generation success and failure, login and users, upload, fail-closed, fail-open, baseline and restart, capture disabled |
| `test/auth.integration.test.js` | 6 | Every route refuses anonymous requests; forged and expired tokens; admin from session role, not `adminUsername`; actor spoofing recorded and flagged; sessions end on restart; `SYNC_AUTH=off` |
| `test/scenarios.integration.test.js` | 56 | All 44 scenarios through the real synchroniser: expected findings and nothing else; citations exist; lineage, classification and linkage expectations; common-source falsification; duplicate evidence; post-issue divergence; event time vs ingestion time; deleted job; reconciliation clean and tampered |
| `test/adapters.test.js` | 3 | Python outbox; visualizer bridge → chain → finding; real B.I.I.L. `generate_all()` |
| `test/pipeline.test.js` | 13 (4 opt-in) | Missing file, invalid lines, duplicate delivery, retry after failure, incomplete line, artifact hash states, B.I.I.L. and stuffing-report evidence reaching analysis and case view, weak links never becoming contradictions, configuration and switches; **real windows** of the visualizer and the three WPF programs |

## Where each required case is tested

| Case | Test |
|---|---|
| Tampered record | store: "detects modified event contents", "…hash was recomputed" |
| Reordered events | store: "detects reordered records" |
| Missing events | store: "detects a deleted line", "interrupted write in the middle…" |
| Altered anchors | store: "altered head anchor is detected", "external anchor detects a full rewrite" |
| Interrupted writes | store: "incomplete final record…", "interrupted write in the middle…" |
| Concurrent writes | store: "concurrent writers in separate processes…" |
| Chain and anchor rewritten together | store: "LIMITATION: a full rewrite…", "external anchor detects…", "a head recorded elsewhere…" |
| Unauthorised writes | auth: "every API route except login refuses…", "admin privileges come from the session role…" |
| Actor spoofing | auth: "actor spoofing: the session identity is recorded…"; sync: lifecycle |
| Fail-closed | sync: "fail-closed: destructive operations are refused…" |
| Adapter: successful ingestion | adapters (all three), pipeline: "B.I.I.L. and stuffing-report evidence reaches…" |
| Adapter: duplicate delivery | pipeline: "duplicate delivery…"; scenarios: "duplicate evidence…" |
| Adapter: missing files | pipeline: "missing outbox file…", "artifact hashes…"; adapters: python outbox |
| Adapter: invalid data | pipeline: "invalid lines are rejected…"; units: ingest |
| Adapter: retry | pipeline: "retry: a failure part-way through…", "a line still being written…" |
| Common-source falsification | scenarios: "common-source falsification: agreement is reported as copies…" |
| Mismatched identifiers | pipeline: "mismatched identifiers…"; scenario `xapp_identifier_mismatch`, `xapp_ambiguous_link` |
| Missing evidence | scenario `xapp_unlinked_record`; units: "operations without a completion event…" |
| Duplicate evidence | scenario `xapp_duplicate_evidence` |
| Inconsistent records | scenarios `xapp_*_conflict`, `xapp_post_issue_divergence`, `xapp_document_backed_conflict` |

## Real application windows (opt-in)

```
set FORENSIC_GUI_TESTS=1
node --test test/pipeline.test.js
```

- **3D visualizer:** `e2e/visualizer_gui.py` opens the real pywebview window on the built bundle, waits for the bridge, types a shipment reference and clicks Recalculate through `evaluate_js`. Checks that the first run and the clicked run both reach the outbox and the chain.
- **EasyQuote, EasyQuoteImport, StuffingReport:** `e2e/wpf_click.ps1` starts the built program and presses "Copy HTML Table for Email" through Windows UI Automation. Checks the evidence line and its ingestion. The clipboard is replaced during the test and restored afterwards (text only).

These open windows on the desktop, so they are off by default.

## Paths that were NOT tested

| Path | Why | Risk |
|---|---|---|
| Synchroniser browser UI (login screen, session expiry handling, event stream after sign-in, logout) | No browser automation was used; only the API was driven | The `app.js` changes for sessions are untested in a browser |
| EasyQuote "Export Excel" and "Save HTML" | Need a save-file dialog | Same `RecordExport()` call as the tested clipboard path, plus a file hash |
| Visualizer "Export PDF" (`packing.report_saved`) | Needs a native save dialog | Untested code in `app.py Api.save_pdf` |
| Visualizer in a plain browser | No bridge exists there | By design nothing is captured |
| B.I.I.L. through its real window and file pickers; its PyInstaller build | The run was headless with dialogs stubbed; the build was not run | The packaged executable does not include the adapter |
| `document_generator.py` (legacy B.I.I.L.) | Not instrumented | — |
| Document-status toggle route | No caller exists in the UI (confirmed by source) | Instrumented by shared code, never exercised |
| Air and import job types; client-specific BL templates | Not generated | Template files may hold real client data and were not opened |
| Real checklists, invoices and packing lists | Not used | Parser accuracy on real documents unknown |
| More than one synchroniser process; more than ~12,000 events | Not tried | Analysis loads the whole event file |
| Disk-full and power loss | Simulated by an unwritable path and torn lines only | — |
| External anchor on a real separate host | Tested with a second local folder | Protection depends entirely on where it is put |

## Manual checks

```
node cli.js verify [--anchor <file>] [--expect <seq>:<hash>]
node cli.js head
node cli.js artifacts
node cli.js reconcile --db "../Workflow syncroniser/db.json"
node cli.js cases
node cli.js case CASE-XXXXXXXX
node cli.js timeline <job_no>
node cli.js ingest
node src/dashboard.js --port 3100
```

Add `--dir datasets/seed-1/evidence` to look at a synthetic dataset.

To see tamper detection by hand: copy a dataset's `evidence` folder, change one character inside `events.jsonl`, run `node cli.js verify --dir <copy>`.

## Regenerating data and results

See EXPERIMENTS_AND_RESULTS.md §9.
