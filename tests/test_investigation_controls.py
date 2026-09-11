"""Focused regression tests for explainability and tamper-evident audit controls."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from webapp import main


class InvestigationControlTests(unittest.TestCase):
    def test_shortest_path_returns_the_minimum_hops(self):
        edges = [
            {"sender": "A", "receiver": "B", "amount": 10, "timestamp": "2026-01-01"},
            {"sender": "B", "receiver": "C", "amount": 20, "timestamp": "2026-01-02"},
            {"sender": "A", "receiver": "D", "amount": 30, "timestamp": "2026-01-01"},
            {"sender": "D", "receiver": "E", "amount": 40, "timestamp": "2026-01-02"},
            {"sender": "E", "receiver": "C", "amount": 50, "timestamp": "2026-01-03"},
        ]
        with patch.object(main, "records", return_value=edges):
            result = main.shortest_path("A", "C")
        self.assertTrue(result["connected"])
        self.assertEqual(result["nodes"], ["A", "B", "C"])

    def test_audit_entries_are_chained(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audit.jsonl"
            with patch.object(main, "AUDIT_PATH", path), patch.object(main, "PROCESSED", Path(directory)):
                main.audit("first", {"record": 1})
                main.audit("second", {"record": 2})
            entries = [json.loads(line) for line in path.read_text().splitlines()]
        self.assertEqual(entries[1]["previous_hash"], entries[0]["entry_hash"])
        self.assertNotEqual(entries[0]["entry_hash"], entries[1]["entry_hash"])

    def test_cluster_detection_flags_connected_group(self):
        edges = [
            {"sender": "A", "receiver": "B", "timestamp": "1"},
            {"sender": "B", "receiver": "C", "timestamp": "2"},
            {"sender": "C", "receiver": "A", "timestamp": "3"},
        ]
        with patch.object(main, "records", return_value=edges):
            result = main.graph_intelligence()
        self.assertEqual(result["clusters"][0]["entity_count"], 3)
        self.assertEqual(result["clusters"][0]["signal"], "Potential coordinated ring")

    def test_requester_cannot_approve_their_own_sensitive_action(self):
        with tempfile.TemporaryDirectory() as directory:
            approvals = Path(directory) / "approvals.json"
            audit_path = Path(directory) / "audit.jsonl"
            approvals.write_text(json.dumps([{"id": "APR-1", "action": "evidence_export", "node": "CASE", "message": "Required", "requested_by": "investigator", "status": "pending"}]))
            with patch.object(main, "APPROVALS_PATH", approvals), patch.object(main, "AUDIT_PATH", audit_path), patch.object(main, "PROCESSED", Path(directory)):
                with self.assertRaises(main.HTTPException) as error:
                    main.decide_approval("APR-1", main.ApprovalDecision(decision="approved", rationale="self"), {"username": "investigator", "role": "supervisor"})
        self.assertEqual(error.exception.status_code, 403)

    def test_consumed_approval_cannot_be_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            approvals = Path(directory) / "approvals.json"
            audit_path = Path(directory) / "audit.jsonl"
            approvals.write_text(json.dumps([{"id": "APR-2", "action": "evidence_export", "status": "approved"}]))
            user = {"username": "supervisor"}
            with patch.object(main, "APPROVALS_PATH", approvals), patch.object(main, "AUDIT_PATH", audit_path), patch.object(main, "PROCESSED", Path(directory)):
                main.consume_approval("evidence_export", user)
                with self.assertRaises(main.HTTPException):
                    main.consume_approval("evidence_export", user)


if __name__ == "__main__":
    unittest.main()
