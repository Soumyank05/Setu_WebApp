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
  risk_paths: [],
  links: [],
  edges: [],

  manifest: {},
  case: {},

  notes: [],
  reviews: {},
  status_updates: {},
  assignments: {},
  assignees: [],
  watchlists: {},
  notifications: [],
  custody: [],
  entity_attributes: {},
  analytics: {},
  approvals: [],
  external_requests: [],
  entity_tags: {},
  audit: [],

  report_available: false,

  auth: null,

  network: {
    selected: null,
    search: "",
    risk: "ALL",
    hops: "ALL",
    layout: "cose",
    egoFocus: false,
    activeTrace: null,
    tracerOpen: false,
    flowInterval: null,
    cy: null
  },
  visual: {
    days: 30,
    minAmount: 0,
    rail: "ALL",
    expand: false,
    model: null,
    activityChart: null,
    riskChart: null,
    cy: null
  }
};

let activeTier = "ALL";


/* =========================================================
   DOM HELPER
   ========================================================= */

function $(id) {
  return document.getElementById(id);
}

/* Native option menus cannot be consistently themed by macOS browsers. Keep
   the real select for filtering/accessibility and present a SETU-style menu. */
function initialiseFilterSelects() {
  document.querySelectorAll(".filter-select[data-select-for]").forEach(host => {
    const select = $(host.dataset.selectFor);
    if (!select || host.dataset.ready) return;
    host.dataset.ready = "true";
    const render = () => {
      const current = select.options[select.selectedIndex];
      host.innerHTML = `<button class="filter-select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false"><span>${escapeHtml(current?.text || "Select")}</span><i aria-hidden="true"></i></button><div class="filter-select-menu" role="listbox">${[...select.options].map(option => `<button type="button" role="option" aria-selected="${option.selected}" data-filter-value="${escapeHtml(option.value)}">${escapeHtml(option.text)}</button>`).join("")}</div>`;
      const trigger = host.querySelector(".filter-select-trigger");
      trigger.addEventListener("click", event => { event.stopPropagation(); document.querySelectorAll(".filter-select.open").forEach(item => { if (item !== host) item.classList.remove("open"); }); host.classList.toggle("open"); trigger.setAttribute("aria-expanded", String(host.classList.contains("open"))); });
      host.querySelectorAll("[data-filter-value]").forEach(option => option.addEventListener("click", () => { select.value = option.dataset.filterValue; select.dispatchEvent(new Event("change", {bubbles:true})); host.classList.remove("open"); render(); }));
    };
    select.addEventListener("change", render); render();
  });
  if (!document.documentElement.dataset.filterMenusReady) {
    document.documentElement.dataset.filterMenusReady = "true";
    document.addEventListener("click", () => document.querySelectorAll(".filter-select.open").forEach(item => item.classList.remove("open")));
  }
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


function formatCompactCurrency(value) {
  const number = Number(value || 0);
  if (number >= 10_000_000) return `₹${(number / 10_000_000).toFixed(number >= 100_000_000 ? 0 : 2)} Cr`;
  if (number >= 100_000) return `₹${(number / 100_000).toFixed(number >= 1_000_000 ? 0 : 1)} L`;
  if (number >= 1_000) return `₹${(number / 1_000).toFixed(1)}k`;
  return formatCurrency(number);
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
    ["shared_device", "Shared device", 20],
    ["multi_hop_routing", "Rapid pass-through", 30],
    ["high_velocity_fanout", "Rapid fan-out", 15],
    ["high_in_degree", "Unusually high fan-in", 15],
    ["high_value_flow", "High-value flow", 10],
    ["anomaly_flag", "Behavioural outlier", 10, value => Number(value) === -1]
  ];

  return signals.filter(([key, , , predicate]) => predicate ? predicate(row[key]) : hasSignal(row[key]));
}


function reasons(row) {
  if (row?.risk_reasons) {
    return String(row.risk_reasons)
      .split(";")
      .map(reason => reason.trim().replace(/\b\w/g, letter => letter.toUpperCase()))
      .join(" · ");
  }

  const active = getSignals(row);

  if (!active.length) {
    return "No explainable signal";
  }

  return active
    .map(([, label]) => label)
    .join(" · ");
}


function signalContext(row, key) {
  if (key === "multi_hop_routing" && row.pass_through_ratio !== undefined) return `${Math.round(Number(row.pass_through_ratio) * 100)}% of an incoming transfer was forwarded within 15 minutes.`;
  if (key === "high_velocity_fanout" && row.max_fanout_counterparties !== undefined) return `${row.max_fanout_counterparties} distinct recipients were paid within 15 minutes.`;
  if (key === "high_in_degree" && row.in_degree !== undefined) return `${row.in_degree} distinct incoming counterparties; above the case-relative threshold.`;
  if (key === "high_value_flow") return "Total flow is in the top 5% for this investigation.";
  if (key === "anomaly_flag") return "Outlier across transaction volume, degree, and short-window activity.";
  if (key === "shared_device") return "Corroborated by a shared device identifier; review remains required.";
  return "Contributed to this entity's triage score.";
}

