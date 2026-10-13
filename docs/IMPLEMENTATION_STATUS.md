# Implementation Status

Last updated: 2026-10-13. Labels: **done** (implemented and tested), **partial**, **not done**.

## Phase checklist

| # | Phase | Status | Evidence |
|---|---|---|---|
| 0 | Repository audit and baseline | done | [BASELINE_AND_VERIFICATION.md](BASELINE_AND_VERIFICATION.md) |
| 1 | Event schema and catalogue | done | [FORENSIC_EVENT_SCHEMA.md](FORENSIC_EVENT_SCHEMA.md) |
| 2 | Independent evidence store | done | `forensics/src/store.js`; `test/store.test.js` (18 tests) |
| 3 | Synchroniser instrumentation | done | `forensics/src/capture.js`, `Workflow syncroniser/server.js`; `test/sync.integration.test.js` (9 tests) |
| 4 | Completeness and reconstruction | done | `forensics/src/model.js` (`reconstruct`, `reconcile`); scenario tests |
| 5 | Normalisation and entity resolution | done | `forensics/src/normalize.js`, `linkExternal` in `model.js` |
| 6 | Rule-based detection | done | `forensics/src/rules.js` (16 rules); [DETECTION_RULES.md](DETECTION_RULES.md) |
| 7 | Synthetic dataset and ground truth | done | `forensics/synthetic/`; [SYNTHETIC_DATASET.md](SYNTHETIC_DATASET.md) |
| 8 | Behavioural features and ML baseline | done, with a negative result | `features()` in `cases.js`, `evaluation/ml_baseline.py`; [EXPERIMENTS_AND_RESULTS.md](EXPERIMENTS_AND_RESULTS.md) |
| 9 | Evidence correlation and cases | done | `forensics/src/cases.js` |
| 10 | Investigation interface | done | `forensics/src/dashboard.js`, `forensics/public/index.html`, `forensics/cli.js` |
| 11 | Additional application adapters | partial | See below |
| 12 | Security, privacy, limitations | done (review and documentation); hardening not done | [SECURITY_AND_LIMITATIONS.md](SECURITY_AND_LIMITATIONS.md) |
| 13 | Testing and validation | done | 86 automated tests, all passing; [TESTING_GUIDE.md](TESTING_GUIDE.md) |
| 14 | Evaluation | done | [EXPERIMENTS_AND_RESULTS.md](EXPERIMENTS_AND_RESULTS.md) |
| 15 | Documentation | done | this folder |

## Test results (last full run)

`node --test` in `forensics/`, with a Python that has `openpyxl` and `pdfplumber`: **86 tests, 86 passed, 0 failed, 0 skipped**, about 27 s.

With the system Python as found on the development machine (no `openpyxl`): the two tests that need real document generation are skipped with a stated reason; the rest pass.

| File | Tests |
|---|---|
| `store.test.js` | 18 |
| `units.test.js` | 17 |
| `sync.integration.test.js` | 9 |
| `scenarios.integration.test.js` | 39 (31 scenarios + 8 checks) |
| `adapters.test.js` | 3 |

## Definition of done

| # | Criterion | Met | How shown |
|---|---|---|---|
| 1 | Real synchroniser changes produce structured events | yes | Integration tests over HTTP |
| 2 | Previous values and deletion snapshots preserved | yes | `job.update_requested`, `job.delete_requested`; erased closing-bill figures recovered in test |
| 3 | Generated documents tied to inputs and events | yes | `operation_id`, `input_sha256`, output hashes, archived copies |
| 4 | Integrity independently verifiable | yes, within stated limits | `cli.js verify`; adversarial tests. Not immutable: see limitations |
| 5 | Normalised and correlated without hiding uncertainty | yes | Originals kept; link method and confidence; ambiguity test |
| 6 | Rules find known synthetic anomalies with evidence links | yes | Scenario tests; every finding cites existing event ids |
| 7 | Behavioural detection evaluated against rules-only | yes | Reported honestly, including that it performed poorly |
| 8 | Findings assembled into cases | yes | `analyze()`, `caseDetail()` |
| 9 | Investigator can reconstruct chronology | yes | Dashboard and `cli.js case` |
| 10 | Tests cover behaviour, integrity failure, regression | yes | 86 tests |
| 11 | Results reproducible and qualified | yes | Seeds and commands in the results document |
| 12 | Documentation separates implemented from planned | yes | This file |

Core acceptance path (synthetic job with a controlled anomaly → captured → integrity verified → detected → correlated → reconstructable) is exercised by the test "core demonstration: anomaly -> case -> reconstructable timeline".

## Phase 11 detail

| Application | Implemented | Tested | Gap |
|---|---|---|---|
| 3D visualizer | Reason codes in `packing.js`; packing-run event; report-saved event; optional shipment reference field; `dist/` rebuilt | Reason codes, payload, Python bridge, ingestion, resulting finding | GUI not driven; `save_pdf` event not executed; nothing captured in plain-browser mode |
| B.I.I.L. unified | Snapshot per `generate_all()` | Real headless run; hashes checked against files | PyInstaller build does not bundle the adapter; upload/parse events not emitted separately; legacy `document_generator.py` untouched |
| EasyQuote ×3 | `RecordExport()` on every export and copy | All three projects compile, 0 warnings | Never executed. No rule consumes these events yet. No shipment reference exists in these tools |

These applications should be described as **having adapters**, not as integrated, until their events are seen arriving from real use.

## Not done

- Authenticated sessions in the synchroniser (actors remain unverified claims).
- External anchoring or write-once storage for the evidence chain.
- Backup, retention and deletion policy.
- Rules over EasyQuote and B.I.I.L. evidence (events are stored and linkable; nothing analyses them).
- Cross-document comparison of generated workbook **contents** (hashes and input snapshots are compared; cell values are not read back).
- Full replay of evidence into a `db.json`.
- Scenarios for air and import job types, and for IDN-002.
- Validation against real operational data.

## Open questions for the project owner

1. May the sample documents, templates and hard-coded defaults in the repository be used or published?
2. Which workflow steps are truly mandatory before closure, and which fix the record (`required_before_close`, `lock_steps`)?
3. Which tax treatment is correct for ocean freight: 9 %+9 % or 2.5 %+2.5 %?
4. Should the closing bill equal the taxable total, the grand total, or the amount after TDS?
5. Fail-closed or fail-open in real use?
6. Is the document-status toggle used anywhere in practice?

## Action needed on this machine

The system Python has no `openpyxl` or `pdfplumber`. Until `pip install openpyxl pdfplumber` is run, the synchroniser saves jobs without generating documents and reports nothing to the user. (With capture on, each such attempt is now recorded as `document.generation_failed`.)

## Next step if work continues

Add server-side sessions to the synchroniser and switch `actor.source` to a verified value; then store the evidence head hash outside the application host.
