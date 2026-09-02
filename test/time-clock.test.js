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
  assert.match(html, /id="clockInButton"/);
  assert.match(html, /id="clockOutButton"/);
  assert.match(script, /data\.deviceApproved/);
});

test("clock actions require a registered store tablet", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /requireRegisteredTimeClockDevice\(request, session\)/);
  assert.match(source, /customer_credit_registered_devices/);
  assert.match(source, /SameSite=Strict/);
});

test("owner admin retains paid payroll and audits adjustments", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "time-clock.html"), "utf8");
  assert.match(source, /SET paid_at=\?,paid_by=\?/);
  assert.match(source, /time_clock\.entry_adjusted/);
  assert.match(html, /Payroll history/);
  assert.match(html, /Employee management &amp; payroll/);
});

test("employee and time clock controls share one page", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "time-clock.html"), "utf8");
  const oldEmployeePage = fs.readFileSync(path.join(__dirname, "..", "employee-management.html"), "utf8");
  const oldAdminPage = fs.readFileSync(path.join(__dirname, "..", "time-clock-admin.html"), "utf8");
  assert.match(html, /Employees &amp; Time Clock/);
  assert.match(html, /id="employeeForm"/);
  assert.match(html, /id="adminSection"/);
  assert.match(oldEmployeePage, /location\.replace\('\/time-clock\.html#admin'\)/);
  assert.match(oldAdminPage, /location\.replace\('\/time-clock\.html#admin'\)/);
});
