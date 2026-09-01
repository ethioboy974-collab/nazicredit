"use strict";

const ORDER_STATUSES = Object.freeze(["pending", "preparing", "ready", "picked_up"]);
const ALLOWED_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["preparing"]),
  preparing: Object.freeze(["ready"]),
  ready: Object.freeze(["picked_up"]),
  picked_up: Object.freeze(["pending"]),
});

function isOrderStatus(status) {
  return ORDER_STATUSES.includes(status);
}

function canTransitionOrderStatus(fromStatus, toStatus) {
  return Boolean(ALLOWED_TRANSITIONS[normalizeOrderStatus(fromStatus)]?.includes(normalizeOrderStatus(toStatus)));
}

function normalizeOrderStatus(status) {
  if (status === "active") return "pending";
  if (status === "completed") return "picked_up";
  return status;
}

function canResendOrderNotification(role) {
  return role === "owner" || role === "manager" || role === "staff";
}

module.exports = {
  ORDER_STATUSES,
  canResendOrderNotification,
  canTransitionOrderStatus,
  isOrderStatus,
  normalizeOrderStatus,
};
