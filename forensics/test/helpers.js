// Starts a disposable Workflow Synchroniser whose database, uploads, downloads
// and evidence store all live in a temp directory. Live data is never touched.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SYNC_DIR = path.join(REPO, 'Workflow syncroniser');
const VENV_PYTHON = path.join(REPO, 'forensics', '.venv', 'Scripts', 'python.exe');
export const PYTHON = process.env.SYNC_PYTHON || (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python');

/** Document generation needs openpyxl; tests that depend on it are skipped when it is missing. */
export const pythonCanCompile = spawnSync(PYTHON, ['-c', 'import openpyxl, pdfplumber']).status === 0;

export async function startSync({ dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsync-')), env = {} } = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const dbPath = path.join(dir, 'db.json');
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({ jobs: [], users: [] }));
  // Every test instance gets its own random passwords, kept beside its disposable database.
  // No shared or predictable password exists anywhere.
  const credFile = path.join(dir, 'test_credentials.json');
  const creds = fs.existsSync(credFile) ? JSON.parse(fs.readFileSync(credFile, 'utf8')) : {};
  if (!creds.admin) creds.admin = 'T!' + crypto.randomBytes(12).toString('base64url');
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: SYNC_DIR,
    env: {
      ...process.env, PORT: String(port), SYNC_PYTHON: PYTHON,
      SYNC_DB_PATH: dbPath,
      SYNC_UPLOADS_DIR: path.join(dir, 'uploads'),
      SYNC_DOWNLOADS_DIR: path.join(dir, 'downloads'),
      FORENSIC_DIR: path.join(dir, 'evidence'),
      SYNC_ADMIN_PASSWORD: creds.admin, SYNC_BCRYPT_COST: '10',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  const base = `${env.SYNC_TLS_CERT ? 'https' : 'http'}://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { await fetch(base + '/api/jobs'); break; } catch {
      if (i > 100 || proc.exitCode !== null) throw new Error('synchroniser did not start:\n' + log);
      await new Promise(r => setTimeout(r, 100));
    }
  }
  const caller = cookie => async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON response */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  const anon = caller(null);
  const cookies = {};
  const cookieOf = res => res.headers.get('set-cookie').split(';')[0];
  const login = async username => {
    if (!cookies[username]) {
      const res = await anon('POST', '/api/login', { username, password: creds[username] });
      if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${res.text}`);
      cookies[username] = cookieOf(res);
      if (res.json.must_change_password) {
        // first sign-in after the administrator created the account: choose a new random password
        const next = 'N!' + crypto.randomBytes(12).toString('base64url');
        const ch = await caller(cookies[username])('POST', '/api/password', { current_password: creds[username], new_password: next });
        if (ch.status !== 200) throw new Error(`password change failed for ${username}: ${ch.text}`);
        creds[username] = next;
        cookies[username] = cookieOf(ch);
        fs.writeFileSync(credFile, JSON.stringify(creds));
      }
    }
    return cookies[username];
  };
  const authOff = env.SYNC_AUTH === 'off';
  // The desk accounts the tests and scenarios use, created through the admin API like a real setup.
  if (!authOff && !creds.desk1) {
    const admin = caller(await login('admin'));
    for (const [username, name, role] of DESK_ACCOUNTS) {
      const temp = 'P!' + crypto.randomBytes(12).toString('base64url');
      const r = await admin('POST', '/api/users', { username, password: temp, name, role });
      if (r.status !== 201) throw new Error(`could not create ${username}: ${r.text}`);
      creds[username] = temp;
    }
    fs.writeFileSync(credFile, JSON.stringify(creds));
    for (const [username] of DESK_ACCOUNTS) await login(username); // first sign-in: forced password change
  }
  const as = async username => (authOff ? anon : caller(await login(username)));
  const call = authOff ? anon : caller(await login('desk1'));
  return {
    base, dir, dbPath, evidenceDir: path.join(dir, 'evidence'), call, anon, as, cookieFor: login,
    password: username => creds[username], credentials: () => ({ ...creds }), forgetSession: username => { delete cookies[username]; },
    log: () => log,
    db: () => JSON.parse(fs.readFileSync(dbPath, 'utf8')),
    stop: () => new Promise(res => { proc.once('exit', res); proc.kill(); })
  };
}

export const DESK_ACCOUNTS = [['desk1', 'Desk 1 (Invoice)', 'Invoice'], ['desk2', 'Desk 2 (Documentation)', 'Documentation'], ['desk3', 'Desk 3 (Customs / CHA)', 'Customs'], ['desk4', 'Desk 4 (Operations)', 'Operations']];

/** A fully synthetic sea-export job. No value here comes from a real shipment. */
export function sampleInfo(over = {}) {
  return {
    job_no: 'SYN-TEST-001', type: 'sea_export',
    shipper: 'SYNTHETIC EXPORTS LTD\n1 Example Road\nTestville', consignee: 'SYNTHETIC IMPORTS BV\n2 Sample Street',
    notify: 'SAME AS CONSIGNEE', invoice_no_date: 'SYN/001 DT. 05/01/2026', sb_no_date: '9000001 DT. 06/01/2026',
    vessel_voyage: 'MV EXAMPLE V.001', port_of_loading: 'CHENNAI / INDIA', port_of_discharge: 'ROTTERDAM', final_destination: 'ROTTERDAM / NETHERLANDS',
    cargo_desc: 'SYNTHETIC TEST GOODS', hs_code: '99999999', payment_mode: 'PREPAID',
    total_pkgs: '400 BAGS', gross_weight: '20200 KGS', net_weight: '20000 KGS', cbm: '20',
    cargo_items: [{ description: 'SYNTHETIC TEST GOODS', hs_code: '99999999', qty: 400, unit: 'BAGS', rate: 10, net_wt: 20000, gross_wt: 20200, amount: 4000 }],
    containers: [{ container_no: 'CSQU3054383', seal_no: 'SL0001', pkgs: '400 BAGS', net_wt: 20000, gross_wt: 20200, cbm: 20 }],
    billing_charges: [{ description: 'OCEAN FREIGHT', amount: 50000 }, { description: 'DOCUMENTATION', amount: 2500 }],
    ...over
  };
}
