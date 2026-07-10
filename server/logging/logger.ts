import { redactLogValue } from "./redact.js";

export type LogLevel = "error" | "info" | "warn";
export type LogContext = Record<string, unknown>;

export interface ErrorTrackerContext {
  extra: Record<string, unknown>;
  level: "error";
  tags: Record<string, string>;
}

export interface ErrorTrackerAdapter {
  captureException(error: unknown, context: ErrorTrackerContext): void;
}

export interface StructuredLoggerOptions {
  clock?: () => Date;
  errorTracker?: ErrorTrackerAdapter;
  write?: (line: string, level: LogLevel) => void;
}

export interface AppLogger {
  error(message: string, context?: LogContext, error?: unknown): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
}

const noOpErrorTracker: ErrorTrackerAdapter = {
  captureException() {},
};

const defaultWriter = (line: string, level: LogLevel): void => {
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
};

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function asLogContext(value: unknown): LogContext {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as LogContext;
  }
  return {};
}

function trackerTags(context: LogContext): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const key of [
    "component",
    "errorType",
    "event",
    "method",
    "route",
    "statusCode",
  ]) {
    const value = context[key];
    if (typeof value === "string" || typeof value === "number") {
      tags[key] = String(value);
    }
  }
  return tags;
}

export class StructuredLogger implements AppLogger {
  private readonly clock: () => Date;
  private readonly errorTracker: ErrorTrackerAdapter;
  private readonly write: (line: string, level: LogLevel) => void;

  constructor(options: StructuredLoggerOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.errorTracker = options.errorTracker ?? noOpErrorTracker;
    this.write = options.write ?? defaultWriter;
  }

  info(message: string, context?: LogContext): void {
    this.emit("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.emit("warn", message, context);
  }

  error(message: string, context: LogContext = {}, error?: unknown): void {
    const safeContext = asLogContext(
      redactLogValue({
        ...context,
        ...(error === undefined ? {} : { errorType: getErrorType(error) }),
      }),
    );
    this.emitSafe("error", message, safeContext);

    if (error === undefined) {
      return;
    }

    try {
      this.errorTracker.captureException(error, {
        extra: safeContext,
        level: "error",
        tags: trackerTags(safeContext),
      });
    } catch {
      this.emit("warn", "Error tracker adapter failed", {
        event: "error_tracker_adapter_failed",
        tracker: "sentry",
      });
    }
  }

  private emit(level: LogLevel, message: string, context?: LogContext): void {
    this.emitSafe(level, message, asLogContext(redactLogValue(context ?? {})));
  }

  private emitSafe(
    level: LogLevel,
    message: string,
    context: LogContext,
  ): void {
    const safeMessage = redactLogValue(message);
    const record = {
      timestamp: this.clock().toISOString(),
      level,
      message: typeof safeMessage === "string" ? safeMessage : "Log event",
      ...(Object.keys(context).length === 0 ? {} : { context }),
    };
    this.write(JSON.stringify(record), level);
  }
}
