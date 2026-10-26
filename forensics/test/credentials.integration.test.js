// Accounts, passwords, sessions and login throttling in the Workflow Synchroniser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startSync, sampleInfo } from './helpers.js';
import { EventStore } from '../src/store.js';

const events = s => new EventStore(s.evidenceDir).readAll().records.map(x => x.record);
const STRONG = 'Correct-Horse-91-Battery';

test('no account exists and no default password works unless an administrator is bootstrapped', async t => {
  const s = await startSync({ env: { SYNC_ADMIN_PASSWORD: '', SYNC_AUTH: 'off' } }); // auth off only to inspect startup quickly
  t.after(() => s.stop());
  assert.equal(s.db().users.length, 0, 'nothing seeded');
  assert.match(s.log(), /No user accounts exist/);
  for (const u of ['admin', 'desk1', 'desk2', 'desk3', 'desk4']) {
    assert.equal((await s.anon('POST', '/api/login', { username: u, password: u })).status, 401, `${u}/${u} must not work`);
  }
});

test('weak bootstrap password is refused and creates nothing', async t => {
  const s = await startSync({ env: { SYNC_ADMIN_PASSWORD: 'admin', SYNC_AUTH: 'off' } });
  t.after(() => s.stop());
  assert.equal(s.db().users.length, 0);
  assert.match(s.log(), /SYNC_ADMIN_PASSWORD rejected/);
  assert.equal(s.log().includes('admin\n'), false);
});

test('passwords are stored only as bcrypt hashes and never appear in logs or evidence', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const admin = await s.as('admin');
  assert.equal((await admin('POST', '/api/users', { username: 'temp1', password: STRONG, name: 'Temp', role: 'Operations' })).status, 201);
  await s.anon('POST', '/api/login', { username: 'temp1', password: 'Wrong-password-12345' });
  const raw = fs.readFileSync(s.dbPath, 'utf8') + fs.readFileSync(path.join(s.evidenceDir, 'events.jsonl'), 'utf8') + s.log();
  for (const secret of [STRONG, 'Wrong-password-12345', s.password('admin'), s.password('desk1')]) assert.equal(raw.includes(secret), false, 'secret leaked');
  assert.ok(s.db().users.every(u => /^\$2[aby]\$\d\d\$/.test(u.passwordHash) && !('password' in u)));
});

test('login: valid, wrong password, unknown user, malformed bodies', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const ok = await s.anon('POST', '/api/login', { username: 'admin', password: s.password('admin') });
  assert.equal(ok.status, 200);
  const wrong = await s.anon('POST', '/api/login', { username: 'admin', password: s.password('desk1') || 'Some-Other-Pass-1' });
  const unknown = await s.anon('POST', '/api/login', { username: 'nobody', password: 'Some-Other-Pass-1' });
  assert.deepEqual([wrong.status, unknown.status], [401, 401]);
  assert.equal(wrong.text, unknown.text, 'same answer whether or not the account exists');
  for (const body of [{}, { username: 'admin' }, { password: 'x' }, { username: ['admin'], password: 'x' }, { username: 'admin', password: { $ne: 1 } }, { username: 'a'.repeat(500), password: 'x' }]) {
    assert.equal((await s.anon('POST', '/api/login', body)).status, 400, JSON.stringify(body).slice(0, 40));
  }
  const res = await fetch(s.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  assert.equal(res.status, 400);
});

test('login throttling after repeated failures; the right password is refused while throttled', async t => {
  const s = await startSync({ env: { SYNC_LOGIN_MAX_FAILURES: '3' } });
  t.after(() => s.stop());
  for (let i = 0; i < 3; i++) assert.equal((await s.anon('POST', '/api/login', { username: 'desk4', password: 'Wrong-password-' + i + 'xx' })).status, 401);
  assert.equal((await s.anon('POST', '/api/login', { username: 'desk4', password: s.password('desk4') })).status, 429);
  assert.equal((await s.anon('POST', '/api/login', { username: 'nobody-at-all', password: 'Wrong-password-x' })).status, 429, 'same client address is throttled too');
  assert.ok(events(s).some(e => e.action === 'auth.request_rejected' && e.payload.reason === 'login throttled'));
});

