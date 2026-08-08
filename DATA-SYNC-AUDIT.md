# Central Data Synchronization Audit

## Source of truth

All business records are loaded from and persisted through the authenticated `/api` service and the tenant-scoped MySQL database. Browser storage is not used for credit records, products, vendors, receiving defaults, employees, orders, sessions, or AI handoffs.

If the API is unavailable, the page reports the failure and does not claim that data was saved. Successful create, update, and delete operations reload the affected database-backed collection before rendering.

## Audited data paths

| Data | Read API | Write API |
| --- | --- | --- |
| Credit records and payments | `GET /api/records` | `/api/records`, payment endpoints |
| Employees | `GET /api/users` | `/api/users` and status/password endpoints |
| Products and barcodes | `GET /api/products` | `/api/products`, `/api/barcode-print-events` |
| Vendor accounts | `GET /api/vendor-accounts` | `POST/PATCH/DELETE /api/vendor-accounts` |
| Vendor receiving and defaults | `GET /api/vendors`, `GET /api/vendors/receiving-defaults` | `POST/DELETE /api/vendors` |
| Orders | `GET /api/meat-orders` | create, update, status, and notification endpoints |

Vendor counts come from vendor accounts, employee counts come from users, and receiving defaults are computed from the latest tenant-scoped vendor records in MySQL.

## Device A / Device B test plan

Use two different browsers or devices signed into the same enterprise.

1. Record the vendor count, employee count, product count, and the selected vendor's receiving defaults on both devices. Confirm they match.
2. On device A, create a vendor. Refresh device B and confirm the vendor and count match exactly.
3. On device A, edit that vendor's name and phone. Refresh device B and confirm both fields match.
4. On device A, save a receiving entry with a distinctive product, unit, price, and quantity. Refresh device B and confirm the entry and saved defaults match.
5. On device A, edit the receiving entry. Refresh device B and confirm the exact updated values.
6. On device A, delete the receiving entry and then the test vendor. Refresh device B and confirm both disappear and counts return to their starting values.
7. Repeat create/edit/delete for a product, employee, credit record, and order. Refresh device B after each operation and compare every field.
8. Disconnect device A from the network and attempt a write. Confirm the page reports a database error and the unsaved change does not appear on device B.
9. Reconnect device A, refresh it, and confirm it returns to the same database state shown on device B.

