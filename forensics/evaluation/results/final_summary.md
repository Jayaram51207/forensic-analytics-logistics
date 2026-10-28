Code 3d2a5e3374be0966f577a6ae38816730170bf1e5; Node v24.11.1; evaluated 2026-10-28T21:53:48.583Z.

### Detection, pooled over held-out seeds (seed-7, seed-8, seed-9); brackets: 95% Wilson interval

| Variant | TP | FP | FN | TN | Precision | Recall | F1 | FPR |
|---|---|---|---|---|---|---|---|---|
| A rules only | 221 | 7 | 107 | 565 | 0.969 [0.938, 0.985] | 0.674 [0.621, 0.722] | 0.795 | 0.012 [0.006, 0.025] |
| C rules + provenance tracking | 221 | 7 | 107 | 565 | 0.969 [0.938, 0.985] | 0.674 [0.621, 0.722] | 0.795 | 0.012 [0.006, 0.025] |
| X rules + contradiction analysis without lineage | 301 | 7 | 27 | 565 | 0.977 [0.954, 0.989] | 0.918 [0.883, 0.943] | 0.947 | 0.012 [0.006, 0.025] |
| D full framework | 301 | 7 | 27 | 565 | 0.977 [0.954, 0.989] | 0.918 [0.883, 0.943] | 0.947 | 0.012 [0.006, 0.025] |
| B Isolation Forest only (ml_normal_only, seed-7+seed-8+seed-9) | | | | | 0.348 ±0.049 | 0.084 ±0.020 | 0.134 ±0.029 | 0.088 ±0.007 |
| A + Isolation Forest (ml_normal_only, seed-7+seed-8+seed-9) | | | | | 0.796 ±0.011 | 0.681 ±0.005 | 0.734 ±0.004 | 0.100 ±0.007 |
| D + Isolation Forest (ml_normal_only, seed-7+seed-8+seed-9) | | | | | 0.841 ±0.010 | 0.918 ±0.001 | 0.878 ±0.005 | 0.100 ±0.007 |
| B Isolation Forest only (ml_unsupervised_q0.10, seed-7+seed-8+seed-9) | | | | | 0.613 ±0.012 | 0.154 ±0.009 | 0.246 ±0.012 | 0.056 ±0.002 |
| A + Isolation Forest (ml_unsupervised_q0.10, seed-7+seed-8+seed-9) | | | | | 0.851 ±0.004 | 0.675 ±0.001 | 0.753 ±0.001 | 0.068 ±0.002 |
| D + Isolation Forest (ml_unsupervised_q0.10, seed-7+seed-8+seed-9) | | | | | 0.886 ±0.003 | 0.918 ±0.000 | 0.901 ±0.002 | 0.068 ±0.002 |

### Detection per seed

| Variant | seed-7 | seed-8 | seed-9 |
|---|---|---|---|
| A | P 0.986 R 0.664 F1 0.793 FPR 0.005 | P 0.934 R 0.696 F1 0.798 FPR 0.025 | P 0.988 R 0.664 F1 0.794 FPR 0.006 |
| C | P 0.986 R 0.664 F1 0.793 FPR 0.005 | P 0.934 R 0.696 F1 0.798 FPR 0.025 | P 0.988 R 0.664 F1 0.794 FPR 0.006 |
| X | P 0.989 R 0.869 F1 0.925 FPR 0.005 | P 0.951 R 0.951 F1 0.951 FPR 0.025 | P 0.991 R 0.933 F1 0.961 FPR 0.006 |
| D | P 0.989 R 0.869 F1 0.925 FPR 0.005 | P 0.951 R 0.951 F1 0.951 FPR 0.025 | P 0.991 R 0.933 F1 0.961 FPR 0.006 |

### Recall (anomaly categories) and false-positive rate (negative classes) by category, pooled

