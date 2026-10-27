// Safe local demonstration on synthetic data only. Runs a fixed set of shipments through the real
// pipeline: Workflow Synchroniser (HTTP, signed-in sessions) -> evidence store; desktop-tool records
// (B.I.I.L., stuffing report, 3D visualizer) in their real schemas -> outbox -> ingestion; then
// entity linking, provenance, contradiction analysis, rules, case scoring.
//
//   cd forensics
//   node e2e/demo.js                      prints what was found for each shipment
//   node e2e/demo.js --serve [--port N]   also serves the investigation dashboard on the demo evidence
//   (from the repository root: node forensics/e2e/demo.js --serve; inside forensics: npm run demo)
//
// Everything is written to a fresh temp folder. No live database or evidence folder is opened.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { generate } from '../synthetic/generate.js';
import { EventStore } from '../src/store.js';
import { analyze } from '../src/cases.js';
import { loadBusinessRules } from '../src/business_rules.js';

export const DEMO_SCENARIOS = [
  'clean_complete',                 // control: nothing should be raised
  'xapp_consistent',                // control across applications: linked, agrees
  'xapp_rounding_difference',       // control: B.I.I.L. weight differs by < 1 kg
  'xapp_weight_conflict',           // B.I.I.L. states another gross weight
  'xapp_document_backed_conflict',  // uploaded checklist and B.I.I.L. agree; the job was changed
  'common_source_falsification',    // every record agrees and all come from one false source
  'xapp_unlinked_record',           // a record that cannot be tied to any shipment
  'unauthorized_delete_attempt',    // refused deletion by a desk user
  'deleted_after_close',            // administrator deletes a closed job
  'legit_backfill'                  // known false positive of TIM-001
];

export async function runDemo(out = fs.mkdtempSync(path.join(os.tmpdir(), 'fdemo-')), seed = 500) {
  const { dir, labels, manifest } = await generate({ seed, only: DEMO_SCENARIOS, out, concurrency: 4 });
  const store = new EventStore(path.join(dir, 'evidence'), { remote: null, anchorFile: null });
  const integrity = store.verify();
  const analysis = analyze(store.readAll().records.map(x => x.record), { integrity, business_rules: loadBusinessRules() });
  const byJob = new Map(labels.map(l => {
    const views = [...analysis.views.values()].filter(v => v.job_nos.has(l.job_no));
    const c = analysis.cases.find(x => x.job_nos_seen.includes(l.job_no));
    return [l.job_no, { label: l, case: c || null, provenance: views.map(v => analysis.provenance.get(v.correlation_id)).filter(Boolean).at(-1) || null,
      rules: [...new Set((c?.findings || []).filter(f => f.kind === 'anomaly').map(f => f.rule_id))].sort() }];
  }));
  return { dir, labels, manifest, integrity, analysis, byJob };
}

export async function main(argv = process.argv) {
  const d = await runDemo();
  console.log(`Synthetic demo evidence: ${path.join(d.dir, 'evidence')}  (chain ${d.integrity.ok ? 'verifies' : 'HAS PROBLEMS'}, ${d.integrity.count} events)\n`);
  for (const { label, case: c, provenance: p, rules } of d.byJob.values()) {
    const xap = p?.contradictions.map(x => `${x.field}: ${x.classification}`) || [];
    const single = Object.values(p?.corroboration || {}).filter(x => x.status !== 'not_comparable' && x.needs_independent_source && x.agreeing_records > 1).map(x => x.field);
    console.log(`${label.job_no}  ${label.type.padEnd(30)} truth: ${label.class.padEnd(13)} raised: ${rules.join(',') || 'nothing'}${c ? `  (case ${c.case_id}, priority ${c.priority.value})` : ''}`);
    if (xap.length) console.log(`    contradictions: ${xap.join('; ')}`);
    if (single.length) console.log(`    agreement from a single source only: ${single.join(', ')}`);
  }
  if (argv.includes('--serve')) {
    const { createDashboard } = await import('../src/dashboard.js');
    const i = argv.indexOf('--port'), port = i > 0 ? +argv[i + 1] : 3100;
    createDashboard({ dir: path.join(d.dir, 'evidence') })
      .on('error', err => { console.error(err.code === 'EADDRINUSE' ? `\nPort ${port} is in use (another dashboard?). Stop it or pass --port <other>.` : err.message); process.exit(1); })
      .listen(port, '127.0.0.1', () => console.log(`\nDashboard: http://127.0.0.1:${port}  (Ctrl+C to stop)`));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
