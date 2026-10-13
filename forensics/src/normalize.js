// Normalisation of free-text operational values. Every function returns the
// original text alongside the parsed value, and `ok: false` with a reason when
// the text cannot be interpreted; nothing is guessed.

const num = s => Number(String(s).replace(/,/g, ''));

/** "20,200.5 KGS" -> { ok, value: 20200.5, unit: 'kg', original } */
export function parseWeight(text) {
  const original = text ?? '';
  if (typeof text === 'number') return Number.isFinite(text) ? { ok: true, value: text, unit: 'kg', unit_assumed: true, original } : { ok: false, reason: 'not a finite number', original };
  const m = String(original).trim().match(/^([\d,]*\.?\d+)\s*([a-zA-Z.]*)$/);
  if (!m) return { ok: false, reason: String(original).trim() ? 'unrecognised weight format' : 'empty', original };
  const u = m[2].toLowerCase().replace(/\./g, '');
  const unit = u === '' ? 'kg' : /^(kg|kgs|kilogram|kilograms)$/.test(u) ? 'kg' : /^(mt|ton|tons|tonne|tonnes|mts)$/.test(u) ? 't' : /^(lb|lbs)$/.test(u) ? 'lb' : null;
  if (!unit) return { ok: false, reason: `unknown unit "${m[2]}"`, original };
  const factor = { kg: 1, t: 1000, lb: 0.45359237 }[unit];
  return { ok: true, value: num(m[1]) * factor, unit: 'kg', source_unit: unit, unit_assumed: u === '', original };
}

/** "1,600 PP BAGS" -> { ok, count: 1600, package_type: 'PP BAGS', original } */
export function parsePackages(text) {
  const original = text ?? '';
  const m = String(original).trim().match(/^([\d,]+)\s*(.*)$/);
  if (!m) return { ok: false, reason: String(original).trim() ? 'no leading package count' : 'empty', original };
  return { ok: true, count: num(m[1]), package_type: m[2].trim().toUpperCase() || null, original };
}

/** "SYN/001 DT. 05/01/2026" -> { ok, number: 'SYN/001', date: '2026-01-05', original }. Dates are read as day-first. */
export function parseNumberDate(text) {
  const original = text ?? '';
  const s = String(original).trim();
  if (!s) return { ok: false, reason: 'empty', original };
  const m = s.match(/^(.*?)\s*(?:DT[.:]?|DATED?|\/\s*(?=\d{2}[./-]\d{2}[./-]\d{4}))\s*(\d{2})[./-](\d{2})[./-](\d{4})\s*$/i);
  if (!m) return { ok: true, number: s, date: null, date_reason: 'no recognisable date part', original };
  const [, number, dd, mm, yyyy] = m;
  const valid = +mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31;
  return { ok: true, number: number.trim(), date: valid ? `${yyyy}-${mm}-${dd}` : null, date_reason: valid ? undefined : 'date out of range', original };
}

/** Comparison key for identifiers typed by hand: upper-case, alphanumerics only. */
export function normId(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function parseMoney(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? { ok: true, value: v, original: v } : { ok: false, reason: 'not finite', original: v };
  const s = String(v ?? '').replace(/rs\.?|inr|,|\/-/gi, '').trim();
  if (s === '' || Number.isNaN(Number(s))) return { ok: false, reason: s === '' ? 'empty' : 'not numeric', original: v ?? '' };
  return { ok: true, value: Number(s), original: v };
}

/** ISO 6346 container number: 4 letters + 6 digits + check digit. */
export function checkContainerNo(text) {
  const original = text ?? '';
  const s = normId(original);
  if (!/^[A-Z]{4}\d{7}$/.test(s)) return { ok: false, valid_format: false, reason: 'not 4 letters followed by 7 digits', normalized: s, original };
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s.charCodeAt(i);
    let v;
    if (c >= 65) { v = c - 55; v += Math.floor((v - 1) / 10); } // letters skip multiples of 11: A=10, B=12 ... K=21 ...
    else v = c - 48;
    sum += v * 2 ** i;
  }
  const expected = (sum % 11) % 10;
  const valid = expected === +s[10];
  return { ok: true, valid_format: true, check_digit_valid: valid, expected_check_digit: expected, normalized: s, original, ...(valid ? {} : { reason: `check digit should be ${expected}` }) };
}

export const withinTolerance = (a, b, { abs = 0, rel = 0 } = {}) => Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));

/**
 * Normalised view of a job state (as captured in evidence). The input object is
 * not changed; each normalised value keeps `original`.
 */
export function normalizeJob(state) {
  if (!state) return null;
  const containers = (state.containers || []).map(c => ({
    container_no: checkContainerNo(c.container_no),
    gross_kg: parseWeight(c.gross_wt), net_kg: parseWeight(c.net_wt),
    packages: parsePackages(c.pkgs), cbm: parseMoney(c.cbm)
  }));
  const charges = (state.billing_charges || []).map(c => ({ description: String(c.description ?? '').trim(), amount: parseMoney(c.amount) }));
  return {
    job_no: { key: normId(state.job_no), original: state.job_no },
    type: state.type,
    invoice: parseNumberDate(state.invoice_no_date),
    shipping_bill: parseNumberDate(state.sb_no_date),
    gross_kg: parseWeight(state.gross_weight), net_kg: parseWeight(state.net_weight),
    packages: parsePackages(state.total_pkgs), cbm: parseMoney(state.cbm),
    containers, charges,
    taxable_total: charges.every(c => c.amount.ok) ? charges.reduce((s, c) => s + c.amount.value, 0) : null,
    closing: {
      bill_no: state.closing_bill_no || null,
      amount: parseMoney(state.closing_bill_amount), sgst: parseMoney(state.closing_sgst), cgst: parseMoney(state.closing_cgst)
    }
  };
}
