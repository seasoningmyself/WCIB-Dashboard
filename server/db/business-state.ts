import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export function inActiveBusinessGeneration(
  generationColumn: AnyPgColumn,
): SQL {
  return sql`${generationColumn} = current_business_state_generation_id()`;
}
