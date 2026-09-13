"""Produce explainable, time-aware risk scores for transaction graph entities.

The score is a triage aid, not a determination of wrongdoing. It combines
reviewable behavioural signals and retains the underlying measurements.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = ROOT / "data" / "processed"
PASS_THROUGH_WINDOW = pd.Timedelta(minutes=15)
FANOUT_WINDOW = pd.Timedelta(minutes=15)
MIN_FANOUT_COUNTERPARTIES = 2


def load_data() -> tuple[pd.DataFrame, set[str]]:
    edges = pd.read_csv(PROCESSED_DIR / "graph_edges.csv", dtype={"sender": "string", "receiver": "string"}, parse_dates=["timestamp"])
    shared: set[str] = set()
    links_path = PROCESSED_DIR / "entity_links.csv"
    if links_path.exists():
        links = pd.read_csv(links_path, dtype="string")
        shared = set(links.get("entity_a", pd.Series(dtype="string")).dropna()) | set(links.get("entity_b", pd.Series(dtype="string")).dropna())
    identity_path = PROCESSED_DIR / "identity_map.csv"
    if identity_path.exists():
        identities = pd.read_csv(identity_path, dtype="string").set_index("raw_id")["canonical_id"].to_dict()
        edges["sender"] = edges["sender"].map(lambda value: identities.get(value, value))
        edges["receiver"] = edges["receiver"].map(lambda value: identities.get(value, value))
        shared = {identities.get(node, node) for node in shared}
    edges["amount"] = pd.to_numeric(edges["amount"], errors="coerce").fillna(0.0)
    return edges.dropna(subset=["timestamp"]), shared


def _pass_through(incoming: pd.DataFrame, outgoing: pd.DataFrame) -> tuple[bool, float]:
    """Find the strongest rapid forwarding of an incoming transfer.

    Outgoing transfers are aggregated since mule accounts often split a received
    amount. The 70--130% band excludes ordinary, unrelated small payments.
    """
    strongest = 0.0
    for received in incoming.itertuples(index=False):
        if received.amount <= 0:
            continue
        forwarded = outgoing.loc[
            (outgoing.timestamp >= received.timestamp)
            & (outgoing.timestamp <= received.timestamp + PASS_THROUGH_WINDOW),
            "amount",
        ].sum()
        strongest = max(strongest, float(forwarded / received.amount))
    return 0.70 <= strongest <= 1.30, round(strongest, 3)


def _max_window_fanout(outgoing: pd.DataFrame) -> int:
    """Return the maximum number of distinct recipients in a short window."""
    largest = 0
    for start in outgoing.timestamp:
        recipients = outgoing.loc[
            (outgoing.timestamp >= start) & (outgoing.timestamp <= start + FANOUT_WINDOW), "receiver"
        ].nunique()
        largest = max(largest, int(recipients))
    return largest


def compute_features(edges: pd.DataFrame, shared: set[str]) -> pd.DataFrame:
    rows = []
    nodes = pd.unique(edges[["sender", "receiver"]].to_numpy().ravel())
    for node in nodes:
        incoming = edges[edges.receiver == node].sort_values("timestamp")
        outgoing = edges[edges.sender == node].sort_values("timestamp")
        multi_hop, pass_through_ratio = _pass_through(incoming, outgoing)
        max_fanout = _max_window_fanout(outgoing)
        rows.append({
            "node": node, "in_degree": incoming.sender.nunique(), "out_degree": outgoing.receiver.nunique(),
            "incoming_transactions": len(incoming), "outgoing_transactions": len(outgoing),
            "total_in_amount": incoming.amount.sum(), "total_out_amount": outgoing.amount.sum(),
            "shared_device": node in shared, "multi_hop_routing": multi_hop, "pass_through_ratio": pass_through_ratio,
            "max_fanout_counterparties": max_fanout, "high_velocity_fanout": max_fanout >= MIN_FANOUT_COUNTERPARTIES,
        })
    features = pd.DataFrame(rows)
    threshold = max(3, int(np.ceil(features["in_degree"].quantile(0.90)))) if len(features) else 3
    features["high_in_degree"] = features["in_degree"] >= threshold
    flow = features[["total_in_amount", "total_out_amount"]].max(axis=1)
    features["high_value_flow"] = flow >= flow.quantile(0.95)
    return features


def add_anomaly_signals(features: pd.DataFrame) -> pd.DataFrame:
    """Add a reproducible outlier signal, after log-scaling skewed monetary data."""
    features = features.copy()
    columns = ["in_degree", "out_degree", "incoming_transactions", "outgoing_transactions", "total_in_amount", "total_out_amount", "max_fanout_counterparties"]
    matrix = np.log1p(features[columns].astype(float))
    if len(features) < 10:
        features["anomaly_flag"], features["anomaly_score"] = 1, 0.0
        return features
    model = IsolationForest(contamination=0.05, random_state=42, n_estimators=200)
    features["anomaly_flag"] = model.fit_predict(matrix)
    features["anomaly_score"] = (-model.decision_function(matrix)).round(4)
    return features


def score_components(row: pd.Series) -> dict[str, int]:
    return {
        "shared_device": 20 if row.shared_device else 0,
        "rapid_pass_through": 30 if row.multi_hop_routing else 0,
        "rapid_fanout": 15 if row.high_velocity_fanout else 0,
        "unusually_high_fanin": 15 if row.high_in_degree else 0,
        "high_value_flow": 10 if row.high_value_flow else 0,
        "behavioural_outlier": 10 if row.anomaly_flag == -1 else 0,
    }


def score_features(features: pd.DataFrame) -> pd.DataFrame:
    features = add_anomaly_signals(features)
    components = features.apply(score_components, axis=1)
    features["risk_score"] = components.map(lambda item: min(100, sum(item.values())))
    features["risk_reasons"] = components.map(lambda item: "; ".join(name.replace("_", " ") for name, points in item.items() if points))
    features["risk_tier"] = features.risk_score.map(risk_tier)
    return features


def risk_tier(score: int) -> str:
    return "HIGH" if score >= 55 else "MEDIUM" if score >= 30 else "LOW"


def main() -> None:
    edges, shared = load_data()
    features = score_features(compute_features(edges, shared))
    features.sort_values(["risk_score", "node"], ascending=[False, True]).to_csv(PROCESSED_DIR / "risk_scores.csv", index=False)
    print(f"Scored {len(features)} entities; {(features.risk_tier != 'LOW').sum()} require review.")


if __name__ == "__main__":
    main()
