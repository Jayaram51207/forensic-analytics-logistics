// Scores the framework against ground truth, with ablations, and exports the
// feature table used by the machine-learning baseline.
//
//   node evaluation/evaluate.js datasets/seed-1 datasets/seed-2 datasets/seed-3
//
// Unit of analysis: one job (labels.json has one entry per job number).
// Positive class: label.class === 'anomaly'. Predicted positive: at least one
// finding of kind 'anomaly' on any lifecycle of that job number.
//
// Variants:
//   A  rules only                                  analyze({ provenance: false })
//   C  rules + provenance tracking                 analyze({ contradictions: false })
//   D  rules + provenance + contradiction analysis analyze({})
//   (B, rules + Isolation Forest, is computed by ml_baseline.py from features.csv)
// Provenance alone (C) adds no findings by design; it is scored on what it adds to
// reconstruction and to the honesty of conclusions.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventStore } from '../src/store.js';
import { analyze, caseDetail, features } from '../src/cases.js';
import { reconstruct } from '../src/model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function metrics(rows, predicted) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    const p = !!predicted(r);
    if (r.anomalous && p) tp++; else if (!r.anomalous && p) fp++; else if (r.anomalous) fn++; else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null, recall = tp + fn ? tp / (tp + fn) : null;
  return { tp, fp, fn, tn, precision, recall, f1: precision && recall ? 2 * precision * recall / (precision + recall) : (precision === null || recall === null ? null : 0), false_positive_rate: fp + tn ? fp / (fp + tn) : null };
}

const ratio = (a, b) => (b ? a / b : null);

function perJob(analysis, labels) {
  return new Map(labels.map(l => {
    const cases = analysis.cases.filter(c => c.job_nos_seen.includes(l.job_no));
    const fs_ = cases.flatMap(c => c.findings);
    return [l.job_no, { cases, findings: fs_, anomaly_rules: [...new Set(fs_.filter(f => f.kind === 'anomaly').map(f => f.rule_id))].sort(), flag: fs_.some(f => f.kind === 'anomaly'), priority: Math.max(0, ...cases.map(c => c.priority.value)) }];
  }));
}

/** Fraction of adjacent timeline pairs that are in true chronological order. */
function orderingAccuracy(analysis, order) {
  let ok = 0, total = 0, jobsWithExternal = 0, okExt = 0, totalExt = 0;
  for (const view of analysis.views.values()) {
    if (!view.state) continue;
    const tl = reconstruct(view, analysis.context, { order }).timeline;
    const hasExt = tl.some(t => t.application !== 'workflow_sync');
    if (hasExt) jobsWithExternal++;
    for (let i = 1; i < tl.length; i++) {
      // Ground truth: every event's true time is its simulated event time (ties broken by arrival).
      const good = Date.parse(tl[i - 1].event_time) <= Date.parse(tl[i].event_time);
      total++; ok += good ? 1 : 0;
      if (hasExt) { totalExt++; okExt += good ? 1 : 0; }
    }
  }
  return { all_jobs: ratio(ok, total), jobs_with_external_records: ratio(okExt, totalExt), n_jobs_with_external_records: jobsWithExternal };
}

