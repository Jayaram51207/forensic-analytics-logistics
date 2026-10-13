// Evidence from applications that cannot write to the chain directly
// (3D visualizer, B.I.I.L., EasyQuote). Each writes plain JSON lines to its own
// "outbox" file; ingest() copies them into the hash-chained store.
//
// Outbox records are NOT integrity-protected until ingested, and their
// timestamps come from the source machine's clock. Both facts are kept in the
// ingested event (payload.source) so they are never mistaken for chain-grade evidence.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function outboxAppend(file, rec) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const full = { source_event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(), ...rec };
  fs.appendFileSync(file, JSON.stringify(full) + '\n');
  return full;
}

const validate = r => !r || typeof r !== 'object' ? 'not an object'
  : typeof r.source_event_id !== 'string' || !r.source_event_id ? 'missing source_event_id'
  : typeof r.application !== 'string' || !r.application ? 'missing application'
  : r.application === 'workflow_sync' || r.application === 'forensic_layer' ? 'reserved application name'
  : typeof r.action !== 'string' || !r.action ? 'missing action'
  : Number.isNaN(Date.parse(r.occurred_at)) ? 'occurred_at is not a timestamp' : null;

/** Idempotent: a source_event_id already in the chain is skipped. `simulateTime` is for synthetic data only. */
export function ingest(store, file, { simulateTime = false } = {}) {
  const seen = new Set(store.readAll().records.map(x => x.record.payload?.source?.source_event_id).filter(Boolean));
  const result = { ingested: 0, skipped_duplicates: 0, rejected: [] };
  if (!fs.existsSync(file)) return result;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let rec;
    try { rec = JSON.parse(line); } catch { result.rejected.push({ line: i + 1, reason: 'invalid JSON' }); return; }
    const bad = validate(rec);
    if (bad) { result.rejected.push({ line: i + 1, reason: bad }); return; }
    if (seen.has(rec.source_event_id)) { result.skipped_duplicates++; return; }
    seen.add(rec.source_event_id);
    store.append({
      application: rec.application, action: rec.action,
      entity_type: rec.entity_type || 'external_record', entity_id: rec.source_event_id,
      actor: { display_name: rec.actor_claim ?? null, source: rec.actor_claim ? (rec.actor_source || 'os_account_claimed') : 'not_supplied', verified: false },
      artifacts: Array.isArray(rec.artifacts) ? rec.artifacts : [],
      payload: {
        ...(rec.payload || {}), shipment_ref: rec.shipment_ref ?? null,
        source: { source_event_id: rec.source_event_id, occurred_at: rec.occurred_at, clock: 'source application (unsynchronised)', outbox: path.basename(file), integrity_before_ingest: 'none' }
      }
    }, simulateTime ? { timestamp: new Date(rec.occurred_at).toISOString() } : {});
    result.ingested++;
  });
  return result;
}

// Single definition lives with the visualizer so the live app and the tests cannot drift apart.
export { packingPayload } from '../../3D_stuffing_visualizer/src/forensicPayload.js';
