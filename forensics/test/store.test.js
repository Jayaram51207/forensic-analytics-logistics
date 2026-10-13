import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { EventStore, canonical, hashRecord, ForensicWriteError, GENESIS_HASH } from '../src/store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fstore-'));
const evt = (n = 1) => ({ application: 'test', action: 'thing.happened', entity_type: 'job', entity_id: String(n), job_no: `J${n}`, correlation_id: `c${n}`, payload: { n } });
const types = v => v.problems.map(p => p.type);
function seeded(count = 5) {
  const store = new EventStore(tmp());
  for (let i = 1; i <= count; i++) store.append(evt(i));
  return store;
}
const lines = s => fs.readFileSync(s.file, 'utf8').split('\n').filter(Boolean);
const rewrite = (s, ls) => fs.writeFileSync(s.file, ls.join('\n') + '\n');

test('canonical serialisation is key-order independent', () => {
  assert.equal(canonical({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), canonical({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
  assert.equal(canonical({ a: undefined, b: 1 }), '{"b":1}');
});

test('append assigns id, sequence, UTC timestamp and hash links', () => {
  const store = new EventStore(tmp());
  const a = store.append(evt(1));
  const b = store.append(evt(2));
  assert.equal(a.sequence, 1);
  assert.equal(b.sequence, 2);
  assert.equal(a.previous_event_hash, GENESIS_HASH);
  assert.equal(b.previous_event_hash, a.integrity_hash);
  assert.notEqual(a.event_id, b.event_id);
  assert.match(a.server_timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(a.clock_source, 'system');
  assert.equal(hashRecord(a), a.integrity_hash);
  assert.deepEqual(a.actor, { display_name: null, source: 'not_supplied', verified: false });
});

test('simulated timestamps are labelled', () => {
  const r = new EventStore(tmp()).append(evt(), { timestamp: '2026-01-01T00:00:00.000Z' });
  assert.equal(r.clock_source, 'simulated');
});

test('rejects events missing required fields', () => {
  assert.throws(() => new EventStore(tmp()).append({ application: 'x' }), ForensicWriteError);
});

test('clean chain verifies; a second store instance continues the same chain', () => {
  const store = seeded(3);
  const again = new EventStore(store.dir);
  assert.equal(again.append(evt(4)).sequence, 4);
  assert.equal(store.append(evt(5)).sequence, 5); // first instance notices the file grew
  const v = store.verify();
  assert.deepEqual(v.problems, []);
  assert.equal(v.count, 5);
});

test('detects modified event contents', () => {
  const s = seeded();
  const ls = lines(s);
  ls[2] = ls[2].replace('"n":3', '"n":999');
  rewrite(s, ls);
  const v = s.verify();
  assert.equal(v.ok, false);
  assert.ok(types(v).includes('content_modified'));
  assert.equal(v.problems.find(p => p.type === 'content_modified').sequence, 3);
});

test('detects a modified record whose hash was recomputed (link to next record breaks)', () => {
  const s = seeded();
  const ls = lines(s);
  const r = JSON.parse(ls[2]);
  r.payload.n = 999;
  r.integrity_hash = hashRecord(r);
  ls[2] = JSON.stringify(r);
  rewrite(s, ls);
  const v = s.verify();
  assert.deepEqual(types(v), ['broken_hash_link']);
  assert.equal(v.problems[0].sequence, 4);
});

test('detects a deleted line', () => {
  const s = seeded();
  const ls = lines(s);
  ls.splice(2, 1);
  rewrite(s, ls);
  const t = types(s.verify());
  assert.ok(t.includes('sequence_gap') && t.includes('broken_hash_link'));
});

test('detects reordered records', () => {
  const s = seeded();
  const ls = lines(s);
  [ls[1], ls[2]] = [ls[2], ls[1]];
  rewrite(s, ls);
  const t = types(s.verify());
  assert.ok(t.includes('sequence_out_of_order') || t.includes('sequence_gap'));
  assert.ok(t.includes('broken_hash_link'));
});

test('detects invalid JSON without hiding later records', () => {
  const s = seeded();
  const ls = lines(s);
  ls[1] = '{not json';
  rewrite(s, ls);
  const v = s.verify();
  assert.ok(types(v).includes('malformed_record'));
  assert.equal(v.count, 4);
});

test('detects truncation of the tail via the head anchor', () => {
  const s = seeded();
  rewrite(s, lines(s).slice(0, 3));
  assert.ok(types(s.verify()).includes('truncated'));
});

test('does not report success merely because the last record is valid', () => {
  const s = seeded();
  const ls = lines(s);
  ls[0] = ls[0].replace('"n":1', '"n":7');
  rewrite(s, ls);
  assert.equal(s.verify().ok, false);
});

test('incomplete final record is reported and later appends stay parseable', () => {
  const s = seeded(2);
  fs.appendFileSync(s.file, '{"schema_version":"1.0","sequence":3,"eve');
  assert.ok(types(s.verify()).includes('incomplete_final_record'));
  const fresh = new EventStore(s.dir);
  const r = fresh.append(evt(3));
  assert.equal(r.sequence, 3);
  const v = fresh.verify();
  assert.deepEqual(types(v), ['malformed_record']); // the torn line stays visible as evidence of the crash
  assert.equal(v.count, 3);
});

test('duplicate event ids are reported', () => {
  const s = seeded(2);
  const ls = lines(s);
  ls.push(ls[1]);
  rewrite(s, ls);
  assert.ok(types(s.verify()).includes('duplicate_event_id'));
});

test('write failure raises ForensicWriteError instead of pretending success', () => {
  const s = seeded(1);
  fs.rmSync(s.file);
  fs.mkdirSync(s.file); // appending to a directory must fail
  s._tail = null;
  assert.throws(() => s.append(evt(2)), ForensicWriteError);
});

test('query filters by application, action, entity, correlation and time', () => {
  const s = new EventStore(tmp());
  s.append(evt(1), { timestamp: '2026-01-01T00:00:00.000Z' });
  s.append({ ...evt(2), action: 'other.thing' }, { timestamp: '2026-01-02T00:00:00.000Z' });
  s.append({ ...evt(1), application: 'app2' }, { timestamp: '2026-01-03T00:00:00.000Z' });
  assert.equal(s.query({ application: 'test' }).length, 2);
  assert.equal(s.query({ action: 'other.thing' }).length, 1);
  assert.equal(s.query({ entity_id: 1 }).length, 2);
  assert.equal(s.query({ correlation_id: 'c1', application: 'app2' }).length, 1);
  assert.equal(s.query({ from: '2026-01-02T00:00:00.000Z', to: '2026-01-02T23:00:00.000Z' }).length, 1);
});

test('concurrent writers in separate processes keep one valid chain', () => {
  const dir = tmp();
  const storeUrl = new URL('../src/store.js', import.meta.url).href;
  const script = `import { EventStore } from ${JSON.stringify(storeUrl)};
    const s = new EventStore(process.argv[2]);
    for (let i = 0; i < 25; i++) s.append({ application: 'w' + process.argv[3], action: 'a', entity_type: 't' });`;
  const file = path.join(dir, 'writer.mjs');
  fs.writeFileSync(file, script);
  const procs = [1, 2, 3, 4].map(n => import('child_process').then(cp => new Promise(res => cp.spawn(process.execPath, [file, dir, String(n)]).on('exit', res))));
  return Promise.all(procs).then(codes => {
    assert.deepEqual(codes, [0, 0, 0, 0]);
    const v = new EventStore(dir).verify();
    assert.deepEqual(v.problems, []);
    assert.equal(v.count, 100);
  });
});

test('a failing head-anchor write does not turn a written record into a reported failure', () => {
  const s = seeded(2);
  fs.rmSync(s.headFile);
  fs.mkdirSync(s.headFile); // rename onto a directory and in-place write both fail
  const r = s.append(evt(3));
  assert.equal(r.sequence, 3, 'append succeeds: the record is in the file');
  assert.equal(lines(s).length, 3);
  assert.ok(types(s.verify()).includes('head_unreadable'), 'the stale anchor is visible to the verifier');
  fs.rmdirSync(s.headFile);
  s.append(evt(4));
  assert.deepEqual(s.verify().problems, [], 'next append repairs the anchor');
});
