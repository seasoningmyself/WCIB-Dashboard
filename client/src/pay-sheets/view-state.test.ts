import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  adjustmentTypeLabel,
  buildPaySheetLiveKpi,
  closedSheetsForOwner,
  detailSourceLabel,
  formatPaySheetPeriod,
  formatPaySheetRate,
  groupPaySheetPolicies,
  groupPaySheetsByOwner,
  isPaySheetsAdmin,
  listPaySheetPeriods,
  openSheetForOwner,
  ownerHasPaySheetPeriod,
  paySheetExportQueryForScope,
  paySheetAccountLabel,
} from "./view-state.js";
import {
  paySheetDetailFixture,
  paySheetListFixture,
  paySheetPolicyFixture,
  producerSummaryFixture,
  uuid,
} from "./test-fixture.js";

test("owner grouping preserves server order and separates open from history", () => {
  const groups = groupPaySheetsByOwner(paySheetListFixture().items);
  assert.deepEqual(
    groups.map(({ key, label }) => [key, label]),
    [[`sophia:${uuid(1)}`, "Sophia"], [`producer:${uuid(2)}`, "Kaylee"]],
  );
  assert.equal(openSheetForOwner(groups[0]!)?.periodMonth, 7);
  assert.deepEqual(
    closedSheetsForOwner(groups[0]!).map(({ periodMonth }) => periodMonth),
    [6],
  );
});

test("policy sections preserve v15 account order, A-Z rows, and exact totals", () => {
  const sophia = paySheetDetailFixture();
  const sections = groupPaySheetPolicies({
    ...sophia,
    policies: [
      paySheetPolicyFixture({
        associationId: uuid(31),
        insuredName: "Zulu House",
        kayleeSplit: "none",
      }),
      paySheetPolicyFixture({
        associationId: uuid(32),
        insuredName: "Alpha House",
        kayleeSplit: "none",
      }),
      paySheetPolicyFixture({
        associationId: uuid(33),
        insuredName: "Book Client",
        kayleeSplit: "book",
      }),
      paySheetPolicyFixture({
        associationId: uuid(34),
        insuredName: "First Year Client",
        kayleeSplit: "house",
      }),
    ],
  });
  assert.deepEqual(
    sections.map(({ key, label, sectionAmount, sectionAmountLabel }) => [
      key,
      label,
      sectionAmount,
      sectionAmountLabel,
    ]),
    [
      ["none", "Sophia's account", "300.00", "Section total"],
      ["book", "Producers' books", "150.00", "Section total"],
      ["house", "1st-yr house", "150.00", "Section total"],
    ],
  );
  assert.deepEqual(
    sections[0]?.policies.map(({ insuredName }) => insuredName),
    ["Alpha House", "Zulu House"],
  );

  const producer = groupPaySheetPolicies(
    paySheetDetailFixture(producerSummaryFixture()),
  );
  assert.deepEqual(
    producer.map(({ label, sectionAmount, sectionAmountLabel }) => [
      label,
      sectionAmount,
      sectionAmountLabel,
    ]),
    [["Kaylee's book", "50.00", "Section payout"]],
  );
});

