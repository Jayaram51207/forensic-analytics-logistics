Code 251e9e7362762c3e243525c3074365c75c22abcb; Node v24.11.1; evaluated 2026-10-26T21:50:59.796Z.

### Detection, pooled over held-out seeds

| Variant | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---|---|---|---|---|---|---|---|
| A rules only | 210 | 0 | 111 | 577 | 1.000 | 0.654 | 0.791 | 0.000 |
| C rules + provenance tracking | 210 | 0 | 111 | 577 | 1.000 | 0.654 | 0.791 | 0.000 |
| X rules + contradiction analysis without lineage | 290 | 0 | 31 | 577 | 1.000 | 0.903 | 0.949 | 0.000 |
| D full framework | 290 | 0 | 31 | 577 | 1.000 | 0.903 | 0.949 | 0.000 |
| B Isolation Forest only (ml_normal_only, seed-1+seed-2+seed-3) | | | | | 0.173 ±0.023 | 0.040 ±0.007 | 0.066 ±0.010 | 0.107 ±0.007 |
| A + Isolation Forest (ml_normal_only, seed-1+seed-2+seed-3) | | | | | 0.772 ±0.011 | 0.655 ±0.001 | 0.709 ±0.004 | 0.107 ±0.007 |
| D + Isolation Forest (ml_normal_only, seed-1+seed-2+seed-3) | | | | | 0.824 ±0.009 | 0.903 ±0.000 | 0.862 ±0.005 | 0.107 ±0.007 |
| B Isolation Forest only (ml_unsupervised_q0.10, seed-2+seed-3) | | | | | 0.530 ±0.030 | 0.128 ±0.015 | 0.206 ±0.022 | 0.062 ±0.004 |
| A + Isolation Forest (ml_unsupervised_q0.10, seed-2+seed-3) | | | | | 0.850 ±0.008 | 0.642 ±0.002 | 0.732 ±0.004 | 0.062 ±0.004 |
| D + Isolation Forest (ml_unsupervised_q0.10, seed-2+seed-3) | | | | | 0.888 ±0.006 | 0.896 ±0.000 | 0.892 ±0.003 | 0.062 ±0.004 |

### Detection per seed

| Variant | seed-1 | seed-2 | seed-3 |
|---|---|---|---|
| A | P 1.000 R 0.679 F1 0.809 FPR 0.000 | P 1.000 R 0.636 F1 0.778 FPR 0.000 | P 1.000 R 0.646 F1 0.785 FPR 0.000 |
| C | P 1.000 R 0.679 F1 0.809 FPR 0.000 | P 1.000 R 0.636 F1 0.778 FPR 0.000 | P 1.000 R 0.646 F1 0.785 FPR 0.000 |
| X | P 1.000 R 0.917 F1 0.957 FPR 0.000 | P 1.000 R 0.939 F1 0.969 FPR 0.000 | P 1.000 R 0.858 F1 0.924 FPR 0.000 |
| D | P 1.000 R 0.917 F1 0.957 FPR 0.000 | P 1.000 R 0.939 F1 0.969 FPR 0.000 | P 1.000 R 0.858 F1 0.924 FPR 0.000 |

### Recall (anomaly categories) and false-positive rate (negative classes) by category, pooled

| Category | n | A | C | X | D |
|---|---|---|---|---|---|
| access_control_gap | 5 | 0.000 | 0.000 | 0.000 | 0.000 |
| actor | 6 | 1.000 | 1.000 | 1.000 | 1.000 |
| cross_application | 89 | 0.101 | 0.101 | 1.000 | 1.000 |
| data_quality | 33 | 0.000 | 0.000 | 0.000 | 0.000 |
| deletion | 19 | 1.000 | 1.000 | 1.000 | 1.000 |
| document_integrity | 17 | 1.000 | 1.000 | 1.000 | 1.000 |
| financial_consistency | 24 | 1.000 | 1.000 | 1.000 | 1.000 |
| hard_negative | 268 | 0.000 | 0.000 | 0.000 | 0.000 |
| identifier | 10 | 1.000 | 1.000 | 1.000 | 1.000 |
| late_modification | 22 | 1.000 | 1.000 | 1.000 | 1.000 |
| needs_independent_source | 20 | 0.000 | 0.000 | 0.000 | 0.000 |
| normal | 276 | 0.000 | 0.000 | 0.000 | 0.000 |
| physical_feasibility | 11 | 1.000 | 1.000 | 1.000 | 1.000 |
| placeholder_values | 7 | 1.000 | 1.000 | 1.000 | 1.000 |
| quantity_consistency | 16 | 1.000 | 1.000 | 1.000 | 1.000 |
| regeneration | 22 | 1.000 | 1.000 | 1.000 | 1.000 |
| source_consistency | 16 | 1.000 | 1.000 | 1.000 | 1.000 |
| timing_no_rule | 6 | 0.000 | 0.000 | 0.000 | 0.000 |
| workflow | 31 | 1.000 | 1.000 | 1.000 | 1.000 |

