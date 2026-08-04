const state = {
  enterprises: [],
  invites: [],
  users: [],
  search: "",
};

const elements = {
  activeEnterprises: document.querySelector("#activeEnterprises"),
  disabledEnterprises: document.querySelector("#disabledEnterprises"),
  managedUsers: document.querySelector("#managedUsers"),
  managedRecords: document.querySelector("#managedRecords"),
  activeInvites: document.querySelector("#activeInvites"),
  adminLogoutButton: document.querySelector("#adminLogoutButton"),
  enterpriseSearch: document.querySelector("#enterpriseSearch"),
  enterpriseRows: document.querySelector("#enterpriseRows"),
  enterpriseEmpty: document.querySelector("#enterpriseEmpty"),
  generateInviteButton: document.querySelector("#generateInviteButton"),
  generatedCode: document.querySelector("#generatedCode"),
  generatedCodeValue: document.querySelector("#generatedCodeValue"),
  generatedCodeExpiry: document.querySelector("#generatedCodeExpiry"),
  copyCodeButton: document.querySelector("#copyCodeButton"),
  inviteList: document.querySelector("#inviteList"),
  userSurface: document.querySelector("#userSurface"),
  userHeading: document.querySelector("#userHeading"),
  selectedEnterpriseText: document.querySelector("#selectedEnterpriseText"),
  userList: document.querySelector("#userList"),
  closeUsersButton: document.querySelector("#closeUsersButton"),
  activityList: document.querySelector("#activityList"),
  refreshButton: document.querySelector("#refreshButton"),
  resetDialog: document.querySelector("#resetDialog"),
  resetForm: document.querySelector("#resetForm"),
  resetMode: document.querySelector("#resetMode"),
  resetTargetId: document.querySelector("#resetTargetId"),
  resetTarget: document.querySelector("#resetTarget"),
  resetUsername: document.querySelector("#resetUsername"),
  resetPassword: document.querySelector("#resetPassword"),
  toast: document.querySelector("#toast"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Login required");
  }
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || `Request failed: ${response.status}`);
  }
  return result;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(toast.timeout);
  toast.timeout = window.setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

async function loadDashboard() {
  const [summaryResult, enterpriseResult, inviteResult, activityResult] = await Promise.all([
    api("/admin/summary"),
    api("/admin/enterprises"),
    api("/signup-invites"),
    api("/activity"),
  ]);
  renderSummary(summaryResult.summary);
  state.enterprises = enterpriseResult.enterprises;
  state.invites = inviteResult.invites;
  renderEnterprises();
  renderInvites();
  renderActivity(activityResult.activity);
}

function renderSummary(summary) {
  elements.activeEnterprises.textContent = summary.activeEnterprises;
  elements.disabledEnterprises.textContent = summary.disabledEnterprises;
  elements.managedUsers.textContent = summary.managedUsers;
  elements.managedRecords.textContent = summary.managedRecords;
  elements.activeInvites.textContent = summary.activeInvites;
}

