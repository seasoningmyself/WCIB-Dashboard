import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import ExcelJS from "exceljs";
import {
  buildPaySheetExportModel,
  escapeHtml,
  paySheetExportFilename,
  PaySheetExportConsistencyError,
  PaySheetExportNotFoundError,
  renderPaySheetPrintHtml,
  safeSpreadsheetText,
  writePaySheetWorkbook,
} from "./export-document.js";
import {
  exportDetailFixture,
  exportProducerSummary,
  exportSophiaSummary,
  uuid,
} from "./export-test-fixture.js";

const GENERATED_AT = new Date("2026-07-12T12:00:00.000Z");
const QUERY = { ownerUserId: null, periodMonth: 7, periodYear: 2026 } as const;

test("streamed workbook is valid, exact, formula-safe, and separates Sophia totals", async () => {
  const sophia = exportDetailFixture(
    exportSophiaSummary({ ownerDisplayName: "Sophia [Agency]" }),
    {
      insuredName: '=HYPERLINK("https://bad.test")',
      policyNumber: "+SUM(1,1)",
    },
    { reasonOrNote: "@malicious-note" },
  );
  const producer = exportDetailFixture(
    exportProducerSummary({ ownerDisplayName: "Kaylee / Producer" }),
  );
  const model = buildPaySheetExportModel([producer, sophia], QUERY, GENERATED_AT);
  const bytes = await workbookBytes(model);
  assert.ok(bytes.byteLength > 1_000);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(
    workbook.worksheets.map(({ name }) => name),
    ["Agency Summary", "KPI Activity", "Sophia Agency", "Kaylee Producer"],
  );
  const summary = workbook.getWorksheet("Agency Summary");
  assert.ok(summary);
  assert.equal(valueBeside(summary, "Sophia agency gross"), 250);
  assert.equal(valueBeside(summary, "Sophia take-home"), 212.5);
  assert.notEqual(
    valueBeside(summary, "Sophia agency gross"),
    valueBeside(summary, "Sophia take-home"),
  );
  const owner = workbook.getWorksheet("Sophia Agency");
  assert.ok(owner);
  assert.equal(hasValue(owner, `'${sophia.policies[0]!.insuredName}`), true);
  assert.equal(hasValue(owner, `'${sophia.policies[0]!.policyNumber}`), true);
  assert.equal(hasValue(owner, "'@malicious-note"), true);
  assert.equal(hasValue(owner, "Kaylee's book"), true);
  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow((row) => row.eachCell((cell) => {
      assert.equal(
        typeof cell.value === "object" && cell.value !== null && "formula" in cell.value,
        false,
      );
    }));
  }
});

test("print HTML is self-contained, scoped, and escapes all user content", () => {
  const malicious = exportDetailFixture(
    exportSophiaSummary({ ownerDisplayName: "<script>alert(1)</script>" }),
    { insuredName: "<img src=x onerror=alert(1)>" },
    { reasonOrNote: "A & B < C" },
  );
  const model = buildPaySheetExportModel([malicious], QUERY, GENERATED_AT);
  const html = renderPaySheetPrintHtml(model);

  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Sophia agency gross/);
  assert.match(html, /Sophia take-home/);
  assert.match(html, /\$250\.00/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /A &amp; B &lt; C/);
  assert.match(html, /Kaylee&#39;s book/);
  assert.doesNotMatch(html, /<script|<img/i);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test("single-owner scope excludes every other owner and filenames contain no PII", async () => {
  const producer = exportDetailFixture(exportProducerSummary());
  const query = { ...QUERY, ownerUserId: producer.ownerUserId };
  const model = buildPaySheetExportModel([producer], query, GENERATED_AT);
  const html = renderPaySheetPrintHtml(model);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await workbookBytes(model));

  assert.equal(model.scope, "single");
  assert.equal(model.sheets.length, 1);
  assert.doesNotMatch(html, /Sophia/);
  assert.deepEqual(workbook.worksheets.map(({ name }) => name), [
    "Agency Summary",
    "KPI Activity",
    "Kaylee",
  ]);
  assert.equal(paySheetExportFilename(query, "excel"), "WCIB_Pay_Sheet_2026-07.xlsx");
  assert.equal(paySheetExportFilename(query, "print"), "WCIB_Pay_Sheet_2026-07.html");
  assert.doesNotMatch(paySheetExportFilename(query, "excel"), /Kaylee|00000000/i);
});

test("export model rejects empty, cross-period, duplicate-owner, and wrong-owner facts", () => {
  const sophia = exportDetailFixture();
  assert.throws(
    () => buildPaySheetExportModel([], QUERY, GENERATED_AT),
    PaySheetExportNotFoundError,
  );
  assert.throws(
    () => buildPaySheetExportModel([
      { ...sophia, periodMonth: 6 },
    ], QUERY, GENERATED_AT),
    PaySheetExportConsistencyError,
  );
  assert.throws(
    () => buildPaySheetExportModel([sophia, { ...sophia, id: uuid(99) }], QUERY, GENERATED_AT),
    PaySheetExportConsistencyError,
  );
  assert.throws(
    () => buildPaySheetExportModel(
      [sophia],
      { ...QUERY, ownerUserId: uuid(80) },
      GENERATED_AT,
    ),
    PaySheetExportConsistencyError,
  );
});

test("escaping helpers cover formula prefixes, whitespace, and HTML metacharacters", () => {
  for (const value of ["=1+1", "+cmd", "-2+3", "@SUM", "  =hidden", "\t+hidden"]) {
    assert.equal(safeSpreadsheetText(value), `'${value}`);
  }
  assert.equal(safeSpreadsheetText("ordinary text"), "ordinary text");
  assert.equal(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
});

async function workbookBytes(
  model: ReturnType<typeof buildPaySheetExportModel>,
): Promise<Buffer> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = once(stream, "finish");
  await writePaySheetWorkbook(model, stream);
  await finished;
  return Buffer.concat(chunks);
}

function valueBeside(worksheet: ExcelJS.Worksheet, label: string): unknown {
  let found: unknown;
  worksheet.eachRow((row) => {
    if (row.getCell(1).value === label) found = row.getCell(2).value;
  });
  return found;
}

function hasValue(worksheet: ExcelJS.Worksheet, value: string): boolean {
  let found = false;
  worksheet.eachRow((row) => row.eachCell((cell) => {
    if (cell.value === value) found = true;
  }));
  return found;
}
