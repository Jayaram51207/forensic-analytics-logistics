// Shipment-reference linkage of desktop-tool evidence (EasyQuote, B.I.I.L., stuffing report):
// linked, unlinked, malformed, unknown, conflicting, duplicate and hand-asserted references.
// All records are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventStore } from '../src/store.js';
import { outboxAppend, ingest } from '../src/ingest.js';
import { analyze, evidenceList, recordLinkAssertion } from '../src/cases.js';
import { createDashboard } from '../src/dashboard.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'link-'));
const job = (no, container) => ({ job_no: no, type: 'sea_export', status: 'Active', gross_weight: '100 KGS', containers: [{ key: container, container_no: container, gross_wt: 100 }], billing_charges: [], documents: [], workflow_steps: [] });

function world() {
  const dir = tmp(), store = new EventStore(dir), outbox = path.join(dir, 'outbox.jsonl');
  store.append({ application: 'workflow_sync', action: 'system.started', entity_type: 'system', payload: { users: [] } });
  for (const [i, no, c] of [[1, 'SYN-J-1', 'CSQU3054383'], [2, 'SYN-J-2', 'MSKU1234565']])
    store.append({ application: 'workflow_sync', entity_type: 'job', entity_id: String(i), job_no: no, correlation_id: 'corr-' + i, action: 'job.created', operation_id: 'op' + i, actor: { display_name: 'Desk 1', source: 'session', verified: true }, payload: { stored: job(no, c), state_hash: 'h' + i, source_links: [] } });
  const quote = (ref, over = {}) => outboxAppend(outbox, { application: 'easyquote_export', action: 'quotation.exported', entity_type: 'quotation', shipment_ref: ref, actor_claim: 'synthetic-user', actor_source: 'os_account_claimed', payload: { format: 'clipboard_html', quote_ref: 'Q-SYN-' + String(ref), rows: [] }, ...over });
  const records = () => store.readAll().records.map(x => x.record);
  const evidence = () => evidenceList(analyze(records()));
  return { dir, store, outbox, quote, records, evidence };
}

test('quotation with a typed shipment reference links exactly; normalisation tolerates case and punctuation', () => {
  const w = world();
  w.quote('syn j 1');
  w.quote(null);
  assert.equal(ingest(w.store, w.outbox).ingested, 2);
  const [none, linked] = w.evidence();
  assert.equal(linked.status, 'linked');
  assert.equal(linked.method, 'job_no_exact_after_normalisation');
  assert.equal(linked.confidence, 0.9);
  assert.deepEqual(linked.job_nos, ['SYN-J-1']);
  assert.equal(none.status, 'unlinked');
  assert.equal(none.basis, 'no shipment reference supplied');
  const a = analyze(w.records());
  assert.equal(a.findings.filter(f => f.kind === 'anomaly').length, 0, 'a linked quotation raises nothing by itself (rates are not job charges)');
});

test('malformed and unknown references stay unlinked with the reason; a malformed one is never normalised into a match', () => {
  const w = world();
  w.quote('<SYN-J-1>');            // would normalise to SYNJ1, but is not a valid reference
  w.quote({ job: 'SYN-J-1' });
  w.quote('SYN-J-404');
  ingest(w.store, w.outbox);
  const [unknown, obj, angle] = w.evidence();
  assert.equal(angle.status, 'unlinked');
  assert.match(angle.basis, /^malformed shipment reference/);
  assert.equal(obj.status, 'unlinked');
  assert.match(obj.basis, /^malformed/);
  assert.equal(unknown.status, 'unlinked');
  assert.match(unknown.basis, /"SYN-J-404" matches no job/);
});

test('conflicting reference: typed job and container numbers point to different jobs -> ambiguous, never silently attributed', () => {
  const w = world();
  outboxAppend(w.outbox, { application: 'stuffing_report', action: 'stuffing_report.exported', entity_type: 'stuffing_report', shipment_ref: 'SYN-J-1', payload: { container_nos: ['MSKU1234565'], rows: [] } });
  ingest(w.store, w.outbox);
  const [r] = w.evidence();
  assert.equal(r.status, 'ambiguous');
  assert.match(r.conflict, /container numbers match SYN-J-2/);
  assert.deepEqual(r.job_nos.sort(), ['SYN-J-1', 'SYN-J-2']);
  assert.ok(r.confidence < 0.5, 'below the contradiction threshold');
});

