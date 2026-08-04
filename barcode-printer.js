const LABEL_QUEUE_KEY = "barcode-printer-labels-v2";
const PRODUCTS_KEY = "barcode-printer-products-v1";
const LEGACY_PRODUCT_KEYS = ["easy-barcode-products-v1"];
const LEGACY_LABEL_KEYS = ["easy-barcode-labels-v1"];
const PRODUCT_API_PATH = "/api/products";
const PRODUCT_AUTO_SAVE_DELAY_MS = 350;

const OL875WX = {
  columns: 3,
  rows: 10,
  labelsPerSheet: 30,
  pageWidthIn: 8.5,
  pageHeightIn: 11,
  labelWidthIn: 2.625,
  labelHeightIn: 1,
  leftMarginIn: 0.1875,
  topMarginIn: 0.5,
  horizontalPitchIn: 2.75,
  verticalPitchIn: 1,
};
const GENERATED_BARCODE_DIGITS = 8;
const MAX_BARCODE_LENGTH = 48;
const BARCODE_WARNING_MODULE_IN = 0.008;

const FIXED_BARCODE_PROFILE = {
  labelWidthIn: 2.2,
  quietZoneIn: 0.12,
};

const FIXED_BARCODE_THICKNESS = {
  inkRatio: 0.68,
  minSvgWidth: 0.64,
  minPdfWidthPt: 0.16,
};

const code39Patterns = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn",
};

const code128Patterns = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];

const state = {
  labels: [],
  products: [],
  productStorage: "loading",
  offlineNoticeShown: false,
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const elements = {
  form: document.querySelector("#productForm"),
  productName: document.querySelector("#productName"),
  productPrice: document.querySelector("#productPrice"),
  labelQuantity: document.querySelector("#labelQuantity"),
  saveOnlyButton: document.querySelector("#saveOnlyButton"),
  productList: document.querySelector("#productList"),
  productCount: document.querySelector("#productCount"),
  productEmpty: document.querySelector("#productEmpty"),
  savedProductSearch: document.querySelector("#savedProductSearch"),
  clearProductSearch: document.querySelector("#clearProductSearch"),
  labelSheet: document.querySelector("#labelSheet"),
  labelCount: document.querySelector("#labelCount"),
  barcodeWarning: document.querySelector("#barcodeWarning"),
  emptyState: document.querySelector("#emptyState"),
  template: document.querySelector("#labelTemplate"),
  printButton: document.querySelector("#printButton"),
  downloadPdfButton: document.querySelector("#downloadPdfButton"),
  clearLabelsButton: document.querySelector("#clearLabelsButton"),
  clearAfterPrint: document.querySelector("#clearAfterPrint"),
  quickPrintDock: document.querySelector("#quickPrintDock"),
  dockLabelCount: document.querySelector("#dockLabelCount"),
  dockClearButton: document.querySelector("#dockClearButton"),
  dockPrintButton: document.querySelector("#dockPrintButton"),
  quickProductSearch: document.querySelector("#quickProductSearch"),
  quickProductOptions: document.querySelector("#quickProductOptions"),
  quickNewPrice: document.querySelector("#quickNewPrice"),
  changePriceButton: document.querySelector("#changePriceButton"),
  productNumbers: document.querySelector("#productNumbers"),
  showProductsButton: document.querySelector("#showProductsButton"),
  randomProductsButton: document.querySelector("#randomProductsButton"),
  allProductsButton: document.querySelector("#allProductsButton"),
  updatePreviewButton: document.querySelector("#updatePreviewButton"),
  loadProductsButton: document.querySelector("#loadProductsButton"),
  quickStatus: document.querySelector("#quickStatus"),
  toast: document.querySelector("#toast"),
};

const pendingRowSaveTimers = new Map();
const pendingProductSaves = new Map();
const productSaveVersions = new Map();
let printInProgress = false;

function uid(prefix = "item") {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanBarcode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^0-9A-Z ./$+%-]/g, "")
    .slice(0, MAX_BARCODE_LENGTH);
}

function clampQuantity(value) {
  return Math.min(OL875WX.labelsPerSheet, Math.max(1, Number.parseInt(value, 10) || 1));
}

function priceValue(value) {
  const normalized = String(value ?? "")
    .replace(/[$,\s]/g, "")
    .trim();
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function formatMoney(value) {
  return moneyFormatter.format(priceValue(value));
}

function quantityActionText(quantity) {
  const count = clampQuantity(quantity);
  return `Add ${count} Label${count === 1 ? "" : "s"}`;
}

function setClampedQuantity(input, value) {
  input.value = clampQuantity(value);
}

function clampQuantityOnBlur(input) {
  if (String(input.value).trim() === "") {
    input.value = "1";
  }
  setClampedQuantity(input, input.value);
}

function limitHighQuantity(input) {
  const value = Number.parseInt(input.value, 10);
  if (Number.isFinite(value) && value > OL875WX.labelsPerSheet) {
    input.value = String(OL875WX.labelsPerSheet);
  }
}

function updateRowGenerateButton(row) {
  const quantityInput = row?.querySelector('[data-field="quantity"]');
  const generateButton = row?.querySelector('[data-product-action="labels"]');
  if (!quantityInput || !generateButton) return;
  generateButton.textContent = quantityActionText(quantityInput.value);
}

function stepQuantityFromButton(button) {
  const input = button.closest(".quantity-stepper")?.querySelector('input[type="number"]');
  if (!input) return null;

  const delta =
    Number.parseInt(button.dataset.stepQuantity || button.dataset.productStep || "0", 10) || 0;
  setClampedQuantity(input, clampQuantity(input.value) + delta);
  return input;
}

function updateProductRowSummary(row, product) {
  row.querySelector('[data-summary="price"]').textContent = formatMoney(product.price);
  row.querySelector('[data-summary="quantity"]').textContent = `Qty ${product.quantity}`;
  row.querySelector('[data-summary="barcode"]').textContent = product.barcode;
}

function saveProductRow(row, product, options = {}) {
  const saved = upsertProductLocal(productFromRow(row, product), {
    render: false,
    syncQueuedLabels: true,
  });
  updateProductRowSummary(row, saved);
  updateRowGenerateButton(row);
  renderLabels();
  queueProductSave(saved);

  if (!options.silent) {
    toast("Product updated");
  }

  return saved;
}

async function saveVisibleProductEdits() {
  let changed = false;

  try {
    for (const row of elements.productList.querySelectorAll(".product-item")) {
      const product = state.products.find((item) => item.id === row.dataset.id);
      if (!product) continue;

      const updated = productFromRow(row, product);
      const hasChanged =
        updated.price !== product.price ||
        updated.quantity !== product.quantity ||
        updated.barcode !== product.barcode;

      if (hasChanged) {
        const saved = upsertProductLocal(updated, { render: false, syncQueuedLabels: true });
        updateProductRowSummary(row, saved);
        updateRowGenerateButton(row);
        queueProductSave(saved);
        changed = true;
      }
    }
  } catch (error) {
    toast(error.message);
    return false;
  }

  if (changed) {
    renderLabels();
  }

  return flushProductSaves();
}

function storageRead(key, fallback = []) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function storageWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast("Browser storage is full");
  }
}

