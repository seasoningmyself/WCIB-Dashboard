import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminStaffRecordSchema,
  createAdminStaffRequestSchema,
  producerRateInputSchema,
  updateAdminStaffRequestSchema,
} from "./admin-staff.js";

const rate = {
  effectiveDate: "2026-07-01",
  newBrokerRate: "15.00",
  newCommissionRate: "25.00",
  renewalBrokerRate: "10.00",
  renewalCommissionRate: "20.00",
};

test("admin staff creation requires explicit producer rates and write-only secrets", () => {
  assert.equal(
    createAdminStaffRequestSchema.safeParse({
      displayName: "Producer",
      email: "producer@example.test",
      role: "producer",
      temporaryPassword: "StrongPass123!",
    }).success,
    false,
  );
  assert.equal(
    createAdminStaffRequestSchema.safeParse({
      displayName: "Employee",
      email: "employee@example.test",
      initialRate: rate,
      role: "employee",
      temporaryPassword: "StrongPass123!",
    }).success,
    false,
  );
  const producer = createAdminStaffRequestSchema.parse({
    displayName: "Producer",
    email: "PRODUCER@EXAMPLE.TEST",
    initialRate: rate,
    role: "producer",
    temporaryPassword: "StrongPass123!",
  });
  assert.equal(producer.email, "producer@example.test");
  assert.equal("temporaryPassword" in adminStaffRecordSchema.shape, false);
  assert.equal(
    createAdminStaffRequestSchema.safeParse({
      displayName: "Legacy Pronoun",
      email: "legacy@example.test",
      pronoun: "their",
      role: "employee",
      temporaryPassword: "StrongPass123!",
    }).success,
    false,
  );
});

test("rate and staff update allowlists reject malformed or empty input", () => {
  assert.equal(
    producerRateInputSchema.safeParse({ ...rate, newBrokerRate: "100.01" })
      .success,
    false,
  );
  assert.equal(updateAdminStaffRequestSchema.safeParse({}).success, false);
  assert.equal(
    updateAdminStaffRequestSchema.safeParse({ isActive: false }).success,
    false,
  );
  assert.equal(
    updateAdminStaffRequestSchema.safeParse({ displayName: " Updated " })
      .success,
    true,
  );
});
