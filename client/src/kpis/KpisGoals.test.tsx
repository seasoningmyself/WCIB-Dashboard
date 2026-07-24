import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  KpisGoals,
  KpisGoalsView,
  type KpiScreenState,
} from "./KpisGoals.js";
import type { AgencyOverviewState } from "./overview.js";
import { kpiActualsFixture, kpiTargetsFixture, PRODUCER_ID } from "./test-fixture.js";

const admin: CurrentUser = {
  allowedNavigation: ["kpis"],
  capabilities: ["admin"],
  displayName: "Sophia",
  email: "sophia@example.test",
  id: "00000000-0000-4000-8000-000000000001",
  passwordChangeRequired: false,
  role: "admin",
};

test("KPI screen renders server totals directly with UUID scope and exact decimals", () => {
  const actuals = kpiActualsFixture({
    totals: {
      ...kpiActualsFixture().totals,
      agencyRevenue: "999999.99",
      producerPayout: "12345.67",
    },
  });
  const markup = renderReady(actuals);

  assert.match(markup, /Agency Overview/);
  assert.match(markup, /July 2026 in progress/);
  assert.match(markup, /Policies approved/);
  assert.match(markup, /1 policy change/);
  assert.match(markup, /\$3,000\.00/);
  assert.match(markup, /Latest completed work/);
  assert.match(markup, /Policy WCIB-1001/);
  assert.match(markup, /Settled agency results/);
  assert.match(markup, new RegExp(`value="producer:${PRODUCER_ID}"`));
  assert.match(markup, />Kaylee Producer</);
  assert.match(markup, /\$999,999\.99/);
  assert.match(markup, /\$12,345\.67/);
  assert.match(markup, /\$42,000\.10/);
  assert.match(markup, /50\.00%/);
  assert.match(markup, /Main Office With A Deliberately Long Stable Label/);
  assert.doesNotMatch(markup, /policyNumber|basePremium|netDue|localStorage|sessionStorage/);

  // Deliberately inconsistent totals prove the UI does not sum monthly or payout rows.
  assert.doesNotMatch(markup, /\$120,000\.60/);
  assert.notEqual(actuals.totals.agencyRevenue, "120000.60");
});

test("KPI screen preserves target editing, pending, and empty closed-history states", () => {
  const pending = renderView({
    actuals: kpiActualsFixture(),
    pending: true,
  });
  assert.match(pending, /Saving\.\.\./);
  assert.match(pending, /New policies goal/);
  assert.match(pending, /New revenue goal/);
  assert.match(pending, /Retention goal/);
  assert.match(pending, /Clear targets/);
  assert.match(pending, /disabled=""/);

  const empty = renderView({
    actuals: kpiActualsFixture({
      empty: true,
      monthly: [
        { agencyRevenue: "0.00", month: 1, newPolicyCount: 0, policyCount: 0, producerPayout: "0.00" },
        { agencyRevenue: "0.00", month: 2, newPolicyCount: 0, policyCount: 0, producerPayout: "0.00" },
        { agencyRevenue: "0.00", month: 3, newPolicyCount: 0, policyCount: 0, producerPayout: "0.00" },
      ],
      offices: [],
      producerPayouts: [],
      transactionTypes: [],
      totals: {
        agencyRevenue: "0.00",
        existingPolicyCount: 0,
        newPolicyCount: 0,
        newRevenue: "0.00",
        policyCount: 0,
        producerBookPayout: "0.00",
        producerFirstYearHousePayout: "0.00",
        producerPayout: "0.00",
        retentionRate: null,
        wonBackCount: 0,
        wonBackRevenue: "0.00",
      },
    }),
  });
  assert.match(empty, /No closed performance yet/);
  assert.match(empty, /Targets vs\. actuals/);
  assert.doesNotMatch(empty, /Business performance/);

  const firstRunTargets = kpiTargetsFixture();
  firstRunTargets.items = [];
  const firstRun = renderView({
    actuals: kpiActualsFixture({
      empty: true,
      monthly: [],
      offices: [],
      producerPayouts: [],
      transactionTypes: [],
    }),
    targetValues: {
      newPolicyCountTarget: "",
      newRevenueTarget: "",
      retentionRateTarget: "",
    },
    targets: firstRunTargets,
  });
  assert.match(firstRun, /Set annual targets for 2026/);
  assert.match(firstRun, /Once a pay sheet closes/);
  assert.match(firstRun, /Set annual targets/);
  assert.match(firstRun, /View pay sheets/);
  assert.doesNotMatch(firstRun, /Targets vs\. actuals|No annual target|Not set/);
});

