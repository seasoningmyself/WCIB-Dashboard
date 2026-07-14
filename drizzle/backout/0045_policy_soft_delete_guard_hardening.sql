DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "audit_events"
		WHERE "action" IN ('policy_soft_deleted', 'policy_restored')
	) THEN
		RAISE EXCEPTION 'policy deletion guard is in use; preserve it and forward-fix'
			USING ERRCODE = '23514',
				CONSTRAINT = 'policy_soft_delete_guard_backout_requires_unused_history';
	END IF;
END;
$$;--> statement-breakpoint
ALTER FUNCTION "enforce_policy_soft_delete_state"() SECURITY DEFINER;
