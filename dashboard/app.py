"""Streamlit dashboard for reviewing SETU's evidence-correlation output."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
PROCESSED, REPORT = ROOT / "data" / "processed", ROOT / "report"
STEPS = [("Generate synthetic evidence", "data/generate_data.py"), ("Ingest and hash evidence", "parsers/ingest.py"), ("Resolve entities", "entity_linking/resolve.py"), ("Build transaction graph", "graph/build_graph.py"), ("Score risk", "scoring/score.py"), ("Create investigative brief", "report/generate_brief.py")]

st.set_page_config(page_title="SETU", page_icon="🌉", layout="wide")
st.markdown("""<style>.stApp{background:#0b0e13;color:#f5f7fa}.mono{font-family:monospace}.risk{padding:2px 8px;border-radius:4px;font-family:monospace}.HIGH{background:#521717;color:#ff9b9b}.MEDIUM{background:#4b3810;color:#ffd36e}.LOW{background:#153820;color:#8ce5a8}</style>""", unsafe_allow_html=True)
st.title("🌉 SETU")
st.caption("Digital Evidence Correlation & Triage Engine · CASE REF: SETU-DEMO-001")

with st.sidebar:
    st.subheader("Pipeline")
    if st.button("Run full pipeline", use_container_width=True):
        progress = st.progress(0, text="Starting")
        for index, (label, script) in enumerate(STEPS, 1):
            progress.progress((index - 1) / len(STEPS), text=label)
            result = subprocess.run([sys.executable, str(ROOT / script)], capture_output=True, text=True)
            if result.returncode:
                st.error(f"{label} failed:\n{result.stderr[-800:]}"); break
        else:
            progress.progress(1.0, text="Complete"); st.success("Pipeline complete."); st.rerun()
    for label, script in STEPS:
        if st.button(label, key=script, use_container_width=True):
            result = subprocess.run([sys.executable, str(ROOT / script)], capture_output=True, text=True)
            st.success(result.stdout[-250:] or "Complete") if not result.returncode else st.error(result.stderr[-800:])

scores_path = PROCESSED / "risk_scores.csv"
if not scores_path.exists():
    st.info("No output yet. Run the full pipeline from the sidebar."); st.stop()
scores = pd.read_csv(scores_path)
links_path, manifest_path = PROCESSED / "entity_links.csv", PROCESSED / "manifest.json"
links = pd.read_csv(links_path) if links_path.exists() else pd.DataFrame()
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
metrics = st.columns(4)
metrics[0].metric("Entities scanned", len(scores)); metrics[1].metric("HIGH risk", int((scores.risk_tier == "HIGH").sum())); metrics[2].metric("MEDIUM risk", int((scores.risk_tier == "MEDIUM").sum())); metrics[3].metric("Device links", len(links))
st.subheader("Flagged entities")
flagged = scores[scores.risk_tier != "LOW"].sort_values("risk_score", ascending=False)
st.dataframe(flagged, use_container_width=True, hide_index=True) if not flagged.empty else st.success("No entities are above LOW risk.")
left, right = st.columns(2)
with left:
    st.subheader("Entity links"); st.dataframe(links, use_container_width=True, hide_index=True) if not links.empty else st.caption("No shared-device links.")
with right:
    st.subheader("Evidence integrity")
    st.dataframe(pd.DataFrame([{"file": name, "sha256": value["sha256"][:24] + "…", "bytes": value["size_bytes"]} for name, value in manifest.items()]), use_container_width=True, hide_index=True)
st.subheader("Mule network graph")
graph_path = REPORT / "setu_graph.html"
if graph_path.exists(): st.components.v1.html(graph_path.read_text(), height=700, scrolling=True)
else: st.caption("Build the graph to view it here.")
pdf_path = REPORT / "setu_brief.pdf"
if pdf_path.exists():
    st.download_button("Download investigative brief (PDF)", pdf_path.read_bytes(), file_name="setu_brief.pdf", mime="application/pdf")
