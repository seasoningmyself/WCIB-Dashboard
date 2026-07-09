import assert from "node:assert/strict";
import { test } from "node:test";
import { readApiBaseUrl } from "./config.js";

test("readApiBaseUrl falls back to the same-origin API path", () => {
  assert.equal(readApiBaseUrl(undefined), "/api");
  assert.equal(readApiBaseUrl("  "), "/api");
});

test("readApiBaseUrl normalizes configured API paths", () => {
  assert.equal(readApiBaseUrl("/internal/api/"), "/internal/api");
  assert.equal(readApiBaseUrl("https://api.example.com/"), "https://api.example.com");
});

test("readApiBaseUrl rejects unsafe or ambiguous values", () => {
  assert.throws(
    () => readApiBaseUrl("api.example.com"),
    /must be an HTTP\(S\) URL or a root-relative path/,
  );
  assert.throws(
    () => readApiBaseUrl("javascript:alert(1)"),
    /must be an HTTP\(S\) URL or a root-relative path/,
  );
});
