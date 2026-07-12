import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { UserAccount } from "../auth/users.js";
import type { PolicyRecord } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import {
  PolicyLedgerNotFoundError,
  type PolicyLedgerSourceItem,
} from "../policies/ledger.js";
import { toErrorResponse } from "./errors.js";
import {
  POLICY_LEDGER_DETAIL_PATH,
  POLICY_LEDGER_LIST_PATH,
  registerPolicyLedgerRoutes,
  type RegisterPolicyLedgerRoutesOptions,
} from "./policies.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const INACTIVE_ID = "00000000-0000-4000-8000-000000000004";
const POLICY_ID = "00000000-0000-4000-8000-000000000010";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  path: string;
}

function createFixture(options: { missing?: boolean } = {}) {
  const users = new Map<string, UserAccount>([
    [ADMIN_ID, account(ADMIN_ID)],
    [PRODUCER_ID, account(PRODUCER_ID)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
    [INACTIVE_ID, account(INACTIVE_ID, false)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [ADMIN_ID, principal(ADMIN_ID, { capabilities: ["admin"] })],
    [PRODUCER_ID, principal(PRODUCER_ID, { staffRole: "producer" })],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, { staffRole: "employee" })],
    [
      INACTIVE_ID,
      principal(INACTIVE_ID, { staffRole: "employee", userActive: false }),
    ],
  ]);
  const authorization = createAuthorizationGuards({
    async findUser(userId) {
      return users.get(userId) ?? null;
    },
    async loadPrincipal(userId) {
      return principals.get(userId) ?? null;
    },
    logger,
  });
  const calls: Array<{ id?: string; query?: unknown; userId: string }> = [];
  const registrations: Registration[] = [];
  const routeOptions: RegisterPolicyLedgerRoutesOptions = {
    authorization,
    async get(context, policyId) {
      calls.push({ id: policyId, userId: context.principal.userId });
      if (options.missing === true) {
        throw new PolicyLedgerNotFoundError();
      }
      return sourceItem();
    },
    async list(context, query) {
      calls.push({ query, userId: context.principal.userId });
      return {
        filteredTotal: 1,
        hasMore: false,
        items: [sourceItem()],
        limit: 100,
        month: "2026-07",
        offset: 0,
        total: 1,
        totals: {
          agencyRevenue: "175.00",
          amountPaid: "350.00",
          brokerFee: "50.00",
          commissionAmount: "125.00",
          producerPayout: "43.75",
          sophiaRetained: "131.25",
        },
      };
    },
    logger,
  };
  const routes = {
    get(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      assert.ok(handlers[0]);
      registrations.push({ access, handler: handlers[0], path });
    },
  } as unknown as RouteRegistrar;
  registerPolicyLedgerRoutes(routes, routeOptions);
  return { calls, registrations };
}

test("admin list and detail return only projected ledger policy fields", async () => {
  const fixture = createFixture();
  const list = await invoke(fixture, POLICY_LEDGER_LIST_PATH, {
    identity: "admin",
    query: { month: "2026-07", search: "Private" },
  });
  assert.equal(list.status, 200);
  assert.equal(list.headers["cache-control"], "no-store");
  const listPolicy = ((list.body as any).items[0] as any).policy;
  assert.equal(listPolicy.id, POLICY_ID);
  assert.equal(listPolicy.basePremium, "1000.00");
  assert.deepEqual(listPolicy.financeContact, {
    email: "private@example.test",
  });
  assert.equal("passwordHash" in listPolicy, false);
  assert.equal("balanceDueFromInsured" in listPolicy, false);
  assert.equal("remainingNetDue" in listPolicy, false);

  const detail = await invoke(fixture, POLICY_LEDGER_DETAIL_PATH, {
    identity: "admin",
    params: { policyId: POLICY_ID },
  });
  assert.equal(detail.status, 200);
  assert.equal((detail.body as any).item.policy.id, POLICY_ID);
  assert.equal("passwordHash" in (detail.body as any).item.policy, false);
  assert.deepEqual(fixture.calls, [
    {
      query: {
        duplicates: "all",
        finance: "all",
        limit: 100,
        month: "2026-07",
        offset: 0,
        search: "Private",
        sort: "date",
      },
      userId: ADMIN_ID,
    },
    { id: POLICY_ID, userId: ADMIN_ID },
  ]);
});

