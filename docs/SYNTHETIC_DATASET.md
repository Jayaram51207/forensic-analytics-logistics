# Synthetic Dataset

All experiment data is synthetic. No operational record, sample document or default value from the repository is used as scenario input.

## How it is produced

`forensics/synthetic/generate.js` starts a disposable Workflow Synchroniser (its own `db.json`, uploads, downloads and evidence folder) and drives it through the real HTTP API. The evidence in a dataset is therefore produced by the same capture code that runs in normal use.

```
node synthetic/generate.js --seed 1 --jobs 300 --out datasets/seed-1
node synthetic/generate.js --seed 101 --jobs 300 --out datasets/train-101 --normal-only
```

Requires a Python with `openpyxl` and `pdfplumber` (set `SYNC_PYTHON` if it is not the default `python`).

| Output | Content |
|---|---|
| `<out>/evidence/events.jsonl` | Hash-chained evidence |
| `<out>/db.json` | Final operational database |
| `<out>/outbox/desktop_tools.jsonl` | Records of the desktop tools (packing runs, B.I.I.L. batches, stuffing reports) before ingestion |
| `<out>/labels.json` | Ground truth, one entry per job |
| `<out>/manifest.json` | Seed, counts, errors |
| `<out>/features.csv` | Written later by `evaluation/evaluate.js` |

## Reproducibility

- One PRNG (mulberry32) per job, seeded from `seed × 100003 + job index`, so concurrency does not change the data.
- Same seed ⇒ same jobs, same field values, same scenario assignment, same simulated times.
- Not reproducible bit-for-bit: event ids, operation ids and correlation ids are random UUIDs, so hashes differ between runs.

## Simulated time

Requests carry `X-Forensic-Sim-Time`; the server honours it only when started with `FORENSIC_ALLOW_SIM_TIME=1`. Such events are stored with `clock_source: "simulated"`. Normal activity falls on weekdays between 04:00 and 12:00 UTC (09:30–17:30 IST) with gaps of 30 minutes to 8 hours between steps. Because jobs run concurrently, simulated timestamps are not monotonic across the file; `sequence` remains the order of record.

## What a job contains

`makeJob()` in `synthetic/lib.js`: fictional shipper and consignee, 1–3 containers with valid ISO 6346 numbers (fictional owner prefix `SY?U`), package counts and weights whose container totals equal the header, 1–9 charges, invoice and shipping-bill numbers with dates. The normal lifecycle completes the 19 sea-export steps in order, marks 0–2 optional steps N/A, and closes with a bill equal to the taxable or grand total of the stored charges. Only `sea_export` jobs are generated.

Checklist PDFs for upload scenarios are built by `checklistPdf()`: a one-page text PDF with the labels `pdf_parser.parse_checklist` looks for.

Every actor is a real signed-in session of one of five accounts (admin bootstrapped from a random `SYNC_ADMIN_PASSWORD`, desk1–desk4 created through the admin API with random passwords, changed at first sign-in). Deletion scenarios delete as the administrator. A "spoofed" actor is a request sent from Desk 4's session with another name in the body.

### Where records of the other applications come from

| Application | How the synthetic record is produced | How its schema was checked |
|---|---|---|
| 3D visualizer | The real `packing.js` is run on a manifest describing the job's own cargo; the result is summarised by the same `forensicPayload.js` the application uses | Real window driven in the opt-in GUI test |
| B.I.I.L. | `biilRecord()` writes a record in the adapter's schema, with totals computed by B.I.I.L.'s tax rule (2.5 % + 2.5 % on ocean freight) | Compared with a real `generate_all()` run in `adapters.test.js` |
| Stuffing report | `stuffingRecord()` writes a record in the adapter's schema | Compared with a real button click in the opt-in GUI test |

These are **synthetic records in the real schemas**, marked `capture_mode` in their payload. B.I.I.L. and the stuffing-report tool were not operated to produce them. They reach the evidence store through the same `ingest()` used for real outboxes.

## Scenarios

Defined in `synthetic/scenarios.js`. `expected_rules` is what the rules should raise; an empty list on an anomaly means the rules are **not** expected to detect it.

### Normal
| Type | Description |
|---|---|
| `clean_complete` | Consistent job, completed and closed |
| `clean_in_progress` | Consistent job stopped before a later step |

### Hard negatives (legitimate behaviour that resembles an anomaly)
| Type | Resembles | Why it is legitimate |
|---|---|---|
| `early_correction_regenerated` | post-generation edit | Corrected before any milestone; regeneration succeeded |
| `nonmaterial_late_edit` | late edit | Only ETA/ETD and delay flag changed; not in any generated document |
| `legit_reopen` | closure manipulation | Reopened once, closed again with identical bill |
| `regen_identical_few` | excessive regeneration | Two re-saves, below threshold |
| `deleted_draft` | suspicious deletion | Deleted shortly after creation, before any milestone |
| `source_matches` | source mismatch | Uploaded checklist agrees with stored values |
| `packing_fits` | packing problem | Linked packing run placed everything |

