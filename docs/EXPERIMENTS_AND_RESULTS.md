# Experiments and Results

Every number below was produced by the commands in §9 on 2026-10-13/14 and is stored in `forensics/evaluation/results/`. All data is synthetic. **Nothing here estimates performance on real shipments, real fraud prevalence, or savings.**

Results of the first evaluation (before sessions and cross-application analysis) are in git at tag `forensic-v1`.

## 1. Read this first

The rules, the contradiction analysis and the scenarios were written by the same person against the same understanding of the system. The simulator is not an independent test. Results on scenario types the framework was built for show that the **implementation matches its specification** across three random seeds. They do not measure ability to find anomalies shaped differently from the ones imagined.

The informative parts are the comparisons between variants on the same data, the hard negatives, the cases designed to be undetectable, and the costs.

## 2. Setup

| Item | Value |
|---|---|
| Unit of analysis | One job number (one entry of `labels.json`) |
| Positive class | `class = anomaly` |
| Negative class | `normal`, `hard_negative`, `data_quality` |
| Predicted positive | At least one finding of kind `anomaly` on any lifecycle of that job number |
| Test sets | `seed-1`, `seed-2`, `seed-3`, generated through the real synchroniser with authenticated sessions |
| Training set (ML only) | `train-101`: normal and hard-negative jobs only |
| Scenario types | 44 (2 normal, 11 hard negative, 28 anomaly, 3 data quality) |
| Evidence chains | All four verify; no capture failures |

| Dataset | jobs | normal | hard negative | data quality | anomaly | events |
|---|---|---|---|---|---|---|
| train-101 | 298 | 163 | 135 | 0 | 0 | 11,542 |
| seed-1 | 300 | 105 | 78 | 10 | 107 | 11,677 |
| seed-2 | 298 | 93 | 96 | 10 | 99 | 11,552 |
| seed-3 | 300 | 81 | 96 | 13 | 110 | 11,626 |

`train-101` and `seed-2` each have 298 jobs instead of 300: two scenario runs per dataset aborted with a network error (`fetch failed`) between the generator and the test server. The generator records these in `manifest.json` and writes no label for them; fragments of those jobs remain in the evidence and are not evaluated.

Anomalies are a third of jobs, far above any realistic rate. Precision depends on that share; recall and false-positive rate do not.

## 3. Variants

| | Variant | Code path |
|---|---|---|
| A | Existing rules | `analyze(records, { provenance: false })` |
| B | Rules + Isolation Forest | A's flag OR the model's flag |
| C | Rules + provenance tracking | `analyze(records, { contradictions: false })` |
| D | Full: rules + provenance + cross-application contradiction analysis | `analyze(records)` |

C produces no findings beyond A by construction: provenance explains and qualifies, it does not detect. It is therefore scored on reconstruction and on restraint (§6), not on detection.

## 4. Detection

### Job level

| Dataset | Variant | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---|---|---|---|---|---|---|---|---|
| seed-1 | A rules | 71 | 0 | 36 | 193 | 1.000 | 0.664 | 0.798 | 0.000 |
| seed-1 | D full | 98 | 0 | 9 | 193 | 1.000 | 0.916 | 0.956 | 0.000 |
| seed-2 | A rules | 62 | 0 | 37 | 199 | 1.000 | 0.626 | 0.770 | 0.000 |
| seed-2 | D full | 93 | 0 | 6 | 199 | 1.000 | 0.939 | 0.969 | 0.000 |
| seed-3 | A rules | 75 | 0 | 35 | 190 | 1.000 | 0.682 | 0.811 | 0.000 |
| seed-3 | D full | 100 | 0 | 10 | 190 | 1.000 | 0.909 | 0.952 | 0.000 |
| pooled | A rules | 208 | 0 | 108 | 582 | 1.000 | 0.658 | 0.794 | 0.000 |
| pooled | D full | 291 | 0 | 25 | 582 | 1.000 | 0.921 | 0.959 | 0.000 |
| train-101 | A and D | 0 | 0 | 0 | 298 | n/a | n/a | n/a | 0.000 |

- C equals A in every cell.
- Hard-negative false-positive rate: A 0 of 270, D 0 of 270 (pooled test seeds); 0 of 135 in training.
- Data-quality jobs raised as anomalies: 0 of 33.
- In D, the set of anomaly rules raised matched the label exactly for every job in all four datasets.

### By scenario type (seeds 1–3 pooled)

