import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  APPROVAL_REVIEW_GROUPS,
  buildApprovalOverrideInput,
  isApprovalAdmin,
  removeResolvedApprovalWork,
  reviewSourceValue,
} from "./review-state.js";

const QUEUE_ID = "00000000-0000-4000-8000-000000000601";
const DRAFT_ID = "00000000-0000-4000-8000-000000000602";
const CHANGE_REQUEST_ID = "00000000-0000-4000-8000-000000000604";

test("approval review inventory covers every immutable snapshot field", () => {
  const fields = APPROVAL_REVIEW_GROUPS.flatMap(({ fields }) =>
    fields.map(({ key }) => key),
  ).sort();
  assert.deepEqual(fields, [
    "accountAssignment",
    "amountPaid",
    "basePremium",
    "brokerFee",
    "carrierId",
    "commissionAmount",
    "commissionConfirmed",
    "commissionMode",
    "commissionRate",
    "companyName",
    "depositOption",
    "effectiveDate",
    "expirationDate",
    "financeBalance",
    "financeContact",
    "financeMeta",
    "financeReference",
    "insuredName",
    "invoiceNumber",
    "ipfsFinanced",
    "ipfsManual",
    "ipfsReturning",
    "kayleeSplit",
    "mgaFee",
    "mgaId",
    "netDue",
    "notes",
    "officeLocationId",
    "paymentMode",
    "policyNumber",
    "policyTypeId",
    "producerUserId",
    "proposalTotal",
    "schemaVersion",
    "taxes",
    "transactionNotes",
    "transactionType",
  ]);
});

test("approval state removes only the resolved sensitive record", () => {
  const work = {
    changeRequests: [
      { request: { id: CHANGE_REQUEST_ID } as never } as never,
    ],
    helpRequests: [
      { draft: { id: DRAFT_ID } as never, submitterDisplayName: "Employee" },
    ],
    submissions: [
      { entry: { id: QUEUE_ID } as never, submitterDisplayName: "Employee" },
    ],
  };
  assert.deepEqual(
    removeResolvedApprovalWork(work, { id: QUEUE_ID, kind: "submission" }),
    { ...work, submissions: [] },
  );
  assert.deepEqual(
    removeResolvedApprovalWork(work, {
      id: CHANGE_REQUEST_ID,
      kind: "change_request",
    }),
    { ...work, changeRequests: [] },
  );
  assert.deepEqual(
    removeResolvedApprovalWork(work, { id: DRAFT_ID, kind: "help" }),
    { ...work, helpRequests: [] },
  );
});

test("override builder names only explicit v15 financial replacements", () => {
  assert.deepEqual(
    buildApprovalOverrideInput({
      brokerFee: " 30.00 ",
      commissionAmount: "",
      netDue: "70.00",
      reason: "  Carrier correction  ",
    }),
    {
      input: {
        changedFields: ["brokerFee", "netDue"],
        reason: "Carrier correction",
        replacementValues: { brokerFee: "30.00", netDue: "70.00" },
      },
      success: true,
    },
  );
  assert.equal(
    buildApprovalOverrideInput({
      brokerFee: "",
      commissionAmount: "",
      netDue: "",
      reason: "Missing values",
    }).success,
    false,
  );
});

test("review formatting is deterministic and role display fails closed", () => {
  assert.equal(
    reviewSourceValue(
      { agencyCommissionAmount: "125.00" },
      { key: "commissionAmount", label: "Commission", money: true },
    ),
    "$125.00",
  );
  assert.equal(
    reviewSourceValue(
      { carrierId: "carrier-id" },
      { key: "carrierId", label: "Carrier" },
      { carriers: new Map([["carrier-id", "Acme Carrier"]]) },
    ),
    "Acme Carrier",
  );
  assert.equal(isApprovalAdmin(user("admin", ["admin"])), true);
  assert.equal(isApprovalAdmin(user("producer", [])), false);
  assert.equal(isApprovalAdmin(user("admin", [])), false);
});

function user(
  role: CurrentUser["role"],
  capabilities: CurrentUser["capabilities"],
): CurrentUser {
  return {
    allowedNavigation: role === "admin" ? ["approvals"] : [],
    capabilities,
    displayName: "User",
    email: "user@example.test",
    id: "00000000-0000-4000-8000-000000000603",
    role,
  };
}
