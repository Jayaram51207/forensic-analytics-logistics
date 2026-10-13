# Testing Guide

## Requirements

- Node.js 20 or later (developed on 24.11). The forensic layer has no npm dependencies.
- `Workflow syncroniser/node_modules` installed (`npm install` in that folder).
- Python 3 with `openpyxl` and `pdfplumber` for anything that generates documents or parses PDFs; `scikit-learn` and `numpy` for the ML baseline; `pywebview` for the visualizer adapter test.
- .NET SDK 10 only to rebuild the WPF projects.

If your default `python` lacks those packages, point the tests at one that has them:

```
set SYNC_PYTHON=C:\path\to\venv\Scripts\python.exe        (cmd)
export SYNC_PYTHON=/c/path/to/venv/Scripts/python.exe     (Git Bash)
```

Tests that need a missing component are **skipped with a stated reason**, not passed.

## Run everything

```
cd forensics
node --test
```

Every integration test starts its own synchroniser on a random port with its database, uploads, downloads and evidence in a temp folder. The live `db.json` and `forensics/data` are never touched.

## Test files

| File | Scope | Needs |
|---|---|---|
| `test/store.test.js` | Canonical JSON, append, hash links, every tampering case, truncation, torn write, write failure, head-anchor failure, query filters, four concurrent writer processes | Node |
| `test/units.test.js` | Normalisation, ISO 6346, diff and state hash, packing reason codes, ingest validation and de-duplication, views and gaps, rules on hand-built streams, configuration, scoring, ambiguous links, dispositions, dashboard API and rendering safety | Node |
| `test/sync.integration.test.js` | Real HTTP against the synchroniser: lifecycle, id reuse, generation success and failure, login and users, upload, fail-closed, fail-open, baseline and restart, capture disabled | Node; Python for the generation test |
| `test/scenarios.integration.test.js` | All 31 scenarios once: expected findings and nothing else; evidence citations exist; case and timeline; deleted job; reconciliation clean and tampered | Node + Python |
| `test/adapters.test.js` | Python outbox, visualizer bridge → chain → finding, real B.I.I.L. `generate_all()` | Python, pywebview, Tk |

## Adversarial integrity cases

| Case | Test name |
|---|---|
| Content modified | "detects modified event contents" |
| Modified and re-hashed | "detects a modified record whose hash was recomputed" |
| Line deleted | "detects a deleted line" |
| Records reordered | "detects reordered records" |
| Invalid JSON | "detects invalid JSON without hiding later records" |
| Tail truncated | "detects truncation of the tail via the head anchor" |
| Only last record valid | "does not report success merely because the last record is valid" |
| Torn final write | "incomplete final record is reported and later appends stay parseable" |
| Duplicate id | "duplicate event ids are reported" |
| Store unwritable | "write failure raises ForensicWriteError…", "fail-closed…", "fail-open…" |
| Delete without evidence | "fail-closed: destructive operations are refused…" |
| Database edited behind the API | "reconciliation detects an uncaptured write and a silent deletion" |
| Markup in stored data | "dispositions … dashboard serves cases safely" |

## Manual checks

```
node cli.js verify                                   # integrity of forensics/data
node cli.js reconcile --db "../Workflow syncroniser/db.json"
node cli.js cases
node cli.js case CASE-XXXXXXXX
node cli.js timeline <job_no>
node cli.js ingest                                   # desktop-tool outboxes
node src/dashboard.js --port 3100                    # http://127.0.0.1:3100
```

Add `--dir datasets/seed-1/evidence` to look at a synthetic dataset instead.

To see tamper detection by hand: copy a dataset's `evidence` folder, change one character inside `events.jsonl`, run `node cli.js verify --dir <copy>`.

## Regenerating data and results

```
node synthetic/generate.js --seed 101 --jobs 300 --out datasets/train-101 --normal-only
node synthetic/generate.js --seed 1 --jobs 300 --out datasets/seed-1        # likewise 2 and 3
node evaluation/evaluate.js datasets/train-101 datasets/seed-1 datasets/seed-2 datasets/seed-3
python evaluation/ml_baseline.py --train datasets/train-101 --test datasets/seed-1 datasets/seed-2 datasets/seed-3
```

Results land in `evaluation/results/rules.json` and `ml.json`. About four minutes per 300-job dataset on the development machine.

## Not covered by automated tests

- The synchroniser's browser UI (only its API is exercised).
- The visualizer GUI and `save_pdf` (needs a window and a save dialog).
- EasyQuote exports at runtime (the projects compile; `RecordExport` was not executed).
- `air_*` and `sea_import` job types, client-specific BL templates.
- Load beyond 300 jobs / ~11,000 events.
- Disk-full and power-loss behaviour (only simulated by an unwritable path and a torn line).
