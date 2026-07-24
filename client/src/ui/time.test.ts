import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ageInWholeDays,
  formatAbsoluteTimestamp,
  formatRelativeTime,
} from "./time.js";

const NOW = new Date("2026-07-23T18:00:00.000Z");

test("relative timestamps choose useful triage units", () => {
  assert.equal(formatRelativeTime("2026-07-23T17:59:31.000Z", NOW), "just now");
  assert.equal(formatRelativeTime("2026-07-23T17:52:00.000Z", NOW), "8 minutes ago");
  assert.equal(formatRelativeTime("2026-07-23T15:00:00.000Z", NOW), "3 hours ago");
  assert.equal(formatRelativeTime("2026-07-20T18:00:00.000Z", NOW), "3 days ago");
  assert.equal(formatRelativeTime("2026-05-23T18:00:00.000Z", NOW), "2 months ago");
});

test("relative timestamps preserve invalid values and handle future clock skew", () => {
  assert.equal(formatRelativeTime("not-a-date", NOW), "not-a-date");
  assert.equal(formatRelativeTime("2026-07-23T18:05:00.000Z", NOW), "in 5 minutes");
});

test("whole-day age is nonnegative and deterministic", () => {
  assert.equal(ageInWholeDays("2026-07-20T17:00:00.000Z", NOW), 3);
  assert.equal(ageInWholeDays("2026-07-24T18:00:00.000Z", NOW), 0);
  assert.equal(ageInWholeDays("invalid", NOW), null);
});

test("absolute timestamps retain the exact date and time for hover text", () => {
  assert.match(formatAbsoluteTimestamp("2026-07-23T18:00:00.000Z"), /Jul 23, 2026/);
  assert.equal(formatAbsoluteTimestamp("invalid"), "invalid");
});
