// Scenario families written on 2026-10-29 AFTER the rules, thresholds and the 49 families in
// scenarios.js were fixed, and committed before any dataset was generated from them. None of them
// is in MIX, so none was in the tuning set (tune-11) or the held-out seeds 4-6. They vary the
// mechanism (other field, other tool, other moment, two tools agreeing) rather than re-sampling
// an existing template. Labels give the class only: no expected rule is named, so the evaluation
// of this set rests on "flagged as an anomaly or not", not on the author's rule expectations.
// Same author as the rules: this reduces template leakage, not author bias.
//   node synthetic/generate.js --set unseen --seed 301 --jobs 150 --out datasets/unseen-301
import { biilRecord, stuffingRecord, DESKS } from './lib.js';
import { lifecycle, SCENARIOS } from './scenarios.js';

const MID = 'Bill Assessment First Copy';
const later = (s, minutes = 30) => new Date(s.t.getTime() + minutes * 60000);
const ext = (rec, should_link) => ({ source_event_id: rec.source_event_id, application: rec.application, should_link });
const lbl = (cls, explanation, params = {}) => ({ class: cls, anomalous: cls === 'anomaly', expected_rules: [], explanation, params: { ...params, unseen_family: true } });
const kg = v => parseFloat(v);

export const UNSEEN = {
  // ---------------- anomalies ----------------
  u_net_weight_conflict: async c => {
    const k = 1 - c.r.int(15, 25) / 100;
    let rec;
    await lifecycle(c, { at: { [MID]: async s => { rec = c.outbox(biilRecord(c.r, s.info, later(s), { fields: { net_weight: `${Math.round(kg(s.info.net_weight) * k)} KGS` } })); } } });
    return lbl('anomaly', 'B.I.I.L. documents state a net weight 15-25% below the job record (gross weight unchanged).', { external: [ext(rec, true)] });
  },
  u_charge_dropped_in_invoice: async c => {
    let rec;
    await lifecycle(c, { at: { [MID]: async s => { rec = c.outbox(biilRecord(c.r, s.info, later(s), { charges: s.info.billing_charges.slice(1) })); } } });
    return lbl('anomaly', 'The B.I.I.L. invoice omits one charge that the job record holds.', { external: [ext(rec, true)] });
  },
  u_weight_cut_after_close: async c => {
    await lifecycle(c, { afterClose: async s => { s.info.gross_weight = `${Math.round(kg(s.info.gross_weight) * 0.8)} KGS`; await s.save(DESKS[3]); } });
    return lbl('anomaly', 'Gross weight reduced by 20% after the job was closed.');
  },
  u_two_tools_agree_against_job: async c => {
    const k = 0.8;
    let a, b;
    await lifecycle(c, { containers: 1, at: { [MID]: async s => {
      const w = `${Math.round(kg(s.info.gross_weight) * k)}`;
      a = c.outbox(biilRecord(c.r, s.info, later(s), { fields: { gross_weight: `${w} KGS` } }));
      b = c.outbox(stuffingRecord(s.info, later(s, 60), { gross_weight: w }));
    } } });
    return lbl('anomaly', 'B.I.I.L. and the stuffing report agree on a gross weight 20% below the job record.', { external: [ext(a, true), ext(b, true)] });
  },
  u_stuffing_late_container: async c => {
    let rec;
    await lifecycle(c, { containers: 1, afterClose: async s => {
      const ct = s.info.containers[0];
      rec = c.outbox(stuffingRecord({ ...s.info, containers: [{ ...ct }] }, new Date(s.t.getTime() + 3 * 86400000), { packages: String(parseInt(s.info.total_pkgs, 10) + c.r.int(20, 80)) }));
    } });
    return lbl('anomaly', 'A stuffing report exported three days after closure counts more packages than the job record.', { external: [ext(rec, true)] });
  },

  // ---------------- realistic negative controls ----------------
  u_net_weight_in_tonnes: async c => {
    let rec;
    await lifecycle(c, { at: { [MID]: async s => { rec = c.outbox(biilRecord(c.r, s.info, later(s), { fields: { net_weight: `${(kg(s.info.net_weight) / 1000).toFixed(3)} MT` } })); } } });
    return lbl('hard_negative', 'B.I.I.L. states the same net weight in metric tonnes.', { external: [ext(rec, true)] });
  },
  u_reexported_batch: async c => {
    let a, b;
    await lifecycle(c, { at: { [MID]: async s => { a = c.outbox(biilRecord(c.r, s.info, later(s))); b = c.outbox(biilRecord(c.r, s.info, later(s, 240))); } } });
    return lbl('hard_negative', 'The same B.I.I.L. batch exported twice, hours apart, with identical content (a second export, not a duplicate delivery).', { external: [ext(a, true), ext(b, true)] });
  },
  u_stuffing_rounding: async c => {
    let rec;
    await lifecycle(c, { containers: 1, at: { [MID]: async s => { rec = c.outbox(stuffingRecord(s.info, later(s), { gross_weight: (kg(s.info.gross_weight) + c.r.pick([-0.4, 0.4])).toFixed(1) })); } } });
    return lbl('hard_negative', 'Stuffing report states the gross weight with a rounding difference below one kilogram.', { external: [ext(rec, true)] });
  },
  u_quotation_linked: async c => {
    let rec;
    await lifecycle(c, { at: { [MID]: async s => {
      rec = c.outbox({ application: 'easyquote_export', action: 'quotation.exported', entity_type: 'quotation', occurred_at: later(s).toISOString(), shipment_ref: s.info.job_no, actor_claim: 'synthetic-os-user', actor_source: 'os_account_claimed', artifacts: [],
        payload: { format: 'clipboard_html', quote_ref: 'EQ/SYN/' + c.r.int(1000, 9999), client_name: 'Synthetic Client', rows: [{ header: 'Ocean freight', enabled: true, values: [String(c.r.int(100, 900))], defaults: ['500'], differs_from_default: true }] } });
    } } });
    return lbl('hard_negative', 'A quotation exported with the job number typed in; its rates differ from the job charges, which is normal for a quotation.', { external: [ext(rec, true)] });
  },
  u_quotation_without_ref: async c => {
    await lifecycle(c, { at: { [MID]: async s => {
      c.outbox({ application: 'easyquote_import', action: 'quotation.exported', entity_type: 'quotation', occurred_at: later(s).toISOString(), shipment_ref: null, actor_claim: 'synthetic-os-user', actor_source: 'os_account_claimed', artifacts: [],
        payload: { format: 'clipboard_html', quote_ref: 'EQI/SYN/' + c.r.int(1000, 9999), client_name: 'Synthetic Client', rows: [] } });
    } } });
    return lbl('hard_negative', 'A quotation exported without a job number: it must stay unlinked and raise nothing.');
  }
};

// Clean jobs are included as the base rate of normal work (a seen family; reported separately).
export const UNSEEN_MIX = { clean_complete: 10, u_net_weight_conflict: 3, u_charge_dropped_in_invoice: 3, u_weight_cut_after_close: 3, u_two_tools_agree_against_job: 3, u_stuffing_late_container: 3,
  u_net_weight_in_tonnes: 3, u_reexported_batch: 3, u_stuffing_rounding: 3, u_quotation_linked: 3, u_quotation_without_ref: 3 };
export const ALL_SCENARIOS = { ...SCENARIOS, ...UNSEEN };
