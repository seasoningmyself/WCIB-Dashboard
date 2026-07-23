import {
  and,
  asc,
  eq,
  inArray,
  ne,
  sql,
} from "drizzle-orm";
import type { AccessRequirement } from "./access.js";
import { evaluateAccess } from "./access.js";
import {
  ADMIN_STAFF_MAX_RESULTS,
  adminStaffRateSchema,
  createAdminStaffRequestSchema,
  issueTemporaryPasswordRequestSchema,
  producerRateInputSchema,
  updateAdminStaffRequestSchema,
  type AdminStaffRecord,
  type ProducerRateInput,
} from "../../shared/admin-staff.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import type { AppLogger } from "../logging/logger.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  officeLocations,
  producerRateHistory,
  sessions,
  staffProfiles,
  users,
  type ProducerRateHistoryRecord,
} from "../db/schema.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import {
  createUser,
  DuplicateUserEmailError,
  type AuthDatabase,
} from "./users.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  consumeStepUpAuthorization,
  StepUpRequiredError,
  type StepUpProof,
} from "./mfa-step-up.js";

export const ADMIN_STAFF_ACCESS = {
  capabilities: ["admin"],
} as const satisfies AccessRequirement;

const STAFF_AUDIT_FIELDS = [
  "active",
  "assignmentOptionsChanged",
  "bookAssignmentEnabled",
  "changeKind",
  "firstYearAssignmentEnabled",
  "identityChanged",
  "officeAssignmentChanged",
  "role",
] as const;
const RATE_AUDIT_FIELDS = ["changeKind", "fieldsChanged", "locked"] as const;

interface AdminStaffSource {
  account: {
    createdAt: Date;
    displayName: string;
    email: string;
    id: string;
    isActive: boolean;
    passwordChangeRequiredAt: Date | null;
    sessionVersion: number;
  };
  profile: {
    bookAssignmentEnabled: boolean;
    firstYearAssignmentEnabled: boolean;
    isActive: boolean;
    officeLocation: {
      id: string;
      isActive: boolean;
      name: string;
    } | null;
    role: "employee" | "producer";
  };
  rates: ProducerRateHistoryRecord[];
}

export class AdminStaffAccessDeniedError extends Error {
  constructor() {
    super("Admin staff access denied");
    this.name = "AdminStaffAccessDeniedError";
  }
}

export class AdminStaffNotFoundError extends Error {
  constructor() {
    super("Staff account was not found");
    this.name = "AdminStaffNotFoundError";
  }
}

export class AdminStaffConflictError extends Error {
  constructor(message = "Staff account conflicts with existing data") {
    super(message);
    this.name = "AdminStaffConflictError";
  }
}

export class ProducerRateLockedError extends Error {
  constructor() {
    super("Locked producer rates are immutable");
    this.name = "ProducerRateLockedError";
  }
}

export class AdminStaffBoundsError extends Error {
  constructor() {
    super("Staff result exceeds the supported bound");
    this.name = "AdminStaffBoundsError";
  }
}

export async function listAdminStaffSources(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
): Promise<AdminStaffSource[]> {
  requireAdminStaffAccess(context);
  const rows = await database
    .select({
      bookAssignmentEnabled: staffProfiles.bookAssignmentEnabled,
      createdAt: users.createdAt,
      displayName: users.displayName,
      email: users.email,
      firstYearAssignmentEnabled: staffProfiles.firstYearAssignmentEnabled,
      isAccountActive: users.isActive,
      isProfileActive: staffProfiles.isActive,
      officeId: officeLocations.id,
      officeIsActive: officeLocations.isActive,
      officeName: officeLocations.name,
      passwordChangeRequiredAt: users.passwordChangeRequiredAt,
      role: staffProfiles.role,
      sessionVersion: users.sessionVersion,
      userId: users.id,
    })
    .from(staffProfiles)
    .innerJoin(users, eq(users.id, staffProfiles.userId))
    .leftJoin(
      officeLocations,
      eq(officeLocations.id, staffProfiles.officeLocationId),
    )
    .orderBy(asc(users.displayName), asc(users.id))
    .limit(ADMIN_STAFF_MAX_RESULTS + 1);
  if (rows.length > ADMIN_STAFF_MAX_RESULTS) {
    throw new AdminStaffBoundsError();
  }
  if (rows.length === 0) {
    return [];
  }
  const rateRows = await database
    .select()
    .from(producerRateHistory)
    .where(inArray(producerRateHistory.producerUserId, rows.map(({ userId }) => userId)))
    .orderBy(
      asc(producerRateHistory.producerUserId),
      asc(producerRateHistory.effectiveDate),
      asc(producerRateHistory.id),
    );
  const ratesByUser = new Map<string, ProducerRateHistoryRecord[]>();
  for (const rate of rateRows) {
    const rates = ratesByUser.get(rate.producerUserId) ?? [];
    rates.push(rate);
    ratesByUser.set(rate.producerUserId, rates);
  }
  return rows.map((row) => sourceFromRow(row, ratesByUser.get(row.userId) ?? []));
}

