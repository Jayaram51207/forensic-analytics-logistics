# Baseline and Verification

What was run, on what, and what it showed. Date of work: 2026-10-13.

## Environment

| Item | Value |
|---|---|
| OS | Windows 11 Home 10.0.26200 |
| Node.js | 24.11.1 |
| Python | 3.13.9 |
| .NET SDK | 10.0.400 |
| Version control | **None.** The folder is not a git repository. Originals of every modified file were kept and are reproduced as diffs in `docs/patches/` |
| System Python packages | `scikit-learn` 1.8.0, `numpy` 2.4.2, `pywebview` present; **`openpyxl` and `pdfplumber` absent** |
| Test Python | A virtual environment with `openpyxl` 3.1.5 and `pdfplumber` 0.11.10 added (session-temporary; recreate with `pip install openpyxl pdfplumber`) |

**Consequence for the live machine:** with the system Python as found, the synchroniser cannot generate documents or parse PDFs. Every job is saved without download links, and the failure appears only on the server console. Install the two packages before relying on it.

## Baseline: unmodified synchroniser

Run on a disposable copy (`server.js`, `db.js`, `db.json`, `compiler.py`, `pdf_parser.py`, `public/`, `Templates/`, `node_modules/`), port 3901, before any change to the repository.

| Check | Result |
|---|---|
| Starts; seeds five accounts when `db.json` has an empty user list | Confirmed |
| `POST /api/login` with `desk1`/`desk1` | 200, returns name and role |
| `POST /api/jobs` with a synthetic job | 201; one history row; documents all `Pending` because the compiler failed (missing `openpyxl`) |
| Compiler failure visible to the client | No. Console only |
| Step change with `user: "Mallory (not a user)"` | Stored as `updated_by` |
| `GET /api/logs` without / with `?adminUsername=admin` | 403 / 200 |
| `GET /uploads/x.pdf` | `text/html` (falls through to the app page) |
| `POST /api/parse-checklist` | 500, ENOENT: `uploads/` does not exist |
| `DELETE /api/jobs/1` | `jobs` 0, `history_logs` 0 |
| `compiler.py compile` run directly with `openpyxl` available | Succeeds in about 0.9 s; two workbooks |
| Same input compiled twice | Different SHA-256 for both files |

These confirm at runtime the main claims of the static report: spoofable actor, bypassable admin check, history lost on delete, silent compile failure, unreachable uploads.

## Static-report items resolved

| Item from the reverse-engineering report | Outcome |
|---|---|
| "Uploads fail until the folder exists" (inferred) | Confirmed by runtime test |
| "`/uploads` is not served" (inferred) | Confirmed |
| "WPF projects build?" (unverified) | All three build, 0 warnings, including the new adapter |
| "Compile succeeds end to end?" (unverified) | Yes with the generic template and `Billing_Invoice.xlsx`, once `openpyxl` is installed |
| "Checklist parser accuracy" (unverified) | Works on a synthetic checklist laid out for it (job number, invoice, shipping bill, weights, packages, container). **Still unverified on real checklists** |
| "Document-status toggle reachable from the UI?" | Still unverified; the route is instrumented either way |
| "Vite build works?" | Yes; `dist/` rebuilt |

## Verification of the forensic layer

Automated test results are recorded in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); how to rerun them is in [TESTING_GUIDE.md](TESTING_GUIDE.md).

| Claim | Evidence |
|---|---|
| Live data was not touched by any test or dataset run | `Workflow syncroniser/db.json` still holds 0 jobs; `forensics/data/` does not exist yet |
| Existing behaviour preserved | Regression run with `FORENSIC_DISABLED=1`; 31 scenario lifecycles through the unmodified routes; B.I.I.L. still writes its documents; three WPF builds |
| Capture works on the real application | `sync.integration.test.js`, `scenarios.integration.test.js` |
| Datasets verify | `integrity_ok` in `evaluation/results/rules.json` |

## Defects found by testing and fixed

| Found by | Defect | Fix |
|---|---|---|
| Integration test | "Before" snapshot shared live row objects; step changes showed no difference | Deep copy before mutation |
| Scenario test | Every deletion flagged as anomalous | DEL-001 keyed on closure/milestone |
| First dataset evaluation | On Windows, renaming the head anchor occasionally failed with EPERM (8 of ~11,000 writes). The record was already written but the append reported failure, so the server refused that request with 503. The generator ignored the status, and three "clean" jobs were really closed with a step pending | Head-anchor write retried and made non-fatal; generator aborts a scenario on any refused call; all datasets regenerated |

The third item is worth noting: the unexpected findings were correct descriptions of the jobs' real state, and the evidence gap (`operation_incomplete`) pointed straight at the cause.

## Not verified

- Behaviour on real checklists, invoices and client-specific templates.
- Synchroniser browser UI after the change to `app.js` (two fetch calls now send a header).
- Visualizer GUI path and PDF save event.
- EasyQuote exports at runtime.
- Any concurrency beyond one synchroniser process plus test writers.
- Operation on a machine other than the development one.
