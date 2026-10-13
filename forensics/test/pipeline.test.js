// Evidence pipeline for the desktop tools: delivery, duplicates, bad data, retry,
// artifact hashes, and the real windows (opt-in).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { REPO, PYTHON } from './helpers.js';
import { EventStore, sha256, ForensicWriteError } from '../src/store.js';
import { outboxAppend, ingest, verifyArtifacts } from '../src/ingest.js';
import { analyze, caseDetail } from '../src/cases.js';
import { biilRecord, stuffingRecord, rng } from '../synthetic/lib.js';
import { sampleInfo } from './helpers.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fpipe-'));
const all = s => s.readAll().records.map(x => x.record);
const jobEvent = (store, info, corr = 'c1', id = '1') => store.append({ application: 'workflow_sync', action: 'job.created', entity_type: 'job', entity_id: id, job_no: info.job_no, correlation_id: corr, operation_id: 'o' + id, actor: { display_name: 'Desk 1 (Invoice)', source: 'session', verified: true }, payload: { stored: { ...info, status: 'Active', documents: [], workflow_steps: [] }, state_hash: 'h', source_links: [] } });

test('missing outbox file: nothing ingested, nothing thrown', () => {
  assert.deepEqual(ingest(new EventStore(tmp()), path.join(tmp(), 'absent.jsonl')), { ingested: 0, skipped_duplicates: 0, rejected: [] });
});

test('invalid lines are rejected with a reason and do not block valid ones', () => {
  const dir = tmp(), store = new EventStore(dir), file = path.join(dir, 'o.jsonl');
  const good = outboxAppend(file, { application: 'biil_unified', action: 'document.batch_generated', payload: {} });
  fs.appendFileSync(file, ['[1,2]', '"text"', JSON.stringify({ ...good, source_event_id: 'x1', occurred_at: 'yesterday' }), JSON.stringify({ ...good, source_event_id: 'x2', application: 'forensic_layer' }), ''].join('\n') + '\n');
  outboxAppend(file, { application: 'stuffing_report', action: 'stuffing_report.exported', payload: {} });
  const r = ingest(store, file);
  assert.equal(r.ingested, 2);
  assert.deepEqual(r.rejected.map(x => x.reason), ['missing source_event_id', 'not an object', 'occurred_at is not a timestamp', 'reserved application name']);
  assert.deepEqual(store.verify().problems, []);
});

test('duplicate delivery: same record in two files, and a re-run, are ingested once', () => {
  const dir = tmp(), store = new EventStore(dir), a = path.join(dir, 'a.jsonl'), b = path.join(dir, 'b.jsonl');
  const rec = outboxAppend(a, { application: 'biil_unified', action: 'document.batch_generated', payload: { n: 1 } });
  fs.writeFileSync(b, JSON.stringify(rec) + '\n' + JSON.stringify(rec) + '\n');
  assert.equal(ingest(store, a).ingested, 1);
  assert.deepEqual(ingest(store, b), { ingested: 0, skipped_duplicates: 2, rejected: [] });
  assert.equal(ingest(store, a).skipped_duplicates, 1);
  assert.equal(store.query({ application: 'biil_unified' }).length, 1);
});

test('retry: a failure part-way through loses nothing and duplicates nothing', () => {
  const dir = tmp(), store = new EventStore(dir), file = path.join(dir, 'o.jsonl');
  for (let i = 0; i < 5; i++) outboxAppend(file, { application: 'biil_unified', action: 'x.y', payload: { i } });
  const real = store.append.bind(store);
  let calls = 0;
  store.append = (...args) => { if (++calls === 3) throw new ForensicWriteError('disk full (simulated)'); return real(...args); };
  assert.throws(() => ingest(store, file), ForensicWriteError, 'the failure is surfaced, not swallowed');
  store.append = real;
  assert.equal(store.query({ application: 'biil_unified' }).length, 2, 'records before the failure are in the chain');
  const again = ingest(store, file);
  assert.deepEqual([again.ingested, again.skipped_duplicates], [3, 2]);
  assert.deepEqual(store.query({ application: 'biil_unified' }).map(e => e.payload.i), [0, 1, 2, 3, 4]);
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 5, 'the outbox is never truncated by ingestion');
});

test('a line still being written is rejected now and ingested once complete', () => {
  const dir = tmp(), store = new EventStore(dir), file = path.join(dir, 'o.jsonl');
  const full = JSON.stringify({ source_event_id: 'late-1', occurred_at: new Date().toISOString(), application: 'visualizer_3d', action: 'packing.run_completed', payload: {} });
  fs.writeFileSync(file, full.slice(0, 40));
  assert.equal(ingest(store, file).rejected[0].reason, 'invalid JSON');
  fs.writeFileSync(file, full + '\n');
  assert.equal(ingest(store, file).ingested, 1);
});

