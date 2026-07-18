import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { PolicyLedgerListQuery } from "../../../shared/policy-ledger.js";
import { ApiClientProvider } from "../api/context.js";
import { createSessionBoundary } from "../auth/session-boundary.js";
import {
  DeletedPolicyPanel,
  PolicyLedger,
  PolicyLedgerView,
} from "./PolicyLedger.js";
import { ledgerItemFixture, ledgerListFixture, uuid } from "./test-fixture.js";

const query: PolicyLedgerListQuery = {
  direction: "asc",
  duplicates: "all",
  finance: "all",
  limit: 100,
  month: "2026-07",
  offset: 0,
  search: "",
  sort: "insured",
};

test("admin ledger renders financial totals, filters, badges, detail, and separate corrections", () => {
  const first = ledgerItemFixture();
  const second = structuredClone(first);
  second.policy.id = uuid(11);
  second.policy.insuredName = "Second Insured";
  second.policy.policyNumber = "GL-101";
  second.policy.mgaPaid = true;
  second.policy.ipfsPushed = true;
  second.policy.overridden = false;
  second.duplicate = { count: 3, kind: "possible" };
  const data = ledgerListFixture();
  data.items = [first, second];
  data.filteredTotal = 2;
  data.total = 2;

  const markup = ledgerMarkup({
    detail: { data: { item: first }, status: "ready" },
    expandedPolicyId: first.policy.id,
    state: { data, status: "ready" },
  });

  for (const visible of [
    "Collected",
    "$350.00",
    "Commission",
    "$125.00",
    "Broker fees",
    "$50.00",
    "Agency revenue",
    "$175.00",
    "Sophia share",
    "$131.25",
    "Producer share",
    "$43.75",
    "Search policies",
    "IPFS pending",
    "IPFS ✓",
    "Duplicates only",
    "Override",
    "Likely duplicate (2)",
    "Possible duplicate (3)",
    "MGA unpaid",
    "MGA paid",
    "Agency financials",
    "Record",
    "Mark pushed through to IPFS",
    "Correct fields",
    "Financial override",
    "Delete policy",
    "Deleted policies",
    "Export IPFS CSV",
  ]) {
    assert.match(markup, new RegExp(escapeRegExp(visible)));
  }
  for (const excludedAction of [
    "Mark MGA paid",
    "Export ledger",
    "Push to IPFS",
    "Add to pay sheet",
  ]) {
    assert.doesNotMatch(markup, new RegExp(escapeRegExp(excludedAction)));
  }
  for (const dormantPaymentField of [
    "Premium total",
    "Collected to date",
    "Net due total",
    "Remitted to MGA",
    "Receivable status",
    "Payable status",
    "Balance due",
  ]) {
    assert.doesNotMatch(markup, new RegExp(`>${escapeRegExp(dormantPaymentField)}<`));
  }
});

test("admin deleted-policy panel identifies recoverable records and restore control", () => {
  const item = ledgerItemFixture();
  const markup = renderToStaticMarkup(
    <DeletedPolicyPanel
      onClose={() => {}}
      onRestore={() => {}}
      onRetry={() => {}}
      open
      pending={false}
      state={{
        data: {
          items: [
            {
              deletion: {
                deletedAt: "2026-07-12T12:00:00.000Z",
                deletedByUserId: uuid(1),
                reason: "Duplicate entry",
              },
              labels: item.labels,
              policy: item.policy,
            },
          ],
        },
        status: "ready",
      }}
    />,
  );

  assert.match(markup, /Deleted policies/);
  assert.match(markup, /Insured/);
  assert.match(markup, /Duplicate entry/);
  assert.match(markup, />Restore</);
});

