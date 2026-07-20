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
  PolicyIpfsPushedNotFoundError,
  PolicyIpfsPushedStaleError,
  PolicyIpfsPushedValidationError,
} from "../policies/ipfs-pushed.js";
import type { PolicyLedgerSourceItem } from "../policies/ledger.js";
import { toErrorResponse } from "./errors.js";
import {
  POLICY_IPFS_PUSHED_PATH,
  registerPolicyIpfsPushedRoute,
  type RegisterPolicyIpfsPushedRouteOptions,
} from "./ipfs-pushed.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const INACTIVE_ID = "00000000-0000-4000-8000-000000000004";
const POLICY_ID = "00000000-0000-4000-8000-000000000010";
const UPDATED_AT = "2026-07-11T12:00:00.000Z";
const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  path: string;
}

function createFixture(
  error?:
    | PolicyIpfsPushedNotFoundError
    | PolicyIpfsPushedStaleError
    | PolicyIpfsPushedValidationError,
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
    [INACTIVE_ID, principal(INACTIVE_ID, { staffRole: "employee", userActive: false })],
  ]);
  const authorization = createAuthorizationGuards({
    async findUser(userId) { return users.get(userId) ?? null; },
    async loadPrincipal(userId) { return principals.get(userId) ?? null; },
    logger,
  });
  const calls: Array<{ input: unknown; policyId: string; userId: string }> = [];
  const registrations: Registration[] = [];
  const options: RegisterPolicyIpfsPushedRouteOptions = {
    authorization,
    logger,
    async setState(context, policyId, input) {
      calls.push({ input, policyId, userId: context.principal.userId });
      if (error !== undefined) throw error;
      const source = sourceItem();
      source.policy.ipfsPushed = (input as { pushed: boolean }).pushed;
      source.policy.ipfsPushedAt = source.policy.ipfsPushed
        ? new Date("2026-07-14T12:00:00.000Z")
        : null;
      return { changed: true, source };
    },
  };
  const routes = {
    patch(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      assert.ok(handlers[0]);
      registrations.push({ access, handler: handlers[0], path });
    },
  } as unknown as RouteRegistrar;
  registerPolicyIpfsPushedRoute(routes, options);
  return { calls, registration: registrations[0]! };
}

