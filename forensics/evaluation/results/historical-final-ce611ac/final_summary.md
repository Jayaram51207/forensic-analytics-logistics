Code ce611ac7f018a815ac3d176da0eee6b6f6581f25; Node v24.11.1; evaluated 2026-10-26T23:57:45.547Z.

### Detection, pooled over held-out seeds

| Variant | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---|---|---|---|---|---|---|---|
| A rules only | 205 | 7 | 111 | 577 | 0.967 | 0.649 | 0.777 | 0.012 |
| C rules + provenance tracking | 205 | 7 | 111 | 577 | 0.967 | 0.649 | 0.777 | 0.012 |
| X rules + contradiction analysis without lineage | 296 | 7 | 20 | 577 | 0.977 | 0.937 | 0.956 | 0.012 |
| D full framework | 296 | 7 | 20 | 577 | 0.977 | 0.937 | 0.956 | 0.012 |
| B Isolation Forest only (ml_normal_only, seed-4+seed-5+seed-6) | | | | | 0.401 ±0.040 | 0.106 ±0.017 | 0.168 ±0.025 | 0.085 ±0.005 |
| A + Isolation Forest (ml_normal_only, seed-4+seed-5+seed-6) | | | | | 0.790 ±0.009 | 0.675 ±0.006 | 0.728 ±0.006 | 0.097 ±0.005 |
| D + Isolation Forest (ml_normal_only, seed-4+seed-5+seed-6) | | | | | 0.839 ±0.007 | 0.937 ±0.000 | 0.885 ±0.004 | 0.097 ±0.005 |
| B Isolation Forest only (ml_unsupervised_q0.10, seed-4+seed-5+seed-6) | | | | | 0.713 ±0.011 | 0.209 ±0.013 | 0.323 ±0.016 | 0.046 ±0.002 |
| A + Isolation Forest (ml_unsupervised_q0.10, seed-4+seed-5+seed-6) | | | | | 0.862 ±0.004 | 0.663 ±0.007 | 0.750 ±0.004 | 0.058 ±0.002 |
| D + Isolation Forest (ml_unsupervised_q0.10, seed-4+seed-5+seed-6) | | | | | 0.898 ±0.004 | 0.937 ±0.000 | 0.917 ±0.002 | 0.058 ±0.002 |

### Detection per seed

| Variant | seed-4 | seed-5 | seed-6 |
|---|---|---|---|
| A | P 0.931 R 0.598 F1 0.728 FPR 0.027 | P 1.000 R 0.705 F1 0.827 FPR 0.000 | P 0.973 R 0.651 F1 0.780 FPR 0.010 |
| C | P 0.931 R 0.598 F1 0.728 FPR 0.027 | P 1.000 R 0.705 F1 0.827 FPR 0.000 | P 0.973 R 0.651 F1 0.780 FPR 0.010 |
| X | P 0.954 R 0.920 F1 0.936 FPR 0.027 | P 1.000 R 0.947 F1 0.973 FPR 0.000 | P 0.981 R 0.945 F1 0.963 FPR 0.010 |
| D | P 0.954 R 0.920 F1 0.936 FPR 0.027 | P 1.000 R 0.947 F1 0.973 FPR 0.000 | P 0.981 R 0.945 F1 0.963 FPR 0.010 |

### Recall (anomaly categories) and false-positive rate (negative classes) by category, pooled

| Category | n | A | C | X | D |
|---|---|---|---|---|---|
| access_control | 8 | 1.000 | 1.000 | 1.000 | 1.000 |
| actor | 10 | 1.000 | 1.000 | 1.000 | 1.000 |
| cross_application | 104 | 0.125 | 0.125 | 1.000 | 1.000 |
| data_quality | 36 | 0.000 | 0.000 | 0.000 | 0.000 |
| deletion | 9 | 1.000 | 1.000 | 1.000 | 1.000 |
| document_integrity | 17 | 1.000 | 1.000 | 1.000 | 1.000 |
| financial_consistency | 16 | 1.000 | 1.000 | 1.000 | 1.000 |
| hard_negative | 302 | 0.023 | 0.023 | 0.023 | 0.023 |
| identifier | 4 | 1.000 | 1.000 | 1.000 | 1.000 |
| late_modification | 9 | 1.000 | 1.000 | 1.000 | 1.000 |
| needs_independent_source | 20 | 0.000 | 0.000 | 0.000 | 0.000 |
| normal | 246 | 0.000 | 0.000 | 0.000 | 0.000 |
| physical_feasibility | 19 | 1.000 | 1.000 | 1.000 | 1.000 |
| placeholder_values | 9 | 1.000 | 1.000 | 1.000 | 1.000 |
| quantity_consistency | 24 | 1.000 | 1.000 | 1.000 | 1.000 |
| regeneration | 17 | 1.000 | 1.000 | 1.000 | 1.000 |
| source_consistency | 11 | 1.000 | 1.000 | 1.000 | 1.000 |
| timing | 8 | 1.000 | 1.000 | 1.000 | 1.000 |
| workflow | 31 | 1.000 | 1.000 | 1.000 | 1.000 |

### Investigation quality, pooled

