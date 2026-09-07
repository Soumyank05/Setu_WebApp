let state = {
  scores: [],
  links: [],
  edges: [],
  manifest: {},
  report_available: false
};

let activeTier = "ALL";


/* =========================
   HELPERS
========================= */

const $ = (id) => document.getElementById(id);


const toast = (text) => {

  const el = $("toast");

  el.textContent = text;

  el.classList.add("show");

  setTimeout(() => {
    el.classList.remove("show");
  }, 3400);
};


const reasons = (row) => {

  return [
    ["shared_device", "Shared device"],
    ["multi_hop_routing", "Multi-hop routing"],
    ["high_velocity_fanout", "Rapid fan-out"],
    ["high_in_degree", "High in-degree"]
  ]

    .filter(
      ([key]) =>
        row[key] === true ||
        row[key] === "True" ||
        row[key] === 1
    )

    .map(([, label]) => label)

    .join(" · ")

    || "No explainable signal";
};


const formatCurrency = (value) => {

  const number = Number(value || 0);

  if (!number) {
    return "₹0";
  }

  if (number >= 10000000) {
    return `₹${(number / 10000000).toFixed(2)}Cr`;
  }

  if (number >= 100000) {
    return `₹${(number / 100000).toFixed(2)}L`;
  }

  if (number >= 1000) {
    return `₹${(number / 1000).toFixed(1)}K`;
  }

  return `₹${number.toLocaleString("en-IN")}`;
};


/* =========================
   TRANSACTION STATISTICS
========================= */

function transactionStats() {

  const amounts = state.edges.map(
    edge => Number(edge.amount || 0)
  );

  const total = amounts.reduce(
    (sum, amount) => sum + amount,
    0
  );

  return {
    count: amounts.length,
    total
  };
}


/* =========================
   DASHBOARD METRICS
========================= */

function renderMetrics() {

  const high = state.scores.filter(
    row => row.risk_tier === "HIGH"
  ).length;

  const medium = state.scores.filter(
    row => row.risk_tier === "MEDIUM"
  ).length;

  const low = state.scores.filter(
    row => row.risk_tier === "LOW"
  ).length;

  const transactions = transactionStats();

  $("entity-count").textContent =
    state.scores.length || "—";

  $("high-count").textContent =
    high || "—";

  $("medium-count").textContent =
    medium || "—";

  $("link-count").textContent =
    state.links.length || "—";

  $("transfer-count").textContent =
    transactions.count || "—";

  $("transaction-value").textContent =
    transactions.count
      ? formatCurrency(transactions.total)
      : "—";


  /* Risk distribution */

  const totalEntities =
    high + medium + low;

  const highPercentage =
    totalEntities
      ? Math.round((high / totalEntities) * 100)
      : 0;

  $("risk-percentage").textContent =
    `${highPercentage}%`;

  $("risk-high-label").textContent = high;
  $("risk-medium-label").textContent = medium;
  $("risk-low-label").textContent = low;


  const highWidth =
    totalEntities
      ? (high / totalEntities) * 100
      : 0;

  const mediumWidth =
    totalEntities
      ? (medium / totalEntities) * 100
      : 0;

  const lowWidth =
    totalEntities
      ? (low / totalEntities) * 100
      : 0;


  $("risk-high-bar").style.width =
    `${highWidth}%`;

  $("risk-medium-bar").style.width =
    `${mediumWidth}%`;

  $("risk-low-bar").style.width =
    `${lowWidth}%`;


  /* Ring */

  const ring = document.querySelector(".risk-ring");

  if (ring) {

    const degrees =
      highPercentage * 3.6;

    ring.style.background =
      `conic-gradient(
        var(--red) 0deg ${degrees}deg,
        #27343a ${degrees}deg 360deg
      )`;
  }

}


/* =========================
   INVESTIGATION HEALTH
========================= */

