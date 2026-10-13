# Architecture Decisions

Each entry: decision, reason, alternative rejected, and what would change it.

**AD-01 · JSON Lines, not SQLite, for evidence.**
Needs no dependency in Node, Python or C#; append-only by construction; a hash chain is natural on a line sequence; a student can read the evidence in a text editor. SQLite would add a native dependency to the synchroniser and make "append-only" a convention on top of a mutable file. Revisit if event volume makes full-file reads slow (analysis currently loads everything; about 11,000 events for 300 jobs).

**AD-02 · Evidence store separate from `db.json`.**
`db.json` is rewritten whole on every save and `deleteJob` removes history. Putting events there would give them the same fate.

**AD-03 · Hooks in `server.js`, not in `db.js`.**
The route has the request (claimed actor, IP), the compiler result and the upload; the data layer has none of these. `server.js` is the only caller of `db.js`, so no write path is missed. Start-up migrations are covered by `system.started` and by baseline events. Cost: a future second caller of `db.js` would bypass capture; reconciliation would show the difference.

**AD-04 · Two events for destructive operations.**
The old state is written before the overwrite, so a crash or a failed write cannot lose it. One event after the fact would be simpler but would lose evidence exactly when something goes wrong. Cost: roughly twice the event count.

**AD-05 · Fail-closed by default for required events.**
An audit layer that silently stops recording while the application keeps accepting deletions is worse than none. `FORENSIC_FAIL_MODE=open` exists for sites that prefer availability. Desktop tools are always fail-open: there is no server to refuse anything.

**AD-06 · `changes[]` array instead of one event per field.**
One edit is one event with all its field changes. The flat `field_changed / old_value / new_value` shape would split a single user action across many events and need regrouping later.

**AD-07 · Child rows compared by business key.**
`updateJob` deletes and re-inserts every child row with new ids, so an id-based diff would report everything as changed. Keys: container number, cargo description, charge description, step name, document name; duplicates get a `~n` suffix. Weakness: renaming a charge appears as remove + add.

**AD-08 · Forensic `correlation_id` per job lifecycle.**
Database ids are reused after deletion and job numbers are editable, so neither identifies a lifecycle. The id is created by the capture layer and rebuilt from evidence at start-up. It is not presented as an identifier the applications share.

**AD-09 · Content fingerprint for workbooks.**
Runtime testing showed two generations from identical input differ in bytes. The fingerprint (entry names, CRC-32 and sizes from the zip central directory, excluding `docProps/core.xml`) is stable across such runs. Both it and the plain SHA-256 are recorded.

**AD-10 · Output archiving on by default.**
A hash proves a file changed but cannot show what the old one said. Copies are stored by SHA-256, so identical files are stored once. Off for synthetic datasets to save space.

**AD-11 · Analysis in Node, ML in Python.**
Capture must be Node (same process as the synchroniser). Keeping rules and cases in the same language avoids a second implementation of the schema. Only the Isolation Forest baseline uses Python, reading a CSV.

**AD-12 · Outbox files for desktop tools.**
They are separate processes in three languages, sometimes offline. A shared HTTP endpoint would need the synchroniser running and reachable. Cost: outbox content is unprotected until ingested, which is recorded on each ingested event.

**AD-13 · Both tax implementations accepted.**
The repository contains two different tax rules and nothing says which is right. Flagging disagreement with either one would encode a guess as a rule. A closing bill is flagged only if no candidate total under either implementation explains it.

**AD-14 · Workflow order is configuration.**
The application enforces no order. `required_before_close` and `lock_steps` are explicit assumptions listed on every finding that depends on them.

**AD-15 · Findings have kinds; only anomalies score.**
Unparseable or missing data yields a data-quality note. Mixing those into the score would rank sloppy typing above real inconsistencies.

**AD-16 · Reviewer decisions are events in the same chain.**
A disposition is itself evidence and should be as tamper-evident as the events it judges. Case status is the latest disposition; earlier ones stay visible.

**AD-17 · Synthetic data drives the real application.**
Scenarios call the synchroniser's HTTP API, so the evidence is what the real capture code produces. Hand-built event files would test the rules against my idea of the events rather than the events. Cost: generation takes minutes, and timestamps must be simulated through a header that is disabled unless explicitly enabled.

**AD-18 · Authentication not rebuilt.**
Adding sessions to the synchroniser is a security change to the operational system, larger than the capture hooks. Actors are recorded as unverified instead. See SECURITY_AND_LIMITATIONS §3.

## Decisions that changed during implementation

| Change | Why |
|---|---|
| "Before" snapshots are deep-copied in `server.js` | Integration test showed `getJobById` returns live row references; step changes produced empty diffs |
| DEL-001 no longer treats "documents existed" as serious | Scenario test: the synchroniser generates at creation, so every deletion was flagged, including discarded drafts |
| Identical regeneration judged by input hash, not output hash | Baseline run showed output bytes are never identical |
| `uploads/` created at server start | Baseline run showed uploads fail without it; upload capture could not be tested otherwise |
| Python interpreter path made configurable (`SYNC_PYTHON`) | System Python lacked `openpyxl`; tests use an isolated environment |
