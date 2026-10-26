// Building blocks for synthetic shipments. Every name, number and document
// produced here is invented; nothing is taken from the repository's sample files.

/** Small deterministic PRNG (mulberry32) so a seed reproduces a dataset exactly. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = arr => arr[Math.floor(next() * arr.length)];
  next.chance = p => next() < p;
  return next;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Valid ISO 6346 container number with a fictional owner prefix. */
export function containerNo(r) {
  const prefix = 'SY' + LETTERS[r.int(0, 25)] + 'U';
  const body = prefix + String(r.int(0, 999999)).padStart(6, '0');
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = body.charCodeAt(i);
    let v = c >= 65 ? c - 55 : c - 48;
    if (c >= 65) v += Math.floor((v - 1) / 10);
    sum += v * 2 ** i;
  }
  return body + ((sum % 11) % 10);
}

const SHIPPERS = ['NORTHWIND SYNTHETIC TEXTILES', 'BLUE HERON TEST FOODS', 'ALDER VALLEY SAMPLE MILLS', 'KESTREL DEMO CERAMICS', 'TAMARIND MOCK SPICES', 'GRANITE PEAK TRIAL STONES', 'LOTUS POND EXAMPLE CRAFTS', 'COPPER RIDGE DUMMY CASTINGS'];
const CONSIGNEES = ['HOLLOWAY FICTIONAL IMPORTS BV', 'MERIDIAN PLACEHOLDER TRADING LLC', 'ASHGROVE IMAGINARY WHOLESALE GMBH', 'QUAYSIDE INVENTED SUPPLY PTE', 'FERNBROOK MADE-UP DISTRIBUTION SA'];
const PORTS = [['ROTTERDAM', 'NETHERLANDS'], ['HAMBURG', 'GERMANY'], ['SINGAPORE', 'SINGAPORE'], ['JEBEL ALI', 'UAE'], ['FELIXSTOWE', 'UK'], ['PORT KLANG', 'MALAYSIA']];
const GOODS = [['COTTON KNITTED GARMENTS', 'CTNS'], ['BASMATI RICE', 'BAGS'], ['CERAMIC TABLEWARE', 'CTNS'], ['GROUND SPICES', 'BAGS'], ['POLISHED GRANITE SLABS', 'CRATES'], ['HANDICRAFT ITEMS', 'CTNS']];
const CHARGES = [['OCEAN FREIGHT', 40000, 140000], ['TERMINAL HANDLING CHARGES', 6000, 12000], ['BL FEES', 3000, 5000], ['DOCUMENTATION CHARGES', 500, 2500], ['CONTAINER TRANSPORTATION CHARGES', 8000, 12000], ['SEAL CHARGES', 800, 1500], ['CFS CHARGES', 4000, 7000], ['SURVEY CHARGES', 500, 900], ['HANDLING CHARGES', 2500, 4500]];
export const DESKS = ['Desk 1 (Invoice)', 'Desk 2 (Documentation)', 'Desk 3 (Customs / CHA)', 'Desk 4 (Operations)'];

const ddmmyyyy = d => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

