-- Extend Driver
ALTER TABLE "Driver"
  ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false;

-- Extend Vehicle
ALTER TABLE "Vehicle"
  ADD COLUMN IF NOT EXISTS "makeModel" TEXT,
  ADD COLUMN IF NOT EXISTS "year" INTEGER,
  ADD COLUMN IF NOT EXISTS "vin" TEXT,
  ADD COLUMN IF NOT EXISTS "engine" TEXT,
  ADD COLUMN IF NOT EXISTS "color" TEXT,
  ADD COLUMN IF NOT EXISTS "purchasedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "purchasedOdometerKm" INTEGER,
  ADD COLUMN IF NOT EXISTS "currentOdometerKm" INTEGER,
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "isPinned" BOOLEAN NOT NULL DEFAULT false;

-- Receipt nullable fields
ALTER TABLE "Receipt"
  ALTER COLUMN "receiptAt" DROP NOT NULL;

ALTER TABLE "Receipt"
  ALTER COLUMN "dataSource" DROP NOT NULL;

-- Shifts table
CREATE TABLE IF NOT EXISTS "Shift" (
  "id" TEXT NOT NULL,
  "driverName" TEXT NOT NULL,
  "plateNumber" TEXT,
  "routeName" TEXT NOT NULL,
  "routeNumber" TEXT,
  "plannedTime" TEXT,
  "assignedTime" TEXT,
  "departureTime" TEXT,
  "delayMinutes" INTEGER,
  "shiftDate" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Shift_shiftDate_idx" ON "Shift"("shiftDate");
CREATE INDEX IF NOT EXISTS "Shift_driverName_idx" ON "Shift"("driverName");
CREATE INDEX IF NOT EXISTS "Shift_routeName_idx" ON "Shift"("routeName");
