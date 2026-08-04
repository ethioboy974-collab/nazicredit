(() => {
  if (window.location.pathname === "/login") return;
  const LOGOUT_AFTER = 10 * 60 * 1000;
  const WARN_AFTER = 9 * 60 * 1000;
  let lastActivity = Date.now();
  let warning;

  const reset = () => {
    lastActivity = Date.now();
    if (warning) warning.hidden = true;
  };

  function ensureWarning() {
    if (warning) return warning;
    warning = document.createElement("div");
    warning.hidden = true;
    warning.setAttribute("role", "dialog");
    warning.setAttribute("aria-modal", "true");
    warning.innerHTML = `
      <div class="session-warning-card">
        <h2>Still working?</h2>
        <p>You will be signed out in one minute because there has been no activity.</p>
        <button type="button">Continue and stay signed in</button>
      </div>`;
    const style = document.createElement("style");
    style.textContent = `
      .session-warning{position:fixed;inset:0;z-index:9999;background:#0f172a99;display:grid;place-items:center;padding:20px}
      .session-warning[hidden]{display:none}.session-warning-card{background:#fff;border-radius:14px;box-shadow:0 24px 70px #0004;max-width:440px;padding:26px;width:100%;color:#1f2933}
      .session-warning-card h2{margin:0 0 8px}.session-warning-card button{background:#0f766e;border:0;border-radius:9px;color:#fff;font:inherit;font-weight:900;min-height:50px;padding:0 16px;width:100%}`;
    warning.className = "session-warning";
    warning.querySelector("button").addEventListener("click", reset);
    document.head.appendChild(style);
    document.body.appendChild(warning);
    return warning;
  }

  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((name) => {
    window.addEventListener(name, reset, { passive: true });
  });
  window.setInterval(() => {
    const idle = Date.now() - lastActivity;
    if (idle >= LOGOUT_AFTER) {
      window.location.href = "/logout";
    } else if (idle >= WARN_AFTER) {
      ensureWarning().hidden = false;
    }
  }, 1000);
})();
