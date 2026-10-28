// Builds per-shipment views from the evidence stream, reconstructs timelines,
// links external evidence, and reconciles evidence against the operational database.
import { stateHash } from './diff.js';
import { normId, checkContainerNo } from './normalize.js';

const clone = v => structuredClone(v);
const COMPLETES = { 'job.update_requested': 'job.updated', 'job.delete_requested': 'job.deleted', 'workflow_step.status_change_requested': 'workflow_step.status_changed', 'document.status_change_requested': 'document.status_changed', 'document.generation_requested': ['document.generated', 'document.generation_failed'] };

function applyStatusChange(state, e) {
  const row = (state[e.payload.list] || []).find(r => r.name === e.payload.item_name);
  const c = e.changes.find(x => x.field === `${e.payload.list}[${e.payload.item_name}].status`);
  if (row && c) row.status = c.new;
  state.status = e.payload.job_status;
  const cl = e.payload.closing || {};
  Object.assign(state, { closing_bill_no: cl.bill_no, closing_bill_amount: cl.bill_amount, closing_sgst: cl.sgst, closing_cgst: cl.cgst });
}

/**
 * One view per correlation id (one synchroniser job lifecycle).
 * Everything in a view comes from evidence events; nothing is read from db.json.
 */
export function buildViews(records) {
  const views = new Map();
  const context = { users: new Set(), external: [], uploads: new Map(), storeGaps: [], rejected: [], linkAssertions: new Map() };
  const get = r => {
    if (!views.has(r.correlation_id)) {
      views.set(r.correlation_id, {
        correlation_id: r.correlation_id, entity_id: r.entity_id, job_no: r.job_no, job_nos: new Set(),
        events: [], state: null, last_state_hash: null, origin: null, created: null, deleted: null,
        updates: [], generations: [], status_changes: [], closures: [], reopenings: [],
        source_links: [], external_links: [], gaps: [], refused: []
      });
    }
    return views.get(r.correlation_id);
  };

  for (const r of records) {
    if (r.action === 'system.started') for (const u of r.payload.users || []) context.users.add(u.name);
    if (r.action === 'user.created') context.users.add(r.payload.name);
    if (r.action === 'forensic.capture_gap') context.storeGaps.push(r);
    if (r.action === 'auth.request_rejected') context.rejected.push(r);
    // A later assertion for the same record supersedes the earlier one; all stay in the chain.
    if (r.action === 'evidence.link_asserted') context.linkAssertions.set(r.payload.target_event_id, r);
    if (r.entity_type === 'upload') {
      const u = context.uploads.get(r.entity_id) || { events: [] };
      u.events.push(r);
      if (r.action === 'source.parsed') u.parsed = r.payload.parsed;
      if (r.action === 'source.parse_failed') u.parse_error = r.payload.error;
      context.uploads.set(r.entity_id, u);
      continue;
    }
    if (r.application !== 'workflow_sync' && r.application !== 'forensic_layer') context.external.push(r);
    if (!r.correlation_id || r.application !== 'workflow_sync' || r.entity_type !== 'job') continue;

    const v = get(r);
    v.events.push(r);
    if (r.job_no) { v.job_no = r.job_no; v.job_nos.add(r.job_no); }
    if (r.entity_id) v.entity_id = r.entity_id;
    switch (r.action) {
      case 'job.created':
      case 'job.baseline_captured':
        v.origin = r.action === 'job.created' ? 'created' : 'baseline';
        v.created = r;
        v.state = clone(r.payload.stored);
        v.last_state_hash = r.payload.state_hash;
        v.source_links = r.payload.source_links || [];
        break;
      case 'job.updated': {
        const gen = v.generations.find(g => g.operation_id === r.operation_id);
        v.updates.push({ event: r, changes: r.changes, state_before: v.state, generation: gen || null });
        v.state = clone(r.payload.after);
        v.last_state_hash = r.payload.state_hash;
        break;
      }
      case 'workflow_step.status_changed':
      case 'document.status_changed': {
        const c = r.changes.find(x => x.field === `${r.payload.list}[${r.payload.item_name}].status`);
        const job_status_before = v.state?.status ?? null;
        if (v.state) applyStatusChange(v.state, r);
        v.status_changes.push({ event: r, kind: r.payload.list, name: r.payload.item_name, old: c?.old ?? null, new: c?.new ?? null, job_status_before });
        v.last_state_hash = r.payload.state_hash;
        break;
      }
      case 'job.closed':
      case 'job.completed':
        v.closures.push({ event: r, state: v.state ? clone(v.state) : null });
        break;
      case 'job.reopened':
        v.reopenings.push({ event: r });
        break;
      case 'document.generation_requested':
        v.generations.push({ number: r.generation_number, operation_id: r.operation_id, requested: r, outcome: 'no_outcome_recorded', input_sha256: r.payload.input_sha256, result: null });
        break;
      case 'document.generated':
      case 'document.generation_failed': {
        const g = v.generations.find(x => x.operation_id === r.operation_id);
        if (g) { g.outcome = r.action === 'document.generated' ? 'generated' : 'failed'; g.result = r; }
        break;
      }
      case 'job.delete_requested':
        if (!v.state) v.state = clone(r.payload.snapshot);
        break;
      case 'job.deleted':
        v.deleted = r;
        break;
    }
  }

  for (const v of views.values()) {
    // An operation whose "requested" event has no completion event: a crash, a failed write, or lost evidence.
    const byOp = new Map();
    for (const e of v.events) { if (!byOp.has(e.operation_id)) byOp.set(e.operation_id, []); byOp.get(e.operation_id).push(e.action); }
    for (const e of v.events) {
      const want = COMPLETES[e.action];
      if (want && ![].concat(want).some(a => byOp.get(e.operation_id).includes(a))) {
        v.gaps.push({ type: 'operation_incomplete', event_id: e.event_id, sequence: e.sequence, detail: `${e.action} has no matching ${[].concat(want).join(' / ')} event; the outcome of this operation is unknown from evidence` });
      }
    }
    if (v.origin === 'baseline') v.gaps.push({ type: 'history_before_baseline_unknown', event_id: v.created.event_id, sequence: v.created.sequence, detail: 'job existed before capture began; no evidence about its creation or earlier edits' });
    if (!v.origin) v.gaps.push({ type: 'no_origin_event', detail: 'events exist for this job but no creation or baseline event was captured' });
  }

  // Refused requests carry no correlation id; the job id in the path ties them to the job that
  // held that id at the time (ids can be reused after a deletion).
  for (const r of context.rejected) {
    const id = /^\/api\/jobs\/(\d+)/.exec(r.payload?.path || '')?.[1];
    if (!id) continue;
    const v = [...views.values()].find(x => String(x.entity_id) === id && x.created && x.created.sequence < r.sequence && !(x.deleted && x.deleted.sequence < r.sequence));
    if (v) v.refused.push(r);
  }

  linkExternal(views, context);
  return { views, context };
}

