import assert from "node:assert/strict";
import { test } from "node:test";
import { formatManagedSchemaVerificationError } from "./managed-schema-verification.js";

test("managed schema failures expose only a sanitized database code", () => {
  const error = Object.assign(
    new Error("failed for postgresql://user:secret@example.test/wcib"),
    { code: "42501" },
  );

  assert.equal(
    formatManagedSchemaVerificationError(error),
    "Managed schema verification failed (42501)",
  );
});
