import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { createApp } from "../app.js";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { UserAccount } from "../auth/users.js";
import type { DraftRecord } from "../db/schema.js";
import { DraftInputValidationError } from "../drafts/create.js";
import { DRAFT_FINANCIAL_FIELDS } from "../drafts/projection.js";
import {
  DraftNotEditableError,
  DraftNotFoundError,
} from "../drafts/edit.js";
import {
  DraftNotSubmittableError,
  DraftSubmissionNotFoundError,
  DraftSubmissionValidationError,
} from "../drafts/submit.js";
import type { AppLogger } from "../logging/logger.js";
import { toErrorResponse } from "./errors.js";
import {
  DRAFTS_PATH,
  DRAFT_PATH,
  DRAFT_SUBMIT_PATH,
  createDraftCreateHandler,
  createDraftEditHandler,
  createDraftListHandler,
  createDraftSubmitHandler,
  registerDraftCreateRoute,
  registerDraftEditRoute,
  registerDraftListRoute,
  registerDraftSubmitRoute,
  type RegisterDraftCreateRouteOptions,
  type RegisterDraftEditRouteOptions,
  type RegisterDraftListRouteOptions,
  type RegisterDraftSubmitRouteOptions,
} from "./drafts.js";
import {
  auditRouteAccessDeclarations,
  type RouteAccessDeclaration,
  type RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const UNASSIGNED_ID = "00000000-0000-4000-8000-000000000004";
const INACTIVE_ID = "00000000-0000-4000-8000-000000000005";
const DRAFT_ID = "00000000-0000-4000-8000-000000000010";
const LOCKED_DRAFT_ID = "00000000-0000-4000-8000-000000000011";
const INCOMPLETE_DRAFT_ID = "00000000-0000-4000-8000-000000000012";
const INACTIVE_REFERENCE_DRAFT_ID =
  "00000000-0000-4000-8000-000000000013";
const OTHER_DRAFT_ID = "00000000-0000-4000-8000-000000000099";

interface RegisteredRoute {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  method: "GET" | "PATCH" | "POST";
  path: string;
}

interface TestResult {
  body: unknown;
  headers: Record<string, string>;
  status: number;
}

const logger: AppLogger = { error() {}, info() {}, warn() {} };

function createFixture(options: { emptyList?: boolean } = {}) {
  const users = new Map<string, UserAccount>([
    ...[ADMIN_ID, PRODUCER_ID, EMPLOYEE_ID, UNASSIGNED_ID].map(
      (id) => [id, account(id)] as const,
    ),
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
  const calls: Array<{ input: unknown; userId: string }> = [];
  const listCalls: Array<{ query: unknown; userId: string }> = [];
  const editCalls: Array<{ draftId: string; input: unknown; userId: string }> = [];
  const submitCalls: Array<{ draftId: string; userId: string }> = [];
  const authorization = createAuthorizationGuards({
    async findUser(userId) {
      return users.get(userId) ?? null;
    },
    async loadPrincipal(userId) {
      return principals.get(userId) ?? null;
    },
    logger,
  });
  const registrations: RegisteredRoute[] = [];
  const createOptions: RegisterDraftCreateRouteOptions = {
    authorization,
    async create(context, input) {
      calls.push({ input, userId: context.principal.userId });
      return draft(context.principal.userId) as DraftRecord;
    },
    logger,
  };
  const listOptions: RegisterDraftListRouteOptions = {
    authorization,
    async list(context, query) {
      listCalls.push({ query, userId: context.principal.userId });
      if (options.emptyList === true) {
        return [];
      }
      const records = [
        draft(context.principal.userId, "draft", 10),
        draft(context.principal.userId, "submitted", 11),
        draft(context.principal.userId, "flagged", 12),
        draft(context.principal.userId, "sent_back", 13),
        draft(context.principal.userId, "approved", 14),
      ];
      const status = (query as { status?: DraftRecord["status"] }).status;
      return status === undefined
        ? records
        : records.filter((record) => record.status === status);
    },
    logger,
  };
  const editOptions: RegisterDraftEditRouteOptions = {
    authorization,
    async edit(context, draftId, input) {
      editCalls.push({
        draftId,
        input,
        userId: context.principal.userId,
      });
      if (draftId === OTHER_DRAFT_ID) {
        throw new DraftNotFoundError();
      }
      if ((input as { notes?: string }).notes === "locked") {
        throw new DraftNotEditableError();
      }
      const record = draft(context.principal.userId);
      record.insuredName =
        (input as { insuredName?: string }).insuredName ?? record.insuredName;
      return {
        draft: record,
        previousStatus:
          (input as { notes?: string }).notes === "reopen"
            ? "sent_back"
            : "draft",
      };
    },
    logger,
  };
  const submitOptions: RegisterDraftSubmitRouteOptions = {
    authorization,
    logger,
    async submit(context, draftId) {
      submitCalls.push({ draftId, userId: context.principal.userId });
      if (draftId === OTHER_DRAFT_ID) {
        throw new DraftSubmissionNotFoundError();
      }
      if (draftId === LOCKED_DRAFT_ID) {
        throw new DraftNotSubmittableError();
      }
      if (draftId === INCOMPLETE_DRAFT_ID) {
        throw new DraftSubmissionValidationError([
          { field: "policyNumber", message: "Policy number is required" },
        ]);
      }
      if (draftId === INACTIVE_REFERENCE_DRAFT_ID) {
        throw new DraftInputValidationError([
          { field: "carrierId", message: "Select an active carrier" },
        ]);
      }
      const isAdmin = context.principal.capabilities.includes("admin");
      return {
        destination: isAdmin ? "ledger" : "approval",
        draft: draft(
          context.principal.userId,
          isAdmin ? "approved" : "submitted",
        ),
      };
    },
  };
  const routes = {
    get(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      const handler = handlers[0];
      assert.ok(handler);
      registrations.push({ access, handler, method: "GET", path });
    },
    post(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      const handler = handlers[0];
      assert.ok(handler);
      registrations.push({ access, handler, method: "POST", path });
    },
    patch(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      const handler = handlers[0];
      assert.ok(handler);
      registrations.push({ access, handler, method: "PATCH", path });
    },
  } as unknown as RouteRegistrar;
  registerDraftCreateRoute(routes, createOptions);
  registerDraftListRoute(routes, listOptions);
  registerDraftEditRoute(routes, editOptions);
  registerDraftSubmitRoute(routes, submitOptions);
  return {
    calls,
    createOptions,
    editCalls,
    editOptions,
    listCalls,
    listOptions,
    registrations,
    submitCalls,
    submitOptions,
  };
}

test("all three authenticated WCIB roles create UUID-owned active drafts", async () => {
  for (const [identity, userId] of [
    ["admin", ADMIN_ID],
    ["producer", PRODUCER_ID],
    ["employee", EMPLOYEE_ID],
  ] as const) {
    const fixture = createFixture();
    const response = await invokeRoute(fixture, validBody(), identity);
    assert.equal(response.status, 201);
    assert.equal(response.headers["cache-control"], "no-store");
    const body = response.body as { draft: Record<string, unknown> };
    assert.equal(body.draft.ownerUserId, userId);
    assert.equal(body.draft.status, "draft");
    assert.equal(body.draft.agencyCommissionAmount, "125.00");
    assert.equal(body.draft.basePremium, "1000.00");
    for (const field of [
      "applicableProducerRate",
      "producerPayout",
      "producerRate",
      "producerRateHistory",
    ]) {
      assert.equal(field in body.draft, false, field);
    }
    assert.deepEqual(fixture.calls, [{ input: validBody(), userId }]);
  }
});

test("owner and lifecycle spoofing fail before draft persistence", async () => {
  for (const body of [
    { ...validBody(), ownerUserId: ADMIN_ID },
    { ...validBody(), status: "submitted" },
    { ...validBody(), linkedPolicyId: DRAFT_ID },
    { ...validBody(), producerPayout: "25.00" },
  ]) {
    const fixture = createFixture();
    const response = await invokeRoute(fixture, body, "employee");
    assert.equal(response.status, 400);
    assert.deepEqual(fixture.calls, []);
  }
});

test("draft creation denies unauthenticated and default-deny users", async () => {
  for (const identity of [undefined, "unassigned"] as const) {
    const fixture = createFixture();
    const response = await invokeRoute(fixture, validBody(), identity);
    assert.equal(response.status, identity === undefined ? 401 : 403);
    assert.deepEqual(fixture.calls, []);
  }
});

test("draft route is explicitly authorized and fails closed without its guard", async () => {
  const fixture = createFixture();
  const app = createApp({
    registerRoutes(routes) {
      registerDraftCreateRoute(routes, fixture.createOptions);
    },
  });
  assert.deepEqual(
    auditRouteAccessDeclarations(app).find(({ path }) => path === DRAFTS_PATH),
    {
      access: { type: "authorized" },
      method: "POST",
      path: DRAFTS_PATH,
    },
  );

  let calls = 0;
  const handler = createDraftCreateHandler({
    async create() {
      calls += 1;
      return draft(EMPLOYEE_ID) as DraftRecord;
    },
    logger,
  });
  const result = await invokeHandlerWithoutGuard(handler, validBody());
  assert.equal(result.status, 500);
  assert.equal(calls, 0);
});

test("own-draft list projects staff financial fields by exact status", async () => {
  for (const [identity, userId] of [
    ["employee", EMPLOYEE_ID],
    ["producer", PRODUCER_ID],
  ] as const) {
    const fixture = createFixture();
    const response = await invokeListRoute(fixture, {}, identity);
    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    const rows = (response.body as { drafts: Array<Record<string, unknown>> })
      .drafts;
    assert.equal(rows.length, 5);
    assert.equal(rows.every((row) => row.ownerUserId === userId), true);
    const active = rows.find((row) => row.status === "draft");
    assert.ok(active);
    assert.equal(active.agencyCommissionAmount, "125.00");
    assert.equal(active.basePremium, "1000.00");

    for (const row of rows.filter((candidate) => candidate.status !== "draft")) {
      for (const field of [
        ...DRAFT_FINANCIAL_FIELDS,
        "agencyCommissionAmount",
      ]) {
        assert.equal(field in row, false, `${String(row.status)}:${field}`);
      }
    }
    for (const row of rows) {
      for (const field of [
        "applicableProducerRate",
        "producerPayout",
        "producerRate",
        "producerRateHistory",
      ]) {
        assert.equal(field in row, false, field);
      }
    }
    assert.deepEqual(fixture.listCalls, [{ query: {}, userId }]);
  }
});

test("admin My Drafts remains owner-scoped and empty/filter states are exact", async () => {
  const fixture = createFixture();
  const filtered = await invokeListRoute(
    fixture,
    { status: "flagged" },
    "admin",
  );
  assert.equal(filtered.status, 200);
  const rows = (filtered.body as { drafts: Array<Record<string, unknown>> })
    .drafts;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.ownerUserId, ADMIN_ID);
  assert.equal(rows[0]?.status, "flagged");
  assert.equal(rows[0]?.basePremium, "1000.00");

  const empty = await invokeListRoute(
    createFixture({ emptyList: true }),
    {},
    "employee",
  );
  assert.deepEqual(empty.body, { drafts: [] });
});

test("own-draft list rejects owner broadening, invalid filters, and missing guards", async () => {
  for (const query of [
    { ownerUserId: ADMIN_ID },
    { status: "unknown" },
    { status: ["draft", "submitted"] },
  ]) {
    const fixture = createFixture();
    const result = await invokeListRoute(fixture, query, "employee");
    assert.equal(result.status, 400);
    assert.deepEqual(fixture.listCalls, []);
  }

  let calls = 0;
  const handler = createDraftListHandler({
    async list() {
      calls += 1;
      return [];
    },
    logger,
  });
  const result = await invokeHandlerWithoutGuard(handler, undefined, {});
  assert.equal(result.status, 500);
  assert.equal(calls, 0);
});

test("own-draft list denies unauthenticated, inactive, and default-deny identities", async () => {
  for (const [identity, status] of [
    [undefined, 401],
    ["inactive", 401],
    ["unassigned", 403],
  ] as const) {
    const fixture = createFixture();
    const result = await invokeListRoute(fixture, {}, identity);
    assert.equal(result.status, status);
    assert.deepEqual(fixture.listCalls, []);
  }
});

test("own-draft list route is explicitly authorized", () => {
  const fixture = createFixture();
  const app = createApp({
    registerRoutes(routes) {
      registerDraftListRoute(routes, fixture.listOptions);
    },
  });
  assert.deepEqual(
    auditRouteAccessDeclarations(app).find(
      ({ method, path }) => method === "GET" && path === DRAFTS_PATH,
    ),
    {
      access: { type: "authorized" },
      method: "GET",
      path: DRAFTS_PATH,
    },
  );
});

test("all three roles edit only through the active owner projection", async () => {
  for (const [identity, userId] of [
    ["admin", ADMIN_ID],
    ["producer", PRODUCER_ID],
    ["employee", EMPLOYEE_ID],
  ] as const) {
    const fixture = createFixture();
    const result = await invokeEditRoute(
      fixture,
      DRAFT_ID,
      { insuredName: "Updated Insured" },
      identity,
    );
    assert.equal(result.status, 200);
    const response = result.body as { draft: Record<string, unknown> };
    assert.equal(response.draft.ownerUserId, userId);
    assert.equal(response.draft.insuredName, "Updated Insured");
    assert.equal(response.draft.agencyCommissionAmount, "125.00");
    assert.equal("producerPayout" in response.draft, false);
    assert.deepEqual(fixture.editCalls, [
      {
        draftId: DRAFT_ID,
        input: { insuredName: "Updated Insured" },
        userId,
      },
    ]);
  }
});

test("draft edit hides missing ownership and rejects closed states and system fields", async () => {
  const missing = await invokeEditRoute(
    createFixture(),
    OTHER_DRAFT_ID,
    { insuredName: "No access" },
    "employee",
  );
  assert.deepEqual(missing, {
    body: { error: { code: "not_found", message: "Draft not found" } },
    headers: {},
    status: 404,
  });

  const locked = await invokeEditRoute(
    createFixture(),
    DRAFT_ID,
    { notes: "locked" },
    "employee",
  );
  assert.equal(locked.status, 409);

  for (const input of [
    { ownerUserId: ADMIN_ID },
    { status: "draft" },
    { history: [] },
    { producerPayout: "10.00" },
  ]) {
    const fixture = createFixture();
    const result = await invokeEditRoute(
      fixture,
      DRAFT_ID,
      input,
      "producer",
    );
    assert.equal(result.status, 400);
    assert.deepEqual(fixture.editCalls, []);
  }
});

test("sent-back edit returns a reopened active draft without lifecycle internals", async () => {
  const result = await invokeEditRoute(
    createFixture(),
    DRAFT_ID,
    { notes: "reopen" },
    "employee",
  );
  assert.equal(result.status, 200);
  const body = result.body as { draft: Record<string, unknown> };
  assert.equal(body.draft.status, "draft");
  assert.equal("previousStatus" in body, false);
  assert.equal(body.draft.basePremium, "1000.00");
});

test("draft edit route is explicitly authorized and fails closed without its guard", async () => {
  const fixture = createFixture();
  const app = createApp({
    registerRoutes(routes) {
      registerDraftEditRoute(routes, fixture.editOptions);
    },
  });
  assert.deepEqual(
    auditRouteAccessDeclarations(app).find(
      ({ method, path }) => method === "PATCH" && path === DRAFT_PATH,
    ),
    {
      access: { type: "authorized" },
      method: "PATCH",
      path: DRAFT_PATH,
    },
  );

  let calls = 0;
  const handler = createDraftEditHandler({
    async edit() {
      calls += 1;
      return { draft: draft(EMPLOYEE_ID), previousStatus: "draft" };
    },
    logger,
  });
  const response = createTestResponse();
  handler(
    {
      body: { insuredName: "No guard" },
      params: { draftId: DRAFT_ID },
    } as unknown as Request,
    response.res,
    response.next,
  );
  const error = await response.completed;
  assert.ok(error);
  assert.equal(errorResult(error).status, 500);
  assert.equal(calls, 0);
});

test("draft submission sends staff to approval and admin directly to ledger", async () => {
  for (const [identity, expectedUserId] of [
    ["employee", EMPLOYEE_ID],
    ["producer", PRODUCER_ID],
  ] as const) {
    const fixture = createFixture();
    const result = await invokeSubmitRoute(fixture, DRAFT_ID, {}, identity);
    assert.equal(result.status, 200);
    assert.equal(result.headers["cache-control"], "no-store");
    const response = result.body as {
      destination: string;
      draft: Record<string, unknown>;
    };
    assert.equal(response.destination, "approval");
    assert.equal(response.draft.status, "submitted");
    assert.equal(response.draft.ownerUserId, expectedUserId);
    for (const field of [
      ...DRAFT_FINANCIAL_FIELDS,
      "agencyCommissionAmount",
    ]) {
      assert.equal(field in response.draft, false, `${identity}:${field}`);
    }
    for (const field of [
      "applicableProducerRate",
      "producerPayout",
      "producerRate",
      "producerRateHistory",
    ]) {
      assert.equal(field in response.draft, false, `${identity}:${field}`);
    }
    assert.deepEqual(fixture.submitCalls, [
      { draftId: DRAFT_ID, userId: expectedUserId },
    ]);
  }

  const adminFixture = createFixture();
  const adminResult = await invokeSubmitRoute(
    adminFixture,
    DRAFT_ID,
    {},
    "admin",
  );
  assert.equal(adminResult.status, 200);
  const adminResponse = adminResult.body as {
    destination: string;
    draft: Record<string, unknown>;
  };
  assert.equal(adminResponse.destination, "ledger");
  assert.equal(adminResponse.draft.status, "approved");
  assert.equal(adminResponse.draft.basePremium, "1000.00");
  assert.equal(adminResponse.draft.agencyCommissionAmount, "125.00");
  assert.equal("producerPayout" in adminResponse.draft, false);
});

test("draft submission rejects replacement payloads and discloses no other owner", async () => {
  const forgedFixture = createFixture();
  const forged = await invokeSubmitRoute(
    forgedFixture,
    DRAFT_ID,
    { basePremium: "1.00", ownerUserId: ADMIN_ID },
    "employee",
  );
  assert.equal(forged.status, 400);
  assert.deepEqual(forgedFixture.submitCalls, []);

  const missing = await invokeSubmitRoute(
    createFixture(),
    OTHER_DRAFT_ID,
    {},
    "producer",
  );
  assert.deepEqual(missing, {
    body: { error: { code: "not_found", message: "Draft not found" } },
    headers: {},
    status: 404,
  });

  const locked = await invokeSubmitRoute(
    createFixture(),
    LOCKED_DRAFT_ID,
    {},
    "employee",
  );
  assert.equal(locked.status, 409);

  const incomplete = await invokeSubmitRoute(
    createFixture(),
    INCOMPLETE_DRAFT_ID,
    {},
    "employee",
  );
  assert.deepEqual(incomplete.body, {
    error: {
      code: "validation_error",
      details: [
        { field: "policyNumber", message: "Policy number is required" },
      ],
      message: "Draft is incomplete",
    },
  });

  const inactiveReference = await invokeSubmitRoute(
    createFixture(),
    INACTIVE_REFERENCE_DRAFT_ID,
    {},
    "employee",
  );
  assert.deepEqual(inactiveReference.body, {
    error: {
      code: "validation_error",
      details: [
        { field: "carrierId", message: "Select an active carrier" },
      ],
      message: "Request validation failed",
    },
  });
});

test("draft submission denies unauthenticated and default-closed identities", async () => {
  for (const [identity, status] of [
    [undefined, 401],
    ["inactive", 401],
    ["unassigned", 403],
  ] as const) {
    const fixture = createFixture();
    const result = await invokeSubmitRoute(fixture, DRAFT_ID, {}, identity);
    assert.equal(result.status, status);
    assert.deepEqual(fixture.submitCalls, []);
  }
});

test("draft submit route is explicitly authorized and fails closed without its guard", async () => {
  const fixture = createFixture();
  const app = createApp({
    registerRoutes(routes) {
      registerDraftSubmitRoute(routes, fixture.submitOptions);
    },
  });
  assert.deepEqual(
    auditRouteAccessDeclarations(app).find(
      ({ method, path }) => method === "POST" && path === DRAFT_SUBMIT_PATH,
    ),
    {
      access: { type: "authorized" },
      method: "POST",
      path: DRAFT_SUBMIT_PATH,
    },
  );

  let calls = 0;
  const handler = createDraftSubmitHandler({
    logger,
    async submit() {
      calls += 1;
      return { destination: "approval", draft: draft(EMPLOYEE_ID) };
    },
  });
  const result = await invokeHandlerWithoutGuard(handler, {}, {});
  assert.equal(result.status, 500);
  assert.equal(calls, 0);
});

function validBody() {
  return {
    basePremium: "1000.00",
    commissionConfirmed: true,
    commissionMode: "pct" as const,
    commissionRate: "12.5000",
    insuredName: "Test Insured",
  };
}

function draft(
  ownerUserId: string,
  status: DraftRecord["status"] = "draft",
  idSuffix = 10,
): DraftRecord & Record<string, unknown> {
  return {
    accountAssignment: null,
    amountPaid: "300.00",
    applicableProducerRate: "25.0000",
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: null,
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: null,
    createdAt: new Date("2026-07-10T00:00:00.000Z"),
    depositOption: "300.00",
    effectiveDate: null,
    expirationDate: null,
    financeBalance: "780.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    flagReason: null,
    history: [],
    id: `00000000-0000-4000-8000-${String(idSuffix).padStart(12, "0")}`,
    insuredName: "Test Insured",
    invoiceNumber: null,
    ipfsFinanced: null,
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: null,
    lastEditedAt: new Date("2026-07-10T00:00:00.000Z"),
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaFee: "0.00",
    mgaId: null,
    netDue: "125.00",
    notes: null,
    officeLocationId: null,
    ownerUserId,
    paymentMode: "deposit",
    policyNumber: null,
    policyTypeId: null,
    producerPayout: "31.25",
    producerRate: "25.0000",
    producerRateHistory: [],
    producerUserId: null,
    proposalTotal: "1080.00",
    schemaVersion: 1,
    sentBackAt: null,
    sentBackByUserId: null,
    sentBackReason: null,
    status,
    submittedAt: null,
    taxes: "5.00",
    transactionNotes: null,
    transactionType: null,
  };
}

function account(id: string, isActive = true): UserAccount {
  return {
    createdAt: new Date("2026-07-10T00:00:00.000Z"),
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

async function invokeRoute(
  fixture: ReturnType<typeof createFixture>,
  body: unknown,
  identity?: "admin" | "employee" | "producer" | "unassigned",
): Promise<TestResult> {
  const registration = fixture.registrations.find(
    ({ method, path }) => method === "POST" && path === DRAFTS_PATH,
  );
  assert.ok(registration);
  const guard = registration.access.authorization;
  assert.ok(guard);
  const userId =
    identity === "admin"
      ? ADMIN_ID
      : identity === "producer"
        ? PRODUCER_ID
        : identity === "employee"
          ? EMPLOYEE_ID
          : identity === "unassigned"
            ? UNASSIGNED_ID
            : undefined;
  const req = {
    body,
    headers: {},
    method: "POST",
    originalUrl: DRAFTS_PATH,
    route: { path: DRAFTS_PATH },
    session: fakeSession(userId),
  } as unknown as Request;
  const response = createTestResponse();
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) {
    return errorResult(guardError);
  }
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

async function invokeHandlerWithoutGuard(
  handler: RequestHandler,
  body: unknown,
  query: unknown = {},
): Promise<TestResult> {
  const req = { body, query } as Request;
  const response = createTestResponse();
  handler(req, response.res, response.next);
  const error = await response.completed;
  return error === null ? response.result() : errorResult(error);
}

async function invokeListRoute(
  fixture: ReturnType<typeof createFixture>,
  query: unknown,
  identity?: "admin" | "employee" | "inactive" | "producer" | "unassigned",
): Promise<TestResult> {
  const registration = fixture.registrations.find(
    ({ method }) => method === "GET",
  );
  assert.ok(registration);
  const guard = registration.access.authorization;
  assert.ok(guard);
  const userId =
    identity === "admin"
      ? ADMIN_ID
      : identity === "producer"
        ? PRODUCER_ID
        : identity === "employee"
          ? EMPLOYEE_ID
          : identity === "inactive"
            ? INACTIVE_ID
            : identity === "unassigned"
              ? UNASSIGNED_ID
              : undefined;
  const req = {
    headers: {},
    method: "GET",
    originalUrl: DRAFTS_PATH,
    query,
    route: { path: DRAFTS_PATH },
    session: fakeSession(userId),
  } as unknown as Request;
  const response = createTestResponse();
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) {
    return errorResult(guardError);
  }
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

async function invokeEditRoute(
  fixture: ReturnType<typeof createFixture>,
  draftId: string,
  body: unknown,
  identity?: "admin" | "employee" | "producer" | "unassigned",
): Promise<TestResult> {
  const registration = fixture.registrations.find(
    ({ method }) => method === "PATCH",
  );
  assert.ok(registration);
  const guard = registration.access.authorization;
  assert.ok(guard);
  const userId =
    identity === "admin"
      ? ADMIN_ID
      : identity === "producer"
        ? PRODUCER_ID
        : identity === "employee"
          ? EMPLOYEE_ID
          : identity === "unassigned"
            ? UNASSIGNED_ID
            : undefined;
  const req = {
    body,
    headers: {},
    method: "PATCH",
    originalUrl: `/api/drafts/${draftId}`,
    params: { draftId },
    route: { path: DRAFT_PATH },
    session: fakeSession(userId),
  } as unknown as Request;
  const response = createTestResponse();
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) {
    return errorResult(guardError);
  }
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

async function invokeSubmitRoute(
  fixture: ReturnType<typeof createFixture>,
  draftId: string,
  body: unknown,
  identity?: "admin" | "employee" | "inactive" | "producer" | "unassigned",
): Promise<TestResult> {
  const registration = fixture.registrations.find(
    ({ method, path }) => method === "POST" && path === DRAFT_SUBMIT_PATH,
  );
  assert.ok(registration);
  const guard = registration.access.authorization;
  assert.ok(guard);
  const userId =
    identity === "admin"
      ? ADMIN_ID
      : identity === "producer"
        ? PRODUCER_ID
        : identity === "employee"
          ? EMPLOYEE_ID
          : identity === "inactive"
            ? INACTIVE_ID
            : identity === "unassigned"
              ? UNASSIGNED_ID
              : undefined;
  const req = {
    body,
    headers: {},
    method: "POST",
    originalUrl: `/api/drafts/${draftId}/submit`,
    params: { draftId },
    route: { path: DRAFT_SUBMIT_PATH },
    session: fakeSession(userId),
  } as unknown as Request;
  const response = createTestResponse();
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) {
    return errorResult(guardError);
  }
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
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
      return this;
    },
    json(value: unknown) {
      body = value;
      complete(null);
      return this;
    },
    locals: {},
    set(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    status(value: number) {
      status = value;
      return this;
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
