import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPolicyOverrideValuePair } from "./override-values.js";

test("override values retain only explicitly changed v15 financial fields", () => {
  const values = buildPolicyOverrideValuePair(
    {
      brokerFee: "50.00",
      commissionAmount: "100.00",
      insuredName: "Must not be copied",
      netDue: "200.00",
      passwordHash: "Must not be copied",
    },
    {
      brokerFee: "75.00",
      commissionAmount: "125.00",
      insuredName: "Must not be copied",
      netDue: "200.00",
      passwordHash: "Must not be copied",
    },
    ["brokerFee", "commissionAmount"],
  );

  assert.deepEqual(values, {
    originalValues: {
      brokerFee: "50.00",
      commissionAmount: "100.00",
    },
    replacementValues: {
      brokerFee: "75.00",
      commissionAmount: "125.00",
    },
  });
  assert.equal(JSON.stringify(values).includes("Must not be copied"), false);
  assert.equal(Object.isFrozen(values), true);
});

test("override values reject unsafe, missing, unchanged, and malformed fields", () => {
  assert.throws(
    () => buildPolicyOverrideValuePair({}, {}, []),
    /unique non-empty allowlist/,
  );
  assert.throws(
    () =>
      buildPolicyOverrideValuePair(
        { insuredName: "Private insured" },
        { insuredName: "Other insured" },
        ["insuredName" as never],
      ),
    /unique non-empty allowlist/,
  );
  assert.throws(
    () =>
      buildPolicyOverrideValuePair(
        { brokerFee: "1.00" },
        { brokerFee: "2.00" },
        ["brokerFee", "brokerFee"],
      ),
    /unique non-empty allowlist/,
  );
  assert.throws(
    () =>
      buildPolicyOverrideValuePair(
        { brokerFee: "1.00" },
        {},
        ["brokerFee"],
      ),
    /field is missing/,
  );
  assert.throws(
    () =>
      buildPolicyOverrideValuePair(
        { brokerFee: "1.00" },
        { brokerFee: "1.00" },
        ["brokerFee"],
      ),
    /did not change/,
  );
  assert.throws(
    () =>
      buildPolicyOverrideValuePair(
        { netDue: 1 },
        { netDue: 2 },
        ["netDue"],
      ),
    /must be a string/,
  );
  assert.throws(
    () =>
      buildPolicyOverrideValuePair(
        { commissionMode: "tbd" },
        { commissionMode: "unknown" },
        ["commissionMode"],
      ),
    /commission mode is invalid/,
  );
});
