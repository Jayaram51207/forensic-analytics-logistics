// End-to-end: real HTTP calls against a disposable Workflow Synchroniser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { startSync, sampleInfo, pythonCanCompile } from './helpers.js';
import { EventStore } from '../src/store.js';

const events = s => new EventStore(s.evidenceDir).readAll().records.map(x => x.record);
const actions = s => events(s).map(e => e.action);
const skipGen = pythonCanCompile ? false : 'python with openpyxl/pdfplumber not available (set SYNC_PYTHON)';

test('job lifecycle produces structured, verifiable evidence that survives deletion', async t => {
  const s = await startSync();
  t.after(() => s.stop());

  // create
  const created = await s.call('POST', '/api/jobs', { info: sampleInfo(), creator: 'Desk 1 (Invoice)' });
  assert.equal(created.status, 201);
  const id = created.json.id;
  let ev = events(s);
  const createdEvt = ev.find(e => e.action === 'job.created');
  assert.ok(createdEvt, 'job.created captured');
  assert.equal(createdEvt.job_no, 'SYN-TEST-001');
  assert.equal(createdEvt.entity_id, String(id));
  assert.deepEqual(createdEvt.actor, { display_name: 'Desk 1 (Invoice)', source: 'client_claimed', verified: false });
  assert.equal(createdEvt.payload.stored.gross_weight, '20200 KGS');
  assert.equal(createdEvt.payload.supplied.gross_weight, '20200 KGS');
  const corr = createdEvt.correlation_id;
  assert.ok(corr);

  // update: header field, container weight, a removed and an added charge
  const edited = sampleInfo({
    gross_weight: '18000 KGS',
    containers: [{ container_no: 'CSQU3054383', seal_no: 'SL0001', pkgs: '400 BAGS', net_wt: 20000, gross_wt: 18000, cbm: 20 }],
    billing_charges: [{ description: 'OCEAN FREIGHT', amount: 50000 }, { description: 'HANDLING', amount: 900 }]
  });
  assert.equal((await s.call('PUT', `/api/jobs/${id}`, { info: edited, creator: 'Desk 2 (Documentation)' })).status, 200);
  ev = events(s);
  const req = ev.find(e => e.action === 'job.update_requested');
  const upd = ev.find(e => e.action === 'job.updated');
  assert.ok(req.sequence < upd.sequence, 'old state recorded before the completion event');
  assert.equal(req.payload.before.gross_weight, '20200 KGS', 'previous value preserved');
  assert.equal(req.operation_id, upd.operation_id);
  assert.equal(upd.correlation_id, corr);
  const change = f => upd.changes.find(c => c.field === f);
  assert.deepEqual(change('gross_weight'), { field: 'gross_weight', old: '20200 KGS', new: '18000 KGS' });
  assert.deepEqual(change('containers[CSQU3054383].gross_wt'), { field: 'containers[CSQU3054383].gross_wt', old: 20200, new: 18000 });
  assert.equal(change('billing_charges[DOCUMENTATION]').new, null, 'removed charge row reported');
  assert.equal(change('billing_charges[HANDLING]').old, null, 'added charge row reported');
  assert.equal(upd.changes.some(c => /\.id$|job_id/.test(c.field)), false, 'regenerated row ids are not reported as changes');
  assert.equal(change('consignee'), undefined, 'unchanged fields are not reported');

  // workflow: a step, with an actor name that matches no account
  const job = (await s.call('GET', '/api/jobs')).json.find(j => j.id === id);
  const step = job.workflow_steps.find(w => w.name === 'Shipping Instruction Received');
  await s.call('PUT', `/api/jobs/${id}/workflow/${step.id}`, { status: 'Completed', user: 'Mallory (no such user)' });
  ev = events(s);
  const stepEvt = ev.find(e => e.action === 'workflow_step.status_changed');
  assert.deepEqual(stepEvt.changes.find(c => c.field.endsWith('.status')), { field: 'workflow_steps[Shipping Instruction Received].status', old: 'Pending', new: 'Completed' });
  assert.equal(stepEvt.actor.display_name, 'Mallory (no such user)');
  assert.equal(stepEvt.actor.verified, false, 'claimed actor is never marked verified');
  assert.equal(ev.find(e => e.action === 'workflow_step.status_change_requested').payload.old_status, 'Pending');

  // close, then reopen: closing details are blanked by the application but kept as evidence
  const close = job.workflow_steps.find(w => w.name === 'Job Closed');
  await s.call('PUT', `/api/jobs/${id}/workflow/${close.id}`, { status: 'Completed', user: 'Desk 4 (Operations)', closingDetails: { bill_no: 'B-1', bill_amount: 61950, sgst: 4725, cgst: 4725 } });
  await s.call('PUT', `/api/jobs/${id}/workflow/${close.id}`, { status: 'Pending', user: 'Desk 4 (Operations)' });
  ev = events(s);
  const closed = ev.find(e => e.action === 'job.closed');
  const reopened = ev.find(e => e.action === 'job.reopened');
  assert.deepEqual(closed.changes.find(c => c.field === 'status'), { field: 'status', old: 'Active', new: 'Closed' });
  assert.equal(closed.changes.find(c => c.field === 'closing_bill_amount').new, 61950);
  assert.equal(reopened.changes.find(c => c.field === 'closing_bill_amount').old, 61950, 'blanked closing amount retained');
  assert.equal(s.db().jobs[0].closing_bill_amount, '', 'operational record really was blanked');

  // delete
  assert.equal((await s.call('DELETE', `/api/jobs/${id}`, null, { 'X-Claimed-User': 'System Admin' })).status, 200);
  assert.equal(s.db().jobs.length, 0);
  assert.equal(s.db().history_logs.length, 0, 'operational history is gone');
  ev = events(s);
  const delReq = ev.find(e => e.action === 'job.delete_requested');
  assert.equal(delReq.payload.snapshot.job_no, 'SYN-TEST-001');
  assert.ok(delReq.payload.operational_logs.length >= 4, 'operational log copied into evidence before deletion');
  assert.equal(delReq.actor.display_name, 'System Admin');
  assert.ok(ev.find(e => e.action === 'job.deleted').sequence > delReq.sequence);
  assert.ok(ev.filter(e => e.correlation_id === corr).length >= 10, 'whole lifecycle shares one correlation id');

  assert.deepEqual(new EventStore(s.evidenceDir).verify().problems, []);
});

