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
- `FORENSIC_REVIEW_TOKEN=<secret>` enables recording reviewer assessments (written to the evidence chain).
- The Evaluation tab reads `evaluation/results/final_summary.json` (produced by `evaluation/summarize.js`).

## 4. What the dashboard shows

**Header:** whether the evidence chain verifies; whether business rules are configured.

**Cases tab**

| Area | Content |
|---|---|
| Review queue | cases ranked by review priority (0–100, not a probability); filters for text, priority band, rule, deleted jobs, cases with contradictions |
| Rules raised | how many cases each rule raised; click to filter |
| Evidence not tied to a shipment | external records with no link or an ambiguous one, per application (e.g. EasyQuote quotations, which carry no shipment reference); refused requests |
| Legend | recorded evidence vs. inferred findings vs. unresolved questions vs. synthetic ground truth |
| Synthetic ground truth | scenario label and expected rules, and whether the raised rules match; only when labels are available; never used by the analysis |
| Case / Why this was raised | score components, each finding with rule id, severity, explanation, assumptions, supporting/weakening evidence, cited event ids |
| Contradictions between applications | both records with values, source application, time basis, actor, evidence and event ids, link method and confidence, classification, independence of sources, recommended next step |
| Where key values come from | per field: records agreeing, separate sources, and whether the agreement is copies of one statement |
| Evidence trust | integrity / authenticity / accuracy / independence answered separately |
| Overwritten values | every captured edit with old and new value; deletion noted |
| Document generations | each generation, outcome, input hash, output hashes |
| Timeline | all events across applications in event-time order, with time basis, uncertain ordering, refused requests, cited rows highlighted, evidence gaps |
| Review outcome | recorded assessments; form when a review token is set |

**Evaluation tab** (synthetic results only): confusion matrix per variant (A rules, C + provenance,
X + contradictions without lineage, D full), comparison with Isolation Forest, per-seed results,
per-category recall, per-scenario counts, false alarms listed, and investigation-quality measures.

## 5. Verified by tests

`test/browser.test.js` drives the dashboard in Edge: empty, malformed and populated stores; markup safety;
and on the demo evidence the rule filter, contradiction filter, text filter, ground-truth panel, refused
request in the timeline, unlinked-evidence panel, and the Evaluation tab.
