// Business-rule configuration seen through both investigator interfaces: cli.js and the dashboard.
// Missing, all-null, valid, changed and invalid configuration; no silent fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { EventStore } from '../src/store.js';
import { createDashboard } from '../src/dashboard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fbr-'));

// One closed job: charges 1000 (O/F), closing amount 1000 = the taxable total.
function evidence() {
  const dir = tmp(), store = new EventStore(dir, { remote: null, anchorFile: null });
  const base = { application: 'workflow_sync', entity_type: 'job', entity_id: '1', job_no: 'BR-1', correlation_id: 'c1' };
  const st = { job_no: 'BR-1', type: 'sea_export', status: 'Active', billing_charges: [{ key: 'O/F', description: 'O/F - X', amount: 1000 }], containers: [], documents: [],
    workflow_steps: [{ key: 'Job Created', name: 'Job Created', status: 'Completed' }, { key: 'OOC', name: 'OOC', status: 'Pending' }, { key: 'Job Closed', name: 'Job Closed', status: 'Pending' }], closing_bill_no: '', closing_bill_amount: '', closing_sgst: '', closing_cgst: '' };
  store.append({ ...base, action: 'job.created', operation_id: 'a', payload: { stored: st, state_hash: 'x', source_links: [] } });
  store.append({ ...base, action: 'workflow_step.status_changed', operation_id: 'b', changes: [{ field: 'workflow_steps[Job Closed].status', old: 'Pending', new: 'Completed' }], payload: { list: 'workflow_steps', item_name: 'Job Closed', job_status: 'Closed', closing: { bill_no: 'B', bill_amount: 1000, sgst: 90, cgst: 90 }, state_hash: 'y' } });
  store.append({ ...base, action: 'job.closed', operation_id: 'b', changes: [], payload: {} });
  return dir;
}

const cli = (dir, rulesFile) => spawnSync(process.execPath, [path.join(here, '..', 'cli.js'), 'cases', '--dir', dir], { encoding: 'utf8', env: { ...process.env, FORENSIC_BUSINESS_RULES: rulesFile, FORENSIC_ANCHOR_URL: '' } });

async function dashboard(dir, rulesFile) {
  process.env.FORENSIC_BUSINESS_RULES = rulesFile;
  const d = createDashboard({ dir });
  await new Promise(r => d.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${d.address().port}/api/overview`);
    return { status: res.status, body: await res.json() };
  } finally { d.close(); }
}

test('CLI and dashboard report the same cases and the same business-rule status for every configuration', async () => {
  const dir = evidence(), cfgDir = tmp();
  const file = path.join(cfgDir, 'rules.json');
  const states = [
    ['missing file', null, 3],
    ['all null', { required_before_close: null, tax_scheme: null, closing_bill_basis: null }, 3],
    ['valid', { required_before_close: ['OOC'], tax_scheme: 'flat_9_9', closing_bill_basis: 'grand_total' }, 0],
    ['changed', { required_before_close: ['Job Created'], tax_scheme: null, closing_bill_basis: 'taxable_total' }, 1]
  ];
  const seen = [];
  for (const [name, content, unresolved] of states) {
    if (content) fs.writeFileSync(file, JSON.stringify(content)); else fs.rmSync(file, { force: true });
    const c = cli(dir, file);
    assert.equal(c.status, 0, name + ': ' + c.stderr);
    const d = await dashboard(dir, file);
    assert.equal(d.status, 200, name);
    assert.equal(d.body.business_rules.unresolved.length, unresolved, name);
    if (unresolved) assert.match(c.stdout, new RegExp(`Business rules NOT configured: ${d.body.business_rules.unresolved.join(', ')}`), name);
    else assert.match(c.stdout, /Business rules configured from/, name);
    const cliCases = c.stdout.split('\n').filter(l => /^CASE-/.test(l)).map(l => l.split(/\s+/).slice(0, 2).join(' '));
    assert.deepEqual(cliCases, d.body.cases.map(x => `${x.case_id} ${x.priority}`), `${name}: same queue`);
    seen.push(d.body.cases[0]?.priority ?? 0);
  }
  // Configured closing basis "grand_total" rejects a closing amount equal to the taxable total; the others accept it.
  assert.ok(seen[2] > seen[0], `valid configuration changes the result (${seen})`);
});

test('invalid configuration is refused loudly by both interfaces, never treated as unset', async () => {
  const dir = evidence(), file = path.join(tmp(), 'rules.json');
  for (const bad of ['{not json', JSON.stringify({ tax_scheme: '18%' }), JSON.stringify({ closing_bill_basis: 'total' }), JSON.stringify({ required_before_close: 'some' })]) {
    fs.writeFileSync(file, bad);
    const c = cli(dir, file);
    assert.notEqual(c.status, 0, bad);
    assert.match(c.stderr, /invalid business rules/, bad);
    const d = await dashboard(dir, file);
    assert.equal(d.status, 500, bad);
    assert.match(d.body.error, /invalid business rules/, bad);
  }
});

test.after(() => { delete process.env.FORENSIC_BUSINESS_RULES; });
