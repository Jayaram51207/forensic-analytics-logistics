import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseWeight, parsePackages, parseNumberDate, normId, parseMoney, checkContainerNo, withinTolerance, normalizeJob } from '../src/normalize.js';
import { diffJobs, jobState, stateHash } from '../src/diff.js';
import { EventStore } from '../src/store.js';
import { outboxAppend, ingest } from '../src/ingest.js';
import { buildViews, reconcile } from '../src/model.js';
import { analyze, score, caseId, recordDisposition, caseDetail, features } from '../src/cases.js';
import { runRules, RULES, DEFAULT_CONFIG } from '../src/rules.js';
import { createDashboard } from '../src/dashboard.js';
import { xlsxContentFingerprint } from '../src/capture.js';
import { containerNo, rng } from '../synthetic/lib.js';
import { packCargo } from '../../3D_stuffing_visualizer/src/packing.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'funit-'));

test('weights: units, separators, and refusal to guess', () => {
  assert.deepEqual(parseWeight('20,200.5 KGS'), { ok: true, value: 20200.5, unit: 'kg', source_unit: 'kg', unit_assumed: false, original: '20,200.5 KGS' });
  assert.equal(parseWeight('4.66 Kgs').value, 4.66);
  assert.equal(parseWeight('2 MT').value, 2000);
  assert.equal(parseWeight('100').unit_assumed, true);
  assert.equal(parseWeight('').ok, false);
  assert.equal(parseWeight('heavy').ok, false);
  assert.equal(parseWeight('12 boxes').reason, 'unknown unit "boxes"');
  assert.equal(parseWeight(918).value, 918);
});

test('packages, number+date, identifiers, money', () => {
  assert.deepEqual(parsePackages('1,600 PP BAGS'), { ok: true, count: 1600, package_type: 'PP BAGS', original: '1,600 PP BAGS' });
  assert.equal(parsePackages('BAGS').ok, false);
  assert.deepEqual(parseNumberDate('SYN/001 DT. 05/01/2026'), { ok: true, number: 'SYN/001', date: '2026-01-05', date_reason: undefined, original: 'SYN/001 DT. 05/01/2026' });
  assert.equal(parseNumberDate('2421435 DT: 16.04.2026').date, '2026-04-16');
  assert.equal(parseNumberDate('4013089 / 10.06.2026').number, '4013089');
  assert.equal(parseNumberDate('ABC-1').date, null);
  assert.equal(parseNumberDate('X DT. 45/13/2026').date, null);
  assert.equal(normId(' syn-0001 / a '), 'SYN0001A');
  assert.equal(parseMoney('Rs. 1,20,000.50/-').value, 120000.5);
  assert.equal(parseMoney('at actuals').ok, false);
});

test('ISO 6346 check digit', () => {
  assert.equal(checkContainerNo('CSQU3054383').check_digit_valid, true); // the standard's worked example
  assert.equal(checkContainerNo('CSQU3054384').check_digit_valid, false);
  assert.equal(checkContainerNo('CSQU3054384').expected_check_digit, 3);
  assert.equal(checkContainerNo('ABC123').valid_format, false);
  const r = rng(3);
  for (let i = 0; i < 50; i++) assert.equal(checkContainerNo(containerNo(r)).check_digit_valid, true);
});

test('tolerance and job normalisation keep originals', () => {
  assert.equal(withinTolerance(20200, 20201, { abs: 1 }), true);
  assert.equal(withinTolerance(20200, 20400, { abs: 1, rel: 0.005 }), false);
  const n = normalizeJob({ job_no: 'syn-1', gross_weight: '100 KGS', net_weight: '', total_pkgs: '5 CTNS', containers: [{ container_no: 'CSQU3054383', gross_wt: 100, net_wt: 90, pkgs: '5 CTNS', cbm: 1 }], billing_charges: [{ description: 'A', amount: 10 }, { description: 'B', amount: '5' }] });
  assert.equal(n.gross_kg.original, '100 KGS');
  assert.equal(n.net_kg.ok, false);
  assert.equal(n.taxable_total, 15);
  assert.equal(n.job_no.key, 'SYN1');
});

