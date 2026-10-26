# Decisions and Open Business Requirements

No business owner was consulted and no company policy was available. Every question below that
needs business authority is **still open**: a safe default is applied, it can be configured, and the
software says the question is unresolved instead of presenting a result as confirmed.

Business rules are configured in `forensics/config/business_rules.json` (or the file named by
`FORENSIC_BUSINESS_RULES`). The shipped file sets every rule to `null`. An invalid value stops the CLI
and dashboard with an error; a typo never silently means "unset".

| # | Question | Status | Default applied | Must be confirmed by |
|---|---|---|---|---|
| 1 | May the sample documents and defaults be used? | Open | Kept locally, excluded from distribution | Owner of the business data / data-protection lead |
| 2 | Which workflow steps are mandatory before closing a job? | Open | Unconfigured: every pending step is reported; compliance shown as not verified | Operations manager |
| 3 | Ocean-freight tax: 9% + 9% or 2.5% + 2.5%? | Open | Both accepted; differences labelled unresolved | Finance / tax adviser |
| 4 | What must the closing bill equal? | Open | Taxable total, grand total and amount after TDS all accepted; labelled unresolved | Finance manager |
| 5 | Fail closed or fail open when evidence cannot be written? | Default kept | Fail closed; fail open only by explicit setting, announced and recorded | Business owner together with IT |
| 6 | Restrict job deletion to administrators? | Default applied | Admin-only, enforced on the server | Operations manager |

## Q1. Sample documents and defaults

- **Evidence:** docs/DATA_AND_REPOSITORY_AUDIT.md. The 65 tracked documents hold GSTIN/PAN-format
  identifiers (7 of 7 GSTINs have valid check digits), company names and e-mail addresses. Provenance unknown.
- **Decision:** unresolved. Nothing was deleted. All 65 documents are marked `export-ignore` in
  `.gitattributes`, so `git archive` leaves them out. Nothing was pushed. Only generated synthetic data
  was used in tests and experiments.
- **Configuration:** remove a line from `.gitattributes` to include a document that the owner has cleared.
- **Consequence:** a distributed copy cannot generate documents until the recipient supplies templates.

## Q2. Mandatory workflow steps

- **Evidence:** the application enforces no order; `server.js` lets any step be ticked at any time. No
  requirement document exists in the repository.
- **Default:** `required_before_close: null`. Rule WFL-001 still reports every pending step at closure
  (as before, so no detection is lost) but each finding says "Mandatory steps before closure are
  UNRESOLVED ... workflow compliance is NOT verified". The dashboard header shows "Business rules not configured".
- **Configuration:** `"required_before_close": "all"` or a list such as `["Document Verified (Before Sailing)", "OOC"]`.
  Findings then cite the file as the source of the rule.
- **Consequence:** the synchroniser still lets users close jobs with steps pending. Enforcing an order in
  the application was not done; it would change daily work and needs the confirmed list first.

## Q3. Ocean-freight tax rate

- **Evidence:** `compiler.py` (synchroniser) applies 9% CGST + 9% SGST to every charge;
  `unified_generator.py` (B.I.I.L.) applies 2.5% + 2.5% to ocean freight. Both values are kept unchanged in the source.
- **Default:** `tax_scheme: null`. FIN-001 accepts either; XAP-TAX is classified
  `unresolved_business_rule_conflict` ("neither total can be called wrong").
- **Configuration:** `"tax_scheme": "flat_9_9"` or `"ocean_freight_2_5"`. Then FIN-001 checks the closing
  SGST/CGST against that scheme only, and XAP-TAX becomes `confirmed_data_inconsistency` when B.I.I.L.'s
  total does not follow it (and disappears when it does). Tested in `test/units.test.js`.
- **Consequence:** the generators themselves are not changed; whichever is wrong will keep producing
  wrong totals until its code is changed, and the analysis will then flag them.

## Q4. Closing-bill basis

- **Evidence:** the UI asks for a "closing bill amount" with no definition; no document defines it.
- **Default:** `closing_bill_basis: null`; any of the three totals (under either tax scheme) is accepted,
  and FIN-001 findings say the basis is UNRESOLVED.
- **Configuration:** `"closing_bill_basis": "taxable_total" | "grand_total" | "after_tds"` (TDS rate 2%, from the source).
- **Consequence:** until configured, a closing amount that equals the wrong total is not flagged.

## Q5. Evidence-store failure

- **Evidence:** the project requirement "no destructive change without a preserved record".
- **Default:** fail closed (`FORENSIC_FAIL_MODE` unset). The user sees "Change refused: the forensic
  evidence store could not record it, so nothing was saved..." (browser test). Recovery procedure:
  RUNTIME_SETUP.md §5; the gap is recorded as `forensic.capture_gap` once writing works again.
- **Override:** `FORENSIC_FAIL_MODE=open`, set by whoever starts the server. It prints a warning at
  start-up and is recorded in `system.started`. It cannot be switched from the UI.
- **Consequence:** a full or unavailable evidence disk stops edits in the synchroniser.

## Q6. Job deletion

- **Evidence:** the original UI let anyone delete.
- **Default:** admin-only, enforced by `requireDeleteRole` in `server.js` (403 for others, recorded as
  `auth.request_rejected`). The delete button is hidden for non-admins, but the server check is what
  enforces it. A full snapshot is kept in `job.delete_requested` (tests: sync, auth, browser, e2e).
- **Override:** `SYNC_DELETE_REQUIRES_ADMIN=0` restores the original behaviour; recorded in `system.started`.
- **Consequence:** desk users must ask an administrator to delete a job.
