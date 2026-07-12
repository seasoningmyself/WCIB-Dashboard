import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type {
  PaySheetAdjustmentView,
  PaySheetPolicyView,
} from "../../shared/pay-sheet-api.js";
import {
  calculateOpenPaySheetTotals,
  projectAdminPaySheetCloseResult,
  projectAdminPaySheetDetail,
  projectAdminPaySheetSummary,
  type PaySheetSource,
} from "./read.js";

const ADMIN_ID = uuid(90);

test("open Sophia totals exactly mirror close math with distinct gross and take-home", () => {
  const totals = calculateOpenPaySheetTotals(
    "sophia",
    [policy()],
    [
      adjustment({
        accountBasis: "own",
        commissionDelta: "-20.00",
      }),
      adjustment({
        adjustmentType: "check_income",
        commissionDelta: "0.00",
        id: uuid(31),
        incomeAmount: "100.00",
      }),
    ],
  );

  assert.deepEqual(totals, {
    brokerFees: "50.00",
    commissions: "80.00",
    directCheckAchIncome: "100.00",
    grandTotalIncome: "230.00",
    sophiaAgencyGross: "230.00",
    sophiaShare: "92.50",
    sophiaTakeHome: "192.50",
    trustPull: "130.00",
  });
  assert.notEqual(totals?.sophiaAgencyGross, totals?.sophiaTakeHome);
});

test("producer totals use projected per-policy payout and fail closed without rate", () => {
  assert.deepEqual(
    calculateOpenPaySheetTotals(
      "producer",
      [policy({ producerPayout: "37.50" })],
      [
        adjustment({
          accountBasis: "book",
          brokerFeeDelta: "0.00",
          commissionDelta: "0.00",
          payoutDelta: "-5.00",
          producerDisplayName: "Kaylee",
          producerUserId: uuid(2),
        }),
      ],
    ),
    {
      brokerFees: "50.00",
      commissions: "100.00",
      directCheckAchIncome: "0.00",
      grandTotalIncome: "150.00",
      producerPayout: "32.50",
      trustPull: "150.00",
    },
  );
  assert.equal(
    calculateOpenPaySheetTotals(
      "producer",
      [policy({ producerPayout: null, rate: null })],
      [],
    ),
    null,
  );
});

test("closed admin projection reads exact frozen history and rejects non-admins", () => {
  const source = closedSophiaSource();
  const summary = projectAdminPaySheetSummary(source, context());
  const detail = projectAdminPaySheetDetail(source, context());

  assert.ok(summary?.ownerType === "sophia");
  assert.equal(summary.totals.sophiaAgencyGross, "250.00");
  assert.equal(summary.totals.sophiaTakeHome, "212.50");
  assert.equal(detail?.policies[0]?.source, "frozen");
  assert.equal(detail?.policies[0]?.insuredName, "Frozen Insured");
  assert.notEqual(
    summary.totals.sophiaAgencyGross,
    summary.totals.sophiaTakeHome,
  );
  assert.throws(
    () => projectAdminPaySheetDetail(source, context([])),
    /authorized lifecycle access is required/i,
  );
  assert.throws(
    () =>
      projectAdminPaySheetDetail(
        {
          ...source,
          header: {
            ...source.header,
            sheet: {
              ...source.header.sheet,
              frozenTotals: {
                ...(source.header.sheet.frozenTotals as object),
                secret: "no",
              },
            },
          },
        },
        context(),
      ),
    /field contract/,
  );
});

test("close result projection is an exact admin-only allowlist", () => {
  const projected = projectAdminPaySheetCloseResult(
    {
      closed: true,
      nextSheetId: uuid(3),
      ownerType: "sophia",
      periodMonth: 7,
      periodYear: 2026,
      policyCount: 1,
      privateSnapshot: "must-not-leak",
    } as never,
    context(),
  );
  assert.deepEqual(projected, {
    closed: true,
    nextSheetId: uuid(3),
    ownerType: "sophia",
    periodMonth: 7,
    periodYear: 2026,
    policyCount: 1,
  });
  assert.throws(
    () =>
      projectAdminPaySheetCloseResult(
        projected,
        context([]),
      ),
    /authorized lifecycle access is required/i,
  );
});

