"""Local API and static-site host for the SETU investigation workspace."""

from __future__ import annotations

import json
import hashlib
import hmac
import os
import secrets
import sqlite3
import subprocess
import sys
import io
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import Cookie, Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
PROCESSED, REPORT = ROOT / "data" / "processed", ROOT / "report"
RAW = ROOT / "data" / "raw"
CASE_PATH, NOTES_PATH, REVIEWS_PATH, AUDIT_PATH = (PROCESSED / "case.json", PROCESSED / "notes.json", PROCESSED / "reviews.json", PROCESSED / "audit.jsonl")
STATUS_UPDATES_PATH = PROCESSED / "status_updates.json"
APPROVALS_PATH = PROCESSED / "approvals.json"
REQUESTS_PATH = PROCESSED / "external_requests.json"
ENTITY_TAGS_PATH = PROCESSED / "entity_tags.json"
ASSIGNMENTS_PATH = PROCESSED / "assignments.json"
WATCHLISTS_PATH = PROCESSED / "watchlists.json"
CUSTODY_PATH = PROCESSED / "evidence_custody.json"
TEMPLATES_PATH = PROCESSED / "case_templates.json"
COLLABORATION_PATH = PROCESSED / "collaboration.json"
CASE_LINKS_PATH = PROCESSED / "case_links.json"
CASE_REGISTRY_PATH = PROCESSED / "case_registry.json"
RETENTION_PATH = PROCESSED / "retention.json"
SAVED_SEARCHES_PATH = PROCESSED / "saved_searches.json"
INTEGRATIONS_PATH = PROCESSED / "integrations.json"
SECURITY_PATH = PROCESSED / "security_policy.json"
TASKS_PATH = PROCESSED / "case_tasks.json"
EVIDENCE_ANNOTATIONS_PATH = PROCESSED / "evidence_annotations.json"
DISCLOSURES_PATH = PROCESSED / "disclosures.json"
REPORT_SCHEDULES_PATH = PROCESSED / "report_schedules.json"
GRAPH_VIEWS_PATH = PROCESSED / "graph_views.json"
NARRATIVES_PATH = PROCESSED / "case_narratives.json"
ALERT_RULES_PATH = PROCESSED / "alert_rules.json"
MERGE_REVIEWS_PATH = PROCESSED / "merge_reviews.json"
GRAPH_ANNOTATIONS_PATH = PROCESSED / "graph_annotations.json"
AUTH_DB = PROCESSED / "users.sqlite3"
SESSION_COOKIE = "setu_session"
SESSION_LIFETIME_HOURS = int(os.getenv("SETU_SESSION_LIFETIME_HOURS", "8"))
COOKIE_SECURE = os.getenv("SETU_COOKIE_SECURE", "false").lower() == "true"
PRODUCTION_MODE = os.getenv("SETU_PRODUCTION", "false").lower() == "true"
IDENTITY_PROVIDER = os.getenv("SETU_IDENTITY_PROVIDER", "")
IMMUTABLE_AUDIT_URI = os.getenv("SETU_IMMUTABLE_AUDIT_URI", "")
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


@app.middleware("http")
async def enforce_network_policy(request: Request, call_next):
    """Apply an allowlist only in production; local demos remain usable offline."""
    policy = read_json(SECURITY_PATH, {}) if SECURITY_PATH.exists() else {}
    allowed = set(policy.get("allowed_ips", []))
    client_ip = request.client.host if request.client else ""
    if PRODUCTION_MODE and allowed and client_ip not in allowed:
        return Response(content="Network access is not permitted.", status_code=403)
    return await call_next(request)


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


class StatusUpdate(BaseModel):
    node: str = Field(min_length=2, max_length=160)
    status: str = Field(pattern="^(new|in_progress|monitoring|escalated|resolved)$")
    message: str = Field(min_length=2, max_length=1_000)


class ApprovalDecision(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    rationale: str = Field(min_length=2, max_length=1_000)


class ExternalRequest(BaseModel):
    request_type: str = Field(pattern="^(bank|telecom|platform|forensic_lab|other)$")
    recipient: str = Field(min_length=2, max_length=160)
    subject: str = Field(min_length=3, max_length=300)
    owner: str = Field(min_length=2, max_length=100)
    due_date: str = Field(default="")
    entity: str = Field(default="", max_length=160)
    reference: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=2_000)


class ExternalRequestUpdate(BaseModel):
    status: str = Field(pattern="^(draft|sent|responded|closed)$")
    response_note: str = Field(default="", max_length=2_000)


class EntityTag(BaseModel):
    node: str = Field(min_length=2, max_length=160)
    tag: str = Field(pattern="^(victim|mule_account|beneficiary|cash_out|shared_device|known_associate|person_of_interest|false_positive)$")
    note: str = Field(default="", max_length=1_000)
    active: bool = True


class Assignment(BaseModel):
    node: str = Field(min_length=2, max_length=160)
    assignee: str = Field(min_length=2, max_length=100)
    due_date: str = Field(default="")
    priority: str = Field(default="normal", pattern="^(low|normal|high|urgent)$")


class WatchlistToggle(BaseModel):
    node: str = Field(min_length=2, max_length=160)


class GraphTrace(BaseModel):
    source: str = Field(min_length=2, max_length=160)
    target: str = Field(min_length=2, max_length=160)


class BulkAction(BaseModel):
    nodes: list[str] = Field(min_length=1, max_length=100)
    action: str = Field(pattern="^(assign|tag|watch|status)$")
    assignee: str = Field(default="", max_length=100)
    tag: str = Field(default="", max_length=80)
    status: str = Field(default="", max_length=30)
    message: str = Field(default="", max_length=1_000)


