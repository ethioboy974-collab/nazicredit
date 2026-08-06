const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const quantity = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

loadPortal();

async function loadPortal() {
  try {
    const response = await fetch("/api/vendor-portal/data", { credentials: "same-origin" });
    if (response.status === 401) { window.location.href = "/vendor-login"; return; }
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Portal could not be loaded");
    renderPortal(result);
  } catch (error) {
    const target = document.querySelector("#portalError"); target.hidden = false; target.textContent = error.message;
  }
}

function renderPortal(data) {
  text("#vendorName", data.vendor.name); text("#storeName", `${data.store.name} (${data.store.code})`);
  text("#totalReceived", quantity.format(data.summary.received));
  text("#totalSpoilage", quantity.format(data.summary.spoilage));
  text("#totalAccepted", quantity.format(data.summary.accepted));
  text("#unpaidBalance", money.format(data.summary.unpaidBalance));
  document.querySelector("#statementRows").innerHTML = data.monthlyStatements.map((row) => `<tr><td>${monthLabel(row.month)}</td><td>${quantity.format(row.received)}</td><td>${quantity.format(row.spoilage)}</td><td>${quantity.format(row.accepted)}</td><td>${money.format(row.amountOwed)}</td><td>${money.format(row.paidAmount)}</td><td>${money.format(row.unpaidBalance)}</td></tr>`).join("") || empty(7, "No monthly statements yet.");
  document.querySelector("#deliveryRows").innerHTML = data.deliveries.map((row) => `<tr><td>${dateLabel(row.createdAt)}</td><td>${escapeHtml(row.product)}</td><td>${quantity.format(row.receivedQuantity)} ${escapeHtml(row.unit)}</td><td>${quantity.format(row.spoilageQuantity)} ${escapeHtml(row.unit)}</td><td>${quantity.format(row.acceptedQuantity)} ${escapeHtml(row.unit)}</td><td>${money.format(row.unitPrice)}</td><td>${money.format(row.amount)}</td><td class="${row.status === "paid" ? "paid" : "unpaid"}">${row.status === "paid" ? "Paid" : "Unpaid"}</td></tr>`).join("") || empty(8, "No deliveries yet.");
  document.querySelector("#paymentRows").innerHTML = data.paymentHistory.map((row) => `<tr><td>${dateLabel(row.paidAt)}</td><td>${escapeHtml(row.product)}</td><td>${money.format(row.amount)}</td><td>${escapeHtml(row.receivingId)}</td></tr>`).join("") || empty(4, "No payments recorded yet.");
}

function text(selector, value) { document.querySelector(selector).textContent = value; }
function empty(columns, message) { return `<tr><td class="empty" colspan="${columns}">${message}</td></tr>`; }
function dateLabel(value) { return new Date(value).toLocaleString(); }
function monthLabel(value) { const [year, month] = value.split("-"); return new Date(Number(year), Number(month)-1, 1).toLocaleDateString(undefined,{month:"long",year:"numeric"}); }
function escapeHtml(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
