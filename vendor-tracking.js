const STORAGE_KEY = "vendor-ledger-v1";
const SESSION_KEY = "vendor-ledger-session";
const USERS = {
  admin: { password: "admin123", role: "Admin" },
  staff: { password: "staff123", role: "Staff" }
};

const state = loadState();
let currentUser = { username: "owner", role: "Admin" };
let vendorListOpen = false;
const selectedStatementEntries = new Set();
let clearPaidArmed = false;
let accessState = { role: "employee", ownerPinUnlocked: false };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const elements = {
  loginScreen: document.querySelector("#loginScreen"),
  loginForm: document.querySelector("#loginForm"),
  userLine: document.querySelector("#userLine"),
  activeMonth: document.querySelector("#activeMonth"),
  monthTitle: document.querySelector("#monthTitle"),
  metricReceived: document.querySelector("#metricReceived"),
  metricSpoiled: document.querySelector("#metricSpoiled"),
  metricPayable: document.querySelector("#metricPayable"),
  metricVendors: document.querySelector("#metricVendors"),
  vendorBalanceRows: document.querySelector("#vendorBalanceRows"),
  activityList: document.querySelector("#activityList"),
  historyRows: document.querySelector("#historyRows"),
  editDialog: document.querySelector("#editDialog"),
  editForm: document.querySelector("#editForm"),
  saveEdit: document.querySelector("#saveEdit"),
  vendorDialog: document.querySelector("#vendorDialog"),
  vendorEditForm: document.querySelector("#vendorEditForm"),
  saveVendorEdit: document.querySelector("#saveVendorEdit"),
  deliveryForm: document.querySelector("#deliveryForm"),
  changeReceivingItem: document.querySelector("#changeReceivingItem"),
  vendorForm: document.querySelector("#vendorForm"),
  vendorList: document.querySelector("#vendorList"),
  vendorSearch: document.querySelector("#vendorSearch"),
  toggleVendorList: document.querySelector("#toggleVendorList"),
  akrabiOptions: document.querySelector("#akrabiOptions"),
  statementSearch: document.querySelector("#statementSearch"),
  statementStatus: document.querySelector("#statementStatus"),
  statementDateFrom: document.querySelector("#statementDateFrom"),
  statementDateTo: document.querySelector("#statementDateTo"),
  printVendorName: document.querySelector("#printVendorName"),
  printStoreName: document.querySelector("#printStoreName"),
  printReportPeriod: document.querySelector("#printReportPeriod"),
  printGeneratedDate: document.querySelector("#printGeneratedDate"),
  statementEmpty: document.querySelector("#statementEmpty"),
  statementOverview: document.querySelector("#statementOverview"),
  statementTableWrap: document.querySelector("#statementTableWrap"),
  statementRows: document.querySelector("#statementRows"),
  statementHeadingVendor: document.querySelector("#statementHeadingVendor"),
  statementHeadingPeriod: document.querySelector("#statementHeadingPeriod"),
  statementAcceptedTotal: document.querySelector("#statementAcceptedTotal"),
  statementFooterTotal: document.querySelector("#statementFooterTotal"),
  statementFooterLabel: document.querySelector("#statementFooterLabel"),
  statementTotalLabel: document.querySelector("#statementTotalLabel"),
  selectAllStatementRows: document.querySelector("#selectAllStatementRows"),
  selectStatementRange: document.querySelector("#selectStatementRange"),
  paySelectedRows: document.querySelector("#paySelectedRows"),
  printPaidReport: document.querySelector("#printPaidReport"),
  statementTotalBar: document.querySelector("#statementTotalBar"),
  statementTotal: document.querySelector("#statementTotal"),
  paymentBar: document.querySelector("#paymentBar"),
  paymentStatus: document.querySelector("#paymentStatus"),
  markUnpaid: document.querySelector("#markUnpaid"),
  clearPaidRecords: document.querySelector("#clearPaidRecords"),
  exportCsv: document.querySelector("#exportCsv"),
  printReport: document.querySelector("#printReport"),
  toast: document.querySelector("#toast")
};

init();

function init() {
  elements.activeMonth.value = state.activeMonth;
  setStatementDateRangeForMonth();
  elements.statementSearch.value = "";
  setDefaultDates();
  bindAuth();
  bindNavigation();
  bindForms();
  window.addEventListener("resize", enforceMobileView);
  applyAuthState();
  render();
  updateReceivingItemForSelectedVendor();
  enforceMobileView();
  loadDatabaseState().then(applyAiVendorDraft).catch(() => {
    showToast("Using the local vendor ledger");
    applyAiVendorDraft();
  });
  loadRoleAccess();
}

function applyAiVendorDraft() {
  try {
    const payload = JSON.parse(sessionStorage.getItem("nazicredit-ai-draft") || "null");
    if (payload?.context !== "vendor") return;
    sessionStorage.removeItem("nazicredit-ai-draft");
    const d = payload.draft || {};
    document.querySelector('[data-view="receive"]')?.click();
    const form = elements.deliveryForm;
    if (d.date) form.elements.date.value = d.date;
    form.elements.product.value = d.product || "";
    form.elements.receivedQuantity.value = d.receivedQuantity ?? d.quantity ?? "";
    form.elements.spoilageQuantity.value = d.spoilageQuantity ?? 0;
    if ([...form.elements.unit.options].some((o) => o.value === d.unit)) form.elements.unit.value = d.unit;
    form.elements.note.value = d.notes || "";
    const wanted = String(d.vendorName || "").toLowerCase();
    const vendor = state.vendors.find((item) => item.name.toLowerCase().includes(wanted));
    if (vendor) form.elements.vendorName.value = vendor.name;
    setReceivingItemLocked(false);
    updateAcceptedQuantity();
    showToast("AI draft loaded. Review it before saving.");
  } catch {}
}

async function loadRoleAccess() {
  if (["127.0.0.1", "localhost"].includes(window.location.hostname) || window.location.protocol === "file:") {
    accessState = { role: "owner", ownerPinUnlocked: true };
  } else {
    try {
      const result = await databaseRequest("/me");
      accessState = {
        role: result.user?.role || "employee",
        ownerPinUnlocked: Boolean(result.permissions?.ownerPinUnlocked),
        enterpriseCode: result.enterprise?.code || "",
        enterpriseName: result.enterprise?.name || "",
      };
    } catch {
      accessState = { role: "employee", ownerPinUnlocked: false };
    }
  }
  const statementTab = document.querySelector('[data-view="statement"]');
  const dashboardTab = document.querySelector("#vendorDashboardTab");
  statementTab.hidden = accessState.role !== "owner";
  dashboardTab.hidden = accessState.role !== "owner";
  document.querySelector("#vendorBalancesPanel").hidden = accessState.role !== "owner";
  document.querySelector("#savedHistoryPanel").hidden = accessState.role !== "owner";
  document.querySelector("#employeeManagementLink").hidden = accessState.role !== "owner";
  elements.exportCsv.hidden = accessState.role !== "owner";
  elements.printReport.hidden = accessState.role !== "owner";
  if (accessState.role !== "owner" && document.querySelector("#dashboard").classList.contains("active")) {
    document.querySelector('[data-view="receive"]').click();
  }
  if (window.location.hash === "#statement" && accessState.role === "owner") statementTab.click();
}

async function databaseRequest(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Login required");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || "Database request failed");
  return result;
}

