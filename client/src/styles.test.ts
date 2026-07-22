import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
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

function colorChannel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const color = hex.replace("#", "");
  assert.equal(color.length, 6, `Expected a six-digit color, received ${hex}`);
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    colorChannel(Number.parseInt(color.slice(offset, offset + 2), 16)),
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
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

test("Archivo is self-hosted at every supported UI weight", () => {
  assert.match(tokenValue("--font-family-ui"), /^"Archivo",/);
  for (const weight of [400, 500, 600, 700]) {
    assert.match(mainSource, new RegExp(`@fontsource/archivo/${weight}\\.css`));
  }
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
  assert.match(mobileFloor, /\.workspace-mobile-menu-button,/);
  assert.match(mobileFloor, /\.workspace-nav-link,/);
  assert.match(mobileFloor, /\.password-label-row a,/);
  assert.match(mobileFloor, /min-height:\s*44px/);
  assert.match(mobileFloor, /\.turn-in-icon-button\s*\{[^}]*min-width:\s*var\(--space-44\)/);
});

test("turn-in content reserves desktop clearance for the sticky action bar", () => {
  assert.match(
    css,
    /@media \(min-width: 761px\)\s*\{\s*\.turn-in-page\s*\{[^}]*padding-bottom:\s*var\(--space-0\)[^}]*\}\s*\.turn-in-controls\s*\{[^}]*padding-bottom:\s*var\(--space-72\)[^}]*\}\s*\.turn-in-controls :is\(button, input, select, textarea\)\s*\{[^}]*scroll-margin-bottom:\s*var\(--space-72\)/,
  );

  const mobileTurnInStart = css.indexOf("@media (max-width: 760px)");
  assert.notEqual(mobileTurnInStart, -1);
  assert.match(
    css.slice(mobileTurnInStart),
    /\.turn-in-actions\s*\{[^}]*position:\s*static/,
  );
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

test("Coastal uses the approved 46-property color vocabulary", () => {
  const coastalColors = {
    "--canvas": "#F2EFE9",
    "--surface": "#FFFFFF",
    "--surface-subtle": "#F8F6F2",
    "--surface-muted": "#EAE7E0",
    "--surface-accent": "#E4EDF3",
    "--surface-selected": "#D2E0E9",
    "--surface-sticky": "rgb(255 255 255 / 97%)",
    "--text": "#1D3A4A",
    "--text-secondary": "#405C6D",
    "--text-muted": "#536A7A",
    "--text-inverse": "#FFFFFF",
    "--border": "#DDD8CE",
    "--border-subtle": "#E8E4DC",
    "--border-strong": "#87837B",
    "--control-border": "#74858E",
    "--accent-border": "#647F93",
    "--accent": "#3E6C8D",
    "--accent-hover": "#315A78",
    "--accent-pressed": "#264A63",
    "--focus-ring": "#3E6C8D",
    "--nav-surface": "#1D3A4A",
    "--nav-surface-deep": "#122B38",
    "--nav-surface-hover": "#31566C",
    "--success-text": "#2F5A48",
    "--success": "#47745D",
    "--success-border": "#688A78",
    "--success-surface": "#E7F0EB",
    "--warning-text": "#694A16",
    "--warning": "#815B20",
    "--warning-border": "#9B7636",
    "--warning-surface": "#F6EEDC",
    "--error-text": "#783434",
    "--error": "#9C4949",
    "--error-border": "#AD6663",
    "--error-surface": "#F7E9E7",
    "--dormant-text": "#58636C",
    "--dormant-border": "#7D8588",
    "--dormant-surface": "#EEEDE9",
    "--series-1": "#3E6C8D",
    "--series-2": "#3F7A78",
    "--series-3": "#5F7D5B",
    "--series-4": "#A57232",
    "--series-5": "#74658D",
    "--overlay-soft": "rgb(29 58 74 / 56%)",
    "--overlay": "rgb(18 43 56 / 68%)",
    "--transparent": "transparent",
  } as const;

  assert.equal(Object.keys(coastalColors).length, 46);
  for (const [name, value] of Object.entries(coastalColors)) {
    assert.equal(tokenValue(name), value, name);
  }
});

test("Coastal canvas reaches every full-page ground", () => {
  assert.match(
    css,
    /\.app-shell\s*\{[^}]*background:\s*var\(--canvas\)/,
  );
  assert.match(
    css,
    /\.login-page,\s*\n\.auth-status-page\s*\{[^}]*background:[\s\S]*?var\(--canvas\)/,
  );
  assert.match(
    css,
    /\.workspace-shell\s*\{[^}]*background:\s*var\(--canvas\)/,
  );
});

