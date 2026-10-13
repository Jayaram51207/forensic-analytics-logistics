import fs from 'fs';
import express from 'express';
import cors from 'cors';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
  getAllJobs,
  getJobById,
  createJob,
  updateJob,
  toggleDocumentStatus,
  getAllHistoryLogs,
  deleteJob,
  updateDocumentUrls,
  toggleWorkflowStep,
  verifyUser,
  getAllUsers,
  createUser,
  deleteUser,
  startupInfo
} from './db.js';
import { createCapture, sha256File } from '../forensics/src/capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Runtime folders are configurable so tests and synthetic runs never touch live data.
// Python for compiler.py: SYNC_PYTHON, else the project environment (forensics/setup_env.cmd), else PATH.
const VENV_PYTHON = path.join(__dirname, '..', 'forensics', '.venv', 'Scripts', 'python.exe');
const PYTHON = process.env.SYNC_PYTHON || (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python');
const UPLOADS_DIR = process.env.SYNC_UPLOADS_DIR || path.join(__dirname, 'uploads');
const DOWNLOADS_DIR = process.env.SYNC_DOWNLOADS_DIR || path.join(__dirname, 'public', 'downloads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true }); // multer does not create it
if (process.env.SYNC_DOWNLOADS_DIR) app.use('/downloads', express.static(DOWNLOADS_DIR));

// Forensic evidence capture (see docs/INTEGRATION_POINTS.md). FORENSIC_DISABLED=1 restores the original behaviour.
const forensic = process.env.FORENSIC_DISABLED === '1' ? null : createCapture({
  dir: process.env.FORENSIC_DIR || path.join(__dirname, '..', 'forensics', 'data'),
  db: { getJobById, getAllJobs, getAllUsers },
  downloadsDir: DOWNLOADS_DIR,
  generator: {
    script: 'compiler.py',
    script_sha256: sha256File(path.join(__dirname, 'compiler.py')),
    parser_sha256: sha256File(path.join(__dirname, 'pdf_parser.py'))
  }
});
if (forensic) forensic.startup(startupInfo);

// Setup multer for checklist uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `checklist-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

// ---- Authenticated sessions ------------------------------------------------
// Identity and privileges come from a server-side session created at login.
// Names sent by the client (creator, user, adminUsername) are no longer trusted.
// SYNC_AUTH=off restores the original unauthenticated behaviour (not recommended).
const AUTH_REQUIRED = process.env.SYNC_AUTH !== 'off';
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const sessions = new Map(); // token -> { username, name, role, created_at, last_seen }  (in memory: a restart signs everyone out)
if (!AUTH_REQUIRED) console.warn('WARNING: SYNC_AUTH=off - API requests are not authenticated and actor names are unverified.');

function sessionFrom(req) {
  const cookie = /(?:^|;\s*)sync_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  const bearer = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  const token = (cookie || bearer || [])[1];
  const session = token && sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.last_seen > SESSION_IDLE_MS) {
    sessions.delete(token);
    return null;
  }
  session.last_seen = Date.now();
  return { token, ...session };
}

app.use('/api', (req, res, next) => {
  if (!AUTH_REQUIRED || req.path === '/login') return next();
  req.session = sessionFrom(req);
  if (req.session) return next();
  if (forensic && req.method !== 'GET') forensic.rejected(req, 'no valid session');
  res.status(401).json({ error: 'Authentication required' });
});

// The acting user's display name: from the session when authentication is on.
function actorName(req, claimed) {
  return req.session ? req.session.name : claimed;
}

// Admin check middleware
function requireAdmin(req, res, next) {
  if (AUTH_REQUIRED) {
    if (req.session.role === 'Admin') return next();
    if (forensic) forensic.rejected(req, 'admin role required');
    return res.status(403).json({ error: 'Access denied: Admin only' });
  }
  const adminUsername = req.query.adminUsername || req.body.adminUsername || req.headers['x-admin-username'];
  if (adminUsername === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Access denied: Admin only' });
  }
}

function mapCompileResult(info, compileResult) {
  const download_urls = {};
  if (info.type === 'air_export') {
    download_urls['AWB Instruction Spreadsheet'] = compileResult.bl_file;
  } else if (info.type === 'sea_export') {
    download_urls['BL Instruction Spreadsheet'] = compileResult.bl_file;
  }
  download_urls['Invoice Spreadsheet'] = compileResult.billing_file;
  if (info.checklist_pdf_url) {
    download_urls['Checklist PDF'] = info.checklist_pdf_url;
  }
  return download_urls;
}

// List of connected SSE clients
let clients = [];

// Server-Sent Events stream
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(': ping\n\n');
  clients.push(res);
  req.on('close', () => {
    clients = clients.filter(c => c !== res);
  });
});

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(c => {
    try {
      c.write(payload);
    } catch (err) {
      console.error('Error broadcasting event:', err);
    }
  });
}

