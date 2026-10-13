// Scenario catalogue. Each scenario drives the real synchroniser API through a
// realistic job lifecycle and returns a ground-truth label. Labels are written
// to a separate file and are never sent to the application or the detector.
import { makeJob, closingFor, workTime, checklistPdf, DESKS } from './lib.js';
import { packCargo } from '../../3D_stuffing_visualizer/src/packing.js';
import { packingPayload } from '../src/ingest.js';

const OPTIONAL = ['FCL Form 13 Applied (If FCL)', 'EGM - Transhipment (INKAT1/INENN1)', 'Incentive Processed'];
const CONTAINER_40HC = { id: '40hc', name: "40' High Cube Container", length: 1203, width: 235, height: 269, maxWeight: 27800 };
const clone = v => structuredClone(v);

/**
 * Normal sea-export lifecycle with injection points.
 *   o.info(info)          mutate the job before creation
 *   o.at[stepName](s)     run before that step is processed
 *   o.skip                steps left Pending
 *   o.na                  steps marked N/A (default: 0-2 optional steps)
 *   o.closing(c, s)       mutate closing details
 *   o.afterClose(s)       run after closure
 *   o.noClose             stop before "Job Closed"
 *   o.stopBefore          stop before the named step (job left in progress)
 *   o.actor(step)         actor name for a step
 *   o.gap()               minutes between steps
 */
export async function lifecycle(c, o = {}) {
  const r = c.r;
  const s = { c, r, api: c.api, t: o.gap ? c.start : workTime(c.start, 0), info: makeJob(r, c.jobNo, c.start) };
  if (o.info) await o.info(s.info, s);
  const res = await s.api.create(s.info, o.actor?.('create') ?? DESKS[0], s.t);
  if (res.status !== 201) throw new Error(`create failed for ${c.jobNo}: ${res.status} ${JSON.stringify(res.json)}`);
  s.id = res.json.id;
  s.steps = res.json.workflow_steps;
  s.stepId = name => s.steps.find(x => x.name === name).id;
  s.tick = (lo = 30, hi = 480) => { s.t = o.gap ? new Date(s.t.getTime() + o.gap() * 60000) : workTime(s.t, r.int(lo, hi)); return s.t; };
  s.save = async (actor = DESKS[1]) => {
    const u = await s.api.update(s.id, s.info, actor, s.tick(10, 120));
    if (u.status !== 200) throw new Error(`update failed for ${c.jobNo}: ${u.status}`);
  };
  const na = o.na ?? OPTIONAL.filter(() => r.chance(0.3));
  for (const step of s.steps) {
    if (step.name === 'Job Created') continue;
    if (o.stopBefore === step.name) break;
    if (o.at?.[step.name]) await o.at[step.name](s);
    if (s.gone) break;
    if (step.name === 'Job Closed') {
      if (o.noClose) break;
      s.closing = closingFor(s.info, r);
      if (o.closing) o.closing(s.closing, s);
      await s.api.step(s.id, step.id, 'Completed', o.actor?.(step.name) ?? DESKS[3], s.tick(), s.closing);
      if (o.afterClose) await o.afterClose(s);
      break;
    }
    if (o.skip?.includes(step.name)) continue;
    if (step.status === 'Completed') continue; // auto-completed by the application at creation
    await s.api.step(s.id, step.id, na.includes(step.name) ? 'N/A' : 'Completed', o.actor?.(step.name) ?? r.pick(DESKS), s.tick());
  }
  return s;
}

const scaleWeights = (info, k) => {
  for (const ct of info.containers) { ct.gross_wt = Math.round(ct.gross_wt * k); ct.net_wt = Math.round(ct.net_wt * k); }
  info.gross_weight = `${info.containers.reduce((a, x) => a + x.gross_wt, 0)} KGS`;
  info.net_weight = `${info.containers.reduce((a, x) => a + x.net_wt, 0)} KGS`;
};

const pdfFor = (info, over = {}) => {
  const [invNo, invDate] = info.invoice_no_date.split(' DT. ');
  const [sbNo, sbDate] = info.sb_no_date.split(' DT. ');
  return checklistPdf({
    shipper: info.shipper, consignee: info.consignee, job_no: info.job_no, sb_no: sbNo, sb_date: sbDate, invoice_no: invNo, invoice_date: invDate,
    port: info.port_of_discharge, net_kg: parseFloat(info.net_weight), gross_kg: parseFloat(info.gross_weight),
    pkgs: parseInt(info.total_pkgs, 10), pkg_unit: 'PKG', container_no: info.containers[0].container_no, ...over
  });
};

async function withUpload(c, pdf, o = {}) {
  const up = await c.api.upload(pdf, `checklist_${c.jobNo}.pdf`, workTime(c.start, 0));
  return lifecycle(c, { ...o, info: (info, s) => { if (up.status === 200) info.checklist_pdf_url = up.json.checklist_pdf_url; return o.info?.(info, s); } });
}

