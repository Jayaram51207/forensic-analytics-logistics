// Scores the framework against ground truth, with ablations, and exports the
// feature table used by the machine-learning baseline.
//
//   node evaluation/evaluate.js datasets/seed-1 datasets/seed-2 datasets/seed-3 [--out results/framework.json]
//
// Unit of analysis: one job (labels.json has one entry per job number).
// Positive class: label.class === 'anomaly'. Predicted positive: at least one
// finding of kind 'anomaly' on any lifecycle of that job number.
// Labels are read only to score; analyze() never sees them.
//
// Variants (ablation of the research contribution):
//   A  rules only                                         analyze({ provenance: false })
//   C  rules + provenance tracking, no contradictions     analyze({ contradictions: false })
//   X  rules + contradictions, provenance lineage off     analyze({ provenance_config: { lineage: false } })
//   D  full: rules + provenance + contradiction analysis  analyze({})
//   (Isolation Forest alone and combined with A or D: ml_baseline.py, from features.csv)
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { EventStore } from '../src/store.js';
import { analyze, caseDetail, features } from '../src/cases.js';
import { reconstruct } from '../src/model.js';
import { RULES } from '../src/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const VARIANTS = {
  A: { name: 'rules only', config: { provenance: false } },
  C: { name: 'rules + provenance tracking', config: { contradictions: false } },
  X: { name: 'rules + contradiction analysis without lineage', config: { provenance_config: { lineage: false } } },
  D: { name: 'full framework', config: {} }
};

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
const FAMILY = Object.fromEntries(RULES.map(r => [r.id, r.family]));

/** Category of a labelled job, from its label only (never from what fired). */
export function categoryOf(l) {
  if (l.class !== 'anomaly') return l.class;
  if (!l.expected_rules.length) return 'needs_independent_source';
  if (l.expected_rules.some(r => r.startsWith('XAP-'))) return 'cross_application';
  return FAMILY[l.expected_rules[0]] || 'other';
}

function perJob(analysis, labels) {
  return new Map(labels.map(l => {
    const cases = analysis.cases.filter(c => c.job_nos_seen.includes(l.job_no));
    const fs_ = cases.flatMap(c => c.findings);
    return [l.job_no, { findings: fs_, anomaly_rules: [...new Set(fs_.filter(f => f.kind === 'anomaly').map(f => f.rule_id))].sort(), flag: fs_.some(f => f.kind === 'anomaly'), priority: Math.max(0, ...cases.map(c => c.priority.value)) }];
  }));
}

/** Fraction of adjacent timeline pairs in true chronological order (truth: the simulated event time). */
function orderingAccuracy(analysis, order) {
  let ok = 0, total = 0, jobsWithExternal = 0, okExt = 0, totalExt = 0;
  for (const view of analysis.views.values()) {
    if (!view.state) continue;
    const tl = reconstruct(view, analysis.context, { order }).timeline;
    const hasExt = tl.some(t => t.application !== 'workflow_sync');
    if (hasExt) jobsWithExternal++;
    for (let i = 1; i < tl.length; i++) {
      const good = Date.parse(tl[i - 1].event_time) <= Date.parse(tl[i].event_time);
      total++; ok += good ? 1 : 0;
      if (hasExt) { totalExt++; okExt += good ? 1 : 0; }
    }
  }
  return { all_jobs: ratio(ok, total), jobs_with_external_records: ratio(okExt, totalExt), n_jobs_with_external_records: jobsWithExternal };
}

