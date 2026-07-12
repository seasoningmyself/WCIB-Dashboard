import ExcelJS from "exceljs";
import type { Writable } from "node:stream";
import {
  paySheetDetailSchema,
  type PaySheetAdjustmentView,
  type PaySheetDetail,
  type PaySheetPolicyView,
  type PaySheetTotals,
} from "../../shared/pay-sheet-api.js";
import type {
  PaySheetExportFormat,
  PaySheetExportQuery,
} from "../../shared/pay-sheet-export.js";

const MONEY_FORMAT = "$#,##0.00;[Red]-$#,##0.00";
const DANGEROUS_FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;
const INVALID_SHEET_NAME = /[\[\]:*?/\\\u0000-\u001f]/g;

export interface PaySheetExportModel {
  generatedAt: string;
  periodMonth: number;
  periodYear: number;
  scope: "all" | "single";
  sheets: readonly PaySheetDetail[];
}

export class PaySheetExportNotFoundError extends Error {
  constructor() {
    super("No pay sheets matched the export scope");
    this.name = "PaySheetExportNotFoundError";
  }
}

export class PaySheetExportConsistencyError extends Error {
  constructor() {
    super("Pay-sheet export facts are inconsistent");
    this.name = "PaySheetExportConsistencyError";
  }
}

export function buildPaySheetExportModel(
  rawSheets: readonly PaySheetDetail[],
  query: PaySheetExportQuery,
  generatedAt: Date,
): PaySheetExportModel {
  if (Number.isNaN(generatedAt.getTime())) {
    throw new PaySheetExportConsistencyError();
  }
  const sheets = rawSheets.map((sheet) => paySheetDetailSchema.parse(sheet));
  if (sheets.length === 0) {
    throw new PaySheetExportNotFoundError();
  }
  const seenOwners = new Set<string>();
  for (const sheet of sheets) {
    if (
      sheet.periodMonth !== query.periodMonth ||
      sheet.periodYear !== query.periodYear ||
      (query.ownerUserId !== null && sheet.ownerUserId !== query.ownerUserId) ||
      seenOwners.has(sheet.ownerUserId)
    ) {
      throw new PaySheetExportConsistencyError();
    }
    seenOwners.add(sheet.ownerUserId);
  }
  if (query.ownerUserId !== null && sheets.length !== 1) {
    throw new PaySheetExportConsistencyError();
  }
  return {
    generatedAt: generatedAt.toISOString(),
    periodMonth: query.periodMonth,
    periodYear: query.periodYear,
    scope: query.ownerUserId === null ? "all" : "single",
    sheets: [...sheets].sort(compareSheets),
  };
}

export async function writePaySheetWorkbook(
  model: PaySheetExportModel,
  output: Writable,
): Promise<void> {
  const generatedAt = new Date(model.generatedAt);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useSharedStrings: true,
    useStyles: true,
  });
  workbook.creator = "WCIB Dashboard";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.subject = `Pay sheets for ${periodLabel(model)}`;
  workbook.title = "WCIB Pay Sheet Report";

  writeAgencySummaryWorksheet(workbook, model);
  writeActivityWorksheet(workbook, model);
  const names = new Set<string>(["Agency Summary", "KPI Activity"]);
  for (const sheet of model.sheets) {
    writeOwnerWorksheet(workbook, sheet, uniqueSheetName(sheet.ownerDisplayName, names));
  }
  await workbook.commit();
}

