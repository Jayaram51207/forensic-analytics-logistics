// Capture layer for the Workflow Synchroniser. server.js calls these hooks;
// nothing here changes operational data.
//
// Pattern for destructive operations (update, delete, status change):
//   1. "<x>_requested" event with the state about to be overwritten  -> REQUIRED
//   2. the operational write
//   3. "<x>" completion event with field-level changes               -> best effort
// If a REQUIRED event cannot be written the operation is refused (fail-closed)
// unless FORENSIC_FAIL_MODE=open, in which case the gap is logged and later
// recorded in the chain as forensic.capture_gap.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventStore, ForensicWriteError, canonical, sha256 } from './store.js';
import { diffJobs, jobState, stateHash } from './diff.js';

const APP = 'workflow_sync';

export const sha256File = file => sha256(fs.readFileSync(file));

/**
 * Fingerprint of an .xlsx that ignores zip timestamps and docProps/core.xml.
 * openpyxl stamps the save time into every file, so byte hashes differ between
 * two generations from identical input; this fingerprint does not.
 * Built from the zip central directory (entry name, CRC-32, uncompressed size).
 */
export function xlsxContentFingerprint(buf) {
  try {
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) return null;
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) return null;
      const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
      if (name !== 'docProps/core.xml') entries.push(`${name}:${crc}:${size}`);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return sha256(entries.sort().join('\n'));
  } catch {
    return null;
  }
}

