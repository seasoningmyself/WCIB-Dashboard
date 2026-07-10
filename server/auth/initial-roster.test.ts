import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INITIAL_ROSTER,
  INITIAL_ROSTER_ENV,
  formatInitialRosterSeedError,
  formatInitialRosterSeedResult,
  parseInitialRosterCredentials,
} from "./initial-roster.js";

function credentialsJson(
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    daniela: {
      email: "daniela@example.test",
      password: "DanielaPass3!",
    },
    ellyscia: {
      email: "ellyscia@example.test",
      password: "EllysciaPass4!",
    },
    joseph: {
      email: "joseph@example.test",
      password: "JosephPass5!",
    },
    kaylee: {
      email: "  KAYLEE@EXAMPLE.TEST ",
      password: "KayleePass1!",
    },
    mercedes: {
      email: "mercedes@example.test",
      password: "MercedesPass2!",
    },
    sophia: {
      email: "sophia@example.test",
      password: "SophiaPass6!",
    },
    ...overrides,
  });
}

test("initial roster is fixed to the approved account shapes", () => {
  assert.deepEqual(INITIAL_ROSTER, [
    {
      displayName: "Kaylee",
      key: "kaylee",
      staff: { pronoun: "her", role: "producer" },
    },
    {
      displayName: "Mercedes",
      key: "mercedes",
      staff: { pronoun: "their", role: "employee" },
    },
    {
      displayName: "Daniela",
      key: "daniela",
      staff: { pronoun: "their", role: "employee" },
    },
    {
      displayName: "Joseph",
      key: "joseph",
      staff: { pronoun: "their", role: "employee" },
    },
    {
      displayName: "Ellyscia",
      key: "ellyscia",
      staff: { pronoun: "their", role: "employee" },
    },
    { capability: "admin", displayName: "Sophia", key: "sophia" },
  ]);
});

test("seed credentials normalize emails and require unique secure values", () => {
  const credentials = parseInitialRosterCredentials(credentialsJson());

  assert.equal(credentials.kaylee.email, "kaylee@example.test");
  assert.equal(credentials.kaylee.password, "KayleePass1!");
  assert.throws(
    () => parseInitialRosterCredentials(undefined),
    new RegExp(`${INITIAL_ROSTER_ENV} is required`),
  );
  assert.throws(
    () => parseInitialRosterCredentials("not-json"),
    new RegExp(`${INITIAL_ROSTER_ENV} must be valid JSON`),
  );
  assert.throws(
    () =>
      parseInitialRosterCredentials(
        credentialsJson({
          sophia: {
            email: "kaylee@example.test",
            password: "KayleePass1!",
          },
        }),
      ),
    /unique email.*unique temporary password/s,
  );
  assert.throws(
    () =>
      parseInitialRosterCredentials(
        credentialsJson({
          sophia: { email: "sophia@example.test", password: "weak" },
        }),
      ),
    /Password must be at least 12 characters/,
  );
});

test("seed result and unexpected errors never expose credentials", () => {
  const output = formatInitialRosterSeedResult({
    capabilities: { created: 1, skipped: 0 },
    staffProfiles: { created: 5, skipped: 0 },
    users: { created: 6, skipped: 0 },
  });
  const error = formatInitialRosterSeedError(
    new Error("sophia@example.test / SophiaPass6!"),
  );

  assert.equal(
    output,
    "users created 6, skipped 0; staff profiles created 5, skipped 0; capabilities created 1, skipped 0",
  );
  assert.equal(error, "Initial roster seed failed");
  assert.equal(output.includes("example.test"), false);
  assert.equal(error.includes("SophiaPass6!"), false);
});
