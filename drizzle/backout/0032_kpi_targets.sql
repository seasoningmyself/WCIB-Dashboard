DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "kpi_targets") THEN
		RAISE EXCEPTION 'kpi_targets contains data; preserve it and use a reviewed forward-fix migration';
	END IF;
END;
$$;
--> statement-breakpoint
DROP TABLE IF EXISTS "kpi_targets";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."kpi_target_scope_type";
