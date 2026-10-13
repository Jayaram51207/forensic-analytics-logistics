# Forensic Event Schema (version 1.0)

One event is one line of JSON in `events.jsonl`. Defined in `forensics/src/store.js` (`EventStore.append`).

## 1. Record fields

| Field | Type | Set by | Meaning |
|---|---|---|---|
| `schema_version` | string | store | `"1.0"` |
| `sequence` | integer | store | 1-based, gap-free position in the chain |
| `event_id` | UUID | store | Unique id |
| `server_timestamp` | ISO-8601 UTC, ms | store | When the store appended the event |
| `clock_source` | `system` \| `simulated` | store | `simulated` only for synthetic data and replayed outbox times |
| `application` | string | emitter | `workflow_sync`, `visualizer_3d`, `biil_unified`, `easyquote_export`, `easyquote_import`, `stuffing_report`, `forensic_layer` |
| `action` | string | emitter | See catalogue |
| `entity_type` | string | emitter | `job`, `upload`, `user`, `system`, `case`, `packing_run`, `packing_report`, `document_batch`, `quotation`, `stuffing_report`, `evidence_store` |
| `entity_id` | string \| null | emitter | Database id, upload file name, username, case id, or source event id |
| `job_no` | string \| null | emitter | The job number as typed, synchroniser events only |
| `correlation_id` | UUID \| null | capture layer | One per job lifecycle. **Created by the forensic layer**; it is not an identifier the applications share |
| `operation_id` | UUID \| null | capture layer | Groups the events of one request (request → generation → completion) |
| `actor` | object | emitter | `{ display_name, source, verified }` |
| `changes` | array | emitter | `[{ field, old, new }]` |
| `artifacts` | array | emitter | `[{ role, path, sha256, size, content_fingerprint?, replaced_previous_sha256?, archived? }]` |
| `generation_number` | integer \| null | capture layer | Attempt counter per `correlation_id` |
| `payload` | object | emitter | Event-specific data |
| `previous_event_hash` | hex | store | `integrity_hash` of the preceding record; 64 zeros for the first |
| `integrity_hash` | hex | store | SHA-256 of the canonical JSON of every other field |

Canonical JSON: keys sorted recursively, `undefined` dropped, no whitespace (`canonical()`).

### Mapping from the originally proposed fields

| Proposed | Where it is |
|---|---|
| `actor_display_name`, `actor_source`, `actor_verified` | `actor.display_name`, `actor.source`, `actor.verified` |
| `field_changed`, `old_value`, `new_value` | One entry per changed field in `changes[]`; an edit touching five fields is one event, not five |
| `source_file_hash`, `output_hash` | `artifacts[].sha256` with `role` (`source_document`, `instruction_sheet`, `billing_invoice`, …) |
| `metadata` | `payload` |

### Actor trust levels

| `source` | `verified` | Meaning |
|---|---|---|
| `session` | true | The signed-in account of the request (default mode). The actor object also carries `username` and `role`, and `claimed_display_name` when the request body named someone else |
| `client_claimed` | false | Only with `SYNC_AUTH=off`: a name sent by the client, unchecked |
| `password_login` | true | Only on `auth.login_succeeded`: the password check passed for that request |
| `os_account_claimed` | false | Windows account name read by a desktop tool |
| `review_token` | true | Dashboard reviewer who presented `FORENSIC_REVIEW_TOKEN`; the name typed is still free text |
| `system` | true | Emitted by the application itself at start-up |
| `not_supplied` | false | No actor information was available |

### Three kinds of time

