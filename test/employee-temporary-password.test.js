const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const client = fs.readFileSync(path.join(root, "app.js"), "utf8");

test("new employees and admin password resets require one password change", () => {
  assert.match(server, /INSERT INTO customer_credit_users[\s\S]*?must_change_password[\s\S]*?VALUES \([^;]*?, 1,/);
  assert.match(server, /password_hash = COALESCE\([\s\S]*?must_change_password = CASE WHEN \? IS NULL THEN must_change_password ELSE 1 END/);
  assert.match(server, /resetManagedUserAccess[\s\S]*?must_change_password = 1[\s\S]*?session_version = session_version \+ 1/);
});

test("successful password change persists and rebuilds the session from the database row", () => {
  assert.match(server, /UPDATE customer_credit_users SET password_hash = \?, must_change_password = 0, session_version = session_version \+ 1/);
  assert.match(server, /SELECT must_change_password AS mustChangePassword, session_version AS sessionVersion[\s\S]*?FROM customer_credit_users/);
  assert.match(server, /setSession\(response, \{ \.\.\.session, \.\.\.passwordState \}\)/);
  assert.match(client, /state\.user\.mustChangePassword = Boolean\(result\.user\?\.mustChangePassword\)/);
});

test("every authenticated request uses the current central database access state", () => {
  assert.match(server, /const signedSession = getSession\(request\);[\s\S]*?await refreshSessionAccess\(signedSession\)/);
  assert.match(server, /refreshSessionAccess[\s\S]*?u\.must_change_password AS mustChangePassword/);
  assert.match(server, /mustChangePassword: Boolean\(current\.mustChangePassword\)/);
});

test("vendor receiving stays available after the database flag is cleared", () => {
  assert.match(server, /session\.mustChangePassword && request\.method !== "GET"[\s\S]*?requestUrl\.pathname !== "\/api\/account\/password"/);
  assert.match(server, /request\.method === "POST" && requestUrl\.pathname === "\/api\/vendors"/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "vendor-tracking.js"), "utf8"), /localStorage[^\n]*mustChangePassword|sessionStorage[^\n]*mustChangePassword/i);
});

test("authenticated employees can submit the add-vendor form", () => {
  const vendorClient = fs.readFileSync(path.join(root, "vendor-tracking.js"), "utf8");
  assert.match(vendorClient, /manageRecords: Boolean\(result\.permissions\?\.manageRecords\)/);
  assert.match(vendorClient, /function canCreateVendor\(\)[\s\S]*?accessState\.manageRecords/);
  assert.match(vendorClient, /vendorForm\.addEventListener\("submit"[\s\S]*?if \(!canCreateVendor\(\)\)/);
  assert.doesNotMatch(vendorClient, /Only an admin can add vendors/);
  assert.match(server, /request\.method === "POST" && requestUrl\.pathname === "\/api\/vendor-accounts"[\s\S]*?requireRecordManager\(session\)/);
});

test("employees with temporary passwords can create vendors and receiving entries", () => {
  assert.match(server, /temporaryPasswordEmployeeEntry = request\.method === "POST"/);
  assert.match(server, /temporaryPasswordEmployeeEntry[\s\S]*?isEmployeeRole\(session\.role\)/);
  assert.match(server, /temporaryPasswordEmployeeEntry[\s\S]*?"\/api\/vendor-accounts"/);
  assert.match(server, /temporaryPasswordEmployeeEntry[\s\S]*?"\/api\/vendors"/);
  assert.match(server, /session\.mustChangePassword[\s\S]*?!temporaryPasswordEmployeeEntry/);
});
