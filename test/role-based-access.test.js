const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const client = fs.readFileSync(path.join(root, "app.js"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "database", "migrations", "20260807_role_based_access.sql"),
  "utf8",
);

test("only owner and employee roles remain after a non-destructive migration", () => {
  assert.match(migration, /UPDATE customer_credit_users SET role = 'employee'/);
  assert.match(migration, /ENUM\('owner','employee'\)/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM/i);
});

test("restricted pages and APIs enforce owner access on the server", () => {
  assert.match(server, /isOwnerOnlyPage\(requestUrl\.pathname\).*session\.role !== "owner"/s);
  assert.match(server, /response\.writeHead\(403/);
  assert.match(server, /response\.end\("Access Denied"\)/);
  assert.match(server, /\/api\/finance\/summary[\s\S]*?requireOwnerPin\(session\)/);
  assert.match(server, /\/api\/vendors\/mark-paid[\s\S]*?requireEnterpriseOwner\(session\)/);
  assert.match(server, /\/api\/users[\s\S]*?requireEnterpriseOwner\(session\)/);
});

test("employee screens hide financial summary dashboards", () => {
  const vendorHtml = fs.readFileSync(path.join(root, "vendor-tracking.html"), "utf8");
  const vendorClient = fs.readFileSync(path.join(root, "vendor-tracking.js"), "utf8");
  assert.match(html, /id="creditSummary"/);
  assert.match(client, /creditSummary\.hidden = state\.user\.role !== "owner"/);
  assert.match(client, /printLedgerButton\.hidden = state\.user\.role !== "owner"/);
  assert.match(vendorHtml, /id="vendorDashboardTab"/);
  assert.match(vendorHtml, /id="vendorDashboardTab"[^>]*hidden/);
  assert.match(vendorHtml, /class="nav-tab active" data-view="receive"/);
  assert.match(vendorHtml, /class="view active" id="receive"/);
  assert.match(vendorClient, /dashboardTab\.hidden = accessState\.role !== "owner"/);
  assert.match(vendorClient, /accessState\.role === "owner"[\s\S]*?dashboardTab\.click\(\)/);
  assert.match(vendorClient, /Signed in as \$\{accessState\.username/);
  assert.match(fs.readFileSync(path.join(root, "styles.css"), "utf8"), /\[hidden\][\s\S]*?display: none !important/);
  assert.match(fs.readFileSync(path.join(root, "vendor-tracking.css"), "utf8"), /\[hidden\][\s\S]*?display: none !important/);
});

test("employees can only add entries in the credit section", () => {
  assert.match(html, /id="creditRecordsPanel"/);
  assert.match(client, /creditRecordsPanel\.hidden = state\.user\.role !== "owner"/);
  assert.match(client, /syncButton\.hidden = state\.user\.role !== "owner"/);
  assert.match(client, /state\.user\?\.role === "employee"[\s\S]*?mysqlRequest\("\/records", \{ method: "POST"/);
  assert.match(server, /records: session\.role === "owner" \? await listRecords[\s\S]*?: \[\]/);
  assert.match(server, /request\.method === "PUT"[^]*?\/api\/records[^]*?requireEnterpriseOwner\(session\)/);
  assert.match(server, /request\.method === "POST" && paymentMatch[^]*?requireEnterpriseOwner\(session\)/);
  assert.match(html, /id="employeePasswordNotice"/);
  assert.match(client, /recordForm\.hidden = !state\.permissions\.manageRecords/);
  assert.match(client, /employeePasswordNotice\.hidden = !state\.user\.mustChangePassword/);
  assert.match(server, /temporaryPasswordEmployeeEntry = request\.method === "POST"[\s\S]*"\/api\/records"/);
});

test("employees can collect a customer payment without full ledger access", () => {
  assert.match(html, /id="employeePaymentPanel"/);
  assert.match(client, /employeePaymentPanel\.hidden = state\.user\.role !== "employee"/);
  assert.match(client, /\/employee\/credit-search/);
  assert.match(client, /\/employee\/credit-payment/);
  assert.match(server, /\/api\/employee\/credit-search/);
  assert.match(server, /\/api\/employee\/credit-payment/);
  assert.match(server, /async function searchOpenCustomerCredits/);
  assert.match(server, /\.slice\(0, 10\)/);
  assert.match(server, /Payment cannot exceed the customer balance/);
  assert.match(server, /action:\s*"payment\.collected"/);
  assert.match(server, /temporaryPasswordEmployeeEntry[\s\S]*?"\/api\/employee\/credit-payment"/);
});

test("owner employee management supports roles, passwords, and activation status", () => {
  const management = fs.readFileSync(path.join(root, "employee-management.html"), "utf8");
  const timeClock = fs.readFileSync(path.join(root, "time-clock.html"), "utf8");
  assert.match(html, /Employees &amp; Time Clock/);
  assert.match(fs.readFileSync(path.join(root, "vendor-tracking.html"), "utf8"), /id="employeeManagementLink"/);
  assert.match(management, /time-clock\.html#admin/);
  assert.match(timeClock, /id="employeeForm"/);
  assert.match(server, /"\/employee-management\.html"/);
  assert.match(html, /<option value="owner">Owner<\/option>/);
  assert.match(html, /id="staffStatus"/);
  assert.match(client, /Reset Password/);
  assert.match(client, /changeStaffStatus/);
  assert.match(server, /employment_status = \?/);
  assert.match(server, /password_hash = COALESCE/);
  assert.match(server, /session_version = session_version \+ \?/);
});

test("successful and failed logins are retained for owner audit review", () => {
  assert.match(server, /recordLoginHistory\(request, \{[\s\S]*?outcome: "failed"/);
  assert.match(server, /recordLoginHistory\(request, \{[\s\S]*?outcome: "success"/);
  assert.match(server, /customer_credit_login_history/);
  assert.match(server, /\/api\/login-history[\s\S]*?requireEnterpriseOwner\(session\)/);
  assert.match(html, /Login History/);
});
