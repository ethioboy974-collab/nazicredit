const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("order form records optional verbal SMS consent and links disclosures", () => {
  const html = read("create-order.html");
  assert.match(html, /name="smsConsent"/);
  assert.match(html, /not required to place an order/i);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/sms-terms"/);
});

test("server prevents ready texts when consent is absent", () => {
  const server = read("server.js");
  assert.match(server, /status === "ready" && order\.smsConsent/);
  assert.match(server, /if \(!order\.smsConsent\) throw httpError\(409/);
});

test("transactional message and public policies include required SMS disclosures", () => {
  const notification = read("order-notification-service.js");
  const privacy = read("privacy.html");
  const terms = read("sms-terms.html");
  assert.match(notification, /Reply STOP to opt out or HELP for assistance/i);
  assert.match(privacy, /not be shared, sold/i);
  assert.match(privacy, /message frequency/i);
  assert.match(privacy, /message and data rates/i);
  assert.match(terms, /STOP/i);
  assert.match(terms, /HELP/i);
});
