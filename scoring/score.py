"""Produce explainable, time-aware risk scores for transaction graph entities.

The score is a triage aid, not a determination of wrongdoing. It combines
reviewable behavioural signals and retains the underlying measurements.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = ROOT / "data" / "processed"
CONFIG_PATH = Path(__file__).with_name("risk_config.json")
DEFAULT_CONFIG = {
    "version": "2026.09.1",
    "pass_through_window_minutes": 15, "pass_through_ratio_min": 0.70, "pass_through_ratio_max": 1.30,
    "fanout_window_minutes": 15, "min_fanout_counterparties": 2,
    "high_fanin_quantile": 0.90, "high_fanin_minimum": 3, "high_value_quantile": 0.95,
    "anomaly_contamination": 0.05, "high_tier_minimum": 55, "medium_tier_minimum": 30,
    "signal_weights": {"shared_device": 20, "rapid_pass_through": 30, "rapid_fanout": 15,
                       "unusually_high_fanin": 15, "high_value_flow": 10, "behavioural_outlier": 10},
}


def load_config(path: Path | None = None) -> dict:
    """Load a versioned rule set and reject unsafe or incomplete overrides."""
    source = path or Path(os.environ.get("SETU_RISK_CONFIG", CONFIG_PATH))
    config = {**DEFAULT_CONFIG, "signal_weights": dict(DEFAULT_CONFIG["signal_weights"])}
    if source.exists():
        try:
            override = json.loads(source.read_text())
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(f"Invalid risk configuration: {source}") from error
        if not isinstance(override, dict):
            raise ValueError("Risk configuration must be a JSON object.")
        config.update({key: value for key, value in override.items() if key != "signal_weights"})
        if "signal_weights" in override:
            if not isinstance(override["signal_weights"], dict):
                raise ValueError("signal_weights must be an object.")
            config["signal_weights"].update(override["signal_weights"])
    numeric = ("pass_through_window_minutes", "fanout_window_minutes", "min_fanout_counterparties", "high_fanin_minimum", "high_tier_minimum", "medium_tier_minimum")
    if not str(config["version"]).strip() or any(float(config[key]) < 0 for key in numeric):
        raise ValueError("Risk configuration contains invalid version or thresholds.")
    if not (0 < float(config["pass_through_ratio_min"]) <= float(config["pass_through_ratio_max"]) and 0 < float(config["anomaly_contamination"]) < .5):
        raise ValueError("Risk configuration contains invalid scoring ranges.")
    if not (0 < float(config["high_fanin_quantile"]) <= 1 and 0 < float(config["high_value_quantile"]) <= 1):
        raise ValueError("Risk configuration quantiles must be between 0 and 1.")
    if set(DEFAULT_CONFIG["signal_weights"]) - set(config["signal_weights"]) or any(float(value) < 0 for value in config["signal_weights"].values()):
        raise ValueError("Risk configuration contains invalid signal weights.")
    return config


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


def _pass_through(incoming: pd.DataFrame, outgoing: pd.DataFrame, config: dict) -> tuple[bool, float]:
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
            & (outgoing.timestamp <= received.timestamp + pd.Timedelta(minutes=config["pass_through_window_minutes"])),
            "amount",
        ].sum()
        strongest = max(strongest, float(forwarded / received.amount))
    return config["pass_through_ratio_min"] <= strongest <= config["pass_through_ratio_max"], round(strongest, 3)


def _max_window_fanout(outgoing: pd.DataFrame, config: dict) -> int:
    """Return the maximum number of distinct recipients in a short window."""
    largest = 0
    for start in outgoing.timestamp:
        recipients = outgoing.loc[
            (outgoing.timestamp >= start) & (outgoing.timestamp <= start + pd.Timedelta(minutes=config["fanout_window_minutes"])), "receiver"
        ].nunique()
        largest = max(largest, int(recipients))
    return largest


def compute_features(edges: pd.DataFrame, shared: set[str], config: dict | None = None) -> pd.DataFrame:
    config = config or load_config()
    rows = []
    if edges.empty:
        return pd.DataFrame(columns=["node", "in_degree", "out_degree", "incoming_transactions", "outgoing_transactions", "total_in_amount", "total_out_amount", "shared_device", "multi_hop_routing", "pass_through_ratio", "max_fanout_counterparties", "high_velocity_fanout", "high_in_degree", "high_value_flow"])
    # Group once instead of filtering the entire edge list for every entity.
    # This keeps full-case scoring practical as the number of entities grows.
    incoming_by_node = {node: group.sort_values("timestamp") for node, group in edges.groupby("receiver", sort=False)}
    outgoing_by_node = {node: group.sort_values("timestamp") for node, group in edges.groupby("sender", sort=False)}
    # Preserve first-seen input order so the seeded anomaly model remains
    # reproducible across scoring runs.
    nodes = pd.unique(edges[["sender", "receiver"]].to_numpy().ravel())
    for node in nodes:
        incoming = incoming_by_node.get(node, edges.iloc[0:0])
        outgoing = outgoing_by_node.get(node, edges.iloc[0:0])
        multi_hop, pass_through_ratio = _pass_through(incoming, outgoing, config)
        max_fanout = _max_window_fanout(outgoing, config)
        rows.append({
            "node": node, "in_degree": incoming.sender.nunique(), "out_degree": outgoing.receiver.nunique(),
            "incoming_transactions": len(incoming), "outgoing_transactions": len(outgoing),
            "total_in_amount": incoming.amount.sum(), "total_out_amount": outgoing.amount.sum(),
            "shared_device": node in shared, "multi_hop_routing": multi_hop, "pass_through_ratio": pass_through_ratio,
            "max_fanout_counterparties": max_fanout, "high_velocity_fanout": max_fanout >= config["min_fanout_counterparties"],
        })
    features = pd.DataFrame(rows)
    threshold = max(config["high_fanin_minimum"], int(np.ceil(features["in_degree"].quantile(config["high_fanin_quantile"])))) if len(features) else config["high_fanin_minimum"]
    features["high_in_degree"] = features["in_degree"] >= threshold
    flow = features[["total_in_amount", "total_out_amount"]].max(axis=1)
    features["high_value_flow"] = flow >= flow.quantile(config["high_value_quantile"])
    return features


def add_anomaly_signals(features: pd.DataFrame, config: dict) -> pd.DataFrame:
    """Add a reproducible outlier signal, after log-scaling skewed monetary data."""
    features = features.copy()
    if features.empty:
        features["anomaly_flag"] = pd.Series(dtype="int64")
        features["anomaly_score"] = pd.Series(dtype="float64")
        return features
    columns = ["in_degree", "out_degree", "incoming_transactions", "outgoing_transactions", "total_in_amount", "total_out_amount", "max_fanout_counterparties"]
    matrix = np.log1p(features[columns].astype(float))
    if len(features) < 10:
        features["anomaly_flag"], features["anomaly_score"] = 1, 0.0
        return features
    model = IsolationForest(contamination=config["anomaly_contamination"], random_state=42, n_estimators=200)
    features["anomaly_flag"] = model.fit_predict(matrix)
    features["anomaly_score"] = (-model.decision_function(matrix)).round(4)
    return features


def score_components(row: pd.Series, config: dict) -> dict[str, int]:
    weights = config["signal_weights"]
    return {
        "shared_device": weights["shared_device"] if row.shared_device else 0,
        "rapid_pass_through": weights["rapid_pass_through"] if row.multi_hop_routing else 0,
        "rapid_fanout": weights["rapid_fanout"] if row.high_velocity_fanout else 0,
        "unusually_high_fanin": weights["unusually_high_fanin"] if row.high_in_degree else 0,
        "high_value_flow": weights["high_value_flow"] if row.high_value_flow else 0,
        "behavioural_outlier": weights["behavioural_outlier"] if row.anomaly_flag == -1 else 0,
    }


def score_features(features: pd.DataFrame, config: dict | None = None) -> pd.DataFrame:
    config = config or load_config()
    features = add_anomaly_signals(features, config)
    components = features.apply(lambda row: score_components(row, config), axis=1)
    features["risk_score"] = components.map(lambda item: min(100, sum(item.values())))
    features["risk_reasons"] = components.map(lambda item: "; ".join(name.replace("_", " ") for name, points in item.items() if points))
    features["risk_tier"] = features.risk_score.map(lambda score: risk_tier(score, config))
    features["scoring_model_version"] = config["version"]
    return features


def compute_risk_paths(edges: pd.DataFrame, features: pd.DataFrame, config: dict) -> pd.DataFrame:
    """Surface rapid, value-retaining two-hop routes around reviewed entities.

    A path is evidence for review, not proof that the parties are coordinated.
    The retained value is calculated from all payments made shortly after one
    incoming transfer, so split cash-out behaviour remains visible.
    """
    scores = features.set_index("node").to_dict("index")
    candidates = {node for node, row in scores.items() if row["risk_score"] >= config["medium_tier_minimum"]}
    outgoing = {node: group.sort_values("timestamp") for node, group in edges.groupby("sender")}
    rows = []
    window = pd.Timedelta(minutes=config["pass_through_window_minutes"])
    for received in edges[edges.receiver.isin(candidates)].itertuples(index=False):
        if received.amount <= 0:
            continue
        sent = outgoing.get(received.receiver, pd.DataFrame())
        forwarded = sent[(sent.timestamp >= received.timestamp) & (sent.timestamp <= received.timestamp + window)]
        forwarded_value = float(forwarded.amount.sum())
        ratio = forwarded_value / float(received.amount)
        if not (config["pass_through_ratio_min"] <= ratio <= config["pass_through_ratio_max"]):
            continue
        destinations = sorted(str(item) for item in forwarded.receiver.unique())
        base = int(scores[received.receiver]["risk_score"])
        path_score = min(100, base + 10 + (5 if len(destinations) > 1 else 0))
        rows.append({
            "source": str(received.sender), "intermediary": str(received.receiver), "destinations": " | ".join(destinations),
            "received_amount": round(float(received.amount), 2), "forwarded_amount": round(forwarded_value, 2),
            "retention_ratio": round(ratio, 3), "received_at": received.timestamp.isoformat(),
            "forwarded_until": forwarded.timestamp.max().isoformat(), "forwarded_transactions": len(forwarded),
            "path_score": path_score, "path_tier": risk_tier(path_score, config),
            "path_reasons": "rapid value-retaining forwarding" + ("; split to multiple recipients" if len(destinations) > 1 else ""),
            "scoring_model_version": config["version"],
        })
    columns = ["source", "intermediary", "destinations", "received_amount", "forwarded_amount", "retention_ratio", "received_at", "forwarded_until", "forwarded_transactions", "path_score", "path_tier", "path_reasons", "scoring_model_version"]
    if not rows:
        return pd.DataFrame(columns=columns)
    # Deduplicate evidence rows before ranking so retries or duplicated input
    # records do not inflate the investigator's path queue.
    return pd.DataFrame(rows).drop_duplicates(subset=["source", "intermediary", "destinations", "received_at"]).sort_values(["path_score", "received_at"], ascending=[False, True])


def risk_tier(score: int, config: dict | None = None) -> str:
    config = config or load_config()
    return "HIGH" if score >= config["high_tier_minimum"] else "MEDIUM" if score >= config["medium_tier_minimum"] else "LOW"


def main() -> None:
    config = load_config()
    edges, shared = load_data()
    features = score_features(compute_features(edges, shared, config), config)
    features.sort_values(["risk_score", "node"], ascending=[False, True]).to_csv(PROCESSED_DIR / "risk_scores.csv", index=False)
    paths = compute_risk_paths(edges, features, config)
    paths.to_csv(PROCESSED_DIR / "risk_paths.csv", index=False)
    print(f"Scored {len(features)} entities; {(features.risk_tier != 'LOW').sum()} require review; {len(paths)} rapid paths surfaced.")


if __name__ == "__main__":
    main()
