// Field-level differences between two job records as returned by the
// synchroniser's getJobById(). Child rows are matched on business keys, not on
// database ids, because updateJob() deletes and re-inserts every child row.
import { canonical, sha256 } from './store.js';

const CHILD_KEYS = {
  containers: r => r.container_no || `#${r.sl_no}`,
  cargo_items: r => r.description || `#${r.sl_no}`,
  billing_charges: r => r.description || '#blank',
  documents: r => r.name,
  workflow_steps: r => r.name
};
const HEADER_IGNORE = new Set(['id', 'created_at', 'updated_at', 'logs', ...Object.keys(CHILD_KEYS)]);
const ROW_IGNORE = new Set(['id', 'job_id', 'sl_no', 'updated_by', 'updated_at']);

const same = (a, b) => canonical(a) === canonical(b);

function stripRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !ROW_IGNORE.has(k)));
}

function keyed(name, rows = []) {
  const out = new Map(), counts = {};
  for (const row of rows) {
    let key = String(CHILD_KEYS[name](row));
    counts[key] = (counts[key] || 0) + 1;
    if (counts[key] > 1) key += `~${counts[key]}`; // duplicate business keys stay distinguishable
    out.set(key, stripRow(row));
  }
  return out;
}

/** Job record without ids, timestamps and the operational log: what the business data actually is. */
export function jobState(job) {
  if (!job) return null;
  const state = {};
  for (const [k, v] of Object.entries(job)) if (!HEADER_IGNORE.has(k)) state[k] = v;
  for (const name of Object.keys(CHILD_KEYS)) state[name] = [...keyed(name, job[name])].map(([key, row]) => ({ key, ...row }));
  return state;
}

export function stateHash(job) {
  return job ? sha256(canonical(jobState(job))) : null;
}

/** Returns [{ field, old, new }]. A whole added or removed child row has old or new set to null. */
export function diffJobs(before, after) {
  const changes = [];
  const fields = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const f of fields) {
    if (HEADER_IGNORE.has(f)) continue;
    const o = before?.[f] ?? null, n = after?.[f] ?? null;
    if (!same(o, n)) changes.push({ field: f, old: o, new: n });
  }
  for (const name of Object.keys(CHILD_KEYS)) {
    const b = keyed(name, before?.[name]), a = keyed(name, after?.[name]);
    for (const [key, row] of b) {
      if (!a.has(key)) { changes.push({ field: `${name}[${key}]`, old: row, new: null }); continue; }
      const next = a.get(key);
      for (const col of new Set([...Object.keys(row), ...Object.keys(next)])) {
        if (!same(row[col] ?? null, next[col] ?? null)) changes.push({ field: `${name}[${key}].${col}`, old: row[col] ?? null, new: next[col] ?? null });
      }
    }
    for (const [key, row] of a) if (!b.has(key)) changes.push({ field: `${name}[${key}]`, old: null, new: row });
  }
  return changes;
}
