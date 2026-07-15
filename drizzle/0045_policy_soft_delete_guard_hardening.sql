-- The trigger must execute as the invoking role. Otherwise current_user would
-- always be the trigger owner, allowing a caller-set custom GUC to impersonate
-- the trusted delete/restore functions.
ALTER FUNCTION "enforce_policy_soft_delete_state"() SECURITY INVOKER;
