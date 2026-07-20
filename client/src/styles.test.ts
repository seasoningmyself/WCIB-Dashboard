import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("screen typography keeps the approved 11px minimum", () => {
  const pixelSizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(
    (match) => Number(match[1]),
  );

  assert.ok(pixelSizes.length > 0);
  assert.deepEqual(
    pixelSizes.filter((size) => size < 11),
    [],
  );
});

test("body, table, and control examples retain the 12px content floor", () => {
  for (const rule of [
    /\.staff-rate-table\s*\{[^}]*font-size:\s*12px/,
    /\.my-drafts-table td > span:not\(\.draft-status\),[\s\S]*?font-size:\s*12px/,
    /\.ledger-table-row small,[\s\S]*?font-size:\s*12px/,
    /\.pay-sheet-policy-row,[\s\S]*?font-size:\s*12px/,
    /\.my-commission-identity span,[\s\S]*?font-size:\s*12px/,
  ]) {
    assert.match(css, rule);
  }
});

test("mobile controls keep the 44px touch-height floor", () => {
  const mobileFloorStart = css.lastIndexOf("@media (max-width: 760px)");
  assert.notEqual(mobileFloorStart, -1);
  const mobileFloor = css.slice(mobileFloorStart);

  assert.match(mobileFloor, /\.workspace-content button,/);
  assert.match(mobileFloor, /\.workspace-content input:not/);
  assert.match(mobileFloor, /\.workspace-mobile-nav select,/);
  assert.match(mobileFloor, /\.password-label-row a,/);
  assert.match(mobileFloor, /min-height:\s*44px/);
});
