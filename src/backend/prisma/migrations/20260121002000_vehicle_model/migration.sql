-- Add missing Vehicle.model column for restored DB
ALTER TABLE "Vehicle"
  ADD COLUMN IF NOT EXISTS "model" TEXT;
