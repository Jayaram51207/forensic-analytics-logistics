// Business rules that only the business can decide (docs/DECISIONS_AND_OPEN_REQUIREMENTS.md).
// Each is null until an authorised person sets it in config/business_rules.json. While a rule
// is null the analysis keeps its permissive behaviour and says the question is unresolved;
// it never presents a result as confirmed compliance.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const DEFAULT_RULES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config', 'business_rules.json');
export const TAX_SCHEME_IDS = ['flat_9_9', 'ocean_freight_2_5'];
export const CLOSING_BASES = ['taxable_total', 'grand_total', 'after_tds'];
export const UNCONFIGURED = Object.freeze({ source: null, required_before_close: null, tax_scheme: null, closing_bill_basis: null, unresolved: ['required_before_close', 'tax_scheme', 'closing_bill_basis'] });

/** Validates a rules object. Throws on anything it does not understand: a typo must not silently mean "unset". */
export function parseBusinessRules(raw, source = null) {
  const r = {
    required_before_close: raw.required_before_close ?? null,
    tax_scheme: raw.tax_scheme ?? null,
    closing_bill_basis: raw.closing_bill_basis ?? null
  };
  const rbc = r.required_before_close;
  if (rbc !== null && rbc !== 'all' && !(Array.isArray(rbc) && rbc.every(s => typeof s === 'string' && s))) throw new Error('required_before_close must be null, "all" or a list of step names');
  if (r.tax_scheme !== null && !TAX_SCHEME_IDS.includes(r.tax_scheme)) throw new Error(`tax_scheme must be null or one of ${TAX_SCHEME_IDS.join(', ')}`);
  if (r.closing_bill_basis !== null && !CLOSING_BASES.includes(r.closing_bill_basis)) throw new Error(`closing_bill_basis must be null or one of ${CLOSING_BASES.join(', ')}`);
  return { source, ...r, unresolved: Object.keys(r).filter(k => r[k] === null) };
}

export function loadBusinessRules(file = process.env.FORENSIC_BUSINESS_RULES || DEFAULT_RULES_FILE) {
  if (!fs.existsSync(file)) return { ...UNCONFIGURED };
  try {
    return parseBusinessRules(JSON.parse(fs.readFileSync(file, 'utf8')), file);
  } catch (err) {
    throw new Error(`invalid business rules in ${file}: ${err.message}`);
  }
}
