const LOCAL_RECORDS_KEY = "customer-credit-records-v2";
const SETTINGS_KEY = "customer-credit-settings-v2";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const state = {
  enterprise: null,
  user: null,
  permissions: {
    manageSignupInvites: false,
    manageEnterprises: false,
    manageUsers: false,
    manageRecords: false,
    viewActivity: false,
    emailRecoveryEnabled: false,
  },
  records: [],
  search: "",
  showPaid: false,
  enterpriseUsers: [],
  managedEnterprises: [],
  settings: {
    useMysql: true,
    apiUrl: "",
    useSheets: false,
    sheetsUrl: "",
  },
};

const elements = {
  recordForm: document.querySelector("#recordForm"),
  customerName: document.querySelector("#customerName"),
  customerPhone: document.querySelector("#customerPhone"),
  itemNote: document.querySelector("#itemNote"),
  creditDate: document.querySelector("#creditDate"),
  creditTime: document.querySelector("#creditTime"),
  creditAmount: document.querySelector("#creditAmount"),
  recordsBody: document.querySelector("#recordsBody"),
  emptyState: document.querySelector("#emptyState"),
  emptyTitle: document.querySelector("#emptyTitle"),
  emptyText: document.querySelector("#emptyText"),
  searchInput: document.querySelector("#searchInput"),
  showPaid: document.querySelector("#showPaid"),
  metricTotal: document.querySelector("#metricTotal"),
  metricPaid: document.querySelector("#metricPaid"),
  metricBalance: document.querySelector("#metricBalance"),
  metricOpen: document.querySelector("#metricOpen"),
  creditSummary: document.querySelector("#creditSummary"),
  creditRecordsPanel: document.querySelector("#creditRecordsPanel"),
  storageStatus: document.querySelector("#storageStatus"),
  syncButton: document.querySelector("#syncButton"),
  printLedgerButton: document.querySelector("#printLedgerButton"),
  settingsButton: document.querySelector("#settingsButton"),
  accountButton: document.querySelector("#accountButton"),
  logoutButton: document.querySelector("#logoutButton"),
  financeLink: document.querySelector("#financeLink"),
  aiDashboardLink: document.querySelector("#aiDashboardLink"),
  employeeManagementLink: document.querySelector("#employeeManagementLink"),
  enterpriseStatus: document.querySelector("#enterpriseStatus"),
  paymentDialog: document.querySelector("#paymentDialog"),
  paymentForm: document.querySelector("#paymentForm"),
  paymentRecordId: document.querySelector("#paymentRecordId"),
  paymentTitle: document.querySelector("#paymentTitle"),
  paymentDate: document.querySelector("#paymentDate"),
  paymentTime: document.querySelector("#paymentTime"),
  paymentAmount: document.querySelector("#paymentAmount"),
  paymentNote: document.querySelector("#paymentNote"),
  cancelPaymentButton: document.querySelector("#cancelPaymentButton"),
  editDialog: document.querySelector("#editDialog"),
  editForm: document.querySelector("#editForm"),
  editTitle: document.querySelector("#editTitle"),
  editRecordId: document.querySelector("#editRecordId"),
  editCustomerName: document.querySelector("#editCustomerName"),
  editCustomerPhone: document.querySelector("#editCustomerPhone"),
  editItemNote: document.querySelector("#editItemNote"),
  editCreditDate: document.querySelector("#editCreditDate"),
  editCreditTime: document.querySelector("#editCreditTime"),
  editCreditAmount: document.querySelector("#editCreditAmount"),
  cancelEditButton: document.querySelector("#cancelEditButton"),
  historyDialog: document.querySelector("#historyDialog"),
  historyTitle: document.querySelector("#historyTitle"),
  historySummary: document.querySelector("#historySummary"),
  historyList: document.querySelector("#historyList"),
  historyUndoButton: document.querySelector("#historyUndoButton"),
  historyDoneButton: document.querySelector("#historyDoneButton"),
  closeHistoryButton: document.querySelector("#closeHistoryButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  useMysql: document.querySelector("#useMysql"),
  apiUrl: document.querySelector("#apiUrl"),
  useSheets: document.querySelector("#useSheets"),
  sheetsUrl: document.querySelector("#sheetsUrl"),
  cancelSettingsButton: document.querySelector("#cancelSettingsButton"),
  generateInvitationButton: document.querySelector("#generateInvitationButton"),
  generatedInvitation: document.querySelector("#generatedInvitation"),
  generatedInvitationCode: document.querySelector("#generatedInvitationCode"),
  generatedInvitationExpiry: document.querySelector("#generatedInvitationExpiry"),
  copyInvitationButton: document.querySelector("#copyInvitationButton"),
  invitationList: document.querySelector("#invitationList"),
  enterpriseList: document.querySelector("#enterpriseList"),
  accountDialog: document.querySelector("#accountDialog"),
  accountIdentity: document.querySelector("#accountIdentity"),
  recoveryEmailForm: document.querySelector("#recoveryEmailForm"),
  recoveryEmail: document.querySelector("#recoveryEmail"),
  recoveryEmailStatus: document.querySelector("#recoveryEmailStatus"),
  resendVerificationButton: document.querySelector("#resendVerificationButton"),
  passwordForm: document.querySelector("#passwordForm"),
  currentPassword: document.querySelector("#currentPassword"),
  newPassword: document.querySelector("#newPassword"),
  confirmNewPassword: document.querySelector("#confirmNewPassword"),
  teamSection: document.querySelector("#teamSection"),
  platformSection: document.querySelector("#platformSection"),
  staffForm: document.querySelector("#staffForm"),
  staffUserId: document.querySelector("#staffUserId"),
  staffDisplayName: document.querySelector("#staffDisplayName"),
  staffUsername: document.querySelector("#staffUsername"),
  staffEmail: document.querySelector("#staffEmail"),
  staffEmailLabel: document.querySelector("#staffEmailLabel"),
  staffRole: document.querySelector("#staffRole"),
  staffStatus: document.querySelector("#staffStatus"),
  staffPassword: document.querySelector("#staffPassword"),
  cancelStaffEditButton: document.querySelector("#cancelStaffEditButton"),
  saveStaffButton: document.querySelector("#saveStaffButton"),
  staffList: document.querySelector("#staffList"),
  activitySection: document.querySelector("#activitySection"),
  activityList: document.querySelector("#activityList"),
  loginHistoryList: document.querySelector("#loginHistoryList"),
  refreshActivityButton: document.querySelector("#refreshActivityButton"),
  enterpriseAccessDialog: document.querySelector("#enterpriseAccessDialog"),
  enterpriseAccessForm: document.querySelector("#enterpriseAccessForm"),
  enterpriseAccessName: document.querySelector("#enterpriseAccessName"),
  enterpriseAccessId: document.querySelector("#enterpriseAccessId"),
  enterpriseOwnerUsername: document.querySelector("#enterpriseOwnerUsername"),
  enterpriseTemporaryPassword: document.querySelector("#enterpriseTemporaryPassword"),
  cancelEnterpriseAccessButton: document.querySelector("#cancelEnterpriseAccessButton"),
  printArea: document.querySelector("#printArea"),
  toast: document.querySelector("#toast"),
};

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function currentTime() {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatTime(value) {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function uid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `record-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  return moneyFormatter.format(toNumber(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeRecord(record) {
  const payments = Array.isArray(record.payments) ? record.payments : [];
  return {
    id: record.id || uid(),
    customerName: record.customerName || "",
    customerPhone: record.customerPhone || "",
    itemNote: record.itemNote || "",
    creditDate: record.creditDate || today(),
    creditTime: record.creditTime || "",
    creditAmount: toNumber(record.creditAmount),
    payments: payments.map((payment) => ({
      id: payment.id || uid(),
      date: payment.date || today(),
      time: payment.time || "",
      amount: toNumber(payment.amount),
      note: payment.note || "",
    })),
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
}

function getPaid(record) {
  return record.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
}

function getBalance(record) {
  return Math.max(toNumber(record.creditAmount) - getPaid(record), 0);
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(getScopedStorageKey(SETTINGS_KEY)) || "{}");
    state.settings = {
      useMysql: true,
      apiUrl: "",
      useSheets: false,
      sheetsUrl: "",
      ...saved,
    };
  } catch {
    state.settings = { useMysql: true, apiUrl: "", useSheets: false, sheetsUrl: "" };
  }
}

function saveSettings() {
  localStorage.setItem(getScopedStorageKey(SETTINGS_KEY), JSON.stringify(state.settings));
}

function loadLocalRecords() {
  try {
    return JSON.parse(localStorage.getItem(getScopedStorageKey(LOCAL_RECORDS_KEY)) || "[]").map(
      normalizeRecord,
    );
  } catch {
    return [];
  }
}

function saveLocalRecords(records) {
  localStorage.setItem(getScopedStorageKey(LOCAL_RECORDS_KEY), JSON.stringify(records));
}

function getScopedStorageKey(baseKey) {
  const scope = state.enterprise?.id || "local-device";
  return `${baseKey}:${scope}`;
}

async function sheetsRequest(action, payload = {}) {
  if (!state.settings.sheetsUrl) {
    throw new Error("Missing Google Sheets endpoint");
  }

  const response = await fetch(state.settings.sheetsUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
  });

  if (!response.ok) {
    throw new Error(`Google Sheets request failed: ${response.status}`);
  }

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.error || "Google Sheets request failed");
  }
  return result;
}

function getMysqlApiBase() {
  const configuredUrl = (state.settings.apiUrl || "").trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }

  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    return `${window.location.origin}/api`;
  }

  return "";
}

async function mysqlRequest(path, options = {}) {
  const apiBase = getMysqlApiBase();
  if (!apiBase) {
    throw new Error("Open the app through the MySQL server or add an API URL");
  }

  const response = await fetch(`${apiBase}${path}`, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Login required");
  }
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || `MySQL API request failed: ${response.status}`);
  }

  return result;
}

async function loadRecords() {
  if (state.settings.useMysql) {
    try {
      const result = await mysqlRequest("/records");
      state.records = result.records.map(normalizeRecord);
      saveLocalRecords(state.records);
      updateStorageStatus("Stored in MySQL");
      render();
      return;
    } catch (error) {
      updateStorageStatus("Using local copy; MySQL not connected");
      toast(error.message);
    }
  }

  if (state.settings.useSheets && state.settings.sheetsUrl) {
    try {
      const result = await sheetsRequest("listRecords");
      state.records = result.records.map(normalizeRecord);
      saveLocalRecords(state.records);
      updateStorageStatus("Stored in Google Sheets");
      render();
      return;
    } catch (error) {
      updateStorageStatus("Using local copy");
      toast(error.message);
    }
  }

  state.records = loadLocalRecords();
  updateStorageStatus("Stored on this device");
  render();
}

async function loadSessionInfo() {
  if (!state.settings.useMysql) {
    updateEnterpriseStatus("Local device");
    return;
  }

  try {
    const result = await mysqlRequest("/me");
    state.enterprise = result.enterprise;
    state.user = result.user;
    state.permissions = {
      manageSignupInvites: Boolean(result.permissions?.manageSignupInvites),
      manageEnterprises: Boolean(result.permissions?.manageEnterprises),
      manageUsers: Boolean(result.permissions?.manageUsers),
      manageRecords: Boolean(result.permissions?.manageRecords),
      viewActivity: Boolean(result.permissions?.viewActivity),
      emailRecoveryEnabled: Boolean(result.permissions?.emailRecoveryEnabled),
    };
    elements.recordForm.hidden =
      !state.permissions.manageRecords || Boolean(state.user.mustChangePassword);
    elements.settingsButton.hidden = state.user.role !== "owner";
    elements.financeLink.hidden = state.user.role !== "owner";
    elements.aiDashboardLink.hidden = state.user.role !== "owner";
    elements.employeeManagementLink.hidden = state.user.role !== "owner";
    elements.creditSummary.hidden = state.user.role !== "owner";
    elements.printLedgerButton.hidden = state.user.role !== "owner";
    elements.syncButton.hidden = state.user.role !== "owner";
    elements.creditRecordsPanel.hidden = state.user.role !== "owner";
    elements.teamSection.hidden = !state.permissions.manageUsers;
    elements.platformSection.hidden =
      !state.permissions.manageSignupInvites && !state.permissions.manageEnterprises;
    elements.activitySection.hidden = !state.permissions.viewActivity;
    elements.accountIdentity.textContent = `${state.user.username} - ${state.user.role}`;
    elements.recoveryEmailForm.hidden = !state.permissions.emailRecoveryEnabled;
    elements.staffEmailLabel.hidden = !state.permissions.emailRecoveryEnabled;
    elements.staffEmail.required = state.permissions.emailRecoveryEnabled;
    updateRecoveryEmailUi();
    updateEnterpriseStatus(`${result.enterprise.name} (${result.enterprise.code})`);
    if (result.user.mustChangePassword) {
      window.setTimeout(() => {
        openAccount();
        toast("Change your temporary password");
      }, 100);
    }
  } catch (error) {
    elements.recordForm.hidden = true;
    elements.platformSection.hidden = true;
    updateEnterpriseStatus("Enterprise not loaded");
  }
}

async function persistRecords(message, audit) {
  if (!state.permissions.manageRecords) {
    toast("This account has view-only access");
    return;
  }
  saveLocalRecords(state.records);
  render();

  if (state.settings.useMysql) {
    try {
      await mysqlRequest("/records", {
        method: "PUT",
        body: JSON.stringify({ records: state.records, audit }),
      });
      updateStorageStatus("Stored in MySQL");
      toast(message);
      return;
    } catch (error) {
      await loadRecords();
      updateStorageStatus("Stored in MySQL");
      toast(error.message);
      return;
    }
  }

  if (state.settings.useSheets && state.settings.sheetsUrl) {
    try {
      await sheetsRequest("saveRecords", { records: state.records });
      updateStorageStatus("Stored in Google Sheets");
      toast(message);
      return;
    } catch (error) {
      updateStorageStatus("Saved locally; Sheets sync failed");
      toast(error.message);
      return;
    }
  }

  toast(message);
}

function updateStorageStatus(text) {
  elements.storageStatus.textContent = text;
}

function updateEnterpriseStatus(text) {
  if (elements.enterpriseStatus) {
    elements.enterpriseStatus.textContent = text;
  }
}

function getFilteredRecords() {
  const term = state.search.trim().toLowerCase();
  const records = [...state.records]
    .filter((record) => state.showPaid || getBalance(record) > 0.009)
    .sort((a, b) => {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  if (!term) return records;

  return records.filter((record) => {
    return [record.customerName, record.customerPhone, record.itemNote, record.creditDate, record.creditTime]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });
}

function render() {
  renderMetrics();
  renderRecords();
}

function renderMetrics() {
  const total = state.records.reduce((sum, record) => sum + toNumber(record.creditAmount), 0);
  const paid = state.records.reduce((sum, record) => sum + getPaid(record), 0);
  const balance = state.records.reduce((sum, record) => sum + getBalance(record), 0);
  const open = state.records.filter((record) => getBalance(record) > 0.009).length;

  elements.metricTotal.textContent = formatMoney(total);
  elements.metricPaid.textContent = formatMoney(paid);
  elements.metricBalance.textContent = formatMoney(balance);
  elements.metricOpen.textContent = open;
}

function renderRecords() {
  const records = getFilteredRecords();
  elements.recordsBody.innerHTML = "";
  elements.emptyState.style.display = records.length ? "none" : "flex";
  const allPaid = state.records.length && state.records.every((record) => getBalance(record) <= 0.009);
  if (allPaid && !state.showPaid) {
    elements.emptyTitle.textContent = "All accounts are paid";
    elements.emptyText.textContent = "Turn on Show paid to view completed records or undo a payment mistake.";
  } else if (state.records.length) {
    elements.emptyTitle.textContent = "No matching records";
    elements.emptyText.textContent = "Try a different search or turn on Show paid.";
  } else {
    elements.emptyTitle.textContent = "No records yet";
    elements.emptyText.textContent = "Add the first customer credit record to start the ledger.";
  }

  const rows = records.map((record) => {
    const paid = getPaid(record);
    const balance = getBalance(record);
    const isPaid = balance <= 0.009;
    const undoButton = state.permissions.manageRecords && record.payments.length
      ? `
          <button class="icon-button undo-button" data-action="undo-payment" data-id="${record.id}" type="button" title="Undo last payment" aria-label="Undo last payment for ${escapeHtml(record.customerName)}">
            <span aria-hidden="true">&#8630;</span>
          </button>
        `
      : "";
    const manageButtons = state.permissions.manageRecords
      ? `
          <button class="icon-button" data-action="edit" data-id="${record.id}" type="button" title="Edit record" aria-label="Edit record for ${escapeHtml(record.customerName)}">
            <span aria-hidden="true">&#9998;</span>
          </button>
          <button class="icon-button" data-action="payment" data-id="${record.id}" type="button" title="Add payment" aria-label="Add payment for ${escapeHtml(record.customerName)}">
            <span aria-hidden="true">+</span>
          </button>
        `
      : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="customer-cell">
        <strong>${escapeHtml(record.customerName)}</strong>
        <span>${escapeHtml(record.customerPhone || "No phone")}</span>
      </td>
      <td>${escapeHtml(record.itemNote)}</td>
      <td class="date-cell">
        <strong>${escapeHtml(record.creditDate)}</strong>
        <span>${escapeHtml(formatTime(record.creditTime) || "No time")}</span>
      </td>
      <td class="money">${formatMoney(record.creditAmount)}</td>
      <td class="money">${formatMoney(paid)}</td>
      <td class="money">${formatMoney(balance)}</td>
      <td>
        <span class="status-pill ${isPaid ? "status-paid" : "status-open"}">
          ${isPaid ? "Paid" : "Open"}
        </span>
      </td>
      <td>
        <div class="row-actions">
          ${manageButtons}
          <button class="icon-button" data-action="history" data-id="${record.id}" type="button" title="Payment history" aria-label="Payment history for ${escapeHtml(record.customerName)}">
            <span aria-hidden="true">&#9776;</span>
          </button>
          <button class="icon-button" data-action="print" data-id="${record.id}" type="button" title="Print statement" aria-label="Print statement for ${escapeHtml(record.customerName)}">
            <span aria-hidden="true">&#9113;</span>
          </button>
          ${undoButton}
        </div>
      </td>
    `;
    return tr;
  });

  elements.recordsBody.append(...rows);
}

