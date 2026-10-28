// Reproducibility claim of SYNTHETIC_DATASET.md: the same seed gives the same jobs, labels and
// features, and therefore the same evaluation figures, although event ids and hashes differ.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generate } from '../synthetic/generate.js';
import { evaluateDataset } from '../evaluation/evaluate.js';
import { pythonCanCompile } from './helpers.js';

test('same seed twice: identical labels, features and evaluation figures', { timeout: 600000, skip: !pythonCanCompile && 'needs the project Python environment' }, async () => {
  delete process.env.FORENSIC_ANCHOR_URL;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-'));
  const dirs = [path.join(tmp, 'a'), path.join(tmp, 'b')];
  await Promise.all(dirs.map(out => generate({ seed: 4, jobs: 8, out })));
  const [a, b] = dirs.map(evaluateDataset);
  const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
  // Event ids differ between runs; labels cite them, so compare labels without them.
  const labels = d => JSON.stringify(JSON.parse(read(d, 'labels.json'), (k, v) => (k === 'source_event_id' ? undefined : v)));

  assert.notEqual(read(dirs[0], 'evidence/events.jsonl'), read(dirs[1], 'evidence/events.jsonl'), 'event ids are random, so the chains differ');
  assert.equal(labels(dirs[0]), labels(dirs[1]));
  assert.equal(read(dirs[0], 'features.csv'), read(dirs[1], 'features.csv'));
  for (const k of ['jobs', 'events', 'class_counts', 'detection', 'by_type', 'errors', 'investigation']) assert.deepEqual(a[k], b[k], k);
  assert.equal(a.integrity_ok, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});