async function loadDatabaseState() {
  const [result, spoilageResult, accountResult, defaultsResult] = await Promise.all([
    databaseRequest("/vendors"),
    databaseRequest("/vendors/spoilage-history"),
    databaseRequest("/vendor-accounts"),
    databaseRequest("/vendors/receiving-defaults"),
  ]);
  const deliveries = Array.isArray(result.vendors) ? result.vendors : [];
  const vendorMap = new Map();
  const vendorByAccountId = new Map();
  for (const account of (accountResult.vendors || [])) {
    const vendor = { id: account.id, accountId: account.id, name: cleanName(account.vendorName),
      phone: account.phone || "", email: account.email || "", paymentMethod: "Cash" };
    vendorMap.set(vendor.name.toLowerCase(), vendor);
    vendorByAccountId.set(account.id, vendor);
  }
  const receivingDefaults = Array.isArray(defaultsResult.defaults) ? defaultsResult.defaults : [];
  for (const item of receivingDefaults) {
    const vendor = (item.vendorAccountId && vendorByAccountId.get(item.vendorAccountId))
      || vendorMap.get(cleanName(item.vendorName || "").toLowerCase());
    if (vendor) vendor.receivingDefault = { product: item.product, unit: item.unit, unitPrice: Number(item.unitPrice || 0) };
  }
  const entries = [];
  for (const delivery of deliveries) {
    const name = cleanName(delivery.vendorName || "Unknown vendor");
    const key = name.toLowerCase();
    if (delivery.vendorAccountId && vendorByAccountId.has(delivery.vendorAccountId)) {
      vendorMap.set(key, vendorByAccountId.get(delivery.vendorAccountId));
    } else if (!vendorMap.has(key)) {
      vendorMap.set(key, { id: `vendor-${key}`, name, phone: delivery.phone || "", email: delivery.email || "", paymentMethod: "Cash" });
    } else if (!vendorMap.get(key).email && delivery.email) {
      vendorMap.get(key).email = delivery.email;
    }
    const vendor = vendorMap.get(key);
    const base = {
      date: String(delivery.createdAt || delivery.updatedAt || localDateString()).slice(0, 10),
      vendorId: vendor.id,
      vendorName: name,
      product: delivery.reference || "Unspecified product",
      unit: delivery.unit || "piece",
      unitPrice: Number(delivery.amount || 0),
      note: delivery.note || "",
      createdAt: delivery.createdAt || delivery.updatedAt || new Date().toISOString(),
      updatedAt: delivery.updatedAt || delivery.createdAt || new Date().toISOString(),
      databaseId: delivery.id,
      status: delivery.status || "due"
    };
    const legacyQuantity = Number(delivery.quantity || 0);
    const received = Number(delivery.receivedQuantity ?? legacyQuantity);
    const spoiled = Number(delivery.spoiledQuantity || 0);
    const accepted = Number(delivery.acceptedQuantity ?? Math.max(received - spoiled, 0));
    const returned = Number(delivery.returnedQuantity || 0);
    if (received > 0 || spoiled > 0 || delivery.acceptedQuantity !== undefined) {
      entries.push({ ...base, id: `${delivery.id}-received`, type: "DELIVERED", quantity: accepted,
        receivedQuantity: received, spoilageQuantity: spoiled, acceptedQuantity: accepted });
    }
    if (returned > 0) entries.push({ ...base, id: `${delivery.id}-returned`, type: "RETURNED", quantity: returned });
  }
  state.vendors = [...vendorMap.values()];
  state.entries = entries;
  state.spoilageHistory = Array.isArray(spoilageResult.history) ? spoilageResult.history : [];
  state.activeMonth = localDateString().slice(0, 7);
  elements.activeMonth.value = state.activeMonth;
  setStatementDateRangeForMonth();
  saveState();
  render();
  updateReceivingItemForSelectedVendor();
}

async function syncEntryToDatabase(entry) {
  const vendor = findVendor(entry.vendorId);
  const result = await databaseRequest("/vendors", {
    method: "POST",
    body: JSON.stringify({
      id: entry.databaseId || undefined,
      vendorAccountId: vendor.accountId || "",
      vendorName: vendor.name,
      phone: vendor.phone || "",
      email: vendor.email || "",
      quantity: entry.receivedQuantity ?? entry.quantity,
      unit: entry.unit,
      receivedQuantity: entry.type === "DELIVERED" ? (entry.receivedQuantity ?? entry.quantity) : entry.quantity,
      spoiledQuantity: entry.type === "DELIVERED" ? (entry.spoilageQuantity || 0) : (entry.type === "SPOILED" ? entry.quantity : 0),
      acceptedQuantity: entry.type === "DELIVERED" ? (entry.acceptedQuantity ?? entry.quantity) : 0,
      returnedQuantity: entry.type === "RETURNED" ? entry.quantity : 0,
      reference: entry.product,
      amount: entry.unitPrice,
      status: "due",
      note: entry.note,
      createdAt: entry.createdAt,
      updatedAt: new Date().toISOString()
    })
  });
  entry.databaseId = result.vendor?.id || entry.databaseId;
  saveState();
  return result;
}

function showVendorEmailStatus(result) {
  const notification = result?.notification;
  if (!notification) return;
  if (notification.sent) {
    showToast(`Email sent to ${notification.email}.`);
    return;
  }
  if (notification.reason === "missing_email") {
    showToast("Record saved. Add this vendor email to send automatic emails.");
    return;
  }
  if (notification.reason === "not_configured") {
    showToast("Record saved. Email delivery is not configured yet.");
    return;
  }
  showToast("Record saved. Vendor email could not be sent.");
}

function enforceMobileView() {
  const isPhone = window.matchMedia("(max-width: 680px)").matches;
  const statementIsActive = document.querySelector('#statement').classList.contains("active");
  if (isPhone && statementIsActive) {
    document.querySelector('[data-view="dashboard"]').click();
  }
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved);

  const today = new Date();
  const activeMonth = localDateString(today).slice(0, 7);
  return {
    activeMonth,
    vendors: [],
    entries: [],
    payments: []
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadSession() {
  const saved = localStorage.getItem(SESSION_KEY);
  return saved ? JSON.parse(saved) : null;
}

function bindAuth() {
  elements.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = event.currentTarget.elements.username.value.trim().toLowerCase();
    const password = event.currentTarget.elements.password.value;
    const user = USERS[username];

    if (!user || user.password !== password) {
      showToast("Login failed. Check the username and password.");
      return;
    }

    currentUser = { username, role: user.role };
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    applyAuthState();
    showToast(`Signed in as ${user.role}.`);
  });

}

function applyAuthState() {
  const signedIn = Boolean(currentUser);
  elements.loginScreen.classList.toggle("hidden", signedIn);
  document.body.classList.toggle("locked", !signedIn);
  elements.userLine.textContent = signedIn ? `Signed in as ${currentUser.role}` : "Signed out";

  const adminButtons = [elements.vendorForm.querySelector("button")];
  adminButtons.forEach((button) => {
    button.disabled = signedIn && !isAdmin();
    button.title = button.disabled ? "Admin access required" : "";
  });

  renderStatement();
}

function setDefaultDates() {
  const today = localDateString();
  elements.deliveryForm.elements.date.value = today;
}

function setStatementDateRangeForMonth() {
  const [year, month] = String(state.activeMonth || localDateString().slice(0, 7)).split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  elements.statementDateFrom.value = `${year}-${String(month).padStart(2, "0")}-01`;
  elements.statementDateTo.value = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

function bindNavigation() {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.view === "statement") {
        if (accessState.role !== "owner") {
          showToast("Owner access required.");
          return;
        }
        if (!accessState.ownerPinUnlocked) {
          window.location.href = `/owner-pin.html?next=${encodeURIComponent("/vendor-tracking.html#statement")}`;
          return;
        }
      }
      document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`#${button.dataset.view}`).classList.add("active");
    });
  });

  elements.activeMonth.addEventListener("change", () => {
    state.activeMonth = elements.activeMonth.value;
    setStatementDateRangeForMonth();
    saveState();
    render();
  });

  elements.statementSearch.addEventListener("input", renderStatement);
  elements.statementDateFrom.addEventListener("change", renderStatement);
  elements.statementDateTo.addEventListener("change", renderStatement);
  elements.statementStatus.addEventListener("change", () => {
    selectedStatementEntries.clear();
    renderStatement();
  });
  ["receivedQuantity", "spoilageQuantity"].forEach((name) =>
    elements.deliveryForm.elements[name].addEventListener("input", updateAcceptedQuantity));
  elements.deliveryForm.elements.vendorName.addEventListener("input", updateReceivingItemForSelectedVendor);
  elements.changeReceivingItem.addEventListener("click", () => setReceivingItemLocked(false));
  elements.statementRows.addEventListener("click", handleStatementAction);
  elements.statementRows.addEventListener("change", handleStatementSelection);
  elements.selectAllStatementRows.addEventListener("change", toggleAllStatementRows);
  elements.selectStatementRange.addEventListener("click", selectAllStatementRange);
  elements.paySelectedRows.addEventListener("click", paySelectedStatementRows);
  elements.printPaidReport.addEventListener("click", printSelectedPaidReport);
  elements.markUnpaid.addEventListener("click", markSelectedVendorUnpaid);
  elements.clearPaidRecords.addEventListener("click", clearSelectedVendorPaidRecords);
  elements.exportCsv.addEventListener("click", exportStatementCsv);
  elements.printReport.addEventListener("click", printStatement);
  elements.historyRows.addEventListener("click", handleHistoryAction);
  elements.saveEdit.addEventListener("click", saveEditedEntry);
  ["receivedQuantity", "spoilageQuantity"].forEach((name) =>
    elements.editForm.elements[name].addEventListener("input", () => {
      try {
        const values = VendorQuantities.calculateAccepted(
          elements.editForm.elements.receivedQuantity.value,
          elements.editForm.elements.spoilageQuantity.value,
        );
        elements.editForm.elements.acceptedQuantity.value = values.accepted;
        elements.editForm.elements.spoilageQuantity.setCustomValidity("");
      } catch (error) {
        elements.editForm.elements.acceptedQuantity.value = "";
        elements.editForm.elements.spoilageQuantity.setCustomValidity(error.message);
      }
    }));
  elements.vendorList.addEventListener("click", handleVendorAction);
  elements.toggleVendorList.addEventListener("click", () => {
    vendorListOpen = !vendorListOpen;
    renderVendors();
  });
  elements.vendorSearch.addEventListener("input", () => {
    vendorListOpen = Boolean(elements.vendorSearch.value.trim());
    renderVendors();
  });
  elements.saveVendorEdit.addEventListener("click", saveEditedVendor);
}

