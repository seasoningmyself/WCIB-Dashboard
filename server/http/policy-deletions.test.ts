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
import type {
  DeletedPolicyLedgerSourceItem,
  PolicyLedgerSourceItem,
} from "../policies/ledger.js";
import { toErrorResponse } from "./errors.js";
import {
  DELETED_POLICY_LIST_PATH,
  POLICY_RESTORE_PATH,
  POLICY_SOFT_DELETE_PATH,
  registerPolicyDeletionRoutes,
  type RegisterPolicyDeletionRoutesOptions,
} from "./policy-deletions.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const POLICY_ID = "00000000-0000-4000-8000-000000000010";
const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  method: "GET" | "POST";
  path: string;
}

function createFixture() {
  const users = new Map<string, UserAccount>([
    [ADMIN_ID, account(ADMIN_ID)],
    [PRODUCER_ID, account(PRODUCER_ID)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [ADMIN_ID, principal(ADMIN_ID, { capabilities: ["admin"] })],
    [PRODUCER_ID, principal(PRODUCER_ID, { staffRole: "producer" })],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, { staffRole: "employee" })],
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
  const calls: string[] = [];
  const registrations: Registration[] = [];
  const deleted = deletedSource();
  const active = activeSource();
  const options: RegisterPolicyDeletionRoutesOptions = {
    authorization,
    async list() {
      calls.push("list");
      return [deleted];
    },
    logger,
    async restore() {
      calls.push("restore");
      return { changed: true, source: active };
    },
    async softDelete() {
      calls.push("soft-delete");
      return { changed: true, detachedOpenSheetCount: 2, source: deleted };
    },
  };
  const routes = {
    get(path: string, access: RouteAccessDeclaration, ...handlers: RequestHandler[]) {
      assert.ok(handlers[0]);
      registrations.push({ access, handler: handlers[0], method: "GET", path });
    },
    post(path: string, access: RouteAccessDeclaration, ...handlers: RequestHandler[]) {
      assert.ok(handlers[0]);
      registrations.push({ access, handler: handlers[0], method: "POST", path });
    },
  } as unknown as RouteRegistrar;
  registerPolicyDeletionRoutes(routes, options);
  return { calls, registrations };
}

test("admin policy deletion routes return only projected records", async () => {
  const fixture = createFixture();
  const list = await invoke(fixture, DELETED_POLICY_LIST_PATH, { identity: "admin" });
  assert.equal(list.status, 200);
  assert.equal((list.body as any).items[0].deletion.reason, "Duplicate entry");
  assert.equal("passwordHash" in (list.body as any).items[0].policy, false);

  const removed = await invoke(fixture, POLICY_SOFT_DELETE_PATH, {
    body: {
      expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
      reason: "Duplicate entry",
    },
    identity: "admin",
    params: { policyId: POLICY_ID },
  });
  assert.equal(removed.status, 200);
  assert.equal((removed.body as any).detachedOpenSheetCount, 2);
  assert.equal("passwordHash" in (removed.body as any).item.policy, false);

  const restored = await invoke(fixture, POLICY_RESTORE_PATH, {
    body: { expectedUpdatedAt: "2026-07-15T12:00:00.000Z" },
    identity: "admin",
    params: { policyId: POLICY_ID },
  });
  assert.equal(restored.status, 200);
  assert.equal((restored.body as any).item.policy.id, POLICY_ID);
  assert.equal("deletion" in (restored.body as any).item, false);
  assert.deepEqual(fixture.calls, ["list", "soft-delete", "restore"]);
});

test("employee, producer, and anonymous callers receive no deletion payload", async () => {
  for (const identity of [undefined, "employee", "producer"] as const) {
    for (const path of [DELETED_POLICY_LIST_PATH, POLICY_SOFT_DELETE_PATH, POLICY_RESTORE_PATH]) {
      const fixture = createFixture();
      const response = await invoke(fixture, path, {
        body: path === POLICY_SOFT_DELETE_PATH
          ? { expectedUpdatedAt: "2026-07-14T12:00:00.000Z", reason: "Reason" }
          : { expectedUpdatedAt: "2026-07-15T12:00:00.000Z" },
        identity,
        params: { policyId: POLICY_ID },
      });
      assert.equal(response.status, identity === undefined ? 401 : 403);
      assert.deepEqual(fixture.calls, []);
      assert.equal(JSON.stringify(response.body).includes(POLICY_ID), false);
    }
  }
});

test("all policy deletion routes declare admin authorization and fail closed", async () => {
  const fixture = createFixture();
  assert.deepEqual(
    fixture.registrations.map(({ access, method, path }) => ({
      authorized: typeof access.authorization === "function",
      method,
      path,
      public: "public" in access,
    })),
    [
      { authorized: true, method: "GET", path: DELETED_POLICY_LIST_PATH, public: false },
      { authorized: true, method: "POST", path: POLICY_SOFT_DELETE_PATH, public: false },
      { authorized: true, method: "POST", path: POLICY_RESTORE_PATH, public: false },
    ],
  );
  const registration = fixture.registrations[0]!;
  const response = createTestResponse();
  registration.handler(
    request(registration.path, {}, {}, undefined),
    response.res,
    response.next,
  );
  const error = await response.completed;
  assert.notEqual(error, null);
  assert.equal(errorResult(error).status, 500);
  assert.deepEqual(fixture.calls, []);
});

function activeSource(): PolicyLedgerSourceItem {
  return { duplicate: null, labels: labels(), policy: policy() };
}

function deletedSource(): DeletedPolicyLedgerSourceItem {
  return {
    labels: labels(),
    policy: {
      ...policy(),
      deletedAt: new Date("2026-07-15T12:00:00.000Z"),
      deletedByUserId: ADMIN_ID,
      deleteReason: "Duplicate entry",
      passwordHash: "must-not-leak",
    } as PolicyRecord,
  };
}

function labels() {
  return {
    carrierName: "Carrier",
    mgaName: "MGA",
    officeName: "Office",
    policyTypeClass: "Commercial" as const,
    policyTypeName: "General Liability",
    producerDisplayName: "Kaylee",
    submitterDisplayName: "Mercedes",
  };
}

function policy(): PolicyRecord {
  const at = new Date("2026-07-14T12:00:00.000Z");
  return {
    accountAssignment: "book", amountPaid: "1000.00", approvedAt: at,
    balanceDueDate: null, basePremium: "1000.00", brokerFee: "50.00",
    carrierId: "00000000-0000-4000-8000-000000000020", collectedToDate: "0.00",
    commissionAmount: "100.00", commissionConfirmed: true, commissionMode: "pct",
    commissionRate: "10.0000", companyName: null, createdAt: at,
    deleteReason: null, deletedAt: null, deletedByUserId: null, depositOption: "0.00",
    effectiveDate: "2026-07-01", expirationDate: "2027-07-01", financeBalance: "0.00",
    financeContact: null, financeMeta: null, financeReference: null, id: POLICY_ID,
    insuredName: "Private Insured", invoiceNumber: null, ipfsFinanced: null,
    ipfsManual: false, ipfsPushed: false, ipfsPushedAt: null, ipfsReturning: null,
    kayleeSplit: "book", mgaFee: "0.00",
    mgaId: "00000000-0000-4000-8000-000000000021", mgaPaid: false,
    mgaPaidAt: null, mgaPayReference: null, netDue: "850.00", netDueTotal: "0.00",
    notes: null, officeLocationId: "00000000-0000-4000-8000-000000000022",
    overridden: false, payableStatus: "paid", paymentMode: "full",
    policyNumber: "POL-100", policyTypeId: "00000000-0000-4000-8000-000000000023",
    premiumTotal: "0.00", producerCommissionReceivedAt: null,
    producerUserId: PRODUCER_ID, proposalTotal: "1050.00", receivableStatus: "paid",
    remittedToMga: "0.00", sourceDraftId: null, submittedAt: at,
    submittedByUserId: EMPLOYEE_ID, taxes: "0.00", transactionNotes: null,
    transactionType: "New", updatedAt: at,
  };
}

function account(id: string): UserAccount {
  const at = new Date("2026-07-14T12:00:00.000Z");
  return {
    createdAt: at,
    displayName: id,
    email: `${id}@example.test`,
    id,
    isActive: true,
    passwordChangeRequiredAt: null,
    sessionVersion: 0,
  };
}

function principal(id: string, access: Partial<AccessPrincipal> = {}): AccessPrincipal {
  return { capabilities: [], staffRole: null, userActive: true, userId: id, ...access };
}

type Identity = "admin" | "employee" | "producer";

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  path: string,
  options: {
    body?: unknown;
    identity?: Identity;
    params?: Record<string, string>;
  },
): Promise<TestResult> {
  const registration = fixture.registrations.find((item) => item.path === path);
  assert.ok(registration);
  const userId = options.identity === "admin"
    ? ADMIN_ID
    : options.identity === "employee"
      ? EMPLOYEE_ID
      : options.identity === "producer"
        ? PRODUCER_ID
        : undefined;
  const req = request(path, options.params ?? {}, options.body ?? {}, userId);
  const response = createTestResponse();
  const guard = registration.access.authorization;
  assert.ok(guard);
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) return errorResult(guardError);
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

