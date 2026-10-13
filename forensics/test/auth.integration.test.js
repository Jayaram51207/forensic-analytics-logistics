// Authentication, authorisation and actor attribution in the Workflow Synchroniser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSync, sampleInfo } from './helpers.js';
import { EventStore } from '../src/store.js';
import { analyze } from '../src/cases.js';

const events = s => new EventStore(s.evidenceDir).readAll().records.map(x => x.record);

test('every API route except login refuses requests without a session', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const job = (await s.call('POST', '/api/jobs', { info: sampleInfo(), creator: 'x' })).json;
  const step = job.workflow_steps[1].id;
  const attempts = [
    ['GET', '/api/jobs'], ['GET', '/api/session'], ['GET', '/api/events'], ['GET', '/api/logs'], ['GET', '/api/users'],
    ['POST', '/api/jobs', { info: sampleInfo({ job_no: 'ANON' }), creator: 'System Admin' }],
    ['PUT', `/api/jobs/${job.id}`, { info: sampleInfo({ gross_weight: '1 KGS' }), creator: 'System Admin' }],
    ['PUT', `/api/jobs/${job.id}/workflow/${step}`, { status: 'Completed', user: 'System Admin' }],
    ['PUT', `/api/jobs/${job.id}/documents/1`, { status: 'Submitted', user: 'System Admin' }],
    ['DELETE', `/api/jobs/${job.id}`],
    ['POST', '/api/users', { username: 'evil', password: 'x', name: 'Evil', role: 'Admin' }],
    ['DELETE', '/api/users/desk1'], ['POST', '/api/parse-checklist'], ['POST', '/api/logout']
  ];
  for (const [m, u, b] of attempts) assert.equal((await s.anon(m, u, b)).status, 401, `${m} ${u}`);
  const db = s.db();
  assert.equal(db.jobs.length, 1);
  assert.equal(db.jobs[0].gross_weight, '20200 KGS', 'nothing was changed by unauthenticated requests');
  assert.equal(db.users.some(u => u.username === 'evil'), false);
  const rejected = events(s).filter(e => e.action === 'auth.request_rejected');
  assert.equal(rejected.length, attempts.filter(a => a[0] !== 'GET').length, 'every refused write is recorded');
  assert.ok(rejected.every(e => e.actor.verified === false));
  assert.equal(rejected.find(e => e.payload.path === '/api/users').actor.display_name, null);
});

test('forged or expired tokens are refused', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const forged = 'sync_sid=' + 'a'.repeat(64);
  const res = await fetch(s.base + '/api/jobs', { headers: { Cookie: forged } });
  assert.equal(res.status, 401);
  assert.equal((await fetch(s.base + '/api/jobs', { headers: { Authorization: 'Bearer not-a-token' } })).status, 401);
  // a real token works as cookie or bearer, and stops working after logout
  const login = await s.anon('POST', '/api/login', { username: 'desk2', password: 'desk2' });
  const token = login.json.token;
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(s.base + '/api/session', { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  await fetch(s.base + '/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await fetch(s.base + '/api/session', { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  assert.ok(events(s).some(e => e.action === 'auth.logout' && e.actor.username === 'desk2'));
});

test('admin privileges come from the session role, not from adminUsername', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const desk = await s.as('desk3');
  // the old bypass: claim to be admin in the query string, body or header
  assert.equal((await desk('GET', '/api/logs?adminUsername=admin')).status, 403);
  assert.equal((await desk('GET', '/api/users', null, { 'X-Admin-Username': 'admin' })).status, 403);
  assert.equal((await desk('POST', '/api/users?adminUsername=admin', { username: 'evil', password: 'x', name: 'Evil', role: 'Admin', adminUsername: 'admin' })).status, 403);
  assert.equal((await desk('DELETE', '/api/users/desk1?adminUsername=admin')).status, 403);
  assert.equal(s.db().users.length, 5);
  const admin = await s.as('admin');
  assert.equal((await admin('GET', '/api/logs')).status, 200);
  assert.equal((await admin('GET', '/api/users')).json.length, 5);
  const rej = events(s).filter(e => e.action === 'auth.request_rejected');
  assert.equal(rej.length, 4, 'every refused admin request is recorded, reads included');
  assert.ok(rej.every(e => e.payload.reason === 'admin role required' && e.actor.username === 'desk3' && e.actor.verified));
});

test('actor spoofing: the session identity is recorded and the attempt is flagged', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const desk2 = await s.as('desk2');
  const job = (await desk2('POST', '/api/jobs', { info: sampleInfo(), creator: 'System Admin' })).json;
  await desk2('PUT', `/api/jobs/${job.id}/workflow/${job.workflow_steps[1].id}`, { status: 'Completed', user: 'Desk 4 (Operations)' });
  await desk2('DELETE', `/api/jobs/${job.id}`, null, { 'X-Claimed-User': 'System Admin' });
  const ev = events(s).filter(e => e.entity_type === 'job' && e.actor.source !== 'system');
  assert.ok(ev.length >= 6);
  assert.ok(ev.every(e => e.actor.display_name === 'Desk 2 (Documentation)' && e.actor.username === 'desk2' && e.actor.verified === true));
  assert.equal(ev.find(e => e.action === 'job.created').actor.claimed_display_name, 'System Admin');
  assert.equal(ev.find(e => e.action === 'job.created').payload.stored.workflow_steps.find(w => w.name === 'Job Created').status, 'Completed');
  const f = analyze(events(s)).findings.find(x => x.rule_id === 'ACT-001');
  assert.ok(f, 'spoofing attempt raised as a finding');
  assert.match(f.explanation, /signed in as Desk 2 \(Documentation\)/);
  // honest requests (body name equals session name) carry no claim and raise nothing
  const desk1 = await s.as('desk1');
  const clean = (await desk1('POST', '/api/jobs', { info: sampleInfo({ job_no: 'CLEAN' }), creator: 'Desk 1 (Invoice)' })).json;
  const created = events(s).find(e => e.action === 'job.created' && e.job_no === 'CLEAN');
  assert.equal('claimed_display_name' in created.actor, false);
  assert.equal(analyze(events(s)).findings.some(x => x.rule_id === 'ACT-001' && x.job_no === 'CLEAN'), false);
  assert.equal(clean.logs[0].user, 'Desk 1 (Invoice)');
});

test('sessions do not survive a restart', async t => {
  const first = await startSync();
  const cookie = await first.cookieFor('desk1');
  await first.stop();
  const second = await startSync({ dir: first.dir });
  t.after(() => second.stop());
  assert.equal((await fetch(second.base + '/api/jobs', { headers: { Cookie: cookie } })).status, 401);
});

test('SYNC_AUTH=off keeps the original behaviour and marks every actor unverified', async t => {
  const s = await startSync({ env: { SYNC_AUTH: 'off' } });
  t.after(() => s.stop());
  assert.match(s.log(), /SYNC_AUTH=off/);
  const r = await s.anon('POST', '/api/jobs', { info: sampleInfo(), creator: 'Anyone At All' });
  assert.equal(r.status, 201);
  const e = events(s).find(x => x.action === 'job.created');
  assert.deepEqual(e.actor, { display_name: 'Anyone At All', source: 'client_claimed', verified: false });
  assert.equal((await s.anon('GET', '/api/logs?adminUsername=admin')).status, 200, 'legacy admin check still applies in this mode');
  assert.ok(analyze(events(s)).findings.some(x => x.rule_id === 'ACT-001' && /not matching any account/.test(x.title)));
});