| Category | n | A | C | X | D |
|---|---|---|---|---|---|
| access_control | 14 | 1.000 | 1.000 | 1.000 | 1.000 |
| actor | 5 | 1.000 | 1.000 | 1.000 | 1.000 |
| cross_application | 90 | 0.111 | 0.111 | 1.000 | 1.000 |
| data_quality | 24 | 0.000 | 0.000 | 0.000 | 0.000 |
| deletion | 11 | 1.000 | 1.000 | 1.000 | 1.000 |
| document_integrity | 10 | 1.000 | 1.000 | 1.000 | 1.000 |
| financial_consistency | 31 | 1.000 | 1.000 | 1.000 | 1.000 |
| hard_negative | 303 | 0.023 | 0.023 | 0.023 | 0.023 |
| identifier | 2 | 1.000 | 1.000 | 1.000 | 1.000 |
| late_modification | 14 | 1.000 | 1.000 | 1.000 | 1.000 |
| needs_independent_source | 27 | 0.000 | 0.000 | 0.000 | 0.000 |
| normal | 245 | 0.000 | 0.000 | 0.000 | 0.000 |
| physical_feasibility | 20 | 1.000 | 1.000 | 1.000 | 1.000 |
| placeholder_values | 14 | 1.000 | 1.000 | 1.000 | 1.000 |
| quantity_consistency | 28 | 1.000 | 1.000 | 1.000 | 1.000 |
| regeneration | 13 | 1.000 | 1.000 | 1.000 | 1.000 |
| source_consistency | 11 | 1.000 | 1.000 | 1.000 | 1.000 |
| timing | 11 | 1.000 | 1.000 | 1.000 | 1.000 |
| workflow | 27 | 1.000 | 1.000 | 1.000 | 1.000 |

### Investigation quality, pooled

| Measure | C | X | D |
|---|---|---|---|
| Conflicting field identified | 0/113 (0.0%) | 113/113 (100.0%) | 113/113 (100.0%) |
| Contradictions on non-anomalous jobs | 0 | 0 | 0 |
| Lineage expectations met | 38/61 (62.3%) | 23/61 (37.7%) | 61/61 (100.0%) |
| Agreement of copies counted as independent | 1020/1461 (69.8%) | 1461/1461 (100.0%) | 1020/1461 (69.8%) |
| Single-lineage fields stated as needing an independent source | 6114/6114 (100.0%) | 5833/5833 (100.0%) | 6114/6114 (100.0%) |
| External records linked to the right job | 314/314 (100.0%) | 314/314 (100.0%) | 314/314 (100.0%) |
| Unattributable records left unlinked | 8/8 (100.0%) | 8/8 (100.0%) | 8/8 (100.0%) |
| Ambiguous references marked ambiguous | 13/13 (100.0%) | 13/13 (100.0%) | 13/13 (100.0%) |
| Records attributed to a wrong job | 0 | 0 | 0 |
| Weak links used as anomaly evidence | 0 | 0 | 0 |
| Findings citing existing events | 284/284 (100.0%) | 598/598 (100.0%) | 598/598 (100.0%) |
| Contradictions with both records traceable | 0/0 (n/a) | 314/314 (100.0%) | 314/314 (100.0%) |
| Recorded values with a captured source | 2337/9573 (24.4%) | 2337/9573 (24.4%) | 2337/9573 (24.4%) |
| Timeline order correct (jobs with external records) | 1.000 / 1.000 / 1.000 | 1.000 / 1.000 / 1.000 | 1.000 / 1.000 / 1.000 |
| Same, arrival order (variant A) | 0.972 / 0.971 / 0.972 | | |

### Missed anomalies by scenario type (pooled)

