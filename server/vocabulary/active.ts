import { asc, eq, sql } from "drizzle-orm";
import type { PolicyTypeClass } from "../../shared/policy-types.js";
import type { ActiveVocabularyResponse } from "../../shared/vocabulary.js";
import { evaluateAccess } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import {
  carriers,
  mgas,
  officeLocations,
  policyTypes,
} from "../db/schema.js";
import { VOCABULARY_USER_ACCESS } from "./access.js";

export const MAX_ACTIVE_VOCABULARY_ENTRIES_PER_TYPE = 1_000;
export const VOCABULARY_READ_ACCESS = VOCABULARY_USER_ACCESS;

export interface ActiveVocabularySource {
  carriers: readonly { id: string; name: string }[];
  mgas: readonly { id: string; name: string }[];
  officeLocations: readonly { id: string; name: string }[];
  policyTypes: readonly {
    classTag: PolicyTypeClass;
    id: string;
    name: string;
  }[];
}

const vocabularySelection = {
  id: carriers.id,
  name: carriers.name,
};

export async function loadActiveVocabulary(
  database: AuthDatabase,
): Promise<ActiveVocabularySource> {
  const [carrierRows, mgaRows, officeRows, policyTypeRows] = await Promise.all([
    database
      .select(vocabularySelection)
      .from(carriers)
      .where(eq(carriers.isActive, true))
      .orderBy(asc(sql`lower(${carriers.name})`), asc(carriers.id))
      .limit(MAX_ACTIVE_VOCABULARY_ENTRIES_PER_TYPE),
    database
      .select({ id: mgas.id, name: mgas.name })
      .from(mgas)
      .where(eq(mgas.isActive, true))
      .orderBy(asc(sql`lower(${mgas.name})`), asc(mgas.id))
      .limit(MAX_ACTIVE_VOCABULARY_ENTRIES_PER_TYPE),
    database
      .select({ id: officeLocations.id, name: officeLocations.name })
      .from(officeLocations)
      .where(eq(officeLocations.isActive, true))
      .orderBy(asc(sql`lower(${officeLocations.name})`), asc(officeLocations.id))
      .limit(MAX_ACTIVE_VOCABULARY_ENTRIES_PER_TYPE),
    database
      .select({
        classTag: policyTypes.classTag,
        id: policyTypes.id,
        name: policyTypes.name,
      })
      .from(policyTypes)
      .where(eq(policyTypes.isActive, true))
      .orderBy(asc(sql`lower(${policyTypes.name})`), asc(policyTypes.id))
      .limit(MAX_ACTIVE_VOCABULARY_ENTRIES_PER_TYPE),
  ]);

  return {
    carriers: carrierRows,
    mgas: mgaRows,
    officeLocations: officeRows,
    policyTypes: policyTypeRows,
  };
}

export function projectActiveVocabulary(
  source: Readonly<ActiveVocabularySource>,
  context: AuthorizedRequestContext,
): ActiveVocabularyResponse | null {
  if (!evaluateAccess(context.principal, VOCABULARY_READ_ACCESS).allowed) {
    return null;
  }

  return {
    carriers: source.carriers.map(({ id, name }) => ({ id, name })),
    mgas: source.mgas.map(({ id, name }) => ({ id, name })),
    officeLocations: source.officeLocations.map(({ id, name }) => ({
      id,
      name,
    })),
    policyTypes: source.policyTypes.map(({ classTag, id, name }) => ({
      classTag,
      id,
      name,
    })),
  };
}
