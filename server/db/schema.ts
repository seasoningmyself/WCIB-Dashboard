import { sql } from "drizzle-orm";
import { STAFF_ROLES } from "../../shared/access.js";
import { MFA_METHOD_TYPES } from "../../shared/mfa-scaffold.js";
import { POLICY_TYPE_CLASSES } from "../../shared/policy-types.js";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  MAX_AUDIT_SUMMARY_BYTES,
} from "../../shared/audit-events.js";
import {
  ACCOUNT_ASSIGNMENTS,
  APPROVAL_QUEUE_STATUSES,
  COMMISSION_MODES,
  DRAFT_STATUSES,
  IPFS_CUSTOMER_TYPES,
  IPFS_FINANCING_CHOICES,
  PAYABLE_STATUSES,
  PAYMENT_MODES,
  RECEIVABLE_STATUSES,
} from "../../shared/policy-fields.js";
import {
  boolean,
  check,
  date,
  integer,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const staffRoleEnum = pgEnum("staff_role", STAFF_ROLES);
export const mfaMethodTypeEnum = pgEnum("mfa_method_type", MFA_METHOD_TYPES);
export const policyTypeClassEnum = pgEnum(
  "policy_type_class",
  POLICY_TYPE_CLASSES,
);
export const draftStatusEnum = pgEnum("draft_status", DRAFT_STATUSES);
export const commissionModeEnum = pgEnum(
  "commission_mode",
  COMMISSION_MODES,
);
export const paymentModeEnum = pgEnum("payment_mode", PAYMENT_MODES);
export const accountAssignmentEnum = pgEnum(
  "account_assignment",
  ACCOUNT_ASSIGNMENTS,
);
export const ipfsFinancingChoiceEnum = pgEnum(
  "ipfs_financing_choice",
  IPFS_FINANCING_CHOICES,
);
export const ipfsCustomerTypeEnum = pgEnum(
  "ipfs_customer_type",
  IPFS_CUSTOMER_TYPES,
);
export const approvalQueueStatusEnum = pgEnum(
  "approval_queue_status",
  APPROVAL_QUEUE_STATUSES,
);
export const receivableStatusEnum = pgEnum(
  "receivable_status",
  RECEIVABLE_STATUSES,
);
export const payableStatusEnum = pgEnum("payable_status", PAYABLE_STATUSES);
export const auditActionEnum = pgEnum("audit_action", AUDIT_ACTIONS);
export const auditEntityTypeEnum = pgEnum(
  "audit_entity_type",
  AUDIT_ENTITY_TYPES,
);
export const staffPronounEnum = pgEnum("staff_pronoun", [
  "her",
  "his",
  "their",
]);

export const sessions = pgTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_expire_idx").on(table.expire)],
);

export type SessionRecord = typeof sessions.$inferSelect;
export type NewSessionRecord = typeof sessions.$inferInsert;

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sessionVersion: integer("session_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique_idx").on(sql`lower(${table.email})`),
    check(
      "users_email_normalized_check",
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),
    check(
      "users_password_hash_format_check",
      sql`${table.passwordHash} ~ '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$'`,
    ),
    check(
      "users_session_version_nonnegative_check",
      sql`${table.sessionVersion} >= 0`,
    ),
  ],
);

export type UserRecord = typeof users.$inferSelect;
export type NewUserRecord = typeof users.$inferInsert;

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    action: auditActionEnum("action").notNull(),
    entityType: auditEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    beforeSummary: jsonb("before_summary"),
    afterSummary: jsonb("after_summary"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_events_actor_timeline_idx").on(
      table.actorUserId,
      table.occurredAt,
    ),
    index("audit_events_entity_timeline_idx").on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    index("audit_events_action_timeline_idx").on(
      table.action,
      table.occurredAt,
    ),
    check(
      "audit_events_before_summary_shape_check",
      sql`${table.beforeSummary} is null OR (
        jsonb_typeof(${table.beforeSummary}) = 'object'
        AND pg_column_size(${table.beforeSummary}) <= ${sql.raw(String(MAX_AUDIT_SUMMARY_BYTES))}
      )`,
    ),
    check(
      "audit_events_after_summary_shape_check",
      sql`${table.afterSummary} is null OR (
        jsonb_typeof(${table.afterSummary}) = 'object'
        AND pg_column_size(${table.afterSummary}) <= ${sql.raw(String(MAX_AUDIT_SUMMARY_BYTES))}
      )`,
    ),
  ],
);

