"""Create synthetic telecom, UPI, and KYC artifacts containing one mule chain."""

from __future__ import annotations

import csv
import random
from datetime import datetime, timedelta
from pathlib import Path

from faker import Faker

OUT_DIR = Path(__file__).parent / "raw"
BASE_TIME = datetime(2026, 8, 20, 9, 0, 0)
NOISE_PEOPLE, NOISE_TRANSACTIONS = 500, 500
fake = Faker("en_IN")


def digits(length: int) -> str:
    return "".join(str(random.randint(0, 9)) for _ in range(length))


def phone() -> str:
    return "9" + digits(9)


def timestamp(hours: int = 24 * 30) -> str:
    return (BASE_TIME + timedelta(minutes=random.randint(0, hours * 60))).isoformat()


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    people = [{"phone": phone(), "imei": "IMEI-" + digits(10), "imsi": "IMSI-" + digits(10), "upi": fake.user_name() + "@upi"} for _ in range(NOISE_PEOPLE)]
    telecom, upi = [], []
    for person in people:
        for _ in range(random.randint(3, 7)):
            telecom.append({"phone_number": person["phone"], "imei": person["imei"], "imsi": person["imsi"], "timestamp": timestamp(), "tower_id": f"TWR-{random.randint(100, 199)}"})
    for _ in range(NOISE_TRANSACTIONS):
        sender, receiver = random.sample(people, 2)
        upi.append({"sender_phone": sender["phone"], "receiver_upi": receiver["upi"], "amount": random.choice([100, 250, 500, 999, 1500, 2000]), "timestamp": timestamp()})

    victim, mule_one, mule_two = phone(), phone(), phone()
    shared_imei = "IMEI-" + digits(10)
    handle_one, handle_two, cashout = "quickpay.mule1@upi", "swiftcash.mule2@upi", "finalpoint.cashout@upi"
    fraud_start = datetime(2026, 8, 25, 14, 0, 0)
    telecom.extend([
        {"phone_number": victim, "imei": "IMEI-" + digits(10), "imsi": "IMSI-" + digits(10), "timestamp": (fraud_start - timedelta(hours=1)).isoformat(), "tower_id": "TWR-101"},
        {"phone_number": mule_one, "imei": shared_imei, "imsi": "IMSI-" + digits(10), "timestamp": fraud_start.isoformat(), "tower_id": "TWR-104"},
        {"phone_number": mule_two, "imei": shared_imei, "imsi": "IMSI-" + digits(10), "timestamp": (fraud_start + timedelta(minutes=5)).isoformat(), "tower_id": "TWR-104"},
    ])
    upi.extend([
        {"sender_phone": victim, "receiver_upi": handle_one, "amount": 48000, "timestamp": fraud_start.isoformat()},
        {"sender_phone": mule_one, "receiver_upi": handle_two, "amount": 22000, "timestamp": (fraud_start + timedelta(minutes=3)).isoformat()},
        {"sender_phone": mule_one, "receiver_upi": cashout, "amount": 25000, "timestamp": (fraud_start + timedelta(minutes=4)).isoformat()},
        {"sender_phone": mule_two, "receiver_upi": cashout, "amount": 21000, "timestamp": (fraud_start + timedelta(minutes=9)).isoformat()},
    ])
    random.shuffle(telecom); random.shuffle(upi)
    for name, rows, fields in (
        ("telecom_cdr.csv", telecom, ["phone_number", "imei", "imsi", "timestamp", "tower_id"]),
        ("upi_settlement.csv", upi, ["sender_phone", "receiver_upi", "amount", "timestamp"]),
        ("kyc_mapping.csv", [{"phone_number": p["phone"], "upi_handle": p["upi"]} for p in people] + [{"phone_number": mule_one, "upi_handle": handle_one}, {"phone_number": mule_two, "upi_handle": handle_two}], ["phone_number", "upi_handle"]),
    ):
        with (OUT_DIR / name).open("w", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=fields); writer.writeheader(); writer.writerows(rows)
    print(f"Wrote {len(telecom)} CDRs, {len(upi)} UPI transactions, and {len(people) + 2} KYC records.")
    print(f"Planted chain: victim {victim} -> {handle_one}; shared device {shared_imei}; cashout {cashout}.")


if __name__ == "__main__":
    main()
