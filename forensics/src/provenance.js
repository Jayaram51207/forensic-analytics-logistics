// Evidence provenance and cross-application contradiction analysis.
//
// For one shipment this module answers four separate questions and keeps them separate:
//   integrity     - is the captured record unchanged since capture?        (hash chain; see store.js)
//   authenticity  - did the original source really say this?               (never established here)
//   accuracy      - is the value true?                                     (never established here)
//   independence  - how many separately sourced records agree?             (computed from lineage)
//
// Lineage: every value is traced to a ROOT. Two records with the same root are copies of
// one statement, not two witnesses. Where an application does not tell us how a value got
// there, the lineage is marked unknown instead of being guessed.
import { sha256, canonical } from './store.js';
import { parseWeight, parsePackages, parseNumberDate, parseMoney, normId, checkContainerNo, withinTolerance } from './normalize.js';

export const PROVENANCE_CONFIG = {
  min_link_confidence: 0.5,          // below this a cross-application link cannot support a contradiction
  weight_tolerance: { abs: 1, rel: 0.005 },
  money_tolerance: { abs: 1, rel: 0.001 },
  // ASSUMPTION: a packing manifest lists the same packages and cargo weight as the job.
  // True when the planner loads the whole consignment; false for part loads or palletised units.
  compare_packing_manifest: true,
  packing_weight_tolerance: { abs: 50, rel: 0.05 },
  clock_skew_minutes: 10,            // desktop tools use their own clock; closer than this, order is not asserted
  enabled_comparisons: ['gross_weight', 'net_weight', 'packages', 'invoice_no', 'shipping_bill_no', 'container_nos', 'taxable_total', 'job_no', 'tax_treatment', 'timing']
};

export const CLASSIFICATIONS = {
  confirmed_data_inconsistency: { kind: 'anomaly', severity: 'medium', label: 'Confirmed data inconsistency' },
  suspected_operational_anomaly: { kind: 'anomaly', severity: 'low', label: 'Suspected operational anomaly' },
  potential_fraud_indicator_requiring_investigation: { kind: 'anomaly', severity: 'high', label: 'Potential fraud indicator requiring investigation' },
  insufficient_evidence: { kind: 'data_quality', severity: 'low', label: 'Insufficient evidence' },
  unresolved_business_rule_conflict: { kind: 'data_quality', severity: 'low', label: 'Unresolved business-rule conflict' }
};

const FIELD_LABEL = { gross_weight: 'gross weight', net_weight: 'net weight', packages: 'package count', invoice_no: 'invoice number', shipping_bill_no: 'shipping bill number', container_nos: 'container numbers', taxable_total: 'taxable charge total', job_no: 'job number' };
const APP_LABEL = { workflow_sync: 'Workflow Synchroniser', biil_unified: 'B.I.I.L.', visualizer_3d: '3D visualizer', stuffing_report: 'Stuffing report tool', easyquote_export: 'EasyQuote (export)', easyquote_import: 'EasyQuote (import)' };
const appName = a => APP_LABEL[a] || a;

// ---- reading comparable values out of each application's records --------------------------------
const num = (parsed, key, unit) => parsed.ok ? { ok: true, normalized: parsed[key], unit } : { ok: false, reason: parsed.reason };
const ident = v => String(v ?? '').trim() ? { ok: true, normalized: normId(v), unit: 'identifier' } : { ok: false, reason: 'empty' };
const containerSet = list => { const s = [...new Set((list || []).map(c => checkContainerNo(c).normalized).filter(Boolean))].sort(); return s.length ? { ok: true, normalized: s, unit: 'set' } : { ok: false, reason: 'empty' }; };

