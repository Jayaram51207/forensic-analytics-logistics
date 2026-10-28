# Testing Guide

## Requirements

See RUNTIME_SETUP.md §2. In short: Node.js 20+, `npm install` in `Workflow syncroniser/`, `npm install` in `forensics/` (installs `playwright-core` for the browser tests; no browser is downloaded), and `forensics\setup_env.cmd` once to create the Python environment. The tests find `forensics\.venv` by themselves; `SYNC_PYTHON` overrides it.

Browser tests drive the installed Microsoft Edge (or Chrome) headless through `playwright-core`. They are skipped with a reason if neither is installed, if `playwright-core` is missing, or with `FORENSIC_BROWSER_TESTS=0`. Edge is preferred, then Chrome; `FORENSIC_BROWSER_SHOTS=<folder>` saves screenshots. The page may not reach the internet: every non-local request is blocked.

Test credentials are random for every test instance and live only in that instance's temp folder (`test_credentials.json`). No shared or predictable password exists.

Tests that need a missing component are **skipped with a stated reason**, never counted as passed.

## Run everything

```
cd forensics
npm test                       # = node --test "test/*.test.js"; 4 desktop-window tests skipped unless FORENSIC_GUI_TESTS=1
node e2e/run_e2e.js            # 28-step end-to-end run on a disposable synchroniser
```

Plain `node --test` also works, but Node's default discovery also loads `test/helpers.js` (no tests in it) and counts that file as one passing test, so it reports one more test than exist. The counts up to 2026-10-27 below include that extra one.

Every integration test starts its own synchroniser on a random port, with database, uploads, downloads and evidence in a temp folder, and signs in through the real login route. The live `db.json` and `forensics/data` are never opened.

Run 2026-10-28 at `bc86d5c` (same code as `4f845f6`): `node --test` 189 reported (= 188 tests + `helpers.js`), 185 passed, 0 failed, 4 skipped; `npm test` **188 tests, 184 passed, 0 failed, 4 skipped**. Then `test/reproducibility.test.js` was added (1 test, passed): **189 tests with `npm test`**. GUI and e2e were not re-run that day.

Run 2026-10-29 (after the linkage, evaluation and dashboard round): `npm test` **195 tests, 191 passed, 0 failed, 4 skipped** (opt-in desktop-window tests); `test/browser.test.js` 19/19 after the redesign. GUI and e2e not re-run in that round.

Previous full run (2026-10-27, commit `ce611ac`): **189 tests, 185 passed, 0 failed, 4 skipped** (opt-in desktop-window tests); with `FORENSIC_GUI_TESTS=1`: **189/189 passed**. End-to-end: 28/28. New this round: `test/demo.integration.test.js` (acceptance run through the real pipeline), a browser test of the analysis dashboard on demo data, an EasyQuote ingestion test, and 4 new scenarios plus 2 rules in the scenario test (61 subtests). (Earlier: 182 at `8add33d`, 174 at `e932963`, 131 at `forensic-v2`.)

## Test files

