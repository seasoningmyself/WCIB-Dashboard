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
  PolicyLedgerCorrectionNotFoundError,
  PolicyLedgerCorrectionStaleError,
  PolicyLedgerCorrectionValidationError,
} from "../policies/ledger-corrections.js";
import { toErrorResponse } from "./errors.js";
import {
  POLICY_LEDGER_CORRECTION_PATH,
  registerPolicyLedgerCorrectionRoute,
  type RegisterPolicyLedgerCorrectionRouteOptions,
} from "./policy-corrections.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const INACTIVE_ID = "00000000-0000-4000-8000-000000000004";
const POLICY_ID = "00000000-0000-4000-8000-000000000010";
const EXPECTED_UPDATED_AT = "2026-07-11T12:00:00.000Z";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  path: string;
}

function createFixture(
  error?:
    | PolicyLedgerCorrectionNotFoundError
    | PolicyLedgerCorrectionStaleError
    | PolicyLedgerCorrectionValidationError,
) {
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
  const calls: Array<{ input: unknown; policyId: string; userId: string }> = [];
  const registration: Registration[] = [];
  const options: RegisterPolicyLedgerCorrectionRouteOptions = {
    authorization,
    async correct(context, policyId, input) {
      calls.push({ input, policyId, userId: context.principal.userId });
      if (error !== undefined) throw error;
      return {
        kind: (input as { kind: "general" | "override" }).kind,
        mutationId: "00000000-0000-4000-8000-000000000099",
        policy: {
          ...policy(),
          passwordHash: "must-not-leak",
        } as PolicyRecord,
      };
    },
    logger,
  };
  const routes = {
    patch(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      assert.ok(handlers[0]);
      registration.push({ access, handler: handlers[0], path });
    },
  } as unknown as RouteRegistrar;
  registerPolicyLedgerCorrectionRoute(routes, options);
  return { calls, registration: registration[0]! };
}

test("admin general and override requests stay separate and return projected policies", async () => {
  const general = createFixture();
  const generalResponse = await invoke(general, generalBody(), "admin");
  assert.equal(generalResponse.status, 200);
  assert.equal(generalResponse.headers["cache-control"], "no-store");
  assert.equal((generalResponse.body as any).policy.id, POLICY_ID);
  assert.equal((generalResponse.body as any).policy.basePremium, "1000.00");
  assert.equal("passwordHash" in (generalResponse.body as any).policy, false);
  assert.deepEqual(general.calls, [
    {
      input: generalBody(),
      policyId: POLICY_ID,
      userId: ADMIN_ID,
    },
  ]);

  const override = createFixture();
  const overrideResponse = await invoke(override, overrideBody(), "admin");
  assert.equal(overrideResponse.status, 200);
  assert.deepEqual(override.calls, [
    {
      input: overrideBody(),
      policyId: POLICY_ID,
      userId: ADMIN_ID,
    },
  ]);
});

