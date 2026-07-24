import assert from "node:assert/strict";
import { test } from "node:test";
import {
  KPI_RECENT_ACTIVITY_LIMIT,
  kpiRecentActivityResponseSchema,
} from "./kpi-activity.js";

test("recent KPI activity exposes only the bounded diagnostic contract", () => {
  const parsed = kpiRecentActivityResponseSchema.parse({
    activities: [
      {
        actionType: "policy_approved",
        actorDisplayName: "Sophia Nguyen",
        occurredAt: new Date("2026-07-23T12:00:00.000Z"),
        targetReference: "Policy WCIB-1001",
      },
    ],
  });

  assert.deepEqual(parsed, {
    activities: [
      {
        actionType: "policy_approved",
        actorDisplayName: "Sophia Nguyen",
        occurredAt: "2026-07-23T12:00:00.000Z",
        targetReference: "Policy WCIB-1001",
      },
    ],
  });
  assert.equal(
    kpiRecentActivityResponseSchema.safeParse({
      activities: [
        {
          actionType: "policy_approved",
          actorDisplayName: "Sophia Nguyen",
          amount: "1250.00",
          occurredAt: "2026-07-23T12:00:00.000Z",
          targetReference: "Policy WCIB-1001",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    kpiRecentActivityResponseSchema.safeParse({
      activities: Array.from(
        { length: KPI_RECENT_ACTIVITY_LIMIT + 1 },
        (_, index) => ({
          actionType: "pay_sheet_closed",
          actorDisplayName: "Sophia Nguyen",
          occurredAt: "2026-07-23T12:00:00.000Z",
          targetReference: `Pay sheet ${index + 1}`,
        }),
      ),
    }).success,
    false,
  );
});
