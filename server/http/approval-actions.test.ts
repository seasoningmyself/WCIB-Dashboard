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
  PolicyRecord,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { ApprovalOverrideValidationError } from "../approval-queue/approve-with-override.js";
import { ApprovalItemStateError } from "../approval-queue/approve.js";
import { toErrorResponse } from "./errors.js";
import {
  APPROVE_SUBMISSION_PATH,
  APPROVE_WITH_OVERRIDE_PATH,
  OPEN_FIX_HELP_PATH,
  PUSH_THROUGH_HELP_PATH,
  SEND_BACK_HELP_PATH,
  SEND_BACK_SUBMISSION_PATH,
  registerApprovalActionRoutes,
  type RegisterApprovalActionRoutesOptions,
} from "./approval-actions.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const QUEUE_ID = "00000000-0000-4000-8000-000000000010";
const DRAFT_ID = "00000000-0000-4000-8000-000000000011";
const POLICY_ID = "00000000-0000-4000-8000-000000000012";
const OVERRIDE_ID = "00000000-0000-4000-8000-000000000013";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  path: string;
}

function createFixture(
  options: {
    fail?: boolean;
    failOverride?: boolean;
    failSendBack?: boolean;
  } = {},
) {
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
  const calls: Array<{ body?: unknown; id: string; kind: string }> = [];
  const registrations: Registration[] = [];
  const optionsForRoute: RegisterApprovalActionRoutesOptions = {
    async approve(_context, queueEntryId) {
      calls.push({ id: queueEntryId, kind: "approve" });
      if (options.fail === true) throw new ApprovalItemStateError();
      return policy();
    },
    async approveFixedHelp(_context, draftId, body) {
      calls.push({ body, id: draftId, kind: "fix" });
      return policy();
    },
    async approveWithOverride(_context, queueEntryId, body) {
      calls.push({ body, id: queueEntryId, kind: "approve-with-override" });
      if (options.failOverride === true) {
        throw new ApprovalOverrideValidationError();
      }
      return {
        originalValues: { brokerFee: "20.00" },
        overrideId: OVERRIDE_ID,
        policy: { ...policy(), brokerFee: "30.00", overridden: true },
      };
    },
    authorization,
    logger,
    async pushThroughHelp(_context, draftId) {
      calls.push({ id: draftId, kind: "push" });
      return policy();
    },
    async sendBackHelp(_context, draftId, body) {
      calls.push({ body, id: draftId, kind: "send-back-help" });
      if (options.failSendBack === true) throw new ApprovalItemStateError();
      return draft("sent_back");
    },
    async sendBackSubmission(_context, queueEntryId, body) {
      calls.push({ body, id: queueEntryId, kind: "send-back-submission" });
      if (options.failSendBack === true) throw new ApprovalItemStateError();
      return queueEntry("sent_back");
    },
  };
  const routes = {
    post(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      assert.ok(handlers[0]);
      registrations.push({ access, handler: handlers[0], path });
    },
  } as unknown as RouteRegistrar;
  registerApprovalActionRoutes(routes, optionsForRoute);
  return { calls, registrations };
}

