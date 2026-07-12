import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { KpiTargetRecord } from "../db/schema.js";
import {
  KpiTargetAccessDeniedError,
  listKpiTargetSources,
  projectAdminKpiTargetListSource,
  projectAdminKpiTargetMutationSource,
} from "./targets.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";

test("KPI target projector returns only the explicit admin contract", () => {
  const target = targetRecord();
  const source = {
    items: [target],
    producers: [
      {
        displayName: "Kaylee",
        isActive: true,
        producerUserId: PRODUCER_ID,
      },
    ],
    year: 2026,
  };
  const projected = projectAdminKpiTargetListSource(source, adminContext());
  assert.ok(projected);
  assert.deepEqual(Object.keys(projected.items[0]!).sort(), [
    "newPolicyCountTarget",
    "newRevenueTarget",
    "producerUserId",
    "retentionRateTarget",
    "scopeType",
    "year",
  ]);
  const serialized = JSON.stringify(projected);
  for (const excluded of ["id", "createdAt", "updatedAt", "email", "rate"]) {
    assert.equal(serialized.includes(`\"${excluded}\"`), false);
  }
  assert.equal(
    projectAdminKpiTargetListSource(source, employeeContext()),
    null,
  );
  assert.deepEqual(
    projectAdminKpiTargetMutationSource({ target }, adminContext()),
    { target: projected.items[0] },
  );
  assert.equal(
    projectAdminKpiTargetMutationSource({ target }, employeeContext()),
    null,
  );
});

test("KPI target repository fails closed before touching storage", async () => {
  await assert.rejects(
    listKpiTargetSources({} as never, employeeContext(), { year: 2026 }),
    KpiTargetAccessDeniedError,
  );
});

function targetRecord(): KpiTargetRecord {
  return {
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    id: "00000000-0000-4000-8000-000000000003",
    newPolicyCountTarget: 12,
    newRevenueTarget: "150000.00",
    producerUserId: null,
    retentionRateTarget: "82.50",
    scopeType: "company",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    year: 2026,
  };
}

function adminContext(): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive: true,
      userId: ADMIN_ID,
    },
  };
}

function employeeContext(): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [],
      staffRole: "employee",
      userActive: true,
      userId: PRODUCER_ID,
    },
  };
}
