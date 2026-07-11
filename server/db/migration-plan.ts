import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const statementBreakpoint = "--> statement-breakpoint";

interface MigrationJournal {
  dialect: string;
  entries: MigrationJournalEntry[];
}

interface MigrationJournalEntry {
  breakpoints: boolean;
  idx: number;
  tag: string;
  version: string;
  when: number;
}

export interface MigrationPlanEntry {
  backoutPath: string;
  backoutStatements: string[];
  forwardHash: string;
  forwardPath: string;
  forwardStatements: string[];
  idx: number;
  tag: string;
  when: number;
}

const nontransactionalPatterns = [
  /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i,
  /\bDROP\s+INDEX\s+CONCURRENTLY\b/i,
  /\bREINDEX\b[\s\S]*\bCONCURRENTLY\b/i,
  /\bALTER\s+TYPE\b[\s\S]*\bADD\s+VALUE\b/i,
  /\bVACUUM\b/i,
  /\bCREATE\s+DATABASE\b/i,
  /\bDROP\s+DATABASE\b/i,
];

function splitStatements(source: string): string[] {
  return source
    .split(statementBreakpoint)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export function findNontransactionalStatement(
  statements: readonly string[],
): string | undefined {
  return statements.find((statement) =>
    nontransactionalPatterns.some((pattern) => pattern.test(statement)),
  );
}

export function loadMigrationPlan(
  migrationsFolder = resolve(process.cwd(), "drizzle"),
): MigrationPlanEntry[] {
  const journalPath = resolve(migrationsFolder, "meta/_journal.json");
  const journal = JSON.parse(
    readFileSync(journalPath, "utf8"),
  ) as MigrationJournal;

  if (journal.dialect !== "postgresql") {
    throw new Error("Migration safety verification requires PostgreSQL");
  }

  return journal.entries.map((entry, position) => {
    if (entry.idx !== position || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag)) {
      throw new Error(`Invalid migration journal entry at position ${position}`);
    }

    const forwardPath = resolve(migrationsFolder, `${entry.tag}.sql`);
    const backoutPath = resolve(
      migrationsFolder,
      "backout",
      `${entry.tag}.sql`,
    );
    if (!existsSync(forwardPath) || !existsSync(backoutPath)) {
      throw new Error(`Migration ${entry.tag} needs forward and backout SQL`);
    }

    const forwardSource = readFileSync(forwardPath, "utf8");
    const backoutSource = readFileSync(backoutPath, "utf8");
    const forwardStatements = splitStatements(forwardSource);
    const backoutStatements = splitStatements(backoutSource);
    if (forwardStatements.length === 0 || backoutStatements.length === 0) {
      throw new Error(`Migration ${entry.tag} has an empty direction`);
    }

    return {
      backoutPath,
      backoutStatements,
      forwardHash: createHash("sha256").update(forwardSource).digest("hex"),
      forwardPath,
      forwardStatements,
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
    };
  });
}

export function assertMigrationPlanIsTransactional(
  plan: readonly MigrationPlanEntry[],
): void {
  for (const entry of plan) {
    const unsafeForward = findNontransactionalStatement(entry.forwardStatements);
    const unsafeBackout = findNontransactionalStatement(entry.backoutStatements);
    if (unsafeForward !== undefined || unsafeBackout !== undefined) {
      throw new Error(
        `Migration ${entry.tag} contains SQL that needs a reviewed nontransactional recovery procedure`,
      );
    }
  }
}