function fromJobState(st) {
  const charges = (st.billing_charges || []).map(c => parseMoney(c.amount));
  const inv = parseNumberDate(st.invoice_no_date), sb = parseNumberDate(st.sb_no_date);
  return {
    gross_weight: { original: st.gross_weight, ...num(parseWeight(st.gross_weight), 'value', 'kg') },
    net_weight: { original: st.net_weight, ...num(parseWeight(st.net_weight), 'value', 'kg') },
    packages: { original: st.total_pkgs, ...num(parsePackages(st.total_pkgs), 'count', 'packages') },
    invoice_no: { original: st.invoice_no_date, ...(inv.ok ? ident(inv.number) : { ok: false, reason: inv.reason }) },
    shipping_bill_no: { original: st.sb_no_date, ...(sb.ok ? ident(sb.number) : { ok: false, reason: sb.reason }) },
    container_nos: { original: (st.containers || []).map(c => c.container_no), ...containerSet((st.containers || []).map(c => c.container_no)) },
    taxable_total: { original: (st.billing_charges || []).map(c => c.amount), ...(charges.length && charges.every(c => c.ok) ? { ok: true, normalized: charges.reduce((s, c) => s + c.value, 0), unit: 'INR' } : { ok: false, reason: charges.length ? 'unparseable charge' : 'no charges' }) },
    job_no: { original: st.job_no, ...ident(st.job_no) }
  };
}

function fromParsedUpload(p) {
  const out = fromJobState({ gross_weight: p.gross_weight, net_weight: p.net_weight, total_pkgs: p.total_pkgs, invoice_no_date: p.invoice_no_date, sb_no_date: p.sb_no_date, containers: p.containers, billing_charges: [], job_no: p.job_no });
  delete out.taxable_total; // a checklist carries no charges
  return out;
}

const EXTRACTORS = {
  biil_unified(e) {
    const f = e.payload.fields || {}, charges = (e.payload.charges || []).map(c => ({ amount: c.amount }));
    const out = fromJobState({ gross_weight: f.gross_weight, net_weight: f.net_weight, total_pkgs: f.total_pkgs, invoice_no_date: f.invoice_no_date, sb_no_date: f.sb_no_date, containers: (e.payload.container_nos || []).map(c => ({ container_no: c })), billing_charges: charges, job_no: e.payload.shipment_ref });
    if (!String(e.payload.shipment_ref ?? '').trim()) delete out.job_no;
    return { values: out, lineage_note: 'B.I.I.L. does not record whether a value was parsed from a file or typed; lineage inside the tool is unknown.' };
  },
  visualizer_3d(e) {
    if (e.action !== 'packing.run_completed') return null;
    const m = e.payload.manifest || [];
    const usable = m.length > 0 && m.every(x => Number.isFinite(+x.weight) && Number.isFinite(+x.quantity));
    return {
      values: usable ? {
        gross_weight: { original: m.map(x => `${x.quantity} x ${x.weight} kg`), ok: true, normalized: m.reduce((s, x) => s + x.weight * x.quantity, 0), unit: 'kg', assumption: 'manifest unit weights x quantities are taken as the consignment weight' },
        packages: { original: m.map(x => x.quantity), ok: true, normalized: m.reduce((s, x) => s + +x.quantity, 0), unit: 'packages', assumption: 'one manifest unit is taken as one package' }
      } : {},
      lineage_note: 'Manifest was typed into the visualizer; no source reference is captured.', assumption_based: true
    };
  },
  stuffing_report(e) {
    const rows = (e.payload.rows || []).filter(r => r.enabled !== false);
    const val = re => rows.find(r => re.test(String(r.shipment_key || '')))?.shipment_value;
    const v = {};
    const gw = val(/gross\s*weight/i), pk = val(/^packages/i), sb = val(/shipping\s*bill/i);
    if (gw !== undefined) v.gross_weight = { original: gw, ...num(parseWeight(gw), 'value', 'kg') };
    if (pk !== undefined) v.packages = { original: pk, ...num(parsePackages(pk), 'count', 'packages') };
    if (sb !== undefined) { const p = parseNumberDate(sb); v.shipping_bill_no = { original: sb, ...(p.ok ? ident(p.number) : { ok: false, reason: p.reason }) }; }
    if ((e.payload.container_nos || []).length) v.container_nos = { original: e.payload.container_nos, ...containerSet(e.payload.container_nos) };
    return { values: v, lineage_note: 'Stuffing report rows are free text typed by the user.' };
  }
};