/** A complete, internally consistent sea-export job. */
export function makeJob(r, jobNo, start, { containers: fixedContainers } = {}) {
  const [goods, unit] = r.pick(GOODS);
  const [port, country] = r.pick(PORTS);
  const nContainers = fixedContainers || (r.chance(0.7) ? 1 : r.int(2, 3));
  const containers = Array.from({ length: nContainers }, () => {
    const pkgs = r.int(150, 900);
    const net = r.int(8000, 24000);
    return { container_no: containerNo(r), seal_no: 'SL' + r.int(100000, 999999), pkgs: `${pkgs} ${unit}`, net_wt: net, gross_wt: net + r.int(100, 600), cbm: r.int(20, 60) };
  });
  const sum = k => containers.reduce((s, c) => s + c[k], 0);
  const pkgTotal = containers.reduce((s, c) => s + parseInt(c.pkgs, 10), 0);
  const chosen = [CHARGES[0], ...CHARGES.slice(1).filter(() => r.chance(0.55))];
  const inv = `SYN/${r.int(1000, 9999)}`;
  const d = new Date(start);
  return {
    job_no: jobNo, type: 'sea_export', file_ref_no: 'REF-' + r.int(10000, 99999),
    shipper: `${r.pick(SHIPPERS)}\n${r.int(1, 200)} Example Industrial Estate\nTestnagar 600000`,
    consignee: `${r.pick(CONSIGNEES)}\n${r.int(1, 90)} Sample Quay\n${port}`,
    notify: 'SAME AS CONSIGNEE', also_notify: 'SAME AS CONSIGNEE', cha: 'SYNTHETIC CHA SERVICES', forwarding_agent: 'SYNTHETIC FORWARDERS',
    invoice_no_date: `${inv} DT. ${ddmmyyyy(d)}`, sb_no_date: `${r.int(1000000, 9999999)} DT. ${ddmmyyyy(new Date(d.getTime() + 86400000))}`,
    buyer_order_no_date: `PO-${r.int(100, 999)} DT. ${ddmmyyyy(new Date(d.getTime() - 5 * 86400000))}`,
    vessel_voyage: `MV SYNTHETIC ${r.pick(['AURORA', 'BOREAS', 'CALYPSO', 'DELPHI'])} V.${r.int(100, 999)}`, carrier: 'DEMO LINE',
    port_of_loading: 'CHENNAI / INDIA', port_of_discharge: port, final_destination: `${port} / ${country}`, country_of_origin: 'INDIA', country_of_dest: country,
    hs_code: String(r.int(10000000, 99999999)), payment_mode: r.pick(['PREPAID', 'COLLECT']),
    eta: '', etd: '', marks_nos: 'AS PER INVOICE', type_of_packing: unit, cargo_desc: goods,
    total_pkgs: `${pkgTotal} ${unit}`, gross_weight: `${sum('gross_wt')} KGS`, net_weight: `${sum('net_wt')} KGS`, cbm: String(sum('cbm')),
    cargo_items: [{ description: goods, hs_code: '', qty: pkgTotal, unit, rate: r.int(5, 60), net_wt: sum('net_wt'), gross_wt: sum('gross_wt'), amount: 0 }],
    containers,
    billing_charges: chosen.map(([description, lo, hi]) => ({ description, amount: r.int(lo / 50, hi / 50) * 50 })),
    is_flagged: false, flag_remarks: ''
  };
}

const hex = r => Array.from({ length: 64 }, () => '0123456789abcdef'[r.int(0, 15)]).join('');

/**
 * A B.I.I.L. generation record in the schema unified_generator.py emits (checked against a
 * real run in test/adapters.test.js). Totals use B.I.I.L.'s own tax rule: 2.5% + 2.5% on
 * ocean freight, 9% + 9% otherwise.
 */
