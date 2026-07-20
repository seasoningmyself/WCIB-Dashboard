import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as databaseSchema from "../db/schema.js";
import {
  staffProfiles,
  userCapabilities,
  users,
} from "../db/schema.js";
import { evaluateAccess } from "./access.js";
import { loadAccessPrincipal } from "./access-repository.js";
import { createUser } from "./users.js";

test("database access lookup composes roles and capabilities", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the access model smoke test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  const runId = randomUUID();
  const userIds: string[] = [];

  try {
    const employee = await createUser(database, {
      displayName: "Employee Test",
      email: `employee.${runId}@example.test`,
      password: "StrongPass123!",
    });
    const producer = await createUser(database, {
      displayName: "Producer Test",
      email: `producer.${runId}@example.test`,
      password: "StrongPass123!",
    });
    const admin = await createUser(database, {
      email: `admin.${runId}@example.test`,
      password: "StrongPass123!",
    });
    userIds.push(employee.id, producer.id, admin.id);

    await database.insert(staffProfiles).values([
      { role: "employee", userId: employee.id },
      { role: "producer", userId: producer.id },
    ]);
    await database.insert(userCapabilities).values([
      { capability: "future_permission", userId: producer.id },
      { capability: "admin", userId: admin.id },
    ]);

    const employeeAccess = await loadAccessPrincipal(database, employee.id);
    const producerAccess = await loadAccessPrincipal(database, producer.id);
    const adminAccess = await loadAccessPrincipal(database, admin.id);
    assert.ok(employeeAccess);
    assert.ok(producerAccess);
    assert.ok(adminAccess);

    assert.deepEqual(evaluateAccess(employeeAccess, { staffRoles: ["employee"] }), {
      allowed: true,
    });
    assert.deepEqual(evaluateAccess(producerAccess, { staffRoles: ["producer"] }), {
      allowed: true,
    });
    assert.deepEqual(producerAccess.capabilities, []);
    assert.deepEqual(evaluateAccess(producerAccess, { capabilities: ["admin"] }), {
      allowed: false,
      reason: "missing_required_access",
    });
    assert.equal(adminAccess.staffRole, null);
    assert.deepEqual(evaluateAccess(adminAccess, { capabilities: ["admin"] }), {
      allowed: true,
    });

    await database
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, employee.id));
    const inactiveEmployee = await loadAccessPrincipal(database, employee.id);
    assert.ok(inactiveEmployee);
    assert.deepEqual(
      evaluateAccess(inactiveEmployee, { staffRoles: ["employee"] }),
      { allowed: false, reason: "inactive_user" },
    );

    assert.equal(await loadAccessPrincipal(database, randomUUID()), null);
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
