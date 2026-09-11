# SETU deployment guardrails

This repository is a local prototype. It is suitable for demonstrations with synthetic data only. Do not put operational CDR, banking, KYC, or victim data into this version until the following controls are implemented and approved by the Cyber Cell and its information-security/legal teams.

## Required before operational use

- Deploy on an approved isolated network or a private government environment; do not expose the web server directly to the public internet.
- Replace the local, unauthenticated interface with organization-managed login, role-based permissions, and MFA. Separate investigator, supervisor, administrator, and auditor permissions.
- Store uploads and generated briefs on encrypted approved storage. Define backup, retention, legal-hold, and secure-disposal procedures.
- Send audit events to a protected, append-only central log. The local JSONL audit file is a prototype convenience, not a tamper-resistant record.
- Validate evidence-transfer authority and keep original artifacts read-only. Preserve acquisition metadata, the original file hash, uploader identity, and time of intake.
- Add input-malware scanning, file-size/rate controls, dependency scanning, security review, and a privacy impact assessment.
- Obtain a documented operating procedure for supervisory review, correction of false positives, requests to providers, and disclosure obligations.

## Human review rule

SETU's scores identify patterns for triage only. They do not establish identity, guilt, account ownership, or a basis for adverse action. A trained officer must corroborate every finding with source records and record the review rationale before any escalation.

## Current local workflow

1. Register the case and responsible officer in **Casework**.
2. Stage the authorized telecom, UPI, and KYC CSV artifacts.
3. Run the pipeline; it validates sources and records SHA-256 hashes.
4. Use the graph and risk queue to prioritize manual review.
5. Record corroborated notes and a review disposition for each flagged entity.
6. Download the brief for the approved case file.

## Production-mode guard

Set `SETU_PRODUCTION=true` only behind HTTPS. In that mode, SETU blocks enabling a live intake connector unless all of the following are configured: `SETU_COOKIE_SECURE=true`, an administrator-approved IP allowlist and MFA policy, `SETU_IDENTITY_PROVIDER`, and `SETU_IMMUTABLE_AUDIT_URI`. The environment variables identify the approved services; the deployment team must integrate and validate those services before operational use.