test("live KPI widget derives only projected open-sheet facts", () => {
  const sophia = paySheetDetailFixture();
  const sophiaDetail = {
    ...sophia,
    policies: [
      paySheetPolicyFixture({
        associationId: uuid(40),
        insuredName: "Workers Client",
        kayleeSplit: "book",
        policyTypeName: "Workers Compensation",
        producerPayout: "25.00",
        transactionType: "New",
      }),
      paySheetPolicyFixture({
        associationId: uuid(41),
        insuredName: "Bond Client",
        kayleeSplit: "none",
        policyTypeName: "Surety Bond",
        producerPayout: null,
        transactionType: "Renewal",
      }),
      paySheetPolicyFixture({
        associationId: uuid(42),
        insuredName: "First Year Client",
        kayleeSplit: "house",
        policyTypeName: "General Liability",
        producerPayout: "40.00",
        transactionType: "New",
      }),
    ],
  };
  const otherProducer = producerSummaryFixture({
    id: uuid(43),
    ownerDisplayName: "Jordan",
    ownerUserId: uuid(44),
    totals: {
      ...producerSummaryFixture().totals!,
      producerPayout: "10.25",
    },
  });
  const sophiaKpi = buildPaySheetLiveKpi(sophiaDetail, [
    sophiaDetail,
    producerSummaryFixture(),
    otherProducer,
  ]);
  assert.deepEqual(sophiaKpi, {
    accountMix: {
      firstYearHouse: 1,
      house: 1,
      producerBook: 1,
      suretyBonds: 1,
      workersComp: 1,
    },
    firstYearProducerPayout: "40.00",
    newBusinessCount: 2,
    ownerType: "sophia",
    paidToProducers: "55.25",
    periodLabel: "July 2026",
    renewalOrExistingCount: 1,
    totalPolicyCount: 3,
    totals: sophiaDetail.totals,
  });

  const producer = paySheetDetailFixture(producerSummaryFixture());
  const producerKpi = buildPaySheetLiveKpi(
    {
      ...producer,
      policies: [
        producer.policies[0]!,
        paySheetPolicyFixture({
          associationId: uuid(45),
          kayleeSplit: "house",
          policyTypeName: "Workers Compensation",
          transactionType: "Renewal",
        }),
        paySheetPolicyFixture({
          associationId: uuid(46),
          kayleeSplit: "book",
          policyTypeName: "Workers Compensation",
          transactionType: "Endorsement",
        }),
      ],
    },
    [producer],
  );
  assert.equal(producerKpi.ownerType, "producer");
  if (producerKpi.ownerType !== "producer") return;
  assert.deepEqual(producerKpi.accountMix, {
    firstYearHouse: 1,
    producerBook: 2,
  });
  assert.deepEqual(producerKpi.policyTypes, [
    { label: "Workers Compensation", policyCount: 2 },
    { label: "General Liability", policyCount: 1 },
  ]);
  assert.equal(producerKpi.payout, "45.00");
  assert.equal(producerKpi.newBusinessCount, 1);
  assert.equal(producerKpi.renewalOrExistingCount, 2);
});

test("export periods are unique, newest-first, and owner-scoped by UUID", () => {
  const data = paySheetListFixture();
  const periods = listPaySheetPeriods(data.items);
  const groups = groupPaySheetsByOwner(data.items);
  assert.deepEqual(
    periods.map(({ key, label }) => [key, label]),
    [["2026-07", "July 2026"], ["2026-06", "June 2026"]],
  );
  assert.equal(ownerHasPaySheetPeriod(groups[0]!, periods[1]!), true);
  assert.equal(ownerHasPaySheetPeriod(groups[1]!, periods[1]!), false);
  assert.deepEqual(paySheetExportQueryForScope("all", groups[1]!, periods[1]!), {
    ownerUserId: null,
    periodMonth: 6,
    periodYear: 2026,
  });
  assert.equal(
    paySheetExportQueryForScope("owner", groups[1]!, periods[1]!),
    null,
  );
  assert.deepEqual(
    paySheetExportQueryForScope("owner", groups[1]!, periods[0]!),
    {
      ownerUserId: uuid(2),
      periodMonth: 7,
      periodYear: 2026,
    },
  );
});

test("pay-sheet labels preserve exact period, rate, account, and source meaning", () => {
  assert.equal(formatPaySheetPeriod(7, 2026), "July 2026");
  assert.equal(formatPaySheetRate("25.00"), "25.00%");
  assert.equal(paySheetAccountLabel("own", null), "Sophia's account");
  assert.equal(paySheetAccountLabel("book", "Kaylee"), "Kaylee's book");
  assert.equal(
    paySheetAccountLabel("house", "Kaylee"),
    "1st-yr house - Kaylee",
  );
  assert.equal(adjustmentTypeLabel("direct_deposit"), "Direct deposit");
  assert.equal(detailSourceLabel(paySheetDetailFixture()), "Current values");
  assert.equal(
    detailSourceLabel(
      paySheetDetailFixture({
        ...paySheetDetailFixture(),
        closedAt: "2026-07-31T00:00:00.000Z",
        closedByUserId: uuid(1),
        status: "closed",
      }),
    ),
    "Frozen history",
  );
});

test("pay-sheet UI access requires the trusted admin role and capability", () => {
  const base: CurrentUser = {
    allowedNavigation: ["pay_sheets"],
    capabilities: ["admin"],
    displayName: "Sophia",
    email: "sophia@example.test",
    id: uuid(1),
    role: "admin" as const,
  };
  assert.equal(isPaySheetsAdmin(base), true);
  assert.equal(isPaySheetsAdmin({ ...base, capabilities: [] }), false);
  assert.equal(
    isPaySheetsAdmin({ ...base, capabilities: [], role: "employee" }),
    false,
  );
});
