import type { AdminStaffRecord } from "../../../shared/admin-staff.js";

export function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

export function staffFixture(
  overrides: Partial<AdminStaffRecord> = {},
): AdminStaffRecord {
  return {
    createdAt: "2026-01-02T12:00:00.000Z",
    displayName: "Kaylee Producer",
    email: "kaylee@example.test",
    isActive: true,
    rateState: "configured",
    rates: [
      {
        createdAt: "2026-01-01T12:00:00.000Z",
        effectiveDate: "2026-01-01",
        id: uuid(11),
        lockedAt: "2026-06-30T23:59:59.000Z",
        newBrokerRate: "20.00",
        newCommissionRate: "25.00",
        renewalBrokerRate: "30.00",
        renewalCommissionRate: "35.00",
        updatedAt: "2026-01-01T12:00:00.000Z",
      },
      {
        createdAt: "2026-07-01T12:00:00.000Z",
        effectiveDate: "2026-07-01",
        id: uuid(12),
        lockedAt: null,
        newBrokerRate: "21.00",
        newCommissionRate: "26.00",
        renewalBrokerRate: "31.00",
        renewalCommissionRate: "36.00",
        updatedAt: "2026-07-01T12:00:00.000Z",
      },
    ],
    role: "producer",
    userId: uuid(1),
    ...overrides,
  };
}

export function employeeFixture(
  overrides: Partial<AdminStaffRecord> = {},
): AdminStaffRecord {
  return staffFixture({
    displayName: "Mercedes Employee",
    email: "mercedes@example.test",
    rateState: "not_applicable",
    rates: [],
    role: "employee",
    userId: uuid(2),
    ...overrides,
  });
}