const same = (field, a, b, cfg, assumptionBased) => {
  if (field === 'container_nos') return canonical(a) === canonical(b);
  if (typeof a === 'number') return withinTolerance(a, b, assumptionBased ? cfg.packing_weight_tolerance : field === 'taxable_total' ? cfg.money_tolerance : field === 'packages' ? (assumptionBased ? { abs: 0 } : { abs: 0 }) : cfg.weight_tolerance);
  return a === b;
};

const eventTime = e => e.payload?.source?.occurred_at || e.server_timestamp;
const timeBasis = e => e.payload?.source?.occurred_at ? 'source application clock' : e.clock_source === 'simulated' ? 'simulated clock' : 'evidence store clock';

/** History of each comparable field of the synchroniser job: one entry per value it has held. */
function fieldHistory(view) {
  const hist = {};
  const push = (state, evt, how) => {
    for (const [field, v] of Object.entries(fromJobState(state))) {
      const list = hist[field] || (hist[field] = []);
      const prev = list.at(-1);
      if (prev && canonical(prev.value.normalized ?? prev.value.original) === canonical(v.normalized ?? v.original)) continue;
      list.push({ value: v, event: evt, how });
    }
  };
  if (view.created) push(view.created.payload.stored, view.created, view.origin === 'created' ? 'entered at job creation' : 'present when capture began (earlier history unknown)');
  for (const u of view.updates) push(u.event.payload.after, u.event, 'changed by edit');
  return hist;
}

/**
 * Provenance graph, corroboration and contradictions for one shipment view.
 * `integrity` is the result of EventStore.verify() if the caller ran it.
 */
