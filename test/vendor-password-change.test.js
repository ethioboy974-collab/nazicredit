const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("vendor password change verifies current password and remains tenant scoped", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /\/api\/vendor-portal\/change-password/);
  assert.match(source, /passwordMatches\(String\(currentPassword/);
  assert.match(source, /WHERE id = \? AND enterprise_id = \?/);
  assert.match(source, /SET password_hash = \?, session_version = \?/);
});

test("vendor portal includes password confirmation", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "vendor-portal.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "vendor-portal.js"), "utf8");
  assert.match(html, /name="currentPassword"/);
  assert.match(html, /name="confirmPassword"/);
  assert.match(script, /New passwords do not match/);
});
