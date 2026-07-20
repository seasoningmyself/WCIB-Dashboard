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
import type {
  ApprovalQueueEntryRecord,
  DraftRecord,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { toErrorResponse } from "./errors.js";
import {
  APPROVAL_WORK_PATH,
  registerApprovalWorkRoute,
  type RegisterApprovalWorkRouteOptions,
} from "./approval-queue.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const UNASSIGNED_ID = "00000000-0000-4000-8000-000000000004";
const INACTIVE_ID = "00000000-0000-4000-8000-000000000005";
const DRAFT_ID = "00000000-0000-4000-8000-000000000010";
const QUEUE_ID = "00000000-0000-4000-8000-000000000020";
const POLICY_ID = "00000000-0000-4000-8000-000000000021";
const CHANGE_REQUEST_ID = "00000000-0000-4000-8000-000000000022";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  path: string;
}

function createFixture(options: { empty?: boolean } = {}) {
  const users = new Map<string, UserAccount>([
    [ADMIN_ID, account(ADMIN_ID)],
    [PRODUCER_ID, account(PRODUCER_ID)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
    [UNASSIGNED_ID, account(UNASSIGNED_ID)],
    [INACTIVE_ID, account(INACTIVE_ID, false)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [ADMIN_ID, principal(ADMIN_ID, { capabilities: ["admin"] })],
    [PRODUCER_ID, principal(PRODUCER_ID, { staffRole: "producer" })],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, { staffRole: "employee" })],
    [UNASSIGNED_ID, principal(UNASSIGNED_ID)],
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
  const listCalls: unknown[] = [];
  const registration: Registration[] = [];
  const routeOptions: RegisterApprovalWorkRouteOptions = {
    authorization,
    async list(context, query) {
      listCalls.push({ query, userId: context.principal.userId });
      if (options.empty === true) {
        return { changeRequests: [], helpRequests: [], submissions: [] };
      }
      return {
        changeRequests: [changeRequestSource()],
        helpRequests: [
          {
            draft: draft() as DraftRecord,
            submitterDisplayName: "Mercedes",
          },
        ],
        submissions: [
          {
            entry: queueEntry() as ApprovalQueueEntryRecord,
            submitterDisplayName: "Kaylee",
          },
        ],
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
      registration.push({ access, handler: handlers[0], path });
    },
  } as unknown as RouteRegistrar;
  registerApprovalWorkRoute(routes, routeOptions);
  return { listCalls, registration: registration[0]!, routeOptions };
}

test("active admin receives exact projected submission and flagged-help data", async () => {
  const fixture = createFixture();
  const response = await invoke(fixture, {}, "admin");
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const body = response.body as Record<string, unknown>;
  const submissions = body.submissions as Array<Record<string, unknown>>;
  const helpRequests = body.helpRequests as Array<Record<string, unknown>>;
  const changeRequests = body.changeRequests as Array<Record<string, unknown>>;
  assert.equal(submissions.length, 1);
  assert.equal(helpRequests.length, 1);
  assert.equal(changeRequests.length, 1);
  assert.equal(submissions[0]?.submitterDisplayName, "Kaylee");
  assert.deepEqual(
    (submissions[0]?.entry as Record<string, unknown>).submittedPayload,
    queueEntry().submittedPayload,
  );
  const projectedDraft = helpRequests[0]?.draft as Record<string, unknown>;
  assert.equal(projectedDraft.status, "flagged");
  assert.equal(projectedDraft.basePremium, "1000.00");
  for (const field of [
    "passwordHash",
    "producerPayout",
    "producerRate",
    "producerRateHistory",
  ]) {
    assert.equal(field in projectedDraft, false, field);
  }
  const projectedChange = changeRequests[0] as {
    request: Record<string, unknown>;
  };
  assert.equal(projectedChange.request.reason, "Correct the approved insured name");
  assert.equal("basePremium" in projectedChange.request, false);
  assert.equal("commissionAmount" in projectedChange.request, false);
  assert.equal("netDue" in projectedChange.request, false);
  assert.deepEqual(fixture.listCalls, [
    { query: { status: "all" }, userId: ADMIN_ID },
  ]);
});

test("every non-admin identity is denied before the queue query", async () => {
  for (const identity of [
    undefined,
    "employee",
    "producer",
    "unassigned",
    "inactive",
  ] as const) {
    const fixture = createFixture();
    const response = await invoke(fixture, { status: "flagged" }, identity);
    assert.equal(
      response.status,
      identity === undefined || identity === "inactive" ? 401 : 403,
    );
    assert.deepEqual(fixture.listCalls, []);
    assert.equal(JSON.stringify(response.body).includes("submittedPayload"), false);
  }
});

test("empty state and bounded status filters preserve the response contract", async () => {
  const empty = createFixture({ empty: true });
  const response = await invoke(empty, { status: "pending" }, "admin");
  assert.deepEqual(response.body, {
    changeRequests: [],
    helpRequests: [],
    submissions: [],
  });
  assert.deepEqual(empty.listCalls, [
    { query: { status: "pending" }, userId: ADMIN_ID },
  ]);

  const invalid = createFixture();
  const invalidResponse = await invoke(
    invalid,
    { ownerUserId: EMPLOYEE_ID, status: "all" },
    "admin",
  );
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(invalid.listCalls, []);
});

test("approval work route declares an admin authorization guard", () => {
  const fixture = createFixture();
  assert.equal(fixture.registration.path, APPROVAL_WORK_PATH);
  assert.equal(typeof fixture.registration.access.authorization, "function");
  assert.equal("public" in fixture.registration.access, false);
});

function queueEntry(): ApprovalQueueEntryRecord & Record<string, unknown> {
  const at = new Date("2026-07-11T12:00:00.000Z");
  return {
    actedAt: null,
    actedByUserId: null,
    createdAt: at,
    deleteReason: null,
    deletedAt: null,
    deletedByUserId: null,
    draftId: DRAFT_ID,
    id: QUEUE_ID,
    passwordHash: "must-not-leak",
    reason: null,
    status: "pending",
    submittedAt: at,
    submittedByUserId: EMPLOYEE_ID,
    submittedPayload: {
      basePremium: "1000.00",
      financeContact: { email: "private@example.test" },
      insuredName: "Private Insured",
      schemaVersion: 1,
    },
    updatedAt: at,
  };
}

function changeRequestSource() {
  const at = new Date("2026-07-14T12:00:00.000Z");
  return {
    insuredName: "Approved Insured",
    policyNumber: "CHANGE-001",
    requesterDisplayName: "Mercedes",
    request: {
      id: CHANGE_REQUEST_ID,
      mutationId: null,
      mutationKind: null,
      policyId: POLICY_ID,
      reason: "Correct the approved insured name",
      requestedAt: at,
      requestedByUserId: EMPLOYEE_ID,
      resolution: null,
      resolutionReason: null,
      resolvedAt: null,
      resolvedByUserId: null,
      status: "pending" as const,
    },
  };
}

function draft(): DraftRecord & Record<string, unknown> {
  const at = new Date("2026-07-11T12:00:00.000Z");
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
    deleteReason: null,
    deletedAt: null,
    deletedByUserId: null,
    depositOption: "0.00",
    effectiveDate: "2026-07-11",
    expirationDate: "2027-07-11",
    financeBalance: "750.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    flagReason: "Need admin help",
    history: [],
    id: DRAFT_ID,
    insuredName: "Flagged Insured",
    invoiceNumber: null,
    ipfsFinanced: "no",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: null,
    lastEditedAt: at,
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
    producerPayout: "31.25",
    producerRate: "25.0000",
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
    transactionType: "new_business",
  };
}

function account(id: string, isActive = true): UserAccount {
  const at = new Date("2026-07-11T12:00:00.000Z");
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

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  query: unknown,
  identity?: "admin" | "employee" | "producer" | "unassigned" | "inactive",
): Promise<TestResult> {
  const userId =
    identity === "admin"
      ? ADMIN_ID
      : identity === "employee"
        ? EMPLOYEE_ID
        : identity === "producer"
          ? PRODUCER_ID
          : identity === "unassigned"
            ? UNASSIGNED_ID
            : identity === "inactive"
              ? INACTIVE_ID
              : undefined;
  const req = {
    headers: {},
    method: "GET",
    originalUrl: APPROVAL_WORK_PATH,
    query,
    route: { path: APPROVAL_WORK_PATH },
    session: fakeSession(userId),
  } as unknown as Request;
  const response = createTestResponse();
  const guard = fixture.registration.access.authorization;
  assert.ok(guard);
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) {
    return errorResult(guardError);
  }
  fixture.registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
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
