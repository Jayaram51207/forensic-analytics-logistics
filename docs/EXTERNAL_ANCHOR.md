# External Anchor: Trust Boundary and Verification

**Status (2026-10-27): the physical two-machine test has NOT been run.** All tests so far ran on one Windows PC: the witness listened on 127.0.0.1, in another process and another folder, under the same user account. They show the protocol and the detection logic, not a separate trust domain. §5 is the procedure and §6 the empty results template.

## 1. What each layer protects against

| Reference | Where it lives | Detects | Does not detect |
|---|---|---|---|
| Hash chain (`events.jsonl`) | evidence folder | edit, deletion, reordering, duplication of individual records | someone who rewrites the whole file and recomputes every hash |
| Head anchor (`events.head.json`) | same folder | truncation of the tail | the same person rewriting it too |
| Anchor file (`FORENSIC_ANCHOR_FILE`) | any path | a full rewrite, **if** the path is out of the attacker's reach | anything, if the same account can write it (test: "rewrite that also rewrote the local anchor file") |
| `cli.js head` kept elsewhere + `verify --expect` | paper, e-mail, another system | rewrite of anything up to that point | records after it |
| **Remote witness** (`FORENSIC_ANCHOR_URL`, `src/anchor_server.js`) | another machine and account | full rewrite, deletion, reordering, truncation, rewritten local anchor file, attempts to re-anchor a forged chain | records written while the witness was unreachable and rewritten before it caught up; a compromise of the witness host |

The trust boundary is the **witness host**. The witness protects only if nobody who can write the evidence folder can also write the witness's data folder or run code on the witness host.

## 2. Code review (verified in code and tests, 2026-10-27)

| Question | Finding | Evidence |
|---|---|---|
| How are hashes stored? | Append-only JSON lines in `<dir>/<store_id>.jsonl`: `{kind: witness|conflict, store_id, sequence, integrity_hash, received_at (witness clock), from (client address)}`. Nothing else. | `anchor_server.js` |
| How does the host authenticate? | One bearer token (≥ 24 characters), constant-time comparison. Missing or wrong token: 401. | test "rejects missing or wrong credentials" |
| Replay of an entry already held | 200, nothing written | test "…replays change nothing" |
| A different hash for a held sequence | Refused with 409; the attempt is kept as a `conflict` and `verify` reports `remote_anchor_conflict` | test "re-anchoring a rewritten chain is refused" |
| Altered, deleted, reordered, truncated local records after anchoring | `anchor_mismatch` / `anchored_record_missing` from the remote witness, while local verification alone passes | four tests "detects a full local rewrite" |
| Local evidence and local anchor file rewritten together | Detected by the remote witness | test "…rewrote the local anchor file" |
| Can the evidence host change or delete witness history? | No API for it: PUT, PATCH, DELETE answer 405, other paths 404. Only someone with file access on the witness host can. | test "witness offers no way to change or delete history" |
| Can the evidence host silently reset or replace the history? | **Gap found and fixed in this round.** The host holds the token and could start a fresh `store_id`, anchor a forged chain under it, and point its own verifier at it. The witness now takes `--stores site-a` (or `FORENSIC_ANCHOR_ALLOWED_STORES`); other ids get 403, and it warns at start-up if the list is missing. | test "store allowlist…" |
| Witness unavailable | Appends succeed; each failure is counted and logged; `verify` reports `remote_anchor_unreachable` and lists unwitnessed records | test "witness down…" |
| Catch-up after an outage | On the next append the host asks the witness for its highest sequence and sends everything after it from the local chain. `cli.js anchor` forces the same catch-up without an append (added this round; tested). Records written during the outage are sent as they are at catch-up time: if they were rewritten during the outage, the forged versions get witnessed. | `store.js flushRemote`; test "…caught up after recovery" |
| What leaves the evidence host? | `store_id`, sequence numbers and SHA-256 hashes. No job data. | test checks the witness file for event content |
| Pre-claiming | A host holding the token can submit hashes for sequences it has not written yet. Those later appear as `anchor_mismatch` or as `anchored_record_missing`, so the action is visible, not hidden. | code reading |
| Who verifies? | `cli.js verify` on the evidence host uses that host's configuration and code. A compromised host can lie, so the **independent check must run on the witness machine** against a copy of the evidence (§5 step 10). | code reading |
| Transport | Plain HTTP. On a network, the token travels in clear text; run it over a VPN or behind a TLS reverse proxy. | code reading |
| Scale | Each request reads the whole store file: O(n) per request, O(n²) to catch up a long gap. Fine at the tested ~12,000 events. | `ponytail` note: index by sequence if stores grow large |

