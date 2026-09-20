-- Align with the reference schema, without losing data.
-- Prisma's generated diff would drop/recreate both the enum and the column;
-- renaming in place keeps every existing payment row intact.

-- PaymentStatus: CANCELED -> CANCELLED (rename keeps the ordinal position)
ALTER TYPE "PaymentStatus" RENAME VALUE 'CANCELED' TO 'CANCELLED';

-- paymentGateway: enum column -> plain text, preserving current values
ALTER TABLE "payments" ALTER COLUMN "paymentGateway" DROP DEFAULT;
ALTER TABLE "payments"
  ALTER COLUMN "paymentGateway" TYPE TEXT USING lower("paymentGateway"::text);
ALTER TABLE "payments" ALTER COLUMN "paymentGateway" SET DEFAULT 'bkash';
ALTER TABLE "payments" ALTER COLUMN "paymentGateway" SET NOT NULL;
DROP TYPE "PaymentGateway";

-- Profile image columns are non-null with an empty default (NULLs backfilled first)
ALTER TABLE "users" ALTER COLUMN "imageUrl" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "imagePublicId" SET NOT NULL;
