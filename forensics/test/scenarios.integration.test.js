// Runs every synthetic scenario once through the real synchroniser and checks
// that the rules raise exactly the findings the ground truth expects.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pythonCanCompile } from './helpers.js';
import { generate } from '../synthetic/generate.js';
import { SCENARIOS, MIX } from '../synthetic/scenarios.js';
import { EventStore } from '../src/store.js';
import { analyze, caseDetail } from '../src/cases.js';
import { reconcile } from '../src/model.js';

const skip = pythonCanCompile ? false : 'python with openpyxl/pdfplumber not available (set SYNC_PYTHON)';

test('every scenario has a weight in the dataset mix', () => {
  assert.deepEqual(Object.keys(SCENARIOS).sort(), Object.keys(MIX).sort());
});

test('each scenario yields its expected findings and nothing else', { skip, timeout: 600000 }, async t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fscen-'));
  const { dir, labels, manifest } = await generate({ seed: 7, only: Object.keys(SCENARIOS), out, concurrency: 6 });
  assert.deepEqual(manifest.errors, []);
  const store = new EventStore(path.join(dir, 'evidence'));
  assert.deepEqual(store.verify().problems, [], 'evidence chain verifies after a full run');
  const records = store.readAll().records.map(x => x.record);
  const analysis = analyze(records);

  for (const label of labels) {
    await t.test(label.type, () => {
      const c = analysis.cases.find(x => x.job_nos_seen.includes(label.job_no));
      const anomalyRules = [...new Set((c?.findings || []).filter(f => f.kind === 'anomaly').map(f => f.rule_id))].sort();
      const dqRules = [...new Set((c?.findings || []).filter(f => f.kind === 'data_quality').map(f => f.rule_id))].sort();
      const show = JSON.stringify((c?.findings || []).map(f => [f.rule_id, f.kind, f.title]));
      if (label.class === 'anomaly') {
        assert.deepEqual(anomalyRules, [...label.expected_rules].sort(), show);
      } else {
        assert.deepEqual(anomalyRules, [], `no anomaly finding expected for ${label.class}: ${show}`);
        if (label.class === 'data_quality') assert.deepEqual(dqRules, [...label.expected_rules].sort(), show);
      }
      for (const f of c?.findings || []) {
        assert.ok(f.evidence_event_ids.length > 0, `${f.rule_id} cites evidence`);
        for (const id of f.evidence_event_ids) assert.ok(records.some(r => r.event_id === id), 'cited event exists in the store');
      }
    });
  }

  const viewOf = job => [...analysis.views.values()].filter(v => v.job_nos.has(job)).at(-1);
  const provOf = job => analysis.provenance.get(viewOf(job).correlation_id);
  const labelOf = type => labels.find(l => l.type === type);

  await t.test('provenance: scenario expectations on lineage, classification and linkage', () => {
    for (const l of labels) {
      const p = provOf(l.job_no);
      for (const [field, n] of Object.entries(l.params.expect_roots || {})) assert.equal(p.corroboration[field].independent_roots, n, `${l.type}: independent roots for ${field}`);
      if (l.params.expect_needs_authority) assert.equal(p.corroboration.gross_weight.needs_independent_source, true, l.type);
      if (l.params.expect_classification) assert.ok(p.contradictions.some(c => c.classification === l.params.expect_classification), `${l.type}: ${p.contradictions.map(c => c.classification)}`);
      for (const f of l.params.conflict_fields || []) assert.ok(p.contradictions.some(c => c.field === f && c.classification !== 'insufficient_evidence'), `${l.type}: contradiction on ${f}`);
      for (const e of l.params.external || []) {
        const rec = records.find(r => r.payload?.source?.source_event_id === e.source_event_id);
        assert.ok(rec, `${l.type}: external record reached the chain`);
        const link = rec._link;
        if (e.should_link === true) assert.ok(link && !link.ambiguous && link.confidence >= 0.5 && viewOf(l.job_no).external_links.some(x => x.event === rec), `${l.type}: linked to its job`);
        if (e.should_link === false) assert.equal(link.method, 'unlinked', `${l.type}: must stay unlinked`);
        if (e.should_link === 'ambiguous') assert.equal(link.ambiguous, true, `${l.type}: must stay ambiguous`);
      }
    }
  });

  await t.test('common-source falsification: agreement is reported as copies of one source, never as corroboration', () => {
    const l = labelOf('common_source_falsification');
    const c = analysis.cases.find(x => x.job_nos_seen.includes(l.job_no));
    assert.equal((c?.findings || []).filter(f => f.kind === 'anomaly').length, 0, 'not detected, and not claimed to be');
    const g = provOf(l.job_no).corroboration.gross_weight;
    assert.equal(g.independent_roots, 1);
    assert.ok(g.agreeing_records >= 3, 'job, extraction and B.I.I.L. all agree');
    assert.equal(g.copies_of_same_source, g.agreeing_records - 1);
    assert.equal(g.needs_independent_source, true);
    assert.match(g.statement, /copies, not corroboration/);
    assert.match(provOf(l.job_no).trust.accuracy, /Not established/);
    // without any document the statement names the single entry instead
    assert.match(provOf(labelOf('consistent_falsification').job_no).corroboration.gross_weight.statement, /independent authoritative source is required/);
  });

  await t.test('duplicate evidence is ingested once and does not add corroboration', () => {
    const l = labelOf('xapp_duplicate_evidence');
    assert.ok(manifest.external_records_ingested.skipped_duplicates >= 1);
    const g = provOf(l.job_no).corroboration.gross_weight;
    assert.equal(g.independent_roots, 2, 'the job entry and B.I.I.L., however many times B.I.I.L. repeats it');
    assert.equal(g.agreeing_records, 3);
  });

  await t.test('edit after documents were issued elsewhere: invisible to the rules, raised by contradiction analysis', () => {
    const l = labelOf('xapp_post_issue_divergence');
    const rulesOnly = analyze(records, { contradictions: false });
    assert.equal(rulesOnly.cases.some(c => c.job_nos_seen.includes(l.job_no) && c.n_anomaly_findings > 0), false, 'rules alone see a legitimate early correction');
    const cx = provOf(l.job_no).contradictions.find(c => c.field === 'gross_weight');
    assert.equal(cx.classification, 'potential_fraud_indicator_requiring_investigation');
    assert.ok(cx.supported_by.some(x => /held .* until it was edited/.test(x)));
    assert.equal(cx.items.length, 2);
    assert.ok(cx.items.every(i => i.evidence_id && i.event_id && i.root));
    assert.equal(cx.independence, 'separately_recorded');
  });

  await t.test('every finding traces to evidence items; timeline separates event time from ingestion time', () => {
    for (const c of analysis.cases) {
      const d = caseDetail(analysis, c.case_id);
      for (const f of d.findings) assert.ok(f.assessment && Array.isArray(f.assessment.supports) && Array.isArray(f.assessment.weakens));
      const ext = d.timeline.filter(x => x.time_basis === 'source application clock');
      for (const e of ext) assert.ok(e.ingested_at && e.event_time, 'both times kept');
      assert.deepEqual([...d.timeline].sort((a, b) => Date.parse(a.event_time) - Date.parse(b.event_time) || a.sequence - b.sequence), d.timeline);
    }
    const late = caseDetail(analysis, analysis.cases.find(c => c.job_nos_seen.includes(labelOf('xapp_consistent').job_no)).case_id);
    const i = late.timeline.findIndex(x => x.application === 'biil_unified');
    assert.ok(i > 0 && i < late.timeline.length - 1, 'a record ingested at the end is placed where it happened');
    const bySeq = analyze(records, { timeline_order: 'sequence' });
    const seqTl = caseDetail(bySeq, late.case_id).timeline;
    assert.equal(seqTl.at(-1).application !== 'workflow_sync', true, 'arrival order puts it last');
  });

  await t.test('core demonstration: anomaly -> case -> reconstructable timeline', () => {
    const job = labels.find(l => l.type === 'closing_changed_on_reclose').job_no;
    const c = analysis.cases.find(x => x.job_no === job);
    const d = caseDetail(analysis, c.case_id);
    assert.ok(d.priority.value > 0 && d.status === 'requires_review');
    const actions = d.timeline.map(x => x.action);
    for (const a of ['job.created', 'document.generated', 'job.closed', 'job.reopened']) assert.ok(actions.includes(a), a);
    assert.equal(actions.filter(a => a === 'job.closed').length, 2);
    const reopen = d.timeline.find(x => x.action === 'job.reopened');
    assert.ok(reopen.changes.some(ch => ch.field === 'closing_bill_amount' && ch.old > 0), 'erased first bill amount is recoverable from evidence');
    assert.ok(d.timeline.some(x => x.cited_by_finding));
    assert.deepEqual([...d.timeline].sort((a, b) => Date.parse(a.event_time) - Date.parse(b.event_time) || a.sequence - b.sequence), d.timeline, 'timeline is in event-time order');
  });

  await t.test('deleted job remains fully reconstructable', () => {
    const job = labels.find(l => l.type === 'deleted_after_close').job_no;
    const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    assert.equal(db.jobs.some(j => j.job_no === job), false, 'gone from the operational database');
    const d = caseDetail(analysis, analysis.cases.find(x => x.job_no === job).case_id);
    assert.equal(d.state_from_evidence.job_no, job);
    assert.ok(d.timeline.length > 20);
  });

  await t.test('ambiguity is kept: unplaced cargo finding states link method and confidence', () => {
    const job = labels.find(l => l.type === 'unplaced_cargo').job_no;
    const f = analysis.cases.find(x => x.job_no === job).findings.find(x => x.rule_id === 'PCK-001');
    assert.equal(f.details.link.method, 'job_no_exact_after_normalisation');
    assert.ok(f.details.link.confidence < 1);
    assert.ok(Object.keys(f.details.unplaced_reasons).some(k => ['payload_exceeded', 'no_space', 'no_stable_position'].includes(k)));
  });

  await t.test('reconciliation: evidence matches the operational database', () => {
    const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    const rec = reconcile(db, records);
    assert.deepEqual(rec.problems.filter(p => p.type !== 'operation_incomplete'), []);
  });

  await t.test('reconciliation detects an uncaptured write and a silent deletion', () => {
    const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    db.jobs[0].gross_weight = '1 KGS';       // edited behind the API
    const removed = db.jobs.pop();           // deleted behind the API
    const types = reconcile(db, records).problems.map(p => p.type);
    assert.ok(types.includes('state_differs_from_evidence'));
    assert.ok(types.includes('job_missing_without_deletion_evidence'), removed.job_no);
    db.jobs.push({ ...removed, id: 99999, job_no: 'INSERTED-BEHIND-API' });
    assert.ok(reconcile(db, records).problems.some(p => p.type === 'job_without_evidence'));
  });
});