function bindForms() {
  elements.vendorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!isAdmin()) {
      showToast("Only an admin can add vendors.");
      return;
    }

    const form = event.currentTarget;
    if (!form.elements.phone.value.trim()) {
      showToast("Enter a phone number for vendor login.");
      return;
    }
    try {
      const result = await databaseRequest("/vendor-accounts", { method: "POST", body: JSON.stringify({
        vendorName: form.elements.name.value.trim(), phone: form.elements.phone.value.trim(),
      }) });
      const saved = result.vendor;
      const vendor = { id: saved.id, accountId: saved.id, name: saved.vendorName, phone: saved.phone || "",
        email: saved.email || "", paymentMethod: form.elements.paymentMethod.value };
      const existingIndex = state.vendors.findIndex((item) => item.id === vendor.id);
      if (existingIndex >= 0) state.vendors[existingIndex] = vendor;
      else state.vendors.push(vendor);
      const notice = document.querySelector("#vendorCredentialNotice");
      notice.hidden = false;
      notice.innerHTML = result.created
        ? `Vendor portal login created. Store code: <strong>${escapeHtml(accessState.enterpriseCode || "your store code")}</strong>. Login: <strong>${escapeHtml(vendor.phone)}</strong>. Temporary password: <strong>${escapeHtml(result.temporaryPassword)}</strong>. Portal: <strong>/vendor-login</strong>`
        : `Existing vendor portal login updated for <strong>${escapeHtml(vendor.name)}</strong>.`;
      form.reset(); saveState(); render(); showToast("Vendor added with portal access.");
    } catch (error) { showToast(error.message); }
  });

  elements.deliveryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!addEntryFromForm(event.currentTarget, "DELIVERED")) return;
    event.currentTarget.reset();
    setReceivingItemLocked(false);
    setDefaultDates();
    showToast("Delivery saved.");
  });

}

function setReceivingItemLocked(locked) {
  const form = elements.deliveryForm;
  [form.elements.product, form.elements.unit, form.elements.unitPrice].forEach((field) => {
    field.disabled = locked;
    field.setAttribute("aria-readonly", String(locked));
  });
  elements.changeReceivingItem.hidden = !locked;
}

function updateReceivingItemForSelectedVendor() {
  const form = elements.deliveryForm;
  const wanted = normalizeSearch(form.elements.vendorName.value);
  const vendor = state.vendors.find((item) => normalizeSearch(item.name) === wanted);
  if (!vendor) {
    form.elements.product.value = "";
    form.elements.unit.value = "piece";
    form.elements.unitPrice.value = "";
    setReceivingItemLocked(false);
    return;
  }
  const latest = [...state.entries]
    .filter((entry) => entry.type === "DELIVERED" && entry.vendorId === vendor.id)
    .sort((left, right) => String(right.createdAt || right.date).localeCompare(String(left.createdAt || left.date)))[0];
  const itemDefault = latest || vendor.receivingDefault;
  if (!itemDefault) {
    form.elements.product.value = "";
    form.elements.unit.value = "piece";
    form.elements.unitPrice.value = "";
    setReceivingItemLocked(false);
    return;
  }
  form.elements.product.value = itemDefault.product;
  form.elements.unit.value = itemDefault.unit;
  form.elements.unitPrice.value = itemDefault.unitPrice;
  setReceivingItemLocked(true);
}

function addEntryFromForm(form, type) {
  let vendorId;
  let quantities;
  try {
    vendorId = resolveAkrabiId(form);
    quantities = type === "DELIVERED"
      ? VendorQuantities.calculateAccepted(form.elements.receivedQuantity.value, form.elements.spoilageQuantity.value)
      : VendorQuantities.calculateAccepted(form.elements.quantity.value, form.elements.quantity.value);
  } catch (error) {
    showReceivingError(error.message);
    return false;
  }
  const entry = {
    id: makeId(),
    date: form.elements.date.value,
    vendorId,
    vendorName: findVendor(vendorId).name,
    product: cleanName(form.elements.product.value),
    type,
    quantity: quantities.accepted,
    receivedQuantity: quantities.received,
    spoilageQuantity: quantities.spoilage,
    acceptedQuantity: quantities.accepted,
    unit: form.elements.unit ? form.elements.unit.value : inferUnit(form.elements.product.value),
    unitPrice: Number(form.elements.unitPrice.value),
    note: form.elements.note ? form.elements.note.value.trim() : "",
    createdAt: new Date().toISOString()
  };

  state.entries.push(entry);
  const receivingVendor = findVendor(entry.vendorId);
  if (receivingVendor) receivingVendor.receivingDefault = {
    product: entry.product, unit: entry.unit, unitPrice: entry.unitPrice,
  };
  state.activeMonth = entry.date.slice(0, 7);
  elements.activeMonth.value = state.activeMonth;
  setStatementDateRangeForMonth();
  saveState();
  render();
  syncEntryToDatabase(entry)
    .then(showVendorEmailStatus)
    .catch((error) => showToast(`${actionLabel(type)} saved locally. ${error.message}`));
  return true;
}

function render() {
  elements.monthTitle.textContent = formatMonth(state.activeMonth);
  renderVendorOptions();
  renderDashboard();
  renderVendors();
  renderStatement();
  renderSpoilageHistory();
}

function renderSpoilageHistory() {
  const target = document.querySelector("#spoilageHistoryRows");
  if (!target) return;
  target.innerHTML = (state.spoilageHistory || []).map((item) => `
    <tr>
      <td>${formatCreatedAt(item.recordedAt)}</td>
      <td>${escapeHtml(item.vendorName)}</td>
      <td>${escapeHtml(item.product || "Unspecified product")}</td>
      <td>${formatQty(item.receivedQuantity)}</td>
      <td>${formatQty(item.spoilageQuantity)}</td>
      <td>${formatQty(item.acceptedQuantity)}</td>
      <td>${escapeHtml(item.recordedBy || "—")}</td>
    </tr>`).join("") || emptyRow("No spoilage has been recorded.", 7);
}

function renderVendorOptions() {
  const options = state.vendors
    .map((vendor) => `<option value="${vendor.id}">${escapeHtml(vendor.name)}</option>`)
    .join("");

  document.querySelectorAll('select[name="vendorId"]').forEach((select) => {
    const selected = select.value;
    select.innerHTML = options || '<option value="" disabled selected>Add vendor first</option>';
    if (selected) select.value = selected;
  });

  elements.akrabiOptions.innerHTML = state.vendors
    .map((vendor) => `<option value="${escapeHtml(vendor.name)}"></option>`)
    .join("");
  document.querySelector("#receivingVendorOptions").innerHTML = state.vendors
    .map((vendor) => `<option value="${escapeHtml(vendor.name)}">${escapeHtml([vendor.phone, vendor.email, vendor.id].filter(Boolean).join(" | "))}</option>`)
    .join("");

}

