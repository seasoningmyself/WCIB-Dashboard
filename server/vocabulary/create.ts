import { sql } from "drizzle-orm";
import {
  createCarrierRequestSchema,
  createPolicyTypeRequestSchema,
  type CarrierMutationResponse,
  type PolicyTypeMutationResponse,
  type VocabularyOption,
  type PolicyTypeOption,
} from "../../shared/vocabulary.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import { evaluateAccess } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { carriers, policyTypes } from "../db/schema.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import type { AppLogger } from "../logging/logger.js";
import { VOCABULARY_ADD_ACCESS } from "./add-rules.js";

type VocabularyQueryDatabase = Pick<AuthDatabase, "select">;

const carrierSelection = {
  id: carriers.id,
  name: carriers.name,
};

const policyTypeSelection = {
  classTag: policyTypes.classTag,
  id: policyTypes.id,
  name: policyTypes.name,
};

export class VocabularyAccessDeniedError extends Error {
  constructor() {
    super("Vocabulary write access denied");
    this.name = "VocabularyAccessDeniedError";
  }
}

export async function createCarrierVocabulary(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  input: unknown,
  logger: AppLogger,
): Promise<CarrierMutationResponse> {
  requireVocabularyAccess(context);
  const request = createCarrierRequestSchema.parse(input);

  try {
    const result = await database.transaction(async (transaction) => {
      const existing = await findCarrierByName(transaction, request.name);
      if (existing !== null) {
        return { item: existing, outcome: "duplicate" as const };
      }

      const [item] = await transaction
        .insert(carriers)
        .values({ name: request.name })
        .returning(carrierSelection);
      if (item === undefined) {
        throw new Error("Carrier insert returned no record");
      }

      await writeAuditEventInDrizzleTransaction(
        transaction,
        context,
        {
          action: "carrier_created",
          after: { allowedFields: ["name"], source: item },
          entityId: item.id,
          entityType: "carrier",
        },
        logger,
      );
      return { item, outcome: "created" as const };
    });
    logVocabularyOutcome(logger, context, "carrier", result.outcome);
    return result;
  } catch (error) {
    if (readDatabaseErrorCode(error) === "23505") {
      const existing = await findCarrierByName(database, request.name);
      if (existing !== null) {
        logVocabularyOutcome(logger, context, "carrier", "duplicate");
        return { item: existing, outcome: "duplicate" };
      }
    }
    logVocabularyFailure(logger, context, "carrier", error);
    throw error;
  }
}

export async function createPolicyTypeVocabulary(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  input: unknown,
  logger: AppLogger,
): Promise<PolicyTypeMutationResponse> {
  requireVocabularyAccess(context);
  const request = createPolicyTypeRequestSchema.parse(input);

  try {
    const result = await database.transaction(async (transaction) => {
      const existing = await findPolicyTypeByName(transaction, request.name);
      if (existing !== null) {
        return { item: existing, outcome: "duplicate" as const };
      }

      const [item] = await transaction
        .insert(policyTypes)
        .values({ classTag: request.classTag, name: request.name })
        .returning(policyTypeSelection);
      if (item === undefined) {
        throw new Error("Policy type insert returned no record");
      }

      await writeAuditEventInDrizzleTransaction(
        transaction,
        context,
        {
          action: "policy_type_created",
          after: { allowedFields: ["classTag", "name"], source: item },
          entityId: item.id,
          entityType: "policy_type",
        },
        logger,
      );
      return { item, outcome: "created" as const };
    });
    logVocabularyOutcome(logger, context, "policy_type", result.outcome);
    return result;
  } catch (error) {
    if (readDatabaseErrorCode(error) === "23505") {
      const existing = await findPolicyTypeByName(database, request.name);
      if (existing !== null) {
        logVocabularyOutcome(logger, context, "policy_type", "duplicate");
        return { item: existing, outcome: "duplicate" };
      }
    }
    logVocabularyFailure(logger, context, "policy_type", error);
    throw error;
  }
}

export function projectCarrierMutation(
  source: Readonly<CarrierMutationResponse>,
  context: AuthorizedRequestContext,
): CarrierMutationResponse | null {
  if (!evaluateAccess(context.principal, VOCABULARY_ADD_ACCESS).allowed) {
    return null;
  }
  return {
    item: pickVocabularyOption(source.item),
    outcome: source.outcome,
  };
}

export function projectPolicyTypeMutation(
  source: Readonly<PolicyTypeMutationResponse>,
  context: AuthorizedRequestContext,
): PolicyTypeMutationResponse | null {
  if (!evaluateAccess(context.principal, VOCABULARY_ADD_ACCESS).allowed) {
    return null;
  }
  return {
    item: {
      classTag: source.item.classTag,
      ...pickVocabularyOption(source.item),
    },
    outcome: source.outcome,
  };
}

function requireVocabularyAccess(context: AuthorizedRequestContext): void {
  if (!evaluateAccess(context.principal, VOCABULARY_ADD_ACCESS).allowed) {
    throw new VocabularyAccessDeniedError();
  }
}

async function findCarrierByName(
  database: VocabularyQueryDatabase,
  name: string,
): Promise<VocabularyOption | null> {
  const [item] = await database
    .select(carrierSelection)
    .from(carriers)
    .where(sql`lower(${carriers.name}) = lower(${name})`)
    .limit(1);
  return item ?? null;
}

async function findPolicyTypeByName(
  database: VocabularyQueryDatabase,
  name: string,
): Promise<PolicyTypeOption | null> {
  const [item] = await database
    .select(policyTypeSelection)
    .from(policyTypes)
    .where(sql`lower(${policyTypes.name}) = lower(${name})`)
    .limit(1);
  return item ?? null;
}

function pickVocabularyOption(source: VocabularyOption): VocabularyOption {
  return { id: source.id, name: source.name };
}

function logVocabularyOutcome(
  logger: AppLogger,
  context: AuthorizedRequestContext,
  entityType: "carrier" | "policy_type",
  outcome: "created" | "duplicate",
): void {
  logger.info("Vocabulary write completed", {
    actorUserId: context.principal.userId,
    component: "vocabulary",
    entityType,
    event: "vocabulary_write_completed",
    outcome,
  });
}

function logVocabularyFailure(
  logger: AppLogger,
  context: AuthorizedRequestContext,
  entityType: "carrier" | "policy_type",
  error: unknown,
): void {
  logger.error(
    "Vocabulary write failed",
    {
      actorUserId: context.principal.userId,
      component: "vocabulary",
      entityType,
      event: "vocabulary_write_failed",
    },
    error,
  );
}
