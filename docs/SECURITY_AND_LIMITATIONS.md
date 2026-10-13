# Security, Threat Model and Forensic Limitations

**Status:** an academic prototype of a forensic analytics framework. It has not been validated for legal admissibility or chain-of-custody compliance and makes no such claim.

Labels: **T** = covered by an automated test; **D** = by design, untested; **N** = not provided.

## 1. Threat model

| Actor | Capability | Outcome |
|---|---|---|
| Unauthenticated user on the LAN | Sends HTTP requests to the synchroniser | Refused with 401 on every `/api` route except login; refused writes are recorded (T) |
| Signed-in desk user | Uses the API directly, naming another user in the request | The session identity is recorded as actor and stored in the operational record; the other name is kept as a claim and raised as finding ACT-001 (T) |
| Signed-in desk user | Claims admin through `adminUsername` | Refused with 403; recorded (T) |
| Signed-in user | Edits, closes, reopens, deletes jobs through the application | Allowed (the application permits it). Old state, snapshot and actor preserved; rules and contradiction analysis may flag it (T) |
| Anyone with the seeded passwords | Signs in as that account | **Not prevented.** Seeded accounts use the username as password |
| Someone who shares a signed-in browser | Acts as that user | Not distinguishable |
| User with write access to `db.json` | Edits data behind the API | No event is produced. `cli.js reconcile` reports the state difference afterwards; it cannot say who (T) |
| User with write access to the evidence folder | Edits one record | Detected by `verify` (T) |
| Same | Rewrites the whole chain and the head anchor consistently | **Not detected by the local chain** (T: the test demonstrates it passes). Detected if an external anchor or an externally kept head exists and is out of that user's reach (T) |
| Same | Deletes the evidence folder | Evidence is gone. Backups are the only defence (N) |
| User who can restart the server with different settings | Starts with `FORENSIC_DISABLED=1` or `SYNC_AUTH=off` | Capture stops, or actors become unverified. A later `system.started` event shows the settings in force; the gap itself is silent |
| User of a desktop tool | Edits or deletes outbox lines before ingestion | Not detected (N). Recorded on every ingested event as `integrity_before_ingest: none` |
| Author of a source document | Supplies a false document | Not detected. Hash proves which file was uploaded, not that it is true |

## 2. Authentication and attribution

Implemented in `Workflow syncroniser/server.js`.

- Server-side sessions: 256-bit random token, `HttpOnly; SameSite=Strict` cookie or bearer header, held in memory, 12-hour idle expiry, ended by logout or restart.
- Identity and role come from the session. `creator`, `user`, `adminUsername` and `X-Claimed-User` are ignored for authorisation and for the operational record.
- Evidence records `actor = { display_name, username, role, source: "session", verified: true }`, plus `claimed_display_name` when the request named someone else.
- `auth.login_succeeded`, `auth.login_failed`, `auth.logout`, `auth.request_rejected` are recorded. Passwords, password hashes and session tokens are not (T).

**What "verified" means:** the request carried a session created by a successful password check for that account. It does not mean the person at the keyboard is that person.

Remaining weaknesses:
- Seeded passwords equal usernames, and there is no password-change screen. Not changed: it needs a decision and a UI.
- No login throttling or lockout.
- No HTTPS. The cookie is not `Secure`; on the LAN it can be read by anyone who can sniff traffic.
- CORS is open (`cors()` with defaults). Cross-origin pages cannot send the cookie (no credentials, `SameSite=Strict`), but should be restricted anyway.
- Authorisation is two-level only (signed in / Admin). Any signed-in user may edit or delete any job, as the original UI allowed. Whether deletion should be admin-only is a business decision that was not made here.
- `SYNC_AUTH=off` exists for compatibility. With it, everything in the first row of §1 is possible again.

Desktop tools record the Windows account name as an unverified claim. They have no login.

## 3. Evidence integrity

| Property | Status |
|---|---|
| Append-only writes with `fsync` | D |
| Edited record detected | T |
| Edited and re-hashed record detected through the next link | T |
| Deleted, reordered, duplicated lines detected | T |
| Truncated tail detected through the head anchor | T |
| Altered or unreadable head anchor detected | T |
| Torn write (end or middle of file) detected; later appends remain valid | T |
| Concurrent writers from several processes keep one chain | T |
| Whole chain verified, not only the last record | T |
| Head-anchor write failure does not turn a written record into a reported failure | T |
| Full rewrite of chain and head anchor | **Not detected locally** (T) |
| Full rewrite detected with `FORENSIC_ANCHOR_FILE` or `verify --expect` | T |
| Records not seen by the external anchor are listed | T |
| Anchor unreachable: appends continue, failure counted and reported | T |