function updateAcceptedQuantity() {
  const form = elements.deliveryForm;
  try {
    const values = VendorQuantities.calculateAccepted(form.elements.receivedQuantity.value, form.elements.spoilageQuantity.value);
    form.elements.acceptedQuantity.value = values.accepted;
    showReceivingError("");
  } catch (error) {
    form.elements.acceptedQuantity.value = "";
    showReceivingError(error.message);
  }
}

function showReceivingError(message) {
  const error = document.querySelector("#receivingQuantityError");
  error.textContent = message;
  error.hidden = !message;
  elements.deliveryForm.elements.spoilageQuantity.setCustomValidity(message || "");
}

function resolveAkrabiId(form) {
  if (form.elements.vendorId) return form.elements.vendorId.value;

  const typedName = cleanName(form.elements.vendorName.value).toLowerCase();
  const vendor = state.vendors.find((item) => item.name.toLowerCase() === typedName);
  if (vendor) return vendor.id;
  throw new Error("Select a saved vendor from the searchable list.");
}

function renderDashboard() {
  const monthEntries = entriesForActiveMonth();
  const totals = calculateTotals(monthEntries);
  elements.metricReceived.textContent = money.format(totals.receivedValue);
  elements.metricSpoiled.textContent = money.format(totals.spoiledValue + totals.returnedValue);
  elements.metricPayable.textContent = money.format(totals.payableValue);
  elements.metricVendors.textContent = String(new Set(monthEntries.map((entry) => entry.vendorId)).size);

  const rows = groupByVendor(monthEntries)
    .map(({ vendor, totals: vendorTotals }) => `
      <tr>
        <td><strong>${escapeHtml(vendor.name)}</strong></td>
        <td>${money.format(vendorTotals.receivedValue)}</td>
        <td class="amount-warning">${money.format(vendorTotals.spoiledValue + vendorTotals.returnedValue)}</td>
        <td class="amount-positive">${money.format(vendorTotals.payableValue)}</td>
      </tr>
    `)
    .join("");

  elements.vendorBalanceRows.innerHTML = rows || emptyRow("No activity for this month.", 4);

  const recent = [...monthEntries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3)
    .map((entry) => {
      const vendor = findVendor(entry.vendorId);
      return `
        <div class="activity-item">
          <strong>${escapeHtml(actionLabel(entry.type))}: ${escapeHtml(entry.product)}</strong>
          <span>${escapeHtml(vendor.name)} | ${formatQty(entry.quantity)} ${escapeHtml(entry.unit)} | ${formatDate(entry.date)}</span>
        </div>
      `;
    })
    .join("");

  elements.activityList.innerHTML = recent || `<div class="activity-item"><strong>No activity yet</strong><span>Record a delivery to begin.</span></div>`;
  renderHistory();
}

