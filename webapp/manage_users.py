"""Terminal-only user provisioning for the SETU workspace."""

from __future__ import annotations

import argparse
import getpass
import sqlite3
import sys
from datetime import datetime, timezone

from pydantic import ValidationError

from webapp.main import CreateUser, db, hash_password, init_auth_db


def create_user(args: argparse.Namespace) -> int:
    password = getpass.getpass("Password: ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        print("Passwords do not match.", file=sys.stderr)
        return 2
    try:
        account = CreateUser(username=args.username, password=password, role=args.role)
    except ValidationError as exc:
        print(exc, file=sys.stderr)
        return 2

    init_auth_db()
    try:
        with db() as connection:
            cursor = connection.execute(
                "INSERT INTO users (username, password_hash, role, created_at, force_password_reset) VALUES (?, ?, ?, ?, 1)",
                (account.username, hash_password(account.password), account.role, datetime.now(timezone.utc).isoformat()),
            )
    except sqlite3.IntegrityError:
        print("That username is already in use.", file=sys.stderr)
        return 2
    print(f"Created user ID #{cursor.lastrowid} for {account.username} ({account.role}).")
    return 0


def list_users(_: argparse.Namespace) -> int:
    init_auth_db()
    with db() as connection:
        rows = connection.execute("SELECT id, username, role, is_active, force_password_reset, locked_at, created_at FROM users ORDER BY id").fetchall()
    if not rows:
        print("No users provisioned.")
        return 0
    for row in rows:
        state = "locked" if row["locked_at"] else ("active" if row["is_active"] else "disabled")
        reset = "reset required" if row["force_password_reset"] else "ready"
        print(f"#{row['id']}  {row['username']:<24} {row['role']:<12} {state:<8} {reset:<14} {row['created_at']}")
    return 0


def set_account_state(args: argparse.Namespace) -> int:
    init_auth_db()
    with db() as connection:
        cursor = connection.execute("UPDATE users SET is_active = ? WHERE username = ?", (1 if args.enabled else 0, args.username))
    if not cursor.rowcount:
        print("User not found.", file=sys.stderr); return 2
    print(f"{args.username} {'enabled' if args.enabled else 'disabled'}.")
    return 0


def reset_password(args: argparse.Namespace) -> int:
    password = getpass.getpass("New password: "); confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation or len(password) < 12:
        print("Passwords must match and be at least 12 characters.", file=sys.stderr); return 2
    init_auth_db()
    with db() as connection:
        cursor = connection.execute("UPDATE users SET password_hash = ?, force_password_reset = 1, failed_login_attempts = 0, locked_at = NULL WHERE username = ?", (hash_password(password), args.username))
    if not cursor.rowcount:
        print("User not found.", file=sys.stderr); return 2
    print(f"Password reset for {args.username}."); return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage SETU user IDs from the terminal.")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="Create a user ID")
    create.add_argument("username")
    create.add_argument("--role", choices=("admin", "supervisor", "investigator"), default="investigator")
    create.set_defaults(handler=create_user)
    listing = commands.add_parser("list", help="List provisioned user IDs")
    listing.set_defaults(handler=list_users)
    for name, enabled, help_text in (("enable", True, "Enable a user ID"), ("disable", False, "Disable a user ID")):
        command = commands.add_parser(name, help=help_text); command.add_argument("username"); command.set_defaults(handler=set_account_state, enabled=enabled)
    reset = commands.add_parser("reset-password", help="Reset a user's password")
    reset.add_argument("username"); reset.set_defaults(handler=reset_password)
    args = parser.parse_args()
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