## 3. How the remote witness works

- After each append, the evidence store (in the synchroniser, the ingester and the dashboard) fetches the witness's entries and posts `{store_id, sequence, integrity_hash}` for every later record. No local queue is kept, so restarts lose nothing.
- Appends never fail because of the witness. `verify` reports every gap.
- `cli.js verify` checks the witness when `FORENSIC_ANCHOR_URL` is set and exits 2 on any problem.

## 4. Configuration reference

| Where | Setting | Value |
|---|---|---|
| Witness (B) | `FORENSIC_ANCHOR_TOKEN` | random, ≥ 24 characters; same value as on A |
| Witness (B) | `--dir` | folder writable only by the witness account |
| Witness (B) | `--port`, `--host` | 3200; the private-network address of B (never a public interface) |
| Witness (B) | `--stores` / `FORENSIC_ANCHOR_ALLOWED_STORES` | the store ids allowed, e.g. `office-a` |
| Evidence host (A) | `FORENSIC_ANCHOR_URL` | `http://<B>:3200/anchor` |
| Evidence host (A) | `FORENSIC_ANCHOR_TOKEN` | same token |
| Evidence host (A) | `FORENSIC_ANCHOR_STORE_ID` | `office-a` |
| Firewall on B | inbound TCP 3200 | allow from A's address only; deny all else |

## 5. Two-machine procedure (synthetic data only)

Machine A = evidence host (synchroniser, `forensics/`). Machine B = witness, administered by a different person or at least a different account that A's users do not have. Both Windows, Node.js ≥ 18, on one private network. All commands are `cmd`.

**On B**

1. Copy `forensics/src/anchor_server.js` to `C:\witness\`. Create `D:\anchor-witness` and give write access to the witness account only.
2. Generate a token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`; pass it to A's operator out of band.
3. Firewall: `netsh advfirewall firewall add rule name="anchor-witness" dir=in action=allow protocol=TCP localport=3200 remoteip=<A's IP>`.
4. Start: `set FORENSIC_ANCHOR_TOKEN=<token>` then `node C:\witness\anchor_server.js --dir D:\anchor-witness --port 3200 --host <B's IP> --stores office-a`. Expect `Anchor witness listening … (stores: office-a)`.

**On A** (use a disposable evidence folder, never the live one)

5. `set FORENSIC_DIR=C:\fe-test\evidence`, `set FORENSIC_ANCHOR_URL=http://<B's IP>:3200/anchor`, `set FORENSIC_ANCHOR_TOKEN=<token>`, `set FORENSIC_ANCHOR_STORE_ID=office-a`.
6. Synthetic events: `cd forensics` then `node synthetic/generate.js --seed 900 --jobs 5 --out datasets/xm-900`. Generation runs its own disposable synchroniser, so push the hashes with `node cli.js anchor --dir datasets/xm-900/evidence` (expect `remote anchor holds records up to sequence N`). Then `node cli.js verify --dir datasets/xm-900/evidence > verify-1.txt`. Expect `OK` and `remote anchor: N record(s) witnessed` with N = event count.
7. Tampering, each on a fresh copy of `datasets/xm-900/evidence` (`xcopy /e /i`), followed by `node cli.js verify --dir <copy>`. Expect exit code 2:
   - modify one record's payload and recompute the chain (`test/anchor.remote.test.js`, function `rewrite`, shows how) → `anchor_mismatch`;
   - delete one line and recompute → `anchor_mismatch`;
   - swap two lines and recompute → `anchor_mismatch`;
   - cut the last 3 lines, recompute, rewrite the head file → `anchored_record_missing`;
   - recompute the chain and also rewrite a local `FORENSIC_ANCHOR_FILE` → still `anchor_mismatch` from the remote witness.
