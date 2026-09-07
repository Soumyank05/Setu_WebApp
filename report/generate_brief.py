"""Generate machine-readable and PDF investigative briefs from pipeline output."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR, REPORT_DIR = ROOT / "data" / "processed", Path(__file__).parent


def build_brief() -> dict:
    manifest = json.loads((PROCESSED_DIR / "manifest.json").read_text())
    scores = pd.read_csv(PROCESSED_DIR / "risk_scores.csv")
    links_path = PROCESSED_DIR / "entity_links.csv"
    links = pd.read_csv(links_path) if links_path.exists() else pd.DataFrame()
    entities = []
    for row in scores[scores.risk_tier != "LOW"].sort_values("risk_score", ascending=False).itertuples(index=False):
        labels = [("shared_device", "shared device"), ("multi_hop_routing", "multi-hop routing"), ("high_velocity_fanout", "high-velocity fan-out"), ("high_in_degree", "high in-degree")]
        entities.append({"entity_id": str(row.node), "risk_score": int(row.risk_score), "risk_tier": row.risk_tier, "reasons": [label for field, label in labels if getattr(row, field)]})
    return {"brief_title": "SETU Investigative Brief", "generated_at_utc": datetime.now(timezone.utc).isoformat(), "evidence_manifest": manifest, "flagged_entities": entities, "entity_links": links.to_dict("records"), "recommended_actions": [f"Prioritize account-freeze review for {sum(item['risk_tier'] == 'HIGH' for item in entities)} HIGH-risk entities.", "Verify shared-device links with the telecom provider before escalation.", "Request PSP KYC details for unmapped cash-out handles."]}


def write_pdf(brief: dict, output: Path) -> None:
    doc = SimpleDocTemplate(str(output), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm)
    styles = getSampleStyleSheet(); heading = ParagraphStyle("heading", parent=styles["Heading2"], spaceBefore=10, spaceAfter=5)
    metadata = ParagraphStyle("metadata", parent=styles["Normal"], fontSize=8, textColor=colors.grey)
    story = [Paragraph(brief["brief_title"], styles["Title"]), Paragraph(f"Generated: {brief['generated_at_utc']}", metadata), HRFlowable(width="100%", color=colors.grey), Paragraph("Evidence integrity", heading)]
    evidence = [["Source", "SHA-256", "Bytes"]] + [[name, details["sha256"][:24] + "…", str(details["size_bytes"])] for name, details in brief["evidence_manifest"].items()]
    flagged = [["Entity", "Score", "Tier", "Reasons"]] + [[item["entity_id"], str(item["risk_score"]), item["risk_tier"], ", ".join(item["reasons"])] for item in brief["flagged_entities"]]
    for table_data in (evidence, flagged):
        table = Table(table_data, repeatRows=1, colWidths=[45 * mm, 75 * mm, 20 * mm] if len(table_data[0]) == 3 else [42 * mm, 17 * mm, 20 * mm, 61 * mm])
        table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#263238")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), .25, colors.lightgrey), ("FONTSIZE", (0, 0), (-1, -1), 8), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.extend([table, Spacer(1, 7 * mm)])
    story.append(Paragraph("Recommended actions", heading))
    story.extend(Paragraph("• " + action, styles["BodyText"]) for action in brief["recommended_actions"])
    doc.build(story)


def main() -> None:
    brief = build_brief(); (REPORT_DIR / "setu_brief.json").write_text(json.dumps(brief, indent=2, default=str) + "\n"); write_pdf(brief, REPORT_DIR / "setu_brief.pdf")
    print(f"Brief written: {len(brief['flagged_entities'])} flagged entities.")


if __name__ == "__main__":
    main()