test("Coastal text and interactive boundaries meet their contrast floors", () => {
  const textPairs = [
    ["--text", "--canvas"],
    ["--text", "--surface"],
    ["--text-secondary", "--canvas"],
    ["--text-secondary", "--surface"],
    ["--text-muted", "--canvas"],
    ["--text-muted", "--surface"],
    ["--text-inverse", "--accent"],
    ["--text-inverse", "--accent-hover"],
    ["--text-inverse", "--accent-pressed"],
    ["--text-inverse", "--nav-surface"],
    ["--text-inverse", "--nav-surface-hover"],
    ["--success-text", "--success-surface"],
    ["--warning-text", "--warning-surface"],
    ["--error-text", "--error-surface"],
    ["--dormant-text", "--dormant-surface"],
    ["--accent", "--surface-accent"],
    ["--accent-hover", "--surface-accent"],
    ["--accent-pressed", "--surface-selected"],
    ["--series-2", "--surface-subtle"],
    ["--series-5", "--surface-subtle"],
  ] as const;
  for (const [foreground, background] of textPairs) {
    assert.ok(
      contrastRatio(tokenValue(foreground), tokenValue(background)) >= 4.5,
      `${foreground} on ${background} must meet 4.5:1`,
    );
  }

  for (const foreground of [
    "--control-border",
    "--accent-border",
    "--border-strong",
    "--focus-ring",
    "--series-1",
    "--series-2",
    "--series-3",
    "--series-4",
    "--series-5",
  ]) {
    assert.ok(
      contrastRatio(tokenValue(foreground), tokenValue("--surface")) >= 3,
      `${foreground} on --surface must meet 3:1`,
    );
  }
});

test("state surfaces are not reused for generic interaction feedback", () => {
  const stateSurfaceRules = [
    ...screenCss.matchAll(/([^{}]+)\{[^{}]*background:\s*var\(--(?:success|warning|error)-surface\)/g),
  ].map((match) => match[1].trim());

  for (const selector of stateSurfaceRules) {
    assert.doesNotMatch(selector, /:hover|:focus|:disabled|aria-(?:pressed|selected|expanded)/);
  }
  assert.match(
    css,
    /\.staff-vocabulary-class\.is-commercial\s*\{[^}]*border-color:\s*var\(--series-2\);[^}]*background:\s*var\(--surface-subtle\)/,
  );
  assert.match(
    css,
    /\.staff-vocabulary-class\.is-personal\s*\{[^}]*border-color:\s*var\(--series-5\);[^}]*background:\s*var\(--surface-subtle\)/,
  );
  assert.match(
    css,
    /\.staff-vocabulary-class\.is-life-health\s*\{[^}]*border-color:\s*var\(--series-4\);[^}]*background:\s*var\(--surface-subtle\)/,
  );
});

test("disabled controls keep AA text contrast after feature-specific rules", () => {
  const overrideStart = screenCss.lastIndexOf(
    "/* Disabled controls remain visibly distinct without reducing text contrast. */",
  );

  assert.ok(overrideStart > screenCss.lastIndexOf("opacity: 0.58"));
  assert.match(
    screenCss.slice(overrideStart),
    /button:disabled:disabled,[\s\S]*?background-color:\s*var\(--dormant-surface\);[\s\S]*?color:\s*var\(--dormant-text\);[\s\S]*?opacity:\s*1;/,
  );
});

test("pay-sheet owner labels do not reduce approved text contrast with opacity", () => {
  const ownerLabelRule = css.match(
    /\.pay-sheet-owner-tabs button small\s*\{([^}]*)\}/,
  );

  assert.ok(ownerLabelRule);
  assert.doesNotMatch(ownerLabelRule[1], /opacity:/);
});

test("removed overloaded color properties are no longer referenced", () => {
  for (const token of [
    "--surface-strong",
    "--selected-surface",
    "--accent-border-strong",
    "--metric-accent",
    "--paid-accent",
    "--ipfs-pushed-accent",
    "--override-accent",
    "--focus-ring-solid",
  ]) {
    assert.doesNotMatch(css, new RegExp(`${token}\\b`));
  }
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

test("mobile MFA method actions override the compact desktop height", () => {
  const mfaMobileStart = css.indexOf(
    "@media (max-width: 760px)",
    css.indexOf(".mfa-enrollment-page"),
  );
  const nextMobileBlock = css.indexOf(
    "@media (max-width: 760px)",
    mfaMobileStart + 1,
  );
  assert.notEqual(mfaMobileStart, -1);
  assert.notEqual(nextMobileBlock, -1);
  const mfaMobile = css.slice(mfaMobileStart, nextMobileBlock);

  assert.match(
    mfaMobile,
    /\.mfa-method-list li > \.mfa-method-row-actions button\s*\{[^}]*min-height:\s*44px;/,
  );
});

test("mobile settings tabs fit all four sections without clipping", () => {
  const mobileSettingsStart = css.lastIndexOf("@media (max-width: 600px)");
  const mobileTouchStart = css.lastIndexOf("@media (max-width: 760px)");
  assert.notEqual(mobileSettingsStart, -1);
  assert.ok(mobileTouchStart > mobileSettingsStart);
  const mobileSettings = css.slice(mobileSettingsStart, mobileTouchStart);

  assert.match(
    mobileSettings,
    /\.settings-tabs\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*overflow-x:\s*visible;/,
  );
  assert.match(
    mobileSettings,
    /\.settings-tabs button\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*44px;/,
  );
});