### Anomalies the rules should detect
| Type | Injection | Expected rule |
|---|---|---|
| `stale_documents` | Weights cut 20 % after issue; regeneration forced to fail | GEN-001 |
| `late_material_edit` | Consignee and weights changed after "Sailing Completed" | GEN-002 |
| `weight_mismatch` | Header gross weight understated 8–25 % | WGT-001 |
| `package_mismatch` | Header package count raised by 20–200 | WGT-001 |
| `billing_inconsistency` | Closing bill inflated 12–45 % | FIN-001 |
| `closing_changed_on_reclose` | Reopened and re-closed 25 % higher | FIN-001 |
| `premature_closure` | Closed with seven steps pending | WFL-001 |
| `excess_reversals` | Four completed steps reversed and redone | WFL-002 |
| `bulk_na` | Nine of nineteen steps N/A | WFL-003 |
| `regen_changed_excess` | Freight revised five times | GEN-003 |
| `regen_identical_excess` | Four identical re-saves | GEN-003 |
| `placeholder_charges` | Auto-inserted default charges billed unchanged | DEF-001 |
| `job_renamed` | Job number changed mid-workflow | IDN-001 |
| `deleted_after_close` | Closed job deleted | DEL-001 |
| `spoofed_actor` | Three key steps under a name matching no account | ACT-001 |
| `source_mismatch` | Stored weights 15 % below the uploaded checklist, consistently | SRC-001 |
| `unplaced_cargo` | Linked packing run exceeds payload or space | PCK-001 |

### Anomalies the rules are not expected to detect
| Type | Why |
|---|---|
| `unusual_timing` | Whole workflow completed in minutes at about 20:40 UTC. No rule looks at timing; a target for behavioural analysis |
| `consistent_falsification` | Weights understated 30 % from the first entry, consistently, no source document. Nothing in the evidence contradicts anything else |

### Cross-application scenarios

| Type | Class | What happens | Expected |
|---|---|---|---|
| `xapp_consistent` | hard negative | B.I.I.L. batch, packing run and stuffing report all agree with the job | No anomaly. One `XAP-TAX` note: the two programs tax ocean freight differently |
| `xapp_duplicate_evidence` | hard negative | Same B.I.I.L. line delivered twice, then re-exported unchanged | No anomaly; ingested once; still two lineage roots for the weight |
| `xapp_unlinked_record` | hard negative | A conflicting B.I.I.L. record with no job reference and no containers | Stays unlinked; nothing raised |
| `xapp_ambiguous_link` | hard negative | A draft is deleted and re-entered under the same job number; a conflicting B.I.I.L. record carries that number | Link ambiguous; `XAP-UNATTRIBUTED` note; no anomaly |
| `xapp_weight_conflict` | anomaly | B.I.I.L. gross weight differs 10-25 % | `XAP-GROSS_WEIGHT` |
| `xapp_package_conflict` | anomaly | Stuffing report counts fewer packages; linked by container number only | `XAP-PACKAGES` |
| `xapp_container_conflict` | anomaly | B.I.I.L. names a different container | `XAP-CONTAINER_NOS` |
| `xapp_charge_conflict` | anomaly | B.I.I.L. invoice bills 15-40 % more freight | `XAP-TAXABLE_TOTAL` |
| `xapp_identifier_mismatch` | anomaly | B.I.I.L. carries a different job number; linked by container | `XAP-JOB_NO` |
| `xapp_post_issue_divergence` | anomaly | B.I.I.L. documents issued; job weights then cut 15 % early in the workflow and regenerated | `XAP-GROSS_WEIGHT`, `XAP-NET_WEIGHT`. **The rules alone see a legitimate early correction** |
| `xapp_document_backed_conflict` | anomaly | Job understates weights 15 %; uploaded checklist and B.I.I.L. (made from it) show the originals | `SRC-001`, `XAP-GROSS_WEIGHT`, `XAP-NET_WEIGHT`, classified as potential fraud indicator |
| `xapp_late_activity` | anomaly | B.I.I.L. documents generated two days after closure | `XAP-TIMING` |
| `common_source_falsification` | anomaly, **undetectable** | The checklist itself carries false weights; job, generated documents and B.I.I.L. all repeat them | No finding. Corroboration must report one lineage root and say an independent source is required |

`labels.json` also records, per job, which external records belong to it (`params.external` with `should_link` true / false / `ambiguous`), which fields conflict (`params.conflict_fields`), and expected lineage (`params.expect_roots`).

### Data quality (not anomalies)
| Type | Expected |
|---|---|
| `bad_container_check_digit` | IDN-001 data-quality note |
| `missing_identifiers` | IDN-001 data-quality note |
| `malformed_source` | Parse failure recorded; no job-level finding |

## Labels

`labels.json` entries: `scenario_id`, `job_no`, `type`, `class` (`normal`, `hard_negative`, `anomaly`, `data_quality`), `anomalous`, `expected_rules`, `explanation`, `params`.

Labels are kept out of the detector's reach: they are returned by the scenario function to the generator, written to a separate file, and never sent to the synchroniser. The feature table puts label columns last with a `LABEL_` prefix, and the ML script drops every such column before fitting.

## Limits of this dataset

- Normal behaviour is my model of a clerk's work, not observed behaviour. Real gaps, corrections and step orders will be messier.
- Each anomaly is a clean, single injection. Real cases are partial, combined and disguised.
- Anomaly prevalence follows the `MIX` weights (about a quarter of jobs), far above any plausible real rate. Precision depends on prevalence; recall and false-positive rate do not.
- One job type, one generator template, one fictional office.
- Packing events are produced by running `packing.js` headlessly, not by the desktop application.
- No scenario covers IDN-002 (shared container) or EasyQuote quotations.
- Cross-application records are consistent with the job except for the one injected difference. Real tools would differ in formatting, rounding and timing in many small ways, each a possible false contradiction.
- Linking is tested on exact job numbers, container numbers, one ambiguous case and one unlinked case. Misspellings and partial references were not generated.
