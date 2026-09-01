const activeOrders = document.querySelector("#activeOrders");
const activeEmpty = document.querySelector("#activeEmpty");
const activeCount = document.querySelector("#activeCount");
const pageMessage = document.querySelector("#pageMessage");
const clearDemoButton = document.querySelector("#clearDemoButton");
const printOrderCount = document.querySelector("#printOrderCount");
const printTimestamp = document.querySelector("#printTimestamp");
const demoMode = false;
let demoOrders = [];
let currentOrders = [];
let currentUser = { role: "employee", username: "" };
let currentPermissions = { resendOrderNotifications: false };

init();

function init() {
  loadCurrentUser();
  clearDemoButton.hidden = true;
  document.querySelector("#refreshButton").addEventListener("click", loadOrders);
  document.querySelector("#printButton").addEventListener("click", printActiveOrders);
  activeOrders.addEventListener("click", handleOrderAction);
  loadOrders();
  setInterval(() => renderOrders(currentOrders), 60_000);
}

async function loadCurrentUser() {
  try {
    const result = await apiRequest("/me");
    currentUser = result.user || currentUser;
    currentPermissions = result.permissions || currentPermissions;
    renderOrders(currentOrders);
  } catch {}
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (response.status === 401) { location.href = "/login"; throw new Error("Login required"); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || "Could not update the order");
  return result;
}

function demoApiRequest(path, options = {}) {
  if (path === "/me") return { ok: true, user: { username: "Demo Owner", role: "owner" }, permissions: { resendOrderNotifications: true } };
  const id = decodeURIComponent(path.split("/")[2] || "");
  const order = demoOrders.find((item) => item.id === id);
  if (options.method === "PATCH") {
    if (!order) throw new Error("Order not found");
    const input = JSON.parse(options.body);
    order.status = input.status;
    order.isActive = input.status !== "picked_up";
    order.completedAt = input.status === "picked_up" ? new Date().toISOString() : null;
    order.completedBy = input.status === "picked_up" ? (input.completedBy || currentUser.username || "Demo Employee") : "";
    if (input.status === "ready" && !order.notificationSentAt) markDemoNotification(order);
    saveDemoOrders();
    return { ok: true, order };
  }
  if (options.method === "POST" && path.endsWith("/notification")) {
    if (!order) throw new Error("Order not found");
    markDemoNotification(order); saveDemoOrders(); return { ok: true, order };
  }
  return { ok: true, orders: demoOrders };
}

function markDemoNotification(order) {
  order.notificationSentAt = new Date().toISOString();
  order.notificationProvider = "log";
  order.notificationChannel = "sms";
}

async function loadOrders() {
  try { const result = await apiRequest("/meat-orders"); renderOrders(Array.isArray(result.orders) ? result.orders : []); }
  catch (error) { showMessage(error.message, true); }
}

function renderOrders(orders) {
  currentOrders = orders;
  const active = orders.filter((order) => order.status !== "picked_up" && order.isActive !== false).sort(compareOrderPriority);
  activeOrders.innerHTML = active.map((order, index) => orderRow(order, index + 1)).join("");
  activeCount.textContent = active.length;
  printOrderCount.textContent = active.length;
  activeEmpty.hidden = active.length > 0;
}

function printActiveOrders() {
  const activeTotal = Number(activeCount.textContent || 0);
  if (!activeTotal) return showMessage("There are no active orders to print.", true);
  printTimestamp.textContent = `Printed ${formatDateTime(new Date())}`;
  window.print();
}

function orderRow(order, sequence) {
  const priority = getPickupPriority(order.pickupAt);
  const status = normalizeStatus(order.status);
  const notificationAction = status === "ready" && (!order.notificationSentAt || currentPermissions.resendOrderNotifications);
  return `<tr class="priority-${priority.key}">
    <td class="sheet-sequence" data-label="Order">${sequence}</td>
    <td class="pickup-cell" data-label="Pickup">${escapeHtml(formatDateTime(order.pickupAt))}</td>
    <td class="status-cell" data-label="Status"><span class="order-status status-${status}">${escapeHtml(statusLabel(status))}</span><span class="priority-time">${escapeHtml(priority.timeText)}</span></td>
    <td data-label="Customer"><strong>${escapeHtml(order.customerName)}</strong></td>
    <td data-label="Phone"><a href="tel:${escapeHtml(order.customerPhone)}">${escapeHtml(order.customerPhone)}</a></td>
    <td class="products-cell" data-label="Products">${normalizedItems(order).map(productLine).join("")}</td>
    <td class="preparation-cell full-details-cell" data-label="Order notes">${escapeHtml(order.preparationInstructions || "—")}</td>
    <td data-label="Taken by">${escapeHtml(order.employeeName)}</td>
    <td class="notification-cell" data-label="Customer text">${notificationDisplay(order, status)}${notificationAction ? `<button class="resend-button" type="button" data-order-id="${escapeHtml(order.id)}">${order.notificationSentAt ? "Text Again" : "Retry Text"}</button>` : ""}</td>
    <td class="action-cell" data-label="Next step"><a class="edit-order-button" href="create-order.html?edit=${encodeURIComponent(order.id)}${demoMode ? "&demo=1" : ""}">Edit details</a>${workflowButtons(order.id, status)}</td>
  </tr>`;
}

