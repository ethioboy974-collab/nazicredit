const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("vendor statement omits quantity summary from screen and paid print report", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.js"), "utf8");
  assert.doesNotMatch(html, /Quantity summary/i);
  assert.doesNotMatch(script, /buildPrintQuantitySummary/);
  assert.doesNotMatch(script, /Recorded quantity summary/i);
});
