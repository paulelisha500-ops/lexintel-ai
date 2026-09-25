"""
Run once, after `init_db()` has created the tables, to create the first
account. Every other account gets created through POST /auth/users by an
admin from here on -- there's no public registration endpoint.

Usage:
    python -m scripts.seed_admin --username admin --password <pw> --full-name "System Administrator"
"""

from __future__ import annotations

import argparse
import getpass

from app.db.base import get_session, init_db
from app.db.postgres_repository import UserRepository
from app.core.security import hash_password
from app.models.auth_models import SystemRole


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the first LexIntel admin account.")
    parser.add_argument("--username", required=True)
    parser.add_argument("--full-name", required=True)
    parser.add_argument("--role", default="admin", choices=[r.value for r in SystemRole])
    parser.add_argument("--password", help="Omit to be prompted (recommended -- avoids shell history).")
    args = parser.parse_args()

    password = args.password or getpass.getpass("Password: ")

    init_db()
    with get_session() as db:
        repo = UserRepository(db)
        if repo.get_by_username(args.username):
            print(f"User '{args.username}' already exists -- nothing to do.")
            return
        repo.create(
            username=args.username,
            hashed_password=hash_password(password),
            full_name=args.full_name,
            role=SystemRole(args.role),
        )
    print(f"Created {args.role} account '{args.username}'.")


if __name__ == "__main__":
    main()