function workflowButtons(id, status) {
  const escapedId = escapeHtml(id);
  if (status === "pending") return `<button class="status-button preparing-button" data-status="preparing" data-order-id="${escapedId}" type="button">Start Preparing</button>`;
  if (status === "preparing") return `<button class="status-button ready-button" data-status="ready" data-order-id="${escapedId}" type="button">Done — Text Customer</button>`;
  if (status === "ready") return `<button class="status-button picked-up-button" data-status="picked_up" data-order-id="${escapedId}" type="button">Picked Up</button>`;
  return "";
}

function notificationDisplay(order, status) {
  if (order.notificationSentAt) return `<span class="notification-sent">Customer Texted</span><small>${escapeHtml(formatDateTime(order.notificationSentAt))}</small>`;
  if (status === "ready") return `<span class="notification-failed">Text Not Sent</span><small>Use Retry Text</small>`;
  return `<span class="notification-pending">Texts automatically when ready</span>`;
}

async function handleOrderAction(event) {
  const resend = event.target.closest(".resend-button");
  if (resend) return resendNotification(resend);
  const button = event.target.closest(".status-button");
  if (!button) return;
  button.disabled = true;
  try {
    const result = await apiRequest(`/meat-orders/${encodeURIComponent(button.dataset.orderId)}/status`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.status }) });
    const successMessage = button.dataset.status === "ready"
      ? "Done. The customer was texted."
      : button.dataset.status === "picked_up"
        ? "Done. The order was moved to Order History."
        : "Order preparation started.";
    showMessage(result.notificationError ? `Order is ready, but the customer text failed. Press Retry Text.` : successMessage, Boolean(result.notificationError));
    await loadOrders();
  } catch (error) { showMessage(error.message, true); button.disabled = false; }
}

async function resendNotification(button) {
  button.disabled = true;
  try {
    await apiRequest(`/meat-orders/${encodeURIComponent(button.dataset.orderId)}/notification`, { method: "POST", body: "{}" });
    showMessage("The customer was texted again."); await loadOrders();
  } catch (error) { showMessage(error.message, true); button.disabled = false; }
}

function normalizeStatus(status) { return status === "active" ? "pending" : status === "completed" ? "picked_up" : status; }
function statusLabel(status) { return ({ pending: "Pending", preparing: "Being Prepared", ready: "Ready for Pickup", picked_up: "Picked Up" })[status] || status; }
function normalizedItems(order) { return order.items?.length ? order.items : [{ productName: order.meatType, quantity: order.quantity, unit: "", specialInstructions: order.preparationInstructions, price: null }]; }
function productLine(item) { const details = !(Number(item.quantity) === 1 && item.unit === "item" && item.price == null); const price = item.price == null ? "" : ` · $${Number(item.price).toFixed(2)}`; return `<div class="product-display"><strong>${escapeHtml(item.productName)}</strong>${details ? `<span>${escapeHtml(item.quantity)} ${escapeHtml(item.unit || "")}${escapeHtml(price)}</span>` : ""}${item.specialInstructions ? `<small>${escapeHtml(item.specialInstructions)}</small>` : ""}</div>`; }
function getPickupPriority(pickupAt, now = Date.now()) { const minutes = (new Date(pickupAt).getTime() - now) / 60000; if (!Number.isFinite(minutes)) return { key: "prepare", timeText: "Pickup time unavailable", rank: 0 }; if (minutes <= 0) return { key: "overdue", timeText: Math.abs(minutes) < 1 ? "Pickup is due now" : `${Math.floor(Math.abs(minutes))} min overdue`, rank: 2 }; if (minutes <= 20) return { key: "soon", timeText: `Pickup in ${Math.ceil(minutes)} min`, rank: 1 }; return { key: "prepare", timeText: formatTimeUntil(minutes), rank: 0 }; }
function compareOrderPriority(a, b) { const ap = getPickupPriority(a.pickupAt); const bp = getPickupPriority(b.pickupAt); return bp.rank - ap.rank || new Date(a.pickupAt) - new Date(b.pickupAt); }
function formatTimeUntil(minutes) { if (minutes < 60) return `Pickup in ${Math.ceil(minutes)} min`; const total = Math.ceil(minutes); const hours = Math.floor(total / 60); const mins = total % 60; if (hours < 24) return `Pickup in ${hours} hr${hours === 1 ? "" : "s"}${mins ? ` ${mins} min` : ""}`; const days = Math.floor(hours / 24); return `Pickup in ${days} day${days === 1 ? "" : "s"}`; }
function formatDateTime(value) { if (!value) return "—"; return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function clearDemoOrders() { demoOrders = []; saveDemoOrders(); renderOrders(demoOrders); showMessage("All demo orders cleared."); }
function loadDemoOrders() { return []; }
function saveDemoOrders() {}
function showMessage(message, isError = false) { pageMessage.textContent = message; pageMessage.classList.toggle("error", isError); }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