function renderHealth() {

  const hasData =
    state.scores.length > 0 ||
    state.edges.length > 0;

  const hasLinks =
    state.links.length > 0;

  const hasNetwork =
    state.edges.length > 0;

  const hasReport =
    Boolean(state.report_available);


  $("health-data")
    .classList.toggle("ready", hasData);

  $("health-links")
    .classList.toggle("ready", hasLinks);

  $("health-network")
    .classList.toggle("ready", hasNetwork);

  $("health-report")
    .classList.toggle("ready", hasReport);


  const readyCount =
    [hasData, hasLinks, hasNetwork, hasReport]
      .filter(Boolean)
      .length;

  const percentage =
    Math.round((readyCount / 4) * 100);


  $("case-progress").style.width =
    `${percentage}%`;

  $("progress-label").textContent =
    `${readyCount}/4 investigation stages ready`;

}


/* =========================
   STATUS
========================= */

function renderStatus() {

  const high =
    state.scores.filter(
      row => row.risk_tier === "HIGH"
    ).length;


  if (!state.scores.length) {

    $("status").textContent =
      "Awaiting evidence";

    $("status-detail").textContent =
      "Run a new investigation to create a synthetic evidence case.";

    return;
  }


  $("status").textContent =
    "Evidence correlated";

  $("status-detail").textContent =
    `${high} high-priority entities surfaced from ${state.edges.length} payment transfers.`;
}


/* =========================
   RISK TABLE
========================= */

function renderTable() {

  const query =
    $("entity-search")
      .value
      .toLowerCase()
      .trim();


  const rows =
    state.scores

      .filter(
        row =>
          (
            activeTier === "ALL" ||
            row.risk_tier === activeTier
          )
        &&
        row.risk_tier !== "LOW"
        &&
        String(row.node)
          .toLowerCase()
          .includes(query)
      )

      .sort(
        (a, b) =>
          Number(b.risk_score || 0) -
          Number(a.risk_score || 0)
      );


  $("risk-table").innerHTML =
    rows.length

      ? rows.map(row => `

        <tr>

          <td class="mono">
            ${row.node}
          </td>

          <td>
            <span class="score">
              ${row.risk_score}
            </span>
            <small>/100</small>
          </td>

          <td>
            <span class="pill ${row.risk_tier}">
              ${row.risk_tier}
            </span>
          </td>

          <td class="signals">
            ${reasons(row)}
          </td>

          <td>
            <span class="signals">
              Pending
            </span>
          </td>

          <td>
            <button
              class="entity-action"
              onclick="openEntity('${String(row.node).replace(/'/g, "\\'")}')"
            >
              VIEW
            </button>
          </td>

        </tr>

      `).join("")

      : `
        <tr>
          <td colspan="6" class="empty">
            No matching priority entities.
          </td>
        </tr>
      `;
}


/* =========================
   ENTITY VIEW
========================= */

function openEntity(node) {

  document
    .querySelectorAll(".tab, .view")
    .forEach(element => {
      element.classList.remove("active");
    });


  const entityTab =
    document.querySelector(
      '[data-view="entity"]'
    );


  if (entityTab) {
    entityTab.classList.add("active");
  }


  $("entity").classList.add("active");


  renderEntity(node);

}

/* =========================
   ENTITY INTELLIGENCE
========================= */