async function productApiRequest(path = "", options = {}) {
  const response = await fetch(`${PRODUCT_API_PATH}${path}`, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : {};
  const redirectedToLogin =
    response.redirected && new URL(response.url, window.location.href).pathname === "/login";

  if (redirectedToLogin || response.status === 401) {
    const error = new Error("Login required");
    error.status = response.status || 401;
    error.offlineFallback = true;
    throw error;
  }

  if (!response.ok || result.ok === false) {
    const error = new Error(result.error || `Product API request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return result;
}

function shouldUseOfflineFallback(error) {
  return error?.offlineFallback || error?.status !== 403;
}

function enableOfflineProductFallback(error) {
  if (!shouldUseOfflineFallback(error)) return false;
  state.productStorage = "offline";

  if (!state.offlineNoticeShown) {
    toast("Using browser fallback. Log in to save products permanently.");
    state.offlineNoticeShown = true;
  }

  renderProducts();
  return true;
}

async function saveProductToApi(product) {
  const result = await productApiRequest("", {
    method: "POST",
    body: JSON.stringify(product),
  });
  return markProductDatabaseBacked(normalizeProduct(result.product));
}

async function deleteProductFromApi(productId) {
  await productApiRequest(`/${encodeURIComponent(productId)}`, {
    method: "DELETE",
  });
}

async function deleteProduct(product) {
  if (state.productStorage === "offline") return;

  if (!(await flushProductSaves())) {
    throw new Error("Finish saving products before deleting");
  }

  try {
    await deleteProductFromApi(product.id);
  } catch (error) {
    if (!enableOfflineProductFallback(error)) {
      throw error;
    }
  }
}

function loadState() {
  const productRows = [
    ...storageRead(PRODUCTS_KEY),
    ...LEGACY_PRODUCT_KEYS.flatMap((key) => storageRead(key)),
  ];

  state.products = mergeProducts(productRows);

  const labelRows = [
    ...storageRead(LABEL_QUEUE_KEY),
    ...LEGACY_LABEL_KEYS.flatMap((key) => storageRead(key)),
  ];
  state.labels = mergeLabels(labelRows);

  saveProducts();
  saveLabels();
  return {
    products: state.products.slice(),
    labels: state.labels.slice(),
  };
}

function mergeProducts(products) {
  const merged = [];

  for (const row of products) {
    const product = normalizeProduct(row);
    if (!product) continue;

    const index = merged.findIndex((item) => item.id === product.id || item.barcode === product.barcode);
    if (index >= 0) {
      merged[index] = {
        ...merged[index],
        ...product,
        id: merged[index].id,
        createdAt: merged[index].createdAt || product.createdAt,
      };
    } else {
      merged.push(product);
    }
  }

  return merged.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}

function mergeLabels(labels) {
  const merged = [];
  const seen = new Set();

  for (const row of labels) {
    const label = normalizeLabel(row);
    if (!label || seen.has(label.id)) continue;
    seen.add(label.id);
    merged.push(label);
  }

  return merged;
}

function normalizeProduct(product) {
  if (!product) return null;

  const name = String(product.name || "").trim();
  const barcode = cleanBarcode(product.barcode);
  if (!name || !barcode) return null;

  const now = new Date().toISOString();
  return {
    id: product.id || uid("product"),
    name,
    price: priceValue(product.price),
    barcode,
    quantity: clampQuantity(product.quantity || product.copies || 1),
    storedInDatabase: Boolean(product.storedInDatabase),
    createdAt: product.createdAt || now,
    updatedAt: product.updatedAt || now,
  };
}

function normalizeLabel(label) {
  if (!label) return null;

  const name = String(label.name || "").trim();
  const barcode = cleanBarcode(label.barcode);
  const product = state.products.find(
    (item) => item.id === label.productId || item.barcode === barcode,
  );
  if (!name || !barcode) return null;

  const price = label.price === undefined || label.price === null || label.price === "" ? product?.price : label.price;
  return {
    id: label.id || uid("label"),
    productId: label.productId || product?.id || "",
    name,
    price: priceValue(price),
    barcode,
  };
}

function markProductDatabaseBacked(product) {
  return product
    ? {
        ...product,
        storedInDatabase: true,
      }
    : null;
}

function markProductBrowserOnly(product) {
  return product
    ? {
        ...product,
        storedInDatabase: false,
      }
    : null;
}

async function loadProductsFromApi(localProducts = []) {
  try {
    const result = await productApiRequest();
    state.productStorage = "database";
    state.offlineNoticeShown = false;

    let databaseProducts = mergeProducts(
      (Array.isArray(result.products) ? result.products : []).map(markProductDatabaseBacked),
    );
    const databaseBarcodes = new Set(databaseProducts.map((product) => product.barcode));
    let migratedCount = 0;

    const productsToMigrate = mergeProducts([...localProducts, ...state.products]);
    for (const product of productsToMigrate) {
      if (product.storedInDatabase) continue;
      if (databaseBarcodes.has(product.barcode)) continue;
      const saved = await saveProductToApi(product);
      if (!saved) continue;
      databaseProducts = mergeProducts([saved, ...databaseProducts]);
      databaseBarcodes.add(saved.barcode);
      migratedCount += 1;
    }

    state.products = databaseProducts;
    reconcileLabelsWithProducts();
    saveProducts();
    saveLabels();
    renderProducts();
    renderLabels();

    if (migratedCount) {
      toast(`${migratedCount} browser product${migratedCount === 1 ? "" : "s"} saved permanently`);
    }
  } catch (error) {
    if (!enableOfflineProductFallback(error)) {
      state.productStorage = "offline";
      renderProducts();
      toast(error.message);
    }
  }
}

function reconcileLabelsWithProducts() {
  let changed = false;
  state.labels = state.labels.map((label) => {
    const product = state.products.find(
      (item) => item.id === label.productId || item.barcode === label.barcode,
    );
    if (!product) return label;

    if (
      label.productId === product.id &&
      label.name === product.name &&
      label.price === product.price &&
      label.barcode === product.barcode
    ) {
      return label;
    }

    changed = true;
    return {
      ...label,
      productId: product.id,
      name: product.name,
      price: product.price,
      barcode: product.barcode,
    };
  });

  return changed;
}

function saveProducts() {
  storageWrite(PRODUCTS_KEY, state.products);
}

function saveLabels() {
  storageWrite(LABEL_QUEUE_KEY, state.labels);
}

function generateBarcode(_name = "", reserved = new Set()) {
  const used = new Set([
    ...reserved,
    ...state.products.map((product) => product.barcode),
    ...state.labels.map((label) => label.barcode),
  ]);
  let barcode = randomNumericBarcode();

  while (used.has(barcode)) {
    barcode = randomNumericBarcode();
  }

  reserved.add(barcode);
  return barcode;
}

function randomNumericBarcode() {
  const minimum = 10 ** (GENERATED_BARCODE_DIGITS - 1);
  const range = 9 * minimum;

  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return String(minimum + (values[0] % range));
  }

  return String(Math.floor(minimum + Math.random() * range));
}

function productFromForm() {
  const name = elements.productName.value.trim();
  if (!name) {
    throw new Error("Product name is required");
  }

  const product = normalizeProduct({
    id: uid("product"),
    name,
    price: elements.productPrice.value,
    quantity: elements.labelQuantity.value,
    barcode: generateBarcode(name),
  });

  if (!product) {
    throw new Error("Barcode is required");
  }

  return product;
}

function productFromRow(row, product, options = {}) {
  const barcode = options.barcode || product.barcode;
  const duplicate = state.products.find((item) => item.id !== product.id && item.barcode === barcode);

  if (!barcode) {
    throw new Error("Barcode number is required");
  }

  if (duplicate) {
    throw new Error("Barcode already belongs to another product");
  }

  return {
    ...product,
    price: priceValue(row.querySelector('[data-field="price"]').value),
    quantity: clampQuantity(row.querySelector('[data-field="quantity"]').value),
    barcode,
    storedInDatabase: product.storedInDatabase && state.productStorage !== "offline",
    updatedAt: new Date().toISOString(),
  };
}

function upsertProductLocal(product, options = {}) {
  const normalized = normalizeProduct(product);
  if (!normalized) return null;

  const shouldRender = options.render !== false;
  const index = state.products.findIndex(
    (item) => item.id === normalized.id || item.barcode === normalized.barcode,
  );
  let saved;

  if (index >= 0) {
    saved = {
      ...state.products[index],
      ...normalized,
      id: options.keepExistingId === false ? normalized.id : state.products[index].id,
      createdAt: state.products[index].createdAt || normalized.createdAt,
      updatedAt: new Date().toISOString(),
    };
    state.products[index] = saved;
    state.products.unshift(...state.products.splice(index, 1));
  } else {
    saved = {
      ...normalized,
      updatedAt: new Date().toISOString(),
    };
    state.products.unshift(saved);
  }

  saveProducts();

  if (options.syncQueuedLabels) {
    syncQueuedLabels(saved);
  }

  if (shouldRender) {
    renderProducts();
  }

  return saved;
}

async function upsertProduct(product, options = {}) {
  const normalized = normalizeProduct(product);
  if (!normalized) return null;

  if (state.productStorage !== "offline" && !options.localOnly) {
    try {
      return await persistProductToApi(normalized, options);
    } catch (error) {
      if (!enableOfflineProductFallback(error)) throw error;
      return upsertProductLocal(markProductBrowserOnly(normalized), options);
    }
  }

  return upsertProductLocal(normalized, options);
}

async function persistProductToApi(product, options = {}) {
  const normalized = normalizeProduct(product);
  if (!normalized) return null;

  const version = (productSaveVersions.get(normalized.id) || 0) + 1;
  productSaveVersions.set(normalized.id, version);

  const operation = saveProductToApi(normalized)
    .then((savedProduct) => {
      if (productSaveVersions.get(normalized.id) !== version) {
        return savedProduct;
      }

      state.productStorage = "database";
      state.offlineNoticeShown = false;
      const saved = upsertProductLocal(savedProduct, {
        ...options,
        keepExistingId: false,
      });
      reconcileLabelsWithProducts();
      return saved;
    })
    .finally(() => {
      if (pendingProductSaves.get(normalized.id) === operation) {
        pendingProductSaves.delete(normalized.id);
      }
    });

  pendingProductSaves.set(normalized.id, operation);
  return operation;
}

function queueProductSave(product) {
  if (state.productStorage === "offline") return;

  const existingTimer = pendingRowSaveTimers.get(product.id);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    pendingRowSaveTimers.delete(product.id);
    const latest = state.products.find((item) => item.id === product.id);
    if (!latest) return;

    persistProductToApi(latest, { render: false, syncQueuedLabels: true }).catch((error) => {
      if (!enableOfflineProductFallback(error)) {
        toast(error.message);
        return;
      }
      upsertProductLocal(markProductBrowserOnly(latest), { render: false, syncQueuedLabels: true });
    });
  }, PRODUCT_AUTO_SAVE_DELAY_MS);

  pendingRowSaveTimers.set(product.id, timer);
}

async function flushProductSaves() {
  const queuedProductIds = [...pendingRowSaveTimers.keys()];
  for (const productId of queuedProductIds) {
    const timer = pendingRowSaveTimers.get(productId);
    if (timer) window.clearTimeout(timer);
    pendingRowSaveTimers.delete(productId);

    const product = state.products.find((item) => item.id === productId);
    if (product && state.productStorage !== "offline") {
      persistProductToApi(product, { render: false, syncQueuedLabels: true }).catch((error) => {
        if (!enableOfflineProductFallback(error)) throw error;
        upsertProductLocal(markProductBrowserOnly(product), {
          render: false,
          syncQueuedLabels: true,
        });
        return product;
      });
    }
  }

  const results = await Promise.allSettled([...pendingProductSaves.values()]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) {
    toast(failed.reason?.message || "Product save failed");
    return false;
  }

  return true;
}

function syncQueuedLabels(product) {
  let changed = false;
  state.labels = state.labels.map((label) => {
    if (label.productId !== product.id && label.barcode !== product.barcode) return label;
    changed = true;
    return {
      ...label,
      productId: product.id,
      name: product.name,
      price: product.price,
      barcode: product.barcode,
    };
  });

  if (changed) {
    saveLabels();
  }
}

function labelsForProduct(product, quantity = product.quantity) {
  const count = clampQuantity(quantity);
  return Array.from({ length: count }, () => ({
    id: uid("label"),
    productId: product.id,
    name: product.name,
    price: product.price,
    barcode: product.barcode,
  }));
}

function addProductLabels(product, quantity = product.quantity) {
  const labels = labelsForProduct(product, quantity);
  state.labels.push(...labels);
  saveLabels();
  renderLabels();
  toast(`${labels.length} label${labels.length === 1 ? "" : "s"} added`);
}

function setLabelsFromProducts(products) {
  state.labels = products.map((product) => ({
    id: uid("label"),
    productId: product.id,
    name: product.name,
    price: product.price,
    barcode: product.barcode,
  }));
  saveLabels();
  renderLabels();
  updateQuickStatus();
}

function productReference(product) {
  return state.products.findIndex((item) => item.id === product.id) + 1;
}

function productFromQuickSearch() {
  const query = elements.quickProductSearch.value.trim();
  const reference = Number.parseInt(query, 10);
  if (Number.isInteger(reference) && reference >= 1 && reference <= state.products.length) {
    return state.products[reference - 1];
  }

  const normalized = query.toLowerCase();
  return state.products.find((product) => {
    const referenceLabel = `${productReference(product)}. ${product.name}`.toLowerCase();
    return product.name.toLowerCase() === normalized || referenceLabel === normalized;
  });
}

function productsFromReferenceInput() {
  const references = elements.productNumbers.value
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter(Number.isInteger);

  if (!references.length) {
    throw new Error("Enter product numbers separated by commas");
  }

  const missing = references.find((reference) => reference < 1 || reference > state.products.length);
  if (missing) {
    throw new Error(`Product ${missing} was not found`);
  }

  return references.map((reference) => state.products[reference - 1]);
}

function randomProducts(limit = OL875WX.labelsPerSheet) {
  if (!state.products.length) return [];
  const shuffled = [...state.products];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return Array.from({ length: Math.min(limit, shuffled.length) }, (_, index) => shuffled[index]);
}

function updateQuickProductOptions() {
  if (!elements.quickProductOptions) return;
  elements.quickProductOptions.innerHTML = "";
  state.products.slice(0, 500).forEach((product, index) => {
    const option = document.createElement("option");
    option.value = `${index + 1}. ${product.name}`;
    option.label = `${formatMoney(product.price)} · #${index + 1}`;
    elements.quickProductOptions.append(option);
  });
}

function updateQuickStatus() {
  if (!elements.quickStatus) return;
  if (!state.labels.length) {
    elements.quickStatus.textContent = "Choose products to prepare labels.";
    return;
  }
  const pages = Math.ceil(state.labels.length / OL875WX.labelsPerSheet);
  elements.quickStatus.textContent = `Showing ${state.labels.length} label${state.labels.length === 1 ? "" : "s"}. ${OL875WX.labelsPerSheet} labels fit on one A4 page. ${pages} page${pages === 1 ? "" : "s"} ready.`;
}

function removeLabel(id) {
  state.labels = state.labels.filter((label) => label.id !== id);
  saveLabels();
  renderLabels();
}

function clearLabels() {
  if (!state.labels.length) {
    toast("No labels to clear");
    return;
  }

  state.labels = [];
  saveLabels();
  renderLabels();
  toast("Labels cleared");
}

function confirmClearLabels() {
  if (!state.labels.length) {
    toast("No labels to clear");
    return;
  }
  const labelText = state.labels.length === 1 ? "1 label" : `${state.labels.length} labels`;
  if (!window.confirm(`Clear ${labelText} from the print sheet? Saved products will not be deleted.`)) return;
  clearLabels();
}

function removeLastLabel() {
  if (!state.labels.length) {
    toast("No labels to remove");
    return;
  }

  state.labels.pop();
  saveLabels();
  renderLabels();
  toast("Last label removed");
}

function resetForm() {
  elements.productName.value = "";
  elements.productPrice.value = "";
  elements.labelQuantity.value = "1";
  elements.productName.focus();
}

function code39Runs(value, narrow = 1, wide = 2.45, gap = 1.25) {
  const encoded = `*${cleanBarcode(value)}*`;
  let x = 0;
  const bars = [];

  for (const char of encoded) {
    const pattern = code39Patterns[char];
    if (!pattern) continue;

    for (let index = 0; index < pattern.length; index += 1) {
      const width = pattern[index] === "w" ? wide : narrow;
      if (index % 2 === 0) {
        bars.push({ x, width });
      }
      x += width;
    }
    x += gap;
  }

  return { bars, width: x, encoded, symbology: "Code 39" };
}

function code128Runs(value) {
  const cleaned = cleanBarcode(value);

  if (/^\d{4,}$/.test(cleaned)) {
    return code128NumericRuns(cleaned);
  }

  return code128BRuns(cleaned);
}

function code128NumericRuns(value) {
  const dataCodes = [];
  let startCode = 105;
  let index = 0;

  if (value.length % 2 === 1) {
    startCode = 104;
    dataCodes.push(value.charCodeAt(0) - 32, 99);
    index = 1;
  }

  for (; index < value.length; index += 2) {
    dataCodes.push(Number.parseInt(value.slice(index, index + 2), 10));
  }

  return code128RunsFromCodes(startCode, dataCodes, value);
}

function code128BRuns(value) {
  const dataCodes = Array.from(value, (char) => char.charCodeAt(0) - 32);
  return code128RunsFromCodes(104, dataCodes, value);
}

function code128RunsFromCodes(startCode, dataCodes, encoded) {
  const checksum =
    (startCode + dataCodes.reduce((total, code, index) => total + code * (index + 1), 0)) % 103;
  const codes = [startCode, ...dataCodes, checksum, 106];
  let x = 0;
  const bars = [];

  for (const code of codes) {
    const pattern = code128Patterns[code];
    if (!pattern) continue;

    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]);
      if (index % 2 === 0) {
        bars.push({ x, width });
      }
      x += width;
    }
  }

  return { bars, width: x, encoded, symbology: "Code 128" };
}

