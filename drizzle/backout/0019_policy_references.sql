ALTER TABLE "policies" DROP CONSTRAINT IF EXISTS "policies_producer_user_id_staff_profiles_user_id_fk";
ALTER TABLE "policies" DROP CONSTRAINT IF EXISTS "policies_office_location_id_office_locations_id_fk";
ALTER TABLE "policies" DROP CONSTRAINT IF EXISTS "policies_mga_id_mgas_id_fk";
ALTER TABLE "policies" DROP CONSTRAINT IF EXISTS "policies_carrier_id_carriers_id_fk";
ALTER TABLE "policies" DROP CONSTRAINT IF EXISTS "policies_policy_type_id_policy_types_id_fk";
ALTER TABLE "policies" DROP CONSTRAINT IF EXISTS "policies_submitted_by_user_id_users_id_fk";
ALTER TABLE "policies" DROP CONSTRAINT IF EXISTS "policies_source_draft_id_drafts_id_fk";