export async function getAdminStaffSource(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  userId: string,
): Promise<AdminStaffSource> {
  requireAdminStaffAccess(context);
  const source = await loadAdminStaffSource(database, userId);
  if (source === null) {
    throw new AdminStaffNotFoundError();
  }
  return source;
}

export async function createAdminStaff(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  input: unknown,
  logger: AppLogger,
): Promise<AdminStaffSource> {
  requireAdminStaffAccess(context);
  const request = createAdminStaffRequestSchema.parse(input);
  requireAllowedDisplayName(request.displayName);

  try {
    const userId = await database.transaction(async (transaction) => {
      await lockStaffNames(transaction);
      await requireUniqueDisplayName(transaction, request.displayName, null);
      await requireAssignableOffice(transaction as AuthDatabase, request.officeLocationId);
      const account = await createUser(transaction as AuthDatabase, {
        displayName: request.displayName,
        email: request.email,
        password: request.temporaryPassword,
        passwordChangeRequired: true,
      });
      await transaction.insert(staffProfiles).values({
        officeLocationId: request.officeLocationId ?? null,
        role: request.role,
        userId: account.id,
      });
      await writeStaffAudit(
        transaction,
        context,
        account.id,
        null,
        staffAuditSource(
          "created",
          request.role,
          true,
          true,
          request.officeLocationId !== undefined &&
            request.officeLocationId !== null,
        ),
        logger,
      );
      await writeTemporaryPasswordAudit(
        transaction,
        context,
        account.id,
        "account_created",
        logger,
      );
      if (request.initialRate !== undefined) {
        await insertRateWithAudit(
          transaction,
          context,
          account.id,
          request.initialRate,
          logger,
        );
      }
      return account.id;
    });
    logger.info("Staff account mutation completed", {
      action: "created",
      actorUserId: context.principal.userId,
      component: "admin_staff",
      event: "admin_staff_mutation_completed",
      targetUserId: userId,
    });
    return requireLoadedSource(database, userId);
  } catch (error) {
    throw mapAdminStaffWriteError(error);
  }
}

