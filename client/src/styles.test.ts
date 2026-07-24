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

test("financial and operational figures use tabular numerals globally", () => {
  assert.match(rootCss, /font-feature-settings:\s*"tnum" 1/);
  assert.match(rootCss, /font-variant-numeric:\s*tabular-nums/);
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
  const staffMobileStart = css.indexOf("@media (max-width: 680px)");
  assert.notEqual(staffMobileStart, -1);
  const staffMobile = css.slice(
    staffMobileStart,
    css.indexOf("@media (max-width: 420px)", staffMobileStart),
  );

  assert.match(mobileFloor, /\.workspace-content button,/);
  assert.match(mobileFloor, /\.workspace-content input:not/);
  assert.match(mobileFloor, /\.workspace-mobile-menu-button,/);
  assert.match(mobileFloor, /\.workspace-nav-link,/);
  assert.match(mobileFloor, /\.password-label-row a,/);
  assert.match(mobileFloor, /min-height:\s*44px/);
  assert.match(mobileFloor, /\.turn-in-icon-button\s*\{[^}]*min-width:\s*var\(--space-44\)/);
  assert.match(
    staffMobile,
    /\.staff-more-menu > summary\s*\{[^}]*min-height:\s*44px/,
  );
  assert.match(
    css,
    /\.approval-row-select\s*\{[^}]*min-width:\s*var\(--space-44\);[^}]*min-height:\s*var\(--space-44\)/,
  );
  assert.match(
    css,
    /@media \(max-width: 600px\)\s*\{[\s\S]*?\.my-items-filters\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*overflow-x:\s*visible/,
  );
  assert.match(
    mobileFloor,
    /\.my-items-new,[\s\S]*?min-height:\s*44px/,
  );
});

test("staff action menus can escape their cards and stack above later rows", () => {
  assert.match(
    css,
    /\.staff-row\s*\{[^}]*overflow:\s*visible/,
  );
  assert.match(
    css,
    /\.staff-more-menu\[open\]\s*\{[^}]*z-index:\s*5/,
  );
});

test("turn-in content reserves desktop clearance for the sticky action bar", () => {
  assert.doesNotMatch(css, /\.turn-in-draft-actions/);
  assert.match(
    css,
    /\.turn-in-action-menu > div\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*calc\(100% \+ var\(--space-8\)\)/,
  );
  assert.match(
    css,
    /\.turn-in-action-menu:not\(\[open\]\) > div\s*\{[^}]*display:\s*none/,
  );
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
  assert.match(
    css.slice(mobileTurnInStart),
    /\.turn-in-actions button,\s*\n\s*\.turn-in-action-menu summary\s*\{[^}]*min-height:\s*44px/,
  );
});

test("ledger totals use hierarchy instead of decorative series colors", () => {
  const metricsStart = css.indexOf(".ledger-metrics {");
  const toolbarStart = css.indexOf(".ledger-toolbar {", metricsStart);
  assert.notEqual(metricsStart, -1);
  assert.notEqual(toolbarStart, -1);
  const metricsCss = css.slice(metricsStart, toolbarStart);

  assert.match(metricsCss, /\.ledger-metric-primary/);
  assert.match(metricsCss, /\.ledger-metric-split/);
  assert.match(metricsCss, /\.ledger-metric-secondary/);
  assert.doesNotMatch(metricsCss, /var\(--series-/);
  assert.doesNotMatch(metricsCss, /\.ledger-metric:nth-child/);
});

test("Agency Overview keeps the first-run secondary action visually secondary", () => {
  assert.match(
    css,
    /\.app-empty-state-action\.kpi-first-run-actions > a\s*\{[^}]*background:\s*var\(--surface\)[^}]*color:\s*var\(--accent-hover\)/,
  );
});

test("MGA payables switch to labeled rows before the table can clip", () => {
  assert.match(
    css,
    /\.mga-page\s*\{[^}]*container:\s*mga-payables\s*\/\s*inline-size/,
  );
  assert.match(
    css,
    /@container mga-payables \(max-width: 1168px\)\s*\{[\s\S]*?\.mga-table-header\s*\{[^}]*display:\s*none;[\s\S]*?\.mga-table-row\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)\s*100px;/,
  );
});

test("policy ledger switches to labeled rows before the table can clip", () => {
  assert.match(
    css,
    /\.ledger-page\s*\{[^}]*container:\s*policy-ledger\s*\/\s*inline-size/,
  );
  assert.match(
    css,
    /@container policy-ledger \(max-width: 1080px\)\s*\{[\s\S]*?\.ledger-table-header\s*\{[^}]*display:\s*none;[\s\S]*?\.ledger-table-row\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)\s*40px;/,
  );
  assert.match(
    css,
    /@container policy-ledger \(max-width: 720px\)\s*\{[\s\S]*?\.ledger-toolbar\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);[\s\S]*?\.ledger-search\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/,
  );
});

