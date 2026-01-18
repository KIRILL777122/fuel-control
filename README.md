# Fuel Control

## Repairs V1 setup

### Environment variables
Add the following variables to your `.env` or deployment configuration:

- `REPAIR_BOT_TOKEN` — Telegram bot token for the repair wizard bot.
- `TELEGRAM_ADMIN_CHAT_ID` — Telegram chat ID for maintenance notifications.
- `REPAIR_FILES_DIR` — Optional path for repair attachments (default `/app/data/repairs`).
- `WEB_ADMIN_LOGIN`, `WEB_ADMIN_PASSWORD`, `WEB_SESSION_SECRET`, `JWT_SECRET` — Admin authentication.
- `DATABASE_URL` — Postgres connection string.

### Migrations
1. Install dependencies and run Prisma migrations:
   ```bash
   cd src/backend
   npm install
   npx prisma migrate deploy
   ```
2. Regenerate Prisma client if needed:
   ```bash
   npx prisma generate
   ```

### Repair bot
The repair bot starts automatically when `REPAIR_BOT_TOKEN` is set. To run locally:

```bash
cd src/backend
npm run dev
```

### Maintenance notifications
The daily cron runs at 09:00 server time and sends a summary to `TELEGRAM_ADMIN_CHAT_ID`. To run a manual test, use:

```bash
cd src/backend
npx tsx src/scripts/run-maintenance-once.ts
```