export async function updateAdminStaff(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  userId: string,
  input: unknown,
  logger: AppLogger,
  proof?: StepUpProof,
): Promise<AdminStaffSource> {
  requireAdminStaffAccess(context);
  const request = updateAdminStaffRequestSchema.parse(input);
  if (request.displayName !== undefined) {
    requireAllowedDisplayName(request.displayName);
  }

  try {
    await database.transaction(async (transaction) => {
      await lockStaffNames(transaction);
      const current = await loadAdminStaffSource(transaction as AuthDatabase, userId, true);
      if (current === null) {
        throw new AdminStaffNotFoundError();
      }
      if (request.displayName !== undefined) {
        await requireUniqueDisplayName(
          transaction,
          request.displayName,
          userId,
        );
      }
      await requireAssignableOffice(
        transaction as AuthDatabase,
        request.officeLocationId,
      );
      const nextRole = request.role ?? current.profile.role;
      const roleChanged = nextRole !== current.profile.role;
      const emailChanged =
        request.email !== undefined && request.email !== current.account.email;
      const officeAssignmentChanged =
        request.officeLocationId !== undefined &&
        request.officeLocationId !==
          (current.profile.officeLocation?.id ?? null);
      const assignmentOptionsChanged =
        (request.bookAssignmentEnabled !== undefined &&
          request.bookAssignmentEnabled !==
            current.profile.bookAssignmentEnabled) ||
        (request.firstYearAssignmentEnabled !== undefined &&
          request.firstYearAssignmentEnabled !==
            current.profile.firstYearAssignmentEnabled);
      if (
        (request.bookAssignmentEnabled !== undefined ||
          request.firstYearAssignmentEnabled !== undefined) &&
        nextRole !== "producer"
      ) {
        throw new AdminStaffConflictError(
          "Assignment options can only be changed for a producer",
        );
      }
      if (emailChanged || roleChanged) {
        if (proof === undefined) throw new StepUpRequiredError();
        await consumeStepUpAuthorization(
          transaction as AuthDatabase,
          context,
          proof,
        );
      }
      const needsInitialRate =
        current.profile.role === "employee" &&
        nextRole === "producer" &&
        current.rates.length === 0;
      if (needsInitialRate && request.initialRate === undefined) {
        throw new AdminStaffConflictError(
          "Employee-to-producer changes require an explicit initial rate",
        );
      }
      if (!needsInitialRate && request.initialRate !== undefined) {
        throw new AdminStaffConflictError(
          "An initial rate is only accepted for a producer transition without rate history",
        );
      }

      if (emailChanged || roleChanged || request.displayName !== undefined) {
        await transaction
          .update(users)
          .set({
            ...(request.displayName === undefined
              ? {}
              : { displayName: request.displayName }),
            ...(emailChanged ? { email: request.email } : {}),
            ...(emailChanged || roleChanged
              ? { sessionVersion: sql`${users.sessionVersion} + 1` }
              : {}),
          })
          .where(eq(users.id, userId));
      }
      await transaction
        .update(staffProfiles)
        .set({
          ...(request.bookAssignmentEnabled === undefined
            ? {}
            : { bookAssignmentEnabled: request.bookAssignmentEnabled }),
          ...(request.firstYearAssignmentEnabled === undefined
            ? {}
            : {
                firstYearAssignmentEnabled:
                  request.firstYearAssignmentEnabled,
              }),
          ...(request.officeLocationId === undefined
            ? {}
            : { officeLocationId: request.officeLocationId }),
          ...(request.role === undefined ? {} : { role: request.role }),
        })
        .where(eq(staffProfiles.userId, userId));

      const identityChanged = emailChanged || request.displayName !== undefined;
      const before = staffAuditSource(
        "updated",
        current.profile.role,
        current.account.isActive && current.profile.isActive,
        identityChanged,
        officeAssignmentChanged,
        assignmentOptionsChanged
          ? {
              assignmentOptionsChanged: true,
              bookAssignmentEnabled:
                current.profile.bookAssignmentEnabled,
              firstYearAssignmentEnabled:
                current.profile.firstYearAssignmentEnabled,
            }
          : undefined,
      );
      const after = staffAuditSource(
        "updated",
        nextRole,
        current.account.isActive && current.profile.isActive,
        identityChanged,
        officeAssignmentChanged,
        assignmentOptionsChanged
          ? {
              assignmentOptionsChanged: true,
              bookAssignmentEnabled:
                request.bookAssignmentEnabled ??
                current.profile.bookAssignmentEnabled,
              firstYearAssignmentEnabled:
                request.firstYearAssignmentEnabled ??
                current.profile.firstYearAssignmentEnabled,
            }
          : undefined,
      );
      if (
        identityChanged ||
        roleChanged ||
        officeAssignmentChanged ||
        assignmentOptionsChanged
      ) {
        await writeStaffAudit(
          transaction,
          context,
          userId,
          before,
          after,
          logger,
        );
      }
      if (request.initialRate !== undefined) {
        await insertRateWithAudit(
          transaction,
          context,
          userId,
          request.initialRate,
          logger,
        );
      }
    });
    logger.info("Staff account mutation completed", {
      action: "updated",
      actorUserId: context.principal.userId,
      component: "admin_staff",
      event: "admin_staff_mutation_completed",
      targetUserId: userId,
    });
    return requireLoadedSource(database, userId);
  } catch (error) {
    throw mapAdminStaffWriteError(error);
  }
}

