"""Unit tests for stateless cryptographic session authentication in serverless environments."""

import unittest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from webapp import main
from webapp.main import app, db, generate_signed_session_token, verify_signed_session_token


class ServerlessAuthTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_signed_token_roundtrip(self):
        payload = {
            "user_id": 12,
            "username": "admin",
            "role": "admin",
            "force_password_reset": False,
            "exp": (datetime.now(timezone.utc) + timedelta(hours=1)).timestamp(),
        }
        token = generate_signed_session_token(payload)
        verified = verify_signed_session_token(token)
        self.assertIsNotNone(verified)
        self.assertEqual(verified["user_id"], 12)
        self.assertEqual(verified["username"], "admin")
        self.assertEqual(verified["role"], "admin")

    def test_tampered_token_rejected(self):
        payload = {
            "user_id": 12,
            "username": "admin",
            "role": "admin",
            "exp": (datetime.now(timezone.utc) + timedelta(hours=1)).timestamp(),
        }
        token = generate_signed_session_token(payload)
        self.assertIsNone(verify_signed_session_token(token + "tampered"))

    def test_expired_token_rejected(self):
        payload = {
            "user_id": 12,
            "username": "admin",
            "role": "admin",
            "exp": (datetime.now(timezone.utc) - timedelta(seconds=10)).timestamp(),
        }
        token = generate_signed_session_token(payload)
        self.assertIsNone(verify_signed_session_token(token))

    def test_multi_container_session_persistence(self):
        """Verify that a session issued by one instance works when another instance has an empty sessions table."""
        # 1. Login to get cookie
        response = self.client.post("/api/auth/login", json={"username": "admin", "password": "Admin@12345678"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("setu_session", self.client.cookies)

        # 2. Simulate Container B with empty SQLite sessions table
        with db() as conn:
            conn.execute("DELETE FROM sessions")

        # 3. Authenticate against /api/auth/me - must succeed 200 without sessions row
        me_resp = self.client.get("/api/auth/me")
        self.assertEqual(me_resp.status_code, 200)
        user = me_resp.json()
        self.assertEqual(user["username"], "admin")
        self.assertEqual(user["role"], "admin")

        # 4. Access protected data endpoint /api/case
        case_resp = self.client.get("/api/case")
        self.assertEqual(case_resp.status_code, 200)

        # 5. Logout clears cookie
        logout_resp = self.client.post("/api/auth/logout")
        self.assertEqual(logout_resp.status_code, 204)
        post_logout_me = self.client.get("/api/auth/me")
        self.assertEqual(post_logout_me.status_code, 401)