// Spawns Python process to parse checklist PDF
function parseChecklistPDF(filePath) {
  return new Promise((resolve, reject) => {
    const py = spawn(PYTHON, ['compiler.py', 'parse', filePath], { cwd: __dirname });
    let output = '';
    let errorOutput = '';

    py.stdout.on('data', (data) => {
      output += data.toString();
    });

    py.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    py.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python parse failed with code ${code}. Error: ${errorOutput}`));
      } else {
        try {
          resolve(JSON.parse(output));
        } catch (e) {
          reject(new Error(`Failed to parse Python JSON output: ${output}`));
        }
      }
    });
  });
}

// Spawns Python process to compile Excel spreadsheets
function runExcelCompiler(jobPayload) {
  return new Promise((resolve, reject) => {
    const py = spawn(PYTHON, ['compiler.py', 'compile', DOWNLOADS_DIR], { cwd: __dirname });
    let output = '';
    let errorOutput = '';

    py.stdout.on('data', (data) => {
      output += data.toString();
    });

    py.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    // Write job payload to Python stdin
    py.stdin.write(JSON.stringify(jobPayload));
    py.stdin.end();

    py.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Excel compilation failed with code ${code}. Error: ${errorOutput}`));
      } else {
        try {
          resolve(JSON.parse(output));
        } catch (e) {
          reject(new Error(`Failed to parse compiler output: ${output}`));
        }
      }
    });
  });
}

// Login authentication
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = verifyUser(username, password);
  if (forensic) forensic.login(req, username, user);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { username: user.username, name: user.name, role: user.role, created_at: Date.now(), last_seen: Date.now() });
    res.setHeader('Set-Cookie', `sync_sid=${token}; HttpOnly; SameSite=Strict; Path=/`);
    return res.json({
      success: true,
      username: user.username,
      name: user.name,
      role: user.role,
      token
    });
  }

  res.status(401).json({ error: 'Invalid username or password' });
});

app.get('/api/session', (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Authentication required' });
  res.json({ username: req.session.username, name: req.session.name, role: req.session.role });
});

