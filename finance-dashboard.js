const demoMode = new URLSearchParams(location.search).get("demo") === "1";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const state = { entries: demoMode ? makeDemoEntries() : [], summary: emptySummary(), reports: { daily: [], monthly: [] }, reportMode: "daily", pendingDelete: "" };
const views = ["dashboard", "revenue", "expenses", "reports"];
const revenueForm = document.querySelector("#revenueForm");
const expenseForm = document.querySelector("#expenseForm");

init();

function init() {
  const today = localDate(new Date());
  revenueForm.elements.entryDate.value = today;
  expenseForm.elements.entryDate.value = today;
  bindNavigation();
  bindForms();
  bindTables();
  bindReports();
  bindDeleteDialog();
  bindClearAll();
  loadData();
}

function bindNavigation() {
  document.querySelectorAll("[data-view], [data-go]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view || button.dataset.go));
  });
  document.querySelector("#mobileMenu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
  document.querySelector("#logoutButton").addEventListener("click", () => location.href = "/logout");
}

function showView(name) {
  if (!views.includes(name)) return;
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelector(`#${name}View`).classList.add("active");
  document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  document.querySelector("#mobileTitle").textContent = titleCase(name);
  document.querySelector(".sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "reports") renderReports();
}

function bindForms() {
  [revenueForm, expenseForm].forEach((form) => {
    form.addEventListener("submit", saveEntry);
    form.querySelector(".cancel-edit").addEventListener("click", () => resetForm(form));
  });
  expenseForm.elements.receipt.addEventListener("change", () => {
    expenseForm.querySelector(".receipt-name").textContent = expenseForm.elements.receipt.files[0]?.name || "";
  });
}

async function saveEntry(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const status = form.querySelector(".form-status");
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  setStatus(status, "Saving…");
  try {
    const values = new FormData(form);
    const current = state.entries.find((entry) => entry.id === values.get("id"));
    const receipt = form.dataset.type === "expense" ? await readReceipt(form.elements.receipt.files[0], current) : {};
    const payload = {
      id: values.get("id") || undefined,
      entryType: form.dataset.type,
      amount: Number(values.get("amount")),
      category: values.get("category"),
      paymentMethod: values.get("paymentMethod") || "",
      entryDate: values.get("entryDate"),
      notes: values.get("notes"),
      ...receipt,
    };
    const path = payload.id ? `/finance/entries/${encodeURIComponent(payload.id)}` : "/finance/entries";
    await apiRequest(path, { method: payload.id ? "PATCH" : "POST", body: JSON.stringify(payload) });
    setStatus(status, `${titleCase(form.dataset.type)} saved.`);
    resetForm(form, true);
    await loadData();
  } catch (error) {
    setStatus(status, error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function readReceipt(file, current) {
  if (!file) return {
    receiptName: current?.receiptName || "",
    receiptType: current?.receiptType || "",
    receiptData: current?.receiptData || "",
  };
  if (file.size > 1_800_000) throw new Error("Receipt must be smaller than 1.8 MB");
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) throw new Error("Receipt must be a JPG, PNG, WebP, or PDF");
  const receiptData = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read receipt"));
    reader.readAsDataURL(file);
  });
  return { receiptName: file.name, receiptType: file.type, receiptData };
}

function resetForm(form, keepStatus = false) {
  const date = form.elements.entryDate.value || localDate(new Date());
  form.reset();
  form.elements.id.value = "";
  form.elements.entryDate.value = date;
  form.querySelector("h2").textContent = `Add ${titleCase(form.dataset.type)}`;
  form.querySelector('[type="submit"]').textContent = `Save ${titleCase(form.dataset.type)}`;
  form.querySelector(".cancel-edit").hidden = true;
  form.querySelector(".receipt-name")?.replaceChildren();
  if (!keepStatus) setStatus(form.querySelector(".form-status"), "");
}

function bindTables() {
  document.querySelectorAll("[data-search]").forEach((input) => input.addEventListener("input", renderTables));
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-entry-action]");
    if (!action) return;
    if (action.dataset.entryAction === "edit") editEntry(action.dataset.id);
    if (action.dataset.entryAction === "delete") openDelete(action.dataset.id);
  });
}

function editEntry(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  const form = entry.entryType === "revenue" ? revenueForm : expenseForm;
  form.elements.id.value = entry.id;
  form.elements.amount.value = entry.amount;
  form.elements.category.value = entry.category;
  if (form.elements.paymentMethod) form.elements.paymentMethod.value = entry.paymentMethod;
  form.elements.entryDate.value = entry.entryDate;
  form.elements.notes.value = entry.notes;
  form.querySelector("h2").textContent = `Edit ${titleCase(entry.entryType)}`;
  form.querySelector('[type="submit"]').textContent = "Save Changes";
  form.querySelector(".cancel-edit").hidden = false;
  if (entry.receiptName) form.querySelector(".receipt-name").textContent = `Current: ${entry.receiptName}`;
  showView(entry.entryType === "revenue" ? "revenue" : "expenses");
  form.elements.amount.focus();
}

