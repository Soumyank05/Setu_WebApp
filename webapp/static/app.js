/* =========================================================
   SETU INVESTIGATION WORKSPACE
   Main dashboard controller
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

const $ = (id) => document.getElementById(id);


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function toast(message) {
  const el = $("toast");

  if (!el) return;

  el.textContent = message;
  el.classList.add("show");

  setTimeout(() => {
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
  );
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

  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";

  return "LOW";
}


function getSender(edge) {
  return String(
    edge?.sender ??
    edge?.source ??
    edge?.from ??
    ""
  );
}


function getReceiver(edge) {
  return String(
    edge?.receiver ??
    edge?.target ??
    edge?.to ??
    ""
  );
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
  return (
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


function reasons(row) {
  const signals = [
    ["shared_device", "Shared device"],
    ["multi_hop_routing", "Multi-hop routing"],
    ["high_velocity_fanout", "Rapid fan-out"],
    ["high_in_degree", "High in-degree"]
  ];

  const active = signals
    .filter(([key]) => hasSignal(row?.[key]))
    .map(([, label]) => label);

  return active.length
    ? active.join(" · ")
    : "No explainable signal";
}


/* =========================================================
   TRANSACTION STATISTICS
   ========================================================= */

function transactionStats() {
  const edges = state.edges || [];

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
   TOP METRICS
   ========================================================= */

function renderMetrics() {
  const scores = state.scores || [];
  const links = state.links || [];

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
    entityCount.textContent =
      scores.length || "—";
  }

  if (highCount) {
    highCount.textContent =
      high || "—";
  }

  if (mediumCount) {
    mediumCount.textContent =
      medium || "—";
  }

  if (linkCount) {
    linkCount.textContent =
      links.length || "—";
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
   STATUS CARD
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

  const total =
    high + medium + low;

  const highLabel =
    $("risk-high-label");

  const mediumLabel =
    $("risk-medium-label");

  const lowLabel =
    $("risk-low-label");

  const highBar =
    $("risk-high-bar");

  const mediumBar =
    $("risk-medium-bar");

  const lowBar =
    $("risk-low-bar");

  const percentage =
    $("risk-percentage");

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

    if (!el) return;

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
  const table =
    $("risk-table");

  if (!table) return;

  const search =
    ($("entity-search")?.value || "")
      .trim()
      .toLowerCase();

  let rows =
    state.scores.filter(row => {

      const entity =
        getEntityId(row)
          .toLowerCase();

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
      getScore(b) - getScore(a)
  );

  if (!rows.length) {
    table.innerHTML = `
      <tr>
        <td
          colspan="6"
          class="empty"
        >
          No matching priority entities.
        </td>
      </tr>
    `;

    return;
  }

  table.innerHTML =
    rows.map(row => {

      const entity =
        escapeHtml(
          getEntityId(row)
        );

      const score =
        getScore(row);

      const risk =
        getRisk(row);

      return `
        <tr>

          <td class="mono">
            <button
              type="button"
              class="entity-link"
              data-open-entity="${entity}"
            >
              ${entity}
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
              data-trace-entity="${entity}"
            >
              Trace
            </button>
          </td>

          <td></td>

        </tr>
      `;
    }).join("");

  table
    .querySelectorAll("[data-open-entity]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {
          openEntity(
            button.dataset.openEntity
          );
        }
      );

    });

  table
    .querySelectorAll("[data-trace-entity]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {
          openNetworkEntity(
            button.dataset.traceEntity
          );
        }
      );

    });
}


/* =========================================================
   ENTITY INTELLIGENCE
   ========================================================= */

function openEntity(entity) {
  const id = String(entity);

  const tab =
    document.querySelector(
      '[data-view="entity"]'
    );

  if (tab) {
    tab.click();
  }

  renderEntity(id);
}