export function renderPaySheetPrintHtml(model: PaySheetExportModel): string {
  const title = `WCIB Pay Sheet Report - ${periodLabel(model)}`;
  const summary = renderPrintSummary(model);
  const activity = renderPrintActivity(model);
  const owners = model.sheets.map(renderPrintOwner).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head>
<body><main><header class="report-header"><p>West Coast Insurance Brokers</p><h1>${escapeHtml(title)}</h1><span>Prepared ${escapeHtml(formatGeneratedAt(model.generatedAt))}</span></header>
${summary}${activity}${owners}</main></body></html>`;
}

export function paySheetExportFilename(
  query: PaySheetExportQuery,
  format: PaySheetExportFormat,
): string {
  const scope = query.ownerUserId === null ? "Pay_Sheets" : "Pay_Sheet";
  const extension = format === "excel" ? "xlsx" : "html";
  return `WCIB_${scope}_${query.periodYear}-${String(query.periodMonth).padStart(2, "0")}.${extension}`;
}

export function safeSpreadsheetText(value: string): string {
  return DANGEROUS_FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function writeAgencySummaryWorksheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  model: PaySheetExportModel,
): void {
  const worksheet = workbook.addWorksheet("Agency Summary", {
    properties: { defaultRowHeight: 18 },
  });
  worksheet.columns = [
    { key: "label", width: 30 },
    { key: "policies", width: 12 },
    { key: "broker", width: 16 },
    { key: "commission", width: 16 },
    { key: "trust", width: 18 },
    { key: "direct", width: 18 },
    { key: "gross", width: 18 },
    { key: "payout", width: 18 },
  ];
  addTitleRows(worksheet, "West Coast Insurance Brokers - Pay Sheet", `${periodLabel(model)} - ${model.scope === "all" ? "Full agency" : "Single owner"}`);

  const sophia = model.sheets.find((sheet) => sheet.ownerType === "sophia");
  if (sophia?.ownerType === "sophia") {
    addSectionRow(worksheet, "Sophia agency totals");
    addKeyMoneyRow(worksheet, "Sophia agency gross", sophia.totals.sophiaAgencyGross);
    addKeyMoneyRow(worksheet, "Sophia take-home", sophia.totals.sophiaTakeHome);
    addKeyMoneyRow(worksheet, "Sophia share", sophia.totals.sophiaShare);
    addKeyMoneyRow(worksheet, "Trust pull", sophia.totals.trustPull);
    addKeyMoneyRow(worksheet, "Direct check/ACH income", sophia.totals.directCheckAchIncome);
    worksheet.addRow([]).commit();
  }

  addSectionRow(worksheet, "By owner");
  addHeaderRow(worksheet, [
    "Owner",
    "Policies",
    "Broker fees",
    "Commissions",
    "Trust pull",
    "Direct income",
    "Agency gross",
    "Payout / take-home",
  ]);
  for (const sheet of model.sheets) {
    const payout = sheet.ownerType === "sophia"
      ? sheet.totals.sophiaTakeHome
      : sheet.totals?.producerPayout ?? null;
    const row = worksheet.addRow([
      safeSpreadsheetText(sheet.ownerDisplayName),
      sheet.policyCount,
      moneyCell(sheet.totals?.brokerFees ?? null),
      moneyCell(sheet.totals?.commissions ?? null),
      moneyCell(sheet.totals?.trustPull ?? null),
      moneyCell(sheet.totals?.directCheckAchIncome ?? null),
      moneyCell(sheet.ownerType === "sophia" ? sheet.totals.sophiaAgencyGross : null),
      moneyCell(payout),
    ]);
    applyMoneyFormat(row, [3, 4, 5, 6, 7, 8]);
    row.commit();
  }
  worksheet.commit();
}

function writeActivityWorksheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  model: PaySheetExportModel,
): void {
  const worksheet = workbook.addWorksheet("KPI Activity", {
    properties: { defaultRowHeight: 18 },
  });
  worksheet.columns = [{ width: 40 }, { width: 18 }];
  addTitleRows(worksheet, "KPI / Activity", periodLabel(model));
  const policies = activityPolicies(model);
  const transactionCounts = countBy(policies, (policy) => policy.transactionType);
  addSectionRow(worksheet, "Production by transaction type");
  addHeaderRow(worksheet, ["Transaction type", "Policies"]);
  for (const [label, count] of [...transactionCounts].sort(compareCountRows)) {
    worksheet.addRow([safeSpreadsheetText(label), count]).commit();
  }
  worksheet.addRow([]).commit();
  addSectionRow(worksheet, "Account mix");
  for (const [label, assignment] of [
    ["House (agency)", "none"],
    ["Producer book", "book"],
    ["First-year house", "house"],
  ] as const) {
    worksheet.addRow([label, policies.filter((policy) => policy.kayleeSplit === assignment).length]).commit();
  }
  worksheet.addRow([]).commit();
  addSectionRow(worksheet, "Producer payout activity");
  const producerSheets = model.sheets.filter((sheet) => sheet.ownerType === "producer");
  const paidToProducers = sumMoney(
    producerSheets.map((sheet) => sheet.totals?.producerPayout ?? "0.00"),
  );
  const firstYearPayout = sumMoney(
    producerSheets.flatMap((sheet) =>
      sheet.policies
        .filter((policy) => policy.kayleeSplit === "house")
        .map((policy) => policy.producerPayout ?? "0.00"),
    ),
  );
  addKeyMoneyRow(worksheet, "Paid to producers", paidToProducers);
  addKeyMoneyRow(worksheet, "First-year house paid to producers", firstYearPayout);
  worksheet.commit();
}

function writeOwnerWorksheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  sheet: PaySheetDetail,
  name: string,
): void {
  const worksheet = workbook.addWorksheet(name, {
    properties: { defaultRowHeight: 18 },
  });
  worksheet.columns = [
    { width: 27 },
    { width: 18 },
    { width: 22 },
    { width: 16 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
  ];
  addTitleRows(
    worksheet,
    safeSpreadsheetText(sheet.ownerDisplayName),
    `${sheet.periodYear}-${String(sheet.periodMonth).padStart(2, "0")} - ${sheet.status}`,
  );
  addSectionRow(worksheet, "Policies");
  addHeaderRow(worksheet, [
    "Insured",
    "Policy #",
    "Policy type",
    "Transaction",
    "Account",
    "Broker fee",
    "Commission",
    "Agency revenue",
    sheet.ownerType === "sophia" ? "Sophia share" : "Producer payout",
  ]);
  for (const policy of sheet.policies) {
    const row = worksheet.addRow([
      safeSpreadsheetText(policy.insuredName),
      safeSpreadsheetText(policy.policyNumber),
      safeSpreadsheetText(policy.policyTypeName),
      safeSpreadsheetText(policy.transactionType),
      accountLabel(policy.kayleeSplit),
      moneyCell(policy.brokerFee),
      moneyCell(policy.commissionAmount),
      moneyCell(policy.agencyRevenue),
      moneyCell(sheet.ownerType === "sophia" ? policy.sophiaShare : policy.producerPayout),
    ]);
    applyMoneyFormat(row, [6, 7, 8, 9]);
    row.commit();
  }

  if (sheet.adjustments.length > 0) {
    worksheet.addRow([]).commit();
    addSectionRow(worksheet, "Adjustments and direct income");
    addHeaderRow(worksheet, [
      "Date",
      "Insured / client",
      "Type",
      "Note",
      "Broker delta",
      "Commission delta",
      "Payout delta",
      "Income amount",
    ]);
    for (const adjustment of sheet.adjustments) {
      const row = worksheet.addRow([
        adjustment.effectiveDate,
        safeSpreadsheetText(adjustment.insuredOrClientLabel),
        adjustment.adjustmentType,
        safeSpreadsheetText(adjustment.reasonOrNote ?? ""),
        moneyCell(adjustment.brokerFeeDelta),
        moneyCell(adjustment.commissionDelta),
        moneyCell(adjustment.payoutDelta),
        moneyCell(adjustment.incomeAmount),
      ]);
      applyMoneyFormat(row, [5, 6, 7, 8]);
      row.commit();
    }
  }

  worksheet.addRow([]).commit();
  addSectionRow(worksheet, "Totals");
  writeOwnerTotals(worksheet, sheet);
  worksheet.commit();
}

function writeOwnerTotals(
  worksheet: ExcelJS.Worksheet,
  sheet: PaySheetDetail,
): void {
  if (sheet.totals === null) {
    worksheet.addRow(["Totals unavailable - producer rate required"]).commit();
    return;
  }
  const labels: Array<[string, string]> = [
    ["Broker fees", sheet.totals.brokerFees],
    ["Commissions", sheet.totals.commissions],
    ["Trust pull", sheet.totals.trustPull],
    ["Direct check/ACH income", sheet.totals.directCheckAchIncome],
    ["Grand total income", sheet.totals.grandTotalIncome],
  ];
  if (sheet.ownerType === "sophia") {
    labels.push(
      ["Sophia agency gross", sheet.totals.sophiaAgencyGross],
      ["Sophia share", sheet.totals.sophiaShare],
      ["Sophia take-home", sheet.totals.sophiaTakeHome],
    );
  } else {
    labels.push(["Producer payout", sheet.totals.producerPayout]);
  }
  for (const [label, value] of labels) addKeyMoneyRow(worksheet, label, value);
}

function renderPrintSummary(model: PaySheetExportModel): string {
  const sophia = model.sheets.find((sheet) => sheet.ownerType === "sophia");
  const sophiaTotals = sophia?.ownerType === "sophia"
    ? `<dl class="totals"><div><dt>Sophia agency gross</dt><dd>${moneyHtml(sophia.totals.sophiaAgencyGross)}</dd></div><div><dt>Sophia take-home</dt><dd>${moneyHtml(sophia.totals.sophiaTakeHome)}</dd></div><div><dt>Sophia share</dt><dd>${moneyHtml(sophia.totals.sophiaShare)}</dd></div><div><dt>Trust pull</dt><dd>${moneyHtml(sophia.totals.trustPull)}</dd></div><div><dt>Direct check/ACH income</dt><dd>${moneyHtml(sophia.totals.directCheckAchIncome)}</dd></div></dl>`
    : "";
  const rows = model.sheets.map((sheet) => {
    const payout = sheet.ownerType === "sophia"
      ? sheet.totals.sophiaTakeHome
      : sheet.totals?.producerPayout ?? null;
    return `<tr><td>${escapeHtml(sheet.ownerDisplayName)}</td><td>${sheet.policyCount}</td><td>${moneyHtml(sheet.totals?.brokerFees ?? null)}</td><td>${moneyHtml(sheet.totals?.commissions ?? null)}</td><td>${moneyHtml(sheet.totals?.trustPull ?? null)}</td><td>${moneyHtml(sheet.ownerType === "sophia" ? sheet.totals.sophiaAgencyGross : null)}</td><td>${moneyHtml(payout)}</td></tr>`;
  }).join("");
  return `<section class="agency-summary"><h2>Agency summary</h2>${sophiaTotals}<table><thead><tr><th>Owner</th><th>Policies</th><th>Broker fees</th><th>Commissions</th><th>Trust pull</th><th>Agency gross</th><th>Payout / take-home</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function renderPrintActivity(model: PaySheetExportModel): string {
  const policies = activityPolicies(model);
  const transactionRows = [...countBy(policies, (policy) => policy.transactionType)]
    .sort(compareCountRows)
    .map(([label, count]) => `<tr><td>${escapeHtml(label)}</td><td>${count}</td></tr>`)
    .join("");
  return `<section class="activity"><h2>KPI / Activity</h2><table><thead><tr><th>Transaction type</th><th>Policies</th></tr></thead><tbody>${transactionRows}</tbody></table></section>`;
}

function renderPrintOwner(sheet: PaySheetDetail): string {
  const policyRows = sheet.policies.map((policy) => `<tr><td>${escapeHtml(policy.insuredName)}</td><td>${escapeHtml(policy.policyNumber)}</td><td>${escapeHtml(policy.policyTypeName)}</td><td>${escapeHtml(policy.transactionType)}</td><td>${escapeHtml(accountLabel(policy.kayleeSplit))}</td><td>${moneyHtml(policy.brokerFee)}</td><td>${moneyHtml(policy.commissionAmount)}</td><td>${moneyHtml(policy.agencyRevenue)}</td><td>${moneyHtml(sheet.ownerType === "sophia" ? policy.sophiaShare : policy.producerPayout)}</td></tr>`).join("");
  const adjustments = sheet.adjustments.length === 0 ? "" : `<h3>Adjustments and direct income</h3><table><thead><tr><th>Date</th><th>Insured / client</th><th>Type</th><th>Note</th><th>Broker</th><th>Commission</th><th>Payout</th><th>Income</th></tr></thead><tbody>${sheet.adjustments.map(renderPrintAdjustment).join("")}</tbody></table>`;
  return `<section class="owner-sheet"><header><h2>${escapeHtml(sheet.ownerDisplayName)}</h2><p>${escapeHtml(sheet.ownerType === "sophia" ? "House / agency" : "Producer")} - ${escapeHtml(sheet.status)}</p></header><table><thead><tr><th>Insured</th><th>Policy #</th><th>Type</th><th>Transaction</th><th>Account</th><th>Broker</th><th>Commission</th><th>Revenue</th><th>${sheet.ownerType === "sophia" ? "Sophia share" : "Producer payout"}</th></tr></thead><tbody>${policyRows}</tbody></table>${adjustments}${renderPrintTotals(sheet)}</section>`;
}

function renderPrintAdjustment(adjustment: PaySheetAdjustmentView): string {
  return `<tr><td>${escapeHtml(adjustment.effectiveDate)}</td><td>${escapeHtml(adjustment.insuredOrClientLabel)}</td><td>${escapeHtml(adjustment.adjustmentType)}</td><td>${escapeHtml(adjustment.reasonOrNote ?? "")}</td><td>${moneyHtml(adjustment.brokerFeeDelta)}</td><td>${moneyHtml(adjustment.commissionDelta)}</td><td>${moneyHtml(adjustment.payoutDelta)}</td><td>${moneyHtml(adjustment.incomeAmount)}</td></tr>`;
}

function renderPrintTotals(sheet: PaySheetDetail): string {
  if (sheet.totals === null) return "<p>Totals unavailable - producer rate required.</p>";
  const totals: Array<[string, string]> = [
    ["Broker fees", sheet.totals.brokerFees],
    ["Commissions", sheet.totals.commissions],
    ["Trust pull", sheet.totals.trustPull],
    ["Direct check/ACH income", sheet.totals.directCheckAchIncome],
    ["Grand total income", sheet.totals.grandTotalIncome],
  ];
  if (sheet.ownerType === "sophia") {
    totals.push(
      ["Sophia agency gross", sheet.totals.sophiaAgencyGross],
      ["Sophia share", sheet.totals.sophiaShare],
      ["Sophia take-home", sheet.totals.sophiaTakeHome],
    );
  } else totals.push(["Producer payout", sheet.totals.producerPayout]);
  return `<dl class="totals owner-totals">${totals.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${moneyHtml(value)}</dd></div>`).join("")}</dl>`;
}

function addTitleRows(
  worksheet: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
): void {
  const titleRow = worksheet.addRow([safeSpreadsheetText(title)]);
  titleRow.font = { bold: true, color: { argb: "FF203B33" }, size: 16 };
  titleRow.commit();
  const subtitleRow = worksheet.addRow([safeSpreadsheetText(subtitle)]);
  subtitleRow.font = { color: { argb: "FF5F6E72" }, size: 10 };
  subtitleRow.commit();
  worksheet.addRow([]).commit();
}

function addSectionRow(
  worksheet: ExcelJS.Worksheet,
  label: string,
): void {
  const row = worksheet.addRow([safeSpreadsheetText(label)]);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF315C4A" } };
  row.commit();
}

function addHeaderRow(
  worksheet: ExcelJS.Worksheet,
  labels: readonly string[],
): void {
  const row = worksheet.addRow(labels.map(safeSpreadsheetText));
  row.font = { bold: true, color: { argb: "FF253A34" }, size: 10 };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0ED" } };
  row.commit();
}

function addKeyMoneyRow(
  worksheet: ExcelJS.Worksheet,
  label: string,
  value: string,
): void {
  const row = worksheet.addRow([safeSpreadsheetText(label), moneyCell(value)]);
  row.getCell(1).font = { bold: true };
  applyMoneyFormat(row, [2]);
  row.commit();
}

function applyMoneyFormat(row: ExcelJS.Row, columns: readonly number[]): void {
  for (const column of columns) row.getCell(column).numFmt = MONEY_FORMAT;
}

function moneyCell(value: string | null): number | null {
  if (value === null) return null;
  const cents = moneyToCents(value);
  const numericCents = Number(cents);
  if (!Number.isSafeInteger(numericCents)) throw new PaySheetExportConsistencyError();
  return numericCents / 100;
}

function moneyHtml(value: string | null): string {
  return value === null ? "Not available" : escapeHtml(formatMoney(value));
}

function formatMoney(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split(".");
  if (whole === undefined || fraction === undefined) throw new PaySheetExportConsistencyError();
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${fraction}`;
}