test("employee, producer, inactive, and anonymous callers receive no correction payload", async () => {
  for (const identity of [
    undefined,
    "employee",
    "producer",
    "inactive",
  ] as const) {
    const fixture = createFixture();
    const response = await invoke(fixture, generalBody(), identity);
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
});

test("mixed, immutable, no-reason, stale-shape, and invalid-money requests reject before mutation", async () => {
  for (const body of [
    {
      ...generalBody(),
      change: {
        changedFields: ["brokerFee"],
        reason: "Wrong path",
        replacementValues: { brokerFee: "20.00" },
      },
    },
    {
      ...overrideBody(),
      change: {
        changedFields: ["insuredName"],
        reason: "Wrong path",
        replacementValues: { insuredName: "Wrong" },
      },
    },
    {
      ...generalBody(),
      change: {
        changedFields: ["insuredName"],
        reason: " ",
        replacementValues: { insuredName: "Corrected" },
      },
    },
    {
      ...generalBody(),
      change: {
        changedFields: ["mgaPaid"],
        reason: "Immutable",
        replacementValues: { mgaPaid: true },
      },
    },
    {
      ...overrideBody(),
      change: {
        changedFields: ["brokerFee"],
        reason: "Invalid money",
        replacementValues: { brokerFee: "20.0" },
      },
    },
    { ...generalBody(), expectedUpdatedAt: "not-a-timestamp" },
    { ...generalBody(), actorUserId: ADMIN_ID },
  ]) {
    const fixture = createFixture();
    const response = await invoke(fixture, body, "admin");
    assert.equal(response.status, 400);
    assert.deepEqual(fixture.calls, []);
  }
});

test("known correction failures map to minimal not-found, stale, and invalid responses", async () => {
  for (const [error, status, message] of [
    [new PolicyLedgerCorrectionNotFoundError(), 404, "Policy not found"],
    [
      new PolicyLedgerCorrectionStaleError(),
      409,
      "Policy changed; reload before correcting",
    ],
    [
      new PolicyLedgerCorrectionValidationError(),
      400,
      "Policy correction is invalid",
    ],
  ] as const) {
    const fixture = createFixture(error);
    const response = await invoke(fixture, generalBody(), "admin");
    assert.equal(response.status, status);
    assert.equal((response.body as any).error.message, message);
    assert.equal(JSON.stringify(response.body).includes("replacementValues"), false);
  }
});

test("correction route is explicitly admin-guarded and its handler fails closed alone", async () => {
  const fixture = createFixture();
  assert.equal(fixture.registration.path, POLICY_LEDGER_CORRECTION_PATH);
  assert.equal(
    typeof fixture.registration.access.authorization,
    "function",
  );
  assert.equal("public" in fixture.registration.access, false);

  const req = request(generalBody(), ADMIN_ID);
  const response = createTestResponse();
  fixture.registration.handler(req, response.res, response.next);
  const error = await response.completed;
  assert.notEqual(error, null);
  assert.equal(errorResult(error).status, 500);
  assert.deepEqual(fixture.calls, []);
});

function generalBody() {
  return {
    change: {
      changedFields: ["insuredName", "notes"],
      reason: "Correct the bound record",
      replacementValues: {
        insuredName: "Corrected Insured",
        notes: null,
      },
    },
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    kind: "general",
  } as const;
}

function overrideBody() {
  return {
    change: {
      changedFields: ["brokerFee"],
      reason: "Correct the agency fee",
      replacementValues: { brokerFee: "75.00" },
    },
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    kind: "override",
  } as const;
}

function policy(): PolicyRecord {
  const at = new Date(EXPECTED_UPDATED_AT);
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
    financeBalance: "725.00",
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
    deletedAt: null,
    deletedByUserId: null,
    deleteReason: null,
    mgaPayReference: null,
    netDue: "175.00",
    netDueTotal: "700.00",
    notes: "Private notes",
    officeLocationId: "00000000-0000-4000-8000-000000000022",
    overridden: false,
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
  const at = new Date(EXPECTED_UPDATED_AT);
  return {
    createdAt: at,
    displayName: id,
    email: `${id}@example.test`,
    id,
    isActive,
    passwordChangeRequiredAt: null,
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
  body: unknown,
  identity?: Identity,
): Promise<TestResult> {
  const userId =
    identity === "admin"
      ? ADMIN_ID
      : identity === "employee"
        ? EMPLOYEE_ID
        : identity === "producer"
          ? PRODUCER_ID
          : identity === "inactive"
            ? INACTIVE_ID
            : undefined;
  const req = request(body, userId);
  const response = createTestResponse();
  const guard = fixture.registration.access.authorization;
  assert.ok(guard);
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) return errorResult(guardError);
  fixture.registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

function request(body: unknown, userId?: string): Request {
  return {
    body,
    headers: {},
    method: "PATCH",
    originalUrl: POLICY_LEDGER_CORRECTION_PATH,
    params: { policyId: POLICY_ID },
    route: { path: POLICY_LEDGER_CORRECTION_PATH },
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
