# Customer Credit Ledger

Simple demo app for customer credit records.

## Open the app

Open `index.html` in a browser. It works immediately with local browser storage.

For the professional MySQL version, run the included backend server and open:

`http://127.0.0.1:5500/index.html`

## What it does

- Add a customer credit record.
- View open records, dates, times, and balances.
- Hide paid records automatically, with a Show paid toggle for completed accounts.
- Add dated and timed payments to an existing record.
- Print the full ledger or an individual customer statement.
- Save to a MySQL database through the included backend API.
- Optionally sync to Google Sheets through the Apps Script backend in `google-apps-script/Code.gs`.

## MySQL backend setup

1. Install MySQL Server.
2. Copy `.env.example` to `.env`.
3. Update `.env` with your MySQL username/password and store password.
4. Install the Node dependency: `pnpm install`
5. Start MySQL.
6. Start the app: `pnpm start`
   - On this Windows setup, you can also double-click `start-server.bat`.
7. Open `http://127.0.0.1:5500/index.html`

The server creates the `customer_credit` database and tables automatically. The SQL is also available in `database/schema.sql`.

## Store access

The app supports multiple enterprises. Each enterprise has its own code, username, password, records, and payments.

The first enterprise is created from these `.env` values:

- `STORE_NAME`: the store name shown on the login page
- `DEFAULT_ENTERPRISE_CODE`: the enterprise code used at login
- `DEFAULT_ENTERPRISE_USERNAME`: the first username, usually `owner`
- `STORE_PASSWORD`: the password staff use to unlock the app
- `SESSION_SECRET`: a long private value used to protect login cookies
- `SESSION_HOURS`: how long the store stays logged in

The first local password is `store1234`. Change it before real use.

To lock the app again, click the power/lock button in the top-right corner.

To add another enterprise, double-click `create-enterprise.bat`.

For public hosting, do not use `STORE_PASSWORD` in plain text. Generate a hash and put it in `STORE_PASSWORD_HASH`:

`pnpm run hash-password "your new password"`

Then remove or leave blank `STORE_PASSWORD`.

See `DEPLOYMENT.md` before putting the app online.

API endpoints:

- `GET /api/health`
- `GET /api/records`
- `PUT /api/records`
- `POST /api/records`
- `POST /api/records/:id/payments`

## Optional Google Sheets setup

1. Create a Google Sheet.
2. Go to Extensions > Apps Script.
3. Paste the contents of `google-apps-script/Code.gs`.
4. Save and deploy it as a Web App.
5. Set access to anyone who should use the demo.
6. Copy the Web App URL.
7. In the app, open data settings, enable Google Sheets endpoint, and paste the URL.

The app keeps a local copy too, so the demo still works if the Sheet endpoint is not ready.
# Order notifications

Changing an order to **Ready for Pickup** sends one customer notification through
`order-notification-service.js`. The default `ORDER_NOTIFICATION_PROVIDER=log`
adapter is for development and writes the delivery to the server console. To send
real messages, register an adapter with a `send(notification)` method and set
`ORDER_NOTIFICATION_PROVIDER` to its name. The adapter receives `channel`,
`recipient`, `message`, and `orderId`, so SMS, WhatsApp, or email can be added
without changing order routes or pages.

The order workflow is enforced as Pending → Being Prepared → Ready for Pickup →
Picked Up. Picked-up orders appear in Order History and can be restored to
Pending. The first transition to Ready for Pickup claims and sends the
notification once; owners and manager-level staff can explicitly resend it.
The most recent successful send date and time remains visible on the active
order and in Order History.

To keep messaging costs low, Pending, Being Prepared, and Picked Up are
website-only status changes. Ready for Pickup is the only status that triggers
an automatic customer notification.

For Twilio SMS, set `ORDER_NOTIFICATION_PROVIDER=twilio`,
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either
`TWILIO_MESSAGING_SERVICE_SID` (recommended) or `TWILIO_FROM_NUMBER`. Store
these as Railway variables; never commit the auth token to the project.
