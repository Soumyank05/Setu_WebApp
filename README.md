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

uvicorn webapp.main:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000), then select **Run new investigation**. The web app runs the full synthetic-data pipeline, then lets you filter risk findings, inspect a clickable money-flow network, verify source hashes, and download the PDF brief.

The original Streamlit dashboard remains available with `streamlit run dashboard/app.py`.

For the controls required before handling operational evidence, read [DEPLOYMENT.md](DEPLOYMENT.md).

Generated evidence stays out of version control. Re-run the generator to start a new synthetic case.

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