| Type | Jobs | A rules | D full |
|---|---|---|---|
| stale_documents | 19 | 19 | 19 |
| package_mismatch | 16 | 16 | 16 |
| late_material_edit | 15 | 15 | 15 |
| unplaced_cargo | 15 | 15 | 15 |
| excess_reversals | 14 | 14 | 14 |
| bulk_na, placeholder_charges | 13 each | all | all |
| job_renamed, source_mismatch | 12 each | all | all |
| deleted_after_close, premature_closure, regen_changed_excess, xapp_document_backed_conflict | 11 each | all | all |
| billing_inconsistency | 10 | 10 | 10 |
| closing_changed_on_reclose, weight_mismatch | 8 each | all | all |
| spoofed_actor | 5 | 5 | 5 |
| regen_identical_excess | 4 | 4 | 4 |
| **xapp_weight_conflict** | 17 | **0** | 17 |
| **xapp_post_issue_divergence** | 16 | **0** | 16 |
| **xapp_late_activity** | 14 | **0** | 14 |
| **xapp_charge_conflict** | 10 | **0** | 10 |
| **xapp_container_conflict** | 10 | **0** | 10 |
| **xapp_package_conflict** | 8 | **0** | 8 |
| **xapp_identifier_mismatch** | 8 | **0** | 8 |
| common_source_falsification | 12 | 0 | **0** |
| consistent_falsification | 7 | 0 | **0** |
| unusual_timing | 6 | 0 | **0** |
| all 11 hard-negative types | 270 | 0 | 0 |
| all 3 data-quality types | 33 | 0 | 0 |
| clean_complete, clean_in_progress | 279 | 0 | 0 |

**Where the gain comes from.** The 83 additional detections of D are exactly the seven scenario types whose evidence lies in another application. A cannot see them because it reads only the synchroniser's record. This is an increase in **coverage** (new evidence sources reach the analysis), not a better detector on the same evidence. `xapp_document_backed_conflict` is caught by both, since the uploaded document already contradicts the job (SRC-001); D adds the corroborating second record and a higher classification.

`xapp_post_issue_divergence` is the one case where D changes the reading of something A looked at and passed: inside the synchroniser it is an early correction with successful regeneration (a hard negative for the rules); only the documents already issued from B.I.I.L. show the pre-edit figures.

**What stays undetected: 25 of 316.** Timing anomalies (no rule), and both kinds of consistent falsification. For the latter nothing internal contradicts anything; see §6.

## 5. Isolation Forest (variant B and D + ML)

21 behavioural features per job, no identifiers, labels or rule outputs; 200 trees; five model seeds; mean ± standard deviation over model seeds.

### Fit on normal-only data (`train-101`), threshold at the 95th percentile of training scores

| Test | ML only P / R / FPR | B: A OR ML — P / R / FPR | D OR ML — P / R / FPR |
|---|---|---|---|
| seed-1 | 0.149 ± 0.051 / 0.032 ± 0.010 / 0.103 ± 0.014 | 0.783 / 0.664 / 0.103 | 0.832 / 0.916 / 0.103 |
| seed-2 | 0.236 ± 0.037 / 0.059 ± 0.010 / 0.094 ± 0.007 | 0.768 / 0.626 / 0.094 | 0.832 / 0.939 / 0.094 |
| seed-3 | 0.161 ± 0.031 / 0.040 ± 0.009 / 0.120 ± 0.002 | 0.767 / 0.682 / 0.120 | 0.814 / 0.909 / 0.120 |

Under this protocol the model adds **no recall at all** to A or to D, and 9–12 % false positives. As in the first evaluation, five features are constant in normal-only training (`n_generation_failures`, `frac_steps_pending_at_close`, `frac_events_off_hours`, `deleted`, `weight_rel_diff`), and an isolation tree cannot split on a feature with no range.

### Fit unsupervised on mixed, unlabelled data (`seed-1`), flag the 10 % most isolated; test on seeds 2 and 3

| Test | ML only P / R / FPR | B: A OR ML — P / R / FPR | D OR ML — P / R / FPR |
|---|---|---|---|
| seed-2 | 0.592 ± 0.009 / 0.170 ± 0.008 / 0.058 ± 0.004 | 0.849 / 0.659 / 0.058 | 0.892 / 0.966 / 0.058 |
| seed-3 | 0.588 ± 0.014 / 0.145 ± 0.013 / 0.059 ± 0.004 | 0.873 / 0.700 / 0.059 | 0.901 / 0.925 / 0.059 |

