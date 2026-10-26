// Remote anchor witness (src/anchor_server.js) against tampering of the local evidence folder.
// SAME-MACHINE TESTS: the witness runs on 127.0.0.1 in this process, in a different temporary
// folder. They prove the protocol and the detection logic, not a separate trust domain; the
// cross-machine procedure is in docs/EXTERNAL_ANCHOR.md and is still pending.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { EventStore, GENESIS_HASH, hashRecord } from '../src/store.js';
import { createAnchorServer } from '../src/anchor_server.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fanchor-'));
const evt = n => ({ application: 'test', action: 'thing.happened', entity_type: 'job', entity_id: String(n), job_no: `J${n}`, payload: { n } });
const types = v => v.problems.map(p => p.type);

async function witness(dir = tmp(), token = crypto.randomBytes(24).toString('hex'), allowedStores = null) {
  const server = createAnchorServer({ dir, token, allowedStores });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/anchor`;
  return { server, dir, token, url, remote: { url, token, storeId: 'site-a' }, close: () => new Promise(r => server.close(r)) };
}

async function anchoredStore(w, count = 5, anchorFile = null) {
  const s = new EventStore(tmp(), { remote: w.remote, anchorFile });
  for (let i = 1; i <= count; i++) s.append(evt(i));
  await s.flushRemote();
  return s;
}

// An attacker with write access to the whole evidence folder (and the local anchor file).
function rewrite(s, mutate, anchorFile = null) {
  const recs = fs.readFileSync(s.file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  mutate(recs);
  let prev = GENESIS_HASH;
  recs.forEach((r, i) => { r.sequence = i + 1; r.previous_event_hash = prev; r.integrity_hash = hashRecord(r); prev = r.integrity_hash; });
  fs.writeFileSync(s.file, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(s.headFile, JSON.stringify({ sequence: recs.length, integrity_hash: prev }));
  if (anchorFile) fs.writeFileSync(anchorFile, recs.map(r => JSON.stringify({ sequence: r.sequence, integrity_hash: r.integrity_hash })).join('\n') + '\n');
  s._tail = null;
  return recs;
}

test('remote witness holds every record and an untouched chain verifies', async () => {
  const w = await witness();
  try {
    const s = await anchoredStore(w);
    const v = await s.verifyRemote();
    assert.deepEqual(v.problems, []);
    assert.equal(v.remote.witnessed, 5);
    const stored = fs.readFileSync(path.join(w.dir, 'site-a.jsonl'), 'utf8');
    assert.ok(!stored.includes('thing.happened') && !stored.includes('"payload"'), 'only sequence numbers and hashes leave the evidence host');
  } finally { await w.close(); }
});

for (const [name, mutate, expected] of [
  ['altered event', recs => { recs[1].payload.n = 999; }, 'anchor_mismatch'],
  ['deleted event', recs => { recs.splice(2, 1); }, 'anchor_mismatch'],
  ['reordered events', recs => { [recs[1], recs[3]] = [recs[3], recs[1]]; }, 'anchor_mismatch'],
  ['truncated chain', recs => { recs.splice(3); }, 'anchored_record_missing']
]) {
  test(`remote witness detects a full local rewrite: ${name}`, async () => {
    const w = await witness();
    try {
      const s = await anchoredStore(w);
      rewrite(s, mutate);
      assert.equal(s.verify().ok, true, 'local verification alone is fooled by a recomputed chain');
      assert.ok(types(await s.verifyRemote()).includes(expected));
    } finally { await w.close(); }
  });
}

test('remote witness detects a rewrite that also rewrote the local anchor file', async () => {
  const w = await witness(), anchorFile = path.join(tmp(), 'local-witness.jsonl');
  try {
    const s = await anchoredStore(w, 5, anchorFile);
    rewrite(s, recs => { recs[0].payload.n = 42; }, anchorFile);
    const v = await s.verifyRemote();
    assert.ok(!types(v).includes('anchor_mismatch') || v.problems.every(p => p.type !== 'anchor_mismatch' || p.detail.startsWith('remote')), 'local anchor file agrees with the forgery');
    assert.ok(v.problems.some(p => p.type === 'anchor_mismatch' && p.detail.startsWith('remote anchor')));
  } finally { await w.close(); }
});

test('re-anchoring a rewritten chain is refused and the attempt is reported', async () => {
  const w = await witness();
  try {
    const s = await anchoredStore(w);
    const forged = rewrite(s, recs => { recs[1].payload.n = 7; });
    // the attacker also holds the evidence host's witness token and pushes the new hash
    const res = await fetch(w.url, { method: 'POST', headers: { Authorization: `Bearer ${w.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ store_id: 'site-a', sequence: 2, integrity_hash: forged[1].integrity_hash }) });
    assert.equal(res.status, 409);
    const v = await s.verifyRemote();
    assert.ok(types(v).includes('remote_anchor_conflict'));
    assert.ok(types(v).includes('anchor_mismatch'), 'the original witness entry is unchanged');
  } finally { await w.close(); }
});

