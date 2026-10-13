// Read-oriented investigation dashboard. Separate process from the
// synchroniser; binds to localhost only. The single write it offers is a
// reviewer disposition, which requires FORENSIC_REVIEW_TOKEN.
//   node src/dashboard.js [--dir <evidence dir>] [--port 3100]
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { EventStore } from './store.js';
import { analyze, caseDetail, recordDisposition, DISPOSITIONS, SCORING } from './cases.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createDashboard({ dir, reviewToken = process.env.FORENSIC_REVIEW_TOKEN || null, config = {} }) {
  const store = new EventStore(dir);
  const load = () => analyze(store.readAll().records.map(x => x.record), { ...config, integrity: store.verify() });
  const summary = c => ({ case_id: c.case_id, job_no: c.job_no, status: c.status, priority: c.priority.value, band: c.priority.band, n_anomaly_findings: c.n_anomaly_findings, n_data_quality_findings: c.n_data_quality_findings, reasons: c.reasons.slice(0, 3) });
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
        return json(res, 200, { integrity: store.verify(), cases: a.cases.map(summary), shipments: a.views.size, dispositions: DISPOSITIONS, review_enabled: !!reviewToken, scoring: SCORING });
      }
      const m = url.pathname.match(/^\/api\/cases\/([A-Za-z0-9-]+)(\/disposition)?$/);
      if (m && req.method === 'GET' && !m[2]) {
        const d = caseDetail(load(), m[1]);
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
  createDashboard({ dir }).listen(port, '127.0.0.1', () => console.log(`Forensic investigation dashboard: http://127.0.0.1:${port}  (evidence: ${dir})`));
}