8. Unauthorised updates against B, from A: POST without a token (expect 401); POST a different hash for sequence 1 (expect 409, then `verify` shows `remote_anchor_conflict`); POST with `store_id` `office-a-v2` (expect 403); `curl -X DELETE` (expect 405).
9. Outage: stop the witness on B; append twice on A (`node cli.js ingest`); `verify` (expect `remote_anchor_unreachable`). Start the witness again; `node cli.js anchor`; `verify` (expect `OK`, all records witnessed).
10. Independent check on B: copy A's `datasets/xm-900/evidence` to B, then on B run `node cli.js verify --dir <copy>` with `FORENSIC_ANCHOR_URL=http://127.0.0.1:3200/anchor`, the token and the store id. This uses B's own code and does not trust A's.
11. Keep `verify-*.txt`, the witness file `D:\anchor-witness\office-a.jsonl`, and both hosts' clock times in the record.

Failure conditions: any tampering case exits 0; any unauthorised request answers 2xx; anything in the witness file other than ids, numbers and hashes; catch-up incomplete after step 9.

## 6. Results template (NOT RUN)

| Step | Expected | Observed | Pass | Evidence file |
|---|---|---|---|---|
| 4 witness start with allowlist | listening, stores listed | NOT RUN | | |
| 6 normal anchoring | OK, N/N witnessed | NOT RUN | | |
| 7a modified record | exit 2, `anchor_mismatch` | NOT RUN | | |
| 7b deleted record | exit 2, `anchor_mismatch` | NOT RUN | | |
| 7c reordered records | exit 2, `anchor_mismatch` | NOT RUN | | |
| 7d truncation | exit 2, `anchored_record_missing` | NOT RUN | | |
| 7e chain + local anchor rewritten | exit 2, `anchor_mismatch` | NOT RUN | | |
| 8 no token / conflict / foreign store / DELETE | 401 / 409 + conflict / 403 / 405 | NOT RUN | | |
| 9 outage and catch-up | unreachable, then OK | NOT RUN | | |
| 10 verification on B | same results as on A | NOT RUN | | |

Operator, machines, OS versions, network, date: _to be filled in_.

## 7. Operations

- **Availability.** The witness is not on the critical path. While it is down, records are protected by the local chain only.
- **Recovery.** Restart with the same `--dir`, token and `--stores`; the next append fills the gap. If the witness data is lost, start an empty one and record the date as a gap in protection: re-witnessed history is only as good as the chain at that moment.
- **Key management.** One token per evidence host, kept in the service environment (never in git; `.env` is ignored). Rotate by restarting both sides with a new token. The token lets its holder add entries, never change them.
- **Retention.** Keep witness entries as long as the evidence (about 200 bytes per event). Back up the witness folder separately from A.
- **Failure behaviour.** Errors, 10-second time-outs and refusals never fail an append. A 409 means the local chain no longer matches what was witnessed: treat it as an integrity incident.

## 8. Tested on one machine (2026-10-27)

| Test | Where | Result |
|---|---|---|
| 12 witness tests (all rows of §2 marked "test", plus `cli.js anchor`) | `test/anchor.remote.test.js` | pass |
| Synchroniser (child process) sends to a witness in another process; every record witnessed | `e2e/run_e2e.js` step 28 | pass |
| `cli.js verify` against a witness started as a separate OS process; wrong token reported; rewrite detected | manual, 2026-10-26 | pass |
