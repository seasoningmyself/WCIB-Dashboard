import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPolicyCorrectionReplacement } from "./correction-values.js";

test("correction values retain only explicitly selected fields", () => {
  assert.deepEqual(
    buildPolicyCorrectionReplacement(
      {
        commissionAmount: "999.00",
        financeContact: { email: "private@example.test" },
        insuredName: "Corrected Name",
      },
      ["insuredName", "financeContact"],
    ),
    {
      financeContact: { email: "private@example.test" },
      insuredName: "Corrected Name",
    },
  );
});

test("correction values reject unsafe, duplicate, and unbounded selections", () => {
  assert.throws(
    () => buildPolicyCorrectionReplacement({}, []),
    /unique non-empty allowlist/,
  );
  assert.throws(
    () =>
      buildPolicyCorrectionReplacement(
        { insuredName: "Name" },
        ["insuredName", "insuredName"],
      ),
    /unique non-empty allowlist/,
  );
  assert.throws(
    () =>
      buildPolicyCorrectionReplacement(
        { commissionAmount: "1.00" },
        ["commissionAmount" as never],
      ),
    /unique non-empty allowlist/,
  );
  assert.throws(
    () =>
      buildPolicyCorrectionReplacement(
        { insuredName: undefined },
        ["insuredName"],
      ),
    /field is missing/,
  );
  assert.throws(
    () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      buildPolicyCorrectionReplacement(
        { financeMeta: circular },
        ["financeMeta"],
      );
    },
    /JSON serializable/,
  );
  assert.throws(
    () =>
      buildPolicyCorrectionReplacement(
        { notes: "x".repeat(17_000) },
        ["notes"],
      ),
    /byte limit/,
  );
});