function sumMoney(values: readonly string[]): string {
  return centsToMoney(values.reduce((total, value) => total + moneyToCents(value), 0n));
}

function moneyToCents(value: string): bigint {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (match === null) throw new PaySheetExportConsistencyError();
  const cents = BigInt(match[2]!) * 100n + BigInt(match[3]!);
  return match[1] === "-" ? -cents : cents;
}

function centsToMoney(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function activityPolicies(model: PaySheetExportModel): readonly PaySheetPolicyView[] {
  const sophia = model.sheets.find((sheet) => sheet.ownerType === "sophia");
  if (sophia !== undefined) return sophia.policies;
  return model.sheets.flatMap((sheet) => sheet.policies);
}

function countBy(
  policies: readonly PaySheetPolicyView[],
  keyOf: (policy: PaySheetPolicyView) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const policy of policies) {
    const key = keyOf(policy);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function compareCountRows(
  left: readonly [string, number],
  right: readonly [string, number],
): number {
  return right[1] - left[1] || left[0].localeCompare(right[0]);
}

function compareSheets(left: PaySheetDetail, right: PaySheetDetail): number {
  if (left.ownerType !== right.ownerType) return left.ownerType === "sophia" ? -1 : 1;
  return left.ownerDisplayName.localeCompare(right.ownerDisplayName) || left.ownerUserId.localeCompare(right.ownerUserId);
}

function accountLabel(value: PaySheetPolicyView["kayleeSplit"]): string {
  if (value === "house") return "First-year house";
  if (value === "book") return "Producer book";
  return "House (agency)";
}

function uniqueSheetName(rawName: string, used: Set<string>): string {
  const cleaned = rawName.replace(INVALID_SHEET_NAME, " ").replace(/\s+/g, " ").trim() || "Owner";
  let candidate = cleaned.slice(0, 31);
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const addition = ` ${suffix}`;
    candidate = `${cleaned.slice(0, 31 - addition.length)}${addition}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function periodLabel(model: Pick<PaySheetExportModel, "periodMonth" | "periodYear">): string {
  return `${MONTHS[model.periodMonth - 1]} ${model.periodYear}`;
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new PaySheetExportConsistencyError();
  return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const PRINT_CSS = `
@page{size:landscape;margin:0.45in}*{box-sizing:border-box}body{margin:0;color:#17231f;font-family:Arial,sans-serif;font-size:10px}main{width:100%}.report-header{border-bottom:2px solid #1f4e3c;padding:0 0 12px}.report-header p{margin:0;color:#315c4a;font-size:9px;font-weight:700;text-transform:uppercase}.report-header h1{margin:4px 0;font-size:22px}.report-header span{color:#5f6e72}section{margin-top:20px}h2{margin:0 0 9px;color:#203b33;font-size:16px}h3{margin:18px 0 7px;font-size:12px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{overflow-wrap:anywhere;border:1px solid #bcc8c4;padding:6px;text-align:left;vertical-align:top}th{background:#e8f0ed;font-size:8px;text-transform:uppercase}.totals{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;margin:0 0 14px;background:#bcc8c4;border:1px solid #bcc8c4}.totals div{background:#fff;padding:8px}.totals dt{color:#5f6e72;font-size:8px;text-transform:uppercase}.totals dd{margin:3px 0 0;font-size:14px;font-weight:700}.owner-sheet{break-before:page}.owner-sheet>header{display:flex;align-items:end;justify-content:space-between;border-bottom:2px solid #315c4a;padding-bottom:7px}.owner-sheet>header h2,.owner-sheet>header p{margin:0}.owner-totals{grid-template-columns:repeat(4,minmax(0,1fr));margin-top:16px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.owner-sheet{break-before:page}tr{break-inside:avoid}}`;
