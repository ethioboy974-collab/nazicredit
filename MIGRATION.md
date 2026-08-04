# Move To Another PC

Use this when another Windows PC should become the main computer that hosts `https://credit.nazicredit.com`.

## Old PC

1. Make sure XAMPP MySQL is running.
2. Double-click `backup-for-migration.bat`.
3. Wait for it to create a zip inside `migration-backup`.
4. Move that zip to the new PC with a private USB drive or private transfer.

The zip is private. It contains the database backup, app settings, and Cloudflare tunnel files.

## New PC

1. Install XAMPP.
2. Start **Apache** and **MySQL** in XAMPP.
3. Install Node.js LTS if Node is not already installed.
4. Unzip the migration zip.
5. Move the `customer-credit-app` folder to Documents.
6. Open that folder.
7. Double-click `restore-on-new-pc.bat`.
8. Double-click `start-server.bat`.
9. Double-click `start-permanent-tunnel.bat`.
10. Test `https://credit.nazicredit.com/login`.

## After The New PC Works

Stop the app server and permanent tunnel on the old PC. Only one PC should host the permanent tunnel during normal store use.

Other computers do not need migration. They can just open `https://credit.nazicredit.com/login` as users.
