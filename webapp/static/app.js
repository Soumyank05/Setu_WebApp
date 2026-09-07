/* =========================================================
   SETU INVESTIGATION WORKSPACE
   Main dashboard controller

   Features:
   - Case loading
   - Risk metrics
   - Priority queue
   - Entity Intelligence
   - Network Explorer
   - Evidence Integrity
   - Pipeline execution
   - Robust dynamic click handling
   ========================================================= */


/* =========================================================
   STATE
   ========================================================= */

const state = {
  scores: [],
  links: [],
  edges: [],

  manifest: {},
  case: {},

  notes: [],
  reviews: {},
  audit: [],

  report_available: false,

  network: {
    selected: null,
    search: "",
    risk: "ALL",
    hops: "ALL"
  }
};

let activeTier = "ALL";


/* =========================================================
   DOM HELPER
   ========================================================= */

function $(id) {
  return document.getElementById(id);
}


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function toast(message) {
  const el = $("toast");

  if (!el) {
    console.log(message);
    return;
  }

  el.textContent = message;
  el.classList.add("show");

  window.setTimeout(() => {
    el.classList.remove("show");
  }, 3400);
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function formatCurrency(value) {
  const number = Number(value || 0);

  return `₹${number.toLocaleString("en-IN", {
    maximumFractionDigits: 0
  })}`;
}


function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
}


function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}


/* =========================================================
   DATA NORMALIZATION
   ========================================================= */

function getEntityId(row) {
  return String(
    row?.node ??
    row?.entity ??
    row?.entity_id ??
    row?.id ??
    ""
  ).trim();
}


function getScore(row) {
  return Number(
    row?.risk_score ??
    row?.score ??
    0
  );
}


function getRisk(row) {
  const explicit = String(
    row?.risk_tier ??
    row?.risk_level ??
    row?.risk ??
    row?.tier ??
    ""
  ).toUpperCase();

  if (
    explicit === "HIGH" ||
    explicit === "MEDIUM" ||
    explicit === "LOW"
  ) {
    return explicit;
  }

  const score = getScore(row);

  if (score >= 70) {
    return "HIGH";
  }

  if (score >= 40) {
    return "MEDIUM";
  }

  return "LOW";
}


function getSender(edge) {
  return String(
    edge?.sender ??
    edge?.source ??
    edge?.from ??
    ""
  ).trim();
}


function getReceiver(edge) {
  return String(
    edge?.receiver ??
    edge?.target ??
    edge?.to ??
    ""
  ).trim();
}


function getAmount(edge) {
  return Number(
    edge?.amount ??
    edge?.value ??
    edge?.transaction_amount ??
    0
  );
}


function getTimestamp(edge) {
  return String(
    edge?.timestamp ??
    edge?.datetime ??
    edge?.time ??
    edge?.created_at ??
    ""
  );
}


/* =========================================================
   RISK SIGNALS
   ========================================================= */

function hasSignal(value) {
  return (
    value === true ||
    value === "True" ||
    value === "true" ||
    value === 1 ||
    value === "1"
  );
}


function getSignals(row) {
  if (!row) {
    return [];
  }

  const signals = [
    ["shared_device", "Shared device"],
    ["multi_hop_routing", "Multi-hop routing"],
    ["high_velocity_fanout", "Rapid fan-out"],
    ["high_in_degree", "High in-degree"]
  ];

  return signals.filter(([key]) => hasSignal(row[key]));
}


function reasons(row) {
  const active = getSignals(row);

  if (!active.length) {
    return "No explainable signal";
  }

  return active
    .map(([, label]) => label)
    .join(" · ");
}


/* =========================================================
   TRANSACTION STATISTICS
   ========================================================= */

function transactionStats() {
  const edges = arrayOrEmpty(state.edges);

  let total = 0;

  edges.forEach(edge => {
    total += getAmount(edge);
  });

  return {
    total,
    count: edges.length
  };
}


/* =========================================================
   METRICS
   ========================================================= */

function renderMetrics() {
  const scores = arrayOrEmpty(state.scores);
  const links = arrayOrEmpty(state.links);

  const high = scores.filter(
    row => getRisk(row) === "HIGH"
  ).length;

  const medium = scores.filter(
    row => getRisk(row) === "MEDIUM"
  ).length;

  const stats = transactionStats();

  const entityCount = $("entity-count");
  const highCount = $("high-count");
  const mediumCount = $("medium-count");
  const linkCount = $("link-count");
  const transactionValue = $("transaction-value");
  const transferCount = $("transfer-count");

  if (entityCount) {
    entityCount.textContent = scores.length || "—";
  }

  if (highCount) {
    highCount.textContent = high || "—";
  }

  if (mediumCount) {
    mediumCount.textContent = medium || "—";
  }

  if (linkCount) {
    linkCount.textContent = links.length || "—";
  }

  if (transactionValue) {
    transactionValue.textContent =
      stats.count
        ? formatCurrency(stats.total)
        : "—";
  }

  if (transferCount) {
    transferCount.textContent =
      stats.count || "—";
  }
}


/* =========================================================
   STATUS
   ========================================================= */

function renderStatus() {
  const status = $("status");
  const statusDetail = $("status-detail");

  const ready = state.scores.length > 0;

  const high = state.scores.filter(
    row => getRisk(row) === "HIGH"
  ).length;

  if (status) {
    status.textContent = ready
      ? "Evidence correlated"
      : "Awaiting evidence";
  }

  if (statusDetail) {
    statusDetail.textContent = ready
      ? `${high} high-priority entities surfaced from ${state.edges.length} payment transfers.`
      : "Run a new investigation to create a synthetic evidence case.";
  }
}