test('artifact hashes: unchanged, changed and missing files are told apart', () => {
  const dir = tmp(), store = new EventStore(dir);
  const files = ['same.xlsx', 'changed.xlsx', 'gone.xlsx'].map(n => { const f = path.join(dir, n); fs.writeFileSync(f, 'content of ' + n); return f; });
  store.append({ application: 'biil_unified', action: 'document.batch_generated', entity_type: 'document_batch', artifacts: [...files.map(f => ({ role: 'out', path: f, sha256: sha256(fs.readFileSync(f)) })), { role: 'src', path: 'x.pdf', sha256: null, error: 'not found' }] });
  fs.writeFileSync(files[1], 'edited afterwards');
  fs.rmSync(files[2]);
  // a synchroniser output: checked against the archived copy, because the live file is overwritten by design
  const body = Buffer.from('generated workbook bytes');
  fs.mkdirSync(path.join(dir, 'artifacts'));
  fs.writeFileSync(path.join(dir, 'artifacts', sha256(body) + '.xlsx'), body);
  store.append({ application: 'workflow_sync', action: 'document.generated', entity_type: 'job', artifacts: [{ role: 'instruction_sheet', path: '/downloads/BL.xlsx', sha256: sha256(body) }, { role: 'billing_invoice', path: '/downloads/B.xlsx', sha256: 'e'.repeat(64) }] });
  const st = verifyArtifacts(all(store), dir).map(x => x.status);
  assert.deepEqual(st, ['file_unchanged', 'file_changed_since_capture', 'not_available', 'no_hash_recorded', 'archived_copy_verified', 'not_available']);
  fs.writeFileSync(path.join(dir, 'artifacts', sha256(body) + '.xlsx'), 'tampered archive');
  assert.ok(verifyArtifacts(all(store), dir).some(x => x.status === 'ARCHIVED_COPY_ALTERED'));
});

test('B.I.I.L. and stuffing-report evidence reaches the analysis and the case view', () => {
  const dir = tmp(), store = new EventStore(dir), file = path.join(dir, 'o.jsonl'), r = rng(1);
  const info = sampleInfo({ job_no: 'SYN-PIPE-1' });
  jobEvent(store, info);
  outboxAppend(file, biilRecord(r, info, new Date(), { fields: { gross_weight: '25000 KGS' } }));   // linked by job number, weight differs
  outboxAppend(file, stuffingRecord(info, new Date(), { packages: '390' }));                       // no job number: linked by container, count differs
  outboxAppend(file, biilRecord(r, { ...info, containers: [] }, new Date(), { shipment_ref: 'NO-SUCH-JOB' }));   // belongs to nothing here
  assert.equal(ingest(store, file).ingested, 3);
  const a = analyze(all(store), { integrity: store.verify() });
  const ids = a.findings.map(f => f.rule_id);
  assert.ok(ids.includes('XAP-GROSS_WEIGHT') && ids.includes('XAP-PACKAGES'));
  const d = caseDetail(a, a.cases[0].case_id);
  assert.deepEqual(d.provenance.external_records.map(x => [x.application, x.entity_match.method, x.entity_match.confidence]), [['biil_unified', 'job_no_exact_after_normalisation', 0.9], ['stuffing_report', 'container_number_match', 0.6]]);
  assert.equal(a.context.external.find(e => e.payload.shipment_ref === 'NO-SUCH-JOB')._link.method, 'unlinked', 'an unsupported link is not forced');
  const cx = d.provenance.contradictions.find(c => c.field === 'packages');
  assert.equal(cx.entity_match.confidence, 0.6);
  assert.deepEqual(cx.items.map(i => i.original), ['400 BAGS', '390'], 'original values are preserved next to the normalised ones');
  assert.deepEqual(cx.items.map(i => i.normalized), [400, 390]);
  assert.ok(d.timeline.filter(t => t.application !== 'workflow_sync').every(t => t.time_basis === 'source application clock' && t.ingested_at));
  assert.match(d.provenance.trust.integrity, /All captured records verify/);
  assert.ok(d.findings.every(f => f.assessment));
});

test('mismatched identifiers: a low-confidence or ambiguous link never becomes a contradiction', () => {
  const dir = tmp(), store = new EventStore(dir), file = path.join(dir, 'o.jsonl'), r = rng(2);
  const info = sampleInfo({ job_no: 'SYN-PIPE-2' });
  jobEvent(store, info, 'c1', '1');
  jobEvent(store, { ...info, containers: [{ ...info.containers[0], container_no: 'SYAU1234564' }] }, 'c2', '2');   // same job number on a second lifecycle
  outboxAppend(file, biilRecord(r, { ...info, containers: [] }, new Date(), { fields: { gross_weight: '1 KGS' } }));
  ingest(store, file);
  const a = analyze(all(store));
  assert.equal(a.findings.filter(f => f.kind === 'anomaly').length, 0);
  const notes = a.findings.filter(f => f.rule_id === 'XAP-UNATTRIBUTED');
  assert.equal(notes.length, 2, 'shown on both candidates');
  assert.ok(notes.every(f => f.kind === 'data_quality' && f.details.classification === 'insufficient_evidence' && f.details.link.ambiguous));
  assert.ok(a.cases.every(c => c.priority.band === 'informational'));
});

