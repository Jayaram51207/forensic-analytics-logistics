# Experiments and Results

Every number below was produced by the commands in §7 on 2026-10-13 and is stored in `forensics/evaluation/results/`. All data is synthetic. **Nothing here estimates performance on real shipments, real fraud prevalence, or savings.**

## 1. Read this first

The rules and the scenarios were written by the same person against the same understanding of the system. The rule results therefore show that the rules **do what they were designed to do** on clean, single-cause injections, across three independent random seeds. They are a correctness check, not an independent measure of detection ability. The more informative results are the ones that are not perfect: the hard-negative behaviour, the two undetectable scenario types, the priority-band threshold, and the ML baseline.

## 2. Setup

| Item | Value |
|---|---|
| Unit of analysis | One job lifecycle (one `correlation_id`) |
| Positive class | `class = anomaly` in `labels.json` |
| Negative class | `normal`, `hard_negative`, `data_quality` |
| Rule prediction | Job has at least one finding of kind `anomaly` |
| Test sets | `seed-1`, `seed-2`, `seed-3`: 300 jobs each, generated through the real synchroniser |
| Training set | `train-101`: 300 normal and hard-negative jobs, no anomalies |
| Events per dataset | 11,160 to 11,587; every chain verified (`integrity_ok: true`) |
| Capture failures during generation | 0 in all four datasets |

Class counts:

| Dataset | normal | hard negative | data quality | anomaly | anomaly share |
|---|---|---|---|---|---|
| train-101 | 184 | 116 | 0 | 0 | 0 % |
| seed-1 | 124 | 83 | 14 | 79 | 26 % |
| seed-2 | 121 | 81 | 10 | 88 | 29 % |
| seed-3 | 106 | 86 | 11 | 97 | 32 % |

The anomaly share is set by the scenario weights and is far higher than any realistic rate. Precision depends on it; recall and false-positive rate do not.

## 3. Rule-based detection

### Job level, any anomaly finding

| Dataset | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---|---|---|---|---|---|---|---|
| train-101 | 0 | 0 | 0 | 300 | n/a | n/a | n/a | 0.000 |
| seed-1 | 69 | 0 | 10 | 221 | 1.000 | 0.873 | 0.932 | 0.000 |
| seed-2 | 78 | 0 | 10 | 212 | 1.000 | 0.886 | 0.940 | 0.000 |
| seed-3 | 86 | 0 | 11 | 203 | 1.000 | 0.887 | 0.940 | 0.000 |
| seeds 1–3 pooled | 233 | 0 | 31 | 636 | 1.000 | 0.883 | 0.938 | 0.000 |

- Hard-negative false-positive rate: 0 of 250 (pooled test seeds), 0 of 116 in the training set.
- Data-quality jobs raised as anomalies: 0 of 35.
- All 31 false negatives belong to the two scenario types that no rule is meant to detect.

### By scenario type (seeds 1–3 pooled)

| Type | Class | Jobs | Flagged by rules |
|---|---|---|---|
| stale_documents | anomaly | 29 | 29 |
| premature_closure | anomaly | 21 | 21 |
| deleted_after_close | anomaly | 18 | 18 |
| weight_mismatch | anomaly | 17 | 17 |
| unplaced_cargo | anomaly | 15 | 15 |
| closing_changed_on_reclose | anomaly | 14 | 14 |
| source_mismatch | anomaly | 14 | 14 |
| spoofed_actor | anomaly | 14 | 14 |
| placeholder_charges | anomaly | 13 | 13 |
| job_renamed | anomaly | 12 | 12 |
| excess_reversals | anomaly | 11 | 11 |
| package_mismatch | anomaly | 11 | 11 |
| late_material_edit | anomaly | 10 | 10 |
| bulk_na | anomaly | 9 | 9 |
| regen_changed_excess | anomaly | 9 | 9 |
| regen_identical_excess | anomaly | 9 | 9 |
| billing_inconsistency | anomaly | 7 | 7 |
| **consistent_falsification** | anomaly | 18 | **0** |
| **unusual_timing** | anomaly | 13 | **0** |
| all hard-negative types | hard negative | 250 | 0 |
| all data-quality types | data quality | 35 | 0 (data-quality notes only) |
| clean_complete, clean_in_progress | normal | 351 | 0 |

### Using the priority band as the threshold

If only cases scoring 30 or more ("medium" band and above) are treated as positive:

| Dataset | Precision | Recall |
|---|---|---|
| seed-1 | 1.000 | 0.228 |
| seed-2 | 1.000 | 0.182 |
| seed-3 | 1.000 | 0.268 |

Most injected anomalies raise one finding in one rule family, which scores 10, 25 or 40; a single medium-severity finding scores 25 and lands in the "low" band. The bands are too strict to be used as a detection threshold. The score should be used to order the queue, not to filter it. The weights and band limits are uncalibrated design choices (see DETECTION_RULES.md).

## 4. Isolation Forest baseline

