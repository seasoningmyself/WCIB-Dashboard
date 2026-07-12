import { PassThrough, Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { RequestHandler, Response } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  paySheetExportQuerySchema,
  type PaySheetExportFormat,
  type PaySheetExportQuery,
} from "../../shared/pay-sheet-export.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import {
  buildPaySheetExportModel,
  paySheetExportFilename,
  PaySheetExportConsistencyError,
  PaySheetExportNotFoundError,
  renderPaySheetPrintHtml,
  writePaySheetWorkbook,
  type PaySheetExportModel,
} from "../pay-sheets/export-document.js";
import {
  PaySheetBoundsError,
  type PaySheetSourceList,
} from "../pay-sheets/read.js";
import { POLICY_LEDGER_ADMIN_ACCESS } from "../policies/ledger-access.js";
import { asyncRoute, HttpError } from "./errors.js";
import { projectPaySheetDetail } from "./pay-sheets.js";
import type { RouteRegistrar } from "./routes.js";

export const PAY_SHEET_EXCEL_EXPORT_PATH = "/api/pay-sheets/exports/excel";
export const PAY_SHEET_PRINT_EXPORT_PATH = "/api/pay-sheets/exports/print";

export type PaySheetExportStreamer = (
  response: Response,
  model: PaySheetExportModel,
) => Promise<number>;

export interface PaySheetExportHandlerDependencies {
  clock?(): Date;
  list(
    context: AuthorizedRequestContext,
    query: unknown,
  ): Promise<PaySheetSourceList>;
  logger: AppLogger;
  streamExcel?: PaySheetExportStreamer;
  streamPrint?: PaySheetExportStreamer;
}

export interface RegisterPaySheetExportRoutesOptions
  extends PaySheetExportHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createPaySheetExportHandler(
  dependencies: PaySheetExportHandlerDependencies,
  format: PaySheetExportFormat,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const startedAt = performance.now();
    const context = getAuthorizedRequestContext(res);
    const query = paySheetExportQuerySchema.parse(req.query);
    let source: PaySheetSourceList;
    try {
      source = await dependencies.list(context, listQuery(query));
    } catch (error) {
      if (error instanceof PaySheetBoundsError) {
        throw new HttpError(400, apiErrorCodes.badRequest, "Pay-sheet export scope is invalid");
      }
      throw error;
    }

    let model: PaySheetExportModel;
    try {
      model = buildPaySheetExportModel(
        source.items.map((item) => projectPaySheetDetail(res, item)),
        query,
        dependencies.clock?.() ?? new Date(),
      );
    } catch (error) {
      if (error instanceof PaySheetExportNotFoundError) {
        throw new HttpError(404, apiErrorCodes.notFound, "No pay sheets matched the export scope");
      }
      if (error instanceof PaySheetExportConsistencyError) {
        throw new HttpError(409, apiErrorCodes.badRequest, "Pay-sheet export facts are inconsistent");
      }
      throw error;
    }

    setExportHeaders(res, query, format);
    const stream = format === "excel"
      ? dependencies.streamExcel ?? streamExcelResponse
      : dependencies.streamPrint ?? streamPrintResponse;
    let byteCount: number;
    try {
      byteCount = await stream(res, model);
    } catch (error) {
      dependencies.logger.error("Pay-sheet export failed", {
        component: "pay_sheet_exports",
        durationMs: elapsedMilliseconds(startedAt),
        event: "pay_sheet_export_failed",
        format,
        ownerScope: model.scope,
        periodMonth: model.periodMonth,
        periodYear: model.periodYear,
        userId: context.principal.userId,
      }, error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      clearExportHeaders(res);
      throw error;
    }

    dependencies.logger.info("Pay-sheet export streamed", {
      byteCount,
      component: "pay_sheet_exports",
      durationMs: elapsedMilliseconds(startedAt),
      event: "pay_sheet_export_streamed",
      format,
      ownerScope: model.scope,
      periodMonth: model.periodMonth,
      periodYear: model.periodYear,
      sheetCount: model.sheets.length,
      userId: context.principal.userId,
    });
  });
}

export function registerPaySheetExportRoutes(
  routes: RouteRegistrar,
  options: RegisterPaySheetExportRoutesOptions,
): void {
  const adminAccess = {
    authorization: options.authorization.require(POLICY_LEDGER_ADMIN_ACCESS),
  } as const;
  routes.get(
    PAY_SHEET_EXCEL_EXPORT_PATH,
    adminAccess,
    createPaySheetExportHandler(options, "excel"),
  );
  routes.get(
    PAY_SHEET_PRINT_EXPORT_PATH,
    adminAccess,
    createPaySheetExportHandler(options, "print"),
  );
}

export async function streamExcelResponse(
  response: Response,
  model: PaySheetExportModel,
): Promise<number> {
  const source = new PassThrough();
  const counter = new ByteCounter();
  try {
    await Promise.all([
      writePaySheetWorkbook(model, source),
      pipeline(source, counter, response),
    ]);
    return counter.byteCount;
  } catch (error) {
    source.destroy(asError(error));
    throw error;
  }
}

export async function streamPrintResponse(
  response: Response,
  model: PaySheetExportModel,
): Promise<number> {
  const html = renderPaySheetPrintHtml(model);
  const counter = new ByteCounter();
  await pipeline(Readable.from(chunkString(html, 16_384)), counter, response);
  return counter.byteCount;
}

function listQuery(query: PaySheetExportQuery) {
  return {
    ownerType: "all" as const,
    ownerUserId: query.ownerUserId,
    periodMonth: query.periodMonth,
    periodYear: query.periodYear,
    status: "all" as const,
  };
}

function setExportHeaders(
  response: Response,
  query: PaySheetExportQuery,
  format: PaySheetExportFormat,
): void {
  response.status(200);
  response.set({
    "Cache-Control": "no-store",
    "Content-Disposition": `${format === "excel" ? "attachment" : "inline"}; filename="${paySheetExportFilename(query, format)}"`,
    "Content-Type": format === "excel"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/html; charset=utf-8",
    "Cross-Origin-Resource-Policy": "same-origin",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (format === "print") {
    response.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  }
}

function clearExportHeaders(response: Response): void {
  for (const header of [
    "Cache-Control",
    "Content-Disposition",
    "Content-Security-Policy",
    "Content-Type",
    "Cross-Origin-Resource-Policy",
    "Pragma",
    "Referrer-Policy",
    "X-Content-Type-Options",
  ]) response.removeHeader(header);
}

function* chunkString(value: string, chunkSize: number): Generator<string> {
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    yield value.slice(offset, offset + chunkSize);
  }
}

class ByteCounter extends Transform {
  byteCount = 0;

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.byteCount += Buffer.isBuffer(chunk)
      ? chunk.byteLength
      : Buffer.byteLength(chunk, encoding);
    callback(null, chunk);
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("Pay-sheet export stream failed");
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.round(Math.max(0, performance.now() - startedAt) * 100) / 100;
}
