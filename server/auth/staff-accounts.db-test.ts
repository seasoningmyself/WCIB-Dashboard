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
import { createUser } from "./users.js";

const roster = [
  { displayName: "Kaylee", pronoun: "her", role: "producer" },
  { displayName: "Mercedes", pronoun: "their", role: "employee" },
  { displayName: "Daniela", pronoun: "their", role: "employee" },
  { displayName: "Joseph", pronoun: "their", role: "employee" },
  { displayName: "Ellyscia", pronoun: "their", role: "employee" },
] as const;

test("staff and capabilities represent the approved account shapes", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the staff model smoke test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  const runId = randomUUID();
  const userIds: string[] = [];

  try {
    const staffAccounts = [];
    for (const member of roster) {
      const account = await createUser(database, {
        email: `${member.displayName.toLowerCase()}.${runId}@example.test`,
        password: "StrongPass123!",
      });
      userIds.push(account.id);
      staffAccounts.push({ ...member, userId: account.id });
    }

    const sophia = await createUser(database, {
      email: `sophia.${runId}@example.test`,
      password: "StrongPass123!",
    });
    userIds.push(sophia.id);

    await database.insert(staffProfiles).values(staffAccounts);
    await database.insert(userCapabilities).values({
      capability: "admin",
      userId: sophia.id,
    });

    const staff = await database
      .select()
      .from(staffProfiles)
      .where(inArray(staffProfiles.userId, userIds));
    assert.equal(staff.length, 5);
    assert.equal(staff.filter((member) => member.role === "producer").length, 1);
    assert.equal(staff.filter((member) => member.role === "employee").length, 4);

    const [sophiaAccess] = await database
      .select({
        capability: userCapabilities.capability,
        hasStaffProfile: staffProfiles.userId,
        isActive: userCapabilities.isActive,
      })
      .from(userCapabilities)
      .leftJoin(
        staffProfiles,
        eq(userCapabilities.userId, staffProfiles.userId),
      )
      .where(
        and(
          eq(userCapabilities.userId, sophia.id),
          eq(userCapabilities.capability, "admin"),
        ),
      );
    assert.deepEqual(sophiaAccess, {
      capability: "admin",
      hasStaffProfile: null,
      isActive: true,
    });

    await database
      .update(userCapabilities)
      .set({ isActive: false })
      .where(
        and(
          eq(userCapabilities.userId, sophia.id),
          eq(userCapabilities.capability, "admin"),
        ),
      );
    const [inactiveCapability] = await database
      .select({ isActive: userCapabilities.isActive })
      .from(userCapabilities)
      .where(
        and(
          eq(userCapabilities.userId, sophia.id),
          eq(userCapabilities.capability, "admin"),
        ),
      );
    assert.equal(inactiveCapability?.isActive, false);

    const mercedesId = staffAccounts.find(
      (member) => member.displayName === "Mercedes",
    )?.userId;
    const danielaId = staffAccounts.find(
      (member) => member.displayName === "Daniela",
    )?.userId;
    assert.ok(mercedesId);
    assert.ok(danielaId);

    await database
      .update(staffProfiles)
      .set({ isActive: false })
      .where(eq(staffProfiles.userId, mercedesId));
    await database
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, danielaId));

    const [inactiveStaff] = await database
      .select({ isActive: staffProfiles.isActive })
      .from(staffProfiles)
      .where(eq(staffProfiles.userId, mercedesId));
    const [inactiveUser] = await database
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, danielaId));
    assert.equal(inactiveStaff?.isActive, false);
    assert.equal(inactiveUser?.isActive, false);
  } finally {
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