test('a reused database id gets a new correlation id', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const a = await s.call('POST', '/api/jobs', { info: sampleInfo({ job_no: 'A' }), creator: 'x' });
  await s.call('DELETE', `/api/jobs/${a.json.id}`);
  const b = await s.call('POST', '/api/jobs', { info: sampleInfo({ job_no: 'B' }), creator: 'x' });
  assert.equal(a.json.id, b.json.id, 'the synchroniser reuses ids');
  const [first, second] = events(s).filter(e => e.action === 'job.created');
  assert.notEqual(first.correlation_id, second.correlation_id);
});

test('successful generation records hashes of the real output files', { skip: skipGen }, async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const r = await s.call('POST', '/api/jobs', { info: sampleInfo(), creator: 'Desk 1 (Invoice)' });
  const ev = events(s);
  const gen = ev.find(e => e.action === 'document.generated');
  const reqEvt = ev.find(e => e.action === 'document.generation_requested');
  assert.ok(gen, 'document.generated captured: ' + s.log().slice(-400));
  assert.equal(gen.generation_number, 1);
  assert.equal(gen.payload.request_event_id, reqEvt.event_id);
  assert.equal(gen.correlation_id, ev.find(e => e.action === 'job.created').correlation_id, 'generation before the insert still links to the job');
  assert.equal(gen.artifacts.length, 2);
  for (const a of gen.artifacts) {
    assert.match(a.sha256, /^[0-9a-f]{64}$/);
    assert.match(a.content_fingerprint, /^[0-9a-f]{64}$/);
    assert.ok(fs.existsSync(path.join(s.evidenceDir, 'artifacts', a.sha256 + '.xlsx')), 'output archived by content hash');
  }
  // regenerate with identical input: bytes differ (save timestamp), content fingerprint and input hash do not
  await s.call('PUT', `/api/jobs/${r.json.id}`, { info: sampleInfo(), creator: 'Desk 1 (Invoice)' });
  const gens = events(s).filter(e => e.action === 'document.generated');
  assert.equal(gens[1].generation_number, 2);
  assert.equal(gens[1].payload.input_sha256, gens[0].payload.input_sha256);
  assert.equal(gens[1].artifacts[0].content_fingerprint, gens[0].artifacts[0].content_fingerprint);
  assert.equal(events(s).find(e => e.action === 'job.updated').changes.filter(c => !c.field.startsWith('documents') && !c.field.startsWith('workflow_steps')).length, 0);
});

test('failed generation is recorded as a failure, never as a generated document', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  // a non-numeric CBM makes compiler.py raise; the synchroniser still saves the job
  const info = sampleInfo({ containers: [{ container_no: 'CSQU3054383', cbm: 'not-a-number' }] });
  const r = await s.call('POST', '/api/jobs', { info, creator: 'Desk 1 (Invoice)' });
  assert.equal(r.status, 201, 'existing behaviour kept: job saved although compilation failed');
  const a = actions(s);
  assert.ok(a.includes('document.generation_requested'));
  assert.ok(a.includes('document.generation_failed'));
  assert.equal(a.includes('document.generated'), false);
  assert.ok(events(s).find(e => e.action === 'document.generation_failed').payload.error.length > 0);
});