function renderEntity(node) {

  const entity =
    state.scores.find(
      row =>
        String(row.node) === String(node)
    );


  if (!entity) {

    toast(
      "No scoring information available for this entity."
    );

    return;
  }


  const incoming =
    state.edges.filter(
      edge =>
        String(edge.receiver) === String(node)
    );


  const outgoing =
    state.edges.filter(
      edge =>
        String(edge.sender) === String(node)
    );


  const connectedNodes = [

    ...incoming.map(
      edge => String(edge.sender)
    ),

    ...outgoing.map(
      edge => String(edge.receiver)
    )

  ];


  const uniqueConnections =
    [...new Set(
      connectedNodes
        .filter(
          connection =>
            connection !== String(node)
        )
    )];


  const incomingValue =
    incoming.reduce(
      (sum, edge) =>
        sum + Number(edge.amount || 0),
      0
    );


  const outgoingValue =
    outgoing.reduce(
      (sum, edge) =>
        sum + Number(edge.amount || 0),
      0
    );


  /* HEADER */

  $("entity-title").textContent =
    node;


  $("entity-subtitle").textContent =
    "Cross-source entity risk and transaction analysis";


  /* SUMMARY */

  $("entity-score").textContent =
    entity.risk_score ?? "—";


  const tier =
    entity.risk_tier || "UNKNOWN";


  $("entity-tier").textContent =
    tier;


  $("entity-tier").className =
    `pill ${tier}`;


  $("entity-incoming").textContent =
    formatCurrency(incomingValue);


  $("entity-outgoing").textContent =
    formatCurrency(outgoingValue);


  $("entity-connections").textContent =
    uniqueConnections.length;


  $("entity-transfer-count").textContent =
    `${incoming.length + outgoing.length} EVENTS`;


  /* SIGNALS */

  renderEntitySignals(entity);


  /* CONNECTIONS */

  $("entity-connections-list").innerHTML =

    uniqueConnections.length

      ? uniqueConnections.map(
          connection => `

            <button
              class="connection-card"
              onclick="renderEntity('${connection.replace(/'/g, "\\'")}')"
            >

              <strong>
                ${connection}
              </strong>

              <small>
                Connected entity · click to inspect
              </small>

            </button>

          `
        ).join("")

      : `
          <p class="empty">
            No direct entity connections detected.
          </p>
        `;


  /* TIMELINE */

  renderEntityTimeline(
    node,
    incoming,
    outgoing
  );

}


/* =========================
   ENTITY SIGNALS
========================= */

function renderEntitySignals(entity) {

  const signals = [

    {
      key: "shared_device",

      title: "Shared device",

      description:
        "Entity shares a device identifier with another identity."

    },

    {
      key: "multi_hop_routing",

      title: "Multi-hop routing",

      description:
        "Funds appear within a transaction chain involving multiple hops."

    },

    {
      key: "high_velocity_fanout",

      title: "Rapid fan-out",

      description:
        "Funds were distributed across multiple downstream entities."

    },

    {
      key: "high_in_degree",

      title: "High in-degree",

      description:
        "Entity receives funds from an unusually large number of sources."

    }

  ];


  const active =
    signals.filter(
      signal =>
        entity[signal.key] === true ||
        entity[signal.key] === "True" ||
        entity[signal.key] === 1
    );


  $("entity-signals").innerHTML =

    active.length

      ? active.map(
          signal => `

            <div class="signal-item">

              <span class="signal-icon">
                !
              </span>

              <div>

                <strong>
                  ${signal.title}
                </strong>

                <small>
                  ${signal.description}
                </small>

              </div>

            </div>

          `
        ).join("")

      : `

          <div class="signal-item">

            <span
              class="signal-icon"
              style="
                background:#17362a;
                color:var(--lime);
              "
            >
              ✓
            </span>

            <div>

              <strong>
                No rule-based signals
              </strong>

              <small>
                No configured risk indicators were triggered.
              </small>

            </div>

          </div>

        `;

}


/* =========================
   ENTITY TIMELINE
========================= */

function renderEntityTimeline(
  node,
  incoming,
  outgoing
) {

  const events = [

    ...incoming.map(
      edge => ({

        type: "incoming",

        timestamp:
          edge.timestamp ||
          edge.datetime ||
          edge.time ||
          "",

        counterparty:
          edge.sender,

        amount:
          Number(edge.amount || 0)

      })
    ),


    ...outgoing.map(
      edge => ({

        type: "outgoing",

        timestamp:
          edge.timestamp ||
          edge.datetime ||
          edge.time ||
          "",

        counterparty:
          edge.receiver,

        amount:
          Number(edge.amount || 0)

      })
    )

  ];


  events.sort(
    (a, b) =>
      String(a.timestamp)
        .localeCompare(
          String(b.timestamp)
        )
  );


  $("entity-timeline").innerHTML =

    events.length

      ? events.map(
          event => `

            <div class="timeline-event">

              <span class="timeline-time">

                ${event.timestamp || "TRANSACTION"}

              </span>

              <strong>

                ${
                  event.type === "incoming"
                    ? "Received funds"
                    : "Sent funds"
                }

              </strong>

              <p>

                ${
                  event.type === "incoming"
                    ? "Received from"
                    : "Transferred to"
                }

                <span class="mono">
                  ${event.counterparty}
                </span>

                ·

                <strong>
                  ${formatCurrency(event.amount)}
                </strong>

              </p>

            </div>

          `
        ).join("")

      : `

          <p class="empty">
            No transaction events found for this entity.
          </p>

        `;

}


