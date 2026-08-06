const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("owner can reset an existing vendor password without exposing the old password", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.js"), "utf8");
  assert.match(server, /vendor-accounts\\\/\(\[\^\/\]\+\)\\\/reset-password/);
  assert.match(server, /requireEnterpriseOwner\(session\)/);
  assert.match(server, /session_version = session_version \+ 1/);
  assert.match(client, /Reset portal password/);
  assert.match(client, /Temporary password:/);
});