/** A shipment reference as typed: 1-64 characters, starting with a letter or digit. */
export const SHIPMENT_REF = /^[A-Za-z0-9][A-Za-z0-9/._ -]{0,63}$/;
export const shipmentRefOk = raw => (typeof raw === 'string' || typeof raw === 'number') && SHIPMENT_REF.test(String(raw).trim());

/**
 * Entity resolution for evidence from applications that have no shared key with
 * the synchroniser. A link is a claim with a method and a confidence, never a fact.
 * status: linked | ambiguous (several candidates, or the evidence points two ways) | unlinked (with a reason).
 */
export function linkExternal(views, context) {
  const all = [...views.values()];
  const byJobNo = ref => all.filter(v => [...v.job_nos].some(j => normId(j) === ref));
  const names = vs => vs.map(v => v.job_no).join(', ');
  for (const r of context.external) {
    const raw = r.payload?.shipment_ref ?? r.job_no ?? null;
    const malformed = raw !== null && raw !== '' && !shipmentRefOk(raw);
    const ref = malformed ? '' : normId(raw);
    const containers = (r.payload?.container_nos || []).map(c => checkContainerNo(c).normalized).filter(Boolean);
    const byRef = ref ? byJobNo(ref) : [];
    const byContainer = containers.length ? all.filter(v => (v.state?.containers || []).some(c => containers.includes(checkContainerNo(c.container_no).normalized))) : [];
    const assertion = context.linkAssertions.get(r.event_id);
    let candidates = [], method = 'unlinked', confidence = 0, basis, conflict = null;
    if (assertion) {
      // A person's recorded claim, used only where the record itself does not point elsewhere.
      candidates = byJobNo(normId(assertion.payload.job_no));
      method = 'manual_assertion'; confidence = 0.7;
      basis = `linked to ${assertion.payload.job_no} by ${assertion.actor?.display_name || 'unnamed reviewer'}${assertion.actor?.verified ? '' : ' (identity not verified)'} at ${assertion.server_timestamp}: "${assertion.payload.reason}"`;
      const own = byRef.length ? byRef : byContainer;
      if (own.length && !own.some(v => candidates.includes(v))) { conflict = `the record itself points to ${names(own)}`; candidates = [...new Set([...candidates, ...own])]; }
    } else if (byRef.length) {
      candidates = byRef; method = 'job_no_exact_after_normalisation'; confidence = 0.9;
      basis = `shipment_ref "${raw}" typed in ${r.application}`;
      if (byContainer.length && !byContainer.some(v => byRef.includes(v))) { conflict = `container numbers match ${names(byContainer)}`; candidates = [...new Set([...byRef, ...byContainer])]; }
    } else if (byContainer.length) {
      candidates = byContainer; method = 'container_number_match'; confidence = 0.6;
      basis = 'container numbers in payload';
    }
    const reason = malformed ? `malformed shipment reference ${JSON.stringify(String(raw).slice(0, 80))}`
      : ref ? `shipment reference "${raw}" matches no job${containers.length ? ' and no container number matches either' : ''}`
      : containers.length ? 'container numbers match no job' : 'no shipment reference supplied';
    const link = { event: r, method: candidates.length ? method : 'unlinked', confidence: 0, ambiguous: false, status: 'unlinked', basis: candidates.length ? basis : reason };
    if (assertion && !candidates.length) link.basis = `${basis}; but no job ${assertion.payload.job_no} exists`;
    if (candidates.length === 1) {
      link.confidence = confidence; link.status = 'linked';
      candidates[0].external_links.push(link);
    } else if (candidates.length > 1) {
      // Same reference on several job lifecycles, or the evidence points two ways: do not pick one silently.
      link.ambiguous = true; link.status = 'ambiguous';
      link.confidence = +(confidence / candidates.length).toFixed(2);
      link.candidates = candidates.map(v => v.correlation_id);
      if (conflict) link.conflict = conflict;
      for (const v of candidates) v.external_links.push(link);
    }
    r._link = link;
  }
}