Features: 21 behavioural counts and ratios per job (`features()` in `cases.js`): event, edit, generation, reversal and reopening counts, timing gaps, off-hours share, step fractions, relative weight difference, closing-to-taxable ratio, and similar. No identifiers, labels or rule outputs. 200 trees, five model seeds, mean ± standard deviation over model seeds.

### Protocol A: fit on normal-only data (`train-101`), threshold at the 95th percentile of training scores

| Test set | Method | Precision | Recall | F1 | FPR |
|---|---|---|---|---|---|
| seed-1 | ML only | 0.178 ± 0.067 | 0.030 ± 0.013 | 0.052 ± 0.022 | 0.050 ± 0.005 |
| seed-1 | rules OR ML | 0.863 ± 0.012 | 0.873 ± 0.000 | 0.868 ± 0.006 | 0.050 ± 0.005 |
| seed-2 | ML only | 0.096 ± 0.018 | 0.030 ± 0.006 | 0.045 ± 0.009 | 0.115 ± 0.005 |
| seed-2 | rules OR ML | 0.762 ± 0.008 | 0.886 ± 0.000 | 0.819 ± 0.004 | 0.115 ± 0.005 |
| seed-3 | ML only | 0.154 ± 0.051 | 0.043 ± 0.018 | 0.067 ± 0.027 | 0.110 ± 0.005 |
| seed-3 | rules OR ML | 0.793 ± 0.007 | 0.887 ± 0.000 | 0.837 ± 0.004 | 0.110 ± 0.005 |

**This protocol failed.** It found 3–4 % of anomalies and added nothing to the rules except false positives.

Why: five features are constant in the normal-only training set (`n_generation_failures`, `frac_steps_pending_at_close`, `frac_events_off_hours`, `deleted`, `weight_rel_diff`). An isolation tree chooses split points inside the range seen during fitting, so a feature with no range is never split on, and a new value on it (a deleted job, an all-night job) cannot shorten the path. The model was blind on exactly the features where anomalies differ most. It also flagged every `deleted_draft` job (short lifetimes) and about a quarter of `clean_in_progress` and `legit_reopen` jobs. The false-positive rate on test (0.05–0.115) drifted above the 0.05 target set on training.

### Protocol B: fit unsupervised on a mixed, unlabelled dataset (`seed-1`), test on `seed-2` and `seed-3`

The threshold flags the q most isolated share of the fitting set. Labels of the fitting set are not read.

| q | Test set | Method | Precision | Recall | F1 | FPR |
|---|---|---|---|---|---|---|
| 0.10 | seed-2 | ML only | 0.613 ± 0.018 | 0.343 ± 0.026 | 0.440 ± 0.026 | 0.090 ± 0.000 |
| 0.10 | seed-2 | rules OR ML | 0.814 ± 0.000 | 0.943 ± 0.000 | 0.874 ± 0.000 | 0.090 ± 0.000 |
| 0.10 | seed-3 | ML only | 0.575 ± 0.032 | 0.270 ± 0.034 | 0.367 ± 0.038 | 0.095 ± 0.002 |
| 0.10 | seed-3 | rules OR ML | 0.824 ± 0.003 | 0.928 ± 0.000 | 0.873 ± 0.002 | 0.095 ± 0.002 |
| 0.25 | seed-2 | ML only | 0.489 ± 0.016 | 0.559 ± 0.018 | 0.522 ± 0.015 | 0.242 ± 0.011 |
| 0.25 | seed-2 | rules OR ML | 0.618 ± 0.011 | 0.943 ± 0.000 | 0.746 ± 0.008 | 0.242 ± 0.011 |
| 0.25 | seed-3 | ML only | 0.446 ± 0.015 | 0.464 ± 0.018 | 0.455 ± 0.009 | 0.276 ± 0.024 |
| 0.25 | seed-3 | rules OR ML | 0.617 ± 0.020 | 0.928 ± 0.000 | 0.741 ± 0.014 | 0.276 ± 0.024 |

Rules alone on the same test sets: precision 1.000, recall 0.886 / 0.887, FPR 0.000.

ML flag rate by type at q = 0.10 (pooled seed-2 and seed-3, mean over model seeds):

| Flagged often | Rate | Rarely or never flagged | Rate |
|---|---|---|---|
| unusual_timing | 1.00 | consistent_falsification | 0.00 |
| regen_changed_excess | 1.00 | weight_mismatch, package_mismatch | 0.00 |
| regen_identical_excess | 0.95 | billing_inconsistency | 0.00 |
| premature_closure | 0.84 | placeholder_charges | 0.00 |
| excess_reversals | 0.75 | spoofed_actor, job_renamed | 0.00 |
| stale_documents | 0.69 | late_material_edit, source_mismatch | 0.00 |
| **deleted_draft (hard negative)** | **1.00** | bulk_na | 0.00 |
| **clean_in_progress (normal)** | **0.31** | clean_complete | 0.00 |

## 5. Comparison

