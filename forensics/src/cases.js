// Correlates findings into investigation cases, scores review priority, and
// derives behavioural features. A case is a bundle of evidence for a human
// reviewer; its score orders the review queue and is not a probability.
import { EventStore } from './store.js';
import { buildViews, reconstruct, shipmentRefOk } from './model.js';
import { runRules, DEFAULT_CONFIG } from './rules.js';
import { UNCONFIGURED } from './business_rules.js';
import { normalizeJob } from './normalize.js';
import { buildProvenance, contradictionFindings, assessFinding } from './provenance.js';

export const SCORING = {
  severity_weight: { low: 10, medium: 25, high: 40 },
  corroboration_bonus: { 2: 10, 3: 20 },   // distinct rule families with anomaly findings
  evidence_gap_factor: 0.8,                // incomplete evidence lowers confidence in the picture
  ambiguous_link_factor: 0.5,              // a finding resting only on an ambiguous cross-application link
  bands: [[60, 'high'], [30, 'medium'], [1, 'low'], [0, 'informational']]
};

export const DISPOSITIONS = ['requires_review', 'explained_legitimate', 'escalated', 'closed_without_confirmation', 'confirmed_anomaly'];

export const caseId = correlationId => 'CASE-' + String(correlationId).slice(0, 8).toUpperCase();

/**
 * priority_score = min(100, sum over rule families of the highest severity
 * weight in that family + corroboration bonus) x evidence factors.
 * Several findings of one family count once: they are usually views of one underlying issue.
 */
export function score(findings, view) {
  const anomalies = findings.filter(f => f.kind === 'anomaly');
  const perFamily = new Map();
  for (const f of anomalies) {
    let w = SCORING.severity_weight[f.severity] || 0;
    if (f.details?.link?.ambiguous) w *= SCORING.ambiguous_link_factor;
    perFamily.set(f.family, Math.max(perFamily.get(f.family) || 0, w));
  }
  const base = [...perFamily.values()].reduce((a, b) => a + b, 0);
  const bonus = perFamily.size >= 3 ? SCORING.corroboration_bonus[3] : perFamily.size === 2 ? SCORING.corroboration_bonus[2] : 0;
  const gapFactor = view.gaps.some(g => g.type === 'operation_incomplete' || g.type === 'no_origin_event') ? SCORING.evidence_gap_factor : 1;
  const value = Math.min(100, Math.round((base + bonus) * gapFactor));
  return {
    value, band: SCORING.bands.find(([min]) => value >= min)[1],
    components: { families: Object.fromEntries(perFamily), base, corroboration_bonus: bonus, evidence_gap_factor: gapFactor },
    note: 'Review priority on a 0-100 scale. Not a probability of fraud.'
  };
}

