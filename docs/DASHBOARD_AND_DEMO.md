# Investigation Dashboard and Safe Local Demonstration

## 1. Synthetic-data-only operating procedure

This framework has been evaluated on synthetic data only. Until the data owner and business owners
have decided the open questions (DECISIONS_AND_OPEN_REQUIREMENTS.md), run it only as follows.

1. Use a disposable evidence folder (`FORENSIC_DIR` pointing to a temp folder, or the demo below). Never point
   the dashboard or CLI at `Workflow syncroniser/db.json` or a production evidence folder for experiments.
2. Generate data with `synthetic/generate.js` or `e2e/demo.js`. Both start their own synchroniser with a
   throw-away database, random passwords and simulated clocks (`clock_source: "simulated"`).
3. Do not copy sample documents from `B,I,I,L/Templates/` or `Workflow syncroniser/Templates/` into
   demonstrations or reports; they may contain real business identifiers (DATA_AND_REPOSITORY_AUDIT.md).
4. Treat every finding as a potential anomaly for review, never as proof. Business rules are unconfigured:
   the dashboard header says so, and results that depend on them are marked unresolved.
5. Keep the dashboard on `127.0.0.1` (the default). It has no login; anyone on the machine can read it.

## 2. Demonstration (about 30 seconds)

Any of these (Node.js 20+, `npm install` done in `Workflow syncroniser/` and `forensics/`, and `forensics\setup_env.cmd` run once for document generation):

```
node e2e/demo.js --serve                 (from the repository root)
cd forensics && node e2e/demo.js --serve
cd forensics && npm run demo
```

Add `--port <n>` if 3100 is taken; a clear message is printed when the port is in use. Ctrl+C stops it.
(Before 2026-10-27 the command only worked from `forensics/`; from the root it failed with
"Cannot find module …\Forensics\e2e\demo.js". The root `e2e/demo.js` and `e2e/run_e2e.js` now forward to `forensics/e2e/`.)

It runs ten synthetic shipments through the real pipeline (synchroniser over HTTP with signed-in sessions →
evidence store; B.I.I.L., stuffing-report and 3D-visualizer records in their real schemas → outbox →
ingestion → linking → provenance → contradictions → rules → cases), prints what was found, and opens the
dashboard at http://127.0.0.1:3100 on that evidence, with the synthetic labels shown next to each case.

| Shipment | What it shows |
|---|---|
| clean_complete | control: no case at all |
| xapp_consistent | B.I.I.L., packing run and stuffing report linked to one job and agreeing; the only note is the unresolved tax rule |
| xapp_rounding_difference | B.I.I.L. weight differs by < 1 kg: not a contradiction |
| xapp_weight_conflict | B.I.I.L. gross weight differs: both records named, classified, linked with confidence |
| xapp_document_backed_conflict | checklist and B.I.I.L. agree, job was changed: potential fraud indicator requiring investigation |
| common_source_falsification | every record agrees but all come from one false source: not flagged, stated as single-source |
| xapp_unlinked_record | a record that cannot be tied to any job: listed under "Evidence not tied to a shipment", never used |
| unauthorized_delete_attempt | refused deletion by a desk user (ACT-002); job not deleted |
| deleted_after_close | administrator deletes a closed job (DEL-001); reconstructed from evidence |
| legit_backfill | finished shipment entered after the fact: a known false positive of TIM-001 |

`test/demo.integration.test.js` asserts all of the above on every test run.

## 3. Launching the dashboard on other evidence

```
node src/dashboard.js --dir <evidence folder> [--port 3100] [--labels <labels.json>] [--eval <final_summary.json>]
```

- On a generated dataset (`--dir datasets/seed-4/evidence`) the labels next to it are found automatically.
- `FORENSIC_REVIEW_TOKEN=<secret>` enables recording reviewer assessments and manual evidence links (both appended to the evidence chain; nothing is edited).
- The Evaluation view reads `evaluation/results/final_summary.json` (produced by `evaluation/summarize.js`).
- Views have addresses: `#/overview`, `#/cases`, `#/cases/<CASE-ID>`, `#/evidence`, `#/eval`; browser back and forward work.

## 4. What the dashboard shows

**Top bar:** whether the evidence chain verifies (integrity: the records were not altered after capture, not that they are true) and whether business rules are configured.

| View | Content |
|---|---|
| Overview | open cases, high priority, contradictions in open cases, chain integrity, desktop-tool records not tied to one shipment (each opens the filtered view); unconfigured business rules stated once; highest-priority cases; rules raised (click to filter); recent desktop-tool records |
| Investigation queue | cases ranked by review priority (0–100, not a probability); search, priority, rule, status, sort, contradiction and deletion filters; keyboard: arrows and Enter. Each row: main reason, findings, contradictions, source applications |
| Case | "Why this was raised" (highest-severity finding, with "potential anomaly, not a finding of fraud"); synthetic ground truth when labels exist (never used by the analysis); findings with supporting and weakening evidence; contradictions between applications (both records, classification, link method and confidence, independence); recommended next steps; uncertainty and limitations; where key values come from (separate sources vs copies); related records from other applications; timeline (filter: cited by a finding, application); expandable technical details: score components, four trust questions, overwritten values, document generations; review outcome |
| Evidence | every desktop-tool record as Linked, Uncertain (several candidate jobs, or the record points two ways) or Unlinked (with the reason: no reference, malformed reference, reference matching no job); link method, confidence, basis, conflict; event id, actor claim, artifact hashes; "Link by hand" form when a review token is set |
| Evaluation | synthetic-only label first; precision, recall and FPR of the full framework with 95% intervals; variants and Isolation Forest compared; confusion matrices; unseen scenario families; previous held-out seeds re-scored; each rule alone; per seed, per category, per scenario type, false alarms, misses, investigation quality |

Loading, empty and error states are shown in every view; the page follows the system light or dark theme.

## 5. Linking a record by hand

A desktop-tool record without a usable shipment reference (for example a quotation exported before the
Shipment / Job No. field existed) can be tied to a job by a reviewer:

```
node cli.js evidence --status unlinked                      list them with their event ids
node cli.js link <event_id> <job_no> --reason "..."          or the Evidence view with a review token
```

The link is a new `evidence.link_asserted` event with the reviewer and reason; the record is unchanged.
It counts as a claim (method `manual_assertion`, confidence 0.7). If the record's own reference or
container numbers point to another job, the link becomes uncertain and both jobs are shown.

## 6. Verified by tests

`test/browser.test.js` drives the dashboard in Edge: empty, malformed and populated stores; markup safety;
the case view and the Evidence view (linked record, integrity wording, status filter); and on the demo
evidence the overview, rule filter, keyboard selection, priority filter, sort, contradiction and text
filters, ground-truth panel, refused request in the timeline, unlinked records in the Evidence view and the
Evaluation view. `test/linkage.test.js` covers the evidence API and manual links.
