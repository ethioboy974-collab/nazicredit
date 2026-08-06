const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("statement paid and unpaid actions persist database transaction ids", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.js"), "utf8");
  assert.match(source, /selectedEntries\.map\(\(entry\) => entry\.databaseId\)/);
  assert.match(source, /databaseRequest\("\/vendors\/mark-paid"/);
  assert.match(source, /databaseRequest\("\/vendors\/mark-unpaid"/);
});

test("paid deliveries move from the unpaid statement into paid records", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.js"), "utf8");
  assert.match(html, /<option value="unpaid">Unpaid statement<\/option>/);
  assert.match(html, /<option value="paid">Paid records<\/option>/);
  assert.match(source, /isEntryPaid\(entry\) === showingPaid/);
});