| Approach | Finds | Misses | Cost |
|---|---|---|---|
| Rules | Every scenario it has a rule for; no false positives on these data | Timing anomalies; consistent falsification | Each rule must be written, and encodes assumptions |
| Isolation Forest, normal-only fit | Almost nothing | Almost everything | 5–11 % false positives |
| Isolation Forest, unsupervised fit, q = 0.10 | Behavioural outliers: unusual timing, heavy regeneration, reversals, premature closure | Anything that is a wrong **value** with normal **behaviour** (weights, bills, placeholders, names) | 9 % false positives; flags every early deletion |
| Rules OR ML (protocol B, q = 0.10) | Recall 0.93–0.94 against 0.89 for rules alone: the gain is `unusual_timing` | `consistent_falsification` | Precision falls from 1.00 to about 0.82; FPR rises from 0 to 0.09 |

What the experiment supports:

1. On this data the rules are the primary detector, and the forest is not a substitute for them.
2. The forest has one clear use: behavioural patterns no rule describes. All 13 `unusual_timing` jobs in the test seeds were flagged at q = 0.10.
3. That gain costs about one false alarm for every eleven normal jobs. Whether that is acceptable depends on reviewer capacity, which this project did not measure.
4. Training on normal-only data, which sounds like the careful choice, was the wrong one for this model and these features.
5. The better use of the ML score is probably as a separate low-priority "unusual behaviour" list rather than OR-ed into detection. This was not tested.

## 6. Limitations of this evaluation

- **Circularity.** Rules and scenarios share an author and a model of the system. Perfect precision and recall on rule-covered types say the implementation matches its specification. They say little about anomalies shaped differently from the ones imagined.
- **Synthetic normal behaviour.** Real work has interruptions, out-of-order steps, bulk corrections and habits that will produce false positives not seen here. The zero false-positive rate should be expected to rise on real data, particularly for GEN-002, WFL-001 and WFL-003, which rest on unconfirmed assumptions about the workflow.
- **Single-cause injections.** Each anomalous job has one clean injection. Combined, partial or disguised cases were not generated.
- **Thresholds tuned by the same person who wrote the scenarios.** `regen_*_threshold`, `reversal_threshold`, `bulk_na_fraction` sit between the hard-negative and anomaly magnitudes by construction.
- **Prevalence.** 26–32 % anomalies. At a realistic rate of a few per thousand, ML precision would fall sharply; rule precision would depend on the real false-positive rate, which is unknown.
- **Small counts per type.** 7 to 29 jobs per anomaly type across three seeds; per-type rates are coarse.
- **One job type.** Sea export only.
- **Undetectable by design.** `consistent_falsification` (18 jobs, 0 detected by any method): values falsified consistently from the first entry leave no internal contradiction and no edit trail. Detection needs an independent source, such as an uploaded source document (compare `source_mismatch`, 14 of 14 detected) or an external weighbridge record. This is a limit of the approach, not of the implementation.
- **Entity matching.** Packing runs were linked by an exact typed job number, the easy case. Misspelt, missing or shared references were tested in unit tests only, not measured.
- **Case-level evaluation was not done.** Cases are one per job here, so case-level and job-level results coincide. Whether grouping helps an investigator was not measured; that would need human reviewers.
- **Evidence integrity is a tested property, not a measured rate.** See the adversarial tests.

## 7. Reproducing

```
cd forensics
node synthetic/generate.js --seed 101 --jobs 300 --out datasets/train-101 --normal-only
node synthetic/generate.js --seed 1 --jobs 300 --out datasets/seed-1
node synthetic/generate.js --seed 2 --jobs 300 --out datasets/seed-2
node synthetic/generate.js --seed 3 --jobs 300 --out datasets/seed-3

node evaluation/evaluate.js datasets/train-101 datasets/seed-1 datasets/seed-2 datasets/seed-3
python evaluation/ml_baseline.py --train datasets/train-101 --test datasets/seed-1 datasets/seed-2 datasets/seed-3 --quantile 0.05 --name ml_normal_only
python evaluation/ml_baseline.py --train datasets/seed-1 --test datasets/seed-2 datasets/seed-3 --unsupervised --quantile 0.10 --name ml_unsupervised_q0.10
python evaluation/ml_baseline.py --train datasets/seed-1 --test datasets/seed-2 datasets/seed-3 --unsupervised --quantile 0.25 --name ml_unsupervised_q0.25
```

Job content and scenario assignment are fixed by the seed. Event ids differ between runs, so hashes differ; counts and metrics for the rules should not. ML figures depend on the scikit-learn version (1.8.0 here).

Result files: `evaluation/results/rules.json`, `ml_normal_only.json`, `ml_unsupervised_q0.10.json`, `ml_unsupervised_q0.25.json`.

## 8. An earlier run that was discarded

The first generation of these datasets showed three false positives on `clean_complete` jobs (WFL-001). Investigation through the case view showed the jobs really had been closed with a step pending: a store defect on Windows had caused the server to refuse one request in about 1,400, and the generator had not checked the response. The findings were right and the labels were wrong. The defect was fixed, the generator now aborts on any refused call, and all four datasets were regenerated. The numbers above are from the regenerated data only. Details: BASELINE_AND_VERIFICATION.md.
