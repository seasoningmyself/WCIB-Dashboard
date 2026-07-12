import assert from "node:assert/strict";
import { test } from "node:test";
import { myItemSchema, myItemsResponseSchema } from "./my-items.js";

const item = {
  id: "00000000-0000-4000-8000-000000000001",
  lastActivityAt: "2026-07-11T12:00:00.000Z",
  reason: null,
  status: "draft" as const,
  submittedAt: null,
  title: "Acme Construction",
};

test("My Items schemas accept only the status-safe response contract", () => {
  assert.deepEqual(myItemSchema.parse(item), item);
  assert.deepEqual(myItemsResponseSchema.parse({ items: [item] }), {
    items: [item],
  });

  assert.throws(() =>
    myItemSchema.parse({ ...item, basePremium: "1000.00" }),
  );
  assert.throws(() =>
    myItemsResponseSchema.parse({
      items: [{ ...item, ipfsFinanced: "yes" }],
    }),
  );
});

test("My Items schemas bound titles and reasons", () => {
  assert.throws(() => myItemSchema.parse({ ...item, title: "" }));
  assert.throws(() =>
    myItemSchema.parse({ ...item, reason: "x".repeat(501) }),
  );
});
