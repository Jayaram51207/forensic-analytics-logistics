// Acceptance: one reproducible synthetic run through the real pipeline (synchroniser, outbox,
// ingestion, linking, provenance, contradictions, rules, cases). Controls must stay clean.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { runDemo } from '../e2e/demo.js';
import { EventStore } from '../src/store.js';
import { pythonCanCompile } from './helpers.js';

test('demo shipments: cross-application records linked, contradictions found, provenance evaluated, controls clean', { timeout: 600000, skip: !pythonCanCompile && 'needs the project Python environment' }, async () => {
  const d = await runDemo();
  assert.deepEqual(d.manifest.errors, []);
  assert.equal(d.integrity.ok, true, 'evidence chain verifies');
  const of = type => [...d.byJob.values()].find(x => x.label.type === type);
  const apps = x => x.case?.provenance.applications || [];

  // Controls
  for (const t of ['clean_complete', 'xapp_consistent', 'xapp_rounding_difference']) assert.deepEqual(of(t).rules, [], `${t} not flagged`);
  assert.equal(of('clean_complete').case, null, 'clean job has no case at all');
  assert.deepEqual(new Set(of('xapp_consistent').provenance.external_records.map(r => r.application)), new Set(['biil_unified', 'visualizer_3d', 'stuffing_report']), 'records from three desktop tools tied to one shipment');
  const real = x => x.provenance.contradictions.filter(c => !['unresolved_business_rule_conflict', 'insufficient_evidence'].includes(c.classification));
  assert.deepEqual(real(of('xapp_consistent')), [], 'only the unresolved tax-rule note, no contradiction');
  assert.ok(of('xapp_consistent').provenance.contradictions.every(c => c.classification === 'unresolved_business_rule_conflict'), 'tax difference stays unresolved while tax_scheme is null');

  // Cross-application conflict, with both records named
  const w = of('xapp_weight_conflict');
  assert.deepEqual(w.rules, ['XAP-GROSS_WEIGHT']);
  const c = w.provenance.contradictions.find(x => x.field === 'gross_weight');
  assert.equal(c.items.length, 2);
  assert.deepEqual(new Set(c.items.map(i => i.application)), new Set(['workflow_sync', 'biil_unified']));
  assert.ok(apps(w).includes('biil_unified'));

  // Source document backs the other application: stronger classification
  assert.ok(of('xapp_document_backed_conflict').provenance.contradictions.some(x => x.classification === 'potential_fraud_indicator_requiring_investigation'));

  // A false initial value repeated everywhere: not flagged, but stated as single-source
  const cs = of('common_source_falsification');
  assert.deepEqual(cs.rules, []);
  assert.equal(cs.provenance.corroboration.gross_weight.independent_roots, 1);
  assert.equal(cs.provenance.corroboration.gross_weight.needs_independent_source, true);

  // Unattributable record kept out; refused and completed deletions told apart
  assert.ok(d.analysis.context.external.some(r => r._link?.method === 'unlinked'));
  assert.deepEqual(of('unauthorized_delete_attempt').rules, ['ACT-002']);
  assert.equal(of('unauthorized_delete_attempt').case.deleted, false, 'refused deletion did not delete');
  assert.deepEqual(of('deleted_after_close').rules, ['DEL-001']);
  assert.equal(of('deleted_after_close').case.deleted, true);

  // Documented known false positive stays visible
  assert.deepEqual(of('legit_backfill').rules, ['TIM-001']);
  for (const t of ['unauthorized_delete_attempt', 'legit_backfill']) assert.ok(of(t).case.priority.value > 0, `${t} is ranked`);

  // Every finding is traceable to stored events
  const ids = new Set(new EventStore(path.join(d.dir, 'evidence'), { remote: null, anchorFile: null }).readAll().records.map(x => x.record.event_id));
  for (const k of d.analysis.cases) for (const f of k.findings) {
    assert.ok(f.evidence_event_ids.length > 0, `${f.rule_id} cites evidence`);
    for (const id of f.evidence_event_ids) assert.ok(ids.has(id), `${f.rule_id} cites a stored event`);
  }
});