function summarize(e) {
  const p = e.payload || {};
  const ch = e.changes || [];
  switch (e.action) {
    case 'job.created': return `Job ${e.job_no} created`;
    case 'job.baseline_captured': return `Existing job ${e.job_no} recorded as baseline (earlier history unknown)`;
    case 'job.update_requested': return 'Edit submitted; previous state preserved';
    case 'job.updated': return ch.length ? `Job edited: ${ch.length} field change(s)` : 'Job saved with no data changes';
    case 'workflow_step.status_change_requested': return `Workflow step "${p.item_name}": ${p.old_status} -> ${p.requested_status} requested`;
    case 'workflow_step.status_changed': return `Workflow step "${p.item_name}" changed`;
    case 'document.status_change_requested': return `Document "${p.item_name}": ${p.old_status} -> ${p.requested_status} requested`;
    case 'document.status_changed': return `Document "${p.item_name}" status changed`;
    case 'job.closed': return `Job closed (bill ${ch.find(c => c.field === 'closing_bill_no')?.new || 'n/a'}, amount ${ch.find(c => c.field === 'closing_bill_amount')?.new ?? 'n/a'})`;
    case 'job.completed': return 'Job marked completed (all documents submitted)';
    case 'job.reopened': return 'Job reopened; closing details cleared by the application';
    case 'document.generation_requested': return `Document generation #${e.generation_number} requested`;
    case 'document.generated': return `Documents generated (#${e.generation_number}): ${e.artifacts.map(a => a.path).join(', ')}`;
    case 'document.generation_failed': return `Document generation #${e.generation_number} FAILED`;
    case 'job.delete_requested': return 'Deletion requested; full snapshot preserved';
    case 'job.deleted': return 'Job deleted from the operational database';
    default: return e.action;
  }
}

export function timelineEntry(e) {
  // Event time and ingestion time differ for records that arrived through an outbox.
  const sourceTime = e.payload?.source?.occurred_at || null;
  return {
    sequence: e.sequence, event_id: e.event_id, operation_id: e.operation_id,
    time: e.server_timestamp, event_time: sourceTime || e.server_timestamp,
    time_basis: sourceTime ? 'source application clock' : e.clock_source === 'simulated' ? 'simulated clock' : 'evidence store clock',
    ingested_at: sourceTime ? e.server_timestamp : null,
    clock_source: e.clock_source, application: e.application, action: e.action,
    actor: e.actor?.display_name ?? null, actor_source: e.actor?.source ?? 'not_supplied', actor_verified: !!e.actor?.verified,
    summary: summarize(e), changes: e.changes || [], artifacts: e.artifacts || [],
    generation_number: e.generation_number, integrity_hash: e.integrity_hash
  };
}

/**
 * Chronological reconstruction for one shipment, with what is NOT known stated explicitly.
 * order 'event_time' (default): by when things happened, using each record's own clock;
 *       neighbours timed by different clocks within `clockSkewMinutes` are marked order_uncertain.
 * order 'sequence': by arrival in the evidence store (outbox records then appear when ingested).
 */
