import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'db.json');

// Initialize local DB state
let data = {
  jobs: [],
  cargo_items: [],
  containers: [],
  billing_charges: [],
  documents: [],
  history_logs: [],
  workflow_steps: [],
  users: []
};

// Atomic save helper (writes to a temporary file and renames it)
function saveToDisk() {
  const tempPath = dbPath + '.tmp';
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, dbPath);
  } catch (err) {
    console.error('Failed to write to disk atomically:', err);
  }
}

// ID Generator Helper
function getNextId(table) {
  const list = data[table] || [];
  if (list.length === 0) return 1;
  return Math.max(...list.map(item => item.id)) + 1;
}

// Password hashing helper
function hashPassword(password) {
  const sha256 = crypto.createHash('sha256').update(password).digest('hex');
  return bcrypt.hashSync(sha256, 10);
}

export function getAllUsers() {
  return (data.users || []).map(u => ({ username: u.username, name: u.name, role: u.role }));
}

export function createUser({ username, password, name, role }) {
  if (!data.users) data.users = [];
  const exists = data.users.some(u => u.username.toLowerCase() === username.trim().toLowerCase());
  if (exists) {
    throw new Error('User already exists');
  }
  const passwordHash = hashPassword(password);
  data.users.push({
    username: username.trim(),
    name: name.trim(),
    role: role.trim(),
    passwordHash
  });
  saveToDisk();
}

export function deleteUser(username) {
  if (!data.users) data.users = [];
  if (username.trim().toLowerCase() === 'admin') {
    throw new Error('Cannot delete admin user');
  }
  const initialLength = data.users.length;
  data.users = data.users.filter(u => u.username.toLowerCase() !== username.trim().toLowerCase());
  if (data.users.length === initialLength) {
    throw new Error('User not found');
  }
  saveToDisk();
}

export function verifyUser(username, password) {
  if (!data.users) data.users = [];
  const user = data.users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!user) return null;
  const sha256 = crypto.createHash('sha256').update(password).digest('hex');
  const match = bcrypt.compareSync(sha256, user.passwordHash);
  if (match) {
    return { username: user.username, name: user.name, role: user.role };
  }
  return null;
}

export function getDefaultDocuments(type) {
  if (type === 'air_import' || type === 'sea_import') {
    return [
      'Invoice Spreadsheet',
      'Packing List Spreadsheet',
      'Checklist PDF'
    ];
  } else if (type === 'air_export') {
    return [
      'Invoice Spreadsheet',
      'Packing List Spreadsheet',
      'Checklist PDF',
      'AWB Instruction Spreadsheet'
    ];
  } else {
    // Default is 'sea_export'
    return [
      'Checklist PDF',
      'Invoice Spreadsheet',
      'Packing List Spreadsheet',
      'BL Instruction Spreadsheet'
    ];
  }
}

export function getDefaultWorkflowSteps(type) {
  if (type === 'air_import') {
    return [
      'Job Created',
      'Invoice and P-List Received',
      'Checklist Approval',
      'Consol Manifest Filing Status',
      'Bill Filing',
      'Duty Payment',
      'Bill Registration',
      'OOC',
      'Accounts Processed',
      'Job Closed'
    ];
  } else if (type === 'air_export') {
    return [
      'Job Created',
      'Shipping Instruction',
      'AWB Instruction',
      'Cargo Ready Status',
      'Checklist Approval',
      'Shipping Bill Filing',
      'TC Generation',
      'LEO Copy',
      'Flight Status',
      'EGM Status',
      'DBK Status',
      'Accounts Processing',
      'Job Closed'
    ];
  } else if (type === 'sea_import') {
    return [
      'Job Created',
      'KYC',
      'Invoice and Packing List',
      'IGM Manifest',
      'Checklist',
      'Filling of BL',
      'First copy',
      'Duty payment',
      'OOC',
      'Delivery completed',
      'Accounts proccessed',
      'Job Closed'
    ];
  } else {
    // Default is 'sea_export'
    return [
      'Job Created',
      'Shipping Instruction Received',
      'Invoice and Packing List Received',
      'Checklist Preparing',
      'Prepared Checklist',
      'BL Instruction & Bill Generated',
      'Bill Assessment First Copy',
      'Cargo Movement',
      'Bill Goes to Let Export',
      'Gatepass Generation (Stuffing Completed)',
      'FCL Form 13 Applied (If FCL)',
      'Shipping Bill EIR, Let Export, Gatepass Submission',
      'Document Verified (Before Sailing)',
      'Sailing Completed',
      'EGM - Normal (INMAA-1 CCTL/CITPL)',
      'EGM - Transhipment (INKAT1/INENN1)',
      'Accounts Processing Done',
      'Incentive Processed',
      'Job Closed'
    ];
  }
}

