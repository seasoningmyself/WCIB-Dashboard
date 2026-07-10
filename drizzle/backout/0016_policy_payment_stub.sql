ALTER TABLE "policies" DROP COLUMN IF EXISTS "balance_due_date";
ALTER TABLE "policies" DROP COLUMN IF EXISTS "payable_status";
ALTER TABLE "policies" DROP COLUMN IF EXISTS "receivable_status";
ALTER TABLE "policies" DROP COLUMN IF EXISTS "remitted_to_mga";
ALTER TABLE "policies" DROP COLUMN IF EXISTS "net_due_total";
ALTER TABLE "policies" DROP COLUMN IF EXISTS "collected_to_date";
ALTER TABLE "policies" DROP COLUMN IF EXISTS "premium_total";

DROP TYPE IF EXISTS "payable_status";
DROP TYPE IF EXISTS "receivable_status";