class CaseTemplate(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    typology: str = Field(min_length=2, max_length=100)
    evidence: list[str] = Field(default_factory=list)
    tasks: list[str] = Field(default_factory=list)
    review_questions: list[str] = Field(default_factory=list)
    closure_criteria: list[str] = Field(default_factory=list)


class CollaborationItem(BaseModel):
    kind: str = Field(pattern="^(comment|handoff|waiting_on)$")
    text: str = Field(min_length=2, max_length=2_000)
    entity: str = Field(default="", max_length=160)
    mention: str = Field(default="", max_length=100)
    assignee: str = Field(default="", max_length=100)


class RetentionUpdate(BaseModel):
    retention_deadline: str = Field(default="")
    legal_hold: bool = False
    reason: str = Field(default="", max_length=1_000)


class SavedSearch(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    query: str = Field(default="", max_length=160)
    filters: dict = Field(default_factory=dict)
    shared: bool = False
    alert: bool = False


class SavedGraphView(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    entity: str = Field(default="", max_length=160)
    days: int = Field(default=30, ge=1, le=365)
    risk: str = Field(default="ALL", max_length=20)
    rail: str = Field(default="ALL", max_length=40)
    min_amount: float = Field(default=0, ge=0)
    expand: bool = False
    shared: bool = False


class CaseNarrative(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    summary: str = Field(min_length=10, max_length=5_000)
    entity: str = Field(default="", max_length=160)
    findings: list[str] = Field(default_factory=list, max_length=30)
    charts: list[str] = Field(default_factory=list, max_length=10)
    annotations: list[str] = Field(default_factory=list, max_length=30)


class AlertRule(BaseModel):
    name: str = Field(min_length=3, max_length=100)
    entity: str = Field(default="", max_length=160)
    min_amount: float = Field(default=0, ge=0)
    risk: str = Field(default="HIGH", max_length=20)
    new_evidence: bool = True
    value_threshold: bool = True
    high_risk_cluster: bool = False


class MergeReview(BaseModel):
    entity: str = Field(min_length=2, max_length=160)
    matched_entity: str = Field(min_length=2, max_length=160)
    case_reference: str = Field(min_length=3, max_length=80)
    decision: str = Field(pattern="^(confirmed|rejected|needs_more_evidence)$")
    rationale: str = Field(min_length=3, max_length=1_000)
    confidence: str = Field(default="candidate", pattern="^(low|candidate|probable|high)$")


class GraphAnnotation(BaseModel):
    target_type: str = Field(pattern="^(entity|route)$")
    target: str = Field(min_length=2, max_length=400)
    note: str = Field(min_length=2, max_length=2_000)
    disposition: str = Field(default="reviewed", pattern="^(reviewed|cleared|escalated)$")
    suspected_mule: bool = False


class IntegrationConfig(BaseModel):
    connector: str = Field(pattern="^(telecom|bank_payment|platform|forensic_lab|secure_documents)$")
    enabled: bool = False
    intake_mode: str = Field(default="manual_review", pattern="^(manual_review|approved_pull)$")


class CaseAssociation(BaseModel):
    related_case: str = Field(min_length=3, max_length=80)
    entity: str = Field(min_length=2, max_length=160)
    basis: str = Field(min_length=3, max_length=1_000)


class SensitiveActionRequest(BaseModel):
    action: str = Field(pattern="^(evidence_export|evidence_replacement|watchlist_removal|case_closure|retention_disposition)$")
    reason: str = Field(min_length=3, max_length=1_000)
    node: str = Field(default="CASE", max_length=160)


class SecurityPolicy(BaseModel):
    allowed_ips: list[str] = Field(default_factory=list, max_length=100)
    mfa_required: bool = False


class TaskUpdate(BaseModel):
    status: str = Field(pattern="^(open|in_progress|done|blocked)$")
    note: str = Field(default="", max_length=1_000)


class BoardTask(BaseModel):
    text: str = Field(min_length=3, max_length=500)
    assignee: str = Field(default="", max_length=100)
    due_date: str = Field(default="")
    depends_on: str = Field(default="", max_length=80)
    priority: str = Field(default="normal", pattern="^(low|normal|high|urgent)$")


class EvidenceAnnotation(BaseModel):
    artifact: str = Field(min_length=3, max_length=200)
    row: int = Field(ge=1, le=1_000_000)
    note: str = Field(min_length=2, max_length=2_000)
    label: str = Field(default="review", pattern="^(review|relevant|redact|exception)$")


class DisclosureBundle(BaseModel):
    recipient: str = Field(min_length=2, max_length=160)
    authority_reference: str = Field(min_length=3, max_length=300)
    scope: str = Field(min_length=3, max_length=1_000)


class ReportSchedule(BaseModel):
    cadence: str = Field(pattern="^(daily|weekly|monthly)$")
    recipient: str = Field(min_length=2, max_length=160)


class Credentials(BaseModel):
    username: str = Field(pattern=r"^[a-zA-Z0-9_.-]{3,50}$")
    password: str = Field(min_length=12, max_length=256)


class CreateUser(Credentials):
    role: str = Field(default="investigator", pattern="^(admin|supervisor|investigator)$")


def db() -> sqlite3.Connection:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(AUTH_DB)
    connection.row_factory = sqlite3.Row
    return connection


def init_auth_db() -> None:
    with db() as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'supervisor', 'investigator')),
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        """)
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)")}
        if "is_active" not in columns:
            connection.execute("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
        if "force_password_reset" not in columns:
            connection.execute("ALTER TABLE users ADD COLUMN force_password_reset INTEGER NOT NULL DEFAULT 0")
        if "failed_login_attempts" not in columns:
            connection.execute("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0")
        if "locked_at" not in columns:
            connection.execute("ALTER TABLE users ADD COLUMN locked_at TEXT")
        session_columns = {row["name"] for row in connection.execute("PRAGMA table_info(sessions)")}
        if "ip_address" not in session_columns:
            connection.execute("ALTER TABLE sessions ADD COLUMN ip_address TEXT NOT NULL DEFAULT ''")
        if "user_agent" not in session_columns:
            connection.execute("ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT ''")
        schema = connection.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").fetchone()["sql"]
        # Older local prototypes allowed only admin/user. Rebuild that tiny table
        # once so existing users migrate to the investigator role safely; sessions
        # are intentionally revoked during the schema change.
        if "supervisor" not in schema:
            connection.execute("DROP TABLE IF EXISTS sessions")
            connection.execute("CREATE TABLE users_revised (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin', 'supervisor', 'investigator')), created_at TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, force_password_reset INTEGER NOT NULL DEFAULT 0, failed_login_attempts INTEGER NOT NULL DEFAULT 0, locked_at TEXT)")
            connection.execute("INSERT INTO users_revised (id, username, password_hash, role, created_at, is_active, force_password_reset, failed_login_attempts, locked_at) SELECT id, username, password_hash, CASE WHEN role = 'user' THEN 'investigator' ELSE role END, created_at, is_active, force_password_reset, failed_login_attempts, locked_at FROM users")
            connection.execute("DROP TABLE users")
            connection.execute("ALTER TABLE users_revised RENAME TO users")
            connection.execute("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)")


def hash_password(password: str, salt: bytes | None = None) -> str:
    """Return a salted PBKDF2-SHA256 password hash; passwords are never stored."""
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
    return f"pbkdf2_sha256$600000${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        calculated = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
        return hmac.compare_digest(calculated.hex(), digest_hex)
    except (TypeError, ValueError):
        return False


def public_user(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "username": row["username"], "role": row["role"]}


def session_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(response: Response, user_id: int, request: Request) -> None:
    token = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=SESSION_LIFETIME_HOURS)
    with db() as connection:
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now.isoformat(),))
        connection.execute("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
                           (session_token_hash(token), user_id, expires.isoformat(), now.isoformat(), request.client.host if request.client else "", request.headers.get("user-agent", "")[:300]))
    response.set_cookie(SESSION_COOKIE, token, max_age=int(timedelta(hours=SESSION_LIFETIME_HOURS).total_seconds()),
                        httponly=True, secure=COOKIE_SECURE, samesite="lax", path="/")


def get_current_user(session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE)) -> dict:
    if not session:
        raise HTTPException(status_code=401, detail="Sign in is required.")
    with db() as connection:
        row = connection.execute("""
            SELECT users.id, users.username, users.role FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.is_active = 1
        """, (session_token_hash(session), datetime.now(timezone.utc).isoformat())).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Your session has expired. Please sign in again.")
    return public_user(row)


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Administrator access is required.")
    return user


def require_supervisor(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] not in {"admin", "supervisor"}:
        raise HTTPException(status_code=403, detail="Supervisor or administrator access is required.")
    return user


@app.on_event("startup")
def initialize() -> None:
    init_auth_db()


def read_json(path: Path, default):
    return json.loads(path.read_text()) if path.exists() else default


def write_json(path: Path, value) -> None:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def audit(event: str, details: dict | None = None) -> None:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    previous = ""
    if AUDIT_PATH.exists() and AUDIT_PATH.stat().st_size:
        try:
            previous = json.loads(AUDIT_PATH.read_text().splitlines()[-1]).get("entry_hash", "")
        except (json.JSONDecodeError, IndexError):
            previous = ""
    item = {"at_utc": datetime.now(timezone.utc).isoformat(), "event": event, "details": details or {}, "previous_hash": previous}
    item["entry_hash"] = hashlib.sha256(json.dumps(item, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    with AUDIT_PATH.open("a") as log:
        log.write(json.dumps(item) + "\n")


def custody(event: str, artifact: str, user: dict | None = None, **details) -> dict:
    """Append a custody event; hash and identity fields remain immutable history."""
    items = read_json(CUSTODY_PATH, [])
    item = {"event": event, "artifact": artifact, "at_utc": datetime.now(timezone.utc).isoformat(), **details}
    if user:
        item.update({"user_id": user["id"], "username": user["username"], "role": user["role"]})
    items.append(item)
    write_json(CUSTODY_PATH, items)
    audit(f"evidence_{event}", {"artifact": artifact, **({"user": user["username"]} if user else {})})
    return item


def evidence_attributes() -> dict[str, dict]:
    """Build a small searchable index from staged evidence, without exposing raw files."""
    indexed: dict[str, dict] = {}
    def add(entity: str, **values) -> None:
        if not entity:
            return
        row = indexed.setdefault(str(entity), {"phones": set(), "upis": set(), "imeis": set(), "amount": 0, "dates": []})
        for key, value in values.items():
            if value in (None, ""):
                continue
            if key in {"phones", "upis", "imeis"}:
                row[key].add(str(value))
            elif key == "amount":
                row["amount"] += float(value or 0)
            elif key == "date":
                row["dates"].append(str(value))
    telecom = PROCESSED / "telecom.csv"
    if telecom.exists():
        for row in records(telecom):
            add(row.get("entity_id", ""), phones=row.get("entity_id"), imeis=row.get("imei"), date=row.get("timestamp"))
    upi = PROCESSED / "upi.csv"
    if upi.exists():
        for row in records(upi):
            amount, date = row.get("amount", 0), row.get("timestamp")
            add(row.get("sender_entity_id", ""), phones=row.get("sender_entity_id"), amount=amount, date=date)
            add(row.get("receiver_entity_id", ""), upis=row.get("receiver_entity_id"), amount=amount, date=date)
    return {entity: {**row, "phones": sorted(row["phones"]), "upis": sorted(row["upis"]), "imeis": sorted(row["imeis"]), "date_min": min(row["dates"], default=""), "date_max": max(row["dates"], default="")} for entity, row in indexed.items()}


def duplicate_case_matches() -> list[dict]:
    """Compare current identifiers with the local registered-case index, never merge automatically."""
    current_case = read_json(CASE_PATH, {}).get("case_reference", "")
    current = evidence_attributes()
    matches = []
    for case in read_json(CASE_REGISTRY_PATH, []):
        if case.get("case_reference") == current_case:
            continue
        for entity, attributes in current.items():
            for other in case.get("entities", []):
                shared = []
                for key in ("phones", "upis", "imeis"):
                    shared.extend(f"{key[:-1]}:{value}" for value in set(attributes.get(key, [])) & set(other.get(key, [])))
                if shared:
                    matches.append({"case_reference": case.get("case_reference"), "entity": entity, "matched_entity": other.get("entity"), "identifiers": sorted(shared), "confidence": "candidate"})
    return matches


def records(path: Path) -> list[dict]:
    return pd.read_csv(path).fillna("").to_dict("records") if path.exists() else []


def risk_tier(score: dict | None) -> str:
    """Return the canonical display tier for an entity score row."""
    explicit = str((score or {}).get("risk_tier", "")).upper()
    if explicit in {"LOW", "MEDIUM", "HIGH"}:
        return explicit
    value = float((score or {}).get("risk_score", 0) or 0)
    return "HIGH" if value >= 70 else "MEDIUM" if value >= 40 else "LOW"


def chart_data_model(days: int = 30, risk: str = "ALL", rail: str = "ALL", min_amount: float = 0,
                     max_amount: float | None = None, entity: str = "", expand: bool = False) -> dict:
    """Build a small, filter-aware visual view model on the server, not the browser."""
    days = 60 if int(days) >= 60 else 30
    scores = {str(row.get("node", "")): row for row in records(PROCESSED / "risk_scores.csv")}
    tags, links = read_json(ENTITY_TAGS_PATH, {}), records(PROCESSED / "entity_links.csv")
    parsed = []
    for row in records(PROCESSED / "graph_edges.csv"):
        try:
            at, amount = pd.Timestamp(row.get("timestamp")), float(row.get("amount", 0) or 0)
        except (TypeError, ValueError):
            continue
        sender, receiver = str(row.get("sender", "")), str(row.get("receiver", ""))
        if sender and receiver:
            parsed.append({**row, "sender": sender, "receiver": receiver, "amount": amount, "at": at,
                           "rail": str(row.get("rail") or row.get("payment_rail") or "UPI").upper()})
    newest = max((edge["at"] for edge in parsed), default=pd.Timestamp.now())
    start, risk, rail = newest.normalize() - pd.Timedelta(days=days - 1), str(risk).upper(), str(rail).upper()
    filtered = []
    for edge in parsed:
        edge["risk_tier"] = max((risk_tier(scores.get(edge["sender"])), risk_tier(scores.get(edge["receiver"]))), key=("LOW", "MEDIUM", "HIGH").index)
        if edge["at"] < start or edge["amount"] < max(0, min_amount) or (max_amount is not None and edge["amount"] > max_amount):
            continue
        if (rail == "ALL" or edge["rail"] == rail) and (risk == "ALL" or edge["risk_tier"] == risk):
            filtered.append(edge)
    daily = {str((start + pd.Timedelta(days=i)).date()): {"date": str((start + pd.Timedelta(days=i)).date()), "count": 0, "value": 0.0} for i in range(days)}
    tiers, inbound, outbound = ({tier: {"tier": tier, "count": 0, "value": 0.0} for tier in ("LOW", "MEDIUM", "HIGH")}, {}, {})
    for edge in filtered:
        bucket = daily[str(edge["at"].date())]; bucket["count"] += 1; bucket["value"] += edge["amount"]
        tiers[edge["risk_tier"]]["count"] += 1; tiers[edge["risk_tier"]]["value"] += edge["amount"]
        inbound[edge["receiver"]] = inbound.get(edge["receiver"], 0.0) + edge["amount"]
        outbound[edge["sender"]] = outbound.get(edge["sender"], 0.0) + edge["amount"]
    ranked = sorted(set(inbound) | set(outbound), key=lambda node: inbound.get(node, 0) + outbound.get(node, 0), reverse=True)
    top_entities = [{"id": node, "inbound_value": round(inbound.get(node, 0), 2), "outbound_value": round(outbound.get(node, 0), 2), "risk_tier": risk_tier(scores.get(node)), "tags": tags.get(node, [])} for node in ranked[:15]]
    selected = str(entity or (ranked[0] if ranked else ""))
    direct, counterparties = [edge for edge in filtered if selected in {edge["sender"], edge["receiver"]}], {}
    for edge in direct:
        other = edge["receiver"] if edge["sender"] == selected else edge["sender"]
        item = counterparties.setdefault(other, {"id": other, "inbound_value": 0.0, "outbound_value": 0.0, "value": 0.0, "count": 0})
        item["count"] += 1; item["value"] += edge["amount"]; item["inbound_value" if edge["receiver"] == selected else "outbound_value"] += edge["amount"]
    counterparties = sorted(counterparties.values(), key=lambda item: item["value"], reverse=True)[:15]
    visible = {selected, *(item["id"] for item in counterparties)} if selected else set()
    if expand and visible:
        extra = sorted({node for edge in filtered if edge["sender"] in visible or edge["receiver"] in visible for node in (edge["sender"], edge["receiver"])} - visible, key=lambda node: inbound.get(node, 0) + outbound.get(node, 0), reverse=True)[:15]
        visible.update(extra)
    grouped = {}
    for edge in filtered:
        if edge["sender"] in visible and edge["receiver"] in visible:
            key = (edge["sender"], edge["receiver"]); item = grouped.setdefault(key, {"source": key[0], "target": key[1], "value": 0.0, "count": 0})
            item["value"] += edge["amount"]; item["count"] += 1
    shared_pairs = {frozenset((str(link.get("entity_a", "")), str(link.get("entity_b", "")))) for link in links if str(link.get("relationship", "")).lower() == "shared_device"}
    nodes = [{"id": node, "risk_tier": risk_tier(scores.get(node)), "shared_device": bool(scores.get(node, {}).get("shared_device") in (True, "True", "true", 1, "1")) or any(tag.get("tag") == "shared_device" and tag.get("active", True) for tag in tags.get(node, []))} for node in sorted(visible)]
    graph_edges = [{**item, "value": round(item["value"], 2), "shared_device": frozenset((item["source"], item["target"])) in shared_pairs} for item in grouped.values()]
    return {"filters": {"days": days, "risk": risk, "rail": rail, "min_amount": min_amount, "max_amount": max_amount}, "summary": {"transfer_count": len(filtered), "transfer_value": round(sum(edge["amount"] for edge in filtered), 2)}, "daily": list(daily.values()), "risk_tiers": list(tiers.values()), "top_entities": top_entities, "selected": {"id": selected, "counterparties": counterparties, "path_totals": {"inbound_value": round(sum(edge["amount"] for edge in direct if edge["receiver"] == selected), 2), "outbound_value": round(sum(edge["amount"] for edge in direct if edge["sender"] == selected), 2), "transfer_count": len(direct)}, "shared_device_links": [edge for edge in graph_edges if edge["shared_device"]]}, "relationship_graph": {"nodes": nodes, "edges": graph_edges, "expanded": bool(expand), "counterparty_limit": 15}}


def graph_intelligence() -> dict:
    """Produce explainable components and a time-ordered transaction view."""
    edges = records(PROCESSED / "graph_edges.csv")
    adjacency: dict[str, set[str]] = {}
    for edge in edges:
        sender, receiver = str(edge.get("sender", "")), str(edge.get("receiver", ""))
        if sender and receiver:
            adjacency.setdefault(sender, set()).add(receiver)
            adjacency.setdefault(receiver, set()).add(sender)
    seen, clusters = set(), []
    for start in adjacency:
        if start in seen:
            continue
        stack, component = [start], []
        seen.add(start)
        while stack:
            node = stack.pop(); component.append(node)
            for neighbour in adjacency[node]:
                if neighbour not in seen:
                    seen.add(neighbour); stack.append(neighbour)
        internal = sum(1 for edge in edges if str(edge.get("sender")) in component and str(edge.get("receiver")) in component)
        if len(component) >= 3:
            clusters.append({"id": f"CL-{len(clusters)+1:03}", "entities": sorted(component), "entity_count": len(component), "links": internal,
                             "signal": "Potential coordinated ring" if internal >= len(component) else "Connected investigation cluster"})
    timeline = sorted(edges, key=lambda edge: str(edge.get("timestamp", "")))
    return {"clusters": sorted(clusters, key=lambda item: (item["links"], item["entity_count"]), reverse=True), "timeline": timeline}


def shortest_path(source: str, target: str) -> dict:
    edges = records(PROCESSED / "graph_edges.csv")
    adjacency: dict[str, list[tuple[str, dict]]] = {}
    for edge in edges:
        sender, receiver = str(edge.get("sender", "")), str(edge.get("receiver", ""))
        if sender and receiver:
            adjacency.setdefault(sender, []).append((receiver, edge))
            adjacency.setdefault(receiver, []).append((sender, edge))
    queue, visited = [(source, [])], {source}
    while queue:
        node, path = queue.pop(0)
        if node == target:
            return {"connected": True, "nodes": [source] + [step[0] for step in path], "steps": [{"to": to, "relationship": "UPI transfer" if str(edge.get("sender")) == previous else "Linked transfer", "amount": edge.get("amount", 0), "timestamp": edge.get("timestamp", "")} for previous, (to, edge) in zip([source] + [p[0] for p in path[:-1]], path)]}
        for neighbour, edge in adjacency.get(node, []):
            if neighbour not in visited:
                visited.add(neighbour); queue.append((neighbour, path + [(neighbour, edge)]))
    return {"connected": False, "nodes": [], "steps": []}


def compare_paths(source: str, target: str, max_hops: int = 6) -> dict:
    """Return distinct directed transfer routes, ranked for investigation review."""
    scores = {str(row.get("node", "")): row for row in records(PROCESSED / "risk_scores.csv")}
    adjacency: dict[str, list[dict]] = {}
    for edge in records(PROCESSED / "graph_edges.csv"):
        sender, receiver = str(edge.get("sender", "")), str(edge.get("receiver", ""))
        if sender and receiver:
            adjacency.setdefault(sender, []).append({**edge, "sender": sender, "receiver": receiver,
                                                       "amount": float(edge.get("amount", 0) or 0)})
    routes: list[dict] = []
    def visit(node: str, nodes: list[str], edges: list[dict]) -> None:
        if len(routes) >= 100 or len(edges) >= max_hops:
            return
        for edge in adjacency.get(node, []):
            nxt = edge["receiver"]
            if nxt in nodes:
                continue
            route_nodes, route_edges = nodes + [nxt], edges + [edge]
            if nxt == target:
                tiers = [risk_tier(scores.get(item)) for item in route_nodes]
                risk = max(tiers, key=("LOW", "MEDIUM", "HIGH").index)
                routes.append({"nodes": route_nodes, "hops": len(route_edges),
                               "value": round(sum(item["amount"] for item in route_edges), 2),
                               "bottleneck_value": round(min(item["amount"] for item in route_edges), 2),
                               "risk": risk, "transfers": [{"from": item["sender"], "to": item["receiver"], "amount": item["amount"], "timestamp": item.get("timestamp", "")} for item in route_edges]})
            else:
                visit(nxt, route_nodes, route_edges)
    visit(source, [source], [])
    risk_rank = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    routes.sort(key=lambda item: (-item["bottleneck_value"], item["hops"], risk_rank[item["risk"]], -item["value"]))
    for index, route in enumerate(routes, 1):
        route["rank"] = index
    return {"source": source, "target": target, "routes": routes, "max_hops": max_hops}


def entity_traceability(entity: str) -> dict:
    """Link one graph identity back to row-level evidence without guessing provenance."""
    entity = str(entity).strip()
    csv_rows, documents = [], []
    for path in sorted(RAW.glob("*.csv")):
        try:
            for number, row in enumerate(records(path), 1):
                if any(entity.lower() == str(value).strip().lower() for value in row.values()):
                    csv_rows.append({"artifact": path.name, "row": number, "fields": {key: str(value) for key, value in row.items() if str(value).strip()}})
        except (OSError, UnicodeDecodeError, pd.errors.ParserError):
            continue
    manifest = read_json(PROCESSED / "manifest.json", {})
    for name, item in manifest.items():
        documents.append({"artifact": name, "sha256": item.get("sha256", ""), "rows": item.get("rows", "")})
    attrs = evidence_attributes().get(entity, {})
    annotations = [item for items in read_json(EVIDENCE_ANNOTATIONS_PATH, {}).values() for item in items if entity.lower() in json.dumps(item).lower()]
    notes = [item for item in read_json(NOTES_PATH, []) if entity.lower() in json.dumps(item).lower()]
    notes.extend(item for item in read_json(GRAPH_ANNOTATIONS_PATH, []) if entity.lower() in item.get("target", "").lower() or entity.lower() in item.get("note", "").lower())
    return {"entity": entity, "csv_rows": csv_rows[:100], "documents": documents, "device_ids": attrs.get("imeis", []),
            "identifiers": {key: attrs.get(key, []) for key in ("phones", "upis")}, "notes": notes, "evidence_annotations": annotations}


@app.get("/")
def home() -> FileResponse:
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.get("/login")
def login_page() -> FileResponse:
    return FileResponse(Path(__file__).parent / "static" / "login.html")


@app.get("/api/auth/setup-status")
def setup_status() -> dict:
    """Report whether an operator has provisioned at least one terminal-created account."""
    with db() as connection:
        has_users = connection.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
    return {"has_users": has_users}


@app.post("/api/auth/login")
def login(credentials: Credentials, response: Response, request: Request) -> dict:
    with db() as connection:
        row = connection.execute("SELECT id, username, password_hash, role, force_password_reset, failed_login_attempts, locked_at FROM users WHERE username = ? AND is_active = 1", (credentials.username,)).fetchone()
        if row and row["locked_at"]:
            raise HTTPException(status_code=423, detail="This account is locked. Contact an administrator for a terminal reset.")
        if not row or not verify_password(credentials.password, row["password_hash"]):
            if row:
                attempts = int(row["failed_login_attempts"] or 0) + 1
                lock = datetime.now(timezone.utc).isoformat() if attempts >= 5 else None
                connection.execute("UPDATE users SET failed_login_attempts = ?, locked_at = ? WHERE id = ?", (attempts, lock, row["id"]))
            raise HTTPException(status_code=401, detail="Invalid username or password.")
        connection.execute("UPDATE users SET failed_login_attempts = 0 WHERE id = ?", (row["id"],))
    user = public_user(row)
    create_session(response, user["id"], request)
    audit("user_logged_in", {"user_id": user["id"], "username": user["username"]})
    return {**user, "force_password_reset": bool(row["force_password_reset"])}


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=12, max_length=256)
    new_password: str = Field(min_length=12, max_length=256)


@app.post("/api/auth/change-password")
def change_password(change: PasswordChange, user: dict = Depends(get_current_user)) -> dict:
    with db() as connection:
        row = connection.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not row or not verify_password(change.current_password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect.")
        connection.execute("UPDATE users SET password_hash = ?, force_password_reset = 0, failed_login_attempts = 0, locked_at = NULL WHERE id = ?", (hash_password(change.new_password), user["id"]))
    audit("password_changed", {"username": user["username"], "self_service": True})
    return {"message": "Password updated."}


@app.post("/api/auth/logout", status_code=204)
def logout(response: Response, session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE)) -> Response:
    """Revoke a session when present and always clear the browser cookie.

    Logout is intentionally idempotent so a user can leave cleanly even if a
    session expired while the dashboard was open.
    """
    user = None
    if session:
        with db() as connection:
            row = connection.execute("""
                SELECT users.id, users.username, users.role FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token_hash = ?
            """, (session_token_hash(session),)).fetchone()
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (session_token_hash(session),))
            user = public_user(row) if row else None
    response.delete_cookie(SESSION_COOKIE, path="/")
    if user:
        audit("user_logged_out", {"user_id": user["id"], "username": user["username"]})
    response.status_code = 204
    return response


@app.get("/api/auth/me")
def current_user(user: dict = Depends(get_current_user)) -> dict:
    with db() as connection:
        reset = connection.execute("SELECT force_password_reset FROM users WHERE id = ?", (user["id"],)).fetchone()
    return {**user, "force_password_reset": bool(reset and reset["force_password_reset"])}


@app.get("/api/security/sessions")
def session_history(_: dict = Depends(require_admin)) -> list[dict]:
    with db() as connection:
        rows = connection.execute("""SELECT sessions.user_id, users.username, sessions.created_at, sessions.expires_at, sessions.ip_address, sessions.user_agent
                                     FROM sessions JOIN users ON users.id = sessions.user_id ORDER BY sessions.created_at DESC""").fetchall()
    return [dict(row) for row in rows]


@app.post("/api/security/revoke-sessions/{username}")
def revoke_user_sessions(username: str, admin: dict = Depends(require_admin)) -> dict:
    with db() as connection:
        result = connection.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)", (username,))
    audit("admin_sessions_revoked", {"username": username, "count": result.rowcount, "by": admin["username"]})
    return {"revoked": result.rowcount, "username": username}


@app.post("/api/security/policy")
def save_security_policy(policy: SecurityPolicy, admin: dict = Depends(require_admin)) -> dict:
    value = {**policy.model_dump(), "updated_by": admin["username"], "updated_at_utc": datetime.now(timezone.utc).isoformat()}
    write_json(SECURITY_PATH, value); audit("security_policy_updated", {"mfa_required": policy.mfa_required, "ip_rules": len(policy.allowed_ips), "by": admin["username"]})
    return value


@app.get("/api/case")
def case_data(_: dict = Depends(get_current_user)) -> dict:
    scores = records(PROCESSED / "risk_scores.csv")
    links = records(PROCESSED / "entity_links.csv")
    edges = records(PROCESSED / "graph_edges.csv")
    manifest_path = PROCESSED / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    return {
        "ready": bool(scores), "scores": scores, "links": links, "edges": edges,
        "manifest": manifest, "case": read_json(CASE_PATH, {}), "notes": read_json(NOTES_PATH, []),
        "reviews": read_json(REVIEWS_PATH, {}), "status_updates": read_json(STATUS_UPDATES_PATH, {}),
        "approvals": read_json(APPROVALS_PATH, []),
        "external_requests": read_json(REQUESTS_PATH, []),
        "entity_tags": read_json(ENTITY_TAGS_PATH, {}),
        "assignments": read_json(ASSIGNMENTS_PATH, {}), "watchlists": read_json(WATCHLISTS_PATH, {}),
        "custody": read_json(CUSTODY_PATH, []), "entity_attributes": evidence_attributes(), "analytics": case_analytics(),
        "graph_intelligence": graph_intelligence(), "templates": read_json(TEMPLATES_PATH, []),
        "collaboration": read_json(COLLABORATION_PATH, []), "case_links": read_json(CASE_LINKS_PATH, []),
        "duplicate_matches": duplicate_case_matches(),
        "retention": read_json(RETENTION_PATH, {}), "saved_searches": read_json(SAVED_SEARCHES_PATH, []),
        "graph_views": read_json(GRAPH_VIEWS_PATH, []), "case_narratives": read_json(NARRATIVES_PATH, []),
        "alert_rules": read_json(ALERT_RULES_PATH, []), "merge_reviews": read_json(MERGE_REVIEWS_PATH, []),
        "graph_annotations": read_json(GRAPH_ANNOTATIONS_PATH, []),
        "integrations": read_json(INTEGRATIONS_PATH, {}), "security_policy": read_json(SECURITY_PATH, {}),
        "tasks": read_json(TASKS_PATH, []),
        "evidence_annotations": read_json(EVIDENCE_ANNOTATIONS_PATH, {}),
        "disclosures": read_json(DISCLOSURES_PATH, []),
        "report_schedules": read_json(REPORT_SCHEDULES_PATH, []),
        "audit": [json.loads(line) for line in AUDIT_PATH.read_text().splitlines()[-20:]] if AUDIT_PATH.exists() else [],
        "report_available": (REPORT / "setu_brief.pdf").exists(),
    }


@app.get("/api/chart-data")
def chart_data(days: int = 30, risk: str = "ALL", rail: str = "ALL", min_amount: float = 0,
               max_amount: Optional[float] = None, entity: str = "", expand: bool = False,
               _: dict = Depends(get_current_user)) -> dict:
    """Return server-aggregated, filter-aware data for the visual analysis panel."""
    if days not in {30, 60}:
        raise HTTPException(status_code=422, detail="days must be 30 or 60")
    if str(risk).upper() not in {"ALL", "LOW", "MEDIUM", "HIGH"}:
        raise HTTPException(status_code=422, detail="Unknown risk tier")
    if min_amount < 0 or (max_amount is not None and max_amount < min_amount):
        raise HTTPException(status_code=422, detail="Invalid amount range")
    return chart_data_model(days, risk, rail, min_amount, max_amount, entity, expand)


def redacted_entity_label(entity: str) -> str:
    """Keep exported relationship diagrams useful without disclosing identifiers."""
    digest = hashlib.sha256(str(entity).encode()).hexdigest()[:6].upper()
    return f"ENTITY-{digest}"


def exported_relationship_graph(model: dict) -> tuple[list[dict], list[dict]]:
    """Return redacted nodes and directed transfer routes for visual exports."""
    graph = model["relationship_graph"]
    selected = model["selected"].get("id", "")
    raw_nodes = sorted(graph["nodes"], key=lambda node: node["id"] != selected)
    nodes = [{**node, "label": redacted_entity_label(node["id"])} for node in raw_nodes]
    labels = {node["id"]: node["label"] for node in nodes}
    edges = [{**edge, "source_label": labels.get(edge["source"], redacted_entity_label(edge["source"])),
              "target_label": labels.get(edge["target"], redacted_entity_label(edge["target"]))}
             for edge in graph["edges"]]
    return nodes, edges


def relationship_positions(nodes: list[dict], width: float, height: float) -> dict[str, tuple[float, float]]:
    """Lay out the selected entity centrally and its routes around it."""
    if not nodes:
        return {}
    focal = next((node for node in nodes if node.get("id") == nodes[0].get("id")), nodes[0])
    positions = {focal["id"]: (width / 2, height / 2)}
    others = [node for node in nodes if node["id"] != focal["id"]]
    if not others:
        return positions
    import math
    radius_x, radius_y = max(100, width * .39), max(70, height * .34)
    for index, node in enumerate(others):
        angle = -math.pi / 2 + (2 * math.pi * index / len(others))
        positions[node["id"]] = (width / 2 + radius_x * math.cos(angle), height / 2 + radius_y * math.sin(angle))
    return positions


def draw_pdf_transaction_routes(page: canvas.Canvas, nodes: list[dict], edges: list[dict], x: float, y: float, width: float, height: float) -> None:
    """Draw a readable, directed transaction route diagram on a ReportLab canvas."""
    positions = relationship_positions(nodes, width, height)
    risk_colors = {"LOW": colors.HexColor("#71d3df"), "MEDIUM": colors.HexColor("#f5b971"), "HIGH": colors.HexColor("#ef7070")}
    page.setStrokeColor(colors.HexColor("#45656a")); page.setFillColor(colors.HexColor("#b6c5c8"))
    for edge in edges:
        start, end = positions.get(edge["source"]), positions.get(edge["target"])
        if not start or not end:
            continue
        sx, sy, tx, ty = x + start[0], y + start[1], x + end[0], y + end[1]
        dx, dy = tx - sx, ty - sy
        distance = max((dx * dx + dy * dy) ** .5, 1)
        ux, uy = dx / distance, dy / distance
        page.setLineWidth(min(3, 0.8 + (edge.get("value", 0) ** .5) / 600))
        page.line(sx + ux * 29, sy + uy * 18, tx - ux * 29, ty - uy * 18)
        tip_x, tip_y = tx - ux * 25, ty - uy * 15
        page.setFillColor(colors.HexColor("#45656a"))
        path = page.beginPath(); path.moveTo(tip_x, tip_y); path.lineTo(tip_x - ux * 9 - uy * 5, tip_y - uy * 9 + ux * 5); path.lineTo(tip_x - ux * 9 + uy * 5, tip_y - uy * 9 - ux * 5); path.close()
        page.drawPath(path, fill=1, stroke=0)
        page.setFillColor(colors.HexColor("#b6c5c8")); page.setFont("Helvetica", 6)
        page.drawCentredString((sx + tx) / 2, (sy + ty) / 2 + 4, f"INR {edge['value']:,.0f} · {edge['count']} tx")
    for node in nodes:
        nx, ny = positions[node["id"]]; nx, ny = x + nx, y + ny
        page.setFillColor(risk_colors.get(node.get("risk_tier"), colors.HexColor("#71d3df")))
        page.circle(nx, ny, 18 if node == nodes[0] else 14, fill=1, stroke=0)
        page.setFillColor(colors.HexColor("#10181e")); page.setFont("Helvetica-Bold", 6)
        page.drawCentredString(nx, ny - 2, node["label"].replace("ENTITY-", "E-"))


def draw_png_transaction_routes(draw, nodes: list[dict], edges: list[dict], x: int, y: int, width: int, height: int) -> None:
    """Draw the same redacted directed route diagram for the raster export."""
    positions = relationship_positions(nodes, width, height)
    risk_colors = {"LOW": "#71d3df", "MEDIUM": "#f5b971", "HIGH": "#ef7070"}
    for edge in edges:
        start, end = positions.get(edge["source"]), positions.get(edge["target"])
        if not start or not end:
            continue
        sx, sy, tx, ty = x + start[0], y + start[1], x + end[0], y + end[1]
        draw.line((sx, sy, tx, ty), fill="#45656a", width=max(1, min(5, int(1 + (edge.get("value", 0) ** .5) / 500))))
        distance = max(((tx - sx) ** 2 + (ty - sy) ** 2) ** .5, 1)
        ux, uy = (tx - sx) / distance, (ty - sy) / distance
        tip_x, tip_y = tx - ux * 22, ty - uy * 22
        draw.polygon([(tip_x, tip_y), (tip_x - ux * 10 - uy * 6, tip_y - uy * 10 + ux * 6),
                      (tip_x - ux * 10 + uy * 6, tip_y - uy * 10 - ux * 6)], fill="#45656a")
        draw.text(((sx + tx) / 2 + 4, (sy + ty) / 2 + 4), f"₹{edge['value']:,.0f} · {edge['count']} tx", fill="#b6c5c8")
    for node in nodes:
        nx, ny = positions[node["id"]]; nx, ny = x + nx, y + ny
        radius = 25 if node == nodes[0] else 20
        draw.ellipse((nx - radius, ny - radius, nx + radius, ny + radius), fill=risk_colors.get(node.get("risk_tier"), "#71d3df"), outline="#e7f0ed")
        draw.text((nx - radius + 3, ny - 4), node["label"].replace("ENTITY-", "E-"), fill="#10181e")


@app.get("/api/chart-data/export")
def export_chart_data(format: str = "pdf", days: int = 30, risk: str = "ALL", rail: str = "ALL",
                      min_amount: float = 0, max_amount: Optional[float] = None, entity: str = "", expand: bool = False,
                      user: dict = Depends(require_supervisor)) -> Response:
    """Export a redacted visual summary and record the controlled disclosure action."""
    if format.lower() not in {"pdf", "png"}:
        raise HTTPException(status_code=422, detail="format must be pdf or png")
    model = chart_data_model(days, risk, rail, min_amount, max_amount, entity, expand)
    selected = model["selected"]
    # Export intentionally contains opaque entity labels only; identifiers stay in the live workspace.
    lines = ["SETU · REDACTED VISUAL ANALYSIS", f"Selected: {redacted_entity_label(selected['id']) if selected['id'] else 'No entity'}",
             f"Transfers: {model['summary']['transfer_count']}  |  Value: INR {model['summary']['transfer_value']:,.0f}",
             f"Period: {model['filters']['days']} days  |  Risk: {model['filters']['risk']}  |  Rail: {model['filters']['rail']}", "", "Top counterparties (redacted):"]
    lines.extend(f"{redacted_entity_label(item['id'])} · INR {item['value']:,.0f} · {item['count']} transfers" for item in selected["counterparties"])
    nodes, routes = exported_relationship_graph(model)
    if format.lower() == "pdf":
        output = io.BytesIO(); page = canvas.Canvas(output, pagesize=landscape(A4)); page_width, height = landscape(A4)
        y = height - 56
        for line in lines:
            page.drawString(48, y, line[:110]); y -= 18
            if y < height - 210: break
        page.setStrokeColor(colors.HexColor("#45656a")); page.line(48, y - 5, page_width - 48, y - 5)
        page.setFillColor(colors.HexColor("#10181e")); page.setFont("Helvetica-Bold", 13)
        page.drawString(48, y - 31, "TRANSACTION ROUTE FLOWCHART")
        page.setFont("Helvetica", 8); page.setFillColor(colors.HexColor("#52636a"))
        page.drawString(48, y - 45, "Arrows show the direction of aggregated transfers. Entity labels are redacted for controlled disclosure.")
        draw_pdf_transaction_routes(page, nodes, routes, 48, 44, page_width - 96, max(130, y - 105))
        page.save()
        audit("redacted_visual_analysis_exported", {"format": "pdf", "entity": bool(entity), "days": days, "by": user["username"]})
        custody("exported_redacted", "visual_analysis.pdf", user, source="chart_data_export", filters=model["filters"])
        return Response(content=output.getvalue(), media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=setu_redacted_visual_analysis.pdf"})
    # PNG is a deliberately simple, redacted image brief. Pillow is optional at runtime.
    try:
        from PIL import Image, ImageDraw
    except ImportError as exc:
        raise HTTPException(status_code=501, detail="PNG export support is not installed.") from exc
    image = Image.new("RGB", (1400, max(700, 160 + len(lines) * 24)), "#10181e"); draw = ImageDraw.Draw(image)
    for index, line in enumerate(lines): draw.text((40, 32 + index * 28), line, fill="#c9ff53" if index == 0 else "#e7f0ed")
    graph_top = min(image.height - 470, 70 + len(lines) * 28)
    draw.line((40, graph_top, image.width - 40, graph_top), fill="#45656a")
    draw.text((40, graph_top + 16), "TRANSACTION ROUTE FLOWCHART · arrows show transfer direction", fill="#c9ff53")
    draw_png_transaction_routes(draw, nodes, routes, 40, graph_top + 55, image.width - 80, image.height - graph_top - 75)
    output = io.BytesIO(); image.save(output, format="PNG")
    audit("redacted_visual_analysis_exported", {"format": "png", "entity": bool(entity), "days": days, "by": user["username"]})
    custody("exported_redacted", "visual_analysis.png", user, source="chart_data_export", filters=model["filters"])
    return Response(content=output.getvalue(), media_type="image/png", headers={"Content-Disposition": "attachment; filename=setu_redacted_visual_analysis.png"})


@app.get("/api/evidence-preview/{artifact}")
def evidence_preview(artifact: str, _: dict = Depends(get_current_user)) -> dict:
    """Return a bounded, read-only record preview; raw evidence never leaves this endpoint."""
    name = Path(artifact).name
    path = RAW / name
    if not path.exists() or path.suffix.lower() != ".csv":
        raise HTTPException(status_code=404, detail="Evidence artifact is not available for preview.")
    try:
        frame = pd.read_csv(path, nrows=100).fillna("")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Evidence preview could not be generated.") from exc
    return {"artifact": name, "columns": list(frame.columns), "rows": frame.astype(str).to_dict(orient="records"),
            "annotations": read_json(EVIDENCE_ANNOTATIONS_PATH, {}).get(name, [])}


@app.post("/api/evidence-annotations")
def annotate_evidence(item: EvidenceAnnotation, user: dict = Depends(get_current_user)) -> dict:
    annotations = read_json(EVIDENCE_ANNOTATIONS_PATH, {})
    entry = {**item.model_dump(), "author": user["username"], "at_utc": datetime.now(timezone.utc).isoformat()}
    annotations.setdefault(Path(item.artifact).name, []).insert(0, entry)
    write_json(EVIDENCE_ANNOTATIONS_PATH, annotations)
    audit("evidence_annotated", {"artifact": entry["artifact"], "row": entry["row"], "label": entry["label"], "by": user["username"]})
    return entry


@app.get("/api/evidence-export/{artifact}")
def redacted_evidence_export(artifact: str, user: dict = Depends(require_supervisor)) -> Response:
    """Create a deliberately redacted CSV for controlled disclosure/export."""
    consume_approval("evidence_export", user)
    name, path = Path(artifact).name, RAW / Path(artifact).name
    if not path.exists() or path.suffix.lower() != ".csv":
        raise HTTPException(status_code=404, detail="Evidence artifact not found.")
    frame = pd.read_csv(path)
    sensitive = {"phone_number", "sender_phone", "receiver_phone", "imei", "imsi", "upi_handle", "receiver_upi", "account_number", "address", "name"}
    for column in frame.columns:
        if column.lower() in sensitive:
            frame[column] = "[REDACTED]"
    output = io.StringIO(); frame.to_csv(output, index=False)
    custody("exported_redacted", name, user, source="redacted_evidence_export")
    audit("redacted_evidence_exported", {"artifact": name, "by": user["username"]})
    return Response(content=output.getvalue(), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=redacted_{name}"})


@app.post("/api/board-tasks")
def create_board_task(item: BoardTask, user: dict = Depends(get_current_user)) -> dict:
    tasks = read_json(TASKS_PATH, [])
    if item.depends_on and not any(task.get("id") == item.depends_on for task in tasks):
        raise HTTPException(status_code=400, detail="Dependency task was not found.")
    entry = {"id": f"TSK-{secrets.token_hex(4).upper()}", **item.model_dump(), "status": "open", "created_by": user["username"],
             "created_at_utc": datetime.now(timezone.utc).isoformat(), "history": []}
    tasks.insert(0, entry); write_json(TASKS_PATH, tasks)
    audit("board_task_created", {"task": entry["id"], "assignee": entry["assignee"], "by": user["username"]})
    return entry


@app.post("/api/disclosures")
def create_disclosure(item: DisclosureBundle, user: dict = Depends(require_supervisor)) -> dict:
    consume_approval("evidence_export", user)
    bundles = read_json(DISCLOSURES_PATH, [])
    entry = {"id": f"DISC-{secrets.token_hex(4).upper()}", **item.model_dump(), "status": "prepared", "prepared_by": user["username"], "prepared_at_utc": datetime.now(timezone.utc).isoformat()}
    bundles.insert(0, entry); write_json(DISCLOSURES_PATH, bundles)
    audit("disclosure_bundle_prepared", {"bundle": entry["id"], "recipient": entry["recipient"], "by": user["username"]})
    return entry


@app.post("/api/report-schedules")
def create_report_schedule(item: ReportSchedule, user: dict = Depends(require_supervisor)) -> dict:
    schedules = read_json(REPORT_SCHEDULES_PATH, [])
    entry = {"id": f"RPT-{secrets.token_hex(4).upper()}", **item.model_dump(), "enabled": True, "created_by": user["username"], "created_at_utc": datetime.now(timezone.utc).isoformat()}
    schedules.insert(0, entry); write_json(REPORT_SCHEDULES_PATH, schedules)
    audit("supervisor_report_scheduled", {"schedule": entry["id"], "cadence": entry["cadence"], "by": user["username"]})
    return entry


@app.post("/api/graph/trace")
def trace_graph(trace: GraphTrace, user: dict = Depends(get_current_user)) -> dict:
    result = shortest_path(trace.source, trace.target)
    audit("graph_path_traced", {"source": trace.source, "target": trace.target, "connected": result["connected"], "by": user["username"]})
    return result


@app.post("/api/graph/paths")
def compare_graph_paths(trace: GraphTrace, user: dict = Depends(get_current_user)) -> dict:
    result = compare_paths(trace.source, trace.target)
    audit("graph_paths_compared", {"source": trace.source, "target": trace.target, "routes": len(result["routes"]), "by": user["username"]})
    return result


@app.get("/api/entities/{entity}/traceability")
def entity_evidence_traceability(entity: str, user: dict = Depends(get_current_user)) -> dict:
    result = entity_traceability(entity)
    audit("entity_traceability_viewed", {"entity": entity, "rows": len(result["csv_rows"]), "by": user["username"]})
    return result


@app.post("/api/graph-annotations")
def add_graph_annotation(annotation: GraphAnnotation, user: dict = Depends(get_current_user)) -> dict:
    items = read_json(GRAPH_ANNOTATIONS_PATH, [])
    entry = {"id": f"ANN-{secrets.token_hex(4).upper()}", **annotation.model_dump(), "author": user["username"], "created_at_utc": datetime.now(timezone.utc).isoformat()}
    items.insert(0, entry); write_json(GRAPH_ANNOTATIONS_PATH, items)
    audit("graph_annotation_added", {"annotation": entry["id"], "target": entry["target"], "disposition": entry["disposition"], "by": user["username"]})
    return entry


@app.get("/api/audit/verify")
def verify_audit(_: dict = Depends(require_supervisor)) -> dict:
    previous, count, legacy = "", 0, 0
    for line in AUDIT_PATH.read_text().splitlines() if AUDIT_PATH.exists() else []:
        item = json.loads(line)
        if "entry_hash" not in item and not previous:
            legacy += 1
            continue
        supplied = item.pop("entry_hash", "")
        valid_hash = hashlib.sha256(json.dumps(item, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        if item.get("previous_hash", "") != previous or supplied != valid_hash:
            return {"valid": False, "checked": count, "legacy_entries": legacy, "checkpoint": previous}
        previous, count = supplied, count + 1
    return {"valid": True, "checked": count, "legacy_entries": legacy, "checkpoint": previous}


def case_analytics() -> dict:
    assignments, updates = read_json(ASSIGNMENTS_PATH, {}), read_json(STATUS_UPDATES_PATH, {})
    statuses = [history[0].get("status", "new") for history in updates.values() if history]
    workload: dict[str, int] = {}
    for assignment in assignments.values():
        workload[assignment.get("assignee", "Unassigned")] = workload.get(assignment.get("assignee", "Unassigned"), 0) + 1
    resolved = [history[0] for history in updates.values() if history and history[0].get("status") == "resolved"]
    durations = []
    for update in resolved:
        try:
            durations.append((datetime.now(timezone.utc) - datetime.fromisoformat(update["updated_at_utc"])).total_seconds() / 3600)
        except (KeyError, ValueError):
            pass
    sla = sla_summary(assignments)
    scores = records(PROCESSED / "risk_scores.csv")
    attrs = evidence_attributes()
    device_reuse = sum(1 for item in attrs.values() if len(item.get("imeis", [])) > 1)
    typologies: dict[str, int] = {}
    for entries in read_json(ENTITY_TAGS_PATH, {}).values():
        for entry in entries: typologies[entry.get("tag", "unclassified")] = typologies.get(entry.get("tag", "unclassified"), 0) + 1
    return {"by_status": {status: statuses.count(status) for status in ("new", "in_progress", "monitoring", "escalated", "resolved")},
            "escalation_rate": round((statuses.count("escalated") / len(statuses) * 100) if statuses else 0, 1),
            "average_resolution_hours": round(sum(durations) / len(durations), 1) if durations else None,
            "workload": workload, "sla": sla, "risk_tiers": {tier: sum(1 for row in scores if row.get("risk_tier") == tier) for tier in ("HIGH", "MEDIUM", "LOW")},
            "typologies": typologies, "device_reuse_entities": device_reuse, "payment_rails": {"UPI": len(records(PROCESSED / "upi.csv"))}}


def sla_summary(assignments: dict | None = None) -> dict:
    assignments = assignments if assignments is not None else read_json(ASSIGNMENTS_PATH, {})
    today = datetime.now(timezone.utc).date()
    summary = {"on_track": 0, "due_today": 0, "overdue": 0, "undated": 0}
    for assignment in assignments.values():
        due = assignment.get("due_date", "")
        if not due:
            summary["undated"] += 1
            continue
        try:
            days = (datetime.fromisoformat(due).date() - today).days
            summary["overdue" if days < 0 else "due_today" if days == 0 else "on_track"] += 1
        except ValueError:
            summary["undated"] += 1
    return summary


@app.get("/api/evidence-chain")
def evidence_chain(user: dict = Depends(get_current_user)) -> list[dict]:
    manifest = read_json(PROCESSED / "manifest.json", {})
    for artifact in manifest:
        custody("accessed", artifact, user, source="integrity_view", sha256=manifest[artifact].get("sha256", ""))
    return read_json(CUSTODY_PATH, [])


@app.post("/api/pipeline")
def run_pipeline(user: dict = Depends(require_supervisor)) -> dict:
    telecom, upi = RAW / "telecom_cdr.csv", RAW / "upi_settlement.csv"
    available = [path.exists() for path in (telecom, upi)]
    if any(available) and not all(available):
        raise HTTPException(
            status_code=400,
            detail="Stage both Telecom CDR and UPI settlement evidence before running correlation.",
        )

    # Do not overwrite operator-staged evidence. A demo data set is created only
    # for an empty workspace, which keeps the intake workflow usable end to end.
    steps = STEPS if not all(available) else STEPS[1:]
    completed = []
    for label, script in steps:
        result = subprocess.run([sys.executable, str(ROOT / script)], capture_output=True, text=True, cwd=ROOT)
        if result.returncode:
            raise HTTPException(status_code=500, detail={"step": label, "error": result.stderr[-1_500:]})
        completed.append({"step": label, "output": result.stdout.strip()})
        audit("pipeline_step_completed", {"step": label})
    source = "staged evidence" if all(available) else "new synthetic evidence"
    manifest = read_json(PROCESSED / "manifest.json", {})
    prior = read_json(CUSTODY_PATH, [])
    for name, details in manifest.items():
        if not any(item.get("artifact") == name and item.get("sha256") == details.get("sha256") for item in prior):
            custody("ingested", name, user, source=source, sha256=details.get("sha256", ""), bytes=details.get("size_bytes", 0))
    audit("pipeline_completed", {"source": source, "steps": len(completed)})
    return {"completed": completed, "source": source}


@app.post("/api/case")
def save_case(metadata: CaseMetadata, _: dict = Depends(get_current_user)) -> dict:
    write_json(CASE_PATH, metadata.model_dump())
    registry = [item for item in read_json(CASE_REGISTRY_PATH, []) if item.get("case_reference") != metadata.case_reference]
    registry.append({"case_reference": metadata.case_reference, "title": metadata.title, "updated_at_utc": datetime.now(timezone.utc).isoformat(),
                     "entities": [{"entity": entity, "phones": values.get("phones", []), "upis": values.get("upis", []), "imeis": values.get("imeis", [])} for entity, values in evidence_attributes().items()]})
    write_json(CASE_REGISTRY_PATH, registry)
    audit("case_metadata_updated", {"case_reference": metadata.case_reference, "officer": metadata.officer})
    return metadata.model_dump()


@app.post("/api/notes")
def add_note(note: Note, _: dict = Depends(get_current_user)) -> dict:
    notes = read_json(NOTES_PATH, [])
    entry = {**note.model_dump(), "at_utc": datetime.now(timezone.utc).isoformat()}
    notes.insert(0, entry); write_json(NOTES_PATH, notes)
    audit("analyst_note_added", {"author": note.author})
    return entry


@app.post("/api/reviews")
def save_review(review: Review, _: dict = Depends(get_current_user)) -> dict:
    reviews = read_json(REVIEWS_PATH, {})
    entry = {**review.model_dump(), "updated_at_utc": datetime.now(timezone.utc).isoformat()}
    reviews[review.node] = entry; write_json(REVIEWS_PATH, reviews)
    audit("finding_reviewed", {"node": review.node, "disposition": review.disposition, "reviewer": review.reviewer})
    return entry


@app.post("/api/status-updates")
def add_status_update(update: StatusUpdate, user: dict = Depends(get_current_user)) -> dict:
    # Escalation and closure change the case posture. Investigators request those
    # actions; a supervisor must make the final status change.
    if update.status in {"escalated", "resolved"} and user["role"] == "investigator":
        approvals = read_json(APPROVALS_PATH, [])
        entry = {"id": f"APR-{secrets.token_hex(5).upper()}", "action": update.status, "node": update.node,
                 "message": update.message, "requested_by": user["username"], "requested_at_utc": datetime.now(timezone.utc).isoformat(),
                 "status": "pending"}
        approvals.insert(0, entry); write_json(APPROVALS_PATH, approvals)
        audit("approval_requested", {"approval_id": entry["id"], "node": update.node, "action": update.status, "by": user["username"]})
        return {"requires_approval": True, "approval": entry}
    updates = read_json(STATUS_UPDATES_PATH, {})
    entry = {
        **update.model_dump(),
        "author": user["username"],
        "author_user_id": user["id"],
        "updated_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    updates.setdefault(update.node, []).insert(0, entry)
    write_json(STATUS_UPDATES_PATH, updates)
    audit("entity_status_updated", {"node": update.node, "status": update.status, "author": user["username"]})
    return entry


@app.post("/api/sensitive-actions")
def request_sensitive_action(request: SensitiveActionRequest, user: dict = Depends(get_current_user)) -> dict:
    approvals = read_json(APPROVALS_PATH, [])
    entry = {"id": f"APR-{secrets.token_hex(5).upper()}", "action": request.action, "node": request.node,
             "message": request.reason, "requested_by": user["username"], "requested_at_utc": datetime.now(timezone.utc).isoformat(), "status": "pending"}
    approvals.insert(0, entry); write_json(APPROVALS_PATH, approvals)
    audit("sensitive_action_approval_requested", {"approval_id": entry["id"], "action": request.action, "by": user["username"]})
    return {"requires_approval": True, "approval": entry}


@app.post("/api/approvals/{approval_id}")
def decide_approval(approval_id: str, decision: ApprovalDecision, supervisor: dict = Depends(require_supervisor)) -> dict:
    approvals = read_json(APPROVALS_PATH, [])
    approval = next((item for item in approvals if item.get("id") == approval_id), None)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found.")
    if approval.get("status") != "pending":
        raise HTTPException(status_code=409, detail="This approval request has already been decided.")
    if approval.get("requested_by") == supervisor["username"]:
        raise HTTPException(status_code=403, detail="A different supervisor must decide this approval.")
    approval.update({"status": decision.decision, "decision_rationale": decision.rationale, "decided_by": supervisor["username"], "decided_at_utc": datetime.now(timezone.utc).isoformat()})
    if decision.decision == "approved" and approval["action"] in {"escalated", "resolved"}:
        updates = read_json(STATUS_UPDATES_PATH, {})
        updates.setdefault(approval["node"], []).insert(0, {"node": approval["node"], "status": approval["action"], "message": approval["message"], "author": approval["requested_by"], "approved_by": supervisor["username"], "updated_at_utc": approval["decided_at_utc"]})
        write_json(STATUS_UPDATES_PATH, updates)
    write_json(APPROVALS_PATH, approvals)
    audit("approval_decided", {"approval_id": approval_id, "decision": decision.decision, "node": approval["node"], "by": supervisor["username"]})
    return approval


def consume_approval(action: str, user: dict) -> None:
    """Consume a supervisor-approved sensitive action so it cannot be replayed."""
    approvals = read_json(APPROVALS_PATH, [])
    approval = next((item for item in approvals if item.get("action") == action and item.get("status") == "approved" and not item.get("consumed_at_utc")), None)
    if not approval:
        raise HTTPException(status_code=403, detail=f"An approved {action.replace('_', ' ')} request is required.")
    approval.update({"consumed_at_utc": datetime.now(timezone.utc).isoformat(), "consumed_by": user["username"]})
    write_json(APPROVALS_PATH, approvals)
    audit("sensitive_approval_consumed", {"approval_id": approval["id"], "action": action, "by": user["username"]})


@app.post("/api/external-requests")
def create_external_request(request: ExternalRequest, user: dict = Depends(get_current_user)) -> dict:
    requests = read_json(REQUESTS_PATH, [])
    entry = {"id": f"REQ-{secrets.token_hex(5).upper()}", **request.model_dump(), "status": "draft", "created_by": user["username"], "created_at_utc": datetime.now(timezone.utc).isoformat(), "history": []}
    requests.insert(0, entry); write_json(REQUESTS_PATH, requests)
    audit("external_request_created", {"request_id": entry["id"], "type": entry["request_type"], "recipient": entry["recipient"], "owner": entry["owner"], "by": user["username"]})
    return entry


@app.post("/api/external-requests/{request_id}")
def update_external_request(request_id: str, update: ExternalRequestUpdate, user: dict = Depends(get_current_user)) -> dict:
    requests = read_json(REQUESTS_PATH, [])
    entry = next((item for item in requests if item.get("id") == request_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="External request not found.")
    if user["role"] == "investigator" and user["username"] not in {entry.get("owner"), entry.get("created_by")}:
        raise HTTPException(status_code=403, detail="Only the request owner can update this request.")
    action = {"status": update.status, "response_note": update.response_note, "by": user["username"], "at_utc": datetime.now(timezone.utc).isoformat()}
    entry["status"] = update.status; entry["history"].insert(0, action)
    if update.response_note: entry["latest_response_note"] = update.response_note
    write_json(REQUESTS_PATH, requests)
    audit("external_request_updated", {"request_id": request_id, "status": update.status, "by": user["username"]})
    return entry


@app.post("/api/entity-tags")
def save_entity_tag(tag: EntityTag, user: dict = Depends(get_current_user)) -> dict:
    tags = read_json(ENTITY_TAGS_PATH, {})
    current = [item for item in tags.get(tag.node, []) if item.get("tag") != tag.tag]
    if tag.active:
        current.append({"tag": tag.tag, "note": tag.note, "author": user["username"], "at_utc": datetime.now(timezone.utc).isoformat()})
    tags[tag.node] = current
    write_json(ENTITY_TAGS_PATH, tags)
    audit("entity_tag_updated", {"node": tag.node, "tag": tag.tag, "active": tag.active, "by": user["username"]})
    return {"node": tag.node, "tags": current}


@app.post("/api/assignments")
def save_assignment(assignment: Assignment, admin: dict = Depends(require_supervisor)) -> dict:
    assignments = read_json(ASSIGNMENTS_PATH, {})
    priority_days = {"urgent": 0, "high": 1, "normal": 3, "low": 7}
    due_date = assignment.due_date or (datetime.now(timezone.utc).date() + timedelta(days=priority_days[assignment.priority])).isoformat()
    entry = {**assignment.model_dump(), "due_date": due_date, "due_date_auto_set": not bool(assignment.due_date), "updated_at_utc": datetime.now(timezone.utc).isoformat(), "assigned_by": admin["username"]}
    assignments[assignment.node] = entry
    write_json(ASSIGNMENTS_PATH, assignments)
    audit("entity_assigned", {"node": assignment.node, "assignee": assignment.assignee, "due_date": assignment.due_date, "by": admin["username"]})
    return entry


@app.post("/api/watchlist")
def toggle_watchlist(item: WatchlistToggle, user: dict = Depends(get_current_user)) -> dict:
    watchlists = read_json(WATCHLISTS_PATH, {})
    watched = set(watchlists.get(str(user["id"]), []))
    if item.node in watched:
        consume_approval("watchlist_removal", user)
        watched.remove(item.node); active = False
    else:
        watched.add(item.node); active = True
    watchlists[str(user["id"])] = sorted(watched)
    write_json(WATCHLISTS_PATH, watchlists)
    audit("watchlist_updated", {"node": item.node, "active": active, "user": user["username"]})
    return {"node": item.node, "active": active}


@app.post("/api/bulk-actions")
def bulk_actions(action: BulkAction, user: dict = Depends(get_current_user)) -> dict:
    nodes = sorted(set(action.nodes))
    if action.action == "assign":
        if user["role"] not in {"admin", "supervisor"} or not action.assignee:
            raise HTTPException(status_code=403, detail="A supervisor and assignee are required for bulk assignment.")
        assignments = read_json(ASSIGNMENTS_PATH, {})
        for node in nodes: assignments[node] = {"node": node, "assignee": action.assignee, "priority": "normal", "due_date": "", "updated_at_utc": datetime.now(timezone.utc).isoformat(), "assigned_by": user["username"]}
        write_json(ASSIGNMENTS_PATH, assignments)
    elif action.action == "tag":
        if not action.tag: raise HTTPException(status_code=400, detail="Select a tag for this bulk action.")
        tags = read_json(ENTITY_TAGS_PATH, {})
        for node in nodes:
            tags[node] = [item for item in tags.get(node, []) if item.get("tag") != action.tag] + [{"tag": action.tag, "note": "Bulk-applied; requires corroboration.", "author": user["username"], "at_utc": datetime.now(timezone.utc).isoformat()}]
        write_json(ENTITY_TAGS_PATH, tags)
    elif action.action == "watch":
        watched = set(read_json(WATCHLISTS_PATH, {}).get(str(user["id"]), [])); watched.update(nodes)
        watchlists = read_json(WATCHLISTS_PATH, {}); watchlists[str(user["id"])] = sorted(watched); write_json(WATCHLISTS_PATH, watchlists)
    else:
        if action.status not in {"new", "in_progress", "monitoring"}: raise HTTPException(status_code=400, detail="Bulk status supports new, in progress, or monitoring.")
        updates = read_json(STATUS_UPDATES_PATH, {})
        for node in nodes: updates.setdefault(node, []).insert(0, {"node": node, "status": action.status, "message": action.message or "Bulk operational update", "author": user["username"], "updated_at_utc": datetime.now(timezone.utc).isoformat()})
        write_json(STATUS_UPDATES_PATH, updates)
    audit("bulk_action_completed", {"action": action.action, "count": len(nodes), "by": user["username"]})
    return {"updated": len(nodes), "action": action.action}


@app.post("/api/templates")
def save_template(template: CaseTemplate, user: dict = Depends(require_supervisor)) -> dict:
    templates = read_json(TEMPLATES_PATH, []); entry = {"id": f"TPL-{secrets.token_hex(4).upper()}", **template.model_dump(), "created_by": user["username"], "created_at_utc": datetime.now(timezone.utc).isoformat()}
    templates.insert(0, entry); write_json(TEMPLATES_PATH, templates); audit("case_template_saved", {"template": entry["id"], "by": user["username"]}); return entry


@app.post("/api/templates/{template_id}/apply")
def apply_template(template_id: str, user: dict = Depends(get_current_user)) -> dict:
    template = next((item for item in read_json(TEMPLATES_PATH, []) if item.get("id") == template_id), None)
    if not template:
        raise HTTPException(status_code=404, detail="Case template not found.")
    tasks = read_json(TASKS_PATH, [])
    created = []
    for text in template.get("tasks", []) + [f"Review: {item}" for item in template.get("review_questions", [])] + [f"Closure check: {item}" for item in template.get("closure_criteria", [])]:
        entry = {"id": f"TSK-{secrets.token_hex(4).upper()}", "template_id": template_id, "text": text, "status": "open", "created_by": user["username"], "created_at_utc": datetime.now(timezone.utc).isoformat(), "history": []}
        tasks.append(entry); created.append(entry)
    write_json(TASKS_PATH, tasks); audit("case_template_applied", {"template": template_id, "tasks": len(created), "by": user["username"]})
    return {"created": created}


@app.post("/api/tasks/{task_id}")
def update_task(task_id: str, update: TaskUpdate, user: dict = Depends(get_current_user)) -> dict:
    tasks = read_json(TASKS_PATH, []); task = next((item for item in tasks if item.get("id") == task_id), None)
    if not task: raise HTTPException(status_code=404, detail="Task not found.")
    if update.status == "done" and task.get("depends_on"):
        dependency = next((item for item in tasks if item.get("id") == task["depends_on"]), None)
        if dependency and dependency.get("status") != "done":
            raise HTTPException(status_code=400, detail=f"Complete dependency {task['depends_on']} before closing this task.")
    entry = {"status": update.status, "note": update.note, "by": user["username"], "at_utc": datetime.now(timezone.utc).isoformat()}
    task["status"] = update.status; task.setdefault("history", []).insert(0, entry); write_json(TASKS_PATH, tasks)
    audit("case_task_updated", {"task": task_id, "status": update.status, "by": user["username"]}); return task


@app.post("/api/collaboration")
def add_collaboration(item: CollaborationItem, user: dict = Depends(get_current_user)) -> dict:
    items = read_json(COLLABORATION_PATH, []); entry = {"id": f"COL-{secrets.token_hex(4).upper()}", **item.model_dump(), "author": user["username"], "at_utc": datetime.now(timezone.utc).isoformat()}
    items.insert(0, entry); write_json(COLLABORATION_PATH, items); audit("collaboration_recorded", {"kind": item.kind, "entity": item.entity, "by": user["username"]}); return entry


@app.post("/api/retention")
def update_retention(update: RetentionUpdate, user: dict = Depends(require_supervisor)) -> dict:
    retention = {**update.model_dump(), "updated_by": user["username"], "updated_at_utc": datetime.now(timezone.utc).isoformat()}; write_json(RETENTION_PATH, retention); audit("retention_policy_updated", {"legal_hold": update.legal_hold, "by": user["username"]}); return retention


@app.post("/api/saved-searches")
def save_search(search: SavedSearch, user: dict = Depends(get_current_user)) -> dict:
    searches = read_json(SAVED_SEARCHES_PATH, []); entry = {"id": f"SRCH-{secrets.token_hex(4).upper()}", **search.model_dump(), "owner": user["username"], "created_at_utc": datetime.now(timezone.utc).isoformat()}; searches.insert(0, entry); write_json(SAVED_SEARCHES_PATH, searches); audit("saved_search_created", {"search": entry["id"], "by": user["username"]}); return entry


@app.post("/api/graph-views")
def save_graph_view(view: SavedGraphView, user: dict = Depends(get_current_user)) -> dict:
    views = read_json(GRAPH_VIEWS_PATH, [])
    entry = {"id": f"VIEW-{secrets.token_hex(4).upper()}", **view.model_dump(), "owner": user["username"], "created_at_utc": datetime.now(timezone.utc).isoformat()}
    views.insert(0, entry); write_json(GRAPH_VIEWS_PATH, views)
    audit("graph_view_saved", {"view": entry["id"], "entity": entry["entity"], "by": user["username"]})
    return entry


@app.post("/api/case-narratives")
def save_case_narrative(narrative: CaseNarrative, user: dict = Depends(get_current_user)) -> dict:
    narratives = read_json(NARRATIVES_PATH, [])
    entry = {"id": f"NAR-{secrets.token_hex(4).upper()}", **narrative.model_dump(), "author": user["username"], "created_at_utc": datetime.now(timezone.utc).isoformat()}
    narratives.insert(0, entry); write_json(NARRATIVES_PATH, narratives)
    audit("case_narrative_saved", {"narrative": entry["id"], "entity": entry["entity"], "by": user["username"]})
    return entry


@app.post("/api/alert-rules")
def save_alert_rule(rule: AlertRule, user: dict = Depends(get_current_user)) -> dict:
    rules = read_json(ALERT_RULES_PATH, [])
    entry = {"id": f"ALRT-{secrets.token_hex(4).upper()}", **rule.model_dump(), "owner": user["username"], "enabled": True, "created_at_utc": datetime.now(timezone.utc).isoformat()}
    rules.insert(0, entry); write_json(ALERT_RULES_PATH, rules)
    audit("alert_rule_saved", {"rule": entry["id"], "entity": entry["entity"], "by": user["username"]})
    return entry


@app.post("/api/merge-reviews")
def review_duplicate_candidate(review: MergeReview, user: dict = Depends(require_supervisor)) -> dict:
    reviews = read_json(MERGE_REVIEWS_PATH, [])
    entry = {"id": f"MRG-{secrets.token_hex(4).upper()}", **review.model_dump(), "reviewed_by": user["username"], "reviewed_at_utc": datetime.now(timezone.utc).isoformat()}
    reviews.insert(0, entry); write_json(MERGE_REVIEWS_PATH, reviews)
    audit("duplicate_candidate_reviewed", {"entity": review.entity, "matched_entity": review.matched_entity, "decision": review.decision, "by": user["username"]})
    return entry


@app.post("/api/integrations")
def configure_integration(config: IntegrationConfig, user: dict = Depends(require_supervisor)) -> dict:
    if config.enabled and PRODUCTION_MODE:
        policy = read_json(SECURITY_PATH, {})
        missing = []
        if not COOKIE_SECURE: missing.append("SETU_COOKIE_SECURE=true")
        if not policy.get("mfa_required"): missing.append("MFA policy")
        if not policy.get("allowed_ips"): missing.append("IP allowlist")
        if not IDENTITY_PROVIDER: missing.append("SETU_IDENTITY_PROVIDER")
        if not IMMUTABLE_AUDIT_URI: missing.append("SETU_IMMUTABLE_AUDIT_URI")
        if missing:
            raise HTTPException(status_code=400, detail=f"Cannot enable a live connector until deployment controls are configured: {', '.join(missing)}.")
    items = read_json(INTEGRATIONS_PATH, {}); entry = {**config.model_dump(), "approved_by": user["username"], "updated_at_utc": datetime.now(timezone.utc).isoformat()}; items[config.connector] = entry; write_json(INTEGRATIONS_PATH, items); audit("intake_connector_configured", {"connector": config.connector, "enabled": config.enabled, "by": user["username"]}); return entry


@app.post("/api/case-links")
def associate_case(association: CaseAssociation, user: dict = Depends(require_supervisor)) -> dict:
    links = read_json(CASE_LINKS_PATH, []); entry = {"id": f"XCASE-{secrets.token_hex(4).upper()}", **association.model_dump(), "associated_by": user["username"], "at_utc": datetime.now(timezone.utc).isoformat(), "merge_state": "associated"}
    links.insert(0, entry); write_json(CASE_LINKS_PATH, links); audit("cross_case_associated", {"related_case": association.related_case, "entity": association.entity, "by": user["username"]}); return entry


@app.get("/api/notifications")
def notifications(user: dict = Depends(get_current_user)) -> list[dict]:
    assignments = read_json(ASSIGNMENTS_PATH, {})
    updates = read_json(STATUS_UPDATES_PATH, {})
    now = datetime.now(timezone.utc).date().isoformat()
    items = []
    if user["role"] in {"admin", "supervisor"}:
        for approval in read_json(APPROVALS_PATH, []):
            if approval.get("status") == "pending":
                items.append({"type": "approval", "node": approval["node"], "message": f"Approval needed: {approval['action'].replace('_', ' ')} requested by {approval['requested_by']}", "at": approval["requested_at_utc"]})
    for request in read_json(REQUESTS_PATH, []):
        if request.get("status") not in {"responded", "closed"} and request.get("due_date") and request["due_date"] <= now and user["username"] in {request.get("owner"), request.get("created_by")}:
            items.append({"type": "request_overdue", "node": request.get("entity") or request["id"], "message": f"External request {request['id']} is {'overdue' if request['due_date'] < now else 'due today'}: {request['subject']}", "at": request.get("created_at_utc", "")})
    for node, assignment in assignments.items():
        due = assignment.get("due_date", "")
        if due and due <= now and user["username"] in {assignment.get("assignee"), assignment.get("assigned_by")}:
            type_ = "overdue" if due < now else "due_today"
            recipient = "you" if user["username"] == assignment.get("assignee") else assignment.get("assignee")
            items.append({"type": type_, "node": node, "message": f"{type_.replace('_', ' ').title()}: assigned to {recipient} ({due})", "at": assignment.get("updated_at_utc", "")})
    for node, history in updates.items():
        if history and history[0].get("status") in {"escalated", "resolved"}:
            state = history[0]["status"]
            items.append({"type": state, "node": node, "message": f"Entity marked {state}", "at": history[0].get("updated_at_utc", "")})
    for score in records(PROCESSED / "risk_scores.csv"):
        if score.get("risk_tier") in {"HIGH", "MEDIUM"}:
            items.append({"type": "flagged", "node": score.get("node", ""), "message": f"New {str(score.get('risk_tier')).lower()}-risk entity flagged", "at": ""})
    watched = set(read_json(WATCHLISTS_PATH, {}).get(str(user["id"]), []))
    for node in watched:
        activity = [edge for edge in records(PROCESSED / "graph_edges.csv") if node in {str(edge.get("sender", "")), str(edge.get("receiver", ""))}]
        if activity:
            items.append({"type": "watchlist", "node": node, "message": f"Watchlist activity: {len(activity)} linked transfers", "at": max((str(edge.get("timestamp", "")) for edge in activity), default="")})
    for rule in read_json(ALERT_RULES_PATH, []):
        if not rule.get("enabled") or rule.get("owner") != user["username"]:
            continue
        node = rule.get("entity", "")
        activity = [edge for edge in records(PROCESSED / "graph_edges.csv") if not node or node in {str(edge.get("sender", "")), str(edge.get("receiver", ""))}]
        newest_artifact = max((datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) for path in RAW.glob("*") if path.is_file()), default=None)
        try:
            created_at = datetime.fromisoformat(str(rule.get("created_at_utc", "")).replace("Z", "+00:00"))
        except ValueError:
            created_at = datetime.min.replace(tzinfo=timezone.utc)
        has_entity_evidence = not node or bool(entity_traceability(node)["csv_rows"])
        if rule.get("new_evidence", True) and newest_artifact and newest_artifact > created_at and has_entity_evidence:
            items.append({"type": "rule_evidence", "node": node or "Case", "message": f"Rule {rule['name']}: new supporting evidence is available", "at": newest_artifact.isoformat()})
        if rule.get("value_threshold", True):
            for edge in activity:
                try:
                    amount = float(edge.get("amount", 0) or 0)
                except (TypeError, ValueError):
                    continue
                if amount >= float(rule.get("min_amount", 0) or 0):
                    items.append({"type": "rule_value", "node": node or "Transaction", "message": f"Rule {rule['name']}: transfer of INR {amount:,.0f} meets threshold", "at": str(edge.get("timestamp", ""))})
                    break
        if rule.get("high_risk_cluster", False):
            high_entities = {str(row.get("node", "")) for row in records(PROCESSED / "risk_scores.csv") if str(row.get("risk_tier", "")).upper() == "HIGH"}
            clusters = graph_intelligence().get("clusters", [])
            hit = next((cluster for cluster in clusters if any(entity in high_entities for entity in cluster["entities"]) and (not node or node in cluster["entities"])), None)
            if hit:
                items.append({"type": "rule_cluster", "node": node or hit["id"], "message": f"Rule {rule['name']}: linked to high-risk cluster {hit['id']}", "at": ""})
    for search in read_json(SAVED_SEARCHES_PATH, []):
        if not search.get("alert") or (not search.get("shared") and search.get("owner") != user["username"]):
            continue
        query = str(search.get("query", "")).strip().lower()
        if not query:
            continue
        for entity, attributes in evidence_attributes().items():
            haystack = " ".join([entity, *attributes.get("phones", []), *attributes.get("upis", []), *attributes.get("imeis", [])]).lower()
            if query in haystack:
                items.append({"type": "search_alert", "node": entity, "message": f"Saved-search alert: {search['name']} matched {entity}", "at": attributes.get("date_max", "")})
    return sorted(items, key=lambda item: item["at"], reverse=True)[:30]


@app.post("/api/evidence")
async def upload_evidence(artifact: str = Form(...), file: UploadFile = File(...), user: dict = Depends(require_supervisor)) -> dict:
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
    if (RAW / name).exists():
        consume_approval("evidence_replacement", user)
    if missing := required - columns:
        raise HTTPException(status_code=400, detail=f"Missing required columns: {', '.join(sorted(missing))}")
    RAW.mkdir(parents=True, exist_ok=True); (RAW / name).write_bytes(payload)
    custody("uploaded", name, user, artifact_type=artifact, original_filename=file.filename, source="operator_upload", bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
    return {"message": f"{artifact.upper()} evidence staged as {name}. Run the pipeline to hash and correlate it."}


@app.get("/api/brief")
def download_brief(user: dict = Depends(require_supervisor)) -> FileResponse:
    path = REPORT / "setu_brief.pdf"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Run the pipeline before downloading a brief.")
    custody("downloaded", "setu_brief.pdf", user, source="investigation_brief", sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    return FileResponse(path, media_type="application/pdf", filename="setu_brief.pdf")


@app.get("/api/investigation-export")
def investigation_export(days: int = 30, risk: str = "ALL", rail: str = "ALL", min_amount: float = 0,
                         entity: str = "", caption: str = "Selected relationship view", user: dict = Depends(require_supervisor)) -> Response:
    """Export a presentation-ready, reproducible graph package with its methodology."""
    model = chart_data_model(days=days, risk=risk, rail=rail, min_amount=min_amount, entity=entity, expand=True)
    nodes, routes = exported_relationship_graph(model)
    pdf = io.BytesIO(); page = canvas.Canvas(pdf, pagesize=landscape(A4)); width, height = landscape(A4)
    page.setTitle("SETU investigation export")
    page.setFont("Helvetica-Bold", 17); page.drawString(42, height - 42, "SETU · Investigation route package")
    page.setFont("Helvetica", 9); page.drawString(42, height - 58, caption[:125])
    filters = model["filters"]
    page.drawString(42, height - 74, f"Filters: {filters['days']} days · risk {filters['risk']} · rail {filters['rail']} · min value ₹{filters['min_amount']:,.0f}")
    page.drawString(42, height - 88, f"Focus: {entity or 'highest-value entity'} · {model['summary']['transfer_count']} transfers · ₹{model['summary']['transfer_value']:,.0f}")
    draw_pdf_transaction_routes(page, nodes, routes, 42, 230, width - 84, 190)
    y = 212; page.setFont("Helvetica-Bold", 10); page.drawString(42, y, "Selected route table")
    page.setFont("Helvetica", 8); y -= 14
    for route in routes[:9]:
        page.drawString(42, y, f"{route['source'][:24]} → {route['target'][:24]}   ₹{route['value']:,.0f}   {route['count']} transfer(s)")
        y -= 12
    page.showPage(); y = height - 45
    page.setFont("Helvetica-Bold", 16); page.drawString(42, y, "Methodology and traceability")
    y -= 24; page.setFont("Helvetica", 10)
    methodology = [
        "Scope: the selected graph is derived from staged payment records within the recorded filters.",
        "Route logic: directed transfers are aggregated by sender and receiver; no relationship is treated as a conclusion without corroboration.",
        "Risk logic: each route inherits the highest risk tier of its endpoints and shared-device links are separately identified.",
        "Traceability: node selection exposes source CSV rows, artifact hashes, device identifiers, and investigator notes.",
        "Reproducibility: filter settings, caption, methodology, and export timestamp are included in this package."
    ]
    for line in methodology:
        page.drawString(42, y, line); y -= 18
    page.setFont("Helvetica-Bold", 10); page.drawString(42, y - 8, "Included annotations")
    page.setFont("Helvetica", 9); y -= 24
    for item in read_json(GRAPH_ANNOTATIONS_PATH, [])[:12]:
        page.drawString(42, y, f"{item.get('disposition', 'reviewed').upper()} · {item.get('target', '')[:45]} · {item.get('note', '')[:75]}"); y -= 14
    page.save()
    audit("investigation_route_package_exported", {"entity": entity, "filters": filters, "by": user["username"]})
    custody("exported", "investigation_route_package.pdf", user, source="investigation_export", filters=filters)
    return Response(content=pdf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=investigation_route_package.pdf"})


@app.get("/api/case-package")
def case_package(format: str = "zip", user: dict = Depends(require_supervisor)) -> Response:
    """Export metadata, review history, status updates, and integrity records as a ZIP package."""
    consume_approval("evidence_export", user)
    artifacts = {"case.json": read_json(CASE_PATH, {}), "reviews.json": read_json(REVIEWS_PATH, {}),
                 "status_updates.json": read_json(STATUS_UPDATES_PATH, {}), "assignments.json": read_json(ASSIGNMENTS_PATH, {}),
                 "evidence_custody.json": read_json(CUSTODY_PATH, []), "audit.jsonl": AUDIT_PATH.read_text() if AUDIT_PATH.exists() else ""}
    signed_audit = hashlib.sha256(artifacts["audit.jsonl"].encode()).hexdigest()
    if format == "csv":
        output = io.StringIO(); output.write("event,at_utc,details\n")
        for line in artifacts["audit.jsonl"].splitlines():
            event = json.loads(line); output.write(f'"{event.get("event", "")}","{event.get("at_utc", "")}","{json.dumps(event.get("details", {})).replace(chr(34), chr(39))}"\n')
        custody("exported", "case_audit.csv", user, signed_audit_sha256=signed_audit)
        return Response(content=output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=setu_case_audit.csv"})
    if format == "pdf":
        pdf = io.BytesIO(); page = canvas.Canvas(pdf, pagesize=A4); y = 800
        manifest = read_json(PROCESSED / "manifest.json", {})
        pdf_lines = ["SETU CASE PACKAGE", f"Case: {artifacts['case'].get('case_reference', 'Unregistered')}", f"Signed audit SHA-256: {signed_audit}", "", "Evidence hashes:"]
        pdf_lines += [f"{name}: {item.get('sha256', '')}" for name, item in manifest.items()]
        pdf_lines += ["", "Reviews:"] + [f"{node}: {review.get('disposition')} — {review.get('reviewer')}" for node, review in artifacts["reviews.json"].items()]
        pdf_lines += ["", "Status timeline:"] + [f"{item.get('node')}: {item.get('status')} — {item.get('updated_at_utc')}" for history in artifacts["status_updates.json"].values() for item in history]
        for line in pdf_lines:
            page.drawString(42, y, line[:110]); y -= 16
            if y < 50: page.showPage(); y = 800
        page.save(); custody("exported", "case_package.pdf", user, signed_audit_sha256=signed_audit)
        return Response(content=pdf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=setu_case_package.pdf"})
    bundle = io.BytesIO()
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, value in artifacts.items():
            archive.writestr(name, value if isinstance(value, str) else json.dumps(value, indent=2))
        manifest = PROCESSED / "manifest.json"
        if manifest.exists(): archive.writestr("evidence_manifest.json", manifest.read_text())
        archive.writestr("signed_audit.sha256", signed_audit + "\n")
    custody("exported", "setu_case_package.zip", user, signed_audit_sha256=signed_audit)
    return Response(content=bundle.getvalue(), media_type="application/zip", headers={"Content-Disposition": "attachment; filename=setu_case_package.zip"})
