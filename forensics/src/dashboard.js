// Read-oriented investigation dashboard. Separate process from the
// synchroniser; binds to localhost only. The writes it offers (reviewer disposition,
// manual evidence link) append to the chain and require FORENSIC_REVIEW_TOKEN.
//   node src/dashboard.js [--dir <evidence dir>] [--port 3100] [--labels <labels.json>] [--eval <final_summary.json>]
// --labels shows synthetic ground truth next to cases (never used by the analysis). It defaults to
// <dir>/../labels.json when that exists, i.e. when the dashboard is pointed at a generated dataset.
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { EventStore } from './store.js';
import { analyze, caseDetail, recordDisposition, recordLinkAssertion, evidenceList, DISPOSITIONS, SCORING } from './cases.js';
import { loadBusinessRules } from './business_rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createDashboard({ dir, reviewToken = process.env.FORENSIC_REVIEW_TOKEN || null, config = {},
  labelsFile = path.join(dir, '..', 'labels.json'), evalFile = path.join(here, '..', 'evaluation', 'results', 'final_summary.json') }) {
  const readJson = f => (f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  const labels = readJson(labelsFile);
  const truth = labels ? new Map(labels.map(l => [l.job_no, { class: l.class, type: l.type, expected_rules: l.expected_rules, explanation: l.explanation }])) : null;
  const store = new EventStore(dir);
  const load = () => analyze(store.readAll().records.map(x => x.record), { business_rules: loadBusinessRules(), ...config, integrity: store.verify() });
  const summary = c => ({ case_id: c.case_id, job_no: c.job_no, status: c.status, priority: c.priority.value, band: c.priority.band, n_anomaly_findings: c.n_anomaly_findings, n_data_quality_findings: c.n_data_quality_findings, reasons: c.reasons.slice(0, 3),
    rules: [...new Set(c.findings.filter(f => f.kind === 'anomaly').map(f => f.rule_id))].sort(), deleted: c.deleted, contradictions: c.contradictions, applications: c.provenance.applications,
    ...(truth ? { ground_truth: c.job_nos_seen.map(j => truth.get(j)).find(Boolean) || null } : {}) });
  // External records that could not be tied to one shipment: missing evidence from the investigator's view.
  const unlinked = a => {
    const out = {};
    for (const r of a.context.external) {
      const k = !r._link || r._link.method === 'unlinked' ? 'unlinked' : r._link.ambiguous ? 'ambiguous' : null;
      if (!k) continue;
      const o = out[r.application] || (out[r.application] = { unlinked: 0, ambiguous: 0 });
      o[k]++;
    }
    return out;
  };
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const tokenOk = given => reviewToken && given && given.length === reviewToken.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(reviewToken));

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' });
        return res.end(fs.readFileSync(path.join(here, '..', 'public', 'index.html')));
      }
      if (req.method === 'GET' && url.pathname === '/api/overview') {
        const a = load();
        const cases = a.cases.map(summary);
        const rule_breakdown = {};
        for (const c of cases) for (const r of c.rules) rule_breakdown[r] = (rule_breakdown[r] || 0) + 1;
        return json(res, 200, { integrity: store.verify(), cases, shipments: a.views.size, dispositions: DISPOSITIONS, review_enabled: !!reviewToken, scoring: SCORING, business_rules: a.config.business_rules,
          rule_breakdown, unlinked_external: unlinked(a), refused_requests: a.context.rejected.length, ground_truth_available: !!truth });
      }
      if (req.method === 'GET' && url.pathname === '/api/evaluation') {
        const e = readJson(evalFile);
        return e ? json(res, 200, e) : json(res, 404, { error: 'no evaluation results: run evaluation/evaluate.js and evaluation/summarize.js' });
      }
      const m = url.pathname.match(/^\/api\/cases\/([A-Za-z0-9-]+)(\/disposition)?$/);
      if (m && req.method === 'GET' && !m[2]) {
        const d = caseDetail(load(), m[1]);
        if (d && truth) d.ground_truth = d.job_nos_seen.map(j => truth.get(j)).find(Boolean) || null;
        return d ? json(res, 200, d) : json(res, 404, { error: 'case not found' });
      }
      if (m && req.method === 'POST' && m[2]) {
        if (!tokenOk(req.headers['x-review-token'])) return json(res, reviewToken ? 403 : 501, { error: reviewToken ? 'invalid review token' : 'reviewing is disabled: start the dashboard with FORENSIC_REVIEW_TOKEN set' });
        let body = '';
        req.on('data', d => { body += d; if (body.length > 20000) req.destroy(); });
        req.on('end', () => {
          try {
            const { disposition, note, reviewer } = JSON.parse(body);
            const c = load().cases.find(x => x.case_id === m[1]);
            if (!c) return json(res, 404, { error: 'case not found' });
            const evt = recordDisposition(dir, { case_id: c.case_id, correlation_id: c.correlation_id, disposition, note, reviewer, verified: true });
            json(res, 201, { event_id: evt.event_id, sequence: evt.sequence });
          } catch (err) { json(res, 400, { error: err.message }); }
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/evidence') return json(res, 200, { records: evidenceList(load()), review_enabled: !!reviewToken });
      const l = url.pathname.match(/^\/api\/evidence\/([A-Za-z0-9-]+)\/link$/);
      if (l && req.method === 'POST') {
        if (!tokenOk(req.headers['x-review-token'])) return json(res, reviewToken ? 403 : 501, { error: reviewToken ? 'invalid review token' : 'linking is disabled: start the dashboard with FORENSIC_REVIEW_TOKEN set' });
        let body = '';
        req.on('data', d => { body += d; if (body.length > 20000) req.destroy(); });
        req.on('end', () => {
          try {
            const { job_no, reason, reviewer } = JSON.parse(body);
            const evt = recordLinkAssertion(dir, { target_event_id: l[1], job_no, reason, actor: reviewer, verified: true });
            json(res, 201, { event_id: evt.event_id, sequence: evt.sequence });
          } catch (err) { json(res, 400, { error: err.message }); }
        });
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  const dir = path.resolve(arg('dir') || process.env.FORENSIC_DIR || path.join(here, '..', 'data'));
  const port = +(arg('port') || 3100);
  createDashboard({ dir, ...(arg('labels') ? { labelsFile: path.resolve(arg('labels')) } : {}), ...(arg('eval') ? { evalFile: path.resolve(arg('eval')) } : {}) }).listen(port, '127.0.0.1', () => console.log(`Forensic investigation dashboard: http://127.0.0.1:${port}  (evidence: ${dir})`));
}