function renderEntity(entity) {
  const id = String(entity);

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
      "Detailed risk and relationship analysis.";
  }

  if (scoreEl) {
    scoreEl.textContent =
      score || "0";
  }

  if (tierEl) {
    tierEl.textContent = risk;
    tierEl.className =
      `pill ${risk}`;
  }

  if (incomingEl) {
    incomingEl.textContent =
      formatCurrency(incomingTotal);
  }

  if (outgoingEl) {
    outgoingEl.textContent =
      formatCurrency(outgoingTotal);
  }

  if (connectionsEl) {
    connectionsEl.textContent =
      connected.size;
  }

  if (transferCountEl) {
    transferCountEl.textContent =
      `${incoming.length + outgoing.length} EVENTS`;
  }

  renderEntitySignals(scoreRow);
  renderEntityConnections(
    Array.from(connected)
  );
  renderEntityTimeline(
    id,
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

  if (!container) return;

  if (!row) {
    container.innerHTML = `
      <p class="empty">
        No risk profile available.
      </p>
    `;

    return;
  }

  const signals = [
    ["shared_device", "Shared device"],
    ["multi_hop_routing", "Multi-hop routing"],
    ["high_velocity_fanout", "Rapid fan-out"],
    ["high_in_degree", "High in-degree"]
  ];

  const active =
    signals.filter(
      ([key]) =>
        hasSignal(row[key])
    );

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
          <span class="signal-dot"></span>
          <span>${escapeHtml(label)}</span>
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

  if (!container) return;

  if (!nodes.length) {
    container.innerHTML = `
      <p class="empty">
        No connected entities.
      </p>
    `;

    return;
  }

  container.innerHTML =
    nodes.map(node => `
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
    `).join("");

  container
    .querySelectorAll("[data-connection]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          renderEntity(
            button.dataset.connection
          );

        }
      );

    });
}


/* =========================================================
   ENTITY TIMELINE
   ========================================================= */

function renderEntityTimeline(
  entity,
  incoming,
  outgoing
) {
  const container =
    $("entity-timeline");

  if (!container) return;

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
      String(b.time)
        .localeCompare(
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
    events.slice(0, 50).map(
      event => `
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
              ${escapeHtml(event.other)}
            </strong>

            <span>
              ${formatCurrency(event.amount)}
            </span>

            <small>
              ${
                escapeHtml(
                  event.time ||
                  "Timestamp unavailable"
                )
              }
            </small>

          </div>

        </div>
      `
    ).join("");
}


/* =========================================================
   NETWORK — ENTITY COLLECTION
   ========================================================= */

function getNetworkEntities() {
  const map =
    new Map();

  state.scores.forEach(row => {

    const id =
      getEntityId(row);

    if (!id) return;

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

    [sender, receiver]
      .forEach(id => {

        if (!id) return;

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

  return Array.from(map.values());
}


/* =========================================================
   NETWORK — ADJACENCY
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
   NETWORK — HOPS
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
      graph.get(current.node) ||
      new Set();

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
   NETWORK — FILTERING
   ========================================================= */

function getFilteredNetworkEntities() {
  let entities =
    getNetworkEntities();

  const search =
    state.network.search
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
          allowed.has(entity.id)
      );
  }

  return entities;
}


/* =========================================================
   NETWORK — SIDEBAR
   ========================================================= */

function renderNetworkList() {
  const container =
    $("network-list");

  if (!container) return;

  const entities =
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

  container
    .querySelectorAll(
      "[data-network-node]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          selectNetworkNode(
            button.dataset.networkNode
          );

        }
      );

    });
}


/* =========================================================
   NETWORK — NODE DETAIL
   ========================================================= */

