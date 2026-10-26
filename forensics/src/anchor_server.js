// Remote anchor witness. Run it on a machine (or under an account) that the users of the
// evidence host cannot write to. It keeps its own append-only record of (sequence, hash)
// pairs per evidence store and refuses to change one it has already witnessed.
//
//   set FORENSIC_ANCHOR_TOKEN=<long random secret>
//   node src/anchor_server.js --dir D:\anchor-witness --port 3200 [--host 0.0.0.0] [--stores site-a,site-b]
//
// --stores (or FORENSIC_ANCHOR_ALLOWED_STORES) fixes which store ids exist. Without it, a
// compromised evidence host could start a fresh store id and anchor a forged chain there.
//
// API (all require "Authorization: Bearer <token>"):
//   POST /anchor   {store_id, sequence, integrity_hash}  -> 201 new, 200 already witnessed, 409 conflict
//   GET  /anchor?store_id=...                             -> {entries:[...], conflicts:[...]}
// Nothing but sequence numbers and hashes is sent here: no evidence content.
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ID = /^[A-Za-z0-9._-]{1,100}$/;
const HASH = /^[0-9a-f]{64}$/;

export function createAnchorServer({ dir, token, allowedStores = null }) {
  if (!token || token.length < 24) throw new Error('FORENSIC_ANCHOR_TOKEN must be set to at least 24 characters');
  fs.mkdirSync(dir, { recursive: true });
  const file = id => path.join(dir, `${id}.jsonl`);
  const read = id => (fs.existsSync(file(id)) ? fs.readFileSync(file(id), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  const authorised = req => {
    const given = (/^Bearer (.+)$/.exec(req.headers.authorization || '') || [])[1] || '';
    return given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
  };
  const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/anchor') return send(res, 404, { error: 'not found' });
    if (!authorised(req)) return send(res, 401, { error: 'unauthorised' });
    const allowed = id => !allowedStores || allowedStores.includes(id);
    if (req.method === 'GET') {
      const id = url.searchParams.get('store_id') || '';
      if (!ID.test(id)) return send(res, 400, { error: 'bad store_id' });
      if (!allowed(id)) return send(res, 403, { error: 'store_id not allowed on this witness' });
      const all = read(id);
      return send(res, 200, { store_id: id, entries: all.filter(e => e.kind === 'witness'), conflicts: all.filter(e => e.kind === 'conflict') });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    let body = '';
    req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let m;
      try { m = JSON.parse(body); } catch { return send(res, 400, { error: 'invalid JSON' }); }
      if (!ID.test(m.store_id || '') || !Number.isInteger(m.sequence) || m.sequence < 1 || !HASH.test(m.integrity_hash || '')) return send(res, 400, { error: 'store_id, sequence and integrity_hash required' });
      if (!allowed(m.store_id)) return send(res, 403, { error: 'store_id not allowed on this witness' });
      const existing = read(m.store_id).find(e => e.kind === 'witness' && e.sequence === m.sequence);
      if (existing && existing.integrity_hash === m.integrity_hash) return send(res, 200, { status: 'already_witnessed' });
      const entry = { kind: existing ? 'conflict' : 'witness', store_id: m.store_id, sequence: m.sequence, integrity_hash: m.integrity_hash, received_at: new Date().toISOString(), from: req.socket.remoteAddress, ...(existing ? { witnessed_hash: existing.integrity_hash } : {}) };
      fs.appendFileSync(file(m.store_id), JSON.stringify(entry) + '\n');
      // A different hash for a sequence already witnessed is never accepted; the attempt itself is kept.
      send(res, existing ? 409 : 201, { status: existing ? 'conflict_recorded' : 'witnessed' });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  const stores = arg('stores') || process.env.FORENSIC_ANCHOR_ALLOWED_STORES;
  const server = createAnchorServer({ dir: path.resolve(arg('dir') || 'anchor-witness'), token: process.env.FORENSIC_ANCHOR_TOKEN, allowedStores: stores ? stores.split(',').map(s => s.trim()).filter(Boolean) : null });
  const port = +(arg('port') || 3200), host = arg('host') || '127.0.0.1';
  server.listen(port, host, () => console.log(`Anchor witness listening on http://${host}:${port}/anchor${stores ? ` (stores: ${stores})` : ' (WARNING: any store id accepted; pass --stores)'}`));
}