export type AuditEventRecord = typeof auditEvents.$inferSelect;
export type NewAuditEventRecord = typeof auditEvents.$inferInsert;

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_token_hash_idx").on(table.tokenHash),
    uniqueIndex("password_reset_tokens_active_user_idx")
      .on(table.userId)
      .where(sql`${table.consumedAt} is null`),
    index("password_reset_tokens_expiry_idx").on(table.expiresAt),
    check(
      "password_reset_tokens_hash_format_check",
      sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "password_reset_tokens_expiry_order_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "password_reset_tokens_consumed_order_check",
      sql`${table.consumedAt} is null or ${table.consumedAt} >= ${table.createdAt}`,
    ),
  ],
);

export type PasswordResetTokenRecord =
  typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetTokenRecord =
  typeof passwordResetTokens.$inferInsert;

export const userMfaSettings = pgTable(
  "user_mfa_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    enforcementEnabled: boolean("enforcement_enabled")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "user_mfa_settings_foundation_inert_check",
      sql`${table.enforcementEnabled} = false`,
    ),
  ],
);

export const userMfaMethodPlaceholders = pgTable(
  "user_mfa_method_placeholders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userMfaSettings.userId, { onDelete: "cascade" }),
    methodType: mfaMethodTypeEnum("method_type").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_mfa_method_placeholders_user_type_idx").on(
      table.userId,
      table.methodType,
    ),
    check(
      "user_mfa_method_placeholders_foundation_inert_check",
      sql`${table.isEnabled} = false`,
    ),
  ],
);

export type UserMfaSettingsRecord = typeof userMfaSettings.$inferSelect;
export type NewUserMfaSettingsRecord = typeof userMfaSettings.$inferInsert;
export type UserMfaMethodPlaceholderRecord =
  typeof userMfaMethodPlaceholders.$inferSelect;
export type NewUserMfaMethodPlaceholderRecord =
  typeof userMfaMethodPlaceholders.$inferInsert;

export const staffProfiles = pgTable(
  "staff_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    role: staffRoleEnum("role").notNull(),
    pronoun: staffPronounEnum("pronoun").notNull().default("their"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("staff_profiles_role_active_idx").on(table.role, table.isActive),
    check(
      "staff_profiles_display_name_normalized_check",
      sql`${table.displayName} = btrim(${table.displayName}) AND char_length(${table.displayName}) > 0`,
    ),
  ],
);

export const userCapabilities = pgTable(
  "user_capabilities",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    capability: text("capability").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.capability],
      name: "user_capabilities_user_capability_pk",
    }),
    index("user_capabilities_capability_active_idx").on(
      table.capability,
      table.isActive,
    ),
    check(
      "user_capabilities_capability_format_check",
      sql`${table.capability} ~ '^[a-z][a-z0-9_]*$'`,
    ),
  ],
);

export type StaffProfileRecord = typeof staffProfiles.$inferSelect;
export type NewStaffProfileRecord = typeof staffProfiles.$inferInsert;
export type UserCapabilityRecord = typeof userCapabilities.$inferSelect;
export type NewUserCapabilityRecord = typeof userCapabilities.$inferInsert;

export const producerRateHistory = pgTable(
  "producer_rate_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    producerUserId: uuid("producer_user_id")
      .notNull()
      .references(() => staffProfiles.userId, { onDelete: "restrict" }),
    effectiveDate: date("effective_date").notNull(),
    newCommissionRate: numeric("new_commission_rate", {
      precision: 5,
      scale: 2,
    }).notNull(),
    newBrokerRate: numeric("new_broker_rate", {
      precision: 5,
      scale: 2,
    }).notNull(),
    renewalCommissionRate: numeric("renewal_commission_rate", {
      precision: 5,
      scale: 2,
    }).notNull(),
    renewalBrokerRate: numeric("renewal_broker_rate", {
      precision: 5,
      scale: 2,
    }).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("producer_rate_history_producer_effective_date_idx").on(
      table.producerUserId,
      table.effectiveDate,
    ),
    check(
      "producer_rate_history_new_commission_rate_check",
      sql`${table.newCommissionRate} >= 0 AND ${table.newCommissionRate} <= 100`,
    ),
    check(
      "producer_rate_history_new_broker_rate_check",
      sql`${table.newBrokerRate} >= 0 AND ${table.newBrokerRate} <= 100`,
    ),
    check(
      "producer_rate_history_renewal_commission_rate_check",
      sql`${table.renewalCommissionRate} >= 0 AND ${table.renewalCommissionRate} <= 100`,
    ),
    check(
      "producer_rate_history_renewal_broker_rate_check",
      sql`${table.renewalBrokerRate} >= 0 AND ${table.renewalBrokerRate} <= 100`,
    ),
  ],
);