export function buildProvenance(view, context, config = {}, integrity = null) {
  const cfg = { ...PROVENANCE_CONFIG, ...config };
  const items = [];                                   // evidence items, source and derived
  const add = it => { it.evidence_id = 'EV-' + sha256(canonical([it.kind, it.event_id, it.field ?? null, it.parents ?? []])).slice(0, 12); items.push(it); return it; };
  const actorOf = e => ({ display_name: e.actor?.display_name ?? null, source: e.actor?.source ?? 'not_supplied', verified: !!e.actor?.verified });
  const integrityOf = e => integrity ? (integrity.problems.some(p => p.event_id === e.event_id || p.sequence === e.sequence) ? 'FAILED verification' : integrity.ok ? 'verified in hash chain' : 'chain has problems elsewhere') : 'not checked in this run';
  const base = (e, extra) => ({ application: e.application, event_id: e.event_id, source_record_id: e.payload?.source?.source_event_id ?? e.event_id, event_time: eventTime(e), time_basis: timeBasis(e), ingested_at: e.server_timestamp, actor: actorOf(e), record_integrity: integrityOf(e), ...extra });

  // ---- source documents uploaded to the synchroniser, and the values extracted from them
  const upload = view.source_links[0] ? [...context.uploads.values()].find(u => u.events.some(e => e.event_id === view.source_links[0].upload_event_id)) : null;
  let docItem = null, parsedValues = null, parseEvent = null;
  if (upload) {
    const upEvt = upload.events.find(e => e.action === 'source.uploaded');
    parseEvent = upload.events.find(e => e.action === 'source.parsed') || null;
    docItem = add(base(upEvt, { kind: 'source_document', derived: false, root: `doc:${upEvt.artifacts[0]?.sha256}`, artifact: { path: upEvt.artifacts[0]?.path, sha256: upEvt.artifacts[0]?.sha256, original_name: upEvt.payload.original_name }, parents: [], transformation: null, entity_match: { method: 'checklist URL submitted with the job', confidence: 1 }, unverified: ['authenticity of the document', 'accuracy of its contents'] }));
    if (parseEvent) parsedValues = fromParsedUpload(parseEvent.payload.parsed || {});
  }
  const extracted = {};
  for (const [field, v] of Object.entries(parsedValues || {})) {
    if (v.original === undefined || v.original === '' || (Array.isArray(v.original) && !v.original.length)) continue;
    extracted[field] = add(base(parseEvent, { kind: 'extracted_value', derived: true, field, original: v.original, normalized: v.ok ? v.normalized : null, unit: v.unit ?? null, root: docItem.root, parents: [docItem.evidence_id], transformation: 'regex extraction by pdf_parser.py (position in the file not recorded)', entity_match: docItem.entity_match, unverified: ['extraction correctness'], ...(v.ok ? {} : { not_comparable: v.reason }) }));
  }

  // ---- values held by the synchroniser job over time
  const history = fieldHistory(view);
  const current = {};
  for (const [field, list] of Object.entries(history)) {
    list.forEach((h, i) => {
      const ex = extracted[field];
      const copied = i === 0 && ex && h.value.ok && ex.normalized !== null && same(field, h.value.normalized, ex.normalized, cfg);
      const it = add(base(h.event, {
        kind: 'recorded_value', derived: copied, field, original: h.value.original, normalized: h.value.ok ? h.value.normalized : null, unit: h.value.unit ?? null,
        root: copied ? ex.root : `entry:${h.event.event_id}:${field}`,
        parents: copied ? [ex.evidence_id] : [],
        transformation: copied ? 'equal to the value extracted from the uploaded document (form autofill or re-typing)' : `${h.how}; no source reference captured`,
        supersedes: i > 0 ? null : undefined, entity_match: { method: 'synchroniser job record', confidence: 1 },
        unverified: ['accuracy of the value', ...(copied ? [] : ['where the person took the value from'])], ...(h.value.ok ? {} : { not_comparable: h.value.reason })
      }));
      it.is_current = i === list.length - 1;
      if (it.is_current) current[field] = it;
    });
  }

  // ---- documents generated by the synchroniser: derived from the job, never an independent witness
  for (const g of view.generations.filter(x => x.outcome === 'generated')) {
    for (const a of g.result.artifacts) {
      add(base(g.result, { kind: 'generated_artifact', derived: true, artifact: { path: a.path, sha256: a.sha256, content_fingerprint: a.content_fingerprint, role: a.role, archived: !!a.archived }, generation_number: g.number, root: 'derived:workflow_sync_job', parents: Object.values(current).map(c => c.evidence_id), transformation: `compiler.py filled a template from the job record (input hash ${String(g.input_sha256).slice(0, 12)}); cell values were not read back`, entity_match: { method: 'same request as the job write', confidence: 1 }, unverified: ['that the file content equals the recorded input'] }));
    }
  }

  // ---- records from other applications
  const external = [];
  for (const l of view.external_links) {
    const e = l.event, ex = EXTRACTORS[e.application]?.(e);
    const link = { method: l.method, confidence: l.confidence, ambiguous: !!l.ambiguous, basis: l.basis };
    const shares = docItem && (e.artifacts || []).some(a => a.sha256 && a.sha256 === docItem.artifact.sha256);
    const root = shares ? docItem.root : `app:${e.application}`;
    const rec = add(base(e, { kind: 'external_record', derived: false, root, parents: shares ? [docItem.evidence_id] : [], transformation: shares ? 'tool loaded the same source file (identical SHA-256)' : null, artifacts: (e.artifacts || []).map(a => ({ role: a.role, path: a.path, sha256: a.sha256 })), entity_match: link, lineage_note: ex?.lineage_note ?? 'This tool records no comparable shipment fields.', unverified: ['authenticity', 'accuracy', ...(e.payload?.source ? ['record was unprotected until ingested'] : [])] }));
    const values = {};
    for (const [field, v] of Object.entries(ex?.values || {})) {
      values[field] = add(base(e, { kind: 'recorded_value', derived: shares, field, original: v.original, normalized: v.ok ? v.normalized : null, unit: v.unit ?? null, root, parents: [rec.evidence_id], transformation: shares ? 'possibly parsed from the shared source file; edits inside the tool are not captured' : 'typed or parsed inside the tool; not captured', entity_match: link, assumption: v.assumption ?? null, assumption_based: !!ex.assumption_based, unverified: ['accuracy of the value'], ...(v.ok ? {} : { not_comparable: v.reason }) }));
    }
    external.push({ event: e, link, record: rec, values, extractor: ex });
  }

  // ---- corroboration: how many separately sourced records agree with the job's current value
  const corroboration = {};
  for (const [field, cur] of Object.entries(current)) {
    if (cur.normalized === null) { corroboration[field] = { field, status: 'not_comparable', reason: cur.not_comparable }; continue; }
    const others = [extracted[field], ...external.filter(x => !x.link.ambiguous && x.link.confidence >= cfg.min_link_confidence).map(x => x.values[field])].filter(o => o && o.normalized !== null);
    const agree = others.filter(o => same(field, cur.normalized, o.normalized, cfg, o.assumption_based));
    const roots = new Set([cur.root, ...agree.map(o => o.root)]);
    const docRoot = [...roots].some(r => r.startsWith('doc:'));
    corroboration[field] = {
      field, value: cur.original, agreeing_records: 1 + agree.length, independent_roots: roots.size, roots: [...roots],
      copies_of_same_source: 1 + agree.length - roots.size,
      supported_by_source_document: docRoot,
      needs_independent_source: roots.size === 1 && !docRoot,
      statement: roots.size === 1
        ? (docRoot ? `All ${1 + agree.length} record(s) of this value trace to one uploaded document. They are copies, not corroboration; the document's own accuracy is unverified.` : `All ${1 + agree.length} record(s) of this value trace to a single entry in the synchroniser. Agreement between them proves nothing about accuracy: an independent authoritative source is required.`)
        : `${roots.size} separately sourced records agree${docRoot ? ', including an uploaded source document' : ''}. Separate sourcing inside one organisation is weaker than an external authority.`
    };
  }

  // ---- contradictions between the job and other applications' records
  const contradictions = [];
  const sequenceOf = id => view.events.find(e => e.event_id === id)?.sequence ?? null;
  const closedAt = view.closures.filter(c => c.event.action === 'job.closed').at(-1)?.event;
  const endEvent = view.deleted || (view.state?.status === 'Closed' ? closedAt : null);
  for (const x of external) {
    const weakLink = x.link.ambiguous || x.link.confidence < cfg.min_link_confidence;
    const mk = (rule_id, field, a, b, extra) => {
      const c = {
        rule_id, rule_version: '1.0', field, items: [a, b].filter(Boolean).map(i => ({ evidence_id: i.evidence_id, application: i.application, event_id: i.event_id, original: i.original ?? null, normalized: i.normalized ?? null, unit: i.unit ?? null, event_time: i.event_time, time_basis: i.time_basis, root: i.root, actor: i.actor })),
        independence: a && b ? (a.root === b.root ? 'shared_ancestor' : (a.root.startsWith('doc:') || b.root.startsWith('doc:')) ? 'independent_source_document' : 'separately_recorded') : null,
        entity_match: x.link, weakened_by: [], supported_by: [], missing_business_rule: null, ...extra
      };
      if (weakLink) { c.classification = 'insufficient_evidence'; c.weakened_by.push(x.link.ambiguous ? 'The external record matches more than one job; it cannot be attributed to this one.' : `Link confidence ${x.link.confidence} is below ${cfg.min_link_confidence}.`); }
      if (b?.assumption) c.weakened_by.push(`Comparison rests on an assumption: ${b.assumption}.`);
      if (x.extractor?.lineage_note) c.weakened_by.push(x.extractor.lineage_note);
      if (a && b && !(a.actor.verified && b.actor.verified)) c.weakened_by.push('At least one side has no verified actor.');
      c.contradiction_id = 'CX-' + sha256(canonical([rule_id, field, c.items.map(i => i.evidence_id)])).slice(0, 12);
      c.recommendation = c.classification === 'insufficient_evidence' ? 'Establish which shipment the external record belongs to before drawing any conclusion.' : c.classification === 'unresolved_business_rule_conflict' ? 'Obtain the authoritative business rule; no record is shown to be wrong.' : 'Compare both records with an independent source (carrier, customs or weighbridge document) to learn which value is right.';
      contradictions.push(c);
      return c;
    };

    for (const [field, ext] of Object.entries(x.values)) {
      if (!cfg.enabled_comparisons.includes(field) || ext.normalized === null) continue;
      if (ext.assumption_based && !cfg.compare_packing_manifest) continue;
      const cur = current[field];
      if (!cur || cur.normalized === null) continue;
      if (same(field, cur.normalized, ext.normalized, cfg, ext.assumption_based)) continue;
      const numeric = typeof cur.normalized === 'number';
      // Did the job hold the external value at some earlier point? Then the records agreed and the job moved.
      const earlier = (history[field] || []).slice(0, -1).find(h => h.value.ok && same(field, h.value.normalized, ext.normalized, cfg, ext.assumption_based));
      const docAgreesWithExternal = extracted[field] && extracted[field].normalized !== null && extracted[field].root !== ext.root && same(field, extracted[field].normalized, ext.normalized, cfg, ext.assumption_based);
      const c = mk(`XAP-${field.toUpperCase()}`, field, cur, ext, {
        difference: numeric ? { absolute: +(cur.normalized - ext.normalized).toFixed(3), relative: +(Math.abs(cur.normalized - ext.normalized) / Math.max(Math.abs(cur.normalized), Math.abs(ext.normalized))).toFixed(4) } : field === 'container_nos' ? { only_in_job: cur.normalized.filter(v => !ext.normalized.includes(v)), only_in_other: ext.normalized.filter(v => !cur.normalized.includes(v)) } : { nature: 'different identifiers' }
      });
      if (!c.classification) {
        c.classification = ext.assumption_based ? 'suspected_operational_anomaly'
          : numeric && (docAgreesWithExternal || earlier) ? 'potential_fraud_indicator_requiring_investigation'
          : 'confirmed_data_inconsistency';
      }
      if (docAgreesWithExternal) c.supported_by.push(`The uploaded source document also states ${JSON.stringify(extracted[field].original)}, agreeing with ${appName(ext.application)} and not with the job record.`);
      if (earlier) c.supported_by.push(`The job itself held ${JSON.stringify(earlier.value.original)} until it was edited (event ${(history[field][history[field].indexOf(earlier) + 1]).event.event_id}); the other record matches the earlier value.`);
      if (extracted[field] && extracted[field].normalized !== null && same(field, extracted[field].normalized, cur.normalized, cfg)) c.weakened_by.push('The uploaded source document agrees with the job record, not with the other application.');
      c.ordering = orderOf(cur, ext, cfg);
      c.explanation = `${appName(cur.application)} holds ${FIELD_LABEL[field]} ${JSON.stringify(cur.original)}; ${appName(ext.application)} holds ${JSON.stringify(ext.original)} for what is taken to be the same shipment (${x.link.method}, confidence ${x.link.confidence}). ${c.independence === 'shared_ancestor' ? 'Both trace to the same source, so one of them was altered after copying.' : 'The two were recorded separately.'} ${CLASSIFICATIONS[c.classification].label}; this does not show which value is correct, or why they differ.`;
    }

    // Same charges, different tax: both implementations exist in the repository and neither is authoritative.
    if (cfg.enabled_comparisons.includes('tax_treatment') && x.event.application === 'biil_unified' && x.values.taxable_total?.normalized != null && current.taxable_total?.normalized != null && same('taxable_total', current.taxable_total.normalized, x.values.taxable_total.normalized, cfg)) {
      const t = x.event.payload.totals || {}, taxable = current.taxable_total.normalized;
      const syncGrand = taxable * 1.18;
      if (Number.isFinite(+t.grand_total) && !withinTolerance(+t.grand_total, syncGrand, cfg.money_tolerance)) {
        const c = mk('XAP-TAX', 'tax_treatment', current.taxable_total, x.values.taxable_total, { difference: { absolute: +(syncGrand - t.grand_total).toFixed(2) }, missing_business_rule: 'Which GST treatment applies to which charge. compiler.py applies 9% + 9% to every charge; unified_generator.py applies 2.5% + 2.5% to ocean freight.' });
        c.classification = c.classification || 'unresolved_business_rule_conflict';
        c.explanation = `Both applications hold the same taxable total (${taxable}), but B.I.I.L. computed a grand total of ${t.grand_total} where the synchroniser's generator would give ${syncGrand.toFixed(2)}. The two programs implement different tax rules; without the authoritative rule neither total can be called wrong.`;
      }
    }

    // A job number typed in the other tool that is not this job's number (link came from something else).
    if (cfg.enabled_comparisons.includes('job_no') && x.link.method !== 'job_no_exact_after_normalisation' && x.values.job_no?.normalized && current.job_no && ![...view.job_nos].some(j => normId(j) === x.values.job_no.normalized)) {
      const c = mk('XAP-JOB_NO', 'job_no', current.job_no, x.values.job_no, { difference: { nature: 'different identifiers' } });
      c.classification = c.classification || 'confirmed_data_inconsistency';
      c.explanation = `${appName(x.event.application)} refers to job ${JSON.stringify(x.values.job_no.original)}, but the record was linked to job ${JSON.stringify(current.job_no.original)} through ${x.link.method} (confidence ${x.link.confidence}). Either the reference was mistyped or the link is wrong.`;
    }

    // Activity in another application after the job was closed or deleted.
    if (cfg.enabled_comparisons.includes('timing') && endEvent) {
      const gapMin = (Date.parse(eventTime(x.event)) - Date.parse(endEvent.server_timestamp)) / 60000;
      if (gapMin > 0) {
        const pseudo = (e, label) => ({ evidence_id: label === 'end' ? `EV-END-${e.event_id.slice(0, 8)}` : x.record.evidence_id, application: e.application, event_id: e.event_id, original: e.action, normalized: null, unit: null, event_time: eventTime(e), time_basis: timeBasis(e), root: label === 'end' ? `entry:${e.event_id}` : x.record.root, actor: actorOf(e) });
        const uncertain = gapMin < cfg.clock_skew_minutes && timeBasis(x.event) !== timeBasis(endEvent);
        const c = mk('XAP-TIMING', 'timing', pseudo(endEvent, 'end'), pseudo(x.event, 'ext'), { difference: { minutes_after: Math.round(gapMin) } });
        c.ordering = { relation: 'external record after job end', uncertain, note: uncertain ? `The two times come from different clocks and are ${Math.round(gapMin)} minute(s) apart; the order is not established.` : `Times come from ${timeBasis(endEvent)} and ${timeBasis(x.event)}.` };
        c.classification = c.classification || (uncertain ? 'insufficient_evidence' : 'suspected_operational_anomaly');
        c.explanation = `${appName(x.event.application)} recorded "${x.event.action}" ${Math.round(gapMin)} minute(s) after the job was ${view.deleted ? 'deleted' : 'closed'} in the synchroniser. ${uncertain ? 'Given clock differences the order is uncertain.' : 'Work on a finished job may be legitimate (re-issue, correction) and should be explained.'}`;
      }
    }
  }

  function orderOf(a, b) {
    const d = (Date.parse(b.event_time) - Date.parse(a.event_time)) / 60000;
    const mixed = a.time_basis !== b.time_basis;
    const uncertain = mixed && Math.abs(d) < cfg.clock_skew_minutes;
    return { relation: uncertain ? 'order not established' : d >= 0 ? 'job value recorded first' : 'other record made first', minutes_apart: Math.round(Math.abs(d)), uncertain, note: mixed ? 'Times come from different clocks.' : 'Times come from the same clock.' };
  }

  const linkedApps = new Set(external.filter(x => !x.link.ambiguous).map(x => x.event.application));
  return {
    items, corroboration, contradictions,
    external_records: external.map(x => ({ evidence_id: x.record.evidence_id, application: x.event.application, action: x.event.action, event_id: x.event.event_id, event_time: eventTime(x.event), entity_match: x.link, comparable_fields: Object.keys(x.values) })),
    missing_independent_evidence: [
      ...(!upload ? ['No source document was uploaded for this job: every value rests on what was typed.'] : []),
      ...(upload && !parseEvent ? ['The uploaded source document could not be parsed; its contents were not compared.'] : []),
      ...['biil_unified', 'visualizer_3d', 'stuffing_report'].filter(a => !linkedApps.has(a)).map(a => `No ${appName(a)} record is linked to this job.`),
      'No external authority (carrier, customs, weighbridge) is available to this system for any value.'
    ],
    trust: {
      integrity: integrity ? (integrity.ok ? 'All captured records verify in the hash chain.' : `Chain verification reported ${integrity.problems.length} problem(s).`) : 'Chain not verified in this run.',
      integrity_scope: 'Covers records after capture only. It does not cover what was typed before capture, or outbox files before ingestion.',
      authenticity: 'Not established for any source. Uploaded documents are hashed, not authenticated.',
      accuracy: 'Not established for any value. Agreement between records is reported as corroboration strength, never as truth.',
      independence: `${Object.values(corroboration).filter(c => c.needs_independent_source).length} of ${Object.values(corroboration).filter(c => c.status !== 'not_comparable').length} comparable field(s) rest on a single internal entry.`
    }
  };
}

