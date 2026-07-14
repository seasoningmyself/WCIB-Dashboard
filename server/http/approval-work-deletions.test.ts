import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Request,
  RequestHandler,
  Response,
} from "express";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { UserAccount } from "../auth/users.js";
import type { ApprovalWorkDeletionSource } from "../approval-queue/soft-delete.js";
import type {
  ApprovalQueueEntryRecord,
  DraftRecord,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { toErrorResponse } from "./errors.js";
import {
  APPROVAL_HELP_RESTORE_PATH,
  APPROVAL_HELP_SOFT_DELETE_PATH,
  APPROVAL_SUBMISSION_RESTORE_PATH,
  APPROVAL_SUBMISSION_SOFT_DELETE_PATH,
  DELETED_APPROVAL_WORK_LIST_PATH,
  registerApprovalWorkDeletionRoutes,
  type RegisterApprovalWorkDeletionRoutesOptions,
} from "./approval-work-deletions.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const QUEUE_ID = "00000000-0000-4000-8000-000000000010";
const DRAFT_ID = "00000000-0000-4000-8000-000000000011";
const HELP_ID = "00000000-0000-4000-8000-000000000012";
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
  const options: RegisterApprovalWorkDeletionRoutesOptions = {
    authorization,
    async list() {
      calls.push("list");
      return [submissionSource(true), helpSource(true)];
    },
    logger,
    async restore(_context, kind) {
      calls.push(`restore:${kind}`);
      return {
        changed: true,
        source: kind === "submission" ? submissionSource(false) : helpSource(false),
      };
    },
    async softDelete(_context, kind) {
      calls.push(`soft-delete:${kind}`);
      return {
        changed: true,
        source: kind === "submission" ? submissionSource(true) : helpSource(true),
      };
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
  registerApprovalWorkDeletionRoutes(routes, options);
  return { calls, registrations };
}

test("admin approval-work deletion routes return only projected records", async () => {
  const fixture = createFixture();
  const listed = await invoke(fixture, DELETED_APPROVAL_WORK_LIST_PATH, {
    identity: "admin",
  });
  assert.equal(listed.status, 200);
  assert.equal((listed.body as any).items.length, 2);
  assert.equal((listed.body as any).items[0].deletion.reason, "Duplicate work");
  assert.equal(JSON.stringify(listed.body).includes("passwordHash"), false);

  for (const [path, id] of [
    [APPROVAL_SUBMISSION_SOFT_DELETE_PATH, QUEUE_ID],
    [APPROVAL_HELP_SOFT_DELETE_PATH, HELP_ID],
  ] as const) {
    const response = await invoke(fixture, path, {
      body: {
        expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
        reason: "Duplicate work",
      },
      identity: "admin",
      params: { id },
    });
    assert.equal(response.status, 200);
    assert.equal((response.body as any).item.deletion.reason, "Duplicate work");
    assert.equal(JSON.stringify(response.body).includes("passwordHash"), false);
  }

  for (const [path, id] of [
    [APPROVAL_SUBMISSION_RESTORE_PATH, QUEUE_ID],
    [APPROVAL_HELP_RESTORE_PATH, HELP_ID],
  ] as const) {
    const response = await invoke(fixture, path, {
      body: { expectedUpdatedAt: "2026-07-15T12:00:00.000Z" },
      identity: "admin",
      params: { id },
    });
    assert.equal(response.status, 200);
    assert.equal("deletion" in (response.body as any).item, false);
    assert.equal(JSON.stringify(response.body).includes("passwordHash"), false);
  }
  assert.deepEqual(fixture.calls, [
    "list",
    "soft-delete:submission",
    "soft-delete:help",
    "restore:submission",
    "restore:help",
  ]);
});

test("employee, producer, and anonymous callers receive zero deletion payload", async () => {
  for (const identity of [undefined, "employee", "producer"] as const) {
    for (const path of [
      DELETED_APPROVAL_WORK_LIST_PATH,
      APPROVAL_SUBMISSION_SOFT_DELETE_PATH,
      APPROVAL_HELP_SOFT_DELETE_PATH,
      APPROVAL_SUBMISSION_RESTORE_PATH,
      APPROVAL_HELP_RESTORE_PATH,
    ]) {
      const fixture = createFixture();
      const response = await invoke(fixture, path, {
        body: path.includes("soft-delete")
          ? {
              expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
              reason: "Reason",
            }
          : { expectedUpdatedAt: "2026-07-15T12:00:00.000Z" },
        identity,
        params: { id: QUEUE_ID },
      });
      assert.equal(response.status, identity === undefined ? 401 : 403);
      assert.deepEqual(fixture.calls, []);
      assert.equal(JSON.stringify(response.body).includes(QUEUE_ID), false);
    }
  }
});

test("all approval-work deletion routes declare admin authorization and fail closed", async () => {
  const fixture = createFixture();
  assert.deepEqual(
    fixture.registrations.map(({ access, method, path }) => ({
      authorized: typeof access.authorization === "function",
      method,
      path,
      public: "public" in access,
    })),
    [
      { authorized: true, method: "GET", path: DELETED_APPROVAL_WORK_LIST_PATH, public: false },
      { authorized: true, method: "POST", path: APPROVAL_SUBMISSION_SOFT_DELETE_PATH, public: false },
      { authorized: true, method: "POST", path: APPROVAL_HELP_SOFT_DELETE_PATH, public: false },
      { authorized: true, method: "POST", path: APPROVAL_SUBMISSION_RESTORE_PATH, public: false },
      { authorized: true, method: "POST", path: APPROVAL_HELP_RESTORE_PATH, public: false },
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

function submissionSource(deleted: boolean): ApprovalWorkDeletionSource {
  return {
    entry: queueEntry(deleted),
    kind: "submission",
    submitterDisplayName: "Mercedes",
  };
}

function helpSource(deleted: boolean): ApprovalWorkDeletionSource {
  return {
    draft: draft(deleted),
    kind: "help",
    submitterDisplayName: "Kaylee",
  };
}

function queueEntry(
  deleted: boolean,
): ApprovalQueueEntryRecord & Record<string, unknown> {
  const at = new Date("2026-07-14T12:00:00.000Z");
  return {
    actedAt: null,
    actedByUserId: null,
    createdAt: at,
    deleteReason: deleted ? "Duplicate work" : null,
    deletedAt: deleted ? new Date("2026-07-15T12:00:00.000Z") : null,
    deletedByUserId: deleted ? ADMIN_ID : null,
    draftId: DRAFT_ID,
    id: QUEUE_ID,
    passwordHash: "must-not-leak",
    reason: null,
    status: "pending",
    submittedAt: at,
    submittedByUserId: EMPLOYEE_ID,
    submittedPayload: {
      basePremium: "1000.00",
      insuredName: "Private submission",
      schemaVersion: 1,
    },
    updatedAt: deleted ? new Date("2026-07-15T12:00:00.000Z") : at,
  };
}

function draft(deleted: boolean): DraftRecord & Record<string, unknown> {
  const at = new Date("2026-07-14T12:00:00.000Z");
  return {
    accountAssignment: "none",
    amountPaid: "250.00",
    basePremium: "1000.00",
    brokerFee: "20.00",
    carrierId: null,
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: null,
    createdAt: at,
    deleteReason: deleted ? "Duplicate work" : null,
    deletedAt: deleted ? new Date("2026-07-15T12:00:00.000Z") : null,
    deletedByUserId: deleted ? ADMIN_ID : null,
    depositOption: "0.00",
    effectiveDate: "2026-07-11",
    expirationDate: "2027-07-11",
    financeBalance: "750.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    flagReason: "Need admin help",
    history: [],
    id: HELP_ID,
    insuredName: "Private help draft",
    invoiceNumber: null,
    ipfsFinanced: "no",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: null,
    lastEditedAt: deleted ? new Date("2026-07-15T12:00:00.000Z") : at,
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaFee: "10.00",
    mgaId: null,
    netDue: "905.00",
    notes: null,
    officeLocationId: null,
    ownerUserId: EMPLOYEE_ID,
    passwordHash: "must-not-leak",
    paymentMode: "full",
    policyNumber: "FLAG-1",
    policyTypeId: null,
    producerUserId: null,
    proposalTotal: "1030.00",
    schemaVersion: 1,
    sentBackAt: null,
    sentBackByUserId: null,
    sentBackReason: null,
    status: "flagged",
    submittedAt: null,
    taxes: "0.00",
    transactionNotes: null,
    transactionType: "New",
  };
}

function account(id: string): UserAccount {
  const at = new Date("2026-07-14T12:00:00.000Z");
  return {
    createdAt: at,
    email: `${id}@example.test`,
    id,
    isActive: true,
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
  const userId =
    options.identity === "admin"
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
    body,
    headers: {},
    method: path === DELETED_APPROVAL_WORK_LIST_PATH ? "GET" : "POST",
    originalUrl: path,
    params,
    query: {},
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

function createTestResponse() {
  let status = 200;
  let body: unknown;
  const headers: Record<string, string> = {};
  let resolveCompleted!: (error: unknown | null) => void;
  const completed = new Promise<unknown | null>((resolve) => {
    resolveCompleted = resolve;
  });
  const res = {
    locals: {},
    clearCookie() {
      return res;
    },
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