test("employee, producer, inactive, and unauthenticated callers receive no ledger payload", async () => {
  for (const identity of [
    undefined,
    "employee",
    "producer",
    "inactive",
  ] as const) {
    for (const [path, params] of [
      [POLICY_LEDGER_LIST_PATH, {}],
      [POLICY_LEDGER_DETAIL_PATH, { policyId: POLICY_ID }],
    ] as const) {
      const fixture = createFixture();
      const response = await invoke(fixture, path, { identity, params });
      assert.equal(
        response.status,
        identity === undefined || identity === "inactive" ? 401 : 403,
      );
      assert.deepEqual(fixture.calls, []);
      const serialized = JSON.stringify(response.body);
      assert.equal(serialized.includes(POLICY_ID), false);
      assert.equal(serialized.includes("basePremium"), false);
      assert.equal(serialized.includes("Private Insured"), false);
    }
  }
});

test("ledger routes reject invalid inputs and return generic not-found responses", async () => {
  const invalidList = createFixture();
  const invalidQuery = await invoke(invalidList, POLICY_LEDGER_LIST_PATH, {
    identity: "admin",
    query: { limit: "201" },
  });
  assert.equal(invalidQuery.status, 400);
  assert.deepEqual(invalidList.calls, []);

  const invalidDetail = createFixture();
  const invalidId = await invoke(invalidDetail, POLICY_LEDGER_DETAIL_PATH, {
    identity: "admin",
    params: { policyId: "not-a-uuid" },
  });
  assert.equal(invalidId.status, 400);
  assert.deepEqual(invalidDetail.calls, []);

  const missing = createFixture({ missing: true });
  const notFound = await invoke(missing, POLICY_LEDGER_DETAIL_PATH, {
    identity: "admin",
    params: { policyId: POLICY_ID },
  });
  assert.equal(notFound.status, 404);
  assert.deepEqual(notFound.body, {
    error: { code: "not_found", message: "Policy not found" },
  });
});

test("both ledger routes declare admin guards and fail closed without guard context", async () => {
  const fixture = createFixture();
  assert.deepEqual(
    fixture.registrations.map(({ access, path }) => ({
      authorized: typeof access.authorization === "function",
      path,
      public: "public" in access,
    })),
    [
      { authorized: true, path: POLICY_LEDGER_LIST_PATH, public: false },
      { authorized: true, path: POLICY_LEDGER_DETAIL_PATH, public: false },
    ],
  );

  const registration = fixture.registrations[0]!;
  const req = request(POLICY_LEDGER_LIST_PATH, {}, {}, undefined);
  const response = createTestResponse();
  registration.handler(req, response.res, response.next);
  const error = await response.completed;
  assert.notEqual(error, null);
  assert.equal(errorResult(error).status, 500);
  assert.deepEqual(fixture.calls, []);
});

function sourceItem(): PolicyLedgerSourceItem {
  return {
    duplicate: { count: 2, kind: "likely" },
    labels: {
      carrierName: "Carrier",
      mgaName: "MGA",
      officeName: "Office",
      policyTypeClass: "Commercial",
      policyTypeName: "General Liability",
      producerDisplayName: "Kaylee",
      submitterDisplayName: "Mercedes",
    },
    policy: {
      ...policy(),
      passwordHash: "must-not-leak",
    } as PolicyRecord,
  };
}