function request(
  path: string,
  params: Record<string, string>,
  body: unknown,
  userId?: string,
): Request {
  return {
    body, headers: {}, method: "POST", originalUrl: path, params, query: {},
    route: { path }, session: fakeSession(userId),
  } as unknown as Request;
}

function fakeSession(userId?: string): Request["session"] {
  const session = { cookie: {}, destroy(callback: (error?: unknown) => void) { callback(); } } as unknown as Request["session"];
  if (userId !== undefined) {
    session.userId = userId;
    session.sessionVersion = 0;
  }
  return session;
}

interface TestResult { body: unknown; headers: Record<string, string>; status: number }

function createTestResponse() {
  let status = 200;
  let body: unknown;
  const headers: Record<string, string> = {};
  let resolveCompleted!: (error: unknown | null) => void;
  const completed = new Promise<unknown | null>((resolve) => { resolveCompleted = resolve; });
  const res = {
    locals: {},
    clearCookie() { return res; },
    json(value: unknown) { body = value; resolveCompleted(null); return res; },
    set(name: string, value: string) { headers[name.toLowerCase()] = value; return res; },
    status(value: number) { status = value; return res; },
  } as unknown as Response;
  return {
    completed,
    next(error?: unknown) { resolveCompleted(error ?? null); },
    res,
    result: (): TestResult => ({ body, headers, status }),
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
  return { body: response.response, headers: {}, status: response.statusCode };
}
