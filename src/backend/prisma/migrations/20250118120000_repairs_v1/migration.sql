-- Create enums
CREATE TYPE "RepairEventType" AS ENUM ('MAINTENANCE', 'REPAIR');
CREATE TYPE "RepairEventStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'DONE', 'CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID');
CREATE TYPE "RepairCreatedFrom" AS ENUM ('WEB', 'TELEGRAM_BOT');
CREATE TYPE "RepairAttachmentType" AS ENUM ('ORDER', 'PHOTO', 'OTHER');
CREATE TYPE "RepairAttachmentSource" AS ENUM ('WEB', 'TELEGRAM_BOT');
CREATE TYPE "RepairAiParseStatus" AS ENUM ('NONE', 'PENDING', 'DONE', 'FAILED');
CREATE TYPE "VehiclePartsGroup" AS ENUM ('OIL_ENGINE', 'FILTER_OIL', 'FILTER_AIR', 'FILTER_FUEL', 'FILTER_CABIN', 'BRAKE_PADS', 'BRAKE_DISCS', 'SPARK_PLUGS', 'BELTS', 'OTHER');

-- Extend Vehicle
ALTER TABLE "Vehicle" ADD COLUMN "makeModel" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "year" INTEGER;
ALTER TABLE "Vehicle" ADD COLUMN "vin" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "engine" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "color" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "purchasedAt" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "purchasedOdometerKm" INTEGER;
ALTER TABLE "Vehicle" ADD COLUMN "currentOdometerKm" INTEGER;
ALTER TABLE "Vehicle" ADD COLUMN "notes" TEXT;
ALTER TABLE "Vehicle" ALTER COLUMN "plateNumber" SET NOT NULL;

-- Create RepairEvent
CREATE TABLE "RepairEvent" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "eventType" "RepairEventType" NOT NULL,
  "status" "RepairEventStatus" NOT NULL DEFAULT 'DRAFT',
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "odometerKm" INTEGER NOT NULL,
  "categoryCode" TEXT NOT NULL,
  "subsystemCode" TEXT,
  "symptomsText" TEXT NOT NULL,
  "findingsText" TEXT,
  "serviceName" TEXT,
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
  "totalCostWork" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalCostParts" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalCostOther" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "tags" JSONB,
  "createdFrom" "RepairCreatedFrom" NOT NULL DEFAULT 'WEB',
  "rawInputText" TEXT,
  "aiParseStatus" "RepairAiParseStatus" NOT NULL DEFAULT 'NONE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RepairEvent_pkey" PRIMARY KEY ("id")
);

-- Create RepairWork
CREATE TABLE "RepairWork" (
  "id" TEXT NOT NULL,
  "repairEventId" TEXT NOT NULL,
  "workName" TEXT NOT NULL,
  "normHours" DECIMAL(10,2),
  "cost" DECIMAL(12,2) NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RepairWork_pkey" PRIMARY KEY ("id")
);

-- Create RepairPart
CREATE TABLE "RepairPart" (
  "id" TEXT NOT NULL,
  "repairEventId" TEXT NOT NULL,
  "partName" TEXT NOT NULL,
  "brand" TEXT,
  "partNumber" TEXT,
  "qty" DECIMAL(10,2) NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "totalPrice" DECIMAL(12,2) NOT NULL,
  "supplier" TEXT,
  "warrantyUntilDate" TIMESTAMP(3),
  "warrantyUntilOdometerKm" INTEGER,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RepairPart_pkey" PRIMARY KEY ("id")
);

-- Create RepairExpense
CREATE TABLE "RepairExpense" (
  "id" TEXT NOT NULL,
  "repairEventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "cost" DECIMAL(12,2) NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RepairExpense_pkey" PRIMARY KEY ("id")
);

-- Create RepairAttachment
CREATE TABLE "RepairAttachment" (
  "id" TEXT NOT NULL,
  "repairEventId" TEXT NOT NULL,
  "fileType" "RepairAttachmentType" NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" "RepairAttachmentSource" NOT NULL DEFAULT 'WEB',
  CONSTRAINT "RepairAttachment_pkey" PRIMARY KEY ("id")
);

-- Create MaintenanceItem
CREATE TABLE "MaintenanceItem" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "intervalKm" INTEGER,
  "intervalDays" INTEGER,
  "lastDoneAt" TIMESTAMP(3),
  "lastDoneOdometerKm" INTEGER,
  "notifyBeforeKm" INTEGER NOT NULL DEFAULT 500,
  "notifyBeforeDays" INTEGER NOT NULL DEFAULT 7,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastNotifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceItem_pkey" PRIMARY KEY ("id")
);

-- Create VehiclePartsSpec
CREATE TABLE "VehiclePartsSpec" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "groupCode" "VehiclePartsGroup" NOT NULL,
  "recommendedText" TEXT NOT NULL,
  "preferredBrands" JSONB,
  "avoidBrands" JSONB,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehiclePartsSpec_pkey" PRIMARY KEY ("id")
);

-- Create AccidentEvent
CREATE TABLE "AccidentEvent" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "odometerKm" INTEGER,
  "description" TEXT NOT NULL,
  "damage" TEXT,
  "repaired" BOOLEAN NOT NULL DEFAULT false,
  "repairEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccidentEvent_pkey" PRIMARY KEY ("id")
);

-- Create RepairDraft
CREATE TABLE "RepairDraft" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "payload" JSONB,
  "createdFrom" "RepairCreatedFrom" NOT NULL DEFAULT 'TELEGRAM_BOT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RepairDraft_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "RepairEvent_vehicleId_startedAt_idx" ON "RepairEvent"("vehicleId", "startedAt");
CREATE INDEX "RepairEvent_categoryCode_idx" ON "RepairEvent"("categoryCode");
CREATE INDEX "RepairWork_repairEventId_idx" ON "RepairWork"("repairEventId");
CREATE INDEX "RepairPart_repairEventId_idx" ON "RepairPart"("repairEventId");
CREATE INDEX "RepairExpense_repairEventId_idx" ON "RepairExpense"("repairEventId");
CREATE INDEX "RepairAttachment_repairEventId_idx" ON "RepairAttachment"("repairEventId");
CREATE INDEX "MaintenanceItem_vehicleId_idx" ON "MaintenanceItem"("vehicleId");
CREATE INDEX "VehiclePartsSpec_vehicleId_idx" ON "VehiclePartsSpec"("vehicleId");
CREATE INDEX "AccidentEvent_vehicleId_idx" ON "AccidentEvent"("vehicleId");

-- Foreign keys
ALTER TABLE "RepairEvent" ADD CONSTRAINT "RepairEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepairWork" ADD CONSTRAINT "RepairWork_repairEventId_fkey" FOREIGN KEY ("repairEventId") REFERENCES "RepairEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepairPart" ADD CONSTRAINT "RepairPart_repairEventId_fkey" FOREIGN KEY ("repairEventId") REFERENCES "RepairEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepairExpense" ADD CONSTRAINT "RepairExpense_repairEventId_fkey" FOREIGN KEY ("repairEventId") REFERENCES "RepairEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepairAttachment" ADD CONSTRAINT "RepairAttachment_repairEventId_fkey" FOREIGN KEY ("repairEventId") REFERENCES "RepairEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehiclePartsSpec" ADD CONSTRAINT "VehiclePartsSpec_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccidentEvent" ADD CONSTRAINT "AccidentEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccidentEvent" ADD CONSTRAINT "AccidentEvent_repairEventId_fkey" FOREIGN KEY ("repairEventId") REFERENCES "RepairEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
