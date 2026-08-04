const form = document.querySelector("#orderForm");
const productRows = document.querySelector("#productRows");
const saveButton = document.querySelector("#saveButton");
const formMessage = document.querySelector("#formMessage");
const params = new URLSearchParams(location.search);
const editId = params.get("edit");
const demoMode = params.get("demo") === "1" || location.protocol === "file:" || ["127.0.0.1", "localhost"].includes(location.hostname);

setPickupDefaults();
addProductRow();
applyAiDraft();
if (editId) loadOrderForEdit();
productRows.addEventListener("click", (event) => {
  const addButton = event.target.closest(".inline-add-product-button");
  if (addButton) {
    addProductRow();
    productRows.lastElementChild.querySelector('[data-field="productName"]').focus();
    return;
  }
  const button = event.target.closest(".remove-product-button");
  if (!button) return;
  if (productRows.children.length === 1) return showMessage("An order needs at least one product.", true);
  button.closest(".product-row").remove();
  renumberProducts();
});
form.addEventListener("submit", saveOrder);

function addProductRow(item = {}) {
  const row = document.createElement("article");
  row.className = "product-row";
  row.innerHTML = `<div class="product-row-heading"><strong>Product</strong><button class="remove-product-button" type="button" aria-label="Remove product">Remove</button></div>
    <div class="product-fields">
      <label>Product name *<span class="product-name-entry"><input data-field="productName" maxlength="160" list="meatTypes" required><button class="inline-add-product-button" type="button" aria-label="Add another product" title="Add another product">+</button></span></label>
      <label class="wide">Special instructions<textarea data-field="specialInstructions" maxlength="500" rows="2" placeholder="Cutting, preparation, or packaging instructions…"></textarea></label>
    </div>`;
  productRows.append(row);
  for (const [key, value] of Object.entries(item)) {
    const input = row.querySelector(`[data-field="${key}"]`);
    if (input && value != null) input.value = value;
  }
  renumberProducts();
}

function renumberProducts() {
  [...productRows.children].forEach((row, index) => {
    row.querySelector(".product-row-heading strong").textContent = `Product ${index + 1}`;
    row.querySelector(".remove-product-button").hidden = productRows.children.length === 1;
  });
}

function collectItems() {
  return [...productRows.querySelectorAll(".product-row")].map((row) => ({
    productName: row.querySelector('[data-field="productName"]').value.trim(),
    quantity: 1,
    unit: "item",
    specialInstructions: row.querySelector('[data-field="specialInstructions"]').value.trim(),
    price: null,
  }));
}

async function loadOrderForEdit() {
  try {
    const orders = demoMode ? loadDemoOrders() : (await api("/api/meat-orders")).orders;
    const order = orders.find((item) => item.id === editId);
    if (!order) throw new Error("Order not found");
    form.elements.customerName.value = order.customerName;
    form.elements.customerPhone.value = order.customerPhone;
    form.elements.preparationInstructions.value = order.preparationInstructions || "";
    form.elements.employeeName.value = order.employeeName;
    const pickup = new Date(order.pickupAt);
    form.elements.pickupDate.value = localDate(pickup);
    form.elements.pickupTime.value = `${String(pickup.getHours()).padStart(2, "0")}:${String(pickup.getMinutes()).padStart(2, "0")}`;
    productRows.innerHTML = "";
    (order.items?.length ? order.items : [{ productName: order.meatType, specialInstructions: order.preparationInstructions }]).forEach(addProductRow);
    document.querySelector("h1").textContent = "Edit Order";
    saveButton.textContent = "Save Changes";
  } catch (error) { showMessage(error.message, true); saveButton.disabled = true; }
}

function applyAiDraft() {
  if (editId) return;
  try {
    const payload = JSON.parse(sessionStorage.getItem("nazicredit-ai-draft") || "null");
    if (payload?.context !== "order") return;
    sessionStorage.removeItem("nazicredit-ai-draft"); const d = payload.draft || {};
    form.elements.customerName.value = d.customerName || ""; form.elements.customerPhone.value = d.customerPhone || "";
    productRows.querySelector('[data-field="productName"]').value = d.product || "";
    productRows.querySelector('[data-field="specialInstructions"]').value = d.notes || "";
    if (d.pickupDate) form.elements.pickupDate.value = d.pickupDate;
    if (d.pickupTime) form.elements.pickupTime.value = d.pickupTime.slice(0, 5);
    showMessage("AI draft loaded. Review every field before saving.");
  } catch {}
}

function setPickupDefaults() { const pickup = new Date(Date.now() + 3600000); form.elements.pickupDate.value = localDate(pickup); form.elements.pickupTime.value = `${String(pickup.getHours()).padStart(2,"0")}:${String(pickup.getMinutes()).padStart(2,"0")}`; }

async function saveOrder(event) {
  event.preventDefault(); if (!form.reportValidity()) return;
  const values = new FormData(form); const pickupAt = new Date(`${values.get("pickupDate")}T${values.get("pickupTime")}`);
  if (Number.isNaN(pickupAt.getTime())) return showMessage("Choose a valid pickup date and time.", true);
  const input = { customerName: values.get("customerName"), customerPhone: values.get("customerPhone"), items: collectItems(), preparationInstructions: values.get("preparationInstructions"), pickupAt: pickupAt.toISOString(), employeeName: values.get("employeeName") };
  saveButton.disabled = true; showMessage("Saving…");
  try {
    if (demoMode) {
      const orders = loadDemoOrders(); const existing = orders.find((order) => order.id === editId);
      if (existing) Object.assign(existing, input); else orders.push({ ...input, id: `demo-${Date.now()}`, createdAt: new Date().toISOString(), status: "pending", isActive: true });
      localStorage.setItem("nazicredit-demo-orders", JSON.stringify(orders));
    } else await api(editId ? `/api/meat-orders/${encodeURIComponent(editId)}` : "/api/meat-orders", { method: editId ? "PUT" : "POST", body: JSON.stringify(input) });
    location.href = demoMode ? "meat-orders.html?demo=1" : "meat-orders.html";
  } catch (error) { showMessage(error.message, true); saveButton.disabled = false; }
}

async function api(path, options = {}) { const response = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...options }); if (response.status === 401) { location.href = "/login"; throw new Error("Login required"); } const result = await response.json().catch(() => ({})); if (!response.ok || result.ok === false) throw new Error(result.error || "Could not save the order"); return result; }
function loadDemoOrders() { try { const saved = JSON.parse(localStorage.getItem("nazicredit-demo-orders") || "[]"); return Array.isArray(saved) ? saved : []; } catch { return []; } }
function localDate(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function showMessage(message, isError = false) { formMessage.textContent = message; formMessage.classList.toggle("error", isError); }