function policy(
  overrides: Partial<PaySheetPolicyView> = {},
): PaySheetPolicyView {
  return {
    addedAt: "2026-07-01T00:00:00.000Z",
    agencyRevenue: "150.00",
    associationId: uuid(10),
    approvedAt: "2026-06-30T12:00:00.000Z",
    brokerFee: "50.00",
    commissionAmount: "100.00",
    effectiveDate: "2026-07-01",
    insuredName: "Insured",
    kayleeSplit: "book",
    officeLocationId: uuid(5),
    policyId: uuid(11),
    policyNumber: "POL-1",
    policyTypeClass: "Commercial",
    policyTypeName: "General Liability",
    producerPayout: "0.00",
    producerUserId: uuid(2),
    rate: null,
    sophiaShare: "112.50",
    source: "live",
    transactionType: "New",
    ...overrides,
  };
}

function adjustment(
  overrides: Partial<PaySheetAdjustmentView> = {},
): PaySheetAdjustmentView {
  return {
    accountBasis: "own",
    adjustmentType: "manual_adjustment",
    brokerFeeDelta: "0.00",
    commissionDelta: "-20.00",
    createdAt: "2026-07-02T00:00:00.000Z",
    createdByUserId: ADMIN_ID,
    effectiveDate: "2026-07-02",
    id: uuid(30),
    incomeAmount: "0.00",
    insuredOrClientLabel: "Correction",
    paySheetId: uuid(1),
    payoutDelta: "0.00",
    policyTypeId: null,
    policyTypeName: null,
    producerDisplayName: null,
    producerUserId: null,
    reasonOrNote: null,
    updatedAt: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

function closedSophiaSource(): PaySheetSource {
  const closedAt = new Date("2026-07-31T12:00:00.000Z");
  return {
    adjustments: [],
    header: {
      ownerDisplayName: "Sophia",
      ownerEmail: "sophia@example.test",
      sheet: {
        closedAt,
        closedByUserId: ADMIN_ID,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        frozenTotals: {
          brokerFees: "50.00",
          commissions: "100.00",
          directCheckAchIncome: "100.00",
          grandTotalIncome: "250.00",
          sophiaAgencyGross: "250.00",
          sophiaShare: "112.50",
          sophiaTakeHome: "212.50",
          trustPull: "150.00",
        },
        id: uuid(1),
        openedAt: new Date("2026-07-01T00:00:00.000Z"),
        ownerType: "sophia",
        ownerUserId: ADMIN_ID,
        periodMonth: 7,
        periodYear: 2026,
        status: "closed",
        updatedAt: closedAt,
      },
    },
    policies: [
      {
        kind: "frozen",
        value: {
          addedAt: new Date("2026-07-02T00:00:00.000Z"),
          associationId: uuid(10),
          frozenPolicySnapshot: {
            agencyRevenue: "150.00",
            approvedAt: "2026-06-30T12:00:00.000Z",
            brokerFee: "50.00",
            commissionAmount: "100.00",
            effectiveDate: "2026-07-01",
            insuredName: "Frozen Insured",
            kayleeSplit: "book",
            officeLocationId: uuid(5),
            policyId: uuid(11),
            policyNumber: "POL-FROZEN",
            policyTypeClass: "Commercial",
            policyTypeName: "General Liability",
            producerPayout: "0.00",
            producerUserId: uuid(2),
            sophiaShare: "112.50",
            transactionType: "New",
          },
          frozenRateSnapshot: null,
        },
      },
    ],
    rate: null,
  };
}

function context(
  capabilities: AuthorizedRequestContext["principal"]["capabilities"] = [
    "admin",
  ],
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities,
      staffRole: capabilities.length > 0 ? null : "employee",
      userActive: true,
      userId: ADMIN_ID,
    },
  };
}

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
