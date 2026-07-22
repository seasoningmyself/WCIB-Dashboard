import { asc, eq, sql } from "drizzle-orm";
import type { AccessRequirement } from "../auth/access.js";
import { evaluateAccess } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  officeLocations,
  type OfficeLocationRecord,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import {
  ADMIN_OFFICE_LOCATION_MAX_RESULTS,
  adminOfficeManagementResponseSchema,
  createAdminOfficeRequestSchema,
  renameAdminOfficeRequestSchema,
  type AdminOfficeManagementResponse,
  type AdminOfficeMode,
} from "../../shared/admin-office-locations.js";
import { deriveOfficeSelectionMode } from "../../shared/office-selection.js";

export const OFFICE_MANAGEMENT_ACCESS = {
  capabilities: ["admin", "support_engineer"],
} as const satisfies AccessRequirement;

export interface AdminOfficeManagementSource {
  items: readonly OfficeLocationRecord[];
  mode: AdminOfficeMode;
}

export class AdminOfficeAccessDeniedError extends Error {
  constructor() {
    super("Admin office access denied");
    this.name = "AdminOfficeAccessDeniedError";
  }
}

export class AdminOfficeNotFoundError extends Error {
  constructor() {
    super("Office location was not found");
    this.name = "AdminOfficeNotFoundError";
  }
}

export class AdminOfficeConflictError extends Error {
  constructor() {
    super("Office location conflicts with existing data");
    this.name = "AdminOfficeConflictError";
  }
}

export class AdminOfficeBoundsError extends Error {
  constructor() {
    super("Office location result exceeds the supported bound");
    this.name = "AdminOfficeBoundsError";
  }
}

export async function loadAdminOfficeManagementSource(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
): Promise<AdminOfficeManagementSource> {
  requireAdminOfficeAccess(context);
  return loadState(database);
}

export async function createAdminOfficeLocation(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  input: unknown,
  logger: AppLogger,
): Promise<AdminOfficeManagementSource> {
  requireAdminOfficeAccess(context);
  const request = createAdminOfficeRequestSchema.parse(input);
  try {
    const result = await database.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(officeLocations)
        .values({ name: request.name })
        .returning({ id: officeLocations.id });
      if (created === undefined) {
        throw new Error("Office location insert returned no row");
      }
      await writeAuditEventInDrizzleTransaction(
        transaction,
        context,
        {
          action: "office_location_created",
          after: {
            allowedFields: ["isActive", "name"],
            source: { isActive: true, name: request.name },
          },
          entityId: created.id,
          entityType: "office_location",
        },
        logger,
      );
      return {
        officeLocationId: created.id,
        state: await loadState(transaction as AuthDatabase),
      };
    });
    logOfficeMutation(logger, context, "created", result.officeLocationId, result.state);
    return result.state;
  } catch (error) {
    throw mapOfficeWriteError(error);
  }
}

export async function renameAdminOfficeLocation(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  officeLocationId: string,
  input: unknown,
  logger: AppLogger,
): Promise<AdminOfficeManagementSource> {
  requireAdminOfficeAccess(context);
  const request = renameAdminOfficeRequestSchema.parse(input);
  try {
    const state = await database.transaction(async (transaction) => {
      const current = await lockOffice(transaction as AuthDatabase, officeLocationId);
      if (current.name !== request.name) {
        await transaction
          .update(officeLocations)
          .set({ name: request.name, updatedAt: new Date() })
          .where(eq(officeLocations.id, officeLocationId));
        await writeAuditEventInDrizzleTransaction(
          transaction,
          context,
          {
            action: "office_location_renamed",
            after: {
              allowedFields: ["name"],
              source: { name: request.name },
            },
            before: {
              allowedFields: ["name"],
              source: { name: current.name },
            },
            entityId: officeLocationId,
            entityType: "office_location",
          },
          logger,
        );
      }
      return loadState(transaction as AuthDatabase);
    });
    logOfficeMutation(logger, context, "renamed", officeLocationId, state);
    return state;
  } catch (error) {
    throw mapOfficeWriteError(error);
  }
}

