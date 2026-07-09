import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { readPort } from "./runtime.js";

test("readPort uses the backend default when PORT is unset", () => {
  assert.equal(readPort(undefined), 5000);
});

test("readPort accepts a valid configured port", () => {
  assert.equal(readPort("8080"), 8080);
});

test("readPort rejects invalid runtime configuration", () => {
  for (const value of ["", "0", "65536", "5000abc"]) {
    assert.throws(
      () => readPort(value),
      new Error("PORT must be an integer between 1 and 65535"),
    );
  }
});

test("backend startup reports invalid PORT configuration", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      encoding: "utf8",
      env: { ...process.env, PORT: "invalid" },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /PORT must be an integer between 1 and 65535/,
  );
});
