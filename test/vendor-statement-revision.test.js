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

test("statements are monthly and printed with store, vendor, period, and date", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.js"), "utf8");
  assert.match(source, /entry\.date\.startsWith\(state\.activeMonth\)/);
  assert.match(source, /printStoreName\.textContent/);
  assert.match(source, /printVendorName\.textContent/);
  assert.match(source, /printReportPeriod\.textContent/);
  assert.match(source, /printGeneratedDate\.textContent/);
  assert.match(source, /Mark selected as paid/);
});
