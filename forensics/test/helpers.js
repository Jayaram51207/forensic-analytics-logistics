// Starts a disposable Workflow Synchroniser whose database, uploads, downloads
// and evidence store all live in a temp directory. Live data is never touched.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SYNC_DIR = path.join(REPO, 'Workflow syncroniser');
export const PYTHON = process.env.SYNC_PYTHON || 'python';

/** Document generation needs openpyxl; tests that depend on it are skipped when it is missing. */
export const pythonCanCompile = spawnSync(PYTHON, ['-c', 'import openpyxl, pdfplumber']).status === 0;

export async function startSync({ dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsync-')), env = {} } = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const dbPath = path.join(dir, 'db.json');
  // db.js seeds default users only when the file already exists with an empty user list.
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({ jobs: [], users: [] }));
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: SYNC_DIR,
    env: {
      ...process.env, PORT: String(port), SYNC_PYTHON: PYTHON,
      SYNC_DB_PATH: dbPath,
      SYNC_UPLOADS_DIR: path.join(dir, 'uploads'),
      SYNC_DOWNLOADS_DIR: path.join(dir, 'downloads'),
      FORENSIC_DIR: path.join(dir, 'evidence'),
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { await fetch(base + '/api/jobs'); break; } catch {
      if (i > 100 || proc.exitCode !== null) throw new Error('synchroniser did not start:\n' + log);
      await new Promise(r => setTimeout(r, 100));
    }
  }
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON response */ }
    return { status: res.status, json, text };
  };
  return {
    base, dir, dbPath, evidenceDir: path.join(dir, 'evidence'), call,
    log: () => log,
    db: () => JSON.parse(fs.readFileSync(dbPath, 'utf8')),
    stop: () => new Promise(res => { proc.once('exit', res); proc.kill(); })
  };
}

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
