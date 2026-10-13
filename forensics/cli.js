#!/usr/bin/env node
// Command-line access to the evidence store.
//   node cli.js verify [--anchor <file>] [--expect <seq>:<hash>]   integrity check of the whole chain
//   node cli.js head                           current head as <seq>:<hash>, to record somewhere the host cannot change
//   node cli.js reconcile --db <db.json>       evidence vs operational database
//   node cli.js cases                          review queue
//   node cli.js case <CASE-ID>                 one case with findings and timeline
//   node cli.js timeline <job_no>              chronological reconstruction
//   node cli.js ingest [file-or-folder]        import evidence written by the desktop tools
//   node cli.js artifacts                      do recorded files still match their recorded hashes?
//   node cli.js features --out <file.csv>      behavioural features per shipment
//   node cli.js analyze                        everything as JSON
// Common option: --dir <evidence dir> (default forensics/data, or FORENSIC_DIR)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventStore } from './src/store.js';
import { reconcile, reconstruct } from './src/model.js';
import { analyze, caseDetail, features } from './src/cases.js';
import { ingest, verifyArtifacts } from './src/ingest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const [cmd, arg] = positional;
const dir = path.resolve(opt('dir') || process.env.FORENSIC_DIR || path.join(here, 'data'));
const store = new EventStore(dir);
const records = () => store.readAll().records.map(x => x.record);
const print = v => console.log(JSON.stringify(v, null, 2));

export function featureRows(analysis) {
  return [...analysis.views.values()].filter(v => v.state).map(v => ({ job_no: v.job_no, job_nos_seen: [...v.job_nos], ...features(v) }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  switch (cmd) {
    case 'verify': {
      const exp = opt('expect') ? { sequence: +opt('expect').split(':')[0], integrity_hash: opt('expect').split(':')[1] } : null;
      const v = store.verify({ ...(opt('anchor') ? { anchorFile: path.resolve(opt('anchor')) } : {}), expect: exp });
      console.log(`${v.ok ? 'OK' : 'INTEGRITY PROBLEMS'}: ${v.count} events, last sequence ${v.last_sequence}, head ${v.last_hash.slice(0, 16)}...`);
      console.log(v.anchor.configured ? `external anchor: ${v.anchor.witnessed} record(s) witnessed` : 'external anchor: NOT CONFIGURED - a full rewrite of this folder would not be detected (set FORENSIC_ANCHOR_FILE, or keep the output of "cli.js head" elsewhere and pass it to --expect)');
      for (const p of v.problems) console.log(`  [${p.type}] line ${p.line ?? '-'} seq ${p.sequence ?? '-'}: ${p.detail ?? ''}`);
      process.exitCode = v.ok ? 0 : 2;
      break;
    }
    case 'head': {
      const v = store.verify();
      console.log(`${v.last_sequence}:${v.last_hash}`);
      process.exitCode = v.ok ? 0 : 2;
      break;
    }
    case 'reconcile': {
      const db = JSON.parse(fs.readFileSync(opt('db') || path.join(here, '..', 'Workflow syncroniser', 'db.json'), 'utf8'));
      const r = reconcile(db, records());
      console.log(`${r.ok ? 'CONSISTENT' : 'DIFFERENCES FOUND'}: ${r.jobs_in_db} jobs in database, ${r.shipments_in_evidence} shipments in evidence`);
      for (const p of r.problems) console.log(`  [${p.type}] job ${p.job_no ?? '-'}: ${p.detail}`);
      process.exitCode = r.ok ? 0 : 2;
      break;
    }
    case 'cases': {
      const a = analyze(records());
      for (const c of a.cases) console.log(`${c.case_id}  ${String(c.priority.value).padStart(3)} ${c.priority.band.padEnd(13)} ${c.status.padEnd(18)} ${String(c.job_no).padEnd(16)} ${c.reasons[0] || `${c.n_data_quality_findings} data-quality note(s)`}`);
      console.log(`${a.cases.length} case(s). Scores order the review queue; they are not probabilities.`);
      break;
    }
    case 'case': {
      const d = caseDetail(analyze(records()), arg);
      if (!d) { console.error('no such case'); process.exitCode = 1; break; }
      console.log(`${d.case_id}  job ${d.job_no}  priority ${d.priority.value} (${d.priority.band})  status ${d.status}`);
      for (const f of d.findings) console.log(`\n[${f.rule_id} v${f.rule_version} | ${f.kind} | ${f.severity}] ${f.title}\n  ${f.explanation}\n  evidence: ${f.evidence_event_ids.join(', ')}`);
      console.log('\nTimeline:');
      for (const t of d.timeline) console.log(`  ${String(t.sequence).padStart(6)} ${t.time} ${t.cited_by_finding ? '*' : ' '} ${(t.actor || '-').padEnd(26)} ${t.summary}`);
      if (d.limitations.length) console.log('\nLimitations:\n  - ' + d.limitations.join('\n  - '));
      break;
    }
    case 'timeline': {
      const a = analyze(records());
      const views = [...a.views.values()].filter(v => v.job_nos.has(arg));
      if (!views.length) { console.error('no evidence for that job number'); process.exitCode = 1; break; }
      print(views.map(v => reconstruct(v, a.context)));
      break;
    }
    case 'ingest': {
      // A file, or a folder of *.jsonl outboxes (default: where the desktop tools write).
      const target = path.resolve(arg || process.env.FORENSIC_OUTBOX_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'LeadkingForensics', 'outbox'));
      const files = fs.existsSync(target) && fs.statSync(target).isDirectory() ? fs.readdirSync(target).filter(f => f.endsWith('.jsonl')).map(f => path.join(target, f)) : [target];
      print(Object.fromEntries(files.map(f => [f, ingest(store, f)])));
      break;
    }
    case 'artifacts': {
      const rows = verifyArtifacts(records(), dir);
      const tally = {};
      for (const r of rows) tally[r.status] = (tally[r.status] || 0) + 1;
      for (const r of rows.filter(x => !['archived_copy_verified', 'file_unchanged'].includes(x.status))) console.log(`  [${r.status}] ${r.application} ${r.role} ${r.path}`);
      console.log(JSON.stringify(tally));
      process.exitCode = rows.some(r => r.status === 'ARCHIVED_COPY_ALTERED') ? 2 : 0;
      break;
    }
    case 'features': {
      const rows = featureRows(analyze(records()));
      const cols = Object.keys(rows[0] || {}).filter(c => c !== 'job_nos_seen');
      const csv = [cols.join(','), ...rows.map(r => cols.map(c => r[c]).join(','))].join('\n') + '\n';
      if (opt('out')) fs.writeFileSync(opt('out'), csv); else process.stdout.write(csv);
      break;
    }
    case 'analyze': {
      const a = analyze(records());
      print({ integrity: store.verify(), cases: a.cases });
      break;
    }
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  }
}