/** Contradictions as findings, so they enter the same case, score and dashboard as rule findings. */
export function contradictionFindings(view, prov) {
  return prov.contradictions.map(c => {
    const cls = CLASSIFICATIONS[c.classification];
    const f = {
      rule_id: c.rule_id, rule_version: c.rule_version, family: 'cross_application', kind: cls.kind, severity: cls.severity,
      title: `${cls.label}: ${FIELD_LABEL[c.field] || c.field.replace('_', ' ')} differs between ${[...new Set(c.items.map(i => appName(i.application)))].join(' and ')}`,
      explanation: c.explanation, evidence_event_ids: [...new Set(c.items.map(i => i.event_id))],
      details: { contradiction_id: c.contradiction_id, classification: c.classification, independence: c.independence, link: c.entity_match, difference: c.difference, ordering: c.ordering ?? null },
      assumptions: [...c.weakened_by, ...(c.missing_business_rule ? [`Missing business rule: ${c.missing_business_rule}`] : [])],
      correlation_id: view.correlation_id, job_no: view.job_no
    };
    f.finding_id = sha256(canonical([f.rule_id, f.correlation_id, f.evidence_event_ids, c.contradiction_id])).slice(0, 16);
    return f;
  });
}

/**
 * What supports and what weakens an existing rule finding, read from the provenance of the shipment.
 * Nothing here changes the finding; it tells the reviewer how much weight it can bear.
 */
