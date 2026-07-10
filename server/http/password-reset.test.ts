import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import type { AppLogger, LogContext } from "../logging/logger.js";
import {
  createPasswordResetConfirmHandler,
  createPasswordResetRequestHandler,
} from "./password-reset.js";
import { toErrorResponse } from "./errors.js";

interface HandlerResponse {
  body: unknown;
  statusCode: number;
}

function recordingLogger() {
  const events: Array<{
    context?: LogContext;
    level: "error" | "info" | "warn";
    message: string;
  }> = [];
  const logger: AppLogger = {
    error(message, context) {
      events.push({ context, level: "error", message });
    },
    info(message, context) {
      events.push({ context, level: "info", message });
    },
    warn(message, context) {
      events.push({ context, level: "warn", message });
    },
  };
  return { events, logger };
}

async function invokeHandler(
  handler: RequestHandler,
  body: unknown,
): Promise<HandlerResponse> {
  return new Promise<HandlerResponse>((resolve, reject) => {
    let statusCode = 200;
    const req = { body } as Request;
    const res = {
      clearCookie() {
        return res;
      },
      end() {
        resolve({ body: null, statusCode });
        return res;
      },
      json(responseBody: unknown) {
        resolve({ body: responseBody, statusCode });
        return res;
      },
      status(nextStatusCode: number) {
        statusCode = nextStatusCode;
        return res;
      },
    } as unknown as Response;
    const next: NextFunction = (error?: unknown) => {
      if (error === undefined) {
        reject(new Error("Password reset handler called next without an error"));
        return;
      }
      const result = toErrorResponse(error);
      resolve({ body: result.response, statusCode: result.statusCode });
    };
    handler(req, res, next);
  });
}

test("reset requests never reveal account or delivery state", async () => {
  const body = { email: "user@example.test" };
  const expected = { body: { status: "accepted" }, statusCode: 202 };
  const outcomes = [
    { status: "not_issued" as const },
    { status: "delivered" as const },
    { status: "delivery_failed" as const },
  ];

  for (const outcome of outcomes) {
    const { events, logger } = recordingLogger();
    const handler = createPasswordResetRequestHandler({
      logger,
      async requestReset() {
        return outcome;
      },
    });
    const response = await invokeHandler(handler, body);

    assert.deepEqual(response, expected);
    assert.equal(JSON.stringify(response).includes(body.email), false);
    assert.equal(JSON.stringify(events).includes(body.email), false);
    assert.equal(JSON.stringify(events).includes("must-not"), false);
  }

  const { logger } = recordingLogger();
  const failedHandler = createPasswordResetRequestHandler({
    logger,
    async requestReset() {
      throw new Error("database unavailable");
    },
  });
  assert.deepEqual(await invokeHandler(failedHandler, body), expected);
});

test("reset confirmation returns empty success or one generic token error", async () => {
  const body = {
    password: "StrongPass123!",
    token: "a".repeat(43),
  };
  const { logger } = recordingLogger();
  const success = createPasswordResetConfirmHandler({
    async confirmReset() {
      return true;
    },
    logger,
  });
  const rejected = createPasswordResetConfirmHandler({
    async confirmReset() {
      return false;
    },
    logger,
  });

  assert.deepEqual(await invokeHandler(success, body), {
    body: null,
    statusCode: 204,
  });
  assert.deepEqual(await invokeHandler(rejected, body), {
    body: {
      error: {
        code: "invalid_reset_token",
        message: "Password reset token is invalid or expired",
      },
    },
    statusCode: 400,
  });
});

test("reset confirmation enforces password policy before token lookup", async () => {
  const { logger } = recordingLogger();
  let confirmations = 0;
  const handler = createPasswordResetConfirmHandler({
    async confirmReset() {
      confirmations += 1;
      return true;
    },
    logger,
  });

  const response = await invokeHandler(handler, {
    password: "weak",
    token: "a".repeat(43),
  });

  assert.equal(response.statusCode, 400);
  assert.equal(confirmations, 0);
  assert.equal(JSON.stringify(response).includes("weak"), false);
});

test("unexpected confirmation errors use the generic API response", async () => {
  const { logger } = recordingLogger();
  const handler = createPasswordResetConfirmHandler({
    async confirmReset() {
      throw new Error("token=must-not-reach-response");
    },
    logger,
  });

  const response = await invokeHandler(handler, {
    password: "StrongPass123!",
    token: "a".repeat(43),
  });

  assert.deepEqual(response, {
    body: {
      error: { code: "internal_error", message: "Internal server error" },
    },
    statusCode: 500,
  });
  assert.equal(JSON.stringify(response).includes("must-not"), false);
});
