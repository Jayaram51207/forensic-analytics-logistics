# Implementation Status

Last updated: 2026-10-26 (branch `final-hardening`). Labels: **done** (implemented and tested), **partial**, **not done**, **blocked** (needs a decision or access).

## Recovery point

Git repository. Tags: `original-suite` (applications as received), `forensic-v1` (first forensic layer), `forensic-v2` (phases 1–8, unchanged). This round is on branch `final-hardening`, not pushed. See RUNTIME_SETUP.md §1. No live operational data is tracked; `Workflow syncroniser/db.json` still holds zero jobs and `forensics/data/` has not been created.

## Hardening and contribution phases

| # | Phase | Status | Evidence |
|---|---|---|---|
| 1 | Recoverability and baseline | done | 14 of 14 patches reverse to the exact originals; two tagged commits |
| 2 | Environment and end-to-end verification | done, with untested paths listed | `forensics/setup_env.cmd`, `e2e/run_e2e.js` (26/26), real visualizer and WPF windows driven; TESTING_GUIDE "Paths that were NOT tested" |
| 3 | Integrity, security, failure handling | done; residual weaknesses documented | Sessions in `server.js`; `auth.integration.test.js`; external anchor and limitation tests in `store.test.js`; SECURITY_AND_LIMITATIONS.md; RUNTIME_SETUP.md §5–6 |
| 4 | Complete the evidence pipeline | done for ingestion and analysis; partial for capture coverage | `pipeline.test.js`; `verifyArtifacts`; B.I.I.L., stuffing-report and packing evidence analysed. EasyQuote quotations are captured and stored but not analysed |
| 5 | Provenance-aware contradiction analysis | done | `src/provenance.js`; cases, dashboard, timeline; PROVENANCE_AND_CONTRADICTIONS.md |
| 6 | Synthetic data and business assumptions | done; four questions remain open | 44 scenarios; SYNTHETIC_DATASET.md; open questions below |
| 7 | Evaluation of the contribution | done | EXPERIMENTS_AND_RESULTS.md; `evaluation/results/` |
| 8 | Documentation and final verification | done | this folder; final test run below |

Earlier phases (store, capture, rules, cases, dashboard, first evaluation) remain as described at tag `forensic-v1` and are covered by the same test suite.

## Final hardening round (branch `final-hardening`)

| Task | Status | Evidence |
|---|---|---|
| A. Data and repository audit | done; publication **blocked** | DATA_AND_REPOSITORY_AUDIT.md; `.gitattributes` export-ignore (65/65 documents); `.gitignore` secrets; private paths removed from `document_generator.py`, `scratch/test_cotton.py` |
| B. Credentials | done | No default accounts; `SYNC_ADMIN_PASSWORD` bootstrap; policy; forced first change; change-password screen and `POST /api/password`; admin reset (API only); session end on change/reset/deletion; 24 h absolute lifetime; login throttling; `test/credentials.integration.test.js` (12) |
| C. Browser tests | done in Edge headless | `test/browser.test.js` (18). Found and fixed: dashboard case view crash (provenance overwritten), provenance panels rendered as "[object HTMLDivElement]", forced-password dialog hidden behind the workspace overlay, unclear evidence-failure message. 4 desktop-window GUI tests also run |
| D. External anchor | done on one machine; **cross-machine test pending** | `src/anchor_server.js`, `EventStore.flushRemote/verifyRemote`, `cli.js verify`; `test/anchor.remote.test.js` (9); e2e step 28; EXTERNAL_ANCHOR.md |
| E. Business questions | safe defaults implemented; Q1–Q4 still need a business decision | `config/business_rules.json` (all null), `src/business_rules.js`, dashboard banner; admin-only deletion; DECISIONS_AND_OPEN_REQUIREMENTS.md |
| F. Regression | done | below |
| G. Documentation | done | RUNTIME_SETUP, SECURITY_AND_LIMITATIONS, TESTING_GUIDE, SYNTHETIC_DATASET, EXTERNAL_ANCHOR (new), this file; `docs/patches/` regenerated: 19 diffs, all reverse-apply cleanly against `original-suite` |

## Verification status

| Check | Result | When |
|---|---|---|
| `node --test` in `forensics/` | 174 tests: 170 passed, 0 failed, 4 skipped (the opt-in desktop-window tests) | 2026-10-26 |
| Same with `FORENSIC_GUI_TESTS=1` | 174 tests: 174 passed, 0 failed, 0 skipped (includes the 4 real-window tests and 18 browser tests) | 2026-10-26 |
| `node e2e/run_e2e.js` | 28 of 28 steps (document generation in `forensics/.venv`, remote witness in a second process) | 2026-10-26 |
| Baseline at `forensic-v2` | 131 tests: 127 passed, 4 skipped; e2e 26/26 | 2026-10-14 |
| Three WPF projects build | 0 warnings, 0 errors | phase 2 of the first round; binaries reused |
| Visualizer bundle builds | yes (`npm run build`) | after the bridge-ready change |
| Four datasets generated, chains verify, no capture failures | yes; 4 jobs lost to generator network errors | final datasets |

