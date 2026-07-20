import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../app.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import {
  CSP_REPORT_PATH,
  SECURITY_RESPONSE_HEADERS,
} from "../../shared/security-policy.js";

test("security headers cover success, readiness, validation, and not-found responses", async () => {
  const app = createApp({
    readinessCheck: async () => {},
    registerRoutes(routes) {
      routes.post(
        "/api/test/json",
        { public: true, reason: "Test global headers on parsed requests" },
        (req, res) => res.json({ body: req.body }),
      );
    },
  });
  const running = await startServer(app);

  try {
    const responses = [
      await fetch(`${running.baseUrl}/api`),
      await fetch(`${running.baseUrl}/health`),
      await fetch(`${running.baseUrl}/ready`),
      await fetch(`${running.baseUrl}/missing`),
      await fetch(`${running.baseUrl}/api/test/json`, {
        body: "{not-json",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    ];
    assert.deepEqual(
      responses.map(({ status }) => status),
      [200, 200, 200, 404, 400],
    );
    for (const response of responses) {
      assertSecurityHeaders(response.headers);
    }
  } finally {
    await closeServer(running.server);
  }
});

test("CSP report-only endpoint logs bounded sanitized violations without secrets", async () => {
  const events: Array<{ context?: LogContext; message: string }> = [];
  const logger: AppLogger = {
    error() {},
    info() {},
    warn(message, context) {
      events.push({ context, message });
    },
  };
  const app = createApp({ logger });
  const running = await startServer(app);

  try {
    const response = await fetch(`${running.baseUrl}${CSP_REPORT_PATH}`, {
      body: JSON.stringify({
        "csp-report": {
          "blocked-uri": "inline",
          "column-number": 27,
          "document-uri":
            "https://dashboard.example.test/settings?token=must-not-log",
          "effective-directive": "style-src-elem",
          "line-number": 14,
          "source-file":
            "https://dashboard.example.test/assets/app.js?password=must-not-log",
          "status-code": 200,
        },
      }),
      headers: { "content-type": "application/csp-report" },
      method: "POST",
    });

    assert.equal(response.status, 204);
    assertSecurityHeaders(response.headers);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      context: {
        blockedSource: "inline",
        columnNumber: 27,
        component: "security",
        documentPath: "https://dashboard.example.test/settings",
        effectiveDirective: "style-src-elem",
        event: "csp_report_only_violation",
        lineNumber: 14,
        sourcePath: "https://dashboard.example.test/assets/app.js",
        statusCode: 200,
      },
      message: "CSP report-only violation observed",
    });
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes("must-not-log"), false);
    assert.equal(serialized.includes("token="), false);
    assert.equal(serialized.includes("password="), false);
  } finally {
    await closeServer(running.server);
  }
});

function assertSecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
    assert.equal(headers.get(name), value, name);
  }
  const reportOnly = headers.get("content-security-policy-report-only") ?? "";
  assert.match(reportOnly, /script-src 'self'/);
  assert.match(reportOnly, /style-src 'self'/);
  assert.match(reportOnly, /frame-ancestors 'none'/);
  assert.doesNotMatch(reportOnly, /unsafe-inline|unsafe-eval/);
  assert.equal(headers.get("content-security-policy"), "frame-ancestors 'none'");
}

async function startServer(app: ReturnType<typeof createApp>): Promise<{
  baseUrl: string;
  server: Server;
}> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
    server,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