function barcodeRuns(value) {
  const cleaned = cleanBarcode(value);
  return code39Runs(cleaned);
}

function scaledBarcodeBars(
  metrics,
  width = 1200,
  quietZone = 50,
  thickness = FIXED_BARCODE_THICKNESS,
) {
  const usableWidth = width - quietZone * 2;
  const unit = usableWidth / Math.max(metrics.width, 1);
  return metrics.bars.map((bar) => {
    const nominalWidth = bar.width * unit;
    const inkWidth = Math.min(
      nominalWidth,
      Math.max(thickness.minSvgWidth, nominalWidth * thickness.inkRatio),
    );

    return {
      x: quietZone + bar.x * unit + Math.max(0, (nominalWidth - inkWidth) / 2),
      width: inkWidth,
    };
  });
}

function barcodeModuleWidthIn(value) {
  const profile = FIXED_BARCODE_PROFILE;
  const metrics = barcodeRuns(value);
  const usableWidth = profile.labelWidthIn - profile.quietZoneIn * 2;
  return usableWidth / Math.max(metrics.width, 1);
}

function barcodeNeedsWarning(value) {
  return barcodeModuleWidthIn(value) < BARCODE_WARNING_MODULE_IN;
}

function updateBarcodeWarning() {
  if (!elements.barcodeWarning) return;
  const hasWarning = state.labels.some((label) => barcodeNeedsWarning(label.barcode));
  elements.barcodeWarning.hidden = !hasWarning;
}