function entityTags(node) {
  return arrayOrEmpty(state.entity_tags?.[node]);
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
  const transactionValueDetail = $("transaction-value-detail");
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
    transactionValue.textContent = stats.count ? formatCompactCurrency(stats.total) : "—";
    transactionValue.title = stats.count ? formatCurrency(stats.total) : "";
  }

  if (transactionValueDetail) {
    transactionValueDetail.textContent = stats.count ? formatCurrency(stats.total) : "";
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

  const progress = $("case-progress");
  const progressLabel = $("progress-label");
  const completed = [state.manifest && Object.keys(state.manifest).length, state.links.length, state.edges.length, state.report_available]
    .filter(Boolean).length;

  if (progress) progress.style.width = `${completed * 25}%`;
  if (progressLabel) {
    progressLabel.textContent = ready
      ? `${completed} of 4 investigation stages complete`
      : "Investigation not started";
  }

  const caseReference = String(state.case?.case_reference || "").trim();
  const caseRef = document.querySelector(".case-ref");
  if (caseRef) {
    if (caseReference) {
      caseRef.textContent = `CASE REF · ${caseReference}`;
      caseRef.style.display = "";
    } else {
      caseRef.textContent = "";
      caseRef.style.display = "none";
    }
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


function renderModelStatus() {
  const scores = arrayOrEmpty(state.scores);
  const versions = [...new Set(scores.map(row => String(row.scoring_model_version || "").trim()).filter(Boolean))];
  const reviewCount = scores.filter(row => getRisk(row) !== "LOW").length;
  const signalCounts = {};
  scores.filter(row => getRisk(row) !== "LOW").forEach(row => getSignals(row).forEach(([, label]) => { signalCounts[label] = (signalCounts[label] || 0) + 1; }));
  const topSignal = Object.entries(signalCounts).sort((a, b) => b[1] - a[1])[0];
  const version = $("model-version"), queue = $("model-review-count"), paths = $("model-path-count"), signal = $("model-top-signal"), badge = $("model-status-badge");
  if (version) version.textContent = versions.length === 1 ? versions[0] : versions.length ? "Mixed versions" : "Legacy / unavailable";
  if (queue) queue.textContent = scores.length ? reviewCount : "—";
  if (paths) paths.textContent = scores.length ? state.risk_paths.length : "—";
  if (signal) signal.textContent = topSignal ? `${topSignal[0]} · ${topSignal[1]}` : "—";
  if (badge) badge.textContent = scores.length ? (versions.length <= 1 ? "VERSIONED" : "REVIEW MIXED") : "AWAITING DATA";
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
    const entityText =
      getEntityId(row).toLowerCase();

    const risk =
      getRisk(row);

    const matchesSearch =
      !search ||
      entityText.includes(search);

    const matchesTier =
      activeTier === "ALL" ||
      risk === activeTier;

    const entity = getEntityId(row);
    const latest = arrayOrEmpty(state.status_updates?.[entity])[0];
    const statusFilter = $("status-filter")?.value || "ALL";
    const assignmentFilter = $("assignment-filter")?.value || "ALL";
    const tagFilter = $("tag-filter")?.value || "ALL";
    const assignment = state.assignments?.[entity];
    const matchesStatus = statusFilter === "ALL" || (latest?.status || "none") === statusFilter;
    const matchesAssignment = assignmentFilter === "ALL" || (assignmentFilter === "MINE" && assignment?.assignee === state.auth?.username) || (assignmentFilter === "UNASSIGNED" && !assignment);
    const matchesTag = tagFilter === "ALL" || entityTags(entity).some(item => item.tag === tagFilter);
    const attrs = state.entity_attributes?.[entity] || {};
    const contains = (field, value) => !value || arrayOrEmpty(attrs[field]).some(item => String(item).toLowerCase().includes(value.toLowerCase()));
    const minAmount = Number($("amount-min")?.value || 0);
    const from = $("date-from")?.value || "";
    const to = $("date-to")?.value || "";
    const matchesEvidence = Number(attrs.amount || 0) >= minAmount && (!from || String(attrs.date_max || "") >= from) && (!to || String(attrs.date_min || "") <= `${to}T23:59:59`) && contains("imeis", $("device-filter")?.value || "") && contains("upis", $("upi-filter")?.value || "") && contains("phones", $("phone-filter")?.value || "");

    return (
      matchesSearch &&
      matchesTier &&
      matchesStatus &&
      matchesAssignment &&
      matchesTag &&
      matchesEvidence &&
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

      const latestUpdate = arrayOrEmpty(state.status_updates?.[entity])[0];
      const updateLabel = latestUpdate ? String(latestUpdate.status || "new").replaceAll("_", " ") : "No update";
      const assignment = state.assignments?.[entity];
      const due = assignment?.due_date || "";
      const dueClass = due && due < new Date().toISOString().slice(0, 10) ? "overdue" : "";

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
            ${escapeHtml(reasons(row))}${entityTags(entity).length ? `<small class="tag-list">${entityTags(entity).map(item => escapeHtml(item.tag.replaceAll("_", " "))).join(" · ")}</small>` : ""}
          </td>

          <td>
            <span class="entity-status ${escapeHtml(String(latestUpdate?.status || "none"))}">${escapeHtml(updateLabel)}</span>
            ${latestUpdate ? `<small class="status-author">${escapeHtml(latestUpdate.author || "")}</small>` : ""}
            ${assignment ? `<small class="status-author ${dueClass}">${escapeHtml(assignment.assignee)} · due ${escapeHtml(due)}</small>` : ""}
          </td>

          <td>
            <button type="button" class="small-action" data-watch-entity="${escapeHtml(entity)}">${arrayOrEmpty(state.watchlists?.[String(state.auth?.id)])[0] && arrayOrEmpty(state.watchlists?.[String(state.auth?.id)]).includes(entity) ? "Unwatch" : "Watch"}</button>
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
  const id = String(entity || "").trim();

  if (!id) {
    console.warn("SETU: openEntity called without an entity.");
    return;
  }

  console.log("SETU: Opening Entity Intelligence:", id);

  const entityView = $("entity");

  if (!entityView) {
    console.error("SETU: #entity view was not found.");
    toast("Entity Intelligence view is missing.");
    return;
  }

  // Activate Entity Intelligence tab
  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle(
      "active",
      tab.dataset.view === "entity"
    );
  });

  // Activate Entity Intelligence view
  document.querySelectorAll(".view").forEach(view => {
    view.classList.toggle(
      "active",
      view.id === "entity"
    );
  });

  // Render selected entity
  renderEntity(id);

  // Scroll to the Entity Intelligence section
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
      String(getEntityId(row)).trim() === id
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
    outgoing,
    id
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

  container.innerHTML = `
    <div class="score-explanation">
      <span>Score basis</span><strong>${getScore(row)}/100</strong>
      <small>Only corroborated signals contribute to the triage score. Human review is required.</small>
    </div>
    ${active.map(
      ([key, label, points]) => `
        <div class="signal-row">

          <span
            class="signal-dot"
          ></span>

          <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(signalContext(row, key))}</small></span>
          <b class="signal-points">+${points || 0}</b>

        </div>
      `
    ).join("")}`;
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
  outgoing,
  entity
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
    })),
    ...arrayOrEmpty(state.status_updates?.[entity]).map(update => ({ kind: "status", time: update.updated_at_utc, label: `Status: ${String(update.status).replaceAll("_", " ")}`, detail: update.message })),
    ...(state.reviews?.[entity] ? [{ kind: "review", time: state.reviews[entity].updated_at_utc, label: `Review: ${state.reviews[entity].disposition}`, detail: state.reviews[entity].rationale }] : []),
    ...state.notes.map(note => ({ kind: "note", time: note.at_utc, label: `Case note · ${note.author}`, detail: note.text }))

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
              event.kind === "status" ? "in" : event.kind === "review" ? "out" : event.direction === "IN"
                ? "in"
                : "out"
            }"
          >
            ${
              event.kind === "status" ? "•" : event.kind === "review" ? "✓" : event.direction === "IN"
                ? "↓"
                : "↑"
            }
          </div>

          <div class="timeline-content">

            <strong>

              ${
                event.kind ? event.label : event.direction === "IN"
                  ? "Received from"
                  : "Sent to"
              }

              ${escapeHtml(
                event.kind ? event.detail : event.other
              )}

            </strong>

            <span>
              ${event.kind ? "Case activity" : formatCurrency(event.amount)}
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
            ([key, label, points]) => `
              <div class="signal-row">

                <span
                  class="signal-dot"
                ></span>

                <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(signalContext(scoreRow, key))}</small></span>
                <b class="signal-points">+${points || 0}</b>

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

      <div class="node-detail-action-group" style="display:flex; flex-direction:column; gap:8px; margin-top:14px;">
        <button
          type="button"
          class="primary node-trace-button"
          data-open-entity="${escapeHtml(id)}"
        >
          Open entity intelligence
        </button>

        <button
          type="button"
          class="outline node-trace-button"
          data-focus-ego-network="${escapeHtml(id)}"
        >
          ◎ Focus ego-network
        </button>

        <button
          type="button"
          class="outline node-trace-button"
          data-trace-from-node="${escapeHtml(id)}"
        >
          ⚡ Trace mule flow from here
        </button>

        <button type="button" class="outline node-trace-button" data-open-graph-operations="${escapeHtml(id)}">
          Explain a link in Operations
        </button>
      </div>

      <div id="node-provenance" class="node-detail-section provenance-loading">
        <span class="eyebrow">EVIDENCE TRACEABILITY</span>
        <p class="empty">Loading source rows, documents, device IDs, and notes…</p>
      </div>

    </div>
  `;
}


/* =========================================================
   NETWORK GRAPH (CYTOSCAPE ENGINE WITH COSE PHYSICS,
   EGO-NETWORK FILTERING & MULE PATH ANIMATION)
   ========================================================= */

let cachedFlowMap = null;
let cachedEdgesRef = null;

function getEntityFlowMap() {
  if (cachedFlowMap && cachedEdgesRef === state.edges) {
    return cachedFlowMap;
  }
  const flowMap = new Map();
  state.edges.forEach(edge => {
    const sender = getSender(edge);
    const receiver = getReceiver(edge);
    const amt = getAmount(edge) || 0;
    if (sender) flowMap.set(sender, (flowMap.get(sender) || 0) + amt);
    if (receiver) flowMap.set(receiver, (flowMap.get(receiver) || 0) + amt);
  });
  cachedFlowMap = flowMap;
  cachedEdgesRef = state.edges;
  return flowMap;
}

function entityTotalFlow(entityId) {
  const map = getEntityFlowMap();
  return map.get(entityId) || 0;
}