function openPaymentDialog(record) {
  elements.paymentRecordId.value = record.id;
  elements.paymentTitle.textContent = `Payment for ${record.customerName}`;
  elements.paymentDate.value = today();
  elements.paymentTime.value = currentTime();
  elements.paymentAmount.value = getBalance(record).toFixed(2);
  elements.paymentNote.value = "";
  elements.paymentDialog.showModal();
  elements.paymentAmount.focus();
}

function openEditDialog(record) {
  elements.editRecordId.value = record.id;
  elements.editTitle.textContent = `Edit ${record.customerName}`;
  elements.editCustomerName.value = record.customerName;
  elements.editCustomerPhone.value = record.customerPhone;
  elements.editItemNote.value = record.itemNote;
  elements.editCreditDate.value = record.creditDate;
  elements.editCreditTime.value = record.creditTime || currentTime();
  elements.editCreditAmount.value = toNumber(record.creditAmount).toFixed(2);
  elements.editDialog.showModal();
  elements.editCustomerName.focus();
}

function openHistoryDialog(record) {
  elements.historyDialog.dataset.recordId = record.id;
  renderHistoryDialog(record);
  elements.historyDialog.showModal();
}

function renderHistoryDialog(record) {
  const paid = getPaid(record);
  const balance = getBalance(record);
  elements.historyTitle.textContent = `${record.customerName} Payments`;
  elements.historySummary.innerHTML = `
    <div><span>Credit</span><strong>${formatMoney(record.creditAmount)}</strong></div>
    <div><span>Paid</span><strong>${formatMoney(paid)}</strong></div>
    <div><span>Balance</span><strong>${formatMoney(balance)}</strong></div>
  `;

  if (!record.payments.length) {
    elements.historyList.innerHTML = `
      <div class="history-empty">
        <strong>No payments yet</strong>
        <span>Payments will appear here after they are saved.</span>
      </div>
    `;
    elements.historyUndoButton.disabled = true;
    return;
  }

  elements.historyUndoButton.disabled = !state.permissions.manageRecords;
  elements.historyList.innerHTML = record.payments
    .map(
      (payment, index) => `
        <article class="history-item">
          <div>
            <strong>${escapeHtml(payment.date)} ${escapeHtml(formatTime(payment.time))}</strong>
            <span>${escapeHtml(payment.note || "Payment")}</span>
          </div>
          <div class="history-amount">
            <span>#${index + 1}</span>
            <strong>${formatMoney(payment.amount)}</strong>
          </div>
        </article>
      `,
    )
    .join("");
}