/* =========================
   NODE DETAIL
========================= */

function detail(node) {

  const incoming =
    state.edges.filter(
      edge => String(edge.receiver) === String(node)
    );

  const outgoing =
    state.edges.filter(
      edge => String(edge.sender) === String(node)
    );


  const connectedValue =
    [...incoming, ...outgoing]

      .reduce(
        (sum, edge) =>
          sum + Number(edge.amount || 0),
        0
      );


  const score =
    state.scores.find(
      row => String(row.node) === String(node)
    );


  $("node-detail").innerHTML = `

    <p class="eyebrow">
      ENTITY TRACE
    </p>

    <h3 class="mono">
      ${node}
    </h3>

    ${
      score
        ? `
          <div style="margin:14px 0">
            <span class="pill ${score.risk_tier}">
              ${score.risk_tier}
            </span>

            <strong
              style="
                font:22px 'DM Mono';
                margin-left:8px;
              "
            >
              ${score.risk_score}/100
            </strong>
          </div>
        `
        : ""
    }

    <p>
      ${incoming.length}
      incoming ·
      ${outgoing.length}
      outgoing transfer${outgoing.length === 1 ? "" : "s"}
    </p>

    <hr />

    <p class="eyebrow">
      CONNECTED VALUE
    </p>

    <h3>
      ${formatCurrency(connectedValue)}
    </h3>

    <hr />

    <p class="eyebrow">
      SIGNALS
    </p>

    <p>
      ${score ? reasons(score) : "No scoring data available."}
    </p>

  `;
}


/* =========================
   GRAPH
========================= */

function renderGraph() {

  const nodes = [
    ...new Set(
      state.edges.flatMap(
        edge => [
          String(edge.sender),
          String(edge.receiver)
        ]
      )
    )
  ].slice(0, 55);


  const graph = $("graph");
  const list = $("network-list");


  if (!nodes.length) {

    graph.innerHTML = `
      <p class="empty">
        Run the pipeline to explore the graph.
      </p>
    `;

    list.innerHTML = "";

    return;
  }


  graph.innerHTML = "";
  list.innerHTML = "";


  list.innerHTML =
    nodes.map(
      node => `
        <button data-node="${node}">
          ${node}
        </button>
      `
    ).join("");


  const positions = {};


  const width =
    graph.clientWidth || 600;

  const height =
    graph.clientHeight || 500;


  nodes.forEach((node, index) => {

    const angle =
      (index / nodes.length) *
      Math.PI *
      2;


    const radius =
      Math.min(width, height) * 0.36;


    positions[node] = {

      x:
        width / 2 +
        Math.cos(angle) * radius,

      y:
        height / 2 +
        Math.sin(angle) * radius

    };

  });


  /* Edges */

  state.edges

    .filter(
      edge =>
        positions[String(edge.sender)] &&
        positions[String(edge.receiver)]
    )

    .forEach(edge => {

      const a =
        positions[String(edge.sender)];

      const b =
        positions[String(edge.receiver)];


      const dx =
        b.x - a.x;

      const dy =
        b.y - a.y;


      const line =
        document.createElement("i");


      line.className = "edge";

      line.style.width =
        Math.hypot(dx, dy) + "px";

      line.style.left =
        a.x + "px";

      line.style.top =
        a.y + "px";

      line.style.transform =
        `rotate(${Math.atan2(dy, dx)}rad)`;


      graph.append(line);

    });


  /* Nodes */

  nodes.forEach(node => {

    const pos =
      positions[node];


    const high =
      state.scores.some(
        score =>
          String(score.node) === node &&
          score.risk_tier === "HIGH"
      );


    const element =
      document.createElement("button");


    element.className =
      "node " + (high ? "high" : "");


    element.textContent =
      node.slice(-2);


    element.title =
      node;


    element.style.left =
      (pos.x - 21) + "px";

    element.style.top =
      (pos.y - 21) + "px";


    element.onclick =
      () => detail(node);


    graph.append(element);

  });


  list
    .querySelectorAll("button")
    .forEach(button => {

      button.onclick =
        () => detail(button.dataset.node);

    });

}