test('witness down: appends still succeed, gap is reported, then caught up after recovery', async () => {
  const dir = tmp(), w = await witness(dir);
  const s = await anchoredStore(w, 2);
  await w.close();
  s.append(evt(3)); s.append(evt(4));
  await s.flushRemote();
  assert.ok(s.remoteStatus.last_error, 'failure recorded');
  assert.ok(types(await s.verifyRemote()).includes('remote_anchor_unreachable'));
  const back = await witness(dir, w.token);
  try {
    s.remote = back.remote; // same folder and token, new port
    let v = await s.verifyRemote();
    assert.ok(types(v).includes('remote_unwitnessed_records'), 'records written during the outage are flagged');
    await s.flushRemote();
    v = await s.verifyRemote();
    assert.deepEqual(v.problems, []);
    assert.equal(v.remote.witnessed, 4);
  } finally { await back.close(); }
});

test('witness rejects missing or wrong credentials and malformed input', async () => {
  const w = await witness();
  try {
    const post = (body, token = w.token) => fetch(w.url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
    assert.equal((await fetch(w.url + '?store_id=site-a')).status, 401);
    assert.equal((await post('{}', 'x'.repeat(48))).status, 401);
    assert.equal((await post('{bad')).status, 400);
    assert.equal((await post(JSON.stringify({ store_id: '../x', sequence: 1, integrity_hash: 'a'.repeat(64) }))).status, 400);
    assert.equal((await post(JSON.stringify({ store_id: 'site-a', sequence: 1, integrity_hash: 'a'.repeat(64) }))).status, 201);
    assert.equal((await post(JSON.stringify({ store_id: 'site-a', sequence: 1, integrity_hash: 'a'.repeat(64) }))).status, 200);
    assert.equal((await post(JSON.stringify({ store_id: 'site-a', sequence: 1, integrity_hash: 'b'.repeat(64) }))).status, 409);
    assert.throws(() => createAnchorServer({ dir: tmp(), token: 'short' }), /at least 24/);
  } finally { await w.close(); }
});

test('store allowlist: a compromised host cannot open a fresh store id to anchor a forged chain', async () => {
  const w = await witness(tmp(), undefined, ['site-a']);
  try {
    const s = await anchoredStore(w);
    rewrite(s, recs => { recs[1].payload.n = 5; });
    const fresh = new EventStore(s.dir, { remote: { ...w.remote, storeId: 'site-a-v2' } });
    const st = await fresh.flushRemote();
    assert.match(st.last_error, /403/);
    assert.ok(types(await fresh.verifyRemote()).includes('remote_anchor_unreachable'), 'verifying against the fresh id fails loudly');
    assert.ok(types(await s.verifyRemote()).includes('anchor_mismatch'), 'the real store id still exposes the rewrite');
  } finally { await w.close(); }
});

test('witness offers no way to change or delete history, and replays change nothing', async () => {
  const w = await witness();
  try {
    const s = await anchoredStore(w, 3);
    const auth = { Authorization: `Bearer ${w.token}` };
    for (const method of ['PUT', 'DELETE', 'PATCH']) assert.equal((await fetch(w.url + '?store_id=site-a', { method, headers: auth })).status, 405, method);
    assert.equal((await fetch(w.url.replace('/anchor', '/anchor/site-a'), { method: 'DELETE', headers: auth })).status, 404);
    const before = fs.readFileSync(path.join(w.dir, 'site-a.jsonl'), 'utf8');
    const r1 = s.readAll().records[0].record;
    const res = await fetch(w.url, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ store_id: 'site-a', sequence: 1, integrity_hash: r1.integrity_hash }) });
    assert.equal(res.status, 200);
    assert.equal(fs.readFileSync(path.join(w.dir, 'site-a.jsonl'), 'utf8'), before, 'replayed entry not written again');
  } finally { await w.close(); }
});

test('cli.js anchor catches the witness up without a new append', async () => {
  const w = await witness();
  try {
    const s = new EventStore(tmp(), { remote: null, anchorFile: null });
    for (let i = 1; i <= 4; i++) s.append(evt(i));
    const { execFile } = await import('child_process');
    const run = (...a) => new Promise(res => execFile(process.execPath, [path.join(import.meta.dirname, '..', 'cli.js'), ...a, '--dir', s.dir], { env }, (err, stdout, stderr) => res({ status: err ? err.code : 0, stdout, stderr })));
    const env = { ...process.env, FORENSIC_ANCHOR_URL: w.url, FORENSIC_ANCHOR_TOKEN: w.token, FORENSIC_ANCHOR_STORE_ID: 'site-a' };
    const r = await run('anchor');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /up to sequence 4/);
    const v = await run('verify');
    assert.equal(v.status, 0, v.stdout);
    assert.match(v.stdout, /remote anchor: 4 record/);
  } finally { await w.close(); }
});