## Definition of done

| Criterion | Met | Note |
|---|---|---|
| Repository recoverable | yes | tags and reversible patches |
| End-to-end operation demonstrated in a controlled environment | yes | scripted, disposable, repeatable |
| Evidence capture, integrity verification, actor attribution tested | yes | including the case integrity does not cover |
| Adapters feed real analysis | partly | B.I.I.L., stuffing report, packing: yes. EasyQuote quotations: captured only |
| Provenance-aware contradiction analysis implemented and integrated | yes | findings, cases, score, dashboard, CLI |
| Contribution evaluated against the previous system | yes | variants A, B, C, D on the same data and labels |
| Report separates verified facts, synthetic findings, assumptions, untested behaviour | yes | each document labels them |

## Mismatches found between documentation and code at the start of this round, and fixed

| Document said | Reality | Fix |
|---|---|---|
| "EasyQuote export never executed", "visualizer GUI not driven" | Still true then | Both now driven; documents updated |
| Actors are unverified claims; no sessions | True then | Sessions implemented; documents rewritten |
| "Hash chain … head anchor detects truncation" without saying both can be rewritten together | Under-stated | Limitation now demonstrated by a test and stated first |
| Packing scenarios described as "linked packing run" | Manifests were unrelated to the job's cargo (found by the new contradiction analysis) | Manifests now describe the job's own cargo |
| `docs/patches/` as the only record of originals | No version control | Git history; patches regenerated from `git diff original-suite` |

## Open questions

| # | Question | Status | Basis |
|---|---|---|---|
| 1 | May the sample documents, templates and hard-coded defaults be used or published? | **blocked; excluded from distribution** | Audited (DATA_AND_REPOSITORY_AUDIT.md): likely real GSTINs/PANs. Needs their owner |
| 2 | Which workflow steps are mandatory before closure, and which fix the record? | **unresolved; configurable, labelled "not verified"** | `required_before_close` in `config/business_rules.json` (null). `lock_steps` remains a labelled assumption |
| 3 | Correct tax treatment of ocean freight: 9 %+9 % or 2.5 %+2.5 %? | **unresolved; configurable** | `tax_scheme` (null). When set, FIN-001 and XAP-TAX use it and XAP-TAX becomes a confirmed inconsistency |
| 4 | Should the closing bill equal taxable total, grand total, or amount after TDS? | **unresolved; configurable** | `closing_bill_basis` (null) |
| 5 | Fail-closed or fail-open in real use? | **default kept (closed)**; override explicit and recorded | Needs the business owner to accept the stopped-work consequence |
| 6 | Is the document-status toggle used? | **resolved from source** | `toggleDocument` is defined in `app.js` and called nowhere in `app.js` or `index.html`. The route is reachable only by direct API call |

| 7 | Should deleting a job require the Admin role? | **default applied: admin-only**, server-enforced; `SYNC_DELETE_REQUIRES_ADMIN=0` restores the original | Needs the operations manager to confirm |

## Blockers

| Blocker | Affects | Work proceeded by |
|---|---|---|
| No answer on data provenance (Q1) | Publishing the repository; using real documents for parser validation | Synthetic data only |
| No authoritative business rules (Q2–Q4) | Severity and precision of GEN-002, WFL-001, FIN-001, XAP-TAX on real data | Configurable assumptions, both tax rules accepted |
| No independent data source | Detecting consistent falsification | Stating the limit explicitly on every case |
| No real operational data or users | Any claim about real performance or usefulness | Not claimed |

## Not done

- HTTPS, multi-factor authentication, finer-grained authorisation, an admin-reset button in the UI.
- Physical cross-machine anchor test (procedure ready: EXTERNAL_ANCHOR.md §3); trusted timestamps; backup automation; retention policy.
- Regenerating `datasets/` and `evaluation/results/` after this round (deletion scenarios now act as the administrator; the scenario test confirms every scenario still yields its expected findings, but the published numbers are from `forensic-v2`).
- Removing unverified documents from git history (owner's decision; irreversible for clones).
- Analysis of EasyQuote quotations (free text, no shipment reference).
- Capture of B.I.I.L. upload/parse steps separately; adapter in its PyInstaller build.
- Reading generated workbooks back to compare cell values.
- Full replay of evidence into `db.json`.
- Scenarios for air and import jobs, misspelt references, combined anomalies.
- Evaluation with human reviewers.

## Recommended next steps

1. Get answers to Q1–Q4 and confirm Q5–Q7 (DECISIONS_AND_OPEN_REQUIREMENTS.md); fill in `config/business_rules.json`.
2. On any existing installation, reset or delete the old seeded accounts.
3. Run the remote witness on another machine (EXTERNAL_ANCHOR.md §3, steps 1–10), record the result, and schedule backups.
4. Run the parser against a small set of cleared, real checklists and measure extraction accuracy; SRC-001 and all document-backed contradictions depend on it.
5. Add a shipment-reference field to EasyQuote and B.I.I.L. exports so links do not depend on typed job numbers and container numbers.
6. Have someone other than the author write anomaly scenarios, and evaluate on those.