Types the model flags in at least a fifth of cases (pooled): regen_changed_excess 1.00, stale_documents 0.89, unusual_timing 0.88, excess_reversals 0.65, premature_closure 0.60, regen_identical_excess 0.45; and among negatives **deleted_draft 1.00**, clean_in_progress 0.22. It flags none of the cross-application conflicts: their behaviour inside the synchroniser is ordinary.

Reading:
- B never approaches D. Adding the forest to the rules raises recall by 2–3 points (timing cases) and costs 6 % false positives; adding cross-application evidence raises it by 26 points at no false-positive cost on this data.
- On top of D, the forest adds 2–3 points of recall (the timing cases) for the same 6 % false-positive rate: about 11 false alarms per 190–200 normal jobs to find about 2–3 extra anomalies per seed.
- The model and the contradiction analysis find different things. They are not substitutes.

## 6. What provenance and reconstruction add (variants C and D)

### Linkage of external records to jobs

| Dataset | Should link, linked to the right job | Should stay unlinked | Should stay ambiguous | Attributed to a wrong job |
|---|---|---|---|---|
| train-101 | 76 / 76 | — | — | 0 |
| seed-1 | 81 / 81 | 5 / 5 | 8 / 8 | 0 |
| seed-2 | 105 / 105 | 4 / 4 | 2 / 2 | 0 |
| seed-3 | 84 / 84 | 7 / 7 | 8 / 8 | 0 |

Links here are the easy cases: exact job number, exact container number, one designed ambiguity, one designed absence. No misspelt or partial references were generated, so this shows the mechanism works and that it does not force links, not how it performs on messy references.

### Identification of the conflicting records

| Dataset | Labelled conflicting fields found | Contradictions raised on non-anomalous jobs |
|---|---|---|
| seed-1 | 41 / 41 | 0 |
| seed-2 | 45 / 45 | 0 |
| seed-3 | 35 / 35 | 0 |

Every contradiction carries two evidence items that resolve to events in the chain, an independence label and the link used (308 of 308).

### Incident ordering

Fraction of adjacent timeline entries in true chronological order, for jobs that have records from another application:

| Dataset | Jobs | Ordered by arrival in the store (A) | Ordered by event time (C, D) |
|---|---|---|---|
| train-101 | 37 | 0.961 | 1.000 |
| seed-1 | 76 | 0.973 | 1.000 |
| seed-2 | 77 | 0.971 | 1.000 |
| seed-3 | 76 | 0.974 | 1.000 |

Desktop-tool records reach the store when ingested, which can be long after they were made. Ordering by arrival puts them at the end of the timeline. **The 1.000 is by construction**: in synthetic data the event time is exact and is the ground truth being compared with. With real, unsynchronised clocks, order between a desktop record and a synchroniser event a few minutes apart is not knowable; the timeline marks such neighbours `order_uncertain` rather than asserting an order. That behaviour is unit-tested, not measured here.

### Provenance completeness

| Dataset | Recorded values | With a lineage root | With a captured source (parent) | Lineage unknown (typed, no source captured) |
|---|---|---|---|---|
| seed-1 | 3,157 | 100 % | 22.2 % | 77.8 % |
| seed-2 | 3,129 | 100 % | 24.1 % | 75.9 % |
| seed-3 | 3,183 | 100 % | 23.6 % | 76.4 % |

About three quarters of all values have no captured origin: they were typed into the synchroniser and nothing records from where. This is a property of the applications, shown rather than hidden. Every value still has a root, so that copies can be told from separate statements.

Findings citing only events that exist in the chain: 100 % in all datasets. Findings carrying a support/weakening assessment: 100 %.

### Restraint (unsupported or overconfident conclusions)

| Check | seed-1 | seed-2 | seed-3 |
|---|---|---|---|
| Undetectable anomalies flagged anyway | 0 / 9 | 0 / 6 | 0 / 10 |
| Fields resting on one lineage that were presented as corroborated | 0 / 2,172 | 0 / 2,033 | 0 / 2,156 |
| Ambiguous or low-confidence links used to support an anomaly | 0 | 0 | 0 |
| Notes for unattributable records (`insufficient_evidence`) | 16 | 4 | 16 |
| Notes for the unresolved tax rule | 43 | 55 | 53 |

Common-source falsification (12 jobs): in every one, three records agree on the false weight (job, value extracted from the checklist, B.I.I.L.), `independent_roots` is 1, and the case states that the records are copies of one source and that an independent authority is required. A reader of variant A sees no finding and no caveat; a naive count of agreeing documents would read "three sources agree".

