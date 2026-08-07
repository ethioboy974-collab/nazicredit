const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("each vendor loads and locks its own latest product, unit, and price", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.js"), "utf8");
  assert.match(source, /entry\.vendorId === vendor\.id/);
  assert.match(source, /vendorName\.addEventListener\("input", updateReceivingItemForSelectedVendor\)/);
  assert.match(source, /setReceivingItemLocked\(true\)/);
  assert.match(source, /updateReceivingItemForSelectedVendor\(\)/);
});

test("item details lock after saving and can be intentionally changed", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.js"), "utf8");
  assert.match(html, /id="changeReceivingItem"/);
  assert.match(source, /field\.disabled = locked/);
  assert.match(source, /setReceivingItemLocked\(false\)/);
});

test("saved record item details remain editable", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.html"), "utf8");
  const editForm = html.match(/<form id="editForm"[\s\S]*?<\/form>/)?.[0] || "";
  assert.doesNotMatch(editForm.match(/name="product"[^>]*>/)?.[0] || "", /readonly|disabled/);
  assert.doesNotMatch(editForm.match(/name="unit"[^>]*>/)?.[0] || "", /readonly|disabled/);
  assert.doesNotMatch(editForm.match(/name="unitPrice"[^>]*>/)?.[0] || "", /readonly|disabled/);
});
