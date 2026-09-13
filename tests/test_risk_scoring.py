"""Unit tests for evidence-backed risk signals."""

import unittest
import json
import tempfile
from pathlib import Path

import pandas as pd

from scoring.score import compute_features, compute_risk_paths, load_config, score_features


class RiskScoringTests(unittest.TestCase):
    def test_split_forwarding_and_distinct_fanout_are_flagged(self):
        edges = pd.DataFrame([
            {"sender": "victim", "receiver": "mule", "amount": 1000, "timestamp": "2026-01-01T10:00:00"},
            {"sender": "mule", "receiver": "cashout-a", "amount": 480, "timestamp": "2026-01-01T10:03:00"},
            {"sender": "mule", "receiver": "cashout-b", "amount": 450, "timestamp": "2026-01-01T10:05:00"},
        ])
        edges["timestamp"] = pd.to_datetime(edges["timestamp"])
        mule = compute_features(edges, {"mule"}).set_index("node").loc["mule"]
        self.assertTrue(mule.multi_hop_routing)
        self.assertTrue(mule.high_velocity_fanout)
        self.assertEqual(mule.max_fanout_counterparties, 2)
        self.assertAlmostEqual(mule.pass_through_ratio, 0.93)

    def test_unrelated_small_follow_on_payment_is_not_pass_through(self):
        edges = pd.DataFrame([
            {"sender": "source", "receiver": "account", "amount": 1000, "timestamp": "2026-01-01T10:00:00"},
            {"sender": "account", "receiver": "merchant", "amount": 40, "timestamp": "2026-01-01T10:05:00"},
        ])
        edges["timestamp"] = pd.to_datetime(edges["timestamp"])
        account = compute_features(edges, set()).set_index("node").loc["account"]
        self.assertFalse(account.multi_hop_routing)

    def test_score_keeps_explanation_and_tier_consistent(self):
        features = pd.DataFrame([{
            "node": "mule", "in_degree": 1, "out_degree": 2, "incoming_transactions": 1, "outgoing_transactions": 2,
            "total_in_amount": 1000, "total_out_amount": 930, "shared_device": True, "multi_hop_routing": True,
            "pass_through_ratio": .93, "max_fanout_counterparties": 2, "high_velocity_fanout": True,
            "high_in_degree": False, "high_value_flow": False,
        }])
        scored = score_features(features).iloc[0]
        self.assertEqual(scored.risk_tier, "HIGH")
        self.assertIn("rapid pass through", scored.risk_reasons)

    def test_versioned_rule_set_can_adjust_weights_and_tiers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rules.json"
            path.write_text(json.dumps({"version": "test-rules-1", "high_tier_minimum": 40, "signal_weights": {"shared_device": 40}}))
            config = load_config(path)
        features = pd.DataFrame([{
            "node": "candidate", "in_degree": 0, "out_degree": 0, "incoming_transactions": 0, "outgoing_transactions": 0,
            "total_in_amount": 0, "total_out_amount": 0, "shared_device": True, "multi_hop_routing": False,
            "pass_through_ratio": 0, "max_fanout_counterparties": 0, "high_velocity_fanout": False,
            "high_in_degree": False, "high_value_flow": False,
        }])
        scored = score_features(features, config).iloc[0]
        self.assertEqual(scored.risk_score, 40)
        self.assertEqual(scored.risk_tier, "HIGH")
        self.assertEqual(scored.scoring_model_version, "test-rules-1")

    def test_rapid_value_retaining_path_is_scored(self):
        edges = pd.DataFrame([
            {"sender": "victim", "receiver": "mule", "amount": 1000, "timestamp": "2026-01-01T10:00:00"},
            {"sender": "mule", "receiver": "cashout-a", "amount": 480, "timestamp": "2026-01-01T10:03:00"},
            {"sender": "mule", "receiver": "cashout-b", "amount": 450, "timestamp": "2026-01-01T10:05:00"},
        ])
        edges["timestamp"] = pd.to_datetime(edges["timestamp"])
        config = load_config()
        features = score_features(compute_features(edges, {"mule"}, config), config)
        paths = compute_risk_paths(edges, features, config)
        self.assertEqual(len(paths), 1)
        path = paths.iloc[0]
        self.assertEqual(path.intermediary, "mule")
        self.assertAlmostEqual(path.retention_ratio, .93)
        self.assertEqual(path.forwarded_transactions, 2)
        self.assertIn("split to multiple recipients", path.path_reasons)

    def test_empty_case_returns_a_valid_empty_score_set(self):
        edges = pd.DataFrame(columns=["sender", "receiver", "amount", "timestamp"])
        features = compute_features(edges, set(), load_config())
        scored = score_features(features, load_config())
        self.assertTrue(scored.empty)
        self.assertIn("risk_score", scored.columns)


if __name__ == "__main__":
    unittest.main()
