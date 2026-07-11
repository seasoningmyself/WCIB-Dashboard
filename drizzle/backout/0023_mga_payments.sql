DROP TABLE IF EXISTS "mga_payments";
DROP TYPE IF EXISTS "mga_payment_status";

-- Safe only before real settlement state or downstream pay-sheet dependencies
-- exist. Preserve populated data and forward-fix after use.