function bindDeleteDialog() {
  document.querySelector("#confirmDelete").addEventListener("click", deleteEntry);
  document.querySelector("#cancelDelete").addEventListener("click", () => document.querySelector("#confirmDialog").close());
}

function bindClearAll() {
  const dialog = document.querySelector("#clearAllDialog");
  const input = document.querySelector("#clearAllConfirmation");
  const confirm = document.querySelector("#confirmClearAll");
  document.querySelector("#clearAllButton").addEventListener("click", () => {
    input.value = "";
    confirm.disabled = true;
    setStatus(document.querySelector("#clearAllStatus"), "");
    dialog.showModal();
    input.focus();
  });
  input.addEventListener("input", () => {
    confirm.disabled = input.value.trim() !== "CLEAR ALL";
  });
  document.querySelector("#cancelClearAll").addEventListener("click", () => dialog.close());
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    setStatus(document.querySelector("#clearAllStatus"), "Clearing…");
    try {
      await apiRequest("/finance/entries", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: input.value.trim() }),
      });
      dialog.close();
      await loadData();
    } catch (error) {
      setStatus(document.querySelector("#clearAllStatus"), error.message, true);
      confirm.disabled = false;
    }
  });
}

function openDelete(id) {
  state.pendingDelete = id;
  document.querySelector("#confirmDialog").showModal();
}

async function deleteEntry() {
  const button = document.querySelector("#confirmDelete");
  button.disabled = true;
  try {
    await apiRequest(`/finance/entries/${encodeURIComponent(state.pendingDelete)}`, { method: "DELETE" });
    document.querySelector("#confirmDialog").close();
    await loadData();
  } finally {
    button.disabled = false;
  }
}

function bindReports() {
  document.querySelectorAll("[data-report]").forEach((button) => button.addEventListener("click", () => {
    state.reportMode = button.dataset.report;
    document.querySelectorAll("[data-report]").forEach((item) => item.classList.toggle("active", item === button));
    renderReports();
  }));
}

async function loadData() {
  try {
    if (demoMode) {
      recalculateDemo();
    } else {
      const [entriesResult, summaryResult] = await Promise.all([apiRequest("/finance/entries"), apiRequest("/finance/summary")]);
      state.entries = entriesResult.entries || [];
      state.summary = summaryResult.summary || emptySummary();
      state.reports = summaryResult.reports || { daily: [], monthly: [] };
    }
    renderAll();
  } catch (error) {
    document.querySelector("#businessSummary").textContent = error.message;
  }
}

async function apiRequest(path, options = {}) {
  if (demoMode) return demoRequest(path, options);
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 401) {
    location.href = "/login";
    throw new Error("Login required");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || "Finance request failed");
  return result;
}