export async function setAdminStaffActive(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  userId: string,
  active: boolean,
  logger: AppLogger,
): Promise<AdminStaffSource> {
  requireAdminStaffAccess(context);
  try {
    await database.transaction(async (transaction) => {
      const current = await loadAdminStaffSource(transaction as AuthDatabase, userId, true);
      if (current === null) {
        throw new AdminStaffNotFoundError();
      }
      const currentlyActive = current.account.isActive && current.profile.isActive;
      if (currentlyActive === active) {
        return;
      }
      await transaction
        .update(users)
        .set({
          isActive: active,
          sessionVersion: sql`${users.sessionVersion} + 1`,
        })
        .where(eq(users.id, userId));
      await transaction
        .update(staffProfiles)
        .set({ isActive: active })
        .where(eq(staffProfiles.userId, userId));
      await writeStaffAudit(
        transaction,
        context,
        userId,
        staffAuditSource(
          active ? "reactivated" : "deactivated",
          current.profile.role,
          currentlyActive,
          false,
        ),
        staffAuditSource(
          active ? "reactivated" : "deactivated",
          current.profile.role,
          active,
          false,
        ),
        logger,
      );
    });
    logger.info("Staff account mutation completed", {
      action: active ? "reactivated" : "deactivated",
      actorUserId: context.principal.userId,
      component: "admin_staff",
      event: "admin_staff_mutation_completed",
      targetUserId: userId,
    });
    return requireLoadedSource(database, userId);
  } catch (error) {
    throw mapAdminStaffWriteError(error);
  }
}

export async function issueAdminTemporaryPassword(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  userId: string,
  input: unknown,
  logger: AppLogger,
  proof?: StepUpProof,
): Promise<AdminStaffSource> {
  requireAdminStaffAccess(context);
  if (context.principal.userId === userId) {
    throw new AdminStaffConflictError(
      "Use Settings to change your own password",
    );
  }
  const request = issueTemporaryPasswordRequestSchema.parse(input);
  try {
    await database.transaction(async (transaction) => {
      if (proof === undefined) throw new StepUpRequiredError();
      await consumeStepUpAuthorization(
        transaction as AuthDatabase,
        context,
        proof,
      );
      const current = await loadAdminStaffSource(
        transaction as AuthDatabase,
        userId,
        true,
      );
      if (current === null) {
        throw new AdminStaffNotFoundError();
      }
      const [credentials] = await transaction
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, userId))
        .for("update")
        .limit(1);
      if (credentials === undefined) {
        throw new AdminStaffNotFoundError();
      }
      if (
        await verifyPassword(
          request.temporaryPassword,
          credentials.passwordHash,
        )
      ) {
        throw new AdminStaffConflictError(
          "Temporary password must differ from the current password",
        );
      }
      const passwordHash = await hashPassword(request.temporaryPassword);
      await transaction
        .update(users)
        .set({
          passwordChangeRequiredAt: new Date(),
          passwordHash,
          sessionVersion: sql`${users.sessionVersion} + 1`,
        })
        .where(eq(users.id, userId));
      await transaction
        .delete(sessions)
        .where(sql`${sessions.sess}->>'userId' = ${userId}`);
      await writeTemporaryPasswordAudit(
        transaction,
        context,
        userId,
        "admin_recovery",
        logger,
      );
    });
    logger.info("Temporary password issued", {
      actorUserId: context.principal.userId,
      component: "admin_staff",
      event: "temporary_password_issued",
      targetUserId: userId,
    });
    return requireLoadedSource(database, userId);
  } catch (error) {
    throw mapAdminStaffWriteError(error);
  }
}

export async function createAdminProducerRate(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  userId: string,
  input: unknown,
  logger: AppLogger,
): Promise<AdminStaffSource> {
  requireAdminStaffAccess(context);
  const request = producerRateInputSchema.parse(input);
  try {
    await database.transaction(async (transaction) => {
      const current = await loadAdminStaffSource(transaction as AuthDatabase, userId, true);
      if (current === null) {
        throw new AdminStaffNotFoundError();
      }
      if (current.profile.role !== "producer") {
        throw new AdminStaffConflictError(
          "New rates can only be added to a producer account",
        );
      }
      await insertRateWithAudit(
        transaction,
        context,
        userId,
        request,
        logger,
      );
    });
    logger.info("Producer rate mutation completed", {
      action: "created",
      actorUserId: context.principal.userId,
      component: "admin_staff",
      event: "producer_rate_mutation_completed",
      targetUserId: userId,
    });
    return requireLoadedSource(database, userId);
  } catch (error) {
    throw mapAdminStaffWriteError(error);
  }
}

