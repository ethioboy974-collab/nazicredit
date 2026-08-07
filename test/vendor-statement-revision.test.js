const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("vendor statement uses the simplified amount-due layout", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.html"), "utf8");
  assert.match(html, />Amount Due<\/option>/);
  for (const heading of ["Received", "Spoilage", "Accepted", "Unit price", "Amount", "Status"]) {
    assert.match(html, new RegExp(`<th>${heading}</th>`, "i"));
  }
  assert.doesNotMatch(html, /<th>Type<\/th>/);
  assert.doesNotMatch(html, /statement-action-column">Action/);
  assert.match(html, /id="statementAcceptedTotal"/);
  assert.match(html, /id="statementFooterTotal"/);
});

test("statements support inclusive date ranges and print store, vendor, period, and date", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.html"), "utf8");
  assert.match(html, /id="statementDateFrom"/);
  assert.match(html, /id="statementDateTo"/);
  assert.match(html, /id="selectStatementRange"/);
  assert.match(source, /entry\.date >= dateFrom/);
  assert.match(source, /entry\.date <= dateTo/);
  assert.match(source, /function selectAllStatementRange\(\)/);
  assert.match(source, /printStoreName\.textContent/);
  assert.match(source, /printVendorName\.textContent/);
  assert.match(source, /printReportPeriod\.textContent/);
  assert.match(source, /printGeneratedDate\.textContent/);
  assert.match(source, /Mark selected as paid/);
});