export async function setAdminOfficeLocationActive(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  officeLocationId: string,
  active: boolean,
  logger: AppLogger,
): Promise<AdminOfficeManagementSource> {
  requireAdminOfficeAccess(context);
  try {
    const state = await database.transaction(async (transaction) => {
      const current = await lockOffice(transaction as AuthDatabase, officeLocationId);
      if (current.isActive !== active) {
        await transaction
          .update(officeLocations)
          .set({ isActive: active, updatedAt: new Date() })
          .where(eq(officeLocations.id, officeLocationId));
        await writeAuditEventInDrizzleTransaction(
          transaction,
          context,
          {
            action: active
              ? "office_location_reactivated"
              : "office_location_deactivated",
            after: {
              allowedFields: ["isActive"],
              source: { isActive: active },
            },
            before: {
              allowedFields: ["isActive"],
              source: { isActive: current.isActive },
            },
            entityId: officeLocationId,
            entityType: "office_location",
          },
          logger,
        );
      }
      return loadState(transaction as AuthDatabase);
    });
    logOfficeMutation(
      logger,
      context,
      active ? "reactivated" : "deactivated",
      officeLocationId,
      state,
    );
    return state;
  } catch (error) {
    throw mapOfficeWriteError(error);
  }
}

export function projectAdminOfficeManagementSource(
  source: Readonly<AdminOfficeManagementSource>,
  context: AuthorizedRequestContext,
): AdminOfficeManagementResponse | null {
  if (!evaluateAccess(context.principal, OFFICE_MANAGEMENT_ACCESS).allowed) {
    return null;
  }
  return adminOfficeManagementResponseSchema.parse({
    items: source.items.map((item) => ({
      createdAt: item.createdAt,
      id: item.id,
      isActive: item.isActive,
      name: item.name,
      updatedAt: item.updatedAt,
    })),
    mode: source.mode,
  });
}

export function deriveAdminOfficeMode(
  items: readonly Pick<OfficeLocationRecord, "id" | "isActive">[],
): AdminOfficeMode {
  return deriveOfficeSelectionMode(items.filter(({ isActive }) => isActive));
}

function requireAdminOfficeAccess(context: AuthorizedRequestContext): void {
  if (!evaluateAccess(context.principal, OFFICE_MANAGEMENT_ACCESS).allowed) {
    throw new AdminOfficeAccessDeniedError();
  }
}

async function loadState(database: AuthDatabase): Promise<AdminOfficeManagementSource> {
  const rows = await database
    .select()
    .from(officeLocations)
    .orderBy(asc(sql`lower(${officeLocations.name})`), asc(officeLocations.id))
    .limit(ADMIN_OFFICE_LOCATION_MAX_RESULTS + 1);
  if (rows.length > ADMIN_OFFICE_LOCATION_MAX_RESULTS) {
    throw new AdminOfficeBoundsError();
  }
  return { items: rows, mode: deriveAdminOfficeMode(rows) };
}

async function lockOffice(
  database: AuthDatabase,
  officeLocationId: string,
): Promise<OfficeLocationRecord> {
  const [office] = await database
    .select()
    .from(officeLocations)
    .where(eq(officeLocations.id, officeLocationId))
    .limit(1)
    .for("update");
  if (office === undefined) throw new AdminOfficeNotFoundError();
  return office;
}

function mapOfficeWriteError(error: unknown): unknown {
  if (
    error instanceof AdminOfficeBoundsError ||
    error instanceof AdminOfficeConflictError ||
    error instanceof AdminOfficeNotFoundError
  ) {
    return error;
  }
  if (readDatabaseErrorCode(error) === "23505") {
    return new AdminOfficeConflictError();
  }
  return error;
}

function logOfficeMutation(
  logger: AppLogger,
  context: AuthorizedRequestContext,
  action: "created" | "deactivated" | "reactivated" | "renamed",
  officeLocationId: string,
  state: AdminOfficeManagementSource,
): void {
  logger.info("Office location mutation completed", {
    action,
    activeCount: state.mode.activeCount,
    actorUserId: context.principal.userId,
    component: "admin_office_locations",
    event: "admin_office_location_mutation_completed",
    mode: state.mode.kind,
    officeLocationId,
  });
}
