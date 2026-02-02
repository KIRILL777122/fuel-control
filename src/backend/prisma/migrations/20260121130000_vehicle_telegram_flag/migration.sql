-- Add a flag to control which vehicles are shown in Telegram
ALTER TABLE "Vehicle"
ADD COLUMN IF NOT EXISTS "isTelegramEnabled" BOOLEAN NOT NULL DEFAULT false;
