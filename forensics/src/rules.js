// Rule-based forensic checks. Each rule reads a shipment view built from
// evidence and returns findings that cite the supporting event ids.
// A finding is a potential anomaly requiring review, never a conclusion.
// Rationale, tolerances and known false positives: docs/DETECTION_RULES.md.
import { sha256, canonical } from './store.js';
import { normalizeJob, withinTolerance, normId, parseWeight, parsePackages, parseNumberDate } from './normalize.js';
import { UNCONFIGURED } from './business_rules.js';

export const DEFAULT_CONFIG = {
  // Fields that compiler.py writes into the generated workbooks (read from the source).
  output_fields: ['job_no', 'shipper', 'consignee', 'notify', 'also_notify', 'cha', 'forwarding_agent', 'buyer_if_other', 'vessel_voyage', 'carrier',
    'port_of_loading', 'port_of_discharge', 'final_destination', 'marks_nos', 'type_of_packing', 'total_pkgs', 'cargo_desc', 'invoice_no_date',
    'buyer_order_no_date', 'hs_code', 'sb_no_date', 'gross_weight', 'net_weight', 'cbm', 'chargeable_weight', 'payment_mode', 'dimensions',
    'mawb_no_date', 'hawb_no_date', 'exchange_rate', 'bank_ac_drawback', 'containers', 'billing_charges'],
  // ASSUMPTION (unconfirmed business rule): once any of these steps is completed, output-affecting edits deserve review.
  lock_steps: ['Document Verified (Before Sailing)', 'Sailing Completed', 'Flight Status', 'OOC', 'Job Closed'],
  // ASSUMPTION: 'all' = every step not marked N/A must be completed before "Job Closed". May be a list of step names.
  required_before_close: 'all',
  weight_tolerance: { abs: 1, rel: 0.005 },
  money_tolerance: { abs: 1, rel: 0.001 },
  // The repository contains two tax implementations. Neither is confirmed as authoritative, so both are accepted.
  // config/business_rules.json tax_scheme narrows this to one; closing_bill_basis narrows the accepted totals.
  tax_schemes: [
    { id: 'flat_9_9', name: 'compiler.py (9% CGST + 9% SGST on every charge)', rate: () => 0.09 },
    { id: 'ocean_freight_2_5', name: 'unified_generator.py (2.5% + 2.5% on ocean freight, 9% + 9% otherwise)', rate: d => /^(o\/f|of[ -]|of$)|ocean freight/i.test(d.trim()) ? 0.025 : 0.09 }
  ],
  closing_bill_basis: null,
  business_rules: UNCONFIGURED,
  tds_rate: 0.02,
  // Charges that public/js/app.js inserts automatically after a checklist is parsed (handleChecklistUpload).
  placeholder_charge_sets: [
    [['O/F - OCEAN FREIGHT CHARGES', 120000], ['LOCAL THC TERMINAL CHARGES', 9500], ['DOCUMENTATION & BL ISSUANCE FEES', 4500]],
    [['A/F - AIR FREIGHT CHARGES', 85000], ['AIRPORT TERMINAL HANDLING (THC)', 6500], ['AWB DOCUMENTATION & PROCESSING FEES', 3500]]
  ],
  placeholder_min_matches: 2,
  regen_changed_threshold: 4,
  regen_identical_threshold: 3,
  reversal_threshold: 3,
  bulk_na_fraction: 0.4,
  check_container_check_digit: true,
  // ASSUMPTION (domain, not a business rule): stuffing, gate pass, let-export and vessel departure lie
  // between "Cargo Movement" and "Sailing Completed", so live recording of both takes hours at least.
  min_cargo_to_sailing_minutes: 120,
  disabled_rules: []
};