test('diff: field changes, child rows matched on business keys', () => {
  const before = { id: 1, job_no: 'A', gross_weight: '1 KGS', updated_at: 'x', containers: [{ id: 5, job_id: 1, sl_no: 1, container_no: 'C1', gross_wt: 10 }], billing_charges: [{ id: 1, description: 'F', amount: 1 }, { id: 2, description: 'F', amount: 2 }], workflow_steps: [{ id: 1, name: 'S', status: 'Pending', updated_by: null }] };
  const after = { id: 1, job_no: 'A', gross_weight: '2 KGS', updated_at: 'y', containers: [{ id: 9, job_id: 1, sl_no: 1, container_no: 'C1', gross_wt: 12 }, { id: 10, job_id: 1, sl_no: 2, container_no: 'C2', gross_wt: 3 }], billing_charges: [{ id: 7, description: 'F', amount: 1 }], workflow_steps: [{ id: 1, name: 'S', status: 'Completed', updated_by: 'x' }] };
  const d = diffJobs(before, after);
  assert.deepEqual(d.map(c => c.field).sort(), ['billing_charges[F~2]', 'containers[C1].gross_wt', 'containers[C2]', 'gross_weight', 'workflow_steps[S].status']);
  assert.equal(stateHash(before), stateHash({ ...before, id: 99, updated_at: 'zzz', containers: [{ ...before.containers[0], id: 77 }] }), 'ids and timestamps do not affect the state hash');
  assert.notEqual(stateHash(before), stateHash(after));
  assert.equal(jobState(before).containers[0].key, 'C1');
});

test('xlsx fingerprint tolerates garbage', () => {
  assert.equal(xlsxContentFingerprint(Buffer.from('not a zip')), null);
});

test('packing reason codes distinguish payload from space', () => {
  const box = { id: 'b', name: 'b', length: 300, width: 200, height: 200, maxWeight: 1000 };
  const heavy = packCargo(box, [{ name: 'h', length: 50, width: 50, height: 50, weight: 600, quantity: 2 }]);
  assert.deepEqual(heavy.unplacedBoxes.map(b => b.unplacedReason), ['payload_exceeded']);
  const big = packCargo(box, [{ name: 'g', length: 290, width: 190, height: 190, weight: 1, quantity: 2, orientation: 'none' }]);
  assert.deepEqual(big.unplacedBoxes.map(b => b.unplacedReason), ['no_space']);
  assert.equal(packCargo(box, [{ name: 's', length: 50, width: 50, height: 50, weight: 1, quantity: 4 }]).unplacedBoxes.length, 0);
});

test('ingest: validates, deduplicates, records provenance', () => {
  const dir = tmp(), store = new EventStore(dir), file = path.join(dir, 'outbox', 'x.jsonl');
  const a = outboxAppend(file, { application: 'biil_unified', action: 'document.generated', shipment_ref: 'J1', actor_claim: 'osuser', payload: { n: 1 } });
  fs.appendFileSync(file, '{broken\n' + JSON.stringify({ application: 'workflow_sync', action: 'x', source_event_id: 'z', occurred_at: a.occurred_at }) + '\n' + JSON.stringify({ application: 'a', action: 'b' }) + '\n');
  const first = ingest(store, file);
  assert.equal(first.ingested, 1);
  assert.deepEqual(first.rejected.map(r => r.reason), ['invalid JSON', 'reserved application name', 'missing source_event_id']);
  assert.deepEqual(ingest(store, file), { ingested: 0, skipped_duplicates: 1, rejected: first.rejected });
  const [e] = store.query({ application: 'biil_unified' });
  assert.equal(e.payload.source.source_event_id, a.source_event_id);
  assert.equal(e.payload.source.integrity_before_ingest, 'none');
  assert.equal(e.actor.verified, false);
  assert.equal(e.job_no, null, 'a typed reference is not promoted to a job number');
  assert.deepEqual(store.verify().problems, []);
});

