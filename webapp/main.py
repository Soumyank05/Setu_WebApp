"""Local API and static-site host for the SETU investigation workspace."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
PROCESSED, REPORT = ROOT / "data" / "processed", ROOT / "report"
RAW = ROOT / "data" / "raw"
CASE_PATH, NOTES_PATH, REVIEWS_PATH, AUDIT_PATH = (PROCESSED / "case.json", PROCESSED / "notes.json", PROCESSED / "reviews.json", PROCESSED / "audit.jsonl")
STEPS = [
    ("Generate synthetic evidence", "data/generate_data.py"),
    ("Ingest and hash evidence", "parsers/ingest.py"),
    ("Resolve entities", "entity_linking/resolve.py"),
    ("Build money-flow graph", "graph/build_graph.py"),
    ("Score investigation risk", "scoring/score.py"),
    ("Create investigative brief", "report/generate_brief.py"),
]

app = FastAPI(title="SETU Investigation Workspace")
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")


class CaseMetadata(BaseModel):
    case_reference: str = Field(min_length=3, max_length=80)
    title: str = Field(min_length=3, max_length=180)
    officer: str = Field(min_length=2, max_length=100)
    unit: str = Field(min_length=2, max_length=120)
    incident_date: str = Field(default="")
    jurisdiction: str = Field(default="Indore")


class Note(BaseModel):
    text: str = Field(min_length=2, max_length=2_000)
    author: str = Field(min_length=2, max_length=100)


class Review(BaseModel):
    node: str = Field(min_length=2, max_length=160)
    disposition: str = Field(pattern="^(pending|reviewed|escalate|cleared)$")
    reviewer: str = Field(min_length=2, max_length=100)
    rationale: str = Field(min_length=2, max_length=1_000)


def read_json(path: Path, default):
    return json.loads(path.read_text()) if path.exists() else default


def write_json(path: Path, value) -> None:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def audit(event: str, details: dict | None = None) -> None:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    item = {"at_utc": datetime.now(timezone.utc).isoformat(), "event": event, "details": details or {}}
    with AUDIT_PATH.open("a") as log:
        log.write(json.dumps(item) + "\n")


def records(path: Path) -> list[dict]:
    return pd.read_csv(path).fillna("").to_dict("records") if path.exists() else []


@app.get("/")
def home() -> FileResponse:
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.get("/api/case")
def case_data() -> dict:
    scores = records(PROCESSED / "risk_scores.csv")
    links = records(PROCESSED / "entity_links.csv")
    edges = records(PROCESSED / "graph_edges.csv")
    manifest_path = PROCESSED / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    return {
        "ready": bool(scores), "scores": scores, "links": links, "edges": edges,
        "manifest": manifest, "case": read_json(CASE_PATH, {}), "notes": read_json(NOTES_PATH, []),
        "reviews": read_json(REVIEWS_PATH, {}), "audit": [json.loads(line) for line in AUDIT_PATH.read_text().splitlines()[-20:]] if AUDIT_PATH.exists() else [],
        "report_available": (REPORT / "setu_brief.pdf").exists(),
    }


@app.post("/api/pipeline")
def run_pipeline() -> dict:
    completed = []
    for label, script in STEPS:
        result = subprocess.run([sys.executable, str(ROOT / script)], capture_output=True, text=True, cwd=ROOT)
        if result.returncode:
            raise HTTPException(status_code=500, detail={"step": label, "error": result.stderr[-1_500:]})
        completed.append({"step": label, "output": result.stdout.strip()})
        audit("pipeline_step_completed", {"step": label})
    return {"completed": completed}


@app.post("/api/case")
def save_case(metadata: CaseMetadata) -> dict:
    write_json(CASE_PATH, metadata.model_dump())
    audit("case_metadata_updated", {"case_reference": metadata.case_reference, "officer": metadata.officer})
    return metadata.model_dump()


@app.post("/api/notes")
def add_note(note: Note) -> dict:
    notes = read_json(NOTES_PATH, [])
    entry = {**note.model_dump(), "at_utc": datetime.now(timezone.utc).isoformat()}
    notes.insert(0, entry); write_json(NOTES_PATH, notes)
    audit("analyst_note_added", {"author": note.author})
    return entry


@app.post("/api/reviews")
def save_review(review: Review) -> dict:
    reviews = read_json(REVIEWS_PATH, {})
    entry = {**review.model_dump(), "updated_at_utc": datetime.now(timezone.utc).isoformat()}
    reviews[review.node] = entry; write_json(REVIEWS_PATH, reviews)
    audit("finding_reviewed", {"node": review.node, "disposition": review.disposition, "reviewer": review.reviewer})
    return entry


@app.post("/api/evidence")
async def upload_evidence(artifact: str = Form(...), file: UploadFile = File(...)) -> dict:
    targets = {"telecom": ("telecom_cdr.csv", {"phone_number", "imei", "imsi", "timestamp", "tower_id"}), "upi": ("upi_settlement.csv", {"sender_phone", "receiver_upi", "amount", "timestamp"}), "kyc": ("kyc_mapping.csv", {"phone_number", "upi_handle"})}
    if artifact not in targets or not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a CSV and select telecom, UPI, or KYC evidence.")
    payload = await file.read()
    if not payload or len(payload) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Evidence must be a non-empty CSV under 50 MB.")
    try:
        columns = set(pd.read_csv(__import__("io").BytesIO(payload), nrows=1).columns)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The uploaded file could not be read as a CSV.") from exc
    name, required = targets[artifact]
    if missing := required - columns:
        raise HTTPException(status_code=400, detail=f"Missing required columns: {', '.join(sorted(missing))}")
    RAW.mkdir(parents=True, exist_ok=True); (RAW / name).write_bytes(payload)
    audit("evidence_uploaded", {"artifact": artifact, "stored_as": name, "bytes": len(payload)})
    return {"message": f"{artifact.upper()} evidence staged as {name}. Run the pipeline to hash and correlate it."}


@app.get("/api/brief")
def download_brief() -> FileResponse:
    path = REPORT / "setu_brief.pdf"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Run the pipeline before downloading a brief.")
    return FileResponse(path, media_type="application/pdf", filename="setu_brief.pdf")