test("admin approval accepts identity only and returns the admin policy projection", async () => {
  const fixture = createFixture();
  const response = await invoke(
    fixture,
    APPROVE_SUBMISSION_PATH,
    { queueEntryId: QUEUE_ID },
    {},
    "admin",
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal((response.body as any).policy.id, POLICY_ID);
  assert.equal("passwordHash" in (response.body as any).policy, false);
  assert.deepEqual(fixture.calls, [{ id: QUEUE_ID, kind: "approve" }]);

  const forged = createFixture();
  const rejected = await invoke(
    forged,
    APPROVE_SUBMISSION_PATH,
    { queueEntryId: QUEUE_ID },
    { basePremium: "0.00", submittedByUserId: ADMIN_ID },
    "admin",
  );
  assert.equal(rejected.status, 400);
  assert.deepEqual(forged.calls, []);
});

test("approval-time override returns only the final admin policy and safe identity", async () => {
  const fixture = createFixture();
  const response = await invoke(
    fixture,
    APPROVE_WITH_OVERRIDE_PATH,
    { queueEntryId: QUEUE_ID },
    {
      changedFields: ["commissionAmount", "brokerFee"],
      reason: "  Carrier corrected the bound figures  ",
      replacementValues: {
        brokerFee: "30.00",
        commissionAmount: "150.00",
      },
    },
    "admin",
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal((response.body as any).overrideId, OVERRIDE_ID);
  assert.equal((response.body as any).policy.id, POLICY_ID);
  assert.equal((response.body as any).policy.brokerFee, "30.00");
  assert.equal((response.body as any).policy.overridden, true);
  assert.equal("originalValues" in (response.body as any), false);
  assert.equal("passwordHash" in (response.body as any).policy, false);
  assert.deepEqual(fixture.calls, [
    {
      body: {
        changedFields: ["commissionAmount", "brokerFee"],
        reason: "Carrier corrected the bound figures",
        replacementValues: {
          brokerFee: "30.00",
          commissionAmount: "150.00",
        },
      },
      id: QUEUE_ID,
      kind: "approve-with-override",
    },
  ]);

  for (const body of [
    {
      changedFields: ["brokerFee"],
      reason: "   ",
      replacementValues: { brokerFee: "30.00" },
    },
    {
      changedFields: ["brokerFee"],
      reason: "Required",
      replacementValues: { brokerFee: "30.00", netDue: "70.00" },
    },
    {
      changedFields: ["insuredName"],
      reason: "Required",
      replacementValues: { insuredName: "Forged insured" },
    },
    {
      changedFields: ["brokerFee"],
      reason: "Required",
      replacementValues: { brokerFee: "30.00" },
      submittedPayload: { basePremium: "0.00" },
    },
  ]) {
    const invalid = createFixture();
    const invalidResponse = await invoke(
      invalid,
      APPROVE_WITH_OVERRIDE_PATH,
      { queueEntryId: QUEUE_ID },
      body,
      "admin",
    );
    assert.equal(invalidResponse.status, 400);
    assert.deepEqual(invalid.calls, []);
  }

  const rejected = createFixture({ failOverride: true });
  const rejectedResponse = await invoke(
    rejected,
    APPROVE_WITH_OVERRIDE_PATH,
    { queueEntryId: QUEUE_ID },
    {
      changedFields: ["brokerFee"],
      reason: "No actual change",
      replacementValues: { brokerFee: "20.00" },
    },
    "admin",
  );
  assert.equal(rejectedResponse.status, 400);
});

test("flagged push-through and open-fix are distinct allowlisted admin actions", async () => {
  const fixture = createFixture();
  const pushed = await invoke(
    fixture,
    PUSH_THROUGH_HELP_PATH,
    { draftId: DRAFT_ID },
    {},
    "admin",
  );
  assert.equal(pushed.status, 201);
  const fixed = await invoke(
    fixture,
    OPEN_FIX_HELP_PATH,
    { draftId: DRAFT_ID },
    { insuredName: "Corrected Insured" },
    "admin",
  );
  assert.equal(fixed.status, 201);
  assert.deepEqual(fixture.calls, [
    { id: DRAFT_ID, kind: "push" },
    {
      body: { insuredName: "Corrected Insured" },
      id: DRAFT_ID,
      kind: "fix",
    },
  ]);

  const rejected = createFixture();
  const unsafe = await invoke(
    rejected,
    OPEN_FIX_HELP_PATH,
    { draftId: DRAFT_ID },
    { ownerUserId: ADMIN_ID },
    "admin",
  );
  assert.equal(unsafe.status, 400);
  assert.deepEqual(rejected.calls, []);
});

test("pending and flagged send-back routes require reasons and exact projections", async () => {
  const fixture = createFixture();
  const pending = await invoke(
    fixture,
    SEND_BACK_SUBMISSION_PATH,
    { queueEntryId: QUEUE_ID },
    { reason: "  Correct the carrier  " },
    "admin",
  );
  assert.equal(pending.status, 200);
  assert.equal(pending.headers["cache-control"], "no-store");
  assert.equal((pending.body as any).entry.status, "sent_back");
  assert.equal((pending.body as any).entry.reason, "Correct the carrier");

  const flagged = await invoke(
    fixture,
    SEND_BACK_HELP_PATH,
    { draftId: DRAFT_ID },
    { reason: "  Complete the missing fields  " },
    "admin",
  );
  assert.equal(flagged.status, 200);
  assert.equal((flagged.body as any).draft.status, "sent_back");
  assert.equal((flagged.body as any).draft.flagReason, null);
  assert.equal(
    (flagged.body as any).draft.sentBackReason,
    "Complete the missing fields",
  );
  assert.deepEqual(fixture.calls, [
    {
      body: { reason: "Correct the carrier" },
      id: QUEUE_ID,
      kind: "send-back-submission",
    },
    {
      body: { reason: "Complete the missing fields" },
      id: DRAFT_ID,
      kind: "send-back-help",
    },
  ]);

  for (const body of [
    {},
    { reason: "   " },
    { reason: "x".repeat(501) },
    { reason: "No", ownerUserId: EMPLOYEE_ID },
  ]) {
    const invalid = createFixture();
    const response = await invoke(
      invalid,
      SEND_BACK_HELP_PATH,
      { draftId: DRAFT_ID },
      body,
      "admin",
    );
    assert.equal(response.status, 400);
    assert.deepEqual(invalid.calls, []);
  }
});

test("employee and producer are denied on every approval action before service access", async () => {
  for (const identity of [undefined, "employee", "producer"] as const) {
    for (const [path, params, body] of [
      [APPROVE_SUBMISSION_PATH, { queueEntryId: QUEUE_ID }, {}],
      [
        APPROVE_WITH_OVERRIDE_PATH,
        { queueEntryId: QUEUE_ID },
        {
          changedFields: ["brokerFee"],
          reason: "No access",
          replacementValues: { brokerFee: "30.00" },
        },
      ],
      [PUSH_THROUGH_HELP_PATH, { draftId: DRAFT_ID }, {}],
      [OPEN_FIX_HELP_PATH, { draftId: DRAFT_ID }, { insuredName: "No" }],
      [
        SEND_BACK_SUBMISSION_PATH,
        { queueEntryId: QUEUE_ID },
        { reason: "No access" },
      ],
      [SEND_BACK_HELP_PATH, { draftId: DRAFT_ID }, { reason: "No access" }],
    ] as const) {
      const fixture = createFixture();
      const response = await invoke(fixture, path, params, body, identity);
      assert.equal(response.status, identity === undefined ? 401 : 403);
      assert.deepEqual(fixture.calls, []);
      assert.equal(JSON.stringify(response.body).includes("basePremium"), false);
    }
  }
});

test("stale approval conflicts are safe and every action route is guarded", async () => {
  const failed = createFixture({ fail: true });
  const response = await invoke(
    failed,
    APPROVE_SUBMISSION_PATH,
    { queueEntryId: QUEUE_ID },
    {},
    "admin",
  );
  assert.equal(response.status, 409);
  for (const registration of failed.registrations) {
    assert.equal(typeof registration.access.authorization, "function");
    assert.equal("public" in registration.access, false);
  }

  const staleSendBack = createFixture({ failSendBack: true });
  const staleResponse = await invoke(
    staleSendBack,
    SEND_BACK_HELP_PATH,
    { draftId: DRAFT_ID },
    { reason: "Too late" },
    "admin",
  );
  assert.equal(staleResponse.status, 409);
});

test("send-back handlers fail closed when route authorization is omitted", async () => {
  for (const [path, params] of [
    [SEND_BACK_SUBMISSION_PATH, { queueEntryId: QUEUE_ID }],
    [SEND_BACK_HELP_PATH, { draftId: DRAFT_ID }],
  ] as const) {
    const fixture = createFixture();
    const registration = fixture.registrations.find((item) => item.path === path);
    assert.ok(registration);
    const req = {
      body: { reason: "Must not run" },
      headers: {},
      method: "POST",
      originalUrl: path,
      params,
      route: { path },
      session: fakeSession(ADMIN_ID),
    } as unknown as Request;
    const response = createTestResponse();
    registration.handler(req, response.res, response.next);
    const error = await response.completed;
    assert.notEqual(error, null);
    assert.equal(errorResult(error).status, 500);
    assert.deepEqual(fixture.calls, []);
  }
});

test("approval override fails closed when route authorization is omitted", async () => {
  const fixture = createFixture();
  const registration = fixture.registrations.find(
    (item) => item.path === APPROVE_WITH_OVERRIDE_PATH,
  );
  assert.ok(registration);
  const req = {
    body: {
      changedFields: ["brokerFee"],
      reason: "Must not run",
      replacementValues: { brokerFee: "30.00" },
    },
    headers: {},
    method: "POST",
    originalUrl: APPROVE_WITH_OVERRIDE_PATH,
    params: { queueEntryId: QUEUE_ID },
    route: { path: APPROVE_WITH_OVERRIDE_PATH },
    session: fakeSession(ADMIN_ID),
  } as unknown as Request;
  const response = createTestResponse();
  registration.handler(req, response.res, response.next);
  const error = await response.completed;
  assert.notEqual(error, null);
  assert.equal(errorResult(error).status, 500);
  assert.deepEqual(fixture.calls, []);
});

function queueEntry(
  status: ApprovalQueueEntryRecord["status"] = "pending",
): ApprovalQueueEntryRecord & Record<string, unknown> {
  const timestamp = new Date("2026-07-11T12:00:00.000Z");
  return {
    actedAt: status === "sent_back" ? timestamp : null,
    actedByUserId: status === "sent_back" ? ADMIN_ID : null,
    createdAt: timestamp,
    draftId: DRAFT_ID,
    id: QUEUE_ID,
    passwordHash: "must-not-leak",
    reason: status === "sent_back" ? "Correct the carrier" : null,
    status,
    submittedAt: timestamp,
    submittedByUserId: EMPLOYEE_ID,
    submittedPayload: {
      basePremium: "1000.00",
      insuredName: "Private Insured",
      schemaVersion: 1,
    },
    updatedAt: timestamp,
  };
}

function draft(status: DraftRecord["status"] = "flagged"): DraftRecord {
  const timestamp = new Date("2026-07-11T12:00:00.000Z");
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
    createdAt: timestamp,
    depositOption: "0.00",
    effectiveDate: "2026-07-11",
    expirationDate: "2027-07-11",
    financeBalance: "750.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    flagReason: status === "flagged" ? "Need admin help" : null,
    history: [],
    id: DRAFT_ID,
    insuredName: "Flagged Insured",
    invoiceNumber: null,
    ipfsFinanced: "no",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: null,
    lastEditedAt: timestamp,
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaFee: "10.00",
    mgaId: null,
    netDue: "905.00",
    notes: null,
    officeLocationId: null,
    ownerUserId: EMPLOYEE_ID,
    paymentMode: "full",
    policyNumber: "FLAG-1",
    policyTypeId: null,
    producerUserId: null,
    proposalTotal: "1030.00",
    schemaVersion: 1,
    sentBackAt: status === "sent_back" ? timestamp : null,
    sentBackByUserId: status === "sent_back" ? ADMIN_ID : null,
    sentBackReason:
      status === "sent_back" ? "Complete the missing fields" : null,
    status,
    submittedAt: null,
    taxes: "0.00",
    transactionNotes: null,
    transactionType: "new_business",
  };
}

function policy(): PolicyRecord & Record<string, unknown> {
  const timestamp = new Date("2026-07-11T12:00:00.000Z");
  return {
    accountAssignment: "book",
    amountPaid: "250.00",
    approvedAt: timestamp,
    balanceDueDate: null,
    basePremium: "1000.00",
    brokerFee: "20.00",
    carrierId: "00000000-0000-4000-8000-000000000021",
    collectedToDate: "0.00",
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: null,
    createdAt: timestamp,
    depositOption: "250.00",
    effectiveDate: "2026-07-11",
    expirationDate: "2027-07-11",
    financeBalance: "780.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    id: POLICY_ID,
    insuredName: "Approved Insured",
    invoiceNumber: null,
    ipfsFinanced: "no",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: null,
    kayleeSplit: "book",
    mgaFee: "10.00",
    mgaId: "00000000-0000-4000-8000-000000000022",
    mgaPaid: false,
    mgaPaidAt: null,
    producerCommissionReceivedAt: null,
    deletedAt: null,
    deletedByUserId: null,
    deleteReason: null,
    mgaPayReference: null,
    netDue: "895.00",
    netDueTotal: "0.00",
    notes: null,
    officeLocationId: "00000000-0000-4000-8000-000000000023",
    overridden: false,
    passwordHash: "must-not-leak",
    payableStatus: "paid",
    paymentMode: "deposit",
    policyNumber: "APPROVED-1",
    policyTypeId: "00000000-0000-4000-8000-000000000024",
    premiumTotal: "0.00",
    producerUserId: "00000000-0000-4000-8000-000000000025",
    proposalTotal: "1030.00",
    receivableStatus: "paid",
    remittedToMga: "0.00",
    sourceDraftId: DRAFT_ID,
    submittedAt: timestamp,
    submittedByUserId: EMPLOYEE_ID,
    taxes: "0.00",
    transactionNotes: null,
    transactionType: "New",
    updatedAt: timestamp,
  };
}

function account(id: string): UserAccount {
  return {
    createdAt: new Date("2026-07-11T12:00:00.000Z"),
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
  path: string,
  params: Record<string, string>,
  body: unknown,
  identity?: "admin" | "employee" | "producer",
): Promise<TestResult> {
  const registration = fixture.registrations.find((item) => item.path === path);
  assert.ok(registration);
  const userId =
    identity === "admin"
      ? ADMIN_ID
      : identity === "employee"
        ? EMPLOYEE_ID
        : identity === "producer"
          ? PRODUCER_ID
          : undefined;
  const req = {
    body,
    headers: {},
    method: "POST",
    originalUrl: path,
    params,
    route: { path },
    session: fakeSession(userId),
  } as unknown as Request;
  const response = createTestResponse();
  const guard = registration.access.authorization;
  assert.ok(guard);
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) return errorResult(guardError);
  registration.handler(req, response.res, response.next);
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
  let body: unknown = null;
  let status = 200;
  const headers: Record<string, string> = {};
  let complete: (error: unknown | null) => void = () => undefined;
  const completed = new Promise<unknown | null>((resolve) => {
    complete = resolve;
  });
  const res = {
    clearCookie() {
      return res;
    },
    json(value: unknown) {
      body = value;
      complete(null);
      return res;
    },
    locals: {},
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
      complete(error ?? null);
    },
    res,
    result: () => ({ body, headers, status }),
  };
}

async function invokeNextMiddleware(
  handler: RequestHandler,
  req: Request,
  res: Response,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    handler(req, res, (error?: unknown) => resolve(error ?? null));
  });
}

function errorResult(error: unknown): TestResult {
  const result = toErrorResponse(error);
  return { body: result.response, headers: {}, status: result.statusCode };
}