**The local hash chain is tamper-evident against partial edits. It is not tamper-proof and does not protect against someone who can rewrite the folder.** The external anchor moves that boundary to "someone who can rewrite both places". It is a plain witness log, not itself chained, and offers nothing if it is stored where the same user can write. No trusted timestamping service is used.

Other limits:
- Timestamps come from the host clock; desktop-tool times from another, unsynchronised clock. Both are kept and labelled.
- Evidence can be withheld (capture disabled, API bypassed). Reconciliation shows resulting state differences only.

## 4. What integrity does not give you

Four different properties, reported separately on every case (`provenance.trust`):

| Property | Provided |
|---|---|
| Integrity of captured records | Yes, within §3 |
| Authenticity of the original source | No |
| Accuracy of the original information | No |
| Independence of corroborating records | Counted from lineage; "separately recorded inside one organisation" at best |

A value that was false when first entered, and copied consistently afterwards, passes every integrity check and raises no finding. The system states that such a value rests on one source and needs an independent authority. See PROVENANCE_AND_CONTRADICTIONS.md §8.

## 5. Sensitive data

- Events hold complete job records: company names, addresses, bank-detail text, charges, client IP addresses. Treat `forensics/data/` like `db.json`.
- Not stored: passwords, hashes, session tokens (T), uploaded file contents (hash and metadata only).
- `artifacts/` holds full copies of generated workbooks. `FORENSIC_ARCHIVE=0` keeps hashes only.
- No retention or deletion policy exists. Append-only evidence and erasure requests conflict; decide before real use.
- `forensics/data/` and `forensics/datasets/` are git-ignored.

### Possible real data already in the repository

Template and sample files under `B,I,I,L/Templates/`, `Workflow syncroniser/Templates/`, `Workflow syncroniser/air/`, and defaults hard-coded in `unified_generator.py` and the EasyQuote programs, carry what look like real company names, addresses, container numbers and tariffs. This work did not open the sample checklists, invoices or client-specific templates; used only the generic templates as layout; generated every synthetic value; and ran B.I.I.L. and the WPF programs with their built-in defaults, writing only to temporary folders. These files are now in **local** git history. Whether they may be used or published is for their owner to say.

## 6. Dashboard

- Binds to `127.0.0.1`. No login: anyone on that machine can read every case.
- Recording an assessment needs `FORENSIC_REVIEW_TOKEN` (constant-time comparison); the reviewer name is free text.
- Evidence text is rendered with `textContent` only; no `innerHTML`; a Content-Security-Policy header is sent (T, with markup in a job number).
- The synchroniser's own UI still builds HTML from stored values. Not changed.

## 7. Failure handling

See RUNTIME_SETUP.md §5 for the operational procedure.

| Situation | Behaviour |
|---|---|
| Evidence store unwritable | Destructive operations refused with 503 (default); logged; `forensic.capture_gap` on recovery (T) |
| Process dies between the request event and the database write | Reported as `operation_incomplete`; `reconcile` shows whether state changed (T for detection) |
| Process dies between the database write and the completion event | Old state preserved; `reconcile` reports the difference |
| `db.js` fails to write `db.json` | It swallows the error (existing behaviour); `reconcile` reports the mismatch |
| Ingestion fails part-way | Error surfaced; records already ingested stay; re-run completes without duplicates (T) |
| Outbox line incomplete | Rejected with a reason; ingested once complete (T) |
| Lock left by a dead process | Stale after 30 s |
| Head anchor or external anchor cannot be written | Append still succeeds; reported; repaired or listed as unwitnessed (T) |

## 8. Reconstruction limits

- A job's captured timeline, all before/after values, generation attempts and deleted jobs are reconstructable from evidence alone (T).
- Full replay into a byte-identical `db.json` is not implemented.
- Jobs existing before capture have a baseline only.
- Timeline order follows event time. Entries timed by different clocks within ten minutes of each other are marked as uncertain rather than ordered silently.
- An event absent from the store was not captured. That is not evidence that it did not happen.