const ids = (...events) => [...new Set(events.flat().filter(Boolean).map(e => e.event_id))];
const isOutputField = (cfg, field) => cfg.output_fields.includes(field.split(/[[.]/)[0]);
const CLOSE_STEP = /^(job closed|close job)$/i;

function finding(view, rule, f) {
  const base = { rule_id: rule.id, rule_version: rule.version, family: rule.family, kind: 'anomaly', assumptions: [], details: {}, ...f, correlation_id: view?.correlation_id ?? null, job_no: view?.job_no ?? null };
  base.finding_id = sha256(canonical([base.rule_id, base.correlation_id, base.evidence_event_ids, base.title])).slice(0, 16);
  return base;
}

export function schemeTotals(cfg, charges) {
  const taxable = charges.reduce((s, c) => s + c.amount.value, 0);
  return cfg.tax_schemes.map(s => {
    const half = charges.reduce((t, c) => t + Math.round(c.amount.value * s.rate(c.description) * 100) / 100, 0);
    const grand = taxable + 2 * half;
    return { scheme: s.name, taxable, cgst: half, sgst: half, grand_total: grand, payable_after_tds: grand - taxable * cfg.tds_rate };
  });
}

export const RULES = [
  {
    id: 'GEN-001', version: '1.0', family: 'document_integrity', severity: 'high',
    purpose: 'Output-affecting data changed after documents were generated, and no later generation succeeded, so the issued documents no longer match the record.',
    run(view, cfg) {
      const out = [];
      const ok = view.generations.filter(g => g.outcome === 'generated');
      for (const u of view.updates) {
        const material = u.changes.filter(c => isOutputField(cfg, c.field));
        if (!material.length) continue;
        const prior = ok.filter(g => g.result.sequence < u.event.sequence && g.operation_id !== u.event.operation_id).at(-1);
        if (!prior) continue;
        const later = ok.find(g => g.requested.sequence >= u.generation?.requested.sequence || g.result.sequence > u.event.sequence);
        if (later) continue;
        out.push(finding(view, this, {
          severity: this.severity, title: 'Record changed after document generation; documents were not regenerated',
          explanation: `Generation #${prior.number} produced documents. A later edit changed ${material.length} output-affecting field(s) (${material.slice(0, 5).map(c => c.field).join(', ')}) and ${u.generation ? `generation #${u.generation.number} ${u.generation.outcome === 'failed' ? 'failed' : 'has no recorded outcome'}` : 'no generation was attempted'}. The last successfully generated documents reflect the earlier values.`,
          evidence_event_ids: ids(prior.result, u.event, u.generation?.result, u.generation?.requested),
          details: { changed_fields: material, last_good_generation: prior.number, last_good_artifacts: prior.result.artifacts.map(a => ({ path: a.path, sha256: a.sha256 })) }
        }));
      }
      return out;
    }
  },
  {
    id: 'GEN-002', version: '1.0', family: 'late_modification', severity: 'high',
    purpose: 'Output-affecting data edited after a milestone that normally fixes the shipment record.',
    run(view, cfg) {
      const out = [];
      for (const u of view.updates) {
        const material = u.changes.filter(c => isOutputField(cfg, c.field));
        if (!material.length || !u.state_before) continue;
        const locked = (u.state_before.workflow_steps || []).filter(s => s.status === 'Completed' && cfg.lock_steps.includes(s.name));
        if (!locked.length) continue;
        const stepEvents = view.status_changes.filter(s => s.new === 'Completed' && cfg.lock_steps.includes(s.name) && s.event.sequence < u.event.sequence).map(s => s.event);
        out.push(finding(view, this, {
          severity: this.severity, title: `Output-affecting edit after "${locked[0].name}"`,
          explanation: `${material.length} output-affecting field(s) (${material.slice(0, 5).map(c => c.field).join(', ')}) were changed while milestone step(s) ${locked.map(s => `"${s.name}"`).join(', ')} were already completed.`,
          evidence_event_ids: ids(stepEvents, u.event),
          details: { changed_fields: material, completed_milestones: locked.map(s => s.name), regenerated: u.generation?.outcome ?? 'not_attempted' },
          assumptions: ['Which steps fix the record is a configurable assumption (lock_steps), not a confirmed business rule.']
        }));
      }
      return out;
    }
  },
  {
    id: 'GEN-003', version: '1.0', family: 'regeneration', severity: 'medium',
    purpose: 'Unusually many document generations for one shipment.',
    run(view, cfg) {
      const out = [];
      const hashes = view.generations.map(g => g.input_sha256);
      const changed = hashes.filter((h, i) => i > 0 && h !== hashes[i - 1]).length;
      const identical = hashes.filter((h, i) => i > 0 && h === hashes[i - 1]).length;
      if (changed >= cfg.regen_changed_threshold) {
        out.push(finding(view, this, {
          severity: 'medium', title: `Documents regenerated ${changed} times with changed input`,
          explanation: `${view.generations.length} generation attempts were recorded; ${changed} used input different from the previous attempt (threshold ${cfg.regen_changed_threshold}).`,
          evidence_event_ids: ids(view.generations.map(g => g.requested)), details: { attempts: view.generations.length, changed_input: changed, identical_input: identical }
        }));
      }
      if (identical >= cfg.regen_identical_threshold) {
        out.push(finding(view, this, {
          severity: 'low', title: `Documents regenerated ${identical} times with identical input`,
          explanation: `${identical} generation attempts repeated the previous input exactly (threshold ${cfg.regen_identical_threshold}). Identical input is established from the input hash; output byte hashes always differ because the generator embeds the save time.`,
          evidence_event_ids: ids(view.generations.map(g => g.requested)), details: { attempts: view.generations.length, identical_input: identical }
        }));
      }
      return out;
    }
  },
  {
    id: 'WGT-001', version: '1.0', family: 'quantity_consistency', severity: 'medium',
    purpose: 'Header gross/net weight and package count should equal the container totals of the same job.',
    run(view, cfg) {
      const out = [];
      const n = normalizeJob(view.state);
      if (!n || !n.containers.length) return out;
      const last = view.events.findLast(e => e.action === 'job.updated' || e.action === 'job.created' || e.action === 'job.baseline_captured');
      const checks = [
        ['gross weight', n.gross_kg, n.containers.map(c => c.gross_kg), 'value', cfg.weight_tolerance, 'kg'],
        ['net weight', n.net_kg, n.containers.map(c => c.net_kg), 'value', cfg.weight_tolerance, 'kg'],
        ['package count', n.packages, n.containers.map(c => c.packages), 'count', { abs: 0 }, 'packages']
      ];
      for (const [label, header, parts, key, tol, unit] of checks) {
        const usable = parts.filter(p => p.ok && p[key] > 0);
        if (!header.ok) {
          if (header.reason !== 'empty' || usable.length) out.push(finding(view, this, { kind: 'data_quality', severity: 'low', title: `Header ${label} cannot be compared`, explanation: `Header ${label} "${header.original}" could not be interpreted (${header.reason}); no mismatch is asserted.`, evidence_event_ids: ids(last), details: { header } }));
          continue;
        }
        if (!usable.length) continue; // container figures not entered: nothing to compare against
        if (usable.length !== parts.length) {
          out.push(finding(view, this, { kind: 'data_quality', severity: 'low', title: `Container ${label} incomplete`, explanation: `${parts.length - usable.length} of ${parts.length} container rows have no usable ${label}; totals were not compared.`, evidence_event_ids: ids(last) }));
          continue;
        }
        const sum = usable.reduce((s, p) => s + p[key], 0);
        if (!withinTolerance(header[key], sum, tol)) {
          out.push(finding(view, this, {
            severity: this.severity, title: `Header ${label} differs from container total`,
            explanation: `Header ${label} is ${header[key]} ${unit} ("${header.original}") but the ${usable.length} container row(s) total ${sum} ${unit}; difference ${+(header[key] - sum).toFixed(3)} ${unit} exceeds the tolerance.`,
            evidence_event_ids: ids(last), details: { quantity: label, header_value: header[key], container_total: sum, difference: header[key] - sum, tolerance: tol }
          }));
        }
      }
      return out;
    }
  },
  {
    id: 'FIN-001', version: '1.0', family: 'financial_consistency', severity: 'high',
    purpose: 'Closing bill figures entered at job closure should be explainable from the stored charges.',
    run(view, cfg) {
      const out = [];
      for (const c of view.closures.filter(x => x.event.action === 'job.closed')) {
        const n = normalizeJob(c.state);
        if (!n) continue;
        const ev = ids(c.event, view.events.find(e => e.event_id === c.event.payload.triggered_by_event_id));
        if (!n.closing.amount.ok) {
          out.push(finding(view, this, { kind: 'data_quality', severity: 'low', title: 'Job closed without a usable closing bill amount', explanation: `Closing bill amount "${n.closing.amount.original}" is ${n.closing.amount.reason}.`, evidence_event_ids: ev }));
          continue;
        }
        if (!n.charges.length || n.taxable_total === null) {
          out.push(finding(view, this, { kind: 'data_quality', severity: 'low', title: 'Closing bill cannot be checked: no usable stored charges', explanation: `A closing bill of ${n.closing.amount.value} was recorded but the job holds ${n.charges.length} charge row(s) with usable amounts, so there is nothing to compare it with.`, evidence_event_ids: ev }));
          continue;
        }
        const schemes = schemeTotals(cfg, n.charges);
        const bases = { taxable_total: 'taxable total', grand_total: 'grand total incl. GST', after_tds: 'payable after TDS' };
        const candidates = schemes.flatMap(s => [['taxable total', s.taxable, s.scheme], ['grand total incl. GST', s.grand_total, s.scheme], ['payable after TDS', s.payable_after_tds, s.scheme]])
          .filter(([basis]) => !cfg.closing_bill_basis || basis === bases[cfg.closing_bill_basis]);
        const br = cfg.business_rules || UNCONFIGURED;
        const basisNote = br.closing_bill_basis ? `Closing bill basis "${br.closing_bill_basis}" from ${br.source}.` : 'Which total the closing bill should equal is UNRESOLVED (closing_bill_basis not configured); taxable total, grand total and amount after TDS are all accepted.';
        const taxNote = br.tax_scheme ? `Tax scheme "${br.tax_scheme}" from ${br.source}.` : 'Which tax implementation is authoritative is UNRESOLVED (tax_scheme not configured); both implementations found in the repository are accepted.';
        const hit = candidates.find(([, v]) => withinTolerance(n.closing.amount.value, v, cfg.money_tolerance));
        if (!hit) {
          out.push(finding(view, this, {
            severity: 'high', title: 'Closing bill amount is not explained by the stored charges',
            explanation: `Closing bill amount ${n.closing.amount.value} matches none of the accepted totals derivable from the ${n.charges.length} stored charge(s) (taxable ${schemes[0].taxable}; grand totals ${schemes.map(s => s.grand_total.toFixed(2)).join(' / ')} under ${schemes.length === 1 ? 'the configured tax scheme' : 'the two tax implementations found in the repository'}).`,
            evidence_event_ids: ev, details: { closing_amount: n.closing.amount.value, candidates: candidates.map(([basis, value, scheme]) => ({ basis, value: +value.toFixed(2), scheme })) },
            assumptions: [basisNote, taxNote]
          }));
        }
        if (n.closing.sgst.ok && n.closing.cgst.ok) {
          const taxOk = schemes.some(s => withinTolerance(n.closing.sgst.value, s.sgst, cfg.money_tolerance) && withinTolerance(n.closing.cgst.value, s.cgst, cfg.money_tolerance));
          if (!taxOk) {
            out.push(finding(view, this, {
              severity: 'medium', title: 'Closing SGST/CGST is not explained by the stored charges',
              explanation: `Closing SGST ${n.closing.sgst.value} / CGST ${n.closing.cgst.value} ${schemes.length === 1 ? 'do not match the configured tax scheme' : 'match neither tax implementation'} applied to the stored charges (expected ${schemes.map(s => s.sgst.toFixed(2)).join(' or ')} each).`,
              evidence_event_ids: ev, details: { sgst: n.closing.sgst.value, cgst: n.closing.cgst.value, expected: schemes.map(s => ({ scheme: s.scheme, each: +s.sgst.toFixed(2) })) },
              assumptions: [taxNote]
            }));
          }
        }
      }
      const closed = view.closures.filter(x => x.event.action === 'job.closed');
      for (let i = 1; i < closed.length; i++) {
        const a = normalizeJob(closed[i - 1].state).closing, b = normalizeJob(closed[i].state).closing;
        if (a.amount.ok && b.amount.ok && !withinTolerance(a.amount.value, b.amount.value, cfg.money_tolerance)) {
          out.push(finding(view, this, {
            severity: 'medium', title: 'Closing bill amount changed between closures',
            explanation: `The job was closed with bill amount ${a.amount.value} (bill ${a.bill_no}), reopened, and closed again with ${b.amount.value} (bill ${b.bill_no}). The application blanks the first figures on reopening; they survive only in evidence.`,
            evidence_event_ids: ids(closed[i - 1].event, view.reopenings.map(r => r.event).filter(e => e.sequence > closed[i - 1].event.sequence && e.sequence < closed[i].event.sequence), closed[i].event),
            details: { first: a, second: b }
          }));
        }
      }
      return out;
    }
  },
  {
    id: 'WFL-001', version: '1.0', family: 'workflow', severity: 'medium',
    purpose: 'Job closed while other workflow steps were still pending.',
    run(view, cfg) {
      const out = [];
      for (const c of view.closures.filter(x => x.event.action === 'job.closed' && x.state)) {
        const pending = c.state.workflow_steps.filter(s => s.status === 'Pending' && !CLOSE_STEP.test(s.name) && (cfg.required_before_close === 'all' || cfg.required_before_close.includes(s.name)));
        if (!pending.length) continue;
        out.push(finding(view, this, {
          severity: this.severity, title: `Job closed with ${pending.length} step(s) still pending`,
          explanation: `At closure, ${pending.length} of ${c.state.workflow_steps.length} steps were Pending (not completed and not marked N/A): ${pending.slice(0, 6).map(s => `"${s.name}"`).join(', ')}${pending.length > 6 ? ', ...' : ''}.`,
          evidence_event_ids: ids(c.event, view.events.find(e => e.event_id === c.event.payload.triggered_by_event_id)),
          details: { pending_steps: pending.map(s => s.name) },
          assumptions: [(cfg.business_rules || UNCONFIGURED).required_before_close
            ? `Mandatory steps from ${cfg.business_rules.source} (required_before_close).`
            : 'Mandatory steps before closure are UNRESOLVED (required_before_close not configured): every pending step is reported, and workflow compliance is NOT verified. The application itself enforces no order.']
        }));
      }
      return out;
    }
  },
  {
    id: 'WFL-002', version: '1.0', family: 'workflow', severity: 'medium',
    purpose: 'Repeated reversal of completed workflow steps.',
    run(view, cfg) {
      const rev = view.status_changes.filter(s => s.kind === 'workflow_steps' && s.old === 'Completed' && s.new !== 'Completed');
      if (rev.length < cfg.reversal_threshold) return [];
      return [finding(view, this, {
        severity: this.severity, title: `${rev.length} reversals of completed workflow steps`,
        explanation: `Completed steps were set back ${rev.length} times (threshold ${cfg.reversal_threshold}): ${[...new Set(rev.map(r => r.name))].slice(0, 6).map(n => `"${n}"`).join(', ')}.`,
        evidence_event_ids: ids(rev.map(r => r.event)), details: { reversals: rev.map(r => ({ step: r.name, to: r.new, sequence: r.event.sequence })) }
      })];
    }
  },
  {
    id: 'WFL-003', version: '1.0', family: 'workflow', severity: 'low',
    purpose: 'A large share of workflow steps marked not applicable.',
    run(view, cfg) {
      const steps = view.state?.workflow_steps || [];
      const na = steps.filter(s => s.status === 'N/A');
      if (!steps.length || na.length / steps.length < cfg.bulk_na_fraction) return [];
      return [finding(view, this, {
        severity: this.severity, title: `${na.length} of ${steps.length} workflow steps marked N/A`,
        explanation: `${Math.round(100 * na.length / steps.length)}% of steps are N/A (threshold ${Math.round(cfg.bulk_na_fraction * 100)}%): ${na.slice(0, 6).map(s => `"${s.name}"`).join(', ')}.`,
        evidence_event_ids: ids(view.status_changes.filter(s => s.new === 'N/A').map(s => s.event)), details: { na_steps: na.map(s => s.name) }
      })];
    }
  },
  {
    id: 'DEF-001', version: '1.0', family: 'placeholder_values', severity: 'medium',
    purpose: 'Charges the application inserts automatically as placeholders are still present in the billed record.',
    run(view, cfg) {
      const charges = view.state?.billing_charges || [];
      for (const set of cfg.placeholder_charge_sets) {
        const hits = set.filter(([d, a]) => charges.some(c => c.description === d && Number(c.amount) === a));
        if (hits.length >= cfg.placeholder_min_matches) {
          const gen = view.generations.filter(g => g.outcome === 'generated').at(-1);
          const src = view.events.findLast(e => e.action === 'job.updated' || e.action === 'job.created' || e.action === 'job.baseline_captured');
          return [finding(view, this, {
            severity: this.severity, title: `${hits.length} auto-inserted placeholder charge(s) left unchanged`,
            explanation: `The job's charges include ${hits.map(([d, a]) => `"${d}" = ${a}`).join('; ')}. These exact description/amount pairs are hard-coded defaults inserted by the browser after a checklist upload${gen ? ' and were present when documents were generated' : ''}.`,
            evidence_event_ids: ids(src, gen?.result), details: { matched: hits }
          })];
        }
      }
      return [];
    }
  },
  {
    id: 'IDN-001', version: '1.0', family: 'identifier', severity: 'low',
    purpose: 'Identifier quality: container number check digits, identifiers missing at closure, job number changed after creation.',
    run(view, cfg) {
      const out = [];
      const n = normalizeJob(view.state);
      if (!n) return out;
      const src = view.events.findLast(e => e.action === 'job.updated' || e.action === 'job.created' || e.action === 'job.baseline_captured');
      if (cfg.check_container_check_digit) {
        const bad = n.containers.filter(c => c.container_no.original && !(c.container_no.valid_format && c.container_no.check_digit_valid));
        if (bad.length) {
          out.push(finding(view, this, {
            kind: 'data_quality', severity: 'low', title: `${bad.length} container number(s) fail ISO 6346 validation`,
            explanation: bad.map(c => `"${c.container_no.original}": ${c.container_no.reason}`).join('; ') + '. This may be a typing error; it is reported as a data-quality issue, not as a mismatch.',
            evidence_event_ids: ids(src), details: { containers: bad.map(c => c.container_no) }
          }));
        }
      }
      const closed = view.closures.filter(x => x.event.action === 'job.closed').at(-1);
      if (closed && view.state.status === 'Closed') {
        const missing = [['invoice_no_date', 'invoice number'], ['sb_no_date', 'shipping bill / bill of entry number']].filter(([f]) => !String(closed.state?.[f] ?? '').trim());
        if (missing.length) out.push(finding(view, this, { kind: 'data_quality', severity: 'low', title: `Job closed without ${missing.map(m => m[1]).join(' and ')}`, explanation: `At closure the field(s) ${missing.map(m => m[0]).join(', ')} were empty.`, evidence_event_ids: ids(closed.event), details: { missing: missing.map(m => m[0]) } }));
      }
      const renames = view.updates.flatMap(u => u.changes.filter(c => c.field === 'job_no').map(c => ({ c, e: u.event })));
      if (renames.length) {
        out.push(finding(view, this, {
          severity: 'medium', title: 'Job number changed after creation',
          explanation: renames.map(r => `"${r.c.old}" -> "${r.c.new}"`).join(', ') + '. The job number is the only shipment key the synchroniser has; changing it breaks links to documents already issued under the old number.',
          evidence_event_ids: ids(renames.map(r => r.e)), details: { renames: renames.map(r => r.c) }
        }));
      }
      return out;
    }
  },
  {
    id: 'SRC-001', version: '1.0', family: 'source_consistency', severity: 'low',
    purpose: 'Values stored at creation differ from values extracted from the uploaded source document.',
    run(view, cfg, context) {
      const link = view.source_links[0];
      if (!link || view.origin !== 'created') return [];
      const upload = [...context.uploads.values()].find(u => u.events.some(e => e.event_id === link.upload_event_id));
      if (!upload?.parsed) return [];
      const stored = view.created.payload.stored, parsed = upload.parsed;
      const diffs = [];
      const cmp = (field, parse, key, tol) => {
        const a = parse(parsed[field]), b = parse(stored[field]);
        if (!a.ok || !b.ok) return;
        const equal = typeof a[key] === 'number' ? withinTolerance(a[key], b[key], tol) : normId(a[key]) === normId(b[key]);
        if (!equal) diffs.push({ field, extracted: parsed[field], stored: stored[field] });
      };
      cmp('gross_weight', parseWeight, 'value', cfg.weight_tolerance);
      cmp('net_weight', parseWeight, 'value', cfg.weight_tolerance);
      cmp('total_pkgs', parsePackages, 'count', { abs: 0 });
      cmp('invoice_no_date', parseNumberDate, 'number');
      cmp('sb_no_date', parseNumberDate, 'number');
      if (!diffs.length) return [];
      return [finding(view, this, {
        severity: this.severity, title: `${diffs.length} stored value(s) differ from the uploaded source document`,
        explanation: diffs.map(d => `${d.field}: extracted "${d.extracted}", stored "${d.stored}"`).join('; ') + '. Extraction is regex-based and can be wrong, so this indicates a difference to check, not which value is correct.',
        evidence_event_ids: ids(upload.events, view.created), details: { differences: diffs, source_sha256: link.sha256 },
        assumptions: ['The link between upload and job rests on the checklist URL submitted with the job.']
      })];
    }
  },
  {
    id: 'DEL-001', version: '1.0', family: 'deletion', severity: 'medium',
    purpose: 'A job was deleted from the operational system after it was closed or had passed a milestone.',
    run(view, cfg) {
      if (!view.deleted) return [];
      const req = view.events.find(e => e.action === 'job.delete_requested');
      const snap = req?.payload.snapshot;
      const generated = view.generations.filter(g => g.outcome === 'generated').length;
      const wasClosed = snap?.status === 'Closed' || view.closures.length > 0;
      const milestones = (snap?.workflow_steps || []).filter(s => s.status === 'Completed' && cfg.lock_steps.includes(s.name)).map(s => s.name);
      // The synchroniser generates documents at creation, so "documents existed" is true of every job and cannot
      // separate a discarded draft from a removed shipment. Closure or a completed milestone can.
      const serious = wasClosed || milestones.length > 0;
      return [finding(view, this, {
        kind: serious ? 'anomaly' : 'notice',
        severity: serious ? 'medium' : 'low', title: serious ? 'Job deleted after closure or a completed milestone' : 'Job deleted before any milestone',
        explanation: `The job was removed from the operational database${req?.actor.display_name ? ` (claimed actor: ${req.actor.display_name}, unverified)` : ' (no actor supplied)'}. At deletion it was ${snap?.status ?? 'in an unknown state'}${milestones.length ? `, with milestone(s) ${milestones.map(m => `"${m}"`).join(', ')} completed` : ''}, and had ${generated} successful document generation(s). The application also deleted its history log; the snapshot and ${view.events.length} events remain in the evidence store.`,
        evidence_event_ids: ids(req, view.deleted), details: { generated, was_closed: wasClosed, completed_milestones: milestones, status_at_deletion: snap?.status ?? null }
      })];
    }
  },
  {
    id: 'ACT-001', version: '1.0', family: 'actor', severity: 'low',
    purpose: 'The actor named in a request does not match the authenticated session, or (unauthenticated mode) matches no account.',
    run(view, cfg, context) {
      const out = [];
      // Authenticated requests: the session says who acted; the request body named someone else.
      const mismatched = view.events.filter(e => e.actor?.verified && e.actor.claimed_display_name);
      if (mismatched.length) {
        const pairs = [...new Set(mismatched.map(e => `"${e.actor.claimed_display_name}" (signed in as ${e.actor.display_name})`))];
        out.push(finding(view, this, {
          severity: 'medium', title: 'Request named a different user than the signed-in account',
          explanation: `${mismatched.length} event(s) were sent by an authenticated session while the request body named another actor: ${pairs.slice(0, 3).join('; ')}. The bundled interface always sends the signed-in user's own name, so this request was built some other way. The session identity is the one recorded as actor.`,
          evidence_event_ids: ids(mismatched.slice(0, 20)), details: { pairs, events: mismatched.length }
        }));
      }
      // Unauthenticated mode (SYNC_AUTH=off): names are claims only.
      const odd = context.users.size ? view.events.filter(e => e.actor?.source === 'client_claimed' && e.actor.display_name && !context.users.has(e.actor.display_name)) : [];
      if (odd.length) {
        const names = [...new Set(odd.map(e => e.actor.display_name))];
        out.push(finding(view, this, {
          severity: this.severity, title: `Actor name(s) not matching any account: ${names.slice(0, 3).join(', ')}`,
          explanation: `${odd.length} event(s) carry an actor name that is not the display name of any account known from evidence. These requests were not authenticated, so this shows the request did not come from the standard interface for a known user; it does not identify who sent it.`,
          evidence_event_ids: ids(odd.slice(0, 20)), details: { names, events: odd.length }
        }));
      }
      return out;
    }
  },
  {
    id: 'PCK-001', version: '1.0', family: 'physical_feasibility', severity: 'medium',
    purpose: 'A packing run linked to this shipment left cargo unplaced.',
    run(view) {
      const out = [];
      for (const l of view.external_links.filter(x => x.event.action === 'packing.run_completed')) {
        const p = l.event.payload;
        if (!(p.unplaced_count > 0)) continue;
        const reasons = p.unplaced_reasons || {};
        out.push(finding(view, this, {
          severity: l.ambiguous ? 'low' : this.severity, title: `Packing run left ${p.unplaced_count} item(s) unplaced`,
          explanation: `A packing run for container "${p.container?.name}" placed ${p.placed_count} item(s) and left ${p.unplaced_count} unplaced (${Object.entries(reasons).map(([k, v]) => `${k}: ${v}`).join(', ') || 'reason not recorded'}). Linked to this job by ${l.method} (confidence ${l.confidence}${l.ambiguous ? ', ambiguous' : ''}). The packing algorithm is a heuristic: unplaced cargo means this algorithm found no position, not that loading is impossible.`,
          evidence_event_ids: ids(l.event), details: { container: p.container, unplaced_reasons: reasons, weight_utilization: p.weight_utilization, volume_utilization: p.volume_utilization, link: { method: l.method, confidence: l.confidence, ambiguous: l.ambiguous } },
          assumptions: ['Link to the job is inferred from a typed shipment reference.']
        }));
      }
      return out;
    }
  },
  {
    id: 'ACT-002', version: '1.0', family: 'access_control', severity: 'medium',
    purpose: 'A privileged operation on this job was attempted by an account not allowed to perform it, and refused.',
    run(view) {
      if (!view.refused?.length) return [];
      const who = [...new Set(view.refused.map(e => e.actor?.display_name || e.actor?.username || 'unknown'))];
      return [finding(view, this, {
        severity: this.severity,
        title: `${view.refused.length} refused request(s) on this job`,
        explanation: `The server refused ${view.refused.map(e => `${e.payload.method} ${e.payload.path} (${e.payload.reason})`).slice(0, 3).join('; ')} from ${who.join(', ')}. Nothing was changed. The standard interface hides these actions from accounts without the right, so the request was probably built by hand; it may also be a misunderstanding of permissions.`,
        evidence_event_ids: ids(view.refused), details: { attempts: view.refused.length, actors: who }
      })];
    }
  },
  {
    id: 'TIM-001', version: '1.0', family: 'timing', severity: 'medium',
    purpose: 'Physical milestones recorded faster than the shipment could physically have moved.',
    run(view, cfg) {
      const at = name => view.status_changes.filter(c => c.name === name && c.new === 'Completed').at(-1)?.event;
      const cargo = at('Cargo Movement'), sail = at('Sailing Completed');
      if (!cargo || !sail) return [];
      const minutes = (Date.parse(sail.server_timestamp) - Date.parse(cargo.server_timestamp)) / 60000;
      if (minutes < 0 || minutes >= cfg.min_cargo_to_sailing_minutes) return [];
      return [finding(view, this, {
        severity: this.severity,
        title: `Cargo movement and sailing recorded ${Math.round(minutes)} minute(s) apart`,
        explanation: `"Cargo Movement" was completed at ${cargo.server_timestamp} and "Sailing Completed" at ${sail.server_timestamp}. Stuffing, gate pass, let-export and departure lie between them, so this was not recorded as it happened. It is also what entering a finished shipment after the fact looks like; check whether the job was back-entered.`,
        evidence_event_ids: ids(cargo, sail), details: { minutes: +minutes.toFixed(1) },
        assumptions: [`Live recording of these two milestones takes at least ${cfg.min_cargo_to_sailing_minutes} minutes (min_cargo_to_sailing_minutes; a domain assumption, not a confirmed business rule).`]
      })];
    }
  },
  {
    id: 'EVD-001', version: '1.0', family: 'evidence_gap', severity: 'low',
    purpose: 'Evidence for this shipment is incomplete.',
    run(view) {
      const gaps = view.gaps.filter(g => g.type !== 'history_before_baseline_unknown');
      if (!gaps.length) return [];
      return [finding(view, this, {
        kind: 'data_quality', severity: 'low', title: `${gaps.length} evidence gap(s)`,
        explanation: gaps.map(g => g.detail).join(' | '),
        evidence_event_ids: gaps.map(g => g.event_id).filter(Boolean), details: { gaps }
      })];
    }
  }
];

/** Cross-shipment check: the same container number on several open jobs. */
function sharedContainers(views, cfg) {
  const rule = { id: 'IDN-002', version: '1.0', family: 'identifier' };
  const seen = new Map();
  for (const v of views.values()) {
    if (v.deleted || !v.state || v.state.status !== 'Active') continue;
    for (const c of v.state.containers || []) {
      const key = normId(c.container_no);
      if (!key) continue;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(v);
    }
  }
  const out = [];
  for (const [key, vs] of seen) {
    if (new Set(vs).size < 2) continue;
    for (const v of new Set(vs)) {
      out.push(finding(v, rule, {
        severity: 'low', title: `Container ${key} also appears on another active job`,
        explanation: `Container ${key} is listed on active jobs ${[...new Set(vs)].map(x => x.job_no).join(', ')}. This is legitimate for part loads and consecutive voyages; it is flagged for a check that the same physical load is not recorded twice.`,
        evidence_event_ids: ids([...new Set(vs)].map(x => x.events.findLast(e => e.action === 'job.updated' || e.action === 'job.created' || e.action === 'job.baseline_captured'))),
        details: { container: key, jobs: [...new Set(vs)].map(x => ({ job_no: x.job_no, correlation_id: x.correlation_id })) }
      }));
    }
  }
  return out;
}

export function runRules(views, context, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const findings = [];
  for (const view of views.values()) {
    if (!view.state) continue;
    for (const rule of RULES) {
      if (cfg.disabled_rules.includes(rule.id)) continue;
      findings.push(...rule.run(view, cfg, context));
    }
  }
  if (!cfg.disabled_rules.includes('IDN-002')) findings.push(...sharedContainers(views, cfg));
  return findings;
}
