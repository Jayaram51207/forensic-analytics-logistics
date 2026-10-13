# Security, Privacy and Forensic Limitations

**Status of this system:** an academic prototype of a forensic analytics framework. It has not been validated for legal admissibility or chain-of-custody compliance and makes no such claim.

## 1. What the evidence store guarantees

| Property | Provided | How | Tested |
|---|---|---|---|
| Records are appended, not rewritten | yes | File opened in append mode, `fsync` per event | store tests |
| Editing a record is detectable | yes | `integrity_hash` over canonical content | "modified event contents" |
| Editing a record and fixing its own hash is detectable | yes | Next record's `previous_event_hash` no longer matches | "hash was recomputed" |
| Deleting or reordering lines is detectable | yes | Sequence and hash links | "deleted line", "reordered" |
| Cutting records off the end is detectable | partly | `events.head.json` anchor | "truncation" |
| Torn final write is detectable and survivable | yes | Newline check; next append starts a new line | "incomplete final record" |
| Concurrent writers do not corrupt the chain | yes | Exclusive lock file, tail re-read under lock | 4 processes × 25 events |
| Verification covers the whole chain | yes | `verify()` walks every record | "last record is valid" |

## 2. What it does not guarantee

- **Not immutable.** Someone who can write to the evidence folder can rewrite the whole file, recompute every hash, and update the head anchor. Verification will pass. Detecting that needs something outside the folder: a copy of the head hash kept elsewhere, write-once storage, or an external timestamping service. None is implemented.
- **Head anchor is weak.** It sits beside the file it protects.
- **Evidence can be withheld.** `FORENSIC_DISABLED=1` or a bypass of the API (editing `db.json` directly) produces no events. `cli.js reconcile` detects the resulting state differences after the fact; it cannot say who made them.
- **Outbox files have no protection** until ingested.
- **Timestamps are the host's clock.** No trusted time source. Desktop-tool times come from a different, unsynchronised clock and are stored separately.

## 3. Actor identity

The synchroniser has no sessions. `user`, `creator` and `X-Claimed-User` are whatever the caller sends; `requireAdmin` accepts a caller-supplied string. Confirmed by runtime test.

Consequences:
- Every actor on a synchroniser write is recorded with `source: client_claimed, verified: false`.
- Attribution in a case is a lead for an investigator, not proof.
- Seeded accounts use the username as the password; this was not changed.

Server-side sessions were **not** added. It is a larger change to the operational application than the capture hooks and belongs in a separate, reviewed piece of work. Until then no finding should be read as identifying a person.

## 4. Sensitive data

- Events contain complete job records: company names, addresses, bank-detail text fields, charges. The evidence folder is as sensitive as `db.json` and must be access-controlled the same way.
- Not recorded: passwords, password hashes (asserted by test), uploaded file contents (hash and metadata only; the file stays in `uploads/`).
- Archived output workbooks (`artifacts/`) are full copies of generated documents. `FORENSIC_ARCHIVE=0` keeps hashes only, at the cost of not being able to show an overwritten file's content.
- Client IP addresses are recorded on write events.
- **No retention or deletion policy exists.** Append-only storage and data-erasure requests are in tension; this needs a decision before any real deployment.
- `forensics/data/` is listed in `.gitignore`.

### Possible real data already in the repository

Template and sample files under `B,I,I,L/Templates/`, `Workflow syncroniser/Templates/` and `Workflow syncroniser/air/`, and default values hard-coded in `unified_generator.py` and the EasyQuote programs, carry what look like real company names, addresses, container numbers and tariffs. This work:
- did not open the sample checklists, invoices or client-specific templates;
- used only the generic templates (`BL INSTRUCTION CPS 001_template.xlsx`, `Billing_Invoice.xlsx`) as layout for generated test output;
- generated all synthetic shippers, consignees, numbers and checklist PDFs from invented values;
- ran B.I.I.L. once with its built-in defaults, writing only to a temporary folder.

Whether those materials may be used or published is a question for their owner and is still open.

## 5. Dashboard

- Binds to `127.0.0.1` only. No login: anyone on the machine can read every case. Put it behind real authentication before exposing it.
- Recording a disposition requires `FORENSIC_REVIEW_TOKEN` (constant-time comparison). The reviewer name is free text.
- All evidence text is rendered with `textContent`; the page contains no `innerHTML`. A Content-Security-Policy header is sent. Tested with a job number containing markup.
- The synchroniser's own UI still renders stored values through `innerHTML`; that was not changed.

## 6. Failure and recovery

| Situation | Behaviour |
|---|---|
| Evidence store unwritable | Destructive operations refused with 503 (default); failure logged to stderr and `capture_failures.log`; a `forensic.capture_gap` event is added on recovery |
| Process dies between the `…_requested` event and the database write | The request event exists without completion; reported as `operation_incomplete`. The state may or may not have changed; `reconcile` shows which |
| Process dies between the database write and the completion event | Old state is preserved; `reconcile` reports the state difference |
| `db.js` fails to write `db.json` | It swallows the error (existing behaviour). Evidence then says a change happened that the file does not show; `reconcile` reports it |
| Lock file left by a dead process | Treated as stale after 30 s |

No backup procedure is implemented. Copy the evidence folder (`events.jsonl`, `events.head.json`, `artifacts/`) regularly, and store the latest head hash somewhere the application host cannot write.

## 7. What reconstruction can and cannot do

- A job's captured timeline, every before/after value, generation attempts, and deleted jobs are reconstructable from evidence alone (tested).
- The current state of every job is tracked through `state_hash`, and reconciliation compares it with `db.json` (tested, including tampering).
- A full replay that rebuilds `db.json` byte-for-byte is **not** implemented: row ids, operational log text and timestamps are not regenerated.
- Jobs that existed before capture began have a baseline only; their earlier history is unknown and is labelled as such.
- An event absent from the store was not captured. That is not evidence that it did not happen.
