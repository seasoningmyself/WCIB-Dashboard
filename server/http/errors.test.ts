import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  createErrorHandler,
  HttpError,
  toErrorResponse,
} from "./errors.js";

test("toErrorResponse maps known HTTP errors", () => {
  assert.deepEqual(
    toErrorResponse(
      new HttpError(404, apiErrorCodes.notFound, "Route not found"),
    ),
    {
      response: {
        error: { code: "not_found", message: "Route not found" },
      },
      statusCode: 404,
      unexpected: false,
    },
  );
});

test("toErrorResponse maps Zod issues to client-safe details", () => {
  const error = z
    .object({ email: z.string().email() })
    .safeParse({ email: "invalid" }).error;

  assert.ok(error);
  assert.deepEqual(toErrorResponse(error), {
    response: {
      error: {
        code: "validation_error",
        details: [{ field: "email", message: "Invalid email" }],
        message: "Request validation failed",
      },
    },
    statusCode: 400,
    unexpected: false,
  });
});

test("toErrorResponse hides unexpected error details", () => {
  const result = toErrorResponse(
    new Error("SESSION_SECRET=must-not-reach-the-client"),
  );

  assert.deepEqual(result, {
    response: {
      error: { code: "internal_error", message: "Internal server error" },
    },
    statusCode: 500,
    unexpected: true,
  });
});

test("error middleware forwards errors after headers are sent", () => {
  const error = new Error("late failure");
  let forwarded: unknown;
  let logged = false;
  const handler = createErrorHandler(() => {
    logged = true;
  });

  handler(
    error,
    { method: "GET" } as Request,
    { headersSent: true } as Response,
    ((nextError?: unknown) => {
      forwarded = nextError;
    }) as NextFunction,
  );

  assert.equal(forwarded, error);
  assert.equal(logged, false);
});