function renderGraph() {
  const graph = $("graph");
  if (!graph) return;

  const allFiltered = getFilteredNetworkEntities();

  if (!allFiltered.length) {
    if (state.network.cy) {
      try { state.network.cy.destroy(); } catch (_) {}
      state.network.cy = null;
    }
    graph.innerHTML = `
      <div class="graph-empty">
        <span class="graph-empty-icon">⌁</span>
        <strong>Network awaiting evidence</strong>
        <p>Run the investigation pipeline to generate the money-flow network.</p>
      </div>
    `;
    return;
  }

  // Scoped high-signal entity selection:
  // Instead of pushing 600+ nodes and 7,200 raw edges into Cytoscape force layout,
  // we scope the active canvas to the focal entity's counterparty cluster (or top threat hubs),
  // aggregate multi-transfers between node pairs, and render in under 15ms.
  let entities = [];
  const MAX_CANVAS_NODES = 28;

  if (state.network.selected) {
    const selectedId = state.network.selected;
    const byCounterparty = new Map();
    state.edges.forEach(edge => {
      const sender = getSender(edge), receiver = getReceiver(edge);
      if (sender === selectedId || receiver === selectedId) {
        const other = sender === selectedId ? receiver : sender;
        byCounterparty.set(other, (byCounterparty.get(other) || 0) + (getAmount(edge) || 0));
      }
    });

    const topCounterparties = [...byCounterparty.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CANVAS_NODES - 1)
      .map(([id]) => id);

    const allowed = new Set([selectedId, ...topCounterparties]);

    // If a mule path trace is active, include its nodes so the full trail is visible
    if (state.network.activeTrace && Array.isArray(state.network.activeTrace.nodes)) {
      state.network.activeTrace.nodes.forEach(n => allowed.add(n));
    }

    entities = allFiltered.filter(entity => allowed.has(entity.id));

    // Ensure focal entity is present in entities
    if (!entities.some(e => e.id === selectedId)) {
      const allEntities = getNetworkEntities();
      const focal = allEntities.find(e => e.id === selectedId) || { id: selectedId, score: 0, risk: "LOW" };
      entities.unshift(focal);
    }
  } else {
    // Macroscopic overview when no node selected: show top suspects by risk score & total flow
    const flowMap = getEntityFlowMap();
    const sorted = [...allFiltered].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (flowMap.get(b.id) || 0) - (flowMap.get(a.id) || 0);
    });
    entities = sorted.slice(0, MAX_CANVAS_NODES);
  }

  // Fallback to SVG renderer if Cytoscape is unavailable
  if (!window.cytoscape) {
    renderGraphSvgFallback(graph, entities);
    return;
  }

  const currentIds = entities.map(e => e.id).sort().join(",");
  const existingNodeIds = state.network.cy ? state.network.cy.nodes().map(n => n.id()).sort().join(",") : "";

  // If Cytoscape already has the exact same active nodes, avoid re-layout; just apply highlights!
  if (state.network.cy && currentIds === existingNodeIds && !state.network.needsRebuild) {
    applyNetworkHighlights();
    return;
  }
  state.network.needsRebuild = false;

  const entityIdSet = new Set(entities.map(e => e.id));
  const flowMap = getEntityFlowMap();
  const nodeElements = entities.map(entity => {
    const isHigh = entity.risk === "HIGH";
    const isMed = entity.risk === "MEDIUM";
    const riskClass = isHigh ? "risk-high" : isMed ? "risk-medium" : "risk-low";
    const flow = flowMap.get(entity.id) || 0;
    const size = Math.min(52, Math.max(26, 22 + Math.sqrt(flow || 0) / 18));
    return {
      data: {
        id: entity.id,
        label: entity.id,
        risk: entity.risk,
        score: entity.score,
        flow: flow,
        size: size
      },
      classes: `${riskClass}`
    };
  });

  // Aggregate multi-transfers between node pairs into single directed edge
  const edgeMap = new Map();
  state.edges.forEach(edge => {
    const sender = getSender(edge);
    const receiver = getReceiver(edge);
    if (entityIdSet.has(sender) && entityIdSet.has(receiver)) {
      const key = `${sender}->${receiver}`;
      const amount = getAmount(edge) || 0;
      const isShared = Boolean(edge.shared_device);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          source: sender,
          target: receiver,
          amount: amount,
          count: 1,
          shared_device: isShared
        });
      } else {
        const item = edgeMap.get(key);
        item.amount += amount;
        item.count += 1;
        if (isShared) item.shared_device = true;
      }
    }
  });

  const edgeElements = Array.from(edgeMap.values()).map(item => {
    const width = Math.min(5.5, Math.max(1.5, 1.2 + Math.sqrt(item.amount) / 220));
    const countLabel = item.count > 1 ? ` (${item.count}x)` : "";
    return {
      data: {
        id: `edge-${item.source}-${item.target}`,
        source: item.source,
        target: item.target,
        amount: item.amount,
        count: item.count,
        label: `${formatCurrency(item.amount)}${countLabel}`,
        width: width,
        shared_device: item.shared_device
      },
      classes: item.shared_device ? "shared-device" : ""
    };
  });

  // Destroy previous Cytoscape instance if recreating elements
  if (state.network.cy) {
    try { state.network.cy.destroy(); } catch (_) {}
    state.network.cy = null;
  }

  // Clear graph container DOM to host Cytoscape canvas
  graph.innerHTML = "";

  const cytoscapeStyles = [
    {
      selector: "node",
      style: {
        "label": "data(id)",
        "font-family": "DM Mono, monospace",
        "font-size": "9px",
        "font-weight": 500,
        "color": "#cbd5e1",
        "text-valign": "bottom",
        "text-margin-y": 5,
        "text-background-color": "#060a10",
        "text-background-opacity": 0.88,
        "text-background-padding": 3,
        "text-background-shape": "roundrectangle",
        "background-color": "#111827",
        "border-width": 2,
        "border-color": "#334155",
        "width": "data(size)",
        "height": "data(size)",
        "transition-property": "background-color, border-color, border-width, opacity, width, height",
        "transition-duration": "0.2s"
      }
    },
    {
      selector: "node.risk-high",
      style: {
        "border-color": "#f43f5e",
        "background-color": "#2e1017"
      }
    },
    {
      selector: "node.risk-medium",
      style: {
        "border-color": "#f59e0b",
        "background-color": "#2a1e0b"
      }
    },
    {
      selector: "node.risk-low",
      style: {
        "border-color": "#10b981",
        "background-color": "#0f241a"
      }
    },
    {
      selector: "node.focal",
      style: {
        "border-color": "#38bdf8",
        "border-width": 4,
        "background-color": "#0c2738",
        "color": "#38bdf8",
        "font-weight": 700,
        "font-size": "11px",
        "z-index": 100
      }
    },
    {
      selector: "node.counterparty-in",
      style: {
        "border-color": "#38bdf8",
        "border-width": 3
      }
    },
    {
      selector: "node.counterparty-out",
      style: {
        "border-color": "#f59e0b",
        "border-width": 3
      }
    },
    {
      selector: "node.path-node",
      style: {
        "border-color": "#c084fc",
        "border-width": 4,
        "background-color": "#2c1240",
        "color": "#f3e8ff",
        "font-weight": 700,
        "z-index": 150
      }
    },
    {
      selector: "node.dimmed",
      style: {
        "opacity": 0.12
      }
    },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "target-arrow-shape": "triangle",
        "target-arrow-color": "#26354a",
        "line-color": "#26354a",
        "width": "data(width)",
        "arrow-scale": 1.15,
        "label": "data(label)",
        "font-family": "DM Mono, monospace",
        "font-size": "8px",
        "color": "#64748b",
        "text-background-color": "#060a10",
        "text-background-opacity": 0.88,
        "text-background-padding": 2,
        "text-background-shape": "roundrectangle",
        "text-rotation": "autorotate",
        "transition-property": "line-color, target-arrow-color, width, opacity",
        "transition-duration": "0.2s"
      }
    },
    {
      selector: "edge.flow-in",
      style: {
        "line-color": "#38bdf8",
        "target-arrow-color": "#38bdf8",
        "color": "#38bdf8",
        "width": 3,
        "z-index": 50
      }
    },
    {
      selector: "edge.flow-out",
      style: {
        "line-color": "#f59e0b",
        "target-arrow-color": "#f59e0b",
        "color": "#f59e0b",
        "width": 3,
        "z-index": 50
      }
    },
    {
      selector: "edge.path-edge",
      style: {
        "line-color": "#c084fc",
        "target-arrow-color": "#c084fc",
        "color": "#f3e8ff",
        "width": 4,
        "line-style": "dashed",
        "z-index": 200
      }
    },
    {
      selector: "edge.shared-device",
      style: {
        "line-style": "dotted",
        "line-color": "#10b981",
        "target-arrow-color": "#10b981",
        "width": 2
      }
    },
    {
      selector: "edge.dimmed",
      style: {
        "opacity": 0.08
      }
    }
  ];

  const layoutName = state.network.layout || "cose";
  const layoutOptions = getCytoscapeLayoutConfig(layoutName);

  state.network.cy = cytoscape({
    container: graph,
    elements: [...nodeElements, ...edgeElements],
    style: cytoscapeStyles,
    layout: layoutOptions,
    wheelSensitivity: 0.28,
    minZoom: 0.2,
    maxZoom: 3.5
  });

  state.network.cy.on("tap", "node", evt => {
    const id = evt.target.id();
    selectNetworkNode(id);
  });

  state.network.cy.on("tap", evt => {
    if (evt.target === state.network.cy) {
      // Background tap
    }
  });

  applyNetworkHighlights();
}

function getCytoscapeLayoutConfig(layoutName) {
  if (layoutName === "concentric") {
    const sel = state.network.selected;
    return {
      name: "concentric",
      animate: true,
      animationDuration: 400,
      concentric: node => (node.id() === sel ? 3 : (node.hasClass("counterparty-in") || node.hasClass("counterparty-out")) ? 2 : 1),
      levelWidth: () => 1,
      minNodeSpacing: 65,
      padding: 40,
      startAngle: -Math.PI / 2
    };
  }
  if (layoutName === "breadthfirst") {
    return {
      name: "breadthfirst",
      animate: true,
      animationDuration: 400,
      directed: true,
      padding: 40,
      spacingFactor: 1.25
    };
  }
  // Default: COSE force-directed physics
  return {
    name: "cose",
    animate: true,
    animationDuration: 350,
    animationEasing: "ease-out",
    nodeDimensionsIncludeLabels: true,
    nodeRepulsion: () => 6500,
    idealEdgeLength: () => 85,
    edgeElasticity: () => 45,
    gravity: 0.25,
    numIter: 100,
    initialTemp: 120,
    coolingFactor: 0.95,
    padding: 35,
    randomize: false
  };
}

function setGraphLayout(layoutName) {
  state.network.layout = layoutName;
  document.querySelectorAll(".graph-hud [data-layout]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-layout") === layoutName);
  });
  if (!state.network.cy) return;
  const config = getCytoscapeLayoutConfig(layoutName);
  const layout = state.network.cy.layout(config);
  layout.run();
}

function applyNetworkHighlights() {
  const cy = state.network.cy;
  if (!cy) return;

  // Clear existing highlight classes
  cy.elements().removeClass("focal counterparty-in counterparty-out flow-in flow-out path-node path-edge dimmed");

  // If a path trace is active, highlight the route!
  if (state.network.activeTrace && state.network.activeTrace.nodes) {
    const traceNodes = new Set(state.network.activeTrace.nodes);
    const traceEdgeKeys = new Set();
    for (let i = 0; i < state.network.activeTrace.nodes.length - 1; i++) {
      const u = state.network.activeTrace.nodes[i];
      const v = state.network.activeTrace.nodes[i + 1];
      traceEdgeKeys.add(`${u}->${v}`);
    }

    const pathEdges = [];
    cy.nodes().forEach(node => {
      if (traceNodes.has(node.id())) {
        node.addClass("path-node");
      } else {
        node.addClass("dimmed");
      }
    });

    cy.edges().forEach(edge => {
      const key = `${edge.data("source")}->${edge.data("target")}`;
      if (traceEdgeKeys.has(key)) {
        edge.addClass("path-edge");
        pathEdges.push(edge);
      } else {
        edge.addClass("dimmed");
      }
    });

    animatePathFlow(pathEdges);
    return;
  }

  // If no trace is active, cancel any previous flow pulse animation
  if (state.network.flowInterval) {
    clearInterval(state.network.flowInterval);
    state.network.flowInterval = null;
  }

  const selected = state.network.selected;
  if (!selected) {
    return;
  }

  const focalNode = cy.getElementById(selected);
  if (focalNode && focalNode.length) {
    focalNode.addClass("focal");
  }

  const inEdges = cy.edges(`[target = "${selected}"]`);
  const outEdges = cy.edges(`[source = "${selected}"]`);

  inEdges.addClass("flow-in");
  inEdges.sources().addClass("counterparty-in");

  outEdges.addClass("flow-out");
  outEdges.targets().addClass("counterparty-out");

  const activeElements = cy.collection()
    .merge(focalNode)
    .merge(inEdges)
    .merge(outEdges)
    .merge(inEdges.sources())
    .merge(outEdges.targets());

  cy.elements().difference(activeElements).addClass("dimmed");
}