// ---- a small evidence stream built directly, without the application ----
function stream() {
  const dir = tmp(), store = new EventStore(dir);
  const job = (over = {}) => ({ job_no: 'J-1', type: 'sea_export', status: 'Active', gross_weight: '100 KGS', net_weight: '90 KGS', total_pkgs: '5 CTNS', invoice_no_date: 'I/1 DT. 01/01/2026', sb_no_date: '1 DT. 01/01/2026',
    containers: [{ key: 'CSQU3054383', container_no: 'CSQU3054383', gross_wt: 100, net_wt: 90, pkgs: '5 CTNS', cbm: 1 }], billing_charges: [{ key: 'FREIGHT', description: 'FREIGHT', amount: 1000 }], documents: [],
    workflow_steps: [{ key: 'Job Created', name: 'Job Created', status: 'Completed' }, { key: 'Sailing Completed', name: 'Sailing Completed', status: 'Pending' }, { key: 'Job Closed', name: 'Job Closed', status: 'Pending' }], closing_bill_no: '', closing_bill_amount: '', closing_sgst: '', closing_cgst: '', ...over });
  const base = { application: 'workflow_sync', entity_type: 'job', entity_id: '1', job_no: 'J-1', correlation_id: 'corr-1', actor: { display_name: 'Desk 1', source: 'client_claimed', verified: false } };
  store.append({ application: 'workflow_sync', action: 'system.started', entity_type: 'system', payload: { users: [{ name: 'Desk 1' }] } });
  store.append({ ...base, action: 'job.created', operation_id: 'op1', payload: { stored: job(), state_hash: 'h1', source_links: [] } });
  return { dir, store, job, base };
}

test('views: operations without a completion event are reported as gaps, not guessed', () => {
  const { store, base, job } = stream();
  store.append({ ...base, action: 'job.update_requested', operation_id: 'op2', payload: { before: job() } });
  const { views } = buildViews(store.readAll().records.map(x => x.record));
  const v = views.get('corr-1');
  assert.equal(v.gaps[0].type, 'operation_incomplete');
  assert.equal(v.state.gross_weight, '100 KGS', 'state is not advanced on a request alone');
  const a = analyze(store.readAll().records.map(x => x.record));
  assert.ok(a.findings.some(f => f.rule_id === 'EVD-001' && f.kind === 'data_quality'));
  assert.equal(a.cases[0].priority.band, 'informational');
});

test('views built from out-of-order input still follow recorded sequence once sorted; missing origin is explicit', () => {
  const { store, base } = stream();
  const recs = store.readAll().records.map(x => x.record);
  const orphan = [{ ...recs[1], action: 'job.updated', changes: [], payload: { after: recs[1].payload.stored, state_hash: 'h2' }, correlation_id: 'corr-9', entity_id: '9' }];
  const v = buildViews(orphan).views.get('corr-9');
  assert.ok(v.gaps.some(g => g.type === 'no_origin_event'));
  assert.equal(reconcile({ jobs: [] }, recs).problems[0].type, 'job_missing_without_deletion_evidence');
});

test('rules: unparseable or missing data yields data-quality notes, never a mismatch', () => {
  const { store, base, job } = stream();
  store.append({ ...base, action: 'job.updated', operation_id: 'op2', changes: [{ field: 'gross_weight', old: '100 KGS', new: 'approx two tons' }], payload: { after: job({ gross_weight: 'approx two tons', net_weight: '' }), state_hash: 'h2' } });
  const a = analyze(store.readAll().records.map(x => x.record));
  const w = a.findings.filter(f => f.rule_id === 'WGT-001');
  assert.equal(w.length, 2);
  assert.ok(w.every(f => f.kind === 'data_quality'));
});