| Measure | C | X | D |
|---|---|---|---|
| Conflicting field identified | 0/141 (0.0%) | 141/141 (100.0%) | 141/141 (100.0%) |
| Contradictions on non-anomalous jobs | 0 | 0 | 0 |
| Lineage expectations met | 26/50 (52.0%) | 24/50 (48.0%) | 50/50 (100.0%) |
| Agreement of copies counted as independent | 1077/1466 (73.5%) | 1466/1466 (100.0%) | 1077/1466 (73.5%) |
| Single-lineage fields stated as needing an independent source | 6128/6128 (100.0%) | 5803/5803 (100.0%) | 6128/6128 (100.0%) |
| External records linked to the right job | 289/289 (100.0%) | 289/289 (100.0%) | 289/289 (100.0%) |
| Unattributable records left unlinked | 8/8 (100.0%) | 8/8 (100.0%) | 8/8 (100.0%) |
| Ambiguous references marked ambiguous | 11/11 (100.0%) | 11/11 (100.0%) | 11/11 (100.0%) |
| Records attributed to a wrong job | 0 | 0 | 0 |
| Weak links used as anomaly evidence | 0 | 0 | 0 |
| Findings citing existing events | 270/270 (100.0%) | 600/600 (100.0%) | 600/600 (100.0%) |
| Contradictions with both records traceable | 0/0 (n/a) | 330/330 (100.0%) | 330/330 (100.0%) |
| Recorded values with a captured source | 2217/9406 (23.6%) | 2217/9406 (23.6%) | 2217/9406 (23.6%) |
| Timeline order correct (jobs with external records) | 1.000 / 1.000 / 1.000 | 1.000 / 1.000 / 1.000 | 1.000 / 1.000 / 1.000 |
| Same, arrival order (variant A) | 0.972 / 0.972 / 0.973 | | |

### Missed anomalies by scenario type (pooled)

| Type | n | A | C | X | D |
|---|---|---|---|---|---|
| billing_inconsistency | 9 | 0 | 0 | 0 | 0 |
| bulk_na | 8 | 0 | 0 | 0 | 0 |
| closing_changed_on_reclose | 7 | 0 | 0 | 0 | 0 |
| common_source_falsification | 9 | 9 | 9 | 9 | 9 |
| consistent_falsification | 11 | 11 | 11 | 11 | 11 |
| deleted_after_close | 9 | 0 | 0 | 0 | 0 |
| excess_reversals | 13 | 0 | 0 | 0 | 0 |
| job_renamed | 4 | 0 | 0 | 0 | 0 |
| late_material_edit | 9 | 0 | 0 | 0 | 0 |
| package_mismatch | 8 | 0 | 0 | 0 | 0 |
| placeholder_charges | 9 | 0 | 0 | 0 | 0 |
| premature_closure | 10 | 0 | 0 | 0 | 0 |
| regen_changed_excess | 10 | 0 | 0 | 0 | 0 |
| regen_identical_excess | 7 | 0 | 0 | 0 | 0 |
| source_mismatch | 11 | 0 | 0 | 0 | 0 |
| spoofed_actor | 10 | 0 | 0 | 0 | 0 |
| stale_documents | 17 | 0 | 0 | 0 | 0 |
| unauthorized_delete_attempt | 8 | 0 | 0 | 0 | 0 |
| unplaced_cargo | 19 | 0 | 0 | 0 | 0 |
| unusual_timing | 8 | 0 | 0 | 0 | 0 |
| weight_mismatch | 16 | 0 | 0 | 0 | 0 |
| xapp_charge_conflict | 8 | 8 | 8 | 0 | 0 |
| xapp_container_conflict | 10 | 10 | 10 | 0 | 0 |
| xapp_document_backed_conflict | 13 | 0 | 0 | 0 | 0 |
| xapp_identifier_mismatch | 7 | 7 | 7 | 0 | 0 |
| xapp_late_activity | 13 | 13 | 13 | 0 | 0 |
| xapp_package_conflict | 14 | 14 | 14 | 0 | 0 |
| xapp_post_issue_divergence | 24 | 24 | 24 | 0 | 0 |
| xapp_weight_conflict | 15 | 15 | 15 | 0 | 0 |

### False alarms (negative jobs flagged), pooled

- A: 7 — seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-6/legit_backfill [TIM-001]; seed-6/legit_backfill [TIM-001]
- C: 7 — seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-6/legit_backfill [TIM-001]; seed-6/legit_backfill [TIM-001]
- X: 7 — seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-6/legit_backfill [TIM-001]; seed-6/legit_backfill [TIM-001]
- D: 7 — seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-4/legit_backfill [TIM-001]; seed-6/legit_backfill [TIM-001]; seed-6/legit_backfill [TIM-001]

### Hard-negative and fit-set false-positive rate

- A: hard-negative FPR per seed 0.047 / 0.000 / 0.020; fit set train-201 FPR 0.013
- C: hard-negative FPR per seed 0.047 / 0.000 / 0.020; fit set train-201 FPR 0.013
- X: hard-negative FPR per seed 0.047 / 0.000 / 0.020; fit set train-201 FPR 0.013
- D: hard-negative FPR per seed 0.047 / 0.000 / 0.020; fit set train-201 FPR 0.013