test("ledger renders loading, denied, failure, empty, and filtered-empty states", () => {
  assert.match(
    ledgerMarkup({ state: { status: "loading" } }),
    /Loading policy ledger/,
  );
  assert.match(
    ledgerMarkup({ state: { status: "denied" } }),
    /Policy ledger unavailable/,
  );
  assert.match(
    ledgerMarkup({ state: { status: "error" } }),
    /Try again/,
  );

  const blank = ledgerListFixture();
  blank.items = [];
  blank.filteredTotal = 0;
  blank.total = 0;
  assert.match(
    ledgerMarkup({ state: { data: blank, status: "ready" } }),
    /No policies yet/,
  );

  const filtered = structuredClone(blank);
  filtered.total = 4;
  assert.match(
    ledgerMarkup({ state: { data: filtered, status: "ready" } }),
    /No matching policies/,
  );
});

test("ledger search exposes the broad live-search contract and explicit clear", () => {
  const markup = ledgerMarkup({
    searchInput: "Acme",
    state: { data: ledgerListFixture(), status: "ready" },
  });

  assert.match(markup, /placeholder="Insured, policy, carrier, MGA"/);
  assert.match(markup, /aria-label="Clear ledger search"/);
  assert.match(markup, />Clear</);
  assert.doesNotMatch(markup, /type="submit"/);
});

test("non-admin ledger entry fails closed before mounting the data controller", () => {
  const user: CurrentUser = {
    allowedNavigation: ["turn_in", "my_items"],
    capabilities: [],
    displayName: "Mercedes",
    email: "employee@example.test",
    id: uuid(90),
    role: "employee",
  };
  const markup = renderToStaticMarkup(<PolicyLedger user={user} />);

  assert.match(markup, /Policy ledger unavailable/);
  assert.doesNotMatch(markup, /Loading policy ledger/);
  assert.doesNotMatch(markup, /Agency financials/);
});

test("admin ledger dialogs retain distinct keys while both are closed", () => {
  const warnings: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => warnings.push(args);
  try {
    renderToStaticMarkup(
      <ApiClientProvider
        boundary={createSessionBoundary(() => {})}
        client={{ async request() { return Response.json({}); } }}
      >
        <PolicyLedger
          user={{
            allowedNavigation: ["policy_ledger"],
            capabilities: ["admin"],
            displayName: "Sophia",
            email: "admin@example.test",
            id: uuid(91),
            role: "admin",
          }}
        />
      </ApiClientProvider>,
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(
    warnings.some((args) => args.some((value) =>
      typeof value === "string" && value.includes("same key")
    )),
    false,
  );
});

test("expanded detail has an explicit retry state without exposing stale policy data", () => {
  const item = ledgerItemFixture();
  const markup = ledgerMarkup({
    detail: { status: "error" },
    expandedPolicyId: item.policy.id,
    state: { data: ledgerListFixture(), status: "ready" },
  });

  assert.match(markup, /Policy details could not be loaded/);
  assert.match(markup, /Try again/);
  assert.doesNotMatch(markup, />Record</);
});

function ledgerMarkup({
  detail = { status: "closed" },
  expandedPolicyId = null,
  searchInput = "",
  state,
}: {
  detail?: Parameters<typeof PolicyLedgerView>[0]["detail"];
  expandedPolicyId?: string | null;
  searchInput?: string;
  state: Parameters<typeof PolicyLedgerView>[0]["state"];
}): string {
  return renderToStaticMarkup(
    <PolicyLedgerView
      detail={detail}
      expandedPolicyId={expandedPolicyId}
      notice={null}
      onCorrect={() => {}}
      onDelete={() => {}}
      onExportIpfs={() => {}}
      onOpenDeleted={() => {}}
      onPage={() => {}}
      onQuery={() => {}}
      onRetry={() => {}}
      onRetryDetail={() => {}}
      onSearch={() => {}}
      onSetIpfsPushed={() => {}}
      onToggleDetail={() => {}}
      pending={false}
      exportingIpfs={false}
      query={query}
      searchInput={searchInput}
      state={state}
    />,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
