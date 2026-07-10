import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDatabaseConnection,
  formatDatabaseConnectionError,
  type DatabaseQueryable,
} from "./client.js";

test("checkDatabaseConnection accepts the select-one response", async () => {
  const database: DatabaseQueryable = {
    async query<Row>() {
      return { rows: [{ connected: 1 } as Row] };
    },
  };

  await assert.doesNotReject(checkDatabaseConnection(database));
});

test("checkDatabaseConnection rejects an unexpected response", async () => {
  const database: DatabaseQueryable = {
    async query<Row>() {
      return { rows: [] as Row[] };
    },
  };

  await assert.rejects(
    checkDatabaseConnection(database),
    /Database connection check returned an unexpected result/,
  );
});

test("formatDatabaseConnectionError omits credentials", () => {
  const error = Object.assign(
    new Error("password authentication failed for secret-password"),
    { code: "28P01" },
  );

  assert.equal(
    formatDatabaseConnectionError(error),
    "Database connection failed (28P01)",
  );
});