| Type | n | A | C | X | D |
|---|---|---|---|---|---|
| billing_inconsistency | 21 | 0 | 0 | 0 | 0 |
| bulk_na | 4 | 0 | 0 | 0 | 0 |
| closing_changed_on_reclose | 10 | 0 | 0 | 0 | 0 |
| common_source_falsification | 9 | 9 | 9 | 9 | 9 |
| consistent_falsification | 18 | 18 | 18 | 18 | 18 |
| deleted_after_close | 11 | 0 | 0 | 0 | 0 |
| excess_reversals | 11 | 0 | 0 | 0 | 0 |
| job_renamed | 2 | 0 | 0 | 0 | 0 |
| late_material_edit | 14 | 0 | 0 | 0 | 0 |
| package_mismatch | 6 | 0 | 0 | 0 | 0 |
| placeholder_charges | 14 | 0 | 0 | 0 | 0 |
| premature_closure | 12 | 0 | 0 | 0 | 0 |
| regen_changed_excess | 9 | 0 | 0 | 0 | 0 |
| regen_identical_excess | 4 | 0 | 0 | 0 | 0 |
| source_mismatch | 11 | 0 | 0 | 0 | 0 |
| spoofed_actor | 5 | 0 | 0 | 0 | 0 |
| stale_documents | 10 | 0 | 0 | 0 | 0 |
| unauthorized_delete_attempt | 14 | 0 | 0 | 0 | 0 |
| unplaced_cargo | 20 | 0 | 0 | 0 | 0 |
| unusual_timing | 11 | 0 | 0 | 0 | 0 |
| weight_mismatch | 22 | 0 | 0 | 0 | 0 |
| xapp_charge_conflict | 12 | 12 | 12 | 0 | 0 |
| xapp_container_conflict | 11 | 11 | 11 | 0 | 0 |
| xapp_document_backed_conflict | 10 | 0 | 0 | 0 | 0 |
| xapp_identifier_mismatch | 11 | 11 | 11 | 0 | 0 |
| xapp_late_activity | 11 | 11 | 11 | 0 | 0 |
| xapp_package_conflict | 13 | 13 | 13 | 0 | 0 |
| xapp_post_issue_divergence | 13 | 13 | 13 | 0 | 0 |
| xapp_weight_conflict | 9 | 9 | 9 | 0 | 0 |

### False alarms (negative jobs flagged), pooled

- A: 7 — seed-7/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-9/legit_backfill [TIM-001]
- C: 7 — seed-7/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-9/legit_backfill [TIM-001]
- X: 7 — seed-7/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-9/legit_backfill [TIM-001]
- D: 7 — seed-7/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-8/legit_backfill [TIM-001]; seed-9/legit_backfill [TIM-001]

### Hard-negative and fit-set false-positive rate

- A: hard-negative FPR per seed 0.009 / 0.051 / 0.010; fit set train-201 FPR 0.013
- C: hard-negative FPR per seed 0.009 / 0.051 / 0.010; fit set train-201 FPR 0.013
- X: hard-negative FPR per seed 0.009 / 0.051 / 0.010; fit set train-201 FPR 0.013
- D: hard-negative FPR per seed 0.009 / 0.051 / 0.010; fit set train-201 FPR 0.013

### Each rule alone (full framework, pooled): labelled jobs it fired on

| Rule | on anomalies | on negatives | precision |
|---|---|---|---|
| ACT-001 | 5 | 0 | 1.000 |
| ACT-002 | 14 | 0 | 1.000 |
| DEF-001 | 14 | 0 | 1.000 |
| DEL-001 | 11 | 0 | 1.000 |
| FIN-001 | 31 | 0 | 1.000 |
| GEN-001 | 10 | 0 | 1.000 |
| GEN-002 | 14 | 0 | 1.000 |
| GEN-003 | 13 | 0 | 1.000 |
| IDN-001 | 2 | 0 | 1.000 |
| PCK-001 | 20 | 0 | 1.000 |
| SRC-001 | 21 | 0 | 1.000 |
| TIM-001 | 11 | 7 | 0.611 |
| WFL-001 | 12 | 0 | 1.000 |
| WFL-002 | 11 | 0 | 1.000 |
| WFL-003 | 4 | 0 | 1.000 |
| WGT-001 | 28 | 0 | 1.000 |
| XAP-CONTAINER_NOS | 11 | 0 | 1.000 |
| XAP-GROSS_WEIGHT | 32 | 0 | 1.000 |
| XAP-JOB_NO | 11 | 0 | 1.000 |
| XAP-NET_WEIGHT | 23 | 0 | 1.000 |
| XAP-PACKAGES | 13 | 0 | 1.000 |
| XAP-TAXABLE_TOTAL | 12 | 0 | 1.000 |
| XAP-TIMING | 11 | 0 | 1.000 |

