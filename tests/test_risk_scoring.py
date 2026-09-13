"""Unit tests for evidence-backed risk signals."""

import unittest

import pandas as pd

from scoring.score import compute_features, score_features


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


if __name__ == "__main__":
    unittest.main()