function packing(c, s, manifest, minutesAfter = 60) {
  const result = packCargo(CONTAINER_40HC, manifest);
  c.outbox({
    application: 'visualizer_3d', action: 'packing.run_completed', entity_type: 'packing_run',
    occurred_at: new Date(s.t.getTime() + minutesAfter * 60000).toISOString(), shipment_ref: s.info.job_no,
    payload: { ...packingPayload(CONTAINER_40HC, manifest, result), capture_mode: 'headless run of packing.js by the synthetic generator' }
  });
  return result;
}

const lbl = (cls, expected_rules, explanation, params = {}) => ({ class: cls, anomalous: cls === 'anomaly', expected_rules, explanation, params });

// type -> async (c) => label
export const SCENARIOS = {
  // ---------------- normal ----------------
  clean_complete: async c => { await lifecycle(c); return lbl('normal', [], 'Consistent job completed in order and closed with a bill that matches its charges.'); },
  clean_in_progress: async c => {
    const stopBefore = c.r.pick(['Cargo Movement', 'Sailing Completed', 'Accounts Processing Done', 'Job Closed']);
    await lifecycle(c, { stopBefore });
    return lbl('normal', [], 'Consistent job still in progress (not closed).', { stopped_before: stopBefore });
  },

  // ---------------- hard negatives ----------------
  early_correction_regenerated: async c => {
    await lifecycle(c, { at: { 'Checklist Preparing': async s => { scaleWeights(s.info, 1 + c.r.pick([-4, -3, -2, 2, 3, 4]) / 100); s.info.hs_code = String(c.r.int(10000000, 99999999)); await s.save(); } } });
    return lbl('hard_negative', [], 'Weights and HS code corrected early; documents regenerated successfully before any milestone. Legitimate correction.');
  },
  nonmaterial_late_edit: async c => {
    await lifecycle(c, { at: { 'EGM - Normal (INMAA-1 CCTL/CITPL)': async s => { s.info.eta = '2026-03-20'; s.info.etd = '2026-03-01'; s.info.is_flagged = true; s.info.flag_remarks = 'vessel delayed'; await s.save(DESKS[3]); } } });
    return lbl('hard_negative', [], 'ETA/ETD and delay flag updated after sailing. These fields are not written to any generated document.');
  },
  legit_reopen: async c => {
    await lifecycle(c, { afterClose: async s => {
      const id = s.stepId('Job Closed');
      await s.api.step(s.id, id, 'Pending', DESKS[3], s.tick(5, 60));
      await s.api.step(s.id, id, 'Completed', DESKS[3], s.tick(5, 60), s.closing);
    } });
    return lbl('hard_negative', [], 'Job reopened once and closed again with the same bill details.');
  },
  regen_identical_few: async c => {
    await lifecycle(c, { at: { 'Checklist Preparing': async s => { await s.save(); await s.save(); } } });
    return lbl('hard_negative', [], 'Job re-saved twice without changes (below the regeneration threshold).');
  },
  deleted_draft: async c => {
    await lifecycle(c, { at: { 'Checklist Preparing': async s => { await s.api.remove(s.id, 'System Admin', s.tick(5, 30)); s.gone = true; } } });
    return lbl('hard_negative', [], 'Job created by mistake and deleted shortly afterwards, before any milestone or closure.');
  },
  source_matches: async c => {
    const info = makeJob(c.r, c.jobNo, c.start);
    await withUpload(c, pdfFor(info), { info: i => { Object.assign(i, info, { checklist_pdf_url: i.checklist_pdf_url }); } });
    return lbl('hard_negative', [], 'Checklist uploaded; stored values equal the extracted values.');
  },
  packing_fits: async c => {
    const s = await lifecycle(c);
    packing(c, s, [{ name: 'Cartons', length: 60, width: 40, height: 40, weight: 18, quantity: c.r.int(40, 200), orientation: 'any', type: 'carton' }]);
    return lbl('hard_negative', [], 'Linked packing run placed every item.');
  },

  // ---------------- anomalies detectable by rules ----------------
  stale_documents: async c => {
    await lifecycle(c, { at: { 'Cargo Movement': async s => { scaleWeights(s.info, 0.8); s.info.containers[0].cbm = 'TBA'; await s.save(); } } });
    return lbl('anomaly', ['GEN-001'], 'Weights changed after documents were issued; the regeneration failed, so issued documents show the old weights.', { weight_factor: 0.8 });
  },
  late_material_edit: async c => {
    await lifecycle(c, { at: { 'EGM - Normal (INMAA-1 CCTL/CITPL)': async s => { s.info.consignee = 'REDIRECTED FICTIONAL CONSIGNEE LTD\n9 Other Street'; scaleWeights(s.info, 0.9); await s.save(DESKS[3]); } } });
    return lbl('anomaly', ['GEN-002'], 'Consignee and weights changed after "Sailing Completed".');
  },
  weight_mismatch: async c => {
    const k = 1 - c.r.int(8, 25) / 100;
    await lifecycle(c, { info: i => { i.gross_weight = `${Math.round(parseFloat(i.gross_weight) * k)} KGS`; } });
    return lbl('anomaly', ['WGT-001'], 'Header gross weight understated relative to the container rows.', { factor: k });
  },
  package_mismatch: async c => {
    await lifecycle(c, { info: i => { i.total_pkgs = `${parseInt(i.total_pkgs, 10) + c.r.int(20, 200)} ${i.type_of_packing}`; } });
    return lbl('anomaly', ['WGT-001'], 'Header package count exceeds the container rows.');
  },
  billing_inconsistency: async c => {
    const k = 1 + c.r.int(12, 45) / 100;
    await lifecycle(c, { closing: cl => { cl.bill_amount = Math.round(cl.bill_amount * k); } });
    return lbl('anomaly', ['FIN-001'], 'Closing bill amount inflated relative to stored charges.', { factor: k });
  },
  closing_changed_on_reclose: async c => {
    await lifecycle(c, { afterClose: async s => {
      const id = s.stepId('Job Closed');
      await s.api.step(s.id, id, 'Pending', DESKS[3], s.tick(5, 60));
      await s.api.step(s.id, id, 'Completed', DESKS[3], s.tick(5, 60), { ...s.closing, bill_no: s.closing.bill_no + 'A', bill_amount: Math.round(s.closing.bill_amount * 1.25) });
    } });
    return lbl('anomaly', ['FIN-001'], 'Job reopened and closed again with a 25% higher bill; the first figures were erased from the application.');
  },
  premature_closure: async c => {
    const skip = ['Bill Goes to Let Export', 'Gatepass Generation (Stuffing Completed)', 'Shipping Bill EIR, Let Export, Gatepass Submission', 'Document Verified (Before Sailing)', 'Sailing Completed', 'EGM - Normal (INMAA-1 CCTL/CITPL)', 'Accounts Processing Done'];
    await lifecycle(c, { skip, na: [] });
    return lbl('anomaly', ['WFL-001'], 'Job closed while seven steps, including sailing, were still pending.', { pending: skip.length });
  },
  excess_reversals: async c => {
    await lifecycle(c, { at: { 'Cargo Movement': async s => {
      for (const name of ['Shipping Instruction Received', 'Invoice and Packing List Received', 'Checklist Preparing', 'Prepared Checklist']) {
        await s.api.step(s.id, s.stepId(name), 'Pending', DESKS[1], s.tick(2, 20));
        await s.api.step(s.id, s.stepId(name), 'Completed', DESKS[1], s.tick(2, 20));
      }
    } } });
    return lbl('anomaly', ['WFL-002'], 'Four completed steps were reversed and re-completed.');
  },
  bulk_na: async c => {
    const na = ['Bill Assessment First Copy', 'Cargo Movement', 'Bill Goes to Let Export', 'Gatepass Generation (Stuffing Completed)', 'FCL Form 13 Applied (If FCL)', 'Shipping Bill EIR, Let Export, Gatepass Submission', 'Document Verified (Before Sailing)', 'EGM - Transhipment (INKAT1/INENN1)', 'Incentive Processed'];
    await lifecycle(c, { na });
    return lbl('anomaly', ['WFL-003'], 'Nine of nineteen steps marked not applicable.');
  },
  regen_changed_excess: async c => {
    await lifecycle(c, { at: { 'Checklist Preparing': async s => { for (let i = 0; i < 5; i++) { s.info.billing_charges[0].amount += c.r.int(1, 9) * 500; await s.save(); } } } });
    return lbl('anomaly', ['GEN-003'], 'Freight charge revised five times, each regenerating the documents.');
  },
  regen_identical_excess: async c => {
    await lifecycle(c, { at: { 'Checklist Preparing': async s => { for (let i = 0; i < 4; i++) await s.save(); } } });
    return lbl('anomaly', ['GEN-003'], 'Documents regenerated four times with identical input.');
  },
  placeholder_charges: async c => {
    await lifecycle(c, { info: i => { i.billing_charges = [{ description: 'O/F - OCEAN FREIGHT CHARGES', amount: 120000 }, { description: 'LOCAL THC TERMINAL CHARGES', amount: 9500 }, { description: 'DOCUMENTATION & BL ISSUANCE FEES', amount: 4500 }]; } });
    return lbl('anomaly', ['DEF-001'], 'Auto-inserted placeholder charges were billed unchanged.');
  },
  job_renamed: async c => {
    await lifecycle(c, { at: { 'Cargo Movement': async s => { s.info.job_no = s.info.job_no + '-R'; await s.save(); } } });
    return lbl('anomaly', ['IDN-001'], 'Job number changed after documents were issued under the original number.');
  },
  deleted_after_close: async c => {
    await lifecycle(c, { afterClose: async s => { await s.api.remove(s.id, DESKS[3], s.tick(30, 300)); } });
    return lbl('anomaly', ['DEL-001'], 'Closed job deleted from the operational system together with its history.');
  },
  spoofed_actor: async c => {
    const fake = c.r.pick(['Admin Override', 'desk9', 'Supervisor']);
    await lifecycle(c, { actor: step => (['Sailing Completed', 'Accounts Processing Done', 'Job Closed'].includes(step) ? fake : undefined) });
    return lbl('anomaly', ['ACT-001'], 'Key steps sent from one signed-in session while naming a different, non-existent actor in the request.', { name: fake });
  },
  source_mismatch: async c => {
    const info = makeJob(c.r, c.jobNo, c.start);
    const pdf = pdfFor(info); // the source document states the true weights
    await withUpload(c, pdf, { info: i => { Object.assign(i, info, { checklist_pdf_url: i.checklist_pdf_url }); scaleWeights(i, 0.85); } });
    return lbl('anomaly', ['SRC-001'], 'Stored weights are 15% below the uploaded checklist, consistently across header and containers.');
  },
  unplaced_cargo: async c => {
    const s = await lifecycle(c);
    const heavy = c.r.chance(0.5);
    packing(c, s, heavy
      ? [{ name: 'Steel coils', length: 120, width: 100, height: 100, weight: 4000, quantity: 9, orientation: 'upright', type: 'pallet' }]
      : [{ name: 'Oversize crates', length: 240, width: 220, height: 250, weight: 500, quantity: 8, orientation: 'none', type: 'carton' }]);
    return lbl('anomaly', ['PCK-001'], heavy ? 'Declared cargo exceeds container payload in the linked packing run.' : 'Declared cargo does not fit the container in the linked packing run.', { cause: heavy ? 'payload' : 'space' });
  },

  // ---------------- anomalies the rules cannot see ----------------
  unusual_timing: async c => {
    c.start = new Date(Date.UTC(c.start.getUTCFullYear(), c.start.getUTCMonth(), c.start.getUTCDate(), 20, 40));
    await lifecycle(c, { gap: () => c.r.int(0, 2), na: [] });
    return lbl('anomaly', [], 'Entire workflow completed in minutes late at night. No rule covers timing; only behavioural analysis can notice it.');
  },
  consistent_falsification: async c => {
    await lifecycle(c, { info: i => scaleWeights(i, 0.7) });
    return lbl('anomaly', [], 'Weights understated by 30% consistently from the first entry, with no source document. Internally consistent: undetectable without an independent source of truth.');
  },

  // ---------------- data quality (not anomalies) ----------------
  bad_container_check_digit: async c => {
    await lifecycle(c, { info: i => { const n = i.containers[0].container_no; i.containers[0].container_no = n.slice(0, 10) + ((+n[10] + 1) % 10); } });
    return lbl('data_quality', ['IDN-001'], 'Container number mistyped (check digit wrong).');
  },
  missing_identifiers: async c => {
    await lifecycle(c, { info: i => { i.sb_no_date = ''; } });
    return lbl('data_quality', ['IDN-001'], 'Job closed without a shipping bill number.');
  },
  malformed_source: async c => {
    await c.api.upload(Buffer.from('%PDF-1.4 truncated'), `broken_${c.jobNo}.pdf`, workTime(c.start, 0));
    await lifecycle(c);
    return lbl('data_quality', [], 'Uploaded checklist could not be parsed; job entered by hand.');
  }
};

// Share of each scenario in a generated dataset (weights, not counts).
export const MIX = {
  clean_complete: 34, clean_in_progress: 8,
  early_correction_regenerated: 6, nonmaterial_late_edit: 5, legit_reopen: 5, regen_identical_few: 4, deleted_draft: 3, source_matches: 4, packing_fits: 4,
  stale_documents: 2, late_material_edit: 2, weight_mismatch: 2, package_mismatch: 1.5, billing_inconsistency: 2, closing_changed_on_reclose: 1.5,
  premature_closure: 2, excess_reversals: 1.5, bulk_na: 1.5, regen_changed_excess: 1.5, regen_identical_excess: 1, placeholder_charges: 1.5,
  job_renamed: 1, deleted_after_close: 1.5, spoofed_actor: 1.5, source_mismatch: 2, unplaced_cargo: 2, unusual_timing: 2, consistent_falsification: 2,
  bad_container_check_digit: 1.5, missing_identifiers: 1.5, malformed_source: 1
};
