# Multi-Enterprise Setup

The app now supports multiple enterprises in one database.

Each enterprise has:

- An enterprise code, such as `nazi2025`
- One or more users, starting with `owner`
- Its own customer credit records and payments

Records from one enterprise are not shown to another enterprise.

## Current Store Login

Use:

- Enterprise code: `nazi2025`
- Username: `owner`
- Password: the store password in `.env`

## Add Another Enterprise

On the hosting PC:

1. Start XAMPP MySQL.
2. Double-click `create-enterprise.bat`.
3. Enter the business name.
4. Accept or type an enterprise code.
5. Enter the owner username.
6. Enter the owner password.

Then that business can sign in at:

```text
https://credit.nazicredit.com/login
```

They must use their own enterprise code, username, and password.

## Important

Only the hosting PC needs XAMPP, the app server, and the Cloudflare tunnel.
Other businesses only open the public website in a browser.

For real 24/7 service across many businesses, move the app and database to cloud hosting.
