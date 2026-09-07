"""A small, self-contained demonstration of SETU's core libraries."""

from pathlib import Path
import hashlib

import networkx as nx
import pandas as pd
from sklearn.ensemble import IsolationForest

telecom = pd.DataFrame({"phone": ["9800000001", "9800000002", "9800000003"], "imei": ["IMEI-A", "IMEI-A", "IMEI-B"]})
upi = pd.DataFrame({"sender": ["9800000001", "9800000002", "9800000003"], "receiver": ["upi_mule1"] * 3, "amount": [5000, 7000, 6000]})
merged = upi.merge(telecom, left_on="sender", right_on="phone", how="left")
print("Distinct senders per receiver:\n", merged.groupby("receiver").sender.nunique())
sample = Path(__file__).with_name("telecom_demo.csv"); telecom.to_csv(sample, index=False)
print("SHA-256:", hashlib.sha256(sample.read_bytes()).hexdigest())
graph = nx.DiGraph(); [graph.add_edge(row.sender, row.receiver, amount=row.amount) for row in merged.itertuples()]
features = pd.DataFrame({"in_degree": [graph.in_degree(n) for n in graph], "amount_sum": [sum(data["amount"] for _, _, data in graph.in_edges(n, data=True)) for n in graph]}, index=list(graph))
features["anomaly"] = IsolationForest(contamination=0.3, random_state=42).fit_predict(features)
print(features)
