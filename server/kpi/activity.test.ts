import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import {
  projectAdminKpiRecentActivitySource,
  type KpiRecentActivitySource,
} from "./activity.js";

const source: KpiRecentActivitySource = {
  activities: [
    {
      actionType: "policy_approved",
      actorDisplayName: "Sophia Nguyen",
      occurredAt: new Date("2026-07-23T12:00:00.000Z"),
      targetReference: "Policy WCIB-1001",
    },
  ],
};

test("recent KPI activity projection allows only administrators", () => {
  assert.deepEqual(
    projectAdminKpiRecentActivitySource(source, context(["admin"], null)),
    {
      activities: [
        {
          actionType: "policy_approved",
          actorDisplayName: "Sophia Nguyen",
          occurredAt: "2026-07-23T12:00:00.000Z",
          targetReference: "Policy WCIB-1001",
        },
      ],
    },
  );
  assert.equal(
    projectAdminKpiRecentActivitySource(
      source,
      context(["support_engineer"], null),
    ),
    null,
  );
  assert.equal(
    projectAdminKpiRecentActivitySource(source, context([], "producer")),
    null,
  );
  assert.equal(
    projectAdminKpiRecentActivitySource(source, context([], "employee")),
    null,
  );
});

function context(
  capabilities: AuthorizedRequestContext["principal"]["capabilities"],
  staffRole: AuthorizedRequestContext["principal"]["staffRole"],
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities,
      staffRole,
      userActive: true,
      userId: "00000000-0000-4000-8000-000000000001",
    },
  } as AuthorizedRequestContext;
}
