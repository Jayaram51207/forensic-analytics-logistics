# Detection Rules

Implemented in `forensics/src/rules.js`. Every finding carries `rule_id`, `rule_version`, `family`, `kind`, `severity`, `title`, `explanation`, `evidence_event_ids`, `details` and `assumptions`.

A finding is a **potential anomaly requiring review**. No rule decides that fraud occurred.

## Finding kinds

| Kind | Meaning | Counts toward case priority |
|---|---|---|
| `anomaly` | A condition a reviewer should look at | yes |
| `data_quality` | Data is missing, unparseable or malformed, so a comparison could not be made or an identifier looks mistyped | no |
| `notice` | Recorded for completeness (for example an early deletion) | no |

Missing or unparseable data never produces an `anomaly`: the rule reports that it could not compare.

## Configuration (`DEFAULT_CONFIG`)

| Key | Default | Status |
|---|---|---|
| `output_fields` | Fields `compiler.py` writes into workbooks | Read from source |
| `lock_steps` | `Document Verified (Before Sailing)`, `Sailing Completed`, `Flight Status`, `OOC`, `Job Closed` | **Assumption**, unconfirmed business rule |
| `required_before_close` | `'all'` (every step not marked N/A) | **Assumption**; the application enforces no order |
| `weight_tolerance` | 1 kg or 0.5 % | Chosen |
| `money_tolerance` | 1 or 0.1 % | Chosen |
| `tax_schemes` | 9 %+9 % on all charges (`compiler.py`); 2.5 %+2.5 % on ocean freight, else 9 %+9 % (`unified_generator.py`) | Both taken from the repository; neither confirmed authoritative |
| `tds_rate` | 2 % | From both implementations |
| `placeholder_charge_sets` | The two triples hard-coded in `public/js/app.js` `handleChecklistUpload` | Read from source |
| `regen_changed_threshold` / `regen_identical_threshold` | 4 / 3 | Chosen |
| `reversal_threshold` | 3 | Chosen |
| `bulk_na_fraction` | 0.4 | Chosen |
| `check_container_check_digit` | true | ISO 6346 |
| `disabled_rules` | `[]` | — |

Pass overrides as the second argument of `analyze(records, config)`.

## Rules

### GEN-001 · document_integrity · high — Record changed after generation; documents not regenerated
- **Evidence:** `document.generated`, a later `job.updated` with changes to `output_fields`, and the generation attempt of that update.
- **Condition:** an earlier successful generation exists; the update changed at least one output field; neither that update's own generation nor any later one succeeded.
- **Why it can happen here:** the synchroniser regenerates on every save but ignores compiler failures, leaving older documents on disk.
- **False positives:** the documents were never sent; the field is not shown in the particular template used.
- **Tests:** scenario `stale_documents`; hard negative `early_correction_regenerated`.

### GEN-002 · late_modification · high — Output-affecting edit after a milestone
- **Condition:** an update changed output fields while a `lock_steps` step was already Completed.
- **False positives:** authorised amendments after sailing (these are real and common); wrong `lock_steps` for the business.
- **Tests:** `late_material_edit`; hard negatives `nonmaterial_late_edit`, `early_correction_regenerated`.

### GEN-003 · regeneration · medium / low — Unusually many generations
- **Condition:** ≥ 4 attempts whose input hash differs from the previous one (medium); ≥ 3 attempts repeating the previous input (low).
- **Note:** identical regeneration is judged from the **input** hash and the content fingerprint. Raw output hashes always differ.
- **False positives:** a clerk who saves often.
- **Tests:** `regen_changed_excess`, `regen_identical_excess`; hard negative `regen_identical_few`.

### WGT-001 · quantity_consistency · medium — Header differs from container totals
- **Compared:** header gross weight vs Σ container gross; header net vs Σ container net; header package count vs Σ container packages. Same quantity and unit only.
- **Not compared when:** there are no container rows; no container row has that figure; some rows lack it (data-quality note); the header is unparseable (data-quality note).
- **False positives:** part shipments where the header describes the whole consignment; the parser putting all weight on the first container (totals still agree).
- **Tests:** `weight_mismatch`, `package_mismatch`; unit test for unparseable input.

### FIN-001 · financial_consistency · high / medium — Closing bill not explained by charges
- **At each `job.closed`:** closing bill amount must match one of taxable total, grand total or payable-after-TDS under either tax implementation; closing SGST/CGST must match either implementation. Otherwise high (amount) or medium (tax).
- **Between closures:** amount changed between two closures of the same job (medium). The first figures exist only in evidence because the application blanks them on reopening.
- **Data quality:** closing amount missing; no usable stored charges.
- **False positives:** charges billed outside the system; rounding conventions; a third tax treatment.
- **Tests:** `billing_inconsistency`, `closing_changed_on_reclose`; hard negative `legit_reopen`; unit test accepting both tax implementations.