export type ProducerRateHistoryRecord =
  typeof producerRateHistory.$inferSelect;
export type NewProducerRateHistoryRecord =
  typeof producerRateHistory.$inferInsert;

export const officeLocations = pgTable(
  "office_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("office_locations_name_unique_idx").on(
      sql`lower(${table.name})`,
    ),
    check(
      "office_locations_name_normalized_check",
      sql`${table.name} = btrim(${table.name}) AND char_length(${table.name}) > 0`,
    ),
  ],
);

export type OfficeLocationRecord = typeof officeLocations.$inferSelect;
export type NewOfficeLocationRecord = typeof officeLocations.$inferInsert;

export const mgas = pgTable(
  "mgas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mgas_name_unique_idx").on(sql`lower(${table.name})`),
    check(
      "mgas_name_normalized_check",
      sql`${table.name} = btrim(${table.name}) AND char_length(${table.name}) > 0`,
    ),
  ],
);

export type MgaRecord = typeof mgas.$inferSelect;
export type NewMgaRecord = typeof mgas.$inferInsert;

export const carriers = pgTable(
  "carriers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("carriers_name_unique_idx").on(sql`lower(${table.name})`),
    check(
      "carriers_name_normalized_check",
      sql`${table.name} = btrim(${table.name}) AND char_length(${table.name}) > 0`,
    ),
  ],
);

export type CarrierRecord = typeof carriers.$inferSelect;
export type NewCarrierRecord = typeof carriers.$inferInsert;

export const policyTypes = pgTable(
  "policy_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    classTag: policyTypeClassEnum("class_tag").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("policy_types_name_unique_idx").on(sql`lower(${table.name})`),
    check(
      "policy_types_name_normalized_check",
      sql`${table.name} = btrim(${table.name}) AND char_length(${table.name}) > 0`,
    ),
  ],
);

export type PolicyTypeRecord = typeof policyTypes.$inferSelect;
export type NewPolicyTypeRecord = typeof policyTypes.$inferInsert;