The second row is a self-consistency check on the implementation, not an independent measurement.

### Review burden

| | seed-1 | seed-2 | seed-3 |
|---|---|---|---|
| Cases with an anomaly finding, A → D | 71 → 98 | 62 → 93 | 75 → 100 |
| Anomaly findings, A → D | 73 → 114 | 64 → 109 | 79 → 114 |
| Unscored notes, A → D | 18 → 77 | 17 → 76 | 28 → 97 |

On this data every added case is a true positive. The cost is in notes: D produces four times as many. Most are the same note repeated: **every job with a B.I.I.L. record gets an "unresolved tax rule" note**, because the two programs really do tax ocean freight differently. Until the business states the rule, that note carries no information per job and should be reported once, or switched off (`enabled_comparisons`).

## 7. Does each feature improve detection, attribution, reconstruction or presentation?

| Feature | Detection | Attribution | Reconstruction | Presentation |
|---|---|---|---|---|
| Authenticated sessions | Enables ACT-001 on real identity | **Yes**: actor is the session, not a claim | Timeline shows verified actors | — |
| External anchor | — | — | — (integrity of the record) | — |
| Ingestion of other applications' evidence | Precondition for all XAP rules | — | Adds their events to the timeline | — |
| Entity linking with confidence | Gates what may be compared | **Yes** | — | — |
| Lineage roots and corroboration | **None** (C = A) | — | **Yes**: copies told from separate statements | Yes |
| Contradiction analysis | **Yes**: +26 points recall on these data | Names both records and both actors | **Yes** | — |
| Event-time ordering | — | — | **Yes** when records arrive late | — |
| Support/weakening assessment | — | — | — | **Yes** (and restraint) |
| Isolation Forest | Small: +2–3 points, timing only | — | — | — |

## 8. Limitations

- **Circularity** (§1). Perfect precision and exact rule-set matches are evidence of a consistent implementation, not of real-world accuracy.
- **Injected conflicts are clean.** Each cross-application record agrees with the job in everything except one injected field. Real tools differ in rounding, units, abbreviations and timing; each difference is a potential false contradiction. The zero false-positive rate should not be expected to hold.
- **Cross-application records are synthetic records in the real schemas**, not output of the operated tools (the schemas were checked against real runs). EasyQuote evidence is captured but nothing analyses it.
- **Linking was tested on easy references only.**
- **Ordering accuracy is by construction** on synthetic clocks.
- **Thresholds and tolerances** sit between hard-negative and anomaly magnitudes because the same person chose both.
- **Prevalence** is unrealistic; small counts per type (4 to 19 across three seeds).
- **One job type** (sea export).
- **Undetectable by design.** 19 jobs with values falsified consistently from the first entry were detected by nothing. This is a limit of any analysis of internal evidence: detection needs an independent authoritative source, which this system does not have.
- **Four jobs across two datasets were lost** to generator network errors and are excluded.
- **No human evaluation.** Whether contradictions, lineage and assessments help an investigator reach a correct conclusion faster was not measured.
- **Evidence integrity is a tested property**, not a measured rate.

## 9. Reproducing

```
cd forensics
setup_env.cmd                                        (once)
node synthetic/generate.js --seed 101 --jobs 300 --out datasets/train-101 --normal-only
node synthetic/generate.js --seed 1 --jobs 300 --out datasets/seed-1
node synthetic/generate.js --seed 2 --jobs 300 --out datasets/seed-2
node synthetic/generate.js --seed 3 --jobs 300 --out datasets/seed-3

node evaluation/evaluate.js datasets/train-101 datasets/seed-1 datasets/seed-2 datasets/seed-3
.venv\Scripts\python evaluation/ml_baseline.py --train datasets/train-101 --test datasets/seed-1 datasets/seed-2 datasets/seed-3 --quantile 0.05 --name ml_normal_only
.venv\Scripts\python evaluation/ml_baseline.py --train datasets/seed-1 --test datasets/seed-2 datasets/seed-3 --unsupervised --quantile 0.10 --name ml_unsupervised_q0.10
```

Job content and scenario assignment are fixed by the seed. Event ids are random, so hashes differ between runs. A run in which a scenario aborts (network error) will have fewer jobs than requested; `manifest.json` lists them. About ten minutes per dataset on the development machine. ML figures depend on the scikit-learn version (1.8.0 here).

Result files: `evaluation/results/framework.json`, `ml_normal_only.json`, `ml_unsupervised_q0.10.json`.
