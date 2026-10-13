// Append-only, hash-chained forensic event store (JSON Lines).
//
// Guarantees (and their limits) are documented in docs/SECURITY_AND_LIMITATIONS.md.
// In short: verify() detects edits, deletions, reordering and truncation of
// existing records. It does NOT stop someone with file access from rewriting
// the whole file and recomputing the chain.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const SCHEMA_VERSION = '1.0';
export const GENESIS_HASH = '0'.repeat(64);

export class ForensicWriteError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ForensicWriteError';
    this.status = 503;
    this.cause = cause;
  }
}

/** Deterministic JSON: object keys sorted recursively, undefined dropped. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function hashRecord(record) {
  const { integrity_hash, ...rest } = record;
  return sha256(canonical(rest));
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const REQUIRED = ['application', 'action', 'entity_type'];

export class EventStore {
  /**
   * `anchorFile` (or FORENSIC_ANCHOR_FILE) is an external witness log: after every
   * append, {sequence, integrity_hash} is also appended there. It only adds protection
   * if it lives where someone able to rewrite the evidence folder cannot write, e.g.
   * another machine's share, another account's folder, or write-once media.
   */
  constructor(dir, { lockTimeoutMs = 5000, staleLockMs = 30000, anchorFile = process.env.FORENSIC_ANCHOR_FILE || null } = {}) {
    this.dir = dir;
    this.anchorFile = anchorFile;
    this.anchorFailures = 0;
    this.file = path.join(dir, 'events.jsonl');
    this.headFile = path.join(dir, 'events.head.json');
    this.lockFile = path.join(dir, 'events.lock');
    this.lockTimeoutMs = lockTimeoutMs;
    this.staleLockMs = staleLockMs;
    this._tail = null; // { size, sequence, hash }
    fs.mkdirSync(dir, { recursive: true });
  }

  _lock() {
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        return fs.openSync(this.lockFile, 'wx');
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        try {
          if (Date.now() - fs.statSync(this.lockFile).mtimeMs > this.staleLockMs) fs.unlinkSync(this.lockFile);
        } catch { /* lock vanished between calls */ }
        if (Date.now() > deadline) throw new Error('timed out waiting for evidence store lock');
        sleepMs(15);
      }
    }
  }

  _unlock(fd) {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.unlinkSync(this.lockFile); } catch { /* ignore */ }
  }

  // Finds the last valid record so the next one can chain to it. Another
  // process may have appended since our last write, so the cache is keyed on file size.
  // ponytail: full re-read when the cache misses; read backwards from EOF if the file gets large.
  _loadTail() {
    const size = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
    if (this._tail && this._tail.size === size) return this._tail;
    let sequence = 0, hash = GENESIS_HASH, needsNewline = false;
    if (size > 0) {
      const text = fs.readFileSync(this.file, 'utf8');
      needsNewline = !text.endsWith('\n'); // incomplete final record (crash mid-write)
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line);
          if (Number.isInteger(r.sequence) && typeof r.integrity_hash === 'string') {
            sequence = r.sequence;
            hash = r.integrity_hash;
          }
        } catch { /* malformed line: verify() reports it; chain continues from last valid */ }
      }
    }
    this._tail = { size, sequence, hash, needsNewline };
    return this._tail;
  }

  /**
   * Append one event. `evt` supplies the descriptive fields; the store assigns
   * event_id, sequence, server_timestamp and the hash links.
   * `opts.timestamp` overrides the clock (synthetic data only) and is marked as such.
   */
  append(evt, opts = {}) {
    for (const k of REQUIRED) {
      if (!evt || typeof evt[k] !== 'string' || !evt[k]) throw new ForensicWriteError(`event missing required field "${k}"`);
    }
    let fd;
    try {
      fd = this._lock();
      const tail = this._loadTail();
      const record = {
        schema_version: SCHEMA_VERSION,
        sequence: tail.sequence + 1,
        event_id: crypto.randomUUID(),
        server_timestamp: opts.timestamp || new Date().toISOString(),
        clock_source: opts.timestamp ? 'simulated' : 'system',
        application: evt.application,
        action: evt.action,
        entity_type: evt.entity_type,
        entity_id: evt.entity_id ?? null,
        job_no: evt.job_no ?? null,
        correlation_id: evt.correlation_id ?? null,
        operation_id: evt.operation_id ?? null,
        actor: evt.actor ?? { display_name: null, source: 'not_supplied', verified: false },
        changes: evt.changes ?? [],
        artifacts: evt.artifacts ?? [],
        generation_number: evt.generation_number ?? null,
        payload: evt.payload ?? {},
        previous_event_hash: tail.hash
      };
      record.integrity_hash = hashRecord(record);
      const line = (tail.needsNewline ? '\n' : '') + JSON.stringify(record) + '\n';
      const out = fs.openSync(this.file, 'a');
      try {
        fs.writeSync(out, line);
        fs.fsyncSync(out);
      } finally {
        fs.closeSync(out);
      }
      this._tail = {
        size: tail.size + Buffer.byteLength(line),
        sequence: record.sequence,
        hash: record.integrity_hash,
        needsNewline: false
      };
      // The record is durable from here on. Nothing below may turn this append into a reported failure.
      this._writeHead(record);
      this._witness(record);
      return record;
    } catch (err) {
      this._tail = null;
      if (err instanceof ForensicWriteError) throw err;
      throw new ForensicWriteError(`forensic event could not be written: ${err.message}`, err);
    } finally {
      if (fd !== undefined) this._unlock(fd);
    }
  }

  // Sidecar anchor: lets verify() notice that records were cut off the end.
  // On Windows the rename is occasionally refused (EPERM) while another program
  // has the file open, so it is retried, then written in place. If it still
  // fails the anchor is merely stale: verify() reports head_stale and the next
  // append repairs it.
  _writeHead(record) {
    const body = JSON.stringify({ sequence: record.sequence, integrity_hash: record.integrity_hash, written_at: record.server_timestamp });
    const tmp = this.headFile + '.tmp';
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.writeFileSync(tmp, body);
        fs.renameSync(tmp, this.headFile);
        return true;
      } catch {
        sleepMs(10 * (attempt + 1));
      }
    }
    try {
      fs.writeFileSync(this.headFile, body);
      return true;
    } catch (err) {
      console.error('[forensic] head anchor not updated:', err.message);
      return false;
    }
  }

  // External witness. Failure never fails the append (the record is already durable) but is
  // counted and reported, and verify() lists the records the witness did not see.
  _witness(record) {
    if (!this.anchorFile) return true;
    try {
      fs.mkdirSync(path.dirname(this.anchorFile), { recursive: true });
      fs.appendFileSync(this.anchorFile, JSON.stringify({ sequence: record.sequence, integrity_hash: record.integrity_hash, witnessed_at: new Date().toISOString() }) + '\n');
      return true;
    } catch (err) {
      this.anchorFailures++;
      console.error('[forensic] external anchor not updated:', err.message);
      return false;
    }
  }

  /** Read every line. Malformed lines are returned as problems, never dropped silently. */
  readAll() {
    const records = [], problems = [];
    if (!fs.existsSync(this.file)) return { records, problems, endsWithNewline: true };
    const text = fs.readFileSync(this.file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      try {
        records.push({ line: i + 1, record: JSON.parse(line) });
      } catch {
        problems.push({ type: 'malformed_record', line: i + 1, detail: 'line is not valid JSON' });
      }
    });
    return { records, problems, endsWithNewline: text === '' || text.endsWith('\n') };
  }

  /**
   * Verify the whole chain, start to end.
   * `expect` = { sequence, integrity_hash } recorded somewhere else (paper, another system):
   * the chain must contain exactly that record.
   */
  verify({ anchorFile = this.anchorFile, expect = null } = {}) {
    const { records, problems, endsWithNewline } = this.readAll();
    if (!endsWithNewline) problems.push({ type: 'incomplete_final_record', detail: 'file does not end with a newline; last write may have been interrupted' });
    let prevSeq = 0, prevHash = GENESIS_HASH;
    const seen = new Set();
    for (const { line, record: r } of records) {
      const at = { line, sequence: r.sequence, event_id: r.event_id };
      if (r.schema_version !== SCHEMA_VERSION) problems.push({ type: 'unknown_schema_version', ...at, detail: String(r.schema_version) });
      if (hashRecord(r) !== r.integrity_hash) problems.push({ type: 'content_modified', ...at, detail: 'integrity_hash does not match record contents' });
      if (r.sequence !== prevSeq + 1) {
        problems.push({
          type: r.sequence > prevSeq + 1 ? 'sequence_gap' : 'sequence_out_of_order', ...at,
          detail: `expected sequence ${prevSeq + 1}, found ${r.sequence}`
        });
      }
      if (r.previous_event_hash !== prevHash) problems.push({ type: 'broken_hash_link', ...at, detail: 'previous_event_hash does not match the preceding record' });
      if (seen.has(r.event_id)) problems.push({ type: 'duplicate_event_id', ...at });
      seen.add(r.event_id);
      if (Number.isNaN(Date.parse(r.server_timestamp))) problems.push({ type: 'invalid_timestamp', ...at });
      // Resynchronise on what is actually in the file so one fault is not reported on every later line.
      if (Number.isInteger(r.sequence)) prevSeq = r.sequence;
      prevHash = r.integrity_hash;
    }
    let head = null;
    if (fs.existsSync(this.headFile)) {
      try {
        head = JSON.parse(fs.readFileSync(this.headFile, 'utf8'));
        if (head.sequence > prevSeq) problems.push({ type: 'truncated', detail: `head anchor records sequence ${head.sequence} but the file ends at ${prevSeq}` });
        else if (head.sequence === prevSeq && head.integrity_hash !== prevHash) problems.push({ type: 'head_mismatch', detail: 'last record hash differs from the head anchor' });
        else if (head.sequence < prevSeq) problems.push({ type: 'head_stale', detail: 'file has more records than the head anchor (anchor write was interrupted, or records were appended outside the store)' });
      } catch {
        problems.push({ type: 'head_unreadable', detail: 'events.head.json is not valid JSON' });
      }
    } else if (records.length) {
      problems.push({ type: 'head_missing', detail: 'events.head.json not found; truncation cannot be detected' });
    }
    // External evidence that the chain is the one that was originally written.
    const bySeq = new Map(records.map(x => [x.record.sequence, x.record.integrity_hash]));
    const checkWitness = (w, origin) => {
      if (!bySeq.has(w.sequence)) problems.push({ type: 'anchored_record_missing', sequence: w.sequence, detail: `${origin} records sequence ${w.sequence}, which is not in the chain` });
      else if (bySeq.get(w.sequence) !== w.integrity_hash) problems.push({ type: 'anchor_mismatch', sequence: w.sequence, detail: `${origin} holds a different hash for sequence ${w.sequence}: the chain was rewritten after it was witnessed` });
    };
    let anchor = { configured: !!anchorFile, witnessed: 0, last_witnessed_sequence: null };
    if (anchorFile) {
      if (!fs.existsSync(anchorFile)) {
        if (records.length) problems.push({ type: 'anchor_missing', detail: 'external anchor file is configured but does not exist' });
      } else {
        for (const line of fs.readFileSync(anchorFile, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            const w = JSON.parse(line);
            checkWitness(w, 'external anchor');
            anchor.witnessed++;
            anchor.last_witnessed_sequence = Math.max(anchor.last_witnessed_sequence ?? 0, w.sequence);
          } catch {
            problems.push({ type: 'anchor_unreadable', detail: 'a line of the external anchor is not valid JSON' });
          }
        }
        if (anchor.witnessed < records.length) problems.push({ type: 'unwitnessed_records', detail: `${records.length - anchor.witnessed} record(s) have no entry in the external anchor; they are protected by the local chain only` });
      }
    }
    if (expect) checkWitness(expect, 'expected head');
    return { ok: problems.length === 0, count: records.length, last_sequence: prevSeq, last_hash: prevHash, head, anchor, problems };
  }

  /** Filter events. All criteria are optional and combined with AND. */
  query({ application, action, entity_type, entity_id, correlation_id, operation_id, job_no, from, to } = {}) {
    const match = (v, want) => want === undefined || (Array.isArray(want) ? want.includes(v) : v === want);
    return this.readAll().records.map(x => x.record).filter(r =>
      match(r.application, application) && match(r.action, action) && match(r.entity_type, entity_type) &&
      match(r.entity_id, entity_id === undefined ? undefined : String(entity_id)) &&
      match(r.correlation_id, correlation_id) && match(r.operation_id, operation_id) && match(r.job_no, job_no) &&
      (!from || r.server_timestamp >= from) && (!to || r.server_timestamp <= to));
  }
}
