// Per-seed and pooled tables from the result files of evaluate.js and ml_baseline.py.
//
//   node evaluation/summarize.js     -> evaluation/results/final_summary.json and final_summary.md
//
// Pooled detection = confusion counts summed over the held-out seeds, then the metrics.
// Isolation Forest: counts summed over held-out datasets per model seed, then mean (sd) over model seeds.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const load = f => JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8'));
const fw = load('framework.json');
const mlFiles = fs.readdirSync(RES).filter(f => /^ml_.*\.json$/.test(f));

const fromCounts = c => {
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null, recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
  return { ...c, precision, recall, f1: precision && recall ? 2 * precision * recall / (precision + recall) : (precision === null || recall === null ? null : 0), false_positive_rate: c.fp + c.tn ? c.fp / (c.fp + c.tn) : null };
};
const sum = list => list.reduce((a, m) => ({ tp: a.tp + m.tp, fp: a.fp + m.fp, fn: a.fn + m.fn, tn: a.tn + m.tn }), { tp: 0, fp: 0, fn: 0, tn: 0 });
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = xs => Math.sqrt(mean(xs.map(x => (x - mean(xs)) ** 2)));
const ratio = (a, b) => (b ? a / b : null);
// 95% Wilson score interval for k successes in n trials (jobs are the unit).
const wilson = (k, n, z = 1.96) => {
  if (!n) return null;
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
const withCi = m => ({ ...m, ci: { precision: wilson(m.tp, m.tp + m.fp), recall: wilson(m.tp, m.tp + m.fn), false_positive_rate: wilson(m.fp, m.fp + m.tn) } });

const held = fw.datasets.filter(d => d.class_counts.anomaly > 0);
const fitOnly = fw.datasets.filter(d => d.class_counts.anomaly === 0);
const V = Object.keys(fw.variants);

const out = { run: fw.run, variants: fw.variants, held_out: held.map(d => d.dataset), per_seed: {}, pooled: {}, seed_spread: {}, fit_set_false_positive_rate: {}, by_category: {}, by_type: {}, missed_by_type: {}, false_alarms: {}, investigation: {}, ml: {} };

for (const k of V) {
  out.per_seed[k] = held.map(d => ({ dataset: d.dataset, ...d.detection[k] }));
  out.pooled[k] = withCi(fromCounts(sum(held.map(d => d.detection[k]))));
  out.seed_spread[k] = Object.fromEntries(['precision', 'recall', 'f1', 'false_positive_rate'].map(m => [m, { mean: mean(held.map(d => d.detection[k][m] ?? 0)), sd: sd(held.map(d => d.detection[k][m] ?? 0)) }]));
  out.fit_set_false_positive_rate[k] = fitOnly.map(d => ({ dataset: d.dataset, ...d.detection[k] }));
  out.false_alarms[k] = held.flatMap(d => d.errors[k].false_alarms.map(x => ({ dataset: d.dataset, ...x })));
  out.missed_by_type[k] = {};
  for (const d of held) for (const [t, n] of Object.entries(d.errors[k].missed)) out.missed_by_type[k][t] = (out.missed_by_type[k][t] || 0) + n;
}
out.pooled.D_on_detectable_only = fromCounts(sum(held.map(d => d.detection.D_on_detectable_only)));
out.pooled.A_on_rule_detectable_only = fromCounts(sum(held.map(d => d.detection.A_on_rule_detectable_only)));
for (const d of held) {
  for (const [c, x] of Object.entries(d.by_category)) {
    const o = out.by_category[c] || (out.by_category[c] = { n: 0, flagged: Object.fromEntries(V.map(k => [k, 0])) });
    o.n += x.n; for (const k of V) o.flagged[k] += x.flagged[k];
  }
  for (const [t, x] of Object.entries(d.by_type)) {
    const o = out.by_type[t] || (out.by_type[t] = { class: x.class, category: x.category, n: 0, exact_D: 0, flagged: Object.fromEntries(V.map(k => [k, 0])) });
    o.n += x.n; o.exact_D += x.exact_D; for (const k of V) o.flagged[k] += x.flagged[k];
  }
}

// Investigation quality, pooled over held-out seeds.
for (const k of ['C', 'X', 'D']) {
  const I = held.map(d => d.investigation[k]);
  const s = f => I.reduce((a, i) => a + f(i), 0);
  out.investigation[k] = {
    linkage: { correctly_linked: s(i => i.linkage.correctly_linked), expected_linked: s(i => i.linkage.expected_linked), correctly_unlinked: s(i => i.linkage.correctly_unlinked), expected_unlinked: s(i => i.linkage.expected_unlinked), correctly_ambiguous: s(i => i.linkage.correctly_ambiguous), expected_ambiguous: s(i => i.linkage.expected_ambiguous), wrongly_attributed: s(i => i.linkage.wrongly_attributed) },
    conflicts: { identified: s(i => i.conflict_identification.identified), expected: s(i => i.conflict_identification.expected_fields), jobs_fully: s(i => i.conflict_identification.jobs_fully_identified), jobs: s(i => i.conflict_identification.jobs_expected), spurious_on_non_anomalous: s(i => i.conflict_identification.spurious_contradictions_on_non_anomalous_jobs) },
    lineage_expectations: { met: s(i => i.lineage_expectations.met), expected: s(i => i.lineage_expectations.expected), failures: [...new Set(I.flatMap(i => i.lineage_expectations.failures))] },
    provenance: { values: s(i => i.provenance.values), with_root: s(i => i.provenance.with_root), with_captured_source: s(i => i.provenance.with_captured_source), findings: s(i => i.provenance.findings), findings_traceable: s(i => i.provenance.findings_citing_existing_events), findings_with_assessment: s(i => i.provenance.findings_with_assessment), contradictions: s(i => i.provenance.contradictions), contradictions_traceable: s(i => i.provenance.contradictions_two_items_traceable) },
    restraint: { single_lineage_fields: s(i => i.restraint.single_lineage_fields), independent_source_stated: s(i => i.restraint.needs_independent_source_stated), single_lineage_reported_as_corroborated: s(i => i.restraint.single_lineage_reported_as_corroborated), multi_record_agreement_fields: s(i => i.restraint.multi_record_agreement_fields), multi_record_agreement_counted_as_independent: s(i => i.restraint.multi_record_agreement_counted_as_independent), weak_links_used_as_anomaly: s(i => i.restraint.ambiguous_or_unlinked_used_as_anomaly), undetectable_jobs: s(i => i.restraint.undetectable_jobs), undetectable_flagged: s(i => i.restraint.flagged_anyway), common_source_cases: I.flatMap(i => i.restraint.common_source_cases) },
    ordering_jobs_with_external_records: I.map(i => i.incident_ordering.jobs_with_external_records)
  };
}
out.ordering_arrival_A = held.map(d => d.incident_ordering_arrival_A.jobs_with_external_records);

for (const f of mlFiles) {
  const m = load(f);
  const tests = m.tests.filter(t => held.some(d => d.dataset === t.dataset));
  const pooledPerModelSeed = key => m.model_seeds.map((_, i) => fromCounts(sum(tests.map(t => t[key].per_seed[i]))));
  const agg = runs => Object.fromEntries(['precision', 'recall', 'f1', 'false_positive_rate'].map(x => [x, { mean: mean(runs.map(r => r[x] ?? 0)), sd: sd(runs.map(r => r[x] ?? 0)) }]));
  out.ml[f.replace('.json', '')] = {
    protocol: m.protocol, quantile: m.quantile, fit: m.train.dataset, tested_on: tests.map(t => t.dataset), environment: m.environment ?? null, model_seeds: m.model_seeds,
    ml_only: agg(pooledPerModelSeed('ml_only')), rules_or_ml: agg(pooledPerModelSeed('hybrid_rules_or_ml')), full_or_ml: agg(pooledPerModelSeed('full_or_ml')),
    rules_only_same_rows: fromCounts(sum(tests.map(t => t.rules_only))), full_same_rows: fromCounts(sum(tests.map(t => t.full_framework)))
  };
}

// Each rule alone, pooled: how many labelled anomalies and negatives it fired on.
out.per_rule = {};
for (const d of held) for (const [id, x] of Object.entries(d.per_rule || {})) {
  const o = out.per_rule[id] || (out.per_rule[id] = { on_anomaly: 0, on_negative: 0 });
  o.on_anomaly += x.on_anomaly; o.on_negative += x.on_negative;
}
for (const o of Object.values(out.per_rule)) o.precision = ratio(o.on_anomaly, o.on_anomaly + o.on_negative);

// Further sets scored with the same code: pooled detection and per-family flag counts.
const EXTRA = {
  previous_heldout: ['dev_heldout.json', 'Seeds 4-6: the held-out sets of the previous round. Their results were read in detail during development (no rule or threshold was changed afterwards), so they are no longer untouched; re-scored here with the current code.'],
  unseen: ['unseen.json', 'Scenario families written after the rules were fixed and committed before generation (synthetic/unseen_scenarios.js); never used for tuning. Same author as the rules: less template leakage, not less author bias. Clean jobs are included as the normal base rate.']
};
for (const [key, [file, note]] of Object.entries(EXTRA)) {
  if (!fs.existsSync(path.join(RES, file))) continue;
  const x = load(file), ds = x.datasets.filter(d => d.class_counts.anomaly > 0);
  const by_type = {};
  for (const d of ds) for (const [t, y] of Object.entries(d.by_type)) {
    const o = by_type[t] || (by_type[t] = { class: y.class, n: 0, flagged: Object.fromEntries(V.map(k => [k, 0])) });
    o.n += y.n; for (const k of V) o.flagged[k] += y.flagged[k];
  }
  out[key] = { note, run: x.run, datasets: ds.map(d => d.dataset), pooled: Object.fromEntries(V.map(k => [k, withCi(fromCounts(sum(ds.map(d => d.detection[k]))))])), by_type };
}

fs.writeFileSync(path.join(RES, 'final_summary.json'), JSON.stringify(out, null, 1));

// ---- markdown
const f3 = v => (v === null || v === undefined ? 'n/a' : v.toFixed(3));
const pct = (a, b) => (b ? `${a}/${b} (${(100 * a / b).toFixed(1)}%)` : `${a}/0 (n/a)`);
const md = [];
md.push(`Code ${fw.run.code_commit}${fw.run.uncommitted_changes ? ' (with uncommitted changes)' : ''}; Node ${fw.run.node}; evaluated ${fw.run.evaluated_at}.`, '');
const iv = x => (x ? ` [${f3(x[0])}, ${f3(x[1])}]` : '');
md.push(`### Detection, pooled over held-out seeds (${held.map(d => d.dataset).join(', ')}); brackets: 95% Wilson interval`, '', '| Variant | TP | FP | FN | TN | Precision | Recall | F1 | FPR |', '|---|---|---|---|---|---|---|---|---|');
for (const k of V) { const p = out.pooled[k]; md.push(`| ${k} ${fw.variants[k]} | ${p.tp} | ${p.fp} | ${p.fn} | ${p.tn} | ${f3(p.precision)}${iv(p.ci.precision)} | ${f3(p.recall)}${iv(p.ci.recall)} | ${f3(p.f1)} | ${f3(p.false_positive_rate)}${iv(p.ci.false_positive_rate)} |`); }
for (const [name, m] of Object.entries(out.ml)) {
  for (const [label, key] of [['B Isolation Forest only', 'ml_only'], ['A + Isolation Forest', 'rules_or_ml'], ['D + Isolation Forest', 'full_or_ml']]) {
    const x = m[key]; md.push(`| ${label} (${name}, ${m.tested_on.join('+')}) | | | | | ${f3(x.precision.mean)} ±${f3(x.precision.sd)} | ${f3(x.recall.mean)} ±${f3(x.recall.sd)} | ${f3(x.f1.mean)} ±${f3(x.f1.sd)} | ${f3(x.false_positive_rate.mean)} ±${f3(x.false_positive_rate.sd)} |`);
  }
}
md.push('', '### Detection per seed', '', '| Variant | ' + held.map(d => d.dataset).join(' | ') + ' |', '|---|' + held.map(() => '---|').join(''));
for (const k of V) md.push(`| ${k} | ` + out.per_seed[k].map(s => `P ${f3(s.precision)} R ${f3(s.recall)} F1 ${f3(s.f1)} FPR ${f3(s.false_positive_rate)}`).join(' | ') + ' |');
md.push('', '### Recall (anomaly categories) and false-positive rate (negative classes) by category, pooled', '', '| Category | n | ' + V.join(' | ') + ' |', '|---|---|' + V.map(() => '---|').join(''));
for (const [c, x] of Object.entries(out.by_category).sort()) md.push(`| ${c} | ${x.n} | ` + V.map(k => f3(x.flagged[k] / x.n)).join(' | ') + ' |');
md.push('', '### Investigation quality, pooled', '', '| Measure | C | X | D |', '|---|---|---|---|');
const row = (label, fn) => md.push(`| ${label} | ` + ['C', 'X', 'D'].map(k => fn(out.investigation[k])).join(' | ') + ' |');
row('Conflicting field identified', i => pct(i.conflicts.identified, i.conflicts.expected));
row('Contradictions on non-anomalous jobs', i => String(i.conflicts.spurious_on_non_anomalous));
row('Lineage expectations met', i => pct(i.lineage_expectations.met, i.lineage_expectations.expected));
row('Agreement of copies counted as independent', i => pct(i.restraint.multi_record_agreement_counted_as_independent, i.restraint.multi_record_agreement_fields));
row('Single-lineage fields stated as needing an independent source', i => pct(i.restraint.independent_source_stated, i.restraint.single_lineage_fields));
row('External records linked to the right job', i => pct(i.linkage.correctly_linked, i.linkage.expected_linked));
row('Unattributable records left unlinked', i => pct(i.linkage.correctly_unlinked, i.linkage.expected_unlinked));
row('Ambiguous references marked ambiguous', i => pct(i.linkage.correctly_ambiguous, i.linkage.expected_ambiguous));
row('Records attributed to a wrong job', i => String(i.linkage.wrongly_attributed));
row('Weak links used as anomaly evidence', i => String(i.restraint.weak_links_used_as_anomaly));
row('Findings citing existing events', i => pct(i.provenance.findings_traceable, i.provenance.findings));
row('Contradictions with both records traceable', i => pct(i.provenance.contradictions_traceable, i.provenance.contradictions));
row('Recorded values with a captured source', i => pct(i.provenance.with_captured_source, i.provenance.values));
row('Timeline order correct (jobs with external records)', i => i.ordering_jobs_with_external_records.map(f3).join(' / '));
md.push(`| Same, arrival order (variant A) | ${out.ordering_arrival_A.map(f3).join(' / ')} | | |`);
md.push('', '### Missed anomalies by scenario type (pooled)', '', '| Type | n | ' + V.join(' | ') + ' |', '|---|---|' + V.map(() => '---|').join(''));
for (const [t, x] of Object.entries(out.by_type).filter(([, x]) => x.class === 'anomaly').sort()) md.push(`| ${t} | ${x.n} | ` + V.map(k => String(out.missed_by_type[k][t] || 0)).join(' | ') + ' |');
md.push('', '### False alarms (negative jobs flagged), pooled', '');
for (const k of V) md.push(`- ${k}: ${out.false_alarms[k].length}${out.false_alarms[k].length ? ' — ' + out.false_alarms[k].map(x => `${x.dataset}/${x.type} [${x.fired.join(',')}]`).join('; ') : ''}`);
md.push('', '### Hard-negative and fit-set false-positive rate', '');
for (const k of V) md.push(`- ${k}: hard-negative FPR per seed ${held.map(d => f3(d.hard_negative_fpr[k])).join(' / ')}; fit set ${out.fit_set_false_positive_rate[k].map(x => `${x.dataset} FPR ${f3(x.false_positive_rate)}`).join(', ') || 'none'}`);
md.push('', '### Each rule alone (full framework, pooled): labelled jobs it fired on', '', '| Rule | on anomalies | on negatives | precision |', '|---|---|---|---|');
for (const [id, o] of Object.entries(out.per_rule).sort()) md.push(`| ${id} | ${o.on_anomaly} | ${o.on_negative} | ${f3(o.precision)} |`);
for (const key of Object.keys(EXTRA)) {
  const x = out[key];
  if (!x) continue;
  md.push('', `### ${key === 'unseen' ? 'Unseen scenario families' : 'Previous held-out seeds, re-scored'} (${x.datasets.join(', ')}; code ${x.run.code_commit?.slice(0, 7)})`, '', x.note, '', '| Variant | TP | FP | FN | TN | Precision | Recall | FPR |', '|---|---|---|---|---|---|---|---|');
  for (const k of V) { const p = x.pooled[k]; md.push(`| ${k} | ${p.tp} | ${p.fp} | ${p.fn} | ${p.tn} | ${f3(p.precision)}${iv(p.ci.precision)} | ${f3(p.recall)}${iv(p.ci.recall)} | ${f3(p.false_positive_rate)}${iv(p.ci.false_positive_rate)} |`); }
  if (key === 'unseen') {
    md.push('', '| Family | class | n | ' + V.map(k => k + ' flagged').join(' | ') + ' |', '|---|---|---|' + V.map(() => '---|').join(''));
    for (const [t, y] of Object.entries(x.by_type).sort((a, b) => a[1].class.localeCompare(b[1].class) || a[0].localeCompare(b[0]))) md.push(`| ${t} | ${y.class} | ${y.n} | ` + V.map(k => y.flagged[k]).join(' | ') + ' |');
  }
}
fs.writeFileSync(path.join(RES, 'final_summary.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