export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    schemaVersion: integer("schema_version").notNull().default(1),
    status: draftStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastEditedAt: timestamp("last_edited_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    flagReason: text("flag_reason"),
    sentBackReason: text("sent_back_reason"),
    sentBackByUserId: uuid("sent_back_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    sentBackAt: timestamp("sent_back_at", { withTimezone: true }),
    linkedQueueEntryId: uuid("linked_queue_entry_id"),
    linkedPolicyId: uuid("linked_policy_id"),
    insuredName: text("insured_name"),
    companyName: text("company_name"),
    policyNumber: text("policy_number"),
    policyTypeId: uuid("policy_type_id").references(() => policyTypes.id, {
      onDelete: "restrict",
    }),
    transactionType: text("transaction_type"),
    transactionNotes: text("transaction_notes"),
    invoiceNumber: text("invoice_number"),
    effectiveDate: date("effective_date"),
    expirationDate: date("expiration_date"),
    carrierId: uuid("carrier_id").references(() => carriers.id, {
      onDelete: "restrict",
    }),
    mgaId: uuid("mga_id").references(() => mgas.id, {
      onDelete: "restrict",
    }),
    officeLocationId: uuid("office_location_id").references(
      () => officeLocations.id,
      { onDelete: "restrict" },
    ),
    accountAssignment: accountAssignmentEnum("account_assignment"),
    producerUserId: uuid("producer_user_id").references(
      () => staffProfiles.userId,
      { onDelete: "restrict" },
    ),
    notes: text("notes"),
    basePremium: numeric("base_premium", { precision: 14, scale: 2 }),
    taxes: numeric("taxes", { precision: 14, scale: 2 }),
    mgaFee: numeric("mga_fee", { precision: 14, scale: 2 }),
    brokerFee: numeric("broker_fee", { precision: 14, scale: 2 }),
    commissionMode: commissionModeEnum("commission_mode"),
    commissionRate: numeric("commission_rate", { precision: 7, scale: 4 }),
    commissionConfirmed: boolean("commission_confirmed")
      .notNull()
      .default(false),
    amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }),
    proposalTotal: numeric("proposal_total", { precision: 14, scale: 2 }),
    netDue: numeric("net_due", { precision: 14, scale: 2 }),
    paymentMode: paymentModeEnum("payment_mode"),
    depositOption: numeric("deposit_option", { precision: 14, scale: 2 }),
    financeBalance: numeric("finance_balance", { precision: 14, scale: 2 }),
    financeReference: text("finance_reference"),
    ipfsFinanced: ipfsFinancingChoiceEnum("ipfs_financed"),
    ipfsManual: boolean("ipfs_manual").notNull().default(false),
    ipfsReturning: ipfsCustomerTypeEnum("ipfs_returning"),
    financeContact: jsonb("finance_contact"),
    financeMeta: jsonb("finance_meta"),
    ipfsPushed: boolean("ipfs_pushed").notNull().default(false),
    ipfsPushedAt: timestamp("ipfs_pushed_at", { withTimezone: true }),
    history: jsonb("history").notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [
    index("drafts_owner_status_idx").on(table.ownerUserId, table.status),
    index("drafts_policy_type_idx").on(table.policyTypeId),
    index("drafts_carrier_idx").on(table.carrierId),
    index("drafts_mga_idx").on(table.mgaId),
    index("drafts_office_location_idx").on(table.officeLocationId),
    index("drafts_producer_idx").on(table.producerUserId),
    check("drafts_schema_version_positive_check", sql`${table.schemaVersion} > 0`),
    check(
      "drafts_last_edited_order_check",
      sql`${table.lastEditedAt} >= ${table.createdAt}`,
    ),
    check(
      "drafts_date_order_check",
      sql`${table.effectiveDate} is null OR ${table.expirationDate} is null OR ${table.expirationDate} >= ${table.effectiveDate}`,
    ),
    check(
      "drafts_base_premium_nonnegative_check",
      sql`${table.basePremium} is null OR ${table.basePremium} >= 0`,
    ),
    check(
      "drafts_taxes_nonnegative_check",
      sql`${table.taxes} is null OR ${table.taxes} >= 0`,
    ),
    check(
      "drafts_mga_fee_nonnegative_check",
      sql`${table.mgaFee} is null OR ${table.mgaFee} >= 0`,
    ),
    check(
      "drafts_broker_fee_nonnegative_check",
      sql`${table.brokerFee} is null OR ${table.brokerFee} >= 0`,
    ),
    check(
      "drafts_commission_rate_check",
      sql`${table.commissionRate} is null OR (${table.commissionRate} >= 0 AND ${table.commissionRate} <= 100)`,
    ),
    check(
      "drafts_amount_paid_nonnegative_check",
      sql`${table.amountPaid} is null OR ${table.amountPaid} >= 0`,
    ),
    check(
      "drafts_proposal_total_nonnegative_check",
      sql`${table.proposalTotal} is null OR ${table.proposalTotal} >= 0`,
    ),
    check(
      "drafts_deposit_option_nonnegative_check",
      sql`${table.depositOption} is null OR ${table.depositOption} >= 0`,
    ),
    check(
      "drafts_finance_balance_nonnegative_check",
      sql`${table.financeBalance} is null OR ${table.financeBalance} >= 0`,
    ),
    check(
      "drafts_finance_contact_shape_check",
      sql`${table.financeContact} is null OR (jsonb_typeof(${table.financeContact}) = 'object' AND pg_column_size(${table.financeContact}) <= 8192)`,
    ),
    check(
      "drafts_finance_meta_shape_check",
      sql`${table.financeMeta} is null OR (jsonb_typeof(${table.financeMeta}) = 'object' AND pg_column_size(${table.financeMeta}) <= 8192)`,
    ),
    check(
      "drafts_ipfs_push_metadata_check",
      sql`(${table.ipfsPushed} = false AND ${table.ipfsPushedAt} is null) OR (${table.ipfsPushed} = true AND ${table.ipfsPushedAt} is not null)`,
    ),
    check(
      "drafts_history_bounded_check",
      sql`jsonb_typeof(${table.history}) = 'array' AND jsonb_array_length(${table.history}) <= 200 AND pg_column_size(${table.history}) <= 65536`,
    ),
  ],
);

export type DraftRecord = typeof drafts.$inferSelect;
export type NewDraftRecord = typeof drafts.$inferInsert;

