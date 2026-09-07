"""Produce explainable, time-aware risk scores for transaction graph entities."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from sklearn.ensemble import IsolationForest

ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = ROOT / "data" / "processed"
MULTI_HOP_WINDOW, FANOUT_WINDOW, HIGH_IN_DEGREE = 15, 15, 3


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
    return edges, shared


def compute_features(edges: pd.DataFrame, shared: set[str]) -> pd.DataFrame:
    rows = []
    for node in pd.unique(edges[["sender", "receiver"]].to_numpy().ravel()):
        incoming = edges[edges.receiver == node].sort_values("timestamp")
        outgoing = edges[edges.sender == node].sort_values("timestamp")
        multi_hop = any(((outgoing.timestamp >= received) & (outgoing.timestamp <= received + pd.Timedelta(minutes=MULTI_HOP_WINDOW))).any() for received in incoming.timestamp)
        times = outgoing.timestamp.tolist()
        fanout = any(later - earlier <= pd.Timedelta(minutes=FANOUT_WINDOW) for earlier, later in zip(times, times[1:]))
        rows.append({"node": node, "in_degree": incoming.sender.nunique(), "out_degree": outgoing.receiver.nunique(), "total_in_amount": incoming.amount.sum(), "total_out_amount": outgoing.amount.sum(), "shared_device": node in shared, "multi_hop_routing": multi_hop, "high_velocity_fanout": fanout, "high_in_degree": incoming.sender.nunique() >= HIGH_IN_DEGREE})
    return pd.DataFrame(rows)


def heuristic_score(row: pd.Series) -> int:
    return min(100, 25 * row.shared_device + 30 * row.multi_hop_routing + 25 * row.high_velocity_fanout + 20 * row.high_in_degree)


def risk_tier(score: int) -> str:
    return "HIGH" if score >= 50 else "MEDIUM" if score >= 25 else "LOW"


def main() -> None:
    edges, shared = load_data()
    features = compute_features(edges, shared)
    features["risk_score"] = features.apply(heuristic_score, axis=1)
    features["risk_tier"] = features.risk_score.map(risk_tier)
    numeric = features[["in_degree", "out_degree", "total_in_amount", "total_out_amount"]]
    features["anomaly_flag"] = IsolationForest(contamination=0.15, random_state=42).fit_predict(numeric) if len(features) > 1 else 1
    features.sort_values(["risk_score", "node"], ascending=[False, True]).to_csv(PROCESSED_DIR / "risk_scores.csv", index=False)
    print(f"Scored {len(features)} entities; {(features.risk_tier != 'LOW').sum()} require review.")


if __name__ == "__main__":
    main()
