import assert from "node:assert/strict";
import { test } from "node:test";
import { readPostgresUrl } from "./postgres-url.js";

test("readPostgresUrl accepts PostgreSQL connection strings", () => {
  assert.equal(
    readPostgresUrl(
      "DATABASE_URL",
      " postgresql://wcib:secret@db:5432/wcib ",
    ),
    "postgresql://wcib:secret@db:5432/wcib",
  );
});

test("readPostgresUrl reports the variable without exposing its value", () => {
  const secretUrl = "https://wcib:do-not-log@example.com/wcib";

  assert.throws(
    () => readPostgresUrl("DATABASE_URL", secretUrl),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /DATABASE_URL must be a valid PostgreSQL/);
      assert.equal(error.message.includes(secretUrl), false);
      return true;
    },
  );
});
