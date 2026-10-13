// Reproducible end-to-end check of the real Workflow Synchroniser with the
// forensic layer, on disposable data. Prints one line per step and exits
// non-zero if any step fails.
//
//   node e2e/run_e2e.js            (from forensics/)
//
// Everything lives in a temp folder: its own db.json, uploads, downloads,
// evidence store and external anchor. The live application data is not opened.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startSync, sampleInfo, pythonCanCompile, PYTHON } from '../test/helpers.js';
import { checklistPdf } from '../synthetic/lib.js';
import { EventStore, sha256 } from '../src/store.js';
import { reconcile } from '../src/model.js';
import { createDashboard } from '../src/dashboard.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe2e-'));
const anchor = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fe2e-anchor-')), 'witness.jsonl');
const env = { FORENSIC_ANCHOR_FILE: anchor };
process.env.FORENSIC_ANCHOR_FILE = anchor; // the dashboard in this process writes reviewer decisions to the same chain
const ME = 'Desk 1 (Invoice)';
let failed = 0, n = 0;
const step = (name, ok, detail = '') => { n++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(n).padStart(2)}. ${name}${detail ? '  [' + detail + ']' : ''}`); };
const store = () => new EventStore(path.join(dir, 'evidence'), { anchorFile: anchor });
const events = () => store().readAll().records.map(x => x.record);
const count = a => events().filter(e => e.action === a).length;

console.log(`Disposable instance: ${dir}\nPython for document generation: ${PYTHON} (openpyxl+pdfplumber ${pythonCanCompile ? 'available' : 'MISSING'})\n`);

let s = await startSync({ dir, env });
step('synchroniser starts; system.started recorded', count('system.started') === 1);
step('unauthenticated API request refused', (await s.anon('GET', '/api/jobs')).status === 401);
step('login creates a session', (await s.anon('POST', '/api/login', { username: 'desk1', password: 'desk1' })).status === 200);

// upload + parse a synthetic checklist
const info = sampleInfo({ job_no: 'E2E-0001' });
const pdf = checklistPdf({ shipper: info.shipper, consignee: info.consignee, job_no: info.job_no, sb_no: '9000001', sb_date: '06/01/2026', invoice_no: 'SYN/001', invoice_date: '05/01/2026', port: 'ROTTERDAM', net_kg: 20000, gross_kg: 20200, pkgs: 400, pkg_unit: 'BAG', container_no: 'CSQU3054383' });
const form = new FormData();
form.append('checklist', new Blob([pdf], { type: 'application/pdf' }), 'synthetic_checklist.pdf');
const up = await fetch(s.base + '/api/parse-checklist', { method: 'POST', body: form, headers: { Cookie: await s.cookieFor('desk1') } });
const parsed = await up.json().catch(() => ({}));
step('checklist upload parsed by pdf_parser.py', up.status === 200 && parsed.gross_weight === '20200 KGS' && parsed.job_no === 'E2E-0001', `status ${up.status}, gross "${parsed.gross_weight}"`);
step('source.uploaded with file hash, source.parsed', count('source.uploaded') === 1 && count('source.parsed') === 1);

// create (generates documents)
const created = await s.call('POST', '/api/jobs', { info: { ...info, checklist_pdf_url: parsed.checklist_pdf_url }, creator: 'Desk 1 (Invoice)' });
const id = created.json?.id;
step('job created', created.status === 201);
const gen = events().find(e => e.action === 'document.generated');
step('documents generated and hashed', !!gen && gen.artifacts.length === 2 && gen.artifacts.every(a => /^[0-9a-f]{64}$/.test(a.sha256)), gen ? gen.artifacts.map(a => a.path).join(', ') : s.log().slice(-300));
step('generated files downloadable', gen ? (await fetch(s.base + gen.artifacts[0].path, { headers: { Cookie: await s.cookieFor('desk1') } })).status === 200 : false);
step('job linked to its uploaded source', events().find(e => e.action === 'job.created').payload.source_links.length === 1);

// modify, twice with the same content afterwards (repeated operation)
const edited = { ...info, gross_weight: '19000 KGS', containers: [{ ...info.containers[0], gross_wt: 19000 }] };
step('job modified', (await s.call('PUT', `/api/jobs/${id}`, { info: edited, creator: ME })).status === 200);
const upd = events().find(e => e.action === 'job.updated');
step('field-level change with old and new value', upd.changes.some(c => c.field === 'gross_weight' && c.old === '20200 KGS' && c.new === '19000 KGS'));
await s.call('PUT', `/api/jobs/${id}`, { info: edited, creator: ME });
await s.call('PUT', `/api/jobs/${id}`, { info: edited, creator: ME });
const gens = events().filter(e => e.action === 'document.generated');
step('repeated identical saves: same input hash, same content fingerprint, new generation numbers', gens.length === 4 && gens[2].payload.input_sha256 === gens[3].payload.input_sha256 && gens[2].artifacts[0].content_fingerprint === gens[3].artifacts[0].content_fingerprint && gens[3].generation_number === 4);

// workflow
const job = (await s.call('GET', '/api/jobs')).json.find(j => j.id === id);
const sid = name => job.workflow_steps.find(w => w.name === name).id;
step('workflow step completed', (await s.call('PUT', `/api/jobs/${id}/workflow/${sid('Shipping Instruction Received')}`, { status: 'Completed', user: ME })).status === 200);
await s.call('PUT', `/api/jobs/${id}/workflow/${sid('Shipping Instruction Received')}`, { status: 'Pending', user: ME });
step('step reversal recorded with old status', events().filter(e => e.action === 'workflow_step.status_changed').at(-1).changes.some(c => c.old === 'Completed' && c.new === 'Pending'));

// restart
const oldCookie = await s.cookieFor('desk1');
await s.stop();
s = await startSync({ dir, env });
step('restart: no duplicate baseline, second system.started', count('job.baseline_captured') === 0 && count('system.started') === 2);
step('restart: session from before the restart is refused', (await fetch(s.base + '/api/jobs', { headers: { Cookie: oldCookie } })).status === 401);
const corr = events().find(e => e.action === 'job.created').correlation_id;
await s.call('PUT', `/api/jobs/${id}/workflow/${sid('Job Closed')}`, { status: 'Completed', user: ME, closingDetails: { bill_no: 'B1', bill_amount: 61950, sgst: 4725, cgst: 4725 } });
step('after restart the job keeps its correlation id', events().find(e => e.action === 'job.closed')?.correlation_id === corr);

// reconciliation before deletion
step('evidence agrees with db.json', reconcile(s.db(), events()).ok, JSON.stringify(reconcile(s.db(), events()).problems.slice(0, 2)));

// second job, then delete the first
await s.call('POST', '/api/jobs', { info: sampleInfo({ job_no: 'E2E-0002' }), creator: ME });
step('job deleted', (await s.call('DELETE', `/api/jobs/${id}`)).status === 200);
step('operational history gone, evidence snapshot kept', !s.db().history_logs.some(l => l.job_id === id) && events().find(e => e.action === 'job.delete_requested').payload.snapshot.job_no === 'E2E-0001');

// integrity
const v = store().verify();
step('evidence chain verifies, every record externally witnessed', v.ok && v.anchor.witnessed === v.count, `${v.count} events; ${v.problems.map(p => p.type).join(',')}`);
step('artifact archive: every stored copy hashes to its recorded sha256', gens.every(g => g.artifacts.every(a => { const f = path.join(dir, 'evidence', 'artifacts', a.sha256 + '.xlsx'); return fs.existsSync(f) && sha256(fs.readFileSync(f)) === a.sha256; })), `${gens.reduce((t, g) => t + g.artifacts.length, 0)} files`);

// dashboard on the same evidence
const dash = createDashboard({ dir: path.join(dir, 'evidence'), reviewToken: 'e2e-token' });
await new Promise(r => dash.listen(0, '127.0.0.1', r));
const dbase = `http://127.0.0.1:${dash.address().port}`;
const ov = await (await fetch(dbase + '/api/overview')).json();
const c = ov.cases.find(x => x.job_no === 'E2E-0001');
step('dashboard lists a case for the deleted job', !!c, c ? `${c.case_id} priority ${c.priority}` : 'no case');
const detail = c ? await (await fetch(`${dbase}/api/cases/${c.case_id}`)).json() : null;
step('case timeline reconstructs the deleted job', !!detail && detail.timeline.length > 15 && detail.timeline.some(t => t.action === 'job.deleted'), detail ? `${detail.timeline.length} entries, findings: ${detail.findings.map(f => f.rule_id).join(',')}` : '');
step('reviewer disposition recorded into the chain', c ? (await fetch(`${dbase}/api/cases/${c.case_id}/disposition`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': 'e2e-token' }, body: JSON.stringify({ disposition: 'requires_review', reviewer: 'e2e', note: 'automated check' }) })).status === 201 : false);
dash.close();
await s.stop();
step('final chain verification', store().verify().ok);

console.log(`\n${n - failed}/${n} steps passed. Events captured: ${events().length}.`);
process.exit(failed ? 1 : 0);