test('administrator-set passwords must be changed at first sign-in', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const admin = await s.as('admin');
  await admin('POST', '/api/users', { username: 'newbie', password: STRONG, name: 'New Person', role: 'Invoice' });
  const login = await s.anon('POST', '/api/login', { username: 'newbie', password: STRONG });
  assert.equal(login.json.must_change_password, true);
  const cookie = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  const blocked = await s.anon('GET', '/api/jobs', null, cookie);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.must_change_password, true);
  assert.equal((await s.anon('POST', '/api/jobs', { info: sampleInfo() }, cookie)).status, 403);
  assert.equal((await s.anon('GET', '/api/session', null, cookie)).status, 200, 'session and password routes stay open');
  const ch = await s.anon('POST', '/api/password', { current_password: STRONG, new_password: 'Brand-New-Secret-77' }, cookie);
  assert.equal(ch.status, 200);
  const fresh = { Cookie: ch.headers.get('set-cookie').split(';')[0] };
  assert.equal((await s.anon('GET', '/api/jobs', null, fresh)).status, 200);
  assert.equal((await s.anon('GET', '/api/jobs', null, cookie)).status, 401, 'pre-change session ended');
});

test('password change: wrong current password, weak new password, success ends other sessions', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  await s.cookieFor('desk1');
  const pw = s.password('desk1');
  const a = await s.anon('POST', '/api/login', { username: 'desk1', password: pw });
  const b = await s.anon('POST', '/api/login', { username: 'desk1', password: pw });
  const ca = { Cookie: a.headers.get('set-cookie').split(';')[0] }, cb = { Cookie: b.headers.get('set-cookie').split(';')[0] };
  assert.equal((await s.anon('POST', '/api/password', { current_password: 'Not-The-Password-1', new_password: 'Another-Good-One-55' }, ca)).status, 400);
  for (const weak of ['short', 'desk1-is-my-pass-x', 'password1234', 'aaaaaaaaaaaaaaa', 12345678901234]) {
    const r = await s.anon('POST', '/api/password', { current_password: pw, new_password: weak }, ca);
    assert.equal(r.status, 400, String(weak));
    assert.equal(r.text.includes(String(weak)), false, 'error never echoes the password');
  }
  assert.equal((await s.anon('POST', '/api/password', { current_password: pw, new_password: pw }, ca)).status, 400, 'must differ');
  const ok = await s.anon('POST', '/api/password', { current_password: pw, new_password: 'Another-Good-One-55' }, ca);
  assert.equal(ok.status, 200);
  assert.equal((await s.anon('GET', '/api/jobs', null, cb)).status, 401, 'other session ended');
  assert.equal((await s.anon('GET', '/api/jobs', null, ca)).status, 401, 'the old token of this session ended too');
  assert.equal((await s.anon('GET', '/api/jobs', null, { Cookie: ok.headers.get('set-cookie').split(';')[0] })).status, 200, 'replacement token works');
  assert.equal((await s.anon('POST', '/api/login', { username: 'desk1', password: pw })).status, 401, 'old password gone');
  assert.equal((await s.anon('POST', '/api/login', { username: 'desk1', password: 'Another-Good-One-55' })).status, 200);
  const ev = events(s).map(e => e.action);
  assert.ok(ev.includes('user.password_changed') && ev.includes('user.password_change_failed'));
});

test('unauthorised password changes: anonymous, another user, admin reset needs Admin', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  assert.equal((await s.anon('POST', '/api/password', { current_password: 'x', new_password: 'Whatever-Long-123' })).status, 401);
  const desk2 = await s.as('desk2');
  // the endpoint only ever changes the caller's own password; naming someone else changes nothing
  await desk2('POST', '/api/password', { username: 'admin', current_password: s.password('admin'), new_password: 'Takeover-Attempt-99' });
  assert.equal((await s.anon('POST', '/api/login', { username: 'admin', password: s.password('admin') })).status, 200, 'admin password unchanged');
  assert.equal((await desk2('POST', '/api/users/desk3/password', { new_password: 'Takeover-Attempt-99' })).status, 403);
  const admin = await s.as('admin');
  assert.equal((await admin('POST', '/api/users/desk3/password', { new_password: 'short' })).status, 400);
  const desk3 = await s.as('desk3');
  assert.equal((await admin('POST', '/api/users/desk3/password', { new_password: 'Temporary-Reset-42' })).status, 200);
  assert.equal((await desk3('GET', '/api/jobs')).status, 401, 'reset ends the user\'s sessions');
  const relog = await s.anon('POST', '/api/login', { username: 'desk3', password: 'Temporary-Reset-42' });
  assert.equal(relog.json.must_change_password, true);
  assert.ok(events(s).some(e => e.action === 'user.password_reset' && e.actor.username === 'admin'));
});

