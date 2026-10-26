# Data and Repository Audit

Date: 2026-10-25/26, branch `final-hardening` (from `forensic-v2`, commit `1a7e03b`).
Scope: every tracked file, all five commits in local history, and the default values in source code.
Method: automated text extraction (openpyxl, xlrd, pdfplumber in `forensics/.venv`) of every tracked
spreadsheet and PDF, pattern search for identifiers, and `git log -p` / `git grep` over all revisions.
Content was read on this machine only. Nothing was sent to an external service.

**Conclusion: the repository is NOT safe to publish as it stands.** It may be kept and used locally.
A distribution copy made with `git archive` leaves the unverified documents out (see §5), but the
full history still contains them, so the repository itself must not be pushed to a public remote.

## 1. What was inspected

| Area | Files | How |
|---|---|---|
| Sample and template documents (`.pdf`, `.xls`, `.xlsx`, `.xlt`, `.xltx`) | 65 tracked; 33 distinct by SHA-256 (the rest are byte-identical copies in `B,I,I,L/`, `Workflow syncroniser/BIIL/`, `Workflow syncroniser/Templates/`) | text extracted from every file; counts of e-mail, GSTIN, PAN, IEC-like, IFSC, phone, bank-account-like, container-number and company-name patterns |
| Source code defaults | `unified_generator.py`, `compiler.py`, `document_generator.py`, EasyQuote / StuffingReport C#, `db.js`, `run_e2e.js`, tests | `git grep` for names, addresses, passwords, keys, tokens, paths |
| Git history | 5 commits, tags `original-suite`, `forensic-v1`, `forensic-v2` | deleted files, removed secrets, `-S` pickaxe for passwords |
| Runtime data | `db.json`, `uploads/`, `Generated/`, `forensics/data/`, `.venv/`, `node_modules/` | checked against `.gitignore` and `git ls-files` |

## 2. Findings

| # | Finding | Evidence | Classification |
|---|---|---|---|
| F1 | Checklists, BL instructions, invoices and packing lists name real-looking exporters, consignees and banks | `Templates/Checklist_*.pdf`, `* - BL INSTRUCTION *.xls(x)`, `1_Invoice.pdf`, `2_Packing List.pdf`, `1st Container Invoice & Packing List (1).xlsx`, `air/ExpChecklist_23.pdf` | **Potentially real; unverified** |
| F2 | These documents carry GSTIN- and PAN-format identifiers. All 7 distinct GSTINs found in the PDFs have a valid GSTIN check digit, which random or made-up strings rarely do | text extraction; check-digit computation | **Likely real registrations**. Not looked up anywhere to confirm |
| F3 | E-mail addresses and company names appear in the invoice and AWB templates | `INVOICE TEMPLATE.xltx`, `AWB Instructions*.xls(x)` | Unverified (may be the operator's own business details) |
| F4 | Container numbers, vessel names, tariffs and company details are hard-coded as defaults | `unified_generator.py` (28 matches), `compiler.py` (14), `document_generator.py`, `StuffingReport` C# | Unverified; left unchanged (it is application behaviour) |
| F5 | Accounts were seeded with password = username (`desk1`/`desk1` … `admin`/`admin`) | `Workflow syncroniser/db.js` in every commit up to `forensic-v2`; `forensics/e2e/run_e2e.js` and tests logged in with them | **Insecure default (not a secret).** Removed in this branch (§4) |
| F6 | Absolute private paths of the original developer's PC | `c:\Users\vkmsd\OneDrive\...` in `document_generator.py` and `scratch/test_cotton.py` (both copies) | Privacy (user name). Replaced with script-relative paths in this branch; the string remains in history and in the reverse-engineering report, which quotes it |
| F7 | No API keys, tokens, private keys or connection strings | pattern search over all revisions | None found |
| F8 | No sensitive file was ever deleted from history | `git log --diff-filter=D`: only two regenerable evaluation results | None |
| F9 | Runtime data is not tracked | `db.json`, `uploads/`, `Generated/`, `forensics/data/`, `forensics/datasets/`, `.venv/` are ignored; `git ls-files` lists none | OK |

### Confirmed synthetic

- Everything under `forensics/synthetic/`, `forensics/datasets/` (generated, git-ignored), and every test fixture: values are produced by a seeded generator and job numbers start `SYN-`, `E2E-`, `DASH-` or `J-`.
- Experiment results under `forensics/evaluation/results/` contain only synthetic job numbers and aggregate scores.
- Test credentials are random per test run and are written only into the test's temporary folder.

### Unverified (not to be distributed)

All 65 tracked sample/template documents (F1–F3) and the defaults in F4. Their provenance could not be
established from the repository. None was deleted: the applications use them as layouts, and
deleting a file does not remove it from history anyway.

## 3. Secrets and privacy issues

- **Seeded passwords (F5).** These are predictable defaults rather than leaked secrets, but any
  installation that ran the old code still has those accounts. The new code forces a password change
  when a stored password fails the policy (so `desk1`/`desk1` cannot be used further than the change
  screen). **Recommendation:** on every existing installation, sign in as admin, reset or delete the
  seeded accounts, and set a strong admin password. The old code remains in local history; deleting it
  from the current files does not remove it from there.
- **Private path (F6).** Exposes a Windows user name. Low risk; it remains in history.
- **Business identifiers (F2).** If the GSTINs/PANs are real, the documents are confidential business
  data of third parties. They are in local history in all five commits.

## 4. Changes made

- `.gitignore`: added `.env`, `.env.*`, `*.pem`, `*.key`, `test_credentials.json`, `anchor-witness/`.
- `.gitattributes` (new): `export-ignore` for all 65 sample/template documents, so `git archive`
  leaves them out. Verified with `git check-attr`: 65 of 65 covered.
- Seeded credentials removed; administrator bootstrap from `SYNC_ADMIN_PASSWORD` (see RUNTIME_SETUP.md §4).
- Private paths replaced with paths relative to the script (F6).

## 5. Safe distribution guidance

1. Do not push this repository, or any clone of it, to a public or shared remote. History holds F1–F3.
2. To share the code: `git archive --format=zip -o forensic.zip final-hardening`. Check the archive lists
   no `.pdf`/`.xls*` files. The recipient must supply their own templates for document generation to run.
3. If a clean public repository is ever needed: create a new repository from that archive (fresh
   history) after the owner has reviewed F4 (hard-coded defaults).
4. The owner of the business data must decide whether any of the documents may be shared (DECISIONS Q1).

## 6. Remaining risks

- F1–F3 stay in local history. Rewriting history (e.g. `git filter-repo`) was not done; it is
  irreversible for anyone holding a clone and should be the owner's decision.
- F4 defaults are compiled into the applications and appear in generated documents.
- The audit is pattern-based. Free-text personal data without a recognisable format (names,
  addresses) is counted only through company-name suffixes; a manual review by the data owner is still needed.
- Evidence stores (`forensics/data/`) hold full job records when the system is used with real data.
  They are ignored by git but must be handled like `db.json`.