export async function updateAdminProducerRate(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  userId: string,
  rateId: string,
  input: unknown,
  logger: AppLogger,
): Promise<AdminStaffSource> {
  requireAdminStaffAccess(context);
  const request = producerRateInputSchema.parse(input);
  try {
    await database.transaction(async (transaction) => {
      const [rate] = await transaction
        .select()
        .from(producerRateHistory)
        .where(
          and(
            eq(producerRateHistory.id, rateId),
            eq(producerRateHistory.producerUserId, userId),
          ),
        )
        .limit(1)
        .for("update");
      if (rate === undefined) {
        throw new AdminStaffNotFoundError();
      }
      if (rate.lockedAt !== null) {
        throw new ProducerRateLockedError();
      }
      const changedFields = producerRateChangedFields(rate, request);
      if (changedFields.length === 0) {
        return;
      }
      await transaction
        .update(producerRateHistory)
        .set({ ...request, updatedAt: new Date() })
        .where(eq(producerRateHistory.id, rateId));
      await writeAuditEventInDrizzleTransaction(
        transaction,
        context,
        {
          action: "producer_rate_changed",
          after: {
            allowedFields: RATE_AUDIT_FIELDS,
            source: {
              changeKind: "corrected",
              fieldsChanged: changedFields.join(","),
              locked: false,
            },
          },
          before: {
            allowedFields: RATE_AUDIT_FIELDS,
            source: {
              changeKind: "corrected",
              fieldsChanged: "",
              locked: false,
            },
          },
          entityId: rateId,
          entityType: "producer_rate_history",
        },
        logger,
      );
    });
    logger.info("Producer rate mutation completed", {
      action: "corrected",
      actorUserId: context.principal.userId,
      component: "admin_staff",
      event: "producer_rate_mutation_completed",
      rateId,
      targetUserId: userId,
    });
    return requireLoadedSource(database, userId);
  } catch (error) {
    throw mapAdminStaffWriteError(error);
  }
}

export function projectAdminStaffSource(
  source: Readonly<AdminStaffSource>,
  context: AuthorizedRequestContext,
): AdminStaffRecord | null {
  if (!evaluateAccess(context.principal, ADMIN_STAFF_ACCESS).allowed) {
    return null;
  }
  const active = source.account.isActive && source.profile.isActive;
  return {
    bookAssignmentEnabled: source.profile.bookAssignmentEnabled,
    createdAt: source.account.createdAt.toISOString(),
    displayName: source.account.displayName,
    email: source.account.email,
    firstYearAssignmentEnabled:
      source.profile.firstYearAssignmentEnabled,
    isActive: active,
    officeLocation: source.profile.officeLocation,
    passwordChangeRequired:
      source.account.passwordChangeRequiredAt !== null,
    rateState:
      source.profile.role === "producer"
        ? source.rates.length === 0
          ? "missing"
          : "configured"
        : source.rates.length === 0
          ? "not_applicable"
          : "dormant",
    rates: source.rates.map((rate) =>
      adminStaffRateSchema.parse({
        createdAt: rate.createdAt,
        effectiveDate: rate.effectiveDate,
        id: rate.id,
        lockedAt: rate.lockedAt,
        newBrokerRate: rate.newBrokerRate,
        newCommissionRate: rate.newCommissionRate,
        renewalBrokerRate: rate.renewalBrokerRate,
        renewalCommissionRate: rate.renewalCommissionRate,
        updatedAt: rate.updatedAt,
      }),
    ),
    role: source.profile.role,
    userId: source.account.id,
  };
}

function requireAdminStaffAccess(context: AuthorizedRequestContext): void {
  if (!evaluateAccess(context.principal, ADMIN_STAFF_ACCESS).allowed) {
    throw new AdminStaffAccessDeniedError();
  }
}