/* =========================================================
   RISK DISTRIBUTION
   ========================================================= */

function renderRiskDistribution() {
  const high = state.scores.filter(
    row => getRisk(row) === "HIGH"
  ).length;

  const medium = state.scores.filter(
    row => getRisk(row) === "MEDIUM"
  ).length;

  const low = state.scores.filter(
    row => getRisk(row) === "LOW"
  ).length;

  const total = high + medium + low;

  const highLabel = $("risk-high-label");
  const mediumLabel = $("risk-medium-label");
  const lowLabel = $("risk-low-label");

  const highBar = $("risk-high-bar");
  const mediumBar = $("risk-medium-bar");
  const lowBar = $("risk-low-bar");

  const percentage = $("risk-percentage");

  if (highLabel) {
    highLabel.textContent = high;
  }

  if (mediumLabel) {
    mediumLabel.textContent = medium;
  }

  if (lowLabel) {
    lowLabel.textContent = low;
  }

  if (highBar) {
    highBar.style.width =
      total
        ? `${(high / total) * 100}%`
        : "0%";
  }

  if (mediumBar) {
    mediumBar.style.width =
      total
        ? `${(medium / total) * 100}%`
        : "0%";
  }

  if (lowBar) {
    lowBar.style.width =
      total
        ? `${(low / total) * 100}%`
        : "0%";
  }

  if (percentage) {
    percentage.textContent =
      total
        ? `${Math.round((high / total) * 100)}%`
        : "—";
  }
}


/* =========================================================
   SYSTEM HEALTH
   ========================================================= */

function renderHealth() {
  const checks = [
    {
      id: "health-data",
      ready:
        Object.keys(state.manifest || {}).length > 0 ||
        state.scores.length > 0
    },

    {
      id: "health-links",
      ready: state.links.length > 0
    },

    {
      id: "health-network",
      ready: state.edges.length > 0
    },

    {
      id: "health-report",
      ready: Boolean(state.report_available)
    }
  ];

  checks.forEach(check => {
    const el = $(check.id);

    if (!el) {
      return;
    }

    el.classList.toggle(
      "ready",
      check.ready
    );

    el.textContent =
      check.ready ? "●" : "○";
  });
}


/* =========================================================
   PRIORITY TABLE
   ========================================================= */

function renderTable() {
  const table = $("risk-table");

  if (!table) {
    console.warn("SETU: #risk-table not found.");
    return;
  }

  const search =
    ($("entity-search")?.value || "")
      .trim()
      .toLowerCase();

  let rows = state.scores.filter(row => {
    const entity =
      getEntityId(row).toLowerCase();

    const risk =
      getRisk(row);

    const matchesSearch =
      !search ||
      entity.includes(search);

    const matchesTier =
      activeTier === "ALL" ||
      risk === activeTier;

    return (
      matchesSearch &&
      matchesTier &&
      risk !== "LOW"
    );
  });

  rows.sort(
    (a, b) =>
      getScore(b) -
      getScore(a)
  );

  if (!rows.length) {
    table.innerHTML = `
      <tr>
        <td colspan="6" class="empty">
          No matching priority entities.
        </td>
      </tr>
    `;

    return;
  }

  table.innerHTML =
    rows.map(row => {
      const entity =
        getEntityId(row);

      const score =
        getScore(row);

      const risk =
        getRisk(row);

      return `
        <tr
          class="flagged-entity-row"
          data-entity-row="${escapeHtml(entity)}"
          title="Click to inspect ${escapeHtml(entity)}"
        >

          <td class="mono">

            <button
              type="button"
              class="entity-link"
              data-open-entity="${escapeHtml(entity)}"
            >
              ${escapeHtml(entity)}
            </button>

          </td>

          <td class="score">
            ${score}
            <small>/100</small>
          </td>

          <td>
            <span class="pill ${risk}">
              ${risk}
            </span>
          </td>

          <td class="signals">
            ${escapeHtml(reasons(row))}
          </td>

          <td>
            <button
              type="button"
              class="small-action"
              data-trace-entity="${escapeHtml(entity)}"
            >
              Trace
            </button>
          </td>

          <td>
            <span class="row-arrow">
              →
            </span>
          </td>

        </tr>
      `;
    }).join("");
}


/* =========================================================
   ENTITY INTELLIGENCE
   ========================================================= */

/*
   THIS IS THE ONLY openEntity() FUNCTION.

   Clicking:
   - Entity ID
   - Flagged row
   - "Open entity intelligence"
   - Connected entity

   can all reach this function.
*/

