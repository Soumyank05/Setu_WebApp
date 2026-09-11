"""Resolve known ownership and identify device reuse across telecom artifacts."""

from __future__ import annotations

from itertools import combinations
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = ROOT / "data" / "processed"
RAW_DIR = ROOT / "data" / "raw"


def find_shared_device_links(telecom: pd.DataFrame) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    for imei, group in telecom.dropna(subset=["imei"]).groupby("imei"):
        phones = sorted(group["entity_id"].astype(str).unique())
        for first, second in combinations(phones, 2):
            # A shared device is high-confidence correlation evidence, not an
            # identity conclusion.  Preserve that distinction for the reviewer.
            links.append({"entity_a": first, "entity_b": second, "relationship": "shared_device",
                          "evidence": f"shared IMEI {imei}", "confidence": 0.98,
                          "match_basis": "exact_device_identifier", "review_required": True})
    return links


def build_identity_map(kyc: pd.DataFrame) -> pd.DataFrame:
    required = {"phone_number", "upi_handle"}
    if missing := required - set(kyc.columns):
        raise ValueError(f"kyc_mapping.csv is missing: {', '.join(sorted(missing))}")
    rows = []
    for row in kyc.dropna(subset=["phone_number", "upi_handle"]).itertuples(index=False):
        phone, handle = str(row.phone_number), str(row.upi_handle)
        rows.extend(({"raw_id": phone, "canonical_id": phone}, {"raw_id": handle, "canonical_id": phone}))
    return pd.DataFrame(rows).drop_duplicates("raw_id")


def main() -> None:
    telecom_path = PROCESSED_DIR / "telecom.csv"
    if not telecom_path.exists():
        raise FileNotFoundError("Run `python -m parsers.ingest` first.")
    links = find_shared_device_links(pd.read_csv(telecom_path, dtype={"entity_id": "string", "imei": "string"}))
    pd.DataFrame(links, columns=["entity_a", "entity_b", "relationship", "evidence", "confidence", "match_basis", "review_required"]).to_csv(PROCESSED_DIR / "entity_links.csv", index=False)

    kyc_path = RAW_DIR / "kyc_mapping.csv"
    if kyc_path.exists():
        identity_map = build_identity_map(pd.read_csv(kyc_path, dtype="string"))
        identity_map.to_csv(PROCESSED_DIR / "identity_map.csv", index=False)
        print(f"Found {len(links)} shared-device link(s); mapped {len(identity_map)} raw identities.")
    else:
        print(f"Found {len(links)} shared-device link(s); no KYC mapping supplied.")


if __name__ == "__main__":
    main()
