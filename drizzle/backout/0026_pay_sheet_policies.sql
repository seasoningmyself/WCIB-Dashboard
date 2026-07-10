DROP TABLE IF EXISTS "pay_sheet_policies";

-- Safe only before attach/detach and close workflows exist. Preserve populated
-- policy/rate snapshots and forward-fix after financial history is written.