function openEntity(entity) {
  const id =
    String(entity || "").trim();

  if (!id) {
    console.warn(
      "SETU: openEntity called without an entity."
    );

    return;
  }

  console.log(
    "SETU: Opening entity intelligence:",
    id
  );

  const entityView =
    $("entity");

  if (!entityView) {
    console.error(
      "SETU: #entity view was not found."
    );

    toast(
      "Entity Intelligence view is missing."
    );

    return;
  }

  /*
     Activate Entity Intelligence tab.
  */

  document
    .querySelectorAll(".tab")
    .forEach(tab => {
      tab.classList.toggle(
        "active",
        tab.dataset.view === "entity"
      );
    });

  /*
     Activate Entity Intelligence view.
  */

  document
    .querySelectorAll(".view")
    .forEach(view => {
      view.classList.toggle(
        "active",
        view.id === "entity"
      );
    });

  /*
     Render entity.
  */

  renderEntity(id);

  /*
     Scroll to the entity view.
  */

  window.setTimeout(() => {
    entityView.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, 50);
}


/* =========================================================
   RENDER ENTITY
   ========================================================= */

function renderEntity(entity) {
  const id =
    String(entity || "").trim();

  if (!id) {
    return;
  }

  const scoreRow =
    state.scores.find(
      row =>
        getEntityId(row) === id
    );

  const incoming =
    state.edges.filter(
      edge =>
        getReceiver(edge) === id
    );

  const outgoing =
    state.edges.filter(
      edge =>
        getSender(edge) === id
    );

  const connected =
    new Set();

  incoming.forEach(edge => {
    const sender =
      getSender(edge);

    if (sender) {
      connected.add(sender);
    }
  });

  outgoing.forEach(edge => {
    const receiver =
      getReceiver(edge);

    if (receiver) {
      connected.add(receiver);
    }
  });

  connected.delete(id);

  const incomingTotal =
    incoming.reduce(
      (sum, edge) =>
        sum + getAmount(edge),
      0
    );

  const outgoingTotal =
    outgoing.reduce(
      (sum, edge) =>
        sum + getAmount(edge),
      0
    );

  const score =
    scoreRow
      ? getScore(scoreRow)
      : 0;

  const risk =
    scoreRow
      ? getRisk(scoreRow)
      : "LOW";

  const title =
    $("entity-title");

  const subtitle =
    $("entity-subtitle");

  const scoreEl =
    $("entity-score");

  const tierEl =
    $("entity-tier");

  const incomingEl =
    $("entity-incoming");

  const outgoingEl =
    $("entity-outgoing");

  const connectionsEl =
    $("entity-connections");

  const transferCountEl =
    $("entity-transfer-count");

  if (title) {
    title.textContent = id;
  }

  if (subtitle) {
    subtitle.textContent =
      scoreRow
        ? "Detailed risk and relationship analysis."
        : "No scored risk profile is available for this entity.";
  }

  if (scoreEl) {
    scoreEl.textContent =
      score;
  }

  if (tierEl) {
    tierEl.textContent =
      risk;

    tierEl.className =
      `pill ${risk}`;
  }

  if (incomingEl) {
    incomingEl.textContent =
      formatCurrency(
        incomingTotal
      );
  }

  if (outgoingEl) {
    outgoingEl.textContent =
      formatCurrency(
        outgoingTotal
      );
  }

  if (connectionsEl) {
    connectionsEl.textContent =
      connected.size;
  }

  if (transferCountEl) {
    transferCountEl.textContent =
      `${incoming.length + outgoing.length} EVENTS`;
  }

  renderEntitySignals(
    scoreRow
  );

  renderEntityConnections(
    Array.from(connected)
  );

  renderEntityTimeline(
    incoming,
    outgoing
  );
}


/* =========================================================
   ENTITY SIGNALS
   ========================================================= */

function renderEntitySignals(row) {
  const container =
    $("entity-signals");

  if (!container) {
    return;
  }

  if (!row) {
    container.innerHTML = `
      <p class="empty">
        No risk profile available.
      </p>
    `;

    return;
  }

  const active =
    getSignals(row);

  if (!active.length) {
    container.innerHTML = `
      <p class="empty">
        No major risk signals detected.
      </p>
    `;

    return;
  }

  container.innerHTML =
    active.map(
      ([, label]) => `
        <div class="signal-row">

          <span
            class="signal-dot"
          ></span>

          <span>
            ${escapeHtml(label)}
          </span>

        </div>
      `
    ).join("");
}


/* =========================================================
   ENTITY CONNECTIONS
   ========================================================= */

function renderEntityConnections(nodes) {
  const container =
    $("entity-connections-list");

  if (!container) {
    return;
  }

  if (!nodes.length) {
    container.innerHTML = `
      <p class="empty">
        No connected entities.
      </p>
    `;

    return;
  }

  container.innerHTML =
    nodes
      .slice(0, 50)
      .map(node => `
        <button
          type="button"
          class="connection-item"
          data-connection="${escapeHtml(node)}"
        >

          <span>
            ${escapeHtml(node)}
          </span>

          <span>
            →
          </span>

        </button>
      `)
      .join("");
}


/* =========================================================
   ENTITY TIMELINE
   ========================================================= */

function renderEntityTimeline(
  incoming,
  outgoing
) {
  const container =
    $("entity-timeline");

  if (!container) {
    return;
  }

  const events = [

    ...incoming.map(edge => ({
      direction: "IN",
      other: getSender(edge),
      amount: getAmount(edge),
      time: getTimestamp(edge)
    })),

    ...outgoing.map(edge => ({
      direction: "OUT",
      other: getReceiver(edge),
      amount: getAmount(edge),
      time: getTimestamp(edge)
    }))

  ];

  events.sort(
    (a, b) =>
      String(b.time).localeCompare(
        String(a.time)
      )
  );

  if (!events.length) {
    container.innerHTML = `
      <p class="empty">
        No transaction activity available.
      </p>
    `;

    return;
  }

  container.innerHTML =
    events
      .slice(0, 50)
      .map(event => `
        <div class="timeline-item">

          <div
            class="timeline-marker ${
              event.direction === "IN"
                ? "in"
                : "out"
            }"
          >
            ${
              event.direction === "IN"
                ? "↓"
                : "↑"
            }
          </div>

          <div class="timeline-content">

            <strong>

              ${
                event.direction === "IN"
                  ? "Received from"
                  : "Sent to"
              }

              ${escapeHtml(
                event.other
              )}

            </strong>

            <span>
              ${formatCurrency(
                event.amount
              )}
            </span>

            <small>
              ${escapeHtml(
                event.time ||
                "Timestamp unavailable"
              )}
            </small>

          </div>

        </div>
      `)
      .join("");
}


/* =========================================================
   NETWORK
   ========================================================= */

function getNetworkEntities() {
  const map =
    new Map();

  state.scores.forEach(row => {
    const id =
      getEntityId(row);

    if (!id) {
      return;
    }

    map.set(id, {
      id,
      score: getScore(row),
      risk: getRisk(row),
      row
    });
  });

  state.edges.forEach(edge => {
    const sender =
      getSender(edge);

    const receiver =
      getReceiver(edge);

    [sender, receiver].forEach(id => {

      if (!id) {
        return;
      }

      if (!map.has(id)) {
        map.set(id, {
          id,
          score: 0,
          risk: "LOW",
          row: null
        });
      }

    });
  });

  return Array.from(
    map.values()
  );
}


/* =========================================================
   NETWORK ADJACENCY
   ========================================================= */

function buildAdjacency() {
  const graph =
    new Map();

  state.edges.forEach(edge => {
    const sender =
      getSender(edge);

    const receiver =
      getReceiver(edge);

    if (!sender || !receiver) {
      return;
    }

    if (!graph.has(sender)) {
      graph.set(
        sender,
        new Set()
      );
    }

    if (!graph.has(receiver)) {
      graph.set(
        receiver,
        new Set()
      );
    }

    graph
      .get(sender)
      .add(receiver);

    graph
      .get(receiver)
      .add(sender);
  });

  return graph;
}


/* =========================================================
   NETWORK HOPS
   ========================================================= */

function getNodesWithinHops(
  start,
  maxHops
) {
  if (
    !start ||
    maxHops === "ALL"
  ) {
    return new Set(
      getNetworkEntities()
        .map(entity => entity.id)
    );
  }

  const graph =
    buildAdjacency();

  const visited =
    new Set([start]);

  const queue = [
    {
      node: start,
      depth: 0
    }
  ];

  while (queue.length) {

    const current =
      queue.shift();

    if (
      current.depth >=
      Number(maxHops)
    ) {
      continue;
    }

    const neighbors =
      graph.get(
        current.node
      ) || new Set();

    neighbors.forEach(
      neighbor => {

        if (visited.has(neighbor)) {
          return;
        }

        visited.add(neighbor);

        queue.push({
          node: neighbor,
          depth:
            current.depth + 1
        });

      }
    );
  }

  return visited;
}


/* =========================================================
   NETWORK FILTER
   ========================================================= */

function getFilteredNetworkEntities() {
  let entities =
    getNetworkEntities();

  const search =
    String(
      state.network.search || ""
    )
      .trim()
      .toLowerCase();

  const risk =
    state.network.risk;


  if (search) {
    entities =
      entities.filter(
        entity =>
          entity.id
            .toLowerCase()
            .includes(search)
      );
  }


  if (risk !== "ALL") {
    entities =
      entities.filter(
        entity =>
          entity.risk === risk
      );
  }


  if (
    state.network.selected &&
    state.network.hops !== "ALL"
  ) {
    const allowed =
      getNodesWithinHops(
        state.network.selected,
        state.network.hops
      );

    entities =
      entities.filter(
        entity =>
          allowed.has(
            entity.id
          )
      );
  }


  return entities;
}


/* =========================================================
   NETWORK LIST
   ========================================================= */

function renderNetworkList() {
  const container =
    $("network-list");

  if (!container) {
    return;
  }

  let entities =
    getFilteredNetworkEntities();

  const count =
    $("network-node-count");

  if (count) {
    count.textContent =
      entities.length;
  }

  if (!entities.length) {
    container.innerHTML = `
      <p class="empty">
        No entities match the current filters.
      </p>
    `;

    return;
  }

  entities.sort(
    (a, b) =>
      b.score - a.score
  );

  container.innerHTML =
    entities.map(entity => `
      <button
        type="button"
        class="network-list-item ${
          state.network.selected === entity.id
            ? "active"
            : ""
        }"
        data-network-node="${escapeHtml(entity.id)}"
      >

        <span
          class="risk-dot ${entity.risk.toLowerCase()}"
        ></span>

        <span class="entity-name">
          ${escapeHtml(entity.id)}
        </span>

        <span class="entity-score">
          ${entity.score}
        </span>

      </button>
    `).join("");
}


/* =========================================================
   NETWORK NODE DETAIL
   ========================================================= */

function renderNodeDetail(entityId) {
  const container =
    $("node-detail");

  if (!container) {
    return;
  }

  if (!entityId) {
    container.innerHTML = `
      <p class="eyebrow">
        SELECT A NODE
      </p>

      <h3>
        Trace a connection
      </h3>

      <p>
        Choose an entity to inspect its
        incoming and outgoing movement.
      </p>
    `;

    return;
  }

  const id =
    String(entityId);

  const scoreRow =
    state.scores.find(
      row =>
        getEntityId(row) === id
    );

  const score =
    scoreRow
      ? getScore(scoreRow)
      : 0;

  const risk =
    scoreRow
      ? getRisk(scoreRow)
      : "LOW";

  const incoming =
    state.edges.filter(
      edge =>
        getReceiver(edge) === id
    );

  const outgoing =
    state.edges.filter(
      edge =>
        getSender(edge) === id
    );

  const incomingTotal =
    incoming.reduce(
      (sum, edge) =>
        sum + getAmount(edge),
      0
    );

  const outgoingTotal =
    outgoing.reduce(
      (sum, edge) =>
        sum + getAmount(edge),
      0
    );

  const connected =
    new Set();

  incoming.forEach(edge => {
    const sender =
      getSender(edge);

    if (sender) {
      connected.add(sender);
    }
  });

  outgoing.forEach(edge => {
    const receiver =
      getReceiver(edge);

    if (receiver) {
      connected.add(receiver);
    }
  });

  connected.delete(id);

  const signalRows =
    scoreRow
      ? getSignals(scoreRow)
      : [];

  const signalHtml =
    signalRows.length
      ? signalRows
          .map(
            ([, label]) => `
              <div class="signal-row">

                <span
                  class="signal-dot"
                ></span>

                <span>
                  ${escapeHtml(label)}
                </span>

              </div>
            `
          )
          .join("")
      : `
          <p class="empty">
            No major risk signals detected.
          </p>
        `;

  const connectionHtml =
    Array.from(connected)
      .slice(0, 20)
      .map(node => `
        <button
          type="button"
          class="connection-item"
          data-node-connection="${escapeHtml(node)}"
        >

          <span>
            ${escapeHtml(node)}
          </span>

          <span>
            →
          </span>

        </button>
      `)
      .join("");

  container.innerHTML = `
    <div class="node-detail-content">

      <span class="eyebrow">
        ENTITY TRACE
      </span>

      <div class="node-detail-heading">

        <div
          class="node-detail-icon ${risk.toLowerCase()}"
        >
          ◎
        </div>

        <div>

          <h3 class="mono">
            ${escapeHtml(id)}
          </h3>

          <span class="pill ${risk}">
            ${risk}
          </span>

        </div>

      </div>

      <div class="node-detail-score">

        <span>
          Risk score
        </span>

        <strong>
          ${score}/100
        </strong>

      </div>

      <div class="node-detail-stats">

        <div>
          <span>Incoming</span>
          <strong>
            ${formatCurrency(incomingTotal)}
          </strong>
        </div>

        <div>
          <span>Outgoing</span>
          <strong>
            ${formatCurrency(outgoingTotal)}
          </strong>
        </div>

        <div>
          <span>Transfers</span>
          <strong>
            ${incoming.length + outgoing.length}
          </strong>
        </div>

        <div>
          <span>Connections</span>
          <strong>
            ${connected.size}
          </strong>
        </div>

      </div>

      <div class="node-detail-section">

        <span class="eyebrow">
          RISK SIGNALS
        </span>

        <div class="node-signals">
          ${signalHtml}
        </div>

      </div>

      <div class="node-detail-section">

        <span class="eyebrow">
          CONNECTIONS
        </span>

        <div class="node-connections">

          ${
            connectionHtml ||
            `
              <p class="empty">
                No connected entities.
              </p>
            `
          }

        </div>

      </div>

      <button
        type="button"
        class="primary node-trace-button"
        data-open-entity="${escapeHtml(id)}"
      >
        Open entity intelligence
      </button>

    </div>
  `;
}


/* =========================================================
   NETWORK GRAPH
   ========================================================= */

function renderGraph() {
  const graph =
    $("graph");

  if (!graph) {
    return;
  }

  const entities =
    getFilteredNetworkEntities();

  if (!entities.length) {
    graph.innerHTML = `
      <div class="graph-empty">

        <span class="graph-empty-icon">
          ⌁
        </span>

        <strong>
          Network awaiting evidence
        </strong>

        <p>
          Run the investigation pipeline to
          generate the money-flow network.
        </p>

      </div>
    `;

    return;
  }

  const width =
    Math.max(
      graph.clientWidth || 700,
      500
    );

  const height =
    Math.max(
      graph.clientHeight || 620,
      500
    );

  const centerX =
    width / 2;

  const centerY =
    height / 2;

  const selected =
    state.network.selected;

  const entityIds =
    new Set(
      entities.map(
        entity => entity.id
      )
    );

  const positions =
    new Map();

  let ordered =
    [...entities];

  if (
    selected &&
    entityIds.has(selected)
  ) {
    ordered = [
      ...entities.filter(
        entity =>
          entity.id === selected
      ),
      ...entities.filter(
        entity =>
          entity.id !== selected
      )
    ];
  }

  const radius =
    Math.max(
      100,
      Math.min(width, height) * 0.34
    );

  ordered.forEach(
    (entity, index) => {

      if (
        selected &&
        entity.id === selected
      ) {

        positions.set(
          entity.id,
          {
            x: centerX,
            y: centerY
          }
        );

        return;
      }

      const hasSelected =
        Boolean(
          selected &&
          entityIds.has(selected)
        );

      const indexOffset =
        hasSelected
          ? index - 1
          : index;

      const count =
        hasSelected
          ? Math.max(
              ordered.length - 1,
              1
            )
          : Math.max(
              ordered.length,
              1
            );

      const angle =
        (Math.PI * 2 * indexOffset) /
          count -
        Math.PI / 2;

      positions.set(
        entity.id,
        {
          x:
            centerX +
            Math.cos(angle) *
            radius,

          y:
            centerY +
            Math.sin(angle) *
            radius
        }
      );
    }
  );


  /*
     Only draw edges whose nodes
     are visible.
  */

  const edges =
    state.edges.filter(edge => {

      const sender =
        getSender(edge);

      const receiver =
        getReceiver(edge);

      return (
        entityIds.has(sender) &&
        entityIds.has(receiver)
      );
    });


  let svg = `
    <svg
      class="network-svg"
      width="100%"
      height="100%"
      viewBox="0 0 ${width} ${height}"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
    >

      <defs>

        <marker
          id="setu-network-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >

          <path
            d="M 0 0 L 10 5 L 0 10 z"
            fill="currentColor"
          />

        </marker>

      </defs>
  `;


  /*
     EDGES
  */

  edges.forEach(edge => {

    const sender =
      getSender(edge);

    const receiver =
      getReceiver(edge);

    const from =
      positions.get(sender);

    const to =
      positions.get(receiver);

    if (!from || !to) {
      return;
    }

    const highlighted =
      selected === sender ||
      selected === receiver;

    svg += `
      <g
        class="network-edge ${
          highlighted
            ? "selected"
            : ""
        }"
      >

        <line
          x1="${from.x}"
          y1="${from.y}"
          x2="${to.x}"
          y2="${to.y}"
          marker-end="url(#setu-network-arrow)"
        />

        <text
          x="${(from.x + to.x) / 2}"
          y="${(from.y + to.y) / 2 - 8}"
          text-anchor="middle"
        >
          ${formatCurrency(
            getAmount(edge)
          )}
        </text>

      </g>
    `;
  });


  /*
     NODES
  */

  entities.forEach(entity => {

    const position =
      positions.get(entity.id);

    if (!position) {
      return;
    }

    const selectedNode =
      selected === entity.id;

    const connectedNode =
      Boolean(
        selected &&
        state.edges.some(edge => {

          const sender =
            getSender(edge);

          const receiver =
            getReceiver(edge);

          return (
            (
              sender === selected &&
              receiver === entity.id
            ) ||
            (
              receiver === selected &&
              sender === entity.id
            )
          );
        })
      );

    const classes = [
      "network-node",
      entity.risk.toLowerCase(),
      selectedNode
        ? "selected"
        : "",
      connectedNode
        ? "connected"
        : ""
    ]
      .filter(Boolean)
      .join(" ");

    svg += `
      <g
        class="${classes}"
        data-network-graph-node="${escapeHtml(entity.id)}"
        transform="translate(${position.x}, ${position.y})"
      >

        <circle
          class="network-node-glow"
          r="${selectedNode ? 30 : 24}"
        />

        <circle
          class="network-node-circle"
          r="${selectedNode ? 22 : 17}"
        />

        <text
          class="network-node-label"
          x="0"
          y="${selectedNode ? 39 : 33}"
          text-anchor="middle"
        >
          ${escapeHtml(entity.id)}
        </text>

        <text
          class="network-node-score"
          x="0"
          y="${selectedNode ? 54 : 48}"
          text-anchor="middle"
        >
          ${entity.score}
        </text>

      </g>
    `;
  });


  svg += `
    </svg>
  `;

  graph.innerHTML =
    svg;
}


/* =========================================================
   NETWORK NODE SELECTION
   ========================================================= */

function selectNetworkNode(entityId) {
  const id =
    String(entityId || "").trim();

  if (!id) {
    return;
  }

  state.network.selected =
    id;

  renderNetworkList();
  renderGraph();
  renderNodeDetail(id);
}


/* =========================================================
   OPEN NETWORK ENTITY
   ========================================================= */

function openNetworkEntity(entityId) {
  const id =
    String(entityId || "").trim();

  if (!id) {
    return;
  }

  activateView("network");

  state.network.selected =
    id;

  renderNetworkList();
  renderGraph();
  renderNodeDetail(id);
}


/* =========================================================
   NETWORK CONTROLS
   ========================================================= */

function setupNetworkControls() {

  const search =
    $("network-search");

  if (search) {

    search.addEventListener(
      "input",
      event => {

        state.network.search =
          event.target.value;

        renderNetworkList();
        renderGraph();

      }
    );

  }


  const risk =
    $("network-risk-filter");

  if (risk) {

    risk.addEventListener(
      "change",
      event => {

        state.network.risk =
          event.target.value;

        renderNetworkList();
        renderGraph();

      }
    );

  }


  const hops =
    $("network-hop-filter");

  if (hops) {

    hops.addEventListener(
      "change",
      event => {

        state.network.hops =
          event.target.value;

        renderNetworkList();
        renderGraph();

      }
    );

  }


  const reset =
    $("network-reset");

  if (reset) {

    reset.addEventListener(
      "click",
      () => {

        state.network = {
          selected: null,
          search: "",
          risk: "ALL",
          hops: "ALL"
        };

        if (search) {
          search.value = "";
        }

        if (risk) {
          risk.value = "ALL";
        }

        if (hops) {
          hops.value = "ALL";
        }

        renderNetworkList();
        renderGraph();
        renderNodeDetail(null);

        toast(
          "Network view reset."
        );

      }
    );

  }
}


/* =========================================================
   RENDER NETWORK
   ========================================================= */

function renderNetwork() {
  renderNetworkList();
  renderGraph();

  renderNodeDetail(
    state.network.selected
  );
}


/* =========================================================
   EVIDENCE INTEGRITY
   ========================================================= */

function renderIntegrity() {

  const manifest =
    $("manifest");

  const links =
    $("links");


  if (manifest) {

    const entries =
      Object.entries(
        state.manifest || {}
      );


    if (!entries.length) {

      manifest.innerHTML = `
        <p class="empty">
          No evidence manifest yet.
        </p>
      `;

    } else {

      manifest.innerHTML =
        entries
          .map(
            ([name, value]) => {

              const hash =
                typeof value === "object"
                  ? value?.sha256
                  : value;

              const size =
                typeof value === "object"
                  ? value?.size_bytes
                  : 0;

              return `
                <article
                  class="hash-card"
                >

                  <span class="eyebrow">
                    SOURCE ARTIFACT
                  </span>

                  <strong>
                    ${escapeHtml(name)}
                  </strong>

                  <code>
                    ${escapeHtml(
                      hash ||
                      "Hash unavailable"
                    )}
                  </code>

                  <small>
                    ${formatNumber(size)}
                    bytes · SHA-256 verified at intake
                  </small>

                </article>
              `;
            }
          )
          .join("");

    }

  }


  if (links) {

    if (!state.links.length) {

      links.innerHTML = `
        <p class="empty">
          No cross-artifact links found.
        </p>
      `;

    } else {

      links.innerHTML =
        state.links
          .map(
            link => `
              <div class="link-row">

                ${escapeHtml(
                  link.entity_a ||
                  ""
                )}

                ↔

                ${escapeHtml(
                  link.entity_b ||
                  ""
                )}

                <br>

                <span class="signals">
                  ${escapeHtml(
                    link.evidence ||
                    ""
                  )}
                </span>

              </div>
            `
          )
          .join("");

    }

  }
}


/* =========================================================
   APPLY CASE DATA
   ========================================================= */

function applyCaseData(data) {

  if (!data) {
    return;
  }

  state.scores =
    arrayOrEmpty(
      data.scores
    );

  state.links =
    arrayOrEmpty(
      data.links
    );

  state.edges =
    arrayOrEmpty(
      data.edges
    );

  state.manifest =
    data.manifest || {};

  state.case =
    data.case || {};

  state.notes =
    arrayOrEmpty(
      data.notes
    );

  state.reviews =
    data.reviews || {};

  state.audit =
    arrayOrEmpty(
      data.audit
    );

  state.report_available =
    Boolean(
      data.report_available
    );
}


/* =========================================================
   RENDER EVERYTHING
   ========================================================= */

function render() {

  renderMetrics();

  renderStatus();

  renderRiskDistribution();

  renderHealth();

  renderTable();

  renderNetwork();

  renderIntegrity();


  const brief =
    $("brief-link");

  if (brief) {

    brief.classList.toggle(
      "disabled",
      !state.report_available
    );

  }
}


/* =========================================================
   LOAD CASE
   ========================================================= */

async function load() {

  try {

    const response =
      await fetch(
        "/api/case",
        {
          cache: "no-store"
        }
      );


    if (!response.ok) {

      throw new Error(
        `API returned ${response.status}`
      );

    }


    const data =
      await response.json();


    applyCaseData(
      data
    );


    render();


    console.log(
      "SETU: Investigation data loaded.",
      {
        entities:
          state.scores.length,

        links:
          state.links.length,

        transfers:
          state.edges.length
      }
    );


  } catch (error) {

    console.error(
      "SETU case loading error:",
      error
    );

    toast(
      "Could not load investigation data."
    );

  }

}


/* =========================================================
   VIEW NAVIGATION
   ========================================================= */

function activateView(viewName) {

  const target =
    String(viewName || "").trim();

  if (!target) {
    return;
  }


  const targetView =
    $(target);

  if (!targetView) {

    console.error(
      `SETU: View #${target} does not exist.`
    );

    return;

  }


  document
    .querySelectorAll(".tab")
    .forEach(tab => {

      tab.classList.toggle(
        "active",
        tab.dataset.view === target
      );

    });


  document
    .querySelectorAll(".view")
    .forEach(view => {

      view.classList.toggle(
        "active",
        view.id === target
      );

    });


  if (target === "network") {

    window.setTimeout(
      () => {
        renderNetwork();
      },
      50
    );

  }


  if (target === "integrity") {

    renderIntegrity();

  }

}


/* =========================================================
   TAB NAVIGATION
   ========================================================= */

function setupTabs() {

  document
    .querySelectorAll(".tab")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const target =
            button.dataset.view;

          if (!target) {
            return;
          }

          activateView(
            target
          );

        }
      );

    });

}