test('rules: tax-scheme disagreement is not flagged; both repository implementations are accepted', () => {
  const { store, base, job } = stream();
  const close = (amount, half, seq) => {
    const st = job({ status: 'Closed', billing_charges: [{ key: 'O/F - X', description: 'O/F - X', amount: 1000 }], closing_bill_no: 'B', closing_bill_amount: amount, closing_sgst: half, closing_cgst: half });
    st.workflow_steps.forEach(s => { s.status = 'Completed'; });
    store.append({ ...base, correlation_id: 'c' + seq, entity_id: String(seq), job_no: 'J-' + seq, action: 'job.created', operation_id: 'a' + seq, payload: { stored: { ...st, status: 'Active', job_no: 'J-' + seq, closing_bill_amount: '' }, state_hash: 'x', source_links: [] } });
    store.append({ ...base, correlation_id: 'c' + seq, entity_id: String(seq), job_no: 'J-' + seq, action: 'workflow_step.status_changed', operation_id: 'b' + seq, changes: [{ field: 'workflow_steps[Job Closed].status', old: 'Pending', new: 'Completed' }], payload: { list: 'workflow_steps', item_name: 'Job Closed', job_status: 'Closed', closing: { bill_no: 'B', bill_amount: amount, sgst: half, cgst: half }, state_hash: 'y' } });
    store.append({ ...base, correlation_id: 'c' + seq, entity_id: String(seq), job_no: 'J-' + seq, action: 'job.closed', operation_id: 'b' + seq, changes: [], payload: {} });
  };
  close(1180, 90, 2);   // 9% + 9%
  close(1050, 25, 3);   // 2.5% + 2.5% on ocean freight
  close(1000, 90, 4);   // taxable only
  close(1400, 90, 5);   // explained by nothing
  const fin = analyze(store.readAll().records.map(x => x.record)).findings.filter(f => f.rule_id === 'FIN-001');
  assert.deepEqual(fin.map(f => f.job_no), ['J-5']);
  assert.ok(fin[0].assumptions.length > 0);
});

test('rules: configuration changes behaviour; disabled rules stay silent', () => {
  const { store, base, job } = stream();
  const st = job({ status: 'Closed', closing_bill_amount: 1180, closing_sgst: 90, closing_cgst: 90, closing_bill_no: 'B' });
  st.workflow_steps[2].status = 'Completed';
  store.append({ ...base, action: 'workflow_step.status_changed', operation_id: 'op2', changes: [{ field: 'workflow_steps[Job Closed].status', old: 'Pending', new: 'Completed' }], payload: { list: 'workflow_steps', item_name: 'Job Closed', job_status: 'Closed', closing: { bill_no: 'B', bill_amount: 1180, sgst: 90, cgst: 90 }, state_hash: 'y' } });
  store.append({ ...base, action: 'job.closed', operation_id: 'op2', changes: [], payload: {} });
  const recs = store.readAll().records.map(x => x.record);
  const ruleIds = cfg => { const { views, context } = buildViews(recs); return runRules(views, context, cfg).filter(f => f.kind === 'anomaly').map(f => f.rule_id); };
  assert.deepEqual(ruleIds({}), ['WFL-001']);
  assert.deepEqual(ruleIds({ required_before_close: ['Job Created'] }), []);
  assert.deepEqual(ruleIds({ disabled_rules: ['WFL-001'] }), []);
  for (const r of RULES) assert.ok(r.id && r.version && r.family && r.purpose, 'every rule declares id, version, family and purpose');
  assert.ok(DEFAULT_CONFIG.tax_schemes.length === 2);
});

test('scoring: one family counts once, corroboration adds, gaps discount, never exceeds 100', () => {
  const f = (family, severity, kind = 'anomaly') => ({ family, severity, kind, details: {} });
  const view = { gaps: [] };
  assert.equal(score([f('a', 'high'), f('a', 'high'), f('a', 'low')], view).value, 40);
  assert.equal(score([f('a', 'high'), f('b', 'medium')], view).value, 75);
  assert.equal(score([f('a', 'high'), f('b', 'high'), f('c', 'high')], view).value, 100);
  assert.equal(score([f('a', 'high', 'data_quality')], view).band, 'informational');
  assert.equal(score([f('a', 'high')], { gaps: [{ type: 'operation_incomplete' }] }).value, 32);
  assert.equal(score([{ family: 'p', severity: 'medium', kind: 'anomaly', details: { link: { ambiguous: true } } }], view).value, 13);
  assert.match(score([], view).note, /Not a probability/);
});

