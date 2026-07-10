import { randomUUID } from "node:crypto";
import pg from "pg";
import { applyMigrations } from "./migrate.js";

export async function withDisposableMigratedDatabase(
  sourceDatabaseUrl: string,
  namePrefix: string,
  action: (databaseUrl: string) => Promise<void>,
): Promise<void> {
  await withDisposableDatabase(sourceDatabaseUrl, namePrefix, async (databaseUrl) => {
    await applyMigrations(databaseUrl);
    await action(databaseUrl);
  });
}

export async function withDisposableDatabase(
  sourceDatabaseUrl: string,
  namePrefix: string,
  action: (databaseUrl: string) => Promise<void>,
): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,20}$/.test(namePrefix)) {
    throw new Error("Disposable database prefix is invalid");
  }
  const databaseName = `${namePrefix}_${randomUUID().replaceAll("-", "")}`;
  const targetUrl = new URL(sourceDatabaseUrl);
  targetUrl.pathname = `/${databaseName}`;
  const adminPool = new pg.Pool({ connectionString: sourceDatabaseUrl, max: 1 });
  let databaseCreated = false;

  try {
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    databaseCreated = true;
    await action(targetUrl.toString());
  } finally {
    try {
      if (databaseCreated) {
        await adminPool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      }
    } finally {
      await adminPool.end();
    }
  }
}