function renderNodeDetail(entityId) {
  const container =
    $("node-detail");

  if (!container) return;

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

  const scoreRow =
    state.scores.find(
      row =>
        getEntityId(row) ===
        entityId
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
        getReceiver(edge) ===
        entityId
    );

  const outgoing =
    state.edges.filter(
      edge =>
        getSender(edge) ===
        entityId
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
    connected.add(
      getSender(edge)
    );
  });

  outgoing.forEach(edge => {
    connected.add(
      getReceiver(edge)
    );
  });

  connected.delete(entityId);

  const signalHtml =
    scoreRow
      ? reasons(scoreRow)
          .split(" · ")
          .map(reason => `
            <div class="signal-row">
              <span class="signal-dot"></span>
              <span>
                ${escapeHtml(reason)}
              </span>
            </div>
          `)
          .join("")
      : `
        <p class="empty">
          No risk signals available.
        </p>
      `;

  const connectionHtml =
    Array.from(connected)
      .slice(0, 15)
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
            ${escapeHtml(entityId)}
          </h3>

          <span
            class="pill ${risk}"
          >
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
        data-open-entity="${escapeHtml(entityId)}"
      >
        Open entity intelligence
      </button>

    </div>
  `;

  container
    .querySelectorAll(
      "[data-node-connection]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          selectNetworkNode(
            button.dataset.nodeConnection
          );

        }
      );

    });

  const openEntityButton =
    container.querySelector(
      "[data-open-entity]"
    );

  if (openEntityButton) {

    openEntityButton.addEventListener(
      "click",
      () => {
        openEntity(entityId);
      }
    );

  }
}


/* =========================================================
   NETWORK — GRAPH
   ========================================================= */

function renderGraph() {
  const graph =
    $("graph");

  if (!graph) return;

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

  const entityIds =
    new Set(
      entities.map(
        entity => entity.id
      )
    );

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

  const width =
    graph.clientWidth || 700;

  const height =
    graph.clientHeight || 620;

  const centerX =
    width / 2;

  const centerY =
    height / 2;

  const positions = {};

  let ordered =
    [...entities];

  const selected =
    state.network.selected;

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

        positions[entity.id] = {
          x: centerX,
          y: centerY
        };

        return;
      }

      const offset =
        selected &&
        entityIds.has(selected)
          ? index - 1
          : index;

      const count =
        selected &&
        entityIds.has(selected)
          ? Math.max(
              ordered.length - 1,
              1
            )
          : Math.max(
              ordered.length,
              1
            );

      const angle =
        (Math.PI * 2 * offset) /
          count -
        Math.PI / 2;

      positions[entity.id] = {
        x:
          centerX +
          Math.cos(angle) *
            radius,

        y:
          centerY +
          Math.sin(angle) *
            radius
      };

    }
  );


  /* -------------------------------------------------------
     SVG
     ------------------------------------------------------- */

  let svg = `
    <svg
      class="network-svg"
      width="100%"
      height="100%"
      viewBox="0 0 ${width} ${height}"
      preserveAspectRatio="xMidYMid meet"
    >

      <defs>

        <marker
          id="network-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path
            d="M 0 0 L 10 5 L 0 10 z"
            fill="currentColor"
          />
        </marker>

      </defs>
  `;


  /* -------------------------------------------------------
     EDGES
     ------------------------------------------------------- */

  edges.forEach(edge => {

    const sender =
      getSender(edge);

    const receiver =
      getReceiver(edge);

    const from =
      positions[sender];

    const to =
      positions[receiver];

    if (!from || !to) return;

    const selectedEdge =
      selected === sender ||
      selected === receiver;

    const amount =
      getAmount(edge);

    svg += `
      <g
        class="network-edge ${
          selectedEdge
            ? "selected"
            : ""
        }"
      >

        <line
          x1="${from.x}"
          y1="${from.y}"
          x2="${to.x}"
          y2="${to.y}"
          marker-end="url(#network-arrow)"
        />

        <text
          x="${(from.x + to.x) / 2}"
          y="${(from.y + to.y) / 2 - 8}"
          text-anchor="middle"
        >
          ${formatCurrency(amount)}
        </text>

      </g>
    `;

  });


  /* -------------------------------------------------------
     NODES
     ------------------------------------------------------- */

  entities.forEach(entity => {

    const position =
      positions[entity.id];

    if (!position) return;

    const isSelected =
      selected === entity.id;

    const isConnected =
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

      });

    const classes = [
      "network-node",
      entity.risk.toLowerCase(),
      isSelected
        ? "selected"
        : "",
      isConnected
        ? "connected"
        : ""
    ].join(" ");

    svg += `
      <g
        class="${classes}"
        data-network-graph-node="${escapeHtml(entity.id)}"
        transform="
          translate(
            ${position.x},
            ${position.y}
          )
        "
      >

        <circle
          class="network-node-glow"
          r="${isSelected ? 30 : 24}"
        />

        <circle
          class="network-node-circle"
          r="${isSelected ? 22 : 17}"
        />

        <text
          class="network-node-label"
          x="0"
          y="${isSelected ? 39 : 33}"
          text-anchor="middle"
        >
          ${escapeHtml(entity.id)}
        </text>

        <text
          class="network-node-score"
          x="0"
          y="${isSelected ? 54 : 48}"
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

  graph
    .querySelectorAll(
      "[data-network-graph-node]"
    )
    .forEach(node => {

      node.addEventListener(
        "click",
        () => {

          selectNetworkNode(
            node.dataset.networkGraphNode
          );

        }
      );

    });
}


/* =========================================================
   NETWORK — NODE SELECTION
   ========================================================= */

function selectNetworkNode(entityId) {

  state.network.selected =
    String(entityId);

  renderNetworkList();
  renderGraph();
  renderNodeDetail(
    state.network.selected
  );
}


