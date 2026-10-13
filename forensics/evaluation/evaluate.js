// Scores the rule-based detector against ground truth and exports the
// feature table used by the machine-learning baseline.
//
//   node evaluation/evaluate.js datasets/seed-1 datasets/seed-2 datasets/seed-3
//
// Unit of analysis: one job lifecycle. Positive class: label.class === 'anomaly'.
// A job is predicted positive when the rules raise at least one finding of kind
// 'anomaly' on it. Writes <dataset>/features.csv and evaluation/results/rules.json.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventStore } from '../src/store.js';
import { analyze, features } from '../src/cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function metrics(rows, predicted) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    const p = predicted(r);
    if (r.anomalous && p) tp++; else if (!r.anomalous && p) fp++; else if (r.anomalous) fn++; else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null, recall = tp + fn ? tp / (tp + fn) : null;
  return { tp, fp, fn, tn, precision, recall, f1: precision && recall ? 2 * precision * recall / (precision + recall) : (precision === null || recall === null ? null : 0), false_positive_rate: fp + tn ? fp / (fp + tn) : null };
}

export function evaluateDataset(dir) {
  const labels = JSON.parse(fs.readFileSync(path.join(dir, 'labels.json'), 'utf8'));
  const store = new EventStore(path.join(dir, 'evidence'));
  const integrity = store.verify();
  const analysis = analyze(store.readAll().records.map(x => x.record));
  const rows = labels.map(l => {
    const view = [...analysis.views.values()].find(v => v.job_nos.has(l.job_no));
    const c = analysis.cases.find(x => x.job_nos_seen.includes(l.job_no));
    const anomalyRules = [...new Set((c?.findings || []).filter(f => f.kind === 'anomaly').map(f => f.rule_id))].sort();
    return {
      ...l, features: view ? features(view) : null,
      rule_flag: anomalyRules.length > 0, rules_fired: anomalyRules, priority: c?.priority.value ?? 0,
      expected_rules_hit: l.expected_rules.every(r => (c?.findings || []).some(f => f.rule_id === r)),
      notes: (c?.findings || []).filter(f => f.kind !== 'anomaly').map(f => f.rule_id)
    };
  });
  const byType = {};
  for (const r of rows) {
    const t = byType[r.type] || (byType[r.type] = { class: r.class, n: 0, flagged: 0, expected_rules_hit: 0 });
    t.n++; t.flagged += r.rule_flag ? 1 : 0; t.expected_rules_hit += r.expected_rules_hit ? 1 : 0;
  }
  const neg = cls => rows.filter(r => r.class === cls);
  const result = {
    dataset: path.basename(dir), jobs: rows.length, integrity_ok: integrity.ok, events: integrity.count,
    class_counts: Object.fromEntries(['normal', 'hard_negative', 'data_quality', 'anomaly'].map(c => [c, neg(c).length])),
    rules_any_anomaly_finding: metrics(rows, r => r.rule_flag),
    rules_priority_medium_or_higher: metrics(rows, r => r.priority >= 30),
    rules_on_rule_detectable_anomalies_only: metrics(rows.filter(r => !r.anomalous || r.expected_rules.length > 0), r => r.rule_flag),
    hard_negative_false_positive_rate: neg('hard_negative').length ? neg('hard_negative').filter(r => r.rule_flag).length / neg('hard_negative').length : null,
    data_quality_cases_flagged_as_anomaly: neg('data_quality').filter(r => r.rule_flag).length,
    by_type: byType,
    unexpected: rows.filter(r => (r.anomalous && r.expected_rules.length && !r.expected_rules_hit) || (!r.anomalous && r.rule_flag)).map(r => ({ job_no: r.job_no, type: r.type, rules_fired: r.rules_fired, expected: r.expected_rules }))
  };
  // Feature table. Label columns come last and are named so no model code can pick them up by accident.
  const cols = Object.keys(rows.find(r => r.features).features);
  const csv = [[...cols, 'rule_flag', 'rule_priority', 'LABEL_anomalous', 'LABEL_class', 'LABEL_type', 'LABEL_rule_detectable', 'job_no'].join(','),
    ...rows.filter(r => r.features).map(r => [...cols.map(c => r.features[c]), +r.rule_flag, r.priority, +r.anomalous, r.class, r.type, +(r.expected_rules.length > 0), r.job_no].join(','))].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'features.csv'), csv);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2).map(d => path.resolve(ROOT, d));
  const results = dirs.map(evaluateDataset);
  fs.mkdirSync(path.join(ROOT, 'evaluation', 'results'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'evaluation', 'results', 'rules.json'), JSON.stringify(results, null, 1));
  const f = v => v === null ? 'n/a' : v.toFixed(3);
  for (const r of results) {
    const m = r.rules_any_anomaly_finding;
    console.log(`${r.dataset}: jobs ${r.jobs} ${JSON.stringify(r.class_counts)} integrity ${r.integrity_ok ? 'ok' : 'FAILED'} | rules: P ${f(m.precision)} R ${f(m.recall)} F1 ${f(m.f1)} FPR ${f(m.false_positive_rate)} | hard-negative FPR ${f(r.hard_negative_false_positive_rate)} | unexpected ${r.unexpected.length}`);
  }
}
