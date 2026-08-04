const SHEET_NAME = "Credit Records";
const HEADERS = [
  "id",
  "customerName",
  "customerPhone",
  "itemNote",
  "creditDate",
  "creditTime",
  "creditAmount",
  "paymentsJson",
  "createdAt",
  "updatedAt",
];

function doPost(event) {
  try {
    const request = JSON.parse(event.postData.contents || "{}");
    if (request.action === "listRecords") {
      return jsonResponse({ ok: true, records: listRecords() });
    }

    if (request.action === "saveRecords") {
      saveRecords(request.records || []);
      return jsonResponse({ ok: true, records: listRecords() });
    }

    return jsonResponse({ ok: false, error: "Unknown action" });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function listRecords() {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  const column = name => headers.indexOf(name);
  const valueAt = (row, name) => {
    const index = column(name);
    return index >= 0 ? row[index] : "";
  };

  return values.slice(1).filter(row => row[0]).map(row => ({
    id: valueAt(row, "id"),
    customerName: valueAt(row, "customerName"),
    customerPhone: valueAt(row, "customerPhone"),
    itemNote: valueAt(row, "itemNote"),
    creditDate: toDateString(valueAt(row, "creditDate")),
    creditTime: valueAt(row, "creditTime"),
    creditAmount: Number(valueAt(row, "creditAmount") || 0),
    payments: parsePayments(valueAt(row, "paymentsJson")),
    createdAt: valueAt(row, "createdAt"),
    updatedAt: valueAt(row, "updatedAt"),
  }));
}

function saveRecords(records) {
  const sheet = getSheet();
  sheet.clearContents();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

  if (!records.length) return;

  const rows = records.map(record => [
    record.id,
    record.customerName,
    record.customerPhone,
    record.itemNote,
    record.creditDate,
    record.creditTime,
    Number(record.creditAmount || 0),
    JSON.stringify(record.payments || []),
    record.createdAt,
    record.updatedAt,
  ]);

  sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (firstRow[0] !== HEADERS[0]) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }

  return sheet;
}

function parsePayments(value) {
  try {
    return JSON.parse(value || "[]");
  } catch (error) {
    return [];
  }
}

function toDateString(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return value || "";
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