function demoRequest(path, options) {
  if (options.method === "DELETE" && path === "/finance/entries") {
    const input = JSON.parse(options.body || "{}");
    if (input.confirmation !== "CLEAR ALL") throw new Error("Type CLEAR ALL to confirm");
    state.entries = [];
    return { ok: true, deletedCount: 0 };
  }
  if (options.method === "POST") {
    const input = JSON.parse(options.body);
    const entry = { ...input, id: `demo-${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.entries.unshift(entry);
    return { ok: true, entry };
  }
  if (options.method === "PATCH") {
    const input = JSON.parse(options.body);
    const index = state.entries.findIndex((entry) => entry.id === input.id);
    state.entries[index] = { ...state.entries[index], ...input, updatedAt: new Date().toISOString() };
    return { ok: true, entry: state.entries[index] };
  }
  if (options.method === "DELETE") {
    const id = decodeURIComponent(path.split("/").pop());
    state.entries = state.entries.filter((entry) => entry.id !== id);
    return { ok: true };
  }
  return { ok: true };
}

function recalculateDemo() {
  const today = localDate(new Date());
  const weekStart = startOfWeek(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;
  const todayEntries = state.entries.filter((entry) => entry.entryDate === today);
  const sumType = (entries, type) => entries.filter((entry) => entry.entryType === type).reduce((sum, entry) => sum + Number(entry.amount), 0);
  const todayRevenue = sumType(todayEntries, "revenue");
  const todayExpenses = sumType(todayEntries, "expense");
  const rangeProfit = (from) => sumType(state.entries.filter((entry) => entry.entryDate >= from), "revenue") - sumType(state.entries.filter((entry) => entry.entryDate >= from), "expense");
  const categories = todayEntries.filter((entry) => entry.entryType === "expense").reduce((map, entry) => map.set(entry.category, (map.get(entry.category) || 0) + entry.amount), new Map());
  const biggest = [...categories].sort((a, b) => b[1] - a[1])[0] || ["", 0];
  state.summary = { todayRevenue, todayExpenses, todayProfit: todayRevenue - todayExpenses, weekProfit: rangeProfit(weekStart), monthProfit: rangeProfit(monthStart), biggestExpenseCategory: biggest[0], biggestExpenseAmount: biggest[1] };
  state.reports.daily = aggregateByDay(state.entries, 30);
  state.reports.monthly = aggregateByMonth(state.entries, 12);
}

function renderAll() {
  renderSummary();
  renderTables();
  renderRecent();
  renderReports();
}

function renderSummary() {
  const s = state.summary;
  ["todayRevenue", "todayExpenses", "todayProfit", "weekProfit", "monthProfit"].forEach((id) => document.querySelector(`#${id}`).textContent = money.format(s[id] || 0));
  document.querySelector("#briefRevenue").textContent = money.format(s.todayRevenue || 0);
  document.querySelector("#briefExpenses").textContent = money.format(s.todayExpenses || 0);
  document.querySelector("#briefProfit").textContent = money.format(s.todayProfit || 0);
  document.querySelector("#biggestExpense").textContent = s.biggestExpenseCategory ? `${titleCase(s.biggestExpenseCategory)} · ${money.format(s.biggestExpenseAmount)}` : "None today";
  const direction = s.todayProfit >= 0 ? "profit" : "loss";
  document.querySelector("#businessSummary").textContent = `Today the business earned ${money.format(s.todayRevenue)}, spent ${money.format(s.todayExpenses)}, and has a net ${direction} of ${money.format(Math.abs(s.todayProfit))}.`;
}

function renderRecent() {
  const entries = [...state.entries].sort(sortEntries).slice(0, 8);
  document.querySelector("#recentRows").innerHTML = entries.map((entry) => `<tr><td>${formatDate(entry.entryDate)}</td><td><span class="type-pill ${entry.entryType}">${entry.entryType}</span></td><td>${titleCase(entry.category)}</td><td>${titleCase(entry.paymentMethod || "—")}</td><td class="amount-${entry.entryType}">${entry.entryType === "expense" ? "−" : "+"}${money.format(entry.amount)}</td></tr>`).join("");
  document.querySelector("#recentEmpty").hidden = entries.length > 0;
}

function renderTables() {
  renderEntryTable("revenue");
  renderEntryTable("expense");
}

function renderEntryTable(type) {
  const query = document.querySelector(`[data-search="${type}"]`).value.trim().toLowerCase();
  const entries = state.entries.filter((entry) => entry.entryType === type && `${entry.category} ${entry.paymentMethod} ${entry.notes} ${entry.entryDate}`.toLowerCase().includes(query)).sort(sortEntries);
  const rows = document.querySelector(`#${type}Rows`);
  rows.innerHTML = entries.map((entry) => `
    <tr>
      <td>${formatDate(entry.entryDate)}</td><td>${titleCase(entry.category)}</td>
      ${type === "revenue" ? `<td>${titleCase(entry.paymentMethod)}</td><td>${escapeHtml(entry.notes || "—")}</td>` : `<td>${escapeHtml(entry.notes || "—")}</td><td>${entry.receiptData ? `<a class="receipt-link" href="${escapeHtml(entry.receiptData)}" target="_blank" rel="noopener">View</a>` : "—"}</td>`}
      <td class="amount-${type}">${type === "expense" ? "−" : "+"}${money.format(entry.amount)}</td>
      <td><div class="row-actions"><button class="row-action" data-entry-action="edit" data-id="${entry.id}" type="button">Edit</button><button class="row-action delete" data-entry-action="delete" data-id="${entry.id}" type="button">Delete</button></div></td>
    </tr>`).join("");
  document.querySelector(`#${type}Count`).textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
  document.querySelector(`#${type}Empty`).hidden = entries.length > 0;
}

function renderReports() {
  let rows;
  if (state.reportMode === "monthly") rows = state.reports.monthly.slice(-12);
  else if (state.reportMode === "weekly") rows = aggregateWeekly(state.reports.daily).slice(-12);
  else rows = state.reports.daily.slice(-14);
  document.querySelector("#chartTitle").textContent = state.reportMode === "daily" ? "Last 14 Days" : state.reportMode === "weekly" ? "Last 12 Weeks" : "Last 12 Months";
  const max = Math.max(1, ...rows.flatMap((row) => [row.revenue, row.expenses, Math.max(0, row.profit)]));
  document.querySelector("#reportChart").innerHTML = rows.length ? rows.map((row) => `<div class="chart-group" title="${escapeHtml(row.label)}: Revenue ${money.format(row.revenue)}, Expenses ${money.format(row.expenses)}, Profit ${money.format(row.profit)}"><div class="bar revenue" style="height:${Math.max(1, row.revenue / max * 100)}%"></div><div class="bar expense" style="height:${Math.max(1, row.expenses / max * 100)}%"></div><div class="bar profit" style="height:${Math.max(1, Math.max(0, row.profit) / max * 100)}%"></div><span class="chart-label">${shortLabel(row.label)}</span></div>`).join("") : '<p class="empty">Add entries to see your report.</p>';
  const totals = rows.reduce((sum, row) => ({ revenue: sum.revenue + row.revenue, expenses: sum.expenses + row.expenses }), { revenue: 0, expenses: 0 });
  document.querySelector("#reportRevenue").textContent = money.format(totals.revenue);
  document.querySelector("#reportExpenses").textContent = money.format(totals.expenses);
  document.querySelector("#reportProfit").textContent = money.format(totals.revenue - totals.expenses);
}

function makeDemoEntries() {
  const entries = [];
  const cats = ["grocery", "meat", "restaurant"];
  const expenseCats = ["product purchase", "salary", "utilities", "transportation", "maintenance"];
  for (let days = 0; days < 35; days += 1) {
    const date = new Date(); date.setDate(date.getDate() - days);
    const entryDate = localDate(date);
    entries.push({ id: `r-${days}`, entryType: "revenue", amount: 840 + ((days * 173) % 620), category: cats[days % cats.length], paymentMethod: days % 2 ? "cash" : "card", entryDate, notes: days ? "Daily sales" : "Store sales today", receiptName: "", receiptType: "", receiptData: "", createdAt: date.toISOString(), updatedAt: date.toISOString() });
    entries.push({ id: `e-${days}`, entryType: "expense", amount: 180 + ((days * 89) % 330), category: expenseCats[days % expenseCats.length], paymentMethod: "", entryDate, notes: days ? "Operating expense" : "Fresh product delivery", receiptName: "", receiptType: "", receiptData: "", createdAt: date.toISOString(), updatedAt: date.toISOString() });
  }
  return entries;
}

function aggregateByDay(entries, days) {
  const output = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(); date.setDate(date.getDate() - offset);
    const label = localDate(date);
    const group = entries.filter((entry) => entry.entryDate === label);
    const revenue = group.filter((e) => e.entryType === "revenue").reduce((s, e) => s + e.amount, 0);
    const expenses = group.filter((e) => e.entryType === "expense").reduce((s, e) => s + e.amount, 0);
    output.push({ label, revenue, expenses, profit: revenue - expenses });
  }
  return output;
}

function aggregateByMonth(entries, months) {
  const output = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - offset);
    const label = localDate(date).slice(0, 7);
    const group = entries.filter((entry) => entry.entryDate.startsWith(label));
    const revenue = group.filter((e) => e.entryType === "revenue").reduce((s, e) => s + e.amount, 0);
    const expenses = group.filter((e) => e.entryType === "expense").reduce((s, e) => s + e.amount, 0);
    output.push({ label, revenue, expenses, profit: revenue - expenses });
  }
  return output;
}

