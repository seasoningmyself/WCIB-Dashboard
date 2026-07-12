DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "policies"
		WHERE "producer_commission_received_at" IS NOT NULL
	) THEN
		RAISE EXCEPTION 'producer commission receipt state is in use; preserve financial history and forward-fix'
			USING ERRCODE = '55000',
				CONSTRAINT = 'producer_commission_received_at_in_use';
	END IF;
END;
$$;--> statement-breakpoint
ALTER TABLE "policies"
	DROP COLUMN IF EXISTS "producer_commission_received_at";