/** What a variant tells an investigator beyond the yes/no flag. Needs provenance (not variant A). */
function investigation(an, labels, records, jobs) {
  // With contradictions switched off they are computed internally but never shown (caseDetail hides them).
  const shown = p => (an.config.contradictions === false ? [] : p.contradictions);
  const viewsOf = job => [...an.views.values()].filter(v => v.job_nos.has(job));
  const ids = new Set(records.map(r => r.event_id));

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

  // Conflicting evidence: the right field. Lineage: the label's expected number of independent
  // roots, "needs an independent source", and expected classification (scenario params).
  const conflict = { expected_fields: 0, identified: 0, jobs_expected: 0, jobs_fully_identified: 0, spurious_contradictions_on_non_anomalous_jobs: 0 };
  const lineage = { expected: 0, met: 0, failures: [] };
  const expectLineage = (ok, what) => { lineage.expected++; lineage.met += +ok; if (!ok) lineage.failures.push(what); };
  for (const l of labels) {
    const prov = viewsOf(l.job_no).map(v => an.provenance.get(v.correlation_id)).filter(Boolean);
    const all = prov.flatMap(shown);
    const real = all.filter(c => !['insufficient_evidence', 'unresolved_business_rule_conflict'].includes(c.classification));
    const want = l.params.conflict_fields || [];
    if (want.length) {
      conflict.jobs_expected++;
      const hit = want.filter(f => real.some(c => c.field === f));
      conflict.expected_fields += want.length; conflict.identified += hit.length;
      conflict.jobs_fully_identified += +(hit.length === want.length);
    } else if (!l.anomalous) conflict.spurious_contradictions_on_non_anomalous_jobs += real.length;
    const last = prov.at(-1);
    for (const [field, n] of Object.entries(l.params.expect_roots || {})) expectLineage(last?.corroboration[field]?.independent_roots === n, `${l.type}: ${field} roots`);
    if (l.params.expect_needs_authority) expectLineage(last?.corroboration.gross_weight?.needs_independent_source === true, `${l.type}: needs independent source`);
    if (l.params.expect_classification) expectLineage(all.some(c => c.classification === l.params.expect_classification), `${l.type}: ${l.params.expect_classification}`);
  }
  lineage.failures = [...new Set(lineage.failures)];

  const prov = { values: 0, with_root: 0, with_captured_source: 0, findings: 0, findings_citing_existing_events: 0, findings_with_assessment: 0, contradictions: 0, contradictions_two_items_traceable: 0 };
  for (const p of an.provenance.values()) {
    for (const it of p.items.filter(i => i.kind === 'recorded_value')) {
      prov.values++; prov.with_root += +!!it.root; prov.with_captured_source += +(it.parents.length > 0);
    }
    for (const c of shown(p)) {
      prov.contradictions++;
      prov.contradictions_two_items_traceable += +(c.items.length >= 2 && c.items.every(i => i.evidence_id && ids.has(i.event_id)));
    }
  }
  for (const c of an.cases) {
    for (const f of caseDetail(an, c.case_id).findings) {
      prov.findings++;
      prov.findings_citing_existing_events += +(f.evidence_event_ids.length > 0 && f.evidence_event_ids.every(i => ids.has(i)));
      prov.findings_with_assessment += +!!f.assessment;
    }
  }

  // Restraint: copies of one statement presented as independent agreement; weak links used as evidence.
  const over = { undetectable_jobs: 0, flagged_anyway: 0, single_lineage_fields: 0, needs_independent_source_stated: 0, single_lineage_reported_as_corroborated: 0, ambiguous_or_unlinked_used_as_anomaly: 0, multi_record_agreement_fields: 0, multi_record_agreement_counted_as_independent: 0 };
  for (const l of labels) {
    if (l.anomalous && l.expected_rules.length === 0 && !l.params.detection_gap) { over.undetectable_jobs++; over.flagged_anyway += +jobs.get(l.job_no).flag; }
    for (const v of viewsOf(l.job_no)) {
      const p = an.provenance.get(v.correlation_id);
      if (!p) continue;
      for (const c of Object.values(p.corroboration)) {
        if (c.status === 'not_comparable') continue;
        if (c.agreeing_records > 1) { over.multi_record_agreement_fields++; over.multi_record_agreement_counted_as_independent += +(c.independent_roots === c.agreeing_records); }
        if (c.independent_roots !== 1) continue;
        over.single_lineage_fields++;
        over.needs_independent_source_stated += +c.needs_independent_source;
        over.single_lineage_reported_as_corroborated += +(!c.needs_independent_source || !/copies|single entry/.test(c.statement));
      }
      over.ambiguous_or_unlinked_used_as_anomaly += shown(p).filter(c => (c.entity_match.ambiguous || c.entity_match.confidence < 0.5) && c.classification !== 'insufficient_evidence').length;
    }
  }
  // Consistent falsification from a common source: does the output say the agreement is one source?
  const commonSource = labels.filter(l => ['common_source_falsification', 'consistent_falsification'].includes(l.type)).map(l => {
    const p = an.provenance.get(viewsOf(l.job_no).at(-1)?.correlation_id);
    const c = p?.corroboration.gross_weight;
    return { type: l.type, agreeing_records: c?.agreeing_records ?? null, independent_roots: c?.independent_roots ?? null, needs_independent_source: c?.needs_independent_source ?? null, flagged_as_anomaly: jobs.get(l.job_no).flag };
  });

  return {
    linkage: { ...link, linked_recall: ratio(link.correctly_linked, link.expected_linked) },
    conflict_identification: { ...conflict, field_recall: ratio(conflict.identified, conflict.expected_fields) },
    lineage_expectations: { ...lineage, rate: ratio(lineage.met, lineage.expected) },
    provenance: { ...prov, root_assigned_rate: ratio(prov.with_root, prov.values), captured_source_rate: ratio(prov.with_captured_source, prov.values), findings_traceable_rate: ratio(prov.findings_citing_existing_events, prov.findings), contradictions_traceable_rate: ratio(prov.contradictions_two_items_traceable, prov.contradictions) },
    restraint: { ...over, independent_source_stated_rate: ratio(over.needs_independent_source_stated, over.single_lineage_fields), common_source_cases: commonSource },
    incident_ordering: orderingAccuracy(an, 'event_time')
  };
}

