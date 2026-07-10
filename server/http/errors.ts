import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { ZodError } from "zod";
import {
  apiErrorCodes,
  type ApiErrorCode,
  type ApiErrorDetail,
  type ApiErrorResponse,
} from "../../shared/api-errors.js";
import { StructuredLogger } from "../logging/logger.js";
import { safeRouteLabel } from "../logging/request.js";

export interface UnexpectedErrorEvent {
  errorType: string;
  event: "unhandled_request_error";
  method: string;
  route: string;
  statusCode: 500;
}

export type UnexpectedErrorLogger = (
  event: UnexpectedErrorEvent,
  error: unknown,
) => void;

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = "HttpError";
  }
}

interface ErrorResponse {
  response: ApiErrorResponse;
  statusCode: number;
  unexpected: boolean;
}

interface BodyParserError extends SyntaxError {
  body?: unknown;
  status?: number;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    error instanceof SyntaxError &&
    (error as BodyParserError).status === 400 &&
    "body" in error
  );
}

function createResponse(
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  details?: ApiErrorDetail[],
  unexpected = false,
): ErrorResponse {
  return {
    response: {
      error: {
        code,
        ...(details === undefined ? {} : { details }),
        message,
      },
    },
    statusCode,
    unexpected,
  };
}

export function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof HttpError) {
    return createResponse(
      error.statusCode,
      error.code,
      error.message,
      error.details,
    );
  }

  if (error instanceof ZodError) {
    const details = error.issues.slice(0, 20).map((issue) => ({
      field: issue.path.join(".") || "request",
      message: issue.message,
    }));

    return createResponse(
      400,
      apiErrorCodes.validation,
      "Request validation failed",
      details,
    );
  }

  if (isBodyParserError(error)) {
    return createResponse(
      400,
      apiErrorCodes.badRequest,
      "Request body is not valid JSON",
    );
  }

  return createResponse(
    500,
    apiErrorCodes.internal,
    "Internal server error",
    undefined,
    true,
  );
}

const defaultLogger = new StructuredLogger();
const defaultUnexpectedErrorLogger: UnexpectedErrorLogger = (event, error) => {
  defaultLogger.error("Unhandled request error", { ...event }, error);
};

export function asyncRoute(
  handler: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, apiErrorCodes.notFound, "Route not found"));
};

export function createErrorHandler(
  logUnexpectedError: UnexpectedErrorLogger = defaultUnexpectedErrorLogger,
): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const result = toErrorResponse(error);

    if (result.unexpected) {
      logUnexpectedError(
        {
          errorType: error instanceof Error ? error.name : "UnknownError",
          event: "unhandled_request_error",
          method: req.method,
          route: safeRouteLabel(req),
          statusCode: 500,
        },
        error,
      );
    }

    res.status(result.statusCode).json(result.response);
  };
}