function renderHistory() {
  const rows = [...state.entries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((entry) => {
      const vendor = findVendor(entry.vendorId);
      const sign = entry.type === "DELIVERED" ? 1 : -1;
      const value = entry.quantity * entry.unitPrice * sign;

      return `
        <tr>
          <td>${formatDate(entry.date)}</td>
          <td>${formatCreatedAt(entry.createdAt)}</td>
          <td>${escapeHtml(vendor.name)}</td>
          <td>${escapeHtml(actionLabel(entry.type))}</td>
          <td><strong>${escapeHtml(entry.product)}</strong></td>
          <td>${formatQty(entry.receivedQuantity ?? entry.quantity)} ${escapeHtml(entry.unit)}</td>
          <td>${formatQty(entry.spoilageQuantity || 0)} ${escapeHtml(entry.unit)}</td>
          <td>${formatQty(entry.acceptedQuantity ?? entry.quantity)} ${escapeHtml(entry.unit)}</td>
          <td>${money.format(entry.unitPrice)}</td>
          <td class="${value < 0 ? "amount-warning" : "amount-positive"}">${money.format(value)}</td>
          <td>
            <button class="text-action" data-edit-entry="${entry.id}" type="button">Edit</button>
            <button class="text-action danger-text" data-delete-entry="${entry.id}" type="button">Delete</button>
          </td>
        </tr>
      `;
    })
    .join("");

  elements.historyRows.innerHTML = rows || emptyRow("No saved records yet.", 11);
}

function handleHistoryAction(event) {
  const editButton = event.target.closest("[data-edit-entry]");
  if (editButton) {
    openEditDialog(editButton.dataset.editEntry);
    return;
  }

  const button = event.target.closest("[data-delete-entry]");
  if (!button) return;

  deleteEntry(button.dataset.deleteEntry);
}

function deleteEntry(entryId) {
  if (!isAdmin()) {
    showToast("Only an admin can delete records.");
    return;
  }

  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;

  const ok = window.confirm(`Delete ${actionLabel(entry.type)} record for ${entry.product} on ${formatDate(entry.date)}?`);
  if (!ok) return;

  state.entries = state.entries.filter((item) => item.id !== entryId);
  saveState();
  render();
  if (entry.databaseId) {
    databaseRequest(`/vendors/${encodeURIComponent(entry.databaseId)}`, { method: "DELETE" })
      .catch((error) => showToast(error.message));
  }
  showToast("Record deleted.");
}

function openEditDialog(entryId) {
  if (!isAdmin()) {
    showToast("Only an admin can edit records.");
    return;
  }

  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;

  const form = elements.editForm;
  form.elements.id.value = entry.id;
  form.elements.date.value = entry.date;
  form.elements.product.value = entry.product;
  form.elements.receivedQuantity.value = entry.receivedQuantity ?? entry.quantity;
  form.elements.spoilageQuantity.value = entry.spoilageQuantity || 0;
  form.elements.acceptedQuantity.value = entry.acceptedQuantity ?? entry.quantity;
  form.elements.unit.value = entry.unit;
  form.elements.unitPrice.value = entry.unitPrice;
  form.elements.note.value = entry.note || "";
  elements.editDialog.showModal();
}

function saveEditedEntry() {
  const form = elements.editForm;
  if (!form.reportValidity()) return;

  const entry = state.entries.find((item) => item.id === form.elements.id.value);
  if (!entry) return;

  let quantities;
  try {
    quantities = VendorQuantities.calculateAccepted(form.elements.receivedQuantity.value, form.elements.spoilageQuantity.value);
  } catch (error) {
    form.elements.spoilageQuantity.setCustomValidity(error.message);
    form.reportValidity();
    return;
  }
  form.elements.spoilageQuantity.setCustomValidity("");
  entry.date = form.elements.date.value;
  entry.product = cleanName(form.elements.product.value);
  entry.receivedQuantity = quantities.received;
  entry.spoilageQuantity = quantities.spoilage;
  entry.acceptedQuantity = quantities.accepted;
  entry.quantity = quantities.accepted;
  entry.unit = form.elements.unit.value;
  entry.unitPrice = Number(form.elements.unitPrice.value);
  entry.note = form.elements.note.value.trim();
  state.activeMonth = entry.date.slice(0, 7);
  elements.activeMonth.value = state.activeMonth;
  setStatementDateRangeForMonth();
  saveState();
  elements.editDialog.close();
  render();
  syncEntryToDatabase(entry)
    .then(showVendorEmailStatus)
    .catch((error) => showToast(`Record updated locally. ${error.message}`));
  showToast("Record updated.");
}

function renderVendors() {
  const query = elements.vendorSearch.value.trim().toLocaleLowerCase();
  const visibleVendors = query
    ? state.vendors.filter((vendor) =>
        [vendor.name, vendor.phone, vendor.email, vendor.paymentMethod]
          .some((value) => String(value || "").toLocaleLowerCase().includes(query)))
    : state.vendors;
  elements.vendorList.hidden = !vendorListOpen;
  elements.toggleVendorList.setAttribute("aria-expanded", String(vendorListOpen));
  elements.toggleVendorList.textContent = vendorListOpen
    ? "Hide Vendor List"
    : `Show Vendor List (${state.vendors.length})`;
  elements.vendorList.innerHTML = visibleVendors
    .map((vendor) => `
      <div class="vendor-item">
        <strong>${escapeHtml(vendor.name)}</strong>
        <span>${escapeHtml(vendorContactLine(vendor))}</span>
        <div class="vendor-actions">
          <button class="text-action" data-print-vendor="${vendor.id}" type="button">Print report</button>
          <button class="text-action" data-reset-vendor-password="${vendor.id}" type="button">Reset portal password</button>
          <button class="text-action" data-edit-vendor="${vendor.id}" type="button">Edit</button>
          <button class="text-action danger-text" data-delete-vendor="${vendor.id}" type="button">Delete</button>
        </div>
      </div>
    `)
    .join("") || (query
      ? `<div class="vendor-item"><strong>No matching vendor</strong><span>Try another name or phone number.</span></div>`
      : `<div class="vendor-item"><strong>No vendors yet</strong><span>Add the first vendor using the form.</span></div>`);
}

function handleVendorAction(event) {
  const resetButton = event.target.closest("[data-reset-vendor-password]");
  if (resetButton) {
    resetVendorPassword(resetButton.dataset.resetVendorPassword);
    return;
  }
  const printButton = event.target.closest("[data-print-vendor]");
  if (printButton) {
    printVendorReport(printButton.dataset.printVendor);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-vendor]");
  if (deleteButton) {
    deleteVendor(deleteButton.dataset.deleteVendor);
    return;
  }

  const button = event.target.closest("[data-edit-vendor]");
  if (!button) return;

  if (!isAdmin()) {
    showToast("Only an admin can edit vendors.");
    return;
  }

  const vendor = state.vendors.find((item) => item.id === button.dataset.editVendor);
  if (!vendor) return;

  const form = elements.vendorEditForm;
  form.elements.id.value = vendor.id;
  form.elements.name.value = vendor.name;
  form.elements.phone.value = vendor.phone || "";
  form.elements.paymentMethod.value = vendor.paymentMethod;
  elements.vendorDialog.showModal();
}

async function resetVendorPassword(vendorId) {
  if (!isAdmin()) { showToast("Only the owner can reset vendor passwords."); return; }
  const vendor = state.vendors.find((item) => item.id === vendorId);
  if (!vendor) return;
  if (!window.confirm(`Reset the portal password for ${vendor.name}? Their old password will stop working.`)) return;
  try {
    const result = await databaseRequest(`/vendor-accounts/${encodeURIComponent(vendorId)}/reset-password`, {
      method: "POST", body: "{}",
    });
    const notice = document.querySelector("#vendorCredentialNotice");
    notice.hidden = false;
    notice.innerHTML = `Vendor portal password reset. Store code: <strong>${escapeHtml(accessState.enterpriseCode || "your store code")}</strong>. Login: <strong>${escapeHtml(result.vendor.phone || result.vendor.email)}</strong>. Temporary password: <strong>${escapeHtml(result.temporaryPassword)}</strong>. Portal: <strong>/vendor-login</strong>`;
    notice.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast("New temporary vendor password created.");
  } catch (error) { showToast(error.message); }
}

function deleteVendor(vendorId) {
  if (!isAdmin()) {
    showToast("Only an admin can delete vendors.");
    return;
  }

  const vendor = state.vendors.find((item) => item.id === vendorId);
  if (!vendor) return;

  const recordCount = state.entries.filter((entry) => entry.vendorId === vendorId).length;
  if (recordCount > 0) {
    showToast(`Delete this vendor's ${recordCount} saved record(s) first.`);
    return;
  }

  const ok = window.confirm(`Delete vendor ${vendor.name}?`);
  if (!ok) return;

  state.vendors = state.vendors.filter((item) => item.id !== vendorId);
  state.payments = state.payments.filter((payment) => payment.vendorId !== vendorId);
  saveState();
  render();
  showToast("Vendor deleted.");
}

function saveEditedVendor() {
  const form = elements.vendorEditForm;
  if (!form.reportValidity()) return;

  const vendor = state.vendors.find((item) => item.id === form.elements.id.value);
  if (!vendor) return;

  vendor.name = cleanName(form.elements.name.value);
  vendor.phone = form.elements.phone.value.trim();
  vendor.paymentMethod = form.elements.paymentMethod.value;
  saveState();
  elements.vendorDialog.close();
  render();
  showToast("Vendor updated.");
}

function renderStatement() {
  const searchText = normalizeSearch(elements.statementSearch.value);
  const statementEntries = getStatementEntries(searchText);
  const showingPaid = elements.statementStatus.value === "paid";
  const hasSearch = Boolean(searchText);
  const hasResults = statementEntries.length > 0;
  const invalidRange = elements.statementDateFrom.value && elements.statementDateTo.value
    && elements.statementDateFrom.value > elements.statementDateTo.value;
  elements.statementEmpty.textContent = invalidRange
    ? "From date cannot be after To date."
    : hasSearch
    ? (showingPaid ? "No paid records found for that vendor." : "No unpaid statement found for that vendor.")
    : "Type a vendor name to display their statement.";
  elements.statementEmpty.hidden = hasResults;
  elements.statementOverview.hidden = !hasResults;
  elements.statementTableWrap.hidden = !hasResults;
  elements.statementTotalBar.hidden = !hasResults;
  elements.paymentBar.hidden = !hasResults;
  elements.paySelectedRows.hidden = showingPaid;
  elements.markUnpaid.hidden = !showingPaid;
  elements.printPaidReport.hidden = !showingPaid;
  elements.clearPaidRecords.hidden = !showingPaid;
  elements.selectStatementRange.textContent = showingPaid ? "Select all paid records" : "Select all in range";
  document.querySelector("#statementSubtext").textContent = searchText
    ? `${showingPaid ? "Paid records" : "Unpaid statement"} for "${elements.statementSearch.value.trim()}"`
    : "Type a vendor name to display their statement.";


  elements.statementRows.innerHTML = [...statementEntries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry, index) => {
      const vendor = findVendor(entry.vendorId);
      const isDelivered = entry.type === "DELIVERED";
      const quantity = Number(entry.quantity) || 0;
      const unitPrice = Number(entry.unitPrice) || 0;
      const payableQty = isDelivered ? quantity : -quantity;
      const amount = payableQty * unitPrice;
      const payment = state.payments.find((item) =>
        item.vendorId === entry.vendorId
        && item.month === entry.date.slice(0, 7)
        && (!Array.isArray(item.entryIds) || item.entryIds.includes(String(entry.id))));
      const paid = isEntryPaid(entry);
      const paymentStatus = paid ? `Paid ${formatDate(payment?.date || entry.updatedAt || entry.date)}` : "Unpaid";

      return `
      <tr>
        <td class="sheet-select-column">
          <input class="statement-row-select" type="checkbox" data-select-entry="${entry.id}" aria-label="Select row ${index + 1}" ${selectedStatementEntries.has(String(entry.id)) ? "checked" : ""}>
        </td>
        <td class="sheet-row-number" aria-label="Row ${index + 1}">${index + 1}</td>
        <td data-label="Date & time" class="statement-date-time">
          <strong>${formatDate(entry.date)}</strong>
          <span>${formatCreatedTime(entry.createdAt)}</span>
        </td>
        <td data-label="Product"><strong>${escapeHtml(entry.product)}</strong></td>
        <td data-label="Received">${formatQty(isDelivered ? (entry.receivedQuantity ?? quantity) : 0)} ${escapeHtml(entry.unit)}</td>
        <td data-label="Spoilage">${formatQty(isDelivered ? (entry.spoilageQuantity || 0) : (entry.type === "SPOILED" ? quantity : 0))} ${escapeHtml(entry.unit)}</td>
        <td data-label="Accepted"><strong>${formatQty(payableQty)} ${escapeHtml(entry.unit)}</strong></td>
        <td data-label="Unit price">${money.format(unitPrice)}</td>
        <td data-label="Amount" class="${amount < 0 ? "amount-warning" : "amount-positive"}">${money.format(amount)}</td>
        <td data-label="Status"><span class="status-pill ${paid ? "paid" : "unpaid"}">${paymentStatus}</span></td>
      </tr>
      `;
    })
    .join("") || emptyRow("No statement activity for this selection.", 10);

  const totals = calculateTotals(statementEntries);
  const statementVendorNames = [...new Set(statementEntries.map((entry) => findVendor(entry.vendorId)?.name).filter(Boolean))];
  elements.statementHeadingVendor.textContent = statementVendorNames.length === 1
    ? statementVendorNames[0]
    : statementVendorNames.length > 1 ? `${statementVendorNames.length} vendors` : "All vendors";
  elements.statementHeadingPeriod.textContent = formatStatementDateRange();
  const visibleIds = new Set(statementEntries.map((entry) => String(entry.id)));
  for (const id of selectedStatementEntries) {
    if (!visibleIds.has(id)) selectedStatementEntries.delete(id);
  }
  elements.selectAllStatementRows.checked = hasResults
    && statementEntries.every((entry) => selectedStatementEntries.has(String(entry.id)));
  elements.selectAllStatementRows.indeterminate = selectedStatementEntries.size > 0
    && !elements.selectAllStatementRows.checked;
  elements.paySelectedRows.textContent = selectedStatementEntries.size
    ? `Mark selected as paid (${selectedStatementEntries.size})`
    : "Mark selected as paid";
  elements.statementTotal.textContent = money.format(totals.payableValue);
  elements.statementFooterTotal.textContent = money.format(totals.payableValue);
  elements.statementTotalLabel.textContent = showingPaid ? "Total paid records" : "Total amount due";
  elements.statementFooterLabel.textContent = showingPaid ? "Paid total" : "Amount due";
  elements.statementAcceptedTotal.textContent = formatStatementAcceptedTotal(statementEntries);
  updatePrintReportHeader(statementEntries);
  renderPaymentStatus();
}