/* =========================================================
   RISK FILTERS
   ========================================================= */

function setupRiskFilters() {

  document
    .querySelectorAll(".filter")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          activeTier =
            String(
              button.dataset.tier ||
              "ALL"
            ).toUpperCase();


          document
            .querySelectorAll(".filter")
            .forEach(item => {

              item.classList.toggle(
                "active",
                item === button
              );

            });


          renderTable();

        }
      );

    });

}


/* =========================================================
   ENTITY SEARCH
   ========================================================= */

function setupEntitySearch() {

  const search =
    $("entity-search");

  if (!search) {
    return;
  }

  search.addEventListener(
    "input",
    () => {
      renderTable();
    }
  );

}


/* =========================================================
   GLOBAL CLICK HANDLER
   ========================================================= */

/*
   IMPORTANT:

   The risk table is generated dynamically with
   innerHTML.

   Therefore we DO NOT attach click listeners
   directly to the generated rows.

   We listen once on document and determine
   what was clicked.

   This prevents the flagged entity button
   from becoming unresponsive after filtering
   or re-rendering.
*/

function setupGlobalClicks() {

  document.addEventListener(
    "click",
    event => {


      /* -----------------------------------------------------
         ENTITY BUTTON
         ----------------------------------------------------- */

      const entityButton =
        event.target.closest(
          "[data-open-entity]"
        );


      if (entityButton) {

        event.preventDefault();
        event.stopPropagation();


        const entity =
          entityButton.getAttribute(
            "data-open-entity"
          );


        console.log(
          "SETU: Entity clicked:",
          entity
        );


        openEntity(
          entity
        );


        return;

      }


      /* -----------------------------------------------------
         ENTITY ROW
         ----------------------------------------------------- */

      const entityRow =
        event.target.closest(
          "[data-entity-row]"
        );


      if (
        entityRow &&
        !event.target.closest("button")
      ) {

        event.preventDefault();


        const entity =
          entityRow.getAttribute(
            "data-entity-row"
          );


        console.log(
          "SETU: Entity row clicked:",
          entity
        );


        openEntity(
          entity
        );


        return;

      }


      /* -----------------------------------------------------
         TRACE BUTTON
         ----------------------------------------------------- */

      const traceButton =
        event.target.closest(
          "[data-trace-entity]"
        );


      if (traceButton) {

        event.preventDefault();
        event.stopPropagation();


        const entity =
          traceButton.getAttribute(
            "data-trace-entity"
          );


        openNetworkEntity(
          entity
        );


        return;

      }


      /* -----------------------------------------------------
         ENTITY CONNECTION
         ----------------------------------------------------- */

      const connectionButton =
        event.target.closest(
          "[data-connection]"
        );


      if (connectionButton) {

        event.preventDefault();


        const entity =
          connectionButton.getAttribute(
            "data-connection"
          );


        renderEntity(
          entity
        );


        return;

      }


      /* -----------------------------------------------------
         NETWORK LIST NODE
         ----------------------------------------------------- */

      const networkNode =
        event.target.closest(
          "[data-network-node]"
        );


      if (networkNode) {

        event.preventDefault();


        const entity =
          networkNode.getAttribute(
            "data-network-node"
          );


        selectNetworkNode(
          entity
        );


        return;

      }


      /* -----------------------------------------------------
         NETWORK GRAPH NODE
         ----------------------------------------------------- */

      const graphNode =
        event.target.closest(
          "[data-network-graph-node]"
        );


      if (graphNode) {

        event.preventDefault();


        const entity =
          graphNode.getAttribute(
            "data-network-graph-node"
          );


        selectNetworkNode(
          entity
        );


        return;

      }


      /* -----------------------------------------------------
         NETWORK DETAIL CONNECTION
         ----------------------------------------------------- */

      const nodeConnection =
        event.target.closest(
          "[data-node-connection]"
        );


      if (nodeConnection) {

        event.preventDefault();


        const entity =
          nodeConnection.getAttribute(
            "data-node-connection"
          );


        selectNetworkNode(
          entity
        );


        return;

      }

    }
  );

}


