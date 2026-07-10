import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";
import { z } from "zod";
import { createApp } from "./app.js";
import { asyncRoute, type UnexpectedErrorEvent } from "./http/errors.js";

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

  return {
    body: JSON.parse(body),
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

test("unknown routes use the standard API error shape", async () => {
  const response = await request("/missing");

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, {
    error: { code: "not_found", message: "Route not found" },
  });
});

test("validation errors use the standard API error shape", async () => {
  const app = createApp({
    registerRoutes(expressApp) {
      expressApp.get(
        "/api/validate",
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
  const app = createApp({
    logUnexpectedError: (event) => events.push(event),
    registerRoutes(expressApp) {
      expressApp.get(
        "/api/fail/:sensitiveValue",
        asyncRoute(async () => {
          throw new Error("DATABASE_URL=must-not-be-logged");
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
});
