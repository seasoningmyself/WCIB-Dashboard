import { asc, sql } from "drizzle-orm";
import {
  createMgaRequestSchema,
  type MgaMutationResponse,
  type VocabularyOption,
} from "../../shared/vocabulary.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import { evaluateAccess } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { mgas } from "../db/schema.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import type { AppLogger } from "../logging/logger.js";
import { evaluateMgaAddition, MGA_ADD_ACCESS } from "./mgas.js";

type MgaQueryDatabase = Pick<AuthDatabase, "select">;

const mgaSelection = {
  id: mgas.id,
  name: mgas.name,
};

export class MgaAccessDeniedError extends Error {
  constructor() {
    super("MGA write access denied");
    this.name = "MgaAccessDeniedError";
  }
}

export async function createMgaVocabulary(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  input: unknown,
  logger: AppLogger,
): Promise<MgaMutationResponse> {
  requireMgaAccess(context);
  const request = createMgaRequestSchema.parse(input);

  try {
    const result = await database.transaction(async (transaction) => {
      const existing = await loadAllMgas(transaction);
      const decision = evaluateMgaAddition({
        candidateName: request.name,
        existingNames: existing.map(({ name }) => name),
        nearDuplicateConfirmed: request.confirmNearDuplicate,
        principal: context.principal,
      });

      if (decision.kind === "denied") {
        throw new MgaAccessDeniedError();
      }
      if (decision.kind === "invalid") {
        throw new Error("Validated MGA request produced an invalid decision");
      }
      if (decision.kind === "duplicate") {
        const item = findExactMga(existing, request.name);
        if (item === null) {
          throw new Error("MGA duplicate decision did not identify a record");
        }
        return { item, outcome: "duplicate" as const };
      }
      if (decision.kind === "confirmation_required") {
        const candidates = mapCandidateMgas(existing, decision.similarNames);
        if (candidates.length === 0) {
          throw new Error("MGA similarity decision did not identify a record");
        }
        return { candidates, outcome: "confirmation_required" as const };
      }

      const [item] = await transaction
        .insert(mgas)
        .values({ name: decision.name })
        .returning(mgaSelection);
      if (item === undefined) {
        throw new Error("MGA insert returned no record");
      }

      await writeAuditEventInDrizzleTransaction(
        transaction,
        context,
        {
          action: "mga_created",
          after: { allowedFields: ["name"], source: item },
          entityId: item.id,
          entityType: "mga",
        },
        logger,
      );
      return { item, outcome: "created" as const };
    });
    logMgaOutcome(logger, context, result.outcome);
    return result;
  } catch (error) {
    if (readDatabaseErrorCode(error) === "23505") {
      const existing = await findMgaByName(database, request.name);
      if (existing !== null) {
        logMgaOutcome(logger, context, "duplicate");
        return { item: existing, outcome: "duplicate" };
      }
    }
    logger.error(
      "MGA write failed",
      {
        actorUserId: context.principal.userId,
        component: "vocabulary",
        entityType: "mga",
        event: "vocabulary_write_failed",
      },
      error,
    );
    throw error;
  }
}

export function projectMgaMutation(
  source: Readonly<MgaMutationResponse>,
  context: AuthorizedRequestContext,
): MgaMutationResponse | null {
  if (!evaluateAccess(context.principal, MGA_ADD_ACCESS).allowed) {
    return null;
  }
  if (source.outcome === "confirmation_required") {
    return {
      candidates: source.candidates.map(pickVocabularyOption),
      outcome: source.outcome,
    };
  }
  return {
    item: pickVocabularyOption(source.item),
    outcome: source.outcome,
  };
}

function requireMgaAccess(context: AuthorizedRequestContext): void {
  if (!evaluateAccess(context.principal, MGA_ADD_ACCESS).allowed) {
    throw new MgaAccessDeniedError();
  }
}

async function loadAllMgas(
  database: MgaQueryDatabase,
): Promise<VocabularyOption[]> {
  return database
    .select(mgaSelection)
    .from(mgas)
    .orderBy(asc(sql`lower(${mgas.name})`), asc(mgas.id));
}

async function findMgaByName(
  database: MgaQueryDatabase,
  name: string,
): Promise<VocabularyOption | null> {
  const [item] = await database
    .select(mgaSelection)
    .from(mgas)
    .where(sql`lower(${mgas.name}) = lower(${name})`)
    .limit(1);
  return item ?? null;
}

function findExactMga(
  existing: readonly VocabularyOption[],
  name: string,
): VocabularyOption | null {
  const normalized = name.toLowerCase();
  return existing.find((item) => item.name.toLowerCase() === normalized) ?? null;
}

function mapCandidateMgas(
  existing: readonly VocabularyOption[],
  similarNames: readonly string[],
): VocabularyOption[] {
  const normalized = new Set(similarNames.map((name) => name.toLowerCase()));
  return existing
    .filter((item) => normalized.has(item.name.toLowerCase()))
    .map(pickVocabularyOption);
}

function pickVocabularyOption(source: VocabularyOption): VocabularyOption {
  return { id: source.id, name: source.name };
}

function logMgaOutcome(
  logger: AppLogger,
  context: AuthorizedRequestContext,
  outcome: MgaMutationResponse["outcome"],
): void {
  logger.info("MGA write completed", {
    actorUserId: context.principal.userId,
    component: "vocabulary",
    entityType: "mga",
    event: "vocabulary_write_completed",
    outcome,
  });
}
