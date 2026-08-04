# Railway Cloud Deployment

This deployment keeps the Node app and MySQL database online when the store
computer is off.

## Services

- `customer-credit`: the Node.js web application
- `MySQL`: the database with a persistent volume
- `credit.nazicredit.com`: the public address managed through Cloudflare

## Application Variables

Set these on the `customer-credit` service:

```env
HOST=0.0.0.0
PUBLIC_ORIGIN=https://credit.nazicredit.com
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_USER=${{MySQL.MYSQLUSER}}
DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
DB_NAME=${{MySQL.MYSQLDATABASE}}
DB_CONNECTION_LIMIT=10
DB_AUTO_CREATE=false
DEFAULT_ENTERPRISE_CODE=nazi2025
DEFAULT_ENTERPRISE_USERNAME=owner
SESSION_SECRET=<long random secret>
SESSION_HOURS=12
COOKIE_SECURE=true
MAX_LOGIN_ATTEMPTS=8
LOGIN_LOCK_MINUTES=10
MAX_SIGNUPS_PER_HOUR=5
SIGNUP_INVITE_DAYS=7
RESEND_API_KEY=<private Resend API key>
EMAIL_FROM=Nazi Credit <security@nazicredit.com>
PASSWORD_RESET_MINUTES=30
EMAIL_VERIFY_HOURS=24
BACKUP_ENABLED=true
BACKUP_S3_ENDPOINT=<private bucket endpoint>
BACKUP_S3_REGION=<private bucket region>
BACKUP_S3_BUCKET=<private bucket name>
BACKUP_S3_ACCESS_KEY_ID=<private bucket access key>
BACKUP_S3_SECRET_ACCESS_KEY=<private bucket secret key>
BACKUP_S3_FORCE_PATH_STYLE=true
BACKUP_INTERVAL_HOURS=24
BACKUP_RETENTION_DAYS=35
```

`PORT` is supplied automatically by Railway. Do not upload the local `.env`
file.

## Migration Order

1. Create a Railway project on a paid plan.
2. Add a MySQL service.
3. Import the local `customer_credit` SQL dump into Railway MySQL.
4. Deploy this project folder as the `customer-credit` service.
5. Add the application variables above.
6. Generate a Railway test domain and test all workflows.
7. Add `credit.nazicredit.com` as a custom domain.
8. Replace the existing Cloudflare Tunnel DNS record with Railway's CNAME and
   TXT records.
9. Set Cloudflare SSL/TLS mode to `Full`.
10. Create a private Railway bucket and enable the app's daily compressed backups.
11. Test the custom domain before stopping the local server and tunnel.

## Backups

The application creates a compressed private backup shortly after startup, then
once every 24 hours. Backups include enterprises, users, credit records,
payments, saved barcode products, invitations, audit history, and recovery
tokens. Files older than 35 days are deleted automatically.

To restore the latest backup, run the recovery command only after supplying the
database and private bucket variables:

```powershell
$env:RESTORE_CONFIRM="YES"
npm run restore-cloud-backup
```

The confirmation setting is deliberately required because a restore replaces
the current database contents. A specific backup object key can be supplied
after the command when an older restore point is needed.

## Account Management

- The default enterprise owner is the platform owner.
- Only the platform owner can create registration invitations, reset another
  enterprise's owner access, disable an enterprise, or remove an enterprise.
- Enterprise owners can add staff and viewer accounts from `Account`.
- Staff can add credits, edit records, and update payments.
- Viewers can view and print but cannot change records.
- New staff accounts and platform-admin password resets use temporary passwords.
  The user must change the temporary password before making updates.
- Owners can review recent account and credit activity from `Account`.
- Users can add and verify a recovery email from `Account`.
- Verified recovery emails receive single-use password-reset links that expire
  after 30 minutes. Manual platform-owner reset remains available as backup.
- Successful logins, password changes, staff changes, credit updates, payment
  updates, invitation changes, and enterprise administration are audited.

## Final Checks

- Login to the existing enterprise.
- Confirm existing records and balances.
- Add and edit a test credit.
- Add, undo, and restore a payment.
- Confirm paid records hide and can be shown again.
- Print a customer statement.
- Confirm a second enterprise cannot see the first enterprise's data.
- Turn off the store computer and confirm the site remains available.
