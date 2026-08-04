# GitHub and Railway Workflow

This project is managed from GitHub as the source of truth. Railway deploys the `customer-credit` service automatically from the `main` branch after changes are merged.

## Current production deployment

- Live site: https://credit.nazicredit.com
- Railway project: fabulous-upliftment
- Railway service: customer-credit
- Railway environment: production
- Runtime: Node.js app built by Railway Railpack from this repository
- Health check: /api/health

## Railway build and start configuration

Railway uses `railway.json` and Railpack.

- Builder: Railpack
- Install command: detected from `packageManager` and `pnpm-lock.yaml`
- Start command: `pnpm start`
- Health check path: `/api/health`
- Health check timeout: 120 seconds

## Required Railway variables

Keep secrets in Railway variables only. Do not commit `.env`.

Required production variables verified by name in Railway production include:

- HOST=0.0.0.0
- PUBLIC_ORIGIN=https://credit.nazicredit.com
- DB_HOST=${{MySQL.MYSQLHOST}}
- DB_PORT=${{MySQL.MYSQLPORT}}
- DB_USER=${{MySQL.MYSQLUSER}}
- DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
- DB_NAME=${{MySQL.MYSQLDATABASE}}
- DB_CONNECTION_LIMIT=10
- DB_AUTO_CREATE=false
- DEFAULT_ENTERPRISE_CODE=nazi2025
- DEFAULT_ENTERPRISE_USERNAME=owner
- SESSION_SECRET=<long random secret>
- SESSION_HOURS=12
- COOKIE_SECURE=true
- ORDER_NOTIFICATION_PROVIDER=twilio
- TWILIO_ACCOUNT_SID=<private Twilio Account SID>
- TWILIO_AUTH_TOKEN=<private Twilio auth token>
- TWILIO_FROM_NUMBER=<private Twilio SMS-capable number>
- TWILIO_MESSAGING_SERVICE_SID=<optional, recommended when available>
- EMAIL_FROM=Nazi Credit <security@nazicredit.com>, if email recovery or vendor record emails are enabled
- RESEND_API_KEY=<private Resend API key>, required for email recovery and automatic vendor record emails
- BACKUP_ENABLED=true
- BACKUP_S3_ENDPOINT=<private bucket endpoint>
- BACKUP_S3_REGION=<private bucket region>
- BACKUP_S3_BUCKET=<private bucket name>
- BACKUP_S3_ACCESS_KEY_ID=<private bucket access key>
- BACKUP_S3_SECRET_ACCESS_KEY=<private bucket secret key>
- BACKUP_S3_FORCE_PATH_STYLE=false
- BACKUP_INTERVAL_HOURS=24
- BACKUP_RETENTION_DAYS=35
- OPENAI_API_KEY=<private OpenAI API key>, if AI features are enabled
- OPENAI_MODEL=<approved production model>, if AI features are enabled
- OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe, if transcription is enabled

## One-time setup in Railway

1. Connect the Railway `customer-credit` service to the GitHub repository.
2. Set the production deploy branch to `main`.
3. Enable automatic deployments.
4. Enable Wait for CI so Railway waits for GitHub Actions checks to pass before deploying.
5. Keep the MySQL and backup bucket services in the same Railway project.

Railway documentation: services linked to a GitHub repository automatically deploy when commits are pushed to the connected branch, and Wait for CI can make Railway wait for GitHub Actions before deploying.

## Future change workflow

1. The owner describes the requested website change in Codex.
2. Codex creates a new Git branch for the change.
3. Codex implements the change.
4. Codex runs `pnpm run check` and `pnpm test`.
5. Codex pushes the branch to GitHub and opens a pull request.
6. The owner reviews and merges the pull request.
7. Railway automatically deploys `main` after the merge and successful checks.

No manual ZIP downloads, file replacement, terminal commands, or manual Railway uploads should be needed after GitHub and Railway are connected.