function animatePathFlow(pathEdges) {
  if (!pathEdges || !pathEdges.length) return;
  if (state.network.flowInterval) {
    clearInterval(state.network.flowInterval);
    state.network.flowInterval = null;
  }
  let step = 0;
  state.network.flowInterval = setInterval(() => {
    if (!state.network.activeTrace) {
      clearInterval(state.network.flowInterval);
      state.network.flowInterval = null;
      return;
    }
    pathEdges.forEach((edge, idx) => {
      if (idx === step) {
        edge.style({
          "width": 6,
          "line-color": "#38bdf8",
          "target-arrow-color": "#38bdf8",
          "opacity": 1.0
        });
      } else {
        edge.style({
          "width": 4,
          "line-color": "#c084fc",
          "target-arrow-color": "#c084fc",
          "opacity": 0.85
        });
      }
    });
    step = (step + 1) % pathEdges.length;
  }, 380);
}

function toggleEgoFocus() {
  state.network.egoFocus = !state.network.egoFocus;
  const btn = $("graph-ego-focus-btn");
  if (btn) btn.classList.toggle("active", state.network.egoFocus);
  state.network.needsRebuild = true;
  renderGraph();
}

function openMulePathTracerWithSource(sourceId) {
  const hud = $("path-tracer-hud");
  if (hud) hud.classList.remove("hidden");
  const toggleBtn = $("graph-trace-toggle-btn");
  if (toggleBtn) toggleBtn.classList.add("active");
  populatePathTracerSelects(sourceId);
}

function toggleMulePathTracer() {
  const hud = $("path-tracer-hud");
  if (!hud) return;
  const isHidden = hud.classList.contains("hidden");
  if (isHidden) {
    hud.classList.remove("hidden");
    $("graph-trace-toggle-btn")?.classList.add("active");
    populatePathTracerSelects(state.network.selected);
  } else {
    hud.classList.add("hidden");
    $("graph-trace-toggle-btn")?.classList.remove("active");
  }
}

function populatePathTracerSelects(preferredSource) {
  const sourceSelect = $("path-tracer-source");
  const targetSelect = $("path-tracer-target");
  if (!sourceSelect || !targetSelect) return;

  const entities = getFilteredNetworkEntities();
  const optionsHtml = entities.map(entity => {
    const riskTag = `[${entity.risk}]`;
    return `<option value="${escapeHtml(entity.id)}">${riskTag} ${escapeHtml(entity.id)}</option>`;
  }).join("");

  sourceSelect.innerHTML = `<option value="">Select source…</option>` + optionsHtml;
  targetSelect.innerHTML = `<option value="">Select target…</option>` + optionsHtml;

  if (preferredSource && entities.some(e => e.id === preferredSource)) {
    sourceSelect.value = preferredSource;
    const candidateTarget = entities.find(e => e.id !== preferredSource && e.risk === "HIGH") || entities.find(e => e.id !== preferredSource);
    if (candidateTarget) {
      targetSelect.value = candidateTarget.id;
    }
  }
}

async function runMulePathTrace(source, target) {
  if (!source || !target) {
    toast("Select both a source and target entity to trace.");
    return;
  }
  if (source === target) {
    toast("Source and target must be distinct entities.");
    return;
  }

  try {
    let result = null;
    try {
      result = await requestJson("/api/graph/paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, target })
      });
    } catch (_) {
      result = await requestJson("/api/graph/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, target })
      });
    }

    let route = null;
    if (result && result.routes && result.routes.length > 0) {
      route = result.routes[0];
    } else if (result && result.connected && result.nodes && result.nodes.length > 1) {
      const routeValue = (result.steps || []).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
      const amounts = (result.steps || []).map(s => Number(s.amount) || 0).filter(Boolean);
      const bottleneck = amounts.length ? Math.min(...amounts) : routeValue;
      route = {
        nodes: result.nodes,
        hops: result.nodes.length - 1,
        value: routeValue,
        bottleneck_value: bottleneck,
        risk: "HIGH",
        transfers: result.steps || []
      };
    } else if (state.network.cy) {
      const rootNode = state.network.cy.getElementById(source);
      const goalNode = state.network.cy.getElementById(target);
      if (rootNode.length && goalNode.length) {
        const aStar = state.network.cy.elements().aStar({ root: rootNode, goal: goalNode, directed: true });
        if (aStar && aStar.found) {
          const pathNodes = aStar.path.nodes().map(n => n.id());
          const pathEdges = aStar.path.edges();
          const amounts = pathEdges.map(e => Number(e.data("amount")) || 0);
          const totalVal = amounts.reduce((a, b) => a + b, 0);
          route = {
            nodes: pathNodes,
            hops: pathNodes.length - 1,
            value: totalVal,
            bottleneck_value: amounts.length ? Math.min(...amounts) : totalVal,
            risk: "HIGH",
            transfers: []
          };
        }
      }
    }

    if (!route || !route.nodes || route.nodes.length < 2) {
      toast(`No active laundering path found between ${source} and ${target}.`);
      clearMulePath();
      return;
    }

    state.network.activeTrace = route;
    $("path-tracer-results")?.classList.remove("hidden");
    const valEl = $("path-metric-value");
    if (valEl) valEl.textContent = formatCurrency(route.value);
    const bottleEl = $("path-metric-bottleneck");
    if (bottleEl) bottleEl.textContent = formatCurrency(route.bottleneck_value);
    const hopsEl = $("path-metric-hops");
    if (hopsEl) hopsEl.textContent = route.hops;
    const riskEl = $("path-metric-risk");
    if (riskEl) {
      riskEl.textContent = route.risk;
      riskEl.className = `pill ${route.risk}`;
    }

    const chainEl = $("path-chain-nodes");
    if (chainEl) {
      chainEl.innerHTML = route.nodes.map((node, i) => {
        if (i === 0) return `<span class="path-chain-step source">${escapeHtml(node)}</span>`;
        return `<span class="path-chain-arrow">➔</span><span class="path-chain-step">${escapeHtml(node)}</span>`;
      }).join("");
    }

    applyNetworkHighlights();
    toast(`Traced ${route.hops}-hop mule path: ${formatCurrency(route.value)} total flow.`);
  } catch (err) {
    toast(`Trace failed: ${err.message}`);
  }
}

function clearMulePath() {
  state.network.activeTrace = null;
  if (state.network.flowInterval) {
    clearInterval(state.network.flowInterval);
    state.network.flowInterval = null;
  }
  $("path-tracer-results")?.classList.add("hidden");
  applyNetworkHighlights();
}

function renderGraphSvgFallback(graph, entities) {
  const width = Math.max(graph.clientWidth || 700, 500);
  const height = Math.max(graph.clientHeight || 600, 500);
  const centerX = width / 2, centerY = height / 2;
  const selected = state.network.selected;
  const entityIds = new Set(entities.map(e => e.id));
  const positions = new Map();
  let ordered = [...entities];

  if (selected && entityIds.has(selected)) {
    ordered = [
      ...entities.filter(e => e.id === selected),
      ...entities.filter(e => e.id !== selected)
    ];
  }

  const radius = Math.max(100, Math.min(width, height) * 0.34);
  ordered.forEach((entity, index) => {
    if (selected && entity.id === selected) {
      positions.set(entity.id, { x: centerX, y: centerY });
      return;
    }
    const hasSelected = Boolean(selected && entityIds.has(selected));
    const indexOffset = hasSelected ? index - 1 : index;
    const count = hasSelected ? Math.max(ordered.length - 1, 1) : Math.max(ordered.length, 1);
    const angle = (Math.PI * 2 * indexOffset) / count - Math.PI / 2;
    positions.set(entity.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    });
  });

  const edges = state.edges.filter(edge => {
    const s = getSender(edge), r = getReceiver(edge);
    return entityIds.has(s) && entityIds.has(r);
  });

  let svg = `
    <svg class="network-svg" width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="setu-network-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
      </defs>
  `;

  edges.forEach(edge => {
    const s = getSender(edge), r = getReceiver(edge);
    const from = positions.get(s), to = positions.get(r);
    if (!from || !to) return;
    const highlighted = selected === s || selected === r;
    svg += `
      <g class="network-edge ${highlighted ? "selected" : ""}">
        <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" marker-end="url(#setu-network-arrow)" />
        <text x="${(from.x + to.x) / 2}" y="${(from.y + to.y) / 2 - 8}" text-anchor="middle">
          ${formatCurrency(getAmount(edge))}
        </text>
      </g>
    `;
  });

  entities.forEach(entity => {
    const pos = positions.get(entity.id);
    if (!pos) return;
    const selectedNode = selected === entity.id;
    const connectedNode = Boolean(selected && state.edges.some(edge => {
      const s = getSender(edge), r = getReceiver(edge);
      return (s === selected && r === entity.id) || (r === selected && s === entity.id);
    }));

    const classes = [
      "network-node",
      entity.risk.toLowerCase(),
      selectedNode ? "selected" : "",
      connectedNode ? "connected" : ""
    ].filter(Boolean).join(" ");

    svg += `
      <g class="${classes}" data-network-graph-node="${escapeHtml(entity.id)}" transform="translate(${pos.x}, ${pos.y})">
        <circle class="network-node-glow" r="${selectedNode ? 30 : 24}" />
        <circle class="network-node-circle" r="${selectedNode ? 22 : 17}" />
        <text class="network-node-label" x="0" y="${selectedNode ? 39 : 33}" text-anchor="middle">${escapeHtml(entity.id)}</text>
        <text class="network-node-score" x="0" y="${selectedNode ? 54 : 48}" text-anchor="middle">${entity.score}</text>
      </g>
    `;
  });

  svg += `</svg>`;
  graph.innerHTML = svg;
}

