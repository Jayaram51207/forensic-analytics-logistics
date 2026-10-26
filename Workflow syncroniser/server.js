import fs from 'fs';
import express from 'express';
import cors from 'cors';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import https from 'https';
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
  changePassword,
  setPassword,
  startupInfo
} from './db.js';
import { createCapture, sha256File } from '../forensics/src/capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
// HTTPS when SYNC_TLS_CERT and SYNC_TLS_KEY name PEM files. Without them passwords and session
// cookies cross the network in clear text: acceptable only on a trusted single-office LAN.
const TLS = process.env.SYNC_TLS_CERT && process.env.SYNC_TLS_KEY
  ? { cert: fs.readFileSync(process.env.SYNC_TLS_CERT), key: fs.readFileSync(process.env.SYNC_TLS_KEY) } : null;
const COOKIE_FLAGS = `HttpOnly; SameSite=Strict; Path=/${TLS ? '; Secure' : ''}`;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const AUTH_REQUIRED = process.env.SYNC_AUTH !== 'off';

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
if (forensic && forensic.failMode === 'open') console.warn('WARNING: FORENSIC_FAIL_MODE=open - destructive operations will proceed even when their evidence cannot be written. Recorded in system.started.');
if (startupInfo.accounts === 'no_accounts') console.warn('No user accounts exist. Start once with SYNC_ADMIN_PASSWORD set (12+ characters) to create the administrator.');
if (forensic) forensic.startup({ ...startupInfo, auth_required: AUTH_REQUIRED, tls: !!TLS, delete_requires_admin: process.env.SYNC_DELETE_REQUIRES_ADMIN !== '0' });

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
const SESSION_IDLE_MS = (parseFloat(process.env.SYNC_SESSION_IDLE_MINUTES || '720') || 720) * 60 * 1000;
const SESSION_MAX_MS = (parseFloat(process.env.SYNC_SESSION_MAX_HOURS || '24') || 24) * 60 * 60 * 1000;
const sessions = new Map(); // token -> { username, name, role, created_at, last_seen }  (in memory: a restart signs everyone out)
if (!AUTH_REQUIRED) console.warn('WARNING: SYNC_AUTH=off - API requests are not authenticated and actor names are unverified.');

function sessionFrom(req) {
  const cookie = /(?:^|;\s*)sync_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  const bearer = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  const token = (cookie || bearer || [])[1];
  const session = token && sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.last_seen > SESSION_IDLE_MS || Date.now() - session.created_at > SESSION_MAX_MS) {
    sessions.delete(token);
    return null;
  }
  session.last_seen = Date.now();
  return { token, ...session };
}

app.use('/api', (req, res, next) => {
  if (!AUTH_REQUIRED || req.path === '/login') return next();
  req.session = sessionFrom(req);
  if (req.session) {
    // An administrator-set or policy-failing password must be replaced before anything else.
    if (req.session.must_change_password && !['/session', '/password', '/logout'].includes(req.path)) {
      return res.status(403).json({ error: 'Password change required', must_change_password: true });
    }
    return next();
  }
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
// Login throttling: failed attempts per client address and per username, kept in memory.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = parseInt(process.env.SYNC_LOGIN_MAX_FAILURES || '5', 10);
const loginFailures = new Map(); // key -> [timestamps]
function recentFailures(key) {
  const now = Date.now();
  const list = (loginFailures.get(key) || []).filter(t => now - t < LOGIN_WINDOW_MS);
  loginFailures.set(key, list);
  return list;
}
function throttled(req, username) {
  return [`ip:${req.ip}`, `user:${String(username).toLowerCase()}`].some(k => recentFailures(k).length >= LOGIN_MAX_FAILURES);
}
function noteFailure(req, username) {
  for (const k of [`ip:${req.ip}`, `user:${String(username).toLowerCase()}`]) recentFailures(k).push(Date.now());
}

function startSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username: user.username, name: user.name, role: user.role, must_change_password: !!user.must_change_password, created_at: Date.now(), last_seen: Date.now() });
  res.setHeader('Set-Cookie', `sync_sid=${token}; ${COOKIE_FLAGS}`);
  return token;
}
function endSessionsOf(username, exceptToken = null) {
  for (const [t, s] of sessions) if (s.username.toLowerCase() === String(username).toLowerCase() && t !== exceptToken) sessions.delete(t);
}

