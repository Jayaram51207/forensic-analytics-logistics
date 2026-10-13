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
    assert.deepEqual([...d.timeline].sort((a, b) => a.sequence - b.sequence), d.timeline, 'timeline is in evidence order');
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