export function biilRecord(r, info, when, over = {}) {
  const charges = (over.charges || info.billing_charges).map(c => {
    const rate = /ocean freight/i.test(c.description) ? 2.5 : 9.0;
    return { description: c.description, amount: Number(c.amount).toFixed(2), cgst_rate: rate, sgst_rate: rate };
  });
  const taxable = charges.reduce((s, c) => s + +c.amount, 0);
  const half = charges.reduce((s, c) => s + Math.round(+c.amount * c.cgst_rate) / 100, 0);
  const containers = over.containers || info.containers;
  return {
    application: 'biil_unified', action: 'document.batch_generated', entity_type: 'document_batch',
    occurred_at: when.toISOString(), shipment_ref: 'shipment_ref' in over ? over.shipment_ref : info.job_no,
    actor_claim: 'synthetic-os-user', actor_source: 'os_account_claimed',
    artifacts: [...(over.source_sha256 ? [{ role: 'source_checklist', path: 'C:/synthetic/checklist.pdf', sha256: over.source_sha256, size: 1000 }] : []),
      { role: 'bl_instruction', path: `C:/synthetic/Generated/BL_${info.job_no}.xlsx`, sha256: hex(r), size: 9000 }, { role: 'billing_invoice', path: `C:/synthetic/Generated/BILL_${info.job_no}.xlsx`, sha256: hex(r), size: 7000 }],
    payload: {
      fields: { shipper: info.shipper, consignee: info.consignee, invoice_no_date: info.invoice_no_date, sb_no_date: info.sb_no_date, gross_weight: info.gross_weight, net_weight: info.net_weight, total_pkgs: info.total_pkgs, cargo_desc: info.cargo_desc, ...(over.fields || {}) },
      billing_metadata: { 'JOB NO:': info.job_no }, containers, container_nos: containers.map(c => c.container_no), charges,
      totals: { taxable, cgst: half, sgst: half, grand_total: taxable + 2 * half, tds: +(taxable * 0.02).toFixed(2), payable: +(taxable + 2 * half - taxable * 0.02).toFixed(2) },
      bl_template: 'Standard (CPS 001)', documents_written: ['bl_instruction', 'billing_invoice'],
      capture_mode: 'synthetic record written in the B.I.I.L. adapter schema'
    }
  };
}

/** A stuffing-report export in the schema StuffingReport emits (checked against a real click in the GUI test). */
export function stuffingRecord(info, when, over = {}) {
  const c = info.containers[0];
  const rows = [['SHIPPER', info.shipper.split('\n')[0]], ['SHIPPING BILL NO', info.sb_no_date.replace(' DT. ', ' / ')], ['PACKAGES', over.packages ?? String(parseInt(info.total_pkgs, 10))], ['GROSS WEIGHT', over.gross_weight ?? String(parseFloat(info.gross_weight))], ['CONTAINER NO.', `${c.container_no}/40'HC`], ['SEAL NO.', c.seal_no]];
  return {
    application: 'stuffing_report', action: 'stuffing_report.exported', entity_type: 'stuffing_report', occurred_at: when.toISOString(), shipment_ref: null,
    actor_claim: 'synthetic-os-user', actor_source: 'os_account_claimed', artifacts: [],
    payload: { format: 'clipboard_html', rows: rows.map(([k, v]) => ({ shipment_key: k, shipment_value: v, vessel_key: '', vessel_value: '', enabled: true })), container_nos: [c.container_no], remarks: '', capture_mode: 'synthetic record written in the stuffing-report adapter schema' }
  };
}

/** Closing figures consistent with the stored charges (9% + 9% scheme used by compiler.py). */
export function closingFor(info, r) {
  const taxable = info.billing_charges.reduce((s, c) => s + c.amount, 0);
  const half = info.billing_charges.reduce((s, c) => s + Math.round(c.amount * 0.09 * 100) / 100, 0);
  return { bill_no: 'SB-' + r.int(10000, 99999), bill_amount: r.chance(0.7) ? taxable + 2 * half : taxable, sgst: half, cgst: half };
}

/** Advance simulated time, keeping activity inside 04:00-12:00 UTC (09:30-17:30 IST) on weekdays. */
export function workTime(t, minutes) {
  const d = new Date(t.getTime() + minutes * 60000);
  for (;;) {
    const h = d.getUTCHours(), day = d.getUTCDay();
    if (day === 0 || day === 6) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(4, d.getUTCMinutes() % 50, 0, 0); continue; }
    if (h >= 12) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(4, d.getUTCMinutes() % 50, 0, 0); continue; }
    if (h < 4) { d.setUTCHours(4, d.getUTCMinutes() % 50, 0, 0); continue; }
    return d;
  }
}

/**
 * Minimal one-page text PDF laid out like an export checklist, readable by
 * pdf_parser.parse_checklist (labels left/right of the page centre line).
 */
