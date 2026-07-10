import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_AUDIT_SUMMARY_FIELDS } from "../../shared/audit-events.js";
import { projectAuditSummary } from "./summary.js";

test("audit summaries include only explicitly allowed scalar fields", () => {
  const summary = projectAuditSummary(
    {
      passwordHash: "must-not-appear",
      policyId: "5ca2922f-488d-4f65-af23-0bca691086d8",
      status: "closed",
    },
    ["policyId", "status"],
  );

  assert.deepEqual(summary, {
    policyId: "5ca2922f-488d-4f65-af23-0bca691086d8",
    status: "closed",
  });
  assert.equal("passwordHash" in summary, false);
  assert.equal(Object.isFrozen(summary), true);
});

test("audit summaries reject unsafe allowlists and unbounded values", () => {
  assert.throws(
    () => projectAuditSummary({ sessionToken: "secret" }, ["sessionToken"]),
    /field is forbidden/,
  );
  assert.throws(
    () => projectAuditSummary({ payload: { amount: "1.00" } }, ["payload"]),
    /must be scalar/,
  );
  assert.throws(
    () => projectAuditSummary({ reason: "x".repeat(501) }, ["reason"]),
    /too long/,
  );
  assert.throws(
    () =>
      projectAuditSummary(
        {},
        Array.from({ length: MAX_AUDIT_SUMMARY_FIELDS + 1 }, (_, index) =>
          `field${index}`,
        ),
      ),
    /allowlist exceeds/,
  );
});
