/* Evidence desk, case board, and unified timeline.  These are views over the
   same audited case record; none of the client-side summaries are findings. */
(() => {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
  const post = async (url, body) => {
    const response = await fetch(url, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Request failed");
    return data;
  };
  const time = item => item.at || item.at_utc || item.updated_at_utc || item.created_at_utc || item.timestamp || "";
  const taskStatus = task => task.status || "open";

  function timelineItems() {
    const items = [];
    (state.custody || []).forEach(x => items.push({kind:"evidence", at:time(x), title:`Evidence ${x.action || "event"}: ${x.artifact || "artifact"}`, detail:x.source || x.artifact_type || "Chain of custody"}));
    (state.edges || []).forEach(x => items.push({kind:"transaction", at:time(x), title:`${x.sender} → ${x.receiver}`, detail:`₹${Number(x.amount || 0).toLocaleString("en-IN")} · ${x.rail || "payment transfer"}`}));
    (state.notes || []).forEach(x => items.push({kind:"case", at:time(x), title:"Case note", detail:x.text}));
    Object.values(state.status_updates || {}).flat().forEach(x => items.push({kind:"case", at:time(x), title:`Entity ${x.status}`, detail:`${x.node}: ${x.message}`}));
    (state.external_requests || []).forEach(x => items.push({kind:"case", at:time(x), title:`Evidence request: ${x.subject}`, detail:`${x.recipient} · ${x.status}`}));
    (state.tasks || []).forEach(x => items.push({kind:"case", at:time(x), title:`Task ${taskStatus(x)}: ${x.text}`, detail:x.assignee ? `Owner: ${x.assignee}` : "Unassigned"}));
    (state.audit || []).forEach(x => items.push({kind:"case", at:time(x), title:x.event?.replaceAll("_", " ") || "Audited action", detail:"Recorded in the case audit log"}));
    return items.filter(x => x.at).sort((a,b) => String(b.at).localeCompare(String(a.at)));
  }

  function renderEvidence() {
    const target = byId("evidence-artifacts"); if (!target) return;
    const artifacts = Object.keys(state.manifest || {});
    target.innerHTML = artifacts.length ? artifacts.map(name => `<button class="artifact-chip" data-preview-artifact="${esc(name)}">${esc(name)}<small>${esc(state.manifest[name].size_bytes || "")} bytes</small></button>`).join("") : "<span class='empty'>Run the pipeline or upload evidence to populate this workspace.</span>";
  }
  function renderBoard() {
    const host = byId("task-board"), dependency = byId("task-dependency"); if (!host) return;
    if (dependency) dependency.innerHTML = `<option value="">No dependency</option>${(state.tasks || []).map(t => `<option value="${esc(t.id)}">${esc(t.id)} · ${esc(t.text.slice(0,40))}</option>`).join("")}`;
    const lanes = [["open","To do"],["in_progress","In progress"],["blocked","Blocked"],["done","Done"]];
    host.innerHTML = lanes.map(([key, label]) => `<section class="kanban-lane"><h4>${label}<span>${(state.tasks || []).filter(t => taskStatus(t) === key).length}</span></h4>${(state.tasks || []).filter(t => taskStatus(t) === key).map(t => { const overdue = t.due_date && t.due_date < new Date().toISOString().slice(0,10) && key !== "done"; return `<article class="task-card ${overdue ? "overdue" : ""}"><strong>${esc(t.text)}</strong><small>${esc(t.assignee || "Unassigned")} · ${esc(t.priority || "normal")}${t.due_date ? ` · due ${esc(t.due_date)}` : ""}</small>${t.depends_on ? `<small>Depends on ${esc(t.depends_on)}</small>` : ""}<div><button data-task-status="${esc(t.id)}" data-status="in_progress">Start</button><button data-task-status="${esc(t.id)}" data-status="done">Done</button></div></article>`; }).join("") || "<p class='empty'>No tasks</p>"}</section>`).join("");
  }
  function renderTimeline() {
    const host = byId("unified-timeline"); if (!host) return;
    const filter = byId("timeline-kind")?.value || "ALL";
    const rows = timelineItems().filter(x => filter === "ALL" || x.kind === filter).slice(0,120);
    host.innerHTML = rows.length ? rows.map(x => `<article class="timeline-event ${x.kind}"><time>${esc(new Date(x.at).toLocaleString())}</time><div><span>${esc(x.kind)}</span><strong>${esc(x.title)}</strong><p>${esc(x.detail)}</p></div></article>`).join("") : "<p class='empty'>No timeline activity matches this filter.</p>";
  }
  function renderReporting() {
    const host = byId("reporting-summary"); if (!host) return;
    const a = state.analytics || {}, sla = a.sla || {}, typologies = Object.entries(a.typologies || {}).sort((x,y) => y[1]-x[1]).slice(0,3);
    host.innerHTML = `<div><span>Overdue SLA</span><strong>${sla.overdue || 0}</strong></div><div><span>Open workload</span><strong>${(state.tasks || []).filter(t => taskStatus(t) !== "done").length}</strong></div><div><span>Top typologies</span><strong>${typologies.map(x => `${esc(x[0])} (${x[1]})`).join(", ") || "—"}</strong></div>`;
    const schedules = byId("scheduled-reports"); if (schedules) schedules.innerHTML = (state.report_schedules || []).map(x => `<div class="ops-row"><strong>${esc(x.cadence)} report → ${esc(x.recipient)}</strong><small>Enabled · ${esc(x.id)}</small></div>`).join("") || "No scheduled reports.";
    const disclosures = byId("disclosure-list"); if (disclosures) disclosures.innerHTML = (state.disclosures || []).map(x => `<div class="ops-row"><strong>${esc(x.recipient)} · ${esc(x.status)}</strong><small>${esc(x.authority_reference)} · ${esc(x.scope)}</small></div>`).join("") || "No disclosure bundles prepared.";
  }
  function renderWorkspace() { renderEvidence(); renderBoard(); renderTimeline(); renderReporting(); }
  const prior = window.render;
  window.render = function () { prior(); renderWorkspace(); };

  document.addEventListener("click", async event => {
    const artifact = event.target.closest("[data-preview-artifact]");
    const task = event.target.closest("[data-task-status]");
    try {
      if (artifact) {
        const name = artifact.dataset.previewArtifact, result = await fetch(`/api/evidence-preview/${encodeURIComponent(name)}`).then(r => r.ok ? r.json() : Promise.reject(new Error("Preview unavailable")));
        byId("annotation-artifact").value = name;
        const annotations = new Map((result.annotations || []).map(a => [String(a.row), a]));
        byId("evidence-preview").innerHTML = `<div class="preview-heading"><strong>${esc(name)}</strong><a class="outline" href="/api/evidence-export/${encodeURIComponent(name)}">Export redacted CSV</a></div><div class="preview-scroll"><table><thead><tr><th>#</th>${result.columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${result.rows.map((row,i) => `<tr class="${annotations.has(String(i+1)) ? "annotated" : ""}" data-record-row="${i+1}"><td>${i+1}</td>${result.columns.map(c => `<td>${esc(row[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="hint">Click a row to set it for annotation. ${annotations.size} annotation(s) on this artifact.</p>`;
      }
      const row = event.target.closest("[data-record-row]"); if (row) byId("evidence-annotation-form").elements.row.value = row.dataset.recordRow;
      if (task) { await post(`/api/tasks/${encodeURIComponent(task.dataset.taskStatus)}`, {status:task.dataset.status, note:"Updated from investigation board."}); await load(); toast("Task updated."); }
    } catch (error) { toast(error.message); }
  });
  byId("evidence-annotation-form")?.addEventListener("submit", async e => { e.preventDefault(); try { await post("/api/evidence-annotations", Object.fromEntries(new FormData(e.currentTarget))); await load(); toast("Evidence annotation saved."); } catch (error) { toast(error.message); } });
  byId("board-task-form")?.addEventListener("submit", async e => { e.preventDefault(); try { await post("/api/board-tasks", Object.fromEntries(new FormData(e.currentTarget))); e.currentTarget.reset(); await load(); toast("Task added to the board."); } catch (error) { toast(error.message); } });
  byId("report-schedule-form")?.addEventListener("submit", async e => { e.preventDefault(); try { await post("/api/report-schedules", Object.fromEntries(new FormData(e.currentTarget))); e.currentTarget.reset(); await load(); toast("Supervisor report scheduled."); } catch (error) { toast(error.message); } });
  byId("disclosure-form")?.addEventListener("submit", async e => { e.preventDefault(); try { await post("/api/disclosures", Object.fromEntries(new FormData(e.currentTarget))); e.currentTarget.reset(); await load(); toast("Disclosure record prepared."); } catch (error) { toast(error.message); } });
  byId("timeline-kind")?.addEventListener("change", renderTimeline);
  byId("timeline-export")?.addEventListener("click", () => window.print());
})();
