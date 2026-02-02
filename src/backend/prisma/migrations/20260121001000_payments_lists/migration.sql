-- Route rates
CREATE TABLE IF NOT EXISTS "RouteRate" (
  "id" TEXT NOT NULL,
  "routeName" TEXT NOT NULL,
  "rate" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RouteRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RouteRate_routeName_key" ON "RouteRate"("routeName");

-- Driver payments
CREATE TABLE IF NOT EXISTS "DriverPayment" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accountedDate" TIMESTAMP(3),
  "payoutType" TEXT,
  "period" TEXT,
  "periodFrom" TIMESTAMP(3),
  "periodTo" TIMESTAMP(3),
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DriverPayment_driverId_idx" ON "DriverPayment"("driverId");
CREATE INDEX IF NOT EXISTS "DriverPayment_paymentDate_idx" ON "DriverPayment"("paymentDate");
ALTER TABLE "DriverPayment"
  ADD CONSTRAINT "DriverPayment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Driver payment details
CREATE TABLE IF NOT EXISTS "DriverPaymentDetail" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "bankName" TEXT,
  "account" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverPaymentDetail_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DriverPaymentDetail_driverId_idx" ON "DriverPaymentDetail"("driverId");
ALTER TABLE "DriverPaymentDetail"
  ADD CONSTRAINT "DriverPaymentDetail_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom lists
CREATE TABLE IF NOT EXISTS "CustomList" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CustomListItem" (
  "id" TEXT NOT NULL,
  "listId" TEXT NOT NULL,
  "driverId" TEXT,
  "vehicleId" TEXT,
  "routeName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomListItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CustomListItem_listId_idx" ON "CustomListItem"("listId");
ALTER TABLE "CustomListItem"
  ADD CONSTRAINT "CustomListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "CustomList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomListItem"
  ADD CONSTRAINT "CustomListItem_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomListItem"
  ADD CONSTRAINT "CustomListItem_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