function openNetworkEntity(entityId) {

  const tab =
    document.querySelector(
      '[data-view="network"]'
    );

  if (tab) {
    tab.click();
  }

  state.network.selected =
    String(entityId);

  renderNetworkList();
  renderGraph();
  renderNodeDetail(
    state.network.selected
  );
}


/* =========================================================
   NETWORK — CONTROLS
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
          "Network view reset"
        );

      }
    );

  }
}


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
        entries.map(
          ([name, value]) => {

            const hash =
              typeof value === "object"
                ? value.sha256
                : value;

            const size =
              typeof value === "object"
                ? value.size_bytes
                : 0;

            return `
              <article class="hash-card">

                <span class="eyebrow">
                  SOURCE ARTIFACT
                </span>

                <strong>
                  ${escapeHtml(name)}
                </strong>

                <code>
                  ${escapeHtml(
                    hash || "Hash unavailable"
                  )}
                </code>

                <small>
                  ${formatNumber(size)}
                  bytes · SHA-256 verified at intake
                </small>

              </article>
            `;

          }
        ).join("");

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
        state.links.map(link => `
          <div class="link-row">

            ${escapeHtml(
              link.entity_a || ""
            )}

            ↔

            ${escapeHtml(
              link.entity_b || ""
            )}

            <br>

            <span class="signals">
              ${escapeHtml(
                link.evidence || ""
              )}
            </span>

          </div>
        `).join("");

    }

  }
}


/* =========================================================
   CASE DATA
   ========================================================= */

function applyCaseData(data) {

  state.scores =
    Array.isArray(data.scores)
      ? data.scores
      : [];

  state.links =
    Array.isArray(data.links)
      ? data.links
      : [];

  state.edges =
    Array.isArray(data.edges)
      ? data.edges
      : [];

  state.manifest =
    data.manifest || {};

  state.case =
    data.case || {};

  state.notes =
    Array.isArray(data.notes)
      ? data.notes
      : [];

  state.reviews =
    data.reviews || {};

  state.audit =
    Array.isArray(data.audit)
      ? data.audit
      : [];

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

    applyCaseData(data);

    render();

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
   TAB NAVIGATION
   ========================================================= */

function setupTabs() {

  document
    .querySelectorAll(
      ".tab"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const target =
            button.dataset.view;

          if (!target) {
            return;
          }

          document
            .querySelectorAll(
              ".tab"
            )
            .forEach(tab => {

              tab.classList.toggle(
                "active",
                tab === button
              );

            });

          document
            .querySelectorAll(
              ".view"
            )
            .forEach(view => {

              view.classList.toggle(
                "active",
                view.id === target
              );

            });

          if (
            target === "network"
          ) {

            setTimeout(
              () => {
                renderGraph();
              },
              50
            );

          }

        }
      );

    });
}


/* =========================================================
   RISK FILTERS
   ========================================================= */

function setupRiskFilters() {

  document
    .querySelectorAll(
      ".filter"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          activeTier =
            button.dataset.tier ||
            "ALL";

          document
            .querySelectorAll(
              ".filter"
            )
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

  if (!search) return;

  search.addEventListener(
    "input",
    () => {
      renderTable();
    }
  );
}


/* =========================================================
   PIPELINE
   ========================================================= */

function setupPipeline() {

  const button =
    $("run-pipeline");

  if (!button) return;

  button.addEventListener(
    "click",
    async () => {

      button.disabled = true;

      button.textContent =
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

            if (
              errorData?.detail
            ) {

              if (
                typeof errorData.detail ===
                "string"
              ) {

                message =
                  errorData.detail;

              } else if (
                errorData.detail.error
              ) {

                message =
                  `${errorData.detail.step}: ${errorData.detail.error}`;

              } else if (
                errorData.detail.step
              ) {

                message =
                  `Pipeline failed at ${errorData.detail.step}`;

              }

            }

          } catch (_) {
            /* Ignore JSON parsing errors */
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
          "Pipeline error:",
          error
        );

        toast(
          `Could not run pipeline: ${error.message}`
        );

      } finally {

        button.disabled = false;

        button.innerHTML =
          "Run investigation <span>→</span>";

      }

    }
  );
}


/* =========================================================
   INITIALIZATION
   ========================================================= */

function init() {

  setupTabs();

  setupRiskFilters();

  setupEntitySearch();

  setupNetworkControls();

  setupPipeline();

  load();

}


/* =========================================================
   START APPLICATION
   ========================================================= */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    init
  );

} else {

  init();

}