test('duplicate delivery of the same export is ingested once', () => {
  const w = world();
  const line = fs.readFileSync((w.quote('SYN-J-1'), w.outbox), 'utf8');
  fs.appendFileSync(w.outbox, line);
  const r = ingest(w.store, w.outbox);
  assert.equal(r.ingested, 1);
  assert.equal(r.skipped_duplicates, 1);
  assert.equal(w.evidence().length, 1);
});

test('manual link: appended as evidence with reason and actor, original untouched, validated, conflicts kept ambiguous', () => {
  const w = world();
  w.quote(null);
  w.quote('SYN-J-1');
  ingest(w.store, w.outbox);
  const [withRef, noRef] = w.evidence();
  const before = w.records().find(r => r.event_id === noRef.event_id);

  assert.throws(() => recordLinkAssertion(w.dir, { target_event_id: noRef.event_id, job_no: 'SYN-J-2', reason: ' ' }), /reason is required/);
  assert.throws(() => recordLinkAssertion(w.dir, { target_event_id: noRef.event_id, job_no: '<x>', reason: 'r' }), /job_no must be/);
  assert.throws(() => recordLinkAssertion(w.dir, { target_event_id: 'nope', job_no: 'SYN-J-2', reason: 'r' }), /no evidence record/);
  const syncEvent = w.records().find(r => r.action === 'job.created');
  assert.throws(() => recordLinkAssertion(w.dir, { target_event_id: syncEvent.event_id, job_no: 'SYN-J-2', reason: 'r' }), /only records from the desktop tools/);

  recordLinkAssertion(w.dir, { target_event_id: noRef.event_id, job_no: 'SYN-J-2', reason: 'Client confirmed by phone (synthetic)', actor: 'reviewer-1' });
  recordLinkAssertion(w.dir, { target_event_id: withRef.event_id, job_no: 'SYN-J-2', reason: 'thought it was J-2', actor: 'reviewer-1' });
  const after = w.evidence();
  const manual = after.find(r => r.event_id === noRef.event_id), clash = after.find(r => r.event_id === withRef.event_id);
  assert.equal(manual.status, 'linked');
  assert.equal(manual.method, 'manual_assertion');
  assert.equal(manual.confidence, 0.7);
  assert.match(manual.basis, /reviewer-1 \(identity not verified\).*Client confirmed by phone/);
  assert.equal(clash.status, 'ambiguous', 'a hand link that contradicts the typed reference is not accepted silently');
  assert.match(clash.conflict, /record itself points to SYN-J-1/);
  assert.deepEqual(w.records().find(r => r.event_id === noRef.event_id), before, 'the linked record is unchanged');
  assert.deepEqual(w.store.verify().problems, []);
});

test('dashboard: evidence list, linking refused without the review token, accepted with it', async () => {
  const w = world();
  w.quote(null);
  ingest(w.store, w.outbox);
  const [rec] = w.evidence();
  for (const [token, code] of [[null, 501], ['wrong-token', 403], ['secret-token', 201]]) {
    const d = createDashboard({ dir: w.dir, labelsFile: null, reviewToken: token === null ? null : 'secret-token' });
    await new Promise(r => d.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${d.address().port}`;
    try {
      const list = await (await fetch(base + '/api/evidence')).json();
      assert.equal(list.records.length, 1);
      const res = await fetch(`${base}/api/evidence/${rec.event_id}/link`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Review-Token': token } : {}) }, body: JSON.stringify({ job_no: 'SYN-J-1', reason: 'synthetic test', reviewer: 'reviewer-2' }) });
      assert.equal(res.status, code);
    } finally { d.close(); }
  }
  const [linked] = w.evidence();
  assert.equal(linked.status, 'linked');
  assert.match(linked.basis, /reviewer-2 at/, 'a token-authenticated reviewer is recorded as verified');
});
