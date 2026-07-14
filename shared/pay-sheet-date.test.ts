import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatPaySheetDateInput,
  normalizePaySheetDateInput,
} from "./pay-sheet-date.js";

test("pay-sheet dates normalize final-v15 typed forms to ISO", () => {
  assert.equal(normalizePaySheetDateInput("6926"), "2026-06-09");
  assert.equal(normalizePaySheetDateInput("06102026"), "2026-06-10");
  assert.equal(normalizePaySheetDateInput("6102026"), "2026-06-10");
  assert.equal(normalizePaySheetDateInput("061026"), "2026-06-10");
  assert.equal(normalizePaySheetDateInput("61026"), "2026-06-10");
  assert.equal(normalizePaySheetDateInput("6/10/26"), "2026-06-10");
  assert.equal(normalizePaySheetDateInput("2026-06-10"), "2026-06-10");
  assert.equal(formatPaySheetDateInput("2026-06-10"), "06/10/2026");
});

test("pay-sheet date normalization rejects impossible and ambiguous values", () => {
  for (const value of ["", "0926", "13312026", "02312026", "June 10", null]) {
    assert.equal(normalizePaySheetDateInput(value), null);
  }
});