/* =========================================================
   VISUAL ANALYSIS — charts consume the API's aggregates only.
   ========================================================= */

function visualQuery() {
  const params = new URLSearchParams({days: state.visual.days, risk: state.network.risk, rail: state.visual.rail, min_amount: state.visual.minAmount, expand: state.visual.expand});
  if (state.network.selected) params.set("entity", state.network.selected);
  return params;
}

function drawAggregateFallback(canvas, values, color, label) {
  if (!canvas) return;
  const width = canvas.clientWidth || 300, height = 220, ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio; canvas.height = height * ratio; canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d"); context.scale(ratio, ratio); context.clearRect(0, 0, width, height);
  const maximum = Math.max(...values, 1), pad = 22;
  context.strokeStyle = "#233239"; context.lineWidth = 1;
  for (let row = 0; row < 4; row += 1) { const y = pad + (height - 2 * pad) * row / 3; context.beginPath(); context.moveTo(pad, y); context.lineTo(width - pad, y); context.stroke(); }
  context.strokeStyle = color; context.lineWidth = 2; context.beginPath();
  values.forEach((value, index) => { const x = pad + (width - 2 * pad) * index / Math.max(values.length - 1, 1), y = height - pad - (height - 2 * pad) * value / maximum; index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.stroke();
  context.fillStyle = "#899a9f"; context.font = "10px DM Mono"; context.fillText(`${label} · Chart library unavailable`, pad, 14);
}

function renderVisualAnalysis(model) {
  state.visual.model = model;
  const summary = $("visual-summary");
  if (summary) summary.textContent = `${formatNumber(model.summary.transfer_count)} transfers · ${formatCurrency(model.summary.transfer_value)} · ${model.filters.days}-day filtered view`;
  const caption = $("relationship-caption");
  if (caption) caption.textContent = model.selected.id ? `${model.selected.id} · top ${model.relationship_graph.counterparty_limit} counterparties${model.relationship_graph.expanded ? " · 2 hops" : " · 1 hop"}` : "No matching entity";
  if (window.Chart) {
    state.visual.activityChart?.destroy(); state.visual.riskChart?.destroy();
    const activity = $("activity-chart"), risk = $("risk-flow-chart");
    if (activity) state.visual.activityChart = new Chart(activity, {type:"line", data:{labels:model.daily.map(item => item.date.slice(5)), datasets:[{label:"Transfer value", data:model.daily.map(item => item.value), borderColor:"#71d3df", backgroundColor:"#71d3df22", fill:true, tension:.28, pointRadius:0, yAxisID:"y"},{label:"Transfer count", data:model.daily.map(item => item.count), borderColor:"#c9ff53", tension:.28, pointRadius:0, yAxisID:"yCount"}]}, options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{labels:{color:"#899a9f",boxWidth:8,font:{size:9}}}, tooltip:{callbacks:{label:item => item.datasetIndex ? `${item.raw} transfers` : formatCurrency(item.raw)}}}, scales:{x:{ticks:{maxTicksLimit:6,color:"#899a9f"},grid:{display:false}},y:{position:"left",ticks:{color:"#899a9f",callback:value => `₹${Math.round(value / 1000)}k`},grid:{color:"#233239"}},yCount:{position:"right",ticks:{color:"#c9ff53",maxTicksLimit:4},grid:{drawOnChartArea:false}}}}});
    if (risk) state.visual.riskChart = new Chart(risk, {type:"bar", data:{labels:["Low","Medium","High"], datasets:[{label:"Flow value", data:["LOW","MEDIUM","HIGH"].map(tier => model.risk_tiers.find(item => item.tier === tier)?.value || 0), backgroundColor:["#71d3df","#f5b971","#ef7070"]}]}, options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}, tooltip:{callbacks:{label:item => formatCurrency(item.raw)}}}, scales:{x:{stacked:true,ticks:{color:"#899a9f"},grid:{display:false}},y:{ticks:{color:"#899a9f",callback:value => `₹${Math.round(value / 1000)}k`},grid:{color:"#233239"}}}}});
  } else {
    drawAggregateFallback($("activity-chart"), model.daily.map(item => item.value), "#71d3df", "Daily transfer value");
    drawAggregateFallback($("risk-flow-chart"), ["LOW", "MEDIUM", "HIGH"].map(tier => model.risk_tiers.find(item => item.tier === tier)?.value || 0), "#ef7070", "Risk-tier flow value");
  }
  const holder = $("relationship-graph");
  if (!holder) return;
  state.visual.cy?.destroy();
  if (!window.cytoscape) { holder.innerHTML = `<p class="empty">Interactive relationship renderer is unavailable. Showing the server-filtered counterparties:</p><div class="node-connections">${model.selected.counterparties.map(item => `<div class="connection-item"><span>${escapeHtml(item.id)}</span><span>${formatCurrency(item.value)} · ${item.count}</span></div>`).join("") || "No matching links."}</div>`; return; }
  const colors = {LOW:"#71d3df", MEDIUM:"#f5b971", HIGH:"#ef7070"};
  const selectedId = model.selected.id;
  const flowById = Object.fromEntries(model.selected.counterparties.map(item => [item.id, item.value]));
  const elements = [
    ...model.relationship_graph.nodes.map(node => ({data:{id:node.id,label:node.id,risk_tier:node.risk_tier,flow:flowById[node.id] || 0,shared:node.shared_device}, classes:`risk-${node.risk_tier.toLowerCase()} ${node.id === selectedId ? "focal" : ""} ${node.shared_device ? "shared-device-node" : ""}`})),
    ...model.relationship_graph.edges.map((edge, index) => ({data:{id:`edge-${index}`,source:edge.source,target:edge.target,label:`${formatCurrency(edge.value)} · ${edge.count} tx`,value:edge.value}, classes:`${edge.source === selectedId ? "flow-out" : edge.target === selectedId ? "flow-in" : "secondary-flow"} ${edge.shared_device ? "shared-device-edge" : ""}`}))
  ];
  state.visual.cy = cytoscape({container:holder, elements, style:[
    {selector:"node",style:{"background-color":node => colors[node.data("risk_tier")] || "#71d3df",label:"data(label)",color:"#e7f0ed","font-size":8,"font-family":"DM Mono","text-valign":"bottom","text-margin-y":6,"text-wrap":"wrap","text-max-width":72,"border-color":"#10181e","border-width":2,width:node => Math.min(36, 20 + Math.sqrt(node.data("flow") || 0) / 20),height:node => Math.min(36, 20 + Math.sqrt(node.data("flow") || 0) / 20)}},
    {selector:".focal",style:{width:46,height:46,"border-color":"#c9ff53","border-width":4,"background-color":"#192a2d","font-size":10,"font-weight":700}},
    {selector:".shared-device-node",style:{"border-color":"#c9ff53","border-width":4,"border-style":"double"}},
    {selector:"edge",style:{width:edge => Math.min(5, 1 + Math.sqrt(edge.data("value") || 0) / 500),"line-color":"#45656a","target-arrow-color":"#45656a","target-arrow-shape":"triangle",label:"data(label)",color:"#b6c5c8","font-size":7,"font-family":"DM Mono","text-background-color":"#10181e","text-background-opacity":.92,"text-background-padding":2,"curve-style":"bezier","text-rotation":"autorotate"}},
    {selector:".flow-out",style:{"line-color":"#71d3df","target-arrow-color":"#71d3df"}},{selector:".flow-in",style:{"line-color":"#f5b971","target-arrow-color":"#f5b971"}},{selector:".secondary-flow",style:{opacity:.42}},{selector:".shared-device-edge",style:{"line-color":"#c9ff53","target-arrow-color":"#c9ff53",width:4}}
  ], layout:{name:"concentric",concentric:node => node.hasClass("focal") ? 2 : 1,levelWidth:() => 1,minNodeSpacing:72,avoidOverlap:true,animate:false,padding:42,startAngle:-Math.PI / 2}});
  state.visual.cy.on("tap", "node", event => selectNetworkNode(event.target.id()));
  const insights = $("relationship-insights");
  if (insights) insights.innerHTML = model.selected.counterparties.slice(0, 3).map(item => `<button type="button" data-network-node="${escapeHtml(item.id)}"><span>${escapeHtml(item.id)}</span><strong>${formatCurrency(item.value)}</strong><small>${item.count} transfers</small></button>`).join("") || '<span>No filtered counterparties.</span>';
}