function handleStatementSelection(event) {
  const checkbox = event.target.closest("[data-select-entry]");
  if (!checkbox) return;
  const entryId = String(checkbox.dataset.selectEntry);
  if (checkbox.checked) selectedStatementEntries.add(entryId);
  else selectedStatementEntries.delete(entryId);
  elements.paySelectedRows.textContent = selectedStatementEntries.size
    ? `Mark selected as paid (${selectedStatementEntries.size})`
    : "Mark selected as paid";
  resetClearPaidButton();
  renderPaymentStatus();
}

function toggleAllStatementRows() {
  const checkboxes = elements.statementRows.querySelectorAll("[data-select-entry]");
  checkboxes.forEach((checkbox) => {
    checkbox.checked = elements.selectAllStatementRows.checked;
    const entryId = String(checkbox.dataset.selectEntry);
    if (checkbox.checked) selectedStatementEntries.add(entryId);
    else selectedStatementEntries.delete(entryId);
  });
  elements.paySelectedRows.textContent = selectedStatementEntries.size
    ? `Mark selected as paid (${selectedStatementEntries.size})`
    : "Mark selected as paid";
  resetClearPaidButton();
  renderPaymentStatus();
}

function selectAllStatementRange() {
  const checkboxes = elements.statementRows.querySelectorAll("[data-select-entry]");
  checkboxes.forEach((checkbox) => {
    checkbox.checked = true;
    selectedStatementEntries.add(String(checkbox.dataset.selectEntry));
  });
  elements.selectAllStatementRows.checked = checkboxes.length > 0;
  elements.selectAllStatementRows.indeterminate = false;
  elements.paySelectedRows.textContent = selectedStatementEntries.size
    ? `Mark selected as paid (${selectedStatementEntries.size})`
    : "Mark selected as paid";
  resetClearPaidButton();
  renderPaymentStatus();
}

async function paySelectedStatementRows() {
  if (!isAdmin()) {
    showToast("Only an admin can mark payments paid.");
    return;
  }

  const selectedEntries = state.entries.filter((entry) => selectedStatementEntries.has(String(entry.id)));
  const vendorIds = [...new Set(selectedEntries.map((entry) => entry.vendorId))];
  if (!vendorIds.length) {
    showToast("Select at least one statement row to pay.");
    return;
  }
  const databaseIds = [...new Set(selectedEntries.map((entry) => entry.databaseId).filter(Boolean))];
  if (databaseIds.length) {
    try {
      await databaseRequest("/vendors/mark-paid", {
        method: "POST",
        body: JSON.stringify({ ids: databaseIds }),
      });
    } catch (error) {
      showToast(error.message);
      return;
    }
  }

  vendorIds.forEach((vendorId) => {
    const vendorEntries = selectedEntries.filter((entry) => entry.vendorId === vendorId);
    const months = [...new Set(vendorEntries.map((entry) => entry.date.slice(0, 7)))];
    months.forEach((month) => {
      const monthEntries = vendorEntries.filter((entry) => entry.date.startsWith(month));
      const selectedIds = monthEntries.map((entry) => String(entry.id));
      const existing = state.payments.find(
        (item) => item.vendorId === vendorId && item.month === month,
      );
      if (existing) {
        const currentIds = Array.isArray(existing.entryIds) ? existing.entryIds : [];
        existing.entryIds = [...new Set([...currentIds, ...selectedIds])];
        const paidEntries = state.entries.filter((entry) =>
          entry.vendorId === vendorId
          && entry.date.startsWith(month)
          && existing.entryIds.includes(String(entry.id)));
        existing.amount = calculateTotals(paidEntries).payableValue;
        existing.date = localDateString();
      } else {
        state.payments.push({
          id: makeId(),
          vendorId,
          month,
          amount: calculateTotals(monthEntries).payableValue,
          date: localDateString(),
          entryIds: selectedIds,
        });
      }
    });
  });
  selectedEntries.forEach((entry) => { entry.status = "paid"; });
  selectedStatementEntries.clear();

  saveState();
  renderStatement();
  showToast(`${vendorIds.length} vendor statement${vendorIds.length === 1 ? "" : "s"} marked paid.`);
}

function updatePrintReportHeader(entries) {
  elements.printStoreName.textContent = `Store: ${accessState.enterpriseName || "Store"}`;
  elements.printGeneratedDate.textContent = `Printed: ${new Date().toLocaleString()}`;
  const vendorIds = [...new Set(entries.map((entry) => entry.vendorId))];
  if (vendorIds.length !== 1) {
    elements.printVendorName.textContent = "";
    elements.printReportPeriod.textContent = "";
    return;
  }

  const vendor = findVendor(vendorIds[0]);
  const dates = entries.map((entry) => entry.date).sort();
  elements.printVendorName.textContent = `Vendor: ${vendor.name}`;
  elements.printReportPeriod.textContent = dates.length
    ? `Report period: ${formatDate(dates[0])} to ${formatDate(dates[dates.length - 1])}`
    : "";
}

function formatStatementAcceptedTotal(entries) {
  const units = [...new Set(entries.map((entry) => entry.unit).filter(Boolean))];
  if (units.length !== 1) return units.length ? "Multiple units" : "0";
  const total = entries.reduce((sum, entry) => {
    const quantity = Number(entry.acceptedQuantity ?? entry.quantity) || 0;
    return sum + (entry.type === "DELIVERED" ? quantity : -Number(entry.quantity || 0));
  }, 0);
  return `${formatQty(total)} ${units[0]}`;
}

function matchesStatementSearch(entry, searchText) {
  if (!searchText) return true;
  return normalizeSearch(getEntryAkrabiName(entry)).includes(searchText);
}

function getStatementEntries(searchText) {
  if (!searchText) return [];
  const dateFrom = elements.statementDateFrom.value;
  const dateTo = elements.statementDateTo.value;
  if (dateFrom && dateTo && dateFrom > dateTo) return [];
  const showingPaid = elements.statementStatus.value === "paid";
  return state.entries.filter((entry) =>
    (!dateFrom || entry.date >= dateFrom)
    && (!dateTo || entry.date <= dateTo)
    && matchesStatementSearch(entry, searchText) && isEntryPaid(entry) === showingPaid);
}

function formatStatementDateRange() {
  const dateFrom = elements.statementDateFrom.value;
  const dateTo = elements.statementDateTo.value;
  if (dateFrom && dateTo) return `${formatDate(dateFrom)} to ${formatDate(dateTo)}`;
  if (dateFrom) return `From ${formatDate(dateFrom)}`;
  if (dateTo) return `Through ${formatDate(dateTo)}`;
  return "All dates";
}

function findSingleStatementAkrabiId() {
  if (selectedStatementEntries.size) {
    const selectedVendorIds = [...new Set(
      state.entries
        .filter((entry) => selectedStatementEntries.has(String(entry.id)))
        .map((entry) => entry.vendorId),
    )];
    return selectedVendorIds.length === 1 ? selectedVendorIds[0] : null;
  }

  const searchText = normalizeSearch(elements.statementSearch.value);
  if (!searchText) return null;
  const matchingEntries = getStatementEntries(searchText);
  const matchingIds = [...new Set(matchingEntries.map((entry) => entry.vendorId))];
  return matchingIds.length === 1 ? matchingIds[0] : null;
}

function handleStatementAction(event) {
  const button = event.target.closest("[data-delete-entry]");
  if (!button) return;
  deleteEntry(button.dataset.deleteEntry);
}