export function reconstruct(view, context, { order = 'event_time', clockSkewMinutes = 10 } = {}) {
  const own = view.events.map(timelineEntry);
  const uploadsFor = id => [...(context?.uploads.values() || [])].find(u => u.events.some(e => e.event_id === id))?.events || [];
  const sources = view.source_links.flatMap(l => uploadsFor(l.upload_event_id))
    .map(e => ({ ...timelineEntry(e), summary: e.action === 'source.uploaded' ? `Source document uploaded: ${e.payload.original_name}` : e.action === 'source.parsed' ? 'Source document parsed (regex extraction, unverified)' : 'Source document could not be parsed', link: 'checklist_pdf_url submitted with the job' }));
  const refused = (view.refused || []).map(e => ({ ...timelineEntry(e), summary: `REFUSED ${e.payload.method} ${e.payload.path}: ${e.payload.reason} (nothing was changed)` }));
  const external = view.external_links.map(l => ({ ...timelineEntry(l.event), summary: `${l.event.application}: ${l.event.action}`, link: `${l.method}, confidence ${l.confidence}${l.ambiguous ? ' (AMBIGUOUS: matches several jobs)' : ''}` }));
  return {
    correlation_id: view.correlation_id, job_no: view.job_no, job_nos_seen: [...view.job_nos], entity_id: view.entity_id,
    origin: view.origin, deleted: !!view.deleted,
    current_state_from_evidence: view.state,
    timeline: orderTimeline([...own, ...sources, ...refused, ...external], order, clockSkewMinutes),
    gaps: view.gaps,
    ordering: order,
    note: order === 'event_time'
      ? 'Ordered by event time. Records from desktop tools carry their own clock; where that makes the order unsafe the entry is marked order_uncertain. Absence of an event here means it was not captured, not that it did not happen.'
      : 'Ordered by arrival in the evidence store. Absence of an event here means it was not captured, not that it did not happen.'
  };
}

function orderTimeline(entries, order, skewMin) {
  if (order === 'sequence') return entries.sort((a, b) => a.sequence - b.sequence);
  entries.sort((a, b) => Date.parse(a.event_time) - Date.parse(b.event_time) || a.sequence - b.sequence);
  entries.forEach((e, i) => {
    const near = [entries[i - 1], entries[i + 1]].filter(n => n && n.time_basis !== e.time_basis && Math.abs(Date.parse(n.event_time) - Date.parse(e.event_time)) < skewMin * 60000);
    e.order_uncertain = near.length > 0;
  });
  return entries;
}

/** Assemble jobs from a raw db.json object the way getJobById() does. */
function dbJobs(db) {
  const of = (t, id) => (db[t] || []).filter(r => r.job_id === id);
  return (db.jobs || []).map(j => ({ ...j, documents: of('documents', j.id), cargo_items: of('cargo_items', j.id), containers: of('containers', j.id), billing_charges: of('billing_charges', j.id), workflow_steps: of('workflow_steps', j.id).sort((a, b) => a.id - b.id) }));
}

/**
 * Compare the operational database with the evidence. Each problem says what
 * was observed; it does not say why (a missed event and a bypassed API look the same).
 */
export function reconcile(db, records) {
  const { views, context } = buildViews(records);
  const problems = [];
  const live = new Map(); // entity_id -> view not yet deleted
  for (const v of views.values()) if (!v.deleted && v.origin) live.set(v.entity_id, v);
  const jobs = dbJobs(db);
  for (const job of jobs) {
    const v = live.get(String(job.id));
    if (!v) { problems.push({ type: 'job_without_evidence', entity_id: String(job.id), job_no: job.job_no, detail: 'job is in the database but has no creation or baseline event' }); continue; }
    if (stateHash(job) !== v.last_state_hash) problems.push({ type: 'state_differs_from_evidence', entity_id: String(job.id), job_no: job.job_no, correlation_id: v.correlation_id, detail: 'database content does not match the last captured state: a write happened that was not captured, or a captured write did not complete' });
    live.delete(String(job.id));
  }
  for (const v of live.values()) problems.push({ type: 'job_missing_without_deletion_evidence', entity_id: v.entity_id, job_no: v.job_no, correlation_id: v.correlation_id, detail: 'evidence shows this job was created and never deleted, but it is not in the database' });
  for (const v of views.values()) for (const g of v.gaps) if (g.type !== 'history_before_baseline_unknown') problems.push({ ...g, correlation_id: v.correlation_id, job_no: v.job_no });
  for (const g of context.storeGaps) problems.push({ type: 'capture_gap', sequence: g.sequence, event_id: g.event_id, detail: `${g.payload.lost_events} event(s) could not be written; first: ${g.payload.first?.action}` });
  return { ok: problems.length === 0, jobs_in_db: jobs.length, shipments_in_evidence: views.size, problems };
}