async function loadAdminStaffSource(
  database: AuthDatabase,
  userId: string,
  lock = false,
): Promise<AdminStaffSource | null> {
  let query = database
    .select({
      bookAssignmentEnabled: staffProfiles.bookAssignmentEnabled,
      createdAt: users.createdAt,
      displayName: users.displayName,
      email: users.email,
      firstYearAssignmentEnabled: staffProfiles.firstYearAssignmentEnabled,
      isAccountActive: users.isActive,
      isProfileActive: staffProfiles.isActive,
      officeId: officeLocations.id,
      officeIsActive: officeLocations.isActive,
      officeName: officeLocations.name,
      passwordChangeRequiredAt: users.passwordChangeRequiredAt,
      role: staffProfiles.role,
      sessionVersion: users.sessionVersion,
      userId: users.id,
    })
    .from(staffProfiles)
    .innerJoin(users, eq(users.id, staffProfiles.userId))
    .leftJoin(
      officeLocations,
      eq(officeLocations.id, staffProfiles.officeLocationId),
    )
    .where(eq(users.id, userId))
    .limit(1);
  const rows = lock ? await query.for("update", { of: users }) : await query;
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  const rates = await database
    .select()
    .from(producerRateHistory)
    .where(eq(producerRateHistory.producerUserId, userId))
    .orderBy(asc(producerRateHistory.effectiveDate), asc(producerRateHistory.id));
  return sourceFromRow(row, rates);
}

async function requireLoadedSource(
  database: AuthDatabase,
  userId: string,
): Promise<AdminStaffSource> {
  const source = await loadAdminStaffSource(database, userId);
  if (source === null) {
    throw new AdminStaffNotFoundError();
  }
  return source;
}

function sourceFromRow(
  row: {
    bookAssignmentEnabled: boolean;
    createdAt: Date;
    displayName: string;
    email: string;
    firstYearAssignmentEnabled: boolean;
    isAccountActive: boolean;
    isProfileActive: boolean;
    officeId: string | null;
    officeIsActive: boolean | null;
    officeName: string | null;
    passwordChangeRequiredAt: Date | null;
    role: "employee" | "producer";
    sessionVersion: number;
    userId: string;
  },
  rates: ProducerRateHistoryRecord[],
): AdminStaffSource {
  return {
    account: {
      createdAt: row.createdAt,
      displayName: row.displayName,
      email: row.email,
      id: row.userId,
      isActive: row.isAccountActive,
      passwordChangeRequiredAt: row.passwordChangeRequiredAt,
      sessionVersion: row.sessionVersion,
    },
    profile: {
      bookAssignmentEnabled: row.bookAssignmentEnabled,
      firstYearAssignmentEnabled: row.firstYearAssignmentEnabled,
      isActive: row.isProfileActive,
      officeLocation:
        row.officeId === null ||
        row.officeIsActive === null ||
        row.officeName === null
          ? null
          : {
              id: row.officeId,
              isActive: row.officeIsActive,
              name: row.officeName,
            },
      role: row.role,
    },
    rates,
  };
}