test("admin marks IPFS pushed state and receives only a projected ledger item", async () => {
  const fixture = createFixture();
  const result = await invoke(fixture, body(true), "admin");
  assert.equal(result.status, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal((result.body as any).changed, true);
  assert.equal((result.body as any).item.policy.ipfsPushed, true);
  assert.equal(
    (result.body as any).item.policy.ipfsPushedAt,
    "2026-07-14T12:00:00.000Z",
  );
  assert.equal("passwordHash" in (result.body as any).item.policy, false);
  assert.deepEqual(fixture.calls, [{
    input: body(true),
    policyId: POLICY_ID,
    userId: ADMIN_ID,
  }]);
});

test("employee, producer, inactive, and anonymous callers receive no policy payload", async () => {
  for (const identity of [undefined, "employee", "producer", "inactive"] as const) {
    const fixture = createFixture();
    const result = await invoke(fixture, body(true), identity);
    assert.equal(
      result.status,
      identity === undefined || identity === "inactive" ? 401 : 403,
    );
    assert.deepEqual(fixture.calls, []);
    const serialized = JSON.stringify(result.body);
    assert.equal(serialized.includes(POLICY_ID), false);
    assert.equal(serialized.includes("basePremium"), false);
    assert.equal(serialized.includes("Private Insured"), false);
  }
});

test("invalid pushed-state shapes reject before mutation", async () => {
  for (const invalid of [
    { pushed: true },
    { expectedUpdatedAt: UPDATED_AT },
    { expectedUpdatedAt: "not-a-time", pushed: true },
    { actorUserId: ADMIN_ID, expectedUpdatedAt: UPDATED_AT, pushed: true },
  ]) {
    const fixture = createFixture();
    const result = await invoke(fixture, invalid, "admin");
    assert.equal(result.status, 400);
    assert.deepEqual(fixture.calls, []);
  }
});

test("known pushed-state failures map to minimal responses", async () => {
  for (const [error, status] of [
    [new PolicyIpfsPushedNotFoundError(), 404],
    [new PolicyIpfsPushedStaleError(), 409],
    [new PolicyIpfsPushedValidationError(), 400],
  ] as const) {
    const fixture = createFixture(error);
    const result = await invoke(fixture, body(true), "admin");
    assert.equal(result.status, status);
    assert.equal(JSON.stringify(result.body).includes("Private Insured"), false);
  }
});

test("IPFS pushed route is explicitly guarded and fails closed without auth context", async () => {
  const fixture = createFixture();
  assert.equal(fixture.registration.path, POLICY_IPFS_PUSHED_PATH);
  assert.equal(typeof fixture.registration.access.authorization, "function");
  assert.equal("public" in fixture.registration.access, false);

  const response = createTestResponse();
  fixture.registration.handler(
    request(body(true)),
    response.res,
    response.next,
  );
  const error = await response.completed;
  assert.notEqual(error, null);
  assert.equal(errorResult(error).status, 500);
  assert.deepEqual(fixture.calls, []);
});

function body(pushed: boolean) {
  return { expectedUpdatedAt: UPDATED_AT, pushed };
}

function sourceItem(): PolicyLedgerSourceItem {
  return {
    duplicate: null,
    labels: {
      carrierName: "Carrier",
      mgaName: "MGA",
      officeName: "Office",
      policyTypeClass: "Commercial",
      policyTypeName: "General Liability",
      producerDisplayName: "Producer",
      submitterDisplayName: "Employee",
    },
    policy: {
      ...policy(),
      passwordHash: "must-not-leak",
    } as PolicyRecord,
  };
}

function policy(): PolicyRecord {
  const at = new Date(UPDATED_AT);
  return {
    accountAssignment: "book",
    amountPaid: "350.00",
    approvedAt: at,
    balanceDueDate: null,
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: "00000000-0000-4000-8000-000000000020",
    collectedToDate: "0.00",
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: null,
    createdAt: at,
    deletedAt: null,
    deletedByUserId: null,
    deleteReason: null,
    depositOption: "350.00",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "725.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
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
    mgaPayReference: null,
    netDue: "175.00",
    netDueTotal: "0.00",
    notes: null,
    officeLocationId: "00000000-0000-4000-8000-000000000022",
    overridden: false,
    payableStatus: "paid",
    paymentMode: "deposit",
    policyNumber: "GL-100",
    policyTypeId: "00000000-0000-4000-8000-000000000023",
    premiumTotal: "0.00",
    producerCommissionReceivedAt: null,
    producerUserId: PRODUCER_ID,
    proposalTotal: "1075.00",
    receivableStatus: "paid",
    remittedToMga: "0.00",
    sourceDraftId: null,
    submittedAt: at,
    submittedByUserId: EMPLOYEE_ID,
    taxes: "0.00",
    transactionNotes: null,
    transactionType: "New",
    updatedAt: at,
  };
}

function account(id: string, isActive = true): UserAccount {
  return {
    createdAt: new Date(UPDATED_AT),
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
  requestBody: unknown,
  identity?: Identity,
): Promise<TestResult> {
  const userId = identity === "admin"
    ? ADMIN_ID
    : identity === "employee"
      ? EMPLOYEE_ID
      : identity === "producer"
        ? PRODUCER_ID
        : identity === "inactive"
          ? INACTIVE_ID
          : undefined;
  const req = request(requestBody, userId);
  const response = createTestResponse();
  const guard = fixture.registration.access.authorization;
  assert.ok(guard);
  const guardError = await invokeMiddleware(guard, req, response.res);
  if (guardError !== null) return errorResult(guardError);
  fixture.registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

function request(requestBody: unknown, userId?: string): Request {
  const session = {
    cookie: {},
    destroy(callback: (error?: unknown) => void) { callback(); },
  } as unknown as Request["session"];
  if (userId !== undefined) {
    session.userId = userId;
    session.sessionVersion = 0;
  }
  return {
    body: requestBody,
    headers: {},
    method: "PATCH",
    originalUrl: POLICY_IPFS_PUSHED_PATH,
    params: { policyId: POLICY_ID },
    route: { path: POLICY_IPFS_PUSHED_PATH },
    session,
  } as unknown as Request;
}

interface TestResult {
  body: unknown;
  headers: Record<string, string>;
  status: number;
}

function createTestResponse() {
  let status = 200;
  let bodyValue: unknown;
  const headers: Record<string, string> = {};
  let resolveCompleted!: (error: unknown | null) => void;
  const completed = new Promise<unknown | null>((resolve) => {
    resolveCompleted = resolve;
  });
  const res = {
    clearCookie() { return res; },
    locals: {},
    json(value: unknown) { bodyValue = value; resolveCompleted(null); return res; },
    set(name: string, value: string) { headers[name.toLowerCase()] = value; return res; },
    status(value: number) { status = value; return res; },
  } as unknown as Response;
  return {
    completed,
    next(error?: unknown) { resolveCompleted(error ?? null); },
    res,
    result: (): TestResult => ({ body: bodyValue, headers, status }),
  };
}

async function invokeMiddleware(
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
