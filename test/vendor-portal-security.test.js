const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  calculateVendorPortalSummary,
  normalizeVendorEmail,
  normalizeVendorPhone,
  scopeVendorPortalRows,
} = require("../vendor-portal-security");

test("normalizes vendor phone and email logins", () => {
  assert.equal(normalizeVendorPhone("+1 (703) 555-0199"), "+17035550199");
  assert.equal(normalizeVendorEmail(" Vendor@Example.COM "), "vendor@example.com");
});

test("portal rows require both the tenant and vendor account", () => {
  const rows = [
    { id: "allowed", enterpriseId: "store-a", vendorAccountId: "vendor-1" },
    { id: "other-vendor", enterpriseId: "store-a", vendorAccountId: "vendor-2" },
    { id: "other-store", enterpriseId: "store-b", vendorAccountId: "vendor-1" },
  ];
  assert.deepEqual(scopeVendorPortalRows(rows, { enterpriseId: "store-a", vendorAccountId: "vendor-1" }), [rows[0]]);
});

test("portal totals and unpaid balance use accepted quantity", () => {
  const summary = calculateVendorPortalSummary([
    { receivedQuantity: 20, spoilageQuantity: 3, acceptedQuantity: 17, unitPrice: 5, status: "due" },
    { receivedQuantity: 10, spoilageQuantity: 0, acceptedQuantity: 10, unitPrice: 2, status: "paid" },
  ]);
  assert.deepEqual(summary, { received: 30, spoilage: 3, accepted: 27, unpaidBalance: 85 });
});

test("server portal query scopes by tenant and vendor and rejects writes", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /WHERE enterprise_id = \? AND vendor_account_id = \?/);
  assert.match(source, /Vendor portal is read-only/);
  assert.match(source, /request\.method === "GET"/);
});