async function lockStaffNames(
  transaction: Parameters<
    Parameters<AuthDatabase["transaction"]>[0]
  >[0],
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('wcib_staff_display_names', 0))`,
  );
}

async function requireUniqueDisplayName(
  database: Pick<AuthDatabase, "select">,
  displayName: string,
  exceptUserId: string | null,
): Promise<void> {
  const condition =
    exceptUserId === null
      ? sql`lower(${users.displayName}) = lower(${displayName})`
      : and(
          sql`lower(${users.displayName}) = lower(${displayName})`,
          ne(users.id, exceptUserId),
        );
  const [existing] = await database
    .select({ userId: users.id })
    .from(users)
    .where(condition)
    .limit(1);
  if (existing !== undefined) {
    throw new AdminStaffConflictError("A staff profile already uses that display name");
  }
}

function requireAllowedDisplayName(displayName: string): void {
  if (displayName.localeCompare("Sophia", undefined, { sensitivity: "accent" }) === 0) {
    throw new AdminStaffConflictError("Sophia is a reserved display name");
  }
}

async function insertRateWithAudit(
  transaction: Parameters<Parameters<AuthDatabase["transaction"]>[0]>[0],
  context: AuthorizedRequestContext,
  producerUserId: string,
  input: ProducerRateInput,
  logger: AppLogger,
): Promise<string> {
  const [rate] = await transaction
    .insert(producerRateHistory)
    .values({ ...input, producerUserId })
    .returning({ id: producerRateHistory.id });
  if (rate === undefined) {
    throw new Error("Producer rate insert returned no row");
  }
  await writeAuditEventInDrizzleTransaction(
    transaction,
    context,
    {
      action: "producer_rate_changed",
      after: {
        allowedFields: RATE_AUDIT_FIELDS,
        source: {
          changeKind: "created",
          fieldsChanged: "effectiveDate,newCommissionRate,newBrokerRate,renewalCommissionRate,renewalBrokerRate",
          locked: false,
        },
      },
      entityId: rate.id,
      entityType: "producer_rate_history",
    },
    logger,
  );
  return rate.id;
}

async function writeStaffAudit(
  transaction: Parameters<Parameters<AuthDatabase["transaction"]>[0]>[0],
  context: AuthorizedRequestContext,
  userId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  logger: AppLogger,
): Promise<void> {
  await writeAuditEventInDrizzleTransaction(
    transaction,
    context,
    {
      action: "staff_account_changed",
      after: { allowedFields: STAFF_AUDIT_FIELDS, source: after },
      ...(before === null
        ? {}
        : { before: { allowedFields: STAFF_AUDIT_FIELDS, source: before } }),
      entityId: userId,
      entityType: "staff_profile",
    },
    logger,
  );
}

function staffAuditSource(
  changeKind: string,
  role: "employee" | "producer",
  active: boolean,
  identityChanged: boolean,
  officeAssignmentChanged = false,
  assignment?: {
    assignmentOptionsChanged: boolean;
    bookAssignmentEnabled: boolean;
    firstYearAssignmentEnabled: boolean;
  },
): Record<string, unknown> {
  return {
    active,
    ...assignment,
    changeKind,
    identityChanged,
    officeAssignmentChanged,
    role,
  };
}

async function requireAssignableOffice(
  database: Pick<AuthDatabase, "select">,
  officeLocationId: string | null | undefined,
): Promise<void> {
  if (officeLocationId === undefined || officeLocationId === null) {
    return;
  }
  const [office] = await database
    .select({ isActive: officeLocations.isActive })
    .from(officeLocations)
    .where(eq(officeLocations.id, officeLocationId))
    .limit(1);
  if (office?.isActive !== true) {
    throw new AdminStaffConflictError(
      "Office assignment requires an active office location",
    );
  }
}

async function writeTemporaryPasswordAudit(
  transaction: Parameters<Parameters<AuthDatabase["transaction"]>[0]>[0],
  context: AuthorizedRequestContext,
  userId: string,
  changeKind: "account_created" | "admin_recovery",
  logger: AppLogger,
): Promise<void> {
  await writeAuditEventInDrizzleTransaction(
    transaction,
    context,
    {
      action: "user_temporary_password_issued",
      after: {
        allowedFields: ["changeKind"],
        source: { changeKind },
      },
      entityId: userId,
      entityType: "user",
    },
    logger,
  );
}

function producerRateChangedFields(
  rate: ProducerRateHistoryRecord,
  input: ProducerRateInput,
): string[] {
  return (Object.keys(input) as Array<keyof ProducerRateInput>).filter(
    (field) => rate[field] !== input[field],
  );
}

function mapAdminStaffWriteError(error: unknown): unknown {
  if (
    error instanceof AdminStaffConflictError ||
    error instanceof AdminStaffNotFoundError ||
    error instanceof ProducerRateLockedError
  ) {
    return error;
  }
  if (error instanceof DuplicateUserEmailError) {
    return new AdminStaffConflictError("An account already uses that email");
  }
  const code = readDatabaseErrorCode(error);
  if (code === "23505") {
    return new AdminStaffConflictError();
  }
  if (code === "55000") {
    return new ProducerRateLockedError();
  }
  return error;
}