### Previous held-out seeds, re-scored (seed-4, seed-5, seed-6; code 3d2a5e3)

Seeds 4-6: the held-out sets of the previous round. Their results were read in detail during development (no rule or threshold was changed afterwards), so they are no longer untouched; re-scored here with the current code.

| Variant | TP | FP | FN | TN | Precision | Recall | FPR |
|---|---|---|---|---|---|---|---|
| A | 205 | 7 | 111 | 577 | 0.967 [0.933, 0.984] | 0.649 [0.595, 0.699] | 0.012 [0.006, 0.025] |
| C | 205 | 7 | 111 | 577 | 0.967 [0.933, 0.984] | 0.649 [0.595, 0.699] | 0.012 [0.006, 0.025] |
| X | 296 | 7 | 20 | 577 | 0.977 [0.953, 0.989] | 0.937 [0.904, 0.959] | 0.012 [0.006, 0.025] |
| D | 296 | 7 | 20 | 577 | 0.977 [0.953, 0.989] | 0.937 [0.904, 0.959] | 0.012 [0.006, 0.025] |

### Unseen scenario families (unseen-301; code 3d2a5e3)

Scenario families written after the rules were fixed and committed before generation (synthetic/unseen_scenarios.js); never used for tuning. Same author as the rules: less template leakage, not less author bias. Clean jobs are included as the normal base rate.

| Variant | TP | FP | FN | TN | Precision | Recall | FPR |
|---|---|---|---|---|---|---|---|
| A | 14 | 0 | 44 | 92 | 1.000 [0.785, 1.000] | 0.241 [0.150, 0.365] | 0.000 [0.000, 0.040] |
| C | 14 | 0 | 44 | 92 | 1.000 [0.785, 1.000] | 0.241 [0.150, 0.365] | 0.000 [0.000, 0.040] |
| X | 58 | 0 | 0 | 92 | 1.000 [0.938, 1.000] | 1.000 [0.938, 1.000] | 0.000 [0.000, 0.040] |
| D | 58 | 0 | 0 | 92 | 1.000 [0.938, 1.000] | 1.000 [0.938, 1.000] | 0.000 [0.000, 0.040] |

| Family | class | n | A flagged | C flagged | X flagged | D flagged |
|---|---|---|---|---|---|---|
| u_charge_dropped_in_invoice | anomaly | 11 | 0 | 0 | 11 | 11 |
| u_net_weight_conflict | anomaly | 15 | 0 | 0 | 15 | 15 |
| u_stuffing_late_container | anomaly | 8 | 0 | 0 | 8 | 8 |
| u_two_tools_agree_against_job | anomaly | 10 | 0 | 0 | 10 | 10 |
| u_weight_cut_after_close | anomaly | 14 | 14 | 14 | 14 | 14 |
| u_net_weight_in_tonnes | hard_negative | 12 | 0 | 0 | 0 | 0 |
| u_quotation_linked | hard_negative | 6 | 0 | 0 | 0 | 0 |
| u_quotation_without_ref | hard_negative | 9 | 0 | 0 | 0 | 0 |
| u_reexported_batch | hard_negative | 10 | 0 | 0 | 0 | 0 |
| u_stuffing_rounding | hard_negative | 11 | 0 | 0 | 0 | 0 |
| clean_complete | normal | 44 | 0 | 0 | 0 | 0 |
