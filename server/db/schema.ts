import { sql } from "drizzle-orm";
import { STAFF_ROLES } from "../../shared/access.js";
import {
  boolean,
  check,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const staffRoleEnum = pgEnum("staff_role", STAFF_ROLES);
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
