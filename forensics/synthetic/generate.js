// Generates a labelled synthetic dataset by driving a disposable Workflow
// Synchroniser through its real HTTP API.
//
//   node synthetic/generate.js --seed 1 --jobs 240 --out datasets/seed-1
//   node synthetic/generate.js --seed 9 --jobs 200 --out datasets/train-9 --normal-only
//
// Output: <out>/evidence/ (event chain + archived outputs), <out>/db.json (final
// operational state), <out>/labels.json (ground truth, kept apart from evidence).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startSync } from '../test/helpers.js';
import { rng, driver } from './lib.js';
import { SCENARIOS, MIX } from './scenarios.js';
import { EventStore } from '../src/store.js';
import { outboxAppend, ingest } from '../src/ingest.js';
import { execSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function generate({ seed = 1, jobs = 60, out, normalOnly = false, only = null, concurrency = 6, mix = MIX, archive = false, keepFiles = false }) {
  const dir = path.resolve(ROOT, out || `datasets/seed-${seed}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const outbox = path.join(dir, 'outbox', 'desktop_tools.jsonl');
  // Output copies are not archived for datasets: hashes are kept, the bulky files are not.
  const server = await startSync({ dir, env: { FORENSIC_ALLOW_SIM_TIME: '1', FORENSIC_ARCHIVE: archive ? '1' : '0' } });
  const api = await driver(server.base, server.credentials());
  const pick = rng(seed);
  let types = Object.keys(mix);
  if (normalOnly) types = types.filter(t => t.startsWith('clean_') || ['early_correction_regenerated', 'nonmaterial_late_edit', 'legit_reopen', 'regen_identical_few', 'source_matches', 'packing_fits', 'xapp_consistent', 'xapp_duplicate_evidence', 'legit_night_shift', 'legit_backfill', 'xapp_rounding_difference', 'xapp_unit_variant'].includes(t));
  const total = types.reduce((s, t) => s + mix[t], 0);
  const choose = () => { let x = pick() * total; for (const t of types) { x -= mix[t]; if (x <= 0) return t; } return types.at(-1); };
  // `only` runs each listed scenario exactly once (used by tests); otherwise scenarios are sampled by weight.
  const plan = only ? only.map((type, i) => ({ type, i })) : Array.from({ length: jobs }, (_, i) => ({ type: choose(), i }));
  for (const p of plan) {
    p.jobNo = `SYN-${seed}-${String(p.i + 1).padStart(4, '0')}`;
    p.start = new Date(Date.UTC(2026, 0, 5 + pick.int(0, 59), 4 + pick.int(0, 6), pick.int(0, 59)));
  }
  const labels = [], errors = [];
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < plan.length) {
      const p = plan[next++];
      const ctx = { api, jobNo: p.jobNo, start: p.start, r: rng(seed * 100003 + p.i), outbox: rec => outboxAppend(outbox, rec) };
      try {
        const label = await SCENARIOS[p.type](ctx);
        labels.push({ scenario_id: `${seed}-${p.i + 1}`, job_no: p.jobNo, type: p.type, ...label });
      } catch (err) {
        errors.push({ job_no: p.jobNo, type: p.type, error: err.message + (err.cause ? ` (${err.cause.code || err.cause.message})` : '') });
      }
    }
  }));
  await server.stop();
  if (!keepFiles) for (const d of ['downloads', 'uploads']) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
  const ingested = ingest(new EventStore(server.evidenceDir), outbox, { simulateTime: true });
  labels.sort((a, b) => a.job_no.localeCompare(b.job_no));
  fs.writeFileSync(path.join(dir, 'labels.json'), JSON.stringify(labels, null, 1));
  const counts = {};
  for (const l of labels) counts[l.type] = (counts[l.type] || 0) + 1;
  const commit = (() => { try { return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim() + (execSync('git status --porcelain -- . ":!datasets" ":!evaluation/results"', { cwd: ROOT, encoding: 'utf8' }).trim() ? '+uncommitted' : ''); } catch { return null; } })();
  const manifest = { seed, code_commit: commit, jobs: plan.length, normal_only: normalOnly, generated_at: new Date().toISOString(), synthetic: true, scenario_counts: counts, class_counts: Object.fromEntries(['normal', 'hard_negative', 'anomaly', 'data_quality'].map(c => [c, labels.filter(l => l.class === c).length])), external_records_ingested: ingested, errors, note: 'All data is synthetic. Event timestamps are simulated (clock_source = "simulated").' };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return { dir, labels, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  const { dir, manifest } = await generate({ seed: +(arg('seed') || 1), jobs: +(arg('jobs') || 60), out: arg('out'), normalOnly: process.argv.includes('--normal-only') });
  console.log(`dataset written to ${dir}`);
  console.log(JSON.stringify({ classes: manifest.class_counts, errors: manifest.errors.length }, null, 1));
  if (manifest.errors.length) { console.error(manifest.errors.slice(0, 5)); process.exitCode = 1; }
}
