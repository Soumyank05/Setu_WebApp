/* Additional local case-management controls. All findings require human review. */
const api = async (url, options = {}) => {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail?.error || body.detail || "Request failed");
  return body;
};

const originalRender = render;
render = function () {
  originalRender();
  const caseInfo = state.case || {};
  const form = document.getElementById("case-form");
  if (form) Object.entries(caseInfo).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
  const select = document.getElementById("review-node");
  if (select) select.innerHTML = state.scores.filter(item => item.risk_tier !== "LOW").map(item => `<option value="${item.node}">${item.node}</option>`).join("") || "<option>No flagged entity</option>";
  const audit = document.getElementById("audit");
  if (audit) audit.innerHTML = (state.audit || []).length ? state.audit.slice().reverse().map(item => `<div class="audit-row"><time>${new Date(item.at_utc).toLocaleString()}</time><strong>${item.event.replaceAll("_", " ")}</strong></div>`).join("") : '<p class="empty">No operator actions recorded yet.</p>';
};

renderTable = function () {
  const query = document.getElementById("entity-search").value.toLowerCase();
  const rows = state.scores.filter(row => (activeTier === "ALL" || row.risk_tier === activeTier) && String(row.node).toLowerCase().includes(query) && row.risk_tier !== "LOW");
  document.getElementById("risk-table").innerHTML = rows.length ? rows.map(row => {
    const review = (state.reviews || {})[String(row.node)];
    const status = review ? `${review.disposition} · ${review.reviewer}` : "Awaiting human review";
    return `<tr><td class="mono">${row.node}</td><td class="score">${row.risk_score}<small>/100</small></td><td><span class="pill ${row.risk_tier}">${row.risk_tier}</span></td><td class="signals">${reasons(row)}</td><td class="review-status">${status}</td></tr>`;
  }).join("") : '<tr><td colspan="5" class="empty">No matching priority entities.</td></tr>';
};

document.getElementById("case-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    await api("/api/case", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await load(); toast("Case registration saved and audited.");
  } catch (error) { toast(error.message); }
});
document.getElementById("evidence-form").addEventListener("submit", async event => {
  event.preventDefault();
  try { const result = await api("/api/evidence", { method: "POST", body: new FormData(event.currentTarget) }); event.currentTarget.reset(); toast(result.message); await load(); } catch (error) { toast(error.message); }
});
document.getElementById("note-form").addEventListener("submit", async event => {
  event.preventDefault();
  try { await api("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); event.currentTarget.reset(); await load(); toast("Case note saved to the audit trail."); } catch (error) { toast(error.message); }
});
document.getElementById("review-form").addEventListener("submit", async event => {
  event.preventDefault();
  try { await api("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await load(); toast("Human review recorded."); } catch (error) { toast(error.message); }
});