// Login authentication. One message for every failure, so it does not reveal which accounts exist.
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password || username.length > 200 || password.length > 200) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (throttled(req, username)) {
    if (forensic) forensic.rejected(req, 'login throttled');
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
  }

  const user = verifyUser(username, password);
  if (forensic) forensic.login(req, username, user);
  if (user) {
    loginFailures.delete(`user:${username.toLowerCase()}`);
    const token = startSession(res, user);
    return res.json({
      success: true,
      username: user.username,
      name: user.name,
      role: user.role,
      must_change_password: user.must_change_password,
      token
    });
  }

  noteFailure(req, username);
  res.status(401).json({ error: 'Invalid username or password' });
});

// The signed-in user changes their own password. All their other sessions end.
app.post('/api/password', (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Authentication required' });
  const { current_password, new_password } = req.body || {};
  if (throttled(req, req.session.username)) return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
  try {
    changePassword(req.session.username, current_password, new_password);
  } catch (err) {
    if (/Current password/.test(err.message)) noteFailure(req, req.session.username);
    if (forensic) forensic.userChanged(req, 'user.password_change_failed', req.session.username, { reason: err.message });
    return res.status(err.status || 400).json({ error: err.message });
  }
  endSessionsOf(req.session.username);
  const token = startSession(res, { ...req.session, must_change_password: false });
  if (forensic) forensic.userChanged(req, 'user.password_changed', req.session.username, { other_sessions_ended: true });
  res.json({ success: true, token });
});

app.get('/api/session', (req, res) => {
  if (!req.session) return res.status(401).json({ error: 'Authentication required' });
  res.json({ username: req.session.username, name: req.session.name, role: req.session.role, must_change_password: !!req.session.must_change_password });
});

app.post('/api/logout', (req, res) => {
  if (req.session) {
    sessions.delete(req.session.token);
    if (forensic) forensic.logout(req);
  }
  res.setHeader('Set-Cookie', `sync_sid=; ${COOKIE_FLAGS}; Max-Age=0`);
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

app.post('/api/users/:username/password', requireAdmin, (req, res) => {
  try {
    setPassword(req.params.username, (req.body || {}).new_password);
    endSessionsOf(req.params.username);
    if (forensic) forensic.userChanged(req, 'user.password_reset', req.params.username, { must_change_password: true });
    res.json({ success: true });
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
    endSessionsOf(username);
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

// Deleting a job: Admin role by default (DECISIONS_AND_OPEN_REQUIREMENTS.md, question 6).
// SYNC_DELETE_REQUIRES_ADMIN=0 lets any signed-in user delete, as the original UI did.
const requireDeleteRole = process.env.SYNC_DELETE_REQUIRES_ADMIN === '0' ? (req, res, next) => next() : requireAdmin;
app.delete('/api/jobs/:id', requireDeleteRole, (req, res) => {
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
if (!TLS) console.warn('WARNING: plain HTTP - passwords and session cookies are not encrypted on the network. Set SYNC_TLS_CERT and SYNC_TLS_KEY for HTTPS.');
(TLS ? https.createServer(TLS, app) : app).listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(`🚀 Workflow Synchronizer Server running on PORT ${PORT}`);
  console.log(`--------------------------------------------------`);
  console.log(`Local machine URL: ${TLS ? 'https' : 'http'}://localhost:${PORT}`);
  
  // Find local LAN IP addresses
  const interfaces = os.networkInterfaces();
  let foundIP = false;
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`Local LAN Office URL: ${TLS ? 'https' : 'http'}://${iface.address}:${PORT}`);
        foundIP = true;
      }
    }
  }
  if (!foundIP) {
    console.log(`LAN IP: Could not detect external network cards. Check connection.`);
  }
  console.log(`==================================================`);
});