test('contradiction analysis can be configured and switched off', () => {
  const dir = tmp(), store = new EventStore(dir), file = path.join(dir, 'o.jsonl'), r = rng(3);
  const info = sampleInfo({ job_no: 'SYN-PIPE-3' });
  jobEvent(store, info);
  outboxAppend(file, biilRecord(r, info, new Date(), { fields: { gross_weight: '20290 KGS' } }));   // 0.45% off
  ingest(store, file);
  const ids = cfg => analyze(all(store), cfg).findings.map(f => f.rule_id).filter(x => x.startsWith('XAP-G'));
  assert.deepEqual(ids({}), [], 'inside the default 0.5% tolerance');
  assert.deepEqual(ids({ provenance_config: { weight_tolerance: { abs: 1, rel: 0.001 } } }), ['XAP-GROSS_WEIGHT']);
  assert.deepEqual(ids({ provenance_config: { weight_tolerance: { abs: 1, rel: 0.001 }, enabled_comparisons: ['packages'] } }), []);
  assert.deepEqual(ids({ provenance_config: { weight_tolerance: { abs: 1, rel: 0.001 } }, contradictions: false }), []);
  assert.equal(analyze(all(store), { provenance: false }).provenance.size, 0);
});

// ---- the real windows. Opt-in: they open on screen and the WPF one replaces the clipboard briefly. ----
const gui = process.env.FORENSIC_GUI_TESTS === '1' && process.platform === 'win32' ? false : 'set FORENSIC_GUI_TESTS=1 to drive the real application windows';

test('GUI: 3D visualizer window -> bridge -> outbox -> chain', { skip: gui, timeout: 180000 }, () => {
  const dir = tmp(), outbox = path.join(dir, 'outbox');
  const run = spawnSync(PYTHON, [path.join(REPO, 'forensics', 'e2e', 'visualizer_gui.py'), 'GUI-REF-7'], { env: { ...process.env, FORENSIC_OUTBOX_DIR: outbox }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const recs = fs.readFileSync(path.join(outbox, 'visualizer_3d.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(recs.length >= 2, 'first run (once the bridge is ready) and the clicked recalculation');
  assert.equal(recs.at(-1).shipment_ref, 'GUI-REF-7', 'reference typed in the page arrives with the evidence');
  assert.ok(recs.at(-1).payload.placed_count > 0 && recs.at(-1).payload.container.name);
  assert.equal(ingest(new EventStore(path.join(dir, 'e')), path.join(outbox, 'visualizer_3d.jsonl')).ingested, recs.length);
});

for (const [name, exe, app, action] of [
  ['EasyQuote', 'EasyQuote/bin/Debug/net10.0-windows/win-x64/EasyQuote.exe', 'easyquote_export', 'quotation.exported'],
  ['EasyQuoteImport', 'EasyQuote/EasyQuoteImport/bin/Debug/net10.0-windows/win-x64/EasyQuoteImport.exe', 'easyquote_import', 'quotation.exported'],
  ['StuffingReport', 'EasyQuote/StuffingReport/bin/Debug/net10.0-windows/win-x64/StuffingReport.exe', 'stuffing_report', 'stuffing_report.exported']
]) {
  const exePath = path.join(REPO, exe);
  test(`GUI: ${name} window, real button click -> outbox -> chain`, { skip: gui || (fs.existsSync(exePath) ? false : `${name} is not built (dotnet build)`), timeout: 120000 }, () => {
    const dir = tmp(), outbox = path.join(dir, 'outbox');
    const run = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(REPO, 'forensics', 'e2e', 'wpf_click.ps1'), '-Exe', exePath, '-Button', 'Copy HTML Table for Email', '-Outbox', outbox], { encoding: 'utf8' });
    assert.match(run.stdout, /clicked/, run.stderr);
    const rec = JSON.parse(fs.readFileSync(path.join(outbox, app + '.jsonl'), 'utf8').trim().split('\n')[0]);
    assert.equal(rec.action, action);
    assert.equal(rec.payload.format, 'clipboard_html');
    assert.ok(rec.payload.rows.length >= 11);
    assert.equal(rec.actor_source, 'os_account_claimed');
    assert.equal(rec.shipment_ref, null, 'no shipment reference is invented');
    assert.equal(ingest(new EventStore(path.join(dir, 'e')), path.join(outbox, app + '.jsonl')).ingested, 1);
  });
}
