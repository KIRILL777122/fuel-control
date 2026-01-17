-- Enums
CREATE TYPE "FuelType" AS ENUM ('AI92', 'AI95', 'DIESEL', 'GAS', 'OTHER');
CREATE TYPE "FuelGroup" AS ENUM ('BENZIN', 'DIESEL', 'GAS', 'OTHER');
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'CASH', 'QR', 'SELF');
CREATE TYPE "DataSource" AS ENUM ('QR', 'MANUAL', 'TELEGRAM');
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- Driver extensions
ALTER TABLE "Driver"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "middleName" TEXT,
  ADD COLUMN "pendingVehicleId" TEXT,
  ADD COLUMN "pendingPaymentMethod" "PaymentMethod",
  ADD COLUMN "pendingReceiptId" TEXT,
  ADD COLUMN "pendingStep" TEXT,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3),
  ADD COLUMN "pendingMileage" INTEGER,
  ADD COLUMN "pendingReceiptFileId" TEXT;

-- Vehicle extensions
ALTER TABLE "Vehicle"
  ADD COLUMN "model" TEXT,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- unique plateNumber
CREATE UNIQUE INDEX IF NOT EXISTS "Vehicle_plateNumber_key" ON "Vehicle"("plateNumber");

-- Receipt extensions
ALTER TABLE "Receipt"
  ADD COLUMN "paymentComment" TEXT,
  ADD COLUMN "reimbursed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "paidByDriver" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fuelType" "FuelType",
  ADD COLUMN "fuelGroup" "FuelGroup",
  ADD COLUMN "hasGoods" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "goodsAmount" DECIMAL(12,2),
  ADD COLUMN "addressShort" TEXT,
  ADD COLUMN "imagePath" TEXT,
  ADD COLUMN "pdfPath" TEXT,
  ADD COLUMN "qrRaw" TEXT,
  ADD COLUMN "dataSource" "DataSource" NOT NULL DEFAULT 'TELEGRAM',
  ADD COLUMN "status" "ReceiptStatus" NOT NULL DEFAULT 'DONE';

-- migrate paymentMethod to enum
ALTER TABLE "Receipt"
  ALTER COLUMN "paymentMethod" TYPE "PaymentMethod" USING ("paymentMethod"::text::"PaymentMethod");

-- ReceiptItem extensions
ALTER TABLE "ReceiptItem"
  ADD COLUMN "isFuel" BOOLEAN NOT NULL DEFAULT false;

-- Ensure existing rows have defaults (in case of existing data)
UPDATE "Receipt" SET "status"='DONE' WHERE "status" IS NULL;
UPDATE "Receipt" SET "dataSource"='TELEGRAM' WHERE "dataSource" IS NULL;