/* =========================================================
   PIPELINE
   ========================================================= */

function setupPipeline() {

  const button =
    $("run-pipeline");

  if (!button) {
    return;
  }


  button.addEventListener(
    "click",
    async () => {

      if (button.disabled) {
        return;
      }


      button.disabled =
        true;


      const originalHtml =
        button.innerHTML;


      button.innerHTML =
        "Correlating evidence…";


      try {

        const response =
          await fetch(
            "/api/pipeline",
            {
              method: "POST"
            }
          );


        if (!response.ok) {

          let message =
            "Pipeline failed.";


          try {

            const errorData =
              await response.json();


            const detail =
              errorData?.detail;


            if (
              typeof detail ===
              "string"
            ) {

              message =
                detail;

            } else if (
              detail?.error
            ) {

              message =
                detail.step
                  ? `${detail.step}: ${detail.error}`
                  : detail.error;

            } else if (
              detail?.step
            ) {

              message =
                `Pipeline failed at ${detail.step}`;

            }

          } catch (_) {

            /*
               Response was not JSON.
            */

          }


          throw new Error(
            message
          );

        }


        await load();


        toast(
          "Investigation ready — evidence correlated successfully."
        );


      } catch (error) {

        console.error(
          "SETU pipeline error:",
          error
        );


        toast(
          `Could not run pipeline: ${error.message}`
        );


      } finally {

        button.disabled =
          false;

        button.innerHTML =
          originalHtml ||
          "Run investigation →";

      }

    }
  );

}


/* =========================================================
   KEYBOARD SHORTCUTS
   ========================================================= */

function setupKeyboardShortcuts() {

  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Escape"
      ) {

        activateView(
          "overview"
        );

      }

    }
  );

}


/* =========================================================
   INITIALIZATION
   ========================================================= */

function initSETU() {

  console.log(
    "SETU: Initializing investigation workspace..."
  );


  setupTabs();

  setupRiskFilters();

  setupEntitySearch();

  setupNetworkControls();

  setupGlobalClicks();

  setupPipeline();

  setupKeyboardShortcuts();


  load();

}


/* =========================================================
   START
   ========================================================= */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initSETU
  );

} else {

  initSETU();

}