const completedOrders = document.querySelector("#completedOrders");
const completedEmpty = document.querySelector("#completedEmpty");
const completedCount = document.querySelector("#completedCount");
const pageMessage = document.querySelector("#pageMessage");
const nameSearch = document.querySelector("#nameSearch");
const phoneSearch = document.querySelector("#phoneSearch");
const dateSearch = document.querySelector("#dateSearch");
const demoMode = new URLSearchParams(location.search).get("demo") === "1" || location.protocol === "file:";
let orders = loadDemoOrders();

init();

function init() {
  document.querySelector("#refreshButton").addEventListener("click", loadOrders);
  document.querySelector("#clearSearchButton").addEventListener("click", () => { nameSearch.value = ""; phoneSearch.value = ""; dateSearch.value = ""; renderOrders(); });
  [nameSearch, phoneSearch, dateSearch].forEach((input) => input.addEventListener("input", renderOrders));
  completedOrders.addEventListener("click", restoreOrder);
  loadOrders();
}

async function apiRequest(path, options = {}) {
  if (demoMode) {
    if (options.method === "PATCH") {
      const id = decodeURIComponent(path.split("/")[2]);
      orders = orders.map((order) => order.id === id ? { ...order, status: "pending", isActive: true, completedAt: null, completedBy: "" } : order);
      localStorage.setItem("nazicredit-demo-orders", JSON.stringify(orders));
      return { ok: true };
    }
    return { ok: true, orders };
  }
  const response = await fetch(`/api${path}`, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (response.status === 401) { location.href = "/login"; throw new Error("Login required"); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || "Could not update the order");
  return result;
}

async function loadOrders() {
  try { const result = await apiRequest("/meat-orders"); orders = Array.isArray(result.orders) ? result.orders : []; renderOrders(); }
  catch (error) { showMessage(error.message, true); }
}

function renderOrders() {
  const name = nameSearch.value.trim().toLowerCase();
  const phone = phoneSearch.value.trim().toLowerCase();
  const date = dateSearch.value;
  const filtered = orders.filter((order) => ["picked_up", "completed"].includes(order.status) || order.isActive === false)
    .filter((order) => !name || String(order.customerName).toLowerCase().includes(name))
    .filter((order) => !phone || String(order.customerPhone).toLowerCase().includes(phone))
    .filter((order) => !date || localDate(new Date(order.pickupAt)) === date)
    .sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
  completedOrders.innerHTML = filtered.map((order, index) => row(order, index + 1)).join("");
  completedCount.textContent = filtered.length;
  completedEmpty.hidden = filtered.length > 0;
}

function row(order, sequence) {
  const items = order.items?.length ? order.items : [{ productName: order.meatType, quantity: order.quantity, unit: "", specialInstructions: order.preparationInstructions }];
  const notification = order.notificationSentAt ? `<span class="notification-sent">Customer Texted</span><small>${escapeHtml(formatDateTime(order.notificationSentAt))}</small>` : `<span class="notification-pending">Not texted</span>`;
  return `<tr>
    <td class="sheet-sequence" data-label="Order">${sequence}</td>
    <td data-label="Customer"><strong>${escapeHtml(order.customerName)}</strong></td>
    <td data-label="Phone"><a href="tel:${escapeHtml(order.customerPhone)}">${escapeHtml(order.customerPhone)}</a></td>
    <td class="preparation-cell" data-label="Order details">${items.map((item) => `<div class="product-display"><strong>${escapeHtml(item.productName)}</strong>${!(Number(item.quantity) === 1 && item.unit === "item" && item.price == null) ? `<span>${escapeHtml(item.quantity)} ${escapeHtml(item.unit || "")}</span>` : ""}${item.specialInstructions ? `<small>${escapeHtml(item.specialInstructions)}</small>` : ""}</div>`).join("")}${order.preparationInstructions ? `<div>${escapeHtml(order.preparationInstructions)}</div>` : ""}</td>
    <td class="pickup-cell" data-label="Pickup">${escapeHtml(formatDateTime(order.pickupAt))}</td>
    <td data-label="Picked up">${escapeHtml(formatDateTime(order.completedAt))}</td>
    <td data-label="Handled by">${escapeHtml(order.completedBy || "—")}</td>
    <td data-label="Notification">${notification}</td>
    <td class="action-cell" data-label="Action"><button class="restore-button" type="button" data-order-id="${escapeHtml(order.id)}">Restore to Pending</button></td>
  </tr>`;
}

async function restoreOrder(event) {
  const button = event.target.closest(".restore-button");
  if (!button) return;
  button.disabled = true;
  try {
    await apiRequest(`/meat-orders/${encodeURIComponent(button.dataset.orderId)}/status`, { method: "PATCH", body: JSON.stringify({ status: "pending" }) });
    showMessage("Order restored to Pending in Active Orders."); await loadOrders();
  } catch (error) { showMessage(error.message, true); button.disabled = false; }
}

function loadDemoOrders() {
  if (!demoMode) return [];
  try { const saved = JSON.parse(localStorage.getItem("nazicredit-demo-orders") || "null"); if (Array.isArray(saved)) return saved; } catch {}
  const now = Date.now();
  const initial = [{ id: "demo-completed-1", customerName: "John Smith", customerPhone: "(555) 010-1920", meatType: "Chicken", quantity: "3 whole", preparationInstructions: "Cut into eight pieces.", pickupAt: new Date(now - 10800000).toISOString(), employeeName: "Sam", createdAt: new Date(now - 86400000).toISOString(), status: "picked_up", completedAt: new Date(now - 7200000).toISOString(), completedBy: "Omar", isActive: false }];
  localStorage.setItem("nazicredit-demo-orders", JSON.stringify(initial)); return initial;
}

function formatDateTime(value) { if (!value) return "—"; return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function localDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function showMessage(message, isError = false) { pageMessage.textContent = message; pageMessage.classList.toggle("error", isError); }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
