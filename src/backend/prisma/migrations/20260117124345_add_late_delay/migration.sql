-- CreateTable
CREATE TABLE "LateDelay" (
    "id" TEXT NOT NULL,
    "driverName" TEXT NOT NULL,
    "plateNumber" TEXT,
    "routeName" TEXT NOT NULL,
    "plannedTime" TEXT,
    "assignedTime" TEXT,
    "delayMinutes" INTEGER NOT NULL,
    "delayDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LateDelay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LateDelay_delayDate_idx" ON "LateDelay"("delayDate");

-- CreateIndex
CREATE INDEX "LateDelay_driverName_delayDate_idx" ON "LateDelay"("driverName", "delayDate");