test('deleting a user ends their sessions; idle and absolute session expiry', async t => {
  const s = await startSync({ env: { SYNC_SESSION_IDLE_MINUTES: '0.02' } });
  t.after(() => s.stop());
  const desk4 = await s.as('desk4');
  assert.equal((await desk4('GET', '/api/jobs')).status, 200);
  await new Promise(r => setTimeout(r, 1500));
  assert.equal((await desk4('GET', '/api/jobs')).status, 401, 'idle session expired');
  const s2 = await startSync({ env: { SYNC_SESSION_MAX_HOURS: '0.0004' } });
  t.after(() => s2.stop());
  const d1 = await s2.as('desk1');
  await new Promise(r => setTimeout(r, 1600));
  assert.equal((await d1('GET', '/api/jobs')).status, 401, 'absolute lifetime reached despite activity');
  s2.forgetSession('admin'); s2.forgetSession('desk2'); // provisioning sessions have also reached the absolute limit
  const admin = await s2.as('admin');
  const d2 = await s2.as('desk2');
  assert.equal((await d2('GET', '/api/jobs')).status, 200);
  assert.equal((await admin('DELETE', '/api/users/desk2')).status, 200);
  assert.equal((await d2('GET', '/api/jobs')).status, 401);
});

test('legacy weak passwords already in a database are forced to change', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcred-'));
  const first = await startSync({ dir });
  await first.stop();
  // simulate an account created by the old code: password equal to the username, hashed the old way
  const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  const bcrypt = (await import('../../Workflow syncroniser/node_modules/bcryptjs/index.js')).default;
  const crypto = await import('crypto');
  db.users.push({ username: 'olddesk', name: 'Old Desk', role: 'Invoice', passwordHash: bcrypt.hashSync(crypto.createHash('sha256').update('olddesk').digest('hex'), 10) });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db));
  const s = await startSync({ dir });
  t.after(() => s.stop());
  const r = await s.anon('POST', '/api/login', { username: 'olddesk', password: 'olddesk' });
  assert.equal(r.status, 200);
  assert.equal(r.json.must_change_password, true);
  assert.equal((await s.anon('GET', '/api/jobs', null, { Cookie: r.headers.get('set-cookie').split(';')[0] })).status, 403);
});

test('job deletion: Admin only by default, configurable, with snapshot either way', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const job = (await s.call('POST', '/api/jobs', { info: sampleInfo(), creator: 'Desk 1 (Invoice)' })).json;
  for (const u of ['desk1', 'desk2', 'desk3', 'desk4']) assert.equal((await (await s.as(u))('DELETE', `/api/jobs/${job.id}`)).status, 403, u);
  assert.equal(s.db().jobs.length, 1);
  assert.equal((await (await s.as('admin'))('DELETE', `/api/jobs/${job.id}`)).status, 200);
  assert.ok(events(s).some(e => e.action === 'job.delete_requested' && e.payload.snapshot.job_no === 'SYN-TEST-001'));
  const open = await startSync({ env: { SYNC_DELETE_REQUIRES_ADMIN: '0' } });
  t.after(() => open.stop());
  const j2 = (await open.call('POST', '/api/jobs', { info: sampleInfo(), creator: 'Desk 1 (Invoice)' })).json;
  assert.equal((await open.call('DELETE', `/api/jobs/${j2.id}`)).status, 200);
  assert.equal(events(open).find(e => e.action === 'system.started').payload.delete_requires_admin, false, 'the setting in force is recorded');
});

test('fail-open is loud and recorded', async t => {
  const s = await startSync({ env: { FORENSIC_FAIL_MODE: 'open' } });
  t.after(() => s.stop());
  assert.match(s.log(), /FORENSIC_FAIL_MODE=open/);
  assert.equal(events(s).find(e => e.action === 'system.started').payload.fail_mode, 'open');
});