test("Review Queue rows respond to their content width instead of the viewport", () => {
  assert.match(
    css,
    /\.approval-work-list\s*\{[^}]*container:\s*approval-work-list\s*\/\s*inline-size[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /@container approval-work-list \(max-width: 850px\)\s*\{[\s\S]*?\.approval-review-row\.is-submission > summary\s*\{[^}]*grid-template-columns:\s*20px 70px minmax\(0,\s*1\.4fr\) minmax\(0,\s*1fr\) 100px 78px/,
  );
  assert.match(
    css,
    /@container approval-work-list \(max-width: 700px\)\s*\{[\s\S]*?\.approval-review-row\.is-submission > summary\s*\{[^}]*grid-template-columns:\s*var\(--space-44\) 68px minmax\(0,\s*1fr\)/,
  );
});

test("settings focus outlines are not clipped by the page container", () => {
  const settingsPage = css.match(
    /\.settings-page,\s*\n\.settings-message\s*\{([^}]*)\}/,
  );

  assert.ok(settingsPage);
  assert.doesNotMatch(settingsPage[1], /overflow-x:\s*clip/);
  assert.match(
    css,
    /\.settings-form input:focus-visible,[\s\S]*?outline:\s*var\(--border-width-strong\)\s+solid\s+var\(--focus-ring\);[\s\S]*?outline-offset:\s*var\(--focus-offset\)/,
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

test("visual craft uses the approved elevation hierarchy", () => {
  assert.match(
    tokenValue("--shadow-surface"),
    /0 1px 2px rgb\(29 58 74 \/ 4%\),\s*0 4px 12px rgb\(29 58 74 \/ 4%\)/,
  );
  assert.match(
    css,
    /\/\* Level 1:[\s\S]*?\.turn-in-form,[\s\S]*?\.ledger-table,[\s\S]*?box-shadow:\s*var\(--shadow-surface\)/,
  );
  assert.match(
    css,
    /\/\* Level 0:[\s\S]*?\.turn-in-conditional,[\s\S]*?\.ledger-filter-strip,[\s\S]*?box-shadow:\s*none/,
  );
  assert.match(
    css,
    /\/\* Level 2:[\s\S]*?\.staff-dialog,[\s\S]*?\.pay-sheet-dialog,[\s\S]*?box-shadow:\s*var\(--shadow-dialog-elevated\)/,
  );
  assert.match(
    css,
    /\/\* Work-set containers own elevation;[\s\S]*?\.help-request-list[\s\S]*?background:\s*var\(--surface\)/,
  );
  assert.match(
    css,
    /:is\(\s*\.staff-row,[\s\S]*?\.help-request-card\s*\)\s*\{[^}]*border:\s*0;[^}]*box-shadow:\s*none/,
  );
  assert.match(
    css,
    /\.pay-sheet-panel\s*\{[^}]*border-top-color:\s*var\(--accent-border\)/,
  );
  assert.match(
    css,
    /\.pay-sheet-panel\.is-closed\s*\{[^}]*border-top-color:\s*var\(--dormant-text\)/,
  );
});

test("all table headers use the existing Coastal subtle surface", () => {
  assert.match(
    css,
    /\/\* One deliberate table-header surface[\s\S]*?\.staff-rate-table thead,[\s\S]*?\.my-drafts-table th,[\s\S]*?\.support-table thead[\s\S]*?background:\s*var\(--surface-subtle\)/,
  );
  assert.doesNotMatch(rootCss, /--surface-table-header:/);
});

test("Manage Staff uses one compact roster surface instead of elevated cards", () => {
  const elevationPass = css.slice(
    css.indexOf("/* UI elevation pass: sign-in composition"),
  );
  assert.match(
    elevationPass,
    /\.staff-row-main\s*\{[^}]*grid-template-areas:\s*"identity details actions"[^}]*padding:\s*var\(--space-8\) var\(--space-14\)/,
  );
  assert.match(
    elevationPass,
    /\.staff-rate-summary\s*\{[^}]*display:\s*block;[^}]*font-size:\s*var\(--font-size-body\)/,
  );
  assert.match(
    elevationPass,
    /@media \(max-width: 980px\)\s*\{[\s\S]*?\.staff-row-main\s*\{[^}]*grid-template-areas:[^}]*"identity"[^}]*"details"[^}]*"actions";[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /:is\(\s*\.staff-row,[\s\S]*?\)\s*\{[^}]*box-shadow:\s*none/,
  );
});

test("tide motif uses the approved page rule and restrained dialog echo", () => {
  assert.match(
    css,
    /\.tide-rule\s*\{[^}]*gap:\s*var\(--space-5\)[^}]*margin-top:\s*var\(--space-16\)/,
  );
  assert.match(
    css,
    /\.tide-rule span\s*\{[^}]*width:\s*var\(--space-56\)[^}]*height:\s*var\(--space-3\)/,
  );
  assert.match(
    css,
    /\.tide-rule span:nth-child\(2\)\s*\{[^}]*width:\s*var\(--space-24\)[^}]*height:\s*var\(--space-2\)[^}]*opacity:\s*var\(--opacity-tide-middle\)/,
  );
  assert.match(
    css,
    /\.tide-rule span:nth-child\(3\)\s*\{[^}]*width:\s*var\(--space-10\)[^}]*height:\s*var\(--space-2\)[^}]*opacity:\s*var\(--opacity-tide-tail\)/,
  );
  assert.equal(tokenValue("--opacity-tide-middle"), "0.55");
  assert.equal(tokenValue("--opacity-tide-tail"), "0.3");
  assert.match(
    css,
    /\.required-password-dialog h1::after\s*\{[^}]*width:\s*var\(--space-24\)[^}]*height:\s*var\(--space-2\)[^}]*margin-top:\s*var\(--space-16\)/,
  );
});

