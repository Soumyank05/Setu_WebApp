/* Investigation workflows layered over the core graph workspace. */
(() => {
  const byId = id => document.getElementById(id);
  const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[char]));
  const post = async (url, body) => {
    const response = await fetch(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Request failed");
    return data;
  };
  const renderList = (id, rows, row) => { const target = byId(id); if (target) target.innerHTML = rows?.length ? rows.map(row).join("") : "<span>No records yet.</span>"; };

  window.loadNodeProvenance = async entity => {
    const target = byId("node-provenance");
    if (!target) return;
    try {
      const response = await fetch(`/api/entities/${encodeURIComponent(entity)}/traceability`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Traceability unavailable");
      target.classList.remove("provenance-loading");
      target.innerHTML = `<span class="eyebrow">EVIDENCE TRACEABILITY</span><div class="provenance-summary"><strong>${data.csv_rows.length} source row(s)</strong> · ${data.documents.length} artifact(s) · ${data.device_ids.length} device ID(s)</div><details><summary>CSV rows, documents & notes</summary><div class="provenance-items">${data.csv_rows.slice(0, 6).map(item => `<div><b>${safe(item.artifact)} · row ${item.row}</b><small>${safe(Object.entries(item.fields).slice(0,4).map(([key,value]) => `${key}: ${value}`).join(" · "))}</small></div>`).join("") || "<small>No matched CSV row.</small>"}${data.documents.slice(0, 4).map(item => `<div><b>${safe(item.artifact)}</b><small>SHA-256 ${safe(item.sha256).slice(0, 16)}…</small></div>`).join("")}${data.device_ids.map(id => `<div><b>Device ID</b><small>${safe(id)}</small></div>`).join("")}${data.notes.slice(0, 4).map(note => `<div><b>Note</b><small>${safe(note.note || note.text || note.target || "")}</small></div>`).join("")}</div></details>`;
    } catch (error) { target.innerHTML = `<span class="eyebrow">EVIDENCE TRACEABILITY</span><p class="empty">${safe(error.message)}</p>`; }
  };

  const previousRender = window.render;
  window.render = function () {
    previousRender();
    renderList("graph-view-list", state.graph_views, item => `<div class="ops-row"><strong>${safe(item.name)}${item.shared ? " · shared" : ""}</strong><small>${safe(item.entity || "All entities")} · ${item.days}d · ${safe(item.risk)} · ${safe(item.rail)} · min ₹${safe(item.min_amount)}</small><button class="small-action" data-load-graph-view="${safe(item.id)}">Load view</button></div>`);
    renderList("narrative-list", state.case_narratives, item => `<div class="ops-row"><strong>${safe(item.title)}</strong><small>${safe(item.summary)} · ${safe(item.author)}</small><small>${(item.findings || []).length} findings · ${(item.charts || []).join(", ") || "no charts"}</small></div>`);
    renderList("alert-rule-list", state.alert_rules, item => `<div class="ops-row"><strong>${safe(item.name)} · ${item.enabled ? "active" : "paused"}</strong><small>${safe(item.entity || "case-wide")} · ${[item.new_evidence && "new evidence", item.value_threshold && `≥ ₹${item.min_amount}`, item.high_risk_cluster && "high-risk cluster"].filter(Boolean).join(" · ") || "risk trigger"}</small></div>`);
    renderList("graph-annotation-list", state.graph_annotations, item => `<div class="ops-row"><strong>${safe(item.disposition)} · ${safe(item.target)}</strong><small>${item.suspected_mule ? "Suspected mule · " : ""}${safe(item.note)} — ${safe(item.author)}</small></div>`);
    renderList("merge-review-list", state.merge_reviews, item => `<div class="ops-row"><strong>${safe(item.entity)} ↔ ${safe(item.matched_entity)}</strong><small>${safe(item.confidence)} confidence · ${safe(item.decision)} · ${safe(item.reviewed_by)}</small><small>${safe(item.rationale)}</small></div>`);
  };

  byId("graph-trace-form")?.addEventListener("submit", async event => {
    event.preventDefault(); event.stopImmediatePropagation();
    try {
      const result = await post("/api/graph/paths", Object.fromEntries(new FormData(event.currentTarget)));
      byId("graph-trace-result").innerHTML = result.routes.length ? result.routes.map(route => `<div class="ops-row route-result"><strong>#${route.rank} · ${safe(route.nodes.join(" → "))}</strong><small>Transferable value ₹${safe(route.bottleneck_value)} · total ₹${safe(route.value)} · ${route.hops} hop${route.hops === 1 ? "" : "s"} · ${safe(route.risk)} risk</small></div>`).join("") : "No directed transfer route found between those entities.";
    } catch (error) { toast(error.message); }
  }, true);

  byId("graph-view-form")?.addEventListener("submit", async event => { event.preventDefault(); try {
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    Object.assign(values, {entity: values.entity || state.network.selected || "", days: Number(state.visual.days || 30), risk: state.network.risk || "ALL", rail: state.visual.rail || "ALL", min_amount: Number(state.visual.minAmount || 0), expand: Boolean(state.visual.expand), shared: form.elements.shared.checked});
    await post("/api/graph-views", values); form.reset(); await load(); toast("Graph view saved.");
  } catch (error) { toast(error.message); }});

  byId("narrative-form")?.addEventListener("submit", async event => { event.preventDefault(); try {
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    values.findings = values.findings ? values.findings.split(",").map(item => item.trim()).filter(Boolean) : [];
    values.charts = form.elements.include_graph.checked ? ["selected relationship graph", "route table"] : [];
    values.annotations = form.elements.include_annotations.checked ? (state.graph_annotations || []).map(item => item.id) : [];
    delete values.include_graph; delete values.include_annotations;
    await post("/api/case-narratives", values); form.reset(); await load(); toast("Finding added to narrative brief.");
  } catch (error) { toast(error.message); }});

  byId("alert-rule-form")?.addEventListener("submit", async event => { event.preventDefault(); try {
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    ["new_evidence", "value_threshold", "high_risk_cluster"].forEach(key => values[key] = form.elements[key].checked);
    values.min_amount = Number(values.min_amount || 0); await post("/api/alert-rules", values); form.reset(); await load(); toast("Alert rule activated.");
  } catch (error) { toast(error.message); }});

  byId("graph-annotation-form")?.addEventListener("submit", async event => { event.preventDefault(); try {
    const form = event.currentTarget, values = Object.fromEntries(new FormData(form)); values.suspected_mule = form.elements.suspected_mule.checked;
    await post("/api/graph-annotations", values); form.reset(); await load(); toast("Annotation pinned to graph.");
  } catch (error) { toast(error.message); }});

  byId("merge-review-form")?.addEventListener("submit", async event => { event.preventDefault(); try {
    await post("/api/merge-reviews", Object.fromEntries(new FormData(event.currentTarget))); event.currentTarget.reset(); await load(); toast("Merge review recorded in audit history.");
  } catch (error) { toast(error.message); }});

  byId("investigation-export-form")?.addEventListener("submit", event => { event.preventDefault(); const caption = event.currentTarget.elements.caption.value; const params = new URLSearchParams({days: state.visual.days || 30, risk: state.network.risk || "ALL", rail: state.visual.rail || "ALL", min_amount: state.visual.minAmount || 0, entity: state.network.selected || "", caption}); window.location.assign(`/api/investigation-export?${params}`); });

  document.addEventListener("click", event => { const button = event.target.closest("[data-load-graph-view]"); if (!button) return; const view = (state.graph_views || []).find(item => item.id === button.dataset.loadGraphView); if (!view) return; state.network.selected = view.entity || null; state.visual.days = view.days; state.network.risk = view.risk; state.visual.rail = view.rail; state.visual.minAmount = view.min_amount; state.visual.expand = view.expand; ["visual-days", "visual-rail", "visual-min-amount"].forEach(id => { const control = byId(id); if (control) control.value = id === "visual-days" ? view.days : id === "visual-rail" ? view.rail : view.min_amount; }); document.querySelector('[data-view="network"]')?.click(); refreshVisualAnalysis(); renderNetwork(); toast(`Loaded ${view.name}.`); });

  let timer = null, cursor = 0, rows = [];
  const resetPlayback = () => { clearInterval(timer); timer = null; cursor = 0; rows.forEach(row => row.classList.remove("playing")); const progress = byId("timeline-progress"); if (progress) progress.textContent = ""; };
  const startPlayback = () => { rows = [...document.querySelectorAll("[data-timeline-index]")].filter(row => { const timestamp = row.dataset.timestamp || ""; const from = byId("playback-from")?.value, to = byId("playback-to")?.value; return (!from || timestamp >= from) && (!to || timestamp <= `${to}T99`); }); if (!rows.length) return toast("No transfers match the playback date range."); clearInterval(timer); const step = () => { rows.forEach(row => row.classList.remove("playing")); if (cursor >= rows.length) return resetPlayback(); rows[cursor].classList.add("playing"); rows[cursor].scrollIntoView({block:"nearest"}); byId("timeline-progress").textContent = `${cursor + 1}/${rows.length}`; const pauseAt = Number(byId("playback-pause")?.value || 0); cursor += 1; if (pauseAt && cursor === pauseAt) { clearInterval(timer); timer = null; toast(`Paused at transfer ${pauseAt}.`); }}; step(); timer = setInterval(step, Number(byId("playback-speed")?.value || 650)); };
  byId("timeline-play")?.addEventListener("click", () => timer ? null : startPlayback());
  byId("timeline-pause")?.addEventListener("click", () => { clearInterval(timer); timer = null; });
  byId("timeline-stop")?.addEventListener("click", resetPlayback);
})();
