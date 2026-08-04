# Public Deployment

This app can be put online, but do not expose the local XAMPP setup directly.

## What You Need

- A domain name, such as `credit.yourstore.com`
- A server or app host that can run Node.js or Docker
- A MySQL database
- HTTPS enabled
- Strong store password and session secret
- Regular MySQL backups

## Production Environment

Set these environment variables on the server:

```env
HOST=0.0.0.0
PORT=5500
PUBLIC_ORIGIN=https://credit.yourstore.com
DB_HOST=your-mysql-host
DB_PORT=3306
DB_USER=your-mysql-user
DB_PASSWORD=your-mysql-password
DB_NAME=customer_credit
DB_AUTO_CREATE=false
STORE_NAME=Your Store Name
STORE_PASSWORD_HASH=your-generated-password-hash
SESSION_SECRET=a-long-random-private-secret
COOKIE_SECURE=true
SESSION_HOURS=12
```

Generate the store password hash:

```sh
pnpm run hash-password "your strong store password"
```

Put the output in `STORE_PASSWORD_HASH`.

## Docker Option

Build and run with Docker Compose:

```sh
docker compose up -d --build
```

For a public domain, put the app behind HTTPS using your host's built-in TLS, a reverse proxy, or a tunnel provider. The browser address should be `https://...`, not plain `http://...`.

## Safety Checklist

- Change `STORE_PASSWORD_HASH`.
- Change `SESSION_SECRET`.
- Do not use MySQL `root` for the public app.
- Use HTTPS.
- Turn on automatic database backups.
- Keep the server private except ports 80 and 443.
- Test login, add record, add payment, undo payment, edit record, and print before opening it to staff.

## Permanent Cloudflare Tunnel From This Computer

Use this when you want one fixed public address, but the app and MySQL database still run on the store computer.

You need:

- A Cloudflare account
- A domain added to Cloudflare
- A subdomain for the app, such as `credit.yourstore.com`
- This computer, XAMPP/MySQL, and the Node app running while the store uses the system

For this store, the planned public address is:

```text
https://credit.nazicredit.com
```

Run the setup script with the store address:

```powershell
powershell -ExecutionPolicy Bypass -File setup-permanent-tunnel.ps1 -Hostname credit.nazicredit.com
```

After setup, update `.env`:

```env
PUBLIC_ORIGIN=https://credit.nazicredit.com
COOKIE_SECURE=true
```

Restart the app, then run:

```bat
start-permanent-tunnel.bat
```

Do not expose MySQL, phpMyAdmin, or XAMPP directly to the internet. The tunnel should point only to `http://127.0.0.1:5500`.
