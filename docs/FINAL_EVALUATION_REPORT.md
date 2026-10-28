# Final Evaluation Report

**All data is synthetic. Nothing here estimates performance on real shipments, real fraud, or real users.**

## 0. Current round (2026-10-29, code `3d2a5e3`)

Full tables: `forensics/evaluation/results/final_summary.md` (and `.json`, shown in the dashboard's Evaluation view). Sections 1–11 below describe the previous round (code `ce611ac`); its result files were moved unchanged to `evaluation/results/historical-final-ce611ac/`.

### What changed and why

- **Fresh untouched test set.** Seeds 4–6 were the held-out sets of the previous round, and their misses and false alarms were read in detail. No rule or threshold was changed after that, but they are no longer untouched. Seeds 7, 8 and 9 (300 jobs each) were generated at `7ebf118` and scored once. They are now the primary test set. Seeds 4–6 are re-scored and reported separately.
- **Unseen scenario families.** `synthetic/unseen_scenarios.js` holds 10 families written after the rules and thresholds were fixed. It was committed (`7ebf118`) before any dataset was generated from it, and it is not in the tuning mix. The set has 5 anomaly families and 5 realistic negative controls. Anomalies: net-weight conflict; a charge dropped from the invoice; weight cut after closure; two tools agreeing against the job; a stuffing report after closure. Negative controls: net weight in tonnes; a batch exported twice; stuffing-report rounding; a linked quotation; a quotation without a reference. Clean jobs are included as the normal base rate. Labels give only the class, not the expected rules.
- **Uncertainty and per-rule figures.** Pooled metrics carry 95% Wilson intervals over jobs, and each rule's firings on anomalies and negatives are counted.
- **Code changes behind this round:** shipment-reference linkage (validation, conflict detection, manual assertions) and the dashboard redesign. Re-scoring seeds 4–6 at `3d2a5e3` reproduced the `ce611ac` figures exactly, so the linkage change did not alter detection on that data.

### Protocol

| Set | Datasets (seed, jobs) | Generated at | Role |
|---|---|---|---|
| Tuning | tune-11 (300) | `ce611ac` | thresholds were set here in the previous round; unchanged |
| Normal-only fit | train-201 (300) | `ce611ac` | Isolation Forest fit (normal-only protocol); fit-set FPR |
| **Test (primary)** | seed-7, seed-8, seed-9 (300 each) | `7ebf118` | scored once at `7ebf118` and again at `3d2a5e3` (identical) |
| Previous held-out | seed-4, seed-5, seed-6 (300 each) | `ce611ac` | re-scored; no longer untouched |
| Unseen families | unseen-301 (150) | `7ebf118` | scored once |

The unit is one labelled job. A job is predicted positive if it has at least one finding of kind `anomaly`. Labels are never read by the analysis, and `ml_baseline.py` drops every `LABEL_*` column. Variants: A is rules only; C adds provenance tracking; X adds contradiction analysis without lineage; D is the full framework. B is Isolation Forest, alone or OR-combined with A or D. Terms: a *finding* is a rule result; an *anomaly* is a finding of kind anomaly; a *contradiction* is two linked records disagreeing about one field. None of these is a determination of fraud.

### Results (synthetic)

Test seeds 7–9 (900 jobs, 328 anomalous), pooled:

| Variant | TP | FP | FN | TN | Precision | Recall | FPR |
|---|---|---|---|---|---|---|---|
| A rules only | 221 | 7 | 107 | 565 | 0.969 [0.938, 0.985] | 0.674 [0.621, 0.722] | 0.012 [0.006, 0.025] |
| C + provenance | 221 | 7 | 107 | 565 | same as A | | |
| X + contradictions, no lineage | 301 | 7 | 27 | 565 | 0.977 [0.954, 0.989] | 0.918 [0.883, 0.943] | 0.012 [0.006, 0.025] |
| **D full framework** | 301 | 7 | 27 | 565 | **0.977 [0.954, 0.989]** | **0.918 [0.883, 0.943]** | **0.012 [0.006, 0.025]** |
| B Isolation Forest only (normal-only fit) | | | | | 0.348 ± 0.049 | 0.084 ± 0.020 | 0.088 ± 0.007 |
| D + Isolation Forest (normal-only fit) | | | | | 0.841 ± 0.010 | 0.918 ± 0.001 | 0.100 ± 0.007 |

Per seed, D: P 0.989 / 0.951 / 0.991, R 0.869 / 0.951 / 0.933. Previous held-out seeds 4–6, re-scored: D P 0.977 [0.953, 0.989], R 0.937 [0.904, 0.959], FPR 0.012; A R 0.649.

Unseen families (unseen-301; 58 anomalous, 92 negative): D flagged 58/58 anomalies and 0/92 negatives (recall interval [0.938, 1.000], FPR interval [0, 0.040]). Rules alone flagged 14/58: only "weight cut after closure" (GEN-002); the four cross-application families were found only by contradiction analysis. No negative control was flagged: net weight in tonnes, re-exported batch, stuffing rounding, linked quotation, unlinked quotation.

Errors on the test seeds (D):
- **All 7 false alarms** are `legit_backfill` (TIM-001). This is the documented known false positive: back-entered jobs cannot be told apart from fabricated pace by timing alone. TIM-001 is the only rule with false alarms (11 on anomalies, 7 on negatives, precision 0.611); every other rule fired only on anomalies.
- **All 27 misses** are `consistent_falsification` (18) and `common_source_falsification` (9). These are falsifications that are internally consistent or copied from one false source. They are undetectable without an independent source of truth, by design.

### What this shows, and what it does not

- **Shown, on synthetic data:** on fresh seeds and on variations the rules were not written against, cross-application contradiction analysis raises recall from about 0.67 to about 0.92 (seeds 7–9) with no added false positives. The added recall comes from contradiction analysis (A to X). Provenance tracking and lineage (A to C, X to D) do not change which jobs are flagged. They change what the investigator is told: single source versus independent agreement, and what evidence is missing.
- **Isolation Forest** on the same behavioural features adds false positives without adding recall to D. It is kept only as a comparison, not as a detector.
- **Not shown:** effectiveness on real shipments, real fraud or real users. Rules, scenarios, labels and the unseen families share one author. The unseen families vary mechanisms the framework already compares (fields across tools, edits after closure), so they test generalisation within those mechanisms, not to new kinds of fraud. No independent reviewer or independently written scenarios were available. The priority score is not calibrated.
- **Needed before any real-world claim:** a labelled sample of real or audited shipments with confirmed outcomes, scenarios written by someone other than the rule author, a two-machine witness test, measured reviewer time and agreement on real cases, and the owner's business-rule decisions (Q1–Q4).

### Reproducing this round

```
cd forensics
node synthetic/generate.js --seed 7 --jobs 300 --out datasets/seed-7          (also 8, 9)
node synthetic/generate.js --set unseen --seed 301 --jobs 150 --out datasets/unseen-301
set FORENSIC_ANCHOR_URL=
node evaluation/evaluate.js datasets/train-201 datasets/seed-7 datasets/seed-8 datasets/seed-9
node evaluation/evaluate.js datasets/seed-4 datasets/seed-5 datasets/seed-6 --out results/dev_heldout.json
node evaluation/evaluate.js datasets/unseen-301 --out results/unseen.json
.venv\Scripts\python evaluation/ml_baseline.py --train datasets/train-201 --test datasets/seed-7 datasets/seed-8 datasets/seed-9 --quantile 0.05 --name ml_normal_only
.venv\Scripts\python evaluation/ml_baseline.py --train datasets/tune-11 --test datasets/seed-7 datasets/seed-8 datasets/seed-9 --unsupervised --quantile 0.10 --name ml_unsupervised_q0.10
node evaluation/summarize.js
```
train-201, tune-11 and seeds 4–6 come from the commands in §11. The datasets for this round were generated in a clean worktree at `7ebf118`, so each `manifest.json` records that commit without uncommitted changes. Generating them took about 20 minutes, four in parallel.

---

## Previous round (2026-10-27, code `ce611ac`)

Produced 2026-10-27 at code commit `ce611ac`; all datasets were generated at the same commit. Its result files are now in `evaluation/results/historical-final-ce611ac/`; paths below that name `results/` refer to that folder.

Historical results are kept unchanged and are **not** used below:
`evaluation/results/historical-forensic-v2/` (tag `forensic-v2`) and `evaluation/results/historical-research-validation/` (commit `251e9e7`, with the report as it stood).

## 1. What is evaluated

The research contribution is **provenance-aware cross-application contradiction analysis and incident reconstruction**: evidence from several logistics applications is linked to one shipment, every value is traced to its source, and disagreements between applications are reported with what they do and do not prove. No claim of novelty is made (no literature review was done for this report).

| Variant | Code path | Adds |
|---|---|---|
| A | `analyze(records, { provenance: false })` | rules only (18 rules) |
| C | `analyze(records, { contradictions: false })` | A + provenance tracking (lineage, corroboration, linking); contradictions hidden |
| X | `analyze(records, { provenance_config: { lineage: false } })` | A + contradiction analysis, lineage off (every value its own source) |
| D | `analyze(records)` | full framework |
| B | `evaluation/ml_baseline.py` | Isolation Forest alone, and OR-combined with A and D |

## 2. Changes since the previous evaluation (`251e9e7`) and why

Each change addresses a cause found in the previous held-out results; none was tuned on the new held-out seeds.

| Change | Cause it addresses |
|---|---|
| Rule ACT-002: refused privileged request on a job (refused requests are now attached to the job that held the id) | 5/5 refused deletion attempts were missed: the refusal was recorded but no rule read it |
| Rule TIM-001: "Cargo Movement" → "Sailing Completed" recorded in under 120 minutes | 6/6 `unusual_timing` jobs were missed. The threshold is a labelled domain assumption (stuffing, gate pass, let-export and departure lie between these milestones), not a business rule; off-hours time is deliberately not used |
| New hard negatives `legit_night_shift`, `legit_backfill`, `xapp_rounding_difference`, `xapp_unit_variant` | the earlier zero false-positive rate rested on clean injections; these test night work, back-entry, rounding below tolerance and kg/MT notation |
| `legit_night_shift` in the normal-only ML fit set | `frac_events_off_hours` was constant in that fit set, so Isolation Forest could not use it |
| Synchroniser `keepAliveTimeout` 65 s | every job previously lost to `fetch failed` was an `ECONNRESET` on a reused idle socket (reproduced 24/24 under load, 0 after); all 1,500 jobs now generate |
| Separate tuning set `tune-11`; unsupervised ML fit on `tune-11` instead of a test seed | the previous unsupervised protocol fitted on seed-1 and tested on seeds 2–3 |

## 3. Protocol and data

1. Rules frozen after inspecting **only** `tune-11`: it showed misses only for the by-design falsification cases and false alarms only for `legit_backfill` (TIM-001), which no timing threshold can separate from fabricated pace. No further change was made.
2. Held-out seeds 4, 5, 6 evaluated once, with the new code and with the previous code (`8add33d`, run from a git worktree) on the same evidence.

| Dataset | Seed | Use | Jobs | Normal | Hard negative | Data quality | Anomaly | Events | Chain | Errors |
|---|---|---|---|---|---|---|---|---|---|---|
| tune-11 | 11 | tuning only; unsupervised ML fit | 300 | 81 | 105 | 8 | 106 | 11,535 | verifies | 0 |
| train-201 | 201 | normal-only ML fit | 300 | 154 | 146 | 0 | 0 | 11,607 | verifies | 0 |
| seed-4 | 4 | held-out test | 300 | 68 | 106 | 14 | 112 | 11,797 | verifies | 0 |
| seed-5 | 5 | held-out test | 300 | 92 | 98 | 15 | 95 | 11,643 | verifies | 0 |
| seed-6 | 6 | held-out test | 300 | 86 | 98 | 7 | 109 | 11,674 | verifies | 0 |

49 scenario types (2 normal, 15 hard negative, 29 anomaly, 3 data quality), generated by driving the real synchroniser over HTTP with signed-in sessions and writing B.I.I.L., stuffing-report and 3D-visualizer records in their real schemas to an outbox that is then ingested. Labels are written beside the evidence and never read by the analysis; `ml_baseline.py` drops every `LABEL_*` column and the rule flags before fitting; thresholds are fixed in advance (normal-only: 95th percentile of training scores; unsupervised: top 10 %).

## 4. Metrics

Unit: one labelled job. Predicted positive: at least one finding of kind `anomaly` on any lifecycle of that job number. Positives: `class = anomaly`; negatives: normal, hard negative, data quality. Pooled = confusion counts summed over seeds 4–6, then the metric. Isolation Forest: 5 model seeds, mean ± sd. Definitions of the investigation measures are in `evaluation/evaluate.js` and §4 of the historical report; they are unchanged.

## 5. Detection on held-out seeds 4–6 (900 jobs, 316 anomalous)

| Variant | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---|---|---|---|---|---|---|---|
| A rules | 205 | 7 | 111 | 577 | 0.967 | 0.649 | 0.777 | 0.012 |
| C rules + provenance | 205 | 7 | 111 | 577 | 0.967 | 0.649 | 0.777 | 0.012 |
| X rules + contradictions, no lineage | 296 | 7 | 20 | 577 | 0.977 | 0.937 | 0.956 | 0.012 |
| **D full framework** | **296** | **7** | **20** | **577** | **0.977** | **0.937** | **0.956** | **0.012** |
| B Isolation Forest, normal-only fit (train-201) | | | | | 0.401 ± 0.040 | 0.106 ± 0.017 | 0.168 ± 0.025 | 0.085 ± 0.005 |
| A + B (normal-only) | | | | | 0.790 ± 0.009 | 0.675 ± 0.006 | 0.728 ± 0.006 | 0.097 ± 0.005 |
| D + B (normal-only) | | | | | 0.839 ± 0.007 | 0.937 ± 0.000 | 0.885 ± 0.004 | 0.097 ± 0.005 |
| B Isolation Forest, unsupervised fit (tune-11) | | | | | 0.713 ± 0.011 | 0.209 ± 0.013 | 0.323 ± 0.016 | 0.046 ± 0.002 |
| A + B (unsupervised) | | | | | 0.862 ± 0.004 | 0.663 ± 0.007 | 0.750 ± 0.004 | 0.058 ± 0.002 |
| D + B (unsupervised) | | | | | 0.898 ± 0.004 | 0.937 ± 0.000 | 0.917 ± 0.002 | 0.058 ± 0.002 |

Per seed, D: recall 0.920 / 0.947 / 0.945, precision 0.954 / 1.000 / 0.981, FPR 0.027 / 0.000 / 0.010. Fit set train-201: no anomaly finding.

### Against the previous code on the same held-out evidence

| | Previous `8add33d` | Current `ce611ac` | Change |
|---|---|---|---|
| A rules: precision / recall / F1 / FPR | 1.000 / 0.598 / 0.749 / 0.000 | 0.967 / 0.649 / 0.777 / 0.012 | +16 TP, +7 FP |
| D full: precision / recall / F1 / FPR | 1.000 / 0.886 / 0.940 / 0.000 | 0.977 / 0.937 / 0.956 / 0.012 | +16 TP (8 refused deletions, 8 timing), +7 FP (all `legit_backfill`) |

(`evaluation/results/baseline_8add33d_on_seed4-6.json`.) The detection gain costs a false-positive rate of 1.2 %: TIM-001 cannot tell a fabricated fast workflow from a shipment entered after the fact, and all 7 `legit_backfill` jobs are flagged. TIM-001's finding text names back-entry as a legitimate explanation; it is left in because a reviewer can resolve it from the job's paperwork, and removing it would hide 8 true anomalies. This is a judgement, recorded here.

### By category (pooled, D)

Every rule-covered category, now including `access_control` (8) and `timing` (8): recall 1.000. `cross_application` (104): 0.125 for A and C, 1.000 for X and D. `needs_independent_source` (20): 0.000 in every variant, by design (§7). Negatives: normal 0/246 flagged; hard negative 7/302 (all `legit_backfill`); data quality 0/36. The new controls `legit_night_shift` (19), `xapp_rounding_difference` (21), `xapp_unit_variant` (9) were never flagged.

**Missed (D, 20):** `consistent_falsification` 11, `common_source_falsification` 9. A and C additionally miss 91 cross-application jobs.

## 6. Ablation: detection vs. attribution

| Measure (pooled) | C provenance only | X contradictions, no lineage | D full |
|---|---|---|---|
| Detection recall | 0.649 | 0.937 | 0.937 |
| Conflicting field identified | 0/141 | 141/141 | 141/141 |
| Contradictions on non-anomalous jobs | 0 | 0 | 0 |
| Lineage expectations met | 26/50 | 24/50 | **50/50** |
| Agreement among copies counted as independent | 1,077/1,466 (73 %) | **1,466/1,466 (100 %)** | 1,077/1,466 (73 %) |
| External records linked to the right job / unattributable left unlinked / ambiguous marked | 289/289, 8/8, 11/11 | same | same |
| Wrong attributions; weak links used as anomaly evidence | 0; 0 | 0; 0 | 0; 0 |
| Findings citing existing events | 270/270 | 600/600 | 600/600 |
| Timeline order correct, jobs with external records | 1.000 | 1.000 | 1.000 (arrival order: 0.972 / 0.972 / 0.973) |

Contradiction analysis provides the detection gain (+0.288 recall over A). Lineage changes no detection figure, but without it every agreement between copies is presented as independent corroboration, falsification cases lose their single-source statement, and the document-backed conflict loses its stronger classification. Ordering by event time is correct by construction on simulated clocks.

## 7. A false initial value repeated everywhere

`consistent_falsification` and `common_source_falsification` (20 jobs) are flagged by no variant, which is the correct outcome: internal consistency cannot show that the original value was false. D reports for these jobs a single independent root and `needs_independent_source = true`; X reports the copies as independent sources. That is a statement of missing independent verification, not a detection.

## 8. Isolation Forest

With night-shift work in the normal-only fit set the off-hours feature is no longer constant, and the model now flags 73–90 % of `unusual_timing` jobs (previously none); normal-only recall rose from 0.040 to 0.106. It also flags `deleted_draft` (a hard negative) on every seed, `legit_reopen` 27–54 %, and types the rules already catch. Combined with D it adds no recall (0.937 either way) and raises the false-positive rate to 5.8–9.7 %. Remaining constant features in the normal-only fit set: `n_generation_failures`, `frac_steps_pending_at_close`, `deleted`, `weight_rel_diff` (absent from normal behaviour by definition); kept, since removing them changes nothing for a tree model and they describe the data honestly.

## 9. Threats to validity

- **Circularity.** Rules, scenarios, tolerances and labels have one author; the new rules were written after seeing which types were missed. The held-out seeds prevent tuning to particular jobs, not to the scenario templates. Results show the implementation meets its specification.
- **Template reuse.** All seeds sample the same 49 templates; tuning, training and test jobs differ in content, not in kind.
- **Injected differences are still simple.** Rounding and unit variants are now tested; abbreviations, partial shipments, multi-document disagreements and real-tool quirks are not.
- **Prevalence** (≈ 35 % anomalous), small counts per type (4–31), one job type, one machine, simulated clocks.
- **Unresolved business rules** (all `null`): FIN-001 accepts any closing basis and either tax scheme; tax differences are notes, not detections.
- **Quotations not analysed:** EasyQuote records carried no shipment reference in this round; they were ingested, verified and listed as "not tied to a shipment". (Since `7ebf118` an optional reference is captured and linked; rates are still not compared with job charges.)
- **No human evaluation and no real data.**

## 10. Verified behaviour vs. this evaluation

| Claim | Status |
|---|---|
| Evidence chain detects edits, deletions, reordering, truncation | tested |
| Remote witness detects full local rewrites | tested on one machine; **two-machine test NOT RUN** (EXTERNAL_ANCHOR.md) |
| Authentication, admin-only deletion, refused-request capture, TLS option | tested |
| One synthetic shipment set through the real pipeline, shown in the dashboard; controls clean | tested (`test/demo.integration.test.js`, browser test) |
| Figures in §5–§8 | synthetic data only |
| Real-world fraud detection performance | not evaluated |

## 11. Reproducing

```
cd forensics
setup_env.cmd                                                     (once)
.venv\Scripts\python -m pip install -r requirements.lock.txt      (exact versions used here)
node synthetic/generate.js --seed 11  --jobs 300 --out datasets/tune-11
node synthetic/generate.js --seed 201 --jobs 300 --out datasets/train-201 --normal-only
node synthetic/generate.js --seed 4   --jobs 300 --out datasets/seed-4
node synthetic/generate.js --seed 5   --jobs 300 --out datasets/seed-5
node synthetic/generate.js --seed 6   --jobs 300 --out datasets/seed-6
set FORENSIC_ANCHOR_URL=
node evaluation/evaluate.js datasets/tune-11 --out results/tuning/tune-11.json
node evaluation/evaluate.js datasets/train-201 datasets/seed-4 datasets/seed-5 datasets/seed-6
.venv\Scripts\python evaluation/ml_baseline.py --train datasets/train-201 --test datasets/seed-4 datasets/seed-5 datasets/seed-6 --quantile 0.05 --name ml_normal_only
.venv\Scripts\python evaluation/ml_baseline.py --train datasets/tune-11 --test datasets/seed-4 datasets/seed-5 datasets/seed-6 --unsupervised --quantile 0.10 --name ml_unsupervised_q0.10
node evaluation/summarize.js
```

Previous-code comparison: `git worktree add <dir> 8add33d`, then in `<dir>/forensics` run `node evaluation/evaluate.js <copies of seed-4..6> --out results/baseline_8add33d.json`.
About 10–15 minutes per dataset (three in parallel here). Job content and scenario assignment are fixed by the seed; event ids are random. Environment: Node v24.11.1; Python 3.13.9, scikit-learn 1.8.0, numpy 2.4.2 (all Python versions in `forensics/requirements.lock.txt`; `requirements.txt` only sets minimums, and other scikit-learn or numpy versions may change the Isolation Forest figures). The two `evaluate.js … summarize.js` steps for the held-out sets are also `npm run evaluate`; it does not re-run `ml_baseline.py`, so `summarize.js` reuses whatever `results/ml_*.json` are present.

Check on 2026-10-28 at `bc86d5c`: `evaluate.js` on the existing `train-201` and `seed-4..6` gave dataset results identical to `results/framework.json`; a small same-seed regeneration gave identical figures (`test/reproducibility.test.js`). On 2026-10-29 at `532ac65` both `ml_baseline.py` commands above rewrote `results/ml_*.json` byte-identically. The 300-job datasets have not been regenerated since `ce611ac`.