- `server_timestamp`: evidence time, assigned by the store.
- Business dates (`invoice_no_date`, `sb_no_date`, `eta`, EasyQuote `date_text`): typed text inside `payload`/`changes`, never used as event time.
- Source time: `payload.source.occurred_at` on ingested outbox events (the desktop machine's clock), and database `created_at`/`updated_at` copied into deletion snapshots.

## 2. Event catalogue

Ordering is by `sequence`. "Required" means the operation is refused (HTTP 503) if the event cannot be written, in the default fail-closed mode.

### Workflow Synchroniser (`application: workflow_sync`)

| Action | Source | Entity | Evidence captured | Required | Tests |
|---|---|---|---|---|---|
| `system.started` | start-up, `server.js` | system | db path, whether migrations ran, account list (no hashes), SHA-256 of `compiler.py` and `pdf_parser.py`, fail mode | no | sync: restart test |
| `job.baseline_captured` | start-up | job | Full state of any job with no earlier evidence, plus its operational log | no | sync: restart test |
| `job.created` | `POST /api/jobs` | job | `supplied` (what the client sent), `stored` (what the database holds), `state_hash`, link to an upload if a checklist URL was submitted | **yes** (insert rolled back on failure) | sync: lifecycle, fail-closed |
| `job.update_requested` | `PUT /api/jobs/:id`, before anything changes | job | `before` state, `supplied` data | **yes** | sync: lifecycle, fail-closed |
| `job.updated` | after `updateJob` | job | `changes[]`, `after` state, `state_hash` | no | sync: lifecycle |
| `workflow_step.status_change_requested` | `PUT …/workflow/:stepId`, before the write | job | old status, requested status, previous updater, job status, closing fields before, closing details supplied | **yes** | sync: lifecycle, fail-closed |
| `workflow_step.status_changed` | after `toggleWorkflowStep` | job | `changes[]` (step status, job status, closing fields) | no | sync: lifecycle |
| `document.status_change_requested` / `document.status_changed` | `PUT …/documents/:docId` | job | as for steps | **yes** / no | covered by shared code path |
| `job.closed` / `job.completed` / `job.reopened` | derived when a status change alters the job status | job | status and closing-field changes; `triggered_by_event_id` | no | sync: lifecycle |
| `job.delete_requested` | `DELETE /api/jobs/:id`, before deletion | job | Full `snapshot`, the operational `history_logs` rows, database timestamps | **yes** | sync: lifecycle, fail-closed |
| `job.deleted` | after `deleteJob` | job | `state_hash` | no | sync: lifecycle |
| `document.generation_requested` | before `compiler.py compile` | job | `input_sha256`, generator hashes, `generation_number` | no | sync: generation |
| `document.generated` | compiler succeeded **and** output files were read | job | Per file: path, SHA-256, size, content fingerprint, hash of the copy it replaced, archive flag | no | sync: generation |
| `document.generation_failed` | compiler failed | job | Error text (first 2000 characters), link to the request | no | sync: failed generation |
| `source.uploaded` | `POST /api/parse-checklist` | upload | SHA-256, size, original and stored names | no | sync: upload |
| `source.parsed` / `source.parse_failed` | same request | upload | Parsed values marked as unverified regex extraction, or the error | no | sync: upload; scenarios |
| `auth.login_succeeded` / `auth.login_failed` | `POST /api/login` | user | username, role, client IP. Never the password or the session token | no | sync: login |
| `auth.logout` | `POST /api/logout` | user | account, client IP | no | auth: forged or expired tokens |
| `auth.request_rejected` | session middleware (non-GET without a session), `requireAdmin` (any method without the Admin role) | request | method, path, reason, client IP, session actor if any | no | auth: unauthenticated, admin privileges |
| `user.created` / `user.delete_requested` / `user.deleted` | `/api/users` | user | name and role; claimed admin name | **yes** | sync: login |

A generation request is never reported as a generated document: `document.generated` is written only after the files have been opened and hashed.

### Forensic layer (`application: forensic_layer`)

| Action | Meaning |
|---|---|
| `forensic.capture_gap` | Written on the first successful append after one or more failed writes: number of lost events, first and last failure |
| `case.disposition_recorded` | Reviewer assessment of a case; entity is the case id |

### Desktop tools (ingested from outbox files)

| Application | Action | Evidence |
|---|---|---|
| `visualizer_3d` | `packing.run_completed` | Container, manifest, placed/unplaced counts, reason codes, utilisation, typed shipment reference |
| `visualizer_3d` | `packing.report_saved` | Saved PDF path and SHA-256 |
| `biil_unified` | `document.batch_generated` | Form fields, containers, charges with tax rates, totals, source and output files by hash |
| `easyquote_export`, `easyquote_import` | `quotation.exported` | Format, header fields, each row's values, defaults and whether they differ; file hash for file exports |
| `stuffing_report` | `stuffing_report.exported` | Rows, container numbers found in the text, file hash |

Every ingested event carries `payload.source = { source_event_id, occurred_at, clock, outbox, integrity_before_ingest: "none" }`.

## 3. External anchor

When `FORENSIC_ANCHOR_FILE` is set, each append also writes `{ sequence, integrity_hash, witnessed_at }` to that file. It is not part of the schema and is not chained; its value comes only from being stored where the evidence folder's users cannot write. `verify()` reports `anchor_mismatch`, `anchored_record_missing`, `unwitnessed_records`, `anchor_missing`.

## 4. Derived model (not stored)

Evidence items, lineage roots, corroboration and contradictions are computed from events at analysis time by `src/provenance.js`; see PROVENANCE_AND_CONTRADICTIONS.md. They are never written back as if they were source evidence.

## 5. What the schema does not record

- Field edits inside the desktop tools between exports.
- Anything typed into the synchroniser's form but not submitted.
- Who was physically at the keyboard. `verified: true` means the request carried a session created by a password check.
- The content of overwritten output files, unless archiving is on (default on; `FORENSIC_ARCHIVE=0` keeps hashes only).