function aggregateWeekly(daily) {
  const groups = new Map();
  daily.forEach((row) => {
    const key = startOfWeek(new Date(`${row.label}T12:00:00`));
    const current = groups.get(key) || { label: key, revenue: 0, expenses: 0, profit: 0 };
    current.revenue += row.revenue; current.expenses += row.expenses; current.profit = current.revenue - current.expenses;
    groups.set(key, current);
  });
  return [...groups.values()];
}

function emptySummary() { return { todayRevenue: 0, todayExpenses: 0, todayProfit: 0, weekProfit: 0, monthProfit: 0, biggestExpenseCategory: "", biggestExpenseAmount: 0 }; }
function sortEntries(a, b) { return b.entryDate.localeCompare(a.entryDate) || String(b.createdAt).localeCompare(String(a.createdAt)); }
function localDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function startOfWeek(date) { const copy = new Date(date); const day = (copy.getDay() + 6) % 7; copy.setDate(copy.getDate() - day); return localDate(copy); }
function formatDate(value) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function shortLabel(label) { return label.length === 7 ? new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(`${label}-01T12:00:00`)) : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${label}T12:00:00`)); }
function titleCase(value) { return String(value || "").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function setStatus(element, message, error = false) { element.textContent = message; element.classList.toggle("error", error); }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