// Check if db.json exists, if not initialize it
if (fs.existsSync(dbPath)) {
  try {
    const raw = fs.readFileSync(dbPath, 'utf8');
    data = JSON.parse(raw);

    if (!data.jobs) data.jobs = [];
    if (!data.cargo_items) data.cargo_items = [];
    if (!data.containers) data.containers = [];
    if (!data.billing_charges) data.billing_charges = [];
    if (!data.documents) data.documents = [];
    if (!data.history_logs) data.history_logs = [];
    if (!data.workflow_steps) data.workflow_steps = [];
    if (!data.users) data.users = [];

    let migrated = false;

    // Seed default users if users is empty
    if (data.users.length === 0) {
      const defaults = [
        { username: 'desk1', name: 'Desk 1 (Invoice)', role: 'Invoice', password: 'desk1' },
        { username: 'desk2', name: 'Desk 2 (Documentation)', role: 'Documentation', password: 'desk2' },
        { username: 'desk3', name: 'Desk 3 (Customs / CHA)', role: 'Customs', password: 'desk3' },
        { username: 'desk4', name: 'Desk 4 (Operations)', role: 'Operations', password: 'desk4' },
        { username: 'admin', name: 'System Admin', role: 'Admin', password: 'admin' }
      ];
      defaults.forEach(d => {
        data.users.push({
          username: d.username,
          name: d.name,
          role: d.role,
          passwordHash: hashPassword(d.password)
        });
      });
      migrated = true;
    }

    // Run migration to add closure bill properties to existing jobs
    data.jobs.forEach(job => {
      if (job.closing_bill_no === undefined) {
        job.closing_bill_no = "";
        migrated = true;
      }
      if (job.closing_bill_amount === undefined) {
        job.closing_bill_amount = "";
        migrated = true;
      }
      if (job.closing_sgst === undefined) {
        job.closing_sgst = "";
        migrated = true;
      }
      if (job.closing_cgst === undefined) {
        job.closing_cgst = "";
        migrated = true;
      }
      if (job.is_flagged === undefined) {
        job.is_flagged = false;
        migrated = true;
      }
      if (job.flag_remarks === undefined) {
        job.flag_remarks = "";
        migrated = true;
      }
      if (job.type === undefined) {
        job.type = "sea_export";
        migrated = true;
      }
      if (job.mawb_no_date === undefined) {
        job.mawb_no_date = "";
        migrated = true;
      }
      if (job.hawb_no_date === undefined) {
        job.hawb_no_date = "";
        migrated = true;
      }
      if (job.chargeable_weight === undefined) {
        job.chargeable_weight = "";
        migrated = true;
      }
    });

    // Run migration to rename Shipping Bill step to Accounts step for existing jobs
    data.workflow_steps.forEach(step => {
      if (step.name === 'Shipping Bill Processing Done') {
        step.name = 'Accounts Processing Done';
        migrated = true;
      }
    });

    // Run migration to add workflow steps to old jobs
    data.jobs.forEach(job => {
      const existing = data.workflow_steps.filter(s => s.job_id === job.id);
      if (existing.length === 0) {
        const now = new Date().toISOString();
        getDefaultWorkflowSteps('sea_export').forEach(stepName => {
          let status = 'Pending';
          let updated_by = null;
          let updated_at = null;

          if (stepName === 'Job Created') {
            status = 'Completed';
            updated_by = 'System';
            updated_at = job.created_at || now;
          } else if (job.status === 'Completed' || job.status === 'Closed') {
            status = 'Completed';
            updated_by = 'System';
            updated_at = job.updated_at || now;
          } else {
            // Check if documents are already submitted
            if (stepName === 'Prepared Checklist') {
              const checklistDoc = data.documents.find(d => d.job_id === job.id && d.name === 'Checklist PDF');
              if (checklistDoc && checklistDoc.status === 'Submitted') {
                status = 'Completed';
                updated_by = checklistDoc.updated_by || 'System';
                updated_at = checklistDoc.updated_at || now;
              }
            } else if (stepName === 'BL Instruction & Bill Generated') {
              const blDoc = data.documents.find(d => d.job_id === job.id && d.name === 'BL Instruction Spreadsheet');
              if (blDoc && blDoc.status === 'Submitted') {
                status = 'Completed';
                updated_by = blDoc.updated_by || 'System';
                updated_at = blDoc.updated_at || now;
              }
            }
          }

          data.workflow_steps.push({
            id: getNextId('workflow_steps'),
            job_id: job.id,
            name: stepName,
            status,
            updated_by,
            updated_at
          });
        });
        migrated = true;
      }
    });

    if (migrated) {
      saveToDisk();
    }
  } catch (err) {
    console.error('Error reading db.json, initializing empty db', err);
    saveToDisk();
  }
} else {
  saveToDisk();
}


