# Forensic Evidence Correlation and Incident Reconstruction Layer

Academic prototype. Captures what the Leadking applications do, keeps it in a tamper-evident store, and turns it into reviewable investigation cases. It raises **potential anomalies for human review**; it does not decide that fraud occurred.

No npm dependencies. Node.js 20+.

## Quick start

```
# 1. Run the synchroniser as usual. Capture is on by default; evidence goes to forensics/data/.
cd "Workflow syncroniser"
node server.js

# 2. Investigate.
cd ../forensics
node cli.js verify          # is the evidence chain intact?
node cli.js cases           # review queue
node cli.js case CASE-XXXXXXXX
node src/dashboard.js       # http://127.0.0.1:3100
```

Document generation in the synchroniser needs `pip install openpyxl pdfplumber`.

To record reviewer assessments from the dashboard, start it with a token:

```
set FORENSIC_REVIEW_TOKEN=choose-a-long-secret
node src/dashboard.js
```

Evidence from the desktop tools (3D visualizer, B.I.I.L., EasyQuote) is written to `%LOCALAPPDATA%\LeadkingForensics\outbox`. Bring it into the chain with `node cli.js ingest`.

## Try it on synthetic data

```
node synthetic/generate.js --seed 1 --jobs 60 --out datasets/demo
node src/dashboard.js --dir datasets/demo/evidence
```

## Tests

```
node --test
```

## Documentation

| Topic | File |
|---|---|
| What exists and how it fits together | [docs/REPOSITORY_ARCHITECTURE.md](../docs/REPOSITORY_ARCHITECTURE.md) |
| Event format and catalogue | [docs/FORENSIC_EVENT_SCHEMA.md](../docs/FORENSIC_EVENT_SCHEMA.md) |
| Where existing code was changed | [docs/INTEGRATION_POINTS.md](../docs/INTEGRATION_POINTS.md), [docs/patches/](../docs/patches/) |
| Rules and scoring | [docs/DETECTION_RULES.md](../docs/DETECTION_RULES.md) |
| Synthetic data | [docs/SYNTHETIC_DATASET.md](../docs/SYNTHETIC_DATASET.md) |
| Measured results | [docs/EXPERIMENTS_AND_RESULTS.md](../docs/EXPERIMENTS_AND_RESULTS.md) |
| What it does not guarantee | [docs/SECURITY_AND_LIMITATIONS.md](../docs/SECURITY_AND_LIMITATIONS.md) |
| Running the tests | [docs/TESTING_GUIDE.md](../docs/TESTING_GUIDE.md) |
| Why it is built this way | [docs/ARCHITECTURE_DECISIONS.md](../docs/ARCHITECTURE_DECISIONS.md) |
| Progress and open items | [docs/IMPLEMENTATION_STATUS.md](../docs/IMPLEMENTATION_STATUS.md) |
