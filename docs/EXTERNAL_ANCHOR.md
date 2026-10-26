# External Anchor: Trust Boundary and Verification

## 1. What each layer protects against

| Reference | Where it lives | Detects | Does not detect |
|---|---|---|---|
| Hash chain (`events.jsonl`) | evidence folder | edit, deletion, reordering, duplication of individual records | someone who rewrites the whole file and recomputes every hash |
| Head anchor (`events.head.json`) | same folder | truncation of the tail | the same person rewriting it too |
| Anchor file (`FORENSIC_ANCHOR_FILE`) | any path | a full rewrite, **if** the path is out of the attacker's reach | anything, if the same account can write it (the test "rewrite that also rewrote the local anchor file" shows this) |
| `cli.js head` kept elsewhere + `verify --expect` | paper, e-mail, another system | rewrite of anything up to that point | records after it |
| **Remote witness** (`FORENSIC_ANCHOR_URL`, `src/anchor_server.js`) | another machine / account | full rewrite, deletion, reordering, truncation, a rewritten local anchor file, and any attempt to re-anchor a forged chain (kept as a conflict) | records written while the witness was unreachable and rewritten before it caught up; a compromise of the witness machine itself |

The trust boundary is the **witness host**. The remote witness adds protection only if a person who can
write the evidence folder cannot write the witness's data folder or run code on the witness host.

## 2. How the remote witness works

- After each append, the evidence store (in the synchroniser, the ingester and the dashboard) asks the
  witness for the highest sequence it holds and posts `{store_id, sequence, integrity_hash}` for every later record.
  No queue is kept locally: whatever the witness lacks is resent from the chain, so an outage or a restart catches up on the next append.
- Only sequence numbers and SHA-256 hashes leave the evidence host. No job data (T: test checks the witness file).
- The witness appends to `<dir>/<store_id>.jsonl`. It never changes an entry: a different hash for a
  sequence it already holds is answered with 409, and the attempt is kept as a `conflict` entry.
- Authentication: one bearer token (`FORENSIC_ANCHOR_TOKEN`, at least 24 characters), compared in constant time.
- Appends never fail because of the witness. Failures are counted (`anchorFailures`), logged, and
  `verify` reports `remote_anchor_unreachable` or `remote_unwitnessed_records`.

`cli.js verify` checks the witness when `FORENSIC_ANCHOR_URL` is set and fails (exit 2) on any problem.

## 3. Setting it up on a separate machine (procedure)

On the **witness machine** (not used by desk staff; ideally a different administrator):

1. Install Node.js 18 or later and copy `forensics/src/anchor_server.js` (no dependencies).
2. Create a folder that only the witness account can write, e.g. `D:\anchor-witness`.
3. Generate a token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. Start: `set FORENSIC_ANCHOR_TOKEN=<token>` then `node anchor_server.js --dir D:\anchor-witness --port 3200 --host 0.0.0.0`.
   Open TCP 3200 only to the evidence host in the firewall.
5. Run it as a service (Task Scheduler "at startup", or NSSM) under the witness account.

On the **evidence host** (where the synchroniser runs):

6. Set `FORENSIC_ANCHOR_URL=http://<witness-host>:3200/anchor`, `FORENSIC_ANCHOR_TOKEN=<token>`,
   `FORENSIC_ANCHOR_STORE_ID=<site name>` and restart the synchroniser.
7. Make one change in the UI, then run `node cli.js verify`. Expect `remote anchor: N record(s) witnessed` and `OK`.

Acceptance test (the step still **pending**, see §6):

8. On the evidence host, stop the synchroniser, copy the evidence folder aside, rewrite one record and
   recompute the chain (`test/anchor.remote.test.js`, function `rewrite`, shows how), and run
   `node cli.js verify`. Expect `anchor_mismatch` from the remote anchor and exit code 2.
9. Stop the witness, make two changes, run `verify` (expect `remote_anchor_unreachable`), start the
   witness, make one more change, run `verify` (expect `OK`).
10. Restore the original evidence folder.

## 4. Operations

- **Availability.** The witness is not on the critical path. While down, work continues and the gap is
  reported; records written in that window are protected by the local chain only until it returns.
- **Recovery.** Restart the witness with the same `--dir` and token; the next append fills the gap.
  If the witness data is lost, start an empty one: everything still in the chain is re-witnessed, but
  that is then only as good as the chain at that moment. Record the date as a gap in protection.
- **Key management.** One shared token per evidence host. Keep it in the service environment, not in
  files under git (`.env` is ignored). Rotate by restarting both sides with a new token; witnessed
  entries are not affected. The token lets its holder add entries, never change them; an attacker
  holding it can create conflicts but cannot hide a rewrite.
- **Retention.** The witness keeps every entry for as long as the evidence is kept. About 200 bytes
  per event. Back up the witness folder separately from the evidence host.
- **Transport.** Plain HTTP. On an untrusted network put it behind TLS (reverse proxy) or a VPN.
  Hashes are not confidential, but the token is.
- **Failure behaviour.** HTTP errors, time-outs (10 s) and refusals never fail an append. A 409 means the
  local chain no longer matches what was witnessed: treat it as an integrity incident.

## 5. What was tested (all on one machine)

| Test | Where | Result |
|---|---|---|
| Untouched chain verifies; witness holds hashes only | `test/anchor.remote.test.js` | pass |
| Full local rewrite after an altered event, a deleted event, reordered events, truncation | same | pass (local `verify` is fooled; remote detects each) |
| Rewrite that also rewrote the local anchor file | same | pass |
| Attacker with the token re-anchors a forged hash: 409, conflict reported | same | pass |
| Witness down, appends continue, gap reported, catch-up after restart | same | pass |
| Missing/wrong token, malformed input, short token refused | same | pass |
| Synchroniser (child process) sends to a witness in another process over HTTP; every record witnessed | `e2e/run_e2e.js` step 28 | pass |
| `cli.js verify` against a witness started as a separate OS process; wrong token reported; rewrite detected (exit 2) | manual run on 2026-10-26 | pass |

## 6. Not done

**The physical cross-machine test is pending.** Every test above ran on one Windows PC: the witness was
on 127.0.0.1 in a different process and folder, under the same user account. That shows the protocol and
detection logic. It does not show a separate trust domain, since that user could have rewritten the
witness folder too. Steps 1–10 of §3 on two machines, with the witness folder unwritable from the evidence
host, are still to be carried out and recorded.