function renderPaymentStatus() {
  const selectedEntries = state.entries.filter((entry) =>
    selectedStatementEntries.has(String(entry.id)));
  const paidEntries = selectedEntries.filter(isEntryPaid);
  const selectedVendorIds = [...new Set(selectedEntries.map((entry) => entry.vendorId))];

  elements.markUnpaid.title = paidEntries.length ? "" : "Select at least one paid row";
  elements.clearPaidRecords.title = paidEntries.length ? "" : "Select at least one paid row";
  elements.printPaidReport.title = selectedVendorIds.length > 1
    ? "Select paid rows from one vendor to print"
    : "";

  if (!selectedEntries.length) {
    elements.paymentStatus.textContent = "Select one or more statement rows.";
    return;
  }

  elements.paymentStatus.textContent =
    `${selectedEntries.length} selected - ${paidEntries.length} paid - ${selectedEntries.length - paidEntries.length} unpaid`;
}

function isEntryPaid(entry) {
  if (entry.status === "paid") return true;
  const payment = state.payments.find((item) =>
    item.vendorId === entry.vendorId && item.month === entry.date.slice(0, 7));
  return Boolean(payment && (!Array.isArray(payment.entryIds) || payment.entryIds.includes(String(entry.id))));
}

function resetClearPaidButton() {
  clearPaidArmed = false;
  elements.clearPaidRecords.textContent = "Clear paid records";
}