async function addRecord(event) {
  event.preventDefault();
  if (!state.permissions.manageRecords) return;
  const record = normalizeRecord({
    customerName: elements.customerName.value.trim(),
    customerPhone: elements.customerPhone.value.trim(),
    itemNote: elements.itemNote.value.trim(),
    creditDate: elements.creditDate.value,
    creditTime: elements.creditTime.value,
    creditAmount: elements.creditAmount.value,
  });

  if (state.settings.useMysql && state.user?.role === "employee") {
    try {
      await mysqlRequest("/records", { method: "POST", body: JSON.stringify(record) });
      elements.recordForm.reset();
      elements.creditDate.value = today();
      elements.creditTime.value = currentTime();
      toast("Credit entry saved");
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  state.records.push(record);
  elements.recordForm.reset();
  elements.creditDate.value = today();
  elements.creditTime.value = currentTime();
  await persistRecords("Credit record saved", {
    action: "credit.created",
    entityId: record.id,
    summary: `Created credit for ${record.customerName}`,
  });
}

async function saveEditedRecord(event) {
  event.preventDefault();
  if (!state.permissions.manageRecords) return;
  const record = state.records.find((item) => item.id === elements.editRecordId.value);
  if (!record) return;

  record.customerName = elements.editCustomerName.value.trim();
  record.customerPhone = elements.editCustomerPhone.value.trim();
  record.itemNote = elements.editItemNote.value.trim();
  record.creditDate = elements.editCreditDate.value;
  record.creditTime = elements.editCreditTime.value;
  record.creditAmount = toNumber(elements.editCreditAmount.value);
  record.updatedAt = new Date().toISOString();

  if (getBalance(record) > 0.009) {
    state.showPaid = false;
    elements.showPaid.checked = false;
  }

  elements.editDialog.close();
  await persistRecords("Credit record updated", {
    action: "credit.updated",
    entityId: record.id,
    summary: `Updated credit for ${record.customerName}`,
  });
}

async function addPayment(event) {
  event.preventDefault();
  if (!state.permissions.manageRecords) return;
  const record = state.records.find((item) => item.id === elements.paymentRecordId.value);
  if (!record) return;

  const payment = {
    id: uid(),
    date: elements.paymentDate.value,
    time: elements.paymentTime.value,
    amount: toNumber(elements.paymentAmount.value),
    note: elements.paymentNote.value.trim(),
  };
  record.payments.push(payment);
  record.updatedAt = new Date().toISOString();

  elements.paymentDialog.close();
  await persistRecords("Payment saved", {
    action: "payment.added",
    entityId: payment.id,
    summary: `Added payment for ${record.customerName}`,
  });
}

async function undoLastPayment(record) {
  if (!state.permissions.manageRecords) return;
  if (!record.payments.length) {
    toast("No payment to undo");
    return;
  }

  const lastPayment = record.payments[record.payments.length - 1];
  const confirmed = window.confirm(
    `Undo the last payment of ${formatMoney(lastPayment.amount)} for ${record.customerName}?`,
  );
  if (!confirmed) return;

  record.payments.pop();
  record.updatedAt = new Date().toISOString();

  if (getBalance(record) > 0.009) {
    state.showPaid = false;
    elements.showPaid.checked = false;
  }

  await persistRecords("Last payment undone", {
    action: "payment.undone",
    entityId: lastPayment.id,
    summary: `Undid payment for ${record.customerName}`,
  });

  if (elements.historyDialog.open) {
    const historyRecord = state.records.find((item) => item.id === elements.historyDialog.dataset.recordId);
    if (historyRecord) renderHistoryDialog(historyRecord);
  }
}

function buildLedgerPrintHtml(records) {
  const total = records.reduce((sum, record) => sum + toNumber(record.creditAmount), 0);
  const paid = records.reduce((sum, record) => sum + getPaid(record), 0);
  const balance = records.reduce((sum, record) => sum + getBalance(record), 0);

  return `
    <div class="print-header">
      <div>
        <h1>Customer Credit Ledger</h1>
        <p>Printed ${new Date().toLocaleString()}</p>
      </div>
      <div>
        <p>Total Credit: ${formatMoney(total)}</p>
        <p>Total Paid: ${formatMoney(paid)}</p>
        <p>Balance Due: ${formatMoney(balance)}</p>
      </div>
    </div>
    <table class="print-table">
      <thead>
        <tr>
          <th>Customer</th>
          <th>Phone</th>
          <th>Item</th>
          <th>Date / Time</th>
          <th>Credit</th>
          <th>Paid</th>
          <th>Balance</th>
        </tr>
      </thead>
      <tbody>
        ${records
          .map(
            (record) => `
              <tr>
                <td>${escapeHtml(record.customerName)}</td>
                <td>${escapeHtml(record.customerPhone)}</td>
                <td>${escapeHtml(record.itemNote)}</td>
                <td>${escapeHtml(record.creditDate)} ${escapeHtml(formatTime(record.creditTime))}</td>
                <td>${formatMoney(record.creditAmount)}</td>
                <td>${formatMoney(getPaid(record))}</td>
                <td>${formatMoney(getBalance(record))}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function buildStatementPrintHtml(record) {
  const payments = record.payments.length
    ? record.payments
        .map(
          (payment) => `
            <tr>
              <td>${escapeHtml(payment.date)} ${escapeHtml(formatTime(payment.time))}</td>
              <td>${escapeHtml(payment.note)}</td>
              <td>${formatMoney(payment.amount)}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="3">No payments recorded</td></tr>`;

  return `
    <div class="print-header">
      <div>
        <h1>${escapeHtml(record.customerName)}</h1>
        <p>${escapeHtml(record.customerPhone || "")}</p>
        <p>${escapeHtml(record.itemNote)}</p>
      </div>
      <div>
        <p>Credit Date: ${escapeHtml(record.creditDate)} ${escapeHtml(formatTime(record.creditTime))}</p>
        <p>Printed ${new Date().toLocaleString()}</p>
      </div>
    </div>
    <div class="print-summary">
      <div><strong>Credit</strong><br />${formatMoney(record.creditAmount)}</div>
      <div><strong>Paid</strong><br />${formatMoney(getPaid(record))}</div>
      <div><strong>Balance</strong><br />${formatMoney(getBalance(record))}</div>
    </div>
    <table class="print-table">
      <thead>
        <tr>
          <th>Payment Date / Time</th>
          <th>Note</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>${payments}</tbody>
    </table>
  `;
}

function printHtml(html) {
  elements.printArea.innerHTML = html;
  window.print();
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(toast.timeout);
  toast.timeout = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2400);
}

function openSettings() {
  elements.useMysql.checked = state.settings.useMysql;
  elements.apiUrl.value = state.settings.apiUrl;
  elements.useSheets.checked = state.settings.useSheets;
  elements.sheetsUrl.value = state.settings.sheetsUrl;
  elements.settingsDialog.showModal();
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function loadInvitations() {
  try {
    const result = await mysqlRequest("/signup-invites");
    renderInvitations(result.invites);
  } catch (error) {
    elements.invitationList.innerHTML = `<p class="invitation-empty">${escapeHtml(error.message)}</p>`;
  }
}

function renderInvitations(invites) {
  if (!invites.length) {
    elements.invitationList.innerHTML =
      '<p class="invitation-empty">No invitations have been generated yet.</p>';
    return;
  }

  elements.invitationList.innerHTML = invites
    .map((invite) => {
      const active = invite.status === "active";
      let detail = `Expires ${formatDateTime(invite.expiresAt)}`;
      if (invite.status === "used") {
        detail = invite.usedByEnterpriseName
          ? `Used by ${invite.usedByEnterpriseName} (${invite.usedByEnterpriseCode}) on ${formatDateTime(invite.usedAt)}`
          : `Used ${formatDateTime(invite.usedAt)}`;
      } else if (invite.status === "expired") {
        detail = `Expired ${formatDateTime(invite.expiresAt)}`;
      }
      return `
        <div class="invitation-item">
          <div>
            <strong class="invitation-status ${escapeHtml(invite.status)}">${escapeHtml(invite.status)}</strong>
            <span>${escapeHtml(detail)}</span>
          </div>
          ${
            active
              ? `<button class="ghost-button" data-invite-action="revoke" data-id="${escapeHtml(invite.id)}" type="button">Revoke</button>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

async function generateInvitation() {
  elements.generateInvitationButton.disabled = true;
  try {
    const result = await mysqlRequest("/signup-invites", {
      method: "POST",
      body: "{}",
    });
    elements.generatedInvitationCode.value = result.invite.code;
    elements.generatedInvitationExpiry.textContent = `Valid until ${formatDateTime(result.invite.expiresAt)}. It can be used once.`;
    elements.generatedInvitation.hidden = false;
    await loadInvitations();
    toast("Invitation generated");
  } catch (error) {
    toast(error.message);
  } finally {
    elements.generateInvitationButton.disabled = false;
  }
}

async function copyInvitation() {
  const code = elements.generatedInvitationCode.value;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    toast("Invitation code copied");
  } catch {
    elements.generatedInvitationCode.select();
    document.execCommand("copy");
    toast("Invitation code copied");
  }
}

async function revokeInvitation(inviteId) {
  if (!window.confirm("Revoke this unused invitation?")) return;
  try {
    await mysqlRequest(`/signup-invites/${encodeURIComponent(inviteId)}`, {
      method: "DELETE",
    });
    await loadInvitations();
    toast("Invitation revoked");
  } catch (error) {
    toast(error.message);
  }
}

async function openAccount() {
  if (!elements.accountDialog.open) elements.accountDialog.showModal();
  elements.passwordForm.reset();
  resetStaffForm();
  const tasks = [];
  if (state.permissions.manageUsers) tasks.push(loadEnterpriseUsers());
  if (state.permissions.manageSignupInvites) tasks.push(loadInvitations());
  if (state.permissions.manageEnterprises) tasks.push(loadManagedEnterprises());
  if (state.permissions.viewActivity) tasks.push(loadActivity());
  await Promise.all(tasks);
}

function updateRecoveryEmailUi() {
  elements.recoveryEmail.value = state.user?.email || "";
  const verified = Boolean(state.user?.emailVerified);
  elements.recoveryEmailStatus.textContent = !state.user?.email
    ? "Add an email to enable automatic password recovery."
    : verified
      ? "Verified for automatic password recovery."
      : "Verification required. Check this email for a verification link.";
  elements.resendVerificationButton.hidden = !state.user?.email || verified;
}

async function saveRecoveryEmail(event) {
  event.preventDefault();
  try {
    const result = await mysqlRequest("/account/email", {
      method: "PATCH",
      body: JSON.stringify({ email: elements.recoveryEmail.value.trim() }),
    });
    state.user.email = result.email;
    state.user.emailVerified = false;
    updateRecoveryEmailUi();
    toast("Verification email sent");
  } catch (error) {
    toast(error.message);
  }
}

async function resendRecoveryVerification() {
  try {
    await mysqlRequest("/account/email/resend", { method: "POST", body: "{}" });
    toast("Verification email sent");
  } catch (error) {
    toast(error.message);
  }
}

async function changePassword(event) {
  event.preventDefault();
  if (elements.newPassword.value !== elements.confirmNewPassword.value) {
    toast("New passwords do not match");
    return;
  }
  try {
    await mysqlRequest("/account/password", {
      method: "PATCH",
      body: JSON.stringify({
        currentPassword: elements.currentPassword.value,
        newPassword: elements.newPassword.value,
      }),
    });
    state.user.mustChangePassword = false;
    elements.recordForm.hidden = !state.permissions.manageRecords;
    elements.passwordForm.reset();
    toast("Password updated");
  } catch (error) {
    toast(error.message);
  }
}

async function loadEnterpriseUsers() {
  try {
    const result = await mysqlRequest("/users");
    state.enterpriseUsers = result.users;
    renderEnterpriseUsers();
  } catch (error) {
    elements.staffList.innerHTML = `<p class="invitation-empty">${escapeHtml(error.message)}</p>`;
  }
}

function renderEnterpriseUsers() {
  elements.staffList.innerHTML = state.enterpriseUsers
    .map((user) => {
      const isSelf = user.id === state.user.id;
      const nextStatus = user.status === "inactive" ? "active" : "inactive";
      return `
        <div class="staff-item">
          <div>
            <strong>${escapeHtml(user.displayName)} <span class="role-badge">${escapeHtml(user.role)}</span> <span class="role-badge">${escapeHtml(user.status)}</span></strong>
            <span>${escapeHtml(user.username)} - ${escapeHtml(user.email || "no email")}${user.emailVerified ? " - verified" : " - unverified"}${user.mustChangePassword ? " - password change required" : ""}</span>
          </div>
          ${
            isSelf
              ? ""
              : `
                <div class="staff-actions">
                  <button class="ghost-button compact-button" data-user-action="edit" data-id="${escapeHtml(user.id)}" type="button">Edit</button>
                  <button class="ghost-button compact-button" data-user-action="reset" data-id="${escapeHtml(user.id)}" type="button">Reset Password</button>
                  ${user.role === "employee" ? `<button class="ghost-button compact-button ${nextStatus === "inactive" ? "danger-button" : ""}" data-user-action="status" data-status="${nextStatus}" data-id="${escapeHtml(user.id)}" type="button">${nextStatus === "active" ? "Activate" : "Deactivate"}</button>` : ""}
                </div>
              `
          }
        </div>
      `;
    })
    .join("");
}

function resetStaffForm() {
  elements.staffForm.reset();
  elements.staffUserId.value = "";
  elements.staffPassword.required = true;
  elements.saveStaffButton.textContent = "Add Employee Account";
  elements.cancelStaffEditButton.hidden = true;
}

function editStaffUser(userId) {
  const user = state.enterpriseUsers.find((item) => item.id === userId);
  if (!user || user.role === "owner") return;
  elements.staffUserId.value = user.id;
  elements.staffDisplayName.value = user.displayName;
  elements.staffUsername.value = user.username;
  elements.staffEmail.value = user.email || "";
  elements.staffRole.value = user.role;
  elements.staffStatus.value = user.status || "active";
  elements.staffPassword.value = "";
  elements.staffPassword.required = false;
  elements.saveStaffButton.textContent = "Save Employee Changes";
  elements.cancelStaffEditButton.hidden = false;
  elements.staffDisplayName.focus();
}

async function saveStaffUser(event) {
  event.preventDefault();
  const userId = elements.staffUserId.value;
  const body = {
    displayName: elements.staffDisplayName.value.trim(),
    username: elements.staffUsername.value.trim(),
    email: elements.staffEmail.value.trim(),
    role: elements.staffRole.value,
    status: elements.staffStatus.value,
  };
  if (elements.staffPassword.value) body.password = elements.staffPassword.value;
  try {
    await mysqlRequest(userId ? `/users/${encodeURIComponent(userId)}` : "/users", {
      method: userId ? "PATCH" : "POST",
      body: JSON.stringify(body),
    });
    resetStaffForm();
    await Promise.all([loadEnterpriseUsers(), loadActivity()]);
    toast(userId ? "Employee account updated" : "Employee account created");
  } catch (error) {
    toast(error.message);
  }
}

async function removeStaffUser(userId) {
  const user = state.enterpriseUsers.find((item) => item.id === userId);
  if (!user || !window.confirm(`Remove ${user.displayName}'s account?`)) return;
  try {
    await mysqlRequest(`/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    await Promise.all([loadEnterpriseUsers(), loadActivity()]);
    toast("Staff account removed");
  } catch (error) {
    toast(error.message);
  }
}

async function changeStaffStatus(userId, status) {
  const user = state.enterpriseUsers.find((item) => item.id === userId);
  if (!user) return;
  await mysqlRequest(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  await Promise.all([loadEnterpriseUsers(), loadActivity()]);
  toast(`Employee ${status}`);
}

async function loadActivity() {
  try {
    const [activityResult, loginResult] = await Promise.all([
      mysqlRequest("/activity"),
      mysqlRequest("/login-history"),
    ]);
    renderActivity(activityResult.activity);
    renderLoginHistory(loginResult.history);
  } catch (error) {
    elements.activityList.innerHTML = `<p class="invitation-empty">${escapeHtml(error.message)}</p>`;
  }
}

function renderLoginHistory(history) {
  elements.loginHistoryList.innerHTML = history.length
    ? history.map((entry) => `
      <article class="activity-item">
        <strong>${escapeHtml(entry.username)} — ${escapeHtml(entry.outcome)}</strong>
        <span>${escapeHtml(entry.ipAddress || "Unknown device address")}</span>
        <time>${escapeHtml(formatDateTime(entry.createdAt))}</time>
      </article>`).join("")
    : '<p class="invitation-empty">No login history recorded yet.</p>';
}

function renderActivity(activity) {
  if (!activity.length) {
    elements.activityList.innerHTML = '<p class="invitation-empty">No activity recorded yet.</p>';
    return;
  }
  elements.activityList.innerHTML = activity
    .map(
      (entry) => `
        <div class="activity-item">
          <div>
            <strong>${escapeHtml(entry.summary)}</strong>
            <span>${escapeHtml(entry.username)} - ${escapeHtml(entry.action)}</span>
          </div>
          <time>${escapeHtml(formatDateTime(entry.createdAt))}</time>
        </div>
      `,
    )
    .join("");
}

async function loadManagedEnterprises() {
  if (!state.permissions.manageEnterprises) return;
  try {
    const result = await mysqlRequest("/admin/enterprises");
    state.managedEnterprises = result.enterprises;
    renderManagedEnterprises();
  } catch (error) {
    elements.enterpriseList.innerHTML = `<p class="invitation-empty">${escapeHtml(error.message)}</p>`;
  }
}

function renderManagedEnterprises() {
  if (!state.managedEnterprises.length) {
    elements.enterpriseList.innerHTML = '<p class="invitation-empty">No additional enterprises yet.</p>';
    return;
  }
  elements.enterpriseList.innerHTML = state.managedEnterprises
    .map((enterprise) => {
      const nextStatus = enterprise.status === "active" ? "disabled" : "active";
      return `
        <div class="enterprise-item">
          <div>
            <strong>${escapeHtml(enterprise.name)} <span class="enterprise-state ${escapeHtml(enterprise.status)}">${escapeHtml(enterprise.status)}</span></strong>
            <span>${escapeHtml(enterprise.code)} - owner: ${escapeHtml(enterprise.ownerUsername || "not set")} - ${escapeHtml(enterprise.ownerEmail || "no recovery email")}${enterprise.ownerEmail ? (enterprise.ownerEmailVerified ? " - verified" : " - not verified") : ""}</span>
            <span>${enterprise.userCount} users - ${enterprise.recordCount} records - joined ${escapeHtml(formatDateTime(enterprise.createdAt))}</span>
          </div>
          <div class="enterprise-actions">
            <button class="ghost-button compact-button" data-enterprise-action="reset" data-id="${escapeHtml(enterprise.id)}" type="button">Reset Access</button>
            <button class="ghost-button compact-button" data-enterprise-action="status" data-status="${nextStatus}" data-id="${escapeHtml(enterprise.id)}" type="button">${nextStatus === "active" ? "Enable" : "Disable"}</button>
            <button class="ghost-button compact-button danger-button" data-enterprise-action="remove" data-id="${escapeHtml(enterprise.id)}" type="button">Remove</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function openEnterpriseAccess(enterpriseId) {
  const enterprise = state.managedEnterprises.find((item) => item.id === enterpriseId);
  if (!enterprise) return;
  elements.enterpriseAccessId.value = enterprise.id;
  elements.enterpriseAccessName.textContent = `${enterprise.name} (${enterprise.code})`;
  elements.enterpriseOwnerUsername.value = enterprise.ownerUsername || "owner";
  elements.enterpriseTemporaryPassword.value = "";
  if (elements.accountDialog.open) elements.accountDialog.close();
  elements.enterpriseAccessDialog.showModal();
}

async function resetEnterpriseAccess(event) {
  event.preventDefault();
  const enterpriseId = elements.enterpriseAccessId.value;
  try {
    await mysqlRequest(`/admin/enterprises/${encodeURIComponent(enterpriseId)}/access`, {
      method: "PATCH",
      body: JSON.stringify({
        username: elements.enterpriseOwnerUsername.value.trim(),
        temporaryPassword: elements.enterpriseTemporaryPassword.value,
      }),
    });
    elements.enterpriseAccessDialog.close();
    await loadManagedEnterprises();
    toast("Enterprise access reset");
  } catch (error) {
    toast(error.message);
  }
}

async function changeEnterpriseStatus(enterpriseId, status) {
  const enterprise = state.managedEnterprises.find((item) => item.id === enterpriseId);
  if (!enterprise) return;
  const verb = status === "active" ? "enable" : "disable";
  if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${enterprise.name}?`)) return;
  try {
    await mysqlRequest(`/admin/enterprises/${encodeURIComponent(enterpriseId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await loadManagedEnterprises();
    toast(`Enterprise ${status === "active" ? "enabled" : "disabled"}`);
  } catch (error) {
    toast(error.message);
  }
}

async function removeManagedEnterprise(enterpriseId) {
  const enterprise = state.managedEnterprises.find((item) => item.id === enterpriseId);
  if (!enterprise) return;
  const confirmation = window.prompt(
    `This permanently removes ${enterprise.name}. Type ${enterprise.code} to confirm.`,
  );
  if (confirmation === null) return;
  try {
    await mysqlRequest(`/admin/enterprises/${encodeURIComponent(enterpriseId)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmCode: confirmation }),
    });
    await loadManagedEnterprises();
    toast("Enterprise removed");
  } catch (error) {
    toast(error.message);
  }
}

function bindEvents() {
  elements.recordForm.addEventListener("submit", addRecord);
  elements.paymentForm.addEventListener("submit", addPayment);
  elements.editForm.addEventListener("submit", saveEditedRecord);

  elements.recordsBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const record = state.records.find((item) => item.id === button.dataset.id);
    if (!record) return;

    if (button.dataset.action === "edit") {
      openEditDialog(record);
    }

    if (button.dataset.action === "payment") {
      openPaymentDialog(record);
    }

    if (button.dataset.action === "history") {
      openHistoryDialog(record);
    }

    if (button.dataset.action === "print") {
      printHtml(buildStatementPrintHtml(record));
    }

    if (button.dataset.action === "undo-payment") {
      undoLastPayment(record);
    }
  });

  elements.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderRecords();
  });
  elements.showPaid.addEventListener("change", (event) => {
    state.showPaid = event.target.checked;
    renderRecords();
  });

  elements.syncButton.addEventListener("click", () => loadRecords());
  elements.printLedgerButton.addEventListener("click", () => {
    printHtml(buildLedgerPrintHtml(getFilteredRecords()));
  });
  elements.settingsButton.addEventListener("click", openSettings);
  elements.accountButton.addEventListener("click", openAccount);
  elements.logoutButton.addEventListener("click", () => {
    window.location.href = "/logout";
  });

  elements.cancelPaymentButton.addEventListener("click", () => elements.paymentDialog.close());
  elements.cancelEditButton.addEventListener("click", () => elements.editDialog.close());
  elements.cancelSettingsButton.addEventListener("click", () => elements.settingsDialog.close());
  elements.closeHistoryButton.addEventListener("click", () => elements.historyDialog.close());
  elements.historyDoneButton.addEventListener("click", () => elements.historyDialog.close());
  elements.generateInvitationButton.addEventListener("click", generateInvitation);
  elements.copyInvitationButton.addEventListener("click", copyInvitation);
  elements.recoveryEmailForm.addEventListener("submit", saveRecoveryEmail);
  elements.resendVerificationButton.addEventListener("click", resendRecoveryVerification);
  elements.passwordForm.addEventListener("submit", changePassword);
  elements.staffForm.addEventListener("submit", saveStaffUser);
  elements.cancelStaffEditButton.addEventListener("click", resetStaffForm);
  elements.refreshActivityButton.addEventListener("click", loadActivity);
  elements.enterpriseAccessForm.addEventListener("submit", resetEnterpriseAccess);
  elements.cancelEnterpriseAccessButton.addEventListener("click", () =>
    elements.enterpriseAccessDialog.close(),
  );
  elements.invitationList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-invite-action='revoke']");
    if (button) revokeInvitation(button.dataset.id);
  });
  elements.staffList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-user-action]");
    if (!button) return;
    if (button.dataset.userAction === "edit") editStaffUser(button.dataset.id);
    if (button.dataset.userAction === "reset") {
      editStaffUser(button.dataset.id);
      elements.staffPassword.focus();
    }
    if (button.dataset.userAction === "status") changeStaffStatus(button.dataset.id, button.dataset.status);
  });
  elements.enterpriseList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-enterprise-action]");
    if (!button) return;
    if (button.dataset.enterpriseAction === "reset") openEnterpriseAccess(button.dataset.id);
    if (button.dataset.enterpriseAction === "status") {
      changeEnterpriseStatus(button.dataset.id, button.dataset.status);
    }
    if (button.dataset.enterpriseAction === "remove") {
      removeManagedEnterprise(button.dataset.id);
    }
  });
  elements.historyUndoButton.addEventListener("click", () => {
    const record = state.records.find((item) => item.id === elements.historyDialog.dataset.recordId);
    if (record) undoLastPayment(record);
  });
  document.querySelectorAll("dialog .icon-button.small").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });

  elements.settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.settings.useMysql = elements.useMysql.checked;
    state.settings.apiUrl = elements.apiUrl.value.trim();
    state.settings.useSheets = elements.useSheets.checked;
    state.settings.sheetsUrl = elements.sheetsUrl.value.trim();
    saveSettings();
    elements.settingsDialog.close();
    await loadSessionInfo();
    await loadRecords();
    toast("Settings saved");
  });
}

async function init() {
  elements.creditDate.value = today();
  elements.creditTime.value = currentTime();
  bindEvents();
  await loadSessionInfo();
  loadSettings();
  await loadRecords();
}

init().catch((error) => {
  updateStorageStatus("Could not load records");
  toast(error.message);
});
