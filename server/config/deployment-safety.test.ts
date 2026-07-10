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
  const packageJson = readRepositoryFile("package.json");

  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^EXPOSE 5000$/m);
  assert.match(dockerfile, /^CMD \["npm", "run", "start"\]$/m);
  assert.match(packageJson, /"start": "node --import tsx server\/index\.ts"/);
  assert.doesNotMatch(dockerfile, /DATABASE_URL\s*=/);
  assert.doesNotMatch(dockerfile, /SESSION_SECRET\s*=/);
  assert.doesNotMatch(dockerfile, /npm", "run", "dev/);
});

test("local Compose keeps Postgres separate and addresses it by service name", () => {
  const compose = readRepositoryFile("docker-compose.yml");

  assert.match(compose, /^  app:$/m);
  assert.match(compose, /^  db:$/m);
  assert.match(compose, /DATABASE_URL: postgresql:\/\/wcib:[^@]+@db:5432\/wcib/);
  assert.match(compose, /image: postgres:18-alpine/);
  assert.match(compose, /command: npm run dev/);
  assert.doesNotMatch(compose, /private-.*\.ondigitalocean\.com/);
});

test("production Compose is app-only by default and keeps the API private", () => {
  const compose = readRepositoryFile("docker-compose.production.yml");

  assert.match(compose, /^  app:$/m);
  assert.doesNotMatch(compose, /^  db:$/m);
  assert.doesNotMatch(compose, /postgres:18/);
  assert.match(compose, /"127\.0\.0\.1:5000:5000"/);
  assert.match(compose, /\/etc\/wcib-dashboard\/app\.env/);
  assert.match(
    compose,
    /\/etc\/wcib-dashboard\/digitalocean-postgres-ca\.crt:\/run\/secrets\/digitalocean-postgres-ca\.crt:ro/,
  );
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\n\s+- ALL/);
  assert.match(compose, /fetch\('http:\/\/127\.0\.0\.1:5000\/health'\)/);
});

test("Caddy ingress is explicit, dormant, and proxies only to the app service", () => {
  const compose = readRepositoryFile("docker-compose.production.yml");
  const caddyfile = readRepositoryFile("deploy/Caddyfile");

  assert.match(compose, /^  caddy:$/m);
  assert.match(
    compose,
    /image: caddy:2\.10\.2-alpine@sha256:[a-f0-9]{64}/,
  );
  assert.match(compose, /profiles:\n\s+- ingress/);
  assert.match(compose, /WCIB_HOSTNAME: \$\{WCIB_HOSTNAME:-\}/);
  assert.match(caddyfile, /^\{\$WCIB_HOSTNAME\} \{/m);
  assert.match(caddyfile, /reverse_proxy app:5000/);
  assert.doesNotMatch(caddyfile, /DATABASE_URL|SESSION_SECRET|:5432/);
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
  assert.match(runbook, /CA certificate is a public trust anchor/);
  assert.match(runbook, /`0644 root:root`/);
});