export function evaluateDataset(dir) {
  const labels = JSON.parse(fs.readFileSync(path.join(dir, 'labels.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const store = new EventStore(path.join(dir, 'evidence'), { remote: null, anchorFile: null });
  const integrity = store.verify();
  const records = store.readAll().records.map(x => x.record);
  const an = {}, jobs = {};
  for (const [k, v] of Object.entries(VARIANTS)) { an[k] = analyze(records, { ...v.config, integrity }); jobs[k] = perJob(an[k], labels); }
  const viewsOf = job => [...an.D.views.values()].filter(v => v.job_nos.has(job));

  const rows = labels.map(l => {
    const view = viewsOf(l.job_no).at(-1);
    const expectedA = l.params.rules_alone_expected ?? l.expected_rules.filter(r => !r.startsWith('XAP-'));
    const d = jobs.D.get(l.job_no);
    return {
      job_no: l.job_no, type: l.type, class: l.class, anomalous: l.anomalous, category: categoryOf(l), expected_rules: l.expected_rules,
      features: view ? features(view) : null, priority: jobs.A.get(l.job_no).priority,
      flags: Object.fromEntries(Object.keys(VARIANTS).map(k => [k, jobs[k].get(l.job_no).flag])),
      fired: Object.fromEntries(Object.keys(VARIANTS).map(k => [k, jobs[k].get(l.job_no).anomaly_rules])),
      detectable_by_rules: expectedA.length > 0, detectable_by_full: l.expected_rules.length > 0,
      exact_full: l.class === 'anomaly' ? JSON.stringify(d.anomaly_rules) === JSON.stringify([...l.expected_rules].sort()) : d.anomaly_rules.length === 0
    };
  });

  const detection = {};
  for (const k of Object.keys(VARIANTS)) detection[k] = metrics(rows, r => r.flags[k]);
  detection.A_on_rule_detectable_only = metrics(rows.filter(r => !r.anomalous || r.detectable_by_rules), r => r.flags.A);
  detection.D_on_detectable_only = metrics(rows.filter(r => !r.anomalous || r.detectable_by_full), r => r.flags.D);
  detection.D_exact_rule_set_match_rate = ratio(rows.filter(r => r.exact_full).length, rows.length);

  const by_type = {}, by_category = {};
  for (const r of rows) {
    const t = by_type[r.type] || (by_type[r.type] = { class: r.class, category: r.category, n: 0, flagged: Object.fromEntries(Object.keys(VARIANTS).map(k => [k, 0])), exact_D: 0 });
    t.n++; t.exact_D += +r.exact_full;
    for (const k of Object.keys(VARIANTS)) t.flagged[k] += +r.flags[k];
    const c = by_category[r.category] || (by_category[r.category] = { n: 0, flagged: Object.fromEntries(Object.keys(VARIANTS).map(k => [k, 0])) });
    c.n++;
    for (const k of Object.keys(VARIANTS)) c.flagged[k] += +r.flags[k];
  }

  const errors = Object.fromEntries(Object.keys(VARIANTS).map(k => [k, {
    missed: rows.filter(r => r.anomalous && !r.flags[k]).map(r => r.type).reduce((m, t) => ({ ...m, [t]: (m[t] || 0) + 1 }), {}),
    false_alarms: rows.filter(r => !r.anomalous && r.flags[k]).map(r => ({ job_no: r.job_no, type: r.type, fired: r.fired[k] }))
  }]));

  // Each rule on its own (full framework D): labelled jobs it fired on. A job can fire several rules.
  const per_rule = {};
  for (const r of rows) for (const id of r.fired.D) { const x = per_rule[id] || (per_rule[id] = { on_anomaly: 0, on_negative: 0 }); r.anomalous ? x.on_anomaly++ : x.on_negative++; }

  const result = {
    dataset: path.basename(dir), seed: manifest.seed, dataset_generated_at: manifest.generated_at, dataset_code_commit: manifest.code_commit ?? null,
    generation_errors: manifest.errors?.length ?? null,
    jobs: rows.length, integrity_ok: integrity.ok, events: integrity.count,
    class_counts: Object.fromEntries(['normal', 'hard_negative', 'data_quality', 'anomaly'].map(c => [c, rows.filter(r => r.class === c).length])),
    detection, by_category, by_type, errors, per_rule,
    hard_negative_fpr: Object.fromEntries(Object.keys(VARIANTS).map(k => [k, ratio(rows.filter(r => r.class === 'hard_negative' && r.flags[k]).length, rows.filter(r => r.class === 'hard_negative').length)])),
    review_burden: Object.fromEntries(Object.keys(VARIANTS).map(k => [k, { cases_with_anomaly: an[k].cases.filter(c => c.n_anomaly_findings).length, anomaly_findings: an[k].findings.filter(f => f.kind === 'anomaly').length, notes: an[k].findings.filter(f => f.kind !== 'anomaly').length }])),
    incident_ordering_arrival_A: orderingAccuracy(an.A, 'sequence'),
    investigation: Object.fromEntries(['C', 'X', 'D'].map(k => [k, investigation(an[k], labels, records, jobs[k])])),
    unexpected_D: rows.filter(r => !r.exact_full).map(r => ({ job_no: r.job_no, type: r.type, fired: r.fired.D, expected: r.expected_rules }))
  };

  const cols = Object.keys(rows.find(r => r.features).features);
  const csv = [[...cols, 'rule_flag', 'full_flag', 'rule_priority', 'LABEL_anomalous', 'LABEL_class', 'LABEL_type', 'LABEL_rule_detectable', 'job_no'].join(','),
    ...rows.filter(r => r.features).map(r => [...cols.map(c => r.features[c]), +r.flags.A, +r.flags.D, r.priority, +r.anomalous, r.class, r.type, +r.detectable_by_rules, r.job_no].join(','))].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'features.csv'), csv);
  return result;
}

export function runInfo() {
  const git = cmd => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } };
  return { code_commit: git('git rev-parse HEAD'), uncommitted_changes: git('git status --porcelain -- . ":!datasets" ":!evaluation/results"') || '', node: process.version, evaluated_at: new Date().toISOString() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const out = path.resolve(ROOT, 'evaluation', oi >= 0 ? args[oi + 1] : 'results/framework.json');
  const dirs = args.filter((a, i) => oi < 0 || (i !== oi && i !== oi + 1));
  const results = dirs.map(d => evaluateDataset(path.resolve(ROOT, d)));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ run: runInfo(), variants: Object.fromEntries(Object.entries(VARIANTS).map(([k, v]) => [k, v.name])), datasets: results }, null, 1));
  const f = v => (v === null || v === undefined ? 'n/a' : v.toFixed(3));
  const m = x => `P ${f(x.precision)} R ${f(x.recall)} F1 ${f(x.f1)} FPR ${f(x.false_positive_rate)}`;
  for (const r of results) {
    console.log(`\n${r.dataset}: ${r.jobs} jobs ${JSON.stringify(r.class_counts)} events ${r.events} integrity ${r.integrity_ok ? 'ok' : 'FAILED'}`);
    for (const k of Object.keys(VARIANTS)) console.log(`  ${k} ${VARIANTS[k].name.padEnd(48)} ${m(r.detection[k])}`);
    for (const k of ['C', 'X', 'D']) {
      const i = r.investigation[k];
      console.log(`  ${k} conflicts ${i.conflict_identification.identified}/${i.conflict_identification.expected_fields}, lineage expectations ${i.lineage_expectations.met}/${i.lineage_expectations.expected}, copies counted independent ${i.restraint.multi_record_agreement_counted_as_independent}/${i.restraint.multi_record_agreement_fields}, findings traceable ${f(i.provenance.findings_traceable_rate)}`);
    }
  }
  console.log(`\nwritten ${path.relative(ROOT, out)}`);
}