function barcodeSvg(value) {
  const metrics = barcodeRuns(value);
  const profile = FIXED_BARCODE_PROFILE;
  const width = 1200;
  const height = 160;
  const top = 18;
  const barHeight = 124;
  const quietZone = Math.max(8, Math.round((profile.quietZoneIn / profile.labelWidthIn) * width));
  const bars = scaledBarcodeBars(metrics, width, quietZone, FIXED_BARCODE_THICKNESS)
    .map((bar) => `<rect x="${fixed(bar.x)}" y="${top}" width="${fixed(bar.width)}" height="${barHeight}" />`)
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${metrics.symbology || "Barcode"} ${metrics.encoded}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" />
      <g fill="#000000">${bars}</g>
    </svg>
  `;
}

function renderProducts() {
  elements.productList.innerHTML = "";
  const searchTerm = elements.savedProductSearch.value.trim().toLowerCase();
  const visibleProducts = state.products.filter((product, index) => {
    if (!searchTerm) return false;
    const reference = String(index + 1);
    return `${reference} ${product.name} ${product.barcode}`.toLowerCase().includes(searchTerm);
  });
  elements.productEmpty.hidden = visibleProducts.length > 0;
  elements.productEmpty.textContent = searchTerm
    ? "No saved products match your search."
    : state.products.length
      ? "Saved products are hidden. Search above to find one."
      : "No saved products yet";
  const storageText =
    state.productStorage === "database"
      ? "database permanent"
      : state.productStorage === "loading"
        ? "checking database"
        : "offline browser fallback";
  const matchText = searchTerm ? `${visibleProducts.length} of ` : "";
  elements.productCount.textContent = `${matchText}${state.products.length} product${state.products.length === 1 ? "" : "s"} saved - ${storageText}`;

  for (const product of visibleProducts) {
    const item = document.createElement("article");
    item.className = "product-item";
    item.dataset.id = product.id;
    item.innerHTML = `
      <div class="product-title">
        <div>
          <strong></strong>
          <div class="product-summary">
            <span data-summary="price"></span>
            <span data-summary="quantity"></span>
            <span data-summary="barcode"></span>
          </div>
        </div>
        <button class="ghost-button remove-product danger-button" type="button" data-product-action="delete">Delete</button>
      </div>
      <div class="product-controls">
        <label>
          Price
          <input data-field="price" type="number" min="0" step="0.01" inputmode="decimal" />
        </label>
        <label>
          Quantity
          <div class="quantity-stepper">
            <button class="stepper-button" type="button" data-product-step="-1" aria-label="Decrease saved quantity">-</button>
            <input data-field="quantity" type="number" min="1" max="30" step="1" />
            <button class="stepper-button" type="button" data-product-step="1" aria-label="Increase saved quantity">+</button>
          </div>
        </label>
        <div class="row-actions">
          <button class="primary-button" type="button" data-product-action="labels">${quantityActionText(product.quantity)}</button>
          <button class="ghost-button" type="button" data-product-action="fill">Fill 30 Labels</button>
        </div>
      </div>
    `;

    item.querySelector("strong").textContent = `${productReference(product)}. ${product.name}`;
    item.querySelector('[data-summary="price"]').textContent = formatMoney(product.price);
    item.querySelector('[data-summary="quantity"]').textContent = `Qty ${product.quantity}`;
    item.querySelector('[data-summary="barcode"]').textContent = product.barcode;
    item.querySelector('[data-field="price"]').value = product.price.toFixed(2);
    item.querySelector('[data-field="quantity"]').value = product.quantity;
    elements.productList.append(item);
  }
  updateQuickProductOptions();
}

function renderLabels() {
  elements.labelSheet.innerHTML = "";
  elements.emptyState.hidden = state.labels.length > 0;

  const pageCount = Math.ceil(state.labels.length / OL875WX.labelsPerSheet);
  elements.labelCount.textContent = state.labels.length
    ? `${state.labels.length} label${state.labels.length === 1 ? "" : "s"} ready, ${pageCount} sheet${pageCount === 1 ? "" : "s"}`
    : "0 labels ready";
  elements.dockLabelCount.textContent = `${state.labels.length} ${state.labels.length === 1 ? "label" : "labels"}`;
  elements.dockPrintButton.disabled = state.labels.length === 0;
  elements.dockClearButton.disabled = state.labels.length === 0;
  elements.quickPrintDock.classList.toggle("has-labels", state.labels.length > 0);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = document.createElement("section");
    page.className = "label-page";
    page.setAttribute("aria-label", `OL875WX sheet ${pageIndex + 1}`);

    for (let slotIndex = 0; slotIndex < OL875WX.labelsPerSheet; slotIndex += 1) {
      const label = state.labels[pageIndex * OL875WX.labelsPerSheet + slotIndex];
      const slot = document.createElement("div");
      slot.className = "label-slot";
      if (label) {
        slot.append(createLabelNode(label));
      }
      page.append(slot);
    }

    elements.labelSheet.append(page);
  }

  updateBarcodeWarning();
  updateQuickStatus();
}

function createLabelNode(label) {
  const node = elements.template.content.firstElementChild.cloneNode(true);
  node.dataset.id = label.id;
  node.querySelector(".label-name").textContent = label.name;
  node.querySelector(".label-price").textContent = formatMoney(label.price);
  node.querySelector(".barcode-wrap").innerHTML = barcodeSvg(label.barcode);
  const code = node.querySelector(".label-code");
  code.textContent = label.barcode;
  code.classList.toggle("long-code", label.barcode.length > 18);
  code.classList.toggle("very-long-code", label.barcode.length > 32);
  node.querySelector(".remove-label").addEventListener("click", () => removeLabel(label.id));
  return node;
}

async function printLabels() {
  if (!(await saveVisibleProductEdits())) return;

  if (!state.labels.length) {
    toast("Add labels first");
    return;
  }
  printInProgress = true;
  fetch("/api/barcode-print-events", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ labelCount: state.labels.length }),
  }).catch(() => {});
  window.print();
}

function finishPrintQueue() {
  if (!printInProgress) return;
  printInProgress = false;
  if (!elements.clearAfterPrint.checked || !state.labels.length) return;
  clearLabels();
  toast("Printed labels cleared. Ready for the next product.");
}

async function downloadPdf() {
  if (!(await saveVisibleProductEdits())) return;

  if (!state.labels.length) {
    toast("Add labels first");
    return;
  }

  const pdf = buildPdf(state.labels);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `ol875wx-barcode-labels-${stamp}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("PDF ready");
}

