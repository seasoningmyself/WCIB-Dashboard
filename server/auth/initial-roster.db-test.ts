import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as databaseSchema from "../db/schema.js";
import {
  staffProfiles,
  userCapabilities,
  users,
} from "../db/schema.js";
import { loadAccessPrincipal } from "./access-repository.js";
import { evaluateAccess } from "./access.js";
import {
  INITIAL_ROSTER,
  parseInitialRosterCredentials,
  seedInitialRoster,
} from "./initial-roster.js";

test("initial roster seed is idempotent and matches WCIB access", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the roster seed test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  const runId = randomUUID();
  const credentials = parseInitialRosterCredentials(
    JSON.stringify({
      daniela: {
        email: `daniela.${runId}@example.test`,
        password: `Daniela-${runId}-3!`,
      },
      ellyscia: {
        email: `ellyscia.${runId}@example.test`,
        password: `Ellyscia-${runId}-4!`,
      },
      joseph: {
        email: `joseph.${runId}@example.test`,
        password: `Joseph-${runId}-5!`,
      },
      kaylee: {
        email: `kaylee.${runId}@example.test`,
        password: `Kaylee-${runId}-1!`,
      },
      mercedes: {
        email: `mercedes.${runId}@example.test`,
        password: `Mercedes-${runId}-2!`,
      },
      sophia: {
        email: `sophia.${runId}@example.test`,
        password: `Sophia-${runId}-6!`,
      },
    }),
  );
  const emails = INITIAL_ROSTER.map(
    (member) => credentials[member.key].email,
  );

  try {
    const first = await seedInitialRoster(database, credentials);
    assert.deepEqual(first, {
      capabilities: { created: 1, skipped: 0 },
      staffProfiles: { created: 5, skipped: 0 },
      users: { created: 6, skipped: 0 },
    });

    const firstUsers = await database
      .select({
        email: users.email,
        id: users.id,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(inArray(users.email, emails));
    assert.equal(firstUsers.length, 6);
    const firstHashes = new Map(
      firstUsers.map((user) => [user.email, user.passwordHash]),
    );

    const second = await seedInitialRoster(database, credentials);
    assert.deepEqual(second, {
      capabilities: { created: 0, skipped: 1 },
      staffProfiles: { created: 0, skipped: 5 },
      users: { created: 0, skipped: 6 },
    });

    const secondUsers = await database
      .select({
        email: users.email,
        id: users.id,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(inArray(users.email, emails));
    assert.equal(secondUsers.length, 6);
    for (const user of secondUsers) {
      assert.match(user.id, /^[0-9a-f-]{36}$/);
      assert.equal(user.passwordHash, firstHashes.get(user.email));
    }

    const usersByEmail = new Map(secondUsers.map((user) => [user.email, user]));
    const staffUserIds = INITIAL_ROSTER.filter(
      (member) => "staff" in member,
    ).map((member) => usersByEmail.get(credentials[member.key].email)?.id);
    assert.equal(staffUserIds.every((userId) => userId !== undefined), true);
    const staff = await database
      .select({
        displayName: staffProfiles.displayName,
        role: staffProfiles.role,
        userId: staffProfiles.userId,
      })
      .from(staffProfiles)
      .where(inArray(staffProfiles.userId, staffUserIds as string[]));
    assert.deepEqual(
      staff
        .map(({ displayName, role }) => ({
          displayName,
          role,
        }))
        .sort((left, right) => left.displayName.localeCompare(right.displayName)),
      [
        { displayName: "Daniela", role: "employee" },
        { displayName: "Ellyscia", role: "employee" },
        { displayName: "Joseph", role: "employee" },
        { displayName: "Kaylee", role: "producer" },
        { displayName: "Mercedes", role: "employee" },
      ],
    );

    for (const member of INITIAL_ROSTER) {
      const user = usersByEmail.get(credentials[member.key].email);
      assert.ok(user);
      const principal = await loadAccessPrincipal(database, user.id);
      assert.ok(principal);
      if ("staff" in member) {
        assert.equal(principal.staffRole, member.staff.role);
        assert.deepEqual(principal.capabilities, []);
        assert.deepEqual(
          evaluateAccess(principal, { staffRoles: [member.staff.role] }),
          { allowed: true },
        );
      } else {
        assert.equal(principal.staffRole, null);
        assert.deepEqual(principal.capabilities, ["admin"]);
        assert.deepEqual(
          evaluateAccess(principal, { capabilities: ["admin"] }),
          { allowed: true },
        );
      }
    }

    const sophiaId = usersByEmail.get(credentials.sophia.email)?.id;
    assert.ok(sophiaId);
    const [sophiaStaff] = await database
      .select({ userId: staffProfiles.userId })
      .from(staffProfiles)
      .where(eq(staffProfiles.userId, sophiaId));
    const [sophiaAdmin] = await database
      .select({ isActive: userCapabilities.isActive })
      .from(userCapabilities)
      .where(
        and(
          eq(userCapabilities.userId, sophiaId),
          eq(userCapabilities.capability, "admin"),
        ),
      );
    assert.equal(sophiaStaff, undefined);
    assert.deepEqual(sophiaAdmin, { isActive: true });

    await database
      .update(userCapabilities)
      .set({ isActive: false })
      .where(
        and(
          eq(userCapabilities.userId, sophiaId),
          eq(userCapabilities.capability, "admin"),
        ),
      );
    await assert.rejects(
      () => seedInitialRoster(database, credentials),
      /admin capability is disabled and will not be reactivated by seed/,
    );
    const [stillDisabled] = await database
      .select({ isActive: userCapabilities.isActive })
      .from(userCapabilities)
      .where(
        and(
          eq(userCapabilities.userId, sophiaId),
          eq(userCapabilities.capability, "admin"),
        ),
      );
    assert.deepEqual(stillDisabled, { isActive: false });
  } finally {
    const seededUsers = await database
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, emails));
    const userIds = seededUsers.map((user) => user.id);
    if (userIds.length > 0) {
      await database
        .delete(userCapabilities)
        .where(inArray(userCapabilities.userId, userIds));
      await database
        .delete(staffProfiles)
        .where(inArray(staffProfiles.userId, userIds));
      await database.delete(users).where(inArray(users.id, userIds));
    }
    await pool.end();
  }
});
