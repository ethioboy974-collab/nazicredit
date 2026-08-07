const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("saved history and vendor balances are owner-only", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.html"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(html, /id="vendorBalancesPanel" hidden/);
  assert.match(html, /id="savedHistoryPanel" hidden/);
  assert.match(client, /vendorBalancesPanel"\)\.hidden = accessState\.role !== "owner"/);
  assert.match(client, /savedHistoryPanel"\)\.hidden = accessState\.role !== "owner"/);
  assert.match(server, /session\.role === "owner" \? await listVendors/);
});

test("employees receive only non-financial per-vendor receiving defaults", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /\/api\/vendors\/receiving-defaults/);
  assert.match(server, /product: row\.product/);
  assert.match(server, /unitPrice: Number\(row\.unitPrice/);
});
