DROP FUNCTION IF EXISTS "close_pay_sheet"(uuid, uuid);

-- This backout removes only the item-26 close entry point. It never reopens a
-- sheet or edits frozen history; forward-fix after any production close.