/* =========================
   INTEGRITY
========================= */

function renderIntegrity() {

  const entries =
    Object.entries(state.manifest);


  $("manifest").innerHTML =

    entries.length

      ? entries.map(
          ([name, value]) => `

            <article class="hash-card">

              <span class="eyebrow">
                SOURCE ARTIFACT
              </span>

              <strong>
                ${name}
              </strong>

              <code>
                ${value.sha256}
              </code>

              <small>
                ${Number(value.size_bytes).toLocaleString()}
                bytes · SHA-256 verified at intake
              </small>

            </article>

          `
        ).join("")

      : `
        <p class="empty">
          No evidence manifest yet.
        </p>
      `;


  $("links").innerHTML =

    state.links.length

      ? state.links.map(
          link => `

            <div class="link-row">

              ${link.entity_a}
              ↔
              ${link.entity_b}

              <br />

              <span class="signals">
                ${link.evidence}
              </span>

            </div>

          `
        ).join("")

      : `
        <p class="empty">
          No cross-artifact links found.
        </p>
      `;
}


/* =========================
   MASTER RENDER
========================= */

function render() {

  renderMetrics();

  renderHealth();

  renderStatus();

  renderTable();

  renderGraph();

  renderIntegrity();

}


/* =========================
   LOAD CASE
========================= */

async function load() {

  try {

    const response =
      await fetch("/api/case");


    if (!response.ok) {
      throw new Error("Could not load case data.");
    }


    state =
      await response.json();


    render();

  } catch (error) {

    console.error(error);

    toast(
      "Could not load investigation data."
    );

  }

}


/* =========================
   TABS
========================= */

document
  .querySelectorAll(".tab")
  .forEach(button => {

    button.onclick = () => {

      document
        .querySelectorAll(".tab, .view")
        .forEach(
          element =>
            element.classList.remove("active")
        );


      button.classList.add("active");


      $(button.dataset.view)
        .classList.add("active");


      if (
        button.dataset.view === "network"
      ) {

        setTimeout(
          renderGraph,
          10
        );

      }

    };

  });


/* =========================
   FILTERS
========================= */

document
  .querySelectorAll(".filter")
  .forEach(button => {

    button.onclick = () => {

      activeTier =
        button.dataset.tier;


      document
        .querySelectorAll(".filter")
        .forEach(
          b =>
            b.classList.toggle(
              "active",
              b === button
            )
        );


      renderTable();

    };

  });


/* =========================
   SEARCH
========================= */

$("entity-search").oninput =
  renderTable;


/* =========================
   PIPELINE
========================= */

$("run-pipeline").onclick =
  async () => {

    const button =
      $("run-pipeline");


    button.disabled =
      true;

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

        const data =
          await response.json();

        throw new Error(
          data.detail?.step ||
          "Pipeline failed"
        );

      }


      await load();


      toast(
        "Investigation ready — evidence correlated successfully."
      );

    } catch (error) {

      console.error(error);

      toast(
        "Could not run pipeline: " +
        error.message
      );

    } finally {

      button.disabled =
        false;

      button.innerHTML =
        `Run investigation <span>→</span>`;

    }

  };


/* =========================
   INITIAL LOAD
========================= */

load();