### Investigation quality, pooled

| Measure | C | X | D |
|---|---|---|---|
| Conflicting field identified | 0/115 (0.0%) | 115/115 (100.0%) | 115/115 (100.0%) |
| Contradictions on non-anomalous jobs | 0 | 0 | 0 |
| Lineage expectations met | 40/69 (58.0%) | 29/69 (42.0%) | 69/69 (100.0%) |
| Agreement of copies counted as independent | 781/1222 (63.9%) | 1222/1222 (100.0%) | 781/1222 (63.9%) |
| Single-lineage fields stated as needing an independent source | 6421/6421 (100.0%) | 6108/6108 (100.0%) | 6421/6421 (100.0%) |
| External records linked to the right job | 252/252 (100.0%) | 252/252 (100.0%) | 252/252 (100.0%) |
| Unattributable records left unlinked | 19/19 (100.0%) | 19/19 (100.0%) | 19/19 (100.0%) |
| Ambiguous references marked ambiguous | 20/20 (100.0%) | 20/20 (100.0%) | 20/20 (100.0%) |
| Records attributed to a wrong job | 0 | 0 | 0 |
| Weak links used as anomaly evidence | 0 | 0 | 0 |
| Findings citing existing events | 286/286 (100.0%) | 584/584 (100.0%) | 584/584 (100.0%) |
| Contradictions with both records traceable | 0/0 (n/a) | 298/298 (100.0%) | 298/298 (100.0%) |
| Recorded values with a captured source | 2147/9475 (22.7%) | 2147/9475 (22.7%) | 2147/9475 (22.7%) |
| Timeline order correct (jobs with external records) | 1.000 / 1.000 / 1.000 | 1.000 / 1.000 / 1.000 | 1.000 / 1.000 / 1.000 |
| Same, arrival order (variant A) | 0.973 / 0.971 / 0.974 | | |

### Missed anomalies by scenario type (pooled)

| Type | n | A | C | X | D |
|---|---|---|---|---|---|
| billing_inconsistency | 15 | 0 | 0 | 0 | 0 |
| bulk_na | 13 | 0 | 0 | 0 | 0 |
| closing_changed_on_reclose | 9 | 0 | 0 | 0 | 0 |
| common_source_falsification | 12 | 12 | 12 | 12 | 12 |
| consistent_falsification | 8 | 8 | 8 | 8 | 8 |
| deleted_after_close | 19 | 0 | 0 | 0 | 0 |
| excess_reversals | 8 | 0 | 0 | 0 | 0 |
| job_renamed | 10 | 0 | 0 | 0 | 0 |
| late_material_edit | 22 | 0 | 0 | 0 | 0 |
| package_mismatch | 10 | 0 | 0 | 0 | 0 |
| placeholder_charges | 7 | 0 | 0 | 0 | 0 |
| premature_closure | 10 | 0 | 0 | 0 | 0 |
| regen_changed_excess | 15 | 0 | 0 | 0 | 0 |
| regen_identical_excess | 7 | 0 | 0 | 0 | 0 |
| source_mismatch | 16 | 0 | 0 | 0 | 0 |
| spoofed_actor | 6 | 0 | 0 | 0 | 0 |
| stale_documents | 17 | 0 | 0 | 0 | 0 |
| unauthorized_delete_attempt | 5 | 5 | 5 | 5 | 5 |
| unplaced_cargo | 11 | 0 | 0 | 0 | 0 |
| unusual_timing | 6 | 6 | 6 | 6 | 6 |
| weight_mismatch | 6 | 0 | 0 | 0 | 0 |
| xapp_charge_conflict | 12 | 12 | 12 | 0 | 0 |
| xapp_container_conflict | 9 | 9 | 9 | 0 | 0 |
| xapp_document_backed_conflict | 9 | 0 | 0 | 0 | 0 |
| xapp_identifier_mismatch | 7 | 7 | 7 | 0 | 0 |
| xapp_late_activity | 14 | 14 | 14 | 0 | 0 |
| xapp_package_conflict | 7 | 7 | 7 | 0 | 0 |
| xapp_post_issue_divergence | 17 | 17 | 17 | 0 | 0 |
| xapp_weight_conflict | 14 | 14 | 14 | 0 | 0 |

### False alarms (negative jobs flagged), pooled

- A: 0
- C: 0
- X: 0
- D: 0

### Hard-negative and fit-set false-positive rate

- A: hard-negative FPR per seed 0.000 / 0.000 / 0.000; fit set train-101 FPR 0.000
- C: hard-negative FPR per seed 0.000 / 0.000 / 0.000; fit set train-101 FPR 0.000
- X: hard-negative FPR per seed 0.000 / 0.000 / 0.000; fit set train-101 FPR 0.000
- D: hard-negative FPR per seed 0.000 / 0.000 / 0.000; fit set train-101 FPR 0.000
