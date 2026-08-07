const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("saved receiving product, unit, and price are locked in the editor", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.html"), "utf8");
  const editForm = html.match(/<form id="editForm"[\s\S]*?<\/form>/)?.[0] || "";
  assert.match(editForm, /name="product"[^>]*readonly/);
  assert.match(editForm, /name="unit"[^>]*disabled/);
  assert.match(editForm, /name="unitPrice"[^>]*readonly/);
});

test("server does not overwrite immutable receiving item fields", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const upsert = source.match(/async function upsertVendor[\s\S]*?if \(vendor\.spoiledQuantity/)?.[0] || "";
  assert.doesNotMatch(upsert, /unit = VALUES\(unit\)/);
  assert.doesNotMatch(upsert, /reference = VALUES\(reference\)/);
  assert.doesNotMatch(upsert, /amount = VALUES\(amount\)/);
});