test("KPI screen fails closed for every non-admin role before API context mounts", () => {
  for (const role of ["employee", "producer", null] as const) {
    const markup = renderToStaticMarkup(
      <KpisGoals user={{ ...admin, allowedNavigation: [], capabilities: [], role }} />,
    );
    assert.match(markup, /KPIs unavailable/);
    assert.match(markup, /not available for your account/);
    assert.doesNotMatch(markup, /Loading KPIs|Targets vs\. actuals|Agency revenue/);
  }
});

test("KPI modules load and fail independently while authorization still fails closed", () => {
  const closedLoading = renderView({ state: { status: "loading" } });
  assert.match(closedLoading, /Loading settled agency results/);
  assert.match(closedLoading, /July 2026 in progress/);

  const overviewError = renderView({ overviewState: { status: "error" } });
  assert.match(overviewError, /Current agency activity unavailable/);
  assert.match(overviewError, /Settled agency results/);
  assert.match(overviewError, /Try again/);

  for (const markup of [
    renderView({ state: { status: "denied" } }),
    renderView({ overviewState: { status: "denied" } }),
  ]) {
    assert.match(markup, /not available for your account/);
    assert.doesNotMatch(markup, /Agency Overview|Agency revenue/);
  }

  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.kpi-target-grid\s*\{/);
  assert.match(css, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.kpi-page,/);
  assert.match(css, /\.kpi-trend\s*\{[\s\S]*overflow-x:\s*auto/);
});

function renderReady(actuals = kpiActualsFixture()): string {
  return renderView({ actuals });
}

function renderView({
  actuals = kpiActualsFixture(),
  pending = false,
  overviewState,
  state,
  targets = kpiTargetsFixture(),
  targetValues = {
    newPolicyCountTarget: "12",
    newRevenueTarget: "125000.00",
    retentionRateTarget: "75.00",
  },
}: {
  actuals?: ReturnType<typeof kpiActualsFixture>;
  pending?: boolean;
  overviewState?: AgencyOverviewState;
  state?: KpiScreenState;
  targets?: ReturnType<typeof kpiTargetsFixture>;
  targetValues?: {
    newPolicyCountTarget: string;
    newRevenueTarget: string;
    retentionRateTarget: string;
  };
} = {}): string {
  return renderToStaticMarkup(
    <KpisGoalsView
      formError={null}
      notice={null}
      onApplyYear={() => {}}
      onClear={() => {}}
      onPeriod={() => {}}
      onRetryClosed={() => {}}
      onRetryOverview={() => {}}
      onSave={() => {}}
      onScope={() => {}}
      onTargetValues={() => {}}
      onYearDraft={() => {}}
      pending={pending}
      period="Q1"
      overviewState={overviewState ?? {
        overview: overviewFixture(),
        status: "ready",
      }}
      scope={{ producerUserId: null, scopeType: "company" }}
      state={state ?? {
        actuals,
        status: "ready",
        targets,
      }}
      targetValues={targetValues}
      year={2026}
      yearDraft="2026"
      now={new Date("2026-07-23T13:00:00.000Z")}
    />,
  );
}

function overviewFixture() {
  return {
    activities: [
      {
        actionType: "policy_approved" as const,
        actorDisplayName: "Sophia",
        occurredAt: "2026-07-23T12:00:00.000Z",
        targetReference: "Policy WCIB-1001",
      },
    ],
    agencyRevenue: "1509.39",
    helpRequestCount: 2,
    month: "2026-07",
    outstandingMgaAmount: "3000.00",
    outstandingMgaCount: 6,
    policyChangeRequestCount: 1,
    policiesApproved: 6,
    reviewItemCount: 7,
    submittedTurnInCount: 4,
  };
}