function buildPdf(labels) {
  const pt = 72;
  const pageWidth = OL875WX.pageWidthIn * pt;
  const pageHeight = OL875WX.pageHeightIn * pt;
  const objects = [];

  function addObject(value) {
    objects.push(value);
    return objects.length;
  }

  const catalogId = addObject("");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const monoFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const pageIds = [];
  const pageCount = Math.ceil(labels.length / OL875WX.labelsPerSheet);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageLabels = labels.slice(
      pageIndex * OL875WX.labelsPerSheet,
      (pageIndex + 1) * OL875WX.labelsPerSheet,
    );
    const content = buildPdfPageContent(pageLabels);
    const contentId = addObject(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageId = addObject(
      [
        "<< /Type /Page",
        `/Parent ${pagesId} 0 R`,
        `/MediaBox [0 0 ${pageWidth} ${pageHeight}]`,
        `/Resources << /Font << /F1 ${fontId} 0 R /F2 ${monoFontId} 0 R /F3 ${boldFontId} 0 R >> >>`,
        `/Contents ${contentId} 0 R`,
        ">>",
      ].join(" "),
    );
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

function buildPdfPageContent(pageLabels) {
  const commands = ["0 0 0 rg"];

  pageLabels.forEach((label, slotIndex) => {
    const column = slotIndex % OL875WX.columns;
    const row = Math.floor(slotIndex / OL875WX.columns);
    const leftIn = OL875WX.leftMarginIn + column * OL875WX.horizontalPitchIn;
    const topIn = OL875WX.topMarginIn + row * OL875WX.verticalPitchIn;
    commands.push(...pdfLabelCommands(label, leftIn, topIn));
  });

  return commands.join("\n");
}

function pdfLabelCommands(label, leftIn, topIn) {
  const pt = 72;
  const pageHeightPt = OL875WX.pageHeightIn * pt;
  const centerX = (leftIn + OL875WX.labelWidthIn / 2) * pt;
  const sizeProfile = FIXED_BARCODE_PROFILE;
  const thicknessProfile = FIXED_BARCODE_THICKNESS;
  const barcodeTotalWidthIn = sizeProfile.labelWidthIn;
  const barcodeQuietZoneIn = sizeProfile.quietZoneIn;
  const barcodeUsableWidthIn = barcodeTotalWidthIn - barcodeQuietZoneIn * 2;
  const commands = [];

  commands.push(
    pdfCenteredText(fitText(label.name, 38), centerX, pageHeightPt - (topIn + 0.115) * pt, 7, "F3", 0.46),
  );
  commands.push(
    pdfCenteredText(formatMoney(label.price), centerX, pageHeightPt - (topIn + 0.245) * pt, 9.4, "F3", 0.52),
  );

  const barcodeTopIn = topIn + 0.34;
  const barcodeHeightIn = 0.42;
  const metrics = barcodeRuns(label.barcode);
  const unitIn = barcodeUsableWidthIn / Math.max(metrics.width, 1);
  const barcodeLeftIn = leftIn + (OL875WX.labelWidthIn - barcodeTotalWidthIn) / 2;
  const barLeftIn = barcodeLeftIn + barcodeQuietZoneIn;
  const barcodeBottomPt = pageHeightPt - (barcodeTopIn + barcodeHeightIn) * pt;

  metrics.bars.forEach((bar) => {
    const nominalWidth = bar.width * unitIn * pt;
    const width = Math.min(
      nominalWidth,
      Math.max(thicknessProfile.minPdfWidthPt, nominalWidth * thicknessProfile.inkRatio),
    );
    const x = (barLeftIn + bar.x * unitIn) * pt + Math.max(0, (nominalWidth - width) / 2);
    commands.push(`${fixed(x)} ${fixed(barcodeBottomPt)} ${fixed(width)} ${fixed(barcodeHeightIn * pt)} re f`);
  });

  const codeText = fitText(label.barcode, MAX_BARCODE_LENGTH);
  const codeFontSize = codeText.length > 40 ? 4.4 : codeText.length > 32 ? 4.8 : codeText.length > 24 ? 5.2 : codeText.length > 18 ? 5.6 : 6.1;
  commands.push(pdfCenteredText(codeText, centerX, pageHeightPt - (topIn + 0.91) * pt, codeFontSize, "F2", 0.52));

  return commands;
}

function pdfCenteredText(text, centerX, y, size, font, widthFactor) {
  const estimatedWidth = String(text || "").length * size * widthFactor;
  return pdfText(text, centerX - estimatedWidth / 2, y, size, font);
}

function pdfText(text, x, y, size, font) {
  return `BT /${font} ${fixed(size)} Tf 1 0 0 1 ${fixed(x)} ${fixed(y)} Tm (${escapePdfText(text)}) Tj ET`;
}

function escapePdfText(value) {
  return String(value || "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function fitText(value, maxChars) {
  const text = String(value || "").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}.` : text;
}

function fixed(value) {
  return Number(value).toFixed(2);
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(toast.timeout);
  toast.timeout = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2200);
}

function bindEvents() {
  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const product = await upsertProduct(productFromForm(), { render: false, syncQueuedLabels: true });
      addProductLabels(product, product.quantity);
      renderProducts();
      resetForm();
    } catch (error) {
      toast(error.message);
    }
  });

  elements.saveOnlyButton.addEventListener("click", async () => {
    try {
      await upsertProduct(productFromForm(), { syncQueuedLabels: true });
      renderLabels();
      resetForm();
      toast("Product saved");
    } catch (error) {
      toast(error.message);
    }
  });

  elements.form.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-step-quantity]");
    if (!button) return;
    stepQuantityFromButton(button);
  });

  elements.labelQuantity.addEventListener("change", (event) => {
    clampQuantityOnBlur(event.target);
  });

  elements.labelQuantity.addEventListener("input", (event) => {
    limitHighQuantity(event.target);
  });

  elements.productList.addEventListener("input", (event) => {
    if (event.target.matches('[data-field="quantity"]')) {
      limitHighQuantity(event.target);
      updateRowGenerateButton(event.target.closest(".product-item"));
    }
  });

  elements.productList.addEventListener("change", (event) => {
    const row = event.target.closest(".product-item");
    const product = state.products.find((item) => item.id === row?.dataset.id);
    if (!row || !product) return;

    if (event.target.matches('[data-field="quantity"]')) {
      clampQuantityOnBlur(event.target);
      updateRowGenerateButton(row);
    }

    if (event.target.matches('[data-field="price"], [data-field="quantity"]')) {
      try {
        saveProductRow(row, product);
      } catch (error) {
        toast(error.message);
      }
    }
  });

  elements.productList.addEventListener("click", async (event) => {
    const stepButton = event.target.closest("button[data-product-step]");
    if (stepButton) {
      const row = stepButton.closest(".product-item");
      const product = state.products.find((item) => item.id === row?.dataset.id);
      if (!row || !product) return;

      try {
        stepQuantityFromButton(stepButton);
        saveProductRow(row, product, { silent: true });
      } catch (error) {
        toast(error.message);
      }
      return;
    }

    const button = event.target.closest("button[data-product-action]");
    if (!button) return;

    const row = button.closest(".product-item");
    const product = state.products.find((item) => item.id === row?.dataset.id);
    if (!product) return;

    try {
      if (button.dataset.productAction === "delete") {
        if (!window.confirm(`Remove ${product.name}?`)) return;
        await deleteProduct(product);
        state.products = state.products.filter((item) => item.id !== product.id);
        state.labels = state.labels.filter(
          (label) => label.productId !== product.id && label.barcode !== product.barcode,
        );
        saveProducts();
        saveLabels();
        renderProducts();
        renderLabels();
        toast("Product removed");
        return;
      }

      const updated = productFromRow(row, product);

      if (button.dataset.productAction === "fill") {
        const filled = {
          ...updated,
          quantity: OL875WX.labelsPerSheet,
        };
        const saved = await upsertProduct(filled, { render: false, syncQueuedLabels: true });
        addProductLabels(saved, OL875WX.labelsPerSheet);
        renderProducts();
        return;
      }

      if (button.dataset.productAction === "labels") {
        const saved = await upsertProduct(updated, { render: false, syncQueuedLabels: true });
        addProductLabels(saved, saved.quantity);
        renderProducts();
        return;
      }

      await upsertProduct(updated, { syncQueuedLabels: true });
      renderLabels();
      toast("Product updated");
    } catch (error) {
      toast(error.message);
    }
  });

  elements.printButton.addEventListener("click", printLabels);
  elements.downloadPdfButton.addEventListener("click", downloadPdf);
  elements.clearLabelsButton.addEventListener("click", confirmClearLabels);
  elements.dockClearButton.addEventListener("click", confirmClearLabels);
  elements.dockPrintButton.addEventListener("click", printLabels);
  elements.savedProductSearch.addEventListener("input", renderProducts);
  elements.clearProductSearch.addEventListener("click", () => {
    elements.savedProductSearch.value = "";
    renderProducts();
    elements.savedProductSearch.focus();
  });
  window.addEventListener("afterprint", finishPrintQueue);

  elements.showProductsButton.addEventListener("click", () => {
    try {
      setLabelsFromProducts(productsFromReferenceInput());
    } catch (error) {
      toast(error.message);
    }
  });

  elements.randomProductsButton.addEventListener("click", () => {
    const products = randomProducts();
    if (!products.length) {
      toast("No saved products found");
      return;
    }
    setLabelsFromProducts(products);
  });

  elements.allProductsButton.addEventListener("click", () => {
    if (!state.products.length) {
      toast("No saved products found");
      return;
    }
    setLabelsFromProducts(state.products);
  });

  elements.updatePreviewButton.addEventListener("click", async () => {
    if (await saveVisibleProductEdits()) {
      reconcileLabelsWithProducts();
      saveLabels();
      renderLabels();
      toast("Labels updated");
    }
  });

  elements.loadProductsButton.addEventListener("click", async () => {
    await loadProductsFromApi(state.products);
    toast(`${Math.min(state.products.length, 500)} products loaded`);
  });

  elements.changePriceButton.addEventListener("click", async () => {
    const product = productFromQuickSearch();
    if (!product) {
      toast("Choose a saved product");
      return;
    }
    if (elements.quickNewPrice.value.trim() === "") {
      toast("Enter the new price");
      return;
    }
    try {
      const saved = await upsertProduct({
        ...product,
        price: priceValue(elements.quickNewPrice.value),
        updatedAt: new Date().toISOString(),
      }, { syncQueuedLabels: true });
      renderProducts();
      renderLabels();
      elements.quickNewPrice.value = "";
      toast(`${saved.name} price changed`);
    } catch (error) {
      toast(error.message);
    }
  });
}

async function init() {
  await applyOwnerOnlyNavigation();
  const localState = loadState();
  bindEvents();
  renderProducts();
  renderLabels();
  await loadProductsFromApi(localState.products);
  applyAiBarcodeDraft();
}

function applyAiBarcodeDraft() {
  try {
    const payload = JSON.parse(sessionStorage.getItem("nazicredit-ai-draft") || "null");
    if (payload?.context !== "barcode") return;
    sessionStorage.removeItem("nazicredit-ai-draft");
    const d = payload.draft || {};
    const existing = state.products.find((p) =>
      (d.productId && p.id === d.productId) ||
      p.name.toLowerCase() === String(d.productName || "").toLowerCase()
    );
    if (existing) {
      addProductLabels(existing, d.quantity || 1);
      toast("AI label draft prepared. Review the preview before printing.");
      return;
    }
    elements.productName.value = d.productName || "";
    if (Number(d.price) >= 0) elements.productPrice.value = Number(d.price).toFixed(2);
    elements.labelQuantity.value = d.quantity || 1;
    toast("AI product draft loaded. Review it before saving or printing.");
  } catch {}
}

async function applyOwnerOnlyNavigation() {
  const financeLink = document.querySelector("#financeLink");
  try {
    const response = await fetch("/api/me", { credentials: "same-origin" });
    const result = await response.json();
    financeLink.hidden = result.user?.role !== "owner";
  } catch {
    financeLink.hidden = true;
  }
}

init().catch((error) => {
  console.error(error);
  state.productStorage = "offline";
  renderProducts();
  toast("Using browser fallback. Log in to save products permanently.");
});