function printSelectedPaidReport() {
  const vendorId = findSingleStatementAkrabiId();
  if (!vendorId) {
    showToast("Select paid rows from one vendor first.");
    return;
  }

  const vendor = findVendor(vendorId);
  const selectedIds = [...selectedStatementEntries];
  const reportEntries = entriesForActiveMonth().filter((entry) =>
    entry.vendorId === vendorId
    && (!selectedIds.length || selectedIds.includes(String(entry.id)))
    && isEntryPaid(entry));
  if (!reportEntries.length) {
    showToast("Select at least one paid record.");
    return;
  }

  const reportRows = [...reportEntries]
    .sort((a, b) => `${a.date}${a.createdAt || ""}`.localeCompare(`${b.date}${b.createdAt || ""}`))
    .map((entry, index) => {
      const sign = entry.type === "DELIVERED" ? 1 : -1;
      const amount = Number(entry.quantity) * Number(entry.unitPrice) * sign;
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(formatDate(entry.date))}<br><small>${escapeHtml(formatCreatedTime(entry.createdAt))}</small></td>
        <td>${escapeHtml(entry.product)}</td>
        <td>${escapeHtml(actionLabel(entry.type))}</td>
        <td>${escapeHtml(formatQty(entry.quantity))} ${escapeHtml(entry.unit)}</td>
        <td>${escapeHtml(money.format(Number(entry.unitPrice)))}</td>
        <td>${escapeHtml(money.format(amount))}</td>
      </tr>`;
    })
    .join("");

  const printWindow = window.open("", "_blank", "width=960,height=760");
  if (!printWindow) {
    showToast("Allow pop-ups to print the paid report.");
    return;
  }

  printWindow.document.write(`<!doctype html>
    <html><head><title>Paid report - ${escapeHtml(vendor.name)}</title>
    <style>
      body{font-family:Arial,sans-serif;color:#17211b;margin:32px}
      h1{font-size:22px;margin:0 0 8px}.meta{display:flex;gap:28px;flex-wrap:wrap;margin:0 0 22px}
      .meta span{font-size:14px}.paid{color:#17633a;font-weight:800}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{border:1px solid #9eaaa2;padding:9px;text-align:left}
      th{background:#e8f0ea}.quantity-report{margin:0 0 20px}.quantity-report h2{font-size:16px;margin:0 0 8px}.total{margin-top:18px;text-align:right;font-size:20px;font-weight:800}
      .footer{margin-top:30px;border-top:1px solid #ccd4ce;padding-top:12px;font-size:12px;color:#66736a}
      @media print{body{margin:14mm}.no-print{display:none}}
    </style></head><body>
    <h1>NaziCredit Paid Vendor Report</h1>
    <div class="meta">
      <span><strong>Vendor:</strong> ${escapeHtml(vendor.name)}</span>
      <span><strong>Month:</strong> ${escapeHtml(formatMonth(state.activeMonth))}</span>
      <span><strong>Paid date:</strong> ${escapeHtml(formatDate(payment.date))}</span>
      <span class="paid">STATUS: PAID</span>
    </div>
    <table><thead><tr><th>#</th><th>Date & time</th><th>Product</th><th>Type</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr></thead>
    <tbody>${reportRows}</tbody></table>
    <div class="total">Total paid: ${escapeHtml(money.format(calculateTotals(reportEntries).payableValue))}</div>
    <div class="footer">Printed from NaziCredit on ${escapeHtml(new Date().toLocaleString())}</div>
    <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`);
  printWindow.document.close();
  showToast("Paid report opened for printing.");
}

function markSelectedVendorPaid() {
  if (!isAdmin()) {
    showToast("Only an admin can mark payments paid.");
    return;
  }

  const vendorId = findSingleStatementAkrabiId();
  if (!vendorId) return;

  const monthEntries = entriesForActiveMonth().filter((entry) => entry.vendorId === vendorId);
  const amount = calculateTotals(monthEntries).payableValue;
  const existing = state.payments.find((item) => item.vendorId === vendorId && item.month === state.activeMonth);

  if (existing) {
    existing.amount = amount;
    existing.date = localDateString();
    existing.entryIds = monthEntries.map((entry) => String(entry.id));
  } else {
    state.payments.push({
      id: makeId(),
      vendorId,
      month: state.activeMonth,
      amount,
      date: localDateString(),
      entryIds: monthEntries.map((entry) => String(entry.id))
    });
  }

  saveState();
  renderStatement();
  showToast("Payment marked paid.");
}

async function markSelectedVendorUnpaid() {
  if (!isAdmin()) {
    showToast("Only an admin can change payment status.");
    return;
  }

  const selectedEntries = state.entries.filter((entry) =>
    selectedStatementEntries.has(String(entry.id)) && isEntryPaid(entry));
  if (!selectedEntries.length) {
    showToast("Select at least one paid row.");
    return;
  }
  const databaseIds = [...new Set(selectedEntries.map((entry) => entry.databaseId).filter(Boolean))];
  if (databaseIds.length) {
    try {
      await databaseRequest("/vendors/mark-unpaid", {
        method: "POST",
        body: JSON.stringify({ ids: databaseIds }),
      });
    } catch (error) {
      showToast(error.message);
      return;
    }
  }

  const vendorIds = [...new Set(selectedEntries.map((entry) => entry.vendorId))];
  vendorIds.forEach((vendorId) => {
    const payment = state.payments.find(
      (item) => item.vendorId === vendorId && item.month === state.activeMonth);
    if (!payment) return;
    const monthEntries = entriesForActiveMonth().filter((entry) => entry.vendorId === vendorId);
    const paidIds = Array.isArray(payment.entryIds)
      ? payment.entryIds
      : monthEntries.map((entry) => String(entry.id));
    const selectedIdsForVendor = new Set(
      selectedEntries.filter((entry) => entry.vendorId === vendorId).map((entry) => String(entry.id)));
    payment.entryIds = paidIds.filter((id) => !selectedIdsForVendor.has(String(id)));
    const remainingPaid = monthEntries.filter((entry) => payment.entryIds.includes(String(entry.id)));
    payment.amount = calculateTotals(remainingPaid).payableValue;
    if (!payment.entryIds.length) {
      state.payments = state.payments.filter((item) => item !== payment);
    }
  });
  selectedEntries.forEach((entry) => { entry.status = "due"; });

  saveState();
  renderStatement();
  showToast(`${selectedEntries.length} selected record${selectedEntries.length === 1 ? "" : "s"} marked unpaid.`);
}

async function clearSelectedVendorPaidRecords() {
  if (!isAdmin()) {
    showToast("Only an admin can clear paid records.");
    return;
  }

  const paidEntries = state.entries.filter((entry) =>
    selectedStatementEntries.has(String(entry.id)) && isEntryPaid(entry));
  if (!paidEntries.length) {
    showToast("Select at least one paid row.");
    return;
  }

  if (!clearPaidArmed) {
    clearPaidArmed = true;
    elements.clearPaidRecords.textContent = `Click again to clear (${paidEntries.length})`;
    showToast("Click Clear paid records again to confirm.");
    return;
  }
  resetClearPaidButton();

  const databaseIds = [...new Set(paidEntries.map((entry) => entry.databaseId).filter(Boolean))];
  if (databaseIds.length) {
    try {
      await databaseRequest("/vendors/clear-paid", {
        method: "POST",
        body: JSON.stringify({ ids: databaseIds }),
      });
    } catch (error) {
      showToast(error.message);
      return;
    }
  }

  const clearedIds = new Set(paidEntries.map((entry) => String(entry.id)));
  state.entries = state.entries.filter((entry) => !clearedIds.has(String(entry.id)));
  state.payments.forEach((payment) => {
    if (!Array.isArray(payment.entryIds)) return;
    payment.entryIds = payment.entryIds.filter((id) => !clearedIds.has(String(id)));
    const remainingPaid = state.entries.filter((entry) =>
      entry.vendorId === payment.vendorId
      && entry.date.slice(0, 7) === payment.month
      && payment.entryIds.includes(String(entry.id)));
    payment.amount = calculateTotals(remainingPaid).payableValue;
  });
  state.payments = state.payments.filter((payment) =>
    !Array.isArray(payment.entryIds) || payment.entryIds.length > 0);
  selectedStatementEntries.clear();
  saveState();
  render();
  showToast(`${paidEntries.length} paid record${paidEntries.length === 1 ? "" : "s"} cleared.`);
}

function exportStatementCsv() {
  const searchText = normalizeSearch(elements.statementSearch.value);
  const monthEntries = getStatementEntries(searchText);
  if (monthEntries.length === 0) {
    showToast("Search a vendor with saved records before exporting.");
    return;
  }

  const rows = [["Vendor", "Date", "Time Created", "Product", "Received", "Spoiled", "Returned", "Payable Quantity", "Unit", "Amount"]];

  [...monthEntries].sort((a, b) => a.date.localeCompare(b.date)).forEach((entry) => {
    const vendor = findVendor(entry.vendorId);
    const payableQty = entry.type === "DELIVERED" ? entry.quantity : -entry.quantity;
    rows.push([
      vendor.name,
      formatDate(entry.date),
      formatCreatedAt(entry.createdAt),
      entry.product,
      entry.type === "DELIVERED" ? (entry.receivedQuantity ?? entry.quantity) : 0,
      entry.type === "DELIVERED" ? (entry.spoilageQuantity || 0) : (entry.type === "SPOILED" ? entry.quantity : 0),
      entry.type === "RETURNED" ? entry.quantity : 0,
      entry.type === "DELIVERED" ? (entry.acceptedQuantity ?? entry.quantity) : payableQty,
      entry.unit,
      (payableQty * entry.unitPrice).toFixed(2)
    ]);
  });

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `vendor-statement-${state.activeMonth}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("CSV downloaded.");
}

function printStatement() {
  const vendorId = findSingleStatementAkrabiId();
  if (!vendorId) {
    showToast("Search one specific vendor before printing.");
    return;
  }

  const searchText = normalizeSearch(elements.statementSearch.value);
  const statementEntries = getStatementEntries(searchText).filter((entry) => entry.vendorId === vendorId);
  if (statementEntries.length === 0) {
    showToast("Search a vendor with saved records before printing.");
    return;
  }

  window.print();
}

function printVendorReport(vendorId) {
  const vendor = findVendor(vendorId);
  const entries = state.entries.filter((entry) => entry.vendorId === vendorId);
  if (entries.length === 0) {
    showToast("This vendor has no saved records to print.");
    return;
  }

  elements.statementSearch.value = vendor.name;
  renderStatement();
  window.setTimeout(() => window.print(), 50);
}

function entriesForActiveMonth() {
  return state.entries.filter((entry) => entry.date.startsWith(state.activeMonth));
}

function normalizeSearch(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function calculateTotals(entries) {
  return entries.reduce(
    (totals, entry) => {
      const value = entry.quantity * entry.unitPrice;
      if (entry.type === "DELIVERED") {
        totals.dates.push(entry.date);
        const received = Number(entry.receivedQuantity ?? entry.quantity);
        const spoilage = Number(entry.spoilageQuantity || 0);
        const accepted = Number(entry.acceptedQuantity ?? entry.quantity);
        totals.deliveredQty += received;
        totals.spoiledQty += spoilage;
        totals.receivedValue += received * entry.unitPrice;
        totals.spoiledValue += spoilage * entry.unitPrice;
        totals.payableValue += accepted * entry.unitPrice;
      }
      if (entry.type === "SPOILED") {
        totals.dates.push(entry.date);
        totals.spoiledQty += entry.quantity;
        totals.spoiledValue += value;
        totals.payableValue -= value;
      }
      if (entry.type === "RETURNED") {
        totals.dates.push(entry.date);
        totals.returnedQty += entry.quantity;
        totals.returnedValue += value;
        totals.payableValue -= value;
      }
      totals.payableQty = totals.deliveredQty - totals.spoiledQty - totals.returnedQty;
      totals.dateRange = formatDateRange(totals.dates);
      return totals;
    },
    {
      deliveredQty: 0,
      spoiledQty: 0,
      returnedQty: 0,
      payableQty: 0,
      dates: [],
      dateRange: "",
      receivedValue: 0,
      spoiledValue: 0,
      returnedValue: 0,
      payableValue: 0
    }
  );
}

function groupByVendor(entries) {
  return state.vendors
    .map((vendor) => {
      const vendorEntries = entries.filter((entry) => entry.vendorId === vendor.id);
      return { vendor, entries: vendorEntries, totals: calculateTotals(vendorEntries) };
    })
    .filter((row) => row.entries.length > 0);
}

function groupByProduct(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    const key = `${entry.product}|${entry.unit}`;
    if (!groups.has(key)) {
      groups.set(key, { product: entry.product, unit: entry.unit, entries: [] });
    }
    groups.get(key).entries.push(entry);
  });

  return [...groups.values()]
    .map((group) => ({ ...group, totals: calculateTotals(group.entries) }))
    .sort((a, b) => a.product.localeCompare(b.product));
}

function groupByVendorProduct(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    const key = `${entry.vendorId}|${entry.product}|${entry.unit}`;
    if (!groups.has(key)) {
      groups.set(key, {
        vendor: findVendor(entry.vendorId),
        product: entry.product,
        unit: entry.unit,
        entries: []
      });
    }
    groups.get(key).entries.push(entry);
  });

  return [...groups.values()]
    .map((group) => ({ ...group, totals: calculateTotals(group.entries) }))
    .sort((a, b) => a.vendor.name.localeCompare(b.vendor.name) || a.product.localeCompare(b.product));
}

function findVendor(vendorId) {
  return state.vendors.find((vendor) => vendor.id === vendorId) || { name: "Unknown vendor" };
}

function getEntryAkrabiName(entry) {
  if (entry.vendorName) return entry.vendorName;
  return findVendor(entry.vendorId).name;
}

function cleanName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function vendorContactLine(vendor) {
  return [vendor.phone || "No phone", vendor.email || "No email", vendor.paymentMethod]
    .filter(Boolean)
    .join(" - ");
}

function inferUnit() {
  return "unit";
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatMonth(monthValue) {
  const [year, month] = monthValue.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function formatDate(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCreatedAt(createdAt) {
  if (!createdAt) return "Before time tracking";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Before time tracking";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatCreatedTime(createdAt) {
  if (!createdAt) return "Time unavailable";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDateRange(dates) {
  const uniqueDates = [...new Set(dates)].sort();
  if (uniqueDates.length === 0) return "";
  if (uniqueDates.length === 1) return formatDate(uniqueDates[0]);
  return `${formatDate(uniqueDates[0])} to ${formatDate(uniqueDates[uniqueDates.length - 1])}`;
}

function formatQty(value) {
  return Number(value.toFixed(2)).toString();
}

function actionLabel(type) {
  return {
    DELIVERED: "Received",
    SPOILED: "Spoiled",
    RETURNED: "Returned"
  }[type] || type;
}

function isAdmin() {
  return currentUser && currentUser.role === "Admin";
}

function emptyRow(message, columns) {
  return `<tr><td colspan="${columns}">${escapeHtml(message)}</td></tr>`;
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}
