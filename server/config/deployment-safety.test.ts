import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

function readRepositoryFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("local secrets stay outside Git and Docker image layers", () => {
  const dockerignore = readRepositoryFile(".dockerignore");

  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.match(dockerignore, /^\.secrets\/$/m);

  if (existsSync(resolve(process.cwd(), ".gitignore"))) {
    const gitignore = readRepositoryFile(".gitignore");
    assert.match(gitignore, /^\.env\.\*$/m);
    assert.match(gitignore, /^\.secrets\/$/m);
  }
});

test("the app image remains environment-driven and non-root", () => {
  const dockerfile = readRepositoryFile("Dockerfile");

  assert.match(dockerfile, /^USER node$/m);
  assert.doesNotMatch(dockerfile, /DATABASE_URL\s*=/);
  assert.doesNotMatch(dockerfile, /SESSION_SECRET\s*=/);
});

test("local Compose keeps Postgres separate and addresses it by service name", () => {
  const compose = readRepositoryFile("docker-compose.yml");

  assert.match(compose, /^  app:$/m);
  assert.match(compose, /^  db:$/m);
  assert.match(compose, /DATABASE_URL: postgresql:\/\/wcib:[^@]+@db:5432\/wcib/);
  assert.match(compose, /image: postgres:18-alpine/);
  assert.doesNotMatch(compose, /private-.*\.ondigitalocean\.com/);
});

test("the managed database runbook keeps runtime and migration roles separate", () => {
  const runbook = readRepositoryFile("docs/DIGITALOCEAN_INFRASTRUCTURE.md");

  assert.match(runbook, /GRANT CONNECT, CREATE ON DATABASE wcib TO wcib_migrator/);
  assert.match(runbook, /REVOKE CREATE ON DATABASE wcib FROM wcib_runtime/);
  assert.match(runbook, /REVOKE CREATE ON SCHEMA public FROM wcib_runtime/);
  assert.match(runbook, /ALTER DEFAULT PRIVILEGES IN SCHEMA public/);
  assert.match(runbook, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wcib_runtime/);
  assert.match(runbook, /GRANT USAGE ON TYPES TO wcib_runtime/);
  assert.match(runbook, /Neither role is a\s+PostgreSQL superuser/);
});
