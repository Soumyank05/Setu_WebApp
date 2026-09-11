# SETU

SETU is a local, synthetic-data demonstrator for correlating telecom CDRs, UPI settlement records, and KYC ownership data during cyber-fraud triage. It hashes source artifacts at intake, resolves shared-device identities, scores explainable transaction signals, and produces an interactive graph plus an investigative brief.

> This project is for training and demonstrations only. Its generated records are synthetic and it is not a substitute for a forensic workflow, legal process, or production security controls.

## What the pipeline does

1. Generates a noisy mock telecom/UPI dataset with one planted mule-money chain.
2. Validates, normalizes, and SHA-256-hashes the raw evidence inputs.
3. Links phones that share an IMEI and maps KYC-linked phone/UPI identifiers to one actor.
4. Builds an interactive directed UPI money-flow graph.
5. Scores shared devices, rapid money forwarding, rapid fan-out, and high fan-in.
6. Writes a JSON/PDF investigation brief and presents the case in a custom browser workspace.

## Setup and run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Use true when serving SETU over HTTPS (the default false supports local HTTP only).
export SETU_COOKIE_SECURE=false
uvicorn webapp.main:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000), then select **Run new investigation**. The web app runs the full synthetic-data pipeline, then lets you filter risk findings, inspect a clickable money-flow network, verify source hashes, and download the PDF brief.

The original Streamlit dashboard remains available with `streamlit run dashboard/app.py`.

For the controls required before handling operational evidence, read [DEPLOYMENT.md](DEPLOYMENT.md).

## Verification

Run the focused investigation-control suite after changes:

```bash
.venv/bin/python -m unittest discover -s tests -v
```

The suite covers shortest-path explainability, cluster detection, chained audit entries, two-person sensitive-action approval, and single-use approval consumption.

Generated evidence stays out of version control. Re-run the generator to start a new synthetic case.

## Authentication and access control

The web workspace requires sign-in and never offers browser-based registration or account creation. Create every user ID from a trusted terminal on the host running SETU:

```bash
python -m webapp.manage_users create administrator --role admin
python -m webapp.manage_users create supervisor.name --role supervisor
python -m webapp.manage_users create analyst.name --role investigator
python -m webapp.manage_users list
```

The command prompts for a password twice and assigns a numeric user ID automatically. Keep terminal and deployment access limited to trusted administrators.

Passwords are stored only as salted PBKDF2-SHA256 hashes. Sessions use opaque, HTTP-only, SameSite cookies, are stored server-side, expire after eight hours by default, and are revoked on logout. Set `SETU_SESSION_LIFETIME_HOURS` to change the session duration. For any HTTPS deployment, set `SETU_COOKIE_SECURE=true`.

New and terminal-reset accounts must choose a new password at first sign-in. Five failed sign-in attempts lock an account; only a trusted terminal operator can reset it:

```bash
python -m webapp.manage_users reset-password analyst.name
```

Investigators can update cases, status, notes, reviews, and personal watchlists. Supervisors and administrators additionally assign entities, stage evidence, run the pipeline, and export signed case packages.

## Flagged-entity status updates

In **Casework**, signed-in investigators can post updates for each flagged entity: `new`, `in progress`, `monitoring`, `escalated`, or `resolved`. Each update records the signed-in user and UTC timestamp, appears in the entity-status timeline, and exposes the latest status directly in the priority queue.

## Case-management capabilities

The priority queue supports assignment, priority, due dates, investigator workload, status/owner filters, monetary and activity-date filters, plus IMEI, UPI, and phone searches. Alerts surface new findings, overdue assignments, escalations, resolutions, and activity touching personal watchlists. Evidence intake and later integrity access/download events are preserved in a custody history with operator identity, UTC time, source, and SHA-256 hash. Supervisor exports are available as a PDF package, CSV audit extract, or ZIP bundle containing the evidence manifest and SHA-256 signed audit log.

## Repository layout

```text
data/             synthetic-data generator; raw and processed artifacts
parsers/          validation, normalization, and evidence manifest
entity_linking/   IMEI and KYC identity resolution
graph/            graph edge list and interactive visualization
scoring/          transparent, time-aware risk scoring
report/           JSON/PDF investigative brief
dashboard/        Streamlit officer interface
webapp/           FastAPI backend and responsive custom browser interface
learning/         short library demonstration
```
