// HTTPS mode of the synchroniser (SYNC_TLS_CERT / SYNC_TLS_KEY) with a throw-away self-signed certificate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { startSync } from './helpers.js';

const haveOpenssl = spawnSync('openssl', ['version']).status === 0;

test('HTTPS: cookie is Secure, plain HTTP is not served, TLS is recorded', { skip: !haveOpenssl && 'openssl not on PATH' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ftls-'));
  const cert = path.join(dir, 'cert.pem'), key = path.join(dir, 'key.pem');
  const gen = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1'], { encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);
  // The certificate is self-signed for this test only; this process trusts it by not verifying.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const s = await startSync({ env: { SYNC_TLS_CERT: cert, SYNC_TLS_KEY: key } });
  t.after(() => s.stop());
  assert.match(s.base, /^https:/);
  const login = await s.anon('POST', '/api/login', { username: 'admin', password: s.password('admin') });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /; Secure/);
  await assert.rejects(fetch(s.base.replace('https:', 'http:') + '/api/jobs'), 'no clear-text listener on the port');
  assert.match(s.log(), /^(?![\s\S]*WARNING: plain HTTP)/, 'no plain-HTTP warning');
});

test('plain HTTP warns at start-up and the cookie is not marked Secure', async t => {
  const s = await startSync();
  t.after(() => s.stop());
  const login = await s.anon('POST', '/api/login', { username: 'admin', password: s.password('admin') });
  assert.doesNotMatch(login.headers.get('set-cookie'), /Secure/);
  assert.match(s.log(), /WARNING: plain HTTP/);
});