test('login attempts and user administration are captured without credentials', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  await s.call('POST', '/api/login', { username: 'desk1', password: 'wrong-secret-value' });
  await s.call('POST', '/api/login', { username: 'desk1', password: 'desk1' });
  await s.call('POST', '/api/users?adminUsername=admin', { username: 'temp1', password: 'pw-secret-value', name: 'Temp', role: 'Operations' });
  await s.call('DELETE', '/api/users/temp1?adminUsername=admin');
  const a = actions(s);
  for (const x of ['auth.login_failed', 'auth.login_succeeded', 'user.created', 'user.deleted']) assert.ok(a.includes(x), x);
  const ok = events(s).find(e => e.action === 'auth.login_succeeded');
  assert.equal(ok.actor.verified, true);
  const raw = fs.readFileSync(path.join(s.evidenceDir, 'events.jsonl'), 'utf8');
  assert.equal(/secret-value|passwordHash/.test(raw), false, 'no passwords or hashes in evidence');
});

test('upload: file hash recorded; unparseable source recorded as parse failure', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const form = new FormData();
  form.append('checklist', new Blob(['this is not a pdf']), 'broken.pdf');
  const res = await fetch(s.base + '/api/parse-checklist', { method: 'POST', body: form });
  assert.equal(res.status, 500);
  const ev = events(s);
  const up = ev.find(e => e.action === 'source.uploaded');
  assert.match(up.artifacts[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(up.payload.original_name, 'broken.pdf');
  assert.equal(ev.find(e => e.action === 'source.parse_failed').payload.upload_event_id, up.event_id);
});

test('fail-closed: destructive operations are refused when evidence cannot be written', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const r = await s.call('POST', '/api/jobs', { info: sampleInfo(), creator: 'x' });
  const file = path.join(s.evidenceDir, 'events.jsonl');
  fs.renameSync(file, file + '.bak');
  fs.mkdirSync(file); // every append now fails

  assert.equal((await s.call('DELETE', `/api/jobs/${r.json.id}`)).status, 503);
  assert.equal(s.db().jobs.length, 1, 'job not deleted without a preserved snapshot');
  assert.equal((await s.call('PUT', `/api/jobs/${r.json.id}`, { info: sampleInfo({ gross_weight: '1 KGS' }), creator: 'x' })).status, 503);
  assert.equal(s.db().jobs[0].gross_weight, '20200 KGS', 'job not overwritten');
  const step = s.db().workflow_steps[1];
  assert.equal((await s.call('PUT', `/api/jobs/${r.json.id}/workflow/${step.id}`, { status: 'Completed', user: 'x' })).status, 503);
  assert.equal((await s.call('POST', '/api/jobs', { info: sampleInfo({ job_no: 'SECOND' }), creator: 'x' })).status, 503);
  assert.equal(s.db().jobs.length, 1, 'insert rolled back');

  fs.rmdirSync(file);
  fs.renameSync(file + '.bak', file);
  assert.equal((await s.call('DELETE', `/api/jobs/${r.json.id}`)).status, 200);
  const ev = events(s);
  assert.ok(ev.some(e => e.action === 'forensic.capture_gap' && e.payload.lost_events >= 4), 'the outage itself is recorded once the store is back');
  assert.ok(fs.readFileSync(path.join(s.evidenceDir, 'capture_failures.log'), 'utf8').includes('job.delete_requested'));
});

test('fail-open mode keeps the application running and records the gap', async t => {
  const s = await startSync({ env: { FORENSIC_FAIL_MODE: 'open' } });
  t.after(() => s.stop());
  const file = path.join(s.evidenceDir, 'events.jsonl');
  fs.renameSync(file, file + '.bak');
  fs.mkdirSync(file);
  assert.equal((await s.call('POST', '/api/jobs', { info: sampleInfo(), creator: 'x' })).status, 201);
  fs.rmdirSync(file);
  fs.renameSync(file + '.bak', file);
  await s.call('POST', '/api/login', { username: 'desk1', password: 'desk1' });
  assert.ok(actions(s).includes('forensic.capture_gap'));
});

test('existing jobs get a baseline on start-up; restart keeps correlation ids', async t => {
  const first = await startSync({ env: { FORENSIC_DISABLED: '1' } });
  const r = await first.call('POST', '/api/jobs', { info: sampleInfo(), creator: 'x' });
  assert.equal(r.status, 201, 'regression: application works with capture disabled');
  assert.equal(fs.existsSync(path.join(first.evidenceDir, 'events.jsonl')), false);
  await first.stop();

  const second = await startSync({ dir: first.dir });
  const base = events(second).find(e => e.action === 'job.baseline_captured');
  assert.equal(base.payload.stored.job_no, 'SYN-TEST-001');
  await second.stop();

  const third = await startSync({ dir: first.dir });
  t.after(() => third.stop());
  assert.equal(events(third).filter(e => e.action === 'job.baseline_captured').length, 1, 'no duplicate baseline');
  await third.call('PUT', `/api/jobs/${r.json.id}`, { info: sampleInfo({ cbm: '21' }), creator: 'x' });
  assert.equal(events(third).find(e => e.action === 'job.updated').correlation_id, base.correlation_id);
  assert.equal(events(third).filter(e => e.action === 'system.started').length, 2);
});