### WFL-001 · workflow · medium — Closed with steps pending
- **Condition:** at closure, steps other than the closing step are `Pending` and are in `required_before_close`.
- **False positives:** steps that do not apply but were not marked N/A.
- **Tests:** `premature_closure`; unit test showing configuration removes the finding.

### WFL-002 · workflow · medium — Repeated reversals
- **Condition:** ≥ 3 changes from Completed to another status.
- **Tests:** `excess_reversals`; hard negative `legit_reopen` (one reversal).

### WFL-003 · workflow · low — Many steps marked N/A
- **Condition:** ≥ 40 % of steps are N/A.
- **Tests:** `bulk_na`; normal jobs mark 0–2 optional steps N/A.

### DEF-001 · placeholder_values · medium — Auto-inserted placeholder charges left unchanged
- **Condition:** at least two of the three hard-coded description/amount pairs are present.
- **False positives:** a real charge that happens to equal a placeholder exactly.
- **Tests:** `placeholder_charges`.

### IDN-001 · identifier — Identifier quality
- Container number fails ISO 6346 format or check digit → `data_quality`.
- Job closed with empty invoice or shipping-bill field → `data_quality`.
- Job number changed after creation → `anomaly`, medium.
- **Tests:** `bad_container_check_digit`, `missing_identifiers`, `job_renamed`.

### IDN-002 · identifier · low — Container on several active jobs
- Cross-job check. Legitimate for part loads and repeat voyages. Not covered by a synthetic scenario; unverified on realistic data.

### SRC-001 · source_consistency · low — Stored values differ from the uploaded source
- **Compared at creation:** gross weight, net weight, package count, invoice number, shipping-bill number, between the parsed checklist and the stored job.
- **Caveat:** extraction is regex-based and may be wrong. The finding says the two differ, not which is right.
- **Tests:** `source_mismatch`; hard negative `source_matches`.

### DEL-001 · deletion · medium — Deleted after closure or a milestone
- `anomaly` when the job was closed or a `lock_steps` step was completed; otherwise a `notice`.
- "Documents had been generated" is deliberately not a criterion: the synchroniser generates at creation, so it is true of every job.
- **Tests:** `deleted_after_close`; hard negative `deleted_draft`.

### ACT-001 · actor · medium / low — Request names a different actor
- **Default mode (sessions):** an event whose authenticated actor differs from the name in the request body (`claimed_display_name`). Medium. The bundled UI always sends the signed-in user's own name, so the request was built another way. The session identity is the recorded actor.
- **`SYNC_AUTH=off`:** a claimed name matching no account. Low. Does not identify the sender.
- Not detected: someone signed in with another person's password.
- **Tests:** `spoofed_actor`.

### PCK-001 · physical_feasibility · medium — Linked packing run left cargo unplaced
- **Evidence:** a `packing.run_completed` event linked to the job, with reason codes.
- **Caveat:** the packing algorithm is a heuristic; "unplaced" means it found no position. The link rests on a typed reference; ambiguous links halve the severity weight.
- Feasibility is **not** inferred from CBM and weight in job records: those lack dimensions.
- **Tests:** `unplaced_cargo`; hard negative `packing_fits`; ambiguity unit test.

### EVD-001 · evidence_gap — Evidence incomplete for this shipment
- `data_quality`. A `…_requested` event with no completion, or events with no origin.

### XAP-* · cross_application — Contradictions between applications
Produced by `src/provenance.js`, not by `rules.js`: `XAP-GROSS_WEIGHT`, `XAP-NET_WEIGHT`, `XAP-PACKAGES`, `XAP-INVOICE_NO`, `XAP-SHIPPING_BILL_NO`, `XAP-CONTAINER_NOS`, `XAP-TAXABLE_TOTAL`, `XAP-JOB_NO`, `XAP-TIMING` (anomalies) and `XAP-TAX`, `XAP-UNATTRIBUTED` (notes). Conditions, classification and configuration: PROVENANCE_AND_CONTRADICTIONS.md §6. All share one family, so several contradictions on one shipment count once in the score.

## Case priority score

`forensics/src/cases.js`, `score()`.

```
per family:  highest severity weight among its anomaly findings   (low 10, medium 25, high 40)
             halved if the finding rests only on an ambiguous cross-application link
base       = sum over families
bonus      = +10 for two families, +20 for three or more
score      = min(100, round((base + bonus) × 0.8 if the shipment has incomplete operations else × 1))
band       = high ≥ 60, medium ≥ 30, low ≥ 1, informational = 0
```

Several findings in one family count once, because they usually describe one underlying issue. The weights are design choices, not calibrated values. The score orders a review queue; it is not a probability and should not be reported as one.

## Known blind spots

- Falsification that is consistent from the first entry, with no source document (scenario `consistent_falsification`: not detected, by construction).
- Timing and volume patterns (scenario `unusual_timing`): no rule; see the ML baseline.
- Anything done in the desktop tools between exports.
- Collusion using genuine display names.
