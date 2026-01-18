# Changelog

## [Unreleased]

### Step 1 — Data model and migrations
- Expanded vehicle fields and introduced repair-related entities (events, works, parts, expenses, attachments, maintenance, recommendations, accidents, drafts).
- Added enums to support repair statuses, categories, and AI placeholders.

Manual test steps:
1. Apply migrations (`prisma migrate deploy`) and confirm new tables and enums are present.
2. Create a vehicle and confirm new fields are stored.

### Step 2 — Backend API and automation
- Added CRUD endpoints for repairs, maintenance, vehicle parts specs, accidents, and drafts.
- Added attachment upload/download endpoints and odometer integration.
- Added Repair Telegram bot and maintenance notification cron.

Manual test steps:
1. Create a repair event via API and verify totals and vehicle odometer refresh.
2. Upload an attachment and verify download works.
3. Create a maintenance item, mark done, and verify optional repair event creation.
4. Run the maintenance cron in test mode and verify notification output.

### Step 3 — Frontend UI
- Added new Vehicles, Drivers, and Repairs pages with navigation refactor.
- Implemented vehicle card tabs (passport, recommendations, accidents).
- Implemented repairs journal, summary, maintenance, and catalogs tabs.
- Added repair editor with AI placeholders and attachment management.

Manual test steps:
1. Create a vehicle, open its card, add recommendations and an accident.
2. Create a repair from the journal, add works/parts/expenses, and upload a document.
3. Check summary KPIs and category breakdowns update.
4. Create a maintenance item and mark it done with repair creation.