app.post('/api/logout', (req, res) => {
  if (req.session) {
    sessions.delete(req.session.token);
    if (forensic) forensic.logout(req);
  }
  res.setHeader('Set-Cookie', 'sync_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ success: true });
});

// Users management endpoints (restricted to admin)
app.get('/api/users', requireAdmin, (req, res) => {
  try {
    res.json(getAllUsers());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: 'All fields (username, password, name, role) are required' });
  }
  try {
    createUser({ username, password, name, role });
    if (forensic) forensic.userChanged(req, 'user.created', username, { name, role });
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.delete('/api/users/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  try {
    const removed = getAllUsers().find(u => u.username.toLowerCase() === username.trim().toLowerCase());
    if (forensic && removed) forensic.userChanged(req, 'user.delete_requested', username, { removed });
    deleteUser(username);
    if (forensic) forensic.userChanged(req, 'user.deleted', username, { removed });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// Checklist PDF Parsing Endpoint
app.post('/api/parse-checklist', upload.single('checklist'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No checklist file uploaded' });
  }

  const fx = forensic && forensic.begin(req, req.body && req.body.user);
  if (fx) forensic.sourceUploaded(fx, req.file);

  try {
    const parsedData = await parseChecklistPDF(req.file.path);
    if (fx) forensic.sourceParsed(fx, req.file, parsedData);
    
    // Inject checklist local URL for storage later
    parsedData.checklist_pdf_url = `/uploads/${req.file.filename}`;
    
    res.json(parsedData);
  } catch (err) {
    if (fx) forensic.sourceParsed(fx, req.file, null, err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// REST Endpoints
app.get('/api/jobs', (req, res) => {
  try {
    res.json(getAllJobs());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/jobs', async (req, res) => {
  try {
    const { info } = req.body;
    const creator = actorName(req, req.body.creator);
    if (!info || !info.job_no) {
      return res.status(400).json({ error: 'Job Number is required' });
    }

    const fx = forensic && forensic.begin(req, req.body.creator);

    // Run Excel Compiler first to generate the BL and Billing spreadsheets
    try {
      const compileResult = fx
        ? await forensic.generate(fx, null, info, () => runExcelCompiler({ info }))
        : await runExcelCompiler({ info });
      if (compileResult.success) {
        info.download_urls = mapCompileResult(info, compileResult);
      }
    } catch (compErr) {
      console.error('Excel compile error on save:', compErr);
      // We still save the metadata but flag compiling issue in logs
    }

    const jobId = createJob({ info, creator });
    const newJob = getJobById(jobId);
    if (fx) {
      try {
        forensic.jobCreated(fx, newJob, info);
      } catch (ferr) {
        deleteJob(jobId); // no evidence, no record: undo the insert
        throw ferr;
      }
    }

    // Broadcast creation
    broadcast('job_created', newJob);
    broadcast('log_entry', { message: `Shipment #${info.job_no} created by ${creator || 'System'}` });

    res.status(201).json(newJob);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed') || err.message.includes('unique')) {
      res.status(400).json({ error: `Job number already exists.` });
    } else {
      res.status(err.status || 500).json({ error: err.message });
    }
  }
});

app.put('/api/jobs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { info } = req.body;
    const creator = actorName(req, req.body.creator);

    const before = structuredClone(getJobById(id)); // copy: db.js mutates rows in place
    const fx = forensic && before && forensic.begin(req, req.body.creator, id);
    if (fx) forensic.updateRequested(fx, before, info); // old state is preserved before anything is overwritten

    // Run Excel Compiler on edit to update the spreadsheets
    try {
      const compileResult = fx
        ? await forensic.generate(fx, before, info, () => runExcelCompiler({ info }))
        : await runExcelCompiler({ info });
      if (compileResult.success) {
        info.download_urls = mapCompileResult(info, compileResult);
      }
    } catch (compErr) {
      console.error('Excel compile error on update:', compErr);
    }

    const updatedJob = updateJob(id, { info, creator });
    if (fx) forensic.jobUpdated(fx, before, updatedJob);

    // Broadcast update
    broadcast('job_updated', updatedJob);
    broadcast('log_entry', { message: `Shipment #${updatedJob.job_no} details updated by ${creator || 'System'}` });

    res.json(updatedJob);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/jobs/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const job = getJobById(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const fx = forensic && forensic.begin(req, req.body && req.body.user, id);
    if (fx) forensic.deleteRequested(fx, job); // full snapshot, including the history deleteJob() erases

    deleteJob(id);
    if (fx) forensic.jobDeleted(fx, job);

    // Broadcast deletion
    broadcast('job_deleted', { id });
    broadcast('log_entry', { message: `Shipment #${job.job_no} archived/deleted${req.session ? ` by ${req.session.name}` : ''}.` });

    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/jobs/:id/documents/:docId', (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const docId = parseInt(req.params.docId);
    const { status } = req.body;
    const user = actorName(req, req.body.user);

    if (!status || !user) {
      return res.status(400).json({ error: 'status and user are required' });
    }

    const before = structuredClone(getJobById(jobId)); // copy: db.js mutates rows in place
    const doc = before && before.documents.find(d => d.id === docId);
    const fx = forensic && doc && forensic.begin(req, req.body.user, jobId);
    if (fx) forensic.statusChangeRequested(fx, 'document', before, doc, status);

    const result = toggleDocumentStatus(jobId, docId, status, user);
    if (fx) forensic.statusChanged(fx, 'document', before, result.job, doc);

    // Broadcast document status toggle
    broadcast('document_toggled', {
      jobId,
      docId,
      status,
      docName: result.docName,
      user,
      jobStatusChanged: result.jobStatusChanged,
      job: result.job
    });

    broadcast('log_entry', { 
      message: `${user} updated '${result.docName}' to '${status}' for Job #${result.job.job_no}.`
    });

    res.json(result.job);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/jobs/:id/workflow/:stepId', (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const stepId = parseInt(req.params.stepId);
    const { status, closingDetails } = req.body;
    const user = actorName(req, req.body.user);

    if (!status || !user) {
      return res.status(400).json({ error: 'status and user are required' });
    }

    const before = structuredClone(getJobById(jobId)); // copy: db.js mutates rows in place
    const step = before && before.workflow_steps.find(s => s.id === stepId);
    const fx = forensic && step && forensic.begin(req, req.body.user, jobId);
    if (fx) forensic.statusChangeRequested(fx, 'workflow_step', before, step, status, { closing_details_supplied: closingDetails ?? null });

    const result = toggleWorkflowStep(jobId, stepId, status, user, closingDetails);
    if (fx) forensic.statusChanged(fx, 'workflow_step', before, result.job, step);

    // Broadcast workflow status toggle
    broadcast('workflow_toggled', {
      jobId,
      stepId,
      status,
      stepName: result.stepName,
      user,
      jobStatusChanged: result.jobStatusChanged,
      job: result.job
    });

    broadcast('log_entry', { 
      message: `${user} updated workflow step '${result.stepName}' to '${status}' for Job #${result.job.job_no}.`
    });

    res.json(result.job);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/logs', requireAdmin, (req, res) => {
  try {
    res.json(getAllHistoryLogs());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Fallback routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start listening
app.listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(`🚀 Workflow Synchronizer Server running on PORT ${PORT}`);
  console.log(`--------------------------------------------------`);
  console.log(`Local machine URL: http://localhost:${PORT}`);
  
  // Find local LAN IP addresses
  const interfaces = os.networkInterfaces();
  let foundIP = false;
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`Local LAN Office URL: http://${iface.address}:${PORT}`);
        foundIP = true;
      }
    }
  }
  if (!foundIP) {
    console.log(`LAN IP: Could not detect external network cards. Check connection.`);
  }
  console.log(`==================================================`);
});