async function refreshVisualAnalysis() {
  if (!$("visual-summary")) return;
  try {
    const model = await requestJson(`/api/chart-data?${visualQuery().toString()}`);
    if (!state.network.selected && model.selected.id) {
      state.network.selected = model.selected.id;
      renderNetworkList(); renderGraph(); renderNodeDetail(model.selected.id);
    }
    renderVisualAnalysis(model);
    const query = visualQuery().toString();
    $("visual-export-png").href = `/api/chart-data/export?format=png&${query}`;
    $("visual-export-pdf").href = `/api/chart-data/export?format=pdf&${query}`;
  } catch (error) { const summary = $("visual-summary"); if (summary) summary.textContent = `Visual analysis unavailable: ${error.message}`; }
}

function setupVisualAnalysis() {
  $("visual-days")?.addEventListener("change", event => { state.visual.days = Number(event.target.value); state.visual.expand = false; refreshVisualAnalysis(); });
  $("visual-min-amount")?.addEventListener("change", event => { state.visual.minAmount = Number(event.target.value || 0); state.visual.expand = false; refreshVisualAnalysis(); });
  $("visual-rail")?.addEventListener("change", event => { state.visual.rail = event.target.value; state.visual.expand = false; refreshVisualAnalysis(); });
  $("visual-expand")?.addEventListener("click", () => { state.visual.expand = !state.visual.expand; $("visual-expand").textContent = state.visual.expand ? "Return to one hop" : "Expand one more hop"; refreshVisualAnalysis(); });
  const dialog = $("relationship-dialog"), card = $("relationship-card"), dialogContent = $("relationship-dialog-content");
  let cardPlaceholder = null;
  const resizeRelationshipGraph = (fullscreen = false) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const graph = state.visual.cy;
      if (!graph) return;
      graph.resize();
      const spacing = fullscreen ? 120 : 72, padding = fullscreen ? 86 : 36;
      const layout = graph.layout({name:"concentric",concentric:node => node.hasClass("focal") ? 2 : 1,levelWidth:() => 1,minNodeSpacing:spacing,avoidOverlap:true,animate:false,padding,startAngle:-Math.PI / 2});
      const fitGraph = () => { graph.resize(); graph.fit(graph.elements(), padding); };
      layout.one("layoutstop", fitGraph); layout.run();
      // Fullscreen dimensions settle after the browser's fullscreenchange event.
      window.setTimeout(fitGraph, 160);
    }));
  };
  const restoreRelationshipCard = () => {
    if (!cardPlaceholder || !card) return;
    cardPlaceholder.replaceWith(card); cardPlaceholder = null;
    resizeRelationshipGraph();
  };
  const fullscreenButton = $("relationship-fullscreen");
  const updateFullscreenState = () => {
    const isFullscreen = document.fullscreenElement === card;
    if (fullscreenButton) fullscreenButton.textContent = isFullscreen ? "Exit fullscreen" : "Go fullscreen";
    resizeRelationshipGraph(isFullscreen);
  };
  fullscreenButton?.addEventListener("click", async () => {
    if (!card) return;
    if (document.fullscreenElement === card) { await document.exitFullscreen(); return; }
    if (typeof card.requestFullscreen === "function") {
      try { await card.requestFullscreen(); return; } catch (_) { /* Fall back below if the browser declines native fullscreen. */ }
    }
    // Older browsers retain the modal view as a graceful fallback.
    if (!dialog || !dialogContent || dialog.open) return;
    cardPlaceholder = document.createComment("fullscreen relationship graph");
    card.replaceWith(cardPlaceholder); dialogContent.append(card);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else { dialog.setAttribute("open", ""); dialog.classList.add("relationship-dialog-fallback"); }
    resizeRelationshipGraph(true);
  });
  $("relationship-dialog-close")?.addEventListener("click", () => {
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else { dialog.removeAttribute("open"); dialog.classList.remove("relationship-dialog-fallback"); restoreRelationshipCard(); }
  });
  dialog?.addEventListener("close", restoreRelationshipCard);
  document.addEventListener("fullscreenchange", updateFullscreenState);
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
  if (typeof window.loadNodeProvenance === "function") window.loadNodeProvenance(id);
  state.visual.expand = false;
  refreshVisualAnalysis();
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
  state.visual.expand = false;
  refreshVisualAnalysis();
}


/* =========================================================
   NETWORK CONTROLS
   ========================================================= */

function setupNetworkControls() {
  const search = $("network-search");
  if (search) {
    search.addEventListener("input", event => {
      state.network.search = event.target.value;
      state.network.needsRebuild = true;
      renderNetworkList();
      renderGraph();
      refreshVisualAnalysis();
    });
  }

  const risk = $("network-risk-filter");
  if (risk) {
    risk.addEventListener("change", event => {
      state.network.risk = event.target.value;
      state.network.needsRebuild = true;
      renderNetworkList();
      renderGraph();
      state.visual.expand = false;
      refreshVisualAnalysis();
    });
  }

  const hops = $("network-hop-filter");
  if (hops) {
    hops.addEventListener("change", event => {
      state.network.hops = event.target.value;
      state.network.needsRebuild = true;
      renderNetworkList();
      renderGraph();
    });
  }

  const reset = $("network-reset");
  if (reset) {
    reset.addEventListener("click", () => {
      state.network.selected = null;
      state.network.search = "";
      state.network.risk = "ALL";
      state.network.hops = "ALL";
      state.network.egoFocus = false;
      state.network.activeTrace = null;
      state.network.needsRebuild = true;
      $("graph-ego-focus-btn")?.classList.remove("active");
      clearMulePath();

      if (search) search.value = "";
      if (risk) risk.value = "ALL";
      if (hops) hops.value = "ALL";

      renderNetworkList();
      renderGraph();
      renderNodeDetail(null);
      state.visual.expand = false;
      refreshVisualAnalysis();

      if (state.network.cy) {
        state.network.cy.animate({ fit: { eles: state.network.cy.elements(), padding: 40 }, duration: 300 });
      }

      toast("Network view reset.");
    });
  }

  // Graph HUD Zoom Controls
  $("graph-zoom-in")?.addEventListener("click", () => {
    if (state.network.cy) {
      const cy = state.network.cy;
      cy.animate({
        zoom: {
          level: Math.min(cy.zoom() * 1.3, cy.maxZoom()),
          renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
        },
        duration: 200
      });
    }
  });

  $("graph-zoom-out")?.addEventListener("click", () => {
    if (state.network.cy) {
      const cy = state.network.cy;
      cy.animate({
        zoom: {
          level: Math.max(cy.zoom() * 0.75, cy.minZoom()),
          renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 }
        },
        duration: 200
      });
    }
  });

  $("graph-zoom-fit")?.addEventListener("click", () => {
    if (state.network.cy) {
      state.network.cy.animate({
        fit: { eles: state.network.cy.elements(), padding: 45 },
        duration: 350
      });
    }
  });

  $("graph-reset")?.addEventListener("click", () => {
    $("network-reset")?.click();
  });

  // Graph Layout Switchers
  $("graph-layout-cose")?.addEventListener("click", () => setGraphLayout("cose"));
  $("graph-layout-concentric")?.addEventListener("click", () => setGraphLayout("concentric"));
  $("graph-layout-breadthfirst")?.addEventListener("click", () => setGraphLayout("breadthfirst"));

  // Ego Focus Toggle
  $("graph-ego-focus-btn")?.addEventListener("click", () => toggleEgoFocus());

  // Mule Path Tracer Toggle & Form
  $("graph-trace-toggle-btn")?.addEventListener("click", () => toggleMulePathTracer());
  $("path-tracer-close")?.addEventListener("click", () => toggleMulePathTracer());

  $("path-tracer-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const source = $("path-tracer-source")?.value;
    const target = $("path-tracer-target")?.value;
    runMulePathTrace(source, target);
  });

  $("path-tracer-clear")?.addEventListener("click", () => {
    clearMulePath();
    toast("Mule path trace cleared.");
  });

  window.addEventListener("resize", () => {
    state.network.cy?.resize();
  });
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
  refreshVisualAnalysis();
}


/* =========================================================
   EVIDENCE INTEGRITY
   ========================================================= */

