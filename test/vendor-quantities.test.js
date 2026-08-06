const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateAccepted } = require("../vendor-quantities");

test("accepted equals received when spoilage is zero", () => {
  assert.deepEqual(calculateAccepted(20, 0), { received: 20, spoilage: 0, accepted: 20 });
});

test("accepted subtracts spoilage", () => {
  assert.deepEqual(calculateAccepted(20, 3), { received: 20, spoilage: 3, accepted: 17 });
});

test("accepted can be zero", () => {
  assert.deepEqual(calculateAccepted(20, 20), { received: 20, spoilage: 20, accepted: 0 });
});

test("spoilage greater than received is rejected", () => {
  assert.throws(() => calculateAccepted(20, 21), /cannot be greater/);
});

test("negative and missing quantities are rejected", () => {
  assert.throws(() => calculateAccepted(-1, 0), /greater than or equal to zero/);
  assert.throws(() => calculateAccepted("", 0), /required/);
});
