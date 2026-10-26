// The real Workflow Synchroniser UI and the investigation dashboard, driven in a real
// browser (the installed Microsoft Edge or Chrome, through playwright-core). Disposable data only.
// Skipped with a reason when no browser or playwright-core is available.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startSync, pythonCanCompile } from './helpers.js';
import { checklistPdf, biilRecord, rng } from '../synthetic/lib.js';
import { EventStore } from '../src/store.js';
import { outboxAppend, ingest } from '../src/ingest.js';
import { createDashboard } from '../src/dashboard.js';

let chromium = null, channel = null;
try {
  ({ chromium } = await import('playwright-core'));
  channel = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].some(p => fs.existsSync(p)) ? 'msedge'
    : fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : null;
} catch { /* not installed */ }
const skip = !chromium ? 'playwright-core is not installed (npm install in forensics/)' : !channel ? 'no Edge or Chrome installation found' : process.env.FORENSIC_BROWSER_TESTS === '0' ? 'FORENSIC_BROWSER_TESTS=0' : false;
const events = s => new EventStore(s.evidenceDir).readAll().records.map(x => x.record);

async function openBrowser(t) {
  const browser = await chromium.launch({ channel, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const jsErrors = [], consoleErrors = [], dialogs = [];
  page.on('pageerror', e => jsErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  // Nothing leaves the machine: external fonts and anything else off localhost are blocked.
  await page.route('**/*', r => (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(r.request().url()) ? r.continue() : r.abort()));
  return { browser, page, jsErrors, consoleErrors, dialogs };
}

async function signIn(page, base, username, password) {
  await page.goto(base + '/');
  // let the page finish checking any remembered session before signing in
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.waitForSelector('#login-overlay:not(.hidden)', { timeout: 10000 }).catch(async () => {
    if (process.env.FORENSIC_BROWSER_SHOTS) await page.screenshot({ path: path.join(process.env.FORENSIC_BROWSER_SHOTS, `signin-${username}.png`) });
    throw new Error('sign-in screen not shown: ' + JSON.stringify(await page.evaluate(() => ({ login: document.getElementById('login-overlay').className, ws: document.getElementById('workspace-selector-overlay').className, app: document.getElementById('app-container').className, user: localStorage.getItem('currentUser') }))));
  });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('#login-form button[type=submit]');
}

test('synchroniser UI: sign-in, jobs, upload, workflow, roles, password, session loss, evidence failure', { skip, timeout: 240000 }, async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const { page, jsErrors, consoleErrors, dialogs } = await openBrowser(t);

  await t.test('invalid credentials are refused with a neutral message', async () => {
    await signIn(page, s.base, 'desk1', 'Definitely-Wrong-123');
    await page.waitForSelector('#login-error:not(.hidden)');
    assert.equal(await page.textContent('#login-error'), 'Invalid username or password.');
    assert.equal(await page.isVisible('#app-container'), false);
  });

  await t.test('valid sign-in reaches the workspace and job list', async () => {
    await signIn(page, s.base, 'desk1', s.password('desk1'));
    await page.click('.workspace-card[data-workspace="sea_export"]');
    await page.waitForSelector('#app-container:not(.hidden)');
    assert.match(await page.textContent('#current-user-name'), /Desk 1/);
    assert.match(await page.textContent('#job-list-tbody'), /No shipments/, 'empty state shown');
    assert.equal(await page.isVisible('#drawer-btn-delete'), false, 'delete hidden for a desk user');
  });

  await t.test('checklist upload autofills the form; job creation generates documents', async () => {
    await page.click('#btn-add-job');
    const pdf = checklistPdf({ shipper: 'BROWSER TEST EXPORTS\n1 Test Road', consignee: 'BROWSER TEST IMPORTS\n2 Quay', job_no: 'BRW-0001', sb_no: '9000001', sb_date: '06/01/2026', invoice_no: 'SYN/001', invoice_date: '05/01/2026', port: 'ROTTERDAM', net_kg: 20000, gross_kg: 20200, pkgs: 400, pkg_unit: 'BAG', container_no: 'CSQU3054383' });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fbrw-')), 'checklist.pdf');
    fs.writeFileSync(file, pdf);
    await page.setInputFiles('#modal-upload-pdf', file);
    await page.waitForSelector('#autofill-status.success, #autofill-status.error', { timeout: 30000 });
    assert.match(await page.textContent('#autofill-status'), /Autofill Success/);
    assert.equal(await page.inputValue('#form-job_no'), 'BRW-0001');
    await page.click('#modal-btn-submit');
    await page.waitForSelector('#job-list-tbody tr[data-job-id]', { timeout: 30000 });
    const created = events(s).find(e => e.action === 'job.created');
    assert.equal(created.actor.username, 'desk1');
    assert.equal(created.payload.source_links.length, 1, 'browser upload linked to the job');
    if (pythonCanCompile) assert.ok(events(s).some(e => e.action === 'document.generated'));
  });

  await t.test('editing a job records field-level changes', async () => {
    await page.click('#job-list-tbody tr[data-job-id]');
    await page.click('#drawer-btn-edit');
    await page.evaluate(() => { document.getElementById('form-gross_weight').value = '19500 KGS'; });
    await page.click('#modal-btn-submit');
    await page.waitForFunction(() => !document.getElementById('job-modal').classList.contains('active'));
    await new Promise(r => setTimeout(r, 500));
    const upd = events(s).find(e => e.action === 'job.updated');
    assert.ok(upd.changes.some(c => c.field === 'gross_weight' && c.new === '19500 KGS'));
  });

  await t.test('workflow step ticked in the drawer is captured', async () => {
    const before = await page.locator('.flowchart-node.completed').count();
    await page.locator('.flowchart-node.pending input[type=checkbox]').first().check();
    await page.waitForFunction(n => document.querySelectorAll('.flowchart-node.completed').length > n, before);
    assert.ok(events(s).some(e => e.action === 'workflow_step.status_changed' && e.actor.username === 'desk1'));
  });

  await t.test('role enforcement: a desk user cannot delete, even by calling the API from the page', async () => {
    const id = (await s.call('GET', '/api/jobs')).json[0].id;
    const status = await page.evaluate(id => fetch(`/api/jobs/${id}`, { method: 'DELETE' }).then(r => r.status), id);
    assert.equal(status, 403);
    assert.equal(s.db().jobs.length, 1);
  });

  await t.test('evidence store unavailable: the change is refused and the user is told', async () => {
    const file = path.join(s.evidenceDir, 'events.jsonl');
    fs.renameSync(file, file + '.bak');
    fs.mkdirSync(file);
    const completedBefore = s.db().workflow_steps.filter(w => w.status === 'Completed').length;
    try {
      dialogs.length = 0;
      await page.locator('.flowchart-node.pending input[type=checkbox]').first().check();
      await page.waitForFunction(() => true, null, { timeout: 2000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
      assert.ok(dialogs.some(d => /evidence/i.test(d)), `user saw: ${JSON.stringify(dialogs)}`);
      assert.match(dialogs.find(d => /evidence/i.test(d)), /nothing was saved/);
      assert.equal(s.db().workflow_steps.filter(w => w.status === 'Completed').length, completedBefore, 'nothing changed');
    } finally {
      fs.rmdirSync(file);
      fs.renameSync(file + '.bak', file);
    }
  });

  await t.test('password change from the screen; old password stops working', async () => {
    const old = s.password('desk1');
    await page.click('#drawer-btn-close');
    await page.click('#btn-change-password');
    await page.fill('#pw-current', old);
    await page.fill('#pw-new', 'Browser-Changed-Secret-8');
    await page.fill('#pw-repeat', 'Browser-Changed-Secret-9');
    await page.click('#password-btn-submit');
    assert.match(await page.textContent('#password-error'), /do not match/);
    await page.fill('#pw-repeat', 'Browser-Changed-Secret-8');
    await page.click('#password-btn-submit');
    await page.waitForFunction(() => !document.getElementById('password-modal').classList.contains('active'));
    assert.equal((await s.anon('POST', '/api/login', { username: 'desk1', password: old })).status, 401);
    assert.equal((await s.anon('POST', '/api/login', { username: 'desk1', password: 'Browser-Changed-Secret-8' })).status, 200);
    assert.equal(await page.evaluate(() => fetch('/api/jobs').then(r => r.status)), 200, 'this browser keeps a fresh session');
  });

  await t.test('session ended elsewhere: the next action returns to the sign-in screen', async () => {
    await (await s.as('admin'))('POST', '/api/users/desk1/password', { new_password: 'Admin-Reset-Value-31' });
    await page.click('.menu-btn[data-filter="all"]').catch(() => {});
    await page.evaluate(() => fetch('/api/jobs'));
    await page.waitForSelector('#login-overlay:not(.hidden)');
  });

  await t.test('forced password change after an administrator reset', async () => {
    await signIn(page, s.base, 'desk1', 'Admin-Reset-Value-31');
    await page.waitForSelector('#password-modal.active', { timeout: 10000 }).catch(async () => {
      throw new Error('state: ' + JSON.stringify(await page.evaluate(() => ({ err: document.getElementById('login-error').className + ' ' + document.getElementById('login-error').textContent, login: document.getElementById('login-overlay').className, modal: document.getElementById('password-modal').className, user: localStorage.getItem('currentUser') }))));
    });
    assert.equal(await page.isVisible('#password-required-note'), true);
    assert.equal(await page.isVisible('#password-btn-cancel'), false, 'cannot be dismissed');
    await page.fill('#pw-current', 'Admin-Reset-Value-31');
    await page.fill('#pw-new', 'Desk-One-Own-Choice-4');
    await page.fill('#pw-repeat', 'Desk-One-Own-Choice-4');
    await page.click('#password-btn-submit');
    await page.waitForFunction(() => !document.getElementById('password-modal').classList.contains('active'));
  });

  await t.test('administrator sees the delete control and can delete; logout ends the session', async () => {
    await page.click('.workspace-card[data-workspace="sea_export"]');
    await page.click('#btn-logout');
    await page.waitForSelector('#login-overlay:not(.hidden)');
    assert.equal(await page.evaluate(() => fetch('/api/jobs').then(r => r.status)), 401);
    await signIn(page, s.base, 'admin', s.password('admin'));
    await page.click('.workspace-card[data-workspace="sea_export"]').catch(() => {});
    await page.waitForSelector('#job-list-tbody tr[data-job-id]');
    await page.click('#job-list-tbody tr[data-job-id]');
    assert.equal(await page.isVisible('#drawer-btn-delete'), true);
    await page.click('#drawer-btn-delete');
    await page.click('#confirm-btn-submit');
    await page.waitForFunction(() => !document.querySelector('#job-list-tbody tr[data-job-id]'));
    assert.equal(s.db().jobs.length, 0);
    assert.ok(events(s).some(e => e.action === 'job.delete_requested' && e.actor.role === 'Admin'));
  });

  await t.test('no JavaScript errors; console errors only for the requests the tests made fail', () => {
    assert.deepEqual(jsErrors, []);
    // Expected: refused requests (401/403/503), blocked external fonts, and the event stream reporting the session loss the test caused.
    const unexpected = consoleErrors.filter(m => !/Failed to load resource: the server responded with a status of (401|403|503)/.test(m) && !/net::ERR_FAILED|ERR_BLOCKED/.test(m) && !/SSE Connection failed/.test(m));
    assert.deepEqual(unexpected, []);
  });
});

test('investigation dashboard: empty, malformed and populated evidence; provenance and contradictions', { skip, timeout: 120000 }, async t => {
  const { page, jsErrors } = await openBrowser(t);
  const serve = async dir => {
    const d = createDashboard({ dir });
    await new Promise(r => d.listen(0, '127.0.0.1', r));
    t.after(() => d.close());
    return `http://127.0.0.1:${d.address().port}`;
  };

  await t.test('empty store', async () => {
    await page.goto(await serve(fs.mkdtempSync(path.join(os.tmpdir(), 'fdash-'))));
    await page.waitForSelector('#cases .mute');
    assert.match(await page.textContent('#cases'), /No cases/);
    await page.waitForSelector('#business-rules.warn');
    assert.match(await page.textContent('#business-rules'), /not configured: required_before_close, tax_scheme, closing_bill_basis.*not verified/);
  });

  await t.test('populated: case with a cross-application contradiction and its provenance', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdash-'));
    const store = new EventStore(dir);
    const info = { job_no: 'DASH-1', type: 'sea_export', status: 'Active', gross_weight: '20200 KGS', net_weight: '20000 KGS', total_pkgs: '400 BAGS', invoice_no_date: 'SYN/1 DT. 01/01/2026', sb_no_date: '1 DT. 01/01/2026', containers: [{ key: 'CSQU3054383', container_no: 'CSQU3054383', gross_wt: 20200, net_wt: 20000, pkgs: '400 BAGS', cbm: 20 }], billing_charges: [{ key: 'FREIGHT', description: 'FREIGHT', amount: 1000 }], documents: [], workflow_steps: [], shipper: 'X', consignee: 'Y' };
    store.append({ application: 'workflow_sync', action: 'job.created', entity_type: 'job', entity_id: '1', job_no: 'DASH-1', correlation_id: 'c-dash', operation_id: 'o1', actor: { display_name: 'Desk 1 (Invoice)', source: 'session', verified: true }, payload: { stored: info, state_hash: 'h', source_links: [] } });
    const ob = path.join(dir, 'outbox.jsonl');
    outboxAppend(ob, biilRecord(rng(1), info, new Date(), { fields: { gross_weight: '25000 KGS' } }));
    ingest(store, ob);
    await page.goto(await serve(dir));
    await page.click('.case');
    await page.waitForFunction(() => document.getElementById('detail').textContent.includes('Contradictions between applications'), null, { timeout: 10000 })
      .catch(async () => { throw new Error('detail: ' + (await page.textContent('#detail')).slice(0, 300) + ' errors: ' + JSON.stringify(jsErrors)); });
    const body = await page.textContent('#detail');
    assert.match(body, /confirmed data inconsistency/);
    assert.match(body, /gross weight/);
    assert.match(body, /Where key values come from/);
    assert.match(body, /Evidence trust: four separate questions/);
    assert.match(body, /source application clock/, 'event time basis shown');
  });

  await t.test('malformed evidence: integrity warning instead of a crash', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdash-'));
    new EventStore(dir).append({ application: 'workflow_sync', action: 'x', entity_type: 'job' });
    fs.appendFileSync(path.join(dir, 'events.jsonl'), '{broken line\n');
    await page.goto(await serve(dir));
    await page.waitForSelector('#integrity.warn');
    assert.match(await page.textContent('#integrity'), /INTEGRITY PROBLEMS/);
  });

  await t.test('markup in evidence is shown as text, never executed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdash-'));
    const store = new EventStore(dir);
    const evil = '<img src=x onerror="window.__pwned=1">';
    store.append({ application: 'workflow_sync', action: 'job.created', entity_type: 'job', entity_id: '1', job_no: evil, correlation_id: 'c-x', operation_id: 'o', payload: { stored: { job_no: evil, status: 'Active', containers: [{ container_no: 'BAD' }], billing_charges: [], workflow_steps: [], documents: [] }, state_hash: 'h', source_links: [] } });
    await page.goto(await serve(dir));
    await page.click('.case');
    await page.waitForSelector('#detail .panel');
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.ok((await page.textContent('#detail')).includes(evil));
  });

  assert.deepEqual(jsErrors, []);
});

