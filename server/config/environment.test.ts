import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { loadConfig } from "./environment.js";

const SAFE_SESSION_SECRET = "vN8#sJ2!qL6@wR4$zT9%yU3&kP7*mD5+";

test("loadConfig reads an environment-driven database target", () => {
  const databaseUrl =
    "postgresql://wcib:secret@managed-postgres.example:25060/wcib";
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    NODE_ENV: "development",
    PORT: "8080",
    SESSION_SECRET: SAFE_SESSION_SECRET,
  });

  assert.deepEqual(config, {
    databaseUrl,
    nodeEnv: "development",
    port: 8080,
    sessionSecret: SAFE_SESSION_SECRET,
  });
  assert.ok(Object.isFrozen(config));
});

test("loadConfig reports missing required values without printing secrets", () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: "development" }),
    new Error("DATABASE_URL is required"),
  );
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL: "postgresql://wcib:secret@db:5432/wcib",
        NODE_ENV: "development",
      }),
    new Error("SESSION_SECRET is required"),
  );
});

test("loadConfig validates database and port formats", () => {
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL: "https://example.com/wcib",
        NODE_ENV: "development",
        SESSION_SECRET: SAFE_SESSION_SECRET,
      }),
    /valid PostgreSQL connection string/,
  );
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL: "postgresql://wcib:secret@db:5432/wcib",
        NODE_ENV: "development",
        PORT: "5000abc",
        SESSION_SECRET: SAFE_SESSION_SECRET,
      }),
    /PORT must be an integer between 1 and 65535/,
  );
});

test("production refuses an example session secret", () => {
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL: "postgresql://wcib:secret@managed.example:25060/wcib",
        NODE_ENV: "production",
        SESSION_SECRET: "local-development-only-change-before-production",
      }),
    /must not use an example value in production/,
  );
});

test("backend startup fails clearly when required config is missing", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      encoding: "utf8",
      env: {
        NODE_ENV: "development",
        PATH: process.env.PATH,
        SESSION_SECRET: SAFE_SESSION_SECRET,
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL is required/);
  assert.equal(result.stderr.includes(SAFE_SESSION_SECRET), false);
});