function policy(): PolicyRecord {
  const at = new Date("2026-07-11T12:00:00.000Z");
  return {
    accountAssignment: "book",
    amountPaid: "350.00",
    approvedAt: at,
    balanceDueDate: "2026-07-25",
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: "00000000-0000-4000-8000-000000000020",
    collectedToDate: "300.00",
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: "Private Company",
    createdAt: at,
    depositOption: "350.00",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "775.00",
    financeContact: { email: "private@example.test" },
    financeMeta: { invoice: true },
    financeReference: "IPFS-PRIVATE",
    id: POLICY_ID,
    insuredName: "Private Insured",
    invoiceNumber: null,
    ipfsFinanced: "yes",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: "new",
    kayleeSplit: "book",
    mgaFee: "25.00",
    mgaId: "00000000-0000-4000-8000-000000000021",
    mgaPaid: false,
    mgaPaidAt: null,
    producerCommissionReceivedAt: null,
    mgaPayReference: null,
    netDue: "175.00",
    netDueTotal: "700.00",
    notes: "Private notes",
    officeLocationId: "00000000-0000-4000-8000-000000000022",
    overridden: true,
    payableStatus: "partially_remitted",
    paymentMode: "deposit",
    policyNumber: "GL-100",
    policyTypeId: "00000000-0000-4000-8000-000000000023",
    premiumTotal: "1000.00",
    producerUserId: PRODUCER_ID,
    proposalTotal: "1075.00",
    receivableStatus: "partial",
    remittedToMga: "200.00",
    sourceDraftId: null,
    submittedAt: at,
    submittedByUserId: EMPLOYEE_ID,
    taxes: "0.00",
    transactionNotes: "Private transaction note",
    transactionType: "New",
    updatedAt: at,
  };
}

function account(id: string, isActive = true): UserAccount {
  const at = new Date("2026-07-11T12:00:00.000Z");
  return {
    createdAt: at,
    email: `${id}@example.test`,
    id,
    isActive,
    sessionVersion: 0,
  };
}

function principal(
  id: string,
  access: Partial<AccessPrincipal> = {},
): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: null,
    userActive: true,
    userId: id,
    ...access,
  };
}

type Identity = "admin" | "employee" | "producer" | "inactive";

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  path: string,
  options: {
    identity?: Identity;
    params?: Record<string, string>;
    query?: unknown;
  },
): Promise<TestResult> {
  const registration = fixture.registrations.find((item) => item.path === path);
  assert.ok(registration);
  const userId =
    options.identity === "admin"
      ? ADMIN_ID
      : options.identity === "employee"
        ? EMPLOYEE_ID
        : options.identity === "producer"
          ? PRODUCER_ID
          : options.identity === "inactive"
            ? INACTIVE_ID
            : undefined;
  const req = request(
    path,
    options.params ?? {},
    options.query ?? {},
    userId,
  );
  const response = createTestResponse();
  const guard = registration.access.authorization;
  assert.ok(guard);
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) {
    return errorResult(guardError);
  }
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

function request(
  path: string,
  params: Record<string, string>,
  query: unknown,
  userId?: string,
): Request {
  return {
    headers: {},
    method: "GET",
    originalUrl: path,
    params,
    query,
    route: { path },
    session: fakeSession(userId),
  } as unknown as Request;
}

function fakeSession(userId?: string): Request["session"] {
  const session = {
    cookie: {},
    destroy(callback: (error?: unknown) => void) {
      callback();
    },
  } as unknown as Request["session"];
  if (userId !== undefined) {
    session.userId = userId;
    session.sessionVersion = 0;
  }
  return session;
}

interface TestResult {
  body: unknown;
  headers: Record<string, string>;
  status: number;
}

function createTestResponse(): {
  completed: Promise<unknown | null>;
  next: NextFunction;
  res: Response;
  result(): TestResult;
} {
  let status = 200;
  let body: unknown;
  const headers: Record<string, string> = {};
  let resolveCompleted!: (error: unknown | null) => void;
  const completed = new Promise<unknown | null>((resolve) => {
    resolveCompleted = resolve;
  });
  const res = {
    clearCookie() {
      return res;
    },
    locals: {},
    json(value: unknown) {
      body = value;
      resolveCompleted(null);
      return res;
    },
    set(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    status(value: number) {
      status = value;
      return res;
    },
  } as unknown as Response;
  return {
    completed,
    next(error?: unknown) {
      resolveCompleted(error ?? null);
    },
    res,
    result: () => ({ body, headers, status }),
  };
}

async function invokeNextMiddleware(
  middleware: RequestHandler,
  req: Request,
  res: Response,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    middleware(req, res, (error?: unknown) => resolve(error ?? null));
  });
}

function errorResult(error: unknown): TestResult {
  const response = toErrorResponse(error);
  return {
    body: response.response,
    headers: {},
    status: response.statusCode,
  };
}