export function createCapture({
  dir,
  db,                                   // { getJobById, getAllJobs, getAllUsers }
  downloadsDir,
  failMode = process.env.FORENSIC_FAIL_MODE === 'open' ? 'open' : 'closed',
  archive = process.env.FORENSIC_ARCHIVE !== '0',
  allowSimTime = process.env.FORENSIC_ALLOW_SIM_TIME === '1',
  generator = {}
}) {
  const store = new EventStore(dir);
  const artifactsDir = path.join(dir, 'artifacts');
  const failureLog = path.join(dir, 'capture_failures.log');
  if (archive) fs.mkdirSync(artifactsDir, { recursive: true });

  // Derived indexes, rebuilt from the evidence itself at start-up.
  const corrByJobId = new Map();   // live db job id -> correlation_id (db ids are reused after deletes)
  const genCount = new Map();      // correlation_id -> number of generation attempts
  const lastOutput = new Map();    // output path -> sha256 of the copy we last recorded
  const uploads = new Map();       // stored upload filename -> { event_id, sha256, parse_event_id }
  let pendingGap = null;

  for (const r of store.readAll().records.map(x => x.record)) {
    if (r.application !== APP) continue;
    if ((r.action === 'job.created' || r.action === 'job.baseline_captured') && r.entity_id) corrByJobId.set(r.entity_id, r.correlation_id);
    if (r.action === 'job.deleted' && corrByJobId.get(r.entity_id) === r.correlation_id) corrByJobId.delete(r.entity_id);
    if (r.action === 'document.generation_requested') genCount.set(r.correlation_id, Math.max(genCount.get(r.correlation_id) || 0, r.generation_number || 0));
    if (r.action === 'document.generated') for (const a of r.artifacts) lastOutput.set(a.path, a.sha256);
    if (r.action === 'source.uploaded') uploads.set(r.payload.stored_name, { event_id: r.event_id, sha256: r.artifacts[0]?.sha256 });
    if (r.action === 'source.parsed' && uploads.has(r.payload.stored_name)) uploads.get(r.payload.stored_name).parse_event_id = r.event_id;
  }

  function write(ctx, evt, required) {
    const full = { application: APP, operation_id: ctx?.operation_id, actor: ctx?.actor, ...evt };
    const opts = ctx?.simTime ? { timestamp: ctx.simTime } : {};
    try {
      if (pendingGap) {
        store.append({ application: 'forensic_layer', action: 'forensic.capture_gap', entity_type: 'evidence_store', payload: pendingGap }, opts);
        pendingGap = null;
      }
      return store.append(full, opts);
    } catch (err) {
      const note = { at: new Date().toISOString(), action: evt.action, entity_id: evt.entity_id ?? null, required, error: err.message };
      console.error('[forensic] event not captured:', JSON.stringify(note));
      try { fs.appendFileSync(failureLog, JSON.stringify(note) + '\n'); } catch { /* same disk may be failing */ }
      pendingGap = pendingGap ? { ...pendingGap, lost_events: pendingGap.lost_events + 1, last: note } : { lost_events: 1, first: note, last: note };
      if (required && failMode === 'closed') {
        throw err instanceof ForensicWriteError ? err : new ForensicWriteError(err.message, err);
      }
      return null;
    }
  }

  const jobRef = (ctx, job) => ({
    entity_type: 'job',
    entity_id: job ? String(job.id) : null,
    job_no: job?.job_no ?? null,
    correlation_id: ctx.correlation_id
  });

  const api = {
    store,
    failMode,

    /**
     * Start one traced operation. The actor is whatever the client claimed:
     * the synchroniser has no sessions, so it is never marked verified here.
     */
    begin(req, claimedActor, jobId) {
      const claimed = claimedActor || req?.headers?.['x-claimed-user'] || null;
      const sim = allowSimTime && req?.headers?.['x-forensic-sim-time'];
      return {
        operation_id: crypto.randomUUID(),
        correlation_id: jobId != null ? (corrByJobId.get(String(jobId)) ?? null) : crypto.randomUUID(),
        actor: { display_name: claimed, source: claimed ? 'client_claimed' : 'not_supplied', verified: false },
        client_ip: req?.ip ?? null,
        simTime: sim && !Number.isNaN(Date.parse(sim)) ? new Date(sim).toISOString() : null
      };
    },

    startup(startupInfo = {}) {
      const ctx = { operation_id: crypto.randomUUID(), actor: { display_name: 'System', source: 'system', verified: true } };
      write(ctx, {
        action: 'system.started', entity_type: 'system', entity_id: 'workflow_sync',
        payload: { ...startupInfo, generator, fail_mode: failMode, archive_outputs: archive, users: db.getAllUsers() }
      }, false);
      // Jobs that existed before instrumentation (or were written while capture was off) get a baseline.
      for (const job of db.getAllJobs()) {
        if (corrByJobId.has(String(job.id))) continue;
        const correlation_id = crypto.randomUUID();
        corrByJobId.set(String(job.id), correlation_id);
        write({ ...ctx, correlation_id }, {
          action: 'job.baseline_captured', ...jobRef({ correlation_id }, job),
          payload: { stored: jobState(job), state_hash: stateHash(job), operational_logs: job.logs, note: 'job existed without a captured creation event; earlier history is unknown' }
        }, false);
      }
    },

    // ---- jobs ------------------------------------------------------------
    jobCreated(ctx, job, suppliedInfo) {
      corrByJobId.set(String(job.id), ctx.correlation_id);
      const upload = suppliedInfo?.checklist_pdf_url ? uploads.get(path.basename(suppliedInfo.checklist_pdf_url)) : null;
      return write(ctx, {
        action: 'job.created', ...jobRef(ctx, job),
        payload: {
          supplied: suppliedInfo, stored: jobState(job), state_hash: stateHash(job),
          source_links: upload ? [{ upload_event_id: upload.event_id, parse_event_id: upload.parse_event_id ?? null, sha256: upload.sha256, link_basis: 'checklist_pdf_url submitted with the job' }] : [],
          client_ip: ctx.client_ip
        }
      }, true);
    },

    updateRequested(ctx, before, suppliedInfo) {
      return write(ctx, {
        action: 'job.update_requested', ...jobRef(ctx, before),
        payload: { before: jobState(before), before_state_hash: stateHash(before), supplied: suppliedInfo, client_ip: ctx.client_ip }
      }, true);
    },

    jobUpdated(ctx, before, after) {
      return write(ctx, {
        action: 'job.updated', ...jobRef(ctx, after),
        changes: diffJobs(before, after),
        payload: { after: jobState(after), state_hash: stateHash(after), before_state_hash: stateHash(before) }
      }, false);
    },

    deleteRequested(ctx, job) {
      return write(ctx, {
        action: 'job.delete_requested', ...jobRef(ctx, job),
        payload: { snapshot: jobState(job), state_hash: stateHash(job), operational_logs: job.logs, db_timestamps: { created_at: job.created_at, updated_at: job.updated_at }, client_ip: ctx.client_ip }
      }, true);
    },

    jobDeleted(ctx, job) {
      const evt = write(ctx, { action: 'job.deleted', ...jobRef(ctx, job), payload: { state_hash: stateHash(job) } }, false);
      corrByJobId.delete(String(job.id));
      return evt;
    },

    // ---- workflow steps and document checklist ---------------------------
    statusChangeRequested(ctx, kind, job, item, newStatus, extra = {}) {
      return write(ctx, {
        action: `${kind}.status_change_requested`, ...jobRef(ctx, job),
        payload: {
          item_id: item.id, item_name: item.name, old_status: item.status, requested_status: newStatus,
          previous_updated_by: item.updated_by ?? null, previous_updated_at: item.updated_at ?? null,
          job_status_before: job.status,
          closing_before: { bill_no: job.closing_bill_no, bill_amount: job.closing_bill_amount, sgst: job.closing_sgst, cgst: job.closing_cgst },
          ...extra, client_ip: ctx.client_ip
        }
      }, true);
    },

    statusChanged(ctx, kind, before, after, item) {
      const list = kind === 'workflow_step' ? 'workflow_steps' : 'documents';
      const changes = diffJobs(before, after);
      const evt = write(ctx, {
        action: `${kind}.status_changed`, ...jobRef(ctx, after),
        changes,
        payload: {
          item_id: item.id, item_name: item.name, list,
          job_status: after.status, state_hash: stateHash(after),
          closing: { bill_no: after.closing_bill_no, bill_amount: after.closing_bill_amount, sgst: after.closing_sgst, cgst: after.closing_cgst }
        }
      }, false);
      if (before.status !== after.status) {
        const action = after.status === 'Active' ? 'job.reopened' : after.status === 'Closed' ? 'job.closed' : 'job.completed';
        write(ctx, {
          action, ...jobRef(ctx, after),
          changes: changes.filter(c => c.field === 'status' || c.field.startsWith('closing_')),
          payload: { triggered_by_event_id: evt?.event_id ?? null, trigger_item: item.name, state_hash: stateHash(after) }
        }, false);
      }
      return evt;
    },

    // ---- document generation --------------------------------------------
    /** Wraps the compiler call. A request is never recorded as a generated document unless the files exist. */
    async generate(ctx, job, info, run) {
      const n = (genCount.get(ctx.correlation_id) || 0) + 1;
      genCount.set(ctx.correlation_id, n);
      const ref = { entity_type: 'job', entity_id: job ? String(job.id) : null, job_no: info?.job_no ?? job?.job_no ?? null, correlation_id: ctx.correlation_id, generation_number: n };
      const requested = write(ctx, {
        action: 'document.generation_requested', ...ref,
        payload: { input_sha256: sha256(canonical(info ?? null)), generator }
      }, false);
      let result;
      try {
        result = await run();
      } catch (err) {
        write(ctx, { action: 'document.generation_failed', ...ref, payload: { request_event_id: requested?.event_id ?? null, error: String(err.message).slice(0, 2000) } }, false);
        throw err;
      }
      const artifacts = [];
      for (const [role, url] of [['instruction_sheet', result?.bl_file], ['billing_invoice', result?.billing_file]]) {
        if (!url) continue;
        const file = path.join(downloadsDir, path.basename(url));
        try {
          const buf = fs.readFileSync(file);
          const digest = sha256(buf);
          const art = {
            role, path: url, sha256: digest, size: buf.length,
            content_fingerprint: xlsxContentFingerprint(buf),
            replaced_previous_sha256: lastOutput.has(url) && lastOutput.get(url) !== digest ? lastOutput.get(url) : null,
            archived: false
          };
          if (archive) {
            const dest = path.join(artifactsDir, digest + path.extname(file));
            if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
            art.archived = true;
          }
          lastOutput.set(url, digest);
          artifacts.push(art);
        } catch (err) {
          artifacts.push({ role, path: url, sha256: null, error: `output could not be read: ${err.message}` });
        }
      }
      write(ctx, {
        action: 'document.generated', ...ref, artifacts,
        payload: { request_event_id: requested?.event_id ?? null, input_sha256: requested?.payload.input_sha256 ?? sha256(canonical(info ?? null)), compiler_result: result }
      }, false);
      return result;
    },

    // ---- uploads ---------------------------------------------------------
    sourceUploaded(ctx, file) {
      const digest = sha256File(file.path);
      const evt = write(ctx, {
        action: 'source.uploaded', entity_type: 'upload', entity_id: file.filename,
        artifacts: [{ role: 'source_document', path: `/uploads/${file.filename}`, sha256: digest, size: file.size }],
        payload: { stored_name: file.filename, original_name: file.originalname, mimetype: file.mimetype, client_ip: ctx.client_ip }
      }, false);
      uploads.set(file.filename, { event_id: evt?.event_id ?? null, sha256: digest });
      return evt;
    },

    sourceParsed(ctx, file, parsed, error) {
      const up = uploads.get(file.filename);
      const evt = write(ctx, {
        action: error ? 'source.parse_failed' : 'source.parsed', entity_type: 'upload', entity_id: file.filename,
        payload: {
          stored_name: file.filename, upload_event_id: up?.event_id ?? null, source_sha256: up?.sha256 ?? null,
          ...(error ? { error: String(error.message).slice(0, 2000) } : { parsed, extraction_method: 'regex (pdf_parser.py); values are unverified extractions' })
        }
      }, false);
      if (up && evt && !error) up.parse_event_id = evt.event_id;
      return evt;
    },

    // ---- accounts --------------------------------------------------------
    login(req, username, user) {
      const ctx = api.begin(req, null);
      ctx.correlation_id = null;
      // A successful password check is the only point where the synchroniser verifies anyone.
      if (user) ctx.actor = { display_name: user.name, source: 'password_login', verified: true };
      return write(ctx, {
        action: user ? 'auth.login_succeeded' : 'auth.login_failed', entity_type: 'user', entity_id: String(username ?? ''),
        payload: { username: username ?? null, role: user?.role ?? null, client_ip: ctx.client_ip }
      }, false);
    },

    userChanged(req, action, username, details = {}) {
      const ctx = api.begin(req, req?.query?.adminUsername || req?.body?.adminUsername || req?.headers?.['x-admin-username']);
      ctx.correlation_id = null;
      return write(ctx, { action, entity_type: 'user', entity_id: String(username), payload: { ...details, client_ip: ctx.client_ip } }, true);
    }
  };
  return api;
}
