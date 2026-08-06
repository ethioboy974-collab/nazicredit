(function exposeVendorQuantities(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.VendorQuantities = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createVendorQuantities() {
  function parseQuantity(value, label) {
    if (value === "" || value === null || value === undefined) throw new Error(`${label} is required`);
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(`${label} must be a number greater than or equal to zero`);
    }
    return quantity;
  }

  function calculateAccepted(receivedValue, spoilageValue) {
    const received = parseQuantity(receivedValue, "Received quantity");
    const spoilage = parseQuantity(spoilageValue, "Spoilage quantity");
    if (spoilage > received) throw new Error("Spoilage quantity cannot be greater than received quantity.");
    return { received, spoilage, accepted: received - spoilage };
  }

  return { calculateAccepted };
});