test('entity resolution: one reference matching two job lifecycles stays ambiguous', () => {
  const { store, base, job } = stream();
  store.append({ ...base, correlation_id: 'corr-2', entity_id: '2', action: 'job.created', operation_id: 'opx', payload: { stored: job(), state_hash: 'h', source_links: [] } });
  store.append({ application: 'visualizer_3d', action: 'packing.run_completed', entity_type: 'packing_run', payload: { shipment_ref: 'j 1', unplaced_count: 2, placed_count: 1, unplaced_reasons: { no_space: 2 }, container: { name: 'c' } } });
  store.append({ application: 'visualizer_3d', action: 'packing.run_completed', entity_type: 'packing_run', payload: { shipment_ref: 'UNKNOWN-REF', unplaced_count: 2 } });
  const a = analyze(store.readAll().records.map(x => x.record));
  const pck = a.findings.filter(f => f.rule_id === 'PCK-001');
  assert.equal(pck.length, 2, 'finding raised on both candidates');
  assert.ok(pck.every(f => f.details.link.ambiguous && f.details.link.confidence === 0.45 && f.severity === 'low'));
  assert.equal(a.context.external[1]._link.method, 'unlinked', 'unknown reference is not attached to anything');
});

test('dispositions are appended as evidence and drive case status; dashboard serves cases safely', async () => {
  const { dir, store, base, job } = stream();
  store.append({ ...base, action: 'job.updated', operation_id: 'op2', changes: [{ field: 'job_no', old: 'J-1', new: '<img src=x onerror=alert(1)>' }], job_no: '<img src=x onerror=alert(1)>', payload: { after: job({ job_no: '<img src=x onerror=alert(1)>' }), state_hash: 'h2' } });
  const id = caseId('corr-1');
  assert.throws(() => recordDisposition(dir, { case_id: id, disposition: 'confirmed_fraud' }), /must be one of/);
  const server = createDashboard({ dir, reviewToken: 'secret-token' });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base_ = `http://127.0.0.1:${server.address().port}`;
  try {
    const ov = await (await fetch(base_ + '/api/overview')).json();
    assert.equal(ov.integrity.ok, true);
    assert.equal(ov.cases[0].case_id, id);
    assert.equal(ov.cases[0].job_no, '<img src=x onerror=alert(1)>', 'served as data, unescaped JSON');
    const page = await fetch(base_ + '/');
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    const html = await page.text();
    assert.equal(/innerHTML|insertAdjacentHTML|document\.write/.test(html), false, 'page never builds HTML from data');
    const post = (token, body) => fetch(`${base_}/api/cases/${id}/disposition`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Review-Token': token } : {}) }, body: JSON.stringify(body) });
    assert.equal((await post(null, { disposition: 'escalated' })).status, 403);
    assert.equal((await post('wrong-token!!', { disposition: 'escalated' })).status, 403);
    assert.equal((await post('secret-token', { disposition: 'nonsense' })).status, 400);
    assert.equal((await post('secret-token', { disposition: 'explained_legitimate', reviewer: 'R', note: 'rename approved' })).status, 201);
    const d = await (await fetch(`${base_}/api/cases/${id}`)).json();
    assert.equal(d.status, 'explained_legitimate');
    assert.equal(d.dispositions[0].reviewer_verified, true);
    assert.ok(d.timeline.length >= 2 && d.findings.length >= 1);
    assert.equal((await fetch(base_ + '/api/cases/CASE-NOPE')).status, 404);
  } finally { server.close(); }
  assert.deepEqual(store.verify().problems, [], 'reviewer decisions extend the same chain');
  const d = caseDetail(analyze(new EventStore(dir).readAll().records.map(x => x.record)), id);
  assert.ok(Object.values(features(analyze(store.readAll().records.map(x => x.record)).views.get('corr-1'))).every(v => typeof v === 'number' && Number.isFinite(v)));
  assert.equal(d.status, 'explained_legitimate');
});

test('dashboard without a review token is read-only', async () => {
  const { dir } = stream();
  const server = createDashboard({ dir, reviewToken: null });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/cases/X/disposition`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 501);
  } finally { server.close(); }
});
