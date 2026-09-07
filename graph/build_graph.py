"""Build the UPI flow graph and render a standalone, interactive HTML view."""

from __future__ import annotations

from pathlib import Path

import networkx as nx
import pandas as pd
from pyvis.network import Network

ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR, REPORT_DIR = ROOT / "data" / "processed", ROOT / "report"


def build_graph(upi: pd.DataFrame, shared_nodes: set[str]) -> nx.MultiDiGraph:
    graph = nx.MultiDiGraph()
    for row in upi.itertuples(index=False):
        graph.add_edge(str(row.sender_entity_id), str(row.receiver_entity_id), amount=float(row.amount), timestamp=str(row.timestamp))
    nx.set_node_attributes(graph, {node: node in shared_nodes for node in graph.nodes}, "shared_device")
    return graph


def render_html(graph: nx.MultiDiGraph, output: Path) -> None:
    net = Network(height="750px", width="100%", directed=True, bgcolor="#0b0e13", font_color="#f5f7fa", cdn_resources="remote")
    for node in graph.nodes:
        inbound, shared = graph.in_degree(node), graph.nodes[node]["shared_device"]
        color = "#ff5c5c" if shared else "#f2b134" if inbound >= 2 else "#4da6ff"
        net.add_node(node, label=node, color=color, title=f"Incoming transfers: {inbound}")
    for source, target, data in graph.edges(data=True):
        net.add_edge(source, target, value=data["amount"], title=f"₹{data['amount']:,.0f} · {data['timestamp']}")
    net.write_html(str(output))


def main() -> None:
    upi_path = PROCESSED_DIR / "upi.csv"
    if not upi_path.exists():
        raise FileNotFoundError("Run `python -m parsers.ingest` first.")
    shared_nodes: set[str] = set()
    links_path = PROCESSED_DIR / "entity_links.csv"
    if links_path.exists():
        links = pd.read_csv(links_path, dtype="string")
        shared_nodes = set(links.get("entity_a", pd.Series(dtype="string")).dropna()) | set(links.get("entity_b", pd.Series(dtype="string")).dropna())
    graph = build_graph(pd.read_csv(upi_path, dtype={"sender_entity_id": "string", "receiver_entity_id": "string"}), shared_nodes)
    edges = [{"sender": source, "receiver": target, **data} for source, target, data in graph.edges(data=True)]
    pd.DataFrame(edges, columns=["sender", "receiver", "amount", "timestamp"]).to_csv(PROCESSED_DIR / "graph_edges.csv", index=False)
    REPORT_DIR.mkdir(parents=True, exist_ok=True); render_html(graph, REPORT_DIR / "setu_graph.html")
    print(f"Graph built: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} transfers.")


if __name__ == "__main__":
    main()