/**
 * Fetch all jobs with their documents, cargo, container, charges and logs
 */
export function getAllJobs() {
  const sortedJobs = [...data.jobs].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return sortedJobs.map(job => {
    return {
      ...job,
      documents: data.documents.filter(d => d.job_id === job.id),
      cargo_items: data.cargo_items.filter(c => c.job_id === job.id),
      containers: data.containers.filter(c => c.job_id === job.id),
      billing_charges: data.billing_charges.filter(b => b.job_id === job.id),
      logs: data.history_logs.filter(l => l.job_id === job.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
      workflow_steps: data.workflow_steps.filter(w => w.job_id === job.id).sort((a, b) => a.id - b.id)
    };
  });
}

/**
 * Fetch a single job by id
 */
export function getJobById(id) {
  const job = data.jobs.find(j => j.id === id);
  if (!job) return null;

  return {
    ...job,
    documents: data.documents.filter(d => d.job_id === id),
    cargo_items: data.cargo_items.filter(c => c.job_id === id),
    containers: data.containers.filter(c => c.job_id === id),
    billing_charges: data.billing_charges.filter(b => b.job_id === id),
    logs: data.history_logs.filter(l => l.job_id === id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    workflow_steps: data.workflow_steps.filter(w => w.job_id === id).sort((a, b) => a.id - b.id)
  };
}

/**
 * Create a new shipment job with all details
 */
export function createJob(jobData) {
  const info = jobData.info;
  const creator = jobData.creator || 'System';

  // Check unique constraint
  const exists = data.jobs.some(j => j.job_no.trim().toLowerCase() === info.job_no.trim().toLowerCase());
  if (exists) {
    throw new Error('UNIQUE constraint failed: job_no must be unique');
  }

  const jobId = getNextId('jobs');
  const now = new Date().toISOString();

  const newJob = {
    id: jobId,
    job_no: info.job_no,
    type: info.type || 'sea_export',
    sb_no_date: info.sb_no_date || '',
    invoice_no_date: info.invoice_no_date || '',
    buyer_order_no_date: info.buyer_order_no_date || '',
    file_ref_no: info.file_ref_no || '',
    pre_carriage: info.pre_carriage || '',
    place_of_receipt: info.place_of_receipt || '',
    vessel_voyage: info.vessel_voyage || '',
    carrier: info.carrier || '',
    port_of_loading: info.port_of_loading || '',
    port_of_discharge: info.port_of_discharge || '',
    final_destination: info.final_destination || '',
    country_of_origin: info.country_of_origin || 'INDIA',
    country_of_dest: info.country_of_dest || '',
    hs_code: info.hs_code || '',
    payment_mode: info.payment_mode || '',
    eta: info.eta || '',
    etd: info.etd || '',
    shipper: info.shipper || '',
    consignee: info.consignee || '',
    notify: info.notify || '',
    also_notify: info.also_notify || '',
    cha: info.cha || '',
    forwarding_agent: info.forwarding_agent || '',
    buyer_if_other: info.buyer_if_other || '',
    cargo_desc: info.cargo_desc || '',
    marks_nos: info.marks_nos || '',
    dimensions: info.dimensions || '',
    total_pkgs: info.total_pkgs || '',
    gross_weight: info.gross_weight || '',
    net_weight: info.net_weight || '',
    cbm: info.cbm || '',
    type_of_packing: info.type_of_packing || '',
    exchange_rate: info.exchange_rate || '',
    bank_ac_drawback: info.bank_ac_drawback || '',
    mawb_no_date: info.mawb_no_date || '',
    hawb_no_date: info.hawb_no_date || '',
    chargeable_weight: info.chargeable_weight || '',
    status: 'Active',
    closing_bill_no: '',
    closing_bill_amount: '',
    closing_sgst: '',
    closing_cgst: '',
    is_flagged: info.is_flagged || false,
    flag_remarks: info.flag_remarks || '',
    created_at: now,
    updated_at: now
  };

  data.jobs.push(newJob);

  // Insert cargo items
  if (info.cargo_items && Array.isArray(info.cargo_items)) {
    info.cargo_items.forEach((item, index) => {
      data.cargo_items.push({
        id: getNextId('cargo_items'),
        job_id: jobId,
        sl_no: item.sl_no || (index + 1),
        description: item.description || '',
        hs_code: item.hs_code || '',
        qty: parseFloat(item.qty) || 0,
        rate: parseFloat(item.rate) || 0,
        unit: item.unit || '',
        net_wt: parseFloat(item.net_wt) || 0,
        gross_wt: parseFloat(item.gross_wt) || 0,
        amount: parseFloat(item.amount) || 0
      });
    });
  }

  // Insert containers
  if (info.containers && Array.isArray(info.containers)) {
    info.containers.forEach((cnt, index) => {
      data.containers.push({
        id: getNextId('containers'),
        job_id: jobId,
        sl_no: cnt.sl_no || (index + 1),
        container_no: cnt.container_no || '',
        seal_no: cnt.seal_no || '',
        pkgs: cnt.pkgs || '',
        net_wt: parseFloat(cnt.net_wt) || 0,
        gross_wt: parseFloat(cnt.gross_wt) || 0,
        cbm: parseFloat(cnt.cbm) || 0
      });
    });
  }

  // Insert billing charges
  if (info.billing_charges && Array.isArray(info.billing_charges)) {
    info.billing_charges.forEach(charge => {
      data.billing_charges.push({
        id: getNextId('billing_charges'),
        job_id: jobId,
        description: charge.description || '',
        amount: parseFloat(charge.amount) || 0
      });
    });
  }

  // Insert default documents
  const downloadUrls = info.download_urls || {};
  const defaultDocs = getDefaultDocuments(newJob.type);
  defaultDocs.forEach(docName => {
    const download_url = downloadUrls[docName] || null;
    let status = 'Pending';
    let doc_updated_by = null;
    let doc_updated_at = null;

    if (download_url) {
      status = 'Submitted';
      doc_updated_by = creator;
      doc_updated_at = now;
    }

    data.documents.push({
      id: getNextId('documents'),
      job_id: jobId,
      name: docName,
      status,
      updated_by: doc_updated_by,
      updated_at: doc_updated_at,
      download_url
    });
  });

  // Insert default workflow steps
  const defaultSteps = getDefaultWorkflowSteps(newJob.type);
  defaultSteps.forEach(stepName => {
    let status = 'Pending';
    let updated_by = null;
    let updated_at = null;

    if (stepName === 'Job Created') {
      status = 'Completed';
      updated_by = creator;
      updated_at = now;
    } else if ((stepName === 'Prepared Checklist' || stepName === 'Checklist Approval') && info.checklist_pdf_url) {
      status = 'Completed';
      updated_by = creator;
      updated_at = now;
    } else if (stepName === 'BL Instruction & Bill Generated' && downloadUrls['BL Instruction Spreadsheet']) {
      status = 'Completed';
      updated_by = creator;
      updated_at = now;
    } else if (stepName === 'AWB Instruction' && downloadUrls['AWB Instruction Spreadsheet']) {
      status = 'Completed';
      updated_by = creator;
      updated_at = now;
    }

    data.workflow_steps.push({
      id: getNextId('workflow_steps'),
      job_id: jobId,
      name: stepName,
      status,
      updated_by,
      updated_at
    });
  });

  // Write history log
  data.history_logs.push({
    id: getNextId('history_logs'),
    job_id: jobId,
    message: `Shipment Job #${info.job_no} created successfully.`,
    user: creator,
    created_at: now
  });

  saveToDisk();
  return jobId;
}

/**
 * Update an existing job details, clearing and replacing sub-grids
 */
export function updateJob(id, jobData) {
  const info = jobData.info;
  const user = jobData.creator || 'System';

  const jobIndex = data.jobs.findIndex(j => j.id === id);
  if (jobIndex === -1) {
    throw new Error('Job not found');
  }

  const now = new Date().toISOString();

  // Update main job fields
  data.jobs[jobIndex] = {
    ...data.jobs[jobIndex],
    job_no: info.job_no || data.jobs[jobIndex].job_no,
    sb_no_date: info.sb_no_date || '',
    invoice_no_date: info.invoice_no_date || '',
    buyer_order_no_date: info.buyer_order_no_date || '',
    file_ref_no: info.file_ref_no || '',
    pre_carriage: info.pre_carriage || '',
    place_of_receipt: info.place_of_receipt || '',
    vessel_voyage: info.vessel_voyage || '',
    carrier: info.carrier || '',
    port_of_loading: info.port_of_loading || '',
    port_of_discharge: info.port_of_discharge || '',
    final_destination: info.final_destination || '',
    country_of_origin: info.country_of_origin || 'INDIA',
    country_of_dest: info.country_of_dest || '',
    hs_code: info.hs_code || '',
    payment_mode: info.payment_mode || '',
    eta: info.eta || '',
    etd: info.etd || '',
    shipper: info.shipper || '',
    consignee: info.consignee || '',
    notify: info.notify || '',
    also_notify: info.also_notify || '',
    cha: info.cha || '',
    forwarding_agent: info.forwarding_agent || '',
    buyer_if_other: info.buyer_if_other || '',
    cargo_desc: info.cargo_desc || '',
    marks_nos: info.marks_nos || '',
    dimensions: info.dimensions || '',
    total_pkgs: info.total_pkgs || '',
    gross_weight: info.gross_weight || '',
    net_weight: info.net_weight || '',
    cbm: info.cbm || '',
    type_of_packing: info.type_of_packing || '',
    exchange_rate: info.exchange_rate || '',
    bank_ac_drawback: info.bank_ac_drawback || '',
    mawb_no_date: info.mawb_no_date || '',
    hawb_no_date: info.hawb_no_date || '',
    chargeable_weight: info.chargeable_weight || '',
    is_flagged: info.is_flagged !== undefined ? info.is_flagged : data.jobs[jobIndex].is_flagged || false,
    flag_remarks: info.flag_remarks !== undefined ? info.flag_remarks : data.jobs[jobIndex].flag_remarks || '',
    updated_at: now
  };

  // Replace cargo items
  data.cargo_items = data.cargo_items.filter(c => c.job_id !== id);
  if (info.cargo_items && Array.isArray(info.cargo_items)) {
    info.cargo_items.forEach((item, index) => {
      data.cargo_items.push({
        id: getNextId('cargo_items'),
        job_id: id,
        sl_no: item.sl_no || (index + 1),
        description: item.description || '',
        hs_code: item.hs_code || '',
        qty: parseFloat(item.qty) || 0,
        rate: parseFloat(item.rate) || 0,
        unit: item.unit || '',
        net_wt: parseFloat(item.net_wt) || 0,
        gross_wt: parseFloat(item.gross_wt) || 0,
        amount: parseFloat(item.amount) || 0
      });
    });
  }

  // Replace containers
  data.containers = data.containers.filter(c => c.job_id !== id);
  if (info.containers && Array.isArray(info.containers)) {
    info.containers.forEach((cnt, index) => {
      data.containers.push({
        id: getNextId('containers'),
        job_id: id,
        sl_no: cnt.sl_no || (index + 1),
        container_no: cnt.container_no || '',
        seal_no: cnt.seal_no || '',
        pkgs: cnt.pkgs || '',
        net_wt: parseFloat(cnt.net_wt) || 0,
        gross_wt: parseFloat(cnt.gross_wt) || 0,
        cbm: parseFloat(cnt.cbm) || 0
      });
    });
  }

  // Replace billing charges
  data.billing_charges = data.billing_charges.filter(b => b.job_id !== id);
  if (info.billing_charges && Array.isArray(info.billing_charges)) {
    info.billing_charges.forEach(charge => {
      data.billing_charges.push({
        id: getNextId('billing_charges'),
        job_id: id,
        description: charge.description || '',
        amount: parseFloat(charge.amount) || 0
      });
    });
  }

  // Update document paths if provided during edit
  if (info.download_urls) {
    data.documents.forEach(doc => {
      if (doc.job_id === id && info.download_urls[doc.name]) {
        doc.download_url = info.download_urls[doc.name];
        // If it compiled, we can auto-submit it
        if (doc.name === 'BL Instruction Spreadsheet' || doc.name === 'AWB Instruction Spreadsheet' || doc.name === 'Checklist PDF') {
          doc.status = 'Submitted';
          doc.updated_by = user;
          doc.updated_at = now;
        }
      }
    });

    // Automatically check off Prepared Checklist or Checklist Approval if Checklist PDF is available
    if (info.checklist_pdf_url || info.download_urls['Checklist PDF']) {
      const step = data.workflow_steps.find(s => s.job_id === id && (s.name === 'Prepared Checklist' || s.name === 'Checklist Approval'));
      if (step && step.status !== 'Completed') {
        step.status = 'Completed';
        step.updated_by = user;
        step.updated_at = now;
      }
    }

    // Automatically check off BL Instruction & Bill Generated or AWB Instruction step
    if (info.download_urls['BL Instruction Spreadsheet'] || info.download_urls['AWB Instruction Spreadsheet']) {
      const step = data.workflow_steps.find(s => s.job_id === id && (s.name === 'BL Instruction & Bill Generated' || s.name === 'AWB Instruction'));
      if (step && step.status !== 'Completed') {
        step.status = 'Completed';
        step.updated_by = user;
        step.updated_at = now;
      }
    }
  }

  // Log update
  data.history_logs.push({
    id: getNextId('history_logs'),
    job_id: id,
    message: `Shipment details updated.`,
    user,
    created_at: now
  });

  saveToDisk();
  return getJobById(id);
}

/**
 * Update Document Download URLs directly
 */
export function updateDocumentUrls(jobId, urls) {
  let updated = false;
  data.documents.forEach(doc => {
    if (doc.job_id === jobId && urls[doc.name]) {
      doc.download_url = urls[doc.name];
      updated = true;
    }
  });
  if (updated) saveToDisk();
}

/**
 * Toggle document status, and auto-complete job if all docs are Submitted
 */
export function toggleDocumentStatus(jobId, docId, status, user) {
  const docIndex = data.documents.findIndex(d => d.id === docId && d.job_id === jobId);
  if (docIndex === -1) {
    throw new Error('Document not found');
  }

  const now = new Date().toISOString();
  
  // Update document status
  data.documents[docIndex].status = status;
  data.documents[docIndex].updated_by = user;
  data.documents[docIndex].updated_at = now;

  const docName = data.documents[docIndex].name;
  
  // Write log entry
  data.history_logs.push({
    id: getNextId('history_logs'),
    job_id: jobId,
    message: `Document '${docName}' set to '${status}'.`,
    user,
    created_at: now
  });

  // Check if ALL documents for this job are 'Submitted'
  const jobDocs = data.documents.filter(d => d.job_id === jobId);
  const isCompleteNow = jobDocs.every(d => d.status === 'Submitted');

  const jobIndex = data.jobs.findIndex(j => j.id === jobId);
  let jobStatusChanged = false;

  if (jobIndex !== -1) {
    const currentJobStatus = data.jobs[jobIndex].status;
    
    if (isCompleteNow && currentJobStatus !== 'Completed') {
      data.jobs[jobIndex].status = 'Completed';
      data.jobs[jobIndex].updated_at = now;
      data.history_logs.push({
        id: getNextId('history_logs'),
        job_id: jobId,
        message: `Job automatically completed since all required documents are Submitted.`,
        user: 'System',
        created_at: now
      });
      jobStatusChanged = true;
    } else if (!isCompleteNow && currentJobStatus === 'Completed') {
      data.jobs[jobIndex].status = 'Active';
      data.jobs[jobIndex].updated_at = now;
      data.history_logs.push({
        id: getNextId('history_logs'),
        job_id: jobId,
        message: `Job re-activated (Pending documents found).`,
        user: 'System',
        created_at: now
      });
      jobStatusChanged = true;
    } else {
      data.jobs[jobIndex].updated_at = now;
    }
  }

  saveToDisk();

  return {
    jobStatusChanged,
    docName,
    job: getJobById(jobId)
  };
}

/**
 * Get all logs across all jobs for the history log screen
 */
export function getAllHistoryLogs() {
  const sortedLogs = [...data.history_logs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  return sortedLogs.slice(0, 200).map(log => {
    const job = data.jobs.find(j => j.id === log.job_id);
    return {
      ...log,
      job_no: job ? job.job_no : 'Unknown'
    };
  });
}

/**
 * Delete a job (for archiving or cleanup)
 */
export function deleteJob(id) {
  data.jobs = data.jobs.filter(j => j.id !== id);
  data.cargo_items = data.cargo_items.filter(c => c.job_id !== id);
  data.containers = data.containers.filter(c => c.job_id !== id);
  data.billing_charges = data.billing_charges.filter(b => b.job_id !== id);
  data.documents = data.documents.filter(d => d.job_id !== id);
  data.history_logs = data.history_logs.filter(l => l.job_id !== id);
  data.workflow_steps = data.workflow_steps.filter(w => w.job_id !== id);

  saveToDisk();
}

/**
 * Toggle a workflow step status, update user details, and handle job closure
 */
export function toggleWorkflowStep(jobId, stepId, status, user, closingDetails) {
  const stepIndex = data.workflow_steps.findIndex(s => s.id === stepId && s.job_id === jobId);
  if (stepIndex === -1) {
    throw new Error('Workflow step not found');
  }

  const now = new Date().toISOString();
  
  data.workflow_steps[stepIndex].status = status; // 'Pending', 'Completed', 'N/A'
  data.workflow_steps[stepIndex].updated_by = user;
  data.workflow_steps[stepIndex].updated_at = now;

  const stepName = data.workflow_steps[stepIndex].name;
  
  // Write log entry
  data.history_logs.push({
    id: getNextId('history_logs'),
    job_id: jobId,
    message: `Workflow step '${stepName}' set to '${status}'.`,
    user,
    created_at: now
  });

  // Check if "Job Closed" step is Completed
  const closedStep = data.workflow_steps.find(s => s.job_id === jobId && (s.name === 'Job Closed' || s.name === 'Close job' || s.name === 'Close Job'));
  
  const jobIndex = data.jobs.findIndex(j => j.id === jobId);
  let jobStatusChanged = false;

  if (jobIndex !== -1) {
    const currentStatus = data.jobs[jobIndex].status;
    const isClosedNow = closedStep && closedStep.status === 'Completed';

    // Store or clear closing billing details
    if (isClosedNow) {
      if (closingDetails) {
        data.jobs[jobIndex].closing_bill_no = closingDetails.bill_no || "";
        data.jobs[jobIndex].closing_bill_amount = closingDetails.bill_amount || "";
        data.jobs[jobIndex].closing_sgst = closingDetails.sgst || "";
        data.jobs[jobIndex].closing_cgst = closingDetails.cgst || "";
      }
    } else {
      data.jobs[jobIndex].closing_bill_no = "";
      data.jobs[jobIndex].closing_bill_amount = "";
      data.jobs[jobIndex].closing_sgst = "";
      data.jobs[jobIndex].closing_cgst = "";
    }

    if (isClosedNow && currentStatus !== 'Closed' && currentStatus !== 'Completed') {
      data.jobs[jobIndex].status = 'Closed';
      data.jobs[jobIndex].updated_at = now;
      data.history_logs.push({
        id: getNextId('history_logs'),
        job_id: jobId,
        message: `Job status set to Closed (Workflow closed).`,
        user: 'System',
        created_at: now
      });
      jobStatusChanged = true;
    } else if (!isClosedNow && (currentStatus === 'Closed' || currentStatus === 'Completed')) {
      data.jobs[jobIndex].status = 'Active';
      data.jobs[jobIndex].updated_at = now;
      data.history_logs.push({
        id: getNextId('history_logs'),
        job_id: jobId,
        message: `Job status set to Active (Workflow re-opened).`,
        user: 'System',
        created_at: now
      });
      jobStatusChanged = true;
    } else {
      data.jobs[jobIndex].updated_at = now;
    }
  }

  saveToDisk();

  return {
    jobStatusChanged,
    stepName,
    job: getJobById(jobId)
  };
}
