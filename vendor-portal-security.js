function normalizeVendorPhone(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.replace(/\D/g, "");
}

function normalizeVendorEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function scopeVendorPortalRows(rows, session) {
  return (Array.isArray(rows) ? rows : []).filter((row) =>
    String(row.enterpriseId) === String(session.enterpriseId)
    && String(row.vendorAccountId) === String(session.vendorAccountId));
}

function calculateVendorPortalSummary(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((totals, row) => {
    const received = Number(row.receivedQuantity || 0);
    const spoilage = Number(row.spoilageQuantity || 0);
    const accepted = Number(row.acceptedQuantity || 0);
    const unitPrice = Number(row.unitPrice || 0);
    totals.received += received;
    totals.spoilage += spoilage;
    totals.accepted += accepted;
    if (row.status !== "paid") totals.unpaidBalance += accepted * unitPrice;
    return totals;
  }, { received: 0, spoilage: 0, accepted: 0, unpaidBalance: 0 });
}

module.exports = {
  calculateVendorPortalSummary,
  normalizeVendorEmail,
  normalizeVendorPhone,
  scopeVendorPortalRows,
};