export function checklistPdf(f) {
  const rows = [
    [760, 40, 'EXPORT CHECK LIST'],
    [740, 40, 'Exporter Details :'], [740, 330, 'Consignee Details :'],
    ...f.shipper.split('\n').map((l, i) => [725 - i * 13, 40, l]),
    ...f.consignee.split('\n').map((l, i) => [725 - i * 13, 330, l]),
    [670, 40, 'GSTN Type / ID : GST / 00SYNTH0000X0Z0'], [670, 330, 'AD Code : 0000000'],
    [650, 40, `Job No & Date : ${f.job_no}`],
    [635, 40, `S.B No & Date : ${f.sb_no} ${f.sb_date}`],
    [620, 40, `Invoice No : ${f.invoice_no} Invoice Date : ${f.invoice_date}`],
    [605, 40, `Port Discharge : ${f.port}`],
    [590, 40, `Net Weight : ${f.net_kg}`],
    [575, 40, `Gross Weight : ${f.gross_kg}`],
    [560, 40, `Total Packages : ${f.pkgs} ${f.pkg_unit}`],
    [545, 40, `Container No : ${f.container_no}`]
  ];
  const esc = s => String(s).replace(/[\\()]/g, m => '\\' + m);
  const stream = 'BT /F1 9 Tf\n' + rows.map(([y, x, text]) => `1 0 0 1 ${x} ${y} Tm (${esc(text)}) Tj`).join('\n') + '\nET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const ACCOUNTS = { 'Desk 1 (Invoice)': 'desk1', 'Desk 2 (Documentation)': 'desk2', 'Desk 3 (Customs / CHA)': 'desk3', 'Desk 4 (Operations)': 'desk4', 'System Admin': 'admin' };

/**
 * HTTP driver bound to one synchroniser instance; every call carries a simulated timestamp.
 * Each actor is a real signed-in session. A name that is not an account (a spoofing
 * attempt) is sent in the request body from Desk 4's session, as a crafted request would be.
 */
export async function driver(base, credentials) {
  const cookies = {};
  for (const [name, username] of Object.entries(ACCOUNTS)) {
    const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: credentials[username] }) });
    if (res.status !== 200) throw new Error(`login failed for ${username}`);
    cookies[name] = res.headers.get('set-cookie').split(';')[0];
  }
  const cookieFor = actor => cookies[actor] || cookies['Desk 4 (Operations)'];
  const send = async (method, url, body, t, headers = {}, actor) => {
    const res = await fetch(base + url, {
      method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: cookieFor(actor), 'X-Forensic-Sim-Time': t.toISOString(), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* error pages are HTML */ }
    return { status: res.status, json };
  };
  // A refused step would silently change what the scenario is, so anything but 200 aborts the scenario.
  const must = async (p, what) => { const r = await p; if (r.status !== 200) throw new Error(`${what} failed: HTTP ${r.status} ${JSON.stringify(r.json)}`); return r; };
  return {
    create: (info, actor, t) => send('POST', '/api/jobs', { info, creator: actor }, t, {}, actor),
    update: (id, info, actor, t) => send('PUT', `/api/jobs/${id}`, { info, creator: actor }, t, {}, actor),
    step: (id, stepId, status, actor, t, closingDetails) => must(send('PUT', `/api/jobs/${id}/workflow/${stepId}`, { status, user: actor, closingDetails }, t, {}, actor), 'workflow step'),
    remove: (id, actor, t) => must(send('DELETE', `/api/jobs/${id}`, null, t, { 'X-Claimed-User': actor }, actor), 'delete'),
    upload: async (buf, name, t) => {
      const form = new FormData();
      form.append('checklist', new Blob([buf], { type: 'application/pdf' }), name);
      const res = await fetch(base + '/api/parse-checklist', { method: 'POST', body: form, headers: { Cookie: cookieFor('Desk 1 (Invoice)'), 'X-Forensic-Sim-Time': t.toISOString() } });
      return { status: res.status, json: await res.json().catch(() => null) };
    }
  };
}