| File | Tests | Scope |
|---|---|---|
| `test/store.test.js` | 26 | Canonical JSON, append, hash links, every tampering case, truncation, torn writes at end and mid-file, write failure, head-anchor failure, altered head anchor, query filters, four concurrent writer processes, **full-rewrite limitation**, external anchor, expected-head check, unwitnessed records |
| `test/units.test.js` | 21 | Business-rule configuration (validation, FIN-001 basis and tax scheme, XAP-TAX resolved by configuration, WFL-001 "not verified"); normalisation, ISO 6346, diff and state hash, packing reason codes, ingest basics, views and gaps, rules on hand-built streams, configuration, scoring, ambiguous links, dispositions, dashboard API and rendering safety |
| `test/sync.integration.test.js` | 9 | Real HTTP: lifecycle (desk deletion refused, admin deletion), id reuse, generation success and failure, login and users, upload, fail-closed, fail-open, baseline and restart, capture disabled |
| `test/auth.integration.test.js` | 6 | Every route refuses anonymous requests; forged and expired tokens; admin from session role, not `adminUsername`; actor spoofing recorded and flagged; sessions end on restart; `SYNC_AUTH=off` |
| `test/scenarios.integration.test.js` | 61 | All 49 scenarios through the real synchroniser: expected findings and nothing else; citations exist; lineage, classification and linkage expectations; common-source falsification; duplicate evidence; post-issue divergence; event time vs ingestion time; deleted job; reconciliation clean and tampered |
| `test/adapters.test.js` | 3 | Python outbox; visualizer bridge → chain → finding; real B.I.I.L. `generate_all()` |
| `test/credentials.integration.test.js` | 12 | No default accounts; weak bootstrap refused; only hashes stored, nothing leaked to logs or evidence; malformed credentials; enumeration resistance; throttling; forced first change; change with right and wrong current password; sessions ended by change, reset, deletion; idle and absolute expiry; legacy weak passwords forced to change; admin-only deletion and its override; fail-open announced |
| `test/browser.test.js` | 19 | **Real synchroniser UI in Edge:** invalid login, sign-in, upload and autofill, job creation with document generation, edit, workflow tick, desk delete refused, evidence-store failure dialog, password change, session ended elsewhere, forced change after admin reset, admin delete and logout, no console errors. **Dashboard:** empty store and unconfigured business rules banner, case with contradiction and provenance panels, malformed evidence, markup safety. **Analysis dashboard on demo shipments:** filters, ground truth, unlinked evidence, Evaluation tab |
| `test/anchor.remote.test.js` | 12 | Remote witness (same machine): hashes only leave the host; full rewrite after altered, deleted, reordered, truncated records; rewritten local anchor file; refused re-anchoring; witness outage and catch-up; token and input checks; store allowlist; no history-changing route; `cli.js anchor` catch-up |
| `test/business_rules.test.js` | 2 | CLI and dashboard report the same cases and business-rule status for every configuration; invalid configuration refused by both |
| `test/tls.integration.test.js` | 2 | HTTPS option: `Secure` cookie, no plain HTTP, TLS recorded; plain HTTP warns and the cookie is not `Secure` (first test skipped without `openssl`) |
| `test/demo.integration.test.js` | 1 | Demo shipments through the real pipeline: cross-application links, contradictions, provenance, controls clean |
| `test/linkage.test.js` | 6 | Shipment references of desktop-tool records: exact link with normalisation, missing, malformed (never normalised into a match), unknown, reference and containers pointing to different jobs (uncertain), duplicate delivery, manual link (validation, reason and actor recorded, record unchanged, conflict kept uncertain), evidence API and review-token handling |
| `test/reproducibility.test.js` | 1 | Same seed generated twice: identical labels (event ids aside), `features.csv` and evaluation figures |
| `test/pipeline.test.js` | 14 (4 opt-in) | Missing file, invalid lines, duplicate delivery, retry after failure, incomplete line, artifact hash states, B.I.I.L. and stuffing-report evidence reaching analysis and case view, weak links never becoming contradictions, configuration and switches; **real windows** of the visualizer and the three WPF programs |

## Where each required case is tested

| Case | Test |
|---|---|
| Tampered record | store: "detects modified event contents", "…hash was recomputed" |
| Reordered events | store: "detects reordered records" |
| Missing events | store: "detects a deleted line", "interrupted write in the middle…" |
| Altered anchors | store: "altered head anchor is detected", "external anchor detects a full rewrite"; anchor.remote: "…rewrote the local anchor file" |
| Remote anchor | anchor.remote (all); e2e step 28 |
| Credentials and sessions | credentials (all); browser: password change, session ended elsewhere, forced change |
| Browser UI | browser (all) |
| Business rules | units: "business rules: …" (4 tests); browser: dashboard empty state |
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
| External anchor on a real separate host | Witness tested in another process and folder on the same PC only; procedure in EXTERNAL_ANCHOR.md §3 | Protection depends entirely on where it is put. **Pending** |
| Synchroniser UI in Firefox/Safari, on small screens, with a real idle timeout of 12 h | Edge headless only; expiry tested with shortened times | Low |
| Admin tab user management in the browser | Driven through the API in tests | Low |

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
