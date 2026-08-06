const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("vendor entry uses required phone login without an email field", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.html"), "utf8");
  const addForm = html.match(/<form id="vendorForm"[\s\S]*?<\/form>/)?.[0] || "";
  assert.match(addForm, /name="phone"[^>]*required/);
  assert.doesNotMatch(addForm, /name="email"/);
});

test("receiving entry does not show a vendor email field", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "vendor-tracking.html"), "utf8");
  const receiveForm = html.match(/<form id="deliveryForm"[\s\S]*?<\/form>/)?.[0] || "";
  assert.doesNotMatch(receiveForm, /name="vendorEmail"/);
  assert.doesNotMatch(receiveForm, />\s*Vendor email\s*</);
});

test("vendor entry does not overwrite an existing saved email", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /email = CASE WHEN \? = '' THEN email ELSE \? END/);
});