export function assessFinding(finding, view, prov) {
  const cited = view.events.filter(e => finding.evidence_event_ids.includes(e.event_id));
  const weakens = [], supports = [];
  if (cited.some(e => e.actor && !e.actor.verified && e.actor.source !== 'system')) weakens.push('Some cited events have no verified actor.');
  if (view.gaps.some(g => g.type === 'operation_incomplete')) weakens.push('Evidence for this shipment has incomplete operations.');
  for (const a of finding.assumptions || []) weakens.push(a);
  if (cited.length) supports.push(`${cited.length} cited event(s) are present in the evidence chain${prov.trust.integrity.startsWith('All') ? ' and verify' : ''}.`);
  if (cited.every(e => e.actor?.verified)) supports.push('Every cited event was made by an authenticated session.');
  const fields = { 'WGT-001': ['gross_weight', 'net_weight', 'packages'], 'SRC-001': ['gross_weight', 'net_weight', 'packages', 'invoice_no', 'shipping_bill_no'], 'FIN-001': ['taxable_total'] }[finding.rule_id] || [];
  for (const f of fields) {
    const c = prov.corroboration[f];
    if (!c || c.status === 'not_comparable') continue;
    if (c.independent_roots > 1) weakens.push(`The job's ${FIELD_LABEL[f]} is matched by ${c.independent_roots - 1} separately sourced record(s).`);
    const cx = prov.contradictions.filter(x => x.field === f && CLASSIFICATIONS[x.classification].kind === 'anomaly');
    if (cx.length) supports.push(`Another application also disagrees with the job's ${FIELD_LABEL[f]} (${cx.map(x => x.contradiction_id).join(', ')}).`);
  }
  return { supports, weakens };
}