/** Behavioural features per shipment. No identifiers, labels or rule outputs. */
export function features(view) {
  const ts = view.events.map(e => Date.parse(e.server_timestamp)).sort((a, b) => a - b);
  const ops = [...new Map(view.events.map(e => [e.operation_id, Date.parse(e.server_timestamp)])).values()].sort((a, b) => a - b);
  const gaps = ops.slice(1).map((t, i) => (t - ops[i]) / 60000);
  const med = a => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;
  const steps = view.state?.workflow_steps || [];
  const n = normalizeJob(view.state);
  const containerGross = n?.containers.filter(c => c.gross_kg.ok).reduce((s, c) => s + c.gross_kg.value, 0) || 0;
  const firstGen = view.generations.find(g => g.outcome === 'generated');
  const hour = e => new Date(e.server_timestamp).getUTCHours();
  const lastClose = view.closures.filter(c => c.event.action === 'job.closed').at(-1);
  const nc = lastClose ? normalizeJob(lastClose.state) : null;
  return {
    n_events: view.events.length,
    n_updates: view.updates.length,
    n_field_changes: view.updates.reduce((s, u) => s + u.changes.filter(c => !/^(documents|workflow_steps)\[/.test(c.field)).length, 0),
    n_generations: view.generations.length,
    n_generation_failures: view.generations.filter(g => g.outcome === 'failed').length,
    n_updates_after_first_generation: firstGen ? view.updates.filter(u => u.event.sequence > firstGen.result.sequence && u.changes.some(c => !/^(documents|workflow_steps)\[/.test(c.field))).length : 0,
    n_step_changes: view.status_changes.length,
    n_reversals: view.status_changes.filter(s => s.old === 'Completed' && s.new !== 'Completed').length,
    n_reopenings: view.reopenings.length,
    frac_steps_na: steps.length ? steps.filter(s => s.status === 'N/A').length / steps.length : 0,
    frac_steps_pending_at_close: lastClose?.state ? lastClose.state.workflow_steps.filter(s => s.status === 'Pending').length / lastClose.state.workflow_steps.length : 0,
    n_distinct_actors: new Set(view.events.map(e => e.actor?.display_name).filter(Boolean)).size,
    lifetime_hours: ts.length > 1 ? (ts.at(-1) - ts[0]) / 3600000 : 0,
    median_gap_minutes: med(gaps),
    min_gap_minutes: gaps.length ? Math.min(...gaps) : 0,
    frac_events_off_hours: view.events.length ? view.events.filter(e => hour(e) < 3 || hour(e) >= 14).length / view.events.length : 0, // outside 08:30-19:30 IST
    deleted: view.deleted ? 1 : 0,
    weight_rel_diff: n?.gross_kg.ok && containerGross > 0 ? Math.abs(n.gross_kg.value - containerGross) / Math.max(n.gross_kg.value, containerGross) : 0,
    closing_to_taxable_ratio: nc?.closing.amount.ok && nc.taxable_total > 0 ? nc.closing.amount.value / nc.taxable_total : 0,
    n_charges: view.state?.billing_charges?.length || 0,
    n_external_links: view.external_links.length
  };
}

/**
 * Full analysis of an evidence stream: views, findings, provenance, cases. Pure function of the records.
 * Switches (for ablation): config.provenance === false, config.contradictions === false,
 * config.timeline_order = 'sequence' | 'event_time'. config.integrity may carry EventStore.verify() output.
 */
export function analyze(records, config = {}) {
  const { views, context } = buildViews(records);
  // config.business_rules = loadBusinessRules() output; absent means every business rule is unresolved.
  const br = config.business_rules || UNCONFIGURED;
  config = {
    ...(br.required_before_close ? { required_before_close: br.required_before_close } : {}),
    ...(br.tax_scheme ? { tax_schemes: DEFAULT_CONFIG.tax_schemes.filter(s => s.id === br.tax_scheme) } : {}),
    ...(br.closing_bill_basis ? { closing_bill_basis: br.closing_bill_basis } : {}),
    ...config, business_rules: br,
    provenance_config: { ...config.provenance_config, tax_scheme: br.tax_scheme, business_rules_source: br.source }
  };
  const findings = runRules(views, context, config);
  const provenance = new Map();
  if (config.provenance !== false) {
    for (const view of views.values()) {
      if (!view.state) continue;
      const prov = buildProvenance(view, context, config.provenance_config, config.integrity ?? null);
      provenance.set(view.correlation_id, prov);
      if (config.contradictions !== false) findings.push(...contradictionFindings(view, prov));
    }
  }
  const dispositions = new Map();
  for (const r of records) if (r.action === 'case.disposition_recorded') {
    if (!dispositions.has(r.entity_id)) dispositions.set(r.entity_id, []);
    dispositions.get(r.entity_id).push({ disposition: r.payload.disposition, note: r.payload.note, reviewer: r.actor?.display_name ?? null, reviewer_verified: !!r.actor?.verified, at: r.server_timestamp, event_id: r.event_id });
  }
  const cases = [];
  for (const view of views.values()) {
    if (!view.state) continue;
    const fs_ = findings.filter(f => f.correlation_id === view.correlation_id);
    if (!fs_.length) continue;
    const id = caseId(view.correlation_id);
    const history = dispositions.get(id) || [];
    const sc = score(fs_, view);
    const evidenceIds = [...new Set(fs_.flatMap(f => f.evidence_event_ids))];
    const artifacts = view.events.flatMap(e => (e.artifacts || []).map(a => ({ event_id: e.event_id, generation_number: e.generation_number, ...a })));
    cases.push({
      case_id: id, correlation_id: view.correlation_id, job_no: view.job_no, job_nos_seen: [...view.job_nos], entity_id: view.entity_id, deleted: !!view.deleted,
      status: history.at(-1)?.disposition || 'requires_review', dispositions: history,
      priority: sc,
      reasons: fs_.filter(f => f.kind === 'anomaly').sort((a, b) => SCORING.severity_weight[b.severity] - SCORING.severity_weight[a.severity]).map(f => f.title),
      findings: fs_, n_anomaly_findings: fs_.filter(f => f.kind === 'anomaly').length, n_data_quality_findings: fs_.filter(f => f.kind === 'data_quality').length,
      supporting_event_ids: evidenceIds, artifacts,
      provenance: {
        applications: [...new Set([...view.events, ...view.external_links.map(l => l.event)].map(e => e.application))],
        origin: view.origin, source_links: view.source_links,
        external_links: view.external_links.map(l => ({ event_id: l.event.event_id, application: l.event.application, action: l.event.action, method: l.method, confidence: l.confidence, ambiguous: l.ambiguous, basis: l.basis })),
        actors: [...new Map(view.events.filter(e => e.actor?.display_name).map(e => [e.actor.display_name, { name: e.actor.display_name, source: e.actor.source, verified: e.actor.verified }])).values()]
      },
      contradictions: config.contradictions !== false ? (provenance.get(view.correlation_id)?.contradictions.length ?? 0) : null,
      limitations: [
        ...view.gaps.map(g => g.detail),
        ...(view.events.some(e => e.actor?.source === 'client_claimed') ? ['Actor names are claims sent by the client and are not authenticated.'] : []),
        ...[...new Set(fs_.flatMap(f => f.assumptions))]
      ],
      rule_config: { required_before_close: (config.required_before_close ?? DEFAULT_CONFIG.required_before_close), lock_steps: config.lock_steps ?? DEFAULT_CONFIG.lock_steps, unresolved_business_rules: br.unresolved }
    });
  }
  cases.sort((a, b) => b.priority.value - a.priority.value || a.case_id.localeCompare(b.case_id));
  return { views, context, findings, cases, provenance, config };
}

export function caseDetail(analysis, id) {
  const c = analysis.cases.find(x => x.case_id === id);
  if (!c) return null;
  const view = analysis.views.get(c.correlation_id);
  const rec = reconstruct(view, analysis.context, { order: analysis.config?.timeline_order || 'event_time' });
  const cited = new Set(c.supporting_event_ids);
  const prov = analysis.provenance?.get(c.correlation_id) || null;
  const findings = prov ? c.findings.map(f => ({ ...f, assessment: assessFinding(f, view, prov) })) : c.findings;
  return { ...c, findings, provenance: prov && { ...c.provenance, ...prov, contradictions: analysis.config?.contradictions === false ? [] : prov.contradictions }, timeline_ordering: rec.ordering, timeline_note: rec.note, timeline: rec.timeline.map(t => ({ ...t, cited_by_finding: cited.has(t.event_id) })), gaps: rec.gaps, state_from_evidence: rec.current_state_from_evidence, generations: view.generations.map(g => ({ number: g.number, outcome: g.outcome, input_sha256: g.input_sha256, at: g.requested.server_timestamp, artifacts: g.result?.artifacts || [], error: g.result?.payload.error })) };
}

/** Reviewer decisions are themselves evidence: appended to the same chain, never edited. */
export function recordDisposition(dir, { case_id, correlation_id, disposition, note, reviewer, verified = false }) {
  if (!DISPOSITIONS.includes(disposition)) throw new Error(`disposition must be one of: ${DISPOSITIONS.join(', ')}`);
  return new EventStore(dir).append({
    application: 'forensic_layer', action: 'case.disposition_recorded', entity_type: 'case', entity_id: case_id, correlation_id,
    actor: { display_name: reviewer || null, source: verified ? 'review_token' : 'not_supplied', verified },
    payload: { disposition, note: String(note || '').slice(0, 4000) }
  });
}

/**
 * A reviewer's claim that an external record (e.g. a quotation exported without a shipment
 * reference) belongs to a job. Appended to the chain like any other evidence; the record itself is
 * never altered. The link is weighted as a claim (manual_assertion, 0.7) and becomes ambiguous if
 * the record's own reference or container numbers point to a different job.
 */
export function recordLinkAssertion(dir, { target_event_id, job_no, reason, actor, verified = false }) {
  const store = new EventStore(dir);
  const target = store.readAll().records.map(x => x.record).find(r => r.event_id === target_event_id);
  if (!target) throw new Error('no evidence record with that event_id');
  if (['workflow_sync', 'forensic_layer'].includes(target.application) || target.entity_type === 'upload') throw new Error('only records from the desktop tools can be linked by hand');
  if (!shipmentRefOk(job_no)) throw new Error('job_no must be 1-64 letters, digits or / . _ - and spaces');
  if (!String(reason || '').trim()) throw new Error('a reason is required');
  return store.append({
    application: 'forensic_layer', action: 'evidence.link_asserted', entity_type: 'external_record', entity_id: target_event_id,
    actor: { display_name: actor || null, source: verified ? 'review_token' : actor ? 'os_account_claimed' : 'not_supplied', verified },
    payload: { target_event_id, target_application: target.application, job_no: String(job_no).trim(), reason: String(reason).trim().slice(0, 2000) }
  });
}

/** Every desktop-tool record with how (and whether) it is tied to a shipment, newest first. */
export function evidenceList(analysis) {
  const byCorr = new Map([...analysis.views.values()].map(v => [v.correlation_id, v]));
  const cases = new Map(analysis.cases.map(c => [c.correlation_id, c.case_id]));
  return analysis.context.external.map(r => {
    const l = r._link || { status: 'unlinked', method: 'unlinked', confidence: 0, basis: 'not analysed' };
    const p = r.payload || {};
    const targets = l.status === 'linked' ? [...byCorr.values()].filter(v => v.external_links.includes(l)) : (l.candidates || []).map(c => byCorr.get(c)).filter(Boolean);
    return {
      event_id: r.event_id, sequence: r.sequence, application: r.application, action: r.action,
      event_time: p.source?.occurred_at || r.server_timestamp, recorded_at: r.server_timestamp,
      label: p.quote_ref || p.batch_id || p.shipment_ref || (p.container_nos || []).join(', ') || p.format || '',
      shipment_ref_supplied: p.shipment_ref ?? null, actor: r.actor?.display_name ?? null, actor_verified: !!r.actor?.verified,
      status: l.status, method: l.method, confidence: l.confidence, basis: l.basis, conflict: l.conflict || null,
      job_nos: targets.map(v => v.job_no), case_ids: targets.map(v => cases.get(v.correlation_id)).filter(Boolean),
      artifacts: (r.artifacts || []).map(a => ({ role: a.role, sha256: a.sha256, size: a.size }))
    };
  }).sort((a, b) => b.sequence - a.sequence);
}
