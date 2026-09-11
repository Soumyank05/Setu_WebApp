function message(text = "") {
  document.getElementById("auth-message").textContent = text;
}

function serviceState(text, problem = false) {
  const state = document.getElementById("auth-service-state");
  state.textContent = text;
  state.classList.toggle("problem", problem);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Request failed.");
  return body;
}

async function submitAuth(url, form) {
  message("");
  return requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(form)))
  });
}

async function initialiseLogin() {
  const login = document.getElementById("login-form");
  login.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const user = await submitAuth("/api/auth/login", login);
      if (user.force_password_reset) {
        login.hidden = true;
        document.getElementById("password-reset-form").hidden = false;
        message("A password change is required before you can enter the workspace.");
      } else window.location.replace("/");
    } catch (error) { message(error.message); }
  });
  document.getElementById("password-reset-form").addEventListener("submit", async event => {
    event.preventDefault();
    try { await submitAuth("/api/auth/change-password", event.currentTarget); window.location.replace("/"); } catch (error) { message(error.message); }
  });
  try {
    const status = await requestJson("/api/auth/setup-status");
    serviceState("Authentication service connected");
    const me = await fetch("/api/auth/me", { cache: "no-store" });
    if (me.ok) {
      const user = await me.json();
      if (user.force_password_reset) { login.hidden = true; document.getElementById("password-reset-form").hidden = false; message("A password change is required before you can enter the workspace."); return; }
      window.location.replace("/"); return;
    }
    if (!status.has_users) message("No user IDs are provisioned. An administrator must create one from the terminal.");
  } catch (_) {
    serviceState("Authentication service unavailable", true);
    message("Open SETU through its web server (for example, http://127.0.0.1:8000/login), then reload this page.");
  }
}

initialiseLogin();