test("motion stays restrained and fully disables for reduced-motion users", () => {
  for (const token of ["--motion-fast", "--motion-dialog", "--motion-content"]) {
    const duration = Number.parseFloat(tokenValue(token));
    assert.ok(duration >= 120 && duration <= 200, `${token} is ${duration}ms`);
  }
  assert.match(css, /@keyframes coastal-dialog-enter/);
  assert.match(css, /transform:\s*scale\(var\(--motion-dialog-scale\)\)/);
  assert.match(css, /\.workspace-mobile-panel\[data-open="true"\]/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?animation:\s*none !important;[\s\S]*?transition:\s*none !important;/,
  );
});

test("status chips and loading states use the shared craft treatment", () => {
  assert.match(
    css,
    /\/\* State chips[\s\S]*?\.approval-status,[\s\S]*?\.ledger-badge,[\s\S]*?letter-spacing:\s*var\(--letter-spacing-chip\)/,
  );
  assert.match(
    css,
    /\.status-badge\s*\{[^}]*border:\s*var\(--border-width-thin\) solid var\(--dormant-border\)[^}]*background:\s*var\(--dormant-surface\)/,
  );
  assert.match(
    css,
    /\/\* Route loading[\s\S]*?\[aria-busy="true"\]::after\s*\{[^}]*animation:\s*coastal-loading-pulse/,
  );
});

test("support page-header actions use the established support button treatment", () => {
  assert.match(
    css,
    /\.support-controls :is\(input, select, button\),\s*\n\.support-refresh,[\s\S]*?min-height:\s*var\(--space-44\);[\s\S]*?border:\s*var\(--border-width-thin\) solid var\(--control-border\);/,
  );
  assert.match(
    css,
    /\.support-controls button,\s*\n\.support-refresh,[\s\S]*?cursor:\s*pointer/,
  );
});

test("focus indicators use one AA-visible width, offset, and color", () => {
  assert.match(
    css,
    /html body :is\([\s\S]*?\):focus-visible\s*\{[^}]*outline:\s*var\(--border-width-strong\) solid var\(--focus-ring\);[^}]*outline-offset:\s*var\(--focus-offset\)/,
  );
  for (const background of [
    "--surface",
    "--canvas",
    "--surface-subtle",
    "--surface-accent",
    "--surface-muted",
  ]) {
    assert.ok(
      contrastRatio(tokenValue("--focus-ring"), tokenValue(background)) >= 3,
      `focus ring on ${background}`,
    );
  }
});

test("Coastal text and interactive boundaries meet their contrast floors", () => {
  const textPairs = [
    ["--text", "--canvas"],
    ["--text", "--surface"],
    ["--text-secondary", "--canvas"],
    ["--text-secondary", "--surface"],
    ["--text-secondary", "--surface-subtle"],
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

test("viewport thresholds include only the approved responsive additions", () => {
  const breakpoints = [
    ...css.matchAll(/@media \(max-width: (\d+)px\)/g),
  ].map((match) => Number(match[1]));

  assert.deepEqual(breakpoints, [
    980, 680, 420, 680, 420, 1040, 600, 640, 1020, 760, 760, 600, 760, 900,
    680, 1160, 920, 680, 680, 520, 1080, 760, 480, 900, 700, 500,
    860, 600, 600, 760, 980, 600,
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

test("mobile settings sub-navigation scrolls labeled sections without clipping", () => {
  const mobileSettingsStart = css.lastIndexOf(
    "@media screen and (max-width: 760px)",
  );
  assert.notEqual(mobileSettingsStart, -1);
  const mobileSettings = css.slice(
    mobileSettingsStart,
    css.indexOf("@media (max-width: 600px)", mobileSettingsStart),
  );

  assert.match(
    mobileSettings,
    /\.settings-subnav\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;/,
  );
  assert.match(
    mobileSettings,
    /\.settings-subnav a\s*\{[^}]*min-width:\s*max-content;/,
  );
  assert.match(
    css,
    /\.settings-subnav a\s*\{[^}]*min-height:\s*var\(--space-44\)/,
  );
});

test("draft tables preserve horizontal access before the mobile card breakpoint", () => {
  assert.match(
    css,
    /\.my-drafts-table-wrap\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/,
  );
});