export function evaluateDataset(dir) {
  const labels = JSON.parse(fs.readFileSync(path.join(dir, 'labels.json'), 'utf8'));
  const store = new EventStore(path.join(dir, 'evidence'));
  const integrity = store.verify();
  const records = store.readAll().records.map(x => x.record);
  const A = analyze(records, { provenance: false });
  const C = analyze(records, { contradictions: false, integrity });
  const D = analyze(records, { integrity });
  const jA = perJob(A, labels), jD = perJob(D, labels);
  const viewsOf = job => [...D.views.values()].filter(v => v.job_nos.has(job));

  const rows = labels.map(l => {
    const view = viewsOf(l.job_no).at(-1);
    const a = jA.get(l.job_no), d = jD.get(l.job_no);
    const expectedA = l.params.rules_alone_expected ?? l.expected_rules.filter(r => !r.startsWith('XAP-'));
    return {
      ...l, features: view ? features(view) : null,
      rule_flag: a.flag, rules_fired: a.anomaly_rules, priority: a.priority,
      full_flag: d.flag, full_rules_fired: d.anomaly_rules, full_priority: d.priority,
      detectable_by_rules: expectedA.length > 0, detectable_by_full: l.expected_rules.length > 0,
      expected_hit_full: l.expected_rules.every(r => d.findings.some(f => f.rule_id === r)),
      exact_full: l.class === 'anomaly' ? JSON.stringify(d.anomaly_rules) === JSON.stringify([...l.expected_rules].sort()) : d.anomaly_rules.length === 0
    };
  });

  // ---- per scenario type
  const byType = {};
  for (const r of rows) {
    const t = byType[r.type] || (byType[r.type] = { class: r.class, n: 0, flagged_A_rules: 0, flagged_D_full: 0, exact_D: 0 });
    t.n++; t.flagged_A_rules += +r.rule_flag; t.flagged_D_full += +r.full_flag; t.exact_D += +r.exact_full;
  }

  // ---- linkage of external records (ground truth from labels.params.external)
  const link = { expected_linked: 0, correctly_linked: 0, expected_unlinked: 0, correctly_unlinked: 0, expected_ambiguous: 0, correctly_ambiguous: 0, wrongly_attributed: 0 };
  for (const l of labels) for (const e of l.params.external || []) {
    const rec = records.find(r => r.payload?.source?.source_event_id === e.source_event_id);
    const lk = rec?._link;
    const onRightJob = lk && !lk.ambiguous && lk.method !== 'unlinked' && viewsOf(l.job_no).some(v => v.external_links.some(x => x.event === rec));
    if (e.should_link === true) { link.expected_linked++; link.correctly_linked += +!!onRightJob; }
    if (e.should_link === false) { link.expected_unlinked++; link.correctly_unlinked += +(lk?.method === 'unlinked'); }
    if (e.should_link === 'ambiguous') { link.expected_ambiguous++; link.correctly_ambiguous += +!!lk?.ambiguous; }
    if (lk && !lk.ambiguous && lk.method !== 'unlinked' && !onRightJob) link.wrongly_attributed++;
  }

  // ---- conflicting-record identification
  const conflict = { expected_fields: 0, identified: 0, jobs_expected: 0, jobs_fully_identified: 0, spurious_contradictions_on_non_anomalous_jobs: 0 };
  for (const l of labels) {
    const prov = viewsOf(l.job_no).map(v => D.provenance.get(v.correlation_id)).filter(Boolean);
    const real = prov.flatMap(p => p.contradictions).filter(c => !['insufficient_evidence', 'unresolved_business_rule_conflict'].includes(c.classification));
    const want = l.params.conflict_fields || [];
    if (want.length) {
      conflict.jobs_expected++;
      const hit = want.filter(f => real.some(c => c.field === f));
      conflict.expected_fields += want.length; conflict.identified += hit.length;
      conflict.jobs_fully_identified += +(hit.length === want.length);
    } else if (!l.anomalous) conflict.spurious_contradictions_on_non_anomalous_jobs += real.length;
  }

  // ---- provenance completeness, traceability, overconfidence
  const prov = { values: 0, with_root: 0, with_captured_source: 0, lineage_unknown: 0, findings: 0, findings_citing_existing_events: 0, findings_with_assessment: 0, contradictions: 0, contradictions_two_items_traceable: 0, contradictions_with_independence_and_link: 0 };
  const ids = new Set(records.map(r => r.event_id));
  for (const p of D.provenance.values()) {
    for (const it of p.items.filter(i => i.kind === 'recorded_value')) {
      prov.values++; prov.with_root += +!!it.root;
      prov.with_captured_source += +(it.parents.length > 0);
      prov.lineage_unknown += +(it.parents.length === 0);
    }
    for (const c of p.contradictions) {
      prov.contradictions++;
      prov.contradictions_two_items_traceable += +(c.items.length >= 2 && c.items.every(i => i.evidence_id && (ids.has(i.event_id))));
      prov.contradictions_with_independence_and_link += +(!!c.entity_match && (c.independence !== undefined));
    }
  }
  for (const c of D.cases) {
    const d = caseDetail(D, c.case_id);
    for (const f of d.findings) { prov.findings++; prov.findings_citing_existing_events += +(f.evidence_event_ids.length > 0 && f.evidence_event_ids.every(i => ids.has(i))); prov.findings_with_assessment += +!!f.assessment; }
  }

  // Overconfidence: a single-lineage value presented as corroborated, or an unattributable record used as a contradiction.
  const over = { undetectable_jobs: 0, flagged_anyway: 0, single_lineage_reported_as_corroborated: 0, single_lineage_fields: 0, needs_independent_source_stated: 0, ambiguous_or_unlinked_used_as_anomaly: 0 };
  for (const l of labels) {
    if (l.anomalous && l.expected_rules.length === 0) { over.undetectable_jobs++; over.flagged_anyway += +jD.get(l.job_no).flag; }
    for (const v of viewsOf(l.job_no)) {
      const p = D.provenance.get(v.correlation_id);
      if (!p) continue;
      for (const c of Object.values(p.corroboration)) {
        if (c.status === 'not_comparable' || c.independent_roots !== 1) continue;
        over.single_lineage_fields++;
        over.needs_independent_source_stated += +c.needs_independent_source;
        over.single_lineage_reported_as_corroborated += +(!c.needs_independent_source || !/copies|single entry/.test(c.statement));
      }
      over.ambiguous_or_unlinked_used_as_anomaly += p.contradictions.filter(c => (c.entity_match.ambiguous || c.entity_match.confidence < 0.5) && c.classification !== 'insufficient_evidence').length;
    }
  }
  // What a reader without provenance (variant A) would see for common-source falsification: records agreeing, no caveat.
  const cs = labels.filter(l => l.type === 'common_source_falsification').map(l => D.provenance.get(viewsOf(l.job_no).at(-1).correlation_id).corroboration.gross_weight);

  const neg = cls => rows.filter(r => r.class === cls);
  const result = {
    dataset: path.basename(dir), jobs: rows.length, integrity_ok: integrity.ok, events: integrity.count,
    class_counts: Object.fromEntries(['normal', 'hard_negative', 'data_quality', 'anomaly'].map(c => [c, neg(c).length])),
    detection: {
      A_rules: metrics(rows, r => r.rule_flag),
      C_rules_plus_provenance: metrics(rows, r => r.rule_flag),
      D_full: metrics(rows, r => r.full_flag),
      A_rules_on_rule_detectable_only: metrics(rows.filter(r => !r.anomalous || r.detectable_by_rules), r => r.rule_flag),
      D_full_on_detectable_only: metrics(rows.filter(r => !r.anomalous || r.detectable_by_full), r => r.full_flag),
      D_exact_rule_set_match_rate: ratio(rows.filter(r => r.exact_full).length, rows.length),
      hard_negative_fpr: { A: ratio(neg('hard_negative').filter(r => r.rule_flag).length, neg('hard_negative').length), D: ratio(neg('hard_negative').filter(r => r.full_flag).length, neg('hard_negative').length) }
    },
    review_burden: {
      cases_with_anomaly: { A: A.cases.filter(c => c.n_anomaly_findings).length, D: D.cases.filter(c => c.n_anomaly_findings).length },
      anomaly_findings: { A: A.findings.filter(f => f.kind === 'anomaly').length, D: D.findings.filter(f => f.kind === 'anomaly').length },
      notes_not_scored: { A: A.findings.filter(f => f.kind !== 'anomaly').length, D: D.findings.filter(f => f.kind !== 'anomaly').length },
      unresolved_rule_notes: D.findings.filter(f => f.details?.classification === 'unresolved_business_rule_conflict').length,
      insufficient_evidence_notes: D.findings.filter(f => f.details?.classification === 'insufficient_evidence').length
    },
    linkage: { ...link, linked_recall: ratio(link.correctly_linked, link.expected_linked) },
    conflict_identification: { ...conflict, field_recall: ratio(conflict.identified, conflict.expected_fields) },
    incident_ordering: { arrival_order_A: orderingAccuracy(A, 'sequence'), event_time_order_CD: orderingAccuracy(D, 'event_time') },
    provenance: { ...prov, root_assigned_rate: ratio(prov.with_root, prov.values), captured_source_rate: ratio(prov.with_captured_source, prov.values), findings_traceable_rate: ratio(prov.findings_citing_existing_events, prov.findings) },
    overconfidence: { ...over, common_source_cases: cs.map(c => ({ agreeing_records: c.agreeing_records, independent_roots: c.independent_roots, needs_independent_source: c.needs_independent_source })) },
    by_type: byType,
    unexpected: rows.filter(r => !r.exact_full).map(r => ({ job_no: r.job_no, type: r.type, fired: r.full_rules_fired, expected: r.expected_rules }))
  };

  const cols = Object.keys(rows.find(r => r.features).features);
  const csv = [[...cols, 'rule_flag', 'full_flag', 'rule_priority', 'LABEL_anomalous', 'LABEL_class', 'LABEL_type', 'LABEL_rule_detectable', 'job_no'].join(','),
    ...rows.filter(r => r.features).map(r => [...cols.map(c => r.features[c]), +r.rule_flag, +r.full_flag, r.priority, +r.anomalous, r.class, r.type, +r.detectable_by_rules, r.job_no].join(','))].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'features.csv'), csv);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = process.argv.slice(2).map(d => evaluateDataset(path.resolve(ROOT, d)));
  fs.mkdirSync(path.join(ROOT, 'evaluation', 'results'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'evaluation', 'results', 'framework.json'), JSON.stringify(results, null, 1));
  const f = v => (v === null || v === undefined ? 'n/a' : v.toFixed(3));
  const m = x => `P ${f(x.precision)} R ${f(x.recall)} F1 ${f(x.f1)} FPR ${f(x.false_positive_rate)}`;
  for (const r of results) {
    console.log(`\n${r.dataset}: ${r.jobs} jobs ${JSON.stringify(r.class_counts)} events ${r.events} integrity ${r.integrity_ok ? 'ok' : 'FAILED'}`);
    console.log(`  A rules               ${m(r.detection.A_rules)}`);
    console.log(`  D full                ${m(r.detection.D_full)}   exact rule-set match ${f(r.detection.D_exact_rule_set_match_rate)}  hard-neg FPR A ${f(r.detection.hard_negative_fpr.A)} D ${f(r.detection.hard_negative_fpr.D)}`);
    console.log(`  linkage               linked ${r.linkage.correctly_linked}/${r.linkage.expected_linked}, unlinked ${r.linkage.correctly_unlinked}/${r.linkage.expected_unlinked}, ambiguous ${r.linkage.correctly_ambiguous}/${r.linkage.expected_ambiguous}, wrongly attributed ${r.linkage.wrongly_attributed}`);
    console.log(`  conflicts             fields ${r.conflict_identification.identified}/${r.conflict_identification.expected_fields}, spurious on non-anomalous ${r.conflict_identification.spurious_contradictions_on_non_anomalous_jobs}`);
    console.log(`  ordering (ext. jobs)  arrival ${f(r.incident_ordering.arrival_order_A.jobs_with_external_records)}  event-time ${f(r.incident_ordering.event_time_order_CD.jobs_with_external_records)}  (${r.incident_ordering.event_time_order_CD.n_jobs_with_external_records} jobs)`);
    console.log(`  provenance            values ${r.provenance.values}, captured source ${f(r.provenance.captured_source_rate)}, findings traceable ${f(r.provenance.findings_traceable_rate)}`);
    console.log(`  overconfidence        undetectable flagged ${r.overconfidence.flagged_anyway}/${r.overconfidence.undetectable_jobs}, single-lineage shown as corroborated ${r.overconfidence.single_lineage_reported_as_corroborated}/${r.overconfidence.single_lineage_fields}, weak links used ${r.overconfidence.ambiguous_or_unlinked_used_as_anomaly}`);
    console.log(`  review burden         cases A ${r.review_burden.cases_with_anomaly.A} D ${r.review_burden.cases_with_anomaly.D}; anomaly findings A ${r.review_burden.anomaly_findings.A} D ${r.review_burden.anomaly_findings.D}; notes A ${r.review_burden.notes_not_scored.A} D ${r.review_burden.notes_not_scored.D}; unexpected ${r.unexpected.length}`);
  }
}
