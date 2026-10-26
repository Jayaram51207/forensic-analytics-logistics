# Data and Repository Audit

Date: 2026-10-25/26, branch `final-hardening` (from `forensic-v2`, commit `1a7e03b`); distribution re-audit 2026-10-27 on `research-validation` (§7).
Scope: every tracked file, all five commits in local history, and the default values in source code.
Method: automated text extraction (openpyxl, xlrd, pdfplumber in `forensics/.venv`) of every tracked
spreadsheet and PDF, pattern search for identifiers, and `git log -p` / `git grep` over all revisions.
Content was read on this machine only. Nothing was sent to an external service.

## Decision: NOT SAFE TO DISTRIBUTE

- **Repository (with history): NOT SAFE TO PUBLISH.** History holds 65 unverified documents with likely-real GSTINs/PANs.
- **Source archive (`git archive`): NOT SAFE TO DISTRIBUTE either** (found 2026-10-27, §7). It contains no documents, but source defaults still hold third-party e-mail addresses and a company name, and the documentation quotes developer user names.
- Changes only on the data owner's authorisation, or after the reviewed clean-distribution procedure in §8.
- Archive exclusions do **not** remove anything from Git history.

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
2. `git archive` leaves the 65 documents out (verified, §7) but is not yet clean; do not share it until §8 is done.
   The recipient would also need their own templates for document generation to run.
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

## 7. Distribution re-audit (2026-10-27, commit `ad2d28f`; repeated at `251e9e7` with identical findings: 206 tracked, 141 archived, 65 excluded documents)

Method: `git archive --format=zip HEAD` into a scratch folder, list its files, compare with `git ls-files`,
pattern-scan every archived text file (GSTIN, PAN, e-mail, Indian mobile number, `PVT LTD` names,
Windows user paths, private keys, AWS keys, long secret literals). Nothing published or pushed.

| Check | Result |
|---|---|
| Tracked files | 205 |
| Files in the archive | 140 |
| Excluded by `.gitattributes` | 65 = exactly the 65 `.pdf`/`.xls`/`.xlsx`/`.xlt`/`.xltx` sample documents; no source, test or documentation file is excluded |
| Archive contents by area | `forensics/src` 12, `forensics/test` 14, `forensics/evaluation` 6, `forensics/config` 1, `docs` 36, `Workflow syncroniser` 14, `B,I,I,L` 5, `EasyQuote` 16, `3D_stuffing_visualizer` 18 (plus root files) |
| GSTIN / PAN patterns in the archive | none |
| Private keys, AWS keys, real secrets | none. Three literal passwords exist in tests; each is a value a test sets inside its own disposable instance |
| **E-mail addresses** | **`amy@sierac.cn`, `bm@creativepackaging.in` in the defaults of `unified_generator.py` and `document_generator.py` (both copies): third-party contacts, provenance unverified** |
| Company name | `LEADKING AIR SERVICES PVT. LTD` in the same defaults (the operator's own name; publication still needs the owner) |
| Phone number | `9876543210` (a common placeholder) in the same files and `public/index.html` |
| Private paths | `c:\Users\vkmsd` quoted in `FORENSIC_REVERSE_ENGINEERING_REPORT.md`, this document and four files in `docs/patches/` (removed lines); `C:\Users\Jayaram` in the reverse-engineering report |
| New commits since `forensic-v2` | add no documents, identifiers or keys; `vkmsd` appears only as removed lines in patches and in audit text |
| `.gitignore` | verified with `git check-ignore`: `forensics/data/`, `forensics/datasets/`, `.env`, `*.pem`, `anchor-witness/`, `test_credentials.json`, `db.json` |
| Live data | `Workflow syncroniser/db.json` unchanged (last modified 23 July); `forensics/data/` does not exist |

## 8. Remediation proposal (local only; not carried out)

Creates a separate clean repository and leaves this one, its tags and its history untouched.

1. Data owner decides on each of the 33 distinct documents (keep out / replace with a synthetic template / cleared).
2. In a fresh export (`git archive HEAD | extract to C:\clean-forensic`):
   replace the defaults in `unified_generator.py` / `document_generator.py` with placeholder values (`example.com` addresses, "Example Exporter Pvt Ltd");
   remove the user-path quotations from `FORENSIC_REVERSE_ENGINEERING_REPORT.md`, this audit and `docs/patches/*` (or drop `docs/patches/` from the distribution);
   add synthetic templates generated by `forensics/synthetic` where document generation must work.
3. Re-run the §7 scan on the clean folder; it must report nothing in the bold rows.
4. `git init` there, one commit, no link to this history. Run `node --test` in it.
5. Owner reviews the result before anything is shared. Rotate nothing: no live secret was found.
Rewriting this repository's history (`git filter-repo`) is not proposed: it breaks existing clones and recovery tags.