export const approvalQueueEntries = pgTable(
  "approval_queue_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "restrict" }),
    submittedByUserId: uuid("submitted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    submittedPayload: jsonb("submitted_payload").notNull(),
    status: approvalQueueStatusEnum("status").notNull().default("pending"),
    reason: text("reason"),
    actedByUserId: uuid("acted_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("approval_queue_entries_active_draft_idx")
      .on(table.draftId)
      .where(sql`${table.status} in ('pending', 'flagged')`),
    index("approval_queue_entries_status_submitted_idx").on(
      table.status,
      table.submittedAt,
    ),
    index("approval_queue_entries_submitter_idx").on(table.submittedByUserId),
    check(
      "approval_queue_entries_payload_shape_check",
      sql`jsonb_typeof(${table.submittedPayload}) = 'object'
        AND COALESCE(
          (${table.submittedPayload}->>'schemaVersion') ~ '^[1-9][0-9]*$',
          false
        )
        AND pg_column_size(${table.submittedPayload}) <= 262144`,
    ),
    check(
      "approval_queue_entries_payload_scope_check",
      sql`NOT (${table.submittedPayload} ?| ARRAY[
        'carrierFee',
        'carrier_fee',
        'rewriteSubtype',
        'rewrite_subtype',
        'balance_due_from_insured',
        'remaining_net_due'
      ])`,
    ),
    check(
      "approval_queue_entries_action_metadata_check",
      sql`(
        ${table.status} = 'pending'
        AND ${table.reason} is null
        AND ${table.actedByUserId} is null
        AND ${table.actedAt} is null
      ) OR (
        ${table.status} in ('sent_back', 'flagged')
        AND NULLIF(btrim(${table.reason}), '') is not null
        AND ${table.actedByUserId} is not null
        AND ${table.actedAt} is not null
      )`,
    ),
    check(
      "approval_queue_entries_submitted_order_check",
      sql`${table.submittedAt} >= ${table.createdAt}`,
    ),
    check(
      "approval_queue_entries_updated_order_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export type ApprovalQueueEntryRecord =
  typeof approvalQueueEntries.$inferSelect;
export type NewApprovalQueueEntryRecord =
  typeof approvalQueueEntries.$inferInsert;

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceDraftId: uuid("source_draft_id").references(() => drafts.id, {
      onDelete: "restrict",
    }),
    submittedByUserId: uuid("submitted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    insuredName: text("insured_name").notNull(),
    companyName: text("company_name"),
    policyNumber: text("policy_number").notNull(),
    policyTypeId: uuid("policy_type_id")
      .notNull()
      .references(() => policyTypes.id, { onDelete: "restrict" }),
    transactionType: text("transaction_type").notNull(),
    transactionNotes: text("transaction_notes"),
    invoiceNumber: text("invoice_number"),
    effectiveDate: date("effective_date").notNull(),
    expirationDate: date("expiration_date").notNull(),
    carrierId: uuid("carrier_id")
      .notNull()
      .references(() => carriers.id, { onDelete: "restrict" }),
    mgaId: uuid("mga_id")
      .notNull()
      .references(() => mgas.id, { onDelete: "restrict" }),
    officeLocationId: uuid("office_location_id")
      .notNull()
      .references(() => officeLocations.id, { onDelete: "restrict" }),
    accountAssignment: accountAssignmentEnum("account_assignment")
      .notNull()
      .default("none"),
    producerUserId: uuid("producer_user_id").references(
      () => staffProfiles.userId,
      { onDelete: "restrict" },
    ),
    kayleeSplit: accountAssignmentEnum("kaylee_split")
      .notNull()
      .default("none"),
    notes: text("notes"),
    basePremium: numeric("base_premium", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    taxes: numeric("taxes", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    mgaFee: numeric("mga_fee", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    brokerFee: numeric("broker_fee", { precision: 14, scale: 2 }).notNull(),
    commissionAmount: numeric("commission_amount", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    commissionMode: commissionModeEnum("commission_mode").notNull(),
    commissionRate: numeric("commission_rate", { precision: 7, scale: 4 }),
    commissionConfirmed: boolean("commission_confirmed")
      .notNull()
      .default(false),
    amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }).notNull(),
    proposalTotal: numeric("proposal_total", {
      precision: 14,
      scale: 2,
    }).notNull(),
    netDue: numeric("net_due", { precision: 14, scale: 2 }).notNull(),
    paymentMode: paymentModeEnum("payment_mode").notNull(),
    depositOption: numeric("deposit_option", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    financeBalance: numeric("finance_balance", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    financeReference: text("finance_reference"),
    ipfsFinanced: ipfsFinancingChoiceEnum("ipfs_financed"),
    ipfsManual: boolean("ipfs_manual").notNull().default(false),
    ipfsReturning: ipfsCustomerTypeEnum("ipfs_returning"),
    financeContact: jsonb("finance_contact"),
    financeMeta: jsonb("finance_meta"),
    ipfsPushed: boolean("ipfs_pushed").notNull().default(false),
    ipfsPushedAt: timestamp("ipfs_pushed_at", { withTimezone: true }),
    mgaPaid: boolean("mga_paid").notNull().default(false),
    mgaPayReference: text("mga_pay_reference"),
    mgaPaidAt: timestamp("mga_paid_at", { withTimezone: true }),
    premiumTotal: numeric("premium_total", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    collectedToDate: numeric("collected_to_date", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    netDueTotal: numeric("net_due_total", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    remittedToMga: numeric("remitted_to_mga", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    receivableStatus: receivableStatusEnum("receivable_status")
      .notNull()
      .default("paid"),
    payableStatus: payableStatusEnum("payable_status")
      .notNull()
      .default("paid"),
    balanceDueDate: date("balance_due_date"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("policies_source_draft_idx").on(table.sourceDraftId),
    index("policies_submitter_idx").on(table.submittedByUserId),
    index("policies_policy_type_idx").on(table.policyTypeId),
    index("policies_carrier_idx").on(table.carrierId),
    index("policies_mga_paid_idx").on(table.mgaId, table.mgaPaid),
    index("policies_office_idx").on(table.officeLocationId),
    index("policies_producer_idx").on(table.producerUserId),
    index("policies_effective_date_idx").on(table.effectiveDate),
    check(
      "policies_insured_name_check",
      sql`${table.insuredName} = btrim(${table.insuredName}) AND char_length(${table.insuredName}) > 0`,
    ),
    check(
      "policies_company_name_check",
      sql`${table.companyName} is null OR (${table.companyName} = btrim(${table.companyName}) AND char_length(${table.companyName}) > 0)`,
    ),
    check(
      "policies_policy_number_check",
      sql`${table.policyNumber} = btrim(${table.policyNumber}) AND char_length(${table.policyNumber}) > 0`,
    ),
    check(
      "policies_transaction_type_check",
      sql`${table.transactionType} = btrim(${table.transactionType}) AND char_length(${table.transactionType}) BETWEEN 1 AND 100`,
    ),
    check(
      "policies_invoice_number_check",
      sql`lower(${table.transactionType}) NOT IN ('audit', 'endorsement') OR NULLIF(btrim(${table.invoiceNumber}), '') is not null`,
    ),
    check(
      "policies_date_order_check",
      sql`${table.expirationDate} >= ${table.effectiveDate}`,
    ),
    check(
      "policies_assignment_check",
      sql`(${table.kayleeSplit} = 'none' AND ${table.producerUserId} is null)
        OR (${table.kayleeSplit} in ('book', 'house') AND ${table.producerUserId} is not null)`,
    ),
    check(
      "policies_money_nonnegative_check",
      sql`${table.basePremium} >= 0
        AND ${table.taxes} >= 0
        AND ${table.mgaFee} >= 0
        AND ${table.brokerFee} >= 0
        AND ${table.commissionAmount} >= 0
        AND ${table.amountPaid} >= 0
        AND ${table.proposalTotal} >= 0
        AND ${table.netDue} >= 0
        AND ${table.depositOption} >= 0
        AND ${table.financeBalance} >= 0`,
    ),
    check(
      "policies_proposal_total_check",
      sql`${table.proposalTotal} = ${table.basePremium} + ${table.taxes} + ${table.mgaFee} + ${table.brokerFee}`,
    ),
    check(
      "policies_commission_check",
      sql`(
        ${table.commissionMode} = 'pct'
        AND ${table.commissionRate} is not null
        AND ${table.commissionRate} BETWEEN 0 AND 100
        AND ${table.commissionAmount} = round(${table.basePremium} * ${table.commissionRate} / 100, 2)
        AND (${table.basePremium} = 0 OR ${table.commissionConfirmed} = true)
      ) OR (
        ${table.commissionMode} in ('tbd', 'na')
        AND ${table.commissionRate} is null
        AND ${table.commissionAmount} = 0
        AND ${table.commissionConfirmed} = false
      )`,
    ),
    check(
      "policies_net_due_check",
      sql`${table.netDue} = ${table.amountPaid} - ${table.commissionAmount} - ${table.brokerFee}`,
    ),
    check(
      "policies_finance_balance_check",
      sql`(${table.paymentMode} = 'deposit'
        AND ${table.proposalTotal} >= ${table.amountPaid}
        AND ${table.financeBalance} = ${table.proposalTotal} - ${table.amountPaid})
        OR (${table.paymentMode} in ('full', 'direct') AND ${table.financeBalance} = 0)`,
    ),
    check(
      "policies_finance_contact_shape_check",
      sql`${table.financeContact} is null OR (jsonb_typeof(${table.financeContact}) = 'object' AND pg_column_size(${table.financeContact}) <= 8192)`,
    ),
    check(
      "policies_finance_meta_shape_check",
      sql`${table.financeMeta} is null OR (jsonb_typeof(${table.financeMeta}) = 'object' AND pg_column_size(${table.financeMeta}) <= 8192)`,
    ),
    check(
      "policies_ipfs_state_check",
      sql`(
        ${table.paymentMode} <> 'deposit'
        AND ${table.ipfsFinanced} is null
        AND ${table.ipfsManual} = false
        AND ${table.ipfsReturning} is null
        AND ${table.financeContact} is null
        AND ${table.financeMeta} is null
        AND ${table.ipfsPushed} = false
        AND ${table.ipfsPushedAt} is null
      ) OR (
        ${table.paymentMode} = 'deposit'
        AND ${table.ipfsFinanced} = 'no'
        AND ${table.ipfsManual} = false
        AND ${table.ipfsReturning} is null
        AND ${table.financeContact} is null
        AND ${table.financeMeta} is null
        AND ${table.ipfsPushed} = false
        AND ${table.ipfsPushedAt} is null
      ) OR (
        ${table.paymentMode} = 'deposit'
        AND ${table.ipfsFinanced} = 'yes'
        AND ${table.financeMeta} is not null
        AND (
          ${table.ipfsManual} = true
          OR (${table.ipfsReturning} is not null AND ${table.financeContact} is not null)
        )
        AND (
          (${table.ipfsPushed} = false AND ${table.ipfsPushedAt} is null)
          OR (
            ${table.ipfsManual} = false
            AND ${table.ipfsPushed} = true
            AND ${table.ipfsPushedAt} is not null
          )
        )
      )`,
    ),
    check(
      "policies_mga_paid_state_check",
      sql`(${table.mgaPaid} = false AND ${table.mgaPaidAt} is null)
        OR (${table.mgaPaid} = true AND ${table.mgaPaidAt} is not null)`,
    ),
    check(
      "policies_payment_stub_nonnegative_check",
      sql`${table.premiumTotal} >= 0
        AND ${table.collectedToDate} >= 0
        AND ${table.netDueTotal} >= 0
        AND ${table.remittedToMga} >= 0
        AND ${table.collectedToDate} <= ${table.premiumTotal}
        AND ${table.remittedToMga} <= ${table.netDueTotal}`,
    ),
    check(
      "policies_receivable_status_check",
      sql`(${table.receivableStatus} = 'paid' AND ${table.collectedToDate} = ${table.premiumTotal})
        OR (${table.receivableStatus} = 'open' AND ${table.premiumTotal} > 0 AND ${table.collectedToDate} = 0)
        OR (${table.receivableStatus} = 'partial'
          AND ${table.collectedToDate} > 0
          AND ${table.collectedToDate} < ${table.premiumTotal})`,
    ),
    check(
      "policies_payable_status_check",
      sql`(${table.payableStatus} = 'paid' AND ${table.remittedToMga} = ${table.netDueTotal})
        OR (${table.payableStatus} = 'unpaid' AND ${table.netDueTotal} > 0 AND ${table.remittedToMga} = 0)
        OR (${table.payableStatus} = 'partially_remitted'
          AND ${table.remittedToMga} > 0
          AND ${table.remittedToMga} < ${table.netDueTotal})`,
    ),
    check(
      "policies_timestamp_order_check",
      sql`${table.approvedAt} >= ${table.submittedAt}
        AND ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export type PolicyRecord = typeof policies.$inferSelect;
export type NewPolicyRecord = typeof policies.$inferInsert;