function renderEnterprises() {
  const term = state.search.trim().toLowerCase();
  const enterprises = state.enterprises.filter((enterprise) =>
    [enterprise.name, enterprise.code, enterprise.ownerUsername, enterprise.ownerEmail]
      .join(" ")
      .toLowerCase()
      .includes(term),
  );
  elements.enterpriseRows.innerHTML = enterprises
    .map((enterprise) => {
      const nextStatus = enterprise.status === "active" ? "disabled" : "active";
      const emailText = enterprise.ownerEmail
        ? `${enterprise.ownerEmail}${enterprise.ownerEmailVerified ? " - verified" : " - not verified"}`
        : "No recovery email";
      return `
        <tr>
          <td>
            <strong>${escapeHtml(enterprise.name)}</strong>
            <span>${escapeHtml(enterprise.code)}</span>
          </td>
          <td>
            <strong>${escapeHtml(enterprise.ownerUsername || "Not set")}</strong>
            <span>${escapeHtml(emailText)}</span>
          </td>
          <td>
            <strong>${escapeHtml(formatDateTime(enterprise.createdAt))}</strong>
            <span>Registered</span>
          </td>
          <td>
            <strong>${enterprise.userCount} users</strong>
            <span>${enterprise.recordCount} records</span>
          </td>
          <td><span class="status ${escapeHtml(enterprise.status)}">${escapeHtml(enterprise.status)}</span></td>
          <td>
            <div class="row-actions">
              <button class="button secondary compact" data-enterprise-action="users" data-id="${escapeHtml(enterprise.id)}" type="button">Users</button>
              <button class="button secondary compact" data-enterprise-action="reset" data-id="${escapeHtml(enterprise.id)}" type="button">Reset Owner</button>
              <button class="button secondary compact" data-enterprise-action="status" data-status="${nextStatus}" data-id="${escapeHtml(enterprise.id)}" type="button">${nextStatus === "active" ? "Enable" : "Disable"}</button>
              <button class="button secondary compact danger" data-enterprise-action="remove" data-id="${escapeHtml(enterprise.id)}" type="button">Remove</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
  elements.enterpriseEmpty.hidden = enterprises.length > 0;
}

function renderInvites() {
  if (!state.invites.length) {
    elements.inviteList.innerHTML = '<p class="empty">No invitations yet.</p>';
    return;
  }
  elements.inviteList.innerHTML = state.invites
    .map((invite) => {
      const detail =
        invite.status === "used"
          ? `Used by ${invite.usedByEnterpriseName || invite.usedByEnterpriseCode || "enterprise"} on ${formatDateTime(invite.usedAt)}`
          : `${invite.status === "expired" ? "Expired" : "Expires"} ${formatDateTime(invite.expiresAt)}`;
      return `
        <div class="list-item">
          <div>
            <strong class="status ${escapeHtml(invite.status)}">${escapeHtml(invite.status)}</strong>
            <span>${escapeHtml(detail)}</span>
          </div>
          ${
            invite.status === "active"
              ? `<button class="button secondary compact danger" data-invite-action="revoke" data-id="${escapeHtml(invite.id)}" type="button">Revoke</button>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function renderActivity(activity) {
  if (!activity.length) {
    elements.activityList.innerHTML = '<p class="empty">No platform activity yet.</p>';
    return;
  }
  elements.activityList.innerHTML = activity
    .map(
      (entry) => `
        <article class="activity-item">
          <strong>${escapeHtml(entry.summary)}</strong>
          <span>${escapeHtml(entry.username)} - ${escapeHtml(entry.action)}</span>
          <time>${escapeHtml(formatDateTime(entry.createdAt))}</time>
        </article>
      `,
    )
    .join("");
}

async function loadEnterpriseUsers(enterpriseId) {
  const enterprise = state.enterprises.find((item) => item.id === enterpriseId);
  if (!enterprise) return;
  const result = await api(`/admin/enterprises/${encodeURIComponent(enterpriseId)}/users`);
  state.users = result.users;
  elements.userHeading.textContent = `${enterprise.name} Users`;
  elements.selectedEnterpriseText.textContent = `${enterprise.code} - ${enterprise.status}`;
  elements.userList.innerHTML = state.users
    .map(
      (user) => `
        <article class="user-item">
          <div>
            <strong>${escapeHtml(user.displayName)} <span class="status">${escapeHtml(user.role)}</span></strong>
            <span>${escapeHtml(user.username)} - ${escapeHtml(user.email || "no recovery email")}${user.emailVerified ? " - verified" : ""}</span>
          </div>
          <button class="button secondary compact" data-user-action="reset" data-id="${escapeHtml(user.id)}" type="button">Reset Access</button>
        </article>
      `,
    )
    .join("");
  elements.userSurface.hidden = false;
  elements.userSurface.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openResetDialog({ mode, id, label, username }) {
  elements.resetMode.value = mode;
  elements.resetTargetId.value = id;
  elements.resetTarget.textContent = label;
  elements.resetUsername.value = username || "";
  elements.resetPassword.value = "";
  elements.resetDialog.showModal();
  elements.resetUsername.focus();
}

async function submitReset(event) {
  event.preventDefault();
  const mode = elements.resetMode.value;
  const id = elements.resetTargetId.value;
  const path =
    mode === "enterprise"
      ? `/admin/enterprises/${encodeURIComponent(id)}/access`
      : `/admin/users/${encodeURIComponent(id)}/access`;
  const passwordField = mode === "enterprise" ? "temporaryPassword" : "temporaryPassword";
  await api(path, {
    method: "PATCH",
    body: JSON.stringify({
      username: elements.resetUsername.value.trim(),
      [passwordField]: elements.resetPassword.value,
    }),
  });
  elements.resetDialog.close();
  await loadDashboard();
  toast("Temporary access created");
}

async function generateInvite() {
  elements.generateInviteButton.disabled = true;
  try {
    const result = await api("/signup-invites", { method: "POST", body: "{}" });
    elements.generatedCodeValue.value = result.invite.code;
    elements.generatedCodeExpiry.textContent = `Valid until ${formatDateTime(result.invite.expiresAt)}.`;
    elements.generatedCode.hidden = false;
    await loadDashboard();
    toast("Invitation generated");
  } finally {
    elements.generateInviteButton.disabled = false;
  }
}

async function copyCode() {
  if (!elements.generatedCodeValue.value) return;
  await navigator.clipboard.writeText(elements.generatedCodeValue.value);
  toast("Invitation copied");
}

async function logout(event) {
  event.preventDefault();
  try {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } finally {
    window.location.replace("/login");
  }
}

async function changeEnterpriseStatus(enterprise, status) {
  const verb = status === "active" ? "Enable" : "Disable";
  if (!window.confirm(`${verb} ${enterprise.name}?`)) return;
  await api(`/admin/enterprises/${encodeURIComponent(enterprise.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  await loadDashboard();
  toast(`Enterprise ${status}`);
}

async function removeEnterprise(enterprise) {
  const confirmation = window.prompt(
    `This permanently removes ${enterprise.name}. Type ${enterprise.code} to confirm.`,
  );
  if (confirmation === null) return;
  await api(`/admin/enterprises/${encodeURIComponent(enterprise.id)}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmCode: confirmation }),
  });
  elements.userSurface.hidden = true;
  await loadDashboard();
  toast("Enterprise removed");
}

function bindEvents() {
  elements.adminLogoutButton.addEventListener("click", (event) =>
    logout(event).catch(() => {
      window.location.replace("/login");
    }),
  );
  elements.enterpriseSearch.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderEnterprises();
  });
  elements.generateInviteButton.addEventListener("click", () =>
    generateInvite().catch((error) => toast(error.message)),
  );
  elements.copyCodeButton.addEventListener("click", () =>
    copyCode().catch((error) => toast(error.message)),
  );
  elements.refreshButton.addEventListener("click", () =>
    loadDashboard().catch((error) => toast(error.message)),
  );
  elements.closeUsersButton.addEventListener("click", () => {
    elements.userSurface.hidden = true;
  });
  elements.resetForm.addEventListener("submit", (event) =>
    submitReset(event).catch((error) => toast(error.message)),
  );
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });

  elements.enterpriseRows.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-enterprise-action]");
    if (!button) return;
    const enterprise = state.enterprises.find((item) => item.id === button.dataset.id);
    if (!enterprise) return;
    if (button.dataset.enterpriseAction === "users") {
      loadEnterpriseUsers(enterprise.id).catch((error) => toast(error.message));
    }
    if (button.dataset.enterpriseAction === "reset") {
      openResetDialog({
        mode: "enterprise",
        id: enterprise.id,
        label: `${enterprise.name} (${enterprise.code})`,
        username: enterprise.ownerUsername,
      });
    }
    if (button.dataset.enterpriseAction === "status") {
      changeEnterpriseStatus(enterprise, button.dataset.status).catch((error) =>
        toast(error.message),
      );
    }
    if (button.dataset.enterpriseAction === "remove") {
      removeEnterprise(enterprise).catch((error) => toast(error.message));
    }
  });

  elements.inviteList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-invite-action='revoke']");
    if (!button || !window.confirm("Revoke this unused invitation?")) return;
    api(`/signup-invites/${encodeURIComponent(button.dataset.id)}`, { method: "DELETE" })
      .then(loadDashboard)
      .then(() => toast("Invitation revoked"))
      .catch((error) => toast(error.message));
  });

  elements.userList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-user-action='reset']");
    if (!button) return;
    const user = state.users.find((item) => item.id === button.dataset.id);
    if (!user) return;
    openResetDialog({
      mode: "user",
      id: user.id,
      label: `${user.displayName} - ${user.role}`,
      username: user.username,
    });
  });
}

bindEvents();
loadDashboard().catch((error) => toast(error.message));