function renderIntegrity() {

  const manifest =
    $("manifest");

  const links =
    $("links");
  const custody = $("custody");
  if (custody) custody.innerHTML = state.custody.length ? state.custody.slice().reverse().slice(0, 30).map(item => `<div class="audit-row"><time>${escapeHtml(new Date(item.at_utc).toLocaleString())}</time><strong>${escapeHtml(item.event)} · ${escapeHtml(item.artifact)}</strong></div>`).join("") : '<p class="empty">No custody events recorded yet.</p>';


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

  state.risk_paths = arrayOrEmpty(data.risk_paths);

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

  state.status_updates =
    data.status_updates || {};

  state.assignments = data.assignments || {};
  state.assignees = arrayOrEmpty(data.assignees);
  state.watchlists = data.watchlists || {};
  state.custody = arrayOrEmpty(data.custody);
  state.entity_attributes = data.entity_attributes || {};
  state.analytics = data.analytics || {};
  state.approvals = arrayOrEmpty(data.approvals);
  state.external_requests = arrayOrEmpty(data.external_requests);
  state.entity_tags = data.entity_tags || {};
  state.graph_intelligence = data.graph_intelligence || {};
  state.templates = arrayOrEmpty(data.templates);
  state.collaboration = arrayOrEmpty(data.collaboration);
  state.case_links = arrayOrEmpty(data.case_links);
  state.duplicate_matches = arrayOrEmpty(data.duplicate_matches);
  state.retention = data.retention || {};
  state.saved_searches = arrayOrEmpty(data.saved_searches);
  state.integrations = data.integrations || {};
  state.security_policy = data.security_policy || {};
  state.tasks = arrayOrEmpty(data.tasks);
  state.evidence_annotations = data.evidence_annotations || {};
  state.disclosures = arrayOrEmpty(data.disclosures);
  state.report_schedules = arrayOrEmpty(data.report_schedules);
  state.graph_views = arrayOrEmpty(data.graph_views);
  state.case_narratives = arrayOrEmpty(data.case_narratives);
  state.alert_rules = arrayOrEmpty(data.alert_rules);
  state.merge_reviews = arrayOrEmpty(data.merge_reviews);
  state.graph_annotations = arrayOrEmpty(data.graph_annotations);

  state.audit =
    arrayOrEmpty(
      data.audit
    );

  state.report_available =
    Boolean(
      data.report_available
    );

  // Automatically focus on top threat suspect on initial load
  if (!state.network.selected && state.scores.length > 0) {
    const sortedScores = [...state.scores].sort((a, b) => getScore(b) - getScore(a));
    const topId = getEntityId(sortedScores[0]);
    if (topId) {
      state.network.selected = topId;
    }
  }
}


/* =========================================================
   RENDER EVERYTHING
   ========================================================= */

function render() {

  renderMetrics();

  renderStatus();

  renderRiskDistribution();

  renderModelStatus();

  renderHealth();

  renderTable();

  renderNetwork();

  renderIntegrity();

  renderCasework();


  const brief =
    $("brief-link");

  if (brief) {

    brief.classList.toggle(
      "disabled",
      !state.report_available
    );

    brief.setAttribute("aria-disabled", String(!state.report_available));

  }
}


/* =========================================================
   CASEWORK
   Kept here (rather than in a second script) so it cannot
   overwrite renderTable(), which would remove entity buttons.
   ========================================================= */

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.replace("/login");
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (!response.ok) {
    const detail = body?.detail;
    throw new Error(typeof detail === "string" ? detail : detail?.error || "Request failed.");
  }
  return body;
}

let appInitialized = false;

function renderAuthenticatedUser() {
  const user = state.auth;
  const userLabel = $("auth-user");
  if (userLabel) userLabel.textContent = user ? `${user.username} · ${user.role.toUpperCase()}` : "";
  const supervisor = ["admin", "supervisor"].includes(user?.role);
  $("run-pipeline")?.classList.toggle("disabled", !supervisor);
  if ($("run-pipeline")) $("run-pipeline").disabled = !supervisor;
}

async function authenticateSession() {
  const response = await fetch("/api/auth/me", { cache: "no-store" });
  if (!response.ok) {
    window.location.replace("/login");
    return false;
  }
  state.auth = await response.json();
  if (state.auth.force_password_reset) { window.location.replace("/login"); return false; }
  renderAuthenticatedUser();
  if (!appInitialized) initSETU();
  return true;
}

function setupAuth() {
  const logout = $("logout-button");
  if (logout) logout.addEventListener("click", async () => {
    if (logout.disabled) return;
    logout.disabled = true;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("Logout request was not accepted.");
    } catch (error) {
      console.error("SETU logout error:", error);
      toast("Your local session could not be revoked, but you have been signed out of this page.");
    } finally {
      window.location.replace("/login");
    }
  });
  authenticateSession();
}

function renderCasework() {
  const form = $("case-form");
  if (form) Object.entries(state.case || {}).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value ?? "";
  });

  const reviewNode = $("review-node");
  if (reviewNode) {
    const selected = reviewNode.value;
    const flagged = state.scores.filter(row => getRisk(row) !== "LOW");
    reviewNode.innerHTML = flagged.length
      ? flagged.map(row => {
          const id = getEntityId(row);
          return `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`;
        }).join("")
      : '<option value="">No flagged entity</option>';
    if ([...reviewNode.options].some(option => option.value === selected)) reviewNode.value = selected;
  }

  const statusNode = $("status-node");
  if (statusNode) {
    const selected = statusNode.value;
    const flagged = state.scores.filter(row => getRisk(row) !== "LOW");
    statusNode.innerHTML = flagged.length
      ? flagged.map(row => {
          const id = getEntityId(row);
          return `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`;
        }).join("")
      : '<option value="">No flagged entity</option>';
    if ([...statusNode.options].some(option => option.value === selected)) statusNode.value = selected;
  }

  renderStatusUpdates();
  renderAssignmentAndAnalytics();

  const audit = $("audit");
  if (audit) {
    audit.innerHTML = state.audit.length
      ? state.audit.slice().reverse().map(item => `
          <div class="audit-row">
            <time>${escapeHtml(new Date(item.at_utc).toLocaleString())}</time>
            <strong>${escapeHtml(String(item.event || "").replaceAll("_", " "))}</strong>
          </div>`).join("")
      : '<p class="empty">No operator actions recorded yet.</p>';
  }
}

function renderAssignmentAndAnalytics() {
  const supervisor = ["admin", "supervisor"].includes(state.auth?.role);
  const assignmentPanel = $("assignment-panel"), exportPanel = $("export-panel");
  const approvalPanel = $("approval-panel");
  if (assignmentPanel) assignmentPanel.hidden = !supervisor;
  if (exportPanel) exportPanel.hidden = !supervisor;
  if (approvalPanel) approvalPanel.hidden = !supervisor;
  const assignmentNode = $("assignment-node");
  if (assignmentNode && supervisor) assignmentNode.innerHTML = state.scores.filter(row => getRisk(row) !== "LOW").map(row => `<option value="${escapeHtml(getEntityId(row))}">${escapeHtml(getEntityId(row))}</option>`).join("");
  const assignmentAssignee = $("assignment-assignee");
  if (assignmentAssignee && supervisor) {
    const selected = assignmentAssignee.value;
    assignmentAssignee.innerHTML = state.assignees.length
      ? state.assignees.map(account => `<option value="${escapeHtml(account.username)}">${escapeHtml(account.username)} · ${escapeHtml(account.role)}</option>`).join("")
      : '<option value="">No active accounts available</option>';
    if ([...assignmentAssignee.options].some(option => option.value === selected)) assignmentAssignee.value = selected;
  }
  const tagNode = $("tag-node");
  if (tagNode) tagNode.innerHTML = state.scores.filter(row => getRisk(row) !== "LOW").map(row => `<option value="${escapeHtml(getEntityId(row))}">${escapeHtml(getEntityId(row))}</option>`).join("");
  const watched = arrayOrEmpty(state.watchlists?.[String(state.auth?.id)]);
  const watchlist = $("watchlist");
  if (watchlist) watchlist.innerHTML = watched.length ? watched.map(node => `<div class="watch-item"><span>${escapeHtml(node)}</span><button class="small-action" data-watch-entity="${escapeHtml(node)}">Unwatch</button></div>`).join("") : '<p class="empty">No entities are being monitored.</p>';
  const analytics = $("analytics"), value = state.analytics || {};
  if (analytics) analytics.innerHTML = [
    ["Escalation rate", `${value.escalation_rate || 0}%`],
    ["Avg. resolution", value.average_resolution_hours == null ? "—" : `${value.average_resolution_hours}h`],
    ["Resolved", value.by_status?.resolved || 0],
    ["Active workload", Object.values(value.workload || {}).reduce((sum, count) => sum + count, 0)],
    ["SLA overdue", value.sla?.overdue || 0],
    ["Due today", value.sla?.due_today || 0]
  ].map(([label, amount]) => `<div class="analytics-stat"><span>${label}</span><strong>${amount}</strong></div>`).join("") + Object.entries(value.workload || {}).map(([name, count]) => `<div class="workload-row"><span>${escapeHtml(name)}</span><strong>${count} assigned</strong></div>`).join("");
  const approvalList = $("approval-list");
  if (approvalList && supervisor) {
    const pending = state.approvals.filter(item => item.status === "pending");
    approvalList.innerHTML = pending.length ? pending.map(item => `<div class="approval-row"><strong>${escapeHtml(item.node)} · ${escapeHtml(item.action.replaceAll("_", " "))}</strong><p>${escapeHtml(item.message)}</p><small>Requested by ${escapeHtml(item.requested_by)} · ${escapeHtml(new Date(item.requested_at_utc).toLocaleString())}</small><div><button class="small-action" data-approval-id="${escapeHtml(item.id)}" data-approval-decision="approved">Approve</button><button class="small-action" data-approval-id="${escapeHtml(item.id)}" data-approval-decision="rejected">Reject</button></div></div>`).join("") : '<p class="empty">No pending escalation or closure requests.</p>';
  }
  const requestList = $("external-request-list");
  if (requestList) requestList.innerHTML = state.external_requests.length ? state.external_requests.map(item => `<div class="request-row"><strong>${escapeHtml(item.request_type.replaceAll("_", " "))} · ${escapeHtml(item.recipient)}</strong><span class="entity-status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span><p>${escapeHtml(item.subject)}${item.entity ? ` · ${escapeHtml(item.entity)}` : ""}</p><small>${escapeHtml(item.owner)} · due ${escapeHtml(item.due_date || "not set")} · ${escapeHtml(item.reference || item.id)}</small><div><button class="small-action" data-request-id="${escapeHtml(item.id)}" data-request-status="sent">Mark sent</button><button class="small-action" data-request-id="${escapeHtml(item.id)}" data-request-status="responded">Record response</button><button class="small-action" data-request-id="${escapeHtml(item.id)}" data-request-status="closed">Close</button></div></div>`).join("") : '<p class="empty">No external requests recorded.</p>';
}

