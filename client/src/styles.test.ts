import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const rootMatch = css.match(/^:root\s*\{([\s\S]*?)\n\}/);

assert.ok(rootMatch);

const rootCss = rootMatch[1];
const screenCss = css.slice(rootMatch[0].length);
const tokens = new Map(
  [...rootCss.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
    match[1],
    match[2].trim(),
  ]),
);

function tokenValue(name: string): string {
  const value = tokens.get(name);
  assert.ok(value, `Missing token ${name}`);
  return value;
}

test("screen typography keeps the approved 11px minimum", () => {
  const fontSizeTokens = [
    ...screenCss.matchAll(/font-size:\s*var\((--[\w-]+)\)/g),
  ].map((match) => tokenValue(match[1]));
  const pixelSizes = fontSizeTokens
    .filter((value) => value.endsWith("px"))
    .map((value) => Number.parseFloat(value));

  assert.ok(pixelSizes.length > 0);
  assert.deepEqual(pixelSizes.filter((size) => size < 11), []);
  assert.doesNotMatch(screenCss, /font-size:\s*(?:\d|clamp\()/);
});

test("body, table, and control examples retain the 12px content floor", () => {
  for (const rule of [
    /\.staff-rate-table\s*\{[^}]*font-size:\s*var\(--font-size-body\)/,
    /\.my-drafts-table td > span:not\(\.draft-status\),[\s\S]*?font-size:\s*var\(--font-size-body\)/,
    /\.ledger-table-row small,[\s\S]*?font-size:\s*var\(--font-size-body\)/,
    /\.pay-sheet-policy-row,[\s\S]*?font-size:\s*var\(--font-size-body\)/,
    /\.my-commission-identity span,[\s\S]*?font-size:\s*var\(--font-size-body\)/,
  ]) {
    assert.match(css, rule);
  }
  assert.equal(tokenValue("--font-size-body"), "12px");
  assert.equal(tokenValue("--font-size-meta"), "11px");
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

test("raw visual values stay inside the token definition block", () => {
  assert.doesNotMatch(
    screenCss,
    /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)/i,
  );
  assert.doesNotMatch(
    screenCss,
    /(?:background|border-color|-webkit-tap-highlight-color):\s*transparent/,
  );

  for (const match of screenCss.matchAll(
    /(?:^|\n)\s*((?:margin|padding|gap|row-gap|column-gap)(?:-[\w-]+)?):\s*([^;]+);/g,
  )) {
    assert.doesNotMatch(
      match[2],
      /(?<![-\w.])-?\d*\.?\d+(?:px|pt|rem|em|ch|vw|vh|vmin|vmax|cm|%)\b/,
      `${match[1]} still contains a raw spacing value: ${match[2]}`,
    );
  }

  for (const match of screenCss.matchAll(/border-radius:\s*([^;]+);/g)) {
    assert.match(match[1], /^var\(--radius-/);
  }
  for (const match of screenCss.matchAll(/box-shadow:\s*([^;]+);/g)) {
    assert.match(match[1], /^(?:none|var\(--shadow-)/);
  }
});

test("font weights use the approved real-weight tokens", () => {
  assert.equal(tokenValue("--font-weight-regular"), "400");
  assert.equal(tokenValue("--font-weight-medium"), "500");
  assert.equal(tokenValue("--font-weight-semibold"), "600");
  assert.equal(tokenValue("--font-weight-bold"), "700");
  assert.doesNotMatch(
    screenCss,
    /font-weight:\s*(?:600|650|700|720|750|760|780|800|820|850)\b/,
  );
  assert.doesNotMatch(screenCss, /letter-spacing:\s*0\b/);
});

test("approved neutral color families resolve to one semantic token each", () => {
  assert.equal(tokenValue("--text-muted"), "#5e6b75");
  assert.equal(tokenValue("--text-secondary"), "#52616d");
  assert.equal(tokenValue("--text-strong"), "#263640");
  assert.equal(tokenValue("--border"), "#cbd5d7");
  assert.equal(tokenValue("--border-subtle"), "#d3dcdf");
});

test("responsive thresholds remain unchanged", () => {
  const breakpoints = [
    ...css.matchAll(/@media \(max-width: (\d+)px\)/g),
  ].map((match) => Number(match[1]));

  assert.deepEqual(breakpoints, [
    980, 680, 420, 680, 420, 1040, 600, 640, 1020, 760, 600, 760, 900,
    680, 1160, 920, 680, 1080, 680, 520, 1080, 760, 480, 900, 700, 500,
    860, 600, 600, 760,
  ]);
});
