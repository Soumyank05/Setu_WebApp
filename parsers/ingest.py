"""Normalize source artifacts and record immutable SHA-256 intake hashes."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"


def file_hash(path: Path) -> str:
    """Return a SHA-256 digest calculated over the exact source bytes."""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(65_536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(files: list[Path]) -> dict[str, dict[str, int | str]]:
    return {
        path.name: {"sha256": file_hash(path), "size_bytes": path.stat().st_size}
        for path in files
    }


def require_columns(frame: pd.DataFrame, columns: set[str], source: Path) -> None:
    missing = columns - set(frame.columns)
    if missing:
        raise ValueError(f"{source.name} is missing required column(s): {', '.join(sorted(missing))}")


def parse_telecom(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path, dtype={"phone_number": "string", "imei": "string", "imsi": "string"})
    require_columns(frame, {"phone_number", "imei", "imsi", "timestamp", "tower_id"}, path)
    frame = frame.rename(columns={"phone_number": "entity_id"})
    frame["entity_type"] = "phone"
    frame["source_file"] = path.name
    return frame[["entity_id", "entity_type", "imei", "imsi", "timestamp", "tower_id", "source_file"]]


def parse_upi(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path, dtype={"sender_phone": "string", "receiver_upi": "string"})
    require_columns(frame, {"sender_phone", "receiver_upi", "amount", "timestamp"}, path)
    frame = frame.rename(columns={"sender_phone": "sender_entity_id", "receiver_upi": "receiver_entity_id"})
    frame["amount"] = pd.to_numeric(frame["amount"], errors="raise")
    frame["source_file"] = path.name
    return frame[["sender_entity_id", "receiver_entity_id", "amount", "timestamp", "source_file"]]


def main() -> None:
    telecom_path, upi_path = RAW_DIR / "telecom_cdr.csv", RAW_DIR / "upi_settlement.csv"
    missing = [str(path) for path in (telecom_path, upi_path) if not path.exists()]
    if missing:
        raise FileNotFoundError("Generate or provide source artifacts first: " + ", ".join(missing))

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    manifest = build_manifest([telecom_path, upi_path])
    (PROCESSED_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    telecom, upi = parse_telecom(telecom_path), parse_upi(upi_path)
    telecom.to_csv(PROCESSED_DIR / "telecom.csv", index=False)
    upi.to_csv(PROCESSED_DIR / "upi.csv", index=False)
    print(f"Hashed {len(manifest)} source files; normalized {len(telecom)} CDR rows and {len(upi)} UPI rows.")


if __name__ == "__main__":
    main()
