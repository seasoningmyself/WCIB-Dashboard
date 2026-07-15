import assert from "node:assert/strict";
import { test } from "node:test";
import { POLICY_CORRECTION_FIELDS } from "../../../shared/policy-corrections.js";
import { ledgerItemFixture } from "./test-fixture.js";
import {
  addMoneyExact,
  buildGeneralCorrectionRequest,
  buildOverrideCorrectionRequest,
  formatMoneyExact,
  generalEditorFields,
  ledgerAccountLabel,
  ledgerBadges,
  policyCorrectionValues,
} from "./view-state.js";

test("ledger money and account labels preserve exact stored strings", () => {
  assert.equal(formatMoneyExact("1234567890.05"), "$1,234,567,890.05");
  assert.equal(addMoneyExact("0.01", "999999999999.99"), "1000000000000.00");
  const value = ledgerItemFixture();
  assert.equal(ledgerAccountLabel(value), "Kaylee account");
  value.policy.kayleeSplit = "house";
  assert.equal(ledgerAccountLabel(value), "Kaylee first year");
  value.policy.kayleeSplit = "none";
  assert.equal(ledgerAccountLabel(value), "Sophia house");
});

test("ledger badges distinguish override, duplicate, financing, and MGA state by text", () => {
  assert.deepEqual(ledgerBadges(ledgerItemFixture()).map(({ label }) => label), [
    "Override",
    "Likely duplicate (2)",
    "IPFS pending",
    "MGA unpaid",
  ]);
  const completed = ledgerItemFixture();
  completed.policy.ipfsPushed = true;
  completed.policy.mgaPaid = true;
  completed.duplicate = { count: 3, kind: "possible" };
  assert.deepEqual(ledgerBadges(completed).map(({ label }) => label), [
    "Override",
    "Possible duplicate (3)",
    "IPFS ✓",
    "MGA paid",
  ]);
  const manual = ledgerItemFixture();
  manual.policy.ipfsManual = true;
  assert.equal(ledgerBadges(manual)[2]?.label, "IPFS manual");
});

test("general editor inventory equals the Core Schema allowlist exactly", () => {
  assert.deepEqual(
    [...generalEditorFields()].sort(),
    [...POLICY_CORRECTION_FIELDS].sort(),
  );
  for (const forbidden of ["brokerFee", "commissionAmount", "netDue", "commissionMode"]) {
    assert.equal(generalEditorFields().includes(forbidden as never), false);
  }
});

test("correction builders produce separate exact changed-field requests", () => {
  const source = ledgerItemFixture().policy;
  const values = policyCorrectionValues(source);
  values.insuredName = "Corrected Insured";
  const general = buildGeneralCorrectionRequest(source, values, "  Correct name  ");
  assert.equal(general.success, true);
  if (general.success) {
    assert.deepEqual(general.input, {
      change: {
        changedFields: ["insuredName"],
        reason: "Correct name",
        replacementValues: { insuredName: "Corrected Insured" },
      },
      expectedUpdatedAt: source.updatedAt,
      kind: "general",
    });
  }
  const override = buildOverrideCorrectionRequest(
    source,
    {
      brokerFee: "75.00",
      commissionAmount: source.commissionAmount,
      commissionMode: source.commissionMode,
      netDue: source.netDue,
    },
    "Correct fee",
  );
  assert.equal(override.success, true);
  if (override.success) {
    assert.deepEqual(override.input, {
      change: {
        changedFields: ["brokerFee"],
        reason: "Correct fee",
        replacementValues: { brokerFee: "75.00" },
      },
      expectedUpdatedAt: source.updatedAt,
      kind: "override",
    });
  }
  assert.equal(
    buildGeneralCorrectionRequest(source, policyCorrectionValues(source), "No change").success,
    false,
  );
});
