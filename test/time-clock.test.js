const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("time clock is tenant and employee scoped", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /CREATE TABLE IF NOT EXISTS customer_credit_time_entries/);
  assert.match(source, /WHERE enterprise_id = \? AND user_id = \? AND clock_out IS NULL/);
  assert.match(source, /\/api\/time-clock\/in/);
  assert.match(source, /\/api\/time-clock\/out/);
});

test("employees get clock controls and owners get team records", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "time-clock.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "time-clock.js"), "utf8");
  assert.match(html, /id="clockButton"/);
  assert.match(html, /id="teamPanel"/);
  assert.match(script, /data\.canViewTeam/);
});
