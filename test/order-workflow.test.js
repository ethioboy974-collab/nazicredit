"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  canResendOrderNotification,
  canTransitionOrderStatus,
  isOrderStatus,
} = require("../order-workflow");

test("recognizes the four order statuses", () => {
  for (const status of ["pending", "preparing", "ready", "picked_up"]) {
    assert.equal(isOrderStatus(status), true);
  }
  assert.equal(isOrderStatus("completed"), false);
});

test("allows only the forward workflow and history restore", () => {
  assert.equal(canTransitionOrderStatus("pending", "preparing"), true);
  assert.equal(canTransitionOrderStatus("preparing", "ready"), true);
  assert.equal(canTransitionOrderStatus("ready", "picked_up"), true);
  assert.equal(canTransitionOrderStatus("picked_up", "pending"), true);
  assert.equal(canTransitionOrderStatus("active", "preparing"), true);
  assert.equal(canTransitionOrderStatus("completed", "pending"), true);
  assert.equal(canTransitionOrderStatus("pending", "ready"), false);
  assert.equal(canTransitionOrderStatus("picked_up", "ready"), false);
});

test("limits resends to owners and managers", () => {
  assert.equal(canResendOrderNotification("owner"), true);
  assert.equal(canResendOrderNotification("manager"), true);
  assert.equal(canResendOrderNotification("staff"), true);
  assert.equal(canResendOrderNotification("viewer"), false);
  assert.equal(canResendOrderNotification("employee"), false);
});

test("employee UI presents one plain-language next action", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "meat-orders.js"), "utf8");
  assert.match(script, /Done — Text Customer/);
  assert.match(script, /Picked Up/);
  assert.doesNotMatch(script, /confirmPickup/);
  assert.match(script, /Customer Texted/);
  assert.match(script, /Texts automatically when ready/);
});
