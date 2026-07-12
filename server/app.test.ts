import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex } from "node:stream";
import { test } from "node:test";
import { z } from "zod";
import { createApp } from "./app.js";
import { asyncRoute, type UnexpectedErrorEvent } from "./http/errors.js";
import { auditRouteAccessDeclarations } from "./http/routes.js";

class MemorySocket extends Duplex {
  readonly chunks: Buffer[] = [];

  _read(): void {}

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding),
    );
    callback();
  }
}

async function request(
  path: string,
  app = createApp(),
): Promise<{
  body: unknown;
  headers: ReturnType<ServerResponse["getHeaders"]>;
  statusCode: number;
}> {
  const socket = new MemorySocket();
  const nodeSocket = socket as unknown as Socket;
  const req = new IncomingMessage(nodeSocket);
  const res = new ServerResponse(req);

  req.method = "GET";
  req.url = path;
  req.headers = { host: "localhost" };
  res.assignSocket(nodeSocket);

  const finished = new Promise<void>((resolve, reject) => {
    res.once("finish", resolve);
    res.once("error", reject);
  });

  app(req, res);
  await finished;

  const rawResponse = Buffer.concat(socket.chunks).toString("utf8");
  const body = rawResponse.split("\r\n\r\n", 2)[1];
  const contentType = String(res.getHeader("content-type") ?? "");

  return {
    body: contentType.includes("application/json") ? JSON.parse(body) : body,
    headers: res.getHeaders(),
    statusCode: res.statusCode,
  };
}

test("GET /api returns backend status", async () => {
  const response = await request("/api");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    name: "WCIB Dashboard API",
    status: "ok",
  });
});

test("GET /health reports process liveness without checking dependencies", async () => {
  let readinessChecks = 0;
  const app = createApp({
    readinessCheck: async () => {
      readinessChecks += 1;
      throw new Error("DATABASE_URL=must-not-be-logged");
    },
  });

  const response = await request("/health", app);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { status: "ok" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(readinessChecks, 0);
});

test("health checks remain independent of session storage", async () => {
  let sessionLookups = 0;
  const app = createApp({
    sessionMiddleware(_req, _res, next) {
      sessionLookups += 1;
      next();
    },
  });

  await request("/health", app);
  assert.equal(sessionLookups, 0);

  await request("/api", app);
  assert.equal(sessionLookups, 1);
});

test("production proxy trust can be enabled before secure cookies", () => {
  const app = createApp({ trustProxy: true });

  assert.equal(app.get("trust proxy"), 1);
});

test("production client assets serve the public shell with bounded caching", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "wcib-client-assets-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  await mkdir(join(directory, "assets"));
  await writeFile(
    join(directory, "index.html"),
    "<!doctype html><html><body><div id=\"root\"></div></body></html>",
  );
  await writeFile(join(directory, "assets", "app-test.js"), "export {};\n");

  const app = createApp({ clientAssetsDirectory: directory });
  const root = await request("/", app);
  const asset = await request("/assets/app-test.js", app);
  const missing = await request("/missing", app);
  const rootDeclaration = auditRouteAccessDeclarations(app).find(
    ({ method, path }) => method === "GET" && path === "/",
  );

  assert.equal(root.statusCode, 200);
  assert.match(String(root.body), /id="root"/);
  assert.equal(root.headers["cache-control"], "no-store");
  assert.equal(asset.statusCode, 200);
  assert.equal(asset.body, "export {};\n");
  assert.equal(
    asset.headers["cache-control"],
    "public, max-age=31536000, immutable",
  );
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.body, {
    error: { code: "not_found", message: "Route not found" },
  });
  assert.deepEqual(rootDeclaration?.access, {
    reason: "Users need the public application shell before login",
    type: "public",
  });
});

test("production startup fails when the built client is absent", () => {
  assert.throws(
    () => createApp({ clientAssetsDirectory: "/missing/wcib-client-assets" }),
    /Production client index is missing/,
  );
});

test("GET /ready reports readiness after the database check passes", async () => {
  let readinessChecks = 0;
  const app = createApp({
    readinessCheck: async () => {
      readinessChecks += 1;
    },
  });

  const response = await request("/ready", app);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { status: "ready" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(readinessChecks, 1);
});

test("GET /ready fails safely when the database is unavailable", async () => {
  const app = createApp({
    readinessCheck: async () => {
      throw new Error("password authentication failed for private-password");
    },
  });

  const response = await request("/ready", app);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { status: "unavailable" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(JSON.stringify(response).includes("private-password"), false);
});

test("GET /ready is predictable before a readiness dependency is configured", async () => {
  const response = await request("/ready");

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { status: "unavailable" });
  assert.equal(response.headers["cache-control"], "no-store");
});

test("unknown routes use the standard API error shape", async () => {
  const response = await request("/missing");

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, {
    error: { code: "not_found", message: "Route not found" },
  });
});

test("validation errors use the standard API error shape", async () => {
  const app = createApp({
    registerRoutes(routes) {
      routes.get(
        "/api/validate",
        { public: true, reason: "Test validation error handling" },
        asyncRoute(async () => {
          z.object({ email: z.string().email() }).parse({ email: "invalid" });
        }),
      );
    },
  });
  const response = await request("/api/validate", app);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    error: {
      code: "validation_error",
      details: [{ field: "email", message: "Invalid email" }],
      message: "Request validation failed",
    },
  });
});

test("unexpected errors return a generic response and safe log event", async () => {
  const events: UnexpectedErrorEvent[] = [];
  const failure = new Error("DATABASE_URL=must-not-be-logged");
  let loggedError: unknown;
  const app = createApp({
    logUnexpectedError: (event, error) => {
      events.push(event);
      loggedError = error;
    },
    registerRoutes(routes) {
      routes.get(
        "/api/fail/:sensitiveValue",
        { public: true, reason: "Test unexpected error handling" },
        asyncRoute(async () => {
          throw failure;
        }),
      );
    },
  });
  const response = await request("/api/fail/private-value", app);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: { code: "internal_error", message: "Internal server error" },
  });
  assert.deepEqual(events, [
    {
      errorType: "Error",
      event: "unhandled_request_error",
      method: "GET",
      route: "/api/fail/:sensitiveValue",
      statusCode: 500,
    },
  ]);
  assert.equal(JSON.stringify(events).includes("private-value"), false);
  assert.equal(JSON.stringify(events).includes("DATABASE_URL"), false);
  assert.equal(loggedError, failure);
});
