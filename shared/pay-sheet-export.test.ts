import assert from "node:assert/strict";
import { test } from "node:test";
import { paySheetExportQuerySchema } from "./pay-sheet-export.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";

test("pay-sheet export scope requires one bounded period and optional owner UUID", () => {
  assert.deepEqual(
    paySheetExportQuerySchema.parse({ periodMonth: "7", periodYear: "2026" }),
    { ownerUserId: null, periodMonth: 7, periodYear: 2026 },
  );
  assert.deepEqual(
    paySheetExportQuerySchema.parse({
      ownerUserId: OWNER_ID,
      periodMonth: 12,
      periodYear: 9999,
    }),
    { ownerUserId: OWNER_ID, periodMonth: 12, periodYear: 9999 },
  );
  for (const invalid of [
    {},
    { periodMonth: 0, periodYear: 2026 },
    { periodMonth: 13, periodYear: 2026 },
    { ownerUserId: "not-a-uuid", periodMonth: 7, periodYear: 2026 },
    { ownerType: "producer", periodMonth: 7, periodYear: 2026 },
  ]) {
    assert.equal(paySheetExportQuerySchema.safeParse(invalid).success, false);
  }
});