async function refreshNotifications() {
  try {
    state.notifications = await requestJson("/api/notifications");
    const count = $("notification-count"); if (count) count.textContent = state.notifications.length;
    const list = $("notification-list"); if (list) list.innerHTML = state.notifications.length ? state.notifications.map(item => {
      const type = String(item.type || "notice").replace(/[^a-z_]/g, "");
      const label = type.replaceAll("_", " ") || "case alert";
      return `<article class="notification-row ${escapeHtml(type)}"><div class="notification-icon" aria-hidden="true">!</div><div class="notification-copy"><div class="notification-meta"><span>${escapeHtml(label)}</span><time>${item.at ? escapeHtml(new Date(item.at).toLocaleString()) : "New"}</time></div><strong>${escapeHtml(item.node || "Case")}</strong><p>${escapeHtml(item.message)}</p></div></article>`;
    }).join("") : '<p class="empty">No new operational alerts.</p>';
  } catch (error) { console.warn("SETU notification error", error); }
}

function renderStatusUpdates() {
  const container = $("status-updates");
  if (!container) return;
  const updates = Object.values(state.status_updates || {}).flat()
    .sort((a, b) => String(b.updated_at_utc).localeCompare(String(a.updated_at_utc)));
  container.innerHTML = updates.length
    ? updates.slice(0, 20).map(update => `
        <article class="status-update-row">
          <div><span class="entity-status ${escapeHtml(update.status)}">${escapeHtml(String(update.status).replaceAll("_", " "))}</span><strong>${escapeHtml(update.node)}</strong></div>
          <p>${escapeHtml(update.message)}</p>
          <small>${escapeHtml(update.author)} · ${escapeHtml(new Date(update.updated_at_utc).toLocaleString())}</small>
        </article>`).join("")
    : '<p class="empty">No progress updates posted for flagged entities yet.</p>';
}

function setupCasework() {
  const assignmentDueDate = $("assignment-due-date");
  if (assignmentDueDate) {
    assignmentDueDate.addEventListener("click", () => {
      // Chromium-based browsers expose showPicker(); other browsers retain
      // their standard date-input calendar behavior.
      try { assignmentDueDate.showPicker?.(); } catch (_) { /* native picker is already handling the click */ }
    });
  }

  const bind = (id, handler) => {
    const form = $(id);
    if (form) form.addEventListener("submit", handler);
  };

  bind("case-form", async event => {
    event.preventDefault();
    try {
      await requestJson("/api/case", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      await load(); toast("Case registration saved and audited.");
    } catch (error) { toast(error.message); }
  });

  bind("evidence-form", async event => {
    event.preventDefault();
    try {
      const result = await requestJson("/api/evidence", { method: "POST", body: new FormData(event.currentTarget) });
      event.currentTarget.reset(); await load(); toast(result.message || "Evidence staged.");
    } catch (error) { toast(error.message); }
  });

  bind("note-form", async event => {
    event.preventDefault();
    try {
      await requestJson("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      event.currentTarget.reset(); await load(); toast("Case note saved to the audit trail.");
    } catch (error) { toast(error.message); }
  });

  bind("review-form", async event => {
    event.preventDefault();
    try {
      await requestJson("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      await load(); toast("Human review recorded.");
    } catch (error) { toast(error.message); }
  });

  bind("status-update-form", async event => {
    event.preventDefault();
    try {
      const result = await requestJson("/api/status-updates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      event.currentTarget.elements.message.value = "";
      await load(); toast(result.requires_approval ? "Supervisor approval requested." : "Entity status update posted.");
    } catch (error) { toast(error.message); }
  });

  bind("assignment-form", async event => {
    event.preventDefault();
    try {
      const saved = await requestJson("/api/assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      // Reflect the confirmed assignment immediately; load() then refreshes the
      // rest of the case data without making the operator refresh the page.
      state.assignments = { ...state.assignments, [saved.node]: saved };
      render();
      await load();
      toast("Entity assignment saved.");
    } catch (error) { toast(error.message); }
  });
  bind("external-request-form", async event => {
    event.preventDefault();
    try { await requestJson("/api/external-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); event.currentTarget.reset(); await load(); toast("External request created."); } catch (error) { toast(error.message); }
  });
  bind("entity-tag-form", async event => {
    event.preventDefault();
    try { await requestJson("/api/entity-tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); event.currentTarget.elements.note.value = ""; await load(); toast("Entity tag applied."); } catch (error) { toast(error.message); }
  });
  ["status-filter", "assignment-filter", "amount-min", "date-from", "date-to", "device-filter", "upi-filter", "phone-filter"].forEach(id => $(id)?.addEventListener("input", renderTable));
  ["status-filter", "assignment-filter", "tag-filter"].forEach(id => $(id)?.addEventListener("change", renderTable));
  $("notifications-button")?.addEventListener("click", async () => { await refreshNotifications(); $("notification-center").hidden = false; });
  $("notifications-close")?.addEventListener("click", () => { $("notification-center").hidden = true; });

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
    await refreshNotifications();


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
        if (state.network.cy) {
          state.network.cy.resize();
        }
      },
      50
    );
  }


  if (target === "integrity") {
    requestJson("/api/evidence-chain").then(items => { state.custody = arrayOrEmpty(items); renderIntegrity(); }).catch(() => renderIntegrity());

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

      const disabledBrief = event.target.closest("#brief-link.disabled");
      if (disabledBrief) {
        event.preventDefault();
        toast("Run the investigation before downloading its brief.");
        return;
      }

      const approvalButton = event.target.closest("[data-approval-id]");
      if (approvalButton) {
        event.preventDefault();
        const rationale = window.prompt(`Reason for ${approvalButton.dataset.approvalDecision}:`);
        if (!rationale || rationale.trim().length < 2) { toast("A brief decision reason is required."); return; }
        requestJson(`/api/approvals/${encodeURIComponent(approvalButton.dataset.approvalId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: approvalButton.dataset.approvalDecision, rationale: rationale.trim() }) })
          .then(() => load()).then(() => toast("Approval decision recorded.")).catch(error => toast(error.message));
        return;
      }

      const requestButton = event.target.closest("[data-request-id]");
      if (requestButton) {
        event.preventDefault();
        const status = requestButton.dataset.requestStatus;
        const responseNote = status === "responded" ? (window.prompt("Response received or next step:") || "") : "";
        if (status === "responded" && responseNote.trim().length < 2) { toast("Record a brief response note."); return; }
        requestJson(`/api/external-requests/${encodeURIComponent(requestButton.dataset.requestId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, response_note: responseNote.trim() }) })
          .then(() => load()).then(() => toast("External request updated.")).catch(error => toast(error.message));
        return;
      }

      const watchButton = event.target.closest("[data-watch-entity]");
      if (watchButton) {
        event.preventDefault();
        requestJson("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ node: watchButton.getAttribute("data-watch-entity") }) })
          .then(() => load()).then(() => toast("Watchlist updated.")).catch(error => toast(error.message));
        return;
      }


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

      const focusEgo = event.target.closest("[data-focus-ego-network]");
      if (focusEgo) {
        event.preventDefault();
        const entity = focusEgo.getAttribute("data-focus-ego-network");
        if (state.network.selected !== entity) {
          selectNetworkNode(entity);
        }
        state.network.egoFocus = true;
        $("graph-ego-focus-btn")?.classList.add("active");
        state.network.needsRebuild = true;
        renderGraph();
        return;
      }

      const traceNode = event.target.closest("[data-trace-from-node]");
      if (traceNode) {
        event.preventDefault();
        const entity = traceNode.getAttribute("data-trace-from-node");
        openMulePathTracerWithSource(entity);
        return;
      }

      const graphOperations = event.target.closest("[data-open-graph-operations]");
      if (graphOperations) {
        event.preventDefault();
        const source = graphOperations.getAttribute("data-open-graph-operations");
        document.querySelector('[data-view="operations"]')?.click();
        const sourceInput = document.querySelector('#graph-trace-form [name="source"]');
        if (sourceInput) sourceInput.value = source;
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


        toast("Pipeline finished — updating investigation models…");
        await new Promise(resolve => setTimeout(resolve, 25));
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

  if (appInitialized) return;
  appInitialized = true;

  console.log(
    "SETU: Initializing investigation workspace..."
  );


  setupTabs();

  setupRiskFilters();

  setupEntitySearch();

  setupNetworkControls();

  setupVisualAnalysis();

  setupGlobalClicks();

  setupPipeline();

  setupCasework();

  initialiseFilterSelects();

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
    setupAuth
  );

} else {

  setupAuth();

}
