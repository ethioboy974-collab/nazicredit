const state = { users: [], me: null };
const el = Object.fromEntries(["employeeForm", "employeeId", "displayName", "username", "role", "status", "password", "cancelEdit", "refresh", "employeeList", "activityList", "loginList", "toast", "formTitle"].map((id) => [id, document.querySelector(`#${id}`)]));
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const formatDate = (value) => value ? new Date(value).toLocaleString() : "";

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...options });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) { location.href = "/login"; throw new Error("Login required"); }
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.toast.classList.remove("show"), 2400);
}

async function load() {
  const [me, users, activity, logins] = await Promise.all([api("/me"), api("/users"), api("/activity"), api("/login-history")]);
  state.me = me.user;
  state.users = users.users;
  renderUsers();
  renderAudit(el.activityList, activity.activity.map((item) => ({ title: item.summary, detail: `${item.username} · ${item.action}`, date: item.createdAt })));
  renderAudit(el.loginList, logins.history.map((item) => ({ title: `${item.username} — ${item.outcome}`, detail: item.ipAddress || "Unknown device address", date: item.createdAt })));
}

function renderUsers() {
  el.employeeList.innerHTML = state.users.map((user) => {
    const isSelf = user.id === state.me.id;
    const nextStatus = user.status === "active" ? "inactive" : "active";
    return `<article class="employee-card"><div><strong>${escapeHtml(user.displayName)}<span class="badge">${escapeHtml(user.role)}</span><span class="badge">${escapeHtml(user.status)}</span></strong><span>Username: ${escapeHtml(user.username)}${user.mustChangePassword ? " · Password change required" : ""}</span></div>${isSelf ? "<span>Your account</span>" : `<div class="card-actions"><button class="button secondary" data-action="edit" data-id="${escapeHtml(user.id)}">Edit</button><button class="button secondary" data-action="reset" data-id="${escapeHtml(user.id)}">Reset Password</button>${user.role === "employee" ? `<button class="button ${nextStatus === "inactive" ? "danger" : "secondary"}" data-action="status" data-status="${nextStatus}" data-id="${escapeHtml(user.id)}">${nextStatus === "active" ? "Activate" : "Deactivate"}</button>` : ""}</div>`}</article>`;
  }).join("");
}

function renderAudit(target, items) {
  target.innerHTML = items.length ? items.slice(0, 100).map((item) => `<article class="audit-item"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div><time>${escapeHtml(formatDate(item.date))}</time></article>`).join("") : "<p>No records yet.</p>";
}

function edit(id, resetPassword = false) {
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  el.employeeId.value = id;
  el.displayName.value = user.displayName;
  el.username.value = user.username;
  el.role.value = user.role;
  el.status.value = user.status;
  el.password.value = "";
  el.password.required = false;
  el.cancelEdit.hidden = false;
  el.formTitle.textContent = resetPassword ? `Reset Password — ${user.displayName}` : `Edit — ${user.displayName}`;
  (resetPassword ? el.password : el.displayName).focus();
}

function clearForm() {
  el.employeeForm.reset();
  el.employeeId.value = "";
  el.password.required = true;
  el.cancelEdit.hidden = true;
  el.formTitle.textContent = "Add Employee";
}

async function save(event) {
  event.preventDefault();
  const id = el.employeeId.value;
  const body = { displayName: el.displayName.value.trim(), username: el.username.value.trim(), role: el.role.value, status: el.status.value };
  if (el.password.value) body.password = el.password.value;
  await api(id ? `/users/${encodeURIComponent(id)}` : "/users", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) });
  clearForm();
  await load();
  toast(id ? "Account updated" : "Account created");
}

async function changeStatus(id, status) {
  await api(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
  await load();
  toast(`Employee ${status}`);
}

el.employeeForm.addEventListener("submit", (event) => save(event).catch((error) => toast(error.message)));
el.cancelEdit.addEventListener("click", clearForm);
el.refresh.addEventListener("click", () => load().catch((error) => toast(error.message)));
el.employeeList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "edit") edit(button.dataset.id);
  if (button.dataset.action === "reset") edit(button.dataset.id, true);
  if (button.dataset.action === "status") changeStatus(button.dataset.id, button.dataset.status).catch((error) => toast(error.message));
});

load().catch((error) => toast(error.message));
