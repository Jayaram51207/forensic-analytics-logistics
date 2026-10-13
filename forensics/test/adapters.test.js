// Evidence from the desktop tools: written to an outbox by the tool, then ingested into the chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { REPO, PYTHON, pythonCanCompile } from './helpers.js';
import { EventStore, sha256 } from '../src/store.js';
import { ingest } from '../src/ingest.js';
import { analyze } from '../src/cases.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fadapt-'));
const py = (code, env, args = []) => spawnSync(PYTHON, ['-c', code, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
const hasWebview = spawnSync(PYTHON, ['-c', 'import webview']).status === 0;
const hasTk = spawnSync(PYTHON, ['-c', 'import tkinter; tkinter.Tk().destroy()']).status === 0;

test('python outbox: emit never raises and records an unverified OS account', () => {
  const dir = tmp();
  const adapters = path.join(REPO, 'forensics', 'adapters');
  const ok = py(`import sys; sys.path.insert(0, sys.argv[1]); import forensic_outbox as f; print(f.emit('biil_unified', 'x.y', {'a': 1}, shipment_ref='J1', artifacts=[f.file_artifact('r', sys.argv[2])]))`, { FORENSIC_OUTBOX_DIR: dir }, [adapters, path.join(dir, 'missing.xlsx')]);
  assert.equal(ok.stdout.trim(), 'True', ok.stderr);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, 'biil_unified.jsonl'), 'utf8'));
  assert.equal(rec.actor_source, 'os_account_claimed');
  assert.equal(rec.artifacts[0].sha256, null, 'a missing file is recorded as missing');
  assert.ok(rec.payload.session_id);
  // unwritable outbox: returns False, does not raise
  const blocked = path.join(dir, 'file-not-folder');
  fs.writeFileSync(blocked, '');
  const bad = py(`import sys; sys.path.insert(0, sys.argv[1]); import forensic_outbox as f; print(f.emit('a', 'b'))`, { FORENSIC_OUTBOX_DIR: blocked }, [adapters]);
  assert.equal(bad.stdout.trim(), 'False');
  assert.equal(bad.status, 0);
});

test('3D visualizer wrapper: packing event from the JS bridge reaches the chain and links to a job', { skip: hasWebview ? false : 'pywebview not installed' }, () => {
  const dir = tmp(), outbox = path.join(dir, 'outbox');
  const evt = JSON.stringify({ action: 'packing.run_completed', shipment_ref: 'syn-77', payload: { container: { name: "40' High Cube Container" }, placed_count: 6, unplaced_count: 3, unplaced_reasons: { payload_exceeded: 3 } } });
  const run = py(`import sys; sys.path.insert(0, sys.argv[1]); import app; print(app.Api().forensic_event(sys.argv[2]), app.Api().forensic_event('{not json'))`, { FORENSIC_OUTBOX_DIR: outbox }, [path.join(REPO, '3D_stuffing_visualizer'), evt]);
  assert.equal(run.stdout.trim(), 'True False', run.stderr);

  const store = new EventStore(path.join(dir, 'evidence'));
  store.append({ application: 'workflow_sync', action: 'job.created', entity_type: 'job', entity_id: '1', job_no: 'SYN-77', correlation_id: 'c1', operation_id: 'o1', payload: { stored: { job_no: 'SYN-77', status: 'Active', containers: [], billing_charges: [], workflow_steps: [], documents: [] }, state_hash: 'h', source_links: [] } });
  assert.equal(ingest(store, path.join(outbox, 'visualizer_3d.jsonl')).ingested, 1);
  const a = analyze(store.readAll().records.map(x => x.record));
  const f = a.findings.find(x => x.rule_id === 'PCK-001');
  assert.ok(f, 'unplaced cargo finding raised on the linked job');
  assert.equal(f.job_no, 'SYN-77');
  assert.equal(f.details.link.method, 'job_no_exact_after_normalisation');
  assert.deepEqual(store.verify().problems, []);
});

test('B.I.I.L.: a real generate_all() run records inputs, totals and output hashes', { skip: pythonCanCompile && hasTk ? false : 'needs python with openpyxl, pdfplumber and a working Tk display', timeout: 120000 }, () => {
  const dir = tmp(), outbox = path.join(dir, 'outbox'), out = path.join(dir, 'generated');
  const run = spawnSync(PYTHON, [path.join(REPO, 'forensics', 'test', 'biil_headless.py'), out], { env: { ...process.env, FORENSIC_OUTBOX_DIR: outbox }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const files = fs.readdirSync(out);
  assert.ok(files.length >= 2, 'B.I.I.L. still generates its documents: ' + run.stdout);
  const rec = JSON.parse(fs.readFileSync(path.join(outbox, 'biil_unified.jsonl'), 'utf8').trim());
  assert.equal(rec.action, 'document.batch_generated');
  assert.ok(rec.shipment_ref, 'job number field used as the shipment reference');
  const outputs = rec.artifacts.filter(a => !a.role.startsWith('source_'));
  assert.equal(outputs.length, files.length);
  for (const a of outputs) assert.equal(a.sha256, sha256(fs.readFileSync(a.path)), 'recorded hash matches the file on disk');
  const t = rec.payload.totals;
  assert.ok(Math.abs(t.taxable + t.cgst + t.sgst - t.grand_total) < 0.01);
  assert.ok(rec.payload.charges.length > 0 && 'cgst_rate' in rec.payload.charges[0]);
  assert.equal(JSON.stringify(rec).includes('template_bl_path'), false);
  const store = new EventStore(path.join(dir, 'evidence'));
  assert.equal(ingest(store, path.join(outbox, 'biil_unified.jsonl')).ingested, 1);
  assert.equal(store.query({ application: 'biil_unified' })[0].artifacts.length, outputs.length);
});
