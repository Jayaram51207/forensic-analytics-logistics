import express from 'express';
import cors from 'cors';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
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
  deleteUser
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Setup multer for checklist uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `checklist-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

// Admin check middleware
function requireAdmin(req, res, next) {
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
    const py = spawn('python', ['compiler.py', 'parse', filePath]);
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
    const downloadsDir = path.join(__dirname, 'public', 'downloads');
    const py = spawn('python', ['compiler.py', 'compile', downloadsDir]);
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
  if (user) {
    return res.json({
      success: true,
      username: user.username,
      name: user.name,
      role: user.role
    });
  }

  res.status(401).json({ error: 'Invalid username or password' });
});

// Users management endpoints (restricted to admin)
app.get('/api/users', requireAdmin, (req, res) => {
  try {
    res.json(getAllUsers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: 'All fields (username, password, name, role) are required' });
  }
  try {
    createUser({ username, password, name, role });
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/users/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  try {
    deleteUser(username);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Checklist PDF Parsing Endpoint
app.post('/api/parse-checklist', upload.single('checklist'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No checklist file uploaded' });
  }

  try {
    const parsedData = await parseChecklistPDF(req.file.path);
    
    // Inject checklist local URL for storage later
    parsedData.checklist_pdf_url = `/uploads/${req.file.filename}`;
    
    res.json(parsedData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST Endpoints
app.get('/api/jobs', (req, res) => {
  try {
    res.json(getAllJobs());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/jobs', async (req, res) => {
  try {
    const { info, creator } = req.body;
    if (!info || !info.job_no) {
      return res.status(400).json({ error: 'Job Number is required' });
    }

    // Run Excel Compiler first to generate the BL and Billing spreadsheets
    try {
      const compileResult = await runExcelCompiler({ info });
      if (compileResult.success) {
        info.download_urls = mapCompileResult(info, compileResult);
      }
    } catch (compErr) {
      console.error('Excel compile error on save:', compErr);
      // We still save the metadata but flag compiling issue in logs
    }

    const jobId = createJob({ info, creator });
    const newJob = getJobById(jobId);

    // Broadcast creation
    broadcast('job_created', newJob);
    broadcast('log_entry', { message: `Shipment #${info.job_no} created by ${creator || 'System'}` });

    res.status(201).json(newJob);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed') || err.message.includes('unique')) {
      res.status(400).json({ error: `Job number already exists.` });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

app.put('/api/jobs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { info, creator } = req.body;

    // Run Excel Compiler on edit to update the spreadsheets
    try {
      const compileResult = await runExcelCompiler({ info });
      if (compileResult.success) {
        info.download_urls = mapCompileResult(info, compileResult);
      }
    } catch (compErr) {
      console.error('Excel compile error on update:', compErr);
    }

    const updatedJob = updateJob(id, { info, creator });

    // Broadcast update
    broadcast('job_updated', updatedJob);
    broadcast('log_entry', { message: `Shipment #${updatedJob.job_no} details updated by ${creator || 'System'}` });

    res.json(updatedJob);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/jobs/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const job = getJobById(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    deleteJob(id);

    // Broadcast deletion
    broadcast('job_deleted', { id });
    broadcast('log_entry', { message: `Shipment #${job.job_no} archived/deleted.` });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/jobs/:id/documents/:docId', (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const docId = parseInt(req.params.docId);
    const { status, user } = req.body;

    if (!status || !user) {
      return res.status(400).json({ error: 'status and user are required' });
    }

    const result = toggleDocumentStatus(jobId, docId, status, user);

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
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/jobs/:id/workflow/:stepId', (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const stepId = parseInt(req.params.stepId);
    const { status, user, closingDetails } = req.body;

    if (!status || !user) {
      return res.status(400).json({ error: 'status and user are required' });
    }

    const result = toggleWorkflowStep(jobId, stepId, status, user, closingDetails);

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
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', requireAdmin, (req, res) => {
  try {
    res.json(getAllHistoryLogs());
  } catch (err) {
    res.status(500).json({ error: err.message });
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