test('dashboard analysis on demo shipments: filters, ground truth, unlinked evidence, evaluation tab', { skip, timeout: 600000 }, async t => {
  const { runDemo } = await import('../e2e/demo.js');
  const d = await runDemo();
  const { page, jsErrors } = await openBrowser(t);
  const dash = createDashboard({ dir: path.join(d.dir, 'evidence') });
  await new Promise(r => dash.listen(0, '127.0.0.1', r));
  t.after(() => dash.close());
  await page.goto(`http://127.0.0.1:${dash.address().port}`);
  await page.waitForSelector('#cases .case');
  const total = await page.$$eval('#cases .case', e => e.length);
  assert.match(await page.textContent('#unlinked'), /biil_unified/, 'unattributable record listed as not tied to a shipment');
  assert.match(await page.textContent('#rule-breakdown'), /ACT-002 · 1/);

  await page.selectOption('#f-rule', 'ACT-002');
  assert.equal(await page.$$eval('#cases .case', e => e.length), 1, 'rule filter');
  await page.click('#cases .case');
  await page.waitForFunction(() => document.getElementById('detail').textContent.includes('Synthetic ground truth'));
  const detail = await page.textContent('#detail');
  assert.match(detail, /unauthorized_delete_attempt/);
  assert.match(detail, /matches the label/);
  assert.match(detail, /REFUSED DELETE/, 'refusal shown in the timeline');

  await page.selectOption('#f-rule', '');
  await page.check('#f-xap');
  const withXap = await page.$$eval('#cases .case', e => e.length);
  assert.ok(withXap > 0 && withXap < total, 'contradiction filter narrows the queue');
  await page.uncheck('#f-xap');
  await page.fill('#f-text', 'no-such-job');
  assert.match(await page.textContent('#cases'), /No case matches/);
  await page.fill('#f-text', '');

  await page.click('#tab-eval');
  await page.waitForFunction(() => document.getElementById('evaluation').textContent.includes('anomaly (label)'));
  const ev = await page.textContent('#evaluation');
  assert.match(ev, /SYNTHETIC DATA ONLY/);
  assert.match(ev, /Isolation Forest only/);
  assert.match(ev, /Per scenario type/);
  assert.ok(await page.isHidden('#view-cases'));
  await page.click('#tab-cases');
  assert.ok(await page.isHidden('#view-eval'));
  assert.deepEqual(jsErrors, []);
